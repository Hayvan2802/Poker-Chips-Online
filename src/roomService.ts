import { onValue, ref, remove, runTransaction, serverTimestamp, set, type Database } from 'firebase/database'
import { actionKey, applyRequest, cleanName, newRoom, ROOM_ROOT, roomCode, type RoomRequest, type RoomState } from './roomCore'

export async function createRoom(db: Database, uid: string, name: string, actionId: string) {
  cleanName(name); actionKey(actionId)
  await waitForConnection(db)
  for (let attempt = 0; attempt < 12; attempt++) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${uid}:${actionId}:${attempt}`))
    const code = String(100000 + new DataView(digest).getUint32(0) % 900000)
    try {
      const tx = await runTransaction(ref(db, `${ROOM_ROOT}/rooms/${code}`), current => {
        if (current) return current.hostUid === uid && current.creationAction === actionId ? current : undefined
        return newRoom(code, uid, name, actionId)
      }, {applyLocally: false})
      if (tx.committed) return {roomId: code}
    } catch (error) {
      // An occupied private code is intentionally unreadable to other users.
      if ((error as {code?: string}).code !== 'PERMISSION_DENIED') throw error
    }
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

export function serveRoom(db: Database, uid: string, code: string, reportError: (error: unknown) => void = () => {}) {
  let stopped = false, processing = false
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
            try { return applyRequest(current as RoomState, request) }
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
  return () => { stopped = true; stop() }
}
