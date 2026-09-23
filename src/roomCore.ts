import { act, addChips, addLatePlayer, assertChips, createGame, deal, nextHand, payout, reveal, type Game } from './engine'
import { blindMinutes, blindMultiplier, raisedBlinds, validBlindPlan, validDenominations, type BlindClock, type BlindSettings, type BlindStep } from './blinds'

export const ROOM_ROOT = 'poker/v2'
export const TURN_DURATION_MS = 30000
export interface Member { uid: string; name: string; host: boolean; ready: boolean; seat?: number; timeBank?: number; sittingOut?: boolean }
export interface RoomState {
  code: string; name: string; hostUid: string; creationAction: string; status: 'lobby'|'playing'
  version: number; createdAt: number; settings: BlindSettings; blindClock?: BlindClock
  turnClock?: {uid: string; deadline: number}
  pausedAt?: number; joinOpen?: boolean; lateRegistration?: boolean
  members: Record<string, Member>; game?: Game
  presence?: Record<string, Record<string, boolean>>
  processed?: Record<string, {uid: string; fingerprint: string; version: number}>
  history?: Record<string, {type: string; uid: string; at: number; version: number; handId?: number; amount?: number; move?: string; winners?: string[][]}>
  lastPayout?: {handId: number; game: Game}
  buyIns?: Record<string, number>; boughtChips?: Record<string, number>
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
    joinOpen: true, lateRegistration: false,
    members: {[uid]: {uid, name: cleanName(name), host: true, ready: false, seat: 0, timeBank: 2}}}
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
      if (room.joinOpen === false) throw Error('Dieser Tisch ist für neue Spieler geschlossen')
      if (room.status === 'playing' && (!room.lateRegistration || !room.game || !['waiting-deal', 'settled'].includes(room.game.phase))) throw Error('Später Einstieg ist nur zwischen Händen erlaubt')
      if (Object.keys(room.members).length >= 9) throw Error('Der Tisch ist voll')
      const seat = Array.from({length: 9}, (_, index) => index).find(seat => !Object.values(room.members).some(member => member.seat === seat))!
      room.members[uid] = {uid, name, host: false, ready: false, seat, timeBank: 2}
      if (room.status === 'playing') {
        addLatePlayer(room.game!, {uid, name, seat}, room.settings.stack)
        room.boughtChips ??= {}; room.boughtChips[uid] = room.settings.stack
        if (room.settings.buyInCents) {room.buyIns ??= {}; room.buyIns[uid] = room.settings.buyInCents}
      }
      else resetReady()
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
      case 'randomSeats': {
        lobby(); host()
        const seated = Object.values(room.members).sort((a, b) => a.uid.localeCompare(b.uid))
        const seats = Array.from({length: 9}, (_, index) => index)
        let seed = Array.from(actionId + room.version).reduce((sum, char) => Math.imul(sum ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261)
        for (let index = seats.length - 1; index > 0; index--) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const chosen = seed % (index + 1); [seats[index], seats[chosen]] = [seats[chosen], seats[index]] }
        seated.forEach((member, index) => { member.seat = seats[index] }); resetReady(); break
      }
      case 'entryPolicy': {
        host()
        if (typeof data.joinOpen !== 'boolean' || typeof data.lateRegistration !== 'boolean') throw Error('Ungültige Tischfreigabe')
        room.joinOpen = data.joinOpen; room.lateRegistration = data.lateRegistration; break
      }
      case 'settings': {
        lobby(); host()
        const {stack, sb, bb} = data
        if (![stack, sb, bb].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1000000000) || sb >= bb || bb > stack) throw Error('Ganze Chips eingeben: Small Blind < Big Blind ≤ Startstack')
        const minutes = data.blindMinutes ?? blindMinutes(room.settings)
        const multiplier = data.blindMultiplier ?? blindMultiplier(room.settings)
        if (!Number.isInteger(minutes) || minutes < 0 || minutes > 180 || ![1.5, 2].includes(multiplier)) throw Error('Blind-Timer: 1 bis 180 Minuten oder aus; Erhöhung um 50 % oder 100 %')
        const ante = data.ante ?? 0, anteMode = data.anteMode ?? 'each', buyInCents = data.buyInCents ?? 0
        if (!Number.isSafeInteger(ante) || ante < 0 || ante > bb || !['each','bb'].includes(anteMode) || !Number.isSafeInteger(buyInCents) || buyInCents < 0 || buyInCents > 1000000000) throw Error('Ungültiges Ante oder Buy-in')
        const blindPlan = data.blindPlan ?? []
        if (!Array.isArray(blindPlan) || (blindPlan.length > 0 && !validBlindPlan(blindPlan, {sb,bb}))) throw Error('Ungültiger Blindplan')
        const denominations = data.denominations ?? []
        if (!Array.isArray(denominations) || (denominations.length > 0 && !validDenominations(denominations))) throw Error('Ungültige Chip-Stückelungen')
        room.settings = {stack, sb, bb, blindMinutes: minutes, blindMultiplier: multiplier, ante, anteMode, buyInCents, ...(blindPlan.length ? {blindPlan} : {}), ...(denominations.length ? {denominations} : {})}; resetReady(); break
      }
      case 'start': {
        lobby(); host()
        const members = Object.values(room.members)
        if (members.length < 2 || members.some(member => member.seat == null || !member.ready)) throw Error('Alle Spieler müssen sitzen und bereit sein')
        const first = room.settings.blindPlan?.[0]
        const ante = first?.kind === 'level' ? first.ante ?? 0 : room.settings.ante ?? 0
        const anteMode = first?.kind === 'level' ? first.anteMode ?? 'each' : room.settings.anteMode ?? 'each'
        room.game = createGame(members.map(member => ({uid: member.uid, name: member.name, seat: member.seat!})), room.settings.stack, room.settings.sb, room.settings.bb, Math.min(...members.map(member => member.seat!)), ante, anteMode)
        room.boughtChips = Object.fromEntries(members.map(member => [member.uid, room.settings.stack]))
        if (room.settings.buyInCents) room.buyIns = Object.fromEntries(members.map(member => [member.uid, room.settings.buyInCents!]))
        members.forEach(member => { member.timeBank ??= 2 })
        if (blindMinutes(room.settings)) room.blindClock = {level: 1, nextIncreaseAt: 0}
        room.status = 'playing'; break
      }
      case 'pause':
        host(); if (room.status !== 'playing' || room.pausedAt) throw Error('Der Tisch ist bereits pausiert'); room.pausedAt = now; break
      case 'resume': {
        host(); if (!room.pausedAt) throw Error('Der Tisch ist nicht pausiert')
        const duration = Math.max(0, now - room.pausedAt)
        if (room.turnClock) room.turnClock.deadline += duration
        if (room.blindClock?.nextIncreaseAt) room.blindClock.nextIncreaseAt += duration
        if (room.blindClock?.breakUntil) room.blindClock.breakUntil += duration
        delete room.pausedAt; break
      }
      default: {
        if (room.status !== 'playing' || !room.game) throw Error('Das Spiel hat noch nicht begonnen')
        if (room.pausedAt) throw Error('Der Tisch ist pausiert')
        const game = room.game
        if (data.type === 'rebuy') {
          host()
          if (!['waiting-deal','settled'].includes(game.phase) || !room.members[data.targetUid] || !Number.isSafeInteger(data.chips) || data.chips <= 0 || data.chips > 1000000000) throw Error('Rebuy oder Add-on nur zwischen Händen möglich')
          const price = room.settings.buyInCents ? data.chips * room.settings.buyInCents / room.settings.stack : 0
          if (!Number.isSafeInteger(price) || price < 0 || price > 1000000000) throw Error('Chipmenge passt nicht zum Buy-in')
          addChips(game, data.targetUid, data.chips)
          room.boughtChips ??= {}; room.boughtChips[data.targetUid] = (room.boughtChips[data.targetUid] || 0) + data.chips
          if (price) {room.buyIns ??= {}; room.buyIns[data.targetUid] = (room.buyIns[data.targetUid] || 0) + price}
        } else if (data.type === 'sitOut') {
          if (!['waiting-deal', 'settled'].includes(game.phase) || typeof data.sittingOut !== 'boolean') throw Error('Aussetzen geht nur zwischen Händen')
          const player = game.players[uid]
          if (!player || (!data.sittingOut && player.stack <= 0)) throw Error('Du benötigst Chips zum Mitspielen')
          me.sittingOut = data.sittingOut; player.sittingOut = data.sittingOut; player.folded = data.sittingOut || player.stack === 0
        } else if (data.type === 'timeBank') {
          if (game.turn !== uid || !room.turnClock || room.turnClock.uid !== uid || request.createdAt > room.turnClock.deadline || (me.timeBank ?? 2) <= 0) throw Error('Zeitreserve ist nicht verfügbar')
          me.timeBank = (me.timeBank ?? 2) - 1
          room.turnClock.deadline += 30000
        } else if (data.type === 'undoPayout') {
          host()
          if (game.phase !== 'settled' || room.lastPayout?.handId !== game.handId) throw Error('Diese Auszahlung kann nicht mehr korrigiert werden')
          room.game = room.lastPayout.game
          delete room.lastPayout
        } else if (data.type === 'deal' || data.type === 'reveal') {
          if (room.hostUid !== uid && game.players[uid]?.seat !== game.dealer) throw Error('Nur der Dealer oder Host darf Karten bestätigen')
          if (data.type === 'deal') {
            // A level may change only before chips for a new hand are posted.
            if (game.phase !== 'waiting-deal') throw Error('Die Karten wurden bereits bestätigt')
            prepareBlinds(room, now)
            if (room.blindClock && !room.blindClock.nextIncreaseAt && !room.blindClock.breakUntil) {
              const step = room.settings.blindPlan?.[room.blindClock.level - 1]
              if (!room.settings.blindPlan || room.blindClock.level < room.settings.blindPlan.length) room.blindClock.nextIncreaseAt = now + (step?.minutes ?? blindMinutes(room.settings)) * 60000
            }
            deal(game)
          } else reveal(game)
        } else if (data.type === 'act') {
          if (room.turnClock && request.createdAt > room.turnClock.deadline) throw Error('Deine Bedenkzeit ist abgelaufen. Du wirst automatisch passen.')
          act(game, uid, data.move)
        }
        else if (data.type === 'payout') { host(); const before = JSON.parse(JSON.stringify(game)) as Game; payout(game, data.winners); room.lastPayout = {handId: game.handId, game: before} }
        else if (data.type === 'nextHand') { host(); prepareBlinds(room, now); nextHand(game); delete room.lastPayout }
        else throw Error('Unbekannte Aktion')
        assertChips(room.game)
      }
    }
  } else throw Error('Unbekannte Anfrage')
  if (current.lastPayout && (request.kind === 'joinRoom' || !['undoPayout', 'pause', 'resume'].includes(data.type))) delete room.lastPayout
  updateTurnClock(room, current, now, request.kind === 'roomCommand' && data.type === 'act')
  room.version++
  room.processed ??= {}; room.processed[actionId] = {uid, fingerprint, version: room.version}; trimMap(room.processed)
  room.history ??= {}
  const event: NonNullable<RoomState['history']>[string] = {type: request.kind === 'joinRoom' ? 'joinRoom' : data.type, uid, at: now, version: room.version}
  if (current.game) event.handId = current.game.handId
  if (data.type === 'act' && current.game?.players[uid] && room.game?.players[uid]) {
    event.move = data.move?.kind
    event.amount = current.game.players[uid].stack - room.game.players[uid].stack
  }
  if (data.type === 'payout') { event.amount = Object.values(current.game?.players || {}).reduce((sum, player) => sum + player.handBet, 0); event.winners = data.winners }
  if (data.type === 'rebuy') event.amount = data.chips
  room.history[`v${room.version}`] = event; trimMap(room.history)
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
  if (current.pausedAt || !current.game?.turn || !current.turnClock || current.turnClock.uid !== current.game.turn || now < current.turnClock.deadline) return
  const room: RoomState = JSON.parse(JSON.stringify(current))
  const uid = current.game.turn
  act(room.game!, uid, {kind: 'fold'})
  updateTurnClock(room, current, now, true)
  assertChips(room.game!)
  room.version++
  room.history ??= {}
  room.history[`v${room.version}`] = {type: 'autoFold', uid, at: now, version: room.version, handId: room.game?.handId}
  trimMap(room.history)
  return room
}

function prepareBlinds(room: RoomState, now: number) {
  const clock = room.blindClock, game = room.game
  if (!clock || !game || (game.phase !== 'settled' && game.phase !== 'waiting-deal')) return
  const plan = room.settings.blindPlan
  if (plan?.length) {
    const applyLevel = (step: BlindStep) => {
      if (step.kind !== 'level') throw Error('Ungültiger Blindplan')
      Object.assign(game, {sb:step.sb, bb:step.bb, minRaise:step.bb, ante:step.ante ?? 0, anteMode:step.anteMode ?? 'each'})
      clock.level++; clock.nextIncreaseAt = 0; delete clock.breakUntil
    }
    if (clock.breakUntil) {
      if (now < clock.breakUntil) throw Error('Die Pause läuft noch')
      const afterBreak = plan[clock.level]
      if (afterBreak) applyLevel(afterBreak)
      else {delete clock.breakUntil; clock.nextIncreaseAt = 0}
      return
    }
    if (!clock.nextIncreaseAt || now < clock.nextIncreaseAt || clock.level >= plan.length) return
    const next = plan[clock.level]
    // A pending deal remains playable when a scheduled break becomes due.
    // The break then begins after that hand is paid, with no mid-hand interruption.
    if (game.phase === 'waiting-deal' && next.kind === 'break') return
    if (next.kind === 'break') {clock.level++; clock.breakUntil = now + next.minutes * 60000; clock.nextIncreaseAt = 0}
    else applyLevel(next)
    return
  }
  if (!blindMinutes(room.settings) || !clock.nextIncreaseAt || now < clock.nextIncreaseAt) return
  const next = raisedBlinds(game.sb, game.bb, blindMultiplier(room.settings))
  if (next.sb !== game.sb || next.bb !== game.bb) clock.level++
  Object.assign(game, next, {minRaise: next.bb})
  // No skipped levels after a long hand or reconnect. The next full interval
  // starts when the dealer confirms the new hand.
  clock.nextIncreaseAt = 0
}
