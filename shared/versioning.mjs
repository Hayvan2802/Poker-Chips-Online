// Public releases count upward as v0.1, v0.2, ... v0.100.
// npm needs three numeric components; old installed builds used 0.0.N.
const displayPattern = /^0\.([1-9]\d*)$/
const packagePattern = /^0\.([1-9]\d*)\.0$/
const legacyPattern = /^0\.0\.([1-9]\d*)$/

export function releaseNumber(value) {
  if (typeof value !== 'string') return null
  const match = displayPattern.exec(value) || packagePattern.exec(value) || legacyPattern.exec(value)
  if (!match) return null
  const number = Number(match[1])
  return Number.isSafeInteger(number) ? number : null
}

export function displayVersion(value) {
  const number = releaseNumber(value)
  return number === null ? null : `0.${number}`
}

export function packageVersion(value) {
  if (typeof value !== 'string' || !displayPattern.test(value)) throw Error('Erwartet eine Release-Version wie 0.11.')
  return `${value}.0`
}
