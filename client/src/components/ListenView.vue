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
const loginStatuses = ref({ netease: null, qq: null });
const showLibrary = ref(false);
const libTab = ref('likes'); // likes | playlists
const libLoading = ref(false);
const libNote = ref('');
const libPlaylists = ref([]);
const libTracks = ref([]);

const current = computed(() => musicPlayer.state.current);
const playing = computed(() => musicPlayer.state.playing);
const progress = computed(() => musicPlayer.state.progress);
const duration = computed(() => musicPlayer.state.duration);
const tracksList = computed(() => (tracks.value.length ? tracks.value : musicPlayer.state.tracks));

async function load(resetQuery) {
  loading.value = true;
  try {
    const q = typeof resetQuery === 'string' ? resetQuery.trim() : query.value.trim();
    const data = await api.musicList({ q, source: source.value, limit: 30 });
    tracks.value = data.tracks || [];
    listNote.value = (data.notes || []).join('；') || (source.value === 'qq' ? 'QQ音乐 · 默认音源' : '网易云音乐');
    musicPlayer.setTracks(tracks.value);
    if (!tracks.value.length) toast(listNote.value || '暂无歌曲');
  } catch (e) {
    toast(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function playTrack(t) {
  if (!t) return;
  musicPlayer.setTracks(tracks.value.length ? tracks.value : musicPlayer.state.tracks);
  musicPlayer.playTrack(t);
}

function onSeek(e) { musicPlayer.seek(e.target.value); }
function setSource(s) { source.value = s; load(''); }
function isActive(t) { return current.value && current.value.id === t.id && current.value.source === t.source; }
function openDetail() { if (current.value) showDetail.value = true; }

function openLogin(provider) {
  loginProvider.value = provider || source.value || 'qq';
  showLogin.value = true;
  cookieInput.value = '';
  refreshLoginStatus();
}

async function refreshLoginStatus() {
  for (const p of ['netease', 'qq']) {
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
  } catch (e) {
    toast(e.message || 'Cookie 导入失败');
  } finally {
    loginBusy.value = false;
  }
}

async function doLogout(p) {
  try { await api.musicProviderLogout(p); toast('已退出'); await refreshLoginStatus(); }
  catch (e) { toast(e.message || '退出失败'); }
}

async function loadLibrary() {
  libLoading.value = true;
  libNote.value = '';
  try {
    const provider = source.value === 'netease' ? 'netease' : 'qq';
    if (libTab.value === 'likes') {
      const r = await api.musicProviderLikes(provider);
      libTracks.value = r.songs || [];
      libPlaylists.value = [];
      libNote.value = r.message || `${provider === 'qq' ? 'QQ' : '网易云'} · 我喜欢 ${libTracks.value.length} 首`;
      if (!libTracks.value.length && r.playlists) libPlaylists.value = r.playlists;
    } else {
      const r = await api.musicProviderPlaylists(provider);
      libPlaylists.value = r.playlists || [];
      libTracks.value = [];
      libNote.value = r.message || `${provider === 'qq' ? 'QQ' : '网易云'} · 歌单 ${libPlaylists.value.length}`;
    }
  } catch (e) {
    libNote.value = e.message || '加载失败';
    toast(e.message || '加载失败');
  } finally {
    libLoading.value = false;
  }
}

async function openPlaylist(pl) {
  if (!pl?.id) return;
  libLoading.value = true;
  try {
    const provider = source.value === 'netease' ? 'netease' : 'qq';
    const r = await api.musicProviderPlaylistTracks(provider, pl.id, 100);
    libTracks.value = r.songs || [];
    libNote.value = `${pl.name} · ${libTracks.value.length} 首`;
    if (!libTracks.value.length) toast(r.message || '歌单为空或无权限');
  } catch (e) {
    toast(e.message || '歌单加载失败');
  } finally {
    libLoading.value = false;
  }
}

function playLibraryTrack(t) {
  if (!t) return;
  const list = libTracks.value.map((x) => ({ ...x, source: x.source || source.value }));
  musicPlayer.setTracks(list);
  musicPlayer.playTrack({ ...t, source: t.source || source.value });
}

function switchLibTab(tab) {
  libTab.value = tab;
  loadLibrary();
}

onMounted(() => {
  musicPlayer.ensureAudio();
  refreshLoginStatus();
  // 预加载视觉引擎，进详情页不必再等预设/bundle
  preloadVisualStage();
  if (!tracksList.value.length) load('');
  else tracks.value = musicPlayer.state.tracks.slice();
});
</script>

<template>
  <div class="page">
    <header class="nav">
      <button class="nav-back" type="button" @click="emit('back')">‹</button>
      <div class="nav-title">听一听</div>
      <button class="nav-right link" type="button" @click="openLogin()">音源</button>
      <button class="nav-right lib" type="button" @click="showLibrary = !showLibrary; if (showLibrary) loadLibrary()">歌单</button>
    </header>

    <div class="search-bar">
      <input v-model="query" type="search" placeholder="搜索歌曲 / 音乐人" @keydown.enter="load(query)" />
      <button type="button" @click="load(query)">搜索</button>
    </div>

    <div class="source-tabs">
      <button type="button" :class="{ on: source === 'qq' }" @click="setSource('qq')">QQ音乐</button>
      <button type="button" :class="{ on: source === 'netease' }" @click="setSource('netease')">网易云</button>
    </div>
    <div v-if="listNote" class="list-note">{{ listNote }}</div>

    <div v-if="showLibrary" class="library-panel">
      <div class="library-tabs">
        <button type="button" :class="{ on: libTab === 'likes' }" @click="switchLibTab('likes')">我喜欢</button>
        <button type="button" :class="{ on: libTab === 'playlists' }" @click="switchLibTab('playlists')">歌单</button>
        <button type="button" class="close" @click="showLibrary = false">×</button>
      </div>
      <div v-if="libNote" class="list-note">{{ libNote }}</div>
      <div v-if="libLoading" class="empty">加载中…</div>
      <template v-else>
        <div v-if="libTab === 'playlists' && libPlaylists.length" class="lib-list">
          <button v-for="p in libPlaylists" :key="p.id" type="button" class="song" @click="openPlaylist(p)">
            <div class="cover"><img v-if="p.cover" :src="p.cover" alt="" /><span v-else>☰</span></div>
            <div class="meta">
              <div class="title">{{ p.name }}</div>
              <div class="sub">{{ p.trackCount || 0 }} 首<span v-if="p.isFavorite"> · 我喜欢</span></div>
            </div>
          </button>
        </div>
        <div v-else-if="libTracks.length" class="lib-list">
          <button v-for="t in libTracks" :key="t.source + '-' + t.id" type="button" class="song" @click="playLibraryTrack(t)">
            <div class="cover"><img v-if="t.cover" :src="t.cover" alt="" /><span v-else>♪</span></div>
            <div class="meta">
              <div class="title">{{ t.title }}</div>
              <div class="sub">{{ t.artist }} · {{ source === 'netease' ? '网易云' : 'QQ音乐' }}</div>
            </div>
            <div class="play-ico">▶</div>
          </button>
        </div>
        <div v-else class="empty">{{ libNote || '暂无数据' }}</div>
      </template>
    </div>

    <main class="list scroll-y" :class="{ 'has-player': !!current }">
      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="!tracksList.length" class="empty">暂无歌曲</div>
      <button
        v-for="t in tracksList"
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
            · {{ t.source === 'netease' ? '网易云' : 'QQ音乐' }}
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

    <div v-if="showLogin" class="login-mask" @click.self="showLogin = false">
      <div class="login-panel">
        <div class="login-title">音源登录</div>
        <div class="login-status">
          <div>网易云：{{ loginStatuses.netease?.loggedIn ? (loginStatuses.netease.nickname || '已登录') + (loginStatuses.netease.isSvip ? '（SVIP）' : loginStatuses.netease.isVip ? '（VIP）' : '') : '未登录' }}</div>
          <div>QQ音乐：{{ loginStatuses.qq?.loggedIn ? '已登录 ' + (loginStatuses.qq.userId || '') : '未登录' }}</div>
        </div>
        <div class="login-tabs">
          <button type="button" :class="{ on: loginProvider === 'qq' }" @click="loginProvider = 'qq'">QQ</button>
          <button type="button" :class="{ on: loginProvider === 'netease' }" @click="loginProvider = 'netease'">网易云</button>
        </div>
        <textarea v-model="cookieInput" rows="4" :placeholder="loginProvider === 'qq' ? 'Cookie 需含 uin + qm_keyst' : 'Cookie 需含 MUSIC_U'"></textarea>
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
.nav { height: var(--nav-h); flex-shrink: 0; position: relative; display: flex; align-items: center; background: var(--bg); border-bottom: 0.5px solid var(--divider); }
.nav-back { width: 44px; height: 44px; border: 0; background: transparent; color: var(--text); font-size: 28px; }
.nav-title { position: absolute; left: 50%; transform: translateX(-50%); font-size: 17px; font-weight: 600; color: var(--text); }
.nav-right { width: 48px; margin-left: auto; height: 44px; border: 0; background: transparent; color: var(--green); font-size: 14px; }
.nav-right.lib { width: 48px; margin-left: 0; }
.library-panel {
  background: var(--white);
  border-bottom: 0.5px solid var(--divider);
  max-height: 42vh;
  overflow: auto;
}
.library-tabs { display: flex; gap: 8px; padding: 8px 12px; align-items: center; }
.library-tabs button {
  min-height: 30px; padding: 0 12px; border-radius: 15px;
  border: 1px solid var(--divider); background: var(--bg); color: var(--text-2); font-size: 13px;
}
.library-tabs button.on { border-color: var(--green); color: var(--green); }
.library-tabs button.close { margin-left: auto; border: 0; font-size: 18px; color: var(--text-3); }
.lib-list { padding-bottom: 4px; }
.search-bar { display: flex; gap: 8px; padding: 10px 12px; background: var(--bg); }
.search-bar input { flex: 1; min-height: 36px; border: 0; border-radius: 8px; padding: 0 12px; background: var(--white); color: var(--text); outline: none; font-size: 14px; }
.search-bar button { min-width: 64px; border: 0; border-radius: 8px; background: var(--green); color: #fff; font-size: 14px; }
.source-tabs { display: flex; gap: 8px; padding: 0 12px 8px; background: var(--bg); }
.source-tabs button { min-height: 32px; padding: 0 14px; border-radius: 16px; border: 1px solid var(--divider); background: var(--white); color: var(--text-2); font-size: 13px; }
.source-tabs button.on { background: rgba(7,193,96,.12); border-color: var(--green); color: var(--green); }
.list-note { padding: 0 16px 8px; font-size: 12px; color: var(--text-3); }
.list { flex: 1; min-height: 0; overflow-y: auto; background: var(--white); padding-bottom: 16px; }
.list.has-player { padding-bottom: 120px; }
.empty { padding: 40px; text-align: center; color: var(--text-3); }
.song { width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 14px; border: 0; border-bottom: 0.5px solid var(--divider-soft); background: var(--white); text-align: left; }
.song.active { background: rgba(7,193,96,.06); }
.cover { width: 48px; height: 48px; border-radius: 6px; overflow: hidden; background: var(--divider-soft); display: flex; align-items: center; justify-content: center; color: var(--text-3); font-size: 20px; flex-shrink: 0; }
.cover img { width: 100%; height: 100%; object-fit: cover; }
.meta { flex: 1; min-width: 0; }
.title { font-size: 15px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { margin-top: 4px; font-size: 12px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.play-ico { color: var(--text-2); font-size: 14px; }
.player { position: absolute; left: 0; right: 0; bottom: 0; background: var(--white); border-top: 0.5px solid var(--divider); z-index: 20; }
.player-open { width: 100%; border: 0; background: transparent; padding: 10px 14px calc(10px + var(--safe-b)); text-align: left; color: var(--text); }
.player-top { display: flex; align-items: center; gap: 12px; }
.player-info { flex: 1; min-width: 0; }
.player-title { font-size: 14px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.player-sub { margin-top: 2px; font-size: 12px; color: var(--text-2); }
.player-ctrl { display: flex; gap: 6px; }
.player-ctrl button { width: 36px; height: 36px; border-radius: 50%; border: 0; background: var(--divider-soft); color: var(--text); }
.player-ctrl button.main { background: var(--green); color: #fff; }
.player-progress { margin-top: 8px; display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-3); }
.player-progress input { flex: 1; accent-color: var(--green); }
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
