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
  // 一起听：同一 audio 核心，由房间状态驱动
  listenMode: false,
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
  switch_source: '换源（网易云/QQ/酷狗）',
};

export function setMusicRestrictionHandler(fn) {
  onRestrictionAction = typeof fn === 'function' ? fn : null;
}

function trackKey(t) {
  return t ? `${t.source || 'qq'}:${t.id}` : '';
}

function trackExtra(track) {
  if (!track) return {};
  return {
    mid: track.mid || '',
    mediaMid: track.mediaMid || '',
    title: track.title || track.name || '',
    artist: track.artist || '',
    hash: track.hash || track.fileHash || '',
    albumId: track.albumId || track.album_id || '',
    albumAudioId: track.albumAudioId || track.album_audio_id || track.mixSongId || '',
    mixSongId: track.mixSongId || track.mixsongid || '',
    privilege: track.privilege,
    hqHash: track.hqHash || '',
    sqHash: track.sqHash || '',
    resHash: track.resHash || '',
  };
}

function streamSourceOf(track) {
  const s = track?.source;
  return s === 'netease' || s === 'qq' || s === 'kugou' ? s : 'qq';
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

/** 移动端：在用户手势里解锁 audio，否则后续 play() 会被系统拒掉 */
function unlockAudio() {
  try {
    if (window.audioCtx && window.audioCtx.state === 'suspended') {
      window.audioCtx.resume().catch(() => {});
    }
  } catch { /* ignore */ }
  const el = ensureAudio();
  if (!el || !el.paused) return;
  // 该出声就直接起播；不该出声则 play+pause 仅作解锁
  try {
    const shouldKeep = Boolean(el.src) && (state.playing || (state.listenMode && state.ready && state.current));
    const p = el.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        if (!shouldKeep) {
          try { el.pause(); } catch { /* ignore */ }
        }
      }).catch(() => {});
    }
  } catch { /* ignore */ }
}

/** 尽量出声；失败则标记需要用户点击，不抛给「音源失败」 */
function tryPlay({ silent = false } = {}) {
  const el = ensureAudio();
  if (!el || !el.src) return Promise.resolve(false);
  suppressAudioError = true;
  return el.play().then(() => {
    state.playing = true;
    setMediaPlaybackState('playing');
    if (state.listenMode) state.playing = true;
    setTimeout(() => { suppressAudioError = false; }, 300);
    return true;
  }).catch((err) => {
    suppressAudioError = false;
    const name = String(err?.name || '');
    const blocked = name === 'NotAllowedError' || name === 'AbortError';
    if (state.listenMode || silent || blocked) {
      state.playing = false;
      try { onListenPlayFail?.(); } catch { /* ignore */ }
    }
    return false;
  });
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
    // 一起听模式由房间服务器决定下一首，避免本地连播抢跑
    if (state.listenMode) {
      notifyListenTrackEnded('ended');
      return;
    }
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
    // 一起听：交给房间 skip，不要走本地连播
    if (state.listenMode) {
      toast('当前音源加载失败');
      try { onListenPlayFail?.(); } catch { /* ignore */ }
      notifyListenTrackEnded('error');
      return;
    }
    // 自动连播失败时跳过，而不是卡死
    if (state.playing || state.current) {
      toast('当前音源加载失败，自动切下一首');
      setTimeout(() => nextTrack({ auto: true }), 300);
      return;
    }
    state.playing = false;
    toast('当前音源加载失败，可切换「网易云 / QQ音乐 / 酷狗」');
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
    stop: safe(() => stopAllPlayback()),
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
    const other = state.tracks.find((t) => (t.source === 'netease' || t.source === 'qq' || t.source === 'kugou') && !(t.id === track.id && t.source === track.source));
    if (other) setTimeout(() => playTrack(other), 400);
  }
  return restriction;
}

function isPlayableInfo(info) {
  if (!info) return false;
  if (info.playable === false) return false;
  return Boolean(info.url);
}

function toFetchableStreamUrl(info) {
  if (!info) return '';
  if (info.proxyUrl) return info.proxyUrl;
  if (info.cdnUrl) return '/api/audio?url=' + encodeURIComponent(info.cdnUrl);
  const url = info.url || '';
  if (/^https?:/i.test(url)) return '/api/audio?url=' + encodeURIComponent(url);
  return url;
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
  const info = await api.musicStreamInfo(streamSource, track.id || track.hash, extra);
  if (!isPlayableInfo(info)) {
    const err = new Error(info?.error || 'unplayable');
    err.responseJson = info;
    throw err;
  }
  // 酷狗优先同源代理（Referer 防盗链）；否则走公开 /api/audio
  if (info.proxyUrl) return info.proxyUrl;
  if (info.cdnUrl) return '/api/audio?url=' + encodeURIComponent(info.cdnUrl);
  return info.url;
}

/**
 * 节拍分析等旁路取流：只请求新直链，绝不改 audio.src / 预取缓存 / 播放状态。
 */
export async function resolveStreamUrlForAnalysis(track) {
  if (!track) return '';
  if (track.type === 'local' || track.localUrl) {
    return track.localUrl || track.url || '';
  }
  try {
    const streamSource = streamSourceOf(track);
    const extra = trackExtra(track);
    const info = await api.musicStreamInfo(streamSource, track.id || track.hash, extra);
    if (!isPlayableInfo(info)) return '';
    return toFetchableStreamUrl(info);
  } catch {
    return '';
  }
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
    const info = await api.musicStreamInfo(streamSource, next.id || next.hash, trackExtra(next));
    if (isPlayableInfo(info)) {
      const url = info.proxyUrl
        || (info.cdnUrl ? '/api/audio?url=' + encodeURIComponent(info.cdnUrl) : info.url);
      nextUrlCache = { key, url };
    } else nextUrlCache = { key: '', url: '' };
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
  const listenSync = !!opts.listenSync;
  const token = ++loadToken;
  const el = ensureAudio();
  suppressAudioError = true;
  state.current = track;
  state.progress = 0;
  state.duration = track.duration || 0;
  state.playing = false;
  state.ready = true;
  state.restriction = null;
  listenEndNotifiedKey = '';
  // 换歌装载中：旧 media 的 ended/进度不得再当作新曲状态
  mediaTrackKey = '';
  try {
    if (el && !el.paused) el.pause();
  } catch { /* ignore */ }
  syncMediaMetadata(track);
  setMediaPlaybackState('playing');
  try {
    const url = await resolveStreamUrl(track);
    if (token !== loadToken) return;
    const el2 = el || ensureAudio();
    if (!el2 || typeof el2 !== 'object') return;
    try {
      el2.src = (/^https?:/i.test(url) ? '/api/audio?url=' + encodeURIComponent(url) : url);
      mediaTrackKey = trackKey(track);
    } catch (srcErr) {
      console.warn('[player] set src failed', srcErr);
      return;
    }
    if (listenSync && Number.isFinite(Number(opts.startAt))) {
      const seekTo = Math.max(0, Number(opts.startAt) || 0);
      const applySeek = () => {
        try { el2.currentTime = seekTo; } catch { /* ignore */ }
      };
      if (el2.readyState >= 1) applySeek();
      else {
        const onMeta = () => {
          el2.removeEventListener('loadedmetadata', onMeta);
          applySeek();
        };
        el2.addEventListener('loadedmetadata', onMeta);
        setTimeout(() => el2.removeEventListener('loadedmetadata', onMeta), 8000);
      }
    }
    if (listenSync && opts.autoplay === false) {
      state.playing = false;
      suppressAudioError = false;
      setTimeout(() => { if (token === loadToken) suppressAudioError = false; }, 500);
      return;
    }
    try {
      await el2.play();
      if (token === loadToken) {
        state.playing = true;
        autoFailStreak = 0;
        suppressAudioError = false;
        maybeUpdatePositionState(true);
        if (!listenSync) schedulePreloadNext();
        setTimeout(() => { if (token === loadToken) suppressAudioError = false; }, 500);
      }
    } catch (playErr) {
      // 移动端自动播放被拦：不是音源问题，等用户点一下
      const name = String(playErr?.name || '');
      if (name === 'NotAllowedError' || name === 'AbortError' || name === 'NotSupportedError') {
        state.playing = false;
        suppressAudioError = false;
        try { onListenPlayFail?.(); } catch { /* ignore */ }
        return;
      }
      throw playErr;
    }
  } catch (err) {
    if (token !== loadToken) return;
    suppressAudioError = false;
    handleUnplayable(err?.responseJson || { error: err.message || '无法播放' }, track, { auto });
  }
}

function togglePlay() {
  if (state.listenMode) return;
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

/** 明确播放（一起听远程命令用，避免 toggle 语义） */
function playPlayback() {
  ensureAudio();
  return tryPlay();
}

function pausePlayback() {
  const el = ensureAudio();
  try { el.pause(); } catch { /* ignore */ }
  state.playing = false;
  setMediaPlaybackState('paused');
}

/** 一起听：加载歌曲并在 metadata 后定位，再按房间状态播放 */
function loadTrackAt(track, { startAt = 0, autoplay = true, listenSync = true } = {}) {
  return playTrack(track, { listenSync, startAt, autoplay });
}

let onListenPlayFail = null;
function setListenPlayFailHandler(fn) {
  onListenPlayFail = typeof fn === 'function' ? fn : null;
}

let onListenTrackEnded = null;
let listenEndNotifiedKey = '';
/** 当前 audio.src 实际装载的曲目 key（loading 中为 ''，避免旧 ended 误伤新曲） */
let mediaTrackKey = '';

function setListenTrackEndedHandler(fn) {
  onListenTrackEnded = typeof fn === 'function' ? fn : null;
}

/** audio 是否已装载「指定曲目」（未指定则看 state.current） */
function isMediaLoadedFor(track) {
  if (!mediaTrackKey) return false;
  return mediaTrackKey === trackKey(track || state.current);
}

/** 一起听曲终上报（去重；看门狗/sync 必须确认 media 就是当前曲） */
function notifyListenTrackEnded(reason = 'ended') {
  if (!state.listenMode) return;
  let key = mediaTrackKey;
  // 取流失败还没挂上 src：按 state.current 认
  if (!key && reason === 'error') key = trackKey(state.current);
  if (!key) return;
  // 看门狗/同步触发时，必须是「当前曲目」的 media 真的 ended
  if (reason === 'watchdog' || reason === 'sync') {
    if (!audio?.ended || !isMediaLoadedFor(state.current)) return;
    key = trackKey(state.current);
  }
  if (key === listenEndNotifiedKey) return;
  listenEndNotifiedKey = key;
  try { onListenTrackEnded?.(reason, key); } catch { /* ignore */ }
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

function stopAllPlayback() {
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
  state.listenMode = false;
  mediaTrackKey = '';
  listenEndNotifiedKey = '';
  setMediaPlaybackState('none');
  syncMediaMetadata(null);
  try { if ('mediaSession' in navigator) navigator.mediaSession.metadata = null; } catch { /* ignore */ }
}

function setListenMode(on) {
  state.listenMode = !!on;
  if (on) {
    // 一起听时不走本地连播/预取，避免与房间抢控制
    if (preloadTimer) { clearTimeout(preloadTimer); preloadTimer = 0; }
    nextUrlCache = { key: '', url: '' };
  }
}

export const musicPlayer = {
  state,
  ensureAudio,
  getAudioElement() { return ensureAudio(); },
  setTracks,
  playTrack,
  loadTrackAt,
  play: playPlayback,
  pause: pausePlayback,
  resolveStreamUrlForAnalysis,
  togglePlay,
  nextTrack,
  prevTrack,
  seek,
  setMusicRestrictionHandler,
  setListenPlayFailHandler,
  setListenTrackEndedHandler,
  notifyListenTrackEnded,
  isMediaLoadedFor,
  unlockAudio,
  tryPlay,
  setPlayMode,
  cyclePlayMode,
  setListenMode,
  stopAll: stopAllPlayback,
};

export function fmtAudioTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// 移动端首次手势解锁音频（捕获阶段，早于业务 click）
if (typeof document !== 'undefined') {
  const onUserGesture = () => { unlockAudio(); };
  document.addEventListener('touchend', onUserGesture, { capture: true, passive: true });
  document.addEventListener('pointerdown', onUserGesture, { capture: true, passive: true });
  document.addEventListener('click', onUserGesture, { capture: true, passive: true });
}
