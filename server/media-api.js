// 发现页媒体源: 听一听(免费音乐) + 看一看(抖音尝试 / 免费短视频回退)
const APP_NAME = 'hudui-wechat-clone';
const AUDIUS_HOSTS = [
  'https://discoveryprovider.audius.co',
  'https://discoveryprovider2.audius.co',
  'https://discoveryprovider3.audius.co',
];

const AUDIO_SAFE_VIDEOS = [
  {
    id: 'w3-sintel',
    title: 'Sintel 开源电影预告',
    author: 'Blender Foundation',
    likes: '12.6万',
    cover: null,
    url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
    source: 'open',
    description: '开源电影预告片（含配乐）',
  },
  {
    id: 'mdn-flower',
    title: '花开特写',
    author: 'MDN CC0',
    likes: '4.2万',
    cover: null,
    url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    source: 'open',
    description: 'CC0 短片',
  },
  {
    id: 'bbb-w3',
    title: 'Big Buck Bunny 片段',
    author: 'Blender',
    likes: '9.8万',
    cover: null,
    url: 'https://www.w3schools.com/html/mov_bbb.mp4',
    source: 'open',
    description: '经典开源动画片段',
  },
  {
    id: 'sample-5s',
    title: '示例短片',
    author: 'SampleLib',
    likes: '2.1万',
    cover: null,
    url: 'https://samplelib.com/lib/preview/mp4/sample-5s.mp4',
    source: 'open',
    description: '可播放示例视频',
  },
];

const FALLBACK_VIDEOS = [...AUDIO_SAFE_VIDEOS];

const lookCache = { at: 0, videos: null, source: '', tip: '', blocked: false };
const LOOK_CACHE_MS = 60_000;

async function fetchJson(url, opts = {}, timeout = 10000) {
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

async function audiusPath(path) {
  let lastErr = null;
  for (const host of AUDIUS_HOSTS) {
    try {
      const r = await fetchJson(`${host}${path}`);
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
    cover: s.album?.picUrl
      || s.al?.picUrl
      || (s.album?.picId ? `https://p1.music.126.net/6y-UleORITEDbvrOLV0Q8A==/${s.album.picId}.jpg` : null),
    duration: Math.round((s.duration || s.dt || 0) / 1000),
    genre: '网易云',
    source: 'netease',
  };
}

async function neteaseSearch(q = '热歌', limit = 20) {
  const url = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(q)}&type=1&limit=${limit}`;
  const r = await fetchJson(url, {
    headers: {
      Referer: 'https://music.163.com',
      'User-Agent': 'Mozilla/5.0',
    },
  });
  const songs = r.data?.result?.songs || [];
  const list = [];
  for (const s of songs) list.push(await neteaseMapSong(s));
  return list;
}

async function neteaseToplist(limit = 20) {
  const ids = [3778678, 19723756, 3779629]; // 热歌榜 / 飙升榜 / 新歌榜
  const all = [];
  for (const id of ids) {
    try {
      const r = await fetchJson(`https://music.163.com/api/playlist/detail?id=${id}`, {
        headers: {
          Referer: 'https://music.163.com',
          'User-Agent': 'Mozilla/5.0',
        },
      });
      const tracks = r.data?.result?.tracks || r.data?.playlist?.tracks || [];
      for (const t of tracks) {
        const m = await neteaseMapSong(t);
        if (m.id && !all.some((x) => x.id === m.id)) all.push(m);
      }
    } catch { /* try next list */ }
    if (all.length >= limit * 2) break;
  }
  return all;
}

async function filterPlayable(list, maxProbe = 8) {
  const out = [];
  let probed = 0;
  for (const t of list) {
    if (out.length >= 12) break;
    if (probed >= maxProbe && out.length >= 5) {
      // 已有足够可播结果，后续直接放入（播放失败会前端跳过）
      out.push(t);
      continue;
    }
    try {
      const url = await neteasePlayUrl(t.id);
      probed += 1;
      if (url) out.push(t);
    } catch { /* skip */ }
  }
  return out;
}

async function neteasePlayUrl(id) {
  const url = `https://music.163.com/api/song/enhance/player/url?ids=[${Number(id)}]&br=128000`;
  const r = await fetchJson(url, {
    headers: {
      Referer: 'https://music.163.com',
      'User-Agent': 'Mozilla/5.0',
    },
  });
  const u = r.data?.data?.[0]?.url;
  if (u && !String(u).includes('404')) return u;

  // 回退 outer url
  try {
    const res = await fetch(`https://music.163.com/song/media/outer/url?id=${Number(id)}.mp3`, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    const loc = res.headers.get('location');
    if (loc && !loc.includes('404')) return loc;
  } catch { /* ignore */ }
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
        signal: AbortSignal.timeout(8000),
      });
      const loc = res.headers.get('location');
      if (loc) return loc;
      if (res.ok) return u;
    } catch { /* try next host */ }
  }
  return AUDIUS_HOSTS[0] + `/v1/tracks/${encodeURIComponent(id)}/stream?app_name=${encodeURIComponent(APP_NAME)}`;
}

async function fetchCoverrVideos(limit = 24) {
  const out = [];
  const pages = [1, 2, 3, 4];
  for (const page of pages) {
    if (out.length >= limit) break;
    try {
      const r = await fetchJson(`https://coverr.co/api/videos?page=${page}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }, 12000);
      const hits = r.data?.hits || [];
      for (const v of hits) {
        if (out.length >= limit) break;
        if (!v?.base_filename || v.is_premium) continue;
        out.push({
          id: v.objectID || v.id || v.video_id || v.base_filename,
          title: (v.title || '短视频').trim(),
          author: 'Coverr 精选',
          likes: String(Math.round((v.downloads || 0) / 100) / 10) + '万',
          cover: v.thumbnail || v.poster || null,
          url: `https://cdn.coverr.co/videos/${v.base_filename}/1080p.mp4?download=true`,
          source: 'coverr',
          description: (v.description || '').trim(),
        });
      }
    } catch { /* next page */ }
  }
  return out.filter((v) => v.url && v.title);
}

/** 尝试抖音首页公开数据（通常被反爬，失败则回退免费源） */
async function tryDouyinHome() {
  const attempts = [
    {
      url: 'https://www.douyin.com/',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        Accept: 'text/html,application/xhtml+xml',
        Referer: 'https://www.douyin.com/',
      },
    },
    {
      url: 'https://www.douyin.com/?recommend=1',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
    },
  ];

  for (const a of attempts) {
    try {
      const res = await fetch(a.url, {
        headers: a.headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });
      const html = await res.text() || '';
      // 抖音 SSR 数据常见挂在 RENDER_DATA / _ROUTER_DATA
      const patterns = [
        /window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
        /<script id="RENDER_DATA" type="application\/json">([\s\S]*?)<\/script>/,
        /self\.__next_f\.push\(\[1,\s*"(\{[\s\S]*?\})"\]\)/,
      ];
      for (const re of patterns) {
        const m = html.match(re);
        if (!m) continue;
        let raw = m[1];
        try { raw = decodeURIComponent(raw); } catch { /* keep raw */ }
        try {
          const data = JSON.parse(raw);
          const blob = JSON.stringify(data);
          const urlMatches = blob.match(/https?:\\?\/\\?\/[^"\\]+\.(?:mp4|jpeg|jpg|webp)[^"\\]*/gi) || [];
          const cleaned = urlMatches
            .map((u) => u.replace(/\\\//g, '/'))
            .filter((u) => u.includes('.mp4'))
            .slice(0, 12);
          if (cleaned.length) {
            return {
              ok: true,
              reason: 'douyin',
              videos: cleaned.map((u, i) => ({
                id: `dy-${i}`,
                title: `抖音推荐 ${i + 1}`,
                author: '抖音',
                likes: '—',
                cover: null,
                url: u,
                source: 'douyin',
              })),
            };
          }
        } catch { /* parse fail */ }
      }
      // 兜底: 页面过短说明被风控拦截
      if (html.length < 8000 && /verify|captcha|login|滑动|验证/i.test(html)) {
        return { ok: false, reason: 'douyin_captcha', videos: [] };
      }
    } catch (e) {
      return { ok: false, reason: e.message || 'douyin_fetch_failed', videos: [] };
    }
  }
  return { ok: false, reason: 'douyin_no_public_payload', videos: [] };
}

export function createMediaApi() {
  return {
    /** 听一听: 热歌/搜索 */
    async musicList(req, res) {
      const q = String(req.query.q || '').trim();
      const source = String(req.query.source || (q ? 'all' : 'audius'));
      const limit = Math.min(40, Number(req.query.limit) || 20);
      const tracks = [];
      const notes = [];

      const wantAudius = source === 'audius' || source === 'all';
      const wantNetease = source === 'netease' || source === 'all' || Boolean(q);

      if (wantAudius) {
        try {
          const path = q
            ? `/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=${encodeURIComponent(APP_NAME)}&limit=${limit}`
            : `/v1/tracks/trending?app_name=${encodeURIComponent(APP_NAME)}&limit=${limit}`;
          const list = await audiusPath(path);
          for (const t of list || []) {
            if (t?.id) tracks.push(mapAudiusTrack(t));
          }
        } catch (e) {
          notes.push(`Audius: ${e.message}`);
        }
      }

      if (wantNetease) {
        try {
          const raw = q
            ? await neteaseSearch(q, limit)
            : await neteaseToplist(limit);
          const playable = await filterPlayable(raw, source === 'netease' ? 10 : 6);
          const useList = playable.length ? playable : raw;
          const seen = new Set(tracks.map((t) => `${t.source}:${t.id}`));
          for (const t of useList) {
            if (source === 'netease' && tracks.length >= limit) break;
            if (source !== 'netease' && tracks.length >= limit) break;
            const key = `${t.source}:${t.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            tracks.push(t);
          }
        } catch (e) {
          notes.push(`网易云: ${e.message}`);
        }
      }

      res.json({
        tracks: tracks.slice(0, limit),
        source,
        notes,
      });
    },

    /** 听一听: 解析可播放地址 */
    async musicStreamInfo(req, res) {
      const source = String(req.params.source || '');
      const id = String(req.params.id || '');
      if (!id) return res.status(400).json({ error: '缺少歌曲 ID' });
      try {
        if (source === 'netease') {
          const url = await neteasePlayUrl(id);
          if (!url) return res.status(404).json({ error: '该歌曲暂无可用播放地址' });
          return res.json({ url, source });
        }
        const url = await audiusStreamUrl(id);
        return res.json({ url, source: 'audius' });
      } catch (e) {
        return res.status(502).json({ error: e.message || '获取播放地址失败' });
      }
    },

    /** 听一听: 音频流代理（规避部分跨域） */
    async musicProxy(req, res) {
      const source = String(req.query.source || 'audius');
      const id = String(req.query.id || '');
      try {
        let url = null;
        if (source === 'netease') url = await neteasePlayUrl(id);
        else url = await audiusStreamUrl(id);
        if (!url) return res.status(404).json({ error: '无可用播放地址' });

        const tryFetch = async (useRange) => {
          const headers = {
            'User-Agent': 'Mozilla/5.0',
            Accept: '*/*',
          };
          if (useRange && req.headers.range) headers.Range = req.headers.range;
          if (source === 'netease') headers.Referer = 'https://music.163.com/';
          return fetch(url, {
            headers,
            redirect: 'follow',
            signal: AbortSignal.timeout(25000),
          });
        };

        let upstream = await tryFetch(true);
        if (upstream.status === 416 || upstream.status === 403 || !upstream.ok) {
          upstream = await tryFetch(false);
        }
        if (!upstream.ok && upstream.status !== 206) {
          // 最后回退: 让浏览器直连
          return res.redirect(302, url);
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
        try {
          if (source === 'netease') {
            const u = await neteasePlayUrl(id);
            if (u) return res.redirect(302, u);
          } else {
            return res.redirect(302, await audiusStreamUrl(id));
          }
        } catch { /* ignore */ }
        res.status(502).json({ error: e.message || '代理失败' });
      }
    },

    /** 看一看: 抖音尝试 + 免费视频回退（不展示提示给前端） */
    async lookFeed(req, res) {
      const force = String(req.query.refresh || '') === '1';
      if (!force && lookCache.videos && Date.now() - lookCache.at < LOOK_CACHE_MS) {
        return res.json({
          source: lookCache.source,
          tip: '',
          blocked: lookCache.blocked,
          videos: lookCache.videos,
        });
      }

      const douyin = await tryDouyinHome();
      if (douyin.ok && douyin.videos.length) {
        lookCache.at = Date.now();
        lookCache.source = 'douyin';
        lookCache.blocked = false;
        lookCache.videos = douyin.videos;
        return res.json({
          source: 'douyin',
          tip: '',
          blocked: false,
          videos: douyin.videos,
        });
      }

      const coverr = await fetchCoverrVideos(24);
      // 先放有音轨的开源片，再补 Coverr，保证用户点开能听到声音
      const mixed = [...AUDIO_SAFE_VIDEOS];
      const seen = new Set(mixed.map((v) => v.id));
      for (const v of coverr) {
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        mixed.push(v);
        if (mixed.length >= 28) break;
      }
      const videos = mixed.length ? mixed : FALLBACK_VIDEOS;
      lookCache.at = Date.now();
      lookCache.source = 'fallback';
      lookCache.blocked = true;
      lookCache.videos = videos;
      return res.json({
        source: 'fallback',
        tip: '',
        blocked: true,
        blockReason: douyin.reason || 'douyin_blocked',
        douyinUrl: 'https://www.douyin.com/',
        videos,
      });
    },
  };
}
