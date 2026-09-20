<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { musicPlayer, fmtAudioTime } from '../music-player.js';
import { toast } from '../toast.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
});
const emit = defineEmits(['open-listen']);

const pos = ref({ x: 0, y: 0 });
const dragging = ref(false);
const moved = ref(false);
const showTrash = ref(false);
const overTrash = ref(false);
const dismissing = ref(false);

let start = { x: 0, y: 0, ox: 0, oy: 0 };
let pointerId = null;
let longPressTimer = null;

const LONG_PRESS_MS = 420;

function snapX(x) {
  const w = window.innerWidth || 375;
  const size = 64;
  const pad = 8;
  const min = pad;
  const max = Math.max(min, w - size - pad);
  const mid = (min + max) / 2;
  return x < mid ? min : max;
}

function clamp(x, y) {
  const w = window.innerWidth || 375;
  const h = window.innerHeight || 667;
  const size = 64;
  return {
    x: Math.min(Math.max(8, x), Math.max(8, w - size - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, h - size - 8)),
  };
}

function defaultPos() {
  const h = window.innerHeight || 667;
  return clamp(8, h * 0.55);
}

function trashRect() {
  const w = window.innerWidth || 375;
  const h = window.innerHeight || 667;
  const cx = w / 2;
  const cy = h - 72;
  return { cx, cy, r: 72 };
}

function floatCenter() {
  return {
    x: pos.value.x + 84,
    y: pos.value.y + 28,
  };
}

function hitTrash() {
  const t = trashRect();
  const c = floatCenter();
  const dx = c.x - t.cx;
  const dy = c.y - t.cy;
  return Math.hypot(dx, dy) <= t.r;
}

function clearLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function onPointerDown(e) {
  if (dismissing.value) return;
  dragging.value = true;
  moved.value = false;
  pointerId = e.pointerId;
  start = {
    x: e.clientX,
    y: e.clientY,
    ox: pos.value.x,
    oy: pos.value.y,
  };
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }

  clearLongPress();
  longPressTimer = setTimeout(() => {
    // 长按：底部出现微红渐变手电筒 + 垃圾桶
    showTrash.value = true;
    overTrash.value = hitTrash();
  }, LONG_PRESS_MS);
}

function onPointerMove(e) {
  if (!dragging.value || (pointerId != null && e.pointerId !== pointerId)) return;
  const dx = e.clientX - start.x;
  const dy = e.clientY - start.y;
  if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
    moved.value = true;
    // 拖动时若尚未出现垃圾桶，不强制打断；长按后即可拖入
  }
  const next = clamp(start.ox + dx, start.oy + dy);
  pos.value = next;
  if (showTrash.value) {
    overTrash.value = hitTrash();
  }
}

function dismissFloat() {
  dismissing.value = true;
  try { musicPlayer.stopAll(); } catch { /* ignore */ }
  showTrash.value = false;
  overTrash.value = false;
  toast('已关闭播放悬浮窗');
  setTimeout(() => { dismissing.value = false; }, 200);
}

function onPointerUp() {
  clearLongPress();
  if (!dragging.value) {
    showTrash.value = false;
    overTrash.value = false;
    return;
  }
  dragging.value = false;
  pointerId = null;

  if (showTrash.value && overTrash.value) {
    dismissFloat();
    return;
  }

  showTrash.value = false;
  overTrash.value = false;
  const next = clamp(pos.value.x, pos.value.y);
  pos.value = { x: snapX(next.x), y: next.y };
}

function onBodyClick() {
  if (moved.value) {
    moved.value = false;
    return;
  }
  if (showTrash.value) return;
  emit('open-listen');
}

function onResize() {
  pos.value = clamp(pos.value.x, pos.value.y);
  pos.value = { x: snapX(pos.value.x), y: pos.value.y };
}

onMounted(() => {
  pos.value = defaultPos();
  window.addEventListener('resize', onResize);
});

onBeforeUnmount(() => {
  clearLongPress();
  window.removeEventListener('resize', onResize);
});
</script>

<template>
  <!-- 长按后：底部微红渐变手电筒 + 垃圾桶 -->
  <div v-if="visible && musicPlayer.state.current && showTrash" class="trash-layer">
    <div class="flashlight" :class="{ hot: overTrash }">
      <div class="beam"></div>
      <div class="glow"></div>
    </div>
    <div class="trash-zone" :class="{ hot: overTrash }">
      <div class="trash-icon" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="40" height="40">
          <path d="M16 14h16l-1.2 22.5A3 3 0 0 1 27.8 39h-7.6a3 3 0 0 1-3-2.5L16 14z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
          <path d="M13 14h22" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M20 14v-2.5A2.5 2.5 0 0 1 22.5 9h3A2.5 2.5 0 0 1 28 11.5V14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M21 20v12M27 20v12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="trash-label">{{ overTrash ? '松手关闭' : '拖入关闭' }}</div>
    </div>
  </div>

  <div
    v-if="visible && musicPlayer.state.current"
    class="music-float"
    :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    :class="{ dragging, over: overTrash && showTrash }"
  >
    <button
      class="mf-body"
      type="button"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @click="onBodyClick"
    >
      <span class="mf-disc" :class="{ spin: musicPlayer.state.playing }">
        <img
          v-if="musicPlayer.state.current.cover"
          :src="musicPlayer.state.current.cover"
          alt=""
        />
        <span v-else>♪</span>
      </span>
      <span class="mf-meta">
        <span class="mf-title">{{ musicPlayer.state.current.title }}</span>
        <span class="mf-sub">
          {{ showTrash ? (overTrash ? '松手关闭' : '长按关闭区') : (musicPlayer.state.playing ? '播放中' : '已暂停') }}
          <template v-if="!showTrash"> · {{ fmtAudioTime(musicPlayer.state.progress) }}</template>
        </span>
      </span>
    </button>
    <button
      class="mf-toggle"
      type="button"
      :aria-label="musicPlayer.state.playing ? '暂停' : '播放'"
      @pointerdown.stop
      @pointermove.stop
      @pointerup.stop
      @click.stop="musicPlayer.togglePlay()"
    >
      {{ musicPlayer.state.playing ? '❚❚' : '▶' }}
    </button>
  </div>
</template>

<style scoped>
.trash-layer {
  position: fixed;
  inset: 0;
  z-index: 4790;
  pointer-events: none;
}

/* 底部微红渐变手电筒：宽端朝上，窄端射向垃圾桶 */
.flashlight {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: min(72vw, 280px);
  height: 48vh;
  max-height: 360px;
  transform: translateX(-50%);
  display: flex;
  justify-content: center;
  align-items: flex-end;
  pointer-events: none;
}
.flashlight .beam {
  position: absolute;
  left: 50%;
  bottom: 36px;
  width: 100%;
  height: 100%;
  transform: translateX(-50%);
  /* 顶部宽、底部窄，模拟向下照射的光锥 */
  clip-path: polygon(4% 0%, 96% 0%, 62% 100%, 38% 100%);
  background:
    linear-gradient(
      to bottom,
      rgba(255, 96, 96, 0.02) 0%,
      rgba(255, 88, 88, 0.04) 18%,
      rgba(255, 78, 78, 0.07) 42%,
      rgba(255, 68, 68, 0.10) 68%,
      rgba(255, 58, 58, 0.13) 88%,
      rgba(255, 50, 50, 0.15) 100%
    );
  filter: blur(2px);
  opacity: 0.85;
  transition: opacity 160ms ease, filter 160ms ease;
}
/* 外层柔光，让边缘更像真实手电筒 */
.flashlight .beam::before {
  content: '';
  position: absolute;
  inset: 0;
  clip-path: polygon(0% 0%, 100% 0%, 68% 100%, 32% 100%);
  background: linear-gradient(
    to bottom,
    rgba(255, 100, 100, 0.03) 0%,
    rgba(255, 80, 80, 0.05) 40%,
    rgba(255, 70, 70, 0.08) 75%,
    rgba(255, 60, 60, 0.10) 100%
  );
  filter: blur(8px);
  z-index: -1;
}
/* 光柱中心高光 */
.flashlight .beam::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 28%;
  transform: translateX(-50%);
  clip-path: polygon(20% 0%, 80% 0%, 58% 100%, 42% 100%);
  background: linear-gradient(
    to bottom,
    rgba(255, 210, 210, 0.02) 0%,
    rgba(255, 180, 180, 0.04) 50%,
    rgba(255, 140, 140, 0.06) 100%
  );
  filter: blur(3px);
}
.flashlight .glow {
  position: absolute;
  left: 50%;
  bottom: 20px;
  width: 140px;
  height: 72px;
  transform: translateX(-50%);
  background: radial-gradient(
    ellipse at center,
    rgba(255, 72, 72, 0.18) 0%,
    rgba(255, 72, 72, 0.08) 40%,
    rgba(255, 72, 72, 0) 72%
  );
  transition: transform 160ms ease, opacity 160ms ease;
}
.flashlight.hot .beam {
  filter: blur(1.2px);
  opacity: 1;
  background:
    linear-gradient(
      to bottom,
      rgba(255, 80, 80, 0.03) 0%,
      rgba(255, 70, 70, 0.06) 18%,
      rgba(255, 60, 60, 0.10) 42%,
      rgba(255, 50, 50, 0.14) 68%,
      rgba(255, 40, 40, 0.18) 88%,
      rgba(255, 30, 30, 0.22) 100%
    );
}
.flashlight.hot .glow {
  transform: translateX(-50%) scale(1.08);
  opacity: 1;
  background: radial-gradient(
    ellipse at center,
    rgba(255, 60, 60, 0.26) 0%,
    rgba(255, 60, 60, 0.12) 40%,
    rgba(255, 60, 60, 0) 72%
  );
}

.trash-zone {
  position: absolute;
  left: 50%;
  bottom: calc(22px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  width: 96px;
  height: 96px;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: #ffb4b4;
  background: radial-gradient(circle at center, rgba(80, 20, 20, 0.55), rgba(30, 10, 10, 0.2) 70%, transparent 75%);
  border: 1.5px solid rgba(255, 90, 90, 0.28);
  transition: transform 160ms ease, color 160ms ease, border-color 160ms ease, background 160ms ease;
}
.trash-zone.hot {
  color: #fff;
  transform: translateX(-50%) scale(1.08);
  border-color: rgba(255, 70, 70, 0.75);
  background: radial-gradient(circle at center, rgba(160, 30, 30, 0.7), rgba(80, 16, 16, 0.35) 70%, transparent 75%);
  box-shadow: 0 0 24px rgba(255, 60, 60, 0.35);
}
.trash-icon {
  line-height: 0;
  filter: drop-shadow(0 1px 4px rgba(0,0,0,0.35));
}
.trash-label {
  font-size: 11px;
  letter-spacing: 0.5px;
}

.music-float {
  position: fixed;
  z-index: 4800;
  width: 168px;
  min-height: 56px;
  border-radius: 28px;
  background: rgba(28, 28, 30, 0.94);
  color: #fff;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  padding: 6px 8px 6px 6px;
  gap: 4px;
  touch-action: none;
  user-select: none;
}
.music-float.dragging {
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.45);
  transform: scale(1.03);
}
.music-float.over {
  border: 1.5px solid rgba(255, 80, 80, 0.9);
  box-shadow: 0 0 0 4px rgba(255, 60, 60, 0.18), 0 14px 32px rgba(0,0,0,0.45);
  transform: scale(0.92);
  opacity: 0.92;
}
.mf-body {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  text-align: left;
  cursor: grab;
}
.mf-disc {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  background: #3a3a3c;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 16px;
}
.mf-disc img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mf-disc.spin {
  animation: mfSpin 8s linear infinite;
}
@keyframes mfSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.mf-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mf-title {
  font-size: 12px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mf-sub {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.7);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mf-toggle {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 0;
  background: #07c160;
  color: #fff;
  font-size: 12px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
