// 叠塔对战：服务端权威房间 / 邀请 / 落塔判定
// 房间状态在内存；邀请与个人统计写 SQLite。服务重启后进行中比赛结束，旧邀请标记 closed。
import { randomBytes, randomUUID } from 'node:crypto';
import { canAccessConversation, canAccessPrivate } from './acl.js';
import { getGroup, listGroupMembers, groupConvId, DEFAULT_GROUP_KIND } from './groups.js';
import { isBlockedEither } from './friends.js';
import { stmts } from './db.js';
import {
  ROUND_DURATION_MS,
  COUNTDOWN_MS,
  MAX_LIVES,
  layoutOf,
  settleDrop,
  rankPlayers,
  playerSummary,
  initialPlayerState,
  resetPlayerForRound,
  nextSeed,
} from '../client/src/tower-engine.js';

const MAX_PLAYERS = 2;
const MIN_PLAYERS = 2;
const DISCONNECT_GRACE_MS = 15_000;
const WAITING_IDLE_MS = 15 * 60 * 1000;
const FINISHED_EMPTY_MS = 3 * 60 * 1000;
const CMD_CACHE_MS = 90_000;
const DROP_COOLDOWN_MS = 280;
const MAX_RTT_MS = 400;

/** @type {Map<string, object>} */
const rooms = new Map();
/** userId -> roomId */
const userRoom = new Map();
/** inviteId -> roomId */
const inviteIndex = new Map();
/** commandId -> { at, result } */
const cmdCache = new Map();
const rate = new Map();

function now() {
  return Date.now();
}

function rateOk(key, limit, windowMs) {
  const t = now();
  const arr = (rate.get(key) || []).filter((x) => t - x < windowMs);
  if (arr.length >= limit) {
    rate.set(key, arr);
    return false;
  }
  arr.push(t);
  rate.set(key, arr);
  return true;
}

function newInviteId() {
  return randomBytes(16).toString('hex');
}

function isAiConversation(conversationId) {
  return /_ai_/.test(String(conversationId || ''));
}

function isRealPrivate(conversationId) {
  const conv = String(conversationId || '');
  return conv.startsWith('pv_u_');
}

function privatePeerId(userId, conversationId) {
  const parts = String(conversationId).split('_');
  if (parts[1] !== 'u') return null;
  const a = parseInt(parts[2], 10);
  const b = parseInt(parts[3], 10);
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  return a === Number(userId) ? b : a;
}

function canSendToConversation(userId, conversationId) {
  const conv = conversationId == null || conversationId === '' ? 'default' : String(conversationId);
  if (isAiConversation(conv)) return false;
  if (conv.startsWith('pv_')) {
    if (!isRealPrivate(conv)) return false;
    if (!canAccessPrivate(userId, conv)) return false;
    const peer = privatePeerId(userId, conv);
    if (peer && isBlockedEither(userId, peer)) return false;
    return true;
  }
  if (conv === 'default') return true;
  if (conv.startsWith('grp_')) {
    if (!canAccessConversation(userId, conv, getGroup)) return false;
    const g = getGroup(Number(conv.slice(4)));
    if (!g) return false;
    if (g.isDefault) return true;
    const members = listGroupMembers(g.id) || [];
    return members.some((m) => Number(m.userId) === Number(userId));
  }
  return false;
}

function canJoinConversation(userId, conversationId) {
  return canSendToConversation(userId, conversationId);
}

function findPlayer(room, userId) {
  const uid = Number(userId);
  return room.players.find((p) => Number(p.userId) === uid) || null;
}

function activePlayers(room) {
  return room.players.filter((p) => !p.retired);
}

function touch(room) {
  room.updatedAt = now();
  room.version = (room.version || 1) + 1;
}

function compactInviteExt(invite) {
  const room = rooms.get(invite.roomId);
  const status = room ? room.status : 'closed';
  const playerCount = room ? activePlayers(room).length : 0;
  const ext = {
    kind: 'tower_invite',
    inviteId: String(invite.id).slice(0, 40),
    game: 'tower',
    inviterName: String(invite.inviterName || '').slice(0, 32),
    status: ['waiting', 'full', 'countdown', 'playing', 'finished', 'closed'].includes(status)
      ? status
      : 'closed',
    playerCount,
    maxPlayers: MAX_PLAYERS,
    createdAt: invite.createdAt,
  };
  let json = JSON.stringify(ext);
  if (json.length > 780) {
    delete ext.createdAt;
    json = JSON.stringify(ext);
  }
  if (json.length > 780) {
    const slim = {
      kind: 'tower_invite',
      inviteId: ext.inviteId,
      game: 'tower',
      inviterName: ext.inviterName.slice(0, 16),
      status: ext.status,
      playerCount: ext.playerCount,
      maxPlayers: MAX_PLAYERS,
    };
    return slim;
  }
  return ext;
}

function persistInviteExt(invite) {
  if (!invite.messageId) return null;
  const ext = compactInviteExt(invite);
  try {
    stmts.updateMessageExt.run(JSON.stringify(ext).slice(0, 800), invite.messageId);
  } catch {
    /* ignore */
  }
  return ext;
}

function broadcastInviteUpdate(room, reason = 'status') {
  if (!room) return;
  for (const inv of room.invites) {
    const ext = persistInviteExt(inv);
    if (ext && inv.messageId) {
      try {
        const row = stmts.messageById.get(inv.messageId);
        if (row) {
          let msgExt = null;
          try {
            msgExt = row.ext ? JSON.parse(row.ext) : null;
          } catch {
            msgExt = null;
          }
          const payload = {
            id: row.id,
            senderType: row.sender_type,
            senderId: row.sender_id,
            senderName: row.sender_name,
            avatar: row.avatar,
            content: row.content,
            createdAt: row.created_at,
            mediaType: row.media_type ?? null,
            mediaUrl: row.media_url ?? null,
            conversationId: row.conversation_id ?? null,
            recalled: Boolean(row.recalled),
            ext: msgExt || ext,
            quote: null,
            towerInviteUpdate: true,
          };
          const conv = inv.conversationId;
          if (String(conv).startsWith('pv_')) {
            ioRef?.to(conv).emit('private:message', payload);
            const parts = String(conv).split('_');
            if (parts[1] === 'u') {
              const a = parseInt(parts[2], 10);
              const b = parseInt(parts[3], 10);
              if (Number.isInteger(a)) ioRef?.to(`user_${a}`).emit('private:message', payload);
              if (Number.isInteger(b)) ioRef?.to(`user_${b}`).emit('private:message', payload);
            }
          } else {
            const target = conv === 'default' ? 'group' : conv;
            ioRef?.to(target).emit('group:message', payload);
          }
        }
      } catch {
        /* ignore */
      }
    }
    ioRef?.to(`tower_${room.id}`).emit('tower:invite:update', {
      inviteId: inv.id,
      status: compactInviteExt(inv).status,
      playerCount: activePlayers(room).length,
      reason,
    });
  }
}

let ioRef = null;

function roomSnapshot(room, forUserId = null) {
  const ranked = rankPlayers(activePlayers(room).map((p) => playerSummary(p)));
  return {
    id: room.id,
    status: room.status,
    hostUserId: room.hostUserId,
    players: room.players.map((p) => ({
      ...playerSummary(p),
      isHost: Number(p.userId) === Number(room.hostUserId),
      isMe: forUserId != null && Number(p.userId) === Number(forUserId),
    })),
    ranking: ranked,
    playerCount: activePlayers(room).length,
    maxPlayers: MAX_PLAYERS,
    roundId: room.roundId,
    seed: room.seed,
    countdownAt: room.countdownAt,
    startAt: room.startAt,
    endAt: room.endAt,
    duration: room.duration,
    version: room.version,
    serverTime: now(),
    inviteIds: room.invites.map((i) => i.id),
  };
}

function broadcastRoom(room, event = 'tower:room', extra = {}) {
  if (!room) return;
  const payload = { room: roomSnapshot(room), ...extra, serverTime: now() };
  ioRef?.to(`tower_${room.id}`).emit(event, payload);
  // 也推给成员的 user 房间，刷新后未 join tower 房间时仍能恢复
  for (const p of room.players) {
    ioRef?.to(`user_${p.userId}`).emit(event, payload);
  }
}

function markInviteStatus(room, status, ended = false) {
  const t = now();
  try {
    stmts.setTowerInvitesStatusByRoom.run(status, t, ended ? t : null, room.id, status);
  } catch {
    /* ignore */
  }
  for (const inv of room.invites) {
    if (inv.status !== status) {
      inv.status = status;
      inv.updatedAt = t;
      if (ended) inv.endedAt = t;
      try {
        stmts.setTowerInviteStatus.run(status, t, ended ? t : null, inv.id);
      } catch {
        /* ignore */
      }
    }
  }
}

function closeRoom(room, reason = 'closed') {
  if (!room || room.status === 'closed') return;
  room.status = 'closed';
  room.closedAt = now();
  markInviteStatus(room, reason === 'finished' ? 'finished' : 'closed', true);
  broadcastInviteUpdate(room, reason);
  broadcastRoom(room, 'tower:room', { closed: true, reason });
  userRoom.forEach((rid, uid) => {
    if (rid === room.id) userRoom.delete(uid);
  });
  for (const p of room.players) {
    // 席位清掉，便于立刻开新局
  }
  touch(room);
}

function transferHost(room) {
  const candidates = activePlayers(room)
    .filter((p) => p.online)
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  const next = candidates[0];
  if (!next) return false;
  if (Number(next.userId) === Number(room.hostUserId)) return false;
  room.hostUserId = next.userId;
  touch(room);
  ioRef?.to(`tower_${room.id}`).emit('tower:host-changed', {
    hostUserId: next.userId,
    roomId: room.id,
    serverTime: now(),
  });
  return true;
}

function ensurePlayerSockets(socket, room) {
  socket.join(`tower_${room.id}`);
  socket.join(`user_${socket.data.user.id}`);
}

function resetPlayer(p) {
  resetPlayerForRound(p);
}

function startCountdown(room) {
  if (room.status !== 'waiting' && room.status !== 'finished') return false;
  const online = activePlayers(room).filter((p) => p.online && !p.retired);
  if (online.length < MIN_PLAYERS) return false;
  if (!online.every((p) => p.ready)) return false;
  const t = now();
  room.status = 'countdown';
  room.countdownAt = t;
  room.startAt = t + COUNTDOWN_MS;
  room.endAt = room.startAt + ROUND_DURATION_MS;
  room.duration = ROUND_DURATION_MS;
  if (!room.seed) room.seed = nextSeed(room.createdAt);
  room.roundId = room.roundId || randomUUID().slice(0, 12);
  touch(room);
  markInviteStatus(room, 'countdown');
  broadcastInviteUpdate(room, 'countdown');
  broadcastRoom(room, 'tower:countdown', {
    countdownAt: room.countdownAt,
    startAt: room.startAt,
    endAt: room.endAt,
    roundId: room.roundId,
    seed: room.seed,
  });
  // 倒计时结束自动开赛（服务端定时）
  room.countdownTimer = setTimeout(() => {
    if (room.status === 'countdown') beginPlaying(room);
  }, COUNTDOWN_MS + 30);
  room.countdownTimer.unref?.();
  return true;
}

function beginPlaying(room) {
  if (room.status !== 'countdown') return;
  const online = activePlayers(room).filter((p) => p.online && !p.retired);
  if (online.length < MIN_PLAYERS) {
    room.status = 'waiting';
    room.countdownAt = 0;
    room.startAt = 0;
    room.endAt = 0;
    touch(room);
    markInviteStatus(room, 'waiting');
    broadcastInviteUpdate(room, 'cancel');
    broadcastRoom(room, 'tower:room', { cancelled: true });
    return;
  }
  room.status = 'playing';
  room.startAt = room.startAt || now();
  room.endAt = room.startAt + ROUND_DURATION_MS;
  touch(room);
  markInviteStatus(room, 'playing');
  broadcastInviteUpdate(room, 'playing');
  broadcastRoom(room, 'tower:started', {
    startAt: room.startAt,
    endAt: room.endAt,
    roundId: room.roundId,
    seed: room.seed,
  });
  room.playTimer = setTimeout(() => {
    if (room.status === 'playing') finishRound(room);
  }, Math.max(50, room.endAt - now()));
  room.playTimer.unref?.();
}

function updateStatsForPlayers(room) {
  const ranked = rankPlayers(activePlayers(room).map((p) => playerSummary(p)));
  const winnerId = ranked[0]?.userId;
  for (const p of room.players) {
    const isWinner = Number(p.userId) === Number(winnerId);
    try {
      stmts.upsertTowerStats.run(
        Number(p.userId),
        1,
        isWinner && !p.retired ? 1 : 0,
        Number(p.score) || 0,
        Number(p.maxHeight) || 0,
        Number(p.maxCombo) || 0,
        now()
      );
    } catch {
      /* ignore */
    }
  }
  return ranked;
}

function finishRound(room) {
  if (room.status !== 'playing') return;
  if (room.playTimer) {
    clearTimeout(room.playTimer);
    room.playTimer = null;
  }
  room.status = 'finished';
  const ranked = updateStatsForPlayers(room);
  touch(room);
  markInviteStatus(room, 'finished');
  broadcastInviteUpdate(room, 'finished');
  broadcastRoom(room, 'tower:finished', {
    ranking: ranked,
    roundId: room.roundId,
    endAt: room.endAt,
    serverTime: now(),
  });
}

function cancelCountdown(room) {
  if (room.countdownTimer) {
    clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
  }
  if (room.status === 'countdown') {
    room.status = 'waiting';
    room.countdownAt = 0;
    room.startAt = 0;
    room.endAt = 0;
    touch(room);
    markInviteStatus(room, 'waiting');
    broadcastInviteUpdate(room, 'cancel');
    broadcastRoom(room, 'tower:room', { cancelled: true });
  }
}

function normalizeConv(conversationId) {
  const conv = conversationId == null || conversationId === '' ? 'default' : String(conversationId);
  if (conv === 'default') {
    try {
      const g = stmts.groupByKind.get(DEFAULT_GROUP_KIND);
      if (g?.id) return groupConvId(g.id);
    } catch {
      /* ignore */
    }
    return 'default';
  }
  return conv;
}

function insertChatMessage({ user, conversationId, content, mediaType, ext }) {
  const conv = normalizeConv(conversationId);
  const nowTs = now();
  const r = stmts.insertMessage.run(
    'user',
    user.id,
    user.nickname,
    user.avatar || user.avatarColor || '',
    content,
    nowTs,
    mediaType,
    null,
    conv === 'default' ? null : conv
  );
  const mid = Number(r.lastInsertRowid);
  const extJson = ext ? JSON.stringify(ext).slice(0, 800) : null;
  if (extJson) {
    try {
      stmts.updateMessageExt.run(extJson, mid);
    } catch {
      /* ignore */
    }
  }
  let row = null;
  try {
    row = stmts.messageById.get(mid);
  } catch {
    row = null;
  }
  let msgExt = null;
  try {
    msgExt = row?.ext ? JSON.parse(row.ext) : ext;
  } catch {
    msgExt = ext;
  }
  const msg = {
    id: mid,
    senderType: 'user',
    senderId: user.id,
    senderName: user.nickname,
    avatar: user.avatar || user.avatarColor,
    content,
    createdAt: nowTs,
    mediaType,
    mediaUrl: null,
    conversationId: conv === 'default' ? null : conv,
    recalled: false,
    ext: msgExt,
    quote: null,
  };
  return { msg, conversationId: conv };
}

function broadcastChatMessage(conversationId, msg) {
  const conv = String(conversationId);
  if (conv.startsWith('pv_')) {
    ioRef?.to(conv).emit('private:message', msg);
    const parts = conv.split('_');
    if (parts[1] === 'u') {
      const a = parseInt(parts[2], 10);
      const b = parseInt(parts[3], 10);
      if (Number.isInteger(a)) ioRef?.to(`user_${a}`).emit('private:message', msg);
      if (Number.isInteger(b)) ioRef?.to(`user_${b}`).emit('private:message', msg);
      try {
        for (const uid of [a, b]) {
          if (Number.isInteger(uid) && uid !== msg.senderId) {
            stmts.incrChatUnread.run(uid, conv, now());
          }
        }
      } catch {
        /* ignore */
      }
    }
  } else {
    const isDefault = !conv || conv === 'default' || conv.startsWith('grp_') === false;
    // 默认群广播到 group 房间
    let defaultConv = null;
    try {
      const g = stmts.groupByKind.get(DEFAULT_GROUP_KIND);
      if (g?.id) defaultConv = groupConvId(g.id);
    } catch {
      /* ignore */
    }
    const isDefaultConv = !conv || conv === 'default' || (defaultConv && conv === defaultConv);
    const target = isDefaultConv ? 'group' : conv;
    const payload = { ...msg, conversationId: isDefaultConv ? (defaultConv || null) : conv };
    ioRef?.to(target).emit('group:message', payload);
    if (isDefaultConv) ioRef?.to(target).emit('message:new', payload);
    try {
      stmts.incrChatUnreadAll.run(isDefaultConv ? (defaultConv || 'default') : conv, now(), msg.senderId ?? -1);
    } catch {
      /* ignore */
    }
    void isDefault;
  }
}

function getCachedCommand(commandId) {
  if (!commandId) return null;
  const hit = cmdCache.get(String(commandId));
  if (!hit) return null;
  if (now() - hit.at > CMD_CACHE_MS) {
    cmdCache.delete(String(commandId));
    return null;
  }
  return hit;
}

function rememberCommand(commandId, result) {
  if (!commandId) return;
  cmdCache.set(String(commandId), { at: now(), result });
}

function userActiveRoom(userId) {
  const rid = userRoom.get(Number(userId));
  if (!rid) return null;
  const room = rooms.get(rid);
  if (!room || room.status === 'closed') {
    userRoom.delete(Number(userId));
    return null;
  }
  return room;
}

function activeRoomSnapshotForUser(userId) {
  const room = userActiveRoom(userId);
  return room ? roomSnapshot(room, userId) : null;
}

// 服务重启时把历史邀请标为 closed
try {
  stmts.listActiveTowerInvites.all().forEach((row) => {
    stmts.setTowerInviteStatus.run('closed', now(), now(), row.id);
  });
} catch {
  /* ignore */
}

export function initTowerBattle(io) {
  ioRef = io;

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (!user) return;
    const uid = Number(user.id);
    socket.join(`user_${uid}`);

    const err = (ack, code, message, extra = {}) => {
      const payload = { error: message, code, ...extra };
      if (typeof ack === 'function') ack(payload);
      socket.emit('tower:error', payload);
    };

    const ok = (ack, payload = {}) => {
      const res = { ok: true, ...payload, serverTime: now() };
      if (typeof ack === 'function') ack(res);
      return res;
    };

    // 恢复：若已有活动房间，重新挂接
    const existing = userActiveRoom(uid);
    if (existing) {
      ensurePlayerSockets(socket, existing);
      const p = findPlayer(existing, uid);
      if (p) {
        p.online = true;
        p.disconnectedAt = 0;
      }
    }

    socket.on('tower:room:create', (payload = {}, ack) => {
      try {
        if (!rateOk(`create:${uid}`, 4, 10_000)) return err(ack, 'rate', '开得太快啦，歇一下。');
        const cur = userActiveRoom(uid);
        if (cur && cur.status !== 'closed' && cur.status !== 'finished') {
          return ok(ack, {
            exists: true,
            room: roomSnapshot(cur, uid),
            error: '你还在另一场，先回去看看吧。',
            code: 'already_in_room',
          });
        }
        // 同一用户已有未结束房间：直接回到房间
        if (cur) {
          return ok(ack, { exists: true, room: roomSnapshot(cur, uid) });
        }
        const t = now();
        const room = {
          id: randomUUID().slice(0, 10),
          hostUserId: uid,
          status: 'waiting',
          players: [],
          invites: [],
          roundId: null,
          seed: nextSeed(t),
          countdownAt: 0,
          startAt: 0,
          endAt: 0,
          duration: ROUND_DURATION_MS,
          version: 1,
          createdAt: t,
          updatedAt: t,
          countdownTimer: null,
          playTimer: null,
        };
        room.players.push(
          initialPlayerState({
            userId: uid,
            nickname: user.nickname,
            avatar: user.avatar ?? null,
            avatarColor: user.avatarColor || '#4f6ef7',
            joinedAt: t,
            online: true,
            ready: true,
          })
        );
        rooms.set(room.id, room);
        userRoom.set(uid, room.id);
        ensurePlayerSockets(socket, room);
        touch(room);
        ok(ack, { room: roomSnapshot(room, uid), created: true });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('tower:room:sync', (payload = {}, ack) => {
      try {
        const room = userActiveRoom(uid);
        if (!room) {
          return ok(ack, { room: null, active: false });
        }
        ensurePlayerSockets(socket, room);
        const p = findPlayer(room, uid);
        if (p) {
          p.online = true;
          p.disconnectedAt = 0;
        }
        return ok(ack, { room: roomSnapshot(room, uid) });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('tower:room:leave', (payload = {}, ack) => {
      try {
        const room = userActiveRoom(uid);
        if (!room) return ok(ack, { left: true });
        const p = findPlayer(room, uid);
        if (room.status === 'playing' || room.status === 'countdown') {
          if (p) {
            p.retired = true;
            p.ready = false;
            p.online = false;
            p.disconnectedAt = now();
          }
          // 人数不足则取消倒计时
          if (room.status === 'countdown' && activePlayers(room).filter((x) => x.online && !x.retired).length < MIN_PLAYERS) {
            cancelCountdown(room);
          }
          if (activePlayers(room).filter((x) => !x.retired).length === 0) {
            finishRound(room);
            closeRoom(room, 'empty');
          } else {
            touch(room);
            broadcastRoom(room, 'tower:player-update');
            broadcastInviteUpdate(room, 'leave');
          }
        } else {
          room.players = room.players.filter((x) => Number(x.userId) !== uid);
          if (Number(room.hostUserId) === uid) transferHost(room);
          if (room.players.length === 0) {
            closeRoom(room, 'empty');
          } else {
            touch(room);
            broadcastRoom(room, 'tower:player-update');
            broadcastInviteUpdate(room, 'leave');
          }
        }
        userRoom.delete(uid);
        socket.leave(`tower_${room.id}`);
        return ok(ack, { left: true });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('tower:ready', (payload = {}, ack) => {
      try {
        if (!rateOk(`ready:${uid}`, 12, 5_000)) return err(ack, 'rate', '操作有点快。');
        const room = userActiveRoom(uid);
        if (!room) return err(ack, 'no_room', '房间不在了，再开一局吧。');
        if (room.status !== 'waiting' && room.status !== 'finished') {
          return err(ack, 'bad_state', '现在不能改准备状态。');
        }
        const p = findPlayer(room, uid);
        if (!p || p.retired) return err(ack, 'not_in_room', '你不在这个房间里。');
        p.ready = payload.ready !== false;
        touch(room);
        broadcastRoom(room, 'tower:player-update');
        return ok(ack, { room: roomSnapshot(room, uid) });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('tower:start', (payload = {}, ack) => {
      try {
        if (!rateOk(`start:${uid}`, 4, 5_000)) return err(ack, 'rate', '慢一点。');
        const room = userActiveRoom(uid);
        if (!room) return err(ack, 'no_room', '房间不在了。');
        if (Number(room.hostUserId) !== uid) return err(ack, 'not_host', '等房主来开场。');
        if (room.status === 'countdown' || room.status === 'playing') {
          return ok(ack, { room: roomSnapshot(room, uid), already: true });
        }
        if (room.status !== 'waiting' && room.status !== 'finished') {
          return err(ack, 'bad_state', '现在不能开始。');
        }
        // 再来一局：清空上一局状态
        if (room.status === 'finished') {
          room.roundId = randomUUID().slice(0, 12);
          room.seed = nextSeed(room.seed);
          for (const pl of room.players) resetPlayer(pl);
        }
        const online = activePlayers(room).filter((x) => x.online && !x.retired);
        if (online.length < MIN_PLAYERS) return err(ack, 'need_more', '再来一位就开场。');
        if (!online.every((x) => x.ready)) return err(ack, 'not_ready', '等大家准备好。');
        if (!startCountdown(room)) return err(ack, 'cannot_start', '现在还开不了。');
        return ok(ack, { room: roomSnapshot(room, uid) });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('tower:rematch', (payload = {}, ack) => {
      try {
        if (!rateOk(`rematch:${uid}`, 4, 5_000)) return err(ack, 'rate', '慢一点。');
        const room = userActiveRoom(uid);
        if (!room) return err(ack, 'no_room', '房间不在了。');
        if (room.status !== 'finished') return err(ack, 'bad_state', '这一局还没结束。');
        const p = findPlayer(room, uid);
        if (!p) return err(ack, 'not_in_room', '你不在这个房间里。');
        room.roundId = randomUUID().slice(0, 12);
        room.seed = nextSeed(room.seed);
        for (const pl of room.players) {
          resetPlayer(pl);
          pl.ready = true;
        }
        room.status = 'waiting';
        touch(room);
        markInviteStatus(room, 'waiting');
        broadcastInviteUpdate(room, 'rematch');
        broadcastRoom(room, 'tower:room', { rematch: true });
        // 双人都在就直接下一局
        if (activePlayers(room).length >= MIN_PLAYERS) {
          startCountdown(room);
        }
        return ok(ack, { room: roomSnapshot(room, uid) });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    // 原版叠塔练习嵌入：回报本地成绩用于双人排名（不替代本地判定）
    socket.on('tower:score', (payload = {}, ack) => {
      try {
        if (!rateOk(`score:${uid}`, 20, 5_000)) return err(ack, 'rate', '慢一点。');
        const room = userActiveRoom(uid);
        if (!room || room.status !== 'playing') return err(ack, 'not_playing', '还没开场呢。');
        const p = findPlayer(room, uid);
        if (!p || p.retired) return err(ack, 'not_in_room', '你不在比赛中。');
        const score = Math.max(0, Math.min(99999, Number(payload.score) || 0));
        const layers = Math.max(0, Math.min(200, Number(payload.layers) || 0));
        const livesUsed = Math.max(0, Math.min(MAX_LIVES, Number(payload.failed) || 0));
        p.score = score;
        p.layers = layers;
        p.maxHeight = Math.max(Number(p.maxHeight) || 0, layers);
        p.livesUsed = livesUsed;
        p.combo = Number(payload.combo) || 0;
        p.maxCombo = Math.max(Number(p.maxCombo) || 0, p.combo);
        // 3 命用尽或客户端报 done → 本局结束
        if (payload.done === true || livesUsed >= MAX_LIVES) {
          p.finishedAt = now();
        }
        touch(room);
        const ranked = rankPlayers(activePlayers(room).map((x) => playerSummary(x)));
        broadcastRoom(room, 'tower:player-update');
        // 双方都打完则立刻结算，不等 90 秒
        const actives = activePlayers(room).filter((x) => !x.retired);
        const allDone = actives.length > 0 && actives.every((x) => x.finishedAt || (Number(x.livesUsed) || 0) >= MAX_LIVES);
        if (allDone && room.status === 'playing') {
          finishRound(room);
        }
        return ok(ack, { me: playerSummary(p), ranking: ranked });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('tower:drop', (payload = {}, ack) => {
      const commandId = String(payload.commandId || '');
      try {
        const cached = getCachedCommand(commandId);
        if (cached) {
          const payloadCached = cached.result || cached;
          if (payloadCached.__error) {
            return err(ack, payloadCached.code || 'dup', payloadCached.error || '重复操作', {
              snapshot: payloadCached.snapshot,
            });
          }
          return ok(ack, payloadCached);
        }
        const fail = (code, message, extra = {}) => {
          const res = { error: message, code, ...extra };
          if (commandId) rememberCommand(commandId, { __error: true, ...res });
          return err(ack, code, message, extra);
        };
        if (!rateOk(`drop:${uid}`, 8, 2_000)) return fail('rate', '落得太快啦。', { snapshot: activeRoomSnapshotForUser(uid) });
        const room = userActiveRoom(uid);
        if (!room) return fail('no_room', '房间不在了。', { snapshot: null });
        if (room.status !== 'playing') return fail('not_playing', '还没开场呢。', { snapshot: roomSnapshot(room, uid) });
        const roundId = String(payload.roundId || '');
        if (roundId && room.roundId && roundId !== room.roundId) {
          return fail('stale_round', '这一局已经翻篇了。', { snapshot: roomSnapshot(room, uid) });
        }
        const p = findPlayer(room, uid);
        if (!p || p.retired) return fail('not_in_room', '你不在比赛中。', { snapshot: roomSnapshot(room, uid) });
        const seq = Number(payload.seq);
        if (!Number.isFinite(seq) || seq !== p.seq) {
          return fail('bad_seq', '节奏对不上，看看最新画面。', {
            snapshot: roomSnapshot(room, uid),
            expectedSeq: p.seq,
          });
        }
        if (p.lastDropAt && now() - p.lastDropAt < DROP_COOLDOWN_MS) {
          return fail('too_fast', '稍微稳一下再落。', { snapshot: roomSnapshot(room, uid) });
        }
        if ((Number(p.livesUsed) || 0) >= MAX_LIVES) {
          return fail('no_lives', '这局先歇歇，看你叠到多少。', { snapshot: roomSnapshot(room, uid) });
        }
        // 估计客户端落塔时刻：接收时间 - RTT/2，并夹在回合内
        const recv = now();
        const rtt = Math.min(MAX_RTT_MS, Math.max(0, Number(payload.rttMs) || Number(p.rttMs) || 0));
        const dropAt = recv - rtt / 2;
        const roundElapsed = Math.max(0, Math.min(room.endAt - room.startAt, dropAt - room.startAt));
        const result = settleDrop(p, {
          seed: room.seed,
          layout: layoutOf(390, 585),
          roundElapsedMs: roundElapsed,
          serverNow: dropAt,
        });
        // 无生命后不再继续扣分
        if (result.player?.livesUsed >= MAX_LIVES) {
          result.player.retired = false; // 仍可看排名，但不能再落
        }
        Object.assign(p, result.player);
        p.rttMs = rtt;
        touch(room);
        const ranked = rankPlayers(activePlayers(room).map((x) => playerSummary(x)));
        const payloadOk = {
          drop: {
            miss: result.miss,
            perfect: result.perfect,
            gained: result.gained,
            combo: result.combo,
            block: result.block,
            seq: result.player.seq - 1,
            roundId: room.roundId,
          },
          me: playerSummary(p),
          ranking: ranked,
          snapshot: roomSnapshot(room, uid),
        };
        rememberCommand(commandId, payloadOk);
        broadcastRoom(room, 'tower:drop-result', {
          userId: uid,
          drop: payloadOk.drop,
          me: playerSummary(p),
          ranking: ranked,
        });
        // 人数/阶段未变，不更新邀请卡；仅广播玩家摘要
        return ok(ack, payloadOk);
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('tower:ping', (payload = {}, ack) => {
      try {
        if (!rateOk(`ping:${uid}`, 30, 10_000)) return;
        const t = now();
        const rtt = Number(payload.rttMs) || 0;
        const room = userActiveRoom(uid);
        if (room) {
          const p = findPlayer(room, uid);
          if (p) p.rttMs = Math.min(MAX_RTT_MS, Math.max(0, rtt));
        }
        const res = { ok: true, serverTime: t, clientTime: payload.clientTime || t, rttMs: rtt };
        if (typeof ack === 'function') ack(res);
      } catch {
        /* ignore */
      }
    });

    socket.on('tower:invite:send', (payload = {}, ack) => {
      try {
        if (!rateOk(`invite:${uid}`, 8, 10_000)) return err(ack, 'rate', '邀请发得太快啦。');
        const room = userActiveRoom(uid);
        if (!room) return err(ack, 'no_room', '先发起一场对战吧。');
        if (Number(room.hostUserId) !== uid && !findPlayer(room, uid)) {
          return err(ack, 'not_in_room', '你不在这个房间里。');
        }
        if (room.status !== 'waiting' && room.status !== 'finished') {
          return err(ack, 'bad_state', '现在不能发邀请了。');
        }
        const conversationId = String(payload.conversationId || '');
        if (!conversationId) return err(ack, 'bad_conv', '先选一个会话吧。');
        if (!canSendToConversation(uid, conversationId)) {
          return err(ack, 'forbidden', '这个会话发不了邀请。');
        }
        // 避免同一会话重复卡片：已有未结束邀请则直接返回
        const convNorm0 = normalizeConv(conversationId);
        const dup = room.invites.find(
          (i) => normalizeConv(i.conversationId) === convNorm0 && i.status !== 'closed' && i.status !== 'finished'
        );
        if (dup && room.status === 'waiting') {
          return ok(ack, {
            inviteId: dup.id,
            messageId: dup.messageId,
            duplicated: true,
            status: compactInviteExt(dup).status,
          });
        }
        const inviteId = newInviteId();
        const t = now();
        const convNorm = normalizeConv(conversationId);
        const invite = {
          id: inviteId,
          roomId: room.id,
          conversationId: convNorm,
          messageId: null,
          inviterId: uid,
          inviterName: user.nickname,
          status: room.status === 'waiting' ? 'waiting' : room.status,
          createdAt: t,
          updatedAt: t,
          endedAt: null,
        };
        const ext = compactInviteExt(invite);
        const { msg, conversationId: msgConv } = insertChatMessage({
          user,
          conversationId,
          content: '[游戏邀请] 叠塔对战',
          mediaType: 'tower_invite',
          ext,
        });
        invite.messageId = msg.id;
        room.invites.push(invite);
        inviteIndex.set(inviteId, room.id);
        try {
          stmts.insertTowerInvite.run(
            inviteId,
            room.id,
            msgConv,
            msg.id,
            uid,
            invite.status,
            t,
            t
          );
        } catch {
          /* ignore */
        }
        // 再写一次 ext，保证 inviteId 完整
        persistInviteExt(invite);
        broadcastChatMessage(msgConv, msg);
        return ok(ack, {
          inviteId,
          messageId: msg.id,
          status: ext.status,
          playerCount: ext.playerCount,
        });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('tower:invite:join', (payload = {}, ack) => {
      try {
        const commandId = String(payload.commandId || '');
        const cached = getCachedCommand(commandId);
        if (cached) return ok(ack, cached.result);
        if (!rateOk(`join:${uid}`, 10, 5_000)) return err(ack, 'rate', '慢一点点。');
        const inviteId = String(payload.inviteId || '');
        if (!inviteId) return err(ack, 'bad_invite', '邀请无效，再约一局吧。');
        // 不接受客户端直接给 roomId 绕过邀请
        let room = null;
        const invRow = (() => {
          try {
            return stmts.getTowerInvite.get(inviteId);
          } catch {
            return null;
          }
        })();
        const ridFromIndex = inviteIndex.get(inviteId);
        if (invRow) room = rooms.get(String(invRow.room_id));
        if (!room && ridFromIndex) room = rooms.get(ridFromIndex);
        if (!room || room.status === 'closed') {
          return err(ack, 'invite_closed', '这场已经散了，再约一局吧。');
        }
        const inv = room.invites.find((i) => i.id === inviteId);
        if (invRow && invRow.conversation_id && !canJoinConversation(uid, invRow.conversation_id)) {
          return err(ack, 'forbidden', '你不在这个会话里。');
        }
        if (inv && inv.conversationId && !canJoinConversation(uid, inv.conversationId)) {
          return err(ack, 'forbidden', '你不在这个会话里。');
        }
        // 已在房间：恢复席位
        const already = findPlayer(room, uid);
        if (already) {
          already.online = true;
          already.disconnectedAt = 0;
          ensurePlayerSockets(socket, room);
          userRoom.set(uid, room.id);
          const result = { room: roomSnapshot(room, uid), joined: true, restored: true };
          rememberCommand(commandId, result);
          return ok(ack, result);
        }
        // 已有其他活动房间
        const other = userActiveRoom(uid);
        if (other && other.id !== room.id && other.status !== 'closed' && other.status !== 'finished') {
          return err(ack, 'already_in_room', '你还在另一场，先回去看看吧。', {
            snapshot: roomSnapshot(other, uid),
            needReturn: true,
          });
        }
        if (room.status !== 'waiting' && room.status !== 'finished') {
          return err(ack, 'already_started', '他们已经开场了，下一局再来。');
        }
        if (activePlayers(room).length >= MAX_PLAYERS) {
          return err(ack, 'full', '这里已经坐满啦，下局早点来。');
        }
        const t = now();
        room.players.push(
          initialPlayerState({
            userId: uid,
            nickname: user.nickname,
            avatar: user.avatar ?? null,
            avatarColor: user.avatarColor || '#4f6ef7',
            joinedAt: t,
            online: true,
            ready: true, // 双人即开，无需手动准备
          })
        );
        userRoom.set(uid, room.id);
        ensurePlayerSockets(socket, room);
        // 再来一局时新加入者清空状态
        if (room.status === 'finished') {
          resetPlayer(findPlayer(room, uid));
          findPlayer(room, uid).ready = true;
        }
        touch(room);
        // 创建者也默认已准备
        for (const pl of room.players) {
          if (!pl.retired) pl.ready = true;
        }
        broadcastInviteUpdate(room, 'join');
        broadcastRoom(room, 'tower:player-update');
        // 满 2 人自动开局
        if (room.status === 'waiting' && activePlayers(room).length >= MIN_PLAYERS) {
          if (!room.roundId) room.roundId = randomUUID().slice(0, 12);
          if (!room.seed) room.seed = nextSeed(room.createdAt);
          for (const pl of room.players) {
            if (!pl.line) resetPlayer(pl);
            pl.ready = true;
          }
          startCountdown(room);
        }
        const result = {
          room: roomSnapshot(room, uid),
          joined: true,
          message: '来得正好，准备开叠。',
        };
        rememberCommand(commandId, result);
        return ok(ack, result);
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('disconnect', () => {
      const room = userActiveRoom(uid);
      if (!room) return;
      const p = findPlayer(room, uid);
      if (!p) return;
      p.online = false;
      p.disconnectedAt = now();
      touch(room);
      broadcastRoom(room, 'tower:player-update');
      // 宽限期后仍离线则转移房主 / 视为离线
      setTimeout(() => {
        const r = rooms.get(room.id);
        if (!r) return;
        const pl = findPlayer(r, uid);
        if (pl && !pl.online) {
          if (Number(r.hostUserId) === uid && (r.status === 'waiting' || r.status === 'countdown' || r.status === 'playing' || r.status === 'finished')) {
            transferHost(r);
            broadcastRoom(r, 'tower:player-update');
          }
          if (r.status === 'countdown') {
            const online = activePlayers(r).filter((x) => x.online && !x.retired);
            if (online.length < MIN_PLAYERS) cancelCountdown(r);
          }
        }
      }, DISCONNECT_GRACE_MS).unref?.();
    });
  });

  // 清理定时器
  const timer = setInterval(() => {
    const t = now();
    for (const room of [...rooms.values()]) {
      if (room.status === 'closed') {
        if (t - (room.closedAt || room.updatedAt) > 30_000) rooms.delete(room.id);
        continue;
      }
      // 等待房长期无人
      if (room.status === 'waiting' && t - room.updatedAt > WAITING_IDLE_MS) {
        closeRoom(room, 'idle');
        continue;
      }
      // 结束后空房清理
      if (room.status === 'finished') {
        const anyOnline = room.players.some((p) => p.online);
        if (!anyOnline && t - room.updatedAt > FINISHED_EMPTY_MS) {
          closeRoom(room, 'finished');
        }
      }
      // 断线超时
      for (const p of room.players) {
        if (!p.online && p.disconnectedAt && t - p.disconnectedAt > DISCONNECT_GRACE_MS * 2) {
          if (room.status === 'waiting') {
            room.players = room.players.filter((x) => Number(x.userId) !== Number(p.userId));
            userRoom.delete(Number(p.userId));
            if (Number(room.hostUserId) === Number(p.userId)) transferHost(room);
            if (room.players.length === 0) closeRoom(room, 'empty');
            else {
              touch(room);
              broadcastRoom(room, 'tower:player-update');
              broadcastInviteUpdate(room, 'timeout');
            }
          }
        }
      }
      if (room.status === 'countdown' && room.countdownAt && t - room.countdownAt > COUNTDOWN_MS + 2000 && room.status === 'countdown') {
        beginPlaying(room);
      }
    }
    const cutoff = t - CMD_CACHE_MS;
    for (const [k, at] of cmdCache) if (at < cutoff) cmdCache.delete(k);
    if (rate.size > 4000) {
      for (const [k, arr] of rate) {
        if (!arr.length || t - arr[arr.length - 1] > 60_000) rate.delete(k);
      }
    }
  }, 2000);
  timer.unref?.();

  return {
    getRoom: (id) => rooms.get(String(id)) || null,
    getRoomForUser: (userId) => userActiveRoom(userId),
    listRooms: () => [...rooms.values()],
    activeRoomSnapshotForUser,
  };
}

export { roomSnapshot as towerRoomSnapshot, compactInviteExt as towerInviteExt };
