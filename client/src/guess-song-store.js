// 猜歌抢答客户端状态：Socket 事件绑定 + 房间快照 + 同步播放
import { reactive } from 'vue';
import { getSocket } from './socket-store.js';
import { toast } from './toast.js';
import { api } from './api.js';

const SESSION_KEY = 'hudui_guess_room';

const state = reactive({
  room: null,
  joined: false,
  connecting: false,
  error: '',
  joining: false,
  lastSyncAt: 0,
  serverOffset: 0,
  phase: 'idle', // idle | waiting | playing | finished
  round: null,
  options: null,
  artistOptions: null,
  buzzedName: '',
  buzzedUserId: null,
  lastResult: null,
  flash: '',
  myScore: 0,
  ranking: [],
  me: null,
  audioStarted: false,
  answerDeadline: 0,
  artistDeadline: 0,
  preparing: false,
});

let bound = false;
const unbinders = [];
let pingTimer = 0;
let syncTimer = 0;
let audio = null;
let audioToken = 0;
let buzzLocked = false;

export const guessSong = {
  state,
  get inRoom() {
    return Boolean(state.room && state.joined);
  },
  get isHost() {
    const meId = state.me?.userId ?? state.room?.players?.find((p) => p.isMe)?.userId;
    return Boolean(state.room && meId != null && Number(state.room.hostUserId) === Number(meId));
  },
  get myPlayer() {
    return state.room?.players?.find((p) => p.isMe) || state.me;
  },
  get phase() {
    return state.phase;
  },
  get ranking() {
    return state.ranking;
  },
  get canBuzz() {
    return Boolean(state.round?.canBuzz) && !buzzLocked && state.audioStarted;
  },
};

function socket() {
  return getSocket();
}

function emitAck(event, payload, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const s = socket();
    if (!s) {
      resolve({ error: '网络不可用，请稍后重试', code: 'no_socket' });
      return;
    }
    let settled = false;
    const done = (res) => {
      if (settled) return;
      settled = true;
      resolve(res || {});
    };
    const send = () => {
      const timer = setTimeout(() => {
        done({
          error: '没跟上服务器，请稍后重试（一直失败请刷新页面）',
          code: 'ack_timeout',
        });
      }, timeoutMs);
      try {
        s.emit(event, payload, (res) => {
          clearTimeout(timer);
          done(res || { ok: true });
        });
      } catch (e) {
        clearTimeout(timer);
        done({ error: e?.message || '发送失败', code: 'emit_fail' });
      }
    };
    if (s.connected) {
      send();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      done({ error: '网络走神了，正在重新连接……', code: 'not_connected' });
    }, 4000);
    const onConnect = () => {
      cleanup();
      send();
    };
    const cleanup = () => {
      clearTimeout(timer);
      s.off('connect', onConnect);
    };
    s.once('connect', onConnect);
  });
}

/** 关键动作（开房/加入）失败自动重试一次 */
async function emitAckRetry(event, payload) {
  let res = await emitAck(event, payload);
  if (res?.code === 'ack_timeout' || res?.code === 'not_connected') {
    await waitConnected(2500);
    res = await emitAck(event, payload);
  }
  return res;
}

async function waitConnected(timeoutMs = 3000) {
  const s = socket();
  if (!s) return false;
  if (s.connected) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(Boolean(s.connected)), timeoutMs);
    const on = () => {
      clearTimeout(timer);
      resolve(true);
    };
    s.once('connect', on);
  });
}

function newCommandId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function saveSession() {
  try {
    if (state.room?.id) sessionStorage.setItem(SESSION_KEY, state.room.id);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function loadSession() {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function applyRoom(room, { silent = false } = {}) {
  if (!room) {
    state.room = null;
    state.joined = false;
    state.me = null;
    state.ranking = [];
    state.phase = 'idle';
    state.round = null;
    clearSession();
    return;
  }
  state.room = room;
  state.joined = true;
  state.error = '';
  state.lastSyncAt = Date.now();
  state.serverOffset = (room.serverTime || Date.now()) - Date.now();
  state.ranking = room.ranking || [];
  state.me = room.players?.find((p) => p.isMe) || null;
  state.myScore = Number(state.me?.score) || 0;
  state.round = room.round || null;
  const st = room.status;
  state.phase =
    st === 'finished'
      ? 'finished'
      : st === 'playing'
        ? 'playing'
        : st === 'waiting'
          ? 'waiting'
          : 'idle';
  if (room.round) {
    state.options = room.round.myOptions || null;
    state.artistOptions = room.round.myArtistOptions || null;
    state.buzzedUserId = room.round.buzzUserId ?? null;
    state.buzzedName = room.round.buzzName || '';
    state.answerDeadline = room.round.answerDeadline || 0;
    state.artistDeadline = room.round.artistDeadline || 0;
    state.lastResult = room.round.lastResult || state.lastResult;
    if (room.round.phase === 'playing' || room.round.phase === 'prep' || room.round.phase === 'loading') {
      buzzLocked = false;
    }
  }
  saveSession();
  if (!silent) void 0;
}

function serverNow() {
  return Date.now() + (state.serverOffset || 0);
}

function flash(msg) {
  state.flash = msg;
  setTimeout(() => {
    if (state.flash === msg) state.flash = '';
  }, 2200);
}

export { serverNow };

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  // 同源媒体不要设 crossOrigin，否则部分代理响应会被浏览器判失败
  try {
    audio.setAttribute('playsinline', '');
  } catch {
    /* ignore */
  }
  audio.addEventListener('ended', () => {
    state.audioStarted = false;
  });
  audio.addEventListener('error', () => {
    state.audioStarted = false;
    flash('片段加载失败，正在重试…');
  });
  return audio;
}

function stopAudio() {
  playToken += 1;
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch {
    /* ignore */
  }
  state.audioStarted = false;
}

// 浏览器 DevTools 会因 media play/load 的 AbortError 断点，这里兜底吞掉
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const name = String(e?.reason?.name || '');
    if (name === 'AbortError' || name === 'NotSupportedError' || name === 'NotAllowedError') {
      e.preventDefault?.();
      e.stopPropagation?.();
    }
  });
}

const LOCAL_DEMO = {
  'local-bgm': '/media/demo/listen-bgm.mp3',
  'local-calm': '/media/demo/listen-calm.wav',
  'local-pop': '/media/demo/listen-pop.wav',
  'local-night': '/media/demo/listen-night.wav',
  'local-gameover': '/media/demo/listen-gameover.mp3',
};

function localDemoUrl(id) {
  if (LOCAL_DEMO[id]) return LOCAL_DEMO[id];
  // local-extra-* 等占位曲统一落到可播 demo
  return '/media/demo/listen-bgm.mp3';
}

/** 把任意可播地址收成 <audio> 能直接吃的同源 URL */
function toAudioSrc(url) {
  if (!url) return '';
  if (/^https?:/i.test(url)) return '/api/audio?url=' + encodeURIComponent(url);
  return url;
}

/**
 * 解析片段播放地址。
 * /api/music/proxy 需要 Bearer，<audio> 带不了请求头；
 * 先走鉴权接口 musicStreamInfo 拿直链/代理，再交给 <audio>。
 */
async function resolveTrackUrl(ref) {
  if (!ref) return localDemoUrl('');
  if (ref.source === 'local') return localDemoUrl(ref.id);

  const extra = {
    mid: ref.mid || '',
    mediaMid: ref.mediaMid || '',
    hash: ref.hash || '',
    albumId: ref.albumId || '',
    albumAudioId: ref.albumAudioId || '',
    mixSongId: ref.mixSongId || '',
    hqHash: ref.hqHash || '',
    sqHash: ref.sqHash || '',
    resHash: ref.resHash || '',
  };
  const source = ['qq', 'netease', 'kugou'].includes(ref.source) ? ref.source : 'qq';
  const id = ref.id || ref.hash || '';
  if (!id) return localDemoUrl(ref.id);

  try {
    const info = await api.musicStreamInfo(source, id, extra);
    if (info?.proxyUrl) return info.proxyUrl;
    if (info?.cdnUrl) return toAudioSrc(info.cdnUrl);
    if (info?.url) return toAudioSrc(info.url);
  } catch {
    /* fall through */
  }
  // 版权/会员/网络失败：退回本地 demo，保证对局能继续
  return localDemoUrl(ref.id);
}

/** 等到真正可播才返回 true；不信任 load 前残留的 readyState */
function waitAudioPlayable(el, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const expectSrc = el.src;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ok);
    };
    const onOk = () => {
      if (el.src !== expectSrc) return done(false);
      if (el.readyState >= 2) done(true);
    };
    const onErr = () => done(false);
    const cleanup = () => {
      el.removeEventListener('canplay', onOk);
      el.removeEventListener('canplaythrough', onOk);
      el.removeEventListener('loadeddata', onOk);
      el.removeEventListener('error', onErr);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      done(el.src === expectSrc && el.readyState >= 2);
    }, timeoutMs);
    el.addEventListener('canplay', onOk);
    el.addEventListener('canplaythrough', onOk);
    el.addEventListener('loadeddata', onOk);
    el.addEventListener('error', onErr);
  });
}

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** play() 的 rejection（AbortError 等）绝不能漏到全局 */
function safePlay(el) {
  try {
    const p = el.play();
    if (p && typeof p.then === 'function') {
      return p.then(
        () => true,
        (err) => {
          const name = String(err?.name || '');
          if (name === 'AbortError' || name === 'NotSupportedError') return false;
          if (name === 'NotAllowedError') {
            state.audioStarted = false;
            flash('点一下页面开声音');
            return false;
          }
          return false;
        }
      );
    }
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}

/** 音频操作串行化：避免 load/play/pause 互相打断产生 AbortError */
let audioOpChain = Promise.resolve();
function enqueueAudioOp(fn) {
  const run = audioOpChain.then(() => fn()).catch(() => false);
  audioOpChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

let playToken = 0;

async function handleRound(payload) {
  stopAudio();
  buzzLocked = false;
  state.options = null;
  state.artistOptions = null;
  state.audioStarted = false;
  state.preparing = true;
  state.round = {
    index: payload?.roundIndex ?? 0,
    total: payload?.total ?? 10,
    phase: 'loading',
    clipStartMs: payload?.clipStartMs || 0,
    clipDurationMs: payload?.clipDurationMs || 8000,
    trackRef: payload?.trackRef || null,
    canBuzz: false,
  };
  if (payload?.trackRef) {
    try {
      const okLoad = await preloadTrack(payload.trackRef);
      state.audioStarted = false;
      emitAck('guess:track:loaded', { ok: okLoad, ready: okLoad }).catch(() => {});
    } catch {
      state.audioStarted = false;
      emitAck('guess:track:loaded', { ok: false, ready: false }).catch(() => {});
    }
  }
}

async function preloadTrack(ref) {
  playToken += 1;
  return enqueueAudioOp(() => doPreloadTrack(ref));
}

async function doPreloadTrack(ref) {
  const el = ensureAudio();
  let url = '';
  try {
    url = await resolveTrackUrl(ref);
  } catch {
    url = localDemoUrl(ref?.id);
  }
  if (!url) return false;
  const token = ++audioToken;

  const tryLoad = async (src) => {
    if (token !== audioToken) return false;
    try {
      el.pause();
    } catch {
      /* ignore */
    }
    const sep = src.includes('?') ? '&' : '?';
    const bust = `${src}${sep}_gs=${token}`;
    try {
      el.removeAttribute('src');
      el.load();
      el.src = bust;
      el.load();
    } catch {
      return false;
    }
    return waitAudioPlayable(el, 8000);
  };

  let ok = await tryLoad(url);
  if (!ok && token === audioToken) {
    const fallback = localDemoUrl(ref?.id);
    if (fallback && fallback.split('?')[0] !== String(url).split('?')[0]) {
      ok = await tryLoad(fallback);
    }
  }
  return ok && token === audioToken;
}

function playFrom(clipStartMs, startAtServer) {
  const myToken = ++playToken;
  // 等待 startAt 放在队列外，避免堵住后续预加载
  return (async () => {
    const startAtLocal = startAtServer - (state.serverOffset || 0);
    const delay = startAtLocal - Date.now();
    if (delay > 30) await sleepMs(delay);
    if (myToken !== playToken) return false;
    return enqueueAudioOp(() => doPlayFrom(clipStartMs, myToken));
  })().catch(() => false);
}

async function doPlayFrom(clipStartMs, myToken) {
  try {
    const el = ensureAudio();
    if (myToken !== playToken) return false;
    if (el.readyState < 2) {
      state.audioStarted = false;
      flash('音频还没准备好…');
      emitAck('guess:track:fail', {}).catch(() => {});
      return false;
    }
    try {
      const t = Number(clipStartMs) || 0;
      if (t > 0) el.currentTime = t / 1000;
    } catch {
      /* ignore */
    }
    const ok = await safePlay(el);
    if (myToken !== playToken) return false;
    state.audioStarted = Boolean(ok);
    return Boolean(ok);
  } catch {
    state.audioStarted = false;
    return false;
  }
}

function bindEvents() {
  if (bound) return;
  bound = true;
  const s = socket();
  const on = (ev, fn) => {
    s.on(ev, fn);
    unbinders.push(() => s.off(ev, fn));
  };

  on('guess:room', (payload) => {
    if (payload?.room) applyRoom(payload.room);
    if (payload?.closed) {
      stopAudio();
      flash(payload.reason === 'finished' ? '本局已结束' : '房间已散场');
    }
  });
  on('guess:player-update', (payload) => {
    if (payload?.room) applyRoom(payload.room);
  });
  on('guess:started', (payload) => {
    state.phase = 'playing';
    flash(`开始！本局 ${payload?.songCount || 10} 首`);
  });
  on('guess:round', (payload) => {
    void handleRound(payload).catch(() => {});
  });
  on('guess:prep', (payload) => {
    if (state.round) {
      state.round.phase = 'prep';
      state.round.canBuzz = false;
    }
    state.preparing = true;
    state.audioStarted = false;
    flash('准备…');
    // 同步起播；成功后才开抢
    void playFrom(state.round?.clipStartMs || 0, payload?.startAt || Date.now())
      .then((started) => {
        state.preparing = false;
        state.audioStarted = Boolean(started);
        if (state.round && state.round.phase === 'playing') {
          state.round.canBuzz = Boolean(started);
        }
      })
      .catch(() => {
        state.preparing = false;
        state.audioStarted = false;
      });
  });
  on('guess:play', (payload) => {
    void (async () => {
      if (state.round) {
        state.round.phase = 'playing';
        state.round.canBuzz = false;
      }
      const started = await playFrom(
        payload?.clipStartMs ?? state.round?.clipStartMs ?? 0,
        payload?.startAt || Date.now()
      );
      if (state.round) state.round.canBuzz = Boolean(started);
      state.audioStarted = Boolean(started);
      state.preparing = false;
    })().catch(() => {});
  });
  on('guess:loop', (payload) => {
    void (async () => {
      if (state.round) {
        state.round.phase = 'playing';
        state.round.canBuzz = false;
      }
      const started = await playFrom(
        payload?.clipStartMs ?? state.round?.clipStartMs ?? 0,
        payload?.startAt || Date.now()
      );
      if (state.round) state.round.canBuzz = Boolean(started);
      state.audioStarted = Boolean(started);
    })().catch(() => {});
  });
  on('guess:hint', (payload) => {
    if (state.round) state.round.hintLevel = payload?.hintLevel || 0;
  });
  on('guess:buzzed', (payload) => {
    if (state.round) {
      state.round.phase = 'answering';
      state.round.canBuzz = false;
    }
    buzzLocked = true;
    state.buzzedUserId = payload?.buzzUserId ?? null;
    state.buzzedName = payload?.buzzName || '';
    state.answerDeadline = payload?.deadline || Date.now() + 5000;
    try {
      audio?.pause();
    } catch {
      /* ignore */
    }
    state.audioStarted = false;
  });
  on('guess:options', (payload) => {
    state.options = payload?.options || null;
    state.answerDeadline = payload?.deadline || Date.now() + 5000;
    flash('你抢到了！快选歌名');
  });
  on('guess:wrong', (payload) => {
    if (state.round) {
      state.round.phase = 'playing';
      state.round.canBuzz = !payload?.timeout || true;
    }
    buzzLocked = false;
    state.options = null;
    flash(payload?.timeout ? `${payload?.nickname || '有人'}超时了` : `${payload?.nickname || '有人'}答错了`);
    if (payload?.resumeAt) {
      void playFrom(payload.clipStartMs ?? 0, payload.resumeAt).catch(() => {});
    }
  });
  on('guess:main-result', (payload) => {
    state.lastResult = payload?.result || null;
    state.options = null;
    if (state.round) {
      state.round.phase = 'main_reveal';
      state.round.revealed = payload?.result || true;
      if (payload?.result?.correctTitle) {
        state.round.answerTitle = payload.result.correctTitle;
        state.round.answerArtist = payload.result.correctArtist;
        state.round.answerCover = payload.result.cover;
      }
    }
    try {
      audio?.pause();
    } catch {
      /* ignore */
    }
    const r = payload?.result;
    if (r?.winnerName) flash(`${r.winnerName} 答对了：${r.correctTitle}`);
    else if (r?.mode === 'timeout') flash(`答案是：${r.correctTitle}`);
    else if (r?.mode === 'all_wrong') flash(`都答错啦，答案是：${r.correctTitle}`);
  });
  on('guess:artist', (payload) => {
    state.artistOptions = payload?.options || null;
    state.artistDeadline = payload?.deadline || Date.now() + 5000;
    if (state.round) state.round.phase = 'artist';
    flash('歌手抢分！');
  });
  on('guess:artist-result', (payload) => {
    if (payload?.userId === state.me?.userId) {
      flash(payload.correct ? `歌手对啦 +${payload.delta}` : `歌手错了 ${payload.delta}`);
    }
  });
  on('guess:round-end', (payload) => {
    if (payload?.scores) state.ranking = payload.scores;
    state.artistOptions = null;
    if (state.round) state.round.phase = 'round_end';
  });
  on('guess:finished', (payload) => {
    state.phase = 'finished';
    state.ranking = payload?.ranking || state.ranking;
    stopAudio();
    flash('本局结束，来看看名次');
  });
  on('guess:host-changed', (payload) => {
    if (state.room) state.room.hostUserId = payload?.hostUserId;
  });
  on('guess:error', (payload) => {
    if (payload?.error) flash(payload.error);
  });
}

export function unbindEvents() {
  for (const off of unbinders.splice(0)) {
    try {
      off();
    } catch {
      /* ignore */
    }
  }
  bound = false;
}

function startTimers() {
  stopTimers();
  pingTimer = setInterval(() => {
    const s = socket();
    if (s?.connected) s.emit('guess:ping', { clientTime: Date.now() });
  }, 8000);
  syncTimer = setInterval(() => {
    if (state.joined) void syncNow();
  }, 20000);
}

function stopTimers() {
  if (pingTimer) clearInterval(pingTimer);
  if (syncTimer) clearInterval(syncTimer);
  pingTimer = 0;
  syncTimer = 0;
}

export async function syncNow() {
  bindEvents();
  const res = await emitAck('guess:room:sync', {});
  if (res?.ok && res.room) {
    applyRoom(res.room, { silent: true });
    return res.room;
  }
  if (res?.ok && res.active === false) {
    applyRoom(null);
  }
  return null;
}

export async function createRoom({ songCount = 10, theme = 'random', themeLabel = '曲库小王子' } = {}) {
  bindEvents();
  startTimers();
  state.connecting = true;
  state.error = '';
  try {
    await waitConnected();
    const res = await emitAckRetry('guess:room:create', {
      songCount,
      theme,
      themeLabel,
      commandId: newCommandId(),
    });
    if (res?.ok && res.room) {
      applyRoom(res.room);
      return res;
    }
    if (res?.error && !res.ok) {
      state.error = res.error;
      toast(res.error);
    }
    return res;
  } finally {
    state.connecting = false;
  }
}

export async function joinByInvite(inviteId) {
  if (!inviteId) return { error: '缺少邀请' };
  bindEvents();
  startTimers();
  state.joining = true;
  try {
    await waitConnected();
    const res = await emitAckRetry('guess:invite:join', {
      inviteId,
      commandId: newCommandId(),
    });
    if (res?.ok && res.room) {
      applyRoom(res.room);
      if (res.restored) flash('回来啦，比赛还在继续。');
      else flash(res.message || '加入成功');
      return res;
    }
    if (res?.error) toast(res.error);
    return res;
  } finally {
    state.joining = false;
  }
}

export async function leaveRoom() {
  stopAudio();
  const res = await emitAck('guess:room:leave', {});
  applyRoom(null);
  stopTimers();
  return res;
}

export async function setReady(ready = true) {
  return emitAck('guess:ready', { ready });
}

export async function setSongCount(songCount) {
  return emitAck('guess:song-count', { songCount });
}

export async function setTheme(theme, themeLabel) {
  return emitAck('guess:theme', { theme, themeLabel });
}

export async function startMatch({ songCount, theme, themeLabel } = {}) {
  stopAudio();
  const payload = {};
  if (songCount) payload.songCount = songCount;
  if (theme !== undefined) payload.theme = theme;
  if (themeLabel !== undefined) payload.themeLabel = themeLabel;
  return emitAck('guess:start', payload);
}

export async function rematch() {
  stopAudio();
  return emitAck('guess:rematch', { commandId: newCommandId() });
}

export async function buzz() {
  if (buzzLocked) return { error: '已经点过啦' };
  buzzLocked = true;
  const res = await emitAck('guess:buzz', { commandId: newCommandId() });
  if (!res?.ok && res?.error) {
    buzzLocked = false;
    if (res.code !== 'already_buzzed') toast(res.error);
  }
  return res;
}

export async function answer(optionId) {
  const res = await emitAck('guess:answer', { optionId, commandId: newCommandId() });
  state.options = null;
  return res;
}

export async function answerArtist(optionId) {
  const res = await emitAck('guess:artist', { optionId, commandId: newCommandId() });
  state.artistOptions = null;
  return res;
}

export async function sendInvite(conversationId) {
  return emitAck('guess:invite:send', { conversationId });
}

export function unlockBuzz() {
  buzzLocked = false;
}

export function restoreFromSession() {
  const id = loadSession();
  return id || '';
}

export function initGuessSongStore() {
  bindEvents();
}
