import {reactive} from 'vue'
import releases from '../releases.json'
import {isNewerVersion} from './updates'

export const updateState = reactive({
  checking: false,
  installing: false,
  available: false,
  remoteVersion: '',
  message: '',
})
let registration: ServiceWorkerRegistration | undefined
let initialized = false

export function initUpdates() {
  if (initialized) return
  initialized = true
  if (!('serviceWorker' in navigator)) return
  const register = () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', {scope: import.meta.env.BASE_URL})
      .then(value => { registration = value })
      .catch(() => { /* The online app remains usable without offline caching. */ })
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, {once: true})
}

async function remoteVersion(): Promise<string> {
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined
  const timer = controller ? window.setTimeout(() => controller.abort(), 8000) : undefined
  try {
    const response = await fetch(import.meta.env.BASE_URL + 'version.json?t=' + Date.now(), {
      cache: 'no-store',
      ...(controller ? {signal: controller.signal} : {}),
    })
    if (!response.ok) throw Error('Die Versionsprüfung ist gerade nicht erreichbar.')
    const value: unknown = await response.json()
    if (!value || typeof value !== 'object' || !('version' in value) || typeof value.version !== 'string') throw Error('Ungültige Versionsantwort.')
    return value.version
  } finally { if (timer) clearTimeout(timer) }
}

export async function checkForUpdate() {
  if (updateState.checking || updateState.installing) return
  updateState.checking = true
  updateState.message = ''
  try {
    if (!navigator.onLine) throw Error('Du bist offline. Bitte verbinde dich und versuche es erneut.')
    const next = await remoteVersion()
    updateState.remoteVersion = next
    if (registration) await registration.update()
    else if ('serviceWorker' in navigator) registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
    updateState.available = isNewerVersion(next, releases[0].version)
    if (!updateState.available) updateState.message = 'Du bist auf dem neuesten Stand (v' + releases[0].version + ').'
  } catch (error) {
    updateState.message = error instanceof Error && error.name !== 'AbortError' ? error.message : 'Die Versionsprüfung hat zu lange gedauert. Bitte erneut versuchen.'
  } finally { updateState.checking = false }
}

export function dismissUpdate() { updateState.available = false }

export async function installUpdate() {
  if (updateState.installing || !updateState.available) return
  if (location.pathname.includes('/room/')) {
    updateState.message = 'Bitte beende zuerst die laufende Hand.'
    return
  }
  updateState.installing = true
  try {
    if ('serviceWorker' in navigator) {
      registration ??= await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
      await registration?.update()
      if (registration?.installing) {
        await new Promise<void>((resolve, reject) => {
          const worker = registration!.installing!
          const timeout = window.setTimeout(() => reject(Error('Das Update lädt noch. Bitte versuche es gleich erneut.')), 12000)
          const changed = () => {
            if (worker.state === 'installed' || worker.state === 'activated') {
              clearTimeout(timeout); worker.removeEventListener('statechange', changed); resolve()
            }
          }
          worker.addEventListener('statechange', changed)
          changed()
        })
      }
      if (registration?.waiting) {
        let done = false
        const reload = () => { if (!done) { done = true; location.reload() } }
        navigator.serviceWorker.addEventListener('controllerchange', reload, {once: true})
        registration.waiting.postMessage({type: 'SKIP_WAITING'})
        window.setTimeout(reload, 4000)
        return
      }
    }
    location.reload()
  } catch (error) {
    updateState.message = error instanceof Error ? error.message : 'Das Update konnte nicht geladen werden.'
    updateState.installing = false
  }
}
