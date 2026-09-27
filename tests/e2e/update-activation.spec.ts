import {test,expect,type Page} from '@playwright/test'
import {createServer,type Server} from 'node:http'
import {readFile,readdir} from 'node:fs/promises'
import {extname,join,resolve} from 'node:path'

// Serve two immutable deployments from an isolated origin. The second has new
// lazy-chunk URLs and a new worker/app version, and removes the old asset URLs.
// This exercises actual install/wait/activate/fetch events without mocking SWs.
async function deployments() {
  const first=new Map<string,Buffer>()
  async function walk(directory:string,prefix='') {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const relative=prefix+entry.name
      if(entry.isDirectory())await walk(join(directory,entry.name),relative+'/')
      else first.set(relative,await readFile(join(directory,entry.name)))
    }
  }
  await walk(resolve('dist'))
  const current=JSON.parse(first.get('version.json')!.toString()).label as string
  const next=`0.${Number(current.split('.')[1])+1}`
  const renamed=new Map([...first.keys()].filter(name=>name.startsWith('assets/')&&/\.(js|css)$/.test(name))
    .map(name=>[name,name.replace(/\.(js|css)$/, '-next.$1')]))
  const second=new Map<string,Buffer>()
  for(const [name,bytes] of first) {
    let value=bytes
    if(/\.(js|css|html|json|webmanifest)$/.test(name)) {
      let source=bytes.toString()
      for(const [before,after] of renamed)source=source.replaceAll(before.slice(7),after.slice(7))
      source=source.replaceAll(`"${current}"`,`"${next}"`).replaceAll(`poker-chips-v${current}`,`poker-chips-v${next}`)
      if(name==='version.json')source=JSON.stringify({version:next+'.0',label:next})
      value=Buffer.from(source)
    }
    second.set(renamed.get(name)||name,value)
  }
  let release=first
  const missing:string[]=[]
  const server=createServer((request,response)=>{
    const path=new URL(request.url||'/', 'http://localhost').pathname
    const name=path.replace(/^\/Poker-Chips-Online\//,'')||'index.html'
    const found=release.get(name)
    if(!found&&name.startsWith('assets/'))missing.push(name)
    const bytes=found||release.get('404.html')!
    const types:Record<string,string>={'.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'}
    response.writeHead(found?200:404,{'content-type':types[extname(name)]||'text/html','cache-control':'no-store'})
    response.end(bytes)
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address()
  if(!address||typeof address==='string')throw Error('Missing fixture address')
  return {server,current,next,missing,url:`http://127.0.0.1:${address.port}/Poker-Chips-Online/`,deploy:()=>{release=second}}
}

async function stop(server:Server) { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())) }
async function cacheNames(page:Page) {return page.evaluate(()=>caches.keys())}
async function reportVersion(page:Page) {await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))}

test('activating an update preserves an older game tab and its offline lazy chunks until it closes',async({browser,browserName})=>{
  // Playwright's WebKit port does not implement context.setOffline for worker
  // requests reliably; the real offline activation regression runs in Chromium.
  test.skip(browserName!=='chromium','Multi-tab offline service-worker lifecycle is exercised in Chromium.')
  test.setTimeout(45000)
  const fixture=await deployments()
  const context=await browser.newContext()
  try {
    // Routing disables the HTTP cache as well, so a successful old lazy import
    // must be supplied by the retained worker cache.
    await context.route(/(firebaseio|firebasedatabase|googleapis)\.com/,route=>route.abort())
    await context.addInitScript(version=>localStorage.setItem('poker-chips-seen-version',version),fixture.current)
    const menu=await context.newPage(),game=await context.newPage()
    // Installed legacy apps did not report versions. An unknown live client
    // must retain old assets just as an explicitly older client would.
    await game.addInitScript(()=>{
      const post=ServiceWorker.prototype.postMessage
      ;(window as any).__reportLegacyVersion=(version:string)=>post.call(navigator.serviceWorker.controller!,{type:'APP_VERSION',version})
      ServiceWorker.prototype.postMessage=function(message,...args:any[]){if(message?.type!=='APP_VERSION')return post.call(this,message,...args as [])}
    })
    await menu.goto(fixture.url)
    await menu.evaluate(()=>navigator.serviceWorker.ready)
    await menu.reload()
    await expect.poll(()=>menu.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true)
    await game.goto(fixture.url+'local')
    await game.getByRole('button',{name:'Lokalen Tisch starten'}).click()
    await game.getByRole('button',{name:'Hand starten & Blinds buchen'}).click()
    await game.getByRole('button',{name:'⏸ Pausieren'}).click()
    const before=await game.evaluate(()=>localStorage.getItem('poker-chips-local-table-v1'))
    const documentToken=await game.evaluate(()=>{(window as any).__updateDocumentToken='original game';return performance.timeOrigin})
    const errors:string[]=[]
    game.on('pageerror',error=>errors.push(error.message))
    const oldName=`poker-chips-v${fixture.current}-precache-v2-${fixture.url}`
    const newName=`poker-chips-v${fixture.next}-precache-v2-${fixture.url}`
    const unrelatedName=`poker-chips-v0.1-precache-v2-${fixture.url}other/`
    await menu.evaluate(async name=>{const cache=await caches.open(name);await cache.put('sentinel',new Response('keep me'))},unrelatedName)
    // Register both tabs with the old worker. The intercepted legacy tab will
    // then remain unknown to the new worker after activation.
    await game.evaluate(version=>(window as any).__reportLegacyVersion(version),fixture.current)

    fixture.deploy()
    await menu.getByRole('button',{name:'Nach einer neuen Version suchen'}).click()
    await expect.poll(()=>menu.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true)
    // The old active worker receives reports while the new worker is waiting.
    // It must not delete that future worker's already-populated precache.
    await reportVersion(menu)
    await expect.poll(()=>menu.evaluate(async name=>(await (await caches.open(name)).keys()).length,newName)).toBeGreaterThan(0)
    await menu.getByRole('button',{name:'Aktualisieren & neu starten'}).click()
    await expect(menu.getByRole('button',{name:'Nach einer neuen Version suchen'})).toContainText('v'+fixture.next)
    await expect(menu.getByRole('heading',{name:`Was ist neu in v${fixture.next}?`})).toBeVisible()
    await menu.getByRole('button',{name:'Alles klar'}).click()
    await reportVersion(menu)
    await expect.poll(()=>cacheNames(menu)).toContain(oldName)
    await expect.poll(()=>menu.evaluate(async name=>(await (await caches.open(name)).keys()).length,newName)).toBeGreaterThan(0)
    expect(await game.evaluate(()=>({token:(window as any).__updateDocumentToken,time:performance.timeOrigin}))).toEqual({token:'original game',time:documentToken})
    expect(await game.evaluate(()=>localStorage.getItem('poker-chips-local-table-v1'))).toBe(before)
    await expect(game.getByRole('button',{name:'Fortsetzen'})).toBeVisible()
    await expect(game.getByRole('dialog',{name:/ist da/})).toHaveCount(0)

    const oldHomeResponses:string[]=[]
    game.on('response',response=>{if(/\/Home-[^/]+\.js$/.test(response.url())&&response.fromServiceWorker())oldHomeResponses.push(response.url())})
    await context.setOffline(true)
    await game.getByRole('link',{name:'Zur Startseite'}).click()
    await expect(game.getByRole('heading',{name:/Der Pokerabend/})).toBeVisible()
    expect(oldHomeResponses.some(url=>!url.endsWith('-next.js'))).toBe(true)
    expect(errors).toEqual([])
    expect(fixture.missing).toEqual([])
    expect(await game.evaluate(()=>localStorage.getItem('poker-chips-local-table-v1'))).toBe(before)
    expect(await cacheNames(menu)).toContain(oldName)

    await game.close()
    await reportVersion(menu)
    await expect.poll(()=>cacheNames(menu)).not.toContain(oldName)
    expect(await cacheNames(menu)).toEqual(expect.arrayContaining([newName,unrelatedName]))
    await menu.getByRole('link',{name:/Ohne Internet auf einem Gerät spielen/}).click()
    await expect(menu.getByRole('button',{name:'Fortsetzen'})).toBeVisible()
    expect(await menu.evaluate(()=>localStorage.getItem('poker-chips-local-table-v1'))).toBe(before)
  } finally {await context.close();await stop(fixture.server)}
})
