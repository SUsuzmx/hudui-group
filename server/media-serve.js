// 媒体落盘访问控制：私聊/会话附件不可被任意直链打开；禁止把上传文件当网页执行
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stmts, db } from './db.js';
import { extractBearerToken, verifyToken } from './auth.js';

const MEDIA_DIR = path.join(ROOT, 'data', 'media');

const SAFE_INLINE = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
  ['.m4a', 'audio/mp4'],
  ['.aac', 'audio/aac'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mov', 'video/quicktime'],
  ['.m4v', 'video/x-m4v'],
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

// 永不按网页/脚本执行的类型
const FORCE_DOWNLOAD = new Map([
  ['.html', 'text/html'],
  ['.htm', 'text/html'],
  ['.svg', 'image/svg+xml'],
  ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'],
  ['.xhtml', 'application/xhtml+xml'],
  ['.xml', 'text/xml'],
  ['.json', 'application/json'],
]);

function safeBasename(name) {
  return path.basename(String(name || '')).replace(/[\\/]/g, '');
}

function contentTypeFor(ext) {
  const e = String(ext || '').toLowerCase();
  if (SAFE_INLINE.has(e)) return SAFE_INLINE.get(e);
  if (FORCE_DOWNLOAD.has(e)) return 'application/octet-stream';
  return 'application/octet-stream';
}

/** 解析用户 token（支持 Authorization 头；媒体标签/iframe 可能不带头） */
function userFromMediaRequest(req) {
  const bearer = extractBearerToken(req);
  if (bearer) {
    const u = verifyToken(bearer);
    if (u) return u;
  }
  const q = String(req.query.token || req.query.access_token || '');
  if (q) {
    const u = verifyToken(q);
    if (u) return u;
  }
  // <img>/<video> 不会带 Authorization，依赖登录时种下的 Cookie
  const cookie = req.headers.cookie || '';
  const m = /(?:^|;\s*)hudui_token=([^;]+)/.exec(cookie);
  if (m?.[1]) {
    const u = verifyToken(decodeURIComponent(m[1]));
    if (u) return u;
  }
  return null;
}

function messageHasMedia(userId, relUrl) {
  const like = `%${relUrl}%`;
  try {
    const row = db.prepare(
      `SELECT 1 FROM messages m
       WHERE (m.media_url = ? OR m.content LIKE ?)
         AND (
           m.conversation_id IS NULL
           OR m.conversation_id = ?
           OR m.conversation_id IN (
             SELECT 'grp_' || g.id FROM groups g
             JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
           )
           OR m.conversation_id LIKE ?
           OR m.conversation_id LIKE ?
         )
       LIMIT 1`
    ).get(relUrl, like, `pv_${userId}_%`, userId, `pv\\_${userId}\\_%`, `pv\\_%\\_${userId}`);
    return Boolean(row);
  } catch {
    return false;
  }
}

function momentHasMedia(userId, relUrl) {
  const like = `%${relUrl}%`;
  try {
    const rows = db.prepare(
      `SELECT user_id, visibility, visible_to, created_at, images FROM moments WHERE images LIKE ? LIMIT 30`
    ).all(like);
    for (const r of rows) {
      // 复用 moments 的可见性判断（轻量版，避免循环依赖）
      if (Number(r.user_id) === Number(userId)) return true;
      const vis = r.visibility || 'public';
      let ids = [];
      try { ids = JSON.parse(r.visible_to || '[]'); } catch { ids = []; }
      if (vis === 'private') continue;
      if (vis === 'partial' && !ids.map(Number).includes(Number(userId))) continue;
      if (vis === 'except' && ids.map(Number).includes(Number(userId))) continue;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function profileHasMedia(userId, relUrl) {
  const like = `%${relUrl}%`;
  try {
    // 自己或可查看用户资料里的封面/状态背景
    const row = db.prepare(
      `SELECT id, moments_cover, status_json FROM users
       WHERE moments_cover LIKE ? OR status_json LIKE ?
       LIMIT 20`
    ).all(like, like);
    for (const r of row) {
      if (Number(r.id) === Number(userId)) return true;
      // 好友或非屏蔽关系：允许查看封面类资源
      try {
        const f = stmts.getFriend.get(userId, r.id) || stmts.getFriend.get(r.id, userId);
        if (f && !f.blacklisted) return true;
      } catch { /* ignore */ }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Express 中间件：挂在 /media
 * - demo/ 资源公开
 * - 用户上传：需登录，且属于本人 / 可访问会话 / 可见朋友圈
 * - 危险类型强制下载，绝不以 HTML/SVG/JS 页面执行
 */
export function mediaServeMiddleware(req, res, next) {
  const rel = decodeURIComponent(String(req.path || '').replace(/^\//, ''));
  if (!rel || rel.includes('..')) return res.status(400).send('bad path');

  // 演示资源 data/media/demo/… 公开
  const demoFull = path.join(MEDIA_DIR, rel);
  if (rel.startsWith('demo/') && demoFull.startsWith(MEDIA_DIR)
    && fs.existsSync(demoFull) && fs.statSync(demoFull).isFile()) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', contentTypeFor(path.extname(demoFull).toLowerCase()));
    res.setHeader('Cache-Control', 'public, max-age=604800');
    return res.sendFile(demoFull);
  }

  const name = safeBasename(rel);
  if (!name || name.includes('..')) return res.status(400).send('bad path');

  const full = path.join(MEDIA_DIR, name);
  if (!full.startsWith(MEDIA_DIR)) return res.status(400).send('bad path');
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    return res.status(404).send('not found');
  }

  const ext = path.extname(name).toLowerCase();

  const user = userFromMediaRequest(req);
  if (!user) {
    return res.status(401).json({ error: '需要登录后才能查看附件' });
  }

  // 所有者前缀 u{id}-
  const ownerMatch = /^u(\d+)-/.exec(name);
  if (ownerMatch && Number(ownerMatch[1]) === Number(user.id)) {
    return sendProtected(res, full, ext);
  }

  const relUrl = `/media/${name}`;
  if (messageHasMedia(user.id, relUrl) || momentHasMedia(user.id, relUrl) || profileHasMedia(user.id, relUrl)) {
    return sendProtected(res, full, ext);
  }

  // 他人文件 / 旧版无归属文件：未出现在可见消息或朋友圈中则拒绝
  return res.status(403).json({ error: '无权访问该附件' });
}

function sendProtected(res, file, ext) {
  const forceDl = FORCE_DOWNLOAD.has(ext) || !SAFE_INLINE.has(ext);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', forceDl ? 'application/octet-stream' : contentTypeFor(ext));
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (forceDl) {
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
  }
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.sendFile(file);
}

export { MEDIA_DIR };
