<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';

const msg = ref('');
let timer = null;
let hideTimer = null;

function show(text, ms = 2200) {
  msg.value = String(text || '');
  clearTimeout(timer);
  clearTimeout(hideTimer);
  timer = setTimeout(() => {
    msg.value = '';
  }, ms);
}

onMounted(() => {
  window.__huduiToast = show;
});
onBeforeUnmount(() => {
  if (window.__huduiToast === show) window.__huduiToast = null;
  clearTimeout(timer);
  clearTimeout(hideTimer);
});
</script>

<template>
  <Transition name="toast">
    <div v-if="msg" class="toast-host">{{ msg }}</div>
  </Transition>
</template>

<style scoped>
.toast-host {
  position: fixed;
  left: 50%;
  bottom: 22%;
  transform: translateX(-50%);
  z-index: 5000;
  max-width: 80vw;
  padding: 10px 16px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.78);
  color: #fff;
  font-size: 14px;
  line-height: 1.4;
  text-align: center;
  pointer-events: none;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}
.toast-enter-active, .toast-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
