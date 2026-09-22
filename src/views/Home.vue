<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { command, configurationError, firebaseConfigured, firebaseError } from '../firebase'

const route = useRoute(), router = useRouter()
const name = ref(localStorage.getItem('name') || '')
const code = ref(String(route.params.code || ''))
const codeMode = ref('auto'), customCode = ref('')
const busy = ref(false), error = ref(firebaseConfigured ? '' : configurationError)
const nameValid = computed(() => name.value.trim().length >= 2)
const codeValid = computed(() => /^\d{6}$/.test(code.value.trim()))
const customCodeValid = computed(() => codeMode.value === 'auto' || /^\d{6}$/.test(customCode.value.trim()))

async function go(kind: 'createRoom' | 'joinRoom') {
  if (busy.value || !firebaseConfigured || !nameValid.value || (kind === 'joinRoom' ? !codeValid.value : !customCodeValid.value)) return
  try {
    busy.value = true
    error.value = ''
    localStorage.setItem('name', name.value.trim())
    const result = await command<{ roomId: string }>(kind, { name: name.value.trim(), code: kind === 'joinRoom' ? code.value.trim() : codeMode.value === 'custom' ? customCode.value.trim() : '' })
    await router.push(`/room/${result.roomId}`)
  } catch (cause) {
    error.value = firebaseError(cause)
  } finally { busy.value = false }
}
</script>

<template>
  <section class="hero">
    <div class="eyebrow">ECHTE KARTEN · DIGITALE CHIPS</div>
    <h1>Der Pokerabend.<br><em>Ohne Chipkoffer.</em></h1>
    <p>Stacks, Einsätze und Pots für bis zu neun Personen – live auf jedem Smartphone.</p>
    <div class="join-card" :aria-busy="busy">
      <label>Dein Anzeigename<input v-model="name" minlength="2" maxlength="24" autocomplete="nickname" placeholder="z. B. Alex" :disabled="busy"></label>
      <p v-if="name && !nameValid" class="field-hint">Bitte mindestens zwei Zeichen eingeben.</p>
      <fieldset class="code-mode" :disabled="busy"><legend>Raumcode für deinen neuen Tisch</legend><label :class="{active: codeMode === 'auto'}"><input v-model="codeMode" type="radio" value="auto" name="code-mode">Automatisch</label><label :class="{active: codeMode === 'custom'}"><input v-model="codeMode" type="radio" value="custom" name="code-mode">Selbst wählen</label></fieldset>
      <label v-if="codeMode === 'custom'" class="custom-code">Dein eigener Raumcode<input v-model="customCode" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="z. B. 123456" :disabled="busy"><span>Sechs Ziffern. Der Code darf noch nicht belegt sein.</span></label>
      <button :disabled="!firebaseConfigured || !nameValid || busy || !customCodeValid" @click="go('createRoom')">{{busy ? 'Bitte warten …' : 'Neuen Tisch eröffnen'}} <b>→</b></button>
      <div class="or"><span>oder beitreten</span></div>
      <form class="join" @submit.prevent="go('joinRoom')">
        <input v-model="code" maxlength="6" inputmode="numeric" pattern="[0-9]{6}" aria-label="Sechsstelliger Raumcode" placeholder="RAUMCODE" :disabled="busy">
        <button class="secondary" :disabled="!firebaseConfigured || !nameValid || !codeValid || busy">Beitreten</button>
      </form>
      <p class="field-hint">Der Host muss den Tisch geöffnet lassen. Beim Beitreten bestätigt sein Gerät die Verbindung.</p>
      <p class="error" role="alert">{{error}}</p>
    </div>
    <div class="features"><span>◆ Keine Registrierung</span><span>◆ Sicher synchronisiert</span><span>◆ Für 2–9 Spieler</span></div>
  </section>
</template>
