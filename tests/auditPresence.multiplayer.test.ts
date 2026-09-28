import {afterAll, describe, expect, it, vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {initializeApp, deleteApp, getApps} from 'firebase/app'
import {connectAuthEmulator, getAuth, signInAnonymously} from 'firebase/auth'
import {connectDatabaseEmulator, getDatabase, get, ref, set, onValue, goOffline, goOnline} from 'firebase/database'

const network = vi.hoisted(()=>({dropNextPresence:false, dropped:false, completedPresences:0}))
vi.mock('../src/online/firebaseConfig',()=>({
  firebaseConfig:{apiKey:'fake-api-key',projectId:'demo-poker-chips',databaseURL:'https://demo-poker-chips-default-rtdb.firebaseio.com',appId:'demo-app'},
  firebaseConfigured:true,configurationError:'',firebaseError:(error:unknown)=>String(error),
}))
vi.mock('firebase/database',async importActual=>{
  const actual = await importActual<typeof import('firebase/database')>()
  return {...actual,set:(target:Parameters<typeof actual.set>[0],value:unknown)=>{
    if(network.dropNextPresence && target.toString().includes('/presence/')){
      network.dropNextPresence=false
      network.dropped=true
      // Model connectivity loss after onDisconnect was registered but before
      // the initial presence write reached the server.
      actual.goOffline(actual.getDatabase())
    }
    return actual.set(target,value).then(()=>{if(target.toString().includes('/presence/'))network.completedPresences++})
  }}
})
const stops:Array<()=>void>=[]
afterAll(async()=>{
  for(const stop of stops)stop()
  for(const app of getApps())goOnline(getDatabase(app))
  await Promise.all(getApps().map(deleteApp))
  vi.unstubAllEnvs()
})
async function observer(){
  const app=initializeApp({apiKey:'fake-api-key',projectId:'demo-poker-chips',databaseURL:'https://demo-poker-chips-default-rtdb.firebaseio.com',appId:'demo-app'},randomUUID())
  const auth=getAuth(app),db=getDatabase(app)
  connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true})
  connectDatabaseEmulator(db,'127.0.0.1',9000)
  return {db,uid:(await signInAnonymously(auth)).user.uid}
}
async function until(predicate:()=>boolean){
  const deadline=Date.now()+5000
  while(!predicate()){
    if(Date.now()>deadline)throw Error('Timed out waiting for emulated connection')
    await new Promise(resolve=>setTimeout(resolve,20))
  }
}
describe('presence audit regressions',()=>{
  it('does not resurrect presence without a disconnect hook after a queued write reconnects',async()=>{
    vi.stubEnv('VITE_USE_EMULATORS','true')
    const online=await import('../src/online/firebase')
    const user=await online.identity(),db=getDatabase(),guest=await observer()
    const {roomId}=await online.command<{roomId:string}>('createRoom',{name:'Host'})
    await set(ref(db,`poker/v2/rooms/${roomId}/members/${guest.uid}`),{uid:guest.uid,name:'Guest',host:false,ready:false,seat:1})
    let observed:Record<string,boolean>|null=null
    stops.push(onValue(ref(guest.db,`poker/v2/rooms/${roomId}/presence/${user.uid}`),snapshot=>{observed=snapshot.val()}))
    network.dropNextPresence=true
    stops.push(await online.watchRoom(roomId,{room:()=>{},connection:()=>{},error:error=>{throw error}}))
    await until(()=>network.dropped)
    await new Promise(resolve=>setTimeout(resolve,100))
    goOnline(db)
    await until(()=>network.completedPresences>=2)
    await until(()=>Object.keys(observed||{}).length===1)
    goOffline(db)
    await until(()=>observed===null)
    expect((await get(ref(guest.db,`poker/v2/rooms/${roomId}/presence/${user.uid}`))).val()).toBeNull()
  },10000)
})
