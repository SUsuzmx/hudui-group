<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { musicPlayer, fmtAudioTime } from '../music-player.js';
import {
  initVisualStage,
  syncTrackToVisual,
  setVisualPreset,
  setFxField,
  startVisualWatch,
  stopVisualWatch,
  getVisualStageError,
  ensureDefaultPreset,
  getActivePresetId,
  PRESET_LIST,
  DEFAULT_PRESET_ID,
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
const debugInfo = ref('');

const current = computed(() => musicPlayer.state.current);
const playing = computed(() => musicPlayer.state.playing);
const progress = computed(() => musicPlayer.state.progress);
const duration = computed(() => musicPlayer.state.duration);
const tracks = computed(() => musicPlayer.state.tracks);
const sourceLabel = computed(() => (current.value?.source === 'netease' ? '网易云' : 'QQ音乐'));
const progressPercent = computed(() => (duration.value ? Math.min(100, (progress.value / duration.value) * 100) : 0));

function onSeek(e) { musicPlayer.seek(e.target.value); }
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
  try {
    const u = window.uniforms?.uAlpha?.value;
    const hasP = !!window.particles;
    const canvas = document.querySelectorAll('#canvas-container canvas').length;
    debugInfo.value = `a=${u != null ? Number(u).toFixed(2) : '-'} p=${hasP ? 1 : 0} c=${canvas} fx=${window.fx?.preset ?? '-'}`;
  } catch { /* ignore */ }
}

let lyricTimer = 0;
async function bootStage() {
  try {
    await initVisualStage();
    stageReady.value = true;
    presetId.value = ensureDefaultPreset();
    if (current.value) syncTrackToVisual(current.value);
    startVisualWatch();
    lyricTimer = setInterval(pollCurrentLyric, 200);
    pollCurrentLyric();
  } catch (e) {
    stageReady.value = false;
    stageError.value = (e && e.message) || getVisualStageError() || '视觉引擎加载失败';
    console.error('[SongDetail] visual stage failed', e);
  }
}

watch(current, (t) => { if (t) syncTrackToVisual(t); });
watch(playing, (p) => { window.playing = p; });
onMounted(() => { musicPlayer.ensureAudio(); bootStage(); });
onBeforeUnmount(() => { stopVisualWatch(); if (lyricTimer) clearInterval(lyricTimer); });
</script>

<template>
  <div v-if="current" class="stage-page">
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

    <header class="bar top">
      <button type="button" class="icon-btn" @click="emit('close')">‹</button>
      <div class="now">
        <div class="t">{{ current.title }}</div>
        <div class="s">{{ current.artist }} · {{ sourceLabel }}</div>
      </div>
      <button type="button" class="icon-btn" @click="showFx = !showFx">FX</button>
      <button type="button" class="icon-btn" @click="showQueue = !showQueue">☰</button>
    </header>

    <div v-if="!stageReady" class="stage-status">{{ stageError || '引擎加载中…' }}</div>

    <div v-if="showFx" class="fx-dock">
      <div class="fx-title">舞台预设</div>
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

    <div v-if="showQueue" class="queue-sheet">
      <button v-for="t in tracks" :key="t.source + '-' + t.id" type="button" class="queue-item" :class="{ active: isActive(t) }" @click="playFromQueue(t)">
        <span class="q-title">{{ t.title }}</span>
        <span class="q-sub">{{ t.artist }}</span>
      </button>
    </div>

    <footer class="bar bottom">
      <div class="lyric-now">
        {{ currentLine || '♪' }}
        <span class="lyric-debug">L{{ windowLyricLines }} · P{{ playing ? 1 : 0 }} · {{ debugInfo }}</span>
      </div>
      <div class="ctrl-row">
        <button type="button" class="icon-btn" @click="musicPlayer.prevTrack()">‹‹</button>
        <button type="button" class="icon-btn main" @click="musicPlayer.togglePlay()">{{ playing ? '❚❚' : '▶' }}</button>
        <button type="button" class="icon-btn" @click="musicPlayer.nextTrack()">››</button>
      </div>
      <div class="seek-row">
        <span class="time">{{ fmtAudioTime(progress) }}</span>
        <input class="seek" type="range" min="0" :max="duration || 0" step="0.1" :value="progress" @input="onSeek" />
        <span class="time">{{ fmtAudioTime(duration || current.duration) }}</span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.stage-page { position: absolute; inset: 0; z-index: 40; background: #050608; overflow: hidden; color: #eef3f8; }
.stage-page :deep(.visual-stage-root) { pointer-events: auto; touch-action: none; cursor: grab; }
.bar { position: absolute; left: 0; right: 0; z-index: 30; display: flex; align-items: center; gap: 8px; padding: 8px 10px; pointer-events: none; }
.bar > * { pointer-events: auto; }
.top { top: 0; background: linear-gradient(180deg, rgba(0,0,0,.55), transparent); }
.bottom { bottom: 0; flex-direction: column; align-items: stretch; gap: 6px; padding: 8px 12px calc(10px + var(--safe-b)); background: linear-gradient(0deg, rgba(0,0,0,.72), transparent); }
.icon-btn { min-width: 40px; height: 40px; border: 0; border-radius: 20px; background: rgba(255,255,255,.12); color: #fff; font-size: 16px; }
.icon-btn.main { width: 56px; height: 56px; background: #07c160; font-size: 20px; }
.now { flex: 1; min-width: 0; text-align: center; }
.now .t { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.now .s { font-size: 11px; opacity: .75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stage-status { position: absolute; top: 56px; left: 12px; right: 12px; z-index: 32; padding: 8px 12px; border-radius: 8px; background: rgba(80,20,20,.75); font-size: 12px; text-align: center; }
.lyric-now { text-align: center; font-size: 13px; min-height: 1.4em; text-shadow: 0 2px 10px rgba(0,0,0,.8); }
.lyric-debug { margin-left: 6px; font-size: 10px; opacity: .45; }
.ctrl-row { display: flex; justify-content: center; gap: 18px; }
.seek-row { display: flex; align-items: center; gap: 8px; }
.seek-row .time { font-size: 11px; opacity: .7; width: 36px; }
.seek { flex: 1; accent-color: #07c160; }
.queue-sheet { position: absolute; left: 10px; right: 10px; top: 80px; bottom: 100px; z-index: 34; background: rgba(10,12,16,.92); border-radius: 12px; overflow: auto; padding: 8px; pointer-events: auto; }
.queue-item { width: 100%; display: flex; flex-direction: column; gap: 2px; padding: 10px 8px; border: 0; border-radius: 8px; background: transparent; color: #fff; text-align: left; }
.queue-item.active { background: rgba(7,193,96,.15); }
.q-title { font-size: 14px; }
.q-sub { font-size: 12px; opacity: .6; }
</style>
