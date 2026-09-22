import {readFileSync, writeFileSync} from 'node:fs'
const [version, ...changes] = process.argv.slice(2)
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const releases = JSON.parse(readFileSync('releases.json', 'utf8'))
const valid = /^\d+\.\d+\.\d+$/
function compare(a, b) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i]
  return 0
}
if (!valid.test(version || '') || compare(version, pkg.version) <= 0 || !changes.length || changes.some(x => !x.trim())) {
  throw Error('Aufruf: npm run release:prepare -- 0.0.2 "Erste Änderung" "Weitere Änderung". Die Version muss höher sein.')
}
pkg.version = version
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
lock.version = version; lock.packages[''].version = version
releases.unshift({version, date: new Date().toISOString().slice(0, 10), title: `Neues in v${version}`, changes})
for (const [file, value] of [['package.json',pkg], ['package-lock.json',lock], ['releases.json',releases]]) writeFileSync(file, JSON.stringify(value,null,2)+'\n')
console.log(`Release v${version} vorbereitet. Änderungen prüfen, testen und auf main veröffentlichen.`)
