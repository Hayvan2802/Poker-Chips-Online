<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { auth, command, firebaseError, watchRoom } from '../firebase'
import { buildPots, type Move, type Phase } from '../engine'
import PokerTable from '../components/PokerTable.vue'
import { blindCountdown, blindMinutes, blindMultiplier, raisedBlinds, validBlindPlan, validDenominations, type BlindSettings, type BlindStep } from '../blinds'
import type { RoomState } from '../roomCore'
import {cashSettlement} from '../settlement'
import {readPresets, writePresets, type TablePreset} from '../presets'

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
const locked = computed(() => !online.value || !hostOnline.value || pending.value || !!room.value?.pausedAt)
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
  const playing = players.value.filter(p => !p.sittingOut && (p.stack + p.handBet > 0 || p.allIn))
  const after = (seat: number) => playing.find(p => p.seat > seat) ?? playing[0]
  const small = playing.length === 2 ? dealer.value : after(game.value.dealer)
  return {small: small?.seat, big: small ? after(small.seat)?.seat : undefined}
})
const timerEnabled = computed(() => !!room.value && blindMinutes(room.value.settings) > 0)
const nextStep = computed(() => room.value?.settings.blindPlan?.[room.value.blindClock?.level || 1])
const nextBlinds = computed(() => game.value && room.value ? nextStep.value?.kind === 'level' ? {sb:nextStep.value.sb,bb:nextStep.value.bb} : nextStep.value?.kind === 'break' ? null : raisedBlinds(game.value.sb, game.value.bb, blindMultiplier(room.value.settings)) : null)
const timerAtCap = computed(() => !!game.value && !nextStep.value && !!room.value?.settings.blindPlan || !!game.value && !room.value?.settings.blindPlan && nextBlinds.value?.sb === game.value.sb && nextBlinds.value?.bb === game.value.bb)
const effectiveNow = computed(() => room.value?.pausedAt || now.value)
const timerDue = computed(() => !!room.value?.blindClock?.nextIncreaseAt && effectiveNow.value >= room.value.blindClock.nextIncreaseAt)
const countdown = computed(() => blindCountdown(room.value?.blindClock?.nextIncreaseAt || effectiveNow.value, effectiveNow.value))
const breakCountdown = computed(() => blindCountdown(room.value?.blindClock?.breakUntil || effectiveNow.value,effectiveNow.value))
const cash = computed(() => room.value ? cashSettlement(room.value) : null)
const money = (cents:number) => new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(cents/100)
const pot = computed(() => game.value?.paid ? 0 : players.value.reduce((sum, p) => sum + p.handBet, 0))
const myTurn = computed(() => !!player.value && game.value?.turn === uid.value)
const turnSeconds = computed(() => room.value?.turnClock ? Math.max(0, Math.ceil((room.value.turnClock.deadline - effectiveNow.value) / 1000)) : null)
const canAct = computed(() => myTurn.value && turnSeconds.value !== 0)
const turnTime = computed(() => `${String(Math.floor((turnSeconds.value ?? 30) / 60)).padStart(2, '0')}:${String((turnSeconds.value ?? 30) % 60).padStart(2, '0')}`)
const lastAction = computed(() => room.value?.history?.[`v${room.value.version}`])
const recentHistory = computed(() => Object.values(room.value?.history || {}).sort((a, b) => b.version - a.version).slice(0, 24))
const potDetails = computed(() => game.value && !game.value.paid ? buildPots(game.value) : game.value?.pots || [])
function eventText(entry: NonNullable<RoomState['history']>[string]) {
  const name = room.value?.members[entry.uid]?.name || game.value?.players[entry.uid]?.name || 'Spieler'
  const type = entry.type === 'act' ? ({fold:'passt',check:'checkt',call:'geht mit',bet:'setzt',raise:'erhöht','all-in':'geht all-in'} as Record<string,string>)[entry.move || ''] || 'handelt' : ({joinRoom:'tritt bei',payout:'zahlt den Pot aus',undoPayout:'korrigiert die Auszahlung',autoFold:'passt automatisch',timeBank:'nimmt 30 Sekunden Zeitreserve',sitOut:'ändert seinen Pausenstatus',randomSeats:'lost die Plätze aus',pause:'pausiert den Tisch',resume:'setzt den Tisch fort',deal:'bestätigt die Karten',reveal:'bestätigt weitere Karten',nextHand:'startet die nächste Hand'} as Record<string,string>)[entry.type] || entry.type
  return `${name} ${type}${entry.amount ? ` · ${entry.amount.toLocaleString('de-DE')} Chips` : ''}`
}
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
  if (!room.value) return
  if (type !== 'resume' && locked.value) return
  if (type === 'resume' && (!online.value || !hostOnline.value || pending.value)) return
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

const settings = reactive<BlindSettings>({ stack: 10000, sb: 50, bb: 100, blindMinutes: 20, blindMultiplier: 2, ante:0, anteMode:'each', buyInCents:0, blindPlan:[], denominations:[] })
const timerOn = computed({get: () => (settings.blindMinutes ?? 0) > 0, set: value => { settings.blindMinutes = value ? 20 : 0 }})
watch(() => JSON.stringify(room.value?.settings), () => {
  if (room.value) Object.assign(settings, {ante:0,anteMode:'each',buyInCents:0,blindPlan:[],denominations:[]}, room.value.settings, {blindMinutes: blindMinutes(room.value.settings), blindMultiplier: blindMultiplier(room.value.settings)})
}, { immediate: true })
const settingsValid = computed(() => [settings.stack, settings.sb, settings.bb].every(v => Number.isSafeInteger(v) && v > 0 && v <= 1000000000) && settings.sb < settings.bb && settings.bb <= settings.stack && Number.isInteger(settings.blindMinutes) && (settings.blindMinutes ?? 0) >= 0 && (settings.blindMinutes ?? 0) <= 180 && [1.5, 2].includes(settings.blindMultiplier ?? 2) && Number.isSafeInteger(settings.ante) && (settings.ante ?? 0)>=0 && (settings.ante ?? 0)<=settings.bb && Number.isSafeInteger(settings.buyInCents) && (settings.buyInCents ?? 0)>=0 && (!settings.blindPlan?.length || validBlindPlan(settings.blindPlan,settings)) && (!settings.denominations?.length || validDenominations(settings.denominations)))
const comparableSettings = (s:BlindSettings) => JSON.stringify({stack:s.stack,sb:s.sb,bb:s.bb,blindMinutes:blindMinutes(s),blindMultiplier:blindMultiplier(s),ante:s.ante||0,anteMode:s.anteMode||'each',buyInCents:s.buyInCents||0,blindPlan:s.blindPlan||[],denominations:s.denominations||[]})
const settingsChanged = computed(() => !!room.value && comparableSettings(settings) !== comparableSettings(room.value.settings))
const settingsPreview = computed(() => raisedBlinds(settings.sb, settings.bb, settings.blindMultiplier ?? 2))
const planEnabled = computed({get:()=>!!settings.blindPlan?.length,set:value=>{if(value)settings.blindMinutes=settings.blindMinutes||20;settings.blindPlan=value?[{kind:'level',sb:settings.sb,bb:settings.bb,minutes:settings.blindMinutes||20,ante:settings.ante||0,anteMode:settings.anteMode||'each'}]:[]}})
watch(() => [settings.sb,settings.bb,settings.ante,settings.anteMode], () => {const first=settings.blindPlan?.[0];if(first?.kind==='level'){first.sb=settings.sb;first.bb=settings.bb;first.ante=settings.ante;first.anteMode=settings.anteMode}})
function appendLevel(){const previous=[...(settings.blindPlan||[])].reverse().find(step=>step.kind==='level') as Extract<BlindStep,{kind:'level'}>|undefined;settings.blindPlan?.push({kind:'level',sb:Math.ceil((previous?.sb||settings.sb)*2),bb:Math.ceil((previous?.bb||settings.bb)*2),minutes:20,ante:previous?.ante||0,anteMode:previous?.anteMode||'each'})}
const presets = ref<TablePreset[]>(readPresets())
const presetName = ref(''), selectedPreset = ref('')
function savePreset(){const name=presetName.value.trim().slice(0,30);if(!name||!settingsValid.value)return;presets.value=[{name,settings:JSON.parse(JSON.stringify(settings))},...presets.value.filter(p=>p.name!==name)].slice(0,12);writePresets(presets.value);presetName.value=''}
function loadPreset(){const preset=presets.value.find(p=>p.name===selectedPreset.value);if(preset)Object.assign(settings,JSON.parse(JSON.stringify(preset.settings)))}
function deletePreset(){presets.value=presets.value.filter(p=>p.name!==selectedPreset.value);writePresets(presets.value);selectedPreset.value=''}
const rebuyTarget = ref(''), rebuyChips = ref(10000)
const showCash = ref(false)
const buyInEuros = computed({get:()=>((settings.buyInCents||0)/100),set:value=>{settings.buyInCents=Math.round(Number(value)*100)}})
watch(() => room.value?.settings.stack, value => {if(value)rebuyChips.value=value})
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
const undoConfirm = ref(false)
watch(() => game.value?.phase, () => { undoConfirm.value = false })
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
    <div v-if="room.status === 'playing' && me?.host" class="table-utility"><button v-if="!room.pausedAt" :disabled="locked" @click="send('pause')">⏸ Tisch pausieren</button><button v-else :disabled="!online || !hostOnline || pending" @click="send('resume')">▶ Tisch fortsetzen</button></div>
    <p v-if="room.pausedAt" class="pause-notice" role="status">Der Tisch ist pausiert. Zug- und Blind-Timer laufen nach dem Fortsetzen weiter.</p>
    <div v-if="room.status === 'lobby'" class="lobby">
      <div class="panel seating-panel">
        <div class="seating-heading"><div><small>GEMEINSAM AM TISCH</small><h2>Dein Platz ist reserviert.</h2></div><span class="player-count">{{members.length}} / 9</span></div>
        <p>Passt die Reihenfolge zu eurer Runde? Tippe auf einen freien Platz, um dich umzusetzen.</p>
        <PokerTable :seats="seatedMembers" :my-uid="uid" lobby :locked="locked" @select="seat => send('takeSeat', {seat})">
          <span class="felt-eyebrow">POKER CHIPS</span><strong class="lobby-ready-count">{{readyCount}} <span>/ {{members.length}}</span></strong><span class="felt-caption">bereit für die erste Hand</span>
          <span class="felt-footnote">Die Plätze laufen im Uhrzeigersinn.</span>
        </PokerTable>
        <div v-if="me?.host" class="table-utility"><button :disabled="locked" @click="send('randomSeats')">↻ Plätze auslosen</button><span>Alle Bereit-Meldungen werden danach zurückgesetzt.</span></div>
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
          <details class="advanced-settings"><summary>Turnier, Antes & Chips</summary>
            <div class="twocol"><label>Ante pro Spieler<input v-model.number="settings.ante" type="number" min="0" step="1" :disabled="!me?.host || locked"></label><label>Ante-Art<select v-model="settings.anteMode" :disabled="!me?.host || locked"><option value="each">Jeder Spieler</option><option value="bb">Big Blind Ante</option></select></label></div>
            <label>Buy-in (€ · optional)<input v-model.number="buyInEuros" type="number" min="0" step="0.01" :disabled="!me?.host || locked"></label><p class="field-hint">Bei Cash-Runden werden Einzahlungen und Rebuys für die spätere Abrechnung gespeichert. Die App wickelt kein Geld ab.</p>
            <label class="timer-toggle"><input v-model="planEnabled" type="checkbox" :disabled="!me?.host || locked"><span>Blindplan mit Pausen verwenden<small>Jede Stufe beginnt erst zwischen zwei Händen.</small></span></label>
            <div v-if="planEnabled" class="blind-plan-editor"><div v-for="(step,index) in settings.blindPlan" :key="index" class="plan-row"><strong>{{step.kind==='break' ? 'Pause' : 'Level ' + (index+1)}}</strong><template v-if="step.kind==='level'"><label>SB<input v-model.number="step.sb" type="number" min="1" :disabled="index===0 || !me?.host || locked"></label><label>BB<input v-model.number="step.bb" type="number" min="2" :disabled="index===0 || !me?.host || locked"></label><label>Ante<input v-model.number="step.ante" type="number" min="0" :disabled="index===0 || !me?.host || locked"></label></template><label>Minuten<input v-model.number="step.minutes" type="number" min="1" max="180" :disabled="!me?.host || locked"></label><button v-if="index>0" type="button" :disabled="!me?.host || locked" @click="settings.blindPlan?.splice(index,1)">Entfernen</button></div><div class="plan-actions"><button type="button" :disabled="!me?.host || locked || (settings.blindPlan?.length||0)>=24" @click="appendLevel">+ Blind-Stufe</button><button type="button" :disabled="!me?.host || locked || settings.blindPlan?.[(settings.blindPlan?.length||1)-1]?.kind==='break' || (settings.blindPlan?.length||0)>=23" @click="settings.blindPlan?.push({kind:'break',minutes:5});appendLevel()">+ 5-Minuten-Pause</button></div></div>
            <label class="timer-toggle"><input type="checkbox" :checked="!!settings.denominations?.length" :disabled="!me?.host || locked" @change="settings.denominations = settings.denominations?.length ? [] : [{value:25,color:'#e5e7eb'},{value:100,color:'#2563eb'},{value:500,color:'#ef4444'},{value:1000,color:'#111827'}]"><span>Chipfarben festlegen<small>Nur als optische Stückelung; die Chipwerte bleiben unverändert.</small></span></label>
            <div v-if="settings.denominations?.length" class="chip-editor"><div v-for="(chip,index) in settings.denominations" :key="index" class="plan-row"><input v-model="chip.color" type="color" :disabled="!me?.host || locked" :aria-label="'Farbe für Chip '+(index+1)"><label>Wert<input v-model.number="chip.value" type="number" min="1" :disabled="!me?.host || locked"></label><button type="button" :disabled="!me?.host || locked || settings.denominations?.length===1" @click="settings.denominations?.splice(index,1)">Entfernen</button></div><button type="button" :disabled="!me?.host || locked || settings.denominations.length>=10" @click="settings.denominations?.push({value:5000,color:'#16a34a'})">+ Chipfarbe</button></div>
          </details>
          <details class="advanced-settings"><summary>Meine Tischvorlagen</summary><div class="preset-controls"><select v-model="selectedPreset" aria-label="Gespeicherte Tischvorlage"><option value="">Vorlage wählen</option><option v-for="preset in presets" :key="preset.name" :value="preset.name">{{preset.name}}</option></select><button type="button" :disabled="!selectedPreset || !me?.host || locked" @click="loadPreset">Laden</button><button type="button" :disabled="!selectedPreset" @click="deletePreset">Löschen</button><input v-model="presetName" maxlength="30" placeholder="Vorlagenname" aria-label="Name der Tischvorlage"><button type="button" :disabled="!presetName.trim() || !settingsValid" @click="savePreset">Aktuelle Einstellungen speichern</button></div><p class="field-hint">Vorlagen bleiben nur auf diesem Gerät. Der Host speichert geladene Einstellungen anschließend für den Tisch.</p></details>
          <p v-if="!settingsValid" class="error">Ganze Chips: Small Blind &lt; Big Blind ≤ Startstack. Timer: 1–180 Minuten.</p>
          <button v-if="me?.host" :disabled="locked || !settingsValid || !settingsChanged">Einstellungen speichern</button>
        </form>
        <button :disabled="locked || me?.seat == null || settingsChanged" :class="{ready: me?.ready}" @click="send('ready')">{{me?.ready ? '✓ Bereit – zurücknehmen' : 'Ich bin bereit'}}</button>
        <button v-if="me?.host" class="primary" :disabled="locked || !canStart || settingsChanged" @click="send('start')">Pokerabend starten</button>
        <div v-if="me?.host" class="entry-policy"><h3>Neue Spieler</h3><button type="button" :disabled="locked" @click="send('entryPolicy', {joinOpen: room.joinOpen === false, lateRegistration: !!room.lateRegistration})">{{room.joinOpen === false ? 'Tisch wieder öffnen' : 'Tisch für neue Spieler sperren'}}</button><button type="button" :disabled="locked" @click="send('entryPolicy', {joinOpen: room.joinOpen !== false, lateRegistration: !room.lateRegistration})">Später Einstieg: {{room.lateRegistration ? 'erlaubt' : 'aus'}}</button><p class="field-hint">Ein später Einstieg ist nur zwischen zwei Händen möglich.</p></div>
        <p v-if="settingsChanged && me?.host" class="field-hint settings-unsaved" role="status">Speichere deine Änderungen, bevor ihr bereit seid.</p>
        <p class="field-hint">Zum Start müssen mindestens zwei Spieler sitzen und alle bereit sein.</p>
      </aside>
    </div>
    <div v-else-if="game" class="table-wrap">
      <div class="hand-heading"><span>Hand {{game.handId}}</span><span>Dealer: {{dealer?.name}}</span></div>
      <p v-if="lastAction?.type === 'autoFold'" class="auto-fold-notice" role="status">{{game.players[lastAction.uid]?.name}} hat nach 30 Sekunden automatisch gepasst.</p>
      <div class="blind-board" :class="{due: timerDue && !timerAtCap}">
        <div><small>{{timerEnabled ? 'LEVEL ' + (room.blindClock?.level || 1) : 'FESTE BLINDS'}}</small><strong>{{game.sb.toLocaleString('de-DE')}} <span>/</span> {{game.bb.toLocaleString('de-DE')}}</strong><span>Small Blind / Big Blind <template v-if="game.ante">· Ante {{game.ante}} {{game.anteMode==='bb' ? '(BB)' : '(alle)'}}</template></span></div>
        <div v-if="room.blindClock?.breakUntil" class="blind-timer"><small>SPIELPAUSE</small><strong class="countdown">{{breakCountdown}}</strong><span>Die nächste Blind-Stufe beginnt nach der Pause.</span></div>
        <div v-else-if="timerEnabled && !timerAtCap" class="blind-timer">
          <small>{{timerDue ? 'ERHÖHUNG BEREIT' : room.blindClock?.nextIncreaseAt ? 'NÄCHSTES LEVEL IN' : 'TIMER STARTET BEIM AUSTEILEN'}}</small>
          <strong class="countdown" role="timer" aria-label="Zeit bis zur Blind-Erhöhung">{{room.blindClock?.nextIncreaseAt ? countdown : `${String(blindMinutes(room.settings)).padStart(2, '0')}:00`}}</strong>
          <span>{{nextStep?.kind==='break' ? 'Danach: Pause '+nextStep.minutes+' Minuten' : `${timerDue ? 'Ab der nächsten Hand' : 'Danach'}: ${nextBlinds?.sb.toLocaleString('de-DE')} / ${nextBlinds?.bb.toLocaleString('de-DE')}`}}</span>
        </div>
        <div v-else class="blind-timer"><span>{{timerAtCap ? 'Maximale Blindhöhe erreicht' : 'Ohne Timer · Blinds bleiben gleich'}}</span></div>
        <p v-if="timerDue && !timerAtCap" class="blind-notice" role="status">{{nextStep?.kind==='break' ? 'Nach dieser Hand beginnt eine Spielpause.' : game.phase === 'waiting-deal' ? 'Die neuen Blinds werden beim Austeilen gesetzt.' : game.phase === 'settled' ? 'Die Hand ist beendet. Beim Vorbereiten der nächsten Hand gelten die höheren Blinds.' : 'Diese Hand bleibt bei ' + game.sb + ' / ' + game.bb + '. Danach steigen die Blinds.'}}</p>
      </div>
      <details v-if="room.settings.denominations?.length" class="panel chip-legend"><summary>Chipfarben & Stückelung</summary><div><span v-for="chip in room.settings.denominations" :key="chip.value"><i :style="{background:chip.color}"></i>{{chip.value.toLocaleString('de-DE')}}</span></div><p>Color-up: Tauscht kleine physische Chips bei Bedarf zwischen den Händen gegen gleichwertige größere. Digitale Stacks ändern sich dadurch nicht.</p></details>
      <PokerTable :seats="players" :my-uid="uid" :turn="game.turn" :dealer="game.dealer" :small-blind="blindSeats.small" :big-blind="blindSeats.big">
        <span class="felt-eyebrow">{{phaseName}}</span><div class="center-chips" aria-hidden="true"><i></i><i></i><i></i></div><div :key="pot" class="pot-chip">{{pot.toLocaleString('de-DE')}}</div><strong class="felt-caption">IM POT</strong><p v-if="activeName">{{myTurn ? 'Du bist am Zug' : activeName + ' ist am Zug'}}</p>
        <span v-if="game.turn && turnSeconds !== null" class="turn-clock" :class="{urgent: turnSeconds <= 10}" role="timer" aria-label="Verbleibende Bedenkzeit">{{turnTime}}</span>
      </PokerTable>
      <details v-if="potDetails.length" class="panel pot-loupe"><summary>Pot-Lupe · {{potDetails.length}} {{potDetails.length === 1 ? 'Pot' : 'Pots'}} ansehen</summary><ol><li v-for="(currentPot, index) in potDetails" :key="index"><strong>{{index === 0 ? 'Hauptpot' : 'Nebenpot ' + index}}: {{currentPot.amount.toLocaleString('de-DE')}} Chips</strong><span>Gewinnen können: {{currentPot.eligible.map(playerUid => game?.players[playerUid]?.name || 'Spieler').join(', ')}}</span></li></ol><p>Gefoldete Einsätze bleiben im Pot, gefoldete Spieler können ihn nicht gewinnen.</p></details>
      <div v-if="['waiting-deal', 'settled'].includes(game.phase)" class="panel between-hands"><button v-if="player && player.stack > 0" :disabled="locked" @click="send('sitOut', {sittingOut: !player.sittingOut})">{{player.sittingOut ? 'Wieder mitspielen' : 'Nächste Hand aussetzen'}}</button><span v-if="player?.sittingOut">Du setzt aus und bekommst keine Karten oder Blinds. Zurückkehrende Spieler zahlen den Blind erst, wenn sie regulär an der Reihe sind.</span><div v-if="me?.host && game.phase === 'settled'" class="entry-policy"><button :disabled="locked" @click="send('entryPolicy', {joinOpen: room.joinOpen === false, lateRegistration: !!room.lateRegistration})">{{room.joinOpen === false ? 'Tisch für neue Spieler öffnen' : 'Tisch für neue Spieler sperren'}}</button><button :disabled="locked" @click="send('entryPolicy', {joinOpen: room.joinOpen !== false, lateRegistration: !room.lateRegistration})">Später Einstieg: {{room.lateRegistration ? 'erlaubt' : 'aus'}}</button></div></div>
      <details v-if="me?.host && ['waiting-deal','settled'].includes(game.phase)" class="panel rebuy-panel"><summary>Rebuy / Add-on buchen</summary><p>Nur zwischen Händen. Der neue Chipbetrag wird dem Stack gutgeschrieben und bei der Abrechnung als zusätzliche Einzahlung erfasst.</p><div class="rebuy-controls"><select v-model="rebuyTarget" aria-label="Spieler für Rebuy"><option value="">Spieler wählen</option><option v-for="p in players" :key="p.uid" :value="p.uid">{{p.name}}</option></select><label>Chips<input v-model.number="rebuyChips" type="number" min="1" step="1"></label><button :disabled="locked || !rebuyTarget || !Number.isSafeInteger(rebuyChips) || rebuyChips<=0 || !!room.settings.buyInCents && !Number.isSafeInteger(rebuyChips*room.settings.buyInCents/room.settings.stack)" @click="send('rebuy',{targetUid:rebuyTarget,chips:rebuyChips})">{{room.settings.buyInCents ? `${money(rebuyChips*room.settings.buyInCents/room.settings.stack)} buchen` : 'Chips gutschreiben'}}</button></div></details>
      <details v-if="cash" class="panel cash-panel" :open="showCash" @toggle="showCash=($event.target as HTMLDetailsElement).open"><summary>Cash-Abrechnung & Zahlungen</summary><p>Verteilung der Einzahlungen nach aktuellem Chipstand. Nur an Handgrenzen verbindlich.</p><ul><li v-for="row in cash.rows" :key="row.uid"><strong>{{row.name}}</strong><span>{{row.chips.toLocaleString('de-DE')}} Chips · eingezahlt {{money(row.paidCents)}}</span><b>{{row.netCents>=0?'+':''}}{{money(row.netCents)}}</b></li></ul><h3>Zahlungsvorschlag</h3><ol><li v-for="(transfer,index) in cash.transfers" :key="index">{{game.players[transfer.from]?.name}} → {{game.players[transfer.to]?.name}}: {{money(transfer.cents)}}</li></ol><p v-if="!cash.transfers.length">Alle sind ausgeglichen.</p></details>
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
        <div v-if="me?.host && room.lastPayout?.handId === game.handId" class="undo-payout"><button v-if="!undoConfirm" :disabled="locked" @click="undoConfirm=true">Auszahlung korrigieren</button><template v-else><p>Die Auszahlung dieser Hand zurücknehmen und Gewinner neu wählen?</p><button :disabled="locked" @click="send('undoPayout'); undoConfirm=false">Ja, zurücknehmen</button><button @click="undoConfirm=false">Abbrechen</button></template></div>
        <p v-if="timerEnabled && timerDue && !timerAtCap" class="next-blind-note">{{nextStep?.kind==='break' ? 'Als Nächstes beginnt eine Pause.' : `Nächste Hand mit ${nextBlinds?.sb} / ${nextBlinds?.bb} Blinds · Level ${(room.blindClock?.level || 1) + 1}`}}</p>
        <button v-if="me?.host && players.filter(p => p.stack > 0 && !p.sittingOut).length >= 2" class="primary control-button" :disabled="locked" @click="send('nextHand')">Nächste Hand vorbereiten</button>
        <p v-else-if="players.filter(p => p.stack > 0 && !p.sittingOut).length < 2">Es müssen mindestens zwei Spieler mit Chips aktiv sein, bevor die nächste Hand beginnt.</p>
        <p v-else>Warte auf die nächste Hand.</p>
      </div>
      <div v-if="game.turn" class="actionbar">
        <p class="turn-label" aria-live="polite">{{pending ? 'Aktion wird übertragen …' : myTurn ? 'Du bist am Zug' : 'Warte auf ' + activeName}}</p>
        <span v-if="turnSeconds !== null" class="turn-time-hint" :class="{urgent: turnSeconds <= 10}">{{turnSeconds === 0 ? 'Automatisches Passen …' : 'Automatisch passen in ' + turnTime}}</span>
        <button v-if="myTurn && (me?.timeBank ?? 2) > 0" class="time-bank-button" :disabled="locked || !canAct" @click="send('timeBank')">+30 Sek. Zeitreserve · {{me?.timeBank ?? 2}} übrig</button>
        <div class="bet-controls"><label>{{game.highestBet ? 'Erhöhen auf' : 'Setzen'}}<input v-model.number="bet" type="number" :min="minimumBet" :max="maximumBet" step="1" :disabled="locked || !canAct || !canRaise || maximumBet < minimumBet"></label><button :disabled="locked || !canAct || !canRaise || !validBet" @click="act({kind: game.highestBet ? 'raise' : 'bet', to: bet})">{{game.highestBet ? 'Erhöhen' : 'Setzen'}}</button></div>
        <div class="action-buttons">
          <button :disabled="locked || !canAct" @click="act({kind: 'fold'})">Passen</button>
          <button v-if="callAmount === 0" class="primary" :disabled="locked || !canAct" @click="act({kind: 'check'})">Check</button>
          <button v-else class="primary" :disabled="locked || !canAct" @click="act({kind: 'call'})">Mitgehen {{callAmount}}</button>
          <button :disabled="locked || !canAct || !canAllIn" @click="act({kind: 'all-in'})">All-in {{player?.stack || 0}}</button>
        </div>
      </div>
      <details class="panel hand-history"><summary>Handverlauf · letzte {{recentHistory.length}} Ereignisse</summary><ol><li v-for="entry in recentHistory" :key="entry.version"><span>{{entry.handId ? 'Hand ' + entry.handId : 'Lobby'}} · {{new Date(entry.at).toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'})}}</span><strong>{{eventText(entry)}}</strong></li></ol></details>
    </div>
  </section>
</template>
