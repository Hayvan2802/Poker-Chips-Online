import {safeRead, safeRemove, safeWrite} from './browser'

const KEY = 'poker-chips-last-room'

export function readRecentRoom(): string {
  const code = safeRead(KEY) || ''
  return /^\d{6}$/.test(code) ? code : ''
}

export function rememberRoom(code: string): void {
  if (/^\d{6}$/.test(code)) safeWrite(KEY, code)
}

export function forgetRecentRoom(): void {
  safeRemove(KEY)
}
