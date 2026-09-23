export function isNewerVersion(candidate: string, current: string) {
  if (!/^\d+\.\d+\.\d+$/.test(candidate) || !/^\d+\.\d+\.\d+$/.test(current)) return false
  const next = candidate.split('.').map(Number), previous = current.split('.').map(Number)
  for (let i=0; i<3; i++) if (next[i] !== previous[i]) return next[i] > previous[i]
  return false
}
export function releasesSince<T extends {version: string}>(releases: T[], seen: string | null): T[] {
  return seen ? releases.filter(item => isNewerVersion(item.version, seen)) : releases.slice(0, 1)
}
