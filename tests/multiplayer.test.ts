import { afterAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth'
import { connectDatabaseEmulator, getDatabase, get, ref, set, onValue } from 'firebase/database'
import { createRoom, serveRoom, submitRequest, transferHost } from '../src/online/roomService'
import { ROOM_ROOT } from '../src/game/roomCore'

const apps: FirebaseApp[] = []
const hosts = new Map<string, () => void>()
async function client(authenticate = true) {
  const app = initializeApp({ apiKey: 'fake-api-key', authDomain: 'demo-poker-chips.firebaseapp.com', projectId: 'demo-poker-chips', databaseURL: 'https://demo-poker-chips-default-rtdb.firebaseio.com', appId: 'demo-app' }, randomUUID())
  apps.push(app)
  const auth = getAuth(app), db = getDatabase(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectDatabaseEmulator(db, '127.0.0.1', 9000)
  if (authenticate) await signInAnonymously(auth)
  const uid = auth.currentUser?.uid ?? 'unauthenticated'
  const call = async (name: string, data: Record<string, any>): Promise<any> => {
    if (name === 'createRoom') {
      const result = await createRoom(db, uid, data.name, data.actionId, data.code)
      if (!hosts.has(result.roomId)) hosts.set(result.roomId, serveRoom(db, uid, result.roomId))
      return result
    }
    if (name === 'joinRoom') return submitRequest(db, uid, data.code, 'joinRoom', {name: data.name}, data.actionId)
    const {roomId, actionId, ...payload} = data
    return submitRequest(db, uid, roomId, 'roomCommand', payload, actionId)
  }
  const room = async (id: string) => (await get(ref(db, `${ROOM_ROOT}/rooms/${id}`))).val()
  const command = async (id: string, type: string, data: object = {}) => call('roomCommand', { roomId: id, type, expectedVersion: (await room(id)).version, actionId: randomUUID(), ...data })
  return { uid: auth.currentUser?.uid, app, db, call, room, command }
}
afterAll(async () => { for (const stop of hosts.values()) stop(); await Promise.all(apps.map(deleteApp)) })

describe('Firebase Spark multiplayer integration', () => {
  it('hands control to an online member without losing the room or identity',async()=>{
    const [host,guest]=await Promise.all([client(),client()])
    const {roomId}=await host.call('createRoom',{name:'Host',actionId:randomUUID()})
    await guest.call('joinRoom',{name:'Guest',code:roomId,actionId:randomUUID()})
    const before=await host.room(roomId)
    await transferHost(host.db,host.uid!,roomId,{type:'hostTransfer',targetUid:guest.uid,expectedVersion:before.version},randomUUID())
    hosts.get(roomId)?.();hosts.set(roomId,serveRoom(guest.db,guest.uid!,roomId))
    expect((await guest.room(roomId)).hostUid).toBe(guest.uid)
    await expect(host.command(roomId,'randomSeats')).rejects.toBeDefined()
    await guest.command(roomId,'randomSeats')
    expect((await guest.room(roomId)).members[guest.uid!].host).toBe(true)
  },30000)
  it('stores planned levels, chip colors and rebuys through the free database rules', async () => {
    const [host,guest]=await Promise.all([client(),client()])
    const {roomId}=await host.call('createRoom',{name:'Host',actionId:randomUUID()})
    await guest.call('joinRoom',{name:'Guest',code:roomId,actionId:randomUUID()})
    await host.command(roomId,'settings',{stack:10000,sb:50,bb:100,blindMinutes:1,blindMultiplier:2,ante:10,anteMode:'bb',buyInCents:1000,
      blindPlan:[{kind:'level',sb:50,bb:100,minutes:1,ante:10,anteMode:'bb'},{kind:'break',minutes:5},{kind:'level',sb:100,bb:200,minutes:1,ante:20,anteMode:'bb'}],
      denominations:[{color:'#ffffff',value:25},{color:'#2563eb',value:100}]})
    await host.command(roomId,'ready');await guest.command(roomId,'ready');await host.command(roomId,'start')
    await host.command(roomId,'rebuy',{targetUid:guest.uid,chips:5000})
    const room=await guest.room(roomId)
    expect(room.game.totalChips).toBe(25000)
    expect(room.buyIns[guest.uid!]).toBe(1500)
    expect(room.settings.blindPlan).toHaveLength(3)
    await expect(guest.command(roomId,'rebuy',{targetUid:guest.uid,chips:5000})).rejects.toThrow('Host')
  },30000)
  it('keeps pause, time reserve, payout correction and late entry authoritative across clients', async () => {
    const [host, guest, third] = await Promise.all([client(), client(), client()])
    const {roomId} = await host.call('createRoom', {name:'Host', actionId:randomUUID()})
    await guest.call('joinRoom', {name:'Guest', code:roomId, actionId:randomUUID()})
    await host.command(roomId, 'entryPolicy', {joinOpen:false, lateRegistration:true})
    await expect(third.call('joinRoom', {name:'Third', code:roomId, actionId:randomUUID()})).rejects.toThrow('geschlossen')
    await host.command(roomId, 'entryPolicy', {joinOpen:true, lateRegistration:true})
    await host.command(roomId, 'ready'); await guest.command(roomId, 'ready')
    await host.command(roomId, 'start'); await host.command(roomId, 'deal')
    const firstDeadline = (await guest.room(roomId)).turnClock.deadline
    await host.command(roomId, 'timeBank')
    expect((await guest.room(roomId)).turnClock.deadline).toBe(firstDeadline + 30000)
    await expect(guest.command(roomId, 'timeBank')).rejects.toThrow('Zeitreserve')
    await host.command(roomId, 'pause')
    await expect(host.command(roomId, 'act', {move:{kind:'fold'}})).rejects.toThrow('pausiert')
    await host.command(roomId, 'resume')
    await host.command(roomId, 'act', {move:{kind:'fold'}})
    await host.command(roomId, 'payout', {winners:[[guest.uid],[guest.uid]]})
    await expect(guest.command(roomId, 'undoPayout')).rejects.toThrow('Host')
    await host.command(roomId, 'undoPayout')
    expect((await guest.room(roomId)).game.phase).toBe('showdown')
    await host.command(roomId, 'payout', {winners:[[guest.uid],[guest.uid]]})
    await third.call('joinRoom', {name:'Third', code:roomId, actionId:randomUUID()})
    const state = await host.room(roomId)
    expect(state.game.totalChips).toBe(state.settings.stack * 3)
    expect(state.game.players[third.uid!].stack).toBe(state.settings.stack)
    expect(state.lastPayout).toBeUndefined()
  }, 30000)

  it('authenticates independent players, arbitrates seats, protects writes and completes two real hands', async () => {
    const [host, guest, outsider] = await Promise.all([client(), client(), client()])
    const create = { name: 'Host', actionId: randomUUID() }
    const { roomId } = await host.call('createRoom', create)
    expect(await host.call('createRoom', create)).toEqual({ roomId })
    expect(roomId).toMatch(/^\d{6}$/)
    await expect(outsider.room(roomId)).rejects.toBeDefined()
    await expect(outsider.call('roomCommand', { roomId, type: 'start', expectedVersion: 1, actionId: randomUUID() })).rejects.toBeDefined()
    await guest.call('joinRoom', { name: 'Guest', code: roomId, actionId: randomUUID() })
    expect(Object.keys((await host.room(roomId)).members)).toHaveLength(2)
    expect((await guest.room(roomId)).members[guest.uid!].seat).toBe(1)
    await expect(set(ref(guest.db, `${ROOM_ROOT}/rooms/${roomId}/members/${guest.uid}/host`), true)).rejects.toBeDefined()
    await expect(set(ref(guest.db, `${ROOM_ROOT}/requests/${roomId}/${host.uid}/forged-action`), {uid: host.uid, actionId: 'forged-action', kind: 'roomCommand', payload: {type: 'start', expectedVersion: 2}, createdAt: Date.now()})).rejects.toBeDefined()
    await expect(host.command(roomId, 'takeSeat', { seat: 1.5 })).rejects.toBeDefined()
    const version = (await host.room(roomId)).version
    const seatRace = await Promise.allSettled([host, guest].map(player => player.call('roomCommand', { roomId, type: 'takeSeat', seat: 2, expectedVersion: version, actionId: randomUUID() })))
    expect(seatRace.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    await host.command(roomId, 'takeSeat', { seat: 0 })
    await guest.command(roomId, 'takeSeat', { seat: 1 })
    await expect(guest.command(roomId, 'settings', { stack: 999, sb: 5, bb: 10 })).rejects.toBeDefined()
    await host.command(roomId, 'settings', { stack: 100, sb: 5, bb: 10 })
    await expect(host.command(roomId, 'start')).rejects.toBeDefined()
    await host.command(roomId, 'ready'); await guest.command(roomId, 'ready'); await host.command(roomId, 'start')
    let room = await host.room(roomId)
    expect(room.game.phase).toBe('waiting-deal')
    await expect(guest.command(roomId, 'deal')).rejects.toBeDefined()
    const dealCommand = { roomId, type: 'deal', expectedVersion: room.version, actionId: randomUUID() }
    await host.call('roomCommand', dealCommand); await host.call('roomCommand', dealCommand)
    room = await host.room(roomId)
    expect(room.game.players[host.uid!].stack).toBe(95); expect(room.game.players[guest.uid!].stack).toBe(90)
    expect(room.game.turn).toBe(host.uid)
    await expect(guest.command(roomId, 'act', { move: { kind: 'fold' } })).rejects.toBeDefined()
    await expect(set(ref(guest.db, `${ROOM_ROOT}/rooms/${roomId}/game/players/${guest.uid}/stack`), 999999)).rejects.toBeDefined()
    await host.command(roomId, 'act', { move: { kind: 'fold' } })
    room = await host.room(roomId)
    expect(room.game.phase).toBe('showdown'); expect(room.game.paid).toBe(false)
    await expect(guest.command(roomId,'payout',{winners:[[guest.uid],[guest.uid]]})).rejects.toThrow('Host')
    await expect(host.command(roomId,'nextHand')).rejects.toThrow('abrechnen')
    await host.command(roomId,'payout',{winners:[[guest.uid],[guest.uid]]})
    room = await host.room(roomId)
    expect(room.game.phase).toBe('settled'); expect(room.game.players[host.uid!].stack).toBe(95); expect(room.game.players[guest.uid!].stack).toBe(105)
    await expect(host.command(roomId, 'payout', { winners: [[guest.uid]] })).rejects.toBeDefined()
    await expect(host.command(roomId, 'ready')).rejects.toBeDefined()
    await host.command(roomId, 'nextHand')
    room = await host.room(roomId); expect(room.game.handId).toBe(2); expect(room.game.dealer).toBe(1)
    await guest.command(roomId, 'deal'); await guest.command(roomId, 'act', { move: { kind: 'call' } }); await host.command(roomId, 'act', { move: { kind: 'check' } })
    for (let street = 0; street < 3; street++) {
      await guest.command(roomId, 'reveal')
      await host.command(roomId, 'act', { move: { kind: 'check' } }); await guest.command(roomId, 'act', { move: { kind: 'check' } })
    }
    room = await host.room(roomId); expect(room.game.phase).toBe('showdown')
    await expect(guest.command(roomId, 'payout', { winners: [[guest.uid]] })).rejects.toBeDefined()
    await expect(host.command(roomId, 'payout', { winners: [[host.uid, host.uid]] })).rejects.toBeDefined()
    const pay = { roomId, type: 'payout', expectedVersion: room.version, actionId: randomUUID(), winners: [[host.uid, guest.uid]] }
    await host.call('roomCommand', pay); await host.call('roomCommand', pay)
    room = await host.room(roomId)
    expect(room.game.phase).toBe('settled')
    expect(Object.values(room.game.players).reduce((sum: number, player: any) => sum + player.stack + (player.handBet || 0), 0)).toBe(200)
    expect(room.game.players[host.uid!].stack).toBe(95); expect(room.game.players[guest.uid!].stack).toBe(105)
    hosts.get(roomId)!(); hosts.delete(roomId)
    const queued = guest.command(roomId, 'nextHand')
    hosts.set(roomId, serveRoom(host.db, host.uid!, roomId))
    await expect(queued).rejects.toThrow('Nur der Host')
    await host.command(roomId, 'nextHand')
    expect((await host.room(roomId)).game.handId).toBe(3)
  }, 120000)

  it('synchronizes timer settings and higher blinds at the hand boundary while rejecting guest changes', async () => {
    const [host, guest] = await Promise.all([client(), client()])
    const {roomId} = await host.call('createRoom', {name:'Host', actionId:randomUUID()})
    await guest.call('joinRoom', {name:'Guest', code:roomId, actionId:randomUUID()})
    await host.command(roomId,'settings',{stack:1000,sb:5,bb:10,blindMinutes:1,blindMultiplier:2})
    expect((await guest.room(roomId)).settings.blindMinutes).toBe(1)
    await expect(set(ref(guest.db, `${ROOM_ROOT}/rooms/${roomId}/settings/blindMinutes`), 0)).rejects.toBeDefined()
    await expect(set(ref(host.db, `${ROOM_ROOT}/rooms/${roomId}/settings/blindMinutes`), .5)).rejects.toBeDefined()
    await host.command(roomId,'ready'); await guest.command(roomId,'ready'); await host.command(roomId,'start'); await host.command(roomId,'deal')
    const clock = (await guest.room(roomId)).blindClock
    expect(clock.nextIncreaseAt).toBeGreaterThan(Date.now())
    await expect(set(ref(guest.db, `${ROOM_ROOT}/rooms/${roomId}/blindClock/nextIncreaseAt`), 1)).rejects.toBeDefined()
    // Expire only this isolated emulator clock; no wall-clock wait is required.
    await set(ref(host.db, `${ROOM_ROOT}/rooms/${roomId}/blindClock/nextIncreaseAt`), Date.now()-1)
    await host.command(roomId,'act',{move:{kind:'fold'}})
    await host.command(roomId,'payout',{winners:[[guest.uid],[guest.uid]]})
    expect((await guest.room(roomId)).game.bb).toBe(10)
    await host.command(roomId,'nextHand')
    let room = await guest.room(roomId)
    expect(room.game).toMatchObject({sb:10,bb:20,minRaise:20,handId:2})
    expect(room.blindClock).toEqual({level:2,nextIncreaseAt:0})
    await guest.command(roomId,'deal')
    room = await guest.room(roomId)
    expect(room.game.players[host.uid!].roundBet).toBe(20)
    expect(room.game.players[guest.uid!].roundBet).toBe(10)
    expect(room.blindClock.nextIncreaseAt).toBeGreaterThan(Date.now())
    expect(Object.values(room.game.players).reduce((sum:number,p:any)=>sum+p.stack+p.handBet,0)).toBe(2000)
  },30000)

  it('recovers an expired turn after the host reconnects and waits for payout confirmation', async () => {
    const [host,guest]=await Promise.all([client(),client()])
    const {roomId}=await host.call('createRoom',{name:'Host',actionId:randomUUID()})
    await guest.call('joinRoom',{name:'Guest',code:roomId,actionId:randomUUID()})
    await host.command(roomId,'ready');await guest.command(roomId,'ready');await host.command(roomId,'start');await host.command(roomId,'deal')
    expect((await guest.room(roomId)).turnClock.deadline).toBeGreaterThan(Date.now()+28000)
    await expect(set(ref(guest.db,`${ROOM_ROOT}/rooms/${roomId}/turnClock/deadline`),1)).rejects.toBeDefined()
    hosts.get(roomId)!(); hosts.delete(roomId)
    await set(ref(host.db,`${ROOM_ROOT}/rooms/${roomId}/turnClock/deadline`),Date.now()-1)
    hosts.set(roomId,serveRoom(host.db,host.uid!,roomId))
    const room:any=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{stop();reject(Error('Host did not expire turn'))},5000)
      const stop=onValue(ref(guest.db,`${ROOM_ROOT}/rooms/${roomId}`),snapshot=>{
        if(snapshot.val()?.game?.phase==='showdown'){clearTimeout(timer);stop();resolve(snapshot.val())}
      },reject)
    })
    expect(room.game.players[host.uid!].folded).toBe(true)
    expect(room.game.paid).toBe(false)
    expect(room.turnClock).toBeUndefined()
    expect(room.history[`v${room.version}`].type).toBe('autoFold')
    await host.call('roomCommand',{roomId,type:'payout',expectedVersion:room.version,actionId:randomUUID(),winners:[[guest.uid],[guest.uid]]})
    expect((await guest.room(roomId)).game.phase).toBe('settled')
  },30000)

  it('reserves a custom code atomically and never overwrites an occupied room', async () => {
    const [first, second] = await Promise.all([client(),client()])
    const code=String(100000+Math.floor(Math.random()*900000))
    const payload={name:'Custom table',code,actionId:randomUUID()}
    const results=await Promise.allSettled([first,second].map(player=>player.call('createRoom',payload)))
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
    const winner=results[0].status==='fulfilled'?first:second, loser=winner===first?second:first
    expect(await winner.call('createRoom',payload)).toEqual({roomId:code})
    const previous = await winner.room(code)
    expect(await winner.call('createRoom',{...payload,name:'Changed title',actionId:randomUUID()})).toEqual({roomId:code})
    expect(await winner.room(code)).toEqual(previous)
    expect(Object.keys((await winner.room(code)).members)).toEqual([winner.uid])
    await expect(loser.call('createRoom',{...payload,actionId:randomUUID()})).rejects.toThrow('bereits belegt')
    await expect(loser.call('createRoom',{...payload,code:'12abcd'})).rejects.toThrow('sechsstellig')
  },30000)

  it('rejects unauthenticated and malformed requests without creating state', async () => {
    const [anonymous, player] = await Promise.all([client(false), client()])
    await expect(anonymous.call('createRoom', { name: 'Host', actionId: randomUUID() })).rejects.toBeDefined()
    await expect(player.call('createRoom', { name: 'A', actionId: randomUUID() })).rejects.toBeDefined()
    await expect(player.call('createRoom', { name: 'Host', actionId: '../../invalid' })).rejects.toBeDefined()
    await expect(player.call('joinRoom', { name: 'Guest', code: '12.345', actionId: randomUUID() })).rejects.toBeDefined()
    await expect(player.call('joinRoom', { name: 'Guest', code: '000000', actionId: randomUUID() })).rejects.toBeDefined()
    await expect(player.call('roomCommand', { roomId: '000000', type: 'start', expectedVersion: 1, actionId: randomUUID() })).rejects.toBeDefined()
  }, 30000)
})
