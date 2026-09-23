import {releaseNumber} from '../../shared/versioning.mjs'

export function isNewerVersion(candidate: string, current: string) {
  const next = releaseNumber(candidate), previous = releaseNumber(current)
  return next !== null && previous !== null && next > previous
}
export function releasesSince<T extends {version: string}>(releases: T[], seen: string | null): T[] {
  return seen ? releases.filter(item => isNewerVersion(item.version, seen)) : releases.slice(0, 1)
}
