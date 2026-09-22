<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { musicPlayer, fmtAudioTime } from '../music-player.js';
import {
  initVisualStage, syncTrackToVisual, setVisualPreset, setFxField,
  startVisualWatch, stopVisualWatch, getVisualStageError,
  ensureDefaultPreset, ensureAudioAudible, PRESET_LIST,
  adoptRendererCanvas,
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
const windowLyricLines = ref(0);
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
function applyPreset(id) { presetId.value = setVisualPreset(id); }
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
    windowLyricLines.value = Array.isArray(lines) ? lines.length : 0;
    window.playing = !!(el && !el.paused && !el.ended);
    if (!Array.isArray(lines) || !lines.length || !el) { currentLine.value = ''; return; }
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
    // 听一听预加载可能留下隐藏 staging 容器，先清掉，保证本页 #canvas-container 唯一
    try {
      document.querySelectorAll('#canvas-container[data-visual-staging]').forEach((n) => n.remove());
    } catch { /* ignore */ }
    await initVisualStage();
    adoptRendererCanvas();
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
      <button type="button" class="chrome-btn" @click="emit('close')">‹</button>
      <div class="top-title">{{ current.title }}</div>
      <button type="button" class="chrome-btn" @click="showQueue = !showQueue">☰</button>
    </header>

    <button type="button" class="fx-fab" :class="{ on: showFx }" @click="showFx = !showFx">FX</button>
    <div v-if="showFx" class="fx-dock">
      <div class="fx-title">视觉预设</div>
      <div class="preset-grid local-presets">
        <button v-for="p in PRESET_LIST" :key="p.id" type="button" class="preset-card" :class="{ active: presetId === p.id }" @click="applyPreset(p.id)">
          <div class="pc-name">{{ p.name }}</div>
        </button>
      </div>
      <div class="fx-slider-row"><label>强度</label><input type="range" min="0.2" max="2.5" step="0.05" :value="fxIntensity" @input="onFx('intensity', $event)" /></div>
      <div class="fx-slider-row"><label>深度</label><input type="range" min="0.2" max="2.5" step="0.05" :value="fxDepth" @input="onFx('depth', $event)" /></div>
      <div class="fx-slider-row"><label>速度</label><input type="range" min="0.2" max="2.5" step="0.05" :value="fxSpeed" @input="onFx('speed', $event)" /></div>
      <div class="fx-slider-row"><label>粒子</label><input type="range" min="0.2" max="2.5" step="0.05" :value="fxPoint" @input="onFx('point', $event)" /></div>
    </div>

    <div class="thumb-wrap">
      <img v-if="current.cover" class="thumb-cover" :src="current.cover" alt="" />
      <div v-else class="thumb-cover">♪</div>
      <div class="thumb-info">
        <div class="thumb-title">{{ current.title }}</div>
        <div class="thumb-artist">{{ current.artist }} · {{ sourceLabel }}</div>
      </div>
    </div>

    <div v-if="currentLine" class="lyric-float">{{ currentLine }}</div>

    <div v-if="showQueue" class="mini-queue-popover">
      <div class="mini-queue-head">
        <div class="mini-queue-title">当前队列 · {{ tracks.length }} 首</div>
        <button type="button" class="mini-queue-close" @click="showQueue = false">×</button>
      </div>
      <button v-for="t in tracks" :key="t.source + '-' + t.id" type="button" class="queue-item" :class="{ active: isActive(t) }" @click="playFromQueue(t)">
        <span class="q-title">{{ t.title }}</span>
        <span class="q-sub">{{ t.artist }}</span>
      </button>
    </div>

    <div class="bottom-bar">
      <div class="progress-bar" :class="{ 'is-dragging': seeking }">
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: displayPct + '%' }"></div>
          <div class="progress-thumb" :style="{ left: displayPct + '%' }"></div>
        </div>
        <input class="progress-input" type="range" min="0" max="100" step="0.1" :value="displayPct" @input="onSeekInput" @change="onSeekDone" />
      </div>
      <div class="controls">
        <div class="control-cluster actions">
          <div class="control-cover"><img v-if="current.cover" :src="current.cover" alt="" /><span v-else>♪</span></div>
          <div class="control-meta">
            <div class="control-title">{{ current.title }}</div>
            <div class="control-artist">{{ current.artist }}</div>
          </div>
        </div>
        <div class="control-cluster transport">
          <button type="button" class="ctl-btn" @click="musicPlayer.prevTrack()">‹‹</button>
          <button type="button" id="play-btn" class="play-btn" :class="{ playing }" @click="musicPlayer.togglePlay()">{{ playing ? '❚❚' : '▶' }}</button>
          <button type="button" class="ctl-btn" @click="musicPlayer.nextTrack()">››</button>
        </div>
        <div class="control-cluster meta-side">
          <div class="time">{{ fmtAudioTime(progress) }} / {{ fmtAudioTime(duration || current.duration) }}</div>
          <div class="lyric-debug">L{{ windowLyricLines }} · P{{ playing ? 1 : 0 }}</div>
        </div>
      </div>
    </div>

    <div v-if="!stageReady" class="stage-status">{{ stageError || '引擎加载中…' }}</div>
  </div>
</template>

<style scoped>
.player-stage { position: absolute; inset: 0; z-index: 40; background: #07090c; overflow: hidden; color: #eef3f8; }
.player-stage :deep(.visual-stage-root) { pointer-events: auto; touch-action: none; cursor: grab; }
.top-chrome {
  position: absolute; top: 0; left: 0; right: 0; z-index: 30;
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  background: linear-gradient(180deg, rgba(0,0,0,.5), transparent); pointer-events: none;
}
.top-chrome > * { pointer-events: auto; }
.top-title { flex: 1; text-align: center; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chrome-btn { min-width: 40px; height: 36px; border: 0; border-radius: 18px; background: rgba(255,255,255,.12); color: #fff; font-size: 18px; }
.fx-fab {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%); z-index: 32;
  width: 44px; height: 44px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,.18); background: rgba(16,18,22,.72);
  color: #fff; font-size: 12px; font-weight: 600;
}
.fx-fab.on { border-color: #07c160; color: #07c160; }
.fx-dock {
  position: absolute; right: 64px; top: 50%; transform: translateY(-50%); z-index: 34;
  width: min(200px, 52vw); max-height: 58%; overflow: auto;
  background: rgba(14,16,20,.9); border: 1px solid rgba(255,255,255,.1);
  border-radius: 14px; padding: 12px;
}
.fx-title { font-size: 12px; font-weight: 600; margin-bottom: 8px; }
.preset-grid.local-presets { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.preset-card { border: 1px solid rgba(255,255,255,.08); border-radius: 8px; padding: 6px; background: rgba(255,255,255,.04); color: inherit; text-align: left; cursor: pointer; }
.preset-card.active { border-color: #07c160; background: rgba(7,193,96,.14); }
.preset-card .pc-name { font-size: 11px; font-weight: 600; }
.fx-slider-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 11px; }
.fx-slider-row label { width: 32px; opacity: .7; }
.fx-slider-row input { flex: 1; accent-color: #07c160; }
.thumb-wrap { position: absolute; left: 12px; bottom: 96px; z-index: 28; display: flex; align-items: center; gap: 10px; max-width: min(58vw, 240px); }
.thumb-cover { width: 48px; height: 48px; border-radius: 8px; object-fit: cover; box-shadow: 0 4px 14px rgba(0,0,0,.4); background: rgba(255,255,255,.08); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.thumb-info { min-width: 0; }
.thumb-title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.thumb-artist { font-size: 11px; opacity: .75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lyric-float { position: absolute; left: 16px; right: 72px; bottom: 84px; z-index: 26; text-align: center; font-size: 13px; text-shadow: 0 2px 10px rgba(0,0,0,.85); pointer-events: none; }
.mini-queue-popover {
  position: absolute; left: 12px; right: 12px; bottom: 110px; max-height: 42vh; overflow: auto; z-index: 36;
  background: rgba(14,16,20,.92); border: 1px solid rgba(255,255,255,.1); border-radius: 14px; padding: 8px;
}
.mini-queue-head { display: flex; align-items: center; justify-content: space-between; padding: 4px 6px 8px; }
.mini-queue-title { font-size: 13px; font-weight: 600; }
.mini-queue-close { width: 28px; height: 28px; border: 0; border-radius: 50%; background: rgba(255,255,255,.08); color: #fff; font-size: 16px; }
.queue-item { width: 100%; display: flex; flex-direction: column; gap: 2px; padding: 10px 8px; border: 0; border-radius: 8px; background: transparent; color: #fff; text-align: left; }
.queue-item.active { background: rgba(7,193,96,.15); }
.q-title { font-size: 13px; }
.q-sub { font-size: 11px; opacity: .55; }
.bottom-bar {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 30;
  padding: 0 14px calc(8px + var(--safe-b));
  background: linear-gradient(0deg, rgba(10,12,16,.88) 0%, rgba(10,12,16,.55) 70%, transparent 100%);
}
.progress-bar { position: relative; height: 22px; margin-bottom: 6px; display: flex; align-items: center; cursor: pointer; }
.progress-track { position: relative; width: 100%; height: 4px; border-radius: 2px; background: rgba(255,255,255,.14); }
.progress-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background: linear-gradient(90deg, #07c160, #3ddc84); }
.progress-thumb {
  position: absolute; top: 50%; width: 12px; height: 12px; margin-left: -6px;
  transform: translateY(-50%); border-radius: 50%; background: #fff; opacity: 0; transition: opacity .15s;
}
.progress-bar:hover .progress-thumb, .progress-bar.is-dragging .progress-thumb { opacity: 1; }
.progress-input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.controls { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; padding: 4px 2px 2px; }
.control-cluster { display: flex; align-items: center; gap: 10px; min-width: 0; }
.control-cluster.transport { justify-content: center; }
.control-cluster.meta-side { justify-content: flex-end; flex-direction: column; align-items: flex-end; gap: 2px; }
.control-cover { width: 42px; height: 42px; border-radius: 8px; overflow: hidden; background: rgba(255,255,255,.08); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.control-cover img { width: 100%; height: 100%; object-fit: cover; }
.control-meta { min-width: 0; }
.control-title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 28vw; }
.control-artist { font-size: 11px; opacity: .65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 28vw; }
.ctl-btn { width: 40px; height: 40px; border: 0; border-radius: 50%; background: rgba(255,255,255,.1); color: #fff; font-size: 14px; }
.play-btn { width: 52px; height: 52px; border: 0; border-radius: 50%; background: #07c160; color: #fff; font-size: 18px; box-shadow: 0 4px 16px rgba(7,193,96,.35); }
.time { font-size: 11px; opacity: .7; font-variant-numeric: tabular-nums; }
.lyric-debug { font-size: 10px; opacity: .4; }
.stage-status {
  position: absolute; top: 52px; left: 12px; right: 12px; z-index: 35;
  padding: 8px 12px; border-radius: 8px; background: rgba(80,20,20,.8); font-size: 12px; text-align: center;
}
</style>
