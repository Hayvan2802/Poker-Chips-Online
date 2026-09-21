import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

const runtime = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }
const base = runtime.process?.env?.GITHUB_PAGES ? '/Poker-Chips-Online/' : '/'

export default defineConfig({
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
})
