<script setup lang="ts">
interface TableSeat {
  seat: number; uid: string; name: string; ready?: boolean; stack?: number
  roundBet?: number; folded?: boolean; allIn?: boolean; sittingOut?: boolean
}
const props = defineProps<{
  seats: TableSeat[]; myUid: string; lobby?: boolean; locked?: boolean
  turn?: string | null; dealer?: number; smallBlind?: number; bigBlind?: number
}>()
defineEmits<{select: [seat: number]}>()
const at = (seat: number) => props.seats.find(player => player.seat === seat)
function position(seat: number) {
  const angle = seat * Math.PI * 2 / 9 - Math.PI / 2
  return {'--seat-x': Math.cos(angle), '--seat-y': Math.sin(angle)}
}
function label(seat: number) {
  const player = at(seat)
  if (!player) return `Platz ${seat + 1}: frei – hier sitzen`
  return `Platz ${seat + 1}: ${player.name}${player.uid === props.myUid ? ', dein Platz' : ', belegt'}${props.lobby ? player.ready ? ', bereit' : ', noch nicht bereit' : ''}`
}
</script>

<template>
  <div class="poker-table" :class="{'lobby-table': lobby}" :aria-label="lobby ? 'Sitzplätze im Uhrzeigersinn' : 'Pokertisch'">
    <div class="table-felt"><div class="table-center"><slot /></div></div>
    <component :is="lobby ? 'button' : 'div'" v-for="seat in 9" :key="seat"
      class="table-seat" :class="{occupied: at(seat - 1), mine: at(seat - 1)?.uid === myUid, ready: lobby && at(seat - 1)?.ready, 'on-turn': !lobby && at(seat - 1)?.uid === turn, folded: at(seat - 1)?.folded, empty: !at(seat - 1)}"
      :style="position(seat - 1)" :aria-label="label(seat - 1)"
      :aria-pressed="lobby ? at(seat - 1)?.uid === myUid : undefined"
      :disabled="lobby ? locked || !!at(seat - 1) : undefined"
      @click="lobby && !locked && !at(seat - 1) && $emit('select', seat - 1)">
      <span class="seat-number">{{seat.toString().padStart(2, '0')}}{{at(seat - 1)?.uid === myUid ? ' · DU' : ''}}</span>
      <template v-if="at(seat - 1)">
        <strong class="seat-name" :title="at(seat - 1)!.name">{{at(seat - 1)!.name}}</strong>
        <span v-if="lobby" class="seat-detail">{{at(seat - 1)!.ready ? '✓ Bereit' : at(seat - 1)!.uid === myUid ? 'Dein Platz' : 'Am Tisch'}}</span>
        <span v-else class="seat-stack">{{at(seat - 1)!.stack?.toLocaleString('de-DE')}} <span>Chips</span></span>
        <span v-if="!lobby" class="seat-markers">
          <span v-if="seat - 1 === dealer" class="position-marker dealer-marker" title="Dealer">D</span>
          <span v-if="seat - 1 === smallBlind" class="position-marker small-marker" title="Small Blind">SB</span>
          <span v-if="seat - 1 === bigBlind" class="position-marker big-marker" title="Big Blind">BB</span>
          <span v-if="at(seat - 1)!.sittingOut" class="seat-status">Setzt aus</span>
          <span v-else-if="at(seat - 1)!.folded" class="seat-status">Gepasst</span>
          <span v-else-if="at(seat - 1)!.allIn" class="seat-status">All-in</span>
          <span v-else-if="at(seat - 1)!.stack === 0" class="seat-status">Keine Chips</span>
          <span v-else-if="at(seat - 1)!.uid === turn" class="seat-status">Am Zug</span>
        </span>
        <span v-if="!lobby && at(seat - 1)!.roundBet" :key="at(seat - 1)!.roundBet" class="seat-bet" :aria-label="'Einsatz: ' + at(seat - 1)!.roundBet"><i aria-hidden="true"></i>{{at(seat - 1)!.roundBet?.toLocaleString('de-DE')}}</span>
      </template>
      <template v-else><strong class="seat-name">{{lobby ? '+ Hier sitzen' : 'Frei'}}</strong></template>
    </component>
  </div>
</template>
