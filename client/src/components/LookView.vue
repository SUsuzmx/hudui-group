<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { api } from '../api.js';
import { toast } from '../toast.js';

const emit = defineEmits(['back']);

const videos = ref([]);
const loading = ref(false);
const refreshing = ref(false);
const activeIndex = ref(0);
const listEl = ref(null);
const videoRefs = ref({});
// 浏览器自动播放策略：先静音，用户点一下再开声
const muted = ref(true);
const unlocked = ref(false);

function setVideoRef(id, el) {
  if (el) videoRefs.value[id] = el;
}

async function load(force = false) {
  if (loading.value || refreshing.value) return;
  if (force) refreshing.value = true;
  loading.value = true;
  videoRefs.value = {};
  try {
    const data = await api.lookFeed({ refresh: force });
    const list = data.videos || [];
    if (!list.length) {
      videos.value = [];
      toast('暂无视频，请稍后刷新');
      return;
    }
    // 刷新时打乱顺序，避免看起来像“没反应”
    videos.value = force ? [...list].sort(() => Math.random() - 0.5) : list;
    activeIndex.value = 0;
    await nextTick();
    if (listEl.value) listEl.value.scrollTop = 0;
    playActive();
    if (force) toast(`已刷新 · ${videos.value.length} 条视频`);
  } catch (e) {
    videos.value = [];
    toast(e.message || '加载失败');
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

function applyMediaState() {
  videos.value.forEach((v, i) => {
    const el = videoRefs.value[v.id];
    if (!el) return;
    el.muted = muted.value;
    el.volume = 1;
    if (i === activeIndex.value) {
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else {
      try { el.pause(); el.currentTime = 0; } catch { /* ignore */ }
    }
  });
}

function playActive() {
  applyMediaState();
}

function unlockSound() {
  unlocked.value = true;
  muted.value = false;
  playActive();
  const el = videoRefs.value[videos.value[activeIndex.value]?.id];
  if (el && el.paused) {
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }
}

function onScroll() {
  const el = listEl.value;
  if (!el || !videos.value.length) return;
  const h = el.clientHeight || 1;
  const idx = Math.round(el.scrollTop / h);
  const next = Math.min(Math.max(0, idx), videos.value.length - 1);
  if (next !== activeIndex.value) {
    activeIndex.value = next;
    playActive();
  }
}

function scrollToIndex(i) {
  const el = listEl.value;
  if (!el) return;
  el.scrollTo({ top: i * (el.clientHeight || 0), behavior: 'smooth' });
  activeIndex.value = i;
  setTimeout(playActive, 240);
}

function toggleMute() {
  if (muted.value) {
    unlockSound();
    return;
  }
  muted.value = true;
  playActive();
}

function togglePlayIndex(i) {
  const v = videos.value[i];
  const el = v && videoRefs.value[v.id];
  if (!el) return;
  if (i !== activeIndex.value) {
    activeIndex.value = i;
    if (!unlocked.value) {
      // 切换视频时也尝试开声
      unlocked.value = true;
      muted.value = false;
    }
    playActive();
    return;
  }
  if (!unlocked.value) {
    unlockSound();
    return;
  }
  if (el.paused) {
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } else {
    el.pause();
  }
}

onMounted(() => load(false));
onBeforeUnmount(() => {
  videos.value.forEach((v) => {
    const el = videoRefs.value[v.id];
    try { el?.pause?.(); } catch { /* ignore */ }
  });
});
</script>

<template>
  <div class="douyin-page">
    <header class="dy-nav">
      <button class="dy-btn" type="button" aria-label="返回" @click="emit('back')">‹</button>
      <div class="dy-title">看一看</div>
      <div class="dy-actions">
        <button class="dy-btn text" type="button" @click="toggleMute">{{ muted ? '开声音' : '静音' }}</button>
        <button class="dy-btn text" type="button" :disabled="refreshing || loading" @click="load(true)">
          {{ refreshing ? '刷新中' : '刷新' }}
        </button>
      </div>
    </header>

    <div v-if="loading && !videos.length" class="dy-empty">加载中…</div>
    <div v-else-if="!videos.length" class="dy-empty">
      <p>暂无视频</p>
      <button type="button" @click="load(true)">重新加载</button>
    </div>

    <div
      v-else
      ref="listEl"
      class="dy-feed"
      @scroll.passive="onScroll"
    >
      <section
        v-for="(v, i) in videos"
        :key="v.id"
        class="dy-slide"
      >
        <button class="dy-media" type="button" @click="togglePlayIndex(i)">
          <video
            :ref="(el) => setVideoRef(v.id, el)"
            class="dy-video"
            :src="v.url"
            :poster="v.cover || undefined"
            :muted="muted"
            playsinline
            loop
            webkit-playsinline
            preload="metadata"
          ></video>
          <img
            v-if="v.cover && i !== activeIndex"
            class="dy-poster"
            :src="v.cover"
            alt=""
          />
          <div v-if="i === activeIndex && muted" class="dy-playhint">
            点一下开启声音
          </div>
        </button>

        <div class="dy-overlay">
          <div class="dy-author">@{{ v.author || '推荐' }}</div>
          <div class="dy-desc">{{ v.title }}</div>
          <div class="dy-meta">
            <span v-if="v.likes">❤ {{ v.likes }}</span>
            <span class="dy-src">{{ v.source === 'douyin' ? '抖音' : (v.source === 'open' ? '有声源' : '精选') }}</span>
          </div>
        </div>

        <div class="dy-side">
          <button class="dy-side-btn" type="button" @click="toggleMute">
            {{ muted ? '🔇' : '🔊' }}
          </button>
          <button
            v-for="(n, j) in Math.min(videos.length, 12)"
            :key="'dot-' + j"
            class="dy-dot"
            type="button"
            :class="{ on: j === i }"
            @click="scrollToIndex(j)"
          ></button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.douyin-page {
  position: relative;
  flex: 1;
  min-height: 0;
  width: 100%;
  background: #000;
  overflow: hidden;
  color: #fff;
}
.dy-nav {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  height: calc(var(--nav-h) + env(safe-area-inset-top, 0px));
  padding-top: env(safe-area-inset-top, 0px);
  display: flex;
  align-items: center;
  padding-left: 4px;
  padding-right: 8px;
  background: linear-gradient(to bottom, rgba(0,0,0,0.45), transparent);
  pointer-events: none;
}
.dy-nav > * { pointer-events: auto; }
.dy-btn {
  min-width: 44px;
  height: 44px;
  border: 0;
  background: transparent;
  color: #fff;
  font-size: 30px;
  line-height: 1;
  text-shadow: 0 1px 4px rgba(0,0,0,0.45);
}
.dy-btn.text {
  font-size: 13px;
  padding: 0 6px;
  min-width: auto;
}
.dy-btn:disabled { opacity: 0.55; }
.dy-title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 17px;
  font-weight: 600;
  text-shadow: 0 1px 4px rgba(0,0,0,0.45);
}
.dy-actions {
  margin-left: auto;
  display: flex;
  gap: 2px;
}
.dy-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: rgba(255,255,255,0.75);
  font-size: 14px;
}
.dy-empty button {
  min-height: 36px;
  padding: 0 16px;
  border-radius: 18px;
  border: 0;
  background: #07c160;
  color: #fff;
}
.dy-feed {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scroll-snap-type: y mandatory;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  touch-action: pan-y;
}
.dy-slide {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 100%;
  scroll-snap-align: start;
  scroll-snap-stop: always;
  background: #000;
  overflow: hidden;
}
.dy-media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  padding: 0;
  background: #000;
  display: block;
}
.dy-video,
.dy-poster {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: #000;
}
.dy-poster {
  position: absolute;
  inset: 0;
}
.dy-playhint {
  position: absolute;
  left: 50%;
  top: 46%;
  transform: translate(-50%, -50%);
  font-size: 14px;
  color: #fff;
  background: rgba(0,0,0,0.45);
  padding: 8px 14px;
  border-radius: 16px;
  pointer-events: none;
}
.dy-overlay {
  position: absolute;
  left: 0;
  right: 56px;
  bottom: calc(28px + var(--safe-b));
  padding: 0 16px;
  z-index: 5;
  text-shadow: 0 1px 4px rgba(0,0,0,0.55);
  pointer-events: none;
}
.dy-author {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
}
.dy-desc {
  font-size: 14px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.dy-meta {
  margin-top: 10px;
  display: flex;
  gap: 12px;
  font-size: 12px;
  opacity: 0.92;
}
.dy-src { color: #95ec69; }
.dy-side {
  position: absolute;
  right: 10px;
  bottom: calc(36px + var(--safe-b));
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.dy-side-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 0;
  background: rgba(0,0,0,0.35);
  color: #fff;
  font-size: 16px;
}
.dy-dot {
  width: 6px;
  height: 6px;
  border-radius: 3px;
  border: 0;
  padding: 0;
  background: rgba(255,255,255,0.28);
}
.dy-dot.on {
  height: 16px;
  background: #fff;
}
</style>
