import {readFileSync, writeFileSync} from 'node:fs'
import {displayVersion, packageVersion, releaseNumber} from '../shared/versioning.mjs'

const [version, ...changes] = process.argv.slice(2)
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
const releases = JSON.parse(readFileSync('releases.json', 'utf8'))
const current = releases[0]?.version
const currentNumber = releaseNumber(current)
if (currentNumber === null || displayVersion(current) !== current || releaseNumber(pkg.version) !== currentNumber || lock.version !== pkg.version || lock.packages[''].version !== pkg.version) {
  throw Error('Vor dem Release die bestehende Versionsabweichung beheben.')
}
const expectedNext = `0.${currentNumber + 1}`
if (version !== expectedNext || !changes.length || changes.some(change => !change.trim())) {
  throw Error(`Aufruf: npm run release:prepare -- ${expectedNext} "Änderung für Spieler" "Weitere Änderung". Nur der nächste Zähler ist erlaubt.`)
}

const npmVersion = packageVersion(version)
pkg.version = npmVersion
lock.version = npmVersion
lock.packages[''].version = npmVersion
const date = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date())
releases.unshift({version, date, title: `Neues in v${version}`, changes})
for (const [file, value] of [['package.json', pkg], ['package-lock.json', lock], ['releases.json', releases]]) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}
console.log(`Release v${version} vorbereitet (npm ${npmVersion}). Änderungen prüfen, testen und über einen PR veröffentlichen.`)
