import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInAnonymously, type User } from 'firebase/auth'
import { connectDatabaseEmulator, getDatabase, onDisconnect, onValue, ref, remove, set, type DatabaseReference } from 'firebase/database'
import { createRoom, serveRoom, submitRequest } from './roomService'
import { ROOM_ROOT, type RoomState } from './roomCore'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}
export const firebaseConfigured = Object.values(config).every(value => typeof value === 'string' && value.trim())
export const configurationError = 'Firebase ist für diese Website noch nicht eingerichtet. Die Firebase-Konfiguration muss beim Veröffentlichen hinterlegt werden.'
const app = firebaseConfigured ? initializeApp(config) : null
export const auth = app ? getAuth(app) : null
const db = app ? getDatabase(app) : null

if (import.meta.env.VITE_USE_EMULATORS === 'true' && auth && db) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectDatabaseEmulator(db, '127.0.0.1', 9000)
}

function requireFirebase() {
  if (!auth || !db) throw new Error(configurationError)
  return { auth, db }
}

export function firebaseError(error: unknown): string {
  const { code = '', message = '' } = (error ?? {}) as { code?: string; message?: string }
  const messages: Record<string, string> = {
    'auth/operation-not-allowed': 'Die anonyme Anmeldung ist in Firebase noch nicht aktiviert.',
    'auth/admin-restricted-operation': 'Die anonyme Anmeldung ist in Firebase noch nicht aktiviert.',
    'auth/invalid-api-key': 'Der Firebase-Schlüssel dieser Website ist ungültig. Bitte die Website mit der richtigen Konfiguration veröffentlichen.',
    'auth/configuration-not-found': 'Firebase Authentication ist für dieses Projekt noch nicht eingerichtet.',
    'auth/network-request-failed': 'Firebase ist gerade nicht erreichbar. Prüfe deine Internetverbindung und versuche es erneut.',
    'auth/too-many-requests': 'Zu viele Anmeldeversuche. Bitte versuche es später erneut.',
    'PERMISSION_DENIED': 'Kein Zugriff auf diesen Tisch. Bitte tritt über den Raumcode bei.',
    'permission-denied': 'Kein Zugriff auf diesen Tisch. Bitte tritt über den Raumcode bei.',
  }
  return messages[code] || message || 'Die Anfrage ist fehlgeschlagen. Bitte versuche es erneut.'
}

let signIn: Promise<User> | null = null
export async function identity(): Promise<User> {
  const services = requireFirebase()
  if (!signIn) {
    signIn = (async () => {
      await services.auth.authStateReady()
      return services.auth.currentUser ?? (await signInAnonymously(services.auth)).user
    })().finally(() => { signIn = null })
  }
  return signIn
}

export async function command<T>(name: string, payload: Record<string, any>): Promise<T> {
  const services = requireFirebase()
  const user = await identity(), actionId = crypto.randomUUID()
  if (name === 'createRoom') return await createRoom(services.db, user.uid, payload.name, actionId) as T
  if (name === 'joinRoom') return await submitRequest(services.db, user.uid, payload.code, 'joinRoom', {name: payload.name}, actionId) as T
  if (name === 'roomCommand') {
    const {roomId, ...data} = payload
    return await submitRequest(services.db, user.uid, roomId, 'roomCommand', data, actionId) as T
  }
  throw Error('Unbekannte Aktion')
}

export async function watchRoom<T>(id: string, callbacks: {
  room: (value: T | null) => void
  connection: (connected: boolean) => void
  error: (error: unknown) => void
}): Promise<() => void> {
  const services = requireFirebase()
  const user = await identity()
  let disposed = false
  let stopServing: (() => void) | undefined
  const presences = new Set<DatabaseReference>()
  const fail = (error: unknown) => {
    if (!disposed) {
      callbacks.connection(false)
      callbacks.error(error)
    }
  }
  const removePresence = async (presence: DatabaseReference) => {
    // Keep the server's disconnect handler until removal succeeds.
    await remove(presence)
    await onDisconnect(presence).cancel()
    presences.delete(presence)
  }
  const stopRoom = onValue(ref(services.db, `${ROOM_ROOT}/rooms/${id}`), snapshot => {
    if (disposed) return
    const value = snapshot.val() as RoomState | null
    if (value?.hostUid === user.uid && !stopServing) stopServing = serveRoom(services.db, user.uid, id, fail)
    callbacks.room(value as T | null)
  }, fail)
  const stopConnection = onValue(ref(services.db, '.info/connected'), async snapshot => {
    if (disposed) return
    const connected = snapshot.val() === true
    callbacks.connection(connected)
    if (!connected) return
    const presence = ref(services.db, `${ROOM_ROOT}/rooms/${id}/presence/${user.uid}/${crypto.randomUUID()}`)
    presences.add(presence)
    try {
      await onDisconnect(presence).remove()
      if (!disposed) await set(presence, true)
      if (disposed) await removePresence(presence)
    } catch (error) { fail(error) }
  }, fail)
  return () => {
    disposed = true
    stopRoom()
    stopServing?.()
    stopConnection()
    callbacks.connection(false)
    for (const presence of presences) void removePresence(presence).catch(() => {})
  }
}
