import express from 'express';
import netease from './netease.js';
import qq from './qq.js';
import {
  handleNeteaseUserPlaylists,
  handleNeteasePlaylistTracks,
  handleQQUserPlaylists,
  handleQQPlaylistTracks,
  QQ_LIKED_PLAYLIST_ID,
} from './user-playlists.js';

const PROVIDERS = { netease, qq };

function formatProviderError(e) {
  if (!e) return '未知错误';
  const body = e.body;
  const bodyCode = body && typeof body === 'object' ? (body.code ?? body.subcode) : undefined;
  const bodyMsg = body && typeof body === 'object'
    ? (body.message || body.msg || body.msgs)
    : (typeof body === 'string' ? body : '');
  const detail = [
    e.message,
    e.code,
    bodyCode != null ? `code=${bodyCode}` : '',
    bodyMsg || (body && typeof body === 'object' ? JSON.stringify(body).slice(0, 300) : ''),
  ].filter(Boolean).join(' | ');
  return detail || '未知错误';
}

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
        : await qq.getSongUrl({ id: req.query.id, mid: req.query.mid || req.query.songmid || req.query.id, mediaMid: req.query.mediaMid || req.query.media_mid, level, songMeta: { id: req.query.id, mid: req.query.mid, mediaMid: req.query.mediaMid, title: req.query.title, artist: req.query.artist, artists: String(req.query.artist || '').split(/[\\/\\,]/).filter(Boolean) } });
      res.json(result);
    } catch (e) { res.status(502).json({ provider: name, error: e.message, playable: false, url: '' }); }
  });

  router.get('/lyric', async (req, res) => {
    try {
      res.json(await p.lyric({ id: req.query.id, mid: req.query.mid }));
    } catch (e) { res.status(502).json({ provider: name, error: e.message }); }
  });

  router.get('/user/playlists', async (req, res) => {
    try {
      const opts = {
        limit: Number(req.query.limit) || 0,
        offset: Number(req.query.offset) || 0,
        maxItems: Number(req.query.maxItems) || 0,
      };
      const r = name === 'netease' ? await handleNeteaseUserPlaylists(opts) : await handleQQUserPlaylists();
      res.json({ provider: name, ...r });
    } catch (e) {
      res.status(502).json({ provider: name, error: formatProviderError(e), playlists: [], loggedIn: false });
    }
  });
  router.get('/playlists', async (req, res) => {
    try {
      const opts = {
        limit: Number(req.query.limit) || 0,
        offset: Number(req.query.offset) || 0,
        maxItems: Number(req.query.maxItems) || 0,
      };
      const r = name === 'netease' ? await handleNeteaseUserPlaylists(opts) : await handleQQUserPlaylists();
      res.json({ provider: name, ...r });
    } catch (e) {
      res.status(502).json({ provider: name, error: formatProviderError(e), playlists: [], loggedIn: false });
    }
  });

  router.get('/playlist/tracks', async (req, res) => {
    try {
      const opts = {
        limit: Number(req.query.limit) || 100,
        offset: Number(req.query.offset) || 0,
      };
      const r = name === 'netease'
        ? await handleNeteasePlaylistTracks(req.query.id, opts)
        : await handleQQPlaylistTracks(req.query.id, opts);
      res.json({ provider: name, songs: r.tracks || [], tracks: r.tracks || [], ...r });
    } catch (e) {
      res.status(502).json({ provider: name, error: formatProviderError(e), songs: [] });
    }
  });

  router.get('/likes', async (req, res) => {
    try {
      if (name === 'netease') {
        const list = await handleNeteaseUserPlaylists();
        const liked = (list.playlists || []).find((pl) => Number(pl.specialType) === 5) || (list.playlists || [])[0];
        const songs = liked && liked.id ? (await handleNeteasePlaylistTracks(liked.id, { limit: 200 })).tracks : [];
        return res.json({
          provider: name,
          loggedIn: !!list.loggedIn,
          songs,
          tracks: songs,
          playlists: list.playlists || [],
          message: list.message || '',
        });
      }
      const r = await handleQQPlaylistTracks(QQ_LIKED_PLAYLIST_ID, { limit: 200 });
      const list = await handleQQUserPlaylists();
      return res.json({
        provider: name,
        loggedIn: !!r.loggedIn,
        songs: r.tracks || [],
        tracks: r.tracks || [],
        playlists: list.playlists || [],
        message: r.message || '',
        requiresPlaybackKey: !!r.requiresPlaybackKey,
      });
    } catch (e) {
      res.status(502).json({ provider: name, error: formatProviderError(e), songs: [], loggedIn: false });
    }
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
