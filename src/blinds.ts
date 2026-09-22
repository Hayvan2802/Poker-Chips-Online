export interface BlindSettings {
  stack: number
  sb: number
  bb: number
  blindMinutes?: number
  blindMultiplier?: number
}
export interface BlindClock { level: number; nextIncreaseAt: number }

// Existing rooms keep their fixed blinds until the host enables the timer.
export const blindMinutes = (settings: BlindSettings) => settings.blindMinutes ?? 0
export const blindMultiplier = (settings: BlindSettings) => settings.blindMultiplier ?? 2
export function raisedBlinds(sb: number, bb: number, multiplier: number) {
  // Integer chips and a bounded ceiling keep even long-running tables safe.
  const cap = 1000000000
  return { sb: Math.min(cap - 1, Math.ceil(sb * multiplier)), bb: Math.min(cap, Math.ceil(bb * multiplier)) }
}
export function blindCountdown(deadline: number, now: number) {
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
