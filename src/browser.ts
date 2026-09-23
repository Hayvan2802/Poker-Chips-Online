let fallbackSequence = 0
export function actionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return 'a' + Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('') + (++fallbackSequence).toString(36)
}

export function safeRead(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
export function safeWrite(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* Private browsing can deny storage. */ }
}

export function safeRemove(key: string): void {
  try { localStorage.removeItem(key) } catch { /* Private browsing can deny storage. */ }
}
