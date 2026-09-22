<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { auth, command, firebaseError, watchRoom } from '../firebase'
import { buildPots, type Game, type Move, type Phase } from '../engine'

interface Member { uid: string; name: string; host: boolean; ready: boolean; seat?: number | null }
interface Room {
  code: string
  name: string
  status: 'lobby' | 'playing'
  version: number
  hostUid: string
  settings: { stack: number; sb: number; bb: number }
  members: Record<string, Member>
  presence?: Record<string, Record<string, boolean>>
  game?: Game
}
const id = String(useRoute().params.id)
const room = ref<Room | null>(null), uid = ref(''), error = ref(''), copied = ref(false)
const browserOnline = ref(navigator.onLine), connected = ref(false), pending = ref(false)
let disposed = false, stopRoom: (() => void) | undefined
let copyTimer: ReturnType<typeof setTimeout> | undefined
const updateOnline = () => { browserOnline.value = navigator.onLine }
onMounted(async () => {
  addEventListener('online', updateOnline)
  addEventListener('offline', updateOnline)
  try {
    const stop = await watchRoom<Room>(id, {
      room: value => {
        room.value = value
        uid.value = auth?.currentUser?.uid || ''
        if (!value) error.value = 'Dieser Tisch existiert nicht mehr.'
      },
      connection: value => { connected.value = value },
      error: cause => { error.value = firebaseError(cause) },
    })
    if (disposed) stop()
    else stopRoom = stop
  } catch (cause) { error.value = firebaseError(cause) }
})
onUnmounted(() => {
  disposed = true
  stopRoom?.()
  removeEventListener('online', updateOnline)
  removeEventListener('offline', updateOnline)
  if (copyTimer) clearTimeout(copyTimer)
})

const online = computed(() => browserOnline.value && connected.value)
const hostOnline = computed(() => !!room.value && (room.value.hostUid === uid.value || present(room.value.hostUid)))
const locked = computed(() => !online.value || !hostOnline.value || pending.value)
const members = computed(() => Object.values(room.value?.members || {}))
const me = computed(() => room.value?.members[uid.value])
const game = computed(() => room.value?.game)
const players = computed(() => Object.values(game.value?.players || {}).sort((a, b) => a.seat - b.seat))
const player = computed(() => game.value?.players[uid.value])
const dealer = computed(() => players.value.find(p => p.seat === game.value?.dealer))
const canDeal = computed(() => me.value?.host || dealer.value?.uid === uid.value)
const canStart = computed(() => members.value.length >= 2 && members.value.every(m => m.seat != null && m.ready))
const pot = computed(() => game.value?.paid ? 0 : players.value.reduce((sum, p) => sum + p.handBet, 0))
const myTurn = computed(() => !!player.value && game.value?.turn === uid.value)
const callAmount = computed(() => Math.min(player.value?.stack || 0, Math.max(0, (game.value?.highestBet || 0) - (player.value?.roundBet || 0))))
const maximumBet = computed(() => (player.value?.roundBet || 0) + (player.value?.stack || 0))
const minimumBet = computed(() => game.value ? (game.value.highestBet < game.value.bb ? game.value.bb : game.value.highestBet + game.value.minRaise) : 0)
const canRaise = computed(() => !!player.value && !!game.value && (player.value.actedAtBet < 0 || game.value.highestBet - player.value.actedAtBet >= game.value.minRaise))
const canAllIn = computed(() => canRaise.value || maximumBet.value <= (game.value?.highestBet || 0))
const bet = ref(0)
const validBet = computed(() => Number.isSafeInteger(bet.value) && bet.value >= minimumBet.value && bet.value <= maximumBet.value)
watch([minimumBet, maximumBet], () => { bet.value = Math.min(minimumBet.value, maximumBet.value) }, { immediate: true })
const phaseNames: Record<Phase, string> = {
  'waiting-deal': 'Karten austeilen', preflop: 'Preflop', 'waiting-flop': 'Flop aufdecken',
  flop: 'Flop', 'waiting-turn': 'Turn aufdecken', turn: 'Turn',
  'waiting-river': 'River aufdecken', river: 'River', showdown: 'Showdown', settled: 'Hand beendet',
}
const phaseName = computed(() => game.value ? phaseNames[game.value.phase] : '')
const waitingReveal = computed(() => ['waiting-flop', 'waiting-turn', 'waiting-river'].includes(game.value?.phase || ''))
const activeName = computed(() => game.value?.turn ? game.value.players[game.value.turn]?.name : '')

async function send(type: string, data: object = {}) {
  if (locked.value || !room.value) return
  pending.value = true
  error.value = ''
  try {
    await command('roomCommand', { roomId: id, type, expectedVersion: room.value.version, ...data })
  } catch (cause) { error.value = firebaseError(cause) }
  finally { pending.value = false }
}
function act(move: Move) {
  if (myTurn.value) void send('act', { move })
}
function memberAt(seat: number) { return members.value.find(member => member.seat === seat) }
function present(memberUid: string) { return Object.keys(room.value?.presence?.[memberUid] || {}).length > 0 }
async function copy() {
  try {
    await navigator.clipboard.writeText(`${location.origin}${import.meta.env.BASE_URL}invite/${room.value?.code}`)
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copied.value = false }, 2500)
  } catch { error.value = 'Link konnte nicht kopiert werden. Teile stattdessen den Raumcode.' }
}

const settings = reactive({ stack: 10000, sb: 50, bb: 100 })
watch(() => room.value ? [room.value.settings.stack, room.value.settings.sb, room.value.settings.bb].join(':') : '', () => {
  if (room.value) Object.assign(settings, room.value.settings)
}, { immediate: true })
const settingsValid = computed(() => [settings.stack, settings.sb, settings.bb].every(v => Number.isSafeInteger(v) && v > 0) && settings.sb < settings.bb && settings.bb <= settings.stack)
const settingsChanged = computed(() => !!room.value && (settings.stack !== room.value.settings.stack || settings.sb !== room.value.settings.sb || settings.bb !== room.value.settings.bb))
const pots = computed(() => game.value?.phase === 'showdown' ? buildPots(game.value) : [])
const winners = ref<string[][]>([])
watch(() => JSON.stringify([game.value?.handId, pots.value]), () => {
  winners.value = pots.value.map(p => p.eligible.length === 1 ? [...p.eligible] : [])
}, { immediate: true })
const payoutReady = computed(() => pots.value.length > 0 && pots.value.every((_, index) => winners.value[index]?.length > 0))
</script>

<template>
  <div v-if="!room" class="loading">
    <p :role="error ? 'alert' : 'status'">{{error || 'Verbindung zum Tisch wird hergestellt …'}}</p>
    <router-link v-if="error" to="/">Zur Startseite</router-link>
  </div>
  <section v-else class="room">
    <div v-if="!online" class="connection" role="status">Verbindung wird wiederhergestellt – Aktionen sind pausiert</div>
    <div v-else-if="!hostOnline" class="connection" role="status">Der Host ist offline. Sobald er den Tisch wieder öffnet, geht es weiter.</div>
    <div class="room-head">
      <div><small>PRIVATER TISCH</small><h1>{{room.name || 'Freundschaftsrunde'}}</h1><span class="connection-state">{{online ? '● Live verbunden' : '○ Verbindung unterbrochen'}}</span></div>
      <button class="code" @click="copy"><small>RAUMCODE</small><b>{{room.code}}</b><span>{{copied ? '✓ Link kopiert' : 'Link kopieren'}}</span></button>
    </div>
    <p v-if="error" class="error" role="alert">{{error}}</p>
    <p v-if="me?.host" class="field-hint">Du leitest diesen Tisch. Lass diese Seite während des Spiels geöffnet und dein Gerät wach.</p>
    <div v-if="room.status === 'lobby'" class="lobby">
      <div class="panel">
        <h2>Sitzplatz wählen</h2>
        <p>Tippe auf einen freien Platz. Änderungen setzen „Bereit“ zurück.</p>
        <div class="seats">
          <button v-for="seat in 9" :key="seat" :class="['seat', {taken: memberAt(seat - 1), selected: me?.seat === seat - 1}]" :disabled="locked || (!!memberAt(seat - 1) && memberAt(seat - 1)?.uid !== uid)" @click="send('takeSeat', {seat: seat - 1})">
            <b>{{seat}}</b><span>{{memberAt(seat - 1)?.name || 'Frei'}}</span><span v-if="memberAt(seat - 1)">{{memberAt(seat - 1)?.ready ? '✓ Bereit' : 'Noch nicht bereit'}}</span>
          </button>
        </div>
        <ul class="member-list"><li v-for="member in members" :key="member.uid"><span :class="{present: present(member.uid)}">●</span> {{member.name}}<small v-if="member.host">HOST</small><span v-if="member.seat == null">wählt einen Sitz</span></li></ul>
      </div>
      <aside class="panel settings">
        <h2>Spiel bereitmachen</h2>
        <form class="settings-form" @submit.prevent="settingsValid && send('settings', {...settings})">
          <label>Startstack<input v-model.number="settings.stack" type="number" min="1" step="1" :disabled="!me?.host || locked"></label>
          <div class="twocol">
            <label>Small Blind<input v-model.number="settings.sb" type="number" min="1" step="1" :disabled="!me?.host || locked"></label>
            <label>Big Blind<input v-model.number="settings.bb" type="number" min="2" step="1" :disabled="!me?.host || locked"></label>
          </div>
          <p v-if="!settingsValid" class="error">Ganze Chips eingeben: Small Blind &lt; Big Blind ≤ Startstack.</p>
          <button v-if="me?.host" :disabled="locked || !settingsValid || !settingsChanged">Einstellungen speichern</button>
        </form>
        <button :disabled="locked || me?.seat == null || settingsChanged" :class="{ready: me?.ready}" @click="send('ready')">{{me?.ready ? '✓ Bereit – zurücknehmen' : 'Ich bin bereit'}}</button>
        <button v-if="me?.host" class="primary" :disabled="locked || !canStart || settingsChanged" @click="send('start')">Pokerabend starten</button>
        <p class="field-hint">Zum Start müssen mindestens zwei Spieler sitzen und alle bereit sein.</p>
      </aside>
    </div>
    <div v-else-if="game" class="table-wrap">
      <div class="hand-heading"><span>Hand {{game.handId}} · Blinds {{game.sb}} / {{game.bb}}</span><span>Dealer: {{dealer?.name}}</span></div>
      <div class="table">
        <div class="felt"><div><small>{{phaseName}}</small><div class="pot-chip">{{pot.toLocaleString('de-DE')}}</div><strong>IM POT</strong><p v-if="activeName">{{myTurn ? 'Du bist am Zug' : activeName + ' ist am Zug'}}</p></div></div>
        <div v-for="p in players" :key="p.uid" class="player" :style="{gridArea: 's' + p.seat}" :class="{turn: game.turn === p.uid, folded: p.folded}">
          <span class="avatar">{{p.name[0]}}</span><b>{{p.name}}{{p.uid === uid ? ' (Du)' : ''}} <span v-if="p.seat === game.dealer" class="dealer-marker">D</span></b>
          <span>{{p.stack.toLocaleString('de-DE')}} Chips</span><i v-if="p.roundBet">{{p.roundBet}}</i><small v-if="p.folded">Gepasst</small><small v-else-if="p.allIn">All-in</small>
        </div>
      </div>
      <div v-if="game.phase === 'waiting-deal' || waitingReveal" class="panel dealer-panel">
        <h2>{{phaseName}}</h2>
        <p>{{game.phase === 'waiting-deal' ? 'Der Dealer verteilt die echten Karten. Erst nach der Bestätigung werden die Blinds gebucht.' : 'Der Dealer legt die nächsten Gemeinschaftskarten auf den Tisch und bestätigt anschließend.'}}</p>
        <button v-if="canDeal" class="primary control-button" :disabled="locked" @click="send(game.phase === 'waiting-deal' ? 'deal' : 'reveal')">{{game.phase === 'waiting-deal' ? 'Karten verteilt – Hand starten' : 'Karten aufgedeckt – weiter'}}</button>
        <p v-else>Warte auf die Bestätigung von {{dealer?.name}} oder dem Host.</p>
      </div>
      <div v-if="game.phase === 'showdown'" class="panel showdown-panel">
        <h2>Gewinner bestätigen</h2><p>Vergleicht eure echten Karten. Für einen geteilten Pot können mehrere Gewinner gewählt werden.</p>
        <div v-for="(currentPot, index) in pots" :key="index" class="pot-choice">
          <h3>{{index === 0 ? 'Hauptpot' : 'Nebenpot ' + index}} · {{currentPot.amount.toLocaleString('de-DE')}} Chips</h3>
          <label v-for="eligible in currentPot.eligible" :key="eligible" class="winner-option"><input v-model="winners[index]" type="checkbox" :value="eligible" :disabled="!me?.host || locked || currentPot.eligible.length === 1">{{game.players[eligible].name}}</label>
        </div>
        <button v-if="me?.host" class="primary control-button" :disabled="locked || !payoutReady" @click="send('payout', {winners})">Gewinner bestätigen und auszahlen</button><p v-else>Der Host bestätigt die Gewinner und zahlt die Pots aus.</p>
      </div>
      <div v-if="game.phase === 'settled'" class="panel dealer-panel">
        <h2>Hand beendet</h2><p>Die Chips wurden ausgezahlt.</p>
        <button v-if="me?.host && players.filter(p => p.stack > 0).length >= 2" class="primary control-button" :disabled="locked" @click="send('nextHand')">Nächste Hand vorbereiten</button>
        <p v-else-if="players.filter(p => p.stack > 0).length < 2">Die Runde ist beendet. {{players.find(p => p.stack > 0)?.name}} hat alle Chips.</p>
        <p v-else>Warte auf die nächste Hand.</p>
      </div>
      <div v-if="game.turn" class="actionbar">
        <p class="turn-label" aria-live="polite">{{pending ? 'Aktion wird übertragen …' : myTurn ? 'Du bist am Zug' : 'Warte auf ' + activeName}}</p>
        <div class="bet-controls"><label>{{game.highestBet ? 'Erhöhen auf' : 'Setzen'}}<input v-model.number="bet" type="number" :min="minimumBet" :max="maximumBet" step="1" :disabled="locked || !myTurn || !canRaise || maximumBet < minimumBet"></label><button :disabled="locked || !myTurn || !canRaise || !validBet" @click="act({kind: game.highestBet ? 'raise' : 'bet', to: bet})">{{game.highestBet ? 'Erhöhen' : 'Setzen'}}</button></div>
        <div class="action-buttons">
          <button :disabled="locked || !myTurn" @click="act({kind: 'fold'})">Passen</button>
          <button v-if="callAmount === 0" class="primary" :disabled="locked || !myTurn" @click="act({kind: 'check'})">Check</button>
          <button v-else class="primary" :disabled="locked || !myTurn" @click="act({kind: 'call'})">Mitgehen {{callAmount}}</button>
          <button :disabled="locked || !myTurn || !canAllIn" @click="act({kind: 'all-in'})">All-in {{player?.stack || 0}}</button>
        </div>
      </div>
    </div>
  </section>
</template>
