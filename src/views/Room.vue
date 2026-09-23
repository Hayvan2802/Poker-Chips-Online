<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { auth, command, firebaseError, watchRoom } from '../firebase'
import { buildPots, type Move, type Phase } from '../engine'
import PokerTable from '../components/PokerTable.vue'
import { blindCountdown, blindMinutes, blindMultiplier, raisedBlinds } from '../blinds'
import type { RoomState } from '../roomCore'

const id = String(useRoute().params.id)
const room = ref<RoomState | null>(null), uid = ref(''), error = ref(''), copied = ref(false)
const now = ref(Date.now()), serverOffset = ref(0)
const browserOnline = ref(navigator.onLine), connected = ref(false), pending = ref(false)
let disposed = false, stopRoom: (() => void) | undefined
let copyTimer: ReturnType<typeof setTimeout> | undefined
let clockTimer: ReturnType<typeof setInterval> | undefined
const updateOnline = () => { browserOnline.value = navigator.onLine }
type WakeSentinel = {release: () => Promise<void>}
let wake: WakeSentinel | null = null
let wakePending = false
async function keepHostAwake() {
  const shouldKeep = !disposed && document.visibilityState === 'visible' && room.value?.status === 'playing' && room.value?.hostUid === uid.value
  if (!shouldKeep) { if (wake) { const old = wake; wake = null; await old.release().catch(() => {}) }; return }
  if (wake || wakePending) return
  const supported = navigator as Navigator & {wakeLock?: {request: (type: 'screen') => Promise<WakeSentinel>}}
  if (!supported.wakeLock) return
  wakePending = true
  try {
    const acquired = await supported.wakeLock.request('screen')
    if (disposed || document.visibilityState !== 'visible' || room.value?.status !== 'playing' || room.value?.hostUid !== uid.value) await acquired.release()
    else wake = acquired
  } catch { /* Safari may deny Wake Lock; the room still works. */ }
  finally { wakePending = false }
}
const onVisibility = () => { void keepHostAwake() }
onMounted(async () => {
  clockTimer = setInterval(() => { now.value = Date.now() + serverOffset.value }, 1000)
  addEventListener('online', updateOnline)
  addEventListener('offline', updateOnline)
  document.addEventListener('visibilitychange', onVisibility)
  try {
    const stop = await watchRoom<RoomState>(id, {
      room: value => {
        room.value = value
        now.value = Date.now() + serverOffset.value
        uid.value = auth?.currentUser?.uid || ''
        if (!value) error.value = 'Dieser Tisch existiert nicht mehr.'
      },
      connection: value => { connected.value = value },
      serverTimeOffset: value => { serverOffset.value = value; now.value = Date.now() + value },
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
  document.removeEventListener('visibilitychange', onVisibility)
  void keepHostAwake()
  if (copyTimer) clearTimeout(copyTimer)
  if (clockTimer) clearInterval(clockTimer)
})

const online = computed(() => browserOnline.value && connected.value)
const hostOnline = computed(() => !!room.value && (room.value.hostUid === uid.value || present(room.value.hostUid)))
const locked = computed(() => !online.value || !hostOnline.value || pending.value)
const members = computed(() => Object.values(room.value?.members || {}))
const me = computed(() => room.value?.members[uid.value])
watch(() => [room.value?.status, room.value?.hostUid, uid.value], () => { void keepHostAwake() })
const game = computed(() => room.value?.game)
const players = computed(() => Object.values(game.value?.players || {}).sort((a, b) => a.seat - b.seat))
const player = computed(() => game.value?.players[uid.value])
const dealer = computed(() => players.value.find(p => p.seat === game.value?.dealer))
const canDeal = computed(() => me.value?.host || dealer.value?.uid === uid.value)
const canStart = computed(() => members.value.length >= 2 && members.value.every(m => m.seat != null && m.ready))
const seatedMembers = computed(() => members.value.filter(m => m.seat != null).map(m => ({...m, seat: m.seat!})))
const readyCount = computed(() => members.value.filter(m => m.ready).length)
const blindSeats = computed(() => {
  if (!game.value) return {small: undefined, big: undefined}
  const playing = players.value.filter(p => p.stack + p.handBet > 0 || p.allIn)
  const after = (seat: number) => playing.find(p => p.seat > seat) ?? playing[0]
  const small = playing.length === 2 ? dealer.value : after(game.value.dealer)
  return {small: small?.seat, big: small ? after(small.seat)?.seat : undefined}
})
const timerEnabled = computed(() => !!room.value && blindMinutes(room.value.settings) > 0)
const nextBlinds = computed(() => game.value && room.value ? raisedBlinds(game.value.sb, game.value.bb, blindMultiplier(room.value.settings)) : null)
const timerAtCap = computed(() => !!game.value && nextBlinds.value?.sb === game.value.sb && nextBlinds.value?.bb === game.value.bb)
const timerDue = computed(() => !!room.value?.blindClock?.nextIncreaseAt && now.value >= room.value.blindClock.nextIncreaseAt)
const countdown = computed(() => blindCountdown(room.value?.blindClock?.nextIncreaseAt || now.value, now.value))
const pot = computed(() => game.value?.paid ? 0 : players.value.reduce((sum, p) => sum + p.handBet, 0))
const myTurn = computed(() => !!player.value && game.value?.turn === uid.value)
const turnSeconds = computed(() => room.value?.turnClock ? Math.min(30, Math.max(0, Math.ceil((room.value.turnClock.deadline - now.value) / 1000))) : null)
const canAct = computed(() => myTurn.value && turnSeconds.value !== 0)
const turnTime = computed(() => `00:${String(turnSeconds.value ?? 30).padStart(2, '0')}`)
const lastAction = computed(() => room.value?.history?.[`v${room.value.version}`])
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
  if (canAct.value) void send('act', { move })
}
function present(memberUid: string) { return Object.keys(room.value?.presence?.[memberUid] || {}).length > 0 }
async function copy() {
  try {
    await navigator.clipboard.writeText(`${location.origin}${import.meta.env.BASE_URL}invite/${room.value?.code}`)
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copied.value = false }, 2500)
  } catch { error.value = 'Link konnte nicht kopiert werden. Teile stattdessen den Raumcode.' }
}

const settings = reactive({ stack: 10000, sb: 50, bb: 100, blindMinutes: 20, blindMultiplier: 2 })
const timerOn = computed({get: () => settings.blindMinutes > 0, set: value => { settings.blindMinutes = value ? 20 : 0 }})
watch(() => JSON.stringify(room.value?.settings), () => {
  if (room.value) Object.assign(settings, room.value.settings, {blindMinutes: blindMinutes(room.value.settings), blindMultiplier: blindMultiplier(room.value.settings)})
}, { immediate: true })
const settingsValid = computed(() => [settings.stack, settings.sb, settings.bb].every(v => Number.isSafeInteger(v) && v > 0 && v <= 1000000000) && settings.sb < settings.bb && settings.bb <= settings.stack && Number.isInteger(settings.blindMinutes) && settings.blindMinutes >= 0 && settings.blindMinutes <= 180 && [1.5, 2].includes(settings.blindMultiplier))
const settingsChanged = computed(() => !!room.value && (settings.stack !== room.value.settings.stack || settings.sb !== room.value.settings.sb || settings.bb !== room.value.settings.bb || settings.blindMinutes !== blindMinutes(room.value.settings) || settings.blindMultiplier !== blindMultiplier(room.value.settings)))
const settingsPreview = computed(() => raisedBlinds(settings.sb, settings.bb, settings.blindMultiplier))
const pots = computed(() => game.value?.phase === 'showdown' ? buildPots(game.value) : [])
const winners = ref<string[][]>([])
watch(() => JSON.stringify([game.value?.handId, pots.value]), () => {
  winners.value = pots.value.map(p => p.eligible.length === 1 ? [...p.eligible] : [])
}, { immediate: true })
const payoutReady = computed(() => pots.value.length > 0 && pots.value.every((_, index) => winners.value[index]?.length > 0))
const winnerDialog = ref<HTMLDialogElement | null>(null)
function openWinnerDialog() { const el = winnerDialog.value; if (!el || el.open) return; if (typeof el.showModal === 'function') el.showModal(); else { el.setAttribute('open', ''); el.classList.add('legacy-open') } }
function closeWinnerDialog() { const el = winnerDialog.value; if (!el) return; if (typeof el.close === 'function') el.close(); else { el.removeAttribute('open'); el.classList.remove('legacy-open') } }
const onlyOneLeft = computed(() => players.value.filter(p => !p.folded).length === 1)
watch(() => [game.value?.handId, game.value?.phase, me.value?.host], async () => {
  await nextTick()
  if (game.value?.phase === 'showdown' && me.value?.host) {
    openWinnerDialog()
  } else closeWinnerDialog()
}, {flush: 'post'})
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
      <div class="panel seating-panel">
        <div class="seating-heading"><div><small>GEMEINSAM AM TISCH</small><h2>Dein Platz ist reserviert.</h2></div><span class="player-count">{{members.length}} / 9</span></div>
        <p>Passt die Reihenfolge zu eurer Runde? Tippe auf einen freien Platz, um dich umzusetzen.</p>
        <PokerTable :seats="seatedMembers" :my-uid="uid" lobby :locked="locked" @select="seat => send('takeSeat', {seat})">
          <span class="felt-eyebrow">POKER CHIPS</span><strong class="lobby-ready-count">{{readyCount}} <span>/ {{members.length}}</span></strong><span class="felt-caption">bereit für die erste Hand</span>
          <span class="felt-footnote">Die Plätze laufen im Uhrzeigersinn.</span>
        </PokerTable>
        <div class="seat-legend"><span><i></i> Dein Platz</span><span><i></i> Bereit</span><span>Platzwechsel setzt „Bereit“ zurück.</span></div>
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
          <div class="timer-settings">
            <label class="timer-toggle"><input v-model="timerOn" type="checkbox" :disabled="!me?.host || locked"><span>Blinds automatisch erhöhen<small>Neue Blinds ab der nächsten Hand</small></span></label>
            <div v-if="timerOn" class="twocol">
              <label>Leveldauer (Minuten)<input v-model.number="settings.blindMinutes" type="number" min="1" max="180" step="1" :disabled="!me?.host || locked"></label>
              <label>Erhöhung<select v-model.number="settings.blindMultiplier" :disabled="!me?.host || locked"><option :value="1.5">+50 %</option><option :value="2">Verdoppeln</option></select></label>
            </div>
            <p v-if="timerOn && settingsValid" class="field-hint">Alle {{settings.blindMinutes}} {{settings.blindMinutes === 1 ? 'Minute' : 'Minuten'}}: {{settings.sb}} / {{settings.bb}} → {{settingsPreview.sb}} / {{settingsPreview.bb}}. Der Timer startet mit der ersten Hand. Eine laufende Hand wird fertig gespielt, dann beginnt das nächste Level mit voller Zeit.</p>
            <p v-else-if="!timerOn" class="field-hint">Die Blinds bleiben den ganzen Abend gleich.</p>
          </div>
          <p v-if="!settingsValid" class="error">Ganze Chips: Small Blind &lt; Big Blind ≤ Startstack. Timer: 1–180 Minuten.</p>
          <button v-if="me?.host" :disabled="locked || !settingsValid || !settingsChanged">Einstellungen speichern</button>
        </form>
        <button :disabled="locked || me?.seat == null || settingsChanged" :class="{ready: me?.ready}" @click="send('ready')">{{me?.ready ? '✓ Bereit – zurücknehmen' : 'Ich bin bereit'}}</button>
        <button v-if="me?.host" class="primary" :disabled="locked || !canStart || settingsChanged" @click="send('start')">Pokerabend starten</button>
        <p v-if="settingsChanged && me?.host" class="field-hint settings-unsaved" role="status">Speichere deine Änderungen, bevor ihr bereit seid.</p>
        <p class="field-hint">Zum Start müssen mindestens zwei Spieler sitzen und alle bereit sein.</p>
      </aside>
    </div>
    <div v-else-if="game" class="table-wrap">
      <div class="hand-heading"><span>Hand {{game.handId}}</span><span>Dealer: {{dealer?.name}}</span></div>
      <p v-if="lastAction?.type === 'autoFold'" class="auto-fold-notice" role="status">{{game.players[lastAction.uid]?.name}} hat nach 30 Sekunden automatisch gepasst.</p>
      <div class="blind-board" :class="{due: timerDue && !timerAtCap}">
        <div><small>{{timerEnabled ? 'LEVEL ' + (room.blindClock?.level || 1) : 'FESTE BLINDS'}}</small><strong>{{game.sb.toLocaleString('de-DE')}} <span>/</span> {{game.bb.toLocaleString('de-DE')}}</strong><span>Small Blind / Big Blind</span></div>
        <div v-if="timerEnabled && !timerAtCap" class="blind-timer">
          <small>{{timerDue ? 'ERHÖHUNG BEREIT' : room.blindClock?.nextIncreaseAt ? 'NÄCHSTES LEVEL IN' : 'TIMER STARTET BEIM AUSTEILEN'}}</small>
          <strong class="countdown" role="timer" aria-label="Zeit bis zur Blind-Erhöhung">{{room.blindClock?.nextIncreaseAt ? countdown : `${String(blindMinutes(room.settings)).padStart(2, '0')}:00`}}</strong>
          <span>{{timerDue ? 'Ab der nächsten Hand' : 'Danach'}}: {{nextBlinds?.sb.toLocaleString('de-DE')}} / {{nextBlinds?.bb.toLocaleString('de-DE')}}</span>
        </div>
        <div v-else class="blind-timer"><span>{{timerAtCap ? 'Maximale Blindhöhe erreicht' : 'Ohne Timer · Blinds bleiben gleich'}}</span></div>
        <p v-if="timerDue && !timerAtCap" class="blind-notice" role="status">{{game.phase === 'waiting-deal' ? 'Die neuen Blinds werden beim Austeilen gesetzt.' : game.phase === 'settled' ? 'Die Hand ist beendet. Beim Vorbereiten der nächsten Hand gelten die höheren Blinds.' : 'Diese Hand bleibt bei ' + game.sb + ' / ' + game.bb + '. Danach steigen die Blinds.'}}</p>
      </div>
      <PokerTable :seats="players" :my-uid="uid" :turn="game.turn" :dealer="game.dealer" :small-blind="blindSeats.small" :big-blind="blindSeats.big">
        <span class="felt-eyebrow">{{phaseName}}</span><div class="center-chips" aria-hidden="true"><i></i><i></i><i></i></div><div :key="pot" class="pot-chip">{{pot.toLocaleString('de-DE')}}</div><strong class="felt-caption">IM POT</strong><p v-if="activeName">{{myTurn ? 'Du bist am Zug' : activeName + ' ist am Zug'}}</p>
        <span v-if="game.turn && turnSeconds !== null" class="turn-clock" :class="{urgent: turnSeconds <= 10}" role="timer" aria-label="Verbleibende Bedenkzeit">{{turnTime}}</span>
      </PokerTable>
      <div v-if="game.phase === 'waiting-deal' || waitingReveal" class="panel dealer-panel">
        <h2>{{phaseName}}</h2>
        <p>{{game.phase === 'waiting-deal' ? 'Der Dealer verteilt die echten Karten. Erst nach der Bestätigung werden die Blinds gebucht.' : 'Der Dealer legt die nächsten Gemeinschaftskarten auf den Tisch und bestätigt anschließend.'}}</p>
        <button v-if="canDeal" class="primary control-button" :disabled="locked" @click="send(game.phase === 'waiting-deal' ? 'deal' : 'reveal')">{{game.phase === 'waiting-deal' ? 'Karten verteilt – Hand starten' : 'Karten aufgedeckt – weiter'}}</button>
        <p v-else>Warte auf die Bestätigung von {{dealer?.name}} oder dem Host.</p>
      </div>
      <div v-if="game.phase === 'showdown'" class="panel showdown-panel">
        <h2>Die Hand wartet auf den Host</h2><p>{{onlyOneLeft ? 'Alle anderen Spieler haben gepasst. Der Host bestätigt jetzt die Auszahlung.' : 'Vergleicht eure Karten. Der Host wählt die Gewinner und verteilt den Pot.'}}</p>
        <button v-if="me?.host" class="primary control-button" @click="openWinnerDialog()">Gewinner bestätigen</button>
      </div>
      <dialog ref="winnerDialog" class="winner-dialog" aria-labelledby="winner-heading" aria-describedby="winner-description">
        <div class="winner-dialog-head"><span class="winner-emblem" aria-hidden="true">♠</span><div><small>HOST · HAND {{game.handId}}</small><h2 id="winner-heading">Wer gewinnt die Hand?</h2></div></div>
        <p id="winner-description">{{onlyOneLeft ? 'Nur noch ein Spieler ist dabei. Bestätige seinen Gewinn, um die Hand abzuschließen.' : 'Wähle anhand eurer echten Karten die Gewinner. Bei Gleichstand kannst du mehrere Spieler auswählen.'}}</p>
        <div class="payout-total"><span>Zur Auszahlung</span><strong>{{pot.toLocaleString('de-DE')}} <small>Chips</small></strong></div>
        <div v-for="(currentPot, index) in pots" :key="index" class="pot-choice">
          <h3>{{index === 0 ? 'Hauptpot' : 'Nebenpot ' + index}} <span>{{currentPot.amount.toLocaleString('de-DE')}} Chips</span></h3>
          <label v-for="eligible in currentPot.eligible" :key="eligible" class="winner-card" :class="{chosen: winners[index]?.includes(eligible)}">
            <input v-model="winners[index]" type="checkbox" :value="eligible" :disabled="locked || currentPot.eligible.length === 1">
            <span class="winner-initial" aria-hidden="true">{{game.players[eligible].name[0]}}</span><strong>{{game.players[eligible].name}}</strong><span>{{winners[index]?.includes(eligible) ? 'Gewinner' : 'Auswählen'}}</span>
          </label>
          <p v-if="winners[index]?.length > 1" class="field-hint">Dieser Pot wird zwischen {{winners[index].length}} Gewinnern geteilt.</p>
        </div>
        <p class="field-hint">Die Einsätze sind bereits vom Stack abgezogen. Jetzt wird der Pot den Gewinnern gutgeschrieben.</p>
        <p v-if="error" class="error" role="alert">{{error}}</p><p v-if="!online" class="error" role="status">Verbindung wird wiederhergestellt. Bitte kurz warten.</p>
        <div class="winner-dialog-actions"><button class="primary control-button" :disabled="locked || !payoutReady" @click="send('payout', {winners})">{{pending ? 'Wird ausgezahlt …' : 'Gewinn bestätigen & Chips auszahlen'}}</button><button class="dialog-later" :disabled="pending" @click="closeWinnerDialog()">Zurück zum Tisch</button></div>
      </dialog>
      <div v-if="game.phase === 'settled'" class="panel dealer-panel">
        <h2>Hand beendet</h2><p>Die Chips wurden ausgezahlt.</p>
        <p v-if="timerEnabled && timerDue && !timerAtCap" class="next-blind-note">Nächste Hand mit {{nextBlinds?.sb}} / {{nextBlinds?.bb}} Blinds · Level {{(room.blindClock?.level || 1) + 1}}</p>
        <button v-if="me?.host && players.filter(p => p.stack > 0).length >= 2" class="primary control-button" :disabled="locked" @click="send('nextHand')">Nächste Hand vorbereiten</button>
        <p v-else-if="players.filter(p => p.stack > 0).length < 2">Die Runde ist beendet. {{players.find(p => p.stack > 0)?.name}} hat alle Chips.</p>
        <p v-else>Warte auf die nächste Hand.</p>
      </div>
      <div v-if="game.turn" class="actionbar">
        <p class="turn-label" aria-live="polite">{{pending ? 'Aktion wird übertragen …' : myTurn ? 'Du bist am Zug' : 'Warte auf ' + activeName}}</p>
        <span v-if="turnSeconds !== null" class="turn-time-hint" :class="{urgent: turnSeconds <= 10}">{{turnSeconds === 0 ? 'Automatisches Passen …' : 'Automatisch passen in ' + turnTime}}</span>
        <div class="bet-controls"><label>{{game.highestBet ? 'Erhöhen auf' : 'Setzen'}}<input v-model.number="bet" type="number" :min="minimumBet" :max="maximumBet" step="1" :disabled="locked || !canAct || !canRaise || maximumBet < minimumBet"></label><button :disabled="locked || !canAct || !canRaise || !validBet" @click="act({kind: game.highestBet ? 'raise' : 'bet', to: bet})">{{game.highestBet ? 'Erhöhen' : 'Setzen'}}</button></div>
        <div class="action-buttons">
          <button :disabled="locked || !canAct" @click="act({kind: 'fold'})">Passen</button>
          <button v-if="callAmount === 0" class="primary" :disabled="locked || !canAct" @click="act({kind: 'check'})">Check</button>
          <button v-else class="primary" :disabled="locked || !canAct" @click="act({kind: 'call'})">Mitgehen {{callAmount}}</button>
          <button :disabled="locked || !canAct || !canAllIn" @click="act({kind: 'all-in'})">All-in {{player?.stack || 0}}</button>
        </div>
      </div>
    </div>
  </section>
</template>
