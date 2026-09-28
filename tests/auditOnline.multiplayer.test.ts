import {afterAll, describe, expect, it} from 'vitest'
import {randomUUID} from 'node:crypto'
import {initializeApp, deleteApp, type FirebaseApp} from 'firebase/app'
import {connectAuthEmulator, getAuth, signInAnonymously, updateCurrentUser, type User} from 'firebase/auth'
import {connectDatabaseEmulator, getDatabase, get, ref, set, onValue, remove} from 'firebase/database'
import {createRoom, serveRoom, submitRequest} from '../src/online/roomService'
import {ROOM_ROOT} from '../src/game/roomCore'

// Audit regressions: these exercise only demo-poker-chips Auth/RTDB emulators.
const apps: FirebaseApp[] = []
const stops: Array<() => void> = []
async function client(user?: User) {
  const app = initializeApp({apiKey:'fake-api-key', projectId:'demo-poker-chips', databaseURL:'https://demo-poker-chips-default-rtdb.firebaseio.com', appId:'demo-app'}, randomUUID())
  apps.push(app)
  const auth = getAuth(app), db = getDatabase(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings:true})
  connectDatabaseEmulator(db, '127.0.0.1', 9000)
  if (user) await updateCurrentUser(auth, user)
  else await signInAnonymously(auth)
  return {db, uid:auth.currentUser!.uid, user:auth.currentUser!}
}
async function table() {
  const host = await client()
  const {roomId} = await createRoom(host.db, host.uid, 'Host', randomUUID())
  return {...host, roomId, room:async()=>(await get(ref(host.db, `${ROOM_ROOT}/rooms/${roomId}`))).val()}
}
function waitFor<T>(db: ReturnType<typeof getDatabase>, path:string, predicate:(value:T)=>boolean) {
  return new Promise<T>((resolve,reject)=>{
    let stop = () => {}
    const timer = setTimeout(()=>{stop();reject(Error('Timed out waiting for emulator state'))}, 5000)
    stop = onValue(ref(db,path), snapshot=>{
      const value = snapshot.val() as T
      if(predicate(value)){clearTimeout(timer);stop();resolve(value)}
    }, reject)
    stops.push(stop)
  })
}
afterAll(async()=>{for(const stop of stops)stop();await Promise.all(apps.map(deleteApp))})

describe('online audit regressions',()=>{
  it('rejects reused actionId when the new payload differs from the completed request',async()=>{
    const host = await table()
    const stopServing = serveRoom(host.db,host.uid,host.roomId)
    stops.push(stopServing)
    const actionId = randomUUID()
    await submitRequest(host.db,host.uid,host.roomId,'roomCommand',{type:'ready',expectedVersion:1},actionId)
    await waitFor(host.db,`${ROOM_ROOT}/requests/${host.roomId}/${host.uid}/${actionId}`,value=>value===null)
    stopServing()
    const nextVersion = (await host.room()).version
    await expect(submitRequest(host.db,host.uid,host.roomId,'roomCommand',{type:'ready',expectedVersion:nextVersion},actionId)).rejects.toThrow('actionId')
  },10000)

  it('lets identical concurrent retries share the original response',async()=>{
    const host = await table()
    const actionId = randomUUID(), payload = {type:'ready',expectedVersion:1}
    const first = submitRequest(host.db,host.uid,host.roomId,'roomCommand',payload,actionId)
    await waitFor(host.db,`${ROOM_ROOT}/requests/${host.roomId}/${host.uid}/${actionId}`,value=>value!==null)
    const second = submitRequest(host.db,host.uid,host.roomId,'roomCommand',payload,actionId)
    const both = Promise.allSettled([first,second])
    // Wait for the attempted duplicate write before starting the host inbox.
    await new Promise(resolve=>setTimeout(resolve,100))
    stops.push(serveRoom(host.db,host.uid,host.roomId))
    const results = await both
    expect(results.map(result=>result.status)).toEqual(['fulfilled','fulfilled'])
    expect((await host.room()).version).toBe(2)
  },10000)

  it('rejects a conflicting concurrent retry without changing the queued command',async()=>{
    const host = await table(), actionId = randomUUID()
    const otherTab = await client(host.user)
    const first = submitRequest(host.db,host.uid,host.roomId,'roomCommand',{type:'ready',expectedVersion:1},actionId)
    await waitFor(host.db,`${ROOM_ROOT}/requests/${host.roomId}/${host.uid}/${actionId}`,value=>value!==null)
    await expect(submitRequest(otherTab.db,otherTab.uid,host.roomId,'roomCommand',{type:'takeSeat',seat:2,expectedVersion:1},actionId)).rejects.toThrow('actionId')
    stops.push(serveRoom(host.db,host.uid,host.roomId))
    await first
    expect((await host.room()).members[host.uid]).toMatchObject({seat:0,ready:true})
  },10000)

  it('shares one committed command between simultaneous retries from separate tabs',async()=>{
    const host = await table(), otherTab = await client(host.user)
    const actionId = randomUUID(), payload = {type:'ready',expectedVersion:1}
    const both = Promise.all([
      submitRequest(host.db,host.uid,host.roomId,'roomCommand',payload,actionId),
      submitRequest(otherTab.db,otherTab.uid,host.roomId,'roomCommand',payload,actionId),
    ])
    await waitFor(host.db,`${ROOM_ROOT}/requests/${host.roomId}/${host.uid}/${actionId}`,value=>value!==null)
    stops.push(serveRoom(host.db,host.uid,host.roomId))
    expect(await both).toEqual([{roomId:host.roomId,version:2},{roomId:host.roomId,version:2}])
    expect((await host.room()).version).toBe(2)
  },10000)

  it('reuses an existing identical v0.12 request and verifies legacy cached responses',async()=>{
    const host = await table(), actionId = randomUUID(), payload = {type:'ready',expectedVersion:1}
    await set(ref(host.db,`${ROOM_ROOT}/requests/${host.roomId}/${host.uid}/${actionId}`),{uid:host.uid,actionId,kind:'roomCommand',payload,createdAt:Date.now()})
    stops.push(serveRoom(host.db,host.uid,host.roomId))
    await expect(submitRequest(host.db,host.uid,host.roomId,'roomCommand',payload,actionId)).resolves.toMatchObject({version:2})
    await remove(ref(host.db,`${ROOM_ROOT}/responses/${host.roomId}/${host.uid}/${actionId}/fingerprint`))
    await expect(submitRequest(host.db,host.uid,host.roomId,'roomCommand',{expectedVersion:1,type:'ready'},actionId)).resolves.toMatchObject({version:2})
    await expect(submitRequest(host.db,host.uid,host.roomId,'roomCommand',{...payload,expectedVersion:2},actionId)).rejects.toThrow('actionId')
    expect((await host.room()).version).toBe(2)
  },10000)

  it('matches empty settings collections after Firebase normalizes the request',async()=>{
    const host = await table(), actionId = randomUUID()
    stops.push(serveRoom(host.db,host.uid,host.roomId))
    const payload = {type:'settings',expectedVersion:1,stack:1000,sb:5,bb:10,blindPlan:[],denominations:[]}
    await expect(submitRequest(host.db,host.uid,host.roomId,'roomCommand',payload,actionId)).resolves.toMatchObject({version:2})
    await expect(submitRequest(host.db,host.uid,host.roomId,'roomCommand',payload,actionId)).resolves.toMatchObject({version:2})
  },10000)

  it('rejects scalar payloads before an outsider can fill the host inbox',async()=>{
    const host = await table(), outsider = await client(), actionId = randomUUID()
    const value = {uid:outsider.uid,actionId,kind:'joinRoom',payload:'x'.repeat(100_000),createdAt:Date.now()}
    await expect(set(ref(outsider.db,`${ROOM_ROOT}/requests/${host.roomId}/${outsider.uid}/${actionId}`),value)).rejects.toBeDefined()
  },10000)

  it('rejects extra unbounded data hidden inside recognized payload collections',async()=>{
    const host = await table(), outsider = await client(), actionId = randomUUID()
    const value = {uid:outsider.uid,actionId,kind:'joinRoom',payload:{name:'Guest',denominations:[{color:'red',value:1,unvalidated:'x'.repeat(100_000)}]},createdAt:Date.now()}
    await expect(set(ref(outsider.db,`${ROOM_ROOT}/requests/${host.roomId}/${outsider.uid}/${actionId}`),value)).rejects.toBeDefined()
  },10000)

  it('rejects malformed collection shapes, indices, nested extras, and out-of-range settings',async()=>{
    const host = await table()
    const invalid = [
      {type:'settings',blindPlan:'x'.repeat(100_000)},
      {type:'settings',blindPlan:[{kind:'level',minutes:1,sb:5,bb:10,extra:'x'}]},
      {type:'settings',blindPlan:[{kind:'level',minutes:1.5,sb:5,bb:10}]},
      {type:'settings',blindPlan:[{kind:'level',minutes:1,sb:5,bb:4}]},
      {type:'settings',blindPlan:{24:{kind:'level',minutes:1,sb:5,bb:10}}},
      {type:'settings',blindPlan:[{kind:'break',minutes:61}]},
      {type:'settings',denominations:12},
      {type:'settings',denominations:[{color:'#ffffff',value:1,extra:'x'}]},
      {type:'settings',denominations:[{color:'red',value:1}]},
      {type:'settings',denominations:[{color:'#ffffff',value:1.5}]},
      {type:'settings',denominations:{10:{color:'#ffffff',value:1}}},
      {type:'settings',stack:1_000_000_001},
      {type:'takeSeat',seat:9},
      {type:'act',move:'call'},
      {type:'act',move:{kind:'check',extra:'x'}},
      {type:'payout',winners:['uid']},
      {type:'payout',winners:{9:['uid']}},
      {type:'payout',winners:[{9:'uid'}]},
      {type:'ready',expectedVersion:-1},
    ]
    for(const payload of invalid){
      const actionId=randomUUID()
      await expect(set(ref(host.db,`${ROOM_ROOT}/requests/${host.roomId}/${host.uid}/${actionId}`),{uid:host.uid,actionId,kind:'roomCommand',payload:{expectedVersion:1,...payload},createdAt:Date.now()})).rejects.toBeDefined()
    }
  },10000)

  it('accepts supported maximum collection sizes and normal v0.12 bet commands',async()=>{
    const host = await table()
    const payloads = [
      {type:'settings',stack:1_000_000_000,sb:5,bb:10,blindMinutes:180,blindMultiplier:1.5,ante:10,anteMode:'each',buyInCents:1_000_000_000,
        blindPlan:Array.from({length:24},(_,i)=>({kind:'level',minutes:180,sb:5+i,bb:10+i,ante:0,anteMode:'bb'})),
        denominations:Array.from({length:10},(_,i)=>({color:'#ffffff',value:i+1}))},
      {type:'act',move:{kind:'bet',to:100}},
      {type:'payout',winners:Array.from({length:9},()=>Array.from({length:9},()=>host.uid))},
    ]
    for(const payload of payloads){
      const actionId=randomUUID()
      await expect(set(ref(host.db,`${ROOM_ROOT}/requests/${host.roomId}/${host.uid}/${actionId}`),{uid:host.uid,actionId,kind:'roomCommand',payload:{expectedVersion:1,...payload},createdAt:Date.now()})).resolves.toBeUndefined()
    }
  },10000)
})
