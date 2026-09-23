import {existsSync, readFileSync} from 'node:fs'
import {displayVersion, packageVersion, releaseNumber} from '../shared/versioning.mjs'

const read = path => JSON.parse(readFileSync(path, 'utf8'))
const releases = read('releases.json')
const pkg = read('package.json')
const lock = read('package-lock.json')
const current = releases[0]?.version
if (!current || displayVersion(current) !== current) throw Error('Die aktuelle Release-Version muss 0.N heißen.')
const expectedPackage = packageVersion(current)
if (pkg.version !== expectedPackage || lock.version !== expectedPackage || lock.packages[''].version !== expectedPackage) {
  throw Error(`Release v${current} benötigt in package.json und package-lock.json die npm-Version ${expectedPackage}.`)
}
if (new Set(releases.map(item => item.version)).size !== releases.length) throw Error('Release-Version doppelt vergeben.')
for (let index = 0; index < releases.length; index++) {
  const item = releases[index]
  if (displayVersion(item.version) !== item.version || releaseNumber(item.version) !== releaseNumber(current) - index) {
    throw Error('Versionshistorie muss lückenlos von v0.1 bis zum aktuellen Release reichen.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !item.title?.trim() || !Array.isArray(item.changes) || !item.changes.length || item.changes.some(change => typeof change !== 'string' || !change.trim())) {
    throw Error(`Unvollständiger Versionshinweis für v${item.version}.`)
  }
}
if (releaseNumber(releases.at(-1)?.version) !== 1) throw Error('Die Versionshistorie muss bei v0.1 beginnen.')

if (process.argv.includes('--dist')) {
  for (const path of ['dist/index.html', 'dist/404.html', 'dist/sw.js', 'dist/version.json']) {
    if (!existsSync(path)) throw Error(`Pages-Build unvollständig: ${path}.`)
  }
  const built = read('dist/version.json')
  if (built.version !== expectedPackage || built.label !== current) throw Error('version.json hat nicht die aktuelle interne und sichtbare Version.')
  const sw = readFileSync('dist/sw.js', 'utf8')
  if (!sw.includes(`poker-chips-v${current}`)) throw Error('Service-Worker-Cache hat nicht die Release-Version.')
  for (const path of ['dist/index.html', 'dist/404.html']) {
    const html = readFileSync(path, 'utf8')
    if (!html.includes('/Poker-Chips-Online/assets/') || html.includes('src="/assets/') || html.includes('href="/assets/')) {
      throw Error(`${path}: Asset-Pfad außerhalb von GitHub Pages.`)
    }
  }
}
console.log(`Release v${current} (npm ${expectedPackage}) ist konsistent.`)
