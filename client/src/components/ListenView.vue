<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { musicPlayer, fmtAudioTime } from '../music-player.js';
import SongDetailView from './SongDetailView.vue';

const emit = defineEmits(['back']);

const tracks = ref([]);
const loading = ref(false);
const query = ref('');
const source = ref('local');
const showDetail = ref(false);
const listNote = ref('');

const current = computed(() => musicPlayer.state.current);
const playing = computed(() => musicPlayer.state.playing);
const progress = computed(() => musicPlayer.state.progress);
const duration = computed(() => musicPlayer.state.duration);
const list = computed(() => (tracks.value.length ? tracks.value : musicPlayer.state.tracks));

async function load(resetQuery) {
  loading.value = true;
  try {
    const q = typeof resetQuery === 'string' ? resetQuery.trim() : query.value.trim();
    const data = await api.musicList({ q, source: source.value, limit: 30 });
    tracks.value = data.tracks || [];
    listNote.value = (data.notes || []).join('；') || (data.source === 'local' ? '本地素材 · 国内可播' : '');
    musicPlayer.setTracks(tracks.value);
    if (!tracks.value.length) {
      toast(data.source === 'local' ? '本地 demo 素材未就绪' : '暂无歌曲，可切回「本地」');
    }
  } catch (e) {
    toast(e.message || '加载失败');
    listNote.value = '';
  } finally {
    loading.value = false;
  }
}

function playTrack(t) {
  if (!t) return;
  if (!tracks.value.length) {
    tracks.value = musicPlayer.state.tracks.slice();
  }
  musicPlayer.setTracks(tracks.value.length ? tracks.value : musicPlayer.state.tracks);
  musicPlayer.playTrack(t);
}

function onSeek(e) {
  musicPlayer.seek(e.target.value);
}

function setSource(s) {
  source.value = s;
  load('');
}

function isActive(t) {
  return current.value && current.value.id === t.id && current.value.source === t.source;
}

function openDetail() {
  if (!current.value) return;
  showDetail.value = true;
}

onMounted(() => {
  musicPlayer.ensureAudio();
  if (!list.value.length) {
    load('');
  } else {
    tracks.value = musicPlayer.state.tracks.slice();
  }
});
</script>

<template>
  <div class="page">
    <header class="nav">
      <button class="nav-back" type="button" @click="emit('back')">‹</button>
      <div class="nav-title">听一听</div>
      <div class="nav-right"></div>
    </header>

    <div class="search-bar">
      <input
        v-model="query"
        type="search"
        placeholder="搜索歌曲 / 音乐人"
        @keydown.enter="load(query)"
      />
      <button type="button" @click="load(query)">搜索</button>
    </div>

    <div class="source-tabs">
      <button type="button" :class="{ on: source === 'local' }" @click="setSource('local')">本地</button>
      <button type="button" :class="{ on: source === 'all' }" @click="setSource('all')">全部</button>
      <button type="button" :class="{ on: source === 'audius' }" @click="setSource('audius')">免费热榜</button>
      <button type="button" :class="{ on: source === 'netease' }" @click="setSource('netease')">中文热歌</button>
    </div>
    <div v-if="listNote" class="list-note">{{ listNote }}</div>

    <main class="list scroll-y" :class="{ 'has-player': !!current }">
      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="!list.length" class="empty">暂无歌曲</div>
      <button
        v-for="t in list"
        :key="t.source + '-' + t.id"
        class="song"
        type="button"
        :class="{ active: isActive(t) }"
        @click="playTrack(t)"
      >
        <div class="cover">
          <img v-if="t.cover" :src="t.cover" :alt="t.title" loading="lazy" />
          <span v-else>♪</span>
        </div>
        <div class="meta">
          <div class="title">{{ t.title }}</div>
          <div class="sub">
            {{ t.artist }}
            <template v-if="t.duration"> · {{ fmtAudioTime(t.duration) }}</template>
            <template v-if="t.source === 'local'"> · 本地</template>
            <template v-else-if="t.source === 'netease'"> · 网易云</template>
            <template v-else-if="t.source === 'audius'"> · Audius</template>
            <template v-else> · {{ t.source || '网络' }}</template>
          </div>
        </div>
        <div class="play-ico">{{ isActive(t) && playing ? '❚❚' : '▶' }}</div>
      </button>
    </main>

    <footer v-if="current && !showDetail" class="player">
      <button class="player-open" type="button" @click="openDetail">
        <div class="player-top">
          <div class="player-info">
            <div class="player-title">{{ current.title }}</div>
            <div class="player-sub">{{ current.artist }} · 点击查看详情</div>
          </div>
          <div class="player-ctrl" @click.stop>
            <button type="button" @click="musicPlayer.prevTrack()">‹‹</button>
            <button type="button" class="main" @click="musicPlayer.togglePlay()">{{ playing ? '❚❚' : '▶' }}</button>
            <button type="button" @click="musicPlayer.nextTrack()">››</button>
          </div>
        </div>
        <div class="player-progress" @click.stop>
          <span>{{ fmtAudioTime(progress) }}</span>
          <input type="range" min="0" :max="duration || 0" step="0.1" :value="progress" @input="onSeek" />
          <span>{{ fmtAudioTime(duration) }}</span>
        </div>
      </button>
    </footer>

    <SongDetailView v-if="showDetail" @close="showDetail = false" />
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
  width: 100%;
  position: relative;
}
.nav {
  height: var(--nav-h);
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  background: var(--bg);
  border-bottom: 0.5px solid var(--divider);
}
.nav-back {
  width: 44px;
  height: 44px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 28px;
  line-height: 1;
}
.nav-title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
}
.nav-right { width: 44px; margin-left: auto; }
.search-bar {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg);
}
.search-bar input {
  flex: 1;
  min-height: 36px;
  border: 0;
  border-radius: 8px;
  padding: 0 12px;
  background: var(--white);
  color: var(--text);
  outline: none;
  font-size: 14px;
}
.search-bar button {
  min-width: 64px;
  border: 0;
  border-radius: 8px;
  background: var(--green);
  color: #fff;
  font-size: 14px;
}
.source-tabs {
  display: flex;
  gap: 8px;
  padding: 0 12px 8px;
  background: var(--bg);
  overflow-x: auto;
}
.list-note {
  padding: 0 16px 8px;
  font-size: 12px;
  color: var(--text-3);
}
.list-note:empty { display: none; }
.source-tabs button {
  min-height: 32px;
  padding: 0 12px;
  border-radius: 16px;
  border: 1px solid var(--divider);
  background: var(--white);
  color: var(--text-2);
  font-size: 13px;
}
.source-tabs button.on {
  background: rgba(7, 193, 96, 0.12);
  border-color: var(--green);
  color: var(--green);
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--white);
  padding-bottom: 16px;
}
.list.has-player { padding-bottom: 120px; }
.empty {
  padding: 40px;
  text-align: center;
  color: var(--text-3);
}
.song {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 0;
  border-bottom: 0.5px solid var(--divider-soft);
  background: var(--white);
  text-align: left;
}
.song.active { background: rgba(7, 193, 96, 0.06); }
.cover {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--divider-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  font-size: 20px;
  flex-shrink: 0;
}
.cover img { width: 100%; height: 100%; object-fit: cover; }
.meta { flex: 1; min-width: 0; }
.title {
  font-size: 15px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.play-ico { color: var(--text-2); font-size: 14px; }
.player {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--white);
  border-top: 0.5px solid var(--divider);
  padding: 0;
  z-index: 20;
}
.player-open {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 10px 14px calc(10px + var(--safe-b));
  text-align: left;
  color: var(--text);
}
.player-top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.player-info { flex: 1; min-width: 0; }
.player-title {
  font-size: 14px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.player-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-2);
}
.player-ctrl { display: flex; gap: 6px; }
.player-ctrl button {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 0;
  background: var(--divider-soft);
  color: var(--text);
}
.player-ctrl button.main {
  background: var(--green);
  color: #fff;
}
.player-progress {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-3);
}
.player-progress input {
  flex: 1;
  accent-color: var(--green);
}
</style>
