import {defineConfig, devices} from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 20000,
  use: {baseURL: 'http://127.0.0.1:4173/Poker-Chips-Online/', trace: 'retain-on-failure'},
  projects: [
    {name: 'chromium', use: {...devices['Desktop Chrome']}},
    {name: 'webkit', use: {...devices['Desktop Safari']}},
    {name: 'iphone-webkit', use: {...devices['iPhone 13'], browserName: 'webkit'}},
  ],
  webServer: {
    command: 'node scripts/serve-pages.mjs',
    url: 'http://127.0.0.1:4173/Poker-Chips-Online/',
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
  },
})
