import {reactive} from 'vue'
import releases from '../../releases.json'
import {isNewerVersion} from './updates'
import {displayVersion} from '../../shared/versioning.mjs'

export const updateState = reactive({
  checking: false,
  installing: false,
  available: false,
  remoteVersion: '',
  message: '',
})
let registration: ServiceWorkerRegistration | undefined
let initialized = false
let activeCheck: Promise<void> | undefined
let manualRequested = false
let dismissedVersion = ''
const CHECK_INTERVAL_MS = 15_000

export function initUpdates() {
  if (initialized) return
  initialized = true
  if ('serviceWorker' in navigator) {
    const register = () => {
      navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', {scope: import.meta.env.BASE_URL})
        .then(value => { registration = value })
        .catch(() => { /* The online app remains usable without offline caching. */ })
    }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, {once: true})
  }
  const checkWhenVisible = () => {
    if (document.visibilityState === 'visible' && navigator.onLine) void checkForUpdate(true)
  }
  checkWhenVisible()
  window.setInterval(checkWhenVisible, CHECK_INTERVAL_MS)
  document.addEventListener('visibilitychange', checkWhenVisible)
  window.addEventListener('online', checkWhenVisible)
}

async function remoteVersion(): Promise<{version: string; label: string}> {
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
    const label = displayVersion('label' in value && typeof value.label === 'string' ? value.label : value.version)
    if (!label || displayVersion(value.version) !== label) throw Error('Ungültige Versionsantwort.')
    return {version: value.version, label}
  } finally { if (timer) clearTimeout(timer) }
}

export function checkForUpdate(silent = false): Promise<void> {
  if (updateState.installing) return Promise.resolve()
  if (!silent) {
    manualRequested = true
    updateState.checking = true
    updateState.message = ''
  }
  if (activeCheck) return activeCheck
  const task = (async () => {
    try {
      if (!navigator.onLine) throw Error('Du bist offline. Bitte verbinde dich und versuche es erneut.')
      const next = await remoteVersion()
      updateState.remoteVersion = next.label
      const newer = isNewerVersion(next.version, releases[0].version)
      if (newer) {
        if ('serviceWorker' in navigator) {
          // A failed worker lookup or refresh must not hide a valid update notice.
          try {
            registration ??= await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
            if (!registration?.waiting) await registration?.update()
          } catch { /* The update can still be offered and retried later. */ }
        }
        updateState.available = manualRequested || next.label !== dismissedVersion
        updateState.message = ''
      } else {
        updateState.available = false
        if (manualRequested) updateState.message = 'Du bist auf dem neuesten Stand (v' + releases[0].version + ').'
      }
    } catch (error) {
      if (manualRequested) updateState.message = error instanceof Error && error.name !== 'AbortError' ? error.message : 'Die Versionsprüfung hat zu lange gedauert. Bitte erneut versuchen.'
    } finally {
      manualRequested = false
      updateState.checking = false
    }
  })()
  activeCheck = task.finally(() => { activeCheck = undefined })
  return activeCheck
}

export function dismissUpdate() {
  dismissedVersion = updateState.remoteVersion
  updateState.available = false
}

export async function installUpdate() {
  if (updateState.installing || !updateState.available) return
  if (location.pathname.includes('/room/') || location.pathname.endsWith('/local')) {
    updateState.message = 'Bitte kehre zuerst zum Hauptmenü zurück.'
    return
  }
  updateState.installing = true
  updateState.message = ''
  try {
    if ('serviceWorker' in navigator) {
      registration ??= await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
      if (!registration?.waiting) await registration?.update()
      const previousController = navigator.serviceWorker.controller
      // On a first visit no old worker controls the page; a normal reload is safe.
      if (registration && !registration.waiting && (!previousController || (registration.active && registration.active !== previousController))) {
        location.reload()
        return
      }
      if (registration && !registration.waiting) {
        await new Promise<void>((resolve, reject) => {
          let worker: ServiceWorker | null = null
          const cleanup = () => {
            clearTimeout(timeout)
            registration?.removeEventListener('updatefound', found)
            worker?.removeEventListener('statechange', changed)
          }
          const changed = () => {
            if (registration?.waiting) { cleanup(); resolve() }
            else if (worker?.state === 'redundant') { cleanup(); reject(Error('Das Update konnte nicht installiert werden. Bitte erneut versuchen.')) }
          }
          const found = () => {
            worker?.removeEventListener('statechange', changed)
            worker = registration?.installing || null
            worker?.addEventListener('statechange', changed)
            changed()
          }
          const timeout = window.setTimeout(() => { cleanup(); reject(Error('Das Update lädt noch. Bitte versuche es gleich erneut.')) }, 12000)
          registration?.addEventListener('updatefound', found)
          found()
        })
      }
      if (registration?.waiting) {
        let done = false
        const reload = () => { if (!done) { done = true; location.reload() } }
        navigator.serviceWorker.addEventListener('controllerchange', reload, {once: true})
        registration.waiting.postMessage({type: 'SKIP_WAITING'})
        window.setTimeout(() => {
          if (done) return
          if (navigator.serviceWorker.controller !== previousController) reload()
          else {
            navigator.serviceWorker.removeEventListener('controllerchange', reload)
            updateState.message = 'Das Update konnte noch nicht aktiviert werden. Bitte versuche es erneut.'
            updateState.installing = false
          }
        }, 5000)
        return
      }
      if (registration) throw Error('Das Update wird noch vorbereitet. Bitte versuche es gleich erneut.')
    }
    location.reload()
  } catch (error) {
    updateState.message = error instanceof Error ? error.message : 'Das Update konnte nicht geladen werden.'
    updateState.installing = false
  }
}
