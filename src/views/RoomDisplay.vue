<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {watchRoom,firebaseError} from '../online/firebase'
import {blindPositions,buildPots,tableChampion} from '../game/engine'
import PokerTable from '../components/PokerTable.vue'
import ChampionCelebration from '../components/ChampionCelebration.vue'
import type {RoomState} from '../game/roomCore'
const id=String(useRoute().params.id),router=useRouter()
const room=ref<RoomState|null>(null),error=ref(''),connected=ref(false)
let stop:(()=>void)|undefined,disposed=false
onMounted(async()=>{try{const unsubscribe=await watchRoom<RoomState>(id,{room:value=>{room.value=value;if(!value)error.value='Tisch nicht gefunden oder kein Zugriff.'},connection:value=>connected.value=value,error:cause=>error.value=firebaseError(cause)});if(disposed)unsubscribe();else stop=unsubscribe}catch(cause){error.value=firebaseError(cause)}})
onUnmounted(()=>{disposed=true;stop?.()})
const game=computed(()=>room.value?.game)
const seats=computed(()=>Object.values(game.value?.players||{}))
const pot=computed(()=>game.value&&!game.value.paid?buildPots(game.value).reduce((sum,p)=>sum+p.amount,0):0)
const active=computed(()=>game.value?.turn?game.value.players[game.value.turn]?.name:'')
const blindSeats=computed(()=>game.value?blindPositions(game.value):{small:undefined,big:undefined})
const champion=computed(()=>game.value?tableChampion(game.value):null)
const phaseHint=computed(()=>({'waiting-flop':'Flop: erste drei Karten aufdecken','waiting-turn':'Turn: vierte Karte aufdecken','waiting-river':'River: fünfte Karte aufdecken'} as Record<string,string>)[game.value?.phase||'']||'Karten werden bestätigt')
</script>
<template>
  <section class="display-screen"><div class="display-top"><div><small>POKER CHIPS · TISCH {{id}}</small><h1>Live am Tisch</h1></div><div class="display-top-actions"><span>{{connected?'● Live':'○ Offline'}}</span><button @click="router.back()">Zurück</button></div></div>
    <div v-if="error" class="panel" role="alert">{{error}}</div><div v-else-if="!game" class="panel" role="status">{{room?'Das Spiel startet gleich.':'Tisch wird geladen …'}}</div>
    <template v-else><div class="display-strip"><strong>Hand {{game.handId}}</strong><span>Blinds {{game.sb.toLocaleString('de-DE')}} / {{game.bb.toLocaleString('de-DE')}}</span><span v-if="game.ante">Ante {{game.ante}}</span><span>{{game.phase==='settled'?'Hand beendet':active?active+' ist am Zug':phaseHint}}</span></div>
      <PokerTable :seats="seats" my-uid="" :turn="game.turn" :dealer="game.dealer" :small-blind="blindSeats.small" :big-blind="blindSeats.big"><span class="felt-eyebrow">LIVE-POT</span><strong class="pot-chip">{{pot.toLocaleString('de-DE')}}</strong><span class="felt-caption">CHIPS</span></PokerTable>
      <p v-if="blindSeats.small === game.dealer && blindSeats.big !== undefined" class="heads-up-note">Zu zweit: Dealer = Small Blind · Big Blind handelt ab dem Flop zuerst.</p>
      <div class="display-stacks"><div v-for="player in seats" :key="player.uid"><span>{{player.name}}</span><strong>{{player.stack.toLocaleString('de-DE')}}</strong><small>{{player.sittingOut?'Setzt aus':player.folded?'Gepasst':player.uid===game.turn?'Am Zug':'Chips'}}</small></div></div>
    </template>
    <ChampionCelebration :room-id="id" :hand-id="game?.handId || 0" :champion="champion" />
  </section>
</template>
