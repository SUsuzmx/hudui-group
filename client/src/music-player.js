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
});

let audio = null;
let booting = false;

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'metadata';
  audio.crossOrigin = 'anonymous';
  audio.addEventListener('timeupdate', () => {
    state.progress = audio.currentTime || 0;
    if (audio.duration && Number.isFinite(audio.duration)) {
      state.duration = audio.duration;
    }
  });
  audio.addEventListener('ended', () => {
    nextTrack();
  });
  audio.addEventListener('play', () => {
    state.playing = true;
  });
  audio.addEventListener('pause', () => {
    state.playing = false;
  });
  audio.addEventListener('error', () => {
    state.playing = false;
  });
  return audio;
}

function indexOfCurrent() {
  if (!state.current) return -1;
  return state.tracks.findIndex(
    (t) => t.id === state.current.id && t.source === state.current.source,
  );
}

async function playTrack(track, retry = 0) {
  if (!track) return;
  const el = ensureAudio();
  state.current = track;
  state.progress = 0;
  state.duration = track.duration || 0;
  state.playing = false;
  state.ready = true;
  booting = true;
  const proxyUrl = api.musicProxyUrl(track.source, track.id);
  el.src = proxyUrl;
  try {
    await el.play();
    state.playing = true;
    booting = false;
  } catch {
    try {
      const info = await api.musicStreamInfo(track.source, track.id);
      if (!info?.url) throw new Error(info?.error || '无播放地址');
      el.src = info.url;
      await el.play();
      state.playing = true;
      booting = false;
    } catch (err) {
      state.playing = false;
      booting = false;
      toast(err.message || '无法播放该歌曲');
      if (retry < 2 && state.tracks.length > 1) {
        const i = indexOfCurrent();
        const n = state.tracks[(i + 1 + state.tracks.length) % state.tracks.length];
        if (n && !(n.id === track.id && n.source === track.source)) {
          setTimeout(() => playTrack(n, retry + 1), 400);
        }
      }
    }
  }
}

function togglePlay() {
  const el = ensureAudio();
  if (!state.current) {
    if (state.tracks[0]) playTrack(state.tracks[0]);
    return;
  }
  if (el.paused) {
    el.play().then(() => { state.playing = true; }).catch(() => {});
  } else {
    el.pause();
    state.playing = false;
  }
}

function nextTrack() {
  if (!state.tracks.length || !state.current) return;
  const i = indexOfCurrent();
  const n = state.tracks[(i + 1) % state.tracks.length];
  playTrack(n);
}

function prevTrack() {
  if (!state.tracks.length || !state.current) return;
  const i = indexOfCurrent();
  const n = state.tracks[(i - 1 + state.tracks.length) % state.tracks.length];
  playTrack(n);
}

function seek(sec) {
  const el = ensureAudio();
  const v = Number(sec) || 0;
  el.currentTime = v;
  state.progress = v;
}

function setTracks(list) {
  state.tracks = Array.isArray(list) ? list : [];
}

export const musicPlayer = {
  state,
  ensureAudio,
  setTracks,
  playTrack,
  togglePlay,
  nextTrack,
  prevTrack,
  seek,
  stopAll() {
    try { audio?.pause(); } catch { /* ignore */ }
    if (audio) audio.src = '';
    state.playing = false;
    state.current = null;
    state.progress = 0;
    state.duration = 0;
    state.ready = false;
  },
};

export function fmtAudioTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
