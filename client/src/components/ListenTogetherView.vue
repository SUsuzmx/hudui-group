<script setup>
// 一起听房间控制台（对齐 UI 截图）：展开为整页面板，收起后仅 3D 舞台 + 歌词
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import {
  listenTogether,
  createRoom,
  control,
  queueAction,
  setAllowAllControl,
  leaveRoom,
  syncNow,
  currentPosMs,
  resumePlaybackFromGesture,
} from '../listen-together.js';
import { musicPlayer, fmtAudioTime } from '../music-player.js';
import { api } from '../api.js';
import {
  initVisualStage,
  syncTrackToVisual,
  adoptRendererCanvas,
  ensureStageGestures,
  stopVisualWatch,
  startVisualWatch,
  applyLrcToVisual,
} from '../visual-stage.js';
import UserAvatar from './UserAvatar.vue';
import SongDetailView from './SongDetailView.vue';
import { toast } from '../toast.js';

const props = defineProps({
  me: { type: Object, default: null },
  conversationId: { type: String, default: 'default' },
  pickSong: { type: Boolean, default: false },
  hostName: { type: String, default: '' },
  conversationName: { type: String, default: '' },
});
const emit = defineEmits(['back', 'open-chat', 'joined']);

const room = computed(() => listenTogether.state.room);
const state = listenTogether.state;
const canControl = computed(() => listenTogether.canControl);
const isHost = computed(() => listenTogether.isHost);
const playing = computed(() => Boolean(room.value?.playing));
const track = computed(() => room.value?.current);
const queue = computed(() => room.value?.queue || []);
const members = computed(() => room.value?.members?.filter((m) => m.online) || []);
const hostId = computed(() => room.value?.hostId);

/** 面板展开（默认）/ 收起（只露 3D） */
const panelOpen = ref(true);
const showQueueSheet = ref(false);

const posSec = ref(0);
const searchQ = ref('');
const searching = ref(false);
const searchTracks = ref([]);
const addBusyKey = ref('');
const creating = ref(false);
const localError = ref('');
const seeking = ref(false);
const stageReady = ref(false);
const lyrics = ref([]);
const lyricsLoading = ref(false);
const sourceTab = ref('qq');

const needPick = computed(() => !room.value);
const pickMode = ref(false);

const roomLabel = computed(() => {
  const id = room.value?.id || room.value?.sessionId || '—';
  return `Listen Together · Room ${String(id).slice(0, 6)}`;
});

const durationSec = computed(() => {
  return Number(track.value?.duration) || musicPlayer.state.duration || 0;
});

const remainSec = computed(() => Math.max(0, durationSec.value - posSec.value));

const progressPct = computed(() => {
  const d = durationSec.value;
  if (!d) return 0;
  return Math.min(100, Math.max(0, (posSec.value / d) * 100));
});

const sourceTabs = [
  { key: 'qq', label: 'QQ音乐' },
  { key: 'kugou', label: '酷狗音乐' },
  { key: 'netease', label: '网易云音乐' },
];

let posTimer = 0;
let lastSeek = 0;

function fmt(sec) {
  return fmtAudioTime(sec);
}

function tickPos() {
  posSec.value = currentPosMs() / 1000;
}

function flash(msg) {
  localError.value = msg;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    if (localError.value === msg) localError.value = '';
  }, 1400);
}
let flashTimer = 0;

function onSeekInput(e) {
  if (!canControl.value) return;
  seeking.value = true;
  posSec.value = Number(e.target.value);
}

function onSeekCommit(e) {
  if (!canControl.value) return;
  const sec = Number(e.target.value);
  seeking.value = false;
  const now = Date.now();
  if (now - lastSeek < 400) return;
  lastSeek = now;
  control('seek', { positionMs: Math.round(sec * 1000) });
}

function onTogglePlay() {
  if (!canControl.value) {
    flash('现在由主持人控制播放。');
    return;
  }
  // 先在用户手势里解锁/起播，再发房间命令（移动端 autoplay 需要）
  if (!playing.value || state.playFail) {
    resumePlaybackFromGesture();
  }
  control(playing.value && !state.playFail ? 'pause' : 'play');
}

function onTapResume() {
  resumePlaybackFromGesture().then((ok) => {
    if (ok) flash('已恢复播放');
  });
}

function onNext() {
  if (!canControl.value) {
    flash('现在由主持人控制播放。');
    return;
  }
  control('next');
}

function onPrev() {
  if (!canControl.value) {
    flash('现在由主持人控制播放。');
    return;
  }
  control('previous');
}

function onShuffleOrRepeat() {
  flash('一起听按房间队列顺序播放');
}

async function onLeave() {
  await leaveRoom();
  emit('back');
}

function toTrackMeta(t) {
  return {
    id: t.id,
    source: t.source || sourceTab.value,
    title: t.title || t.name || '未知歌曲',
    artist: t.artist || t.author || '',
    cover: t.cover || t.picUrl || t.albumpic || t.img || '',
    duration: Number(t.duration) || 0,
    durationMs: t.durationMs,
    mid: t.mid,
    mediaMid: t.mediaMid,
    hash: t.hash || t.fileHash,
    albumId: t.albumId || t.album_id,
    albumAudioId: t.albumAudioId || t.album_audio_id,
    mixSongId: t.mixSongId,
    privilege: t.privilege,
    hqHash: t.hqHash,
    sqHash: t.sqHash,
    resHash: t.resHash,
  };
}

async function doSearch() {
  const q = searchQ.value.trim();
  searching.value = true;
  try {
    const d = await api.musicList({ q, source: sourceTab.value, limit: 30 });
    searchTracks.value = (d?.tracks || []).map((t) => ({ ...t, source: t.source || sourceTab.value }));
  } catch {
    searchTracks.value = [];
  } finally {
    searching.value = false;
  }
}

watch(sourceTab, () => {
  if (searchQ.value.trim()) doSearch();
  else doSearch();
});

async function pickTrack(t) {
  if (!t) return;
  const meta = toTrackMeta(t);
  const key = `${meta.source}:${meta.id}`;
  addBusyKey.value = key;
  creating.value = !room.value;
  try {
    if (!room.value) {
      const res = await createRoom({
        conversationId: props.conversationId || 'default',
        track: meta,
        hostName: props.hostName || props.me?.nickname || '我',
        sendInvite: true,
        conversationName: props.conversationName || '',
      });
      if (res?.error) {
        flash(res.error);
        return;
      }
      emit('joined', res.room);
    } else {
      const res = await queueAction('add', { track: meta });
      if (res?.error) flash(res.error);
      else toast('安排上了，等它出场。');
    }
  } finally {
    addBusyKey.value = '';
    creating.value = false;
  }
}

function removeQueue(t) {
  if (!canControl.value) return;
  queueAction('remove', { key: `${t.source}:${t.id}` });
}

function playQueueIndex(i) {
  if (!canControl.value) return;
  queueAction('play-index', { index: i });
}

async function loadLyrics() {
  const t = track.value;
  if (!t) return;
  lyricsLoading.value = true;
  try {
    const d = await api.musicList({ lyric: 1, source: t.source, id: t.id });
    const raw = d?.lyric || d?.lrc || '';
    lyrics.value = String(raw)
      .split('\n')
      .map((line) => {
        const m = /^\[(\d+):(\d+)(?:\.(\d+))?\](.*)$/.exec(line.trim());
        if (!m) return null;
        const sec = Number(m[1]) * 60 + Number(m[2]) + Number(m[3] || 0) / 100;
        return { sec, text: m[4].trim() };
      })
      .filter((x) => x && x.text);
    try { applyLrcToVisual(raw); } catch { /* ignore */ }
  } catch {
    lyrics.value = [];
  } finally {
    lyricsLoading.value = false;
  }
}

const activeLyricIdx = computed(() => {
  if (!lyrics.value.length) return -1;
  const p = posSec.value;
  let idx = -1;
  for (let i = 0; i < lyrics.value.length; i++) {
    if (lyrics.value[i].sec <= p + 0.2) idx = i;
    else break;
  }
  return idx;
});

watch(activeLyricIdx, (i) => {
  if (i < 0 || panelOpen.value) return;
  nextTick(() => {
    const el = document.getElementById(`lt-lyric-${i}`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
});

watch(
  () => track.value?.id,
  () => {
    loadLyrics();
    // 仅在收起态（SongDetail 已挂载、含舞台 DOM）时同步视觉
    if (track.value && !panelOpen.value) {
      try {
        syncTrackToVisual(track.value);
      } catch { /* ignore */ }
    }
  }
);

async function bootStage() {
  try {
    await initVisualStage();
    adoptRendererCanvas();
    ensureStageGestures();
    startVisualWatch();
    if (track.value) syncTrackToVisual(track.value);
    stageReady.value = true;
  } catch {
    stageReady.value = false;
  }
}

function expandPanel() {
  panelOpen.value = true;
}

function collapsePanel() {
  panelOpen.value = false;
}

onMounted(() => {
  posTimer = setInterval(tickPos, 500);
  tickPos();
  loadLyrics();
  doSearch();
  if (props.pickSong && !room.value) pickMode.value = true;
  if (room.value) syncNow().catch(() => {});
});

onBeforeUnmount(() => {
  if (posTimer) clearInterval(posTimer);
  try { stopVisualWatch(); } catch { /* ignore */ }
});
</script>

<template>
  <div class="lt-root" :class="{ collapsed: !panelOpen }">
    <!-- 收起态：SongDetail 同款 3D 舞台 + 歌词（唯一 canvas 宿主） -->
    <SongDetailView
      v-if="!panelOpen"
      class="lt-songdetail"
      :room-mode="true"
      @expand-panel="expandPanel"
      @close="expandPanel"
    />

    <!-- 展开态：整页控制台 -->
    <div v-else class="lt-panel">
      <header class="lt-top">
        <button class="lt-top-btn" type="button" aria-label="返回" @click="emit('back')">‹</button>
        <div class="lt-top-title">{{ roomLabel }}</div>
        <button class="lt-top-btn" type="button" aria-label="已点歌曲" @click="showQueueSheet = true">•••</button>
      </header>

      <!-- 居中浮层提示：不挤压布局，快速消失 -->
      <transition name="lt-toast">
        <div v-if="localError || state.error" class="lt-toast" role="status" @click="syncNow()">
          {{ localError || state.error }}
        </div>
      </transition>
      <transition name="lt-toast">
        <div
          v-if="state.playFail && room?.playing"
          class="lt-toast lt-toast-action"
          role="status"
          @click="onTapResume"
        >
          系统拦了声音，轻触恢复播放
        </div>
      </transition>

      <!-- 主区：手机纵向 / 平板双栏 -->
      <div class="lt-main">
        <div class="lt-hero">
      <!-- 专辑封面：两侧斜置头像 + 耳机线 -->
      <div class="lt-cover-zone">
        <div class="lt-cover">
          <img v-if="track?.cover" :src="track.cover" alt="" />
          <div v-else class="lt-cover-fb">♪</div>
        </div>
        <!-- 耳机线：从封面底部连到两侧头像 -->
        <svg class="lt-wire" viewBox="0 0 300 160" preserveAspectRatio="none" aria-hidden="true">
          <path class="wire-l" d="M150 118 C 120 138, 95 140, 78 128" />
          <path class="wire-r" d="M150 118 C 180 138, 205 140, 222 128" />
          <circle class="wire-jack" cx="150" cy="118" r="3" />
        </svg>
        <div class="lt-avatar left" :class="{ empty: !members[0] }">
          <UserAvatar
            v-if="members[0]"
            :name="members[0].nickname"
            :avatar="members[0].avatar"
            :color="members[0].avatarColor"
            :size="58"
          />
          <span v-else class="lt-avatar-ph">?</span>
        </div>
        <div class="lt-avatar right" :class="{ empty: !members[1] }">
          <UserAvatar
            v-if="members[1]"
            :name="members[1].nickname"
            :avatar="members[1].avatar"
            :color="members[1].avatarColor"
            :size="58"
          />
          <span v-else class="lt-avatar-ph">?</span>
        </div>
        <div v-if="members.length > 2" class="lt-avatar-more">+{{ members.length - 2 }}</div>
      </div>

      <div class="lt-song-meta">
        <div class="lt-song-title">{{ track?.title || (needPick ? '挑首歌，叫上朋友一起听' : '未在播放') }}</div>
        <div class="lt-song-artist">{{ track?.artist || (needPick ? '选好就开始，大家同步听' : '') }}</div>
      </div>

      <!-- 进度 -->
      <div class="lt-progress">
        <span class="lt-time">{{ fmt(posSec) }}</span>
        <div class="lt-bar">
          <div class="lt-bar-fill" :style="{ width: progressPct + '%' }"></div>
          <input
            class="lt-bar-input"
            type="range"
            min="0"
            :max="Math.max(1, durationSec)"
            step="1"
            :value="Math.floor(posSec)"
            :disabled="!canControl"
            @input="onSeekInput"
            @change="onSeekCommit"
          />
        </div>
        <span class="lt-time">-{{ fmt(remainSec) }}</span>
      </div>

      <!-- 播放控制 -->
      <div class="lt-controls">
        <button class="lt-ctrl-ghost" type="button" aria-label="随机" @click="onShuffleOrRepeat">⇄</button>
        <button class="lt-ctrl-ghost" type="button" aria-label="上一首" :disabled="!canControl" @click="onPrev">⏮</button>
        <button class="lt-ctrl-play" type="button" :disabled="!canControl" @click="onTogglePlay">
          <span v-if="playing">❚❚</span>
          <span v-else>▶</span>
        </button>
        <button class="lt-ctrl-ghost" type="button" aria-label="下一首" :disabled="!canControl" @click="onNext">⏭</button>
        <button class="lt-ctrl-ghost" type="button" aria-label="循环" @click="onShuffleOrRepeat">↻</button>
      </div>
        </div><!-- /.lt-hero -->

        <div class="lt-body">
      <!-- 音源 Tab -->
      <div class="lt-tabs">
        <button
          v-for="t in sourceTabs"
          :key="t.key"
          type="button"
          class="lt-tab"
          :class="{ on: sourceTab === t.key }"
          @click="sourceTab = t.key"
        >{{ t.label }}</button>
      </div>

      <!-- 搜索框（在列表上方，手机上更好点） -->
      <div class="lt-search">
        <span class="lt-search-icon">⌕</span>
        <input v-model="searchQ" type="search" placeholder="搜索歌曲，点「点歌」加入" @keyup.enter="doSearch" />
        <button class="lt-search-go" type="button" @click="doSearch">搜索</button>
      </div>

      <!-- 搜索列表 -->
      <div class="lt-list">
        <div v-if="searching" class="lt-list-empty">正在找歌……</div>
        <div v-else-if="!searchTracks.length" class="lt-list-empty">搜一首，点「点歌」加入一起听</div>
        <div v-for="t in searchTracks" :key="`${t.source}:${t.id}`" class="lt-row">
          <div class="lt-row-cover">
            <img v-if="t.cover || t.picUrl" :src="t.cover || t.picUrl" alt="" />
            <span v-else>♪</span>
          </div>
          <div class="lt-row-main">
            <div class="lt-row-title">{{ t.title || t.name }}</div>
            <div class="lt-row-sub">{{ t.artist || t.author || '' }}</div>
          </div>
          <button
            class="lt-row-btn"
            type="button"
            :disabled="addBusyKey === `${t.source || sourceTab}:${t.id}`"
            @click="pickTrack(t)"
          >{{ addBusyKey === `${t.source || sourceTab}:${t.id}` ? '…' : '点歌' }}</button>
        </div>
      </div>
        </div><!-- /.lt-body -->
      </div><!-- /.lt-main -->

      <!-- 底部折叠：明显可点 -->
      <button class="lt-collapse" type="button" aria-label="收起一起听面板" @click="collapsePanel">
        <span class="lt-collapse-bar">
          <span class="lt-collapse-tri">▼</span>
          <span class="lt-collapse-text">收起，看 3D 舞台</span>
        </span>
      </button>
    </div>

    <!-- 已点歌曲 -->
    <div v-if="showQueueSheet" class="lt-sheet-mask" @click.self="showQueueSheet = false">
      <div class="lt-sheet">
        <div class="lt-sheet-title">
          <span>已点歌曲</span>
          <button type="button" @click="showQueueSheet = false">关闭</button>
        </div>
        <div class="lt-sheet-sub">主持人：{{ members.find((m) => m.userId === hostId)?.nickname || '—' }} · {{ members.length }} 人在听</div>
        <label v-if="isHost" class="lt-toggle">
          <input type="checkbox" :checked="room?.allowAllControl" @change="setAllowAllControl($event.target.checked)" />
          <span>所有人都可以控制</span>
        </label>
        <div v-if="!queue.length" class="lt-list-empty">下一首听什么？去搜索里点歌吧</div>
        <div v-for="(t, i) in queue" :key="`${t.source}:${t.id}`" class="lt-row">
          <div class="lt-row-main" @click="playQueueIndex(i)">
            <div class="lt-row-title">{{ i + 1 }}. {{ t.title }}</div>
            <div class="lt-row-sub">{{ t.artist }}</div>
          </div>
          <button v-if="canControl" class="lt-row-btn danger" type="button" @click="removeQueue(t)">删除</button>
        </div>
        <button class="lt-leave" type="button" @click="onLeave">离开房间</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lt-root {
  position: absolute;
  inset: 0;
  z-index: 40;
  background: linear-gradient(165deg, #e0f7fa 0%, #c7f0e4 42%, #a7f3d0 100%);
  color: #1f2d2a;
  overflow: hidden;
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.lt-root.collapsed { background: transparent; }
.lt-songdetail {
  position: absolute !important;
  inset: 0 !important;
  z-index: 20;
}

.lt-panel {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  background: linear-gradient(165deg, #e0f7fa 0%, #b8efe0 48%, #a7f3d0 100%);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  /* 移动端地址栏：用动态视口，避免列表被裁掉 */
  min-height: 0;
}
.lt-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.lt-hero {
  flex-shrink: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.lt-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.lt-top {
  display: flex;
  align-items: center;
  height: calc(52px + var(--safe-t, 0px));
  padding: var(--safe-t, 0px) 8px 0;
  box-sizing: border-box;
  flex-shrink: 0;
}
.lt-top-title {
  flex: 1;
  text-align: center;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #0f3d36;
}
.lt-top-btn {
  width: 44px;
  height: 44px;
  border: 0;
  background: rgba(255, 255, 255, 0.55);
  border-radius: 12px;
  color: #0d9488;
  font-size: 22px;
  line-height: 1;
}
/* 居中 toast：absolute 覆盖，不改变文档流高度 */
.lt-toast {
  position: absolute;
  left: 50%;
  top: 46%;
  transform: translate(-50%, -50%);
  z-index: 50;
  max-width: min(80vw, 280px);
  padding: 12px 18px;
  border-radius: 12px;
  background: rgba(15, 60, 55, 0.88);
  color: #fff;
  font-size: 13px;
  line-height: 1.45;
  text-align: center;
  pointer-events: auto;
  box-shadow: 0 10px 28px rgba(15, 80, 70, 0.28);
}
.lt-toast-action {
  cursor: pointer;
  background: rgba(180, 80, 20, 0.92);
}
.lt-toast-enter-active,
.lt-toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.lt-toast-enter-from,
.lt-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.96);
}

.lt-cover-zone {
  position: relative;
  width: min(230px, 56vw, 32vh);
  height: min(230px, 56vw, 32vh);
  margin: 8px auto 0;
  flex-shrink: 0;
}
.lt-cover {
  position: absolute;
  left: 12%;
  right: 12%;
  top: 0;
  bottom: 18%;
  border-radius: 18px;
  overflow: hidden;
  background: linear-gradient(145deg, #99f6e4, #5eead4);
  box-shadow: 0 14px 32px rgba(20, 120, 110, 0.18);
  z-index: 2;
}
.lt-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.lt-cover-fb {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 56px;
  color: #0f766e;
  opacity: 0.55;
}
.lt-wire {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  pointer-events: none;
}
.lt-wire path {
  fill: none;
  stroke: rgba(15, 148, 136, 0.55);
  stroke-width: 2.2;
  stroke-linecap: round;
}
.lt-wire .wire-jack { fill: #14b8a6; }
.lt-avatar {
  position: absolute;
  top: 38%;
  z-index: 3;
  border-radius: 50%;
  padding: 2.5px;
  box-shadow: 0 8px 18px rgba(20, 120, 110, 0.2);
}
.lt-avatar.left {
  left: -2%;
  transform: rotate(-12deg);
  background: linear-gradient(145deg, #22d3ee, #4fd1c5);
}
.lt-avatar.right {
  right: -2%;
  transform: rotate(12deg);
  background: linear-gradient(145deg, #4fd1c5, #2dd4bf);
}
.lt-avatar.empty { opacity: 0.5; }
.lt-avatar-ph {
  display: flex;
  width: 58px;
  height: 58px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.85);
  color: #0f766e;
  font-size: 18px;
}
.lt-avatar-more {
  position: absolute;
  right: 2%;
  bottom: 4%;
  z-index: 3;
  font-size: 11px;
  color: #0f766e;
}

.lt-song-meta {
  text-align: center;
  margin-top: 12px;
  padding: 0 16px;
  flex-shrink: 0;
  width: 100%;
  max-width: 520px;
}
.lt-song-title {
  font-size: clamp(17px, 4.2vw, 22px);
  font-weight: 800;
  color: #0b1f1c;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lt-song-artist {
  margin-top: 4px;
  font-size: 13px;
  color: #5b756f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lt-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px 0;
  flex-shrink: 0;
  width: 100%;
  max-width: 560px;
}
.lt-time {
  width: 40px;
  font-size: 11px;
  color: #6b857f;
  font-variant-numeric: tabular-nums;
}
.lt-time:last-child { text-align: right; }
.lt-bar {
  position: relative;
  flex: 1;
  height: 22px;
  display: flex;
  align-items: center;
}
.lt-bar::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.7);
  box-shadow: inset 0 0 0 1px rgba(20, 120, 110, 0.08);
}
.lt-bar-fill {
  position: absolute;
  left: 0;
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(90deg, #4fd1c5, #22d3ee);
  pointer-events: none;
}
.lt-bar-input {
  position: relative;
  width: 100%;
  opacity: 0;
  height: 22px;
  margin: 0;
}

.lt-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 10px 16px 8px;
  flex-shrink: 0;
}
.lt-ctrl-ghost {
  border: 0;
  background: rgba(255, 255, 255, 0.55);
  border-radius: 12px;
  color: #0d9488;
  font-size: 18px;
  width: 44px;
  height: 44px;
}
.lt-ctrl-ghost:disabled { opacity: 0.35; }
.lt-ctrl-play {
  width: 56px;
  height: 56px;
  border: 0;
  border-radius: 50%;
  background: linear-gradient(145deg, #22d3ee, #4fd1c5);
  color: #fff;
  font-size: 20px;
  box-shadow: 0 12px 28px rgba(20, 180, 170, 0.35);
}
.lt-ctrl-play:disabled { opacity: 0.5; }

.lt-tabs {
  display: flex;
  gap: 8px;
  padding: 6px 12px 4px;
  flex-shrink: 0;
}
.lt-tab {
  flex: 1;
  border: 0;
  border-radius: 14px 14px 0 0;
  padding: 10px 6px;
  background: rgba(255, 255, 255, 0.45);
  color: #3d5c56;
  font-size: 13px;
}
.lt-tab.on {
  background: rgba(255, 255, 255, 0.92);
  color: #0f766e;
  font-weight: 700;
  box-shadow: 0 -2px 10px rgba(20, 120, 110, 0.08);
}

.lt-list {
  flex: 1;
  min-height: 140px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  margin: 0 12px;
  border-radius: 16px 16px 0 0;
  background: rgba(255, 255, 255, 0.82);
  padding: 8px 8px 12px;
  box-shadow: 0 -4px 18px rgba(20, 120, 110, 0.08);
}
.lt-list-empty {
  padding: 28px 12px;
  text-align: center;
  color: #7a918c;
  font-size: 13px;
}
.lt-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
}
.lt-row-cover {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  overflow: hidden;
  background: #d9f5ef;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.lt-row-cover img { width: 100%; height: 100%; object-fit: cover; }
.lt-row-main { flex: 1; min-width: 0; }
.lt-row-title {
  font-size: 14px;
  color: #172b27;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lt-row-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #6b857f;
}
.lt-row-btn {
  border: 0;
  border-radius: 999px;
  padding: 7px 14px;
  background: linear-gradient(135deg, #4fd1c5, #22d3ee);
  color: #fff;
  font-size: 12px;
  flex-shrink: 0;
  font-weight: 600;
}
.lt-row-btn.danger { background: rgba(239, 68, 68, 0.85); }
.lt-row-btn:disabled { opacity: 0.5; }

.lt-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 12px 6px;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 4px 14px rgba(20, 120, 110, 0.1);
  flex-shrink: 0;
}
.lt-search-icon { color: #0d9488; font-size: 16px; }
.lt-search input {
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: #172b27;
  font-size: 14px;
}
.lt-search input::placeholder { color: #8aa39d; }
.lt-search-go {
  border: 0;
  border-radius: 999px;
  padding: 6px 12px;
  background: linear-gradient(135deg, #4fd1c5, #22d3ee);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}

.lt-collapse {
  border: 0;
  background: transparent;
  padding: 8px 16px calc(12px + env(safe-area-inset-bottom, 0px));
  flex-shrink: 0;
  display: flex;
  justify-content: center;
}
.lt-collapse-bar {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 168px;
  justify-content: center;
  padding: 11px 20px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #0d9488;
  font-size: 13px;
  font-weight: 700;
  box-shadow:
    0 6px 18px rgba(20, 120, 110, 0.18),
    0 0 0 1px rgba(13, 148, 136, 0.12);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.lt-collapse:active .lt-collapse-bar {
  transform: scale(0.97);
  box-shadow: 0 2px 8px rgba(20, 120, 110, 0.16);
}
.lt-collapse-tri {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: linear-gradient(135deg, #4fd1c5, #22d3ee);
  color: #fff;
  font-size: 10px;
}
.lt-collapse-text {
  letter-spacing: 0.02em;
}

.lt-sheet-mask {
  position: absolute;
  inset: 0;
  z-index: 30;
  background: rgba(15, 60, 55, 0.28);
  display: flex;
  align-items: flex-end;
}
.lt-sheet {
  width: 100%;
  max-height: 72vh;
  overflow-y: auto;
  border-radius: 20px 20px 0 0;
  background: #f4fffb;
  padding: 14px 14px calc(18px + env(safe-area-inset-bottom, 0px));
  box-shadow: 0 -8px 30px rgba(20, 120, 110, 0.15);
}
.lt-sheet-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 16px;
  font-weight: 700;
  color: #0b1f1c;
}
.lt-sheet-title button {
  border: 0;
  background: transparent;
  color: #0d9488;
  font-size: 13px;
  font-weight: 600;
}
.lt-sheet-sub {
  margin: 6px 0 10px;
  font-size: 12px;
  color: #5b756f;
}
.lt-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 12px;
  color: #0f766e;
}
.lt-leave {
  margin-top: 14px;
  width: 100%;
  border: 0;
  border-radius: 12px;
  padding: 13px;
  background: rgba(239, 68, 68, 0.9);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}

/* 矮屏（手机横屏 / 带地址栏的小窗）：压缩英雄区，保证点歌列表可见 */
@media (max-height: 740px) {
  .lt-top { height: 46px; }
  .lt-cover-zone {
    width: min(170px, 42vw, 28vh);
    height: min(170px, 42vw, 28vh);
    margin-top: 4px;
  }
  .lt-song-meta { margin-top: 8px; }
  .lt-progress { padding-top: 6px; }
  .lt-controls { padding: 6px 12px 4px; gap: 10px; }
  .lt-ctrl-play { width: 48px; height: 48px; font-size: 16px; }
  .lt-ctrl-ghost { width: 38px; height: 38px; font-size: 15px; }
  .lt-list { min-height: 120px; }
  .lt-collapse { padding: 4px 12px calc(6px + env(safe-area-inset-bottom, 0px)); }
  .lt-collapse-bar { padding: 8px 14px; min-width: 140px; }
}

@media (max-height: 560px) {
  .lt-cover-zone {
    width: min(120px, 34vw, 22vh);
    height: min(120px, 34vw, 22vh);
  }
  .lt-avatar-ph { width: 42px; height: 42px; font-size: 14px; }
  .lt-song-title { font-size: 15px; }
  .lt-song-artist { font-size: 11px; margin-top: 2px; }
  .lt-song-meta { margin-top: 4px; }
  .lt-tabs { padding: 4px 10px 2px; }
  .lt-tab { padding: 7px 4px; font-size: 12px; }
  .lt-list { min-height: 100px; margin: 0 8px; }
  .lt-row { padding: 8px 6px; }
  .lt-row-cover { width: 36px; height: 36px; border-radius: 8px; }
  .lt-collapse { display: none; }
}

/* 小屏宽度 */
@media (max-width: 360px) {
  .lt-song-title { font-size: 17px; }
  .lt-ctrl-play { width: 48px; height: 48px; }
  .lt-progress { padding-left: 12px; padding-right: 12px; }
  .lt-time { width: 34px; font-size: 10px; }
}

/* iPad / 平板：左右双栏，点歌列表占满右列 */
@media (min-width: 720px) and (min-height: 520px) {
  .lt-main {
    flex-direction: row;
    align-items: stretch;
    padding: 0 20px 8px;
    gap: 18px;
  }
  .lt-hero {
    flex: 0 0 42%;
    max-width: 460px;
    justify-content: center;
    padding-bottom: 12px;
  }
  .lt-body {
    flex: 1;
    min-width: 0;
    margin: 8px 0;
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.45);
    padding: 8px 6px 0;
  }
  .lt-cover-zone {
    width: min(280px, 36vw, 40vh);
    height: min(280px, 36vw, 40vh);
  }
  .lt-list {
    border-radius: 16px;
    margin: 0 6px;
    min-height: 200px;
    box-shadow: 0 4px 18px rgba(20, 120, 110, 0.08);
  }
  .lt-song-title { font-size: 24px; }
  .lt-ctrl-play { width: 64px; height: 64px; }
  .lt-collapse {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 8px;
    z-index: 5;
  }
}

/* 大平板横屏：列表更宽 */
@media (min-width: 1024px) {
  .lt-hero { flex-basis: 38%; }
  .lt-list { min-height: 260px; }
}
</style>
