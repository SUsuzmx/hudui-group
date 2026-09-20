// 好友关系 API: 列表/添加/删除/备注/黑名单/权限
import { stmts } from './db.js';
import { publicProfile } from './auth.js';

/** 任一方拉黑即视为双向受限（微信黑名单语义） */
export function isBlockedEither(a, b) {
  const idA = Number(a);
  const idB = Number(b);
  if (!idA || !idB || idA === idB) return false;
  try {
    const f1 = stmts.getFriend.get(idA, idB);
    const f2 = stmts.getFriend.get(idB, idA);
    return Boolean(f1?.blacklisted || f2?.blacklisted);
  } catch {
    return false;
  }
}

export function tagsOfUserMap(ownerId) {
  const map = new Map();
  try {
    const tags = stmts.listTags.all(ownerId) || [];
    for (const t of tags) {
      const members = stmts.listTagMembers.all(t.id) || [];
      for (const m of members) {
        if (!map.has(m.user_id)) map.set(m.user_id, []);
        map.get(m.user_id).push({ id: t.id, name: t.name });
      }
    }
  } catch { /* ignore */ }
  return map;
}

export function createFriendsRouter({ verifyToken }) {
  function requireAuth(req, res, next) {
    const user = verifyToken(req.get('Authorization')?.replace(/^Bearer /, ''));
    if (!user) return res.status(401).json({ error: '未登录' });
    req.user = user;
    next();
  }

  function friendRow(userId, friendId) {
    return stmts.getFriend.get(userId, friendId) || null;
  }

  return {
    requireAuth,
    list(req, res) {
      const rows = stmts.listFriends.all(req.user.id);
      const tagMap = tagsOfUserMap(req.user.id);
      res.json({
        friends: rows.map((r) => ({
          ...publicProfile(r),
          remark: r.remark || null,
          displayName: r.remark || r.nickname,
          blacklisted: Boolean(r.blacklisted),
          permission: r.permission || null,
          friendSince: r.created_at,
          tags: tagMap.get(r.id) || [],
        })),
      });
    },
    add(req, res) {
      const friendId = Number(req.body?.friendId);
      if (!Number.isInteger(friendId) || friendId <= 0) {
        return res.status(400).json({ error: '参数不合法' });
      }
      if (friendId === req.user.id) return res.status(400).json({ error: '不能添加自己' });
      // AI 群友不是用户账号, 禁止加为好友
      if (friendId < 0 || req.body?.isAI || req.body?.personaId) {
        return res.status(400).json({ error: 'AI 群友仅在群聊中互动，无法添加为好友' });
      }
      const target = stmts.userById.get(friendId);
      if (!target) return res.status(404).json({ error: '用户不存在' });
      // 对方拉黑我时禁止加好友
      const peerFr = stmts.getFriend.get(friendId, req.user.id);
      if (peerFr?.blacklisted) {
        return res.status(403).json({ error: '对方设置了权限，无法添加' });
      }
      stmts.addFriend.run(req.user.id, friendId, Date.now());
      res.json({ ok: true, friend: publicProfile(target) });
    },
    remove(req, res) {
      const friendId = Number(req.body?.friendId ?? req.params.friendId);
      if (!Number.isInteger(friendId) || friendId <= 0) {
        return res.status(400).json({ error: '参数不合法' });
      }
      stmts.removeFriend.run(req.user.id, friendId);
      res.json({ ok: true });
    },
    search(req, res) {
      const q = String(req.query.q ?? '').trim();
      if (!q) return res.json({ users: [] });
      const like = `%${q}%`;
      const rows = stmts.searchUsers.all(like, like);
      const friendIds = new Set(stmts.listFriends.all(req.user.id).map((r) => r.id));
      res.json({
        users: rows
          .filter((r) => r.id !== req.user.id)
          .map((r) => ({
            ...publicProfile(r),
            isFriend: friendIds.has(r.id),
          })),
      });
    },

    /** 设置备注名 */
    setRemark(req, res) {
      const friendId = Number(req.body?.friendId);
      const remark = String(req.body?.remark ?? '').trim().slice(0, 20);
      if (!Number.isInteger(friendId) || friendId <= 0) {
        return res.status(400).json({ error: '参数不合法' });
      }
      if (!friendRow(req.user.id, friendId)) {
        return res.status(404).json({ error: '还不是好友' });
      }
      stmts.setFriendRemark.run(remark || null, req.user.id, friendId);
      const target = stmts.userById.get(friendId);
      res.json({ ok: true, remark: remark || null, displayName: remark || target?.nickname });
    },

    /** 加入/移出黑名单 */
    setBlacklist(req, res) {
      const friendId = Number(req.body?.friendId);
      const blacklisted = Boolean(req.body?.blacklisted);
      if (!Number.isInteger(friendId) || friendId <= 0) {
        return res.status(400).json({ error: '参数不合法' });
      }
      if (!friendRow(req.user.id, friendId)) {
        return res.status(404).json({ error: '还不是好友' });
      }
      stmts.setFriendBlack.run(blacklisted ? 1 : 0, req.user.id, friendId);
      // 拉黑时同步收紧朋友权限
      if (blacklisted) {
        try { stmts.setFriendPermission.run('block', req.user.id, friendId); } catch { /* ignore */ }
      } else {
        try {
          const fr = friendRow(req.user.id, friendId);
          if (fr?.permission === 'block') stmts.setFriendPermission.run('all', req.user.id, friendId);
        } catch { /* ignore */ }
      }
      res.json({ ok: true, blacklisted });
    },

    /** 朋友权限: all | chat | hide-moments | block */
    setPermission(req, res) {
      const friendId = Number(req.body?.friendId);
      const permission = String(req.body?.permission || 'all');
      const allowed = ['all', 'chat', 'hide-moments', 'block'];
      if (!allowed.includes(permission)) {
        return res.status(400).json({ error: '权限不合法' });
      }
      if (!friendRow(req.user.id, friendId)) {
        return res.status(404).json({ error: '还不是好友' });
      }
      stmts.setFriendPermission.run(permission, req.user.id, friendId);
      // block 与黑名单联动
      if (permission === 'block') stmts.setFriendBlack.run(1, req.user.id, friendId);
      if (permission !== 'block') {
        try {
          const fr = friendRow(req.user.id, friendId);
          if (fr?.blacklisted) stmts.setFriendBlack.run(0, req.user.id, friendId);
        } catch { /* ignore */ }
      }
      res.json({ ok: true, permission, blacklisted: permission === 'block' });
    },

    /** 设置好友标签（全量覆盖该好友在我的标签中的归属） */
    setFriendTags(req, res) {
      const friendId = Number(req.body?.friendId);
      const tagIds = Array.isArray(req.body?.tagIds)
        ? req.body.tagIds.map(Number).filter(Boolean)
        : [];
      if (!Number.isInteger(friendId) || friendId <= 0) {
        return res.status(400).json({ error: '参数不合法' });
      }
      if (!friendRow(req.user.id, friendId) && !stmts.userById.get(friendId)) {
        return res.status(404).json({ error: '用户不存在' });
      }
      const myTags = stmts.listTags.all(req.user.id) || [];
      const myIdSet = new Set(myTags.map((t) => t.id));
      const next = new Set(tagIds.filter((id) => myIdSet.has(id)));
      for (const t of myTags) {
        try {
          if (!next.has(t.id)) stmts.deleteTagMember.run(t.id, friendId);
          else stmts.insertTagMember.run(t.id, friendId);
        } catch { /* ignore */ }
      }
      const tags = myTags
        .filter((t) => next.has(t.id))
        .map((t) => ({ id: t.id, name: t.name }));
      res.json({ ok: true, tags });
    },

    /** 黑名单列表 */
    blacklist(req, res) {
      const rows = (stmts.listFriends.all(req.user.id) || []).filter((r) => r.blacklisted);
      res.json({
        friends: rows.map((r) => ({
          ...publicProfile(r),
          remark: r.remark || null,
          displayName: r.remark || r.nickname,
          blacklisted: true,
          permission: r.permission || null,
        })),
      });
    },

    /** 私聊已读位置 */
    privateRead(req, res) {
      const conv = String(req.body?.conversationId || '');
      if (!conv.startsWith('pv_')) return res.status(400).json({ error: '会话不合法' });
      const row = stmts.getChatRead.get(req.user.id, conv);
      const mid = stmts.maxMessageId.get(conv)?.mid || 0;
      stmts.upsertChatRead.run(req.user.id, conv, mid, 0, Date.now());
      // 对端 last_read
      let peerRead = 0;
      const parts = conv.split('_');
      try {
        if (parts[1] === 'u') {
          const a = parseInt(parts[2], 10);
          const b = parseInt(parts[3], 10);
          const peer = a === req.user.id ? b : a;
          const pr = stmts.getChatRead.get(peer, conv);
          peerRead = pr?.last_read_id || 0;
        } else {
          const other = parseInt(parts[1], 10);
          if (Number.isInteger(other) && other !== req.user.id) {
            const pr = stmts.getChatRead.get(other, conv);
            peerRead = pr?.last_read_id || 0;
          }
        }
      } catch { /* ignore */ }
      res.json({ ok: true, lastReadId: mid, peerReadId: peerRead });
    },

    /** 查询私聊对方已读位置 */
    privatePeerRead(req, res) {
      const conv = String(req.query.conversationId || req.body?.conversationId || '');
      if (!conv.startsWith('pv_')) return res.status(400).json({ error: '会话不合法' });
      const parts = conv.split('_');
      let peerId = null;
      if (parts[1] === 'u') {
        const a = parseInt(parts[2], 10);
        const b = parseInt(parts[3], 10);
        peerId = a === req.user.id ? b : a;
      } else {
        return res.json({ peerReadId: null, isAI: true });
      }
      const pr = stmts.getChatRead.get(peerId, conv);
      res.json({ peerReadId: pr?.last_read_id || 0, isAI: false });
    },

    /** 群聊已读位置 */
    groupRead(req, res) {
      const conv = String(req.body?.conversationId || 'default');
      const mid = conv === 'default'
        ? (stmts.maxMessageIdNull.get()?.mid || 0)
        : (stmts.maxMessageId.get(conv)?.mid || 0);
      stmts.upsertChatRead.run(req.user.id, conv, mid, 0, Date.now());
      try {
        const others = stmts.allUsers.all().filter((u) => u.id !== req.user.id);
        let readCount = 0;
        for (const u of others) {
          const pr = stmts.getChatRead.get(u.id, conv);
          if ((pr?.last_read_id || 0) >= mid) readCount += 1;
        }
        res.json({ ok: true, lastReadId: mid, readCount, memberCount: others.length + 1 });
      } catch {
        res.json({ ok: true, lastReadId: mid, readCount: 0, memberCount: 1 });
      }
    },

    /** 查询群聊已读概况 */
    groupPeerRead(req, res) {
      const conv = String(req.query.conversationId || req.body?.conversationId || 'default');
      const mid = conv === 'default'
        ? (stmts.maxMessageIdNull.get()?.mid || 0)
        : (stmts.maxMessageId.get(conv)?.mid || 0);
      try {
        const others = stmts.allUsers.all().filter((u) => u.id !== req.user.id);
        let readCount = 0;
        for (const u of others) {
          const pr = stmts.getChatRead.get(u.id, conv);
          if ((pr?.last_read_id || 0) >= mid) readCount += 1;
        }
        res.json({ lastReadId: mid, readCount, memberCount: others.length + 1 });
      } catch {
        res.json({ lastReadId: mid, readCount: 0, memberCount: 1 });
      }
    },
  };
}
