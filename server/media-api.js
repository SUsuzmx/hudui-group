// 发现页媒体源: 本地优先（data/media/demo）+ 可选网络回退
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stmts } from './db.js';
import netease from './providers/netease.js';
import qq from './providers/qq.js';
import kugou from './providers/kugou.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const DEMO_DIR = path.join(ROOT, 'data', 'media', 'demo');

const APP_NAME = 'hudui-wechat-clone';
const AUDIUS_HOSTS = [
  'https://discoveryprovider.audius.co',
  'https://discoveryprovider2.audius.co',
  'https://discoveryprovider3.audius.co',
];

/** 本地演示曲目 — 国内可直接播放（同源 /media/demo/） */
const LOCAL_TRACKS = [
  {
    id: 'local-bgm',
    title: '叠塔挑战 · 主旋律',
    artist: 'Hudui Demo',
    cover: '/media/demo/cover-bgm.png',
    url: '/media/demo/listen-bgm.mp3',
    duration: 0,
    genre: '游戏',
    source: 'local',
  },
  {
    id: 'local-calm',
    title: '静心 · 轻音乐 Demo',
    artist: 'Hudui Demo',
    cover: '/media/demo/cover-calm.png',
    url: '/media/demo/listen-calm.wav',
    duration: 0,
    genre: '轻音乐',
    source: 'local',
  },
  {
    id: 'local-pop',
    title: '热歌 · 节奏 Demo',
    artist: 'Hudui Demo',
    cover: '/media/demo/cover-pop.png',
    url: '/media/demo/listen-pop.wav',
    duration: 0,
    genre: '流行',
    source: 'local',
  },
  {
    id: 'local-night',
    title: '夜色 · 氛围 Demo',
    artist: 'Hudui Demo',
    cover: '/media/demo/cover-night.png',
    url: '/media/demo/listen-night.wav',
    duration: 0,
    genre: '氛围',
    source: 'local',
  },
  {
    id: 'local-gameover',
    title: '提示音 · 短曲',
    artist: 'Hudui Demo',
    cover: '/media/demo/cover-game.png',
    url: '/media/demo/listen-gameover.mp3',
    duration: 0,
    genre: '音效',
    source: 'local',
  },
];

/** 本地演示视频 — 同源可播 */
const LOCAL_VIDEOS = [
  {
    id: 'look-flower',
    title: '花开特写',
    author: '本地 CC0 样片',
    likes: '4.2万',
    cover: '/media/demo/cover-flower.png',
    url: '/media/demo/look-flower.mp4',
    source: 'local',
    description: '本地素材 · 国内可播',
  },
  {
    id: 'look-sintel',
    title: 'Sintel 开源预告',
    author: 'Blender Foundation',
    likes: '12.6万',
    cover: '/media/demo/cover-sintel.png',
    url: '/media/demo/look-sintel.mp4',
    source: 'local',
    description: '开源电影预告（已缓存本地）',
  },
  {
    id: 'look-sample',
    title: '本地示例短片',
    author: 'SampleLib',
    likes: '2.1万',
    cover: '/media/demo/cover-sample.png',
    url: '/media/demo/look-sample.mp4',
    source: 'local',
    description: '同源演示视频',
  },
];

function localFileExists(relUrl) {
  try {
    const rel = String(relUrl || '').replace(/^\/media\//, '');
    if (!rel || rel.includes('..')) return false;
    return fs.existsSync(path.join(ROOT, 'data', 'media', rel));
  } catch {
    return false;
  }
}

function availableLocalTracks() {
  return LOCAL_TRACKS.filter((t) => localFileExists(t.url));
}

function availableLocalVideos() {
  return LOCAL_VIDEOS.filter((v) => localFileExists(v.url));
}

function streamLocalFile(relUrl, req, res) {
  const rel = String(relUrl || '').replace(/^\/media\//, '');
  const abs = path.join(ROOT, 'data', 'media', rel);
  if (rel.includes('..') || !abs.startsWith(path.join(ROOT, 'data', 'media'))) {
    return res.status(400).json({ error: '非法路径' });
  }
  if (!fs.existsSync(abs)) {
    return res.status(404).json({ error: '本地媒体不存在' });
  }
  const stat = fs.statSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const type = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
  }[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', end - start + 1);
    fs.createReadStream(abs, { start, end }).pipe(res);
    return;
  }
  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(abs).pipe(res);
}

async function fetchJson(url, opts = {}, timeout = 8000) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json,text/plain,*/*',
      ...(opts.headers || {}),
    },
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text), text };
  } catch {
    return { ok: res.ok, status: res.status, data: null, text };
  }
}

async function audiusPath(pathname) {
  let lastErr = null;
  for (const host of AUDIUS_HOSTS) {
    try {
      const r = await fetchJson(`${host}${pathname}`);
      if (r.ok && r.data?.data) return r.data.data;
      lastErr = r.text?.slice(0, 120) || r.status;
    } catch (e) {
      lastErr = e.message;
    }
  }
  throw new Error(lastErr || 'Audius 不可用');
}

function mapAudiusTrack(t) {
  return {
    id: t.id,
    title: t.title || '未知曲目',
    artist: t.user?.name || 'Audius 音乐人',
    cover: t.artwork?.['480x480'] || t.artwork?.['150x150'] || null,
    duration: Number(t.duration) || 0,
    genre: t.genre || '',
    source: 'audius',
  };
}

async function neteaseMapSong(s) {
  return {
    id: s.id,
    title: s.name || '未知歌曲',
    artist: (s.artists || s.ar || []).map((a) => a.name).filter(Boolean).join(' / ')
      || (s.album?.artist?.name || '未知歌手'),
    cover: s.album?.picUrl || s.al?.picUrl || null,
    duration: Math.round((s.duration || s.dt || 0) / 1000),
    genre: '网易云',
    source: 'netease',
  };
}

async function neteaseSearch(q = '热歌', limit = 12) {
  const url = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(q)}&type=1&limit=${limit}`;
  const r = await fetchJson(url, {
    headers: { Referer: 'https://music.163.com', 'User-Agent': 'Mozilla/5.0' },
  });
  const songs = r.data?.result?.songs || [];
  return songs.map((s) => neteaseMapSong(s));
}

async function neteaseToplist(limit = 12) {
  const ids = [3778678, 19723756];
  const all = [];
  for (const id of ids) {
    try {
      const r = await fetchJson(`https://music.163.com/api/playlist/detail?id=${id}`, {
        headers: { Referer: 'https://music.163.com', 'User-Agent': 'Mozilla/5.0' },
      }, 8000);
      const tracks = r.data?.result?.tracks || r.data?.playlist?.tracks || [];
      for (const t of tracks) {
        const m = await neteaseMapSong(t);
        if (m.id && !all.some((x) => x.id === m.id)) all.push(m);
      }
    } catch { /* next */ }
    if (all.length >= limit) break;
  }
  return all.slice(0, limit);
}

async function neteasePlayUrl(id) {
  const url = `https://music.163.com/api/song/enhance/player/url?ids=[${Number(id)}]&br=128000`;
  const r = await fetchJson(url, {
    headers: { Referer: 'https://music.163.com', 'User-Agent': 'Mozilla/5.0' },
  }, 8000);
  const u = r.data?.data?.[0]?.url;
  if (u && !String(u).includes('404')) return u;
  return null;
}

async function audiusStreamUrl(id) {
  for (const host of AUDIUS_HOSTS) {
    const u = `${host}/v1/tracks/${encodeURIComponent(id)}/stream?app_name=${encodeURIComponent(APP_NAME)}`;
    try {
      const res = await fetch(u, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(6000),
      });
      const loc = res.headers.get('location');
      if (loc) return loc;
      if (res.ok) return u;
    } catch { /* next */ }
  }
  return AUDIUS_HOSTS[0] + `/v1/tracks/${encodeURIComponent(id)}/stream?app_name=${encodeURIComponent(APP_NAME)}`;
}

function findLocalTrack(id) {
  return LOCAL_TRACKS.find((t) => t.id === id) || null;
}

function findLocalVideo(id) {
  return LOCAL_VIDEOS.find((v) => v.id === id) || null;
}

function searchLocalTracks(q = '') {
  const list = availableLocalTracks();
  if (!q) return list;
  const k = q.toLowerCase();
  return list.filter((t) =>
    String(t.title).toLowerCase().includes(k)
    || String(t.artist).toLowerCase().includes(k)
    || String(t.genre).toLowerCase().includes(k)
  );
}

export function createMediaApi() {
  const ALLOWED = new Set(['netease', 'qq', 'kugou']);
  const SOURCES = ['netease', 'qq', 'kugou'];
  async function resolveSongUrl(source, req) {
    const id = String(req.params.id || req.query.id || '');
    const level = String(req.query.level || req.query.quality || 'exhigh');
    if (source === 'kugou') {
      return kugou.getSongUrl({
        id,
        hash: req.query.hash || id,
        albumId: req.query.albumId || req.query.album_id,
        albumAudioId: req.query.albumAudioId || req.query.album_audio_id || req.query.mixSongId,
        mixSongId: req.query.mixSongId || req.query.mixsongid,
        quality: req.query.quality || level,
        privilege: req.query.privilege,
        vipRequired: req.query.vipRequired,
        hqHash: req.query.hqHash,
        sqHash: req.query.sqHash,
        resHash: req.query.resHash,
      });
    }
    const meta = req.query.title ? { title: String(req.query.title), artists: String(req.query.artist || '').split(/[\/,]/).filter(Boolean), mid: req.query.mid, mediaMid: req.query.mediaMid } : null;
    if (source === 'netease') return netease.getSongUrl({ id, level, songMeta: meta });
    return qq.getSongUrl({
      id,
      mid: req.query.mid || req.query.songmid || id,
      mediaMid: req.query.mediaMid || req.query.media_mid || id,
      level,
      songMeta: meta,
    });
  }
  return {
    /** 听一听：网易云 / QQ / 酷狗，默认 QQ */
    async musicList(req, res) {
      const q = String(req.query.q || '').trim() || '热歌';
      const source = ALLOWED.has(String(req.query.source)) ? String(req.query.source) : 'qq';
      const limit = Math.min(40, Number(req.query.limit) || 30);
      const notes = [];
      let tracks = [];
      try {
        tracks = source === 'kugou'
          ? await kugou.search({ q, limit })
          : source === 'netease'
            ? await netease.search({ q, limit })
            : await qq.search({ q, limit });
      } catch (e) {
        notes.push(e.message);
        try {
          const fallbackOrder = SOURCES.filter((s) => s !== source);
          for (const other of fallbackOrder) {
            try {
              tracks = other === 'kugou'
                ? await kugou.search({ q, limit })
                : other === 'netease'
                  ? await netease.search({ q, limit })
                  : await qq.search({ q, limit });
              notes.push(`已切换到${other}`);
              return res.json({ tracks, source: other, notes, sources: SOURCES, defaultSource: 'qq' });
            } catch (e2) { notes.push(e2.message); }
          }
        } catch (e2) { notes.push(e2.message); }
      }
      res.json({ tracks, source, notes, sources: SOURCES, defaultSource: 'qq' });
    },
    async musicStreamInfo(req, res) {
      const source = String(req.params.source || '');
      const id = String(req.params.id || '');
      if (!id && source !== 'kugou') return res.status(400).json({ error: '缺少歌曲 ID' });
      if (!ALLOWED.has(source)) {
        return res.status(400).json({ error: '仅支持网易云、QQ 与酷狗音乐', playable: false, restriction: { category: 'url_unavailable', message: '仅支持网易云、QQ 与酷狗音乐', action: 'switch_source' } });
      }
      try {
        const result = await resolveSongUrl(source, req);
        res.json({ ...result, source, error: result.playable ? undefined : (result.restriction?.message || '暂无可用播放地址') });
      } catch (e) {
        res.status(502).json({ error: e.message, playable: false, url: '', restriction: { category: 'url_unavailable', message: e.message, action: 'switch_source' } });
      }
    },
    async musicProxy(req, res) {
      const source = String(req.query.source || '');
      const id = String(req.query.id || '');
      if (!ALLOWED.has(source)) return res.status(400).json({ error: '仅支持网易云、QQ 与酷狗音乐' });
      try {
        const result = await resolveSongUrl(source, { params: { id }, query: req.query });
        const fetchUrl = result.cdnUrl || result.url;
        if (!result.playable || !fetchUrl || String(fetchUrl).startsWith('/')) {
          return res.status(404).json({ error: result.restriction?.message || '暂无可用播放地址', restriction: result.restriction || null });
        }
        const headers = { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' };
        if (req.headers.range) headers.Range = req.headers.range;
        if (source === 'kugou') headers.Referer = 'https://www.kugou.com/';
        else if (source === 'netease') headers.Referer = 'https://music.163.com/';
        else headers.Referer = 'https://y.qq.com/';
        const upstream = await fetch(fetchUrl, { headers, redirect: 'follow', signal: AbortSignal.timeout(15000) });
        if (!upstream.ok && upstream.status !== 206) return res.status(502).json({ error: '媒体拉取失败' });
        res.status(upstream.status === 206 ? 206 : 200);
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
        if (upstream.headers.get('content-length')) res.setHeader('Content-Length', upstream.headers.get('content-length'));
        if (upstream.headers.get('content-range')) res.setHeader('Content-Range', upstream.headers.get('content-range'));
        res.setHeader('Cache-Control', 'no-store');
        res.end(Buffer.from(await upstream.arrayBuffer()));
      } catch (e) { res.status(502).json({ error: e.message }); }
    },
    async lookFeed(req, res) {
      const uid = req.user?.id;
      const localVideos = availableLocalVideos();
      let ugc = [];
      try {
        const rows = stmts.listLookPosts.all() || [];
        ugc = rows.map((r) => ({
          id: `ugc-${r.id}`, title: r.title || '用户视频', author: r.author || r.uname || '用户',
          likes: String(r.likes || 0), cover: r.cover_url || null,
          url: String(r.media_url || '').startsWith('/media/') ? r.media_url : null,
          source: 'ugc', mine: Number(uid) === Number(r.user_id), userId: r.user_id, description: '用户上传',
        })).filter((v) => v.url);
      } catch { ugc = []; }
      const videos = [...ugc, ...localVideos];
      res.json({ source: 'local+ugc', tip: videos.length ? `本地/自有片源 · ${ugc.length} 条用户上传` : '暂无视频', blocked: false, videos });
    },
    demoCatalog(req, res) {
      res.json({ tracks: LOCAL_TRACKS.map((t) => ({ ...t, exists: localFileExists(t.url) })), videos: LOCAL_VIDEOS.map((v) => ({ ...v, exists: localFileExists(v.url) })) });
    },
  };
}

export { LOCAL_TRACKS, LOCAL_VIDEOS };
