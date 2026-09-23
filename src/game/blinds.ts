export interface BlindSettings {
  stack: number
  sb: number
  bb: number
  blindMinutes?: number
  blindMultiplier?: number
  ante?: number
  anteMode?: 'each'|'bb'
  blindPlan?: BlindStep[]
  buyInCents?: number
  denominations?: ChipDenomination[]
}
export type BlindStep = {kind:'level';sb:number;bb:number;minutes:number;ante?:number;anteMode?:'each'|'bb'} | {kind:'break';minutes:number}
export interface ChipDenomination {color:string;value:number}
export interface BlindClock { level: number; nextIncreaseAt: number; breakUntil?: number }

// Existing rooms keep their fixed blinds until the host enables the timer.
export const blindMinutes = (settings: BlindSettings) => settings.blindPlan?.[0]?.minutes ?? settings.blindMinutes ?? 0
export const blindMultiplier = (settings: BlindSettings) => settings.blindMultiplier ?? 2

export function validBlindPlan(value: unknown, initial: {sb:number;bb:number}): value is BlindStep[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 24 || value[0]?.kind !== 'level' || value[value.length - 1]?.kind !== 'level') return false
  if (value[0].sb !== initial.sb || value[0].bb !== initial.bb) return false
  return value.every((step, index) => {
    if (!step || typeof step !== 'object' || !Number.isSafeInteger(step.minutes) || step.minutes < 1 || step.minutes > 180) return false
    if (step.kind === 'break') return index > 0 && value[index - 1].kind === 'level' && step.minutes <= 60
    const prior = value.slice(0,index).reverse().find(candidate => candidate.kind === 'level')
    return step.kind === 'level' && Number.isSafeInteger(step.sb) && Number.isSafeInteger(step.bb) && step.sb > 0 && step.sb < step.bb && step.bb <= 1000000000 && (!prior || step.sb >= prior.sb && step.bb >= prior.bb) && Number.isSafeInteger(step.ante ?? 0) && (step.ante ?? 0) >= 0 && (step.ante ?? 0) <= step.bb && ['each','bb'].includes(step.anteMode ?? 'each')
  })
}

export function validDenominations(value: unknown): value is ChipDenomination[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 10 && value.every(chip => chip && /^#[0-9a-fA-F]{6}$/.test(chip.color) && Number.isSafeInteger(chip.value) && chip.value > 0 && chip.value <= 1000000000) && new Set(value.map(chip => chip.value)).size === value.length
}
export function raisedBlinds(sb: number, bb: number, multiplier: number) {
  // Integer chips and a bounded ceiling keep even long-running tables safe.
  const cap = 1000000000
  return { sb: Math.min(cap - 1, Math.ceil(sb * multiplier)), bb: Math.min(cap, Math.ceil(bb * multiplier)) }
}
export function blindCountdown(deadline: number, now: number) {
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
