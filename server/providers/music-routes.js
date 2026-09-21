import express from 'express';
import netease from './netease.js';
import qq from './qq.js';

const PROVIDERS = { netease, qq };

export function createMusicProviderRouter({ requireAuth, provider } = {}) {
  const name = String(provider || '').toLowerCase();
  const p = PROVIDERS[name];
  if (!p) throw new Error(`unknown music provider: ${provider}`);
  const router = express.Router();
  const auth = typeof requireAuth === 'function' ? requireAuth : (req, res, next) => next();
  router.use(auth);

  router.get('/search', async (req, res) => {
    try {
      const songs = await p.search({ q: String(req.query.q || ''), limit: Number(req.query.limit) || 20 });
      res.json({ provider: name, songs, count: songs.length });
    } catch (e) { res.status(502).json({ provider: name, error: e.message || '搜索失败', songs: [] }); }
  });

  router.get('/song/url', async (req, res) => {
    try {
      const level = String(req.query.level || 'exhigh');
      const result = name === 'netease'
        ? await netease.getSongUrl({ id: req.query.id, level })
        : await qq.getSongUrl({ id: req.query.id, mid: req.query.mid, mediaMid: req.query.mediaMid, level });
      res.json(result);
    } catch (e) { res.status(502).json({ provider: name, error: e.message, playable: false, url: '' }); }
  });

  router.get('/lyric', async (req, res) => {
    try {
      res.json(await p.lyric({ id: req.query.id, mid: req.query.mid }));
    } catch (e) { res.status(502).json({ provider: name, error: e.message }); }
  });

  router.get('/playlists', async (req, res) => {
    try {
      res.json(await p.listPlaylists());
    } catch (e) { res.status(502).json({ provider: name, error: e.message, playlists: [], loggedIn: false }); }
  });

  router.get('/playlist/tracks', async (req, res) => {
    try {
      res.json(await p.playlistTracks({ id: req.query.id, limit: Number(req.query.limit) || 100 }));
    } catch (e) { res.status(502).json({ provider: name, error: e.message, songs: [] }); }
  });

  router.get('/likes', async (req, res) => {
    try {
      res.json(await p.listLikes());
    } catch (e) { res.status(502).json({ provider: name, error: e.message, songs: [], loggedIn: false }); }
  });

  router.post('/login/cookie', async (req, res) => {
    try {
      const r = await p.loginByCookie(req.body?.cookie ?? req.body?.Cookie);
      if (!r.ok) return res.status(400).json({ provider: name, ok: false, error: r.error, code: r.code || null, partial: !!r.partial });
      res.json({ provider: name, ok: true, loggedIn: r.loggedIn, nickname: r.nickname || null, userId: r.userId || null, message: r.message });
    } catch (e) { res.status(500).json({ provider: name, error: e.message }); }
  });

  if (name === 'netease') {
    router.get('/login/qr/key', async (req, res) => {
      const r = await netease.qrKey().catch((e) => ({ ok: false, error: e.message }));
      r.ok ? res.json(r) : res.status(502).json(r);
    });
    router.get('/login/qr/create', async (req, res) => {
      if (!req.query.key) return res.status(400).json({ error: '缺少 key' });
      res.json(await netease.qrCreate(req.query.key).catch((e) => ({ ok: false, error: e.message })));
    });
    router.get('/login/qr/check', async (req, res) => {
      if (!req.query.key) return res.status(400).json({ error: '缺少 key' });
      res.json(await netease.qrCheck(req.query.key).catch((e) => ({ ok: false, error: e.message })));
    });
  }

  router.get('/login/status', async (req, res) => {
    try { res.json(await p.loginStatus()); }
    catch (e) { res.status(502).json({ provider: name, error: e.message, loggedIn: false }); }
  });

  router.post('/logout', async (req, res) => {
    try { await p.logout(); res.json({ provider: name, ok: true, loggedIn: false }); }
    catch (e) { res.status(500).json({ provider: name, error: e.message }); }
  });

  return router;
}

export default createMusicProviderRouter;
