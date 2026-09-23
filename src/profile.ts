import {ref} from 'vue'
import {safeRead, safeRemove, safeWrite} from './browser'

// Keep the original key: existing players and Firebase identities stay untouched.
export const playerName = ref(safeRead('name') || safeRead('poker-chips-name') || '')

export function savePlayerName(value: string) {
  playerName.value = value
  if (value.trim()) safeWrite('name', value.trim())
  else { safeRemove('name'); safeRemove('poker-chips-name') }
}
