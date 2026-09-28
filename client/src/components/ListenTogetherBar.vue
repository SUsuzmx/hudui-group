<script setup>
// 聊天页迷你「一起听」状态条
import { computed } from 'vue';
import { listenTogether, control, leaveRoom } from '../listen-together.js';

const emit = defineEmits(['open-room']);

const room = computed(() => listenTogether.state.room);
const playing = computed(() => Boolean(room.value?.playing));
const title = computed(() => room.value?.current?.title || '一起听');
const host = computed(() => room.value?.members?.find((m) => m.isHost)?.nickname || '主持人');
const count = computed(() => room.value?.members?.filter((m) => m.online).length || 0);
const canControl = computed(() => listenTogether.canControl);

function onToggle() {
  if (!canControl.value) return;
  control(playing.value ? 'pause' : 'play');
}
</script>

<template>
  <div v-if="room" class="lt-bar" role="status">
    <button class="lt-bar-main" type="button" @click="emit('open-room')">
      <span class="lt-bar-icon">{{ playing ? '♪' : '⏸' }}</span>
      <span class="lt-bar-text">
        <span class="lt-bar-title">一起听 · {{ title }}</span>
        <span class="lt-bar-sub">{{ host }}主持 · {{ count }} 人</span>
      </span>
    </button>
    <button class="lt-bar-btn" type="button" :disabled="!canControl" @click="onToggle">
      {{ playing ? '暂停' : '播放' }}
    </button>
    <button class="lt-bar-btn ghost" type="button" @click="leaveRoom()">退出</button>
  </div>
</template>

<style scoped>
.lt-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: linear-gradient(90deg, #e0f7fa, #a7f3d0);
  border-bottom: 1px solid rgba(20, 120, 110, 0.12);
}
.lt-bar-fixed-top {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 120;
  padding-top: calc(6px + env(safe-area-inset-top, 0px));
  box-shadow: 0 2px 8px rgba(20, 120, 110, 0.12);
}
.lt-bar-main {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  padding: 4px 0;
  min-width: 0;
  text-align: left;
}
.lt-bar-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4fd1c5, #22d3ee);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}
.lt-bar-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.lt-bar-title {
  font-size: 12px;
  color: #0b1f1c;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}
.lt-bar-sub {
  font-size: 10px;
  color: #5b756f;
}
.lt-bar-btn {
  border: 0;
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 11px;
  background: linear-gradient(135deg, #4fd1c5, #22d3ee);
  color: #fff;
  font-weight: 600;
}
.lt-bar-btn.ghost {
  background: rgba(255, 255, 255, 0.75);
  color: #0d9488;
}
.lt-bar-btn:disabled {
  opacity: 0.5;
}
</style>
