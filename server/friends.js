// 好友关系 API: 列表/添加/删除/备注/黑名单/权限
import { stmts } from './db.js';
import { publicProfile } from './auth.js';

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
      res.json({
        friends: rows.map((r) => ({
          ...publicProfile(r),
          remark: r.remark || null,
          displayName: r.remark || r.nickname,
          blacklisted: Boolean(r.blacklisted),
          permission: r.permission || null,
          friendSince: r.created_at,
        })),
      });
    },
    add(req, res) {
      const friendId = Number(req.body?.friendId);
      if (!Number.isInteger(friendId) || friendId <= 0) {
        return res.status(400).json({ error: '参数不合法' });
      }
      if (friendId === req.user.id) return res.status(400).json({ error: '不能添加自己' });
      const target = stmts.userById.get(friendId);
      if (!target) return res.status(404).json({ error: '用户不存在' });
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
      res.json({ ok: true, permission });
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
