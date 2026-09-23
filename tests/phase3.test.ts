import {describe,expect,it} from 'vitest'
import {applyRequest,newRoom,type RoomState} from '../src/roomCore'
import {createLocalRoom,localCommand} from '../src/localRoom'

let seq=0
const t=1_800_000_000_000
function send(r:RoomState,uid:string,type:string,data:Record<string,unknown>={}){return applyRequest(r,{uid,actionId:`phase-three-${++seq}`,kind:'roomCommand',createdAt:t,payload:{type,expectedVersion:r.version,...data}},t)}
function table(){let r=newRoom('123456','host','Host','phase-three-create');r=applyRequest(r,{uid:'guest',actionId:`phase-three-${++seq}`,kind:'joinRoom',createdAt:t,payload:{name:'Guest'}},t);r=send(r,'host','ready');r=send(r,'guest','ready');return send(r,'host','start')}

describe('Spielleitung und Session-Rückblick',()=>{
  it('transfers the host atomically at a hand boundary',()=>{
    let r=table()
    r=send(r,'host','deal')
    expect(()=>send(r,'host','hostTransfer',{targetUid:'guest'})).toThrow('zwischen Händen')
    r=send(r,'host','act',{move:{kind:'fold'}})
    r=send(r,'host','payout',{winners:[['guest'],['guest']]})
    r=send(r,'host','hostTransfer',{targetUid:'guest'})
    expect(r.hostUid).toBe('guest')
    expect(r.members.guest.host).toBe(true)
    expect(r.members.host.host).toBe(false)
    expect(()=>send(r,'host','nextHand')).toThrow('Host')
    r=send(r,'guest','nextHand')
    expect(r.game?.handId).toBe(2)
  })
  it('rolls the session totals back with a corrected payout',()=>{
    let r=send(table(),'host','deal')
    r=send(r,'host','act',{move:{kind:'fold'}})
    r=send(r,'host','payout',{winners:[['guest'],['guest']]})
    expect(r.session?.handsCompleted).toBe(1)
    expect(r.session?.biggestPot).toBe(150)
    expect(r.session?.winners.guest.chips).toBe(150)
    r=send(r,'host','undoPayout')
    expect(r.session).toBeUndefined()
  })
  it('creates a complete local table without Firebase',()=>{
    let r=createLocalRoom(['Anna','Ben'],{stack:1000,sb:5,bb:10,blindMinutes:0,blindMultiplier:2})
    expect(r.game?.phase).toBe('waiting-deal')
    r=localCommand(r,'local-0','deal')
    expect(r.game?.turn).toBe('local-0')
    r=localCommand(r,'local-0','act',{move:{kind:'fold'}})
    r=localCommand(r,'local-0','payout',{winners:[['local-1'],['local-1']]})
    expect(r.session?.handsCompleted).toBe(1)
  })
})
