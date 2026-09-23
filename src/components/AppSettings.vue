<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import releases from '../../releases.json'
import {safeRead, safeWrite} from '../browser'
import {playerName, savePlayerName} from '../profile'
import {highContrast, reducedMotion, soundEnabled} from '../preferences'
import {updateState, initUpdates, dismissUpdate, installUpdate} from '../updateManager'
import {releasesSince} from '../updates'

type Section = 'darstellung' | 'ton' | 'konto' | 'daten' | ''
const route = useRoute(), router = useRouter()
const settingsOpen = ref(false), historyOpen = ref(false), whatsNewOpen = ref(false)
const canShowUpdate = computed(() => !whatsNewOpen.value && !settingsOpen.value && !historyOpen.value && !route.path.startsWith('/room/') && route.path !== '/local')
const expanded = ref<Section>('')
const seenAtOpen = ref<string | null>(null)
const current = releases[0]
const entriesSince = computed(() => releasesSince(releases, seenAtOpen.value))
function dateLabel(value: string) { return value.split('-').reverse().join('.') }
function openHistory() { historyOpen.value = true }
function closeWhatsNew() {
  safeWrite('poker-chips-seen-version', current.version)
  whatsNewOpen.value = false
}
function openSettings() { expanded.value = ''; settingsOpen.value = true }
function toggle(section: Section) { expanded.value = expanded.value === section ? '' : section }
function maybeShowWhatsNew() {
  if (!route.path.startsWith('/room/') && safeRead('poker-chips-seen-version') !== current.version) {
    seenAtOpen.value = safeRead('poker-chips-seen-version')
    whatsNewOpen.value = true
  }
}
let routerReady = false
onMounted(() => { initUpdates(); void router.isReady().then(() => { routerReady = true; maybeShowWhatsNew() }).catch(() => {}) })
watch(() => route.path, () => { if (routerReady) maybeShowWhatsNew() })
</script>

<template>
  <button class="app-settings-button" aria-label="Einstellungen öffnen" @click="openSettings"><span aria-hidden="true">⚙</span><span>Einstellungen</span></button>
  <Teleport to="body">
    <div v-if="settingsOpen" class="settings-screen" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="settings-page">
        <div class="settings-topbar"><button class="back-button" @click="settingsOpen=false" aria-label="Zurück">← <span>Zurück</span></button><span class="settings-brand">POKER CHIPS</span></div>
        <div class="settings-intro"><p>EIN GUTER ABEND BEGINNT HIER</p><h1 id="settings-title">Einstellungen</h1><span>Richte Poker Chips so ein, wie es für eure Runde passt.</span></div>
        <div class="settings-categories">
          <section class="settings-category">
            <button class="category-head" :aria-expanded="expanded==='darstellung'" @click="toggle('darstellung')"><span class="category-icon">◈</span><span><strong>Darstellung</strong><small>Lesbarkeit und Bewegung</small></span><span class="category-chevron" :class="{open:expanded==='darstellung'}">⌄</span></button>
            <div v-if="expanded==='darstellung'" class="category-body">
              <label class="setting-toggle"><span><strong>Weniger Bewegung</strong><small>Animationen am Tisch reduzieren</small></span><input v-model="reducedMotion" type="checkbox" role="switch"></label>
              <label class="setting-toggle"><span><strong>Mehr Kontrast</strong><small>Schrift und Umrandungen kräftiger anzeigen</small></span><input v-model="highContrast" type="checkbox" role="switch"></label>
            </div>
          </section>
          <section class="settings-category">
            <button class="category-head" :aria-expanded="expanded==='ton'" @click="toggle('ton')"><span class="category-icon">♫</span><span><strong>Ton</strong><small>Leise Signale für Spielereignisse</small></span><span class="category-chevron" :class="{open:expanded==='ton'}">⌄</span></button>
            <div v-if="expanded==='ton'" class="category-body"><label class="setting-toggle"><span><strong>Spielsignale</strong><small>Ein sanfter Ton, wenn du am Zug bist oder eine Hand endet</small></span><input v-model="soundEnabled" type="checkbox" role="switch"></label></div>
          </section>
          <section class="settings-category">
            <button class="category-head" :aria-expanded="expanded==='konto'" @click="toggle('konto')"><span class="category-icon">♙</span><span><strong>Konto & Name</strong><small>Dein Anzeigename auf diesem Gerät</small></span><span class="category-chevron" :class="{open:expanded==='konto'}">⌄</span></button>
            <div v-if="expanded==='konto'" class="category-body">
              <label class="settings-name">Anzeigename<input :value="playerName" maxlength="24" autocomplete="nickname" placeholder="Dein Name" @input="savePlayerName(($event.target as HTMLInputElement).value)"></label>
              <p class="setting-help">Der Name wird für neue Tische und Beitritte vorausgefüllt. Deine bestehende Firebase-Identität bleibt erhalten.</p>
            </div>
          </section>
          <section class="settings-category">
            <button class="category-head" :aria-expanded="expanded==='daten'" @click="toggle('daten')"><span class="category-icon">▤</span><span><strong>Daten & App</strong><small>Versionshinweise und Informationen</small></span><span class="category-chevron" :class="{open:expanded==='daten'}">⌄</span></button>
            <div v-if="expanded==='daten'" class="category-body">
              <button class="category-link" @click="openHistory"><span><strong>Versionshistorie</strong><small>Alle Änderungen seit dem Projektstart</small></span><span aria-hidden="true">→</span></button>
              <div class="settings-about">Poker Chips · v{{current.version}}<br>Für echte Karten und digitale Chips.</div>
            </div>
          </section>
        </div>
      </div>
    </div>
    <div v-if="historyOpen" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="history-title" @click.self="historyOpen=false">
      <div class="release-card"><button class="modal-close" aria-label="Dialog schließen" @click="historyOpen=false">×</button><div class="modal-kicker">POKER CHIPS</div><h2 id="history-title">Versionshistorie</h2><div class="release-scroll"><article v-for="release in releases" :key="release.version" class="release-entry"><div><strong>v{{release.version}}</strong><time :datetime="release.date">{{dateLabel(release.date)}}</time></div><h3>{{release.title}}</h3><ul><li v-for="change in release.changes" :key="change">{{change}}</li></ul></article></div><button class="modal-primary" @click="historyOpen=false">Schließen</button></div>
    </div>
    <div v-if="whatsNewOpen" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
      <div class="release-card"><div class="modal-kicker">NEU IN POKER CHIPS</div><h2 id="whats-new-title">Was ist neu in v{{current.version}}?</h2><div class="release-scroll"><article v-for="release in entriesSince" :key="release.version" class="release-entry"><div><strong>v{{release.version}}</strong><time :datetime="release.date">{{dateLabel(release.date)}}</time></div><h3>{{release.title}}</h3><ul><li v-for="change in release.changes" :key="change">{{change}}</li></ul></article></div><button class="modal-primary" @click="closeWhatsNew">Alles klar</button></div>
    </div>
    <div v-if="updateState.available && canShowUpdate" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="update-title" @click.self="dismissUpdate">
      <div class="release-card update-card"><div class="modal-kicker">UPDATE VERFÜGBAR</div><h2 id="update-title">v{{updateState.remoteVersion}} ist da</h2><p>Die neue Version wird erst installiert, wenn du es möchtest. Deine Räume, dein Name und deine Spieleridentität bleiben gespeichert.</p><p v-if="updateState.message" class="error" role="alert">{{updateState.message}}</p><div class="modal-actions"><button class="modal-secondary" :disabled="updateState.installing" @click="dismissUpdate">Später</button><button class="modal-primary" :disabled="updateState.installing" @click="installUpdate">{{updateState.installing ? 'Lädt …' : 'Aktualisieren & neu starten'}}</button></div></div>
    </div>
  </Teleport>
</template>
