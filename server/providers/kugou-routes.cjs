'use strict';

// ============================================================================
// 酷狗音乐接入路由层（与同目录 kugou-api.js 配套）
//
// 用法: 在你的 HTTP server 里 require 本模块，把 kugouRoutes(req, res, url)
//       挂在路由分发处（见底部示例）。依赖同目录的 kugou-api.cjs
//      （原项目 E:\music\Mineradio-paused-main\kugou-api.js，2265 行，零外部依赖）。
// Cookie 持久化到 .kugou-cookie；音频走代理绕防盗链。
// ============================================================================

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const kugou = require('./kugou-api.cjs');

const KUGOU_COOKIE_FILE = path.join(__dirname, '.kugou-cookie');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ---------- Cookie 持久化 ----------

let kugouCookie = readCookieFile();

function readCookieFile() {
  try {
    if (fs.existsSync(KUGOU_COOKIE_FILE)) return fs.readFileSync(KUGOU_COOKIE_FILE, 'utf8').trim();
  } catch (_) {}
  return '';
}
function saveKugouCookie(cookieText) {
  kugouCookie = kugou.normalizeKugouCookieInput(cookieText);
  try {
    fs.mkdirSync(path.dirname(KUGOU_COOKIE_FILE), { recursive: true });
    fs.writeFileSync(KUGOU_COOKIE_FILE, kugouCookie, 'utf8');
  } catch (e) { console.warn('[KugouCookie] write failed:', e.message); }
  return kugouCookie;
}

// ---------- JSON/请求体工具 ----------

function sendJSON(res, data, status) {
  const body = JSON.stringify(data);
  res.writeHead(status || 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : {}); } catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ---------- 音频代理（关键：酷狗 CDN 校验 Referer，前端直连必 403） ----------

function proxyKugouAudio(req, res, audioUrl) {
  const referer = kugou.kugouAudioReferer(audioUrl);
  const u = new URL(audioUrl);
  const lib = u.protocol === 'https:' ? https : http;
  const headers = {
    'User-Agent': UA,
    // Range 透传（拖进度条需要 206 响应）
    ...(req.headers.range ? { Range: req.headers.range } : {}),
  };
  if (referer) headers.Referer = referer;
  const upstream = lib.request(u, { method: 'GET', headers }, response => {
    const outHeaders = {
      'Content-Type': response.headers['content-type'] || 'audio/mpeg',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
    };
    ['content-length', 'content-range'].forEach(key => {
      if (response.headers[key]) outHeaders[key] = response.headers[key];
    });
    res.writeHead(response.statusCode, outHeaders);
    response.pipe(res);
  });
  upstream.on('error', err => {
    if (!res.headersSent) sendJSON(res, { error: err.message }, 502);
    else res.end();
  });
  upstream.end();
}

// ---------- 路由主入口 ----------

// 挂载方式（在你的 server 里）:
//   const { kugouRoutes } = require('./kugou-routes');
//   if (await kugouRoutes(req, res, url)) return;   // 命中酷狗路由则结束，否则继续你的路由
async function kugouRoutes(req, res, url) {
  const pn = url.pathname;
  const sp = url.searchParams;

  // ----- 登录: Cookie 导入 -----
  // POST /api/kugou/login/cookie  { cookie: "KuGoo=...; kg_mid=..." }
  if (pn === '/api/kugou/login/cookie') {
    try {
      const body = await readRequestBody(req);
      const normalized = kugou.normalizeKugouCookieInput(body.cookie || body.data || body.text || '');
      if (!kugou.kugouCookieHasPlayback(normalized)) {
        sendJSON(res, {
          provider: 'kugou',
          loggedIn: kugou.kugouCookieHasLogin(normalized),
          error: 'INVALID_KUGOU_COOKIE',
          message: '酷狗 Cookie 缺少 KuGoo 字段（或其中的 userid/token）。请登录 www.kugou.com 后从浏览器完整复制 Cookie',
        }, 400);
        return true;
      }
      saveKugouCookie(normalized);
      const info = await kugou.getKugouLoginInfo(kugouCookie);
      sendJSON(res, { ...info, saved: true });
    } catch (err) {
      sendJSON(res, { provider: 'kugou', loggedIn: false, error: err.message }, 500);
    }
    return true;
  }

  // ----- 登录态查询 -----
  // GET /api/kugou/login/status
  if (pn === '/api/kugou/login/status') {
    try {
      const info = await kugou.getKugouLoginInfo(kugouCookie);
      sendJSON(res, info);
    } catch (err) {
      sendJSON(res, { provider: 'kugou', loggedIn: false, error: err.message }, 500);
    }
    return true;
  }

  // ----- 登出 -----
  // POST /api/kugou/logout
  if (pn === '/api/kugou/logout') {
    saveKugouCookie('');
    kugou.clearKugouSessionCaches();
    sendJSON(res, { provider: 'kugou', ok: true, loggedIn: false });
    return true;
  }

  // ----- 搜索（匿名可用） -----
  // GET /api/kugou/search?keyword=&limit=&offset=
  if (pn === '/api/kugou/search') {
    try {
      const songs = await kugou.handleKugouSearch(
        sp.get('keyword'), sp.get('limit') || '20', kugouCookie, sp.get('offset') || '0'
      );
      sendJSON(res, { provider: 'kugou', songs });
    } catch (err) {
      sendJSON(res, { provider: 'kugou', songs: [], error: err.code || err.message }, 500);
    }
    return true;
  }

  // ----- 播放地址（需登录） -----
  // GET /api/kugou/song/url?hash=&albumId=&albumAudioId=&quality=&privilege=
  // quality: standard|exhigh|lossless|hires|jymaster
  if (pn === '/api/kugou/song/url') {
    try {
      const result = await kugou.handleKugouSongUrl({
        hash: sp.get('hash'),
        albumId: sp.get('albumId'),
        albumAudioId: sp.get('albumAudioId') || sp.get('mixSongId'),
        mixSongId: sp.get('mixSongId'),
        quality: sp.get('quality') || 'standard',
        privilege: sp.get('privilege'),
        vipRequired: sp.get('vipRequired'),
      }, kugouCookie);
      // 音频 URL 改写为代理地址（前端永远不直连酷狗 CDN）
      if (result && result.url) {
        result.proxyUrl = '/api/kugou/audio?u=' + encodeURIComponent(result.url);
      }
      sendJSON(res, result);
    } catch (err) {
      sendJSON(res, { provider: 'kugou', playable: false, error: err.message }, 500);
    }
    return true;
  }

  // ----- 音频代理 -----
  // GET /api/kugou/audio?u=<编码后的酷狗CDN地址>
  if (pn === '/api/kugou/audio') {
    const audioUrl = sp.get('u');
    if (!audioUrl || !/^https?:\/\/[^\s]*kugou\.com/i.test(audioUrl)) {
      sendJSON(res, { error: 'Invalid kugou audio url' }, 400);
      return true;
    }
    proxyKugouAudio(req, res, audioUrl);
    return true;
  }

  // ----- 歌词 -----
  // GET /api/kugou/lyric?hash=&albumAudioId=&duration=
  if (pn === '/api/kugou/lyric') {
    try {
      const result = await kugou.handleKugouLyric(
        sp.get('hash'), sp.get('albumAudioId'), sp.get('duration')
      );
      sendJSON(res, result);
    } catch (err) {
      sendJSON(res, { provider: 'kugou', lyric: '', error: err.message }, 500);
    }
    return true;
  }

  // ----- 用户歌单 -----
  // GET /api/kugou/user/playlists
  if (pn === '/api/kugou/user/playlists') {
    try {
      const result = await kugou.handleKugouUserPlaylists(kugouCookie);
      sendJSON(res, result);
    } catch (err) {
      sendJSON(res, { provider: 'kugou', playlists: [], error: err.message }, 500);
    }
    return true;
  }

  // ----- 歌单曲目 -----
  // GET /api/kugou/playlist/tracks?id=&limit=&offset=&paged=1
  if (pn === '/api/kugou/playlist/tracks') {
    try {
      const result = await kugou.handleKugouPlaylistTracks(sp.get('id'), kugouCookie, {
        limit: sp.get('limit') || '50',
        offset: sp.get('offset') || '0',
        paged: sp.get('paged') === '1' || !!sp.get('paged'),
      });
      sendJSON(res, result);
    } catch (err) {
      sendJSON(res, { provider: 'kugou', tracks: [], error: err.message }, 500);
    }
    return true;
  }

  // ----- 红心状态 -----
  // GET /api/kugou/song/like/check?hashes=h1,h2
  if (pn === '/api/kugou/song/like/check') {
    try {
      const result = await kugou.handleKugouLikeCheck({ hashes: sp.get('hashes') }, kugouCookie);
      sendJSON(res, result);
    } catch (err) {
      sendJSON(res, { provider: 'kugou', liked: {}, error: err.message }, 500);
    }
    return true;
  }

  // ----- 红心开关 / 加歌单 -----
  // POST /api/kugou/song/like  { song: {...}, like: true }
  // POST /api/kugou/playlist/add-song  { listId, song }
  if (pn === '/api/kugou/song/like' || pn === '/api/kugou/playlist/add-song') {
    try {
      const body = await readRequestBody(req);
      const result = pn === '/api/kugou/song/like'
        ? await kugou.handleKugouLikeToggle(body.song, body.like !== false, kugouCookie)
        : await kugou.handleKugouPlaylistAddSong(body.listId, body.song, kugouCookie);
      sendJSON(res, result);
    } catch (err) {
      sendJSON(res, { provider: 'kugou', success: false, error: err.message }, 500);
    }
    return true;
  }

  return false;  // 未命中，交回主路由
}

module.exports = { kugouRoutes, getKugouCookie: () => kugouCookie };

// ---------- 独立运行自测: node kugou-routes.js ----------
if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'search') {
    kugou.handleKugouSearch(process.argv[3] || '晴天 周杰伦', 5, kugouCookie, 0)
      .then(songs => {
        console.log('搜索结果', songs.length, '条:');
        songs.forEach(s => console.log(`- ${s.name} | ${s.artist} | hash=${String(s.hash).slice(0, 10)}... | privilege=${s.privilege}`));
      })
      .catch(e => console.log('搜索失败:', e.message));
  } else if (cmd === 'cookie') {
    const raw = process.argv[3];
    if (!raw) { console.log('用法: node kugou-routes.js cookie "KuGoo=..."'); process.exit(0); }
    const normalized = kugou.normalizeKugouCookieInput(raw);
    const ok = kugou.kugouCookieHasPlayback(normalized);
    console.log('Cookie 校验:', ok ? '通过（userid+token 完整）' : '失败（缺 KuGoo 复合字段）');
    if (ok) {
      saveKugouCookie(normalized);
      kugou.getKugouLoginInfo(kugouCookie).then(info =>
        console.log('登录态:', JSON.stringify({ loggedIn: info.loggedIn, nickname: info.nickname, vipLabel: info.vipLabel }, null, 2)));
    }
  } else if (cmd === 'status') {
    kugou.getKugouLoginInfo(kugouCookie).then(info => console.log(JSON.stringify(info, null, 2)));
  } else if (cmd === 'playlists') {
    kugou.handleKugouUserPlaylists(kugouCookie).then(r => {
      console.log('歌单', (r.playlists || []).length, '个:');
      (r.playlists || []).slice(0, 10).forEach(pl => console.log(`- ${pl.name} (${pl.trackCount} 首)`));
    });
  } else {
    console.log(`用法:
  node kugou-routes.js search <关键词>      # 搜索（匿名可用）
  node kugou-routes.js cookie "<Cookie>"    # 导入 Cookie（需含 KuGoo 字段）
  node kugou-routes.js status               # 查询登录态+会员
  node kugou-routes.js playlists            # 用户歌单（需登录）`);
  }
}
