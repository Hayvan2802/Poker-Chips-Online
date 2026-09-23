export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}
export const firebaseConfigured = Object.values(firebaseConfig).every(value => typeof value === 'string' && value.trim())
export const configurationError = 'Firebase ist für diese Website noch nicht eingerichtet. Die Firebase-Konfiguration muss beim Veröffentlichen hinterlegt werden.'

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
