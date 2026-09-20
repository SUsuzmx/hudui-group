<script setup>
import { ref, computed } from 'vue';
import { musicPlayer, fmtAudioTime } from '../music-player.js';

const emit = defineEmits(['close']);

const showQueue = ref(false);
const liked = ref(false);

const current = computed(() => musicPlayer.state.current);
const playing = computed(() => musicPlayer.state.playing);
const progress = computed(() => musicPlayer.state.progress);
const duration = computed(() => musicPlayer.state.duration);
const tracks = computed(() => musicPlayer.state.tracks);
const sourceLabel = computed(() => (current.value?.source === 'netease' ? '网易云公开接口' : 'Audius 免费音乐'));

const progressPercent = computed(() => {
  if (!duration.value) return 0;
  return Math.min(100, Math.max(0, (progress.value / duration.value) * 100));
});

function onSeek(e) {
  musicPlayer.seek(e.target.value);
}

function playFromQueue(t) {
  showQueue.value = false;
  musicPlayer.playTrack(t);
}

function isActive(t) {
  return current.value && current.value.id === t.id && current.value.source === t.source;
}
</script>

<template>
  <div v-if="current" class="song-detail">
    <header class="nav">
      <button class="nav-back" type="button" aria-label="收起" @click="emit('close')">⌄</button>
      <div class="nav-title">正在播放</div>
      <button class="nav-right-btn" type="button" @click="showQueue = !showQueue">
        {{ showQueue ? '封面' : '列表' }}
      </button>
    </header>

    <main v-if="!showQueue" class="detail-body">
      <div class="disc-wrap">
        <div class="disc" :class="{ spin: playing }">
          <img v-if="current.cover" :src="current.cover" :alt="current.title" />
          <div v-else class="disc-fallback">♪</div>
        </div>
      </div>

      <div class="song-head">
        <h1 class="song-title">{{ current.title }}</h1>
        <div class="song-artist">{{ current.artist }}</div>
        <div class="song-tags">
          <span class="tag">{{ sourceLabel }}</span>
          <span v-if="current.genre" class="tag">{{ current.genre }}</span>
          <span class="tag">{{ fmtAudioTime(duration || current.duration) }}</span>
        </div>
      </div>

      <div class="progress-block">
        <input
          class="seek"
          type="range"
          min="0"
          :max="duration || 0"
          step="0.1"
          :value="progress"
          @input="onSeek"
        />
        <div class="time-row">
          <span>{{ fmtAudioTime(progress) }}</span>
          <span>{{ fmtAudioTime(duration || current.duration) }}</span>
        </div>
        <div class="bar">
          <div class="bar-fill" :style="{ width: progressPercent + '%' }"></div>
        </div>
      </div>

      <div class="ctrl-row">
        <button class="ctrl" type="button" @click="musicPlayer.prevTrack()">‹‹</button>
        <button class="ctrl main" type="button" @click="musicPlayer.togglePlay()">
          {{ playing ? '❚❚' : '▶' }}
        </button>
        <button class="ctrl" type="button" @click="musicPlayer.nextTrack()">››</button>
      </div>

      <div class="actions">
        <button class="act" type="button" :class="{ on: liked }" @click="liked = !liked">
          {{ liked ? '♥ 已喜欢' : '♡ 喜欢' }}
        </button>
        <button class="act" type="button" @click="showQueue = true">播放列表</button>
        <button class="act" type="button" @click="emit('close')">返回列表</button>
      </div>

      <section class="info-card">
        <div class="row"><span>歌曲</span><span>{{ current.title }}</span></div>
        <div class="row"><span>歌手</span><span>{{ current.artist }}</span></div>
        <div class="row"><span>来源</span><span>{{ sourceLabel }}</span></div>
        <div class="row"><span>时长</span><span>{{ fmtAudioTime(duration || current.duration) }}</span></div>
        <div class="row"><span>ID</span><span>{{ current.id }}</span></div>
      </section>
    </main>

    <main v-else class="queue-body scroll-y">
      <div class="queue-title">播放列表 · {{ tracks.length }} 首</div>
      <button
        v-for="t in tracks"
        :key="t.source + '-' + t.id"
        class="queue-item"
        type="button"
        :class="{ active: isActive(t) }"
        @click="playFromQueue(t)"
      >
        <div class="q-cover">
          <img v-if="t.cover" :src="t.cover" alt="" />
          <span v-else>♪</span>
        </div>
        <div class="q-meta">
          <div class="q-title">{{ t.title }}</div>
          <div class="q-sub">{{ t.artist }}</div>
        </div>
        <div class="q-ico">{{ isActive(t) && playing ? '❚❚' : '▶' }}</div>
      </button>
    </main>
  </div>
</template>

<style scoped>
.song-detail {
  position: absolute;
  inset: 0;
  z-index: 40;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.nav {
  height: var(--nav-h);
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  border-bottom: 0.5px solid var(--divider);
  background: var(--bg);
}
.nav-back,
.nav-right-btn {
  width: 56px;
  height: 44px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 22px;
}
.nav-right-btn { font-size: 14px; margin-left: auto; }
.nav-title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}
.detail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px calc(20px + var(--safe-b));
}
.disc-wrap {
  display: flex;
  justify-content: center;
  margin: 12px 0 18px;
}
.disc {
  width: min(64vw, 240px);
  aspect-ratio: 1;
  border-radius: 50%;
  background: #222;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-shadow: 0 12px 32px rgba(0,0,0,0.18);
}
.disc img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.disc-fallback {
  color: #fff;
  font-size: 48px;
}
.disc.spin { animation: spin 10s linear infinite; }
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.song-head { text-align: center; }
.song-title {
  font-size: 22px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.3;
}
.song-artist {
  margin-top: 8px;
  font-size: 15px;
  color: var(--text-2);
}
.song-tags {
  margin-top: 12px;
  display: flex;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}
.tag {
  font-size: 12px;
  color: var(--text-2);
  background: var(--white);
  border: 1px solid var(--divider);
  border-radius: 12px;
  padding: 4px 10px;
}
.progress-block { margin-top: 22px; }
.seek {
  width: 100%;
  accent-color: var(--green);
}
.time-row {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-3);
}
.bar {
  margin-top: 6px;
  height: 3px;
  border-radius: 2px;
  background: var(--divider);
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  background: var(--green);
}
.ctrl-row {
  margin-top: 18px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 22px;
}
.ctrl {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 0;
  background: var(--white);
  color: var(--text);
  font-size: 18px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}
.ctrl.main {
  width: 72px;
  height: 72px;
  background: var(--green);
  color: #fff;
  font-size: 22px;
}
.actions {
  margin-top: 20px;
  display: flex;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}
.act {
  min-height: 36px;
  padding: 0 14px;
  border-radius: 18px;
  border: 1px solid var(--divider);
  background: var(--white);
  color: var(--text);
  font-size: 13px;
}
.act.on {
  color: var(--red);
  border-color: var(--red);
}
.info-card {
  margin-top: 22px;
  background: var(--white);
  border-radius: 12px;
  padding: 4px 14px;
}
.row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  font-size: 14px;
  color: var(--text);
  border-bottom: 0.5px solid var(--divider-soft);
}
.row:last-child { border-bottom: 0; }
.row span:first-child { color: var(--text-2); flex-shrink: 0; }
.row span:last-child {
  text-align: right;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.queue-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 20px;
  background: var(--white);
}
.queue-title {
  padding: 14px 16px 8px;
  font-size: 13px;
  color: var(--text-2);
}
.queue-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border: 0;
  background: var(--white);
  text-align: left;
}
.queue-item.active { background: rgba(7, 193, 96, 0.06); }
.q-cover {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--divider-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.q-cover img { width: 100%; height: 100%; object-fit: cover; }
.q-meta { flex: 1; min-width: 0; }
.q-title {
  font-size: 14px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.q-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.q-ico { color: var(--text-2); font-size: 13px; }
</style>
