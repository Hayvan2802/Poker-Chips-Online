import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

const runtime = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }
const base = runtime.process?.env?.GITHUB_PAGES ? '/Poker-Chips-Online/' : '/'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const required = ['API_KEY', 'AUTH_DOMAIN', 'DATABASE_URL', 'PROJECT_ID', 'APP_ID']
  if (command === 'build') {
    const missing = required.filter(key => !(runtime.process?.env?.[`VITE_FIREBASE_${key}`] || env[`VITE_FIREBASE_${key}`])?.trim())
    if (missing.length) throw new Error(`Firebase-Konfiguration fehlt: ${missing.map(key => `VITE_FIREBASE_${key}`).join(', ')}`)
    const emulators = runtime.process?.env?.VITE_USE_EMULATORS ?? env.VITE_USE_EMULATORS
    if (mode === 'production' && emulators === 'true') throw new Error('Produktionsbuild darf keine lokalen Firebase-Emulatoren verwenden.')
  }
  return {
  base,
  plugins: [
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
      workbox: { navigateFallback: `${base}index.html` },
    }),
  ],
  }
})
