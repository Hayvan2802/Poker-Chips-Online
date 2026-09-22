import {describe, expect, it} from 'vitest'
import {applyRequest, applyTurnTimeout, newRoom, type RoomState, type RoomRequest} from '../src/roomCore'
import {blindCountdown, raisedBlinds} from '../src/blinds'
import {assertChips} from '../src/engine'

const beginning = 1800000000000
let sequence = 0
function request(room: RoomState, uid: string, type: string, data = {}, now = beginning): RoomRequest {
  return {uid, actionId: `request-${++sequence}`, kind: 'roomCommand', createdAt: now, payload: {type, expectedVersion: room.version, ...data}}
}
function send(room: RoomState, uid: string, type: string, data = {}, now = beginning) {
  return applyRequest(room, request(room, uid, type, data, now), now)
}
function lobby(minutes = 1, multiplier = 2) {
  let room = newRoom('123456', 'host', 'Host', 'create-room')
  room = applyRequest(room, {uid: 'guest', actionId: `join-room-${++sequence}`, kind: 'joinRoom', createdAt: beginning, payload: {name: 'Guest'}}, beginning)
  room = send(room, 'host', 'settings', {stack: 1000, sb: 5, bb: 10, blindMinutes: minutes, blindMultiplier: multiplier})
  room = send(room, 'host', 'ready'); room = send(room, 'guest', 'ready')
  return room
}
function playing(minutes = 1, multiplier = 2) {
  return send(send(lobby(minutes, multiplier), 'host', 'start'), 'host', 'deal')
}

describe('Seats and blind levels', () => {
  it('automatically seats all nine players and keeps seats unique', () => {
    let room = newRoom('123456', 'host', 'Host', 'create-room')
    for (let index = 1; index < 9; index++) {
      room = applyRequest(room, {uid: `p${index}`, actionId: `join-player-${index}`, kind: 'joinRoom', createdAt: beginning, payload: {name: `Player ${index}`}}, beginning)
    }
    expect(Object.values(room.members).map(p => p.seat)).toEqual([0,1,2,3,4,5,6,7,8])
    expect(() => send(room, 'host', 'takeSeat', {seat: 1})).toThrow('frei')
  })
  it('keeps readiness on the current seat and resets it after changing seats or timer settings', () => {
    let room = lobby()
    room = send(room, 'host', 'takeSeat', {seat: 0})
    expect(room.members.host.ready).toBe(true)
    room = send(room, 'host', 'takeSeat', {seat: 8})
    expect(Object.values(room.members).every(p => !p.ready)).toBe(true)
    room = send(room, 'host', 'ready')
    room = send(room, 'host', 'settings', {stack:1000, sb:5, bb:10, blindMinutes: 30, blindMultiplier: 1.5})
    expect(room.members.host.ready).toBe(false)
    expect(() => send(room, 'guest', 'settings', {stack:1000, sb:5, bb:10, blindMinutes: 1})).toThrow('Host')
    for (const minutes of [-1, .5, 181]) expect(() => send(room,'host','settings',{stack:1000,sb:5,bb:10,blindMinutes:minutes})).toThrow('Blind-Timer')
  })
  it('starts with the first deal, retains current blinds through expiry, then raises exactly once', () => {
    let room = send(lobby(), 'host', 'start')
    expect(room.blindClock).toEqual({level: 1, nextIncreaseAt: 0})
    const dealtAt = beginning + 120000
    room = send(room, 'host', 'deal', {}, dealtAt)
    expect(room.blindClock?.nextIncreaseAt).toBe(dealtAt + 60000)
    // Isolate a blind boundary within this player's 30-second turn.
    room.blindClock!.nextIncreaseAt = dealtAt + 10000
    expect(() => send(room, 'host', 'nextHand', {}, dealtAt + 60001)).toThrow('abrechnen')
    expect(room.game!.bb).toBe(10)
    room = send(room, 'host', 'act', {move: {kind: 'fold'}}, dealtAt + 10001)
    expect(room.game!.phase).toBe('showdown')
    expect(() => send(room,'guest','payout',{winners:[['guest'],['guest']]},dealtAt+60001)).toThrow('Host')
    room = send(room,'host','payout',{winners:[['guest'],['guest']]},dealtAt+60001)
    expect(room.game!.phase).toBe('settled')
    expect(room.game!.bb).toBe(10)
    const advance = request(room, 'host', 'nextHand', {}, dealtAt + 60002)
    room = applyRequest(room, advance, dealtAt + 60002)
    expect(room.game).toMatchObject({sb: 10, bb: 20, minRaise: 20, handId: 2})
    expect(room.blindClock).toEqual({level:2, nextIncreaseAt:0})
    room = applyRequest(room, advance, dealtAt + 60003)
    expect(room.blindClock?.level).toBe(2)
    room = send(room, 'guest', 'deal', {}, dealtAt + 80000)
    expect(room.blindClock?.nextIncreaseAt).toBe(dealtAt + 140000)
    expect(room.game!.players.guest.roundBet).toBe(10)
    expect(room.game!.players.host.roundBet).toBe(20)
    assertChips(room.game!)
  })
  it('handles expiry exactly at deal after a hand was prepared, without skipping levels on reconnect', () => {
    let room = playing(1, 1.5)
    room = send(room, 'host', 'act', {move:{kind:'fold'}}, beginning + 30000)
    room = send(room,'host','payout',{winners:[['guest'],['guest']]},beginning+30000)
    room = send(room, 'host', 'nextHand', {}, beginning + 30001)
    expect(room.game!.bb).toBe(10)
    room = JSON.parse(JSON.stringify(room))
    room = send(room, 'guest', 'deal', {}, beginning + 60000)
    expect(room.game).toMatchObject({sb:8, bb:15, minRaise:15})
    room = send(room, 'guest', 'act', {move:{kind:'fold'}}, beginning + 80000)
    room = send(room,'host','payout',{winners:[['host'],['host']]},beginning+6000000)
    room = send(room, 'host', 'nextHand', {}, beginning + 6000001)
    expect(room.game).toMatchObject({sb:12, bb:23})
    expect(room.blindClock?.level).toBe(3)
  })
  it('applies pending blinds after a showdown payout and preserves all chips', () => {
    let room = playing()
    room = send(room, 'host', 'act', {move:{kind:'call'}})
    room = send(room, 'guest', 'act', {move:{kind:'check'}})
    for (let i=0;i<3;i++) {
      room = send(room,'host','reveal')
      room = send(room,'guest','act',{move:{kind:'check'}})
      room = send(room,'host','act',{move:{kind:'check'}})
    }
    room = send(room,'host','payout',{winners:[['host','guest']]},beginning+60000)
    expect(room.game!.bb).toBe(10)
    room = send(room,'host','nextHand',{},beginning+60001)
    expect(room.game!.bb).toBe(20)
    expect(room.game!.totalChips).toBe(2000)
    assertChips(room.game!)
  })
  it('supports fixed blinds and old rooms, and bounds very high blind levels', () => {
    let room = playing(0)
    expect(room.blindClock).toBeUndefined()
    delete room.settings.blindMinutes; delete room.settings.blindMultiplier
    room = send(room,'host','act',{move:{kind:'fold'}},beginning+10000)
    room = send(room,'host','payout',{winners:[['guest'],['guest']]},beginning+6000000)
    room = send(room,'host','nextHand',{},beginning+6000001)
    expect(room.game).toMatchObject({sb:5,bb:10})
    expect(raisedBlinds(600000000,900000000,2)).toEqual({sb:999999999,bb:1000000000})
    expect(blindCountdown(beginning + 61000,beginning)).toBe('01:01')
    expect(blindCountdown(beginning,beginning+1)).toBe('00:00')
  })
  it('gives each turn 30 seconds and folds exactly once at expiry without paying automatically', () => {
    let room = playing()
    expect(room.turnClock).toEqual({uid:'host',deadline:beginning+30000})
    expect(applyTurnTimeout(room,beginning+29999)).toBeUndefined()
    const reloaded=JSON.parse(JSON.stringify(room))
    room=applyTurnTimeout(reloaded,beginning+30000)!
    expect(room.game!.players.host.folded).toBe(true)
    expect(room.game!.phase).toBe('showdown')
    expect(room.game!.paid).toBe(false)
    expect(room.turnClock).toBeUndefined()
    expect(applyTurnTimeout(room,beginning+30001)).toBeUndefined()
    expect(room.history![`v${room.version}`].type).toBe('autoFold')
    room=send(room,'host','payout',{winners:[['guest'],['guest']]},beginning+30002)
    assertChips(room.game!)
  })
  it('resets the deadline for the next player, rejects late actions, and preserves it on duplicate requests', () => {
    let room=playing()
    const call=request(room,'host','act',{move:{kind:'call'}},beginning+12000)
    room=applyRequest(room,call,beginning+12000)
    expect(room.turnClock).toEqual({uid:'guest',deadline:beginning+42000})
    room=applyRequest(room,call,beginning+20000)
    expect(room.turnClock!.deadline).toBe(beginning+42000)
    expect(()=>send(room,'guest','act',{move:{kind:'check'}},beginning+42001)).toThrow('Bedenkzeit')
    room=send(room,'guest','act',{move:{kind:'check'}},beginning+42000)
    expect(room.turnClock).toBeUndefined()
    expect(applyTurnTimeout(room,beginning+100000)).toBeUndefined()
    room=send(room,'host','reveal',{},beginning+100000)
    expect(room.turnClock).toEqual({uid:'guest',deadline:beginning+130000})
  })
})
