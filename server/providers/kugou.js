// 酷狗音源适配层：协议完整实现见同目录 kugou-api.js（勿精简）。
// 本文件只做项目内 ESM/Express 接线、曲目字段对齐与音频代理。
import express from 'express';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import {
  readCookieFile, writeCookieFile, logProvider,
} from './common.js';

const require = createRequire(import.meta.url);
const kugou = require('./kugou-api.cjs');

const PROVIDER = 'kugou';
const cookie = () => readCookieFile(PROVIDER);

const RESTRICTION_ACTION_BY_CATEGORY = {
  verification_required: 'login',
  login_required: 'login',
  vip_required: 'upgrade',
  membership_unknown: 'upgrade',
  paid_required: 'purchase',
  client_only: 'switch_source',
  copyright_unavailable: 'switch_source',
  trial_only: 'upgrade',
  url_unavailable: 'switch_source',
};

function actionForCategory(category) {
  return RESTRICTION_ACTION_BY_CATEGORY[category] || 'switch_source';
}

function normalizeTrack(raw) {
  if (!raw) return null;
  const durationMs = Number(raw.durationMs ?? raw.duration ?? 0) || 0;
  // mapKugouSearchItem 把 duration 存成毫秒；播放器/列表按秒展示
  const durationSec = durationMs > 10000 ? Math.round(durationMs / 1000) : Math.round(durationMs);
  const title = raw.title || raw.name || '未知歌曲';
  const artists = Array.isArray(raw.artists) && raw.artists.length
    ? raw.artists.map((a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean)
    : String(raw.artist || '').split(/\s*\/\s*/).filter(Boolean);
  return {
    ...raw,
    id: raw.id || raw.hash || raw.fileHash,
    hash: raw.hash || raw.fileHash || '',
    title,
    name: title,
    artist: raw.artist || artists.join(' / ') || '未知歌手',
    artists,
    duration: durationSec,
    durationMs: durationMs > 10000 ? durationMs : durationSec * 1000,
    genre: '酷狗',
    source: PROVIDER,
    provider: PROVIDER,
    type: 'song',
  };
}

function normalizeTracks(list) {
  return (Array.isArray(list) ? list : []).map(normalizeTrack).filter(Boolean);
}

function normalizePlaylist(raw) {
  if (!raw) return null;
  const name = raw.name || '酷狗歌单';
  return {
    ...raw,
    id: String(raw.id || raw.listId || ''),
    listId: String(raw.listId || raw.id || ''),
    name,
    isFavorite: raw.isFavorite || /我喜欢|我的收藏|favorite|liked/i.test(name),
    provider: PROVIDER,
    source: PROVIDER,
  };
}

function withRestrictionAction(result) {
  if (!result || result.playable) return result;
  const category = result.restriction?.category || result.reason || 'url_unavailable';
  const message = result.restriction?.message || result.message || '暂时没有可用的播放地址';
  return {
    ...result,
    playable: false,
    url: result.url || '',
    restriction: {
      category,
      message,
      action: actionForCategory(category),
    },
  };
}

function toProxyPath(cdnUrl) {
  return '/api/kugou/audio?u=' + encodeURIComponent(cdnUrl);
}

function pickHashParams(query = {}) {
  return {
    hash: query.hash || query.fileHash || query.id || '',
    albumId: query.albumId || query.album_id || '',
    albumAudioId: query.albumAudioId || query.album_audio_id || query.mixSongId || query.mixsongid || '',
    mixSongId: query.mixSongId || query.mixsongid || '',
    quality: query.quality || query.level || 'standard',
    privilege: query.privilege,
    vipRequired: query.vipRequired || query.vip_required,
    hqHash: query.hqHash || query.hq_hash || '',
    sqHash: query.sqHash || query.sq_hash || '',
    resHash: query.resHash || query.res_hash || '',
  };
}

export async function search({ q = '', keyword = '', limit = 20, offset = 0 } = {}) {
  const kw = String(q || keyword || '').trim() || '热歌';
  const songs = await kugou.handleKugouSearch(kw, limit, cookie(), offset);
  return normalizeTracks(songs);
}

export async function getSongUrl(params = {}) {
  const raw = await kugou.handleKugouSongUrl(pickHashParams(params), cookie());
  const next = withRestrictionAction(raw);
  if (next.playable && next.url) {
    const cdnUrl = next.url;
    return {
      ...next,
      // 播放器优先用相对代理地址，避免酷狗 CDN 防盗链
      url: toProxyPath(cdnUrl),
      cdnUrl,
      proxyUrl: toProxyPath(cdnUrl),
      playable: true,
      restriction: null,
    };
  }
  return { ...next, url: '', playable: false };
}

export async function lyric({ id, hash, albumAudioId, duration, durationMs } = {}) {
  const fileHash = String(hash || id || '');
  const durationSec = duration != null
    ? Number(duration) || 0
    : Math.round((Number(durationMs) || 0) / 1000);
  const r = await kugou.handleKugouLyric(fileHash, albumAudioId, durationSec);
  return {
    provider: PROVIDER,
    id: fileHash,
    hash: fileHash,
    lrc: r.lyric || '',
    tlyric: r.trans || '',
    lyric: r.lyric || '',
  };
}

export async function loginByCookie(raw) {
  const normalized = kugou.normalizeKugouCookieInput(raw);
  if (!kugou.kugouCookieHasPlayback(normalized)) {
    return {
      ok: false,
      code: 'INVALID_KUGOU_COOKIE',
      error: '酷狗 Cookie 缺少 KuGoo 字段（或其中的 userid/token）。请登录 www.kugou.com 后从浏览器完整复制 Cookie',
      partial: kugou.kugouCookieHasLogin(normalized),
    };
  }
  writeCookieFile(PROVIDER, normalized);
  kugou.clearKugouSessionCaches();
  const info = await kugou.getKugouLoginInfo(cookie());
  return {
    ok: true,
    loggedIn: !!info.loggedIn,
    userId: info.userId || null,
    nickname: info.nickname || null,
    message: info.playbackReady ? '酷狗 Cookie 已生效' : 'Cookie 已保存，播放权益未就绪',
    info,
  };
}

export async function loginStatus() {
  const info = await kugou.getKugouLoginInfo(cookie());
  return {
    provider: PROVIDER,
    loggedIn: !!info.loggedIn,
    hasCookie: !!cookie(),
    userId: info.userId || '',
    nickname: info.nickname || null,
    avatar: info.avatar || '',
    playbackReady: !!info.playbackReady,
    isVip: !!info.isVip,
    isSvip: !!info.isSvip,
    hasMusicPackage: !!info.hasMusicPackage,
    membershipKnown: !!info.membershipKnown,
    membershipVerified: !!info.membershipVerified,
    membershipStale: !!info.membershipStale,
    vipLevel: info.vipLevel || 'none',
    vipLabel: info.vipLabel || '无VIP',
    membershipRights: info.membershipRights || null,
  };
}

export async function logout() {
  writeCookieFile(PROVIDER, '');
  kugou.clearKugouSessionCaches();
  return { ok: true, loggedIn: false };
}

export async function getMembership({ force = false } = {}) {
  void force;
  const s = await loginStatus();
  return {
    loggedIn: s.loggedIn,
    userId: s.userId,
    nickname: s.nickname,
    isVip: s.isVip,
    isSvip: s.isSvip,
    membershipKnown: s.membershipKnown,
    membershipStale: s.membershipStale,
    vipLevel: s.vipLevel,
    vipLabel: s.vipLabel,
  };
}

export async function listPlaylists() {
  const r = await kugou.handleKugouUserPlaylists(cookie());
  const playlists = (r.playlists || []).map((pl) => normalizePlaylist({
    ...pl,
    isFavorite: /我喜欢|我的收藏|favorite|liked/i.test(pl.name || ''),
  }));
  return {
    provider: PROVIDER,
    loggedIn: !!r.loggedIn,
    playbackReady: !!r.playbackReady,
    userId: r.userId || null,
    nickname: r.nickname || null,
    playlists,
    message: r.message || (r.error && !playlists.length ? r.error : ''),
  };
}

export async function playlistTracks({ id, limit = 100, offset = 0 } = {}) {
  const listId = String(id || '');
  if (!listId) return { provider: PROVIDER, songs: [], tracks: [], message: '缺少歌单 id' };
  const r = await kugou.handleKugouPlaylistTracks(listId, cookie(), {
    limit: Math.min(200, Number(limit) || 100),
    offset: Number(offset) || 0,
    paged: true,
  });
  const songs = normalizeTracks(r.tracks || []);
  return {
    provider: PROVIDER,
    id: listId,
    songs,
    tracks: songs,
    count: songs.length,
    total: r.total || songs.length,
    loggedIn: true,
    message: r.message || '',
  };
}

export async function listLikes() {
  const list = await listPlaylists();
  const fav = (list.playlists || []).find((p) => p.isFavorite)
    || (list.playlists || []).find((p) => /我喜欢|收藏/.test(p.name || ''));
  if (!fav) {
    return {
      provider: PROVIDER,
      loggedIn: list.loggedIn,
      songs: [],
      tracks: [],
      playlists: list.playlists || [],
      message: list.loggedIn ? '未找到「我喜欢」歌单' : '请先登录酷狗',
    };
  }
  const tracks = await playlistTracks({ id: fav.id || fav.listId, limit: 200 });
  return {
    ...tracks,
    playlist: fav,
    playlists: list.playlists || [],
    loggedIn: true,
  };
}

function sendJSON(res, data, status = 200) {
  res.status(status).json(data);
}

function proxyKugouAudio(req, res, audioUrl) {
  const referer = kugou.kugouAudioReferer(audioUrl);
  const u = new URL(audioUrl);
  const lib = u.protocol === 'https:' ? https : http;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...(req.headers.range ? { Range: req.headers.range } : {}),
  };
  if (referer) headers.Referer = referer;
  const upstream = lib.request(u, { method: 'GET', headers }, (response) => {
    const outHeaders = {
      'Content-Type': response.headers['content-type'] || 'audio/mpeg',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    };
    ['content-length', 'content-range'].forEach((key) => {
      if (response.headers[key]) outHeaders[key] = response.headers[key];
    });
    res.writeHead(response.statusCode, outHeaders);
    response.pipe(res);
  });
  upstream.on('error', (err) => {
    if (!res.headersSent) sendJSON(res, { error: err.message }, 502);
    else res.end();
  });
  upstream.end();
}

/** Express 路由：挂载在 /api/kugou */
export function createKugouRouter({ requireAuth } = {}) {
  const router = express.Router();
  const auth = typeof requireAuth === 'function' ? requireAuth : (req, res, next) => next();

  // 音频代理必须免鉴权：<audio src> 不会带 Authorization，鉴权会 401 导致整份歌单播不了。
  // 仅允许酷狗 CDN 域名，不做开放代理。
  router.get('/audio', (req, res) => {
    const audioUrl = String(req.query.u || req.query.url || '');
    if (!audioUrl || !/^https?:\/\/[^\s]*kugou\.com/i.test(audioUrl)) {
      return sendJSON(res, { error: 'Invalid kugou audio url' }, 400);
    }
    proxyKugouAudio(req, res, audioUrl);
  });

  router.use(auth);

  router.get('/search', async (req, res) => {
    try {
      const songs = await search({
        q: req.query.q || req.query.keyword,
        limit: Number(req.query.limit) || 20,
        offset: Number(req.query.offset) || 0,
      });
      res.json({ provider: PROVIDER, songs, count: songs.length });
    } catch (e) {
      logProvider(`kugou search: ${e.message}`);
      res.status(502).json({ provider: PROVIDER, songs: [], error: e.code || e.message || '搜索失败' });
    }
  });

  router.get('/song/url', async (req, res) => {
    try {
      const result = await getSongUrl({ ...req.query, level: req.query.level || req.query.quality });
      res.json({ provider: PROVIDER, ...result });
    } catch (e) {
      logProvider(`kugou song/url: ${e.message}`);
      res.status(502).json({ provider: PROVIDER, playable: false, url: '', error: e.message, restriction: { category: 'url_unavailable', message: e.message, action: 'switch_source' } });
    }
  });

  router.get('/lyric', async (req, res) => {
    try {
      const result = await lyric({
        id: req.query.id,
        hash: req.query.hash,
        albumAudioId: req.query.albumAudioId || req.query.album_audio_id,
        duration: req.query.duration,
        durationMs: req.query.durationMs,
      });
      res.json(result);
    } catch (e) {
      res.status(502).json({ provider: PROVIDER, lyric: '', lrc: '', error: e.message });
    }
  });

  const playlistsHandler = async (req, res) => {
    try {
      res.json(await listPlaylists());
    } catch (e) {
      res.status(502).json({ provider: PROVIDER, playlists: [], loggedIn: false, error: e.message });
    }
  };
  router.get('/user/playlists', playlistsHandler);
  router.get('/playlists', playlistsHandler);

  router.get('/playlist/tracks', async (req, res) => {
    try {
      const result = await playlistTracks({
        id: req.query.id || req.query.listId,
        limit: Number(req.query.limit) || 100,
        offset: Number(req.query.offset) || 0,
      });
      res.json(result);
    } catch (e) {
      res.status(502).json({ provider: PROVIDER, songs: [], tracks: [], error: e.message });
    }
  });

  router.get('/likes', async (req, res) => {
    try {
      res.json(await listLikes());
    } catch (e) {
      res.status(502).json({ provider: PROVIDER, songs: [], tracks: [], loggedIn: false, error: e.message });
    }
  });

  router.post('/login/cookie', async (req, res) => {
    try {
      const r = await loginByCookie(req.body?.cookie ?? req.body?.Cookie ?? req.body?.data ?? req.body?.text);
      if (!r.ok) return res.status(400).json({ provider: PROVIDER, ok: false, error: r.error, code: r.code || null, partial: !!r.partial });
      res.json({
        provider: PROVIDER,
        ok: true,
        loggedIn: r.loggedIn,
        nickname: r.nickname || null,
        userId: r.userId || null,
        message: r.message,
        vipLabel: r.info?.vipLabel || null,
        isVip: !!r.info?.isVip,
        isSvip: !!r.info?.isSvip,
      });
    } catch (e) {
      res.status(500).json({ provider: PROVIDER, ok: false, error: e.message });
    }
  });

  router.get('/login/status', async (req, res) => {
    try {
      res.json(await loginStatus());
    } catch (e) {
      res.status(502).json({ provider: PROVIDER, loggedIn: false, error: e.message });
    }
  });

  router.post('/logout', async (req, res) => {
    try {
      await logout();
      res.json({ provider: PROVIDER, ok: true, loggedIn: false });
    } catch (e) {
      res.status(500).json({ provider: PROVIDER, error: e.message });
    }
  });

  router.get('/song/like/check', async (req, res) => {
    try {
      const result = await kugou.handleKugouLikeCheck({ hashes: req.query.hashes }, cookie());
      res.json(result);
    } catch (e) {
      res.status(502).json({ provider: PROVIDER, liked: {}, error: e.message });
    }
  });

  router.post('/song/like', async (req, res) => {
    try {
      const result = await kugou.handleKugouLikeToggle(req.body?.song, req.body?.like !== false, cookie());
      res.json(result);
    } catch (e) {
      res.status(502).json({ provider: PROVIDER, success: false, error: e.message });
    }
  });

  router.post('/playlist/add-song', async (req, res) => {
    try {
      const result = await kugou.handleKugouPlaylistAddSong(req.body?.listId, req.body?.song, cookie());
      res.json(result);
    } catch (e) {
      res.status(502).json({ provider: PROVIDER, success: false, error: e.message });
    }
  });

  return router;
}

export const kugouProvider = {
  name: PROVIDER,
  search,
  lyric,
  getSongUrl,
  getMembership,
  loginByCookie,
  loginStatus,
  logout,
  listPlaylists,
  playlistTracks,
  listLikes,
  qualityLadder: ['jymaster', 'hires', 'lossless', 'exhigh', 'standard'],
  createKugouRouter,
};

export default kugouProvider;
