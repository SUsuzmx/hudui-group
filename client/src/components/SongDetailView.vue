<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { musicPlayer, fmtAudioTime } from '../music-player.js';
import {
  initVisualStage, ensureStageGestures, syncTrackToVisual, setVisualPreset, setFxField,
  startVisualWatch, stopVisualWatch, getVisualStageError,
  ensureDefaultPreset, ensureAudioAudible, PRESET_LIST,
} from '../visual-stage.js';

const emit = defineEmits(['close']);
const showQueue = ref(false);
const showFx = ref(false);
const stageReady = ref(false);
const stageError = ref('');
const presetId = ref(0);
const fxIntensity = ref(1);
const fxDepth = ref(1);
const fxSpeed = ref(1);
const fxPoint = ref(1);
const currentLine = ref('');
const seeking = ref(false);
const seekPct = ref(0);

const current = computed(() => musicPlayer.state.current);
const playing = computed(() => musicPlayer.state.playing);
const progress = computed(() => musicPlayer.state.progress);
const duration = computed(() => musicPlayer.state.duration);
const tracks = computed(() => musicPlayer.state.tracks);
const sourceLabel = computed(() => (current.value?.source === 'netease' ? '网易云' : 'QQ'));
const displayPct = computed(() => {
  if (seeking.value) return seekPct.value;
  return duration.value ? Math.min(100, Math.max(0, (progress.value / duration.value) * 100)) : 0;
});

function onSeekInput(e) { seeking.value = true; seekPct.value = Number(e.target.value); }
function onSeekDone(e) {
  const d = duration.value || 0;
  if (d) musicPlayer.seek((Number(e.target.value) / 100) * d);
  seeking.value = false;
}
function playFromQueue(t) { showQueue.value = false; musicPlayer.playTrack(t); }
function isActive(t) { return current.value && current.value.id === t.id && current.value.source === t.source; }
function applyPreset(id) {
  try {
    presetId.value = setVisualPreset(id);
  } catch (e) {
    console.warn('[preset]', e);
    presetId.value = id;
  }
}
function onFx(key, e) {
  const v = Number(e.target.value);
  if (key === 'intensity') fxIntensity.value = v;
  if (key === 'depth') fxDepth.value = v;
  if (key === 'speed') fxSpeed.value = v;
  if (key === 'point') fxPoint.value = v;
  setFxField(key, v);
}
function pollCurrentLyric() {
  try {
    const lines = window.lyricsLines;
    const el = window.audio;
    if (!Array.isArray(lines) || !lines.length || !el) { currentLine.value = ''; return; }
    window.playing = !!(el && !el.paused && !el.ended);
    const t = el.currentTime || 0;
    let idx = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (Number(lines[i]?.t) <= t + 0.05) idx = i; else break;
    }
    currentLine.value = idx >= 0 ? (lines[idx]?.text || '') : '';
  } catch { currentLine.value = ''; }
}
let lyricTimer = 0;
async function bootStage() {
  try {
    await initVisualStage();
    ensureStageGestures();
    stageReady.value = true;
    presetId.value = ensureDefaultPreset();
    if (current.value) syncTrackToVisual(current.value);
    startVisualWatch();
    lyricTimer = setInterval(pollCurrentLyric, 200);
    pollCurrentLyric();
    ensureAudioAudible();
  } catch (e) {
    stageReady.value = false;
    stageError.value = (e && e.message) || getVisualStageError() || '视觉引擎加载失败';
  }
}
watch(current, (t) => { if (t) syncTrackToVisual(t); });
watch(playing, (p) => { window.playing = p; if (p) ensureAudioAudible(); });
onMounted(() => { musicPlayer.ensureAudio(); bootStage(); });
onBeforeUnmount(() => { stopVisualWatch(); if (lyricTimer) clearInterval(lyricTimer); });
</script>

<template>
  <div v-if="current" class="player-stage">
    <div class="visual-stage-root" aria-hidden="true">
      <div id="custom-bg"><video id="custom-bg-video" muted loop playsinline></video></div>
      <div id="wallpaper-engine-layer">
        <img id="wallpaper-engine-image" alt="" />
        <canvas id="wallpaper-engine-freeze"></canvas>
        <video id="wallpaper-engine-video" muted loop playsinline></video>
      </div>
      <div id="album-bg"></div>
      <div id="album-bg-next"></div>
      <div id="canvas-container"></div>
      <canvas id="splash-canvas"></canvas>
      <img id="thumb-cover" alt="" />
      <div id="ai-depth-chip"><span id="ai-depth-text">…</span></div>
      <div id="cover-crop-modal" style="display:none">
        <div id="cover-crop-stage"><img id="cover-crop-img" alt="" /></div>
        <input id="cover-crop-zoom" type="range" min="1" max="3" step="0.01" value="1" />
        <div id="cover-crop-preview"></div>
      </div>
      <div class="preset-grid" id="preset-grid"></div>
      <div class="lyric-color-grid" id="lyric-color-grid"></div>
    </div>

    <header class="top-chrome">
      <button type="button" class="chrome-btn" @click="emit('close')" title="返回">‹</button>
      <div class="top-title">{{ current.title }}</div>
      <div class="top-spacer"></div>
    </header>

    <button type="button" class="fx-fab" :class="{ on: showFx }" @click="showFx = !showFx" title="视觉控制台">FX</button>
    <div v-if="showFx" class="fx-dock" @pointerdown.stop @click.stop>
      <div class="fx-title">视觉预设</div>
      <div class="preset-grid local-presets">
        <button
          v-for="p in PRESET_LIST"
          :key="p.id"
          type="button"
          class="preset-card"
          :class="{ active: presetId === p.id }"
          @click.stop="applyPreset(p.id)"
        >
          <div class="pc-name">{{ p.name }}</div>
        </button>
      </div>
      <div class="fx-slider-row"><label>强度</label><input type="range" min="0.2" max="2.5" step="0.05" :value="fxIntensity" @input="onFx('intensity', $event)" /></div>
      <div class="fx-slider-row"><label>深度</label><input type="range" min="0.2" max="2.5" step="0.05" :value="fxDepth" @input="onFx('depth', $event)" /></div>
      <div class="fx-slider-row"><label>速度</label><input type="range" min="0.2" max="2.5" step="0.05" :value="fxSpeed" @input="onFx('speed', $event)" /></div>
      <div class="fx-slider-row"><label>粒子</label><input type="range" min="0.2" max="2.5" step="0.05" :value="fxPoint" @input="onFx('point', $event)" /></div>
    </div>

    <div v-if="currentLine" class="lyric-float">{{ currentLine }}</div>

    <div v-if="showQueue" class="mini-queue-popover" @pointerdown.stop @click.stop>
      <div class="mini-queue-head">
        <div>
          <div class="mini-queue-title">当前队列</div>
          <div class="mini-queue-count">{{ tracks.length }} 首</div>
        </div>
        <button type="button" class="mini-queue-close" @click="showQueue = false">×</button>
      </div>
      <div class="mini-queue-list">
        <button
          v-for="t in tracks"
          :key="t.source + '-' + t.id"
          type="button"
          class="queue-item"
          :class="{ active: isActive(t) }"
          @click="playFromQueue(t)"
        >
          <span class="q-title">{{ t.title }}</span>
          <span class="q-sub">{{ t.artist }}</span>
        </button>
      </div>
    </div>

    <div class="bottom-bar">
      <div class="progress-bar" :class="{ 'is-dragging': seeking }">
        <div class="progress-fill" :style="{ width: displayPct + '%' }"></div>
        <div class="progress-thumb" :style="{ left: displayPct + '%' }"></div>
        <input
          class="progress-input"
          type="range"
          min="0"
          max="100"
          step="0.1"
          :value="displayPct"
          @input="onSeekInput"
          @change="onSeekDone"
        />
      </div>
      <div class="controls">
        <div class="control-cluster actions">
          <div class="control-track">
            <div class="control-cover" :class="{ 'cover-empty': !current.cover }">
              <img v-if="current.cover" :src="current.cover" alt="" />
            </div>
            <div class="control-meta">
              <div class="control-title">{{ current.title }}</div>
              <div class="control-artist">{{ current.artist }} · {{ sourceLabel }}</div>
            </div>
          </div>
        </div>
        <div class="control-cluster transport">
          <button type="button" class="ctrl-btn" title="上一首" @click="musicPlayer.prevTrack()">
            <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          <button type="button" id="play-btn" class="ctrl-btn play-btn" :class="{ playing }" title="播放/暂停" @click="musicPlayer.togglePlay()">
            <svg v-if="!playing" width="22" height="22" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            <svg v-else width="22" height="22" fill="currentColor" viewBox="0 0 24 24"><path d="M7 5h3v14H7zm7 0h3v14h-3z"/></svg>
          </button>
          <button type="button" class="ctrl-btn" title="下一首" @click="musicPlayer.nextTrack()">
            <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </button>
          <button type="button" class="ctrl-btn" :class="{ active: showQueue }" title="当前队列" @click="showQueue = !showQueue">
            <svg width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/>
              <path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>
            </svg>
          </button>
        </div>
        <div class="control-cluster modes">
          <div class="time-display">{{ fmtAudioTime(progress) }} / {{ fmtAudioTime(duration || current.duration) }}</div>
        </div>
      </div>
    </div>

    <div v-if="!stageReady" class="stage-status">{{ stageError || '引擎加载中…' }}</div>
  </div>
</template>

<style scoped>
.player-stage {
  position: absolute;
  inset: 0;
  z-index: 40;
  background: #050608;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.92);
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --fc-accent-rgb: 0, 245, 212;
}
.player-stage :deep(.visual-stage-root) {
  pointer-events: auto;
  touch-action: none;
  cursor: grab;
}
.player-stage :deep(.visual-stage-root:active) { cursor: grabbing; }

.top-chrome {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  padding-top: calc(10px + var(--safe-t, 0px));
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.45), transparent);
  pointer-events: none;
}
.top-chrome > * { pointer-events: auto; }
.top-title {
  flex: 1;
  text-align: center;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.6);
}
.top-spacer { width: 40px; }
.chrome-btn {
  min-width: 40px;
  height: 36px;
  border: 0;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  backdrop-filter: blur(10px);
}

.fx-fab {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 32;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.28);
  color: rgba(255, 255, 255, 0.88);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.4px;
  cursor: pointer;
  backdrop-filter: blur(12px) saturate(1.4);
  box-shadow: inset 0 0 2px 1px rgba(255, 255, 255, 0.2), 0 8px 24px rgba(0, 0, 0, 0.25);
}
.fx-fab.on {
  border-color: rgba(var(--fc-accent-rgb), 0.55);
  color: rgb(var(--fc-accent-rgb));
}

.fx-dock {
  position: absolute;
  right: 68px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 34;
  width: min(220px, 58vw);
  max-height: 62%;
  overflow: auto;
  background: rgba(12, 14, 18, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 12px;
  backdrop-filter: blur(18px) saturate(1.3);
  box-shadow: inset 0 0 2px 1px rgba(255, 255, 255, 0.12), 0 16px 40px rgba(0, 0, 0, 0.35);
}
.fx-title { font-size: 12px; font-weight: 700; margin-bottom: 8px; }
.preset-grid.local-presets { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; pointer-events: auto; }
.preset-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 8px 6px;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
}
.preset-card:hover { transform: translateY(-1px); background: rgba(255, 255, 255, 0.08); }
.preset-card.active {
  border-color: rgba(var(--fc-accent-rgb), 0.55);
  background: rgba(var(--fc-accent-rgb), 0.14);
}
.preset-card .pc-name { font-size: 11px; font-weight: 600; line-height: 1.25; }
.fx-slider-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 11px; }
.fx-slider-row label { width: 32px; opacity: 0.7; }
.fx-slider-row input { flex: 1; accent-color: rgb(var(--fc-accent-rgb)); }

.lyric-float {
  position: absolute;
  left: 16px;
  right: 72px;
  bottom: 118px;
  z-index: 26;
  text-align: center;
  font-size: 14px;
  font-weight: 500;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.9);
  pointer-events: none;
  line-height: 1.4;
}

.mini-queue-popover {
  position: absolute;
  left: 50%;
  bottom: 108px;
  transform: translateX(-50%);
  width: min(360px, calc(100vw - 28px));
  max-height: 40vh;
  overflow: hidden;
  z-index: 36;
  display: flex;
  flex-direction: column;
  background: rgba(12, 14, 18, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  backdrop-filter: blur(18px) saturate(1.3);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
}
.mini-queue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 8px;
}
.mini-queue-title { font-size: 13px; font-weight: 700; }
.mini-queue-count { font-size: 11px; opacity: 0.5; margin-top: 2px; }
.mini-queue-close {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 16px;
  cursor: pointer;
}
.mini-queue-list { overflow: auto; padding: 0 8px 8px; }
.queue-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #fff;
  text-align: left;
  cursor: pointer;
}
.queue-item:hover { background: rgba(255, 255, 255, 0.05); }
.queue-item.active { background: rgba(var(--fc-accent-rgb), 0.14); }
.q-title { font-size: 13px; font-weight: 600; }
.q-sub { font-size: 11px; opacity: 0.5; }

.bottom-bar {
  position: absolute;
  left: 50%;
  bottom: 14px;
  bottom: calc(14px + var(--safe-b, 0px));
  transform: translateX(-50%);
  z-index: 30;
  width: min(1080px, calc(100vw - 28px));
  padding: 8px 18px 12px;
  border-radius: 28px;
  background: rgba(0, 0, 0, 0.18);
  border: 0;
  backdrop-filter: blur(14px) saturate(1.6) brightness(1.1);
  -webkit-backdrop-filter: blur(14px) saturate(1.6) brightness(1.1);
  box-shadow:
    inset 0 0 2px 1px rgba(255, 255, 255, 0.28),
    inset 0 0 10px 4px rgba(255, 255, 255, 0.1),
    0 8px 28px rgba(0, 0, 0, 0.22);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-bar {
  position: relative;
  height: 4px;
  margin: 2px 8px 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.12);
  cursor: pointer;
  transition: height 0.18s;
}
.progress-bar:hover,
.progress-bar.is-dragging { height: 6px; }
.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.9), rgba(var(--fc-accent-rgb), 0.75));
  box-shadow: 0 0 12px rgba(var(--fc-accent-rgb), 0.2);
  transition: width 0.12s linear;
}
.progress-thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  transform: translateY(-50%) scale(0.6);
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 10px rgba(var(--fc-accent-rgb), 0.45);
  opacity: 0;
  transition: opacity 0.15s, transform 0.15s;
  pointer-events: none;
}
.progress-bar:hover .progress-thumb,
.progress-bar.is-dragging .progress-thumb {
  opacity: 1;
  transform: translateY(-50%) scale(1);
}
.progress-input {
  position: absolute;
  left: 0;
  right: 0;
  top: -8px;
  bottom: -8px;
  width: 100%;
  height: calc(100% + 16px);
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}
.control-cluster {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.control-cluster.actions { justify-content: flex-start; }
.control-cluster.transport { justify-content: center; gap: 8px; }
.control-cluster.modes { justify-content: flex-end; }

.control-track {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}
.control-cover {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.07);
  box-shadow:
    0 10px 28px rgba(0, 0, 0, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.2),
    inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  flex: 0 0 auto;
}
.control-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.control-cover.cover-empty {
  background-image:
    radial-gradient(circle at 35% 28%, rgba(255, 255, 255, 0.18), transparent 24%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.025));
}
.control-meta {
  min-width: 0;
  max-width: 280px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.control-title {
  font-size: 13.5px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.92);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.control-artist {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.48);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctrl-btn {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 11px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: color 0.15s, background 0.15s, transform 0.15s;
}
.ctrl-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.05);
  transform: translateY(-1px);
}
.ctrl-btn:active { transform: translateY(0) scale(0.96); }
.ctrl-btn.active {
  color: rgba(var(--fc-accent-rgb), 0.95);
}
.play-btn {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.96);
  background: rgba(0, 0, 0, 0.12);
  box-shadow:
    inset 0 0 2px 1px rgba(255, 255, 255, 0.32),
    inset 0 0 10px 4px rgba(255, 255, 255, 0.12),
    0 10px 28px rgba(0, 0, 0, 0.2);
}
.play-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  transform: translateY(-1px) scale(1.02);
}
.play-btn.playing {
  color: rgb(var(--fc-accent-rgb));
}

.time-display {
  min-width: 92px;
  text-align: right;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 0.3px;
  font-variant-numeric: tabular-nums;
}

.stage-status {
  position: absolute;
  top: 56px;
  left: 12px;
  right: 12px;
  z-index: 35;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(80, 20, 20, 0.8);
  font-size: 12px;
  text-align: center;
}

@media (max-width: 720px) {
  .bottom-bar {
    width: calc(100vw - 20px);
    padding: 8px 12px 10px;
    border-radius: 22px;
  }
  .control-cover { width: 44px; height: 44px; border-radius: 10px; }
  .control-meta { max-width: 42vw; }
  .control-title { font-size: 12.5px; }
  .control-artist { font-size: 11px; }
  .ctrl-btn { width: 32px; height: 32px; }
  .play-btn { width: 48px; height: 48px; }
  .time-display { min-width: 72px; font-size: 11px; }
}
@media (max-width: 520px) {
  .time-display { display: none; }
  .control-cluster.modes { display: none; }
  .controls { grid-template-columns: minmax(0, 1fr) max-content; }
}
</style>
