// 发现页媒体源: 本地优先（data/media/demo）+ 可选网络回退
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stmts } from './db.js';

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
  return {
    /**
     * 听一听列表：默认本地优先
     * source: local | all | audius | netease
     */
    async musicList(req, res) {
      const q = String(req.query.q || '').trim();
      const source = String(req.query.source || 'local');
      const limit = Math.min(40, Number(req.query.limit) || 30);
      const notes = [];
      const tracks = [];

      // 1) 本地始终优先
      const local = searchLocalTracks(q);
      for (const t of local) tracks.push(t);

      if (source === 'local') {
        return res.json({
          tracks: tracks.slice(0, limit),
          source: 'local',
          notes: tracks.length ? [] : ['本地 demo 素材未就绪，请运行 scripts/gen-demo-media.py'],
        });
      }

      // 2) 网络源（可选回退）
      const wantAudius = source === 'audius' || source === 'all';
      const wantNetease = source === 'netease' || source === 'all' || (Boolean(q) && source !== 'audius');

      if (wantAudius) {
        try {
          const pathname = q
            ? `/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=${encodeURIComponent(APP_NAME)}&limit=${limit}`
            : `/v1/tracks/trending?app_name=${encodeURIComponent(APP_NAME)}&limit=${limit}`;
          const list = await audiusPath(pathname);
          for (const t of list || []) {
            if (t?.id) tracks.push(mapAudiusTrack(t));
          }
        } catch (e) {
          notes.push(`Audius: ${e.message}`);
        }
      }

      if (wantNetease) {
        try {
          const raw = q ? await neteaseSearch(q, 8) : await neteaseToplist(8);
          const seen = new Set(tracks.map((t) => `${t.source}:${t.id}`));
          for (const t of raw) {
            const key = `${t.source}:${t.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            tracks.push(t);
          }
        } catch (e) {
          notes.push(`网易云: ${e.message}`);
        }
      }

      if (!tracks.length) {
        notes.push('网络媒体源不可达，已回退本地 demo');
        tracks.push(...availableLocalTracks());
      }

      res.json({ tracks: tracks.slice(0, limit), source, notes });
    },

    /** 播放地址：本地直出，网络走解析 */
    async musicStreamInfo(req, res) {
      const source = String(req.params.source || '');
      const id = String(req.params.id || '');
      if (!id) return res.status(400).json({ error: '缺少歌曲 ID' });

      const local = findLocalTrack(id) || (source === 'local' ? findLocalTrack(id) : null);
      if (local && localFileExists(local.url)) {
        return res.json({ url: local.url, source: 'local' });
      }

      try {
        if (source === 'netease') {
          const url = await neteasePlayUrl(id);
          if (!url) return res.status(404).json({ error: '该歌曲暂无可用播放地址（网络源）' });
          return res.json({ url, source });
        }
        if (source === 'audius') {
          const url = await audiusStreamUrl(id);
          return res.json({ url, source: 'audius' });
        }
      } catch (e) {
        return res.status(502).json({ error: e.message || '获取播放地址失败' });
      }
      return res.status(404).json({ error: '未找到可播放资源' });
    },

    /** 音频代理：本地文件直读；网络源失败时明确报错 */
    async musicProxy(req, res) {
      const source = String(req.query.source || 'local');
      const id = String(req.query.id || '');

      const local = findLocalTrack(id);
      if (local) return streamLocalFile(local.url, req, res);

      if (source === 'local' || String(id).startsWith('local-')) {
        return res.status(404).json({ error: '本地媒体不存在' });
      }

      try {
        let url = null;
        if (source === 'netease') url = await neteasePlayUrl(id);
        else url = await audiusStreamUrl(id);
        if (!url) {
          return res.status(404).json({ error: '网络媒体源不可用（国内可能无法访问），请播放「本地」曲目' });
        }

        const headers = { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' };
        if (req.headers.range) headers.Range = req.headers.range;
        if (source === 'netease') headers.Referer = 'https://music.163.com/';

        const upstream = await fetch(url, {
          headers,
          redirect: 'follow',
          signal: AbortSignal.timeout(15000),
        });
        if (!upstream.ok && upstream.status !== 206) {
          return res.status(502).json({ error: '网络媒体拉取失败（可能被墙或无版权）' });
        }
        const ct = upstream.headers.get('content-type') || 'audio/mpeg';
        const range = upstream.headers.get('content-range');
        const len = upstream.headers.get('content-length');
        res.status(upstream.status === 206 ? 206 : 200);
        res.setHeader('Content-Type', ct);
        res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
        if (len) res.setHeader('Content-Length', len);
        if (range) res.setHeader('Content-Range', range);
        res.setHeader('Cache-Control', 'no-store');
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.end(buf);
      } catch (e) {
        res.status(502).json({ error: `网络媒体代理失败：${e.message}` });
      }
    },

    /**
     * 看一看 feed：仅本地 demo + UGC 用户上传（不拉抖音/Coverr 等外站）
     */
    async lookFeed(req, res) {
      const uid = req.user?.id;
      const localVideos = availableLocalVideos();

      let ugc = [];
      try {
        const rows = stmts.listLookPosts.all() || [];
        ugc = rows
          .map((r) => ({
            id: `ugc-${r.id}`,
            title: r.title || '用户视频',
            author: r.author || r.uname || '用户',
            likes: String(r.likes || 0),
            cover: r.cover_url || null,
            url: String(r.media_url || '').startsWith('/media/') ? r.media_url : null,
            source: 'ugc',
            mine: Number(uid) === Number(r.user_id),
            userId: r.user_id,
            description: '用户上传',
          }))
          .filter((v) => v.url);
      } catch {
        ugc = [];
      }

      // UGC 在前，本地 demo 在后
      const videos = [...ugc, ...localVideos];
      res.json({
        source: 'local+ugc',
        tip: videos.length
          ? `本地/自有片源 · ${ugc.length} 条用户上传 · ${localVideos.length} 条系统样片`
          : '暂无视频，可点右上角「发布」上传',
        blocked: false,
        videos,
      });
    },

    /** 调试：列出本地 demo 文件 */
    demoCatalog(req, res) {
      res.json({
        dir: DEMO_DIR,
        tracks: LOCAL_TRACKS.map((t) => ({ ...t, exists: localFileExists(t.url) })),
        videos: LOCAL_VIDEOS.map((v) => ({ ...v, exists: localFileExists(v.url) })),
      });
    },
  };
}

export { LOCAL_TRACKS, LOCAL_VIDEOS };
