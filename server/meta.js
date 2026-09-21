// 会话偏好 / 未读 / 好友申请 / 标签 / 收藏 / 公众号 API
import { stmts } from './db.js';
import { publicProfile } from './auth.js';
import { listGroups, groupConvId, getGroup } from './groups.js';
import { personas } from './ai/personas.js';
import { aiAvatarFile } from './ai/avatars.js';
import { canAccessConversation } from './acl.js';

function normConv(id) {
  return id === null || id === undefined || id === '' ? 'default' : String(id);
}

function getPrefs(userId, conv) {
  const row = stmts.getChatPref.get(userId, conv);
  if (!row) {
    return { muted: 0, pinned: 0, folded: 0, draft: '', bg_key: null, extra: {} };
  }
  let extra = {};
  try { extra = row.extra ? JSON.parse(row.extra) : {}; } catch { extra = {}; }
  return { ...row, extra };
}

function parseExtra(val) {
  if (val == null) return null;
  if (typeof val === 'string') return val.slice(0, 800);
  try { return JSON.stringify(val).slice(0, 800); } catch { return null; }
}

export function getUserSettings(userId) {
  try {
    const r = stmts.getUserSettingsRaw.get(userId);
    return r?.settings ? JSON.parse(r.settings) : {};
  } catch { return {}; }
}

export function setUserSettings(userId, patch) {
  const cur = getUserSettings(userId);
  const next = { ...cur, ...patch };
  // 只保留可识别键
  const ALLOW = new Set([
    'allowFriendReq', 'searchMobile', 'searchWxid', 'addByGroup', 'addByQr', 'addByCard',
    'strangerSee10', 'momentsPublic', 'multiLogin', 'autoDownload', 'voiceInput', 'haptic',
    'voiceLock', 'msgPreview',
  ]);
  const clean = {};
  for (const [k, v] of Object.entries(next)) {
    if (ALLOW.has(k)) clean[k] = Boolean(v);
  }
  stmts.setUserSettings.run(JSON.stringify(clean), userId);
  return clean;
}

function getUnread(userId, conv) {
  const row = stmts.getChatRead.get(userId, conv);
  const lastReadId = row?.last_read_id || 0;
  try {
    const n = conv === 'default'
      ? (stmts.countUnreadNull.get(lastReadId)?.n || 0)
      : (stmts.countUnread.get(conv, lastReadId)?.n || 0);
    return n;
  } catch {
    return row?.unread || 0;
  }
}

export function createMetaRouter({ verifyToken, notify } = {}) {
  function requireAuth(req, res, next) {
    const user = verifyToken(req.get('Authorization')?.replace(/^Bearer /, ''));
    if (!user) return res.status(401).json({ error: '未登录' });
    req.user = user;
    next();
  }

  function mergeChatsWithMeta(userId) {
    const chats = [];

    for (const g of listGroups()) {
      const conv = g.conversationId || groupConvId(g.id);
      const prefRow = stmts.getChatPref.get(userId, conv);
      const prefs = prefRow || { muted: 0, pinned: 0, folded: 0, draft: '', bg_key: null, cleared_before: 0 };
      let prefExtra = {};
      try { prefExtra = prefs.extra ? JSON.parse(prefs.extra) : {}; } catch { prefExtra = {}; }
      // 「不显示该聊天」: 持续隐藏, 直到用户主动打开会话
      if (prefExtra.hidden) continue;
      const unread = getUnread(userId, conv);
      // 默认主群: 无偏好时默认置顶
      const pinned = prefRow ? Boolean(prefRow.pinned) : Boolean(g.isDefault);
      const cleared = Number(prefs.cleared_before || 0);
      const lastId = g.lastId || 0;
      const lastVisible = !cleared || lastId > cleared;
      const aiAvatars = g.isDefault
        ? personas.slice(0, 9).map((p) => aiAvatarFile(p.name) ?? p.emoji)
        : (g.avatars || []).slice(0, 9);
      chats.push({
        id: conv,
        type: 'group',
        groupId: g.id,
        kind: g.kind,
        name: g.name,
        avatars: aiAvatars.length ? aiAvatars : ['👥'],
        lastMessage: lastVisible ? g.lastMessage : '暂无消息',
        lastTime: g.lastTime,
        isDefault: g.isDefault,
        conversationId: conv,
        muted: Boolean(prefs.muted),
        pinned,
        folded: Boolean(prefs.folded),
        draft: prefs.draft || '',
        bgKey: prefs.bg_key || null,
        unread,
      });
    }

    // 私聊: 只查本人相关会话, 避免扫全表 pv_u_%
    try {
      const own = `pv\\_${userId}\\_%`;
      const asMin = `pv\\_u\\_${userId}\\_%`;
      const asMax = `pv\\_u\\_%\\_${userId}`;
      const rowsSet = new Map();
      for (const pattern of [own, asMin, asMax]) {
        for (const row of stmts.lastPrivateMessage.all(pattern)) {
          const conv = String(row.conversation_id);
          // 再确认是本人会话 (LIKE 边界保护)
          if (!canAccessConversation(userId, conv, getGroup)) continue;
          rowsSet.set(conv, row);
        }
      }

      for (const row of rowsSet.values()) {
        const conv = row.conversation_id;
        const parts = conv.split('_');
        let name = null;
        let avatars = null;
        let personaId = null;
        let personaEmoji = null;
        let personaAvatar = null;
        let isAI = false;
        let peerId = null;

        if (parts[1] === 'u') {
          peerId = userId === parseInt(parts[2], 10) ? parseInt(parts[3], 10) : parseInt(parts[2], 10);
          const peer = stmts.userById.get(peerId);
          if (!peer) continue;
          name = peer.nickname;
          avatars = [peer.avatar || peer.avatar_color];
          personaAvatar = peer.avatar || null;
        } else {
          // AI 私聊会话: 不再作为独立会话进入消息列表（AI 仅保留在群聊）
          continue;
        }

        const prefs = getPrefs(userId, conv);
        const prefExtra = prefs.extra || {};
        // 「不显示该聊天」: 持续隐藏, 直到用户主动打开会话
        if (prefExtra.hidden) continue;
        const unread = getUnread(userId, conv);
        const cleared = Number(prefs.cleared_before || 0);
        const lastVisible = !cleared || (row.last_id ?? 0) > cleared;
        const content = !lastVisible
          ? '暂无消息'
          : row.last_content
            ? (row.last_media === 'image' ? '[图片]'
              : row.last_media === 'voice' || row.last_media === 'video'
                ? (row.last_media === 'video' ? '[视频]' : '[语音]')
                : row.last_content.slice(0, 40))
            : '暂无消息';

        const peerColor = parts[1] === 'u'
          ? (stmts.userById.get(peerId)?.avatar_color || '#4f6ef7')
          : '#07c160';
        const firstAvatar = avatars?.[0];
        chats.push({
          id: conv,
          type: 'private',
          name,
          remark: parts[1] === 'u'
            ? (stmts.getFriend.get(userId, peerId)?.remark || null)
            : null,
          avatars,
          avatar: personaAvatar
            || (typeof firstAvatar === 'string' && !firstAvatar.startsWith('#') && !firstAvatar.startsWith('rgb')
              ? firstAvatar
              : null),
          avatarColor: peerColor,
          lastMessage: prefs.draft || content,
          lastTime: row.last_time,
          personaId,
          personaEmoji,
          personaAvatar,
          isAI,
          peerId,
          conversationId: conv,
          muted: Boolean(prefs.muted),
          pinned: Boolean(prefs.pinned),
          folded: Boolean(prefs.folded),
          draft: prefs.draft || '',
          bgKey: prefs.bg_key || null,
          unread,
        });
      }
    } catch { /* ignore */ }

    return chats;
  }

  return {
    requireAuth,
    /** 会话列表(含未读/置顶/草稿) */
    chats(req, res) {
      const chats = mergeChatsWithMeta(req.user.id);
      chats.sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return (b.lastTime || 0) - (a.lastTime || 0);
      });
      const unreadTotal = chats.reduce((s, c) => s + (c.unread || 0), 0);
      res.json({ chats, unreadTotal });
    },

    /** 更新会话偏好 */
    upsertPref(req, res) {
      const conv = normConv(req.body?.conversationId);
      const { muted, pinned, folded, draft, bgKey, extra } = req.body || {};
      const now = Date.now();
      // extra 需与已有字段合并, 避免单独写 hidden/saved 时冲掉其它键
      let extraJson = null;
      if (extra != null) {
        const current = getPrefs(req.user.id, conv);
        const base = current.extra || {};
        const patch = typeof extra === 'object' && !Array.isArray(extra) ? extra : {};
        extraJson = parseExtra({ ...base, ...patch });
      }
      stmts.upsertChatPref.run(
        req.user.id, conv,
        muted ? 1 : 0,
        pinned ? 1 : 0,
        folded ? 1 : 0,
        draft != null ? String(draft).slice(0, 500) : '',
        bgKey != null ? String(bgKey).slice(0, 40) : null,
        extraJson,
        now,
        muted != null ? (muted ? 1 : 0) : null,
        pinned != null ? (pinned ? 1 : 0) : null,
        folded != null ? (folded ? 1 : 0) : null,
        draft != null ? String(draft).slice(0, 500) : null,
        bgKey != null ? String(bgKey).slice(0, 40) : null,
        extraJson,
      );
      const pref = getPrefs(req.user.id, conv);
      if (draft != null && typeof notify === 'function') {
        try {
          notify(req.user.id, {
            type: 'draft',
            conversationId: conv,
            draft: pref.draft || '',
            updatedAt: now,
          });
        } catch { /* ignore */ }
      }
      res.json({ pref });
    },

    /** 读取会话偏好(含草稿, 用于多端同步) */
    getPref(req, res) {
      const conv = normConv(req.query.conversationId);
      res.json({ pref: getPrefs(req.user.id, conv) });
    },

    /** 标记已读 */
    markRead(req, res) {
      const conv = normConv(req.body?.conversationId);
      const mid = conv === 'default'
        ? (stmts.maxMessageIdNull.get()?.mid || 0)
        : (stmts.maxMessageId.get(conv)?.mid || 0);
      stmts.upsertChatRead.run(req.user.id, conv, mid, 0, Date.now());
      res.json({ ok: true, lastReadId: mid });
    },

    /** 标记未读: last_read_id 回退到最新一条之前, 使列表出现未读角标 */
    markUnread(req, res) {
      const conv = normConv(req.body?.conversationId);
      const mid = conv === 'default'
        ? (stmts.maxCountableMessageNull.get()?.mid || 0)
        : (stmts.maxCountableMessage.get(conv)?.mid || 0);
      if (!mid) {
        return res.json({ ok: true, lastReadId: 0, unread: 0 });
      }
      const lastReadId = Math.max(0, mid - 1);
      stmts.upsertChatRead.run(req.user.id, conv, lastReadId, 1, Date.now());
      res.json({ ok: true, lastReadId, unread: 1 });
    },

    /** 清空会话记录 (仅本人视角, 不删除共享消息) */
    clearHistory(req, res) {
      const conv = normConv(req.body?.conversationId);
      if (!canAccessConversation(req.user.id, conv, getGroup)) {
        return res.status(403).json({ error: '无权清空该会话' });
      }
      const mid = conv === 'default'
        ? (stmts.maxMessageIdNull.get()?.mid || 0)
        : (stmts.maxMessageId.get(conv)?.mid || 0);
      try {
        stmts.setClearedBefore.run(req.user.id, conv, mid, Date.now());
      } catch (e) {
        return res.status(500).json({ error: '清空失败' });
      }
      stmts.upsertChatRead.run(req.user.id, conv, mid, 0, Date.now());
      res.json({ ok: true, clearedBefore: mid });
    },

    /** 好友申请 */
    friendRequests(req, res) {
      const incoming = stmts.listFriendRequestsTo.all(req.user.id).map((r) => ({
        id: r.id,
        status: r.status,
        message: r.message,
        createdAt: r.created_at,
        user: {
          id: r.from_id,
          nickname: r.nickname,
          avatar: r.avatar,
          avatarColor: r.avatar_color,
          wxid: r.wxid,
        },
      }));
      const outgoing = stmts.listFriendRequestsFrom.all(req.user.id).map((r) => ({
        id: r.id,
        status: r.status,
        message: r.message,
        createdAt: r.created_at,
        user: {
          id: r.to_id,
          nickname: r.nickname,
          avatar: r.avatar,
          avatarColor: r.avatar_color,
          wxid: r.wxid,
        },
      }));
      const pending = incoming.filter((r) => r.status === 'pending').length;
      res.json({ incoming, outgoing, pending });
    },

    sendFriendRequest(req, res) {
      const toId = Number(req.body?.userId);
      const message = String(req.body?.message || '').slice(0, 40);
      if (!Number.isInteger(toId) || toId <= 0) return res.status(400).json({ error: '参数不合法' });
      if (toId === req.user.id) return res.status(400).json({ error: '不能添加自己' });
      const target = stmts.userById.get(toId);
      if (!target) return res.status(404).json({ error: '用户不存在' });
      if (stmts.getFriend.get(req.user.id, toId)) {
        return res.json({ ok: true, already: true });
      }
      // 对方关闭「允许添加我为朋友」
      if (getUserSettings(toId).allowFriendReq === false) {
        return res.status(403).json({ error: '对方设置了权限，无法添加' });
      }
      // 对方拉黑我时禁止发申请
      const peerFr = stmts.getFriend.get(toId, req.user.id);
      if (peerFr?.blacklisted) {
        return res.status(403).json({ error: '对方设置了权限，无法添加' });
      }
      stmts.insertFriendRequest.run(req.user.id, toId, message, 'pending', Date.now());
      res.json({ ok: true });
    },

    handleFriendRequest(req, res) {
      const id = Number(req.body?.id);
      const action = req.body?.action === 'accept' ? 'accepted' : req.body?.action === 'reject' ? 'rejected' : null;
      if (!id || !action) return res.status(400).json({ error: '参数不合法' });
      const row = stmts.getFriendRequest.get(id);
      if (!row || row.to_id !== req.user.id) return res.status(404).json({ error: '申请不存在' });
      if (row.status !== 'pending') return res.status(400).json({ error: '已处理' });
      stmts.updateFriendRequest.run(action, id, req.user.id);
      if (action === 'accepted') {
        stmts.addFriend.run(req.user.id, row.from_id, Date.now());
        stmts.addFriend.run(row.from_id, req.user.id, Date.now());
      }
      res.json({ ok: true, status: action });
    },

    /** 标签 */
    tags(req, res) {
      const list = stmts.listTags.all(req.user.id).map((t) => {
        const memberIds = stmts.listTagMembers.all(t.id).map((m) => m.user_id);
        const members = memberIds.map((uid) => {
          const u = stmts.userById.get(uid);
          return {
            id: uid,
            nickname: u?.nickname || '用户',
            avatar: u?.avatar || null,
            avatarColor: u?.avatar_color || null,
          };
        });
        return {
          id: t.id,
          name: t.name,
          members: memberIds,
          memberProfiles: members,
        };
      });
      res.json({ tags: list });
    },

    createTag(req, res) {
      const name = String(req.body?.name || '').trim().slice(0, 12);
      if (!name) return res.status(400).json({ error: '标签名不能为空' });
      const r = stmts.insertTag.run(req.user.id, name, Date.now());
      res.json({ tag: { id: Number(r.lastInsertRowid), name, members: [] } });
    },

    deleteTag(req, res) {
      const id = Number(req.body?.id);
      stmts.deleteTag.run(id, req.user.id);
      res.json({ ok: true });
    },

    setTagMembers(req, res) {
      const id = Number(req.body?.id);
      const members = Array.isArray(req.body?.members) ? req.body.members.map(Number).filter(Boolean) : [];
      const tag = stmts.listTags.all(req.user.id).find((t) => t.id === id);
      if (!tag) return res.status(404).json({ error: '标签不存在' });
      stmts.deleteTagMember.run(id, null); // 清空会失败; 逐个删
      for (const m of stmts.listTagMembers.all(id)) stmts.deleteTagMember.run(id, m.user_id);
      for (const uid of members) stmts.insertTagMember.run(id, uid);
      res.json({ ok: true });
    },

    /** 收藏 */
    favorites(req, res) {
      const list = stmts.listFavorites.all(req.user.id).map((f) => ({
        id: f.id,
        kind: f.kind,
        content: f.content,
        mediaUrl: f.media_url,
        fromName: f.from_name,
        createdAt: f.created_at,
      }));
      res.json({ favorites: list });
    },

    addFavorite(req, res) {
      const kind = ['text', 'image', 'voice'].includes(req.body?.kind) ? req.body.kind : 'text';
      const content = String(req.body?.content || '').slice(0, 500);
      const mediaUrl = typeof req.body?.mediaUrl === 'string' && req.body.mediaUrl.startsWith('/media/')
        ? req.body.mediaUrl : null;
      const fromName = String(req.body?.fromName || '').slice(0, 40);
      if (!content && !mediaUrl) return res.status(400).json({ error: '收藏内容为空' });
      const r = stmts.insertFavorite.run(req.user.id, kind, content, mediaUrl, fromName, Date.now());
      res.json({ favorite: { id: Number(r.lastInsertRowid), kind, content, mediaUrl, fromName } });
    },

    removeFavorite(req, res) {
      const id = Number(req.body?.id);
      stmts.deleteFavorite.run(id, req.user.id);
      res.json({ ok: true });
    },

    /** 公众号 */
    official(req, res) {
      // 种子
      const seeds = [
        ['微信团队', '微信官方通知与安全提醒', null],
        ['订阅号助手', '内容创作与群发助手', null],
        ['城市服务', '本地生活与政务服务', null],
      ];
      if (!stmts.listOfficial.all().length) {
        for (const [n, i, a] of seeds) stmts.insertOfficial.run(n, i, a, Date.now());
      }
      const all = stmts.listOfficial.all();
      const followSet = new Set(stmts.listOaFollows.all(req.user.id).map((x) => x.id));
      res.json({
        official: all.map((o) => ({
          id: o.id,
          name: o.name,
          intro: o.intro,
          followed: followSet.has(o.id),
        })),
      });
    },

    followOfficial(req, res) {
      const id = Number(req.body?.id);
      const oa = stmts.listOfficial.all().find((x) => x.id === id);
      if (!oa) return res.status(404).json({ error: '公众号不存在' });
      stmts.followOfficial.run(req.user.id, id, Date.now());
      res.json({ ok: true, followed: true });
    },

    unfollowOfficial(req, res) {
      const id = Number(req.body?.id);
      stmts.unfollowOfficial.run(req.user.id, id);
      res.json({ ok: true, followed: false });
    },
  };
}
