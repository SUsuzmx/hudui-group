// 一起听（Listen Together）服务器权威房间
// 事件命名遵循项目冒号风格；状态写 SQLite，在线连接在内存。
// 不保存播放地址 / Cookie / 票据；曲目仅保留稳定取流字段。
import { randomUUID } from 'node:crypto';
import { canAccessConversation } from './acl.js';
import { getGroup, listGroupMembers } from './groups.js';
import { stmts, db } from './db.js';

const ALLOWED_SOURCES = new Set(['netease', 'qq', 'kugou']);
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const HOST_OFFLINE_TRANSFER_MS = 45_000;
/** 最后一人离线后宽限，便于刷新/弱网回来 */
const EMPTY_GRACE_MS = 10_000;
const MAX_QUEUE = 80;
const REACT_COOLDOWN_MS = 400;
const CONTROL_COOLDOWN_MS = 180;
const QUEUE_ADD_COOLDOWN_MS = 800;
const CMD_CACHE_MS = 60_000;

/** @type {Map<string, object>} */
const rooms = new Map();
const convRooms = new Map();
const rate = new Map();
/** commandId -> at */
const cmdCache = new Map();

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

function isAiConversation(conversationId) {
  return /_ai_/.test(String(conversationId || '')) || String(conversationId || '').includes('_ai_');
}

/** 只接受合法音源曲目元数据，剥离任何 URL / Cookie */
export function sanitizeTrack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const source = String(raw.source || '').toLowerCase();
  if (!ALLOWED_SOURCES.has(source)) return null;
  const id = String(raw.id ?? raw.hash ?? '').slice(0, 80);
  if (!id) return null;
  const title = String(raw.title || raw.name || '').slice(0, 80);
  const artist = String(raw.artist || raw.author || '').slice(0, 80);
  const coverRaw = String(raw.cover || raw.picUrl || raw.albumpic || '').slice(0, 300);
  const coverOk = !coverRaw || /^https?:\/\//i.test(coverRaw) || coverRaw.startsWith('/');
  return {
    id,
    source,
    title: title || '未知歌曲',
    artist: artist || '未知歌手',
    cover: coverOk ? coverRaw : '',
    duration: Math.max(0, Math.min(3600, Number(raw.duration) || 0)),
    durationMs: Math.max(0, Math.min(3600_000, Number(raw.durationMs) || Number(raw.duration) * 1000 || 0)),
    mid: String(raw.mid || '').slice(0, 80),
    mediaMid: String(raw.mediaMid || '').slice(0, 80),
    hash: String(raw.hash || raw.fileHash || '').slice(0, 80),
    albumId: String(raw.albumId || raw.album_id || '').slice(0, 80),
    albumAudioId: String(raw.albumAudioId || raw.album_audio_id || '').slice(0, 80),
    mixSongId: String(raw.mixSongId || '').slice(0, 80),
    privilege: raw.privilege && typeof raw.privilege === 'object' ? raw.privilege : undefined,
    hqHash: String(raw.hqHash || '').slice(0, 80),
    sqHash: String(raw.sqHash || '').slice(0, 80),
    resHash: String(raw.resHash || '').slice(0, 80),
  };
}

function trackKey(t) {
  return t ? `${t.source}:${t.id}` : '';
}

function canJoinConversation(userId, conversationId) {
  const conv = conversationId == null || conversationId === '' ? 'default' : String(conversationId);
  if (isAiConversation(conv)) return false;
  if (!canAccessConversation(userId, conv, getGroup)) return false;
  if (conv.startsWith('grp_')) {
    const g = getGroup(Number(conv.slice(4)));
    if (!g) return false;
    if (g.isDefault) return true;
    const members = listGroupMembers(g.id) || [];
    return members.some((m) => Number(m.userId) === Number(userId));
  }
  return true;
}

function positionMs(room) {
  if (room.playbackState !== 'playing') return room.positionMs;
  return room.positionMs + (now() - room.anchorAt);
}

function touch(room) {
  room.updatedAt = now();
  room.revision = (room.revision || 1) + 1;
  room.expiresAt = now() + ROOM_TTL_MS;
  persist(room);
}

function persist(room) {
  try {
    stmts.upsertListenRoom?.run?.(
      room.id,
      room.conversationId,
      room.hostId,
      room.playbackState,
      room.positionMs,
      room.anchorAt,
      JSON.stringify(room.current || {}),
      JSON.stringify(room.queue || []),
      room.allowAllControl ? 'all' : 'host',
      room.revision,
      room.inviteMessageId ?? null,
      room.createdAt,
      room.updatedAt,
      room.expiresAt,
      room.endedAt ?? null
    );
  } catch {
    // 若 stmts 未注册则用裸 SQL
    try {
      db.prepare(`
        INSERT INTO listen_rooms (
          id, conversation_id, host_user_id, playback_state, position_ms, anchor_at,
          track_json, queue_json, control_mode, revision, invite_message_id,
          created_at, updated_at, expires_at, ended_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          conversation_id=excluded.conversation_id,
          host_user_id=excluded.host_user_id,
          playback_state=excluded.playback_state,
          position_ms=excluded.position_ms,
          anchor_at=excluded.anchor_at,
          track_json=excluded.track_json,
          queue_json=excluded.queue_json,
          control_mode=excluded.control_mode,
          revision=excluded.revision,
          invite_message_id=excluded.invite_message_id,
          updated_at=excluded.updated_at,
          expires_at=excluded.expires_at,
          ended_at=excluded.ended_at
      `).run(
        room.id, room.conversationId, room.hostId, room.playbackState, room.positionMs, room.anchorAt,
        JSON.stringify(room.current || {}), JSON.stringify(room.queue || []),
        room.allowAllControl ? 'all' : 'host', room.revision, room.inviteMessageId ?? null,
        room.createdAt, room.updatedAt, room.expiresAt, room.endedAt ?? null
      );
    } catch { /* ignore */ }
  }
}

function findMember(room, userId) {
  const uid = Number(userId);
  return room.members.find((m) => Number(m.userId) === uid);
}

function memberSnapshot(room, userId) {
  return {
    sessionId: room.id,
    id: room.id,
    conversationId: room.conversationId,
    hostUserId: room.hostId,
    hostId: room.hostId,
    allowAllControl: room.allowAllControl,
    controlMode: room.allowAllControl ? 'all' : 'host',
    status: room.status,
    playbackState: room.playbackState,
    playing: room.playbackState === 'playing',
    positionMs: Math.floor(positionMs(room)),
    anchorAt: room.anchorAt,
    updatedAt: room.updatedAt,
    revision: room.revision,
    current: room.current,
    queue: room.queue,
    members: room.members.map((m) => ({
      userId: m.userId,
      nickname: m.nickname,
      avatar: m.avatar ?? null,
      avatarColor: m.avatarColor || '#4f6ef7',
      online: m.online,
      joinedAt: m.joinedAt,
      isHost: m.userId === room.hostId,
    })),
    inviteMessageId: room.inviteMessageId ?? null,
    viewerId: userId ?? null,
    canControl: room.allowAllControl || room.hostId === Number(userId),
    serverNow: now(),
    serverTime: now(),
  };
}

function transferHost(room, { force = false } = {}) {
  const host = findMember(room, room.hostId);
  if (host?.online && !force) return false;
  if (host?.online && force) {
    host.online = false;
    host.lastSeen = now();
  }
  const next = room.members
    .filter((m) => m.online && m.userId !== room.hostId)
    .sort((a, b) => a.joinedAt - b.joinedAt)[0];
  if (!next) return false;
  room.hostId = next.userId;
  touch(room);
  return true;
}

function markEnded(room, reason, io) {
  room.status = 'ended';
  room.endedAt = now();
  room.playbackState = 'paused';
  touch(room);
  try {
    if (room.inviteMessageId) {
      stmts.updateMessageExt.run(
        JSON.stringify({
          kind: 'listen',
          sessionId: room.id,
          title: room.current?.title || '',
          artist: room.current?.artist || '',
          cover: room.current?.cover || '',
          status: 'ended',
        }),
        room.inviteMessageId
      );
    }
  } catch { /* ignore */ }
  if (io) {
    io.to(`listen_${room.id}`).emit('listen:ended', {
      sessionId: room.id,
      roomId: room.id,
      conversationId: room.conversationId,
      reason,
    });
    io.to(room.conversationId === 'default' ? 'group' : room.conversationId).emit('listen:card-update', {
      messageId: room.inviteMessageId,
      sessionId: room.id,
      status: 'ended',
    });
    io.to(room.conversationId === 'default' ? 'group' : room.conversationId).emit('listen:room-update', {
      roomId: room.id,
      conversationId: room.conversationId,
      status: 'ended',
      playing: false,
      memberCount: 0,
    });
  }
  convRooms.delete(room.conversationId);
  setTimeout(() => {
    if (rooms.get(room.id) === room) rooms.delete(room.id);
  }, 30_000);
}

function anyOnline(room) {
  return room.members.some((m) => m.online);
}

export function initListenTogether(io) {
  // 启动时结束遗留活动房间，避免错误恢复播放
  try {
    db.prepare("UPDATE listen_rooms SET ended_at = ?, playback_state = 'paused' WHERE ended_at IS NULL").run(now());
  } catch { /* ignore */ }

  function broadcast(room, extra = {}) {
    const snap = { ...memberSnapshot(room), ...extra };
    io.to(`listen_${room.id}`).emit('listen:state', snap);
    io.to(room.conversationId === 'default' ? 'group' : room.conversationId).emit('listen:room-update', {
      roomId: room.id,
      sessionId: room.id,
      conversationId: room.conversationId,
      status: room.status,
      playing: room.playbackState === 'playing',
      memberCount: room.members.filter((m) => m.online).length,
      hostId: room.hostId,
      title: room.current?.title || '',
      revision: room.revision,
    });
    if (room.inviteMessageId != null) {
      io.to(room.conversationId === 'default' ? 'group' : room.conversationId).emit('listen:card-update', {
        messageId: room.inviteMessageId,
        sessionId: room.id,
        status: room.status,
        memberCount: room.members.filter((m) => m.online).length,
      });
    }
    io.to(`listen_${room.id}`).emit('listen:presence', {
      sessionId: room.id,
      members: memberSnapshot(room).members,
      revision: room.revision,
    });
  }

  function markOnline(user, online) {
    for (const room of rooms.values()) {
      const hits = room.members.filter((m) => m.userId === user.id);
      if (!hits.length) continue;
      // 多连接只记一次在线
      for (const m of hits) {
        m.online = online;
        if (online) m.lastSeen = now();
      }
      if (online) {
        // keep
      } else if (!anyOnline(room)) {
        // 宽限后再结束
        room.emptySince = room.emptySince || now();
      } else {
        room.emptySince = null;
        if (room.hostId === user.id) {
          if (now() - (findMember(room, user.id)?.lastSeen || now()) > HOST_OFFLINE_TRANSFER_MS || !online) {
            // 意外断线：等待超时才转交（由定时器处理）
          }
        }
        transferHost(room, { force: false });
        broadcast(room);
      }
    }
  }

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (!user) return;
    markOnline(user, true);

    const err = (ack, code, message, extra = {}) => {
      const payload = { error: message, code, ...extra };
      if (typeof ack === 'function') ack(payload);
      socket.emit('listen:error', payload);
    };

    socket.on('listen:rooms', (ack) => {
      const list = [...rooms.values()]
        .filter((r) => r.status === 'active' && findMember(r, user.id))
        .map((r) => memberSnapshot(r, user.id));
      ack?.({ ok: true, rooms: list, serverNow: now() });
    });

    socket.on('listen:create', (payload = {}, ack) => {
      try {
        const rawConv = payload.conversationId;
        const conversationId = (!rawConv || rawConv === 'default') ? 'default' : String(rawConv);
        if (isAiConversation(conversationId)) return err(ack, 'ai_private', '这场只邀请了会话里的朋友。');
        if (!canJoinConversation(user.id, conversationId)) return err(ack, 'forbidden', '这场只邀请了会话里的朋友。');
        const existingId = convRooms.get(conversationId);
        if (existingId) {
          const existing = rooms.get(existingId);
          if (existing && existing.status === 'active') {
            return ack?.({
              ok: true,
              exists: true,
              error: '大家已经开听啦，直接进去吧。',
              roomId: existing.id,
              sessionId: existing.id,
              room: memberSnapshot(existing, user.id),
              serverNow: now(),
            });
          }
        }
        const track = sanitizeTrack(payload.track);
        if (!track) return err(ack, 'bad_track', '这首歌暂时放不出来，换一首试试。');
        const t = now();
        // 点歌开房即播：带初始曲目时默认进入播放，避免「再点一首才响」
        const startPlaying = payload.autoplay !== false;
        const room = {
          id: randomUUID().slice(0, 8),
          conversationId,
          hostId: user.id,
          members: [{
            userId: user.id,
            nickname: user.nickname,
            avatar: user.avatar ?? null,
            avatarColor: user.avatarColor || '#4f6ef7',
            online: true,
            joinedAt: t,
            lastSeen: t,
          }],
          current: track,
          queue: [],
          playbackState: startPlaying ? 'playing' : 'paused',
          positionMs: 0,
          anchorAt: t,
          updatedAt: t,
          createdAt: t,
          expiresAt: t + ROOM_TTL_MS,
          allowAllControl: false,
          status: 'active',
          inviteMessageId: payload.inviteMessageId ?? null,
          revision: 1,
          emptySince: null,
        };
        rooms.set(room.id, room);
        convRooms.set(conversationId, room.id);
        persist(room);
        socket.join(`listen_${room.id}`);
        socket.join(conversationId === 'default' ? 'group' : conversationId);
        broadcast(room);
        io.to(conversationId === 'default' ? 'group' : conversationId).emit('listen:invited', {
          sessionId: room.id,
          conversationId,
          title: track.title,
          artist: track.artist,
          cover: track.cover,
          hostName: user.nickname,
        });
        ack?.({ ok: true, room: memberSnapshot(room, user.id), serverNow: now() });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('listen:join', (payload = {}, ack) => {
      try {
        let sessionId = String(payload.sessionId || payload.roomId || '');
        let room = sessionId ? rooms.get(sessionId) : null;
        // 兜底：按邀请消息或当前会话找回房间
        if (!room || room.status === 'ended') {
          const invId = Number(payload.inviteMessageId || 0);
          for (const r of rooms.values()) {
            if (r.status !== 'active') continue;
            if (invId && Number(r.inviteMessageId) === invId) {
              room = r;
              break;
            }
          }
        }
        if (!room || room.status === 'ended') {
          return err(ack, 'ended', '大家已经散场啦，下次再一起听。', { status: 'ended' });
        }
        if (isAiConversation(room.conversationId)) return err(ack, 'forbidden', '这场只邀请了会话里的朋友。');
        if (!canJoinConversation(user.id, room.conversationId)) return err(ack, 'forbidden', '这场只邀请了会话里的朋友。');
        let m = findMember(room, user.id);
        if (!m) {
          if (room.members.filter((x) => x.online).length >= 50) return err(ack, 'full', '房间人有点多啦');
          m = {
            userId: user.id,
            nickname: user.nickname,
            avatar: user.avatar ?? null,
            avatarColor: user.avatarColor || '#4f6ef7',
            online: true,
            joinedAt: now(),
            lastSeen: now(),
          };
          room.members.push(m);
        } else {
          m.online = true;
          m.lastSeen = now();
        }
        room.emptySince = null;
        if (payload.inviteMessageId != null && room.inviteMessageId == null) {
          room.inviteMessageId = Number(payload.inviteMessageId);
        }
        socket.join(`listen_${room.id}`);
        socket.join(room.conversationId === 'default' ? 'group' : room.conversationId);
        // 命令缓存按 room 清理过期
        const cutoff = now() - CMD_CACHE_MS;
        for (const [k, at] of cmdCache) if (at < cutoff) cmdCache.delete(k);
        touch(room);
        transferHost(room, { force: false });
        broadcast(room);
        ack?.({ ok: true, room: memberSnapshot(room, user.id), serverNow: now() });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('listen:leave', (payload = {}, ack) => {
      try {
        const room = rooms.get(String(payload.sessionId || payload.roomId || ''));
        if (!room) return ack?.({ ok: true });
        const uid = Number(user.id);
        for (const mem of room.members) {
          if (Number(mem.userId) === uid) {
            mem.online = false;
            mem.lastSeen = now();
          }
        }
        socket.leave(`listen_${room.id}`);
        // 明确退出：主持立即转交
        const hostLeft = Number(room.hostId) === uid;
        if (hostLeft) transferHost(room, { force: true });
        else transferHost(room, { force: false });
        const onlineCount = room.members.filter((x) => x.online).length;
        if (onlineCount === 0) {
          // 明确退出且已空房：立即结束（意外断线才走宽限）
          markEnded(room, 'empty', io);
        }
        broadcast(room);
        ack?.({ ok: true });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('listen:end', (payload = {}, ack) => {
      try {
        const room = rooms.get(String(payload.sessionId || payload.roomId || ''));
        if (!room) return ack?.({ ok: true });
        if (room.hostId !== user.id && !room.allowAllControl) {
          return err(ack, 'forbidden', '现在由主持人控制播放。');
        }
        markEnded(room, 'host_end', io);
        ack?.({ ok: true });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('listen:sync', (payload = {}, ack) => {
      const room = rooms.get(String(payload.sessionId || payload.roomId || ''));
      if (!room || room.status === 'ended') return err(ack, 'ended', '这个小房间已经散场了。');
      if (!findMember(room, user.id) && !canJoinConversation(user.id, room.conversationId)) {
        return err(ack, 'forbidden', '这场只邀请了会话里的朋友。');
      }
      ack?.({ ok: true, room: memberSnapshot(room, user.id), serverNow: now() });
    });

    function requireMember(payload, needControl) {
      const room = rooms.get(String(payload.sessionId || payload.roomId || ''));
      if (!room || room.status === 'ended') return { error: '大家已经散场啦，下次再一起听。', code: 'ended' };
      const m = findMember(room, user.id);
      if (!m) return { error: '这场只邀请了会话里的朋友。', code: 'forbidden' };
      m.lastSeen = now();
      if (needControl && !(room.allowAllControl || room.hostId === user.id)) {
        return { error: '现在由主持人控制播放。', code: 'forbidden', room };
      }
      return { room, member: m };
    }

    function applyCommand(room, payload) {
      const action = String(payload.action || '');
      const pos = Number(payload.positionMs);
      if (action === 'play') {
        room.playbackState = 'playing';
        room.anchorAt = now();
        if (Number.isFinite(pos) && pos >= 0) room.positionMs = Math.floor(pos);
      } else if (action === 'pause') {
        room.positionMs = Math.floor(positionMs(room));
        room.playbackState = 'paused';
        room.anchorAt = now();
      } else if (action === 'seek') {
        if (!Number.isFinite(pos) || pos < 0 || pos > 3600_000) return '进度不合法';
        room.positionMs = Math.floor(pos);
        room.anchorAt = now();
      } else if (action === 'next') {
        const next = room.queue.shift();
        if (next) {
          room.current = next;
          room.positionMs = 0;
          room.playbackState = 'playing';
          room.anchorAt = now();
        } else {
          room.playbackState = 'paused';
          room.positionMs = 0;
        }
      } else if (action === 'previous') {
        room.positionMs = 0;
        room.anchorAt = now();
      } else if (action === 'set-track') {
        const t = sanitizeTrack(payload.track);
        if (!t) return '这首歌暂时放不出来，换一首试试。';
        room.current = t;
        room.positionMs = 0;
        room.playbackState = 'playing';
        room.anchorAt = now();
      } else {
        return '未知操作';
      }
      touch(room);
      return null;
    }

    // 新命令接口
    function handleCommand(payload, ack) {
      try {
        const commandId = String(payload.commandId || '');
        if (commandId) {
          if (cmdCache.has(commandId)) {
            const room = rooms.get(String(payload.sessionId || payload.roomId || ''));
            return ack?.({ ok: true, duplicate: true, room: room ? memberSnapshot(room, user.id) : null, serverNow: now() });
          }
        }
        const needControl = ['play', 'pause', 'seek', 'next', 'previous', 'set-track'].includes(String(payload.action || ''));
        if (!rateOk(`ctl:${user.id}`, 12, CONTROL_COOLDOWN_MS * 12)) return err(ack, 'rate', '操作太频繁');
        const r = requireMember(payload, needControl);
        if (r.error) return err(ack, r.code || 'forbidden', r.error);
        const { room } = r;
        if (!rateOk(`ctl2:${user.id}:${room.id}`, 8, 1000)) return err(ack, 'rate', '操作太频繁');
        const baseRevision = Number(payload.baseRevision);
        if (Number.isFinite(baseRevision) && baseRevision < room.revision - 8) {
          return ack?.({ ok: false, stale: true, room: memberSnapshot(room, user.id), serverNow: now(), error: '刚刚没跟上大家，再试一次吧。' });
        }
        const e = applyCommand(room, payload);
        if (e) return err(ack, 'bad_command', e);
        if (commandId) cmdCache.set(commandId, now());
        broadcast(room);
        ack?.({ ok: true, room: memberSnapshot(room, user.id), serverNow: now() });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    }

    socket.on('listen:command', handleCommand);

    // 兼容旧控制接口（映射到 command）
    socket.on('listen:control', (payload = {}, ack) => {
      const map = { toggle: 'play', prev: 'previous', 'skip-failed': 'next' };
      const action = map[String(payload.action || '')] || String(payload.action || '');
      handleCommand({ ...payload, action, commandId: payload.commandId || randomUUID() }, ack);
    });

    function queueOp(payload, ack, op) {
      try {
        const r = requireMember(payload, false);
        if (r.error) return err(ack, r.code || 'forbidden', r.error);
        const { room } = r;
        const needControl = ['remove', 'move', 'clear', 'play-index'].includes(op);
        if (needControl && !(room.allowAllControl || room.hostId === user.id)) {
          return err(ack, 'forbidden', '现在由主持人控制播放。');
        }
        if (op === 'add') {
          if (!rateOk(`qa:${user.id}`, 3, QUEUE_ADD_COOLDOWN_MS * 3)) return err(ack, 'rate', '操作太频繁');
          const track = sanitizeTrack(payload.track);
          if (!track) return err(ack, 'bad_track', '这首歌暂时放不出来，换一首试试。');
          const key = trackKey(track);
          if (trackKey(room.current) === key || room.queue.some((t) => trackKey(t) === key)) {
            return err(ack, 'dup', '这首歌已经在队列里了。');
          }
          if (room.queue.length >= MAX_QUEUE) return err(ack, 'full', '队列有点满啦');
          room.queue.push(track);
          touch(room);
        } else if (op === 'remove') {
          const key = String(payload.key || trackKey(payload.track) || '');
          const idx = room.queue.findIndex((t) => trackKey(t) === key);
          if (idx < 0) return err(ack, 'not_found', '歌曲不在队列');
          room.queue.splice(idx, 1);
          touch(room);
        } else if (op === 'move') {
          const from = Number(payload.from);
          const to = Number(payload.to);
          if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= room.queue.length || to >= room.queue.length) {
            return err(ack, 'bad_move', '队列顺序不合法');
          }
          const [item] = room.queue.splice(from, 1);
          room.queue.splice(to, 0, item);
          touch(room);
        } else if (op === 'play-index') {
          const idx = Number(payload.index);
          if (!Number.isInteger(idx) || idx < 0 || idx >= room.queue.length) return err(ack, 'not_found', '歌曲不在队列');
          const [item] = room.queue.splice(idx, 1);
          if (room.current) room.queue.unshift(room.current);
          room.current = item;
          room.positionMs = 0;
          room.playbackState = 'playing';
          room.anchorAt = now();
          touch(room);
        } else {
          return err(ack, 'bad_op', '未知操作');
        }
        broadcast(room);
        ack?.({ ok: true, room: memberSnapshot(room, user.id), serverNow: now() });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    }

    socket.on('listen:queue-add', (p = {}, ack) => queueOp(p, ack, 'add'));
    socket.on('listen:queue-remove', (p = {}, ack) => queueOp(p, ack, 'remove'));
    socket.on('listen:queue-move', (p = {}, ack) => queueOp(p, ack, 'move'));
    socket.on('listen:queue', (p = {}, ack) => queueOp(p, ack, String(p.action || 'add')));

    socket.on('listen:control-mode', (payload = {}, ack) => {
      try {
        const r = requireMember(payload, false);
        if (r.error) return err(ack, r.code || 'forbidden', r.error);
        const { room } = r;
        if (room.hostId !== user.id) return err(ack, 'forbidden', '现在由主持人控制播放。');
        room.allowAllControl = String(payload.mode || (payload.allowAllControl ? 'all' : 'host')) === 'all' || payload.allowAllControl === true;
        touch(room);
        broadcast(room);
        ack?.({ ok: true, room: memberSnapshot(room, user.id), serverNow: now() });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('listen:settings', (payload = {}, ack) => {
      const room = rooms.get(String(payload.sessionId || payload.roomId || ''));
      if (!room || room.status === 'ended') return err(ack, 'ended', '大家已经散场啦，下次再一起听。');
      if (room.hostId !== user.id) return err(ack, 'forbidden', '现在由主持人控制播放。');
      room.allowAllControl = String(payload.mode || (payload.allowAllControl ? 'all' : 'host')) === 'all' || payload.allowAllControl === true;
      touch(room);
      broadcast(room);
      ack?.({ ok: true, room: memberSnapshot(room, user.id), serverNow: now() });
    });

    socket.on('listen:reaction', (payload = {}, ack) => {
      try {
        const room = rooms.get(String(payload.sessionId || payload.roomId || ''));
        if (!room || room.status === 'ended') return err(ack, 'ended', '大家已经散场啦，下次再一起听。');
        if (!findMember(room, user.id)) return err(ack, 'forbidden', '这场只邀请了会话里的朋友。');
        if (!rateOk(`react:${user.id}:${room.id}`, 6, REACT_COOLDOWN_MS * 6)) return err(ack, 'rate', '操作太频繁');
        const emoji = String(payload.emoji || '').slice(0, 8);
        if (!emoji) return err(ack, 'bad_emoji', '表情不能为空');
        io.to(`listen_${room.id}`).emit('listen:reaction', {
          sessionId: room.id,
          roomId: room.id,
          userId: user.id,
          nickname: user.nickname,
          emoji,
          at: now(),
        });
        ack?.({ ok: true });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('listen:react', (payload, ack) => {
      // 兼容旧名
      const room = rooms.get(String(payload?.sessionId || payload?.roomId || ''));
      if (!room || room.status === 'ended') return err(ack, 'ended', '大家已经散场啦，下次再一起听。');
      if (!findMember(room, user.id)) return err(ack, 'forbidden', '这场只邀请了会话里的朋友。');
      if (!rateOk(`react:${user.id}:${room.id}`, 6, REACT_COOLDOWN_MS * 6)) return err(ack, 'rate', '操作太频繁');
      const emoji = String(payload?.emoji || '').slice(0, 8);
      if (!emoji) return err(ack, 'bad_emoji', '表情不能为空');
      io.to(`listen_${room.id}`).emit('listen:reaction', {
        sessionId: room.id, roomId: room.id, userId: user.id, nickname: user.nickname, emoji, at: now(),
      });
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      markOnline(user, false);
    });
  });

  // 定时：宽限结束、主持超时转交、过期清理
  const timer = setInterval(() => {
    const t = now();
    for (const room of [...rooms.values()]) {
      // 主持意外离线超时转交
      const host = findMember(room, room.hostId);
      if (!host?.online && anyOnline(room)) {
        if (t - (host?.lastSeen || room.updatedAt) > HOST_OFFLINE_TRANSFER_MS) {
          if (transferHost(room, { force: false })) broadcast(room);
        }
      }
      // 空房宽限后结束
      if (!anyOnline(room)) {
        if (!room.emptySince) room.emptySince = t;
        if (t - room.emptySince >= EMPTY_GRACE_MS) {
          markEnded(room, 'empty', io);
        }
      } else {
        room.emptySince = null;
      }
      if (room.status === 'active' && t > room.expiresAt) {
        markEnded(room, 'expire', io);
      }
    }
    // 清理命令缓存
    const cutoff = t - CMD_CACHE_MS;
    for (const [k, at] of cmdCache) if (at < cutoff) cmdCache.delete(k);
  }, 10_000);
  timer.unref?.();

  return {
    getRoom: (id) => rooms.get(String(id)) || null,
    listActiveRooms: () => [...rooms.values()].filter((r) => r.status === 'active'),
    getRoomForConversation: (conv) => {
      const id = convRooms.get(conv);
      return id ? rooms.get(id) : null;
    },
  };
}

export { positionMs as listenPositionMs, memberSnapshot as listenMemberSnapshot };
