import { act, assertChips, createGame, deal, nextHand, payout, reveal, type Game } from './engine'
import { blindMinutes, blindMultiplier, raisedBlinds, type BlindClock, type BlindSettings } from './blinds'

export const ROOM_ROOT = 'poker/v2'
export const TURN_DURATION_MS = 30000
export interface Member { uid: string; name: string; host: boolean; ready: boolean; seat?: number }
export interface RoomState {
  code: string; name: string; hostUid: string; creationAction: string; status: 'lobby'|'playing'
  version: number; createdAt: number; settings: BlindSettings; blindClock?: BlindClock
  turnClock?: {uid: string; deadline: number}
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
    createdAt: Date.now(), settings: {stack: 10000, sb: 50, bb: 100, blindMinutes: 20, blindMultiplier: 2},
    members: {[uid]: {uid, name: cleanName(name), host: true, ready: false, seat: 0}}}
}
function trimMap(map: Record<string, any>) {
  const keys = Object.keys(map).sort((a, b) => (map[a]?.version ?? 0) - (map[b]?.version ?? 0))
  for (const key of keys.slice(0, Math.max(0, keys.length - 256))) delete map[key]
}
// The host's browser is the trusted referee. Guests can submit requests, but
// Firebase Rules never allow them to write membership, settings or game state.
export function applyRequest(current: RoomState, request: RoomRequest, now = Date.now()): RoomState {
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
  if (!Number.isFinite(request.createdAt) || now - request.createdAt > 25000 || request.createdAt > now + 120000) throw Error('Anfrage ist abgelaufen. Bitte erneut versuchen')
  const lobby = () => { if (room.status !== 'lobby') throw Error('Diese Aktion ist nur in der Lobby möglich') }
  const host = () => { if (room.hostUid !== uid) throw Error('Nur der Host darf diese Aktion ausführen') }
  const resetReady = () => Object.values(room.members).forEach(member => { member.ready = false })
  if (request.kind === 'joinRoom') {
    const name = cleanName(data.name)
    if (!room.members[uid]) {
      lobby()
      if (Object.keys(room.members).length >= 9) throw Error('Der Tisch ist voll')
      const seat = Array.from({length: 9}, (_, index) => index).find(seat => !Object.values(room.members).some(member => member.seat === seat))!
      room.members[uid] = {uid, name, host: false, ready: false, seat}
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
        if (me.seat === data.seat) break
        me.seat = data.seat; resetReady(); break
      }
      case 'ready':
        lobby(); if (me.seat == null) throw Error('Bitte zuerst einen Sitz wählen'); me.ready = !me.ready; break
      case 'settings': {
        lobby(); host()
        const {stack, sb, bb} = data
        if (![stack, sb, bb].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1000000000) || sb >= bb || bb > stack) throw Error('Ganze Chips eingeben: Small Blind < Big Blind ≤ Startstack')
        const minutes = data.blindMinutes ?? blindMinutes(room.settings)
        const multiplier = data.blindMultiplier ?? blindMultiplier(room.settings)
        if (!Number.isInteger(minutes) || minutes < 0 || minutes > 180 || ![1.5, 2].includes(multiplier)) throw Error('Blind-Timer: 1 bis 180 Minuten oder aus; Erhöhung um 50 % oder 100 %')
        room.settings = {stack, sb, bb, blindMinutes: minutes, blindMultiplier: multiplier}; resetReady(); break
      }
      case 'start': {
        lobby(); host()
        const members = Object.values(room.members)
        if (members.length < 2 || members.some(member => member.seat == null || !member.ready)) throw Error('Alle Spieler müssen sitzen und bereit sein')
        room.game = createGame(members.map(member => ({uid: member.uid, name: member.name, seat: member.seat!})), room.settings.stack, room.settings.sb, room.settings.bb, Math.min(...members.map(member => member.seat!)))
        if (blindMinutes(room.settings)) room.blindClock = {level: 1, nextIncreaseAt: 0}
        room.status = 'playing'; break
      }
      default: {
        if (room.status !== 'playing' || !room.game) throw Error('Das Spiel hat noch nicht begonnen')
        const game = room.game
        if (data.type === 'deal' || data.type === 'reveal') {
          if (room.hostUid !== uid && game.players[uid]?.seat !== game.dealer) throw Error('Nur der Dealer oder Host darf Karten bestätigen')
          if (data.type === 'deal') {
            // A level may change only before chips for a new hand are posted.
            if (game.phase !== 'waiting-deal') throw Error('Die Karten wurden bereits bestätigt')
            prepareBlinds(room, now)
            if (room.blindClock && !room.blindClock.nextIncreaseAt) room.blindClock.nextIncreaseAt = now + blindMinutes(room.settings) * 60000
            deal(game)
          } else reveal(game)
        } else if (data.type === 'act') {
          if (room.turnClock && request.createdAt > room.turnClock.deadline) throw Error('Deine Bedenkzeit ist abgelaufen. Du wirst automatisch passen.')
          act(game, uid, data.move)
        }
        else if (data.type === 'payout') { host(); payout(game, data.winners) }
        else if (data.type === 'nextHand') { host(); prepareBlinds(room, now); nextHand(game) }
        else throw Error('Unbekannte Aktion')
        assertChips(game)
      }
    }
  } else throw Error('Unbekannte Anfrage')
  updateTurnClock(room, current, now, request.kind === 'roomCommand' && data.type === 'act')
  room.version++
  room.processed ??= {}; room.processed[actionId] = {uid, fingerprint, version: room.version}; trimMap(room.processed)
  room.history ??= {}; room.history[`v${room.version}`] = {type: request.kind === 'joinRoom' ? 'joinRoom' : data.type, uid, at: now, version: room.version}; trimMap(room.history)
  return room
}

function updateTurnClock(room: RoomState, previous: RoomState, now: number, acted = false) {
  const turn = room.game?.turn
  if (!turn) delete room.turnClock
  else if (acted || !room.turnClock || previous.game?.turn !== turn || previous.game?.phase !== room.game?.phase) room.turnClock = {uid: turn, deadline: now + TURN_DURATION_MS}
}

// Only the host calls this inside a transaction. The stored deadline makes it
// safe across repeated timer ticks, multiple host tabs and reconnections.
export function applyTurnTimeout(current: RoomState, now: number): RoomState | undefined {
  if (!current.game?.turn || !current.turnClock || current.turnClock.uid !== current.game.turn || now < current.turnClock.deadline) return
  const room: RoomState = JSON.parse(JSON.stringify(current))
  const uid = current.game.turn
  act(room.game!, uid, {kind: 'fold'})
  updateTurnClock(room, current, now, true)
  assertChips(room.game!)
  room.version++
  room.history ??= {}
  room.history[`v${room.version}`] = {type: 'autoFold', uid, at: now, version: room.version}
  trimMap(room.history)
  return room
}

function prepareBlinds(room: RoomState, now: number) {
  const clock = room.blindClock, game = room.game
  if (!clock || !game || !blindMinutes(room.settings) || !clock.nextIncreaseAt || now < clock.nextIncreaseAt) return
  if (game.phase !== 'settled' && game.phase !== 'waiting-deal') return
  const next = raisedBlinds(game.sb, game.bb, blindMultiplier(room.settings))
  if (next.sb !== game.sb || next.bb !== game.bb) clock.level++
  Object.assign(game, next, {minRaise: next.bb})
  // No skipped levels after a long hand or reconnect. The next full interval
  // starts when the dealer confirms the new hand.
  clock.nextIncreaseAt = 0
}
