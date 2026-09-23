import {describe,expect,it} from 'vitest'
import {createGame,deal,assertChips} from '../src/game/engine'
import {applyRequest,newRoom,type RoomRequest,type RoomState} from '../src/game/roomCore'
import {cashSettlement} from '../src/game/settlement'

const t=1_800_000_000_000
let seq=0
function command(room:RoomState,uid:string,type:string,data:Record<string,unknown>={},now=t) {
  const request:RoomRequest={uid,actionId:`phase-two-${++seq}`,kind:'roomCommand',createdAt:now,payload:{type,expectedVersion:room.version,...data}}
  return applyRequest(room,request,now)
}
function table(){
  let r=newRoom('123456','host','Host','phase-two-create')
  r=applyRequest(r,{uid:'guest',actionId:`phase-two-${++seq}`,kind:'joinRoom',createdAt:t,payload:{name:'Guest'}},t)
  return r
}

describe('Turnierstufen, Antes und Cash-Abrechnung',()=>{
  it('posts each-player and big-blind antes without adding them to the live bet',()=>{
    const players=[{uid:'a',name:'A',seat:0},{uid:'b',name:'B',seat:1},{uid:'c',name:'C',seat:2}]
    const game=createGame(players,1000,50,100,0,10,'each')
    deal(game)
    expect(game.players.a.handBet).toBe(10)
    expect(game.players.b.roundBet).toBe(50)
    expect(game.players.c.handBet).toBe(110)
    assertChips(game)
    const bb=createGame(players,1000,50,100,0,10,'bb')
    deal(bb)
    expect(bb.players.c.handBet).toBe(130)
    expect(bb.players.c.roundBet).toBe(100)
    assertChips(bb)
  })
  it('schedules breaks only between hands and resumes with the next planned level',()=>{
    let r=table()
    const blindPlan=[{kind:'level',sb:50,bb:100,minutes:1},{kind:'break',minutes:1},{kind:'level',sb:100,bb:200,minutes:1}]
    r=command(r,'host','settings',{stack:10000,sb:50,bb:100,blindMinutes:1,blindMultiplier:2,blindPlan})
    r=command(r,'host','ready');r=command(r,'guest','ready');r=command(r,'host','start')
    r=command(r,'host','deal',{},t)
    r=command(r,'host','act',{move:{kind:'fold'}},t+1000)
    r=command(r,'host','payout',{winners:[['guest'],['guest']]},t+2000)
    r=command(r,'host','nextHand',{},t+61000)
    expect(r.blindClock?.breakUntil).toBe(t+121000)
    expect(()=>command(r,'host','deal',{},t+62000)).toThrow('Pause')
    r=command(r,'host','deal',{},t+122000)
    expect([r.game?.sb,r.game?.bb]).toEqual([100,200])
    expect(r.blindClock?.level).toBe(3)
    assertChips(r.game!)
  })
  it('records proportional rebuy and exact-cent cash transfers',()=>{
    let r=table()
    r=command(r,'host','settings',{stack:10000,sb:50,bb:100,blindMinutes:0,blindMultiplier:2,buyInCents:1000})
    r=command(r,'host','ready');r=command(r,'guest','ready');r=command(r,'host','start')
    r=command(r,'host','rebuy',{targetUid:'guest',chips:5000})
    expect(r.game?.totalChips).toBe(25000)
    expect(r.buyIns?.guest).toBe(1500)
    expect(cashSettlement(r)?.rows.reduce((sum,row)=>sum+row.netCents,0)).toBe(0)
    expect(()=>command(r,'guest','rebuy',{targetUid:'guest',chips:5000})).toThrow('Host')
    r=command(r,'host','deal')
    expect(()=>command(r,'host','rebuy',{targetUid:'guest',chips:5000})).toThrow('zwischen Händen')
    assertChips(r.game!)
  })
  it('keeps cent allocation exact even when chip times buy-in exceeds safe integer precision',()=>{
    const r=table()
    r.status='playing'
    r.game={handId:1,dealer:0,sb:1,bb:2,phase:'settled',turn:null,highestBet:0,minRaise:2,paid:true,pots:[],totalChips:8_000_000_000,
      players:{host:{uid:'host',name:'Host',seat:0,stack:4_000_000_001,folded:false,allIn:false,roundBet:0,handBet:0,actedAtBet:-1},guest:{uid:'guest',name:'Guest',seat:1,stack:3_999_999_999,folded:false,allIn:false,roundBet:0,handBet:0,actedAtBet:-1}}}
    r.buyIns={host:1_000_000_000,guest:1_000_000_001}
    const result=cashSettlement(r)!
    expect(result.rows.reduce((sum,row)=>sum+row.valueCents,0)).toBe(2_000_000_001)
    expect(result.rows.reduce((sum,row)=>sum+row.netCents,0)).toBe(0)
  })
})
