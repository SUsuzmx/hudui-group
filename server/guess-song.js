// 猜歌抢答：服务端权威房间 / 同步片段 / 抢答计分 / 邀请卡
// 房间状态在内存；邀请与个人统计写 SQLite。服务重启后进行中比赛结束。
import { randomBytes, randomUUID } from 'node:crypto';
import { canAccessConversation, canAccessPrivate } from './acl.js';
import { getGroup, listGroupMembers, groupConvId, DEFAULT_GROUP_KIND } from './groups.js';
import { isBlockedEither } from './friends.js';
import { stmts } from './db.js';
import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  DEFAULT_SONG_COUNT,
  ROUND_MAX_MS,
  PREPARE_MS,
  ANSWER_MS,
  ARTIST_MS,
  HINT_AT_MS,
  MAIN_SCORE,
  MAIN_WRONG_PENALTY,
  ARTIST_SCORE,
  ARTIST_WRONG_PENALTY,
  keepTrackFields,
  trackKey,
  buildOptions,
  buildArtistOptions,
  publicOptions,
  pickClipWindow,
  initialPlayer,
  resetPlayerForRound,
  rankPlayers,
  validSongCount,
  titlesTooSimilar,
  isSameRecordingVariant,
  isPlaceholderTrack,
  REAL_SONG_TITLES,
  REAL_ARTIST_NAMES,
  normalizeTitle,
} from '../client/src/guess-song-engine.js';
import {
  localTracksForArtist,
  allLocalMusicTracks,
} from './local-music.js';

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DISCONNECT_GRACE_MS = 20_000;
const WAITING_IDLE_MS = 15 * 60 * 1000;
const FINISHED_EMPTY_MS = 3 * 60 * 1000;
const CMD_CACHE_MS = 90_000;
const LOAD_TIMEOUT_MS = 12_000;
const BUZZ_COOLDOWN_MS = 400;

/** @type {Map<string, object>} */
const rooms = new Map();
/** userId -> roomId */
const userRoom = new Map();
/** inviteId -> roomId */
const inviteIndex = new Map();
const cmdCache = new Map();
const rate = new Map();

/** 猜歌用曲库缓存（服务进程内） */
let songPoolCache = { at: 0, tracks: [] };

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

function onlinePlayers(room) {
  return activePlayers(room).filter((p) => p.online);
}

function touch(room) {
  room.updatedAt = now();
  room.version = (room.version || 1) + 1;
}

function clearRoomTimers(room) {
  for (const key of ['prepTimer', 'playTimer', 'answerTimer', 'artistTimer', 'loadTimer', 'roundTimer']) {
    if (room[key]) {
      clearTimeout(room[key]);
      room[key] = null;
    }
  }
}

function compactInviteExt(invite) {
  const room = rooms.get(invite.roomId);
  const status = room ? room.status : 'closed';
  const playerCount = room ? activePlayers(room).length : 0;
  const songCount = room ? room.songCount : DEFAULT_SONG_COUNT;
  const theme = String(room?.themeLabel || '曲库小王子').slice(0, 16);
  const ext = {
    kind: 'guess_invite',
    inviteId: String(invite.id).slice(0, 40),
    game: 'guess',
    inviterName: String(invite.inviterName || '').slice(0, 32),
    status: ['waiting', 'full', 'countdown', 'playing', 'finished', 'closed'].includes(status)
      ? status
      : 'closed',
    playerCount,
    maxPlayers: MAX_PLAYERS,
    songCount,
    theme,
    createdAt: invite.createdAt,
  };
  let json = JSON.stringify(ext);
  if (json.length > 780) {
    delete ext.createdAt;
    json = JSON.stringify(ext);
  }
  if (json.length > 780) {
    return {
      kind: 'guess_invite',
      inviteId: ext.inviteId,
      game: 'guess',
      inviterName: ext.inviterName.slice(0, 16),
      status: ext.status,
      playerCount: ext.playerCount,
      maxPlayers: MAX_PLAYERS,
      songCount,
      theme,
    };
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

let ioRef = null;

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
  }
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
            guessInviteUpdate: true,
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
    ioRef?.to(`guess_${room.id}`).emit('guess:invite:update', {
      inviteId: inv.id,
      status: compactInviteExt(inv).status,
      playerCount: activePlayers(room).length,
      reason,
    });
  }
}

/** 房间公开快照：绝不下发正确答案 / 完整选项给非作答者 */
function roomSnapshot(room, forUserId = null) {
  const me = forUserId != null ? findPlayer(room, forUserId) : null;
  const round = room.round;
  const forMe = me && Number(me.userId) === Number(forUserId);
  let roundPublic = null;
  if (round) {
    const isAnswerer = forMe && room.answererUserId != null && Number(room.answererUserId) === Number(forUserId);
    roundPublic = {
      index: round.index,
      total: room.songCount,
      phase: room.roundPhase,
      clipStartMs: round.clipStartMs,
      clipDurationMs: round.clipDurationMs,
      startAt: room.audioStartAt || 0,
      prepareAt: room.prepareAt || 0,
      phaseDeadline: room.phaseDeadline || 0,
      loadedCount: round.loadedOk?.size || 0,
      expectedLoad: Math.max(1, onlinePlayers(room).length),
      // 匿名音频定位（不暴露曲名）
      trackRef: {
        source: round.track.source,
        id: round.track.id,
        mid: round.track.mid,
        mediaMid: round.track.mediaMid,
        hash: round.track.hash,
        albumId: round.track.albumId,
        albumAudioId: round.track.albumAudioId,
        mixSongId: round.track.mixSongId,
        duration: round.track.duration,
        durationMs: round.track.durationMs,
        privilege: round.track.privilege,
        hqHash: round.track.hqHash,
        sqHash: round.track.sqHash,
        resHash: round.track.resHash,
      },
      // 揭晓后才带 title/artist/cover
      revealed: room.revealed ? {
        title: round.track.title,
        artist: round.track.artist,
        cover: round.track.cover,
        source: round.track.source,
        id: round.track.id,
      } : null,
      buzzUserId: room.buzzUserId,
      buzzName: room.buzzUserId != null ? (findPlayer(room, room.buzzUserId)?.nickname || '') : '',
      answererUserId: room.answererUserId,
      answerDeadline: room.answerDeadline || 0,
      artistDeadline: room.artistDeadline || 0,
      hintLevel: room.hintLevel || 0,
      lastResult: room.lastResult || null,
      myOptions: isAnswerer && room.mainOptions ? publicOptions(room.mainOptions) : null,
      myArtistOptions: (room.artistPhase && room.artistOptions) ? publicOptions(room.artistOptions) : null,
      canBuzz: canPlayerBuzz(room, forUserId),
      mainScore: MAIN_SCORE,
      mainWrongPenalty: MAIN_WRONG_PENALTY,
      artistScore: ARTIST_SCORE,
      artistWrongPenalty: ARTIST_WRONG_PENALTY,
    };
  }
  return {
    id: room.id,
    status: room.status,
    hostUserId: room.hostUserId,
    songCount: room.songCount,
    theme: room.theme || 'random',
    themeLabel: room.themeLabel || '曲库小王子',
    players: room.players.map((p) => ({
      userId: p.userId,
      nickname: p.nickname,
      avatar: p.avatar,
      avatarColor: p.avatarColor,
      score: p.score,
      ready: p.ready,
      online: p.online,
      mainWrong: p.mainWrong,
      answeredMain: p.answeredMain,
      answeredArtist: p.answeredArtist,
      isHost: Number(p.userId) === Number(room.hostUserId),
      isMe: forUserId != null && Number(p.userId) === Number(forUserId),
    })),
    ranking: rankPlayers(activePlayers(room).map((p) => ({
      userId: p.userId,
      nickname: p.nickname,
      avatar: p.avatar,
      avatarColor: p.avatarColor,
      score: p.score,
    }))),
    playerCount: activePlayers(room).length,
    maxPlayers: MAX_PLAYERS,
    round: roundPublic,
    version: room.version,
    serverTime: now(),
    inviteIds: room.invites.map((i) => i.id),
  };
}

function canPlayerBuzz(room, userId) {
  if (room.status !== 'playing' || !room.round) return false;
  if (room.roundPhase !== 'playing') return false;
  if (!room.audioStartAt) return false;
  // 音频未确认可播前不允许抢答
  if (!room.round.loadedOk || room.round.loadedOk.size === 0) return false;
  if (room.buzzUserId != null || room.answererUserId != null) return false;
  const p = userId != null ? findPlayer(room, userId) : null;
  if (!p || p.mainWrong || p.retired || !p.online) return false;
  return true;
}

function broadcastRoom(room, event = 'guess:room', extra = {}) {
  if (!room) return;
  // 房间频道只发公共事件体（不含个人选项 / 正确答案）
  ioRef?.to(`guess_${room.id}`).emit(event, {
    room: null,
    ...extra,
    serverTime: now(),
  });
  // 个人视角快照只发给对应用户，避免选项泄露
  for (const p of room.players) {
    const payload = { room: roomSnapshot(room, p.userId), ...extra, serverTime: now() };
    ioRef?.to(`user_${p.userId}`).emit(event, payload);
  }
}

function markInviteStatus(room, status, ended = false) {
  const t = now();
  try {
    stmts.setGuessInvitesStatusByRoom.run(status, t, ended ? t : null, room.id, status);
  } catch {
    /* ignore */
  }
  for (const inv of room.invites) {
    if (inv.status !== status) {
      inv.status = status;
      inv.updatedAt = t;
      if (ended) inv.endedAt = t;
      try {
        stmts.setGuessInviteStatus.run(status, t, ended ? t : null, inv.id);
      } catch {
        /* ignore */
      }
    }
  }
}

function closeRoom(room, reason = 'closed') {
  if (!room || room.status === 'closed') return;
  clearRoomTimers(room);
  room.status = 'closed';
  room.closedAt = now();
  markInviteStatus(room, reason === 'finished' ? 'finished' : 'closed', true);
  broadcastInviteUpdate(room, reason);
  broadcastRoom(room, 'guess:room', { closed: true, reason });
  userRoom.forEach((rid, uid) => {
    if (rid === room.id) userRoom.delete(uid);
  });
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
  ioRef?.to(`guess_${room.id}`).emit('guess:host-changed', {
    hostUserId: next.userId,
    roomId: room.id,
    serverTime: now(),
  });
  return true;
}

function ensurePlayerSockets(socket, room) {
  socket.join(`guess_${room.id}`);
  socket.join(`user_${socket.data.user.id}`);
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
  return {
    msg: {
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
    },
    conversationId: conv,
  };
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

// ---------- 曲库 ----------

const SEARCH_QUERIES = [
  '热歌', '流行', '经典', '华语', '情歌', '摇滚', '民谣', '说唱',
  '周杰伦', '林俊杰', '邓紫棋', '五月天', '陈奕迅', '薛之谦', '毛不易', '李荣浩',
  '孙燕姿', '梁静茹', '张学友', '王菲', '刘德华', '周深', '华晨宇', '毛阿敏',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms).unref?.() || setTimeout(r, ms));
}

async function fetchProviderTracks(providerName, q, limit = 20, timeoutMs = 2500, offset = 0) {
  const mod = await import(`./providers/${providerName}.js`);
  const p = mod.default || mod;
  if (!p?.search) return [];
  // 酷狗歌单/播放共用账号限流，搜索少打、打完歇一下
  const gap = providerName === 'kugou' ? 450 : 120;
  const songs = await Promise.race([
    p.search({ q, limit, offset }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('pool_timeout')), timeoutMs).unref?.() || setTimeout(() => reject(new Error('pool_timeout')), timeoutMs)),
  ]);
  await sleep(gap);
  return (songs || []).map(keepTrackFields).filter(Boolean);
}

/** 本地演示曲目兜底（无外网 / 测试） */
function localFallbackTracks() {
  return [
    {
      source: 'local', id: 'local-bgm', title: '叠塔挑战 · 主旋律', artist: 'Hudui Demo',
      cover: '/media/demo/cover-bgm.png', duration: 30, durationMs: 30000,
    },
    {
      source: 'local', id: 'local-calm', title: '静心 · 轻音乐 Demo', artist: 'Hudui Demo',
      cover: '/media/demo/cover-calm.png', duration: 30, durationMs: 30000,
    },
    {
      source: 'local', id: 'local-pop', title: '热歌 · 节奏 Demo', artist: 'Hudui Demo',
      cover: '/media/demo/cover-pop.png', duration: 30, durationMs: 30000,
    },
    {
      source: 'local', id: 'local-night', title: '夜色 · 氛围 Demo', artist: 'Hudui Demo',
      cover: '/media/demo/cover-night.png', duration: 30, durationMs: 30000,
    },
    {
      source: 'local', id: 'local-gameover', title: '提示音 · 短曲', artist: 'Hudui Demo',
      cover: '/media/demo/cover-game.png', duration: 20, durationMs: 20000,
    },
    // 额外占位，保证选项池足够
    ...Array.from({ length: 12 }, (_, i) => ({
      source: 'local',
      id: `local-extra-${i}`,
      title: `演示曲目 ${i + 1}`,
      artist: `演示歌手${(i % 4) + 1}`,
      cover: '',
      duration: 25,
      durationMs: 25000,
    })),
  ].map(keepTrackFields).filter(Boolean);
}

/** 曲库主题：random=曲库小王子；artist:xxx=指定歌手 */
const THEME_LABELS = {
  random: '曲库小王子',
};

function normalizeTheme(raw, rawLabel) {
  const theme = String(raw || 'random').slice(0, 40);
  if (theme === 'random') return { theme: 'random', themeLabel: THEME_LABELS.random };
  if (theme.startsWith('artist:')) {
    const name = theme.slice(7).trim().slice(0, 16);
    if (!name) return { theme: 'random', themeLabel: THEME_LABELS.random };
    return { theme: `artist:${name}`, themeLabel: name };
  }
  // 兼容直接传歌手名
  const name = String(rawLabel || raw || '').trim().slice(0, 16);
  if (name && name !== 'random') return { theme: `artist:${name}`, themeLabel: name };
  return { theme: 'random', themeLabel: THEME_LABELS.random };
}

/**
 * 从曲库攒一批曲目。
 * - 指定歌手且本地 music/ 已有该歌手 → **只走本地**，不打远程
 * - 其他主题（曲库小王子 / 无本地的歌手）→ 正常远程搜索
 */
export async function buildGuessSongPool({ minCount = 24, force = false, theme = 'random', themeLabel = '' } = {}) {
  const t = now();
  const artist = theme === 'random' ? '' : String(themeLabel || theme.replace(/^artist:/, '') || '').trim();
  const cacheKey = artist ? `artist:${artist}` : 'random';
  if (!songPoolCache.byTheme) songPoolCache.byTheme = new Map();
  const hit = songPoolCache.byTheme.get(cacheKey);
  if (!force && hit && hit.tracks.length >= Math.min(minCount, 12) && t - hit.at < 30 * 60 * 1000) {
    return hit.tracks;
  }

  // 本地下载曲目（music/<歌手>/）
  const localForTheme = artist ? localTracksForArtist(artist).map(keepTrackFields).filter(Boolean) : [];
  // 有本地库（周杰伦/孙燕姿/陈奕迅/邓紫棋/林俊杰…）：纯本地，不打远程
  if (artist && localForTheme.length >= 8) {
    const uniqueLocal = [];
    for (const tr of localForTheme) {
      if (uniqueLocal.some((u) => titlesTooSimilar(u.title, tr.title) || isSameRecordingVariant(u, tr))) continue;
      uniqueLocal.push(tr);
    }
    const tracks = uniqueLocal.length >= 5 ? uniqueLocal : localForTheme;
    if (!songPoolCache.byTheme) songPoolCache.byTheme = new Map();
    songPoolCache.byTheme.set(cacheKey, { at: now(), tracks });
    songPoolCache.tracks = tracks;
    songPoolCache.at = now();
    return tracks;
  }

  const seed = [...localForTheme, ...localFallbackTracks()];
  if (hit && hit.tracks.length && !force) {
    setTimeout(() => {
      enrichSongPool(minCount, null, artist).catch(() => {});
    }, 0).unref?.();
    return hit.tracks;
  }
  return enrichSongPool(minCount, seed, artist);
}

function looksLikeArtistTrack(tr, artist) {
  if (!artist) return true;
  const ar = String(tr.artist || '');
  const names = ar.split(/\s*\/\s*|\s*&\s*|\s*,\s*|\s+、\s+/).map((s) => s.trim()).filter(Boolean);
  if (names.some((n) => n.includes(artist) || artist.includes(n))) return true;
  // 合辑 / 群星里带歌手名也算
  if (ar.includes(artist)) return true;
  return false;
}

async function enrichSongPool(minCount, seedTracks = null, artist = '') {
  // 本地下载（music/歌手/）：远程超时也能用真歌开局
  const localArtist = artist ? localTracksForArtist(artist).map(keepTrackFields).filter(Boolean) : [];
  const localAny = allLocalMusicTracks().map(keepTrackFields).filter(Boolean);
  const seed = seedTracks && seedTracks.length
    ? seedTracks
    : [...localArtist, ...localFallbackTracks()];

  const collected = new Map();
  const addList = (list, requireArtist) => {
    for (const tr of list) {
      if (!tr?.id && !tr?.hash) continue;
      if (!tr.title || tr.title.length > 60) continue;
      if (/伴奏|纯音乐|karaoke/i.test(tr.title) && !/[一-龥a-zA-Z]/.test(tr.title.replace(/伴奏|纯音乐|karaoke/gi, ''))) continue;
      if (requireArtist && !looksLikeArtistTrack(tr, artist)) continue;
      const k = trackKey(tr);
      if (!collected.has(k)) collected.set(k, tr);
    }
  };

  // 1) 本地真实曲目（同主题优先）
  addList(localArtist, Boolean(artist));
  if (!artist) addList(localAny, false);

  // 本地已足够：不打远程
  if (artist && localArtist.length >= 8) {
    const uniqueLocal = [];
    for (const tr of localArtist) {
      if (uniqueLocal.some((u) => titlesTooSimilar(u.title, tr.title) || isSameRecordingVariant(u, tr))) continue;
      uniqueLocal.push(tr);
    }
    return uniqueLocal.length ? uniqueLocal : localArtist;
  }

  const want = artist ? Math.max(minCount, 36) : Math.max(minCount, 32);
  // 2) 远程搜索补池（串行，避免打挂音源）
  const sources = ['kugou', 'qq', 'netease'];
  const baseQueries = artist
    ? [
      artist,
      `${artist} 热歌`,
      `${artist} 精选`,
      `${artist} 经典`,
      `${artist} 专辑`,
      `${artist} 中国风`,
      `${artist} 抒情`,
      `${artist} 现场`,
    ]
    : SEARCH_QUERIES.slice().sort(() => Math.random() - 0.5).slice(0, 6);

  for (const q of baseQueries) {
    if (collected.size >= want) break;
    const pages = artist ? [0, 20] : [0];
    for (const offset of pages) {
      if (collected.size >= want) break;
      for (const src of sources) {
        if (collected.size >= want) break;
        const list = await fetchProviderTracks(src, q, 20, 2500, offset).catch(() => []);
        addList(list, Boolean(artist));
        await sleep(120);
      }
    }
  }

  // 3) 仍不够：再搜代表作
  if (artist && collected.size < want) {
    const hits = await Promise.all(
      [`${artist}`, `${artist} 歌曲`].map((q) =>
        fetchProviderTracks('kugou', q, 30, 2200, 0).catch(() => [])
      )
    );
    for (const list of hits) addList(list, Boolean(artist));
  }

  let tracks = [...collected.values()];
  if (artist) {
    const matched = tracks.filter((tr) => looksLikeArtistTrack(tr, artist) && !isPlaceholderTrack(tr));
    const uniqueM = [];
    for (const tr of matched) {
      if (uniqueM.some((u) => titlesTooSimilar(u.title, tr.title) || isSameRecordingVariant(u, tr))) continue;
      uniqueM.push(tr);
    }
    if (uniqueM.length >= Math.min(8, want / 2)) tracks = uniqueM;
    else {
      const rest = tracks.filter(
        (tr) => !uniqueM.some((u) => trackKey(u) === trackKey(tr)) && !isPlaceholderTrack(tr)
      );
      tracks = [...uniqueM, ...rest];
    }
  }

  const unique = [];
  for (const tr of tracks) {
    if (isPlaceholderTrack(tr)) continue;
    if (unique.some((u) => titlesTooSimilar(u.title, tr.title) || isSameRecordingVariant(u, tr))) continue;
    unique.push(tr);
  }

  // 真实曲目不够时，把本地下载 / demo 拼在后面
  const fillers = [...localArtist, ...localAny, ...seed].filter(
    (s) => s && !unique.some((u) => trackKey(u) === trackKey(s)) && !isPlaceholderTrack(s)
  );
  const finalTracks = unique.length ? [...unique, ...fillers] : [...localArtist, ...seed];

  if (!songPoolCache.byTheme) songPoolCache.byTheme = new Map();
  const cacheKey = artist ? `artist:${artist}` : 'random';
  if (unique.length >= Math.min(3, want)) {
    songPoolCache.byTheme.set(cacheKey, { at: now(), tracks: finalTracks });
    songPoolCache.tracks = finalTracks;
    songPoolCache.at = now();
  }
  return finalTracks;
}

// 进程启动即后台预热
setTimeout(() => {
  enrichSongPool(30).catch(() => {});
}, 500).unref?.();

/** 从曲库抽 n 首互不重复的题目；优先可播真实曲目（含本地下载），不足时用真实金曲名兜底 */
function pickSongs(pool, n, rng = Math.random, artist = '') {
  let real = pool.filter((tr) => tr && !isPlaceholderTrack(tr));
  if (artist) {
    const matched = real.filter((tr) => String(tr.artist || '').includes(artist));
    if (matched.length >= Math.min(n, 3)) real = matched;
  }
  // 本地已下载（有 url）优先，远程超时也能播
  real = real.slice().sort((a, b) => {
    const la = a.url && String(a.url).startsWith('/music/') ? 0 : 1;
    const lb = b.url && String(b.url).startsWith('/music/') ? 0 : 1;
    return la - lb;
  });
  const shuffled = [
    ...real.filter((t) => t.url && String(t.url).startsWith('/music/')),
    ...real.filter((t) => !(t.url && String(t.url).startsWith('/music/'))).sort(() => rng() - 0.5),
  ];
  const picked = [];
  const usedNorm = new Set();
  for (const tr of shuffled) {
    if (picked.length >= n) break;
    const norm = normalizeTitle(tr.title);
    if (usedNorm.has(norm)) continue;
    if (picked.some((p) => isSameRecordingVariant(p, tr) || titlesTooSimilar(p.title, tr.title))) continue;
    usedNorm.add(norm);
    picked.push(tr);
  }
  // 仍不够时补真实金曲名（只借歌名作题目，音频落到本地 demo）
  const reserve = shuffle(REAL_SONG_TITLES, rng);
  let ri = 0;
  while (picked.length < n && ri < reserve.length) {
    const title = reserve[ri];
    ri += 1;
    if (usedNorm.has(normalizeTitle(title))) continue;
    if (picked.some((p) => titlesTooSimilar(p.title, title))) continue;
    usedNorm.add(normalizeTitle(title));
    picked.push({
      source: 'local',
      id: `reserve-song-${picked.length}`,
      title,
      artist: REAL_ARTIST_NAMES[picked.length % REAL_ARTIST_NAMES.length],
      cover: '',
      duration: 25,
      durationMs: 25000,
    });
  }
  return picked;
}

// ---------- 回合状态机 ----------

function setPhase(room, phase, deadline = 0) {
  room.roundPhase = phase;
  room.phaseDeadline = deadline || 0;
  touch(room);
}

function startRound(room, index) {
  if (room.status !== 'playing') return;
  clearRoomTimers(room);
  const track = room.songList[index];
  if (!track) {
    finishMatch(room);
    return;
  }
  const clip = pickClipWindow(track.durationMs || (track.duration || 0) * 1000 || 20000);
  const usedTitles = new Set(
    room.songList.slice(0, index).map((t) => normalizeTitle(t.title))
  );
  const mainOptions = buildOptions(track, room.pool || room.songList, {
    count: 4,
    usedTitles,
  });
  room.round = {
    index,
    track,
    clipStartMs: clip.clipStartMs,
    clipDurationMs: clip.clipDurationMs,
    loaded: new Set(),
    loadedOk: new Set(),
    startedAt: now(),
    mainOptions,
  };
  room.buzzUserId = null;
  room.answererUserId = null;
  room.mainOptions = mainOptions;
  room.artistOptions = null;
  room.artistPhase = false;
  room.revealed = false;
  room.hintLevel = 0;
  room.audioStartAt = 0;
  room.prepareAt = 0;
  room.answerDeadline = 0;
  room.artistDeadline = 0;
  room.lastResult = null;
  for (const p of room.players) resetPlayerForRound(p);
  setPhase(room, 'loading', now() + LOAD_TIMEOUT_MS);
  broadcastRoom(room, 'guess:round', {
    roundIndex: index,
    total: room.songCount,
    phase: 'loading',
    trackRef: {
      source: track.source,
      id: track.id,
      url: track.url || '',
      mid: track.mid,
      mediaMid: track.mediaMid,
      hash: track.hash,
      albumId: track.albumId,
      albumAudioId: track.albumAudioId,
      mixSongId: track.mixSongId,
      duration: track.duration,
      durationMs: track.durationMs,
      privilege: track.privilege,
      hqHash: track.hqHash,
      sqHash: track.sqHash,
      resHash: track.resHash,
    },
    clipStartMs: clip.clipStartMs,
    clipDurationMs: clip.clipDurationMs,
  });
  room.loadTimer = setTimeout(() => {
    if (room.roundPhase !== 'loading') return;
    // 超时：若仍无人确认可播，则换下一首，绝不带着坏音频进抢答
    if (!room.round?.loadedOk?.size) {
      skipUnplayableRound(room);
      return;
    }
    beginPrep(room);
  }, LOAD_TIMEOUT_MS);
  room.loadTimer.unref?.();
}

/** 本首无法播放：跳到下一首；若已无更多则结算 */
function skipUnplayableRound(room) {
  if (!room || room.status !== 'playing') return;
  clearRoomTimers(room);
  const next = (room.round?.index ?? -1) + 1;
  if (next >= room.songCount) {
    finishMatch(room);
    return;
  }
  startRound(room, next);
}

function beginPrep(room) {
  if (!room.round || room.status !== 'playing') return;
  clearRoomTimers(room);
  const prepareAt = now();
  room.prepareAt = prepareAt;
  room.audioStartAt = prepareAt + PREPARE_MS;
  setPhase(room, 'prep', room.audioStartAt);
  broadcastRoom(room, 'guess:prep', {
    prepareAt,
    startAt: room.audioStartAt,
    clipStartMs: room.round.clipStartMs,
    clipDurationMs: room.round.clipDurationMs,
    hintAtMs: HINT_AT_MS,
  });
  room.prepTimer = setTimeout(() => {
    if (room.roundPhase === 'prep' || room.roundPhase === 'loading') beginPlaying(room);
  }, PREPARE_MS + 40);
  room.prepTimer.unref?.();
}

function beginPlaying(room) {
  if (!room.round || room.status !== 'playing') return;
  clearRoomTimers(room);
  if (!room.audioStartAt) room.audioStartAt = now();
  setPhase(room, 'playing', now() + ROUND_MAX_MS);
  broadcastRoom(room, 'guess:play', {
    startAt: room.audioStartAt,
    clipStartMs: room.round.clipStartMs,
    clipDurationMs: room.round.clipDurationMs,
    maxMs: ROUND_MAX_MS,
    hintAtMs: HINT_AT_MS,
  });
  // 提示逐步出现
  let hintIdx = 0;
  const scheduleHint = () => {
    if (room.roundPhase !== 'playing' || !room.round) return;
    if (hintIdx >= HINT_AT_MS.length) return;
    const delay = Math.max(0, HINT_AT_MS[hintIdx] - (now() - room.audioStartAt));
    room.roundTimer = setTimeout(() => {
      if (room.roundPhase !== 'playing') return;
      room.hintLevel = Math.min(HINT_AT_MS.length, (room.hintLevel || 0) + 1);
      hintIdx += 1;
      broadcastRoom(room, 'guess:hint', { hintLevel: room.hintLevel });
      scheduleHint();
    }, delay);
    room.roundTimer.unref?.();
  };
  scheduleHint();
  // 没人答对则片段播完后循环 / 公布
  const clipEnd = room.audioStartAt + room.round.clipDurationMs + 300;
  const remain = Math.max(200, clipEnd - now());
  room.playTimer = setTimeout(() => onClipEnd(room), remain);
  room.playTimer.unref?.();
}

function onClipEnd(room) {
  if (!room.round || room.status !== 'playing') return;
  if (room.roundPhase === 'answering') return;
  // 已有人在答则等作答结束
  if (room.buzzUserId != null && room.answererUserId != null) return;
  // 尚未有人答对：再循环一轮片段，或超时公布
  const elapsed = now() - (room.audioStartAt || now());
  if (elapsed < ROUND_MAX_MS - 500 && activePlayers(room).some((p) => !p.mainWrong)) {
    // 循环片段：重设 startAt，继续可抢答
    room.audioStartAt = now();
    setPhase(room, 'playing', now() + ROUND_MAX_MS);
    broadcastRoom(room, 'guess:loop', {
      startAt: room.audioStartAt,
      clipStartMs: room.round.clipStartMs,
      clipDurationMs: room.round.clipDurationMs,
    });
    room.playTimer = setTimeout(() => onClipEnd(room), room.round.clipDurationMs + 300);
    room.playTimer.unref?.();
    return;
  }
  // 全员答错或超时 → 公布答案
  revealMain(room, { mode: 'timeout' });
}

function revealMain(room, { mode, winner = null, chosenTitle = null } = {}) {
  if (!room.round) return;
  clearRoomTimers(room);
  room.revealed = true;
  room.answererUserId = null;
  setPhase(room, 'main_reveal', now() + 1200);
  room.lastResult = {
    type: 'main',
    mode,
    winnerUserId: winner?.userId ?? null,
    winnerName: winner?.nickname ?? null,
    chosenTitle,
    correctTitle: room.round.track.title,
    correctArtist: room.round.track.artist,
    cover: room.round.track.cover,
  };
  broadcastRoom(room, 'guess:main-result', {
    result: room.lastResult,
    scores: rankPlayers(activePlayers(room)),
  });
  // 指定歌手曲库时，再问「歌手是谁」没有意义，直接进下一首
  const skipArtist = String(room.theme || '').startsWith('artist:');
  room.artistTimer = setTimeout(() => {
    if (skipArtist) endArtistPhase(room);
    else beginArtistPhase(room);
  }, 1100);
  room.artistTimer.unref?.();
}

function beginArtistPhase(room) {
  if (!room.round || room.status !== 'playing') return;
  clearRoomTimers(room);
  // 指定歌手主题：不再出歌手题
  if (String(room.theme || '').startsWith('artist:')) {
    endArtistPhase(room);
    return;
  }
  room.artistPhase = true;
  room.artistOptions = buildArtistOptions(room.round.track, room.pool || room.songList, { count: 4 });
  for (const p of room.players) p.answeredArtist = false;
  const deadline = now() + ARTIST_MS;
  room.artistDeadline = deadline;
  setPhase(room, 'artist', deadline);
  broadcastRoom(room, 'guess:artist', {
    options: publicOptions(room.artistOptions),
    deadline,
    score: ARTIST_SCORE,
    wrongPenalty: ARTIST_WRONG_PENALTY,
  });
  room.artistTimer = setTimeout(() => endArtistPhase(room), ARTIST_MS + 50);
  room.artistTimer.unref?.();
}

function endArtistPhase(room) {
  if (!room.round) return;
  clearRoomTimers(room);
  room.artistPhase = false;
  setPhase(room, 'round_end', now() + 1500);
  broadcastRoom(room, 'guess:round-end', {
    roundIndex: room.round.index,
    scores: rankPlayers(activePlayers(room)),
  });
  room.roundTimer = setTimeout(() => {
    const next = room.round.index + 1;
    if (next >= room.songCount) finishMatch(room);
    else startRound(room, next);
  }, 1400);
  room.roundTimer.unref?.();
}

function finishMatch(room) {
  clearRoomTimers(room);
  room.status = 'finished';
  room.roundPhase = 'finished';
  room.revealed = true;
  const ranked = rankPlayers(activePlayers(room));
  const winnerId = ranked[0]?.userId;
  for (const p of room.players) {
    try {
      stmts.upsertGuessStats.run(
        Number(p.userId),
        1,
        Number(p.userId) === Number(winnerId) ? 1 : 0,
        Number(p.score) || 0,
        now()
      );
    } catch {
      /* ignore */
    }
  }
  touch(room);
  markInviteStatus(room, 'finished');
  broadcastInviteUpdate(room, 'finished');
  broadcastRoom(room, 'guess:finished', {
    ranking: ranked,
    serverTime: now(),
  });
}

function applyMainScore(room, player, delta) {
  if (!player) return;
  player.score = Math.max(-999, (Number(player.score) || 0) + delta);
}

// 服务重启时把历史邀请标为 closed
try {
  stmts.listActiveGuessInvites.all().forEach((row) => {
    stmts.setGuessInviteStatus.run('closed', now(), now(), row.id);
  });
} catch {
  /* ignore */
}

export function initGuessSong(io) {
  ioRef = io;

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (!user) return;
    const uid = Number(user.id);
    socket.join(`user_${uid}`);

    const err = (ack, code, message, extra = {}) => {
      const payload = { error: message, code, ...extra };
      if (typeof ack === 'function') ack(payload);
      socket.emit('guess:error', payload);
    };
    const ok = (ack, payload = {}) => {
      const res = { ok: true, ...payload, serverTime: now() };
      if (typeof ack === 'function') ack(res);
      return res;
    };

    const existing = userActiveRoom(uid);
    if (existing) {
      ensurePlayerSockets(socket, existing);
      const p = findPlayer(existing, uid);
      if (p) {
        p.online = true;
        p.disconnectedAt = 0;
      }
    }

    socket.on('guess:room:create', (payload = {}, ack) => {
      try {
        if (!rateOk(`gcreate:${uid}`, 4, 10_000)) return err(ack, 'rate', '开得太快啦，歇一下。');
        const cur = userActiveRoom(uid);
        if (cur && cur.status !== 'closed' && cur.status !== 'finished') {
          return ok(ack, {
            exists: true,
            room: roomSnapshot(cur, uid),
            error: '你还在另一场，先回去看看吧。',
            code: 'already_in_room',
          });
        }
        if (cur) return ok(ack, { exists: true, room: roomSnapshot(cur, uid) });
        const t = now();
        const themeInfo = normalizeTheme(payload.theme, payload.themeLabel);
        const room = {
          id: randomUUID().slice(0, 10),
          hostUserId: uid,
          status: 'waiting',
          songCount: validSongCount(payload.songCount),
          theme: themeInfo.theme,
          themeLabel: themeInfo.themeLabel,
          players: [],
          invites: [],
          pool: [],
          songList: [],
          round: null,
          roundPhase: 'idle',
          buzzUserId: null,
          answererUserId: null,
          mainOptions: null,
          artistOptions: null,
          artistPhase: false,
          revealed: false,
          hintLevel: 0,
          audioStartAt: 0,
          prepareAt: 0,
          answerDeadline: 0,
          artistDeadline: 0,
          lastResult: null,
          version: 1,
          createdAt: t,
          updatedAt: t,
          prepTimer: null,
          playTimer: null,
          answerTimer: null,
          artistTimer: null,
          loadTimer: null,
          roundTimer: null,
        };
        room.players.push(initialPlayer(uid, user.nickname, user.avatar, user.avatarColor));
        rooms.set(room.id, room);
        userRoom.set(uid, room.id);
        ensurePlayerSockets(socket, room);
        touch(room);
        ok(ack, { room: roomSnapshot(room, uid), created: true });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('guess:room:sync', (_payload = {}, ack) => {
      try {
        const room = userActiveRoom(uid);
        if (!room) return ok(ack, { room: null, active: false });
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

    socket.on('guess:room:leave', (_payload = {}, ack) => {
      try {
        const room = userActiveRoom(uid);
        if (!room) return ok(ack, { left: true });
        const p = findPlayer(room, uid);
        if (room.status === 'playing') {
          if (p) {
            p.retired = true;
            p.ready = false;
            p.online = false;
            p.disconnectedAt = now();
          }
          if (onlinePlayers(room).length < MIN_PLAYERS) {
            finishMatch(room);
            closeRoom(room, 'empty');
          } else {
            touch(room);
            broadcastRoom(room, 'guess:player-update');
            broadcastInviteUpdate(room, 'leave');
          }
        } else {
          room.players = room.players.filter((x) => Number(x.userId) !== uid);
          if (Number(room.hostUserId) === uid) transferHost(room);
          if (room.players.length === 0) closeRoom(room, 'empty');
          else {
            touch(room);
            broadcastRoom(room, 'guess:player-update');
            broadcastInviteUpdate(room, 'leave');
          }
        }
        userRoom.delete(uid);
        socket.leave(`guess_${room.id}`);
        return ok(ack, { left: true });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('guess:song-count', (payload = {}, ack) => {
      try {
        const room = userActiveRoom(uid);
        if (!room) return err(ack, 'no_room', '房间不在了，再开一局吧。');
        if (Number(room.hostUserId) !== uid) return err(ack, 'not_host', '等房主来定曲目数。');
        if (room.status !== 'waiting' && room.status !== 'finished') {
          return err(ack, 'bad_state', '现在改不了。');
        }
        if (payload.songCount) room.songCount = validSongCount(payload.songCount);
        if (payload.theme !== undefined || payload.themeLabel !== undefined) {
          const themeInfo = normalizeTheme(payload.theme ?? room.theme, payload.themeLabel ?? room.themeLabel);
          room.theme = themeInfo.theme;
          room.themeLabel = themeInfo.themeLabel;
        }
        touch(room);
        broadcastRoom(room, 'guess:player-update');
        return ok(ack, { room: roomSnapshot(room, uid) });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('guess:theme', (payload = {}, ack) => {
      try {
        const room = userActiveRoom(uid);
        if (!room) return err(ack, 'no_room', '房间不在了，再开一局吧。');
        if (Number(room.hostUserId) !== uid) return err(ack, 'not_host', '等房主来定曲库。');
        if (room.status !== 'waiting' && room.status !== 'finished') {
          return err(ack, 'bad_state', '开场后换不了曲库了。');
        }
        const themeInfo = normalizeTheme(payload.theme, payload.themeLabel);
        room.theme = themeInfo.theme;
        room.themeLabel = themeInfo.themeLabel;
        touch(room);
        broadcastRoom(room, 'guess:player-update');
        broadcastInviteUpdate(room, 'theme');
        return ok(ack, { room: roomSnapshot(room, uid), theme: room.theme, themeLabel: room.themeLabel });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('guess:ready', (payload = {}, ack) => {
      try {
        if (!rateOk(`gready:${uid}`, 12, 5_000)) return err(ack, 'rate', '操作有点快。');
        const room = userActiveRoom(uid);
        if (!room) return err(ack, 'no_room', '房间不在了，再开一局吧。');
        if (room.status !== 'waiting' && room.status !== 'finished') {
          return err(ack, 'bad_state', '现在不能改准备状态。');
        }
        const p = findPlayer(room, uid);
        if (!p || p.retired) return err(ack, 'not_in_room', '你不在这个房间里。');
        p.ready = payload.ready !== false;
        touch(room);
        broadcastRoom(room, 'guess:player-update');
        return ok(ack, { room: roomSnapshot(room, uid) });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('guess:start', async (payload = {}, ack) => {
      try {
        if (!rateOk(`gstart:${uid}`, 4, 8_000)) return err(ack, 'rate', '慢一点。');
        const room = userActiveRoom(uid);
        if (!room) return err(ack, 'no_room', '房间不在了。');
        if (Number(room.hostUserId) !== uid) return err(ack, 'not_host', '等房主来开场。');
        if (room.status === 'playing') return ok(ack, { room: roomSnapshot(room, uid), already: true });
        if (room.status !== 'waiting' && room.status !== 'finished') {
          return err(ack, 'bad_state', '现在不能开始。');
        }
        if (payload.songCount) room.songCount = validSongCount(payload.songCount);
        if (payload.theme !== undefined || payload.themeLabel !== undefined) {
          const th = normalizeTheme(payload.theme ?? room.theme, payload.themeLabel ?? room.themeLabel);
          room.theme = th.theme;
          room.themeLabel = th.themeLabel;
        }
        const online = onlinePlayers(room);
        if (online.length < MIN_PLAYERS) return err(ack, 'need_more', '再来一位就开场。');
        if (!online.every((x) => x.ready)) return err(ack, 'not_ready', '等大家准备好。');
        // 再来一局：清空分数
        if (room.status === 'finished') {
          for (const pl of room.players) {
            resetPlayerForRound(pl);
            pl.score = 0;
            pl.ready = false;
          }
        }
        // 立刻进入 playing 并广播，本地曲库直接开局
        room.status = 'playing';
        room.roundId = randomUUID().slice(0, 12);
        touch(room);
        markInviteStatus(room, 'playing');
        broadcastInviteUpdate(room, 'playing');
        ok(ack, { room: roomSnapshot(room, uid), starting: true });
        broadcastRoom(room, 'guess:started', {
          songCount: room.songCount,
          themeLabel: room.themeLabel,
          roundId: room.roundId,
        });
        // 同步取本地池（不阻塞外网）；外网池在后台 enrich
        const artist = room.theme === 'random' ? '' : String(room.themeLabel || '').trim();
        const pool = await buildGuessSongPool({
          minCount: Math.max(12, room.songCount * 2),
          theme: room.theme || 'random',
          themeLabel: room.themeLabel || '',
        });
        if (room.status !== 'playing') return;
        room.pool = pool;
        room.songList = pickSongs(pool, room.songCount, Math.random, artist);
        startRound(room, 0);
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('guess:track:loaded', (payload = {}, ack) => {
      try {
        const room = userActiveRoom(uid);
        if (!room || !room.round) return ok(ack, {});
        if (room.roundPhase !== 'loading' && room.roundPhase !== 'prep') return ok(ack, {});
        const ready = payload?.ok !== false && payload?.ready !== false;
        room.round.loaded.add(uid);
        if (ready) room.round.loadedOk.add(uid);
        touch(room);
        const online = Math.max(1, onlinePlayers(room).length);
        const reported = room.round.loaded.size;
        const okCount = room.round.loadedOk.size;
        // 全员回报后：有 1 人可播就开；全不可播则换歌
        if (room.roundPhase === 'loading') {
          if (reported >= online) {
            if (okCount === 0) skipUnplayableRound(room);
            else beginPrep(room);
          }
        }
        return ok(ack, { loaded: reported, ok: okCount, expected: online });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('guess:track:fail', (_payload = {}, ack) => {
      try {
        const room = userActiveRoom(uid);
        if (!room || !room.round) return ok(ack, {});
        // 播放阶段发现音频不可用：直接换下一首
        if (room.roundPhase === 'loading' || room.roundPhase === 'prep' || room.roundPhase === 'playing') {
          if (!room.round.loadedOk?.size || room.round.loadedOk.has(uid) === false) {
            // 若尚无人成功播放，跳过本首
            if ((room.round.playOkCount || 0) === 0 && room.roundPhase !== 'answering') {
              skipUnplayableRound(room);
            }
          }
        }
        return ok(ack, {});
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('guess:buzz', (payload = {}, ack) => {
      try {
        const commandId = String(payload.commandId || '');
        const cached = getCachedCommand(commandId);
        if (cached) return ok(ack, cached.result || cached);
        if (!rateOk(`gbuzz:${uid}`, 6, 2_000)) return err(ack, 'rate', '手速太快了。');
        const room = userActiveRoom(uid);
        if (!room) return err(ack, 'no_room', '房间不在了。');
        if (room.status !== 'playing' || !room.round) return err(ack, 'not_playing', '还没开始呢。');
        const p = findPlayer(room, uid);
        if (!p || p.retired) return err(ack, 'not_in_room', '你不在比赛里。');
        if (p.mainWrong) return err(ack, 'locked', '这一首你已经答错过，让别人来吧。');
        if (room.roundPhase !== 'playing') return err(ack, 'bad_phase', '现在不能抢。');
        if (!room.audioStartAt) return err(ack, 'not_started', '音频还没开始。');
        if (room.buzzUserId != null || room.answererUserId != null) {
          return err(ack, 'already_buzzed', '有人正在作答。');
        }
        if (p.lastBuzzAt && now() - p.lastBuzzAt < BUZZ_COOLDOWN_MS) {
          return err(ack, 'cooldown', '稍等一下。');
        }
        p.lastBuzzAt = now();
        room.buzzUserId = uid;
        room.answererUserId = uid;
        room.answerDeadline = now() + ANSWER_MS;
        setPhase(room, 'answering', room.answerDeadline);
        // 只把选项发给抢答成功者
        room.mainOptions = room.round.mainOptions;
        const options = publicOptions(room.mainOptions);
        const result = {
          room: roomSnapshot(room, uid),
          youBuzzed: true,
          options,
          deadline: room.answerDeadline,
        };
        if (commandId) rememberCommand(commandId, result);
        // 公共通知：暂停片段 + 谁在作答（不含选项）
        broadcastRoom(room, 'guess:buzzed', {
          buzzUserId: uid,
          buzzName: p.nickname,
          deadline: room.answerDeadline,
        });
        // 单独给作答者选项
        socket.emit('guess:options', {
          options,
          deadline: room.answerDeadline,
          question: '这首歌叫什么？',
        });
        room.answerTimer = setTimeout(() => {
          if (room.roundPhase === 'answering' && Number(room.answererUserId) === uid) {
            onMainAnswerTimeout(room, uid);
          }
        }, ANSWER_MS + 60);
        room.answerTimer.unref?.();
        return ok(ack, result);
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('guess:answer', (payload = {}, ack) => {
      try {
        const commandId = String(payload.commandId || '');
        const cached = getCachedCommand(commandId);
        if (cached) return ok(ack, cached.result || cached);
        if (!rateOk(`gans:${uid}`, 8, 3_000)) return err(ack, 'rate', '慢一点。');
        const room = userActiveRoom(uid);
        if (!room || !room.round) return err(ack, 'no_room', '房间不在了。');
        if (Number(room.answererUserId) !== uid) return err(ack, 'not_answerer', '现在不是你在作答。');
        if (room.roundPhase !== 'answering') return err(ack, 'bad_phase', '作答已结束。');
        if (now() > room.answerDeadline + 200) {
          onMainAnswerTimeout(room, uid);
          return err(ack, 'timeout', '超时了，下一首再战。');
        }
        const optionId = String(payload.optionId || '');
        const opt = (room.mainOptions || []).find((o) => o.optionId === optionId);
        if (!opt) return err(ack, 'bad_option', '选项无效。');
        const p = findPlayer(room, uid);
        const correct = Boolean(opt._correct);
        if (correct) {
          applyMainScore(room, p, MAIN_SCORE);
          p.answeredMain = true;
          clearRoomTimers(room);
          const result = {
            correct: true,
            delta: MAIN_SCORE,
            title: opt.title,
            scores: rankPlayers(activePlayers(room)),
          };
          if (commandId) rememberCommand(commandId, result);
          revealMain(room, { mode: 'correct', winner: p, chosenTitle: opt.title });
          return ok(ack, result);
        }
        // 答错：扣少量分，本轮不能再抢主答案，音频从权威位置继续
        applyMainScore(room, p, -MAIN_WRONG_PENALTY);
        p.mainWrong = true;
        p.answeredMain = true;
        room.buzzUserId = null;
        room.answererUserId = null;
        room.mainOptions = null;
        // 若全员已不能主答 → 公布
        const stillCan = activePlayers(room).some((x) => !x.mainWrong && x.online);
        if (!stillCan) {
          const result = { correct: false, delta: -MAIN_WRONG_PENALTY, title: opt.title, scores: rankPlayers(activePlayers(room)) };
          if (commandId) rememberCommand(commandId, result);
          revealMain(room, { mode: 'all_wrong', chosenTitle: opt.title });
          return ok(ack, result);
        }
        // 从权威位置续播
        const elapsed = Math.max(0, now() - (room.audioStartAt || now()));
        room.audioStartAt = now();
        setPhase(room, 'playing', now() + ROUND_MAX_MS);
        const result = {
          correct: false,
          delta: -MAIN_WRONG_PENALTY,
          title: opt.title,
          scores: rankPlayers(activePlayers(room)),
        };
        if (commandId) rememberCommand(commandId, result);
        broadcastRoom(room, 'guess:wrong', {
          userId: uid,
          nickname: p.nickname,
          delta: -MAIN_WRONG_PENALTY,
          scores: rankPlayers(activePlayers(room)),
          resumeAt: room.audioStartAt,
          resumeElapsedMs: elapsed,
          clipStartMs: room.round.clipStartMs,
          clipDurationMs: room.round.clipDurationMs,
        });
        room.playTimer = setTimeout(() => onClipEnd(room), room.round.clipDurationMs + 300);
        room.playTimer.unref?.();
        return ok(ack, result);
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('guess:artist', (payload = {}, ack) => {
      try {
        const commandId = String(payload.commandId || '');
        const cached = getCachedCommand(commandId);
        if (cached) return ok(ack, cached.result || cached);
        if (!rateOk(`gart:${uid}`, 8, 3_000)) return err(ack, 'rate', '慢一点。');
        const room = userActiveRoom(uid);
        if (!room || !room.round) return err(ack, 'no_room', '房间不在了。');
        if (room.roundPhase !== 'artist' || !room.artistPhase) {
          return err(ack, 'bad_phase', '歌手抢分已结束。');
        }
        const p = findPlayer(room, uid);
        if (!p || p.retired) return err(ack, 'not_in_room', '你不在比赛里。');
        if (p.answeredArtist) return err(ack, 'already', '你已经抢过歌手分了。');
        if (now() > room.artistDeadline + 200) {
          return err(ack, 'timeout', '手慢了。');
        }
        const optionId = String(payload.optionId || '');
        const opt = (room.artistOptions || []).find((o) => o.optionId === optionId);
        if (!opt) return err(ack, 'bad_option', '选项无效。');
        p.answeredArtist = true;
        const correct = Boolean(opt._correct);
        const delta = correct ? ARTIST_SCORE : -ARTIST_WRONG_PENALTY;
        applyMainScore(room, p, delta);
        const result = {
          correct,
          delta,
          label: opt.label,
          scores: rankPlayers(activePlayers(room)),
        };
        if (commandId) rememberCommand(commandId, result);
        // 通知公共结果（可公开选项标签）
        ioRef?.to(`guess_${room.id}`).emit('guess:artist-result', {
          userId: uid,
          nickname: p.nickname,
          correct,
          delta,
          label: opt.label,
          scores: rankPlayers(activePlayers(room)),
        });
        return ok(ack, result);
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('guess:rematch', (_payload = {}, ack) => {
      try {
        if (!rateOk(`grematch:${uid}`, 4, 5_000)) return err(ack, 'rate', '慢一点。');
        const room = userActiveRoom(uid);
        if (!room) return err(ack, 'no_room', '房间不在了。');
        if (room.status !== 'finished') return err(ack, 'bad_state', '这一局还没结束。');
        const p = findPlayer(room, uid);
        if (!p) return err(ack, 'not_in_room', '你不在这个房间里。');
        for (const pl of room.players) {
          resetPlayerForRound(pl);
          pl.score = 0;
          pl.ready = false;
        }
        room.status = 'waiting';
        room.round = null;
        room.songList = [];
        room.revealed = false;
        touch(room);
        markInviteStatus(room, 'waiting');
        broadcastInviteUpdate(room, 'rematch');
        broadcastRoom(room, 'guess:room', { rematch: true });
        return ok(ack, { room: roomSnapshot(room, uid) });
      } catch (e) {
        err(ack, 'server', e.message);
      }
    });

    socket.on('guess:ping', (payload = {}, ack) => {
      try {
        if (!rateOk(`gping:${uid}`, 30, 10_000)) return;
        const t = now();
        const res = { ok: true, serverTime: t, clientTime: payload.clientTime || t };
        if (typeof ack === 'function') ack(res);
      } catch {
        /* ignore */
      }
    });
    socket.on('guess:invite:send', (payload = {}, ack) => {
      try {
        if (!rateOk(`ginvite:${uid}`, 8, 10_000)) return err(ack, 'rate', '邀请发得太快啦。');
        const room = userActiveRoom(uid);
        if (!room) return err(ack, 'no_room', '先发起一局吧。');
        if (!findPlayer(room, uid)) return err(ack, 'not_in_room', '你不在这个房间里。');
        if (room.status !== 'waiting' && room.status !== 'finished') {
          return err(ack, 'bad_state', '现在不能发邀请了。');
        }
        const conversationId = String(payload.conversationId || '');
        if (!conversationId) return err(ack, 'bad_conv', '先选一个会话吧。');
        if (!canSendToConversation(uid, conversationId)) {
          return err(ack, 'forbidden', '这个会话发不了邀请。');
        }
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
          content: '[游戏邀请] 猜歌抢答',
          mediaType: 'guess_invite',
          ext,
        });
        invite.messageId = msg.id;
        room.invites.push(invite);
        inviteIndex.set(inviteId, room.id);
        try {
          stmts.insertGuessInvite.run(inviteId, room.id, msgConv, msg.id, uid, invite.status, t, t);
        } catch {
          /* ignore */
        }
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

    socket.on('guess:invite:join', (payload = {}, ack) => {
      try {
        const commandId = String(payload.commandId || '');
        const cached = getCachedCommand(commandId);
        if (cached) return ok(ack, cached.result);
        if (!rateOk(`gjoin:${uid}`, 10, 5_000)) return err(ack, 'rate', '慢一点点。');
        const inviteId = String(payload.inviteId || '');
        if (!inviteId) return err(ack, 'bad_invite', '邀请无效，再约一局吧。');
        let room = null;
        const invRow = (() => {
          try {
            return stmts.getGuessInvite.get(inviteId);
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
        const other = userActiveRoom(uid);
        if (other && other.id !== room.id && other.status !== 'closed' && other.status !== 'finished') {
          return err(ack, 'already_in_room', '你还在另一场，先回去看看吧。', {
            snapshot: roomSnapshot(other, uid),
            needReturn: true,
          });
        }
        // 比赛开始后不允许中途加入
        if (room.status !== 'waiting' && room.status !== 'finished') {
          return err(ack, 'already_started', '他们已经开场了，下一局再来。');
        }
        if (activePlayers(room).length >= MAX_PLAYERS) {
          return err(ack, 'full', '这里已经坐满啦，下局早点来。');
        }
        room.players.push(initialPlayer(uid, user.nickname, user.avatar, user.avatarColor));
        userRoom.set(uid, room.id);
        ensurePlayerSockets(socket, room);
        if (room.status === 'finished') {
          const p = findPlayer(room, uid);
          resetPlayerForRound(p);
          if (p) p.score = 0;
        }
        touch(room);
        if (activePlayers(room).length >= MAX_PLAYERS && room.status === 'waiting') {
          markInviteStatus(room, 'full');
        } else if (room.status === 'waiting') {
          markInviteStatus(room, 'waiting');
        }
        broadcastInviteUpdate(room, 'join');
        broadcastRoom(room, 'guess:player-update');
        const result = {
          room: roomSnapshot(room, uid),
          joined: true,
          message: '来得正好，准备开猜。',
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
      broadcastRoom(room, 'guess:player-update');
      setTimeout(() => {
        const r = rooms.get(room.id);
        if (!r) return;
        const pl = findPlayer(r, uid);
        if (pl && !pl.online) {
          if (Number(r.hostUserId) === uid && (r.status === 'waiting' || r.status === 'playing' || r.status === 'finished')) {
            transferHost(r);
            broadcastRoom(r, 'guess:player-update');
          }
        }
      }, DISCONNECT_GRACE_MS).unref?.();
    });
  });

  const timer = setInterval(() => {
    const t = now();
    for (const room of [...rooms.values()]) {
      if (room.status === 'closed') {
        if (t - (room.closedAt || room.updatedAt) > 30_000) rooms.delete(room.id);
        continue;
      }
      if (room.status === 'waiting' && t - room.updatedAt > WAITING_IDLE_MS) {
        closeRoom(room, 'idle');
        continue;
      }
      if (room.status === 'finished') {
        const anyOnline = room.players.some((p) => p.online);
        if (!anyOnline && t - room.updatedAt > FINISHED_EMPTY_MS) {
          closeRoom(room, 'finished');
        }
      }
      for (const p of room.players) {
        if (!p.online && p.disconnectedAt && t - p.disconnectedAt > DISCONNECT_GRACE_MS * 2) {
          if (room.status === 'waiting') {
            room.players = room.players.filter((x) => Number(x.userId) !== Number(p.userId));
            userRoom.delete(Number(p.userId));
            if (Number(room.hostUserId) === Number(p.userId)) transferHost(room);
            if (room.players.length === 0) closeRoom(room, 'empty');
            else {
              touch(room);
              broadcastRoom(room, 'guess:player-update');
              broadcastInviteUpdate(room, 'timeout');
            }
          }
        }
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
    roomSnapshot,
  };
}

function onMainAnswerTimeout(room, userId) {
  if (!room || room.roundPhase !== 'answering') return;
  if (Number(room.answererUserId) !== Number(userId)) return;
  const p = findPlayer(room, userId);
  if (p) {
    applyMainScore(room, p, -MAIN_WRONG_PENALTY);
    p.mainWrong = true;
    p.answeredMain = true;
  }
  room.buzzUserId = null;
  room.answererUserId = null;
  room.mainOptions = null;
  const stillCan = activePlayers(room).some((x) => !x.mainWrong && x.online);
  if (!stillCan) {
    revealMain(room, { mode: 'all_wrong' });
    return;
  }
  room.audioStartAt = now();
  setPhase(room, 'playing', now() + ROUND_MAX_MS);
  broadcastRoom(room, 'guess:wrong', {
    userId,
    nickname: p?.nickname || '',
    delta: -MAIN_WRONG_PENALTY,
    timeout: true,
    scores: rankPlayers(activePlayers(room)),
    resumeAt: room.audioStartAt,
    clipStartMs: room.round.clipStartMs,
    clipDurationMs: room.round.clipDurationMs,
  });
  clearRoomTimers(room);
  room.playTimer = setTimeout(() => onClipEnd(room), room.round.clipDurationMs + 300);
  room.playTimer.unref?.();
}

export { roomSnapshot as guessRoomSnapshot, compactInviteExt as guessInviteExt };
