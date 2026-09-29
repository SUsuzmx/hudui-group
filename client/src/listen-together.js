// 一起听客户端状态：Socket 同步 + music-player 融合（同一音频核心）
import { reactive, computed } from 'vue';
import { getSocket } from './socket-store.js';
import { musicPlayer } from './music-player.js';
import { toast } from './toast.js';

const state = reactive({
  room: null,
  joined: false,
  connecting: false,
  error: '',
  lastSyncAt: 0,
  drift: 0,
  reactions: [],
  playFail: false,
});

let syncTimer = 0;
let roomMode = false;
let lastApplyAt = 0;
let lastSeekAt = 0;
let applying = false;

function sameUser(a, b) {
  if (a == null || b == null || a === '' || b === '') return false;
  return Number(a) === Number(b);
}

export const listenTogether = {
  state,
  get inRoom() {
    return Boolean(state.room && state.joined);
  },
  get isHost() {
    return Boolean(state.room && sameUser(state.room.hostId, state.room.viewerId));
  },
  get canControl() {
    if (!state.room) return false;
    return Boolean(state.room.allowAllControl) || sameUser(state.room.hostId, state.room.viewerId);
  },
  get positionMs() {
    return currentPosMs();
  },
};

/** 以服务器 serverTime 推算当前进度；已知时长时钳制到曲末，避免曲终后进度继续跑 */
export function currentPosMs() {
  const r = state.room;
  if (!r) return 0;
  const elapsed = r.playing ? Math.max(0, Date.now() - (r.serverTime || Date.now())) : 0;
  let pos = Math.max(0, (r.positionMs || 0) + elapsed);
  const durMs = Number(r.current?.durationMs) || (Number(r.current?.duration) || 0) * 1000;
  if (durMs > 0 && pos > durMs) return durMs;
  // 本地 audio 已 ended 时冻结在当前位置，避免时间继续跑
  try {
    const el = musicPlayer.getAudioElement();
    if (el?.ended && musicPlayer.isMediaLoadedFor(r.current) && Number.isFinite(el.currentTime) && el.currentTime > 0) {
      pos = Math.min(pos, el.currentTime * 1000);
    }
  } catch { /* ignore */ }
  return pos;
}

export function estimatedPosSec() {
  return currentPosMs() / 1000;
}

function socket() {
  return getSocket();
}

function emitAck(event, payload) {
  return new Promise((resolve) => {
    const s = socket();
    if (!s || !s.connected) {
      resolve({ error: '网络走神了，正在重新连接……' });
      return;
    }
    const timer = setTimeout(() => resolve({ error: '刚刚没跟上大家，再试一次吧。' }), 8000);
    s.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res || {});
    });
  });
}

function newCommandId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function applyRoom(room) {
  if (!room) return;
  // 广播快照不含 viewerId，保留本端身份，避免房主控制权被冲掉
  const prevViewer = state.room?.viewerId;
  const merged = { ...room };
  if (merged.viewerId == null || merged.viewerId === '') {
    if (prevViewer != null) merged.viewerId = prevViewer;
  }
  if (merged.canControl == null && merged.viewerId != null) {
    merged.canControl = Boolean(merged.allowAllControl) || sameUser(merged.hostId, merged.viewerId);
  }
  state.room = merged;
  state.joined = true;
  state.error = '';
  state.lastSyncAt = Date.now();
  state.playFail = false;
  syncPlaybackToRoom(true);
}

/** 将房间状态落到 music-player（共用 audio，避免双声） */
async function syncPlaybackToRoom(force = false) {
  const r = state.room;
  if (!r || !r.current) return;
  if (applying) return;
  applying = true;
  try {
    roomMode = true;
    const track = r.current;
    const cur = musicPlayer.state.current;
    const same = cur && cur.id === track.id && cur.source === track.source;
    const targetSec = currentPosMs() / 1000;
    const durSec = (Number(track.durationMs) || (Number(track.duration) || 0) * 1000) / 1000;
    const el = musicPlayer.getAudioElement();
    const mediaIsThis = musicPlayer.isMediaLoadedFor(track);
    // 曲末：不要 seek 越界；仅当 media 确实是这首时才认 ended
    const atEnd = durSec > 0
      ? targetSec >= durSec - 0.4
      : Boolean(mediaIsThis && el?.ended);

    if (!same || force) {
      // 进入/切歌：装载房间曲目
      musicPlayer.setListenMode(true);
      // 已到曲末就不要再从末尾起播（会卡住 ended）；交给曲终上报/看门狗
      if (atEnd && r.playing && mediaIsThis) {
        reportTrackEnded();
        return;
      }
      await musicPlayer.playTrack(track, { listenSync: true, startAt: targetSec, autoplay: r.playing && !atEnd });
    } else {
      // 同曲：只纠偏播放状态与进度
      const drift = Math.abs((el?.currentTime || 0) - targetSec);
      state.drift = drift;
      // 曲终检测：ended 或已顶到时长末尾（必须是本曲 media，排除切歌加载中的旧 ended）
      if (r.playing && mediaIsThis) {
        if (el?.ended || (durSec > 0 && (el?.currentTime || 0) >= durSec - 0.25 && el?.paused)) {
          reportTrackEnded();
          return;
        }
      }
      if (r.playing && !atEnd) {
        if (el && el.paused && !el.ended) {
          const ok = await musicPlayer.tryPlay();
          if (!ok) state.playFail = true;
          else state.playFail = false;
        }
        // 明显差异才校正（>1.2s），轻微漂移忽略
        if (el && drift > 1.2 && Date.now() - lastSeekAt > 1500) {
          lastSeekAt = Date.now();
          try { el.currentTime = targetSec; } catch { /* ignore */ }
        }
      } else {
        // 房间暂停时才停；播放中到曲末也别 pause，否则永远等不到 ended
        if (el && !r.playing && !el.paused) {
          try { el.pause(); } catch { /* ignore */ }
        }
        if (el && drift > 1.2 && !atEnd && Date.now() - lastSeekAt > 1500) {
          lastSeekAt = Date.now();
          try { el.currentTime = targetSec; } catch { /* ignore */ }
        }
      }
    }
    lastApplyAt = Date.now();
  } finally {
    applying = false;
  }
}

function reportTrackEnded() {
  musicPlayer.setListenMode(true);
  musicPlayer.notifyListenTrackEnded('watchdog');
}

// 曲终上报：由房间权威切歌/停住，避免本地连播抢跑
musicPlayer.setListenTrackEndedHandler((reason, endedKey) => {
  if (!state.joined || !state.room?.id) return;
  const track = state.room.current;
  const key = endedKey || (track ? `${track.source}:${track.id}` : '');
  emitAck('listen:track-ended', {
    sessionId: state.room.id,
    roomId: state.room.id,
    trackKey: key,
  }).then((res) => {
    if (res?.room) applyRoom(res.room);
  }).catch(() => {});
});

// 播放被系统拦下（非音源问题）：提示用户点一下，而不是当坏歌
musicPlayer.setListenPlayFailHandler(() => {
  state.playFail = true;
});

/** 用户手势恢复出声（一起听静音兜底）——必须在手势里同步调 play */
export function resumePlaybackFromGesture() {
  return musicPlayer.tryPlay().then((ok) => {
    if (ok) state.playFail = false;
    else musicPlayer.unlockAudio();
    return ok;
  });
}

function startSyncLoop() {
  if (syncTimer) return;
  syncTimer = setInterval(() => {
    if (!state.room || !state.joined) return;
    // 曲终看门狗：ended 事件可能被后台/提前 pause 吃掉
    const el = musicPlayer.getAudioElement();
    const track = state.room.current;
    const durSec = (Number(track?.durationMs) || (Number(track?.duration) || 0) * 1000) / 1000;
    if (state.room.playing && musicPlayer.isMediaLoadedFor(track)) {
      if (el?.ended) {
        reportTrackEnded();
        return;
      }
      if (durSec > 0 && (el?.currentTime || 0) >= durSec - 0.2) {
        reportTrackEnded();
        return;
      }
    }
    // 校验进度差异
    syncPlaybackToRoom(false);
  }, 1500);
}

function stopSyncLoop() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = 0;
  }
}

function bindSocket() {
  const s = socket();
  if (!s || s.__listenTogetherBound) return;
  s.__listenTogetherBound = true;

  s.on('listen:state', (payload) => {
    if (!payload || (state.room && payload.id && payload.id !== state.room.id)) return;
    applyRoom(payload);
  });
  s.on('listen:ended', (payload) => {
    if (state.room && payload?.roomId && payload.roomId !== state.room.id) return;
    state.room = null;
    state.joined = false;
    roomMode = false;
    musicPlayer.setListenMode(false);
    stopSyncLoop();
    toast('本次一起听已结束');
  });
  s.on('listen:host-changed', (payload) => {
    if (!state.room) return;
    state.room.hostId = payload?.hostId;
    if (payload?.hostId === state.room.viewerId) toast('主持人已转移');
    else toast('主持人已转移');
  });
  s.on('listen:react', (payload) => {
    if (!payload) return;
    const item = {
      id: `${payload.at}-${payload.userId}-${Math.random().toString(36).slice(2, 6)}`,
      emoji: payload.emoji,
      nickname: payload.nickname,
      userId: payload.userId,
      at: payload.at,
    };
    state.reactions = [...state.reactions.slice(-20), item];
    setTimeout(() => {
      state.reactions = state.reactions.filter((x) => x.id !== item.id);
    }, 2200);
  });
  s.on('disconnect', () => {
    if (state.joined) state.error = '网络已断开，正在重新连接';
  });
  s.on('connect', () => {
    if (state.room?.id) {
      // 重连后重新加入并拉全量
      emitAck('listen:join', { roomId: state.room.id }).then((res) => {
        if (res.ok && res.room) applyRoom(res.room);
        else if (res.error) {
          state.error = res.error;
          if (res.error.includes('结束') || res.error.includes('无权')) {
            leaveRoom({ silent: true });
          }
        }
      });
    }
  });
}

export async function createRoom({ conversationId, track, inviteMessageId = null, hostName = '', sendInvite = true, conversationName = '' }) {
  musicPlayer.unlockAudio();
  bindSocket();
  state.connecting = true;
  state.error = '';
  const res = await emitAck('listen:create', { conversationId, track, inviteMessageId });
  state.connecting = false;
  if (res.error) {
    if (res.room) applyRoom(res.room);
    state.error = res.error;
    toast(res.error);
    return res;
  }
  applyRoom(res.room);
  startSyncLoop();
  // 开房即播：确保第一首立刻出声（用户手势内 autoplay 允许）
  if (res.room && res.room.playing === false && (res.room.allowAllControl || sameUser(res.room.hostId, res.room.viewerId))) {
    try {
      await emitAck('listen:command', {
        sessionId: res.room.id,
        roomId: res.room.id,
        action: 'play',
        commandId: newCommandId(),
        baseRevision: res.room.revision || 1,
        positionMs: 0,
      });
    } catch { /* ignore */ }
    await syncNow().catch(() => {});
    await syncPlaybackToRoom(true);
  } else {
    await syncPlaybackToRoom(true);
  }
  // 在会话内发送邀请卡片（只发一条）；对方在聊天列表/会话里点「进去听听」加入
  if (sendInvite && res.room) {
    // 始终以房间绑定的会话为准，避免参数丢失时误发到默认群
    const convId = String(res.room.conversationId || conversationId || 'default');
    const s = socket();
    const title = track?.title || '一起听';
    const ext = {
      kind: 'listen',
      roomId: res.room.id,
      sessionId: res.room.id,
      title,
      artist: track?.artist || '',
      cover: track?.cover || '',
      source: track?.source || 'qq',
      hostName: hostName || '我',
      memberCount: 1,
      id: track?.id,
      status: 'active',
    };
    const content = `[一起听] ${title}`.slice(0, 80);
    const payload = {
      content,
      mediaType: 'listentogether',
      ext,
    };
    const send = (event) =>
      new Promise((resolve) => {
        if (!s || !s.connected) {
          resolve({ error: 'socket' });
          return;
        }
        try {
          if (convId.startsWith('pv_')) s.emit('private:join', convId);
          else s.emit('group:join', convId);
        } catch { /* ignore */ }
        const timer = setTimeout(() => resolve({ error: 'timeout' }), 5000);
        s.emit(event, { conversationId: convId, ...payload }, (r) => {
          clearTimeout(timer);
          resolve(r || {});
        });
      });
    const event = convId.startsWith('pv_') ? 'private:send' : 'message:send';
    const sent = await send(event);
    const label = conversationName || (convId.startsWith('pv_') ? '私聊' : '群聊');
    if (sent?.error || !sent?.id) {
      const why = sent?.error || '服务器未确认';
      toast(`房间已开，但邀请卡片未发出（${why}）`);
      const retry = await send(event);
      if (retry?.id) {
        toast(`已把邀请卡片发到${label}，对方点「进去听听」即可加入`);
      }
    } else {
      toast(`已把邀请卡片发到${label}，对方点「进去听听」即可加入`);
    }
  }
  return res;
}

export async function joinRoom(roomIdOrExt, { inviteMessageId = null } = {}) {
  musicPlayer.unlockAudio();
  bindSocket();
  state.connecting = true;
  state.error = '';
  const id = typeof roomIdOrExt === 'string'
    ? roomIdOrExt
    : (roomIdOrExt?.sessionId || roomIdOrExt?.roomId || '');
  const res = await emitAck('listen:join', {
    sessionId: id,
    roomId: id,
    inviteMessageId,
  });
  state.connecting = false;
  if (res.error) {
    state.error = res.error;
    toast(res.error);
    return res;
  }
  applyRoom(res.room);
  startSyncLoop();
  // 进房立刻跟播/跟停，不要等下一次 5s 校准
  await syncPlaybackToRoom(true);
  return res;
}

export async function leaveRoom({ silent = false } = {}) {
  const id = state.room?.id;
  stopSyncLoop();
  if (id) await emitAck('listen:leave', { roomId: id });
  state.room = null;
  state.joined = false;
  roomMode = false;
  musicPlayer.setListenMode(false);
  if (!silent) toast('已退出一起听');
}

export async function syncNow() {
  if (!state.room?.id) return;
  const res = await emitAck('listen:sync', { roomId: state.room.id });
  if (res.ok && res.room) applyRoom(res.room);
  else if (res.error) {
    state.error = res.error;
    toast(res.error);
  }
}

export async function control(action, extra = {}) {
  if (!state.room?.id) return;
  const map = { toggle: 'play', prev: 'previous' };
  const act = map[action] || action;
  if (!listenTogether.canControl && ['play', 'pause', 'seek', 'next', 'previous', 'set-track'].includes(act)) {
    toast('现在由主持人控制播放。');
    return;
  }
  const res = await emitAck('listen:command', {
    sessionId: state.room.id,
    roomId: state.room.id,
    action: act,
    commandId: newCommandId(),
    baseRevision: state.room.revision || 0,
    ...extra,
  });
  if (res.error) toast(res.error);
  else if (res.room) applyRoom(res.room);
}

export async function queueAction(action, extra = {}) {
  if (!state.room?.id) return;
  const event =
    action === 'add' ? 'listen:queue-add'
    : action === 'remove' ? 'listen:queue-remove'
    : action === 'move' ? 'listen:queue-move'
    : 'listen:queue';
  const res = await emitAck(event, { sessionId: state.room.id, roomId: state.room.id, action, ...extra });
  if (res.error) toast(res.error);
  else if (res.room) applyRoom(res.room);
  return res;
}

export async function setAllowAllControl(allow) {
  if (!state.room?.id) return;
  const res = await emitAck('listen:control-mode', {
    sessionId: state.room.id,
    roomId: state.room.id,
    allowAllControl: !!allow,
    mode: allow ? 'all' : 'host',
  });
  if (res.error) toast(res.error);
  else if (res.room) applyRoom(res.room);
}

export async function sendReaction(emoji) {
  if (!state.room?.id) return;
  const res = await emitAck('listen:reaction', { sessionId: state.room.id, roomId: state.room.id, emoji });
  if (res.error && !res.error.includes('频繁')) toast(res.error);
}

export async function endRoom() {
  if (!state.room?.id) return;
  const res = await emitAck('listen:end', { sessionId: state.room.id, roomId: state.room.id });
  if (res.error) toast(res.error);
}

export function reportPlayFail() {
  state.playFail = true;
  toast('当前歌曲暂时无法播放');
}

export function resetListenTogether() {
  stopSyncLoop();
  state.room = null;
  state.joined = false;
  state.error = '';
  state.reactions = [];
  roomMode = false;
  musicPlayer.setListenMode(false);
}

// 页面重新可见 / 焦点恢复时重新同步
if (typeof document !== 'undefined') {
  const recover = () => {
    if (!state.joined) return;
    syncNow().catch(() => {});
    syncPlaybackToRoom(true).catch(() => {});
    // 之前被系统拦下：后台回来再试一次出声
    if (state.playFail && state.room?.playing) {
      musicPlayer.tryPlay().then((ok) => {
        if (ok) state.playFail = false;
      }).catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') recover();
  });
  window.addEventListener('focus', recover);
  window.addEventListener('pageshow', recover);
}

export function isRoomMode() {
  return roomMode;
}
