import {readFileSync, writeFileSync} from 'node:fs'
const [version, ...changes] = process.argv.slice(2)
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
const releases = JSON.parse(readFileSync('releases.json', 'utf8'))
const valid = /^\d+\.\d+\.\d+$/
function compare(a, b) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i]
  return 0
}
const current = releases[0]?.version
if (pkg.version !== current || lock.version !== current || lock.packages[''].version !== current) throw Error('Vor dem Release die bestehende Versionsabweichung beheben.')
if (!valid.test(version || '') || compare(version, current) <= 0 || releases.some(item => item.version === version) || !changes.length || changes.some(x => !x.trim())) {
  throw Error('Aufruf: npm run release:prepare -- 0.0.9 "Erste Änderung" "Weitere Änderung". Die Version muss neu und höher sein.')
}
pkg.version = version
lock.version = version
lock.packages[''].version = version
const date = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date())
releases.unshift({version, date, title: 'Neues in v' + version, changes})
for (const [file, value] of [['package.json', pkg], ['package-lock.json', lock], ['releases.json', releases]]) writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
console.log('Release v' + version + ' vorbereitet. Änderungen prüfen, testen und auf main veröffentlichen.')
