import {describe,it,expect} from 'vitest'
import {createGame,deal,act,buildPots,payout,reveal,nextHand,assertChips} from '../src/game/engine'
const ps=[{uid:'a',name:'Ada',seat:0},{uid:'b',name:'Bo',seat:1},{uid:'c',name:'Cy',seat:2}]

describe('Poker state machine',()=>{
 it('posts blinds exactly once and retains chips',()=>{
  const g=deal(createGame(ps,1000,25,50,0));expect(g.players.b.stack).toBe(975);expect(g.players.c.stack).toBe(950)
  expect(()=>deal(g)).toThrow();assertChips(g)
 })
 it('preserves the big blind option after calls',()=>{
  const g=deal(createGame(ps,1000,25,50,0));act(g,'a',{kind:'call'});act(g,'b',{kind:'call'});expect(g.turn).toBe('c')
  act(g,'c',{kind:'check'});expect(g.phase).toBe('waiting-flop')
 })
 it('ends a raised round after callers without giving the raiser a second action',()=>{
  const g=deal(createGame(ps,1000,25,50,0));act(g,'a',{kind:'raise',to:150});act(g,'b',{kind:'call'});act(g,'c',{kind:'call'})
  expect(g.phase).toBe('waiting-flop');expect(g.turn).toBeNull();assertChips(g)
 })
 it('handles an entire heads-up checkdown, validated split payout, and dealer rotation',()=>{
  const g=deal(createGame(ps.slice(0,2),100,5,10,0));expect(g.turn).toBe('a');expect(g.players.a.roundBet).toBe(5)
  act(g,'a',{kind:'call'});act(g,'b',{kind:'check'})
  for(let street=0;street<3;street++){reveal(g);expect(g.turn).toBe('b');act(g,'b',{kind:'check'});act(g,'a',{kind:'check'})}
  expect(g.phase).toBe('showdown');const before=JSON.stringify(g)
  expect(()=>payout(g,[['a','a']])).toThrow();expect(JSON.stringify(g)).toBe(before)
  payout(g,[['a','b']]);expect(g.players.a.stack).toBe(100);expect(g.players.b.stack).toBe(100)
  expect(()=>payout(g,[['a']])).toThrow();nextHand(g);expect(g.handId).toBe(2);expect(g.dealer).toBe(1);expect(g.phase).toBe('waiting-deal')
 })
 it('creates side pots and pays odd chips clockwise',()=>{
  const g=createGame(ps,100,5,10,0)
  for(const p of Object.values(g.players)){p.handBet=5;p.stack=95}
  g.players.c.folded=true;g.phase='showdown';payout(g,[['a','b']]);expect(g.players.a.stack).toBe(102);expect(g.players.b.stack).toBe(103);assertChips(g)
  const side=createGame(ps,100,5,10,0)
  side.players.a.handBet=100;side.players.a.stack=0;side.players.b.handBet=70;side.players.b.stack=30;side.players.c.handBet=100;side.players.c.stack=0;side.phase='showdown'
  expect(buildPots(side).map(p=>p.amount)).toEqual([210,60]);payout(side,[['b','c'],['c']]);assertChips(side)
 })
 it('waits for confirmation after folds and pays the remaining player exactly once',()=>{
  const g=deal(createGame(ps,100,5,10,0));act(g,'a',{kind:'fold'});act(g,'b',{kind:'fold'})
  expect(g.phase).toBe('showdown');expect(g.players.c.stack).toBe(90);expect(g.paid).toBe(false)
  expect(()=>nextHand(g)).toThrow();expect(()=>payout(g,[['a'],['a']])).toThrow()
  payout(g,buildPots(g).map(()=>['c']))
  expect(g.phase).toBe('settled');expect(g.players.c.stack).toBe(105);expect(g.paid).toBe(true);assertChips(g)
  expect(()=>payout(g,[['c']])).toThrow()
 })
 it('requires callers to respond to a short all-in without reopening a raise',()=>{
  const g=createGame(ps,1000,25,50,0);g.players.b.stack=125;g.players.c.stack=1875;deal(g)
  act(g,'a',{kind:'raise',to:100});act(g,'b',{kind:'all-in'});act(g,'c',{kind:'call'});expect(g.turn).toBe('a')
  const before=JSON.stringify(g);expect(()=>act(g,'a',{kind:'raise',to:200})).toThrow(/kurzer All-in/);expect(JSON.stringify(g)).toBe(before)
  act(g,'a',{kind:'call'});expect(g.phase).toBe('waiting-flop');assertChips(g)
 })
 it('allows a player who checked to raise a short opening all-in',()=>{
  const g=createGame(ps,1000,25,50,0);g.phase='flop';g.turn='b';g.players.a.stack=1995;g.players.c.stack=5
  act(g,'b',{kind:'check'});act(g,'c',{kind:'all-in'});act(g,'a',{kind:'call'});act(g,'b',{kind:'raise',to:50})
  expect(g.highestBet).toBe(50);expect(g.turn).toBe('a');assertChips(g)
 })
 it('skips betting when both blinds are all-in and preserves manual card confirmations',()=>{
  const g=deal(createGame(ps.slice(0,2),5,5,10,0));expect(g.phase).toBe('waiting-flop');expect(g.turn).toBeNull()
  reveal(g);expect(g.phase).toBe('waiting-turn');reveal(g);reveal(g);expect(g.phase).toBe('showdown')
  payout(g,[['b']]);expect(g.players.b.stack).toBe(10);expect(()=>nextHand(g)).toThrow()
 })
 it('rejects unknown actions, fractional amounts, invalid phases and invalid initial seats',()=>{
  const waiting=createGame(ps,100,5,10,0);expect(()=>act(waiting,'a',{kind:'fold'})).toThrow()
  expect(()=>createGame([{...ps[0],seat:0.5},ps[1]],100,5,10,0)).toThrow()
  const g=deal(waiting),before=JSON.stringify(g)
  expect(()=>act(g,'a',{kind:'raise',to:20.5})).toThrow();expect(()=>act(g,'a',{kind:'nonsense' as any})).toThrow()
  expect(JSON.stringify(g)).toBe(before)
 })
})
