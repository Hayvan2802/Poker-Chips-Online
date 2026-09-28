import { get, onValue, ref, remove, runTransaction, serverTimestamp, set, type Database } from 'firebase/database'
import { actionKey, applyRequest, applyTurnTimeout, cleanName, newRoom, ROOM_ROOT, roomCode, type RoomRequest, type RoomState } from '../game/roomCore'

async function generatedCode(uid: string, actionId: string, attempt: number) {
  const input = `${uid}:${actionId}:${attempt}`
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
    return String(100000 + new DataView(digest).getUint32(0) % 900000)
  }
  // Stable fallback keeps retried create commands idempotent on older WebKit.
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619) >>> 0
  return String(100000 + hash % 900000)
}
export async function createRoom(db: Database, uid: string, name: string, actionId: string, requestedCode?: string) {
  cleanName(name); actionKey(actionId)
  if (requestedCode) roomCode(requestedCode)
  await waitForConnection(db)
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = requestedCode || await generatedCode(uid, actionId, attempt)
    try {
      const tx = await runTransaction(ref(db, `${ROOM_ROOT}/rooms/${code}`), current => {
        // A custom code already owned by this anonymous UID resumes its table.
        // Never reset a room simply because the host left and returned.
        if (current) return current.hostUid === uid && (current.creationAction === actionId || !!requestedCode) ? current : undefined
        return newRoom(code, uid, name, actionId)
      }, {applyLocally: false})
      if (tx.committed) return {roomId: code}
    } catch (error) {
      // An occupied private code is intentionally unreadable to other users.
      const denied = error as {code?: string; message?: string}
      if (!/permission[_-]denied/i.test(denied.code || denied.message || '')) throw error
    }
    if (requestedCode) throw Error('Dieser Raumcode ist bereits belegt. Wähle einen anderen oder lass einen Code generieren.')
  }
  throw Error('Kein Raumcode verfügbar. Bitte erneut versuchen')
}

interface Response {ok: boolean; version?: number; error?: string; fingerprint?: string}
// RTDB omits empty containers/nulls and can return numeric-keyed objects as
// arrays. Compare the stored value, independently of JavaScript key order.
function storedValue(value: any): any {
  if (value === null || typeof value !== 'object') return value
  const entries = Object.keys(value).sort().map(key => [key, storedValue(value[key])])
    .filter(([, child]) => child !== null)
  return entries.length ? Object.fromEntries(entries) : null
}
function requestFingerprint(kind: RoomRequest['kind'], payload: Record<string, any>) {
  return JSON.stringify([kind, storedValue(payload)])
}
function waitForConnection(db: Database) {
  return new Promise<void>((resolve, reject) => {
    let settled = false, stop: (() => void) | undefined
    const finish = (error?: Error) => {
      if (settled) return
      settled = true; clearTimeout(timer); stop?.()
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => finish(Error('Keine Verbindung zu Firebase. Bitte erneut versuchen')), 8000)
    stop = onValue(ref(db, '.info/connected'), snapshot => {
      if (snapshot.val() === true) finish()
    }, error => finish(error))
    if (settled) stop()
  })
}
const pendingRequests = new WeakMap<Database, Map<string, {fingerprint: string; result: Promise<{roomId: string; version?: number}>}>>()
export async function submitRequest(db: Database, uid: string, code: string, kind: RoomRequest['kind'], payload: Record<string, any>, actionId: string) {
  roomCode(code); actionKey(actionId)
  let pending = pendingRequests.get(db)
  if (!pending) { pending = new Map(); pendingRequests.set(db, pending) }
  const key = `${code}/${uid}/${actionId}`, fingerprint = requestFingerprint(kind, payload)
  const existing = pending.get(key)
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw Error('actionId wurde bereits verwendet')
    return existing.result
  }
  const result = sendRequest(db, uid, code, kind, payload, actionId).finally(() => {
    if (pending.get(key)?.result === result) pending.delete(key)
  })
  pending.set(key, {fingerprint, result})
  return result
}
async function sendRequest(db: Database, uid: string, code: string, kind: RoomRequest['kind'], payload: Record<string, any>, actionId: string) {
  roomCode(code); actionKey(actionId)
  const requestRef = ref(db, `${ROOM_ROOT}/requests/${code}/${uid}/${actionId}`)
  const responseRef = ref(db, `${ROOM_ROOT}/responses/${code}/${uid}/${actionId}`)
  const fingerprint = requestFingerprint(kind, payload)
  const matchingResponse = async (response: Response) => {
    if (response.fingerprint !== undefined) {
      if (response.fingerprint !== fingerprint) throw Error('actionId wurde bereits verwendet')
    } else if (response.ok) {
      // Existing v0.12 hosts/responses have no fingerprint. Their committed
      // receipt still binds success to the original command and sender.
      const receipt = (await get(ref(db, `${ROOM_ROOT}/rooms/${code}/processed/${actionId}`))).val()
      let matches = false
      try {
        const [oldKind, oldPayload] = JSON.parse(receipt?.fingerprint)
        matches = receipt.uid === uid && requestFingerprint(oldKind, oldPayload) === fingerprint
      } catch { /* A missing/expired receipt cannot prove this retry succeeded. */ }
      if (!matches) throw Error('actionId kann nicht mehr bestätigt werden. Bitte den Tisch prüfen und erneut versuchen.')
    }
    if (!response.ok) throw Error(response.error || 'Anfrage abgelehnt')
    return {roomId: code, version: response.version}
  }
  return new Promise<{roomId: string; version?: number}>((resolve, reject) => {
    let settled = false, stop: (() => void) | undefined
    const finish = (error?: Error, response?: Response) => {
      if (settled) return
      settled = true; clearTimeout(timer); stop?.()
      if (error) reject(error)
      else resolve({roomId: code, version: response?.version})
    }
    const timer = setTimeout(() => {
      // A deadline cannot cancel a Firebase write already in flight. Only the
      // host removes shared request slots: another tab may still await this one.
      finish(Error('Die Bestätigung vom Host fehlt. Die Aktion kann bereits ausgeführt worden sein oder noch eintreffen. Prüfe den Tisch, bevor du sie erneut ausführst.'))
    }, 30000)
    void (async () => {
      // Reads can stay pending through a disconnect too. The same deadline
      // covers connection, cached responses, receipt checks and queued writes.
      await waitForConnection(db)
      if (settled) return
      const cached = (await get(responseRef)).val() as Response | null
      if (settled) return
      if (cached) {
        await matchingResponse(cached)
        finish(undefined, cached)
        return
      }
      const existing = (await get(requestRef)).val() as RoomRequest | null
      if (settled) return
      if (existing) {
        if (existing.uid !== uid || requestFingerprint(existing.kind, existing.payload) !== fingerprint) throw Error('actionId wurde bereits verwendet')
      } else {
        try {
          await set(requestRef, {uid, actionId, kind, payload, createdAt: serverTimestamp()})
        } catch (error) {
          if (settled) return
          // Requests are immutable. Another tab/retry may already own this slot;
          // only an identical request may wait for its response.
          const pending = (await get(requestRef)).val() as RoomRequest | null
          if (settled) return
          if (pending) {
            if (pending.uid !== uid || requestFingerprint(pending.kind, pending.payload) !== fingerprint) throw Error('actionId wurde bereits verwendet')
          } else {
            const completed = (await get(responseRef)).val() as Response | null
            if (settled) return
            if (!completed) throw error
            await matchingResponse(completed)
            finish(undefined, completed)
            return
          }
        }
      }
      if (settled) return
      stop = onValue(responseRef, snapshot => {
        if (settled) return
        const response = snapshot.val() as Response | null
        if (response) void matchingResponse(response).then(() => finish(undefined, response), error => finish(error))
      }, error => finish(error))
      if (settled) stop()
    })().catch(error => finish(error))
  })
}

// The previous host must finish this transaction before the next host starts
// serving the inbox. Sending it through that inbox can strand its response.
export async function transferHost(db:Database, uid:string, code:string, payload:Record<string,any>, actionId:string) {
  roomCode(code);actionKey(actionId);await waitForConnection(db)
  const request:RoomRequest={uid,actionId,kind:'roomCommand',createdAt:Date.now(),payload}
  let reason='Hostwechsel fehlgeschlagen'
  const result=await runTransaction(ref(db,`${ROOM_ROOT}/rooms/${code}`), current=>{
    if(!current)return
    try{return applyRequest(current as RoomState,request,Date.now())}
    catch(error){reason=error instanceof Error?error.message:reason;return}
  },{applyLocally:false})
  if(!result.committed)throw Error(reason)
  return {roomId:code,version:result.snapshot.val().version}
}

export function serveRoom(db: Database, uid: string, code: string, reportError: (error: unknown) => void = () => {}) {
  let stopped = false, processing = false
  let serverOffset = 0
  const stopOffset = onValue(ref(db, '.info/serverTimeOffset'), snapshot => { serverOffset = Number(snapshot.val()) || 0 })
  let inbox: Record<string, Record<string, RoomRequest>> = {}
  const processInbox = async () => {
    if (processing || stopped) return
    processing = true
    try {
      while (!stopped) {
        const pending = Object.entries(inbox).flatMap(([sender, requests]) => Object.entries(requests).map(([id, request]) => ({sender, id, request})))
          .sort((a, b) => a.request.createdAt - b.request.createdAt)
        if (!pending.length) break
        const {sender, id, request} = pending[0]
        delete inbox[sender][id]
        let response: Response
        try {
          if (sender !== request.uid || id !== request.actionId) throw Error('Ungültiger Absender')
          let reason = 'Tisch ist nicht verfügbar'
          const tx = await runTransaction(ref(db, `${ROOM_ROOT}/rooms/${code}`), current => {
            if (!current) return null
            if (current.hostUid !== uid) { reason = 'Nur der Host darf den Tisch verwalten'; return }
            try { return applyRequest(current as RoomState, request, Date.now() + serverOffset) }
            catch (error) { reason = error instanceof Error ? error.message : 'Anfrage abgelehnt'; return }
          }, {applyLocally: false})
          if (!tx.committed || !tx.snapshot.val()) throw Error(reason)
          response = {ok: true, version: tx.snapshot.val().version}
        } catch (error) { response = {ok: false, error: error instanceof Error ? error.message : 'Anfrage abgelehnt'} }
        if (stopped) break
        response.fingerprint = requestFingerprint(request.kind, request.payload)
        await set(ref(db, `${ROOM_ROOT}/responses/${code}/${sender}/${id}`), response)
        await remove(ref(db, `${ROOM_ROOT}/requests/${code}/${sender}/${id}`))
      }
    } catch (error) { if (!stopped) reportError(error) }
    finally { processing = false }
  }
  const stop = onValue(ref(db, `${ROOM_ROOT}/requests/${code}`), snapshot => {
    inbox = snapshot.val() || {}
    void processInbox()
  }, reportError)
  let turnDeadline = 0
  const stopClock = onValue(ref(db, `${ROOM_ROOT}/rooms/${code}`), snapshot => {
    turnDeadline = snapshot.val()?.turnClock?.deadline || 0
  }, reportError)
  const timer = setInterval(async () => {
    if (stopped || processing || !turnDeadline || Date.now() + serverOffset < turnDeadline) return
    if (Object.values(inbox).some(requests => Object.keys(requests).length)) { void processInbox(); return }
    processing = true
    try {
      await runTransaction(ref(db, `${ROOM_ROOT}/rooms/${code}`), current => {
        if (!current || current.hostUid !== uid) return
        return applyTurnTimeout(current as RoomState, Date.now() + serverOffset)
      }, {applyLocally: false})
    } catch (error) { if (!stopped) reportError(error) }
    finally { processing = false; if (!stopped) void processInbox() }
  }, 500)
  return () => { stopped = true; stop(); stopOffset(); stopClock(); clearInterval(timer) }
}
