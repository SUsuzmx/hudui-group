<script setup>
import { computed } from 'vue';

const props = defineProps({
  session: { type: Object, default: null },
  seconds: { type: Number, default: 0 },
});
const emit = defineEmits(['restore', 'hangup']);

const label = computed(() => {
  const n = props.session?.target?.nickname || '对方';
  const mode = props.session?.callMode === 'voice' ? '语音' : '视频';
  return `${n} · ${mode}通话`;
});

const timeText = computed(() => {
  const s = Math.max(0, Number(props.seconds) || 0);
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const r = String(s % 60).padStart(2, '0');
  return `${m}:${r}`;
});
</script>

<template>
  <div v-if="session" class="call-float" role="status" aria-label="通话中">
    <button class="cf-main" type="button" @click="emit('restore')">
      <span class="cf-dot"></span>
      <span class="cf-time">{{ timeText }}</span>
      <span class="cf-name">{{ label }}</span>
      <span class="cf-back">返回通话</span>
    </button>
    <button class="cf-end" type="button" aria-label="挂断" @click="emit('hangup')">挂断</button>
  </div>
</template>

<style scoped>
.call-float {
  position: fixed;
  left: 12px;
  right: 12px;
  top: calc(8px + env(safe-area-inset-top, 0px));
  z-index: 4500;
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.cf-main {
  pointer-events: auto;
  flex: 1;
  min-height: 48px;
  border: 0;
  border-radius: 24px;
  background: rgba(7, 193, 96, 0.96);
  color: #fff;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  box-shadow: 0 8px 24px rgba(7, 193, 96, 0.35);
  cursor: pointer;
  min-width: 0;
}
.cf-dot {
  width: 8px; height: 8px; border-radius: 50%; background: #c8ffc8;
  flex-shrink: 0; animation: cfPulse 1.2s ease infinite;
}
@keyframes cfPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.85); }
}
.cf-time {
  font-variant-numeric: tabular-nums; font-weight: 600; font-size: 14px;
  flex-shrink: 0;
}
.cf-name {
  flex: 1; min-width: 0; font-size: 13px; text-align: left;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  opacity: 0.95;
}
.cf-back { font-size: 12px; opacity: 0.85; flex-shrink: 0; }
.cf-end {
  pointer-events: auto;
  border: 0;
  border-radius: 24px;
  background: #e64340;
  color: #fff;
  min-height: 48px;
  padding: 0 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 16px rgba(230, 67, 64, 0.3);
}
</style>
