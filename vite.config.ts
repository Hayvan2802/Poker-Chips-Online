import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import releases from './releases.json'
import packageInfo from './package.json'
import lockInfo from './package-lock.json'
import {packageVersion} from './shared/versioning.mjs'

const runtime = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }
const base = runtime.process?.env?.GITHUB_PAGES ? '/Poker-Chips-Online/' : '/'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const required = ['API_KEY', 'AUTH_DOMAIN', 'DATABASE_URL', 'PROJECT_ID', 'APP_ID']
  if (command === 'build') {
    const npmVersion = packageVersion(releases[0].version)
    if (packageInfo.version !== npmVersion || lockInfo.version !== npmVersion || lockInfo.packages[''].version !== npmVersion) throw Error('Release, Paket und Lockdatei müssen dieselbe Version haben.')
    const missing = required.filter(key => !(runtime.process?.env?.[`VITE_FIREBASE_${key}`] || env[`VITE_FIREBASE_${key}`])?.trim())
    if (missing.length) throw new Error(`Firebase-Konfiguration fehlt: ${missing.map(key => `VITE_FIREBASE_${key}`).join(', ')}`)
    const emulators = runtime.process?.env?.VITE_USE_EMULATORS ?? env.VITE_USE_EMULATORS
    if (mode === 'production' && emulators === 'true') throw new Error('Produktionsbuild darf keine lokalen Firebase-Emulatoren verwenden.')
  }
  return {
  base,
  build: {target: 'es2018'},
  plugins: [
    {
      name: 'release-metadata',
      generateBundle() { this.emitFile({type: 'asset', fileName: 'version.json', source: JSON.stringify({version: packageInfo.version, label: releases[0].version, date: releases[0].date, title: releases[0].title, changes: releases[0].changes})}) },
      configureServer(server) {
        server.middlewares.use((req,res,next) => {
          if (req.url?.split('?')[0] !== `${base}version.json`) return next()
          res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store'); res.end(JSON.stringify({version: packageInfo.version, label: releases[0].version, date: releases[0].date, title: releases[0].title, changes: releases[0].changes}))
        })
      },
    },
    vue(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: 'Poker Chips',
        short_name: 'Poker Chips',
        lang: 'de',
        theme_color: '#07121d',
        background_color: '#07121d',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [{ src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' }, {src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable'}],
      },
      workbox: { navigateFallback: `${base}index.html`, cacheId: `poker-chips-v${releases[0].version}`, cleanupOutdatedCaches: true, skipWaiting: false, clientsClaim: false, globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'], globIgnores: ['**/version.json'] },
    }),
  ],
  }
})
