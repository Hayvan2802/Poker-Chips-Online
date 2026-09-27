import {releaseNumber} from '../../shared/versioning.mjs'

// Match the complete Workbox cache name and registration scope. Other apps and
// differently scoped copies of Poker Chips must never supply or lose assets.
export function precacheRelease(name: string, scope: string): number | null {
  const suffix = '-precache-v2-' + scope
  if (!name.startsWith('poker-chips-v') || !name.endsWith(suffix)) return null
  return releaseNumber(name.slice('poker-chips-v'.length, -suffix.length))
}

export function isOlderPrecache(name: string, scope: string, version: string): boolean {
  const cached = precacheRelease(name, scope), current = releaseNumber(version)
  // An installing or waiting future worker already owns a cache. The active
  // worker must leave it intact while its own clients still report the old app.
  return cached !== null && current !== null && cached < current
}
