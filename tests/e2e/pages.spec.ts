import {test, expect} from '@playwright/test'

async function closeWhatsNew(page: import('@playwright/test').Page) {
  const button = page.getByRole('button', {name: 'Alles klar'})
  await expect(button).toBeVisible()
  await button.click()
}

test('start page, reload, version and mobile settings work from the Pages build', async ({page}, testInfo) => {
  const response = await page.goto('./')
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', {name: /Der Pokerabend/})).toBeVisible()
  await expect(page.getByRole('heading', {name: 'Was ist neu in v0.0.8?'})).toBeVisible()
  await closeWhatsNew(page)
  await expect(page.getByRole('button', {name: 'Nach einer neuen Version suchen'})).toContainText('v0.0.8')
  if (testInfo.project.name === 'iphone-webkit') await page.screenshot({path: testInfo.outputPath('home-iphone.png'), fullPage: true})
  await page.getByRole('button', {name: 'Einstellungen öffnen'}).click()
  await expect(page.getByRole('heading', {name: 'Einstellungen'})).toBeVisible()
  if (testInfo.project.name === 'iphone-webkit') await page.screenshot({path: testInfo.outputPath('settings-home-iphone.png')})
  await page.getByRole('button', {name: /Darstellung/}).click()
  await expect(page.getByRole('switch', {name: /Weniger Bewegung/})).toBeVisible()
  await page.getByRole('button', {name: /Daten & App/}).click()
  await page.getByRole('button', {name: /Versionshistorie/}).click()
  await expect(page.getByRole('heading', {name: 'Versionshistorie'})).toBeVisible()
  await expect(page.locator('.release-scroll')).toContainText('v0.0.1')
  if (testInfo.project.name === 'iphone-webkit') await page.screenshot({path: testInfo.outputPath('settings-iphone.png')})
  await page.getByRole('button', {name: 'Schließen', exact: true}).click()
  await page.getByRole('button', {name: /Zurück/}).click()
  await page.reload()
  await expect(page.getByRole('heading', {name: /Der Pokerabend/})).toBeVisible()
  await expect(page.getByRole('heading', {name: 'Was ist neu in v0.0.8?'})).toHaveCount(0)
  await expect(page.locator('#boot-error')).toHaveCount(0)
})

test('saved names and skipped release notes survive reloads', async ({page}) => {
  await page.goto('./')
  await closeWhatsNew(page)
  await page.getByPlaceholder('z. B. Alex').fill('Hakan2802')
  await page.reload()
  await expect(page.getByPlaceholder('z. B. Alex')).toHaveValue('Hakan2802')
  await page.evaluate(() => localStorage.setItem('poker-chips-seen-version', '0.0.5'))
  await page.reload()
  const notes = page.getByRole('dialog', {name: /Was ist neu/})
  await expect(notes).toContainText('v0.0.8')
  await expect(notes).toContainText('v0.0.7')
  await expect(notes).toContainText('v0.0.6')
  await expect(notes).not.toContainText('v0.0.5')
})

test('manual version check works without AbortSignal.timeout and no background poll', async ({page}) => {
  let checks = 0
  await page.route('**/version.json?*', async route => { checks++; await route.continue() })
  await page.addInitScript(() => { try { Object.defineProperty(AbortSignal, 'timeout', {value: undefined}) } catch {} })
  await page.goto('./')
  await closeWhatsNew(page)
  await expect(page.getByRole('heading', {name: /Der Pokerabend/})).toBeVisible()
  expect(checks).toBe(0)
  await page.getByRole('button', {name: 'Nach einer neuen Version suchen'}).click()
  await expect(page.getByRole('status')).toContainText('Du bist auf dem neuesten Stand (v0.0.8).')
  expect(checks).toBe(1)
})

test('new version is offered only after a tap and can be postponed without reload', async ({page}) => {
  await page.route('**/version.json?*', route => route.fulfill({json: {version: '0.0.9'}}))
  await page.goto('./')
  await closeWhatsNew(page)
  const original = page.url()
  await page.getByRole('button', {name: 'Nach einer neuen Version suchen'}).click()
  await expect(page.getByRole('dialog', {name: /v0.0.9 ist da/})).toBeVisible()
  await page.getByRole('button', {name: 'Später'}).click()
  await expect(page.getByRole('dialog', {name: /v0.0.9 ist da/})).toHaveCount(0)
  expect(page.url()).toBe(original)
})

test('manifest, worker and offline shell stay inside the GitHub Pages scope', async ({page, context}, testInfo) => {
  await page.goto('./')
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!
    return await (await fetch(link.href)).json()
  })
  expect(manifest.start_url).toBe('/Poker-Chips-Online/')
  expect(manifest.scope).toBe('/Poker-Chips-Online/')
  expect(manifest.icons.every((icon: {src: string}) => icon.src.startsWith('/Poker-Chips-Online/'))).toBe(true)
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope || ''), {timeout: 10000}).toContain('/Poker-Chips-Online/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  const cachedShell = await page.evaluate(async () => {
    const cache = await caches.open((await caches.keys()).find(name => name.includes('poker-chips-v0.0.8-precache')) || '')
    const page = await cache.match(new URL('index.html', location.href), {ignoreSearch: true})
    return page?.text()
  })
  expect(cachedShell).toContain('<div id="app"')
  if (testInfo.project.name === 'chromium') {
    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('heading', {name: /Der Pokerabend/})).toBeVisible()
  }
})
test('deep room link uses the Pages 404 shell instead of a blank page', async ({page}) => {
  await page.route(/(firebaseio|firebasedatabase|googleapis)\.com/, route => route.abort())
  const response = await page.goto('room/000000')
  expect(response?.status()).toBe(404)
  await expect(page.locator('html')).toHaveAttribute('data-app-mounted', '1')
  await expect(page.locator('#app')).toContainText(/Verbindung zum Tisch|Firebase|nicht erreichbar|Tisch/)
  await expect(page.locator('#boot-error')).toHaveCount(0)
})

test('storage denied on Safari still renders the home screen', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {get() { throw Error('storage denied') }})
  })
  await page.goto('./')
  await expect(page.getByRole('heading', {name: /Der Pokerabend/})).toBeVisible()
  await expect(page.locator('#boot-error')).toHaveCount(0)
})

test('one-device table works offline and survives reload', async ({page,context},testInfo) => {
  await page.goto('./')
  await closeWhatsNew(page)
  await page.getByRole('link',{name:/Ohne Internet auf einem Gerät spielen/}).click()
  await expect(page.getByRole('heading',{name:'Ein Gerät, ein Tisch.'})).toBeVisible()
  await page.getByRole('button',{name:'Lokalen Tisch starten'}).click()
  await expect(page.getByText('Hand 1',{exact:false})).toBeVisible()
  if(testInfo.project.name==='iphone-webkit')await page.screenshot({path:testInfo.outputPath('local-table-iphone.png'),fullPage:true})
  await page.getByRole('button',{name:'Hand starten & Blinds buchen'}).click()
  await page.getByRole('button',{name:'Passen'}).click()
  await page.getByRole('button',{name:'Gewinn auszahlen'}).click()
  await expect(page.getByRole('heading',{name:'Hand beendet'})).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading',{name:'Hand beendet'})).toBeVisible()
  await page.evaluate(()=>navigator.serviceWorker.ready)
  await page.reload()
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true)
  if (context.browser()?.browserType().name()==='chromium') {
    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('heading',{name:'Hand beendet'})).toBeVisible()
  }
})

test('display deep link renders a controlled status instead of a blank page', async ({page}) => {
  await page.route(/(firebaseio|firebasedatabase|googleapis)\.com/,route=>route.abort())
  const response=await page.goto('room/000000/display')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading',{name:'Live am Tisch'})).toBeVisible()
  await expect(page.locator('#boot-error')).toHaveCount(0)
})
