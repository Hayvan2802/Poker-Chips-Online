<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {configurationError, firebaseConfigured, firebaseError} from '../online/firebaseConfig'
import {playerName, savePlayerName} from '../device/profile'
import {updateState, checkForUpdate} from '../updates/updateManager'
import {forgetRecentRoom, readRecentRoom, rememberRoom} from '../device/recentRoom'
import releases from '../../releases.json'

const route = useRoute(), router = useRouter()
const name = playerName
const code = ref(String(route.params.code || ''))
const codeMode = ref('auto'), customCode = ref('')
const busy = ref(false), error = ref(firebaseConfigured ? '' : configurationError)
const recentRoom = ref(readRecentRoom())
const nameValid = computed(() => name.value.trim().length >= 2)
const codeValid = computed(() => /^\d{6}$/.test(code.value.trim()))
const customCodeValid = computed(() => codeMode.value === 'auto' || /^\d{6}$/.test(customCode.value.trim()))

async function go(kind: 'createRoom' | 'joinRoom') {
  if (busy.value || !firebaseConfigured || !nameValid.value || (kind === 'joinRoom' ? !codeValid.value : !customCodeValid.value)) return
  try {
    busy.value = true
    error.value = ''
    savePlayerName(name.value)
    const {command} = await import('../online/firebase')
    const result = await command<{ roomId: string }>(kind, { name: name.value.trim(), code: kind === 'joinRoom' ? code.value.trim() : codeMode.value === 'custom' ? customCode.value.trim() : '' })
    rememberRoom(result.roomId)
    recentRoom.value = result.roomId
    await router.push(`/room/${result.roomId}`)
  } catch (cause) {
    error.value = firebaseError(cause)
  } finally { busy.value = false }
}
function forgetRoom() { forgetRecentRoom(); recentRoom.value = '' }
</script>

<template>
  <section class="hero">
    <div class="eyebrow">ECHTE KARTEN · DIGITALE CHIPS</div>
    <h1>Der Pokerabend.<br><em>Ohne Chipkoffer.</em></h1>
    <p>Stacks, Einsätze und Pots für bis zu neun Personen – live auf jedem Smartphone.</p>
    <div class="join-card" :aria-busy="busy">
      <label>Dein Anzeigename<input v-model="name" @input="savePlayerName(($event.target as HTMLInputElement).value)" minlength="2" maxlength="24" autocomplete="nickname" placeholder="z. B. Alex" :disabled="busy"></label>
      <p v-if="name && !nameValid" class="field-hint">Bitte mindestens zwei Zeichen eingeben.</p>
      <fieldset class="code-mode" :disabled="busy"><legend>Raumcode für deinen neuen Tisch</legend><label :class="{active: codeMode === 'auto'}"><input v-model="codeMode" type="radio" value="auto" name="code-mode">Automatisch</label><label :class="{active: codeMode === 'custom'}"><input v-model="codeMode" type="radio" value="custom" name="code-mode">Selbst wählen</label></fieldset>
      <label v-if="codeMode === 'custom'" class="custom-code">Dein eigener Raumcode<input v-model="customCode" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="z. B. 123456" :disabled="busy"><span>Ein eigener bestehender Tisch wird fortgesetzt. Fremde Codes bleiben belegt.</span></label>
      <button :disabled="!firebaseConfigured || !nameValid || busy || !customCodeValid" @click="go('createRoom')">{{busy ? 'Bitte warten …' : 'Neuen Tisch eröffnen'}} <b>→</b></button>
      <div class="or"><span>oder beitreten</span></div>
      <form class="join" @submit.prevent="go('joinRoom')">
        <input v-model="code" maxlength="6" inputmode="numeric" pattern="[0-9]{6}" aria-label="Sechsstelliger Raumcode" placeholder="RAUMCODE" :disabled="busy">
        <button class="secondary" :disabled="!firebaseConfigured || !nameValid || !codeValid || busy">Beitreten</button>
      </form>
      <p class="field-hint">Der Host muss den Tisch geöffnet lassen. Beim Beitreten bestätigt sein Gerät die Verbindung.</p>
      <p class="error" role="alert">{{error}}</p>
    </div>
    <div v-if="recentRoom" class="recent-room-card">
      <div><small>ZULETZT BESUCHT</small><strong>Tisch {{recentRoom}}</strong><span>Dein Tisch bleibt auch nach dem Zurückgehen gespeichert.</span></div>
      <router-link :to="`/room/${recentRoom}`">Tisch fortsetzen →</router-link>
      <button type="button" class="recent-room-forget" aria-label="Tisch-Verknüpfung entfernen" @click="forgetRoom">Verknüpfung entfernen</button>
    </div>
    <div class="features"><span>◆ Keine Registrierung</span><span>◆ Sicher synchronisiert</span><span>◆ Für 2–9 Spieler</span></div>
    <router-link to="/local" class="local-entry">Ohne Internet auf einem Gerät spielen →</router-link>
    <div class="home-version-wrap"><button class="home-version" :disabled="updateState.checking" @click="checkForUpdate()" aria-label="Nach einer neuen Version suchen">v{{releases[0].version}} <span v-if="updateState.checking" class="refresh-spin" aria-hidden="true">↻</span></button><p v-if="updateState.message" class="version-message" role="status">{{updateState.message}}</p></div>
  </section>
</template>
