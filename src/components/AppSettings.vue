<script setup lang="ts">
import {computed, nextTick, onMounted, onUnmounted, ref} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import {useRegisterSW} from 'virtual:pwa-register/vue'
import releases from '../../releases.json'
import {isNewerVersion, isPokerCache} from '../updates'

const current = releases[0], route = useRoute(), router = useRouter()
const settingsDialog = ref<HTMLDialogElement | null>(null), notesDialog = ref<HTMLDialogElement | null>(null)
const remoteVersion = ref(''), message = ref(''), checking = ref(false), busy = ref(false)
let registration: ServiceWorkerRegistration | undefined
let checkTimer: ReturnType<typeof setInterval> | undefined
let disposed = false
const {needRefresh, updateServiceWorker} = useRegisterSW({
  onRegisteredSW(_url, value) { registration = value; if (!disposed) void checkUpdate(false) },
  onRegisterError() { message.value = 'Die Offline-Version konnte nicht geladen werden. Du kannst die Seite weiter online verwenden.' },
})
const updateAvailable = computed(() => needRefresh.value || isNewerVersion(remoteVersion.value, current.version))
const inRoom = computed(() => route.path.startsWith('/room/'))
async function checkUpdate(manual = true) {
  if (checking.value || busy.value) return
  checking.value = true
  if (manual) message.value = ''
  try {
    if (!navigator.onLine) throw Error('Du bist offline. Bitte verbinde dich und prüfe erneut.')
    const response = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, {cache:'no-store', signal:AbortSignal.timeout(8000)})
    if (!response.ok) throw Error('Die Versionsprüfung ist gerade nicht erreichbar.')
    const data = await response.json()
    if (typeof data.version !== 'string') throw Error('Die Versionsprüfung hat keine gültige Antwort geliefert.')
    remoteVersion.value = data.version
    await registration?.update()
    if (manual) message.value = updateAvailable.value ? `Update verfügbar${remoteVersion.value ? ' · v' + remoteVersion.value : ''}.` : `Du verwendest die aktuelle Version v${current.version}.`
  } catch (error) { if (manual) message.value = error instanceof Error ? error.message : 'Update-Prüfung fehlgeschlagen. Bitte erneut versuchen.' }
  finally { checking.value = false }
}
async function installUpdate() {
  if (busy.value) return
  busy.value = true; message.value = 'Update wird geladen …'
  try {
    await registration?.update()
    if (registration?.installing) {
      await new Promise<void>((resolve,reject) => {
        const worker = registration!.installing!
        const finish = () => { if (worker.state === 'installed' || worker.state === 'activated') { clearTimeout(timer); worker.removeEventListener('statechange',finish); resolve() } }
        const timer = setTimeout(() => { worker.removeEventListener('statechange',finish); reject(Error('Das Update lädt noch. Bitte versuche es gleich erneut.')) }, 10000)
        worker.addEventListener('statechange',finish); finish()
      })
    }
    if (registration?.waiting || needRefresh.value) await updateServiceWorker(true)
    else location.reload()
  } catch (error) { message.value = error instanceof Error ? error.message : 'Aktualisierung fehlgeschlagen.'; busy.value = false }
}
async function resetCache() {
  if (busy.value) return
  busy.value = true; message.value = 'App-Dateien werden neu geladen …'
  try {
    if (!navigator.onLine) throw Error('Zum Neuladen der App-Dateien brauchst du eine Internetverbindung.')
    const response = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, {cache:'no-store', signal:AbortSignal.timeout(8000)})
    if (!response.ok) throw Error('Die Website ist nicht erreichbar. Dein Cache bleibt erhalten.')
    const scope = new URL(import.meta.env.BASE_URL, location.origin).href
    if ('caches' in window) for (const name of await caches.keys()) if (isPokerCache(name, scope)) await caches.delete(name)
    if ('serviceWorker' in navigator) for (const worker of await navigator.serviceWorker.getRegistrations()) if (worker.scope === scope) await worker.unregister()
    // Never clear localStorage or IndexedDB: Firebase keeps the host identity there.
    location.reload()
  } catch (error) { message.value = error instanceof Error ? error.message : 'App konnte nicht neu geladen werden.'; busy.value = false }
}
function closeNotes() { localStorage.setItem('poker-chips-seen-version',current.version); notesDialog.value?.close() }
const checkOnFocus = () => { if (document.visibilityState === 'visible') void checkUpdate(false) }
onMounted(async () => {
  checkTimer = setInterval(() => { if (document.visibilityState === 'visible') void checkUpdate(false) },60000)
  addEventListener('focus',checkOnFocus)
  await router.isReady()
  await nextTick()
  if (!inRoom.value && localStorage.getItem('poker-chips-seen-version') !== current.version) notesDialog.value?.showModal()
})
onUnmounted(() => { disposed = true; if (checkTimer) clearInterval(checkTimer); removeEventListener('focus',checkOnFocus) })
</script>

<template>
  <button class="app-settings-button" aria-label="Einstellungen und Version" @click="settingsDialog?.showModal()"><span aria-hidden="true">⚙</span><span>Einstellungen <small>v{{current.version}}</small></span><i v-if="updateAvailable" aria-label="Update verfügbar"></i></button>
  <Teleport to="body">
    <div v-if="updateAvailable" class="update-banner" role="status"><span>Neue Version{{remoteVersion ? ' v' + remoteVersion : ''}} verfügbar.</span><button @click="settingsDialog?.showModal()">Update ansehen</button></div>
    <dialog ref="settingsDialog" class="app-dialog" aria-labelledby="settings-title">
      <div class="app-dialog-heading"><div><small>POKER CHIPS · v{{current.version}}</small><h2 id="settings-title">Einstellungen & Updates</h2></div><button class="close-dialog" aria-label="Einstellungen schließen" @click="settingsDialog?.close()">×</button></div>
      <div class="version-status"><span class="version-icon">↻</span><div><strong>{{updateAvailable ? 'Neue Version verfügbar' : 'Deine App-Version'}}</strong><p>Installiert: v{{current.version}}<span v-if="updateAvailable && remoteVersion"> · Neu: v{{remoteVersion}}</span></p></div></div>
      <p v-if="inRoom" class="field-hint">Aktualisiere am besten zwischen zwei Händen. Als Host ist dein Tisch während des Neustarts kurz pausiert. Laufende Timer bleiben erhalten.</p>
      <button class="settings-action primary" :disabled="checking || busy" @click="updateAvailable ? installUpdate() : checkUpdate()">{{busy ? 'Bitte warten …' : checking ? 'Prüfe Version …' : updateAvailable ? 'Aktualisieren & neu starten' : 'Nach Updates suchen'}}</button>
      <p v-if="message" class="update-message" role="status">{{message}}</p>
      <button class="settings-row" @click="notesDialog?.showModal()"><span>Versionshistorie<small>Was sich mit jedem Release geändert hat</small></span><span>→</span></button>
      <a class="settings-row" href="https://github.com/Hayvan2802/Poker-Chips-Online/releases" target="_blank" rel="noopener"><span>GitHub-Releases<small>Alle veröffentlichten Versionen</small></span><span>↗</span></a>
      <details class="cache-repair"><summary>App-Dateien neu laden</summary><p>Wenn eine alte Ansicht hängen bleibt, kannst du den App-Cache leeren und neu starten. Dein Name, deine Spieleridentität und dein Zugang zum Tisch bleiben gespeichert.</p><button class="settings-action" :disabled="busy" @click="resetCache">App-Cache leeren & neu starten</button></details>
    </dialog>
    <dialog ref="notesDialog" class="app-dialog release-dialog" aria-labelledby="release-title" @cancel="closeNotes">
      <div class="app-dialog-heading"><div><small>NEU IN POKER CHIPS</small><h2 id="release-title">Versionshistorie</h2></div><button class="close-dialog" aria-label="Versionshinweise schließen" @click="closeNotes">×</button></div>
      <article v-for="release in releases" :key="release.version" class="release-entry"><div><strong>v{{release.version}}</strong><time :datetime="release.date">{{release.date.split('-').reverse().join('.')}}</time></div><h3>{{release.title}}</h3><ul><li v-for="change in release.changes" :key="change">{{change}}</li></ul></article>
      <button class="settings-action primary" @click="closeNotes">Alles klar</button>
    </dialog>
  </Teleport>
</template>
