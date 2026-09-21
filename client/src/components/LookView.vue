<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { api } from '../api.js';
import { toast } from '../toast.js';
import UploadProgress from './UploadProgress.vue';

const emit = defineEmits(['back']);

// 看一看：仅本地系统样片 + 用户 UGC，不接入抖音等外站
const props = defineProps({
  me: { type: Object, default: null },
});

const videos = ref([]);
const loading = ref(false);
const refreshing = ref(false);
const activeIndex = ref(0);
const listEl = ref(null);
const videoRefs = ref({});
const muted = ref(true);
const unlocked = ref(false);
const tip = ref('');

const showPublish = ref(false);
const publishTitle = ref('');
const publishFile = ref(null);
const publishing = ref(false);
const uploadPct = ref(0);
const fileInput = ref(null);

function setVideoRef(id, el) {
  if (el) videoRefs.value[id] = el;
}

async function load(force = false) {
  if (loading.value || refreshing.value) return;
  if (force) refreshing.value = true;
  loading.value = true;
  videoRefs.value = {};
  try {
    const data = await api.lookFeed({ refresh: force, source: 'local' });
    const list = data.videos || [];
    tip.value = data.tip || '本地 / 自有 / UGC 片源';
    videos.value = list;
    activeIndex.value = 0;
    await nextTick();
    if (listEl.value) listEl.value.scrollTop = 0;
    playActive();
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
  if (el.paused) el.play().catch(() => {});
  else el.pause();
}

function openPublish() {
  showPublish.value = true;
  publishTitle.value = '';
  publishFile.value = null;
}

function onPickVideo(e) {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  if (!f.type?.startsWith('video/') && !/\.(mp4|webm|mov|m4v)$/i.test(f.name || '')) {
    toast('请选择视频文件');
    return;
  }
  if (f.size > 40 * 1024 * 1024) {
    toast('视频不能超过 40MB');
    return;
  }
  publishFile.value = f;
  if (!publishTitle.value.trim()) {
    publishTitle.value = (f.name || '').replace(/\.[^.]+$/, '').slice(0, 24) || '我的视频';
  }
}

async function submitPublish() {
  if (publishing.value) return;
  if (!publishFile.value) {
    toast('请先选择视频');
    return;
  }
  publishing.value = true;
  uploadPct.value = 0;
  try {
    const up = await api.lookUploadVideo(publishFile.value, (p) => { uploadPct.value = p; });
    if (!up?.url) throw new Error('上传失败');
    await api.lookPublish({
      title: (publishTitle.value || '').trim() || '未命名视频',
      mediaUrl: up.url,
      author: props.me?.nickname || '我',
    });
    toast('已发布到看一看');
    showPublish.value = false;
    publishFile.value = null;
    publishTitle.value = '';
    await load(true);
  } catch (e) {
    toast(e.message || '发布失败');
  } finally {
    publishing.value = false;
    uploadPct.value = 0;
  }
}

async function deleteMine(v) {
  if (!v?.mine && v?.source !== 'ugc') return;
  const id = String(v.id || '').replace(/^ugc-/, '');
  if (!id || !/^\d+$/.test(id)) {
    toast('系统样片不可删除');
    return;
  }
  try {
    await api.lookDelete(Number(id));
    toast('已删除');
    await load(true);
  } catch (e) {
    toast(e.message || '删除失败');
  }
}

onMounted(() => {
  try { load(false); } catch { /* ignore */ }
});

onBeforeUnmount(() => {
  videos.value.forEach((v) => {
    try { videoRefs.value[v.id]?.pause?.(); } catch { /* ignore */ }
  });
});
</script>

<template>
  <div class="look-page">
    <header class="dy-nav">
      <button class="dy-btn" type="button" aria-label="返回" @click="emit('back')">‹</button>
      <div class="dy-title">看一看</div>
      <div class="dy-actions">
        <button class="dy-btn text" type="button" @click="toggleMute">{{ muted ? '开声音' : '静音' }}</button>
        <button class="dy-btn text" type="button" @click="openPublish">发布</button>
        <button class="dy-btn text" type="button" :disabled="refreshing || loading" @click="load(true)">
          {{ refreshing ? '刷新' : '刷新' }}
        </button>
      </div>
    </header>
    <div v-if="tip" class="dy-tip">{{ tip }}</div>

    <div v-if="loading && !videos.length" class="dy-empty">加载中…</div>
    <div v-else-if="!videos.length" class="dy-empty">
      <p>暂无视频</p>
      <p class="sub">可点右上角「发布」上传本地视频</p>
      <button type="button" @click="openPublish">发布视频</button>
      <button type="button" class="ghost" @click="load(true)">刷新</button>
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
          <div v-if="i === activeIndex && muted" class="dy-playhint">点一下开启声音</div>
        </button>

        <div class="dy-overlay">
          <div class="dy-author">@{{ v.author || '推荐' }}</div>
          <div class="dy-desc">{{ v.title }}</div>
          <div class="dy-meta">
            <span v-if="v.likes">❤ {{ v.likes }}</span>
            <span class="dy-src">{{ v.source === 'ugc' ? '用户上传' : '系统样片' }}</span>
          </div>
        </div>

        <div class="dy-side">
          <button class="dy-side-btn" type="button" @click="toggleMute">
            {{ muted ? '🔇' : '🔊' }}
          </button>
          <button
            v-if="v.mine || (v.source === 'ugc' && v.userId && me && v.userId === me.id)"
            class="dy-side-btn danger"
            type="button"
            title="删除"
            @click.stop="deleteMine(v)"
          >✕</button>
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

    <!-- 发布 UGC -->
    <div v-if="showPublish" class="pub-mask" @click.self="showPublish = false">
      <div class="pub-panel">
        <div class="pub-title">发布到看一看</div>
        <div class="pub-hint">仅上传到本站 `/media`，不接入抖音等外站</div>
        <input
          v-model="publishTitle"
          class="pub-input"
          type="text"
          maxlength="40"
          placeholder="标题（可选）"
        />
        <button class="pub-pick" type="button" @click="fileInput?.click()">
          {{ publishFile ? publishFile.name : '选择本地视频（≤40MB）' }}
        </button>
        <input ref="fileInput" type="file" accept="video/*" hidden @change="onPickVideo" />
        <div class="pub-actions">
          <button type="button" class="ghost" @click="showPublish = false">取消</button>
          <button type="button" class="ok" :disabled="publishing || !publishFile" @click="submitPublish">
            {{ publishing ? `上传中 ${uploadPct}%` : '发布' }}
          </button>
        </div>
      </div>
    </div>
    <UploadProgress v-if="publishing" :percent="uploadPct" label="上传视频" />
  </div>
</template>

<style scoped>
.look-page {
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
  top: 0; left: 0; right: 0;
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
  min-width: 44px; height: 44px; border: 0; background: transparent;
  color: #fff; font-size: 30px; line-height: 1;
  text-shadow: 0 1px 4px rgba(0,0,0,0.45);
}
.dy-btn.text { font-size: 13px; padding: 0 6px; min-width: auto; }
.dy-title {
  flex: 1; text-align: center; font-size: 16px; font-weight: 600; color: #fff;
}
.dy-actions { margin-left: auto; display: flex; gap: 2px; }
.dy-tip {
  position: absolute; left: 12px; right: 12px;
  top: calc(env(safe-area-inset-top, 0px) + 48px);
  z-index: 5; text-align: center; font-size: 12px;
  color: rgba(255,255,255,0.85);
  background: rgba(0,0,0,0.35); border-radius: 999px;
  padding: 4px 10px; pointer-events: none;
}
.dy-empty {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px; color: #ccc;
}
.dy-empty .sub { font-size: 12px; color: #888; }
.dy-empty button {
  min-width: 160px; min-height: 40px; border: 0; border-radius: 20px;
  background: #07c160; color: #fff; font-size: 14px; cursor: pointer;
}
.dy-empty button.ghost { background: rgba(255,255,255,0.12); color: #fff; }
.dy-feed { position: absolute; inset: 0; overflow-y: auto; scroll-snap-type: y mandatory; }
.dy-slide {
  position: relative; width: 100%; height: 100%;
  scroll-snap-align: start; overflow: hidden; background: #000;
}
.dy-media {
  position: absolute; inset: 0; border: 0; padding: 0; background: #000;
  cursor: pointer; width: 100%; height: 100%;
}
.dy-video { width: 100%; height: 100%; object-fit: contain; background: #000; }
.dy-playhint {
  position: absolute; left: 0; right: 0; bottom: 28%;
  text-align: center; color: #fff; font-size: 14px;
  text-shadow: 0 1px 4px rgba(0,0,0,0.6); pointer-events: none;
}
.dy-overlay {
  position: absolute; left: 12px; right: 72px; bottom: 24px;
  z-index: 4; pointer-events: none;
}
.dy-author { font-size: 15px; font-weight: 600; margin-bottom: 6px; text-shadow: 0 1px 4px rgba(0,0,0,0.5); }
.dy-desc { font-size: 14px; opacity: 0.95; line-height: 1.4; text-shadow: 0 1px 4px rgba(0,0,0,0.5); }
.dy-meta { margin-top: 6px; font-size: 12px; opacity: 0.8; display: flex; gap: 8px; }
.dy-side {
  position: absolute; right: 10px; bottom: 28px; z-index: 5;
  display: flex; flex-direction: column; gap: 10px; align-items: center;
}
.dy-side-btn {
  width: 40px; height: 40px; border-radius: 50%; border: 0;
  background: rgba(255,255,255,0.18); color: #fff; font-size: 16px; cursor: pointer;
}
.dy-side-btn.danger { background: rgba(250,81,81,0.85); }
.dy-dot {
  width: 6px; height: 6px; border-radius: 50%; border: 0; padding: 0;
  background: rgba(255,255,255,0.35); cursor: pointer;
}
.dy-dot.on { background: #fff; }
.pub-mask {
  position: fixed; inset: 0; z-index: 40; background: rgba(0,0,0,0.55);
  display: flex; align-items: flex-end; justify-content: center;
}
.pub-panel {
  width: 100%; max-width: 480px;
  background: #1c1c1e; color: #fff;
  border-radius: 12px 12px 0 0;
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px));
}
.pub-title { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
.pub-hint { font-size: 12px; color: #888; margin-bottom: 12px; }
.pub-input {
  width: 100%; box-sizing: border-box;
  border: 0; border-radius: 8px; background: #2c2c2e;
  color: #fff; padding: 10px 12px; font-size: 15px; margin-bottom: 10px; outline: none;
}
.pub-pick {
  width: 100%; min-height: 44px; border: 0; border-radius: 8px;
  background: #2c2c2e; color: #fff; font-size: 14px; cursor: pointer;
  text-align: left; padding: 0 12px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pub-actions { display: flex; gap: 10px; margin-top: 14px; }
.pub-actions button {
  flex: 1; min-height: 44px; border: 0; border-radius: 8px;
  font-size: 15px; cursor: pointer;
}
.pub-actions .ghost { background: #2c2c2e; color: #fff; }
.pub-actions .ok { background: #07c160; color: #fff; font-weight: 600; }
.pub-actions .ok:disabled { opacity: 0.5; }
</style>
