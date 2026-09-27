// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {clearLocalRoom,createLocalRoom,inspectLocalRoom,localCommand,readLocalRoom} from '../src/device/localRoom'

const key='poker-chips-local-table-v1'
const settings={stack:10000,sb:50,bb:100,blindMinutes:20,blindMultiplier:2}
beforeEach(()=>localStorage.clear())
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})

describe('local save recovery',()=>{
  it('keeps valid saves unchanged through dealing, payout, reload and payout correction',()=>{
    let room=createLocalRoom(['Alex','Blair'],settings)
    for(const command of ['deal','pause','resume'])room=localCommand(room,'local-0',command)
    room=localCommand(room,room.game!.turn!,'act',{move:{kind:'fold'}})
    room=localCommand(room,'local-0','payout',{winners:[['local-1']]})
    const raw=localStorage.getItem(key)
    expect(readLocalRoom()).toEqual(room)
    expect(localStorage.getItem(key)).toBe(raw)
    room=localCommand(readLocalRoom()!,'local-0','undoPayout')
    expect(readLocalRoom()).toEqual(room)
    expect(room.game!.phase).toBe('showdown')
  })

  it.each<[string,(room:any)=>void]>([
    ['null player',room=>{room.game.players['local-0']=null}],
    ['array players',room=>{room.game.players=[]}],
    ['missing members',room=>{room.members={}}],
    ['null member',room=>{room.members['local-1']=null}],
    ['mismatched member identity',room=>{room.members['local-1'].uid='local-0'}],
    ['missing host',room=>{room.members['local-0'].host=false}],
    ['invalid member name',room=>{room.members['local-1'].name={}}],
    ['invalid time bank',room=>{room.members['local-0'].timeBank=-1}],
    ['string stack',room=>{room.game.players['local-0'].stack='10000'}],
    ['fractional stack',room=>{room.game.players['local-0'].stack=9999.5}],
    ['duplicate seat',room=>{room.game.players['local-1'].seat=0;room.members['local-1'].seat=0}],
    ['mismatched member seat',room=>{room.members['local-1'].seat=2}],
    ['invalid folded flag',room=>{room.game.players['local-0'].folded='false'}],
    ['invalid ante bet',room=>{room.game.players['local-0'].anteBet=-1}],
    ['incorrect chip total',room=>{room.game.totalChips++}],
    ['unknown turn',room=>{room.game.turn='missing'}],
    ['turn in a waiting phase',room=>{room.game.turn='local-0'}],
    ['unknown phase',room=>{room.game.phase='unknown'}],
    ['incorrect paid state',room=>{room.game.paid=true}],
    ['invalid previous big blind seat',room=>{room.game.previousBigBlindSeat='bad'}],
    ['invalid pending dealer seat',room=>{room.game.pendingDealerSeat=9}],
    ['invalid small blind seat',room=>{room.game.smallBlindSeat=9}],
    ['invalid big blind seat',room=>{room.game.bigBlindSeat=-1}],
    ['null pot',room=>{room.game.pots=[null]}],
    ['unknown eligible player',room=>{room.game.pots=[{amount:100,eligible:['missing']}]}],
    ['invalid pot amount',room=>{room.game.pots=[{amount:-1,eligible:['local-0']}]}],
    ['null settings',room=>{room.settings=null}],
    ['invalid blind multiplier',room=>{room.settings.blindMultiplier='2'}],
    ['malformed blind plan',room=>{room.settings.blindPlan=[null]}],
    ['malformed denominations',room=>{room.settings.denominations=[null]}],
    ['invalid pause timestamp',room=>{room.pausedAt=-1}],
    ['invalid turn clock',room=>{room.turnClock={uid:'missing',deadline:100}}],
    ['invalid blind clock',room=>{room.blindClock={level:0,nextIncreaseAt:0}}],
    ['null session winners',room=>{room.session={handsCompleted:0,biggestPot:0,winners:null}}],
    ['null winner',room=>{room.session={handsCompleted:1,biggestPot:100,winners:{'local-0':null}}}],
    ['malformed payout snapshot',room=>{room.lastPayout={handId:1,game:{players:{}}}}],
    ['invalid buy-in',room=>{room.buyIns={'local-0':'100'}}],
    ['invalid bought chips',room=>{room.boughtChips={'local-0':-1}}],
    ['null processed action',room=>{room.processed={broken:null}}],
    ['invalid history entry',room=>{room.history={broken:{version:'1'}}}],
  ])('retains malformed %s without overwriting its original bytes',(_name,mutate)=>{
    const room=createLocalRoom(['Alex','Blair'],settings);mutate(room)
    const raw=' \r\n'+JSON.stringify(room,null,'\t')+'\r\n ';localStorage.setItem(key,raw)
    expect(inspectLocalRoom()).toEqual({room:null,invalid:raw,unavailable:false})
    expect(readLocalRoom()).toBeNull()
    expect(()=>createLocalRoom(['Caro','Daria'],settings)).toThrow('beschädigten Spielstand')
    expect(localStorage.getItem(key)).toBe(raw)
  })

  it.each(['{broken',' \r\n{"name":"Älex ♠",\r\n','null','[]','{}','42','"save"','','  \r\n\t'])('retains invalid JSON or shape %j until explicitly cleared',raw=>{
    localStorage.setItem(key,raw)
    expect(inspectLocalRoom().invalid).toBe(raw)
    expect(readLocalRoom()).toBeNull()
    expect(()=>createLocalRoom(['Caro','Daria'],settings)).toThrow('beschädigten Spielstand')
    expect(localStorage.getItem(key)).toBe(raw)
    clearLocalRoom()
    expect(inspectLocalRoom()).toEqual({room:null,invalid:null,unavailable:false})
    expect(createLocalRoom(['Alex','Blair'],settings).game).toBeDefined()
  })

  it('accepts older valid saves without optional metadata and preserves formatting',()=>{
    const room=createLocalRoom(['Älex ♠','Blair'],settings)
    for(const field of ['blindClock','turnClock','processed','history','session','joinOpen','lateRegistration'] as const)delete room[field]
    for(const member of Object.values(room.members)){delete member.timeBank;delete member.sittingOut}
    for(const field of ['blindMinutes','blindMultiplier','ante','anteMode'] as const)delete room.settings[field]
    delete room.game!.ante;delete room.game!.anteMode
    const raw='\r\n'+JSON.stringify(room,null,'\t')+'  \r\n';localStorage.setItem(key,raw)
    expect(inspectLocalRoom()).toEqual({room,invalid:null,unavailable:false})
    expect(readLocalRoom()).toEqual(room)
    expect(localStorage.getItem(key)).toBe(raw)
  })

  it('keeps damaged data recoverable when the browser refuses deletion',()=>{
    const raw=' \r\n{broken';localStorage.setItem(key,raw)
    vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('denied')})
    expect(()=>clearLocalRoom()).not.toThrow()
    expect(inspectLocalRoom()).toEqual({room:null,invalid:raw,unavailable:false})
    expect(()=>createLocalRoom(['Alex','Blair'],settings)).toThrow('beschädigten Spielstand')
    expect(localStorage.getItem(key)).toBe(raw)
  })

  it('permits an in-memory session when browser storage is denied',()=>{
    vi.stubGlobal('localStorage',{getItem(){throw Error('denied')},setItem(){throw Error('denied')}})
    expect(inspectLocalRoom()).toEqual({room:null,invalid:null,unavailable:true})
    expect(createLocalRoom(['Alex','Blair'],settings).game).toBeDefined()
  })
})
