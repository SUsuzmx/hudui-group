<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { musicPlayer, fmtAudioTime } from '../music-player.js';
import SongDetailView from './SongDetailView.vue';
import { preloadVisualStage } from '../visual-stage.js';

const emit = defineEmits(['back']);

const tracks = ref([]);
const loading = ref(false);
const query = ref('');
const source = ref('qq');
const showDetail = ref(false);
const listNote = ref('');
const showLogin = ref(false);
const loginProvider = ref('qq');
const cookieInput = ref('');
const loginBusy = ref(false);
const loginStatuses = ref({ netease: null, qq: null, kugou: null });
const SOURCE_LABELS = { netease: '网易云', qq: 'QQ音乐', kugou: '酷狗' };
const ALL_SOURCES = ['qq', 'netease', 'kugou'];

// 音乐库：root 列表 → 歌单详情
const showLibrary = ref(false);
const libTab = ref('likes'); // likes | playlists
const libView = ref('root'); // root | detail
const libLoading = ref(false);
const libError = ref('');
const libPlaylists = ref([]);
const libTracks = ref([]);
const activePlaylist = ref(null);
const libProviderLabel = computed(() => SOURCE_LABELS[source.value] || 'QQ音乐');
const libEntryTitle = computed(() => `Perry的${libProviderLabel.value}歌单，一起品味`);
const recommendTitle = computed(() => `${libProviderLabel.value}推荐歌曲`);
let libSeq = 0;

const current = computed(() => musicPlayer.state.current);
const playing = computed(() => musicPlayer.state.playing);
const progress = computed(() => musicPlayer.state.progress);
const duration = computed(() => musicPlayer.state.duration);
const tracksList = computed(() => (tracks.value.length ? tracks.value : musicPlayer.state.tracks));

const likedCard = computed(() => libPlaylists.value.find((p) => p.isFavorite || Number(p.specialType) === 5) || null);
const normalPlaylists = computed(() => libPlaylists.value.filter((p) => !(p.isFavorite || Number(p.specialType) === 5)));

let loadSeq = 0;

async function fetchList(q, src) {
  let data = await api.musicList({ q, source: src, limit: 30 });
  let list = data.tracks || [];
  if (src === 'qq' && list.length > 0 && list.length < 8) {
    const alt = q === '热歌' ? '热门' : (q ? q + ' 歌曲' : '新歌');
    try {
      const data2 = await api.musicList({ q: alt, source: src, limit: 30 });
      if ((data2.tracks || []).length > list.length) {
        data = data2;
        list = data2.tracks || [];
      }
    } catch { /* keep first */ }
  }
  return { data, list };
}

async function load(resetQuery) {
  const seq = ++loadSeq;
  const q = typeof resetQuery === 'string' ? resetQuery.trim() : query.value.trim();
  if (typeof resetQuery === 'string') query.value = resetQuery;
  loading.value = true;
  try {
    const { data, list } = await fetchList(q, source.value);
    if (seq !== loadSeq) return;
    tracks.value = list;
    listNote.value = (data.notes || []).join('；') || `${libProviderLabel.value} · 推荐`;
    musicPlayer.setTracks(tracks.value);
    if (!tracks.value.length) toast(listNote.value || '暂无歌曲');
  } catch (e) {
    if (seq !== loadSeq) return;
    toast(e.message || '加载失败');
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function runSearch() {
  load(query.value || '');
}

function playTrack(t) {
  if (!t) return;
  musicPlayer.setTracks(tracks.value.length ? tracks.value : musicPlayer.state.tracks);
  musicPlayer.playTrack(t);
}

const seeking = ref(false);
const seekPct = ref(0);
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
function setSource(s) {
  if (source.value === s) return;
  source.value = s;
  load(query.value || '');
  if (showLibrary.value) {
    libView.value = 'root';
    activePlaylist.value = null;
    libTracks.value = [];
    loadLibraryRoot();
  }
}
function isActive(t) {
  return current.value && current.value.id === t.id && (current.value.source || source.value) === (t.source || source.value);
}
function openDetail() { if (current.value) showDetail.value = true; }

function openLogin(provider) {
  loginProvider.value = provider || source.value || 'qq';
  showLogin.value = true;
  cookieInput.value = '';
  refreshLoginStatus();
}

async function refreshLoginStatus() {
  for (const p of ALL_SOURCES) {
    try { loginStatuses.value[p] = await api.musicProviderLoginStatus(p); }
    catch { loginStatuses.value[p] = null; }
  }
}

async function submitCookie() {
  const cookie = cookieInput.value.trim();
  if (!cookie) { toast('请粘贴 Cookie'); return; }
  loginBusy.value = true;
  try {
    const r = await api.musicProviderLoginCookie(loginProvider.value, cookie);
    toast(r.message || '登录成功');
    showLogin.value = false;
    await refreshLoginStatus();
    try {
      libView.value = 'root';
      activePlaylist.value = null;
      await loadLibraryRoot();
      toast('歌单已同步');
    } catch (e) { console.warn('[library sync]', e); }
  } catch (e) {
    toast(e.message || 'Cookie 导入失败');
  } finally {
    loginBusy.value = false;
  }
}

async function doLogout(p) {
  try {
    await api.musicProviderLogout(p);
    toast('已退出');
    await refreshLoginStatus();
    if (showLibrary.value) {
      libView.value = 'root';
      activePlaylist.value = null;
      libTracks.value = [];
      loadLibraryRoot();
    }
  } catch (e) { toast(e.message || '退出失败'); }
}

function extractSongs(r) {
  return (r && (r.songs || r.tracks)) || [];
}

async function loadLibraryRoot() {
  const seq = ++libSeq;
  const provider = source.value === 'netease' || source.value === 'kugou' ? source.value : 'qq';
  libLoading.value = true;
  libError.value = '';
  libView.value = 'root';
  activePlaylist.value = null;
  libTracks.value = [];
  try {
    if (libTab.value === 'likes') {
      const r = await api.musicProviderLikes(provider);
      if (seq !== libSeq) return;
      libTracks.value = extractSongs(r).map((t) => ({ ...t, source: t.source || provider }));
      libPlaylists.value = r.playlists || [];
      activePlaylist.value = {
        id: 'likes',
        name: '我喜欢',
        cover: libTracks.value[0]?.cover || likedCard.value?.cover || '',
        trackCount: libTracks.value.length,
        isFavorite: true,
        virtual: true,
        creator: '',
      };
      if (!libTracks.value.length && r.message) libError.value = r.message;
    } else {
      const r = await api.musicProviderPlaylists(provider);
      if (seq !== libSeq) return;
      libPlaylists.value = r.playlists || [];
      libTracks.value = [];
      if (!libPlaylists.value.length && r.message) libError.value = r.message;
    }
  } catch (e) {
    if (seq !== libSeq) return;
    libError.value = e.message || '加载失败';
    toast(e.message || '加载失败');
  } finally {
    if (seq === libSeq) libLoading.value = false;
  }
}

async function openPlaylist(pl, { playAll = false } = {}) {
  if (!pl?.id) return;
  const seq = ++libSeq;
  const provider = source.value === 'netease' || source.value === 'kugou' ? source.value : 'qq';
  libLoading.value = true;
  libError.value = '';
  activePlaylist.value = pl;
  libView.value = 'detail';
  libTracks.value = [];
  try {
    let songs = [];
    if (pl.virtual || pl.isFavorite || pl.id === 'likes') {
      // 「我喜欢」走 likes，兼容 QQ 虚拟歌单
      const r = await api.musicProviderLikes(provider);
      songs = extractSongs(r).map((t) => ({ ...t, source: t.source || provider }));
    } else {
      const r = await api.musicProviderPlaylistTracks(provider, pl.id, 200);
      songs = extractSongs(r).map((t) => ({ ...t, source: t.source || provider }));
    }
    if (seq !== libSeq) return;
    libTracks.value = songs;
    activePlaylist.value = {
      ...pl,
      trackCount: songs.length || pl.trackCount || 0,
      cover: pl.cover || songs[0]?.cover || '',
    };
    if (!songs.length) {
      libError.value = '歌单为空或无权限查看曲目';
    } else if (playAll) {
      playLibraryTrack(songs[0]);
    }
  } catch (e) {
    if (seq !== libSeq) return;
    libError.value = e.message || '歌单加载失败';
    toast(e.message || '歌单加载失败');
  } finally {
    if (seq === libSeq) libLoading.value = false;
  }
}

function playLibraryTrack(t) {
  if (!t) return;
  const list = (libTracks.value.length ? libTracks.value : [t]).map((x) => ({
    ...x,
    title: x.title || x.name,
    source: x.source || source.value,
  }));
  musicPlayer.setTracks(list);
  musicPlayer.playTrack({ ...t, title: t.title || t.name, source: t.source || source.value });
}

function playAllLibrary() {
  if (!libTracks.value.length) return;
  playLibraryTrack(libTracks.value[0]);
}

function switchLibTab(tab) {
  if (libTab.value === tab && libView.value === 'root' && !libLoading.value) {
    loadLibraryRoot();
    return;
  }
  libTab.value = tab;
  loadLibraryRoot();
}

function openLibrary(tab = libTab.value) {
  showLibrary.value = true;
  libTab.value = tab;
  loadLibraryRoot();
}

function closeLibrary() {
  showLibrary.value = false;
  libView.value = 'root';
  activePlaylist.value = null;
}

function backLib() {
  if (libView.value === 'detail') {
    libView.value = 'root';
    activePlaylist.value = null;
    libTracks.value = [];
    libError.value = '';
    // 回列表时刷新，但不再自动进详情
    loadLibraryRoot();
    return;
  }
  closeLibrary();
}

function playlistBadge(pl) {
  if (pl.isFavorite || Number(pl.specialType) === 5) return '我喜欢';
  if (pl.subscribed) return '收藏';
  if (pl.virtual) return '我喜欢';
  return '歌单';
}

onMounted(() => {
  musicPlayer.ensureAudio();
  refreshLoginStatus();
  // 列表先出来，视觉引擎（three 约 600KB）空闲再拉，避免进页长时间空屏
  setTimeout(() => { preloadVisualStage(); }, 300);
  if (!tracksList.value.length) load('');
  else tracks.value = musicPlayer.state.tracks.slice();
});
</script>

<template>
  <div class="page">
    <header class="nav">
      <button class="nav-back" type="button" @click="emit('back')">‹</button>
      <div class="nav-title">听一听</div>
      <div class="nav-actions">
        <button class="nav-chip" type="button" @click="openLogin()">音源</button>
      </div>
    </header>

    <div class="search-bar">
      <div class="search-input">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
          <path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <input v-model="query" type="search" placeholder="搜索歌曲 / 音乐人" @keydown.enter="runSearch()" />
      </div>
      <button class="search-btn" type="button" @click="runSearch()">搜索</button>
    </div>

    <div class="source-tabs" role="tablist">
      <button type="button" role="tab" :aria-selected="source === 'qq'" :class="{ on: source === 'qq' }" @click="setSource('qq')">QQ音乐</button>
      <button type="button" role="tab" :aria-selected="source === 'netease'" :class="{ on: source === 'netease' }" @click="setSource('netease')">网易云</button>
      <button type="button" role="tab" :aria-selected="source === 'kugou'" :class="{ on: source === 'kugou' }" @click="setSource('kugou')">酷狗</button>
      <div class="source-hint">{{ listNote }}</div>
    </div>

    <!-- 歌单主入口：完整可点卡片，引导打开音乐库 -->
    <button class="lib-entry" type="button" @click="openLibrary()">
      <div class="lib-entry-art" aria-hidden="true">
        <span>♫</span>
      </div>
      <div class="lib-entry-text">
        <div class="lib-entry-title">{{ libEntryTitle }}</div>
        <div class="lib-entry-sub">我喜欢 · 自建 / 收藏 · 点开听歌</div>
      </div>
      <div class="lib-entry-go" aria-hidden="true">›</div>
    </button>

    <main class="list scroll-y" :class="{ 'has-player': !!current }">
      <div class="section-label recommend-label">{{ recommendTitle }}</div>
      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="!tracksList.length" class="empty">暂无歌曲</div>
      <button
        v-for="(t, idx) in tracksList"
        :key="t.source + '-' + t.id"
        class="song"
        type="button"
        :class="{ active: isActive(t) }"
        @click="playTrack(t)"
      >
        <div class="song-index">{{ idx + 1 }}</div>
        <div class="cover">
          <img v-if="t.cover" :src="t.cover" :alt="t.title" loading="lazy" />
          <span v-else>♪</span>
        </div>
        <div class="meta">
          <div class="title">{{ t.title }}</div>
          <div class="sub">
            {{ t.artist }}
            <template v-if="t.duration"> · {{ fmtAudioTime(t.duration) }}</template>
          </div>
        </div>
        <div class="play-ico">{{ isActive(t) && playing ? '❚❚' : '▶' }}</div>
      </button>
    </main>

    <!-- 音乐库全屏层 -->
    <div v-if="showLibrary" class="lib-layer">
      <header class="lib-nav">
        <button class="nav-back" type="button" @click="backLib()">‹</button>
        <div class="lib-nav-title">
          <template v-if="libView === 'detail'">
            <div class="lib-nav-name">{{ activePlaylist?.name || '歌单' }}</div>
            <div class="lib-nav-sub">{{ libProviderLabel }} · {{ libTracks.length || activePlaylist?.trackCount || 0 }} 首</div>
          </template>
          <template v-else>
            <div class="lib-nav-name">{{ libEntryTitle }}</div>
            <div class="lib-nav-sub">{{ libProviderLabel }}</div>
          </template>
        </div>
        <button class="nav-chip" type="button" @click="closeLibrary()">关闭</button>
      </header>

      <div v-if="libView === 'root'" class="lib-tabs">
        <button type="button" :class="{ on: libTab === 'likes' }" @click="switchLibTab('likes')">我喜欢</button>
        <button type="button" :class="{ on: libTab === 'playlists' }" @click="switchLibTab('playlists')">歌单</button>
      </div>

      <div class="lib-body scroll-y" :class="{ 'has-player': !!current }">
        <div v-if="libLoading" class="lib-state">
          <div class="lib-spinner" />
          <div>正在同步歌单…</div>
        </div>

        <!-- 歌单详情 -->
        <template v-else-if="libView === 'detail'">
          <div class="detail-hero">
            <div class="detail-cover" :class="{ liked: activePlaylist?.isFavorite || activePlaylist?.virtual }">
              <img v-if="activePlaylist?.cover" :src="activePlaylist.cover" alt="" />
              <span v-else-if="activePlaylist?.isFavorite || activePlaylist?.virtual" class="heart">♥</span>
              <span v-else>♫</span>
            </div>
            <div class="detail-info">
              <div class="detail-badge">{{ playlistBadge(activePlaylist || {}) }}</div>
              <h2 class="detail-title">{{ activePlaylist?.name || '歌单' }}</h2>
              <div class="detail-meta">
                {{ libTracks.length || activePlaylist?.trackCount || 0 }} 首
                <template v-if="activePlaylist?.creator"> · {{ activePlaylist.creator }}</template>
              </div>
              <button class="play-all" type="button" :disabled="!libTracks.length" @click="playAllLibrary()">
                <span class="play-all-ico">▶</span> 播放全部
              </button>
            </div>
          </div>

          <div v-if="libError && !libTracks.length" class="lib-state">{{ libError }}</div>
          <div v-else-if="!libTracks.length" class="lib-state">暂无歌曲</div>

          <div v-else class="track-list">
            <button
              v-for="(t, idx) in libTracks"
              :key="'det-' + t.source + '-' + t.id + '-' + idx"
              class="song"
              type="button"
              :class="{ active: isActive(t) }"
              @click="playLibraryTrack(t)"
            >
              <div class="song-index" :class="{ playing: isActive(t) && playing }">{{ isActive(t) && playing ? '♪' : idx + 1 }}</div>
              <div class="cover">
                <img v-if="t.cover" :src="t.cover" :alt="t.title || t.name" loading="lazy" />
                <span v-else>♪</span>
              </div>
              <div class="meta">
                <div class="title">{{ t.title || t.name }}</div>
                <div class="sub">
                  {{ t.artist || '未知歌手' }}
                  <template v-if="t.album"> · {{ t.album }}</template>
                  <template v-if="t.duration"> · {{ fmtAudioTime(t.duration) }}</template>
                </div>
              </div>
              <div class="play-ico">{{ isActive(t) && playing ? '❚❚' : '▶' }}</div>
            </button>
          </div>
        </template>

        <!-- 音乐库首页 -->
        <template v-else>
          <div v-if="libError && !libPlaylists.length && !libTracks.length" class="lib-state">{{ libError }}</div>

          <!-- 我喜欢入口：两个 tab 都露出，点进详情看曲目 -->
          <button
            v-if="likedCard || (libTab === 'likes' && activePlaylist)"
            class="hero-liked"
            type="button"
            @click="openPlaylist(likedCard || activePlaylist)"
          >
            <div class="hero-liked-art">
              <img v-if="likedCard?.cover || activePlaylist?.cover || libTracks[0]?.cover" :src="likedCard?.cover || activePlaylist?.cover || libTracks[0]?.cover" alt="" />
              <span v-else>♥</span>
            </div>
            <div class="hero-liked-text">
              <div class="hero-liked-title">我喜欢</div>
              <div class="hero-liked-sub">
                {{ likedCard?.trackCount || activePlaylist?.trackCount || libTracks.length || 0 }} 首 · {{ libProviderLabel }}
              </div>
            </div>
            <div class="hero-liked-go">›</div>
          </button>
          <div v-if="libTab === 'likes' && !likedCard && !libTracks.length && !libLoading" class="lib-state">
            暂无「我喜欢」，去音源里点亮几首吧
          </div>

          <!-- 我喜欢 tab：根视图直接铺曲目，点歌即播 -->
          <template v-if="libTab === 'likes' && libTracks.length">
            <div class="section-label">曲目 · {{ libTracks.length }}</div>
            <div class="track-list">
              <button
                v-for="(t, idx) in libTracks"
                :key="'like-' + t.source + '-' + t.id + '-' + idx"
                class="song"
                type="button"
                :class="{ active: isActive(t) }"
                @click="playLibraryTrack(t)"
              >
                <div class="song-index" :class="{ playing: isActive(t) && playing }">{{ isActive(t) && playing ? '♪' : idx + 1 }}</div>
                <div class="cover">
                  <img v-if="t.cover" :src="t.cover" :alt="t.title || t.name" loading="lazy" />
                  <span v-else>♪</span>
                </div>
                <div class="meta">
                  <div class="title">{{ t.title || t.name }}</div>
                  <div class="sub">
                    {{ t.artist || '未知歌手' }}
                    <template v-if="t.duration"> · {{ fmtAudioTime(t.duration) }}</template>
                  </div>
                </div>
                <div class="play-ico">{{ isActive(t) && playing ? '❚❚' : '▶' }}</div>
              </button>
            </div>
          </template>

          <template v-if="libTab === 'playlists'">
            <div class="section-label">全部歌单</div>
            <div v-if="normalPlaylists.length" class="pl-list">
              <button
                v-for="p in normalPlaylists"
                :key="p.id"
                class="pl-card"
                type="button"
                @click="openPlaylist(p)"
              >
                <div class="pl-cover">
                  <img v-if="p.cover" :src="p.cover" alt="" loading="lazy" />
                  <span v-else>♫</span>
                </div>
                <div class="pl-meta">
                  <div class="pl-title">{{ p.name }}</div>
                  <div class="pl-sub">
                    <span class="pl-tag">{{ playlistBadge(p) }}</span>
                    {{ p.trackCount || 0 }} 首
                    <template v-if="p.creator"> · {{ p.creator }}</template>
                  </div>
                </div>
                <div class="pl-arrow">›</div>
              </button>
            </div>
            <div v-else-if="libTab === 'playlists' && !libLoading" class="lib-state">暂无自建 / 收藏歌单</div>
          </template>
        </template>
      </div>
    </div>

    <footer v-if="current && !showDetail" class="player">
      <div class="player-console" @click.stop>
        <div
          class="progress-bar"
          :class="{ 'is-dragging': seeking }"
          :style="{ '--pct': displayPct + '%' }"
        >
          <input class="progress-input" type="range" min="0" max="100" step="0.1" :value="displayPct" @input="onSeekInput" @change="onSeekDone" />
        </div>
        <div class="controls">
          <div class="control-cluster actions">
            <button type="button" class="control-track" @click="openDetail">
              <div class="control-cover" :class="{ 'cover-empty': !current.cover }">
                <img v-if="current.cover" :src="current.cover" alt="" />
              </div>
              <div class="control-meta">
                <div class="control-title">{{ current.title }}</div>
                <div class="control-artist">{{ current.artist }} · {{ SOURCE_LABELS[current.source] || 'QQ' }}</div>
              </div>
            </button>
          </div>
          <div class="control-cluster transport">
            <button type="button" class="ctrl-btn" title="上一首" @click="musicPlayer.prevTrack()">
              <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
            </button>
            <button type="button" class="ctrl-btn play-btn" :class="{ playing }" title="播放/暂停" @click="musicPlayer.togglePlay()">
              <svg v-if="!playing" width="22" height="22" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              <svg v-else width="22" height="22" fill="currentColor" viewBox="0 0 24 24"><path d="M7 5h3v14H7zm7 0h3v14h-3z"/></svg>
            </button>
            <button type="button" class="ctrl-btn" title="下一首" @click="musicPlayer.nextTrack()">
              <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
            </button>
          </div>
          <div class="control-cluster modes">
            <div class="time-display">{{ fmtAudioTime(progress) }} / {{ fmtAudioTime(duration || current.duration) }}</div>
          </div>
        </div>
      </div>
    </footer>

    <SongDetailView v-if="showDetail" @close="showDetail = false" />

    <div v-if="showLogin" class="login-mask" @click.self="showLogin = false">
      <div class="login-panel">
        <div class="login-title">音源登录</div>
        <div class="login-status">
          <div>网易云：{{ loginStatuses.netease?.loggedIn ? (loginStatuses.netease.nickname || '已登录') + (loginStatuses.netease.isSvip ? '（SVIP）' : loginStatuses.netease.isVip ? '（VIP）' : '') : '未登录' }}</div>
          <div>QQ音乐：{{ loginStatuses.qq?.loggedIn ? '已登录 ' + (loginStatuses.qq.userId || '') : '未登录' }}</div>
          <div>酷狗：{{ loginStatuses.kugou?.loggedIn ? (loginStatuses.kugou.nickname || '已登录') + (loginStatuses.kugou.vipLabel && loginStatuses.kugou.vipLabel !== '无VIP' ? `（${loginStatuses.kugou.vipLabel}）` : '') : '未登录' }}</div>
        </div>
        <div class="login-tabs">
          <button type="button" :class="{ on: loginProvider === 'qq' }" @click="loginProvider = 'qq'">QQ</button>
          <button type="button" :class="{ on: loginProvider === 'netease' }" @click="loginProvider = 'netease'">网易云</button>
          <button type="button" :class="{ on: loginProvider === 'kugou' }" @click="loginProvider = 'kugou'">酷狗</button>
        </div>
        <textarea v-model="cookieInput" rows="4" :placeholder="loginProvider === 'qq' ? 'Cookie 需含 uin + qm_keyst' : loginProvider === 'kugou' ? 'Cookie 需含 KuGoo（内含 userid/token）' : 'Cookie 需含 MUSIC_U'"></textarea>
        <div class="login-actions">
          <button type="button" @click="showLogin = false">取消</button>
          <button type="button" @click="doLogout(loginProvider)">退出</button>
          <button type="button" :disabled="loginBusy" @click="submitCookie">{{ loginBusy ? '导入中…' : '导入 Cookie' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--bg); width: 100%; position: relative; }
.nav { height: var(--nav-h); flex-shrink: 0; position: relative; display: flex; align-items: center; padding: 0 8px; background: var(--bg); border-bottom: 0.5px solid var(--divider); }
.nav-back { width: 40px; height: 44px; border: 0; background: transparent; color: var(--text); font-size: 28px; line-height: 1; }
.nav-title { position: absolute; left: 50%; transform: translateX(-50%); font-size: 17px; font-weight: 600; color: var(--text); }
.nav-actions { margin-left: auto; display: flex; gap: 6px; align-items: center; }
.nav-chip {
  height: 30px; padding: 0 14px; border-radius: 15px; border: 0;
  background: var(--white); color: var(--green); font-size: 13px; font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 1px 4px rgba(0,0,0,.04);
  cursor: pointer;
}
.nav-chip:active { transform: scale(0.96); background: var(--divider-soft); }

/* 歌单主入口卡片 */
.lib-entry {
  display: flex; align-items: center; gap: 12px;
  width: calc(100% - 24px); margin: 2px 12px 10px;
  padding: 12px 14px;
  border: 0; border-radius: 16px;
  background:
    linear-gradient(135deg, rgba(7,193,96,.16), rgba(7,193,96,.06) 48%, rgba(255,156,110,.10));
  color: var(--text); text-align: left;
  box-shadow: 0 6px 18px rgba(7, 193, 96, 0.10), inset 0 0 0 1px rgba(7,193,96,.12);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.lib-entry:hover {
  box-shadow: 0 8px 22px rgba(7, 193, 96, 0.16), inset 0 0 0 1px rgba(7,193,96,.2);
}
.lib-entry:active {
  transform: scale(0.98);
  box-shadow: 0 2px 8px rgba(7, 193, 96, 0.12), inset 0 0 0 1px rgba(7,193,96,.22);
}
.lib-entry-art {
  width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(145deg, #07c160, #05a34f);
  color: #fff; font-size: 20px;
  box-shadow: 0 4px 12px rgba(7,193,96,.28);
}
.lib-entry-text { flex: 1; min-width: 0; }
.lib-entry-title {
  font-size: 15px; font-weight: 700; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lib-entry-sub {
  margin-top: 3px; font-size: 12px; color: var(--text-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lib-entry-go {
  width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(7,193,96,.14); color: var(--green);
  font-size: 22px; line-height: 1; font-weight: 600;
}

.search-bar { display: flex; gap: 8px; padding: 10px 12px 8px; background: var(--bg); }
.search-input {
  flex: 1; display: flex; align-items: center; gap: 8px;
  min-height: 38px; border-radius: 12px; padding: 0 12px;
  background: var(--white); color: var(--text-3);
}
.search-input input {
  flex: 1; min-width: 0; border: 0; background: transparent; color: var(--text);
  outline: none; font-size: 14px;
}
.search-input input::placeholder { color: var(--text-3); }
.search-btn {
  min-width: 64px; border: 0; border-radius: 12px; background: var(--green); color: #fff;
  font-size: 14px; font-weight: 500;
}

.source-tabs { display: flex; gap: 8px; padding: 0 12px 10px; background: var(--bg); align-items: center; }
.source-tabs button {
  min-height: 32px; padding: 0 14px; border-radius: 16px; border: 1px solid var(--divider);
  background: var(--white); color: var(--text-2); font-size: 13px;
}
.source-tabs button.on {
  background: rgba(7,193,96,.12); border-color: transparent; color: var(--green); font-weight: 600;
}
.source-hint {
  margin-left: auto; font-size: 11px; color: var(--text-3);
  max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.list { flex: 1; min-height: 0; overflow-y: auto; background: var(--white); padding-bottom: 16px; }
.list.has-player { padding-bottom: 120px; }
.empty { padding: 48px 20px; text-align: center; color: var(--text-3); font-size: 14px; }

.song {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border: 0; border-bottom: 0.5px solid var(--divider-soft);
  background: var(--white); text-align: left;
}
.song.active { background: rgba(7,193,96,.07); }
.song-index {
  width: 22px; flex-shrink: 0; text-align: center;
  font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums;
}
.song-index.playing { color: var(--green); font-weight: 700; }
.cover {
  width: 48px; height: 48px; border-radius: 8px; overflow: hidden;
  background: var(--divider-soft); display: flex; align-items: center; justify-content: center;
  color: var(--text-3); font-size: 18px; flex-shrink: 0;
}
.cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.meta { flex: 1; min-width: 0; }
.title {
  font-size: 15px; color: var(--text); font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sub {
  margin-top: 3px; font-size: 12px; color: var(--text-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.play-ico { color: var(--text-3); font-size: 13px; flex-shrink: 0; }

/* ===== 音乐库层 ===== */
.lib-layer {
  position: absolute; inset: 0; z-index: 40;
  display: flex; flex-direction: column;
  background: var(--bg);
  /* 底部给播放控制台留位，控制台 z-index 更高会浮在音乐库上 */
  pointer-events: auto;
}
.lib-nav {
  height: var(--nav-h); flex-shrink: 0; position: relative;
  display: flex; align-items: center; padding: 0 8px;
  background: var(--bg); border-bottom: 0.5px solid var(--divider);
}
.lib-nav-title { flex: 1; min-width: 0; text-align: center; padding: 0 4px; }
.lib-nav-name {
  font-size: 15px; font-weight: 650; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lib-nav-sub { margin-top: 1px; font-size: 11px; color: var(--text-3); }

.lib-tabs {
  display: flex; gap: 8px; padding: 12px 14px 8px;
  background: var(--bg);
}
.lib-tabs button {
  min-height: 34px; padding: 0 16px; border-radius: 17px;
  border: 0; background: var(--white); color: var(--text-2); font-size: 13px;
}
.lib-tabs button.on {
  background: var(--green); color: #fff; font-weight: 600;
}

.lib-body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 4px 12px calc(16px + var(--safe-b, 0px));
}
.lib-body.has-player {
  padding-bottom: calc(118px + var(--safe-b, 0px)) !important;
}

.lib-state {
  padding: 36px 16px; text-align: center; color: var(--text-3); font-size: 13px; line-height: 1.6;
}
.lib-spinner {
  width: 22px; height: 22px; margin: 0 auto 12px;
  border: 2px solid var(--divider); border-top-color: var(--green); border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.section-label {
  margin: 14px 4px 8px;
  font-size: 12px; font-weight: 600; color: var(--text-3);
  letter-spacing: 0.04em;
}
.recommend-label {
  margin: 12px 14px 6px;
  color: var(--text-2);
}

/* 我喜欢 hero */
.hero-liked {
  width: 100%; display: flex; align-items: center; gap: 14px;
  border: 0; border-radius: 18px; padding: 14px;
  background:
    linear-gradient(135deg, rgba(255, 92, 120, 0.16), rgba(255, 156, 110, 0.12) 55%, rgba(7, 193, 96, 0.10));
  color: var(--text); text-align: left;
  box-shadow: 0 8px 24px rgba(0,0,0,.04);
  cursor: pointer;
  transition: transform 0.15s ease;
}
.hero-liked:active { transform: scale(0.98); }
.hero-liked-art {
  width: 64px; height: 64px; border-radius: 14px; overflow: hidden; flex-shrink: 0;
  background: linear-gradient(145deg, #ff6b7a, #ff8f6b);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 28px;
  box-shadow: 0 6px 16px rgba(255, 92, 120, 0.28);
}
.hero-liked-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hero-liked-text { flex: 1; min-width: 0; }
.hero-liked-title { font-size: 17px; font-weight: 700; color: var(--text); }
.hero-liked-sub { margin-top: 4px; font-size: 12px; color: var(--text-2); }
.hero-liked-go {
  width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(7,193,96,.12); color: var(--green); font-size: 22px; line-height: 1;
}

/* 歌单卡片 */
.pl-list { display: flex; flex-direction: column; gap: 8px; }
.pl-card {
  width: 100%; display: flex; align-items: center; gap: 12px;
  border: 0; border-radius: 16px; padding: 10px 12px;
  background: var(--white); color: var(--text); text-align: left;
  box-shadow: 0 2px 10px rgba(0,0,0,.03);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.pl-card:hover { box-shadow: 0 4px 14px rgba(0,0,0,.06); }
.pl-card:active { transform: scale(0.985); }
.pl-cover {
  width: 56px; height: 56px; border-radius: 12px; overflow: hidden; flex-shrink: 0;
  background: linear-gradient(145deg, rgba(7,193,96,.18), rgba(7,193,96,.05));
  display: flex; align-items: center; justify-content: center;
  color: var(--green); font-size: 20px;
}
.pl-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pl-meta { flex: 1; min-width: 0; }
.pl-title {
  font-size: 15px; font-weight: 600; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pl-sub {
  margin-top: 5px; font-size: 12px; color: var(--text-2);
  display: flex; align-items: center; gap: 6px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pl-tag {
  display: inline-flex; align-items: center; height: 18px; padding: 0 7px;
  border-radius: 9px; background: rgba(7,193,96,.12); color: var(--green);
  font-size: 10px; font-weight: 600; flex-shrink: 0;
}
.pl-arrow { color: var(--text-3); font-size: 22px; flex-shrink: 0; }

/* 歌单详情 */
.detail-hero {
  display: flex; gap: 14px; align-items: stretch;
  padding: 8px 4px 16px;
}
.detail-cover {
  width: 108px; height: 108px; border-radius: 16px; overflow: hidden; flex-shrink: 0;
  background: linear-gradient(145deg, rgba(7,193,96,.2), rgba(7,193,96,.05));
  display: flex; align-items: center; justify-content: center;
  color: var(--green); font-size: 36px;
  box-shadow: 0 10px 28px rgba(0,0,0,.08);
}
.detail-cover.liked {
  background: linear-gradient(145deg, #ff6b7a, #ff8f6b);
  color: #fff;
  box-shadow: 0 10px 28px rgba(255, 92, 120, 0.28);
}
.detail-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.detail-cover .heart { font-size: 40px; line-height: 1; }
.detail-info {
  flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 6px;
}
.detail-badge {
  align-self: flex-start; height: 20px; padding: 0 8px; border-radius: 10px;
  background: rgba(7,193,96,.12); color: var(--green);
  font-size: 11px; font-weight: 600; line-height: 20px;
}
.detail-title {
  margin: 0; font-size: 20px; font-weight: 750; color: var(--text); line-height: 1.25;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.detail-meta { font-size: 12px; color: var(--text-2); }
.play-all {
  align-self: flex-start; margin-top: 4px;
  height: 34px; padding: 0 14px; border: 0; border-radius: 17px;
  background: var(--green); color: #fff; font-size: 13px; font-weight: 600;
  display: inline-flex; align-items: center; gap: 6px;
}
.play-all:disabled { opacity: 0.4; }
.play-all-ico { font-size: 11px; }

.track-list {
  border-radius: 16px; overflow: hidden;
  background: var(--white);
  box-shadow: 0 2px 10px rgba(0,0,0,.03);
}
.track-list .song:last-child { border-bottom: 0; }

/* 播放器控制台：始终浮在音乐库层之上 */
.player {
  position: absolute; left: 0; right: 0; bottom: 0;
  z-index: 45 !important;
}
.player { display: block !important; background: transparent !important; border: 0 !important; padding: 8px 0 calc(10px + var(--safe-b, 0px)) !important; }
.player-console {
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
  margin: 0 10px !important;
  padding: 8px 14px 12px !important;
  border-radius: 28px !important;
  background: rgba(20, 22, 26, 0.72) !important;
  backdrop-filter: blur(14px) saturate(1.6) !important;
  box-shadow: inset 0 0 2px 1px rgba(255,255,255,.22), 0 8px 24px rgba(0,0,0,.25) !important;
  color: #fff !important;
  overflow: visible !important;
}
.player-console .controls {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) max-content minmax(0, 1fr) !important;
  align-items: center !important;
  gap: 10px !important;
  width: 100% !important;
}
.player-console .control-cluster {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 8px !important;
  min-width: 0 !important;
}
.player-console .control-track {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 10px !important;
  min-width: 0 !important;
  width: auto !important;
  max-width: 100% !important;
  border: 0 !important;
  background: transparent !important;
  padding: 0 !important;
  color: inherit !important;
}
.player-console .control-cover {
  width: 48px !important;
  height: 48px !important;
  min-width: 48px !important;
  max-width: 48px !important;
  min-height: 48px !important;
  max-height: 48px !important;
  flex: 0 0 48px !important;
  border-radius: 10px !important;
  overflow: hidden !important;
  background: rgba(255,255,255,.08) !important;
}
.player-console .control-cover img {
  width: 48px !important;
  height: 48px !important;
  max-width: 48px !important;
  max-height: 48px !important;
  object-fit: cover !important;
  display: block !important;
}
.player-console .control-meta { min-width: 0 !important; max-width: 42vw !important; text-align: left !important; }
.player-console .control-title { font-size: 13px !important; font-weight: 700 !important; text-align: left !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.player-console .control-artist { font-size: 11px !important; color: rgba(255,255,255,.55) !important; text-align: left !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.player-console .transport { justify-content: center !important; }
.player-console .modes { justify-content: flex-end !important; }
.player-console .time-display { min-width: 84px !important; text-align: right !important; font-size: 11px !important; color: rgba(255,255,255,.55) !important; font-variant-numeric: tabular-nums; }
.player-console .progress-bar {
  display: block !important;
  position: relative !important;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  flex: 0 0 8px !important;
  height: 8px !important;
  min-height: 8px !important;
  max-height: 8px !important;
  margin: 6px 0 4px !important;
  border-radius: 999px !important;
  overflow: visible !important;
  /* 已播进度直接画在轨道背景上，避免子元素被压扁看不见 */
  background: linear-gradient(
    to right,
    #7cf5c8 0%,
    #00f5d4 var(--pct, 0%),
    rgba(255, 255, 255, 0.28) var(--pct, 0%),
    rgba(255, 255, 255, 0.28) 100%
  ) !important;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.06) !important;
}
.player-console .progress-input {
  position: absolute !important;
  inset: -10px 0 !important;
  width: 100% !important;
  max-width: none !important;
  height: 28px !important;
  margin: 0 !important;
  opacity: 0 !important;
  appearance: none !important;
  -webkit-appearance: none !important;
  background: transparent !important;
  z-index: 3 !important;
  cursor: pointer !important;
}
.page main { overflow-y: auto !important; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; flex: 1 1 auto; min-height: 0; max-height: none; }

/* 登录 */
.login-mask { position: absolute; inset: 0; z-index: 50; background: rgba(0,0,0,.35); display: flex; align-items: flex-end; }
.login-panel { width: 100%; background: var(--white); border-radius: 16px 16px 0 0; padding: 16px 16px calc(16px + var(--safe-b)); color: var(--text); }
.login-title { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
.login-status { font-size: 12px; color: var(--text-2); line-height: 1.6; margin-bottom: 8px; }
.login-tabs { display: flex; gap: 8px; margin-bottom: 8px; }
.login-tabs button { min-height: 32px; padding: 0 14px; border-radius: 16px; border: 1px solid var(--divider); background: var(--bg); color: var(--text-2); font-size: 13px; }
.login-tabs button.on { border-color: var(--green); color: var(--green); }
.login-panel textarea { width: 100%; border: 1px solid var(--divider); border-radius: 8px; padding: 10px; font-size: 12px; box-sizing: border-box; background: var(--bg); color: var(--text); }
.login-actions { margin-top: 10px; display: flex; gap: 8px; justify-content: flex-end; }
.login-actions button { min-height: 36px; padding: 0 14px; border-radius: 8px; border: 0; font-size: 13px; background: var(--divider-soft); color: var(--text); }
.login-actions button:last-child { background: var(--green); color: #fff; }
</style>
