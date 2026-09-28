import {setCacheNameDetails} from 'workbox-core'
import {createHandlerBoundToURL,precacheAndRoute} from 'workbox-precaching'
import {NavigationRoute,registerRoute} from 'workbox-routing'
import {isOlderPrecache,precacheRelease} from './updates/cacheSafety'

declare const self: ServiceWorkerGlobalScope & {__WB_MANIFEST: Array<{url:string;revision:string|null}>}
declare const __POKER_CACHE_PREFIX__: string
declare const __POKER_VERSION__: string

setCacheNameDetails({prefix:__POKER_CACHE_PREFIX__})
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

const scope = self.registration.scope
const assetPath = new URL('assets/', scope).pathname
const reportedVersions = new Map<string,string>()
const ownPrecache = (name:string) => precacheRelease(name,scope) !== null

// Old tabs can still import lazy chunks from before deployment. Only immutable,
// same-origin assets may fall back to this app's retained, scope-specific caches.
registerRoute(({url}) => url.origin === self.location.origin && url.pathname.startsWith(assetPath)
  && /-[\w-]+\.(?:js|css)$/.test(url.pathname), async ({request}) => {
  for (const name of (await caches.keys()).filter(ownPrecache)) {
    const cached = await (await caches.open(name)).match(request, {ignoreSearch:true})
    if (cached) return cached
  }
  return fetch(request)
})

async function cleanupUnusedVersions() {
  const clients = (await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(client => client.url.startsWith(scope))
  // Legacy clients cannot report a version. Unknown clients and worker restarts
  // therefore keep caches; they never authorize cleanup just by being idle.
  if (!clients.length || clients.some(client => reportedVersions.get(client.id) !== __POKER_VERSION__)) return
  for (const name of (await caches.keys()).filter(name => isOlderPrecache(name,scope,__POKER_VERSION__))) {
    await caches.delete(name)
  }
  const live = new Set(clients.map(client => client.id))
  for (const id of reportedVersions.keys()) if (!live.has(id)) reportedVersions.delete(id)
}

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting())
    return
  }
  if (event.data?.type !== 'APP_VERSION' || typeof event.data.version !== 'string') return
  const client = event.source
  if (!client || !('id' in client) || !('url' in client) || !client.url.startsWith(scope)) return
  reportedVersions.set(client.id,event.data.version)
  event.waitUntil(cleanupUnusedVersions())
})
