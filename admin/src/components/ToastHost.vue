<script setup>
import { ref } from 'vue';
import { toasts } from '../utils.js';

function cls(t) {
  return {
    error: 'error',
    ok: 'ok',
    warn: 'warn',
  }[t.type] || '';
}
</script>

<template>
  <div class="toast-host">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="cls(t)">{{ t.message }}</div>
  </div>
</template>
