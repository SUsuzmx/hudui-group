// 朋友圈 API: 发布/删除/点赞/评论(回复/删除)/可见范围
import { stmts } from './db.js';
import { scheduleAiMomentReact, personaByDbId, personaByKey } from './moments-ai.js';
import { aiAvatarFile } from './ai/avatars.js';
import { isBlockedEither } from './friends.js';

function parseImages(raw) {
  try {
    const arr = JSON.parse(raw ?? '[]');
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x.startsWith('/')) : [];
  } catch {
    return [];
  }
}

function parseVisibleTo(raw) {
  try {
    const arr = JSON.parse(raw ?? '[]');
    return Array.isArray(arr) ? arr.map(Number).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function displayUser(userId, fallbackNickname) {
  const persona = personaByDbId(userId);
  if (persona) {
    return {
      id: persona.id,
      nickname: persona.name,
      avatarColor: '#07c160',
      avatar: aiAvatarFile(persona.name),
      isAI: true,
      personaId: persona.id,
    };
  }
  const u = userId > 0 ? stmts.userById.get(userId) : null;
  return {
    id: userId,
    nickname: fallbackNickname || u?.nickname || '用户',
    avatarColor: u?.avatar_color || '#888',
    avatar: u?.avatar || null,
    isAI: false,
  };
}

function loadInteractions(momentId, viewerId = null) {
  const likeRows = stmts.listMomentLikes.all(momentId) || [];
  const likes = likeRows.map((l) => {
    const p = personaByDbId(l.user_id);
    return {
      userId: l.user_id,
      nickname: p ? p.name : (l.uname || '用户'),
      isAI: Boolean(p),
      createdAt: l.created_at,
    };
  });
  const comments = (stmts.listMomentComments.all(momentId) || []).map((c) => {
    const p = c.persona_key ? personaByKey(c.persona_key) : personaByDbId(c.user_id);
    return {
      id: c.id,
      userId: c.user_id,
      nickname: p ? p.name : (c.uname || '用户'),
      avatar: p ? aiAvatarFile(p.name) : c.uavatar,
      isAI: Boolean(p),
      content: c.content,
      createdAt: c.created_at,
      replyToId: c.reply_to_id || null,
      replyToName: c.reply_to_name || null,
    };
  });
  const likedByMe = viewerId
    ? likeRows.some((l) => l.user_id === viewerId)
    : false;
  return { likes, comments, likeCount: likes.length, commentCount: comments.length, likedByMe };
}

function rowToMoment(r, viewerId = null) {
  const base = {
    id: r.id,
    userId: r.user_id,
    content: r.content,
    images: parseImages(r.images),
    createdAt: r.created_at,
    visibility: r.visibility || 'public',
    visibleTo: parseVisibleTo(r.visible_to),
    author: {
      id: r.user_id,
      nickname: r.nickname,
      avatarColor: r.avatar_color,
      avatar: r.avatar,
    },
  };
  return { ...base, ...loadInteractions(r.id, viewerId) };
}

function canView(moment, userId) {
  const vis = moment.visibility || 'public';
  if (moment.user_id === userId) return true;
  if (isBlockedEither(moment.user_id, userId)) return false;
  if (vis === 'public') return true;
  if (vis === 'private') return false;
  // friends / partial
  if (vis === 'friends') {
    try {
      return Boolean(stmts.getFriend.get(userId, moment.user_id) || stmts.getFriend.get(moment.user_id, userId));
    } catch {
      return false;
    }
  }
  if (vis === 'partial') {
    return parseVisibleTo(moment.visible_to).includes(userId);
  }
  return true;
}

export function createMomentsRouter({ verifyToken, notify } = {}) {
  function requireAuth(req, res, next) {
    const user = verifyToken(req.get('Authorization')?.replace(/^Bearer /, ''));
    if (!user) return res.status(401).json({ error: '未登录' });
    req.user = user;
    next();
  }

  function emitMoment(payload) {
    if (typeof notify === 'function') {
      try { notify(payload); } catch { /* ignore */ }
    }
  }

  return {
    requireAuth,
    list(req, res) {
      const beforeId = req.query.beforeId ? Number(req.query.beforeId) : null;
      const rows = beforeId
        ? stmts.listMomentsBefore.all(beforeId, 50)
        : stmts.listMoments.all(50);
      const visible = rows.filter((r) => canView(r, req.user.id)).slice(0, 20);
      res.json({ moments: visible.map((r) => rowToMoment(r, req.user.id)) });
    },
    mine(req, res) {
      const rows = stmts.listUserMoments.all(req.user.id, 50);
      res.json({ moments: rows.map((r) => rowToMoment(r, req.user.id)) });
    },
    /** 指定用户的朋友圈（按可见权限过滤） */
    userMoments(req, res) {
      const uid = Number(req.params.userId ?? req.query.userId);
      if (!Number.isInteger(uid) || uid <= 0) {
        return res.status(400).json({ error: '参数不合法' });
      }
      if (uid === req.user.id) {
        const rows = stmts.listUserMoments.all(req.user.id, 50);
        return res.json({ moments: rows.map((r) => rowToMoment(r, req.user.id)) });
      }
      const rows = stmts.listUserMoments.all(uid, 50) || [];
      const visible = rows.filter((r) => canView(r, req.user.id));
      const profile = stmts.userById.get(uid);
      res.json({
        moments: visible.map((r) => rowToMoment(r, req.user.id)),
        user: profile
          ? {
              id: profile.id,
              nickname: profile.nickname,
              avatar: profile.avatar,
              avatarColor: profile.avatar_color,
              signature: profile.signature || '',
              momentsCover: profile.moments_cover || null,
            }
          : null,
      });
    },
    create(req, res) {
      const content = String(req.body?.content ?? '').trim();
      let images = req.body?.images;
      if (!Array.isArray(images)) images = [];
      images = images
        .filter((x) => typeof x === 'string' && (x.startsWith('/media/') || x.startsWith('/avatars/')))
        .slice(0, 9);
      const visibility = ['public', 'private', 'friends', 'partial'].includes(req.body?.visibility)
        ? req.body.visibility : 'public';
      const visibleTo = Array.isArray(req.body?.visibleTo)
        ? req.body.visibleTo.map(Number).filter(Boolean).slice(0, 50) : [];
      if (visibility === 'partial' && !visibleTo.length) {
        return res.status(400).json({ error: '部分可见请选择至少一位好友' });
      }
      if (!content && !images.length) {
        return res.status(400).json({ error: '说点什么或配张图吧' });
      }
      if (content.length > 500) return res.status(400).json({ error: '文字最多 500 字' });
      const r = stmts.insertMomentFull.run(
        req.user.id,
        content,
        JSON.stringify(images),
        Date.now(),
        visibility,
        visibility === 'partial' ? JSON.stringify(visibleTo) : null,
      );
      const row = stmts.momentById.get(Number(r.lastInsertRowid));
      const user = stmts.userById.get(req.user.id);
      const momentId = Number(r.lastInsertRowid);
      // 异步: AI 群友点赞/评论
      try { scheduleAiMomentReact(momentId, req.user.id); } catch { /* ignore */ }
      emitMoment({ type: 'created', momentId, userId: req.user.id });
      res.json({
        moment: rowToMoment({
          ...row,
          nickname: user.nickname,
          avatar_color: user.avatar_color,
          avatar: user.avatar,
        }, req.user.id),
      });
    },
    remove(req, res) {
      const id = Number(req.body?.id ?? req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '参数不合法' });
      stmts.deleteMoment.run(id, req.user.id);
      emitMoment({ type: 'deleted', momentId: id, userId: req.user.id });
      res.json({ ok: true });
    },
    like(req, res) {
      const id = Number(req.body?.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '参数不合法' });
      const moment = stmts.momentById.get(id);
      if (!moment || !canView(moment, req.user.id)) return res.status(404).json({ error: '动态不存在' });
      stmts.likeMoment.run(id, req.user.id, Date.now());
      emitMoment({ type: 'liked', momentId: id, userId: req.user.id, authorId: moment.user_id });
      res.json(loadInteractions(id, req.user.id));
    },
    unlike(req, res) {
      const id = Number(req.body?.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '参数不合法' });
      stmts.unlikeMoment.run(id, req.user.id);
      emitMoment({ type: 'unliked', momentId: id, userId: req.user.id });
      res.json(loadInteractions(id, req.user.id));
    },
    comment(req, res) {
      const id = Number(req.body?.id);
      const content = String(req.body?.content ?? '').trim();
      const replyToId = Number(req.body?.replyToId) || null;
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '参数不合法' });
      if (!content || content.length > 200) return res.status(400).json({ error: '评论不合法' });
      const moment = stmts.momentById.get(id);
      if (!moment || !canView(moment, req.user.id)) return res.status(404).json({ error: '动态不存在' });
      let replyToName = null;
      if (replyToId) {
        const src = stmts.getMomentComment.get(replyToId);
        if (src && src.moment_id === id) {
          replyToName = src.reply_to_name || src.uname
            || personaByKey(src.persona_key)?.name
            || personaByDbId(src.user_id)?.name
            || stmts.userById.get(src.user_id)?.nickname
            || null;
        }
      }
      stmts.insertMomentComment.run(id, req.user.id, content, Date.now(), replyToId, replyToName, null);
      emitMoment({ type: 'commented', momentId: id, userId: req.user.id, authorId: moment.user_id });
      res.json(loadInteractions(id, req.user.id));
    },
    deleteComment(req, res) {
      const id = Number(req.body?.commentId);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '参数不合法' });
      const row = stmts.getMomentComment.get(id);
      if (!row) return res.status(404).json({ error: '评论不存在' });
      // 评论作者 或 动态作者 可删; AI 评论动态作者可删
      const moment = stmts.momentById.get(row.moment_id);
      const isAiComment = row.user_id < 0 || row.persona_key;
      if (!isAiComment && row.user_id !== req.user.id && moment?.user_id !== req.user.id) {
        return res.status(403).json({ error: '无权删除' });
      }
      if (isAiComment && moment?.user_id !== req.user.id && row.user_id !== req.user.id) {
        return res.status(403).json({ error: '无权删除' });
      }
      stmts.deleteMomentComment.run(id, row.user_id);
      res.json({ ...loadInteractions(row.moment_id, req.user.id), momentId: row.moment_id });
    },
  };
}
