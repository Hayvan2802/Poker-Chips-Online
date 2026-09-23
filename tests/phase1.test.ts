import {describe, expect, it} from 'vitest'
import {applyRequest, applyTurnTimeout, newRoom, type RoomRequest, type RoomState} from '../src/roomCore'
import {assertChips} from '../src/engine'

const start = 1_800_000_000_000
let sequence = 0
function command(room: RoomState, uid: string, type: string, data: Record<string, unknown> = {}, now = start) {
  const request: RoomRequest = {uid, actionId: `phase-one-${++sequence}`, kind: 'roomCommand', createdAt: now, payload: {type, expectedVersion: room.version, ...data}}
  return applyRequest(room, request, now)
}
function join(room: RoomState, uid: string, now = start) {
  return applyRequest(room, {uid, actionId: `phase-one-${++sequence}`, kind: 'joinRoom', createdAt: now, payload: {name: uid}}, now)
}
function table() {
  let room = join(newRoom('123456', 'host', 'Host', 'create-phase-one'), 'guest')
  room = command(room, 'host', 'ready')
  room = command(room, 'guest', 'ready')
  return command(room, 'host', 'start')
}

describe('Tischkorrekturen und Spielpausen', () => {
  it('restores only the latest payout before the next hand and keeps every chip', () => {
    let room = command(table(), 'host', 'deal')
    room = command(room, 'host', 'act', {move: {kind: 'fold'}})
    const before = JSON.stringify(room.game)
    const winners = [['guest'], ['guest']]
    room = command(room, 'host', 'payout', {winners})
    expect(room.game?.phase).toBe('settled')
    expect(room.history?.[`v${room.version}`]).toMatchObject({type: 'payout', handId: 1, winners})
    expect(() => command(room, 'guest', 'undoPayout')).toThrow('Host')
    room = command(room, 'host', 'undoPayout')
    expect(JSON.stringify(room.game)).toBe(before)
    expect(room.lastPayout).toBeUndefined()
    room = command(room, 'host', 'payout', {winners})
    room = command(room, 'host', 'nextHand')
    expect(() => command(room, 'host', 'undoPayout')).toThrow('korrigiert')
    assertChips(room.game!)
  })

  it('grants each player two idempotent time extensions and freezes both clocks while paused', () => {
    let room = command(table(), 'host', 'deal')
    const original = room.turnClock!.deadline
    const request: RoomRequest = {uid: 'host', actionId: `phase-one-${++sequence}`, kind: 'roomCommand', createdAt: start + 1000, payload: {type: 'timeBank', expectedVersion: room.version}}
    room = applyRequest(room, request, start + 1000)
    expect(room.turnClock?.deadline).toBe(original + 30000)
    expect(room.members.host.timeBank).toBe(1)
    room = applyRequest(room, request, start + 2000)
    expect(room.turnClock?.deadline).toBe(original + 30000)
    room = command(room, 'host', 'pause', {}, start + 5000)
    expect(applyTurnTimeout(room, start + 200000)).toBeUndefined()
    expect(() => command(room, 'host', 'act', {move: {kind: 'fold'}}, start + 6000)).toThrow('pausiert')
    room = command(room, 'host', 'resume', {}, start + 105000)
    expect(room.turnClock?.deadline).toBe(original + 130000)
    room = command(room, 'host', 'timeBank', {}, start + 106000)
    expect(room.members.host.timeBank).toBe(0)
    expect(() => command(room, 'host', 'timeBank', {}, start + 107000)).toThrow('Zeitreserve')
  })

  it('supports sitting out, fair seat draws and controlled late entry between hands', () => {
    let room = join(newRoom('123456', 'host', 'Host', 'create-phase-one'), 'guest')
    room = command(room, 'host', 'ready')
    room = command(room, 'host', 'randomSeats')
    expect(new Set(Object.values(room.members).map(member => member.seat)).size).toBe(2)
    expect(room.members.host.ready).toBe(false)
    room = command(room, 'host', 'entryPolicy', {joinOpen: false, lateRegistration: true})
    expect(() => join(room, 'third')).toThrow('geschlossen')
    room = command(room, 'host', 'entryPolicy', {joinOpen: true, lateRegistration: true})
    room = command(room, 'host', 'ready')
    room = command(room, 'guest', 'ready')
    room = command(room, 'host', 'start')
    room = command(room, 'guest', 'sitOut', {sittingOut: true})
    expect(() => command(room, 'host', 'deal')).toThrow('zwei Spieler')
    room = join(room, 'third')
    expect(room.game?.totalChips).toBe(room.settings.stack * 3)
    room = command(room, 'host', 'deal')
    expect(room.game?.players.guest.sittingOut).toBe(true)
    expect(room.game?.players.guest.handBet).toBe(0)
    assertChips(room.game!)
  })
})
