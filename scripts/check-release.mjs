import {readFileSync} from 'node:fs'
import {existsSync} from 'node:fs'
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const releases = read('releases.json')
const pkg = read('package.json')
const lock = read('package-lock.json')
const version = releases[0]?.version
if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw Error('Ungültige Release-Version.')
if (pkg.version !== version || lock.version !== version || lock.packages[''].version !== version) throw Error('Release, package.json und package-lock.json haben verschiedene Versionen.')
if (new Set(releases.map(item => item.version)).size !== releases.length) throw Error('Release-Version doppelt vergeben.')
for (let i = 0; i < releases.length; i++) {
  const item = releases[i]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !item.title?.trim() || !Array.isArray(item.changes) || !item.changes.length) throw Error('Unvollständiger Versionshinweis.')
  if (i && Number(releases[i-1].version.split('.')[2]) !== Number(item.version.split('.')[2]) + 1) throw Error('Versionshistorie ist nicht lückenlos absteigend.')
}
if (process.argv.includes('--dist')) {
  if (!existsSync('dist/index.html') || !existsSync('dist/404.html') || !existsSync('dist/sw.js')) throw Error('Pages-Build unvollständig.')
  const built = read('dist/version.json')
  if (built.version !== version) throw Error('version.json hat nicht die Release-Version.')
  const sw = readFileSync('dist/sw.js','utf8')
  if (!sw.includes('poker-chips-v' + version)) throw Error('Service-Worker-Cache hat nicht die Release-Version.')
  for (const path of ['dist/index.html','dist/404.html']) {
    const html = readFileSync(path,'utf8')
    if (!html.includes('/Poker-Chips-Online/assets/') || html.includes('src="/assets/') || html.includes('href="/assets/')) throw Error(path + ': Asset-Pfad außerhalb von GitHub Pages.')
  }
}
console.log('Release v' + version + ' ist konsistent.')
