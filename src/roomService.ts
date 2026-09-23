import { onValue, ref, remove, runTransaction, serverTimestamp, set, type Database } from 'firebase/database'
import { actionKey, applyRequest, applyTurnTimeout, cleanName, newRoom, ROOM_ROOT, roomCode, type RoomRequest, type RoomState } from './roomCore'

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
        if (current) return current.hostUid === uid && current.creationAction === actionId ? current : undefined
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

interface Response {ok: boolean; version?: number; error?: string}
function waitForConnection(db: Database) {
  return new Promise<void>((resolve, reject) => {
    let stop: (() => void) | undefined
    const timer = setTimeout(() => { stop?.(); reject(Error('Keine Verbindung zu Firebase. Bitte erneut versuchen')) }, 8000)
    stop = onValue(ref(db, '.info/connected'), snapshot => {
      if (snapshot.val() === true) { clearTimeout(timer); stop?.(); resolve() }
    }, error => { clearTimeout(timer); stop?.(); reject(error) })
  })
}
export async function submitRequest(db: Database, uid: string, code: string, kind: RoomRequest['kind'], payload: Record<string, any>, actionId: string) {
  roomCode(code); actionKey(actionId)
  await waitForConnection(db)
  const requestRef = ref(db, `${ROOM_ROOT}/requests/${code}/${uid}/${actionId}`)
  const responseRef = ref(db, `${ROOM_ROOT}/responses/${code}/${uid}/${actionId}`)
  return new Promise<{roomId: string; version?: number}>((resolve, reject) => {
    let settled = false, stop: (() => void) | undefined
    const finish = (error?: Error, response?: Response) => {
      if (settled) return
      settled = true; clearTimeout(timer); stop?.()
      if (error) reject(error)
      else resolve({roomId: code, version: response?.version})
    }
    const timer = setTimeout(() => {
      finish(Error('Der Host antwortet nicht. Der Host muss den Tisch geöffnet lassen. Prüfe den Tisch und versuche es erneut.'))
      void remove(requestRef).catch(() => {})
    }, 30000)
    stop = onValue(responseRef, snapshot => {
      const response = snapshot.val() as Response | null
      if (response) finish(response.ok ? undefined : Error(response.error || 'Anfrage abgelehnt'), response)
    }, error => finish(error))
    void set(requestRef, {uid, actionId, kind, payload, createdAt: serverTimestamp()}).catch(error => finish(error))
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
