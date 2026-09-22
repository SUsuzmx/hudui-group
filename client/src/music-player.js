import { reactive } from 'vue';
import { api } from './api.js';
import { toast } from './toast.js';

const state = reactive({
  current: null,
  playing: false,
  progress: 0,
  duration: 0,
  tracks: [],
  ready: false,
  restriction: null,
  // order | one | shuffle
  playMode: localStorage.getItem('hudui_music_mode') || 'order',
});

let audio = null;
let onRestrictionAction = null;
let loadToken = 0;
let suppressAudioError = false;
let mediaSessionBound = false;
let lastPosUpdate = 0;
// 下一首直链预取，减少 ended 后异步取流被系统挂起的概率
let nextUrlCache = { key: '', url: '' };
let preloadTimer = 0;
let autoFailStreak = 0;

const RESTRICTION_ACTION_LABEL = {
  login: '去登录音源',
  upgrade: '开通/升级会员',
  purchase: '去购买该单曲',
  switch_source: '换源（网易云/QQ）',
};

export function setMusicRestrictionHandler(fn) {
  onRestrictionAction = typeof fn === 'function' ? fn : null;
}

function trackKey(t) {
  return t ? `${t.source || 'qq'}:${t.id}` : '';
}

function trackExtra(track) {
  if (!track) return {};
  return { mid: track.mid || '', mediaMid: track.mediaMid || '', title: track.title || '', artist: track.artist || '' };
}

function streamSourceOf(track) {
  return track?.source === 'netease' || track?.source === 'qq' ? track.source : 'qq';
}

function findIndex(track) {
  if (!track || !state.tracks.length) return -1;
  return state.tracks.findIndex((t) => t.id === track.id && t.source === track.source);
}

function pickNextIndex(fromIdx, { previous = false, auto = false } = {}) {
  const n = state.tracks.length;
  if (!n) return -1;
  if (state.playMode === 'one' && auto) return fromIdx < 0 ? 0 : fromIdx;
  if (state.playMode === 'shuffle' && n > 1) {
    let idx = fromIdx;
    for (let i = 0; i < 8; i += 1) {
      idx = Math.floor(Math.random() * n);
      if (idx !== fromIdx) break;
    }
    return idx;
  }
  const cur = fromIdx < 0 ? 0 : fromIdx;
  return (cur + (previous ? -1 : 1) + n) % n;
}

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'metadata';
  audio.volume = 1;
  // iOS 后台播放需要 playsinline 兼容属性（部分 WebView）
  try { audio.setAttribute('playsinline', ''); } catch { /* ignore */ }
  audio.addEventListener('timeupdate', () => {
    state.progress = audio.currentTime || 0;
    if (audio.duration && Number.isFinite(audio.duration)) state.duration = audio.duration;
    maybeUpdatePositionState();
  });
  audio.addEventListener('ended', () => {
    // 息屏/后台也尽量立即切歌；one 模式重播当前
    nextTrack({ auto: true });
  });
  audio.addEventListener('play', () => {
    state.playing = true;
    setMediaPlaybackState('playing');
    try {
      if (window.audioCtx && window.audioCtx.state === 'suspended') window.audioCtx.resume().catch(() => {});
    } catch { /* ignore */ }
  });
  audio.addEventListener('pause', () => {
    state.playing = false;
    setMediaPlaybackState('paused');
  });
  audio.addEventListener('waiting', () => {
    // 后台缓冲：不改 playing，避免误停
  });
  audio.addEventListener('error', () => {
    if (suppressAudioError || state.restriction?.message) return;
    const code = audio?.error?.code;
    if (code === 1) return;
    // 自动连播失败时跳过，而不是卡死
    if (state.playing || state.current) {
      toast('当前音源加载失败，自动切下一首');
      setTimeout(() => nextTrack({ auto: true }), 300);
      return;
    }
    state.playing = false;
    toast('当前音源加载失败，可切换「网易云 / QQ音乐」');
  });
  bindMediaSessionHandlers();
  return audio;
}

function setMediaPlaybackState(val) {
  try {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = val;
  } catch { /* ignore */ }
}

function maybeUpdatePositionState(force) {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const el = audio;
  if (!el) return;
  const now = Date.now();
  if (!force && now - lastPosUpdate < 800) return;
  lastPosUpdate = now;
  try {
    const duration = Number(el.duration) || 0;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const position = Math.min(Math.max(0, el.currentTime || 0), duration);
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: el.playbackRate || 1,
      position,
    });
  } catch { /* ignore */ }
}

function artworkList(cover) {
  if (!cover) return [];
  const abs = /^https?:\/\//i.test(cover) ? cover : new URL(cover, location.href).href;
  return [96, 128, 192, 256, 512].map((s) => ({
    src: abs,
    sizes: `${s}x${s}`,
    type: 'image/png',
  }));
}

function syncMediaMetadata(track) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  try {
    navigator.mediaSession.metadata = track
      ? new MediaMetadata({
        title: track.title || '未知歌曲',
        artist: track.artist || '未知歌手',
        album: '听一听',
        artwork: artworkList(track.cover),
      })
      : null;
    maybeUpdatePositionState(true);
  } catch { /* ignore */ }
}

function bindMediaSessionHandlers() {
  if (mediaSessionBound || !('mediaSession' in navigator)) return;
  mediaSessionBound = true;
  const safe = (fn) => () => {
    try { fn(); } catch { /* ignore */ }
  };
  const actions = {
    play: safe(() => { const el = ensureAudio(); if (el.paused) togglePlay(); }),
    pause: safe(() => { const el = ensureAudio(); if (!el.paused) togglePlay(); }),
    stop: safe(() => stopAll()),
    previoustrack: safe(() => prevTrack()),
    nexttrack: safe(() => nextTrack()),
    seekbackward: safe((d) => {
      const el = ensureAudio();
      const delta = d?.seekOffset || 10;
      el.currentTime = Math.max(0, (el.currentTime || 0) - delta);
    }),
    seekforward: safe((d) => {
      const el = ensureAudio();
      const delta = d?.seekOffset || 10;
      const max = Number.isFinite(el.duration) ? el.duration : el.currentTime + delta;
      el.currentTime = Math.min(max, (el.currentTime || 0) + delta);
    }),
    seekto: safe((d) => {
      if (d?.seekTime != null) seek(d.seekTime);
    }),
  };
  Object.entries(actions).forEach(([name, handler]) => {
    try { navigator.mediaSession.setActionHandler(name, handler); } catch { /* ignore */ }
  });
}

function handleUnplayable(info, track, { auto = false } = {}) {
  const restriction = info?.restriction || {
    category: 'url_unavailable',
    message: info?.error || '该歌曲暂无可用播放地址',
    action: 'switch_source',
  };
  state.restriction = restriction;
  state.playing = false;
  if (!auto) {
    toast(`${restriction.message || '无法播放'}（${RESTRICTION_ACTION_LABEL[restriction.action] || '换源'}）`);
    if (typeof onRestrictionAction === 'function') {
      try { onRestrictionAction(restriction, track, info); } catch { /* ignore */ }
    }
  }
  if ((restriction.action === 'switch_source' || auto) && state.tracks.length > 1) {
    if (auto) {
      autoFailStreak += 1;
      if (autoFailStreak >= Math.min(5, state.tracks.length)) {
        autoFailStreak = 0;
        state.playing = false;
        toast('多首歌曲无法播放，已停止连播');
        return restriction;
      }
      const i = findIndex(track);
      const idx = pickNextIndex(i, { auto: true });
      const next = idx >= 0 ? state.tracks[idx] : null;
      if (next && trackKey(next) !== trackKey(track)) playTrack(next, { auto: true });
      return restriction;
    }
    const other = state.tracks.find((t) => (t.source === 'netease' || t.source === 'qq') && !(t.id === track.id && t.source === track.source));
    if (other) setTimeout(() => playTrack(other), 400);
  }
  return restriction;
}

function isPlayableInfo(info) {
  if (!info) return false;
  if (info.playable === false) return false;
  return Boolean(info.url);
}

async function resolveStreamUrl(track) {
  const key = trackKey(track);
  if (nextUrlCache.key === key && nextUrlCache.url) {
    const url = nextUrlCache.url;
    nextUrlCache = { key: '', url: '' };
    return url;
  }
  const streamSource = streamSourceOf(track);
  const extra = trackExtra(track);
  const info = await api.musicStreamInfo(streamSource, track.id, extra);
  if (!isPlayableInfo(info)) {
    const err = new Error(info?.error || 'unplayable');
    err.responseJson = info;
    throw err;
  }
  return info.url;
}

async function preloadNextUrl() {
  if (preloadTimer) {
    clearTimeout(preloadTimer);
    preloadTimer = 0;
  }
  const idx = findIndex(state.current);
  const nextIdx = pickNextIndex(idx, { auto: true });
  const next = state.tracks[nextIdx];
  if (!next || trackKey(next) === trackKey(state.current)) return;
  const key = trackKey(next);
  if (nextUrlCache.key === key && nextUrlCache.url) return;
  try {
    const streamSource = streamSourceOf(next);
    const info = await api.musicStreamInfo(streamSource, next.id, trackExtra(next));
    if (isPlayableInfo(info)) nextUrlCache = { key, url: info.url };
    else nextUrlCache = { key: '', url: '' };
  } catch {
    nextUrlCache = { key: '', url: '' };
  }
}

function schedulePreloadNext() {
  if (preloadTimer) clearTimeout(preloadTimer);
  // 稍后预取，避开当前曲目起播抢带宽；后台也尽量执行
  preloadTimer = setTimeout(() => {
    preloadTimer = 0;
    preloadNextUrl().catch(() => {});
  }, 1200);
}

async function playTrack(track, opts = {}) {
  if (!track) return;
  const auto = !!opts.auto;
  const token = ++loadToken;
  const el = ensureAudio();
  suppressAudioError = true;
  state.current = track;
  state.progress = 0;
  state.duration = track.duration || 0;
  state.playing = false;
  state.ready = true;
  state.restriction = null;
  syncMediaMetadata(track);
  setMediaPlaybackState('playing');
  try {
    const url = await resolveStreamUrl(track);
    if (token !== loadToken) return;
    const el2 = el || ensureAudio();
    if (!el2) return;
    el2.src = (/^https?:/i.test(url) ? '/api/audio?url=' + encodeURIComponent(url) : url);
    await el2.play();
    if (token === loadToken) {
      state.playing = true;
      autoFailStreak = 0;
      suppressAudioError = false;
      maybeUpdatePositionState(true);
      schedulePreloadNext();
      setTimeout(() => { if (token === loadToken) suppressAudioError = false; }, 500);
    }
  } catch (err) {
    if (token !== loadToken) return;
    suppressAudioError = false;
    handleUnplayable(err?.responseJson || { error: err.message || '无法播放' }, track, { auto });
  }
}

function togglePlay() {
  const el = ensureAudio();
  if (!state.current) {
    if (state.tracks[0]) playTrack(state.tracks[0]);
    return;
  }
  if (el.paused) {
    suppressAudioError = true;
    el.play().then(() => {
      state.playing = true;
      setMediaPlaybackState('playing');
      setTimeout(() => { suppressAudioError = false; }, 400);
    }).catch(() => {
      suppressAudioError = false;
      // 后台恢复播放失败时重试一次（iOS 息屏后常见）
      setTimeout(() => {
        el.play().then(() => {
          state.playing = true;
          setMediaPlaybackState('playing');
        }).catch(() => {});
      }, 250);
    });
  } else {
    el.pause();
    state.playing = false;
    setMediaPlaybackState('paused');
  }
}

function nextTrack(opts = {}) {
  if (!state.tracks.length || !state.current) return;
  const i = findIndex(state.current);
  if (state.playMode === 'one' && opts.auto) {
    const el = ensureAudio();
    try { el.currentTime = 0; } catch { /* ignore */ }
    suppressAudioError = true;
    el.play().then(() => {
      state.playing = true;
      setMediaPlaybackState('playing');
      setTimeout(() => { suppressAudioError = false; }, 300);
    }).catch(() => {
      suppressAudioError = false;
      playTrack(state.current, { auto: true });
    });
    return;
  }
  const idx = pickNextIndex(i, opts);
  if (idx >= 0) playTrack(state.tracks[idx], opts);
}

function prevTrack(opts = {}) {
  if (!state.tracks.length || !state.current) return;
  // 播了 3 秒以上先回到开头
  const el = ensureAudio();
  if ((el.currentTime || 0) > 3 && !opts.force) {
    seek(0);
    return;
  }
  const i = findIndex(state.current);
  const idx = pickNextIndex(i, { ...opts, previous: true, auto: false });
  if (idx >= 0) playTrack(state.tracks[idx], opts);
}

function seek(sec) {
  const el = ensureAudio();
  el.currentTime = Number(sec) || 0;
  state.progress = el.currentTime;
  maybeUpdatePositionState(true);
}

function setTracks(list) { state.tracks = Array.isArray(list) ? list : []; }

function setPlayMode(mode) {
  const next = mode === 'one' || mode === 'shuffle' ? mode : 'order';
  state.playMode = next;
  try { localStorage.setItem('hudui_music_mode', next); } catch { /* ignore */ }
  schedulePreloadNext();
}

function cyclePlayMode() {
  const order = ['order', 'one', 'shuffle'];
  const i = order.indexOf(state.playMode);
  setPlayMode(order[(i + 1) % order.length]);
  const label = { order: '顺序播放', one: '单曲循环', shuffle: '随机播放' }[state.playMode];
  toast(label);
}

export const musicPlayer = {
  state,
  ensureAudio,
  getAudioElement() { return ensureAudio(); },
  setTracks,
  playTrack,
  togglePlay,
  nextTrack,
  prevTrack,
  seek,
  setMusicRestrictionHandler,
  setPlayMode,
  cyclePlayMode,
  stopAll() {
    loadToken += 1;
    suppressAudioError = true;
    if (preloadTimer) { clearTimeout(preloadTimer); preloadTimer = 0; }
    nextUrlCache = { key: '', url: '' };
    try { audio?.pause(); } catch { /* ignore */ }
    if (audio) { try { audio.removeAttribute('src'); audio.load(); } catch { /* ignore */ } }
    state.playing = false;
    state.current = null;
    state.progress = 0;
    state.duration = 0;
    state.ready = false;
    state.restriction = null;
    setMediaPlaybackState('none');
    syncMediaMetadata(null);
    try { if ('mediaSession' in navigator) navigator.mediaSession.metadata = null; } catch { /* ignore */ }
  },
};

export function fmtAudioTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
