<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';

const offline = ref(typeof navigator !== 'undefined' ? !navigator.onLine : false);

function setOffline() {
  offline.value = !navigator.onLine;
}
function retry() {
  if (navigator.onLine) {
    offline.value = false;
    location.reload();
  } else {
    offline.value = true;
  }
}

onMounted(() => {
  window.addEventListener('online', setOffline);
  window.addEventListener('offline', setOffline);
});
onBeforeUnmount(() => {
  window.removeEventListener('online', setOffline);
  window.removeEventListener('offline', setOffline);
});
</script>

<template>
  <div v-if="offline" class="offline-bar" role="status">
    <span class="dot" />
    <span class="text">网络已断开 · 聊天与在线音乐暂不可用</span>
    <button type="button" class="retry" @click="retry">重试</button>
  </div>
</template>

<style scoped>
.offline-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: calc(8px + var(--safe-t, 0px)) 12px 8px;
  background: #fff7e8;
  color: #8a5a00;
  font-size: 12px;
  border-bottom: 0.5px solid rgba(138, 90, 0, 0.15);
  z-index: 200;
  flex-shrink: 0;
}
.dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #f5a623; flex-shrink: 0;
}
.text { flex: 1; min-width: 0; line-height: 1.4; }
.retry {
  border: 0;
  border-radius: 999px;
  padding: 6px 12px;
  background: rgba(245, 166, 35, 0.18);
  color: #8a5a00;
  font-size: 12px;
  min-height: 32px;
}
</style>
