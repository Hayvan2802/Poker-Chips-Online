import {describe,it,expect} from 'vitest';import {createGame,deal,act,buildPots,payout} from '../src/engine'
const ps=[{uid:'a',name:'Ada',seat:0},{uid:'b',name:'Bo',seat:1},{uid:'c',name:'Cy',seat:2}]
describe('Poker state machine',()=>{
 it('posts blinds exactly once and retains chips',()=>{const g=deal(createGame(ps,1000,25,50,0));expect(g.players.b.stack).toBe(975);expect(g.players.c.stack).toBe(950);expect(()=>deal(g)).toThrow();expect(Object.values(g.players).reduce((s,p)=>s+p.stack+p.handBet,0)).toBe(3000)})
 it('preserves the big blind option after calls',()=>{const g=deal(createGame(ps,1000,25,50,0));act(g,'a',{kind:'call'});act(g,'b',{kind:'call'});expect(g.turn).toBe('c');act(g,'c',{kind:'check'});expect(g.phase).toBe('waiting-flop')})
 it('creates side pots and splits odd chips clockwise',()=>{const g=createGame(ps,100,5,10,0);g.players.a.handBet=100;g.players.a.stack=0;g.players.b.handBet=70;g.players.b.stack=30;g.players.c.handBet=100;g.players.c.stack=0;g.totalChips=300;g.phase='showdown';expect(buildPots(g).map(p=>p.amount)).toEqual([210,60]);payout(g,[['b','c'],['c']]);expect(g.players.b.stack+g.players.c.stack+g.players.a.stack).toBe(300)})
 it('ends when everyone else folds',()=>{const g=deal(createGame(ps,100,5,10,0));act(g,'a',{kind:'fold'});act(g,'b',{kind:'fold'});expect(g.phase).toBe('showdown')})
})
