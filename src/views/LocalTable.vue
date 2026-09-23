<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {buildPots,type Move} from '../game/engine'
import {blindCountdown} from '../game/blinds'
import PokerTable from '../components/PokerTable.vue'
import {clearLocalRoom,createLocalRoom,localCommand,localTick,readLocalRoom} from '../device/localRoom'

const room=ref(readLocalRoom()),names=ref(['Spieler 1','Spieler 2']),settings=ref({stack:10000,sb:50,bb:100,blindMinutes:20,blindMultiplier:2})
const error=ref(''),now=ref(Date.now()),bet=ref(0),winner=ref<string[][]>([])
let timer:ReturnType<typeof setInterval>|undefined
onMounted(()=>{timer=setInterval(()=>{now.value=Date.now();try{if(room.value)room.value=localTick(room.value,now.value)}catch(cause){error.value=(cause as Error).message}},1000)})
onUnmounted(()=>{if(timer)clearInterval(timer)})
const game=computed(()=>room.value?.game),players=computed(()=>Object.values(game.value?.players||{}).sort((a,b)=>a.seat-b.seat)),pot=computed(()=>game.value&&!game.value.paid?buildPots(game.value).reduce((sum,p)=>sum+p.amount,0):0),pots=computed(()=>game.value?.phase==='showdown'?buildPots(game.value):[])
const current=computed(()=>game.value?.turn?game.value.players[game.value.turn]:null)
const callAmount=computed(()=>current.value&&game.value?Math.min(current.value.stack,Math.max(0,game.value.highestBet-current.value.roundBet)):0)
const minBet=computed(()=>game.value?game.value.highestBet<game.value.bb?game.value.bb:game.value.highestBet+game.value.minRaise:0)
const maxBet=computed(()=>current.value?current.value.stack+current.value.roundBet:0)
const turnTime=computed(()=>blindCountdown(room.value?.turnClock?.deadline||now.value,now.value))
const blindTime=computed(()=>blindCountdown(room.value?.blindClock?.nextIncreaseAt||now.value,now.value))
const phaseLabel=computed(()=>({ 'waiting-deal':'Karten austeilen',preflop:'Preflop','waiting-flop':'Flop aufdecken',flop:'Flop','waiting-turn':'Turn aufdecken',turn:'Turn','waiting-river':'River aufdecken',river:'River',showdown:'Showdown',settled:'Hand beendet'} as Record<string,string>)[game.value?.phase||'']||'Spiel')
watch(()=>JSON.stringify([game.value?.handId,pots.value]),()=>{winner.value=pots.value.map(p=>p.eligible.length===1?[...p.eligible]:[])},{immediate:true})
function start(){try{room.value=createLocalRoom(names.value,settings.value);error.value=''}catch(cause){error.value=(cause as Error).message}}
function send(uid:string,type:string,data:Record<string,unknown>={}){if(!room.value)return;try{room.value=localCommand(room.value,uid,type,data);error.value='';if(type==='nextHand')winner.value=[]}catch(cause){error.value=(cause as Error).message}}
function move(move:Move){if(current.value)send(current.value.uid,'act',{move})}
function payout(){if(pots.value.length&&pots.value.every((p,index)=>winner.value[index]?.length&&winner.value[index].every(uid=>p.eligible.includes(uid))))send('local-0','payout',{winners:winner.value})}
function reset(){if(window.confirm('Lokalen Tisch wirklich löschen? Dieser Spielstand ist danach weg.')){clearLocalRoom();room.value=null;error.value=''}}
</script>
<template>
  <section class="local-page"><div class="local-top"><div><small>POKER CHIPS · OHNE INTERNET</small><h1>Ein Gerät, ein Tisch.</h1><p>Eine Person verwaltet alle Einsätze auf diesem Gerät. Der Spielstand bleibt lokal gespeichert.</p></div><router-link to="/">Zur Startseite</router-link></div>
    <p v-if="error" class="error" role="alert">{{error}}</p>
    <div v-if="!room" class="panel local-setup"><h2>Runde vorbereiten</h2><div class="local-names"><label v-for="(_,index) in names" :key="index">Spieler {{index+1}}<input v-model="names[index]" minlength="2" maxlength="24"></label></div><div class="share-actions"><button :disabled="names.length>=9" @click="names.push(`Spieler ${names.length+1}`)">+ Spieler</button><button :disabled="names.length<=2" @click="names.pop()">− Spieler</button></div><div class="twocol"><label>Startstack<input v-model.number="settings.stack" type="number" min="1"></label><label>Small Blind<input v-model.number="settings.sb" type="number" min="1"></label><label>Big Blind<input v-model.number="settings.bb" type="number" min="2"></label><label>Blind-Minuten<input v-model.number="settings.blindMinutes" type="number" min="0" max="180"></label></div><button class="primary" @click="start">Lokalen Tisch starten</button></div>
    <template v-else-if="game"><div class="local-status"><span>Hand {{game.handId}} · {{phaseLabel}}</span><span>Blinds {{game.sb}} / {{game.bb}} <template v-if="room.blindClock?.nextIncreaseAt">· Level in {{blindTime}}</template></span><button @click="reset">Tisch löschen</button></div><PokerTable :seats="players" my-uid="" :turn="game.turn" :dealer="game.dealer"><span class="felt-eyebrow">LOKALER POT</span><strong class="pot-chip">{{pot.toLocaleString('de-DE')}}</strong><span class="felt-caption">CHIPS</span></PokerTable>
      <div class="panel local-controls"><div v-if="room.pausedAt" class="pause-notice">Pausiert <button @click="send('local-0','resume')">Fortsetzen</button></div><button v-else @click="send('local-0','pause')">⏸ Pausieren</button>
      <template v-if="game.phase==='waiting-deal'"><h2>Karten austeilen</h2><button class="primary" :disabled="!!room.pausedAt" @click="send('local-0','deal')">Hand starten & Blinds buchen</button></template>
      <template v-else-if="['waiting-flop','waiting-turn','waiting-river'].includes(game.phase)"><h2>Gemeinschaftskarten</h2><button class="primary" :disabled="!!room.pausedAt" @click="send('local-0','reveal')">Karten aufgedeckt – weiter</button></template>
      <template v-else-if="current"><h2>{{current.name}} ist am Zug · {{turnTime}}</h2><div class="local-actions"><button :disabled="!!room.pausedAt" @click="move({kind:'fold'})">Passen</button><button v-if="callAmount===0" :disabled="!!room.pausedAt" @click="move({kind:'check'})">Check</button><button v-else :disabled="!!room.pausedAt" @click="move({kind:'call'})">Mitgehen {{callAmount}}</button><label>Setzen / Erhöhen auf<input v-model.number="bet" type="number" :min="minBet" :max="maxBet"></label><button :disabled="!!room.pausedAt || bet<minBet || bet>maxBet" @click="move({kind:game.highestBet?'raise':'bet',to:bet})">Buchen</button><button :disabled="!!room.pausedAt" @click="move({kind:'all-in'})">All-in</button><button :disabled="!!room.pausedAt || !(room.members[current.uid].timeBank??2)" @click="send(current.uid,'timeBank')">+30 Sek.</button></div></template>
      <template v-else-if="game.phase==='showdown'"><h2>Gewinner wählen</h2><div v-for="(currentPot,index) in pots" :key="index" class="local-pot"><strong>{{index===0?'Hauptpot':'Nebenpot '+index}} · {{currentPot.amount}} Chips</strong><label v-for="eligible in currentPot.eligible" :key="eligible"><input v-model="winner[index]" type="checkbox" :value="eligible">{{game.players[eligible].name}}</label></div><button class="primary" :disabled="!!room.pausedAt || !pots.every((_,index)=>winner[index]?.length)" @click="payout">Gewinn auszahlen</button></template>
      <template v-else-if="game.phase==='settled'"><h2>Hand beendet</h2><button class="primary" :disabled="!!room.pausedAt" @click="send('local-0','nextHand')">Nächste Hand</button><button v-if="room.lastPayout" @click="send('local-0','undoPayout')">Auszahlung korrigieren</button></template>
      </div><details class="panel session-recap"><summary>Spielstand & Rückblick</summary><p>{{room.session?.handsCompleted||0}} Hände gespielt · größter Pot {{room.session?.biggestPot||0}} Chips</p><ul><li v-for="player in players" :key="player.uid"><strong>{{player.name}}</strong><span>{{player.stack.toLocaleString('de-DE')}} Chips</span><button v-if="['waiting-deal','settled'].includes(game.phase)" @click="send(player.uid,'sitOut',{sittingOut:!player.sittingOut})">{{player.sittingOut?'Mitspielen':'Aussetzen'}}</button></li></ul></details>
    </template>
  </section>
</template>
