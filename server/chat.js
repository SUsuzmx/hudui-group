// Socket.IO 聊天处理: 多群 + 私聊。默认群可主动插话, 其他群仅在真人发言/@ 时由 AI 回应。
import { verifyToken } from './auth.js';
import { stmts } from './db.js';
import { personas, personasForGroup } from './ai/personas.js';
import { aiAvatarFile } from './ai/avatars.js';
import { groupConvId, DEFAULT_GROUP_KIND, getGroup } from './groups.js';
import { canAccessPrivate as aclCanAccessPrivate, canAccessGroup as aclCanAccessGroup } from './acl.js';
import { getBalance, credit, debit } from './wallet.js';
import {
  normalizeRedPacketInput,
  redPacketPayload,
  claimRedPacketForUser,
  RP_EXPIRE_MS,
} from './rp.js';

const rowToMsg = (r) => {
  let ext = null;
  try {
    ext = r.ext ? JSON.parse(r.ext) : null;
  } catch { ext = null; }
  return {
    id: r.id,
    senderType: r.sender_type,
    senderId: r.sender_id,
    senderName: r.sender_name,
    avatar: r.avatar,
    content: r.content,
    createdAt: r.created_at,
    mediaType: r.media_type ?? null,
    mediaUrl: r.media_url ?? null,
    conversationId: r.conversation_id ?? null,
    recalled: Boolean(r.recalled),
    ext,
    quote: r.quote_id
      ? { id: r.quote_id, name: r.quote_name || '', content: r.quote_content || '' }
      : null,
  };
};

export const MEDIA_TYPES = new Set(['image', 'voice', 'video', 'card', 'file', 'redpacket', 'transfer', 'location', 'merge', 'jielong', 'groupcollect']);
// 与 scripts/e2e-test.mjs 对齐: 60s 窗口内超过该条数则拒绝
export const MSG_RATE = { limit: 20, windowMs: 60_000 };

export function initChat(io, { config, engine }) {
  const online = new Map();
  const sendTimestamps = new Map();
  const announcedAt = new Map();
  const recentCache = [];
  const convCaches = new Map();
  const activeCalls = new Map();

  const defaultGroup = stmts.groupByKind.get(DEFAULT_GROUP_KIND);
  const defaultConvId = defaultGroup ? groupConvId(defaultGroup.id) : null;

  function cacheFor(convId) {
    if (!convId) return recentCache;
    if (!convCaches.has(convId)) convCaches.set(convId, []);
    return convCaches.get(convId);
  }

  const pushTo = (convId, row) => {
    const cache = cacheFor(convId);
    cache.push(row);
    if (cache.length > 60) cache.shift();
    return rowToMsg(row);
  };

  // 预热默认群缓存
  if (defaultConvId) {
    for (const r of stmts.groupMessages.all(defaultConvId, 60).reverse()) recentCache.push(r);
  }

  const emitGroup = (convId, msg) => {
    // 统一只发 group:message, 避免 message:new + group:message 双推导致重复
    // 默认群额外兼容仍在监听 message:new 的旧前端
    const payload = { ...msg, conversationId: convId || defaultConvId };
    if (!convId || convId === defaultConvId) {
      io.to('group').emit('group:message', payload);
      io.to('group').emit('message:new', payload);
    } else {
      io.to(convId).emit('group:message', payload);
    }
    // 给会话内其他用户累计未读 (单条 SQL, 避免按用户循环写库)
    try {
      const target = convId || defaultConvId || 'default';
      const senderId = msg?.senderId ?? -1;
      stmts.incrChatUnreadAll.run(target, Date.now(), senderId);
    } catch { /* ignore */ }
  };

  const addAIMessage = (persona, content, mediaType = null, mediaUrl = null, convId = null) => {
    const target = convId ?? defaultConvId;
    const r = stmts.insertMessage.run('ai', null, persona.name, persona.emoji, content, Date.now(), mediaType, mediaUrl, target);
    const msg = pushTo(target, stmts.messageById.get(Number(r.lastInsertRowid)));
    emitGroup(target, msg);
  };

  const addSystemMessage = (text, convId = null) => {
    const target = convId ?? defaultConvId;
    const r = stmts.insertMessage.run('system', null, '', '', text, Date.now(), null, null, target);
    const msg = pushTo(target, stmts.messageById.get(Number(r.lastInsertRowid)));
    emitGroup(target, msg);
  };

  const privateConvId = (a, b) => `pv_u_${Math.min(Number(a), Number(b))}_${Math.max(Number(a), Number(b))}`;

  const addPrivateSystemMessage = (text, convId) => {
    if (!convId) return null;
    const r = stmts.insertMessage.run('system', null, '', '', text, Date.now(), null, null, convId);
    const msg = pushTo(convId, stmts.messageById.get(Number(r.lastInsertRowid)));
    io.to(convId).emit('private:message', msg);
    try {
      const parts = String(convId).split('_');
      if (parts[1] === 'u') {
        const a = parseInt(parts[2], 10);
        const b = parseInt(parts[3], 10);
        if (Number.isInteger(a)) io.to(`user_${a}`).emit('private:message', msg);
        if (Number.isInteger(b)) io.to(`user_${b}`).emit('private:message', msg);
      } else if (parts[1]) {
        io.to(`user_${parts[1]}`).emit('private:message', msg);
      }
    } catch { /* ignore */ }
    return msg;
  };

  const fmtCallDur = (sec = 0) => {
    const s = Math.max(0, Math.floor(sec));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  const recordCallLog = (call, kind, { byUserId = null, duration = 0 } = {}) => {
    if (!call || call.callerId === call.calleeId) return;
    const conv = privateConvId(call.callerId, call.calleeId);
    const modeLabel = call.mode === 'voice' ? '语音' : '视频';
    let text = '';
    if (kind === 'reject') {
      text = `${modeLabel}通话被拒绝`;
    } else if (kind === 'cancel') {
      text = `已取消${modeLabel}通话`;
    } else if (kind === 'end') {
      text = duration > 0 ? `${modeLabel}通话 ${fmtCallDur(duration)}` : `${modeLabel}通话已结束`;
    } else if (kind === 'busy' || kind === 'offline') {
      text = `${modeLabel}通话未接通`;
    }
    if (text) addPrivateSystemMessage(text, conv);
  };

  const addPrivateAIMessage = (convId, persona, content, mediaType = null, mediaUrl = null) => {
    const r = stmts.insertMessage.run('ai', null, persona.name, persona.emoji, content, Date.now(), mediaType, mediaUrl, convId);
    const msg = pushTo(convId, stmts.messageById.get(Number(r.lastInsertRowid)));
    io.to(convId).emit('private:message', msg);
    try {
      const parts = String(convId).split('_');
      if (parts[1] === 'u') {
        const a = parseInt(parts[2], 10);
        const b = parseInt(parts[3], 10);
        const userId = a; // 约定 pv_u_min_max, 但按会话成员各自 +1
        stmts.incrChatUnread.run(a, convId, Date.now());
        stmts.incrChatUnread.run(b, convId, Date.now());
      } else {
        const userId = parseInt(parts[1], 10);
        if (Number.isInteger(userId)) stmts.incrChatUnread.run(userId, convId, Date.now());
      }
    } catch { /* ignore */ }
  };

  const membersInfo = (groupKind = null) => {
    const pool = groupKind ? personasForGroup(groupKind) : personas.filter((p) => !p.groups || p.groups.includes('main'));
    return {
      groupName: config.groupName,
      groupKind: groupKind || 'main',
      onlineUsers: [...online.values()].map((u) => ({
        nickname: u.nickname, avatarColor: u.avatarColor, avatar: u.avatar, online: true,
      })),
      aiMembers: pool.map((p) => ({
        id: p.id,
        nickname: p.name,
        avatarEmoji: p.emoji,
        avatarUrl: aiAvatarFile(p.name),
      })),
      allUsers: stmts.allUsers.all().map((u) => ({
        id: u.id,
        nickname: u.nickname,
        avatarColor: u.avatar_color,
        avatar: u.avatar,
        wxid: u.wxid,
        online: online.has(u.id),
      })),
    };
  };

  const broadcastMembers = () => io.emit('members:update', membersInfo());

  function getPersonaById(id) {
    return personas.find((p) => p.id === id);
  }

  function canAccessGroup(conversationId) {
    return aclCanAccessGroup(conversationId, (id) => stmts.groupById.get(id));
  }

  function clearedBeforeOf(userId, conv) {
    try {
      const pref = stmts.getChatPref.get(userId, conv === defaultConvId ? 'default' : conv);
      return pref?.cleared_before || 0;
    } catch {
      return 0;
    }
  }

  function filterCleared(rows, userId, conv) {
    const cleared = clearedBeforeOf(userId, conv);
    if (!cleared) return rows;
    return rows.filter((r) => r.id > cleared);
  }

  io.use((socket, next) => {
    const user = verifyToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('登录已过期, 请重新登录'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    let entry = online.get(user.id);
    if (entry) entry.conns += 1;
    else {
      entry = { nickname: user.nickname, avatarColor: user.avatarColor, avatar: user.avatar, conns: 1 };
      online.set(user.id, entry);
    }
    socket.join('group');
    if (defaultConvId) socket.join(defaultConvId);
    // 信令房间: 用于点对点呼叫
    socket.join(`user_${user.id}`);
    broadcastMembers();

    if (socket.handshake.auth?.announce && defaultConvId) {
      const last = announcedAt.get(user.id) ?? 0;
      if (Date.now() - last > 86400_000) {
        announcedAt.set(user.id, Date.now());
        addSystemMessage(`欢迎新成员「${user.nickname}」加入群聊`, defaultConvId);
        engine.onUserJoin(user);
      }
    }

    // ── 群聊 ──
    socket.on('group:join', (conversationId) => {
      if (!canAccessGroup(conversationId)) return;
      socket.join(conversationId);
      const g = getGroup(Number(String(conversationId).replace(/^grp_/, '')));
      if (g) socket.emit('members:update', membersInfo(g.kind));
    });

    socket.on('history:load', ({ beforeId, conversationId } = {}, ack) => {
      if (typeof ack !== 'function') return;
      const conv = conversationId || defaultConvId;
      if (!conv) return ack([]);
      const isPrivate = String(conv).startsWith('pv_');
      if (isPrivate) {
        if (!canAccessPrivate(conv)) return ack([]);
      } else if (conv !== defaultConvId && !canAccessGroup(conv)) {
        return ack([]);
      }

      let rows;
      if (conv === defaultConvId) {
        // 默认群: 同时兼容历史 NULL conversation_id 与 grp_N
        const a = beforeId
          ? stmts.groupMessagesBefore.all(conv, beforeId, 50)
          : stmts.groupMessages.all(conv, 50);
        const b = beforeId
          ? stmts.recentMessages.all(beforeId, 50)
          : stmts.lastMessages.all(50);
        const map = new Map();
        for (const r of [...a, ...b]) map.set(r.id, r);
        rows = [...map.values()].sort((x, y) => y.id - x.id).slice(0, 50);
      } else {
        rows = beforeId
          ? stmts.groupMessagesBefore.all(conv, beforeId, 50)
          : stmts.groupMessages.all(conv, 50);
      }
      ack(filterCleared(rows, user.id, conv).reverse().map(rowToMsg));
    });

    socket.on('message:send', (payload, ack) => {
      // 兼容旧签名: message:send(content, ack)
      let content = payload;
      let conversationId = defaultConvId;
      let quote = null;
      let mediaType = null;
      let mediaUrl = null;
      let ext = null;
      if (payload && typeof payload === 'object') {
        content = payload.content;
        conversationId = payload.conversationId || defaultConvId;
        mediaType = MEDIA_TYPES.has(payload.mediaType) ? payload.mediaType : null;
        mediaUrl = typeof payload.mediaUrl === 'string' && (payload.mediaUrl.startsWith('/media/') || payload.mediaUrl.startsWith('/avatars/')) ? payload.mediaUrl : null;
        if (payload.ext && typeof payload.ext === 'object') ext = payload.ext;
        if (payload.quote && typeof payload.quote === 'object') {
          quote = {
            id: Number(payload.quote.id) || null,
            name: String(payload.quote.name || '').slice(0, 40),
            content: String(payload.quote.content || '').slice(0, 80),
          };
          if (!quote.id) quote = null;
        }
      }
      content = typeof content === 'string' ? content.trim() : '';
      const extJson = ext ? JSON.stringify(ext).slice(0, 800) : null;
      // 卡片/红包/转账/位置等可无 mediaUrl
      if ((!content && !mediaUrl && !extJson && !['redpacket', 'transfer', 'location', 'card', 'jielong', 'groupcollect', 'merge'].includes(mediaType || '')) || content.length > 2000) {
        if (typeof ack === 'function') ack({ error: '消息内容不合法' });
        return;
      }
      if (!mediaUrl && !['image', 'voice', 'video', 'file'].includes(mediaType || '')) {
        // 非文件类媒体不需要 url
      } else if (!mediaUrl) {
        mediaType = null;
      }
      if (conversationId !== defaultConvId && !canAccessGroup(conversationId)) {
        if (typeof ack === 'function') ack({ error: '无效的群聊' });
        return;
      }
      const now = Date.now();
      // 按用户限流, 断线重连无法绕过
      const ts = (sendTimestamps.get(user.id) ?? []).filter((t) => now - t < MSG_RATE.windowMs);
      ts.push(now);
      sendTimestamps.set(user.id, ts);
      if (ts.length > MSG_RATE.limit) {
        if (typeof ack === 'function') ack({ error: '发太快啦, 休息一下' });
        return;
      }

      if (conversationId !== defaultConvId) socket.join(conversationId);

      const text = content || (
        mediaType === 'image' ? '[图片]'
        : mediaType === 'voice' ? '[语音]'
        : mediaType === 'file' ? `[文件]${ext?.name || ''}`
        : mediaType === 'card' ? '[名片]'
        : mediaType === 'redpacket' ? '[微信红包]'
        : mediaType === 'transfer' ? '[转账]'
        : mediaType === 'location' ? '[位置]'
        : mediaType === 'jielong' ? `接龙\n${String(ext?.title || content || '').slice(0, 80)}`
        : mediaType === 'groupcollect' ? `[群收款]${ext?.note || ''}`
        : ''
      );
      const r = quote
        ? stmts.insertMessageQuote.run('user', user.id, user.nickname, user.avatar || user.avatarColor, text, now, mediaType, mediaUrl, conversationId, quote.id, quote.name, quote.content)
        : stmts.insertMessage.run('user', user.id, user.nickname, user.avatar || user.avatarColor, text, now, mediaType, mediaUrl, conversationId);
      const mid = Number(r.lastInsertRowid);
      if (extJson) {
        try { stmts.updateMessageExt.run(extJson, mid); } catch { /* ignore */ }
      }
      const msg = pushTo(conversationId, stmts.messageById.get(mid));
      emitGroup(conversationId, msg);
      if (typeof ack === 'function') ack({ ok: true, id: msg.id });

      // 红包/转账落库 + 演示钱包扣款
      let extWithId = ext ? { ...ext } : null;
      try {
        if (mediaType === 'redpacket' && ext) {
          const norm = normalizeRedPacketInput(ext);
          if (norm.error) {
            if (typeof ack === 'function') ack({ error: norm.error });
            stmts.recallMessage.run(norm.error, mid, user.id);
            return;
          }
          const amount = norm.totalAmount;
          const bal = debit(user.id, amount, {
            type: 'redpacket_send',
            note: norm.note,
            refType: 'message',
            refId: mid,
          });
          if (!bal.ok) {
            if (typeof ack === 'function') ack({ error: bal.error || '零钱不足' });
            stmts.recallMessage.run('红包发送失败：零钱不足', mid, user.id);
            return;
          }
          const pr = stmts.insertRedPacket.run(
            mid, user.id, conversationId, amount, norm.note, now,
            norm.rpType, amount, norm.count, amount, norm.cover, now + RP_EXPIRE_MS
          );
          const packetId = Number(pr.lastInsertRowid);
          const coverPayload = redPacketPayload(stmts.getRedPacket.get(packetId));
          extWithId = {
            ...ext,
            ...coverPayload,
            packetId,
            status: 'pending',
            balance: bal.balance,
            amount,
            note: norm.note,
          };
          try { stmts.updateMessageExt.run(JSON.stringify(extWithId).slice(0, 800), mid); } catch { /* ignore */ }
        }
        if (mediaType === 'transfer' && ext) {
          const amount = Math.max(0.01, Math.round((Number(ext.amount) || 0.01) * 100) / 100);
          const bal = debit(user.id, amount, {
            type: 'transfer_send',
            note: String(ext.note || '').slice(0, 30),
            refType: 'message',
            refId: mid,
          });
          if (!bal.ok) {
            if (typeof ack === 'function') ack({ error: bal.error || '零钱不足' });
            stmts.recallMessage.run('转账发送失败：零钱不足', mid, user.id);
            return;
          }
          const tr = stmts.insertTransfer.run(mid, user.id, conversationId, amount, String(ext.note || '').slice(0, 30), now);
          const transferId = Number(tr.lastInsertRowid);
          let toUserId = null;
          if (String(conversationId).startsWith('pv_')) {
            const parts = String(conversationId).split('_');
            if (parts[1] === 'u') {
              const a = parseInt(parts[2], 10);
              const b = parseInt(parts[3], 10);
              toUserId = a === user.id ? b : a;
            }
          }
          extWithId = {
            ...ext,
            amount,
            transferId,
            status: 'pending',
            toUserId,
            balance: bal.balance,
            expiredAt: now + 24 * 60 * 60 * 1000,
          };
          if (toUserId) {
            try { stmts.updateTransferTarget.run(toUserId, 'pending', transferId); } catch { /* ignore */ }
          }
          try { stmts.updateMessageExt.run(JSON.stringify(extWithId).slice(0, 800), mid); } catch { /* ignore */ }
        }
      } catch { /* ignore */ }

      if (extWithId && (mediaType === 'redpacket' || mediaType === 'transfer')) {
        const msg2 = stmts.messageById.get(mid);
        const payload2 = pushTo(conversationId, msg2);
        // 补发一次带 ext 的消息更新
        if (String(conversationId).startsWith('pv_')) {
          io.to(conversationId).emit('private:message', payload2);
        } else {
          emitGroup(conversationId, payload2);
        }
      }

      // 纯媒体消息不触发 AI 接话
      if (!mediaType) {
        const group = getGroup(Number(String(conversationId).replace(/^grp_/, '')));
        engine.onUserMessage(msg, {
          conversationId,
          isDefault: !group || group.isDefault,
          groupName: group?.name,
        });
      }
    });

    // 领取红包
    socket.on('redpacket:claim', ({ messageId, packetId } = {}, ack) => {
      const pid = Number(packetId || 0);
      let packet = pid ? stmts.getRedPacket.get(pid) : null;
      if (!packet && messageId) {
        const mid = Number(messageId);
        const row = stmts.messageById.get(mid);
        if (row?.ext) {
          try {
            const e = JSON.parse(row.ext);
            if (e.packetId) packet = stmts.getRedPacket.get(Number(e.packetId));
          } catch { /* ignore */ }
        }
      }
      const result = claimRedPacketForUser({
        packet,
        user,
        log: (m) => { try { console.log(m); } catch { /* ignore */ } },
      });
      // 更新聊天消息 ext 状态
      if (result.ok || result.status) {
        try {
          const mid = Number(messageId || 0);
          const row = mid ? stmts.messageById.get(mid) : (packet?.message_id ? stmts.messageById.get(packet.message_id) : null);
          if (row) {
            const e = { ...(JSON.parse(row.ext || '{}') || {}), status: result.status || 'claimed', amount: result.amount };
            const p = result.payload || redPacketPayload(stmts.getRedPacket.get(packet?.id));
            if (p) Object.assign(e, p, { packetId: p.packetId || packet?.id });
            stmts.updateMessageExt.run(JSON.stringify(e).slice(0, 800), row.id);
            const msg = pushTo(row.conversation_id || defaultConvId, stmts.messageById.get(row.id));
            if (String(row.conversation_id || '').startsWith('pv_')) {
              io.to(row.conversation_id).emit('private:message', msg);
            } else {
              emitGroup(row.conversation_id || defaultConvId, msg);
            }
          }
        } catch { /* ignore */ }
      }
      if (typeof ack === 'function') {
        if (result.error && !result.ok) {
          ack({ error: result.error, status: result.status, amount: result.payload?.claims?.[0]?.amount, claimedBy: result.payload?.claimedBy, payload: result.payload });
        } else {
          ack({
            ok: true,
            amount: result.amount,
            status: result.status,
            balance: getBalance(user.id),
            isBest: result.isBest,
            payload: result.payload,
            claimed: true,
          });
        }
      }
    });

    // 确认收款转账
    socket.on('transfer:claim', ({ messageId, transferId } = {}, ack) => {
      const tid = Number(transferId || 0);
      let tr = tid ? stmts.getTransfer.get(tid) : null;
      if (!tr && messageId) {
        const row = stmts.messageById.get(Number(messageId));
        if (row?.ext) {
          try {
            const e = JSON.parse(row.ext);
            if (e.transferId) tr = stmts.getTransfer.get(Number(e.transferId));
          } catch { /* ignore */ }
        }
      }
      if (!tr) {
        if (typeof ack === 'function') ack({ error: '转账不存在' });
        return;
      }
      if (tr.from_id === user.id) {
        if (typeof ack === 'function') ack({ error: '不能确认自己的转账' });
        return;
      }
      if (tr.status !== 'pending') {
        if (typeof ack === 'function') ack({ error: '转账已处理', status: tr.status });
        return;
      }
      // 群聊: 任何人可领; 私聊: 仅对方
      if (tr.to_user_id && tr.to_user_id !== user.id) {
        if (typeof ack === 'function') ack({ error: '不是发给你的转账' });
        return;
      }
      stmts.claimTransfer.run(user.id, tr.id, user.id);
      credit(user.id, tr.amount, {
        type: 'transfer_claim',
        note: tr.note || '确认收款',
        peerId: tr.from_id,
        refType: 'transfer',
        refId: tr.id,
      });
      if (typeof ack === 'function') ack({
        ok: true,
        amount: tr.amount,
        balance: getBalance(user.id),
      });
    });

    // 撤回 (2 分钟内, 仅本人)
    socket.on('message:recall', ({ id, conversationId } = {}, ack) => {
      if (!id) {
        if (typeof ack === 'function') ack({ error: '参数不合法' });
        return;
      }
      const row = stmts.messageById.get(Number(id));
      if (!row) {
        if (typeof ack === 'function') ack({ error: '消息不存在' });
        return;
      }
      if (row.sender_id !== user.id || row.sender_type !== 'user') {
        if (typeof ack === 'function') ack({ error: '只能撤回自己的消息' });
        return;
      }
      if (Date.now() - row.created_at > 120_000) {
        if (typeof ack === 'function') ack({ error: '超过2分钟不能撤回' });
        return;
      }
      const conv = row.conversation_id || conversationId || defaultConvId;
      // 其他人看到「xxx撤回了一条消息」; 前端对本人显示「你撤回了一条消息」
      stmts.recallMessage.run(`${user.nickname}撤回了一条消息`, row.id, user.id);
      const updated = stmts.messageById.get(row.id);
      const msg = pushTo(conv, updated);
      if (String(conv).startsWith('pv_')) {
        io.to(conv).emit('private:message', msg);
      } else {
        emitGroup(conv, msg);
        io.to(conv === defaultConvId ? 'group' : conv).emit('group:message', { ...msg, conversationId: conv });
      }
      if (typeof ack === 'function') ack({ ok: true, message: msg });
    });

    // 转发: 把消息复制到目标会话
    function canSendToConv(conv) {
      if (typeof conv !== 'string' || !conv.startsWith('pv_') && !conv.startsWith('grp_')) {
        return conv === defaultConvId;
      }
      if (conv.startsWith('grp_')) return canAccessGroup(conv) || conv === defaultConvId;
      const parts = conv.split('_');
      if (parts[1] === 'u') {
        const a = parseInt(parts[2], 10);
        const b = parseInt(parts[3], 10);
        return user.id === a || user.id === b;
      }
      // pv_{myId}_ai_{personaId}
      return parseInt(parts[1], 10) === user.id;
    }

    socket.on('message:forward', ({ ids, toConversationId } = {}, ack) => {
      const list = Array.isArray(ids) ? ids.map(Number).filter(Boolean).slice(0, 20) : [];
      const target = typeof toConversationId === 'string' && toConversationId ? toConversationId : defaultConvId;
      if (!list.length) {
        if (typeof ack === 'function') ack({ error: '请选择要转发的消息' });
        return;
      }
      if (!canSendToConv(target)) {
        if (typeof ack === 'function') ack({ error: '无权转发到该会话' });
        return;
      }

      const rows = [];
      for (const mid of list) {
        const r = stmts.messageById.get(mid);
        if (!r || r.recalled || r.sender_type === 'system') continue;
        rows.push(r);
      }
      if (!rows.length) {
        if (typeof ack === 'function') ack({ error: '没有可转发的消息' });
        return;
      }

      if (target !== defaultConvId) {
        if (target.startsWith('grp_')) socket.join(target);
        if (target.startsWith('pv_')) socket.join(target);
      }

      const now = Date.now();
      const sent = [];
      if (rows.length === 1) {
        const r = rows[0];
        const content = r.content || (r.media_type === 'image' ? '[图片]' : r.media_type === 'voice' ? '[语音]' : '转发消息');
        const nr = stmts.insertMessage.run(
          'user', user.id, user.nickname, user.avatar || user.avatarColor,
          content, now, r.media_type, r.media_url, target
        );
        const msg = pushTo(target, stmts.messageById.get(Number(nr.lastInsertRowid)));
        if (target.startsWith('pv_')) io.to(target).emit('private:message', msg);
        else emitGroup(target, msg);
        sent.push(msg.id);
      } else {
        // 合并转发卡片
        const mergeItems = rows.slice(0, 30).map((r) => ({
          name: r.sender_name,
          content: r.content || (r.media_type ? `[${r.media_type === 'image' ? '图片' : r.media_type === 'voice' ? '语音' : r.media_type}]` : ''),
          mediaType: r.media_type || null,
          mediaUrl: r.media_url || null,
          createdAt: r.created_at,
        }));
        const lines = mergeItems.map((x) => `${x.name}: ${x.content}`);
        const content = `「聊天记录」\n${lines.join('\n')}`.slice(0, 1800);
        const extJson = JSON.stringify({ mergeItems, count: mergeItems.length }).slice(0, 700);
        const nr = stmts.insertMessage.run(
          'user', user.id, user.nickname, user.avatar || user.avatarColor,
          content, now, 'merge', null, target
        );
        const mid = Number(nr.lastInsertRowid);
        try { stmts.updateMessageExt.run(extJson, mid); } catch { /* ignore */ }
        const msg = pushTo(target, stmts.messageById.get(mid));
        if (target.startsWith('pv_')) io.to(target).emit('private:message', msg);
        else emitGroup(target, msg);
        sent.push(msg.id);
      }

      if (typeof ack === 'function') ack({ ok: true, ids: sent, conversationId: target });
    });

    // 正在输入
    socket.on('typing:start', ({ conversationId } = {}) => {
      const conv = conversationId || defaultConvId;
      const target = conv === defaultConvId ? 'group' : conv;
      socket.to(target).emit('typing:start', {
        conversationId: conv,
        name: user.nickname,
      });
    });
    socket.on('typing:stop', ({ conversationId } = {}) => {
      const conv = conversationId || defaultConvId;
      const target = conv === defaultConvId ? 'group' : conv;
      socket.to(target).emit('typing:stop', {
        conversationId: conv,
        name: user.nickname,
      });
    });

    // 拍一拍
    socket.on('message:pat', ({ conversationId, targetName } = {}, ack) => {
      const conv = conversationId || defaultConvId;
      if (conv !== defaultConvId && !canAccessGroup(conv)) {
        if (typeof ack === 'function') ack({ error: '无效会话' });
        return;
      }
      const target = String(targetName || '').slice(0, 20);
      if (!target || target === user.nickname) {
        if (typeof ack === 'function') ack({ error: '不能拍自己' });
        return;
      }
      if (conv !== defaultConvId) socket.join(conv);
      addSystemMessage(`「${user.nickname}」拍了拍「${target}」`, conv);
      if (typeof ack === 'function') ack({ ok: true });
    });

    // ── 私聊 ──
    function canAccessPrivate(conversationId) {
      return aclCanAccessPrivate(user.id, conversationId);
    }

    socket.on('private:join', (conversationId) => {
      if (!canAccessPrivate(conversationId)) return;
      socket.join(conversationId);
    });

    socket.on('private:history', ({ conversationId, beforeId } = {}, ack) => {
      if (typeof ack !== 'function') return;
      if (!canAccessPrivate(conversationId)) return ack([]);
      const rows = beforeId
        ? stmts.privateMessagesBefore.all(conversationId, beforeId, 50)
        : stmts.privateMessages.all(conversationId, 50);
      ack(filterCleared(rows, user.id, conversationId).reverse().map(rowToMsg));
    });

    socket.on('private:send', ({ conversationId, content, quote, mediaType, mediaUrl, ext }, ack) => {
      if (!canAccessPrivate(conversationId)) {
        if (typeof ack === 'function') ack({ error: '无权发送' });
        return;
      }
      const nowTs = Date.now();
      const rateTs = (sendTimestamps.get(user.id) ?? []).filter((t) => nowTs - t < MSG_RATE.windowMs);
      rateTs.push(nowTs);
      sendTimestamps.set(user.id, rateTs);
      if (rateTs.length > MSG_RATE.limit) {
        if (typeof ack === 'function') ack({ error: '发太快啦, 休息一下' });
        return;
      }
      content = typeof content === 'string' ? content.trim() : '';
      let mType = mediaType === 'image' || mediaType === 'voice' ? mediaType : null;
      if (['redpacket', 'transfer', 'card', 'file'].includes(mediaType)) mType = mediaType;
      let mUrl = typeof mediaUrl === 'string' && mediaUrl.startsWith('/media/') ? mediaUrl : null;
      if (['image', 'voice', 'video', 'file'].includes(mType) && !mUrl) mType = null;
      if ((!content && !mUrl && !['redpacket', 'transfer', 'card'].includes(mType || '')) || content.length > 2000) {
        if (typeof ack === 'function') ack({ error: '消息内容不合法' });
        return;
      }

      const now = Date.now();
      const parts = conversationId.split('_');
      const personaId = parts[1] === 'u' ? null : parts[3];
      const persona = personaId ? getPersonaById(personaId) : null;

      let q = null;
      if (quote && typeof quote === 'object') {
        const qid = Number(quote.id) || null;
        if (qid) {
          q = {
            id: qid,
            name: String(quote.name || '').slice(0, 40),
            content: String(quote.content || '').slice(0, 80),
          };
        }
      }

      const text = content || (
        mType === 'image' ? '[图片]'
        : mType === 'voice' ? '[语音]'
        : mType === 'redpacket' ? '[微信红包]'
        : mType === 'transfer' ? '[转账]'
        : ''
      );

      // 红包/转账: 先校验与扣款, 失败直接 ack, 不写脏消息
      let preExt = null;
      if (mType === 'redpacket' && ext) {
        const norm = normalizeRedPacketInput(ext);
        if (norm.error) {
          if (typeof ack === 'function') ack({ error: norm.error });
          return;
        }
        const bal = debit(user.id, norm.totalAmount, {
          type: 'redpacket_send',
          note: norm.note,
          refType: 'pending',
          refId: null,
        });
        if (!bal.ok) {
          if (typeof ack === 'function') ack({ error: bal.error || '零钱不足' });
          return;
        }
        preExt = { ...ext, ...norm, balance: bal.balance };
      }
      if (mType === 'transfer' && ext) {
        const amount = Math.max(0.01, Math.round((Number(ext.amount) || 0) * 100) / 100);
        const bal = debit(user.id, amount, {
          type: 'transfer_send',
          note: String(ext.note || '').slice(0, 30),
          refType: 'pending',
          refId: null,
        });
        if (!bal.ok) {
          if (typeof ack === 'function') ack({ error: bal.error || '零钱不足' });
          return;
        }
        preExt = { ...ext, amount, balance: bal.balance };
      }

      const r = q
        ? stmts.insertMessageQuote.run('user', user.id, user.nickname, user.avatar || user.avatarColor, text, now, mType, mUrl, conversationId, q.id, q.name, q.content)
        : stmts.insertMessage.run('user', user.id, user.nickname, user.avatar || user.avatarColor, text, now, mType, mUrl, conversationId);
      const mid = Number(r.lastInsertRowid);
      let extWithId = preExt;
      try {
        if (mType === 'redpacket' && preExt) {
          const norm = normalizeRedPacketInput(preExt);
          const amount = norm.totalAmount;
          const pr = stmts.insertRedPacket.run(
            mid, user.id, conversationId, amount, norm.note, now,
            norm.rpType, amount, norm.count, amount, norm.cover, now + RP_EXPIRE_MS
          );
          const packetId = Number(pr.lastInsertRowid);
          const coverPayload = redPacketPayload(stmts.getRedPacket.get(packetId));
          extWithId = {
            ...preExt,
            ...coverPayload,
            packetId,
            status: 'pending',
            amount,
            note: norm.note,
          };
          try { stmts.updateMessageExt.run(JSON.stringify(extWithId).slice(0, 800), mid); } catch { /* ignore */ }
        }
        if (mType === 'transfer' && preExt) {
          const amount = preExt.amount;
          const tr = stmts.insertTransfer.run(mid, user.id, conversationId, amount, String(preExt.note || '').slice(0, 30), now);
          const transferId = Number(tr.lastInsertRowid);
          let toUserId = null;
          if (String(conversationId).startsWith('pv_')) {
            const pp = String(conversationId).split('_');
            if (pp[1] === 'u') {
              const u1 = parseInt(pp[2], 10);
              const u2 = parseInt(pp[3], 10);
              toUserId = u1 === user.id ? u2 : u1;
            } else if (pp[1] === 'ai') {
              toUserId = null;
            }
          }
          extWithId = {
            ...preExt,
            transferId,
            status: 'pending',
            toUserId,
            expiredAt: now + 24 * 60 * 60 * 1000,
          };
          if (toUserId) {
            try { stmts.updateTransferTarget.run(toUserId, 'pending', transferId); } catch { /* ignore */ }
          }
          try { stmts.updateMessageExt.run(JSON.stringify(extWithId).slice(0, 800), mid); } catch { /* ignore */ }
        }
      } catch (e) {
        console.log('private pay persist', e.message);
      }

      const msg = pushTo(conversationId, stmts.messageById.get(mid));
      io.to(conversationId).emit('private:message', msg);
      if (extWithId) {
        try {
          const msg2 = pushTo(conversationId, stmts.messageById.get(mid));
          io.to(conversationId).emit('private:message', msg2);
        } catch { /* ignore */ }
      }
      if (typeof ack === 'function') ack({ ok: true, id: mid });

      // 对端累计未读
      try {
        const pp = conversationId.split('_');
        if (pp[1] === 'u') {
          const a = parseInt(pp[2], 10);
          const b = parseInt(pp[3], 10);
          const peer = a === user.id ? b : a;
          if (Number.isInteger(peer) && peer !== user.id) {
            stmts.incrChatUnread.run(peer, conversationId, Date.now());
          }
        }
      } catch { /* ignore */ }

      if (persona && !mType) {
        engine.onPrivateMessage(user, persona, conversationId, msg);
      }
    });

    // 私聊正在输入
    socket.on('private:typing', ({ conversationId, typing } = {}) => {
      if (!canAccessPrivate(conversationId)) return;
      socket.to(conversationId).emit('private:typing', {
        conversationId,
        name: user.nickname,
        typing: typing !== false,
      });
    });

    socket.on('disconnect', () => {
      const entry = online.get(user.id);
      if (entry) {
        entry.conns -= 1;
        if (entry.conns <= 0) online.delete(user.id);
      }
      broadcastMembers();
    });

    // ── WebRTC 音视频通话信令 ──
    // activeCalls: callId -> { callerId, calleeId, mode }
    const callKey = (id) => String(id || '');

    socket.on('call:invite', ({ toUserId, mode = 'video', callId } = {}, ack) => {
      const callee = Number(toUserId);
      const cid = callKey(callId) || `c_${user.id}_${callee}_${Date.now()}`;
      if (!Number.isInteger(callee) || callee <= 0 || callee === user.id) {
        if (typeof ack === 'function') ack({ error: '无法呼叫该用户' });
        return;
      }
      if (!online.has(callee)) {
        recordCallLog({ callerId: user.id, calleeId: callee, mode: mode === 'voice' ? 'voice' : 'video' }, 'offline');
        if (typeof ack === 'function') ack({ error: '对方不在线' });
        return;
      }
      activeCalls.set(cid, {
        callId: cid,
        callerId: user.id,
        calleeId: callee,
        mode: mode === 'voice' ? 'voice' : 'video',
        createdAt: Date.now(),
      });
      io.to(`user_${callee}`).emit('call:incoming', {
        callId: cid,
        mode: mode === 'voice' ? 'voice' : 'video',
        from: {
          userId: user.id,
          nickname: user.nickname,
          avatar: user.avatar,
          avatarColor: user.avatarColor,
        },
      });
      if (typeof ack === 'function') ack({ ok: true, callId: cid });
    });

    socket.on('call:accept', ({ callId } = {}, ack) => {
      const cid = callKey(callId);
      const call = activeCalls.get(cid);
      if (!call || call.calleeId !== user.id) {
        if (typeof ack === 'function') ack({ error: '通话不存在' });
        return;
      }
      call.state = 'accepted';
      call.acceptedAt = Date.now();
      io.to(`user_${call.callerId}`).emit('call:accepted', { callId: cid });
      if (typeof ack === 'function') ack({ ok: true, callId: cid, mode: call.mode });
    });

    socket.on('call:reject', ({ callId } = {}, ack) => {
      const cid = callKey(callId);
      const call = activeCalls.get(cid);
      if (!call || (call.calleeId !== user.id && call.callerId !== user.id)) {
        if (typeof ack === 'function') ack({ error: '通话不存在' });
        return;
      }
      const other = call.callerId === user.id ? call.calleeId : call.callerId;
      activeCalls.delete(cid);
      io.to(`user_${other}`).emit('call:rejected', { callId: cid });
      recordCallLog(call, 'reject', { byUserId: user.id });
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('call:end', ({ callId, duration } = {}, ack) => {
      const cid = callKey(callId);
      const call = activeCalls.get(cid);
      if (call) {
        // 通知双方，保证两边都能关掉通话页
        activeCalls.delete(cid);
        const payload = { callId: cid, by: user.id };
        io.to(`user_${call.callerId}`).emit('call:ended', payload);
        io.to(`user_${call.calleeId}`).emit('call:ended', payload);
        const dur = Number(duration) || (call.acceptedAt ? Math.round((Date.now() - call.acceptedAt) / 1000) : 0);
        if (call.state === 'accepted') {
          recordCallLog(call, 'end', { duration: dur });
        } else {
          recordCallLog(call, 'cancel', { byUserId: user.id });
        }
      }
      if (typeof ack === 'function') ack({ ok: true });
    });

    const relay = (event) => (payload = {}, ack) => {
      const cid = callKey(payload?.callId);
      const call = activeCalls.get(cid);
      if (!call || (call.callerId !== user.id && call.calleeId !== user.id)) {
        if (typeof ack === 'function') ack({ error: '通话不存在' });
        return;
      }
      const other = call.callerId === user.id ? call.calleeId : call.callerId;
      io.to(`user_${other}`).emit(event, {
        callId: cid,
        sdp: payload.sdp || null,
        candidate: payload.candidate || null,
      });
      if (typeof ack === 'function') ack({ ok: true });
    };

    socket.on('call:offer', relay('call:offer'));
    socket.on('call:answer', relay('call:answer'));
    socket.on('call:ice', relay('call:ice'));
  });

  return {
    addAIMessage,
    addSystemMessage,
    addPrivateSystemMessage,
    addPrivateAIMessage,
    getRecentContext: (n) => recentCache.slice(-n),
    getConvContext: (convId, n) => (convCaches.get(convId) ?? []).slice(-n),
    getPrivateContext: (convId, n) => (convCaches.get(convId) ?? []).slice(-n),
    membersInfo,
    defaultConvId,
    emitMomentsEvent: (payload) => {
      try {
        io.emit('moments:update', payload);
      } catch { /* ignore */ }
    },
  };
}
