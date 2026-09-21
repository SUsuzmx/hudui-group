// 看一看 UGC：仅本地/自有/用户上传，不依赖抖音等外站
import { stmts } from './db.js';

function mapPost(row, viewerId) {
  const url = String(row.media_url || '');
  const ok = url.startsWith('/media/');
  return {
    id: String(row.id),
    title: row.title || '未命名视频',
    author: row.author || row.uname || '用户',
    likes: String(row.likes || 0),
    cover: row.cover_url || null,
    url: ok ? url : null,
    source: 'ugc',
    mine: Number(viewerId) === Number(row.user_id),
    userId: row.user_id,
    createdAt: row.created_at,
    description: '用户上传 · 同源可播',
  };
}

export function createLookApi() {
  return {
    list(req, res) {
      const uid = req.user?.id;
      let rows = [];
      try {
        rows = stmts.listLookPosts.all() || [];
      } catch {
        rows = [];
      }
      const items = rows
        .map((r) => mapPost(r, uid))
        .filter((v) => v.url);
      res.json({ videos: items, source: 'ugc+local' });
    },

    create(req, res) {
      const uid = req.user?.id;
      if (!uid) return res.status(401).json({ error: '未登录' });
      const title = String(req.body?.title || '').trim().slice(0, 40) || '未命名视频';
      const mediaUrl = String(req.body?.mediaUrl || req.body?.url || '');
      const coverUrl = String(req.body?.coverUrl || req.body?.cover || '');
      const author = String(req.body?.author || req.user?.nickname || '').slice(0, 24);
      if (!mediaUrl.startsWith('/media/')) {
        return res.status(400).json({ error: '请上传本地视频文件（仅支持 /media/ 源）' });
      }
      const r = stmts.insertLookPost.run(uid, title, mediaUrl, coverUrl.startsWith('/media/') || coverUrl.startsWith('/avatars/') ? coverUrl : '', author, Date.now());
      const row = stmts.getLookPost.get(r.lastInsertRowid);
      res.json({ ok: true, video: mapPost(row, uid) });
    },

    remove(req, res) {
      const uid = req.user?.id;
      const id = Number(req.params.id || req.body?.id);
      if (!uid || !id) return res.status(400).json({ error: '参数不合法' });
      stmts.deleteLookPost.run(id, uid);
      res.json({ ok: true });
    },
  };
}
