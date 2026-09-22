import {spawnSync} from 'node:child_process'
import {copyFileSync} from 'node:fs'

for (const [script, args] of [
  ['node_modules/vue-tsc/bin/vue-tsc.js', ['--noEmit']],
  ['node_modules/vite/bin/vite.js', ['build']],
]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: 'inherit',
    env: {...process.env, GITHUB_PAGES: 'true', VITE_USE_EMULATORS: 'false'},
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
copyFileSync('dist/index.html', 'dist/404.html')
