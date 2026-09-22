<script setup lang="ts">
import AppSettings from './components/AppSettings.vue'
</script>
<template>
  <header><router-link to="/" class="brand"><span class="logo">PC</span><strong>Poker Chips</strong></router-link><AppSettings /></header>
  <main><router-view :key="$route.fullPath"/></main>
</template>
