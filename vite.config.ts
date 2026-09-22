import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import releases from './releases.json'
import packageInfo from './package.json'

const runtime = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }
const base = runtime.process?.env?.GITHUB_PAGES ? '/Poker-Chips-Online/' : '/'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const required = ['API_KEY', 'AUTH_DOMAIN', 'DATABASE_URL', 'PROJECT_ID', 'APP_ID']
  if (command === 'build') {
    if (packageInfo.version !== releases[0].version) throw Error('Paketversion und neuester Release müssen übereinstimmen.')
    const missing = required.filter(key => !(runtime.process?.env?.[`VITE_FIREBASE_${key}`] || env[`VITE_FIREBASE_${key}`])?.trim())
    if (missing.length) throw new Error(`Firebase-Konfiguration fehlt: ${missing.map(key => `VITE_FIREBASE_${key}`).join(', ')}`)
    const emulators = runtime.process?.env?.VITE_USE_EMULATORS ?? env.VITE_USE_EMULATORS
    if (mode === 'production' && emulators === 'true') throw new Error('Produktionsbuild darf keine lokalen Firebase-Emulatoren verwenden.')
  }
  return {
  base,
  plugins: [
    {
      name: 'release-metadata',
      generateBundle() { this.emitFile({type: 'asset', fileName: 'version.json', source: JSON.stringify(releases[0])}) },
      configureServer(server) {
        server.middlewares.use((req,res,next) => {
          if (req.url?.split('?')[0] !== `${base}version.json`) return next()
          res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store'); res.end(JSON.stringify(releases[0]))
        })
      },
    },
    vue(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Poker Chips',
        short_name: 'Poker Chips',
        theme_color: '#07121d',
        background_color: '#07121d',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [{ src: `${base}icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { navigateFallback: `${base}index.html`, cacheId: 'poker-chips', cleanupOutdatedCaches: true, globIgnores: ['**/version.json'] },
    }),
  ],
  }
})
