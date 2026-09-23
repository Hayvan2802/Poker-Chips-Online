<script setup lang="ts">
import {computed, nextTick, ref, watch} from 'vue'

const props = defineProps<{
  roomId: string
  handId: number
  champion: {uid: string; name: string; stack: number} | null
}>()
const dismissed = ref('')
const closeButton = ref<HTMLButtonElement | null>(null)
const celebrationId = computed(() => props.champion ? `${props.roomId}:${props.handId}:${props.champion.uid}` : '')
const visible = computed(() => !!props.champion && dismissed.value !== celebrationId.value)
function close() { dismissed.value = celebrationId.value }
watch(visible, async open => { if(open) { await nextTick(); closeButton.value?.focus() } }, {immediate:true})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible && champion" class="champion-overlay" role="dialog" aria-modal="true" aria-labelledby="champion-title" @keydown.esc="close" @click.self="close">
      <div class="champion-sparkles" aria-hidden="true"><i v-for="index in 10" :key="index"></i></div>
      <div class="champion-card">
        <div class="champion-trophy" aria-hidden="true">♛</div>
        <p class="champion-kicker">ALLE CHIPS AN EINEM PLATZ</p>
        <h2 id="champion-title">Pokerabend gewonnen!</h2>
        <p><strong>{{champion.name}}</strong> hat alle Chips am Tisch gewonnen.</p>
        <div class="champion-stack"><span>GEWINNSTACK</span><strong>{{champion.stack.toLocaleString('de-DE')}}</strong><span>CHIPS</span></div>
        <button ref="closeButton" class="champion-continue" @click="close">Zurück zum Tisch</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.champion-overlay{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:20px;background:radial-gradient(circle at 50% 45%,#215548bd,#06111aeF 70%);backdrop-filter:blur(12px);overflow:hidden}
.champion-card{position:relative;width:min(100%,480px);max-height:calc(100vh - 40px);overflow:auto;padding:34px 28px;text-align:center;color:#f2f8f5;background:linear-gradient(155deg,#173947,#0b202e 70%);border:1px solid #dcbd62a6;border-radius:26px;box-shadow:0 30px 100px #000a,0 0 65px #d6aa4240;animation:champion-arrive .65s cubic-bezier(.2,1.3,.4,1) both}
.champion-trophy{display:grid;place-items:center;width:88px;height:88px;margin:0 auto 15px;border-radius:50%;font-size:48px;color:#f4d981;background:radial-gradient(circle,#7b6237,#403b2c 68%,#2a4150 69%);border:3px solid #e7bf59;box-shadow:0 0 0 8px #e8c4671f,0 0 35px #efcf7f88}
.champion-kicker{margin:10px 0;color:#f0d487;font-size:11px;font-weight:800;letter-spacing:.22em}
.champion-card h2{margin:10px 0 14px;font-size:clamp(29px,8vw,43px);line-height:1.08}
.champion-card p{line-height:1.5}.champion-card p strong{color:#8ce1ce}
.champion-stack{display:flex;align-items:baseline;justify-content:center;gap:9px;margin:25px auto;padding:16px 10px;border:1px solid #d0aa5766;border-radius:15px;background:#d3a94915}.champion-stack span{font-size:10px;letter-spacing:.12em;color:#dbca9a}.champion-stack strong{font-size:clamp(25px,7vw,36px);color:#ffe08c}
.champion-continue{width:100%;min-height:50px;border-radius:12px;background:#20a58c;color:#fff;font-weight:800}
.champion-sparkles{position:absolute;inset:0;pointer-events:none}.champion-sparkles i{position:absolute;top:-10%;width:9px;height:17px;border-radius:3px;background:#edc960;animation:champion-fall 3.3s linear infinite}.champion-sparkles i:nth-child(2n){background:#67d7ba}.champion-sparkles i:nth-child(3n){background:#f8f4db}.champion-sparkles i:nth-child(1){left:8%;animation-delay:-.2s}.champion-sparkles i:nth-child(2){left:17%;animation-delay:-1s}.champion-sparkles i:nth-child(3){left:26%;animation-delay:-2.4s}.champion-sparkles i:nth-child(4){left:35%;animation-delay:-.7s}.champion-sparkles i:nth-child(5){left:44%;animation-delay:-1.7s}.champion-sparkles i:nth-child(6){left:53%;animation-delay:-2.9s}.champion-sparkles i:nth-child(7){left:62%;animation-delay:-1.2s}.champion-sparkles i:nth-child(8){left:71%;animation-delay:-2.1s}.champion-sparkles i:nth-child(9){left:80%;animation-delay:-.4s}.champion-sparkles i:nth-child(10){left:89%;animation-delay:-2.6s}
@keyframes champion-fall{to{transform:translateY(120vh) rotate(650deg)}}@keyframes champion-arrive{from{opacity:0;transform:translateY(28px) scale(.86)}to{opacity:1;transform:translateY(0) scale(1)}}
@media(prefers-reduced-motion:reduce){.champion-card,.champion-sparkles i{animation:none}.champion-sparkles{display:none}}
</style>
