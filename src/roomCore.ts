import { act, assertChips, createGame, deal, nextHand, payout, reveal, type Game } from './engine'

export const ROOM_ROOT = 'poker/v2'
export interface Member { uid: string; name: string; host: boolean; ready: boolean; seat?: number }
export interface RoomState {
  code: string; name: string; hostUid: string; creationAction: string; status: 'lobby'|'playing'
  version: number; createdAt: number; settings: {stack: number; sb: number; bb: number}
  members: Record<string, Member>; game?: Game
  presence?: Record<string, Record<string, boolean>>
  processed?: Record<string, {uid: string; fingerprint: string; version: number}>
  history?: Record<string, {type: string; uid: string; at: number; version: number}>
}
export interface RoomRequest {
  uid: string; actionId: string; kind: 'joinRoom'|'roomCommand'; createdAt: number
  payload: Record<string, any>
}
export function cleanName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 24) throw Error('Name muss 2 bis 24 Zeichen haben')
  return value.trim()
}
export function roomCode(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value)) throw Error('Raumcode muss sechsstellig sein')
  return value
}
export function actionKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(value)) throw Error('Ungültige actionId')
  return value
}
export function newRoom(code: string, uid: string, name: string, actionId: string): RoomState {
  return {code: roomCode(code), name: `${cleanName(name)}s Tisch`, hostUid: uid, creationAction: actionKey(actionId), status: 'lobby', version: 1,
    createdAt: Date.now(), settings: {stack: 10000, sb: 50, bb: 100},
    members: {[uid]: {uid, name: cleanName(name), host: true, ready: false, seat: 0}}}
}
function trimMap(map: Record<string, any>) {
  const keys = Object.keys(map).sort((a, b) => (map[a]?.version ?? 0) - (map[b]?.version ?? 0))
  for (const key of keys.slice(0, Math.max(0, keys.length - 256))) delete map[key]
}
// The host's browser is the trusted referee. Guests can submit requests, but
// Firebase Rules never allow them to write membership, settings or game state.
export function applyRequest(current: RoomState, request: RoomRequest): RoomState {
  const room: RoomState = JSON.parse(JSON.stringify(current))
  const {uid, payload: data, actionId} = request
  actionKey(actionId)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Ungültiger Befehl')
  const fingerprint = JSON.stringify([request.kind, data])
  const old = room.processed?.[actionId]
  if (old) {
    if (old.uid !== uid || old.fingerprint !== fingerprint) throw Error('actionId wurde bereits verwendet')
    return room
  }
  if (!Number.isFinite(request.createdAt) || Date.now() - request.createdAt > 25000 || request.createdAt > Date.now() + 120000) throw Error('Anfrage ist abgelaufen. Bitte erneut versuchen')
  const lobby = () => { if (room.status !== 'lobby') throw Error('Diese Aktion ist nur in der Lobby möglich') }
  const host = () => { if (room.hostUid !== uid) throw Error('Nur der Host darf diese Aktion ausführen') }
  const resetReady = () => Object.values(room.members).forEach(member => { member.ready = false })
  if (request.kind === 'joinRoom') {
    const name = cleanName(data.name)
    if (!room.members[uid]) {
      lobby()
      if (Object.keys(room.members).length >= 9) throw Error('Der Tisch ist voll')
      room.members[uid] = {uid, name, host: false, ready: false}
      resetReady()
    }
  } else if (request.kind === 'roomCommand') {
    const me = room.members[uid]
    if (!me) throw Error('Kein Mitglied dieses Raums')
    if (!Number.isSafeInteger(data.expectedVersion) || room.version !== data.expectedVersion) throw Error('Der Tisch wurde inzwischen aktualisiert. Bitte erneut versuchen')
    if (data.handId !== undefined && data.handId !== room.game?.handId) throw Error('Diese Hand wurde bereits beendet')
    switch (data.type) {
      case 'takeSeat': {
        lobby()
        if (!Number.isInteger(data.seat) || data.seat < 0 || data.seat > 8) throw Error('Ungültiger Sitzplatz')
        if (Object.values(room.members).some(member => member.uid !== uid && member.seat === data.seat)) throw Error('Sitz ist nicht mehr frei')
        me.seat = data.seat; resetReady(); break
      }
      case 'ready':
        lobby(); if (me.seat == null) throw Error('Bitte zuerst einen Sitz wählen'); me.ready = !me.ready; break
      case 'settings': {
        lobby(); host()
        const {stack, sb, bb} = data
        if (![stack, sb, bb].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1000000000) || sb >= bb || bb > stack) throw Error('Ganze Chips eingeben: Small Blind < Big Blind ≤ Startstack')
        room.settings = {stack, sb, bb}; resetReady(); break
      }
      case 'start': {
        lobby(); host()
        const members = Object.values(room.members)
        if (members.length < 2 || members.some(member => member.seat == null || !member.ready)) throw Error('Alle Spieler müssen sitzen und bereit sein')
        room.game = createGame(members.map(member => ({uid: member.uid, name: member.name, seat: member.seat!})), room.settings.stack, room.settings.sb, room.settings.bb, Math.min(...members.map(member => member.seat!)))
        room.status = 'playing'; break
      }
      default: {
        if (room.status !== 'playing' || !room.game) throw Error('Das Spiel hat noch nicht begonnen')
        const game = room.game
        if (data.type === 'deal' || data.type === 'reveal') {
          if (room.hostUid !== uid && game.players[uid]?.seat !== game.dealer) throw Error('Nur der Dealer oder Host darf Karten bestätigen')
          if (data.type === 'deal') deal(game); else reveal(game)
        } else if (data.type === 'act') act(game, uid, data.move)
        else if (data.type === 'payout') { host(); payout(game, data.winners) }
        else if (data.type === 'nextHand') { host(); nextHand(game) }
        else throw Error('Unbekannte Aktion')
        assertChips(game)
      }
    }
  } else throw Error('Unbekannte Anfrage')
  room.version++
  room.processed ??= {}; room.processed[actionId] = {uid, fingerprint, version: room.version}; trimMap(room.processed)
  room.history ??= {}; room.history[`v${room.version}`] = {type: request.kind === 'joinRoom' ? 'joinRoom' : data.type, uid, at: Date.now(), version: room.version}; trimMap(room.history)
  return room
}
