import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({ plugins: [vue(), VitePWA({ registerType: 'prompt', manifest: { name: 'Poker Chips', short_name: 'Poker Chips', theme_color: '#07121d', background_color: '#07121d', display: 'standalone', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] }, workbox: { navigateFallback: '/index.html' } })] })
