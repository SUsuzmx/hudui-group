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
});

let audio = null;
let onRestrictionAction = null;
let loadToken = 0;
let suppressAudioError = false;

const RESTRICTION_ACTION_LABEL = {
  login: '去登录音源',
  upgrade: '开通/升级会员',
  purchase: '去购买该单曲',
  switch_source: '换源（网易云/QQ）',
};

export function setMusicRestrictionHandler(fn) {
  onRestrictionAction = typeof fn === 'function' ? fn : null;
}

function trackExtra(track) {
  if (!track) return {};
  return { mid: track.mid || '', mediaMid: track.mediaMid || '', title: track.title || '', artist: track.artist || '' };
}

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'metadata';
  audio.addEventListener('timeupdate', () => {
    state.progress = audio.currentTime || 0;
    if (audio.duration && Number.isFinite(audio.duration)) state.duration = audio.duration;
  });
  audio.addEventListener('ended', () => nextTrack());
  audio.addEventListener('play', () => { state.playing = true; });
  audio.addEventListener('pause', () => { state.playing = false; });
  audio.addEventListener('error', () => {
    if (suppressAudioError || state.playing || state.restriction?.message) return;
    const code = audio?.error?.code;
    if (code === 1) return;
    state.playing = false;
    toast('当前音源加载失败，可切换「网易云 / QQ音乐」');
  });
  return audio;
}

function handleUnplayable(info, track) {
  const restriction = info?.restriction || {
    category: 'url_unavailable',
    message: info?.error || '该歌曲暂无可用播放地址',
    action: 'switch_source',
  };
  state.restriction = restriction;
  state.playing = false;
  toast(`${restriction.message || '无法播放'}（${RESTRICTION_ACTION_LABEL[restriction.action] || '换源'}）`);
  if (typeof onRestrictionAction === 'function') {
    try { onRestrictionAction(restriction, track, info); } catch { /* ignore */ }
  }
  if (restriction.action === 'switch_source' && state.tracks.length > 1) {
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

async function playTrack(track) {
  if (!track) return;
  const token = ++loadToken;
  const el = ensureAudio();
  suppressAudioError = true;
  state.current = track;
  state.progress = 0;
  state.duration = track.duration || 0;
  state.playing = false;
  state.ready = true;
  state.restriction = null;
  const streamSource = track.source === 'netease' || track.source === 'qq' ? track.source : 'qq';
  const extra = trackExtra(track);
  try {
    const info = await api.musicStreamInfo(streamSource, track.id, extra);
    if (token !== loadToken) return;
    if (!isPlayableInfo(info)) {
      suppressAudioError = false;
      handleUnplayable(info, track);
      return;
    }
    el.src = info.url;
    await el.play();
    if (token === loadToken) {
      state.playing = true;
      suppressAudioError = false;
      setTimeout(() => { if (token === loadToken && state.playing) suppressAudioError = false; }, 500);
    }
  } catch (err) {
    if (token !== loadToken) return;
    suppressAudioError = false;
    handleUnplayable(err?.responseJson || { error: err.message || '无法播放' }, track);
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
    el.play().then(() => { state.playing = true; setTimeout(() => { suppressAudioError = false; }, 400); })
      .catch(() => { suppressAudioError = false; });
  } else {
    el.pause();
    state.playing = false;
  }
}

function nextTrack() {
  if (!state.tracks.length || !state.current) return;
  const i = state.tracks.findIndex((t) => t.id === state.current.id && t.source === state.current.source);
  playTrack(state.tracks[(i + 1) % state.tracks.length]);
}
function prevTrack() {
  if (!state.tracks.length || !state.current) return;
  const i = state.tracks.findIndex((t) => t.id === state.current.id && t.source === state.current.source);
  playTrack(state.tracks[(i - 1 + state.tracks.length) % state.tracks.length]);
}
function seek(sec) {
  const el = ensureAudio();
  el.currentTime = Number(sec) || 0;
  state.progress = el.currentTime;
}
function setTracks(list) { state.tracks = Array.isArray(list) ? list : []; }

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
  stopAll() {
    loadToken += 1;
    suppressAudioError = true;
    try { audio?.pause(); } catch {}
    if (audio) { try { audio.removeAttribute('src'); audio.load(); } catch {} }
    state.playing = false;
    state.current = null;
    state.progress = 0;
    state.duration = 0;
    state.ready = false;
    state.restriction = null;
  },
};

export function fmtAudioTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
