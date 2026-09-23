import {validBlindPlan, validDenominations, type BlindSettings} from './blinds'

const KEY = 'poker-chips-table-presets-v1'
export interface TablePreset {name:string;settings:BlindSettings}
export function readPresets(): TablePreset[] {
  try {
    const value:unknown = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item):item is TablePreset=>!!item && typeof item.name==='string' && item.name.length>0 && item.name.length<=30 && validSettings(item.settings)).slice(0,12)
  } catch {return []}
}
export function validSettings(s:unknown):s is BlindSettings {
  if (!s || typeof s!=='object') return false
  const v=s as BlindSettings
  return [v.stack,v.sb,v.bb].every(n=>Number.isSafeInteger(n)&&n>0&&n<=1000000000) && v.sb<v.bb && v.bb<=v.stack
    && (v.blindPlan === undefined || validBlindPlan(v.blindPlan,v))
    && (v.denominations === undefined || validDenominations(v.denominations))
}
export function writePresets(value:TablePreset[]) {
  try {localStorage.setItem(KEY,JSON.stringify(value.slice(0,12)))} catch { /* Private mode may reject storage. */ }
}
