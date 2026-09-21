import {initializeApp} from 'firebase/app'
import {Auth,connectAuthEmulator,getAuth,signInAnonymously} from 'firebase/auth'
import {Database,connectDatabaseEmulator,getDatabase,onDisconnect,onValue,ref,set} from 'firebase/database'
import {Functions,connectFunctionsEmulator,getFunctions,httpsCallable} from 'firebase/functions'

const config={apiKey:import.meta.env.VITE_FIREBASE_API_KEY,authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,databaseURL:import.meta.env.VITE_FIREBASE_DATABASE_URL,projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID,appId:import.meta.env.VITE_FIREBASE_APP_ID}
const configured=Object.values(config).every(Boolean)
const app=configured?initializeApp(config):null
export const auth:Auth|null=app?getAuth(app):null
const db:Database|null=app?getDatabase(app):null
const functions:Functions|null=app?getFunctions(app):null

if(import.meta.env.VITE_USE_EMULATORS==='true'&&auth&&db&&functions){connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectDatabaseEmulator(db,'127.0.0.1',9000);connectFunctionsEmulator(functions,'127.0.0.1',5001)}

function requireFirebase(){if(!auth||!db||!functions)throw new Error('Firebase ist noch nicht konfiguriert. Bitte die VITE_FIREBASE_* Umgebungsvariablen hinterlegen.');return{auth,db,functions}}
export async function identity(){const services=requireFirebase();if(!services.auth.currentUser)await signInAnonymously(services.auth);return services.auth.currentUser!}
export async function command<T>(name:string,payload:object){const services=requireFirebase();await identity();return(await httpsCallable(services.functions,name)({...payload,actionId:crypto.randomUUID()})).data as T}
export async function watchRoom(id:string,cb:(v:any)=>void){const services=requireFirebase();const u=await identity();const room=ref(services.db,`poker/v1/rooms/${id}`);onValue(room,s=>cb(s.val()));onValue(ref(services.db,'.info/connected'),async s=>{if(s.val()){const p=ref(services.db,`poker/v1/rooms/${id}/presence/${u.uid}/${crypto.randomUUID()}`);await onDisconnect(p).remove();await set(p,true)}})}
