<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue'
const {needRefresh, updateServiceWorker} = useRegisterSW()
</script>
<template>
  <header><router-link to="/" class="brand"><span class="logo">PC</span><strong>Poker Chips</strong></router-link><span class="online">Poker mit Freunden</span></header>
  <div v-if="needRefresh" class="connection" role="status">Eine neue Version ist verfügbar. Lade sie am besten zwischen zwei Händen. <button @click="updateServiceWorker(true)">Neue Version laden</button></div>
  <main><router-view :key="$route.fullPath"/></main>
</template>
