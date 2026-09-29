// 叠塔对战客户端状态：Socket 事件绑定 + 房间快照 + 时间差
import { reactive } from 'vue';
import { getSocket } from './socket-store.js';
import { toast } from './toast.js';

const SESSION_KEY = 'hudui_tower_room';

const state = reactive({
  room: null,
  joined: false,
  connecting: false,
  error: '',
  joining: false,
  lastSyncAt: 0,
  serverOffset: 0,
  rttMs: 0,
  countdownMs: 0,
  ranking: [],
  me: null,
  dropLock: false,
  lastDropResult: null,
  flash: '',
  phase: 'idle', // idle | waiting | countdown | playing | finished
});

let bound = false;
const unbinders = [];
let pingTimer = 0;
let syncTimer = 0;

export const towerBattle = {
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
};

function socket() {
  return getSocket();
}

function emitAck(event, payload) {
  return new Promise((resolve) => {
    try {
      const s = socket();
      if (!s || !s.connected) {
        resolve({ error: '网络走神了，正在重新连接……' });
        return;
      }
      const timer = setTimeout(() => resolve({ error: '刚刚没跟上服务器，再试一次吧。' }), 8000);
      s.emit(event, payload, (res) => {
        clearTimeout(timer);
        resolve(res || {});
      });
    } catch (e) {
      resolve({ error: e?.message || '网络异常，稍后再试。' });
    }
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
  const st = room.status;
  state.phase = st === 'finished' ? 'finished' : st === 'playing' ? 'playing' : st === 'countdown' ? 'countdown' : st === 'waiting' ? 'waiting' : 'idle';
  saveSession();
  if (!silent && room.status === 'waiting') {
    // 创建成功提示由调用方处理
  }
}

function applyDropPayload(payload) {
  if (!payload) return;
  if (payload.me) state.me = payload.me;
  if (payload.ranking) state.ranking = payload.ranking;
  if (payload.snapshot) {
    state.room = payload.snapshot;
    state.serverOffset = (payload.snapshot.serverTime || Date.now()) - Date.now();
    state.ranking = payload.snapshot.ranking || state.ranking;
  }
  state.lastDropResult = payload.drop || payload;
  if (payload.drop?.perfect) {
    const combo = payload.drop.combo || 0;
    state.flash = combo >= 3 ? '手感来了！' : combo >= 2 ? '稳稳接住。' : '完美！';
  } else if (payload.drop?.miss) {
    state.flash = '晃了一下，继续。';
  }
  setTimeout(() => {
    if (state.flash) state.flash = '';
  }, 900);
}

function bindEvents() {
  if (bound) return;
  bound = true;
  let s;
  try {
    s = socket();
  } catch {
    return;
  }
  const on = (ev, fn) => {
    try {
      s.on(ev, fn);
      unbinders.push(() => {
        try {
          s.off(ev, fn);
        } catch {
          /* ignore */
        }
      });
    } catch {
      /* ignore */
    }
  };
  const onRoom = (payload) => {
    if (payload?.room) applyRoom(payload.room);
  };
  on('tower:room', onRoom);
  on('tower:countdown', (payload) => {
    if (payload?.room) applyRoom(payload.room);
    else if (state.room) {
      state.room.status = 'countdown';
      state.room.countdownAt = payload?.countdownAt;
      state.room.startAt = payload?.startAt;
      state.room.endAt = payload?.endAt;
      state.room.roundId = payload?.roundId || state.room.roundId;
      state.room.seed = payload?.seed || state.room.seed;
      state.phase = 'countdown';
      state.serverOffset = (payload?.serverTime || Date.now()) - Date.now();
    }
  });
  on('tower:started', (payload) => {
    if (payload?.room) applyRoom(payload.room);
    else if (state.room) {
      state.room.status = 'playing';
      state.room.startAt = payload?.startAt;
      state.room.endAt = payload?.endAt;
      state.room.roundId = payload?.roundId || state.room.roundId;
      state.room.seed = payload?.seed || state.room.seed;
      state.phase = 'playing';
    }
    state.dropLock = false;
  });
  on('tower:drop-result', (payload) => {
    if (payload && state.room && payload.userId != null) {
      // 更新对应玩家摘要
      const players = state.room.players || [];
      const idx = players.findIndex((p) => Number(p.userId) === Number(payload.userId));
      if (idx >= 0 && payload.me) {
        players[idx] = { ...players[idx], ...payload.me };
      }
    }
    if (payload?.ranking) state.ranking = payload.ranking;
    if (payload && state.me && Number(payload.userId) === Number(state.me.userId)) {
      applyDropPayload(payload);
      state.dropLock = false;
    }
  });
  on('tower:player-update', (payload) => {
    if (payload?.room) applyRoom(payload.room);
  });
  on('tower:finished', (payload) => {
    if (payload?.room) applyRoom(payload.room);
    else if (state.room) {
      state.room.status = 'finished';
      state.phase = 'finished';
      if (payload?.ranking) state.ranking = payload.ranking;
    }
    state.dropLock = false;
  });
  on('tower:host-changed', (payload) => {
    if (state.room && payload?.hostUserId != null) {
      state.room.hostUserId = payload.hostUserId;
      state.room.players = (state.room.players || []).map((p) => ({
        ...p,
        isHost: Number(p.userId) === Number(payload.hostUserId),
      }));
    }
  });
  on('tower:invite:update', () => {
    // 卡片状态由消息更新推送，这里仅刷新房间摘要
  });
  on('tower:error', (payload) => {
    if (payload?.error) state.error = payload.error;
    if (payload?.snapshot) applyRoom(payload.snapshot);
    state.dropLock = false;
  });
  on('connect', () => {
    // 重连后同步房间
    if (state.room?.id || loadSession()) {
      syncNow().catch(() => {});
    }
    startPing();
  });
  on('disconnect', () => {
    if (state.joined) {
      state.error = '网络走神了，正在回到比赛……';
    }
  });
}

export function unbindTowerEvents() {
  while (unbinders.length) {
    const off = unbinders.pop();
    try {
      off();
    } catch {
      /* ignore */
    }
  }
  bound = false;
  stopPing();
  stopSyncLoop();
}

function startPing() {
  stopPing();
  pingTimer = setInterval(async () => {
    const s = socket();
    if (!s?.connected) return;
    const clientTime = Date.now();
    const res = await emitAck('tower:ping', { clientTime, rttMs: state.rttMs });
    if (res?.ok) {
      const rtt = Math.max(0, Date.now() - clientTime);
      state.rttMs = rtt;
      state.serverOffset = (res.serverTime || Date.now()) - Date.now();
    }
  }, 4000);
}

function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = 0;
  }
}

function startSyncLoop() {
  stopSyncLoop();
  syncTimer = setInterval(() => {
    if (state.joined) syncNow().catch(() => {});
  }, 12000);
}

function stopSyncLoop() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = 0;
  }
}

export async function syncNow() {
  const res = await emitAck('tower:room:sync', {});
  if (res?.ok && res.room) {
    applyRoom(res.room, { silent: true });
    startSyncLoop();
    startPing();
  } else if (res?.ok && res.room === null) {
    applyRoom(null);
    state.error = '';
  } else if (res?.error) {
    state.error = res.error;
  }
  return res;
}

export async function createRoom() {
  try {
    bindEvents();
    state.connecting = true;
    state.error = '';
    const res = await emitAck('tower:room:create', {});
    state.connecting = false;
    if (res?.error && !res?.ok) {
      state.error = res.error;
      toast(res.error);
      return res;
    }
    if (res?.room) applyRoom(res.room);
    startSyncLoop();
    startPing();
    return res;
  } catch (e) {
    state.connecting = false;
    const res = { error: e?.message || '开房失败了，再试一次。' };
    state.error = res.error;
    return res;
  }
}

async function waitConnected(timeoutMs = 2500) {
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

export async function joinByInvite(inviteId, { commandId } = {}) {
  bindEvents();
  state.joining = true;
  state.error = '';
  await waitConnected();
  const res = await emitAck('tower:invite:join', {
    inviteId,
    commandId: commandId || newCommandId(),
    rttMs: state.rttMs,
  });
  state.joining = false;
  if (res?.error && !res?.ok) {
    state.error = res.error;
    if (!res.needReturn) toast(res.error);
    return res;
  }
  if (res?.room) applyRoom(res.room);
  startSyncLoop();
  startPing();
  return res;
}

export async function leaveRoom({ silent = false } = {}) {
  const res = await emitAck('tower:room:leave', {});
  unbindTowerEvents();
  applyRoom(null);
  state.dropLock = false;
  if (!silent) toast('先休息一下');
  return res;
}

export async function setReady(ready = true) {
  const res = await emitAck('tower:ready', { ready, commandId: newCommandId() });
  if (res?.room) applyRoom(res.room);
  else if (res?.error) toast(res.error);
  return res;
}

export async function startMatch() {
  const res = await emitAck('tower:start', { commandId: newCommandId() });
  if (res?.room) applyRoom(res.room);
  else if (res?.error) toast(res.error);
  return res;
}

export async function rematch() {
  const res = await emitAck('tower:rematch', { commandId: newCommandId() });
  if (res?.room) applyRoom(res.room);
  else if (res?.error) toast(res.error);
  return res;
}

export async function dropBlock() {
  if (state.dropLock) return { error: 'locked' };
  if (!state.room || state.room.status !== 'playing') return { error: 'not_playing' };
  const me = towerBattle.myPlayer;
  if (!me) return { error: 'no_me' };
  state.dropLock = true;
  const res = await emitAck('tower:drop', {
    roundId: state.room.roundId,
    seq: me.seq ?? 0,
    commandId: newCommandId(),
    rttMs: state.rttMs,
  });
  if (res?.ok) {
    applyDropPayload(res);
    // 等下一块开始再解锁；超时兜底
    setTimeout(() => {
      state.dropLock = false;
    }, 220);
  } else {
    state.dropLock = false;
    if (res?.snapshot) applyRoom(res.snapshot);
    if (res?.error && !String(res.error).includes('节奏')) toast(res.error);
  }
  return res;
}

export async function sendInvite(conversationId) {
  const res = await emitAck('tower:invite:send', {
    conversationId,
    commandId: newCommandId(),
  });
  if (res?.error && !res?.ok) {
    toast(res.error);
    return res;
  }
  if (res?.duplicated) toast('已经叫过他们啦。');
  else toast('邀请发出去啦。');
  return res;
}

export async function reportGameScore({ score = 0, layers = 0, failed = 0, combo = 0, done = false } = {}) {
  if (!state.room || (state.room.status !== 'playing' && !done)) return { ok: false };
  const res = await emitAck('tower:score', {
    score,
    layers,
    failed,
    combo,
    done,
    commandId: newCommandId(),
  });
  if (res?.ok) {
    if (res.me) state.me = res.me;
    if (res.ranking) state.ranking = res.ranking;
    if (state.room?.players) {
      const idx = state.room.players.findIndex((p) => p.isMe);
      if (idx >= 0 && res.me) state.room.players[idx] = { ...state.room.players[idx], ...res.me };
    }
  }
  return res;
}

export function serverNow() {
  return Date.now() + state.serverOffset;
}

export function remainingMs() {
  const r = state.room;
  if (!r?.endAt) return 0;
  return Math.max(0, r.endAt - serverNow());
}

export function countdownRemainingMs() {
  const r = state.room;
  if (!r?.startAt) return 0;
  return Math.max(0, r.startAt - serverNow());
}

export function resetTowerBattle() {
  unbindTowerEvents();
  applyRoom(null);
  state.error = '';
  state.dropLock = false;
  state.flash = '';
}

// 页面重新可见时同步
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.joined) {
      syncNow().catch(() => {});
    }
  });
}

// 挤下线时清空
if (typeof window !== 'undefined') {
  window.addEventListener('hudui:logout', () => {
    resetTowerBattle();
  });
}

export default towerBattle;
