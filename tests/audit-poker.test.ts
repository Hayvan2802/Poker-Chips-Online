import { describe, expect, it } from 'vitest'
import { act, addLatePlayer, assertChips, blindPositions, buildPots, canRaise, createGame, deal, minimumRaiseTo, nextHand, payout, reveal, type Game } from '../src/game/engine'

const players = Array.from({ length: 5 }, (_, seat) => ({ uid: String.fromCharCode(97 + seat), name: `Player ${seat}`, seat }))

function checkToShowdown(game: Game) {
  while (game.phase !== 'showdown') {
    if (game.phase.startsWith('waiting-')) reveal(game)
    else if (game.turn) act(game, game.turn, { kind: 'check' })
    else throw Error(`Unexpected phase: ${game.phase}`)
  }
}

describe('Audit: poker correctness regressions', () => {
  it('makes the entire big-blind ante available to the best hand after a checkdown', () => {
    const game = deal(createGame(players.slice(0, 3), 1000, 5, 10, 0, 10, 'bb'))
    act(game, 'a', { kind: 'call' })
    act(game, 'b', { kind: 'call' })
    act(game, 'c', { kind: 'check' })
    checkToShowdown(game)
    const pots = buildPots(game)
    expect(pots).toEqual([{ amount: 60, eligible: ['a', 'b', 'c'] }])
    expect(pots.filter(pot => pot.eligible.includes('a')).reduce((sum, pot) => sum + pot.amount, 0)).toBe(60)
  })

  it('can settle a hand when the big-blind ante payer folds', () => {
    const game = deal(createGame(players.slice(0, 3), 1000, 5, 10, 0, 10, 'bb'))
    act(game, 'a', { kind: 'raise', to: 20 })
    act(game, 'b', { kind: 'fold' })
    act(game, 'c', { kind: 'fold' })
    expect(game.phase).toBe('showdown')
    expect(() => payout(game, buildPots(game).map(() => ['a']))).not.toThrow()
    expect(game.players.a.stack).toBe(1045)
    assertChips(game)
  })

  it('requires the nominal big blind when the BB posts all-in for less', () => {
    const game = createGame(players.slice(0, 3), 100, 5, 10, 0)
    game.players.c.stack = 3
    game.players.a.stack = 197
    deal(game)
    act(game, 'a', { kind: 'call' })
    expect(game.players.a.roundBet).toBe(10)
    expect(minimumRaiseTo(game)).toBe(20)
  })

  it('keeps the next big blind on the next seat after the small blind busts four-handed', () => {
    const game = deal(createGame(players.slice(0, 4), 100, 5, 10, 0))
    act(game, 'd', { kind: 'fold' })
    act(game, 'a', { kind: 'all-in' })
    act(game, 'b', { kind: 'all-in' })
    act(game, 'c', { kind: 'fold' })
    checkToShowdown(game)
    payout(game, buildPots(game).map(() => ['a']))
    expect(game.players.b.stack).toBe(0)
    nextHand(game)
    expect(game.dealer).toBe(1)
    deal(game)
    expect(game.smallBlindSeat).toBe(2)
    expect(game.bigBlindSeat).toBe(3)
  })

  it('does not reopen a checked player after an opening all-in below the minimum bet', () => {
    const game = createGame(players.slice(0, 3), 100, 5, 10, 0)
    game.players.c.stack = 13
    game.players.a.stack = 187
    deal(game)
    act(game, 'a', { kind: 'call' })
    act(game, 'b', { kind: 'call' })
    act(game, 'c', { kind: 'check' })
    reveal(game)
    act(game, 'b', { kind: 'check' })
    act(game, 'c', { kind: 'all-in' })
    act(game, 'a', { kind: 'call' })
    expect(canRaise(game, 'b')).toBe(false)
    const before = JSON.stringify(game)
    expect(() => act(game, 'b', { kind: 'raise', to: 13 })).toThrow()
    expect(() => act(game, 'b', { kind: 'all-in' })).toThrow()
    expect(JSON.stringify(game)).toBe(before)
    act(game, 'b', { kind: 'call' })
    expect(game.phase).toBe('waiting-turn')
  })

  it.each(['late entry', 'return from sitting out'])('keeps the multiway button when %s changes a prepared heads-up hand', change => {
    const game = createGame(players.slice(0, change === 'late entry' ? 2 : 3), 100, 5, 10, 0)
    if (game.players.c) game.players.c.sittingOut = true
    deal(game)
    act(game, 'a', { kind: 'fold' })
    payout(game, [['b']])
    nextHand(game)
    expect(game.dealer).toBe(1)
    if (change === 'late entry') addLatePlayer(game, players[2], 100)
    else game.players.c.sittingOut = false
    // The pending button must survive saving/reloading before deal, too.
    const restored: Game = JSON.parse(JSON.stringify(game))
    deal(restored)
    expect(restored).toMatchObject({ dealer: 0, smallBlindSeat: 1, bigBlindSeat: 2, turn: 'a' })
    expect(restored.pendingDealerSeat).toBeUndefined()
    act(restored, 'a', { kind: 'call' })
    act(restored, 'b', { kind: 'call' })
    act(restored, 'c', { kind: 'check' })
    reveal(restored)
    expect(restored.turn).toBe('b')
    assertChips(restored)
  })

  it('uses the heads-up button when a player sits out after a multiway hand was prepared', () => {
    const game = deal(createGame(players.slice(0, 3), 100, 5, 10, 0))
    act(game, 'a', { kind: 'fold' })
    act(game, 'b', { kind: 'fold' })
    payout(game, [['c']])
    nextHand(game)
    expect(game.dealer).toBe(1)
    game.players.b.sittingOut = true
    deal(game)
    expect(game).toMatchObject({ dealer: 2, smallBlindSeat: 2, bigBlindSeat: 0, turn: 'c' })
    act(game, 'c', { kind: 'call' })
    act(game, 'a', { kind: 'check' })
    reveal(game)
    expect(game.turn).toBe('a')
    assertChips(game)
  })

  it('requires a full raise above a short opening all-in from a player who has not acted', () => {
    const game = createGame(players.slice(0, 3), 100, 5, 10, 0)
    game.players.c.stack = 13
    game.players.a.stack = 187
    deal(game)
    act(game, 'a', { kind: 'call' })
    act(game, 'b', { kind: 'call' })
    act(game, 'c', { kind: 'check' })
    reveal(game)
    act(game, 'b', { kind: 'check' })
    act(game, 'c', { kind: 'all-in' })
    expect(minimumRaiseTo(game)).toBe(13)
    expect(canRaise(game, 'a')).toBe(true)
    expect(() => act(game, 'a', { kind: 'raise', to: 10 })).toThrow()
    act(game, 'a', { kind: 'raise', to: 13 })
    expect(game.minRaise).toBe(10)
    expect(canRaise(game, 'b')).toBe(true)
    act(game, 'b', { kind: 'raise', to: 23 })
    assertChips(game)
  })

  it('does not award multiple odd chips by splitting on folded contributions', () => {
    const game = deal(createGame(players, 100, 5, 10, 4))
    act(game, 'c', { kind: 'raise', to: 25 })
    act(game, 'd', { kind: 'call' })
    act(game, 'e', { kind: 'call' })
    act(game, 'a', { kind: 'fold' })
    act(game, 'b', { kind: 'fold' })
    reveal(game)
    act(game, 'c', { kind: 'check' })
    act(game, 'd', { kind: 'bet', to: 10 })
    act(game, 'e', { kind: 'call' })
    act(game, 'c', { kind: 'fold' })
    checkToShowdown(game)
    expect(Object.values(game.players).reduce((sum, player) => sum + player.handBet, 0)).toBe(110)
    expect(buildPots(game)).toEqual([{ amount: 110, eligible: ['d', 'e'] }])
    payout(game, buildPots(game).map(() => ['d', 'e']))
    expect(game.players.d.stack).toBe(120)
    expect(game.players.e.stack).toBe(120)
    assertChips(game)
  })

  it.each([2, 3])('posts the BB before its ante and keeps the partial ante in the main pot with %i players', count => {
    const game = createGame(players.slice(0, count), 100, 5, 10, 0, 10, 'bb')
    const big = count === 2 ? 'b' : 'c'
    game.players[big].stack = 17
    game.players.a.stack += 83
    deal(game)
    expect(game.players[big]).toMatchObject({ stack: 0, roundBet: 10, anteBet: 7, handBet: 17, allIn: true })
    while (game.phase === 'preflop') act(game, game.turn!, { kind: 'call' })
    checkToShowdown(game)
    expect(buildPots(game)).toEqual([{ amount: 10 * count + 7, eligible: players.slice(0, count).map(player => player.uid) }])
    payout(game, [[big]])
    assertChips(game)
  })

  it('does not let a big-blind ante buy eligibility for side pots', () => {
    const game = createGame(players.slice(0, 3), 100, 5, 10, 0, 10, 'bb')
    game.players.a.stack = 180
    game.players.c.stack = 20
    deal(game)
    act(game, 'a', { kind: 'raise', to: 40 })
    act(game, 'b', { kind: 'call' })
    checkToShowdown(game)
    expect(buildPots(game)).toEqual([{ amount: 40, eligible: ['a', 'b', 'c'] }, { amount: 60, eligible: ['a', 'b'] }])
    payout(game, [['c'], ['b']])
    expect(game.players.c.stack).toBe(40)
    assertChips(game)
  })

  it.each([true, false])('recovers legacy big-blind antes without changing stacks (stored blind positions: %s)', storedPositions => {
    const game = createGame(players.slice(0, 3), 100, 5, 10, 0, 10, 'bb')
    Object.assign(game, { phase: 'showdown', bigBlindSeat: 2, smallBlindSeat: 1 })
    Object.assign(game.players.a, { stack: 80, handBet: 20 })
    Object.assign(game.players.b, { stack: 95, handBet: 5, folded: true })
    Object.assign(game.players.c, { stack: 60, handBet: 40, folded: true })
    if (!storedPositions) { delete game.bigBlindSeat; delete game.smallBlindSeat }
    const saved = JSON.stringify(game)
    expect(buildPots(game)).toEqual([{ amount: 65, eligible: ['a'] }])
    expect(JSON.stringify(game)).toBe(saved)
    payout(game, [['a']])
    expect(game.players.a.stack).toBe(145)
    assertChips(game)
  })

  it('keeps a legacy ante-only all-in eligible for its dead ante without granting live side pots', () => {
    const game = createGame(players.slice(0, 3), 100, 5, 10, 0, 10, 'bb')
    Object.assign(game, { phase: 'showdown', bigBlindSeat: 2 })
    Object.assign(game.players.a, { stack: 175, handBet: 10 })
    Object.assign(game.players.b, { stack: 90, handBet: 10 })
    Object.assign(game.players.c, { stack: 0, handBet: 15, allIn: true })
    expect(buildPots(game)).toEqual([{ amount: 15, eligible: ['a', 'b', 'c'] }, { amount: 20, eligible: ['a', 'b'] }])
    payout(game, [['c'], ['a']])
    assertChips(game)
  })

  it.each(['a', 'b', 'c', 'd'])('keeps normal big-blind progression on sparse seats after %s busts', eliminated => {
    const seats = [0, 2, 5, 8]
    const game = deal(createGame(players.slice(0, 4).map((player, i) => ({ ...player, seat: seats[i] })), 100, 5, 10, 0))
    game.phase = 'settled'; game.paid = true
    for (const player of Object.values(game.players)) {
      player.stack = player.uid === eliminated ? 0 : player.uid === (eliminated === 'a' ? 'b' : 'a') ? 200 : 100
      player.handBet = 0; player.roundBet = 0
    }
    assertChips(game)
    nextHand(game)
    const expectedBig = eliminated === 'd' ? 0 : 8
    expect(blindPositions(game)).toEqual({ small: eliminated === 'c' ? undefined : 5, big: expectedBig })
    deal(game)
    expect(game.dealer).toBe(2)
    expect(game.bigBlindSeat).toBe(expectedBig)
    expect(game.players.c.roundBet).toBe(eliminated === 'c' ? 0 : 5)
    while ((game as Game).phase !== 'showdown') act(game, game.turn!, { kind: 'fold' })
    payout(game, buildPots(game).map(pot => [pot.eligible[0]]))
    nextHand(game)
    expect(game.dealer).toBe(5)
    deal(game)
    expect(game.bigBlindSeat).toBe(eliminated === 'a' || eliminated === 'd' ? 2 : 0)
    assertChips(game)
  })

  it('reopens only the players facing a cumulative full raise after multiple short all-ins', () => {
    const game = createGame(players, 100, 5, 10, 4)
    game.phase = 'flop'; game.turn = 'a'
    game.players.b.stack = 13; game.players.d.stack = 20; game.players.e.stack = 267
    act(game, 'a', { kind: 'bet', to: 10 })
    act(game, 'b', { kind: 'all-in' })
    act(game, 'c', { kind: 'call' })
    act(game, 'd', { kind: 'all-in' })
    act(game, 'e', { kind: 'call' })
    expect(minimumRaiseTo(game)).toBe(30)
    expect(canRaise(game, 'a')).toBe(true)
    expect(canRaise(game, 'c')).toBe(false)
    act(game, 'a', { kind: 'call' })
    expect(() => act(game, 'c', { kind: 'raise', to: 30 })).toThrow()
    act(game, 'c', { kind: 'call' })
    assertChips(game)
  })

  it.each(['none','each','bb'] as const)('preserves every chip and keeps every pot payable across varied legal %s-ante hands', mode => {
    let seed = 37219
    const random = (limit:number) => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed%limit }
    for(let round=0;round<80;round++) {
      const count=2+random(8)
      const entrants=Array.from({length:count},(_,seat)=>({uid:`p${seat}`,name:`Player ${seat}`,seat}))
      const game=createGame(entrants,100,5,10,random(count),mode==='none'?0:2,mode==='bb'?'bb':'each')
      for(let seat=1;seat<count;seat++) {const stack=1+random(100);game.players.p0.stack+=100-stack;game.players[`p${seat}`].stack=stack}
      deal(game)
      let actions=0
      while(game.phase!=='showdown') {
        expect(++actions).toBeLessThan(150)
        if(game.phase.startsWith('waiting-')) {reveal(game);continue}
        const player=game.players[game.turn!]
        const choices: Array<Parameters<typeof act>[2]>=[{kind:'fold'},{kind:player.roundBet<game.highestBet?'call':'check'}]
        if(canRaise(game,player)||player.roundBet+player.stack<=game.highestBet)choices.push({kind:'all-in'})
        if(canRaise(game,player)&&minimumRaiseTo(game)<=player.roundBet+player.stack)choices.push({kind:game.highestBet?'raise':'bet',to:minimumRaiseTo(game)})
        act(game,player.uid,choices[random(choices.length)])
        assertChips(game)
      }
      const pots=buildPots(game)
      expect(pots.every(pot=>pot.eligible.length>0)).toBe(true)
      expect(pots.reduce((sum,pot)=>sum+pot.amount,0)).toBe(Object.values(game.players).reduce((sum,p)=>sum+p.handBet,0))
      payout(game,pots.map(pot=>[pot.eligible[random(pot.eligible.length)]]))
      assertChips(game)
      expect(Object.values(game.players).reduce((sum,p)=>sum+p.stack,0)).toBe(count*100)
    }
  })
})
