// 沉浸式听歌（Folia）集成:
//  - /folia  → vendor/folia-major/dist 静态托管（构建方式见 docs/folia-integration.md）
//  - /ncm-api → 内嵌 NeteaseCloudMusicApi express 应用，作为 Folia Web 版的音乐后端；
//    复用 providers/common.js 的网易云登录 cookie（.netease-cookie），让 Folia 无需
//    单独扫码即可播放，用户在 Folia 里自行扫码登录时跳过注入。
//  - /qq-api → 内嵌 QQ 音乐 API（@yakult-green-tea/qq-music-api，自带 HTTP 服务）。
//  - /kugou-api → 内嵌酷狗 API（kugoumusicapi，构建 app 后进程内挂载）。
//  - /api/lyric-proxy → Folia Web 版唯一的跨域出口（QQ 搜索/歌词、酷狗歌词与匿名搜索、封面）。
//  - /runtime-config.js → Folia index.html 引用的运行时配置。
//  - /api/generate-theme(_openai) → Folia 的 AI 主题生成（Vercel 函数适配到 Express），
//    key 只存在服务端：优先环境变量 OPENAI_API_*/GEMINI_API_KEY，其次 config/folia-ai.json。
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readCookieFile } from './providers/common.js';
import { verifyToken, extractBearerToken } from './auth.js';

const require = createRequire(import.meta.url);

// 主题生成的 Vercel 函数适配产物来自 vendor/folia-major/，而 vendor/ 不入库
// （见 .gitignore：第三方克隆仓库）。所以这里必须惰性加载：写成顶层静态 import
// 会让全新克隆的服务器在启动阶段就因模块缺失直接崩掉，而不是只在用到主题生成时报错。
let foliaThemeOpenAiModule = null;
async function loadFoliaThemeOpenAi(log) {
  if (!foliaThemeOpenAiModule) {
    foliaThemeOpenAiModule = (await import('../vendor/folia-major/api/generate-theme_openai.js')).default;
  }
  return foliaThemeOpenAiModule;
}

// 主题生成的模型降级链（首个为当前使用模型）：env > config/folia-ai.json 的 apiModel + fallbackModels
let foliaModelChain = [];

// config/folia-ai.json（gitignored）→ process.env；环境变量优先
function applyFoliaAiConfig(ROOT, log) {
  let chain = [];
  try {
    const file = path.join(ROOT, 'config', 'folia-ai.json');
    if (existsSync(file)) {
      const cfg = JSON.parse(readFileSync(file, 'utf8'));
      const map = {
        OPENAI_API_KEY: cfg.apiKey,
        OPENAI_API_URL: cfg.apiUrl,
        OPENAI_API_MODEL: cfg.apiModel,
        OPENAI_API_TEMPERATURE: cfg.apiTemperature != null ? String(cfg.apiTemperature) : undefined,
        GEMINI_API_KEY: cfg.geminiApiKey,
      };
      for (const [key, value] of Object.entries(map)) {
        if (value && !process.env[key]) process.env[key] = value;
      }
      chain = [cfg.apiModel, ...(Array.isArray(cfg.fallbackModels) ? cfg.fallbackModels : [])];
    }
  } catch (err) {
    log(`folia: 读取 config/folia-ai.json 失败: ${err?.message || err}`);
  }
  if (process.env.OPENAI_API_MODEL) chain.unshift(process.env.OPENAI_API_MODEL);
  foliaModelChain = [...new Set(chain.filter(Boolean))];
}

// Folia 官方是 Vercel/edge 函数（Web Request/Response），这里适配成 Express 处理器
async function callFoliaApi(handler, req) {
  const webReq = new Request('http://folia.local/api', {
    method: req.method,
    headers: { 'Content-Type': 'application/json' },
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
  });
  return handler(webReq);
}

function sendWebRes(webRes, res) {
  return webRes.arrayBuffer().then((buf) => {
    res.status(webRes.status);
    webRes.headers.forEach((value, key) => res.setHeader(key, value));
    res.send(Buffer.from(buf));
  });
}

// 主题生成串行队列：降级链要临时改 process.env.OPENAI_API_MODEL，串行避免并发请求互相覆盖
let themeQueue = Promise.resolve();
function serializeThemeGen(fn) {
  const run = themeQueue.then(fn, fn);
  themeQueue = run.then(() => undefined, () => undefined);
  return run;
}

function foliaStatic(distDir) {
  return express.static(distDir, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html') || filePath.endsWith('sw.js') || filePath.endsWith('manifest.webmanifest')) {
        // HTML/SW/manifest 必须回源，否则重建后旧引用指向已删除的 hash 资源 → 白屏
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  });
}

export function mountFolia(app, { ROOT, log, requireAuth }) {
  applyFoliaAiConfig(ROOT, log);
  const distDir = path.join(ROOT, 'vendor', 'folia-major', 'dist');

  // Folia 的 index.html 以绝对路径引用 /runtime-config.js（与官方 Docker 部署同款机制）。
  // 必须注册在静态目录之前：dist 里带着一份构建时的空 runtime-config.js，后注册会被它遮住，
  // aiProvider 就回落到构建期的 VITE_AI_PROVIDER=google，前端改调 Gemini 端点导致主题生成失败。
  const runtimeConfig = 'window.__FOLIA_RUNTIME_CONFIG__ = {"aiProvider":"openai","deployment":"custom"};';
  const sendRuntimeConfig = (req, res) => {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(runtimeConfig);
  };
  app.get('/runtime-config.js', sendRuntimeConfig);
  app.get('/folia/runtime-config.js', sendRuntimeConfig);

  if (existsSync(path.join(distDir, 'index.html'))) {
    app.use('/folia', foliaStatic(distDir));
    // Folia 的本地封面 Service Worker 用绝对路径注册：navigator.serviceWorker.register(
    // '/folia-cover-sw.js', { scope: '/' })。dist 挂在 /folia 下，所以必须在根路径上单独
    // 补一条，否则注册脚本 404、本地封面功能一直报错。它的 fetch 只接管 /__folia_cover/
    // 前缀，其余请求直接放行，scope 落在 '/' 不会干扰宿主应用。
    app.get('/folia-cover-sw.js', (req, res) => {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.sendFile(path.join(distDir, 'folia-cover-sw.js'));
    });
    // SPA 回退：静态中间件没接住的、不带扩展名的 GET 路径都回 index.html
    app.get(/^\/folia(\/.*)?$/, (req, res, next) => {
      if (path.extname(req.path)) { next(); return; }
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    log('folia: vendor/folia-major/dist 不存在，沉浸式听歌不可用（先运行 npm run build:folia）');
    app.use('/folia', (req, res) => res.status(404).send('Folia 未构建，请先运行 npm run build:folia'));
  }

  // Folia 前端一律不带 Bearer（gemini.ts / lyric-proxy / 音源调用都没打补丁），所以闸门以
  // 「同源页面请求」为主：Sec-Fetch-Site 由浏览器自动携带，页面在 /folia/ 下时必然是
  // same-origin；跨站页面拿不到这个值，也就烧不掉服务端的 AI 配额与音源账号。
  // 带有效 Bearer 的调用同样放行（宿主自己的工具链会用）。
  const sameOriginGate = (req, res, next) => {
    if (req.get('sec-fetch-site') === 'same-origin' || verifyToken(extractBearerToken(req))) {
      next();
      return;
    }
    res.status(401).json({ error: '未登录' });
  };

  async function runThemeGenOpenAi(req) {
    const models = foliaModelChain.length ? foliaModelChain : [undefined];
    let webRes = null;
    for (const model of models) {
      if (model) process.env.OPENAI_API_MODEL = model;
      webRes = await callFoliaApi(await loadFoliaThemeOpenAi(log), req);
      if (webRes.status === 200) return webRes;
      const detail = await webRes.clone().text();
      log(`folia: 主题模型 ${model || '默认'} 失败(${webRes.status}): ${detail.slice(0, 200)}`);
    }
    return webRes;
  }
  async function runThemeGenGemini(req) {
    const mod = await import('../vendor/folia-major/api/generate-theme.js');
    return callFoliaApi(mod.default, req);
  }

  // 异步任务模式：公网经 Cloudflare 等 CDN 代理时有 ~100s 响应上限，而一次生成实测
  // 82~95s+，同步等待会被 524 切断（前端报「主题生成失败」）。前端带 X-Folia-Job:1
  // 时改为：POST 立即返回 {jobId}，前端轮询 GET /api/theme-job/:id 取结果。
  const themeJobs = new Map();
  const JOB_DONE_TTL_MS = 10 * 60_000;
  const JOB_RUN_TIMEOUT_MS = 15 * 60_000;
  function pruneThemeJobs() {
    const now = Date.now();
    for (const [id, job] of themeJobs) {
      if (job.status === 'running' && now - job.startedAt > JOB_RUN_TIMEOUT_MS) {
        job.status = 'error';
        job.error = '生成超时';
        job.doneAt = now;
      }
      if (job.status !== 'running' && now - job.doneAt > JOB_DONE_TTL_MS) themeJobs.delete(id);
    }
  }

  app.post(['/api/generate-theme_openai', '/api/generate-theme'], sameOriginGate, (req, res, next) => {
    if (req.get('x-folia-job') !== '1') { next(); return; }
    const id = randomUUID();
    themeJobs.set(id, { status: 'running', startedAt: Date.now() });
    pruneThemeJobs();
    const isGemini = !req.path.includes('_openai');
    serializeThemeGen(async () => (isGemini ? runThemeGenGemini(req) : runThemeGenOpenAi(req)))
      .then(async (webRes) => {
        themeJobs.set(id, {
          status: 'done', doneAt: Date.now(),
          httpStatus: webRes.status, body: Buffer.from(await webRes.arrayBuffer()),
        });
      })
      .catch((err) => {
        log(`folia: 主题任务失败: ${err?.message || err}`);
        themeJobs.set(id, { status: 'error', doneAt: Date.now(), error: err?.message || 'job failed' });
      });
    res.status(202).json({ jobId: id });
  });
  app.get('/api/theme-job/:id', sameOriginGate, (req, res) => {
    const job = themeJobs.get(req.params.id);
    if (!job) { res.status(404).json({ status: 'error', error: 'job not found' }); return; }
    if (job.status === 'running') { res.json({ status: 'running' }); return; }
    if (job.status === 'error') { res.status(500).json({ status: 'error', error: job.error }); return; }
    res.status(job.httpStatus).setHeader('Content-Type', 'application/json');
    res.send(job.body);
  });

  // 同步模式（本地/自建反代无 100s 限制时走这里，行为与旧版一致）
  app.post('/api/generate-theme_openai', sameOriginGate, (req, res, next) => {
    serializeThemeGen(() => runThemeGenOpenAi(req))
      .then((webRes) => sendWebRes(webRes, res))
      .catch(next);
  });
  app.post('/api/generate-theme', sameOriginGate, async (req, res) => {
    try {
      const mod = await import('../vendor/folia-major/api/generate-theme.js');
      await sendWebRes(await callFoliaApi(mod.default, req), res);
    } catch (err) {
      log(`folia: generate-theme 失败: ${err?.message || err}`);
      res.status(500).json({ error: 'gemini api unavailable' });
    }
  });

  // ===== /api/lyric-proxy：Folia Web 版唯一的跨域出口 =====
  // Folia 前端把一切无法直连的第三方请求都塞进这个端点：
  //   utils/lyrics/providers/qqLyricProvider.ts      → u.y.qq.com（QQ 歌词，也是 QQ 搜索的实现）
  //   utils/lyrics/providers/kugouLyricProvider.ts   → complexsearch / mobiles.kugou.com
  //   services/onlineMusic/kugouTransport.ts         → 匿名酷狗搜索、m.kugou.com 老播放接口
  //   services/coverCache.ts                         → y.gtimg.cn / imge.kugou.com / kgimg.com 封面
  // 官方实现（vendor/folia-major/api/lyric-proxy.js）是 Vercel 函数，这里等价落到宿主 Express。
  // 与官方 allowlist 的差异：额外放行 kgimg.com —— coverCache 会主动把 kgimg.com 的封面走
  // 这个代理，官方那份漏了它，酷狗封面会 403。
  const LYRIC_PROXY_EXACT_HOSTS = new Set(['qq.com', 'y.gtimg.cn', 'kugou.com', 'kgimg.com']);
  const LYRIC_PROXY_SUFFIX_HOSTS = ['.qq.com', '.kugou.com', '.kgimg.com'];
  const isAllowedLyricProxyHost = (hostname) => (
    LYRIC_PROXY_EXACT_HOSTS.has(hostname)
    || LYRIC_PROXY_SUFFIX_HOSTS.some((suffix) => hostname.endsWith(suffix))
  );
  // 这些头要么由代理自己决定，要么携带宿主身份，不能原样透给第三方；
  // accept-encoding 也要丢掉：undici 已经按它解压过，转发会让上游再压一次而我们又不带编码头。
  const LYRIC_PROXY_DROP_HEADERS = new Set([
    'host', 'connection', 'content-length', 'origin', 'referer',
    'cookie', 'authorization', 'proxy-authorization',
    'accept-encoding', 'transfer-encoding', 'keep-alive', 'upgrade',
  ]);

  app.all('/api/lyric-proxy', sameOriginGate, async (req, res) => {
    const raw = String(req.query.url || '');
    if (!raw) { res.status(400).json({ error: 'Missing url parameter' }); return; }
    let target;
    try {
      target = new URL(raw);
    } catch {
      res.status(400).json({ error: 'Invalid url parameter' });
      return;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      res.status(400).json({ error: 'Unsupported protocol' });
      return;
    }
    if (!isAllowedLyricProxyHost(target.hostname)) {
      res.status(403).json({ error: 'Forbidden: Domain not allowed' });
      return;
    }

    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!LYRIC_PROXY_DROP_HEADERS.has(key.toLowerCase())) headers[key] = value;
    }
    // QQ 的 musicu 接口要求固定的匿名登录标记与 UA，客户端虽然也传，但统一在此覆盖更稳
    if (target.hostname === 'u.y.qq.com') {
      headers.Cookie = 'tmeLoginType=-1;';
      headers['User-Agent'] = 'okhttp/3.14.9';
    }

    const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method);
    try {
      const upstream = await fetch(target.toString(), {
        method: req.method,
        headers,
        ...(hasBody && req.body !== undefined
          ? { body: typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? JSON.stringify(req.body) : req.body }
          : {}),
      });
      // 只回传上游状态与内容类型：编码/长度由 Express 按实际发出的字节重算
      res.status(upstream.status);
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (err) {
      log(`folia: lyric-proxy 请求失败 ${target.hostname}: ${err?.message || err}`);
      res.status(502).json({ error: 'Proxy request failed', details: String(err?.message || err) });
    }
  });

  // NeteaseCloudMusicApi 内嵌实例：serveNcmApi 会顺手 listen 一个临时端口，
  // 拿到构造好的 express 应用后立即关掉，只保留挂载在 /ncm-api 下的处理器。
  let ncmPromise = null;
  const getNcmApp = () => {
    if (!ncmPromise) {
      const { serveNcmApi } = require('NeteaseCloudMusicApi');
      ncmPromise = serveNcmApi({ port: 0, host: '127.0.0.1', checkVersion: false })
        .then((ncmApp) => {
          try { ncmApp.server?.close(); } catch { /* ignore */ }
          return ncmApp;
        })
        .catch((err) => {
          log(`folia: NeteaseCloudMusicApi 启动失败: ${err?.message || err}`);
          ncmPromise = null;
          return null;
        });
    }
    return ncmPromise;
  };

  // cookie 注入策略（path 已去掉挂载前缀 /ncm-api）：
  //  - 内容与 /login/status：客户端未带 cookie 时注入服务端 .netease-cookie，
  //    Folia 开箱即用服务端账号（VIP/歌单与「听一听」一致）
  //  - /register/anonimous：有服务端 cookie 时直接把服务端 cookie 当作"匿名"结果返回，
  //    避免 Folia 存下真正的匿名 cookie 后把共享身份顶掉
  //  - /logout：不转发上游（伪造成功），否则会连服务端共享 cookie 一起作废，
  //    破坏宿主「听一听」的网易云登录态
  //  - Folia 自身的登录流程（扫码/手机号等）不注入，登录成功后客户端 cookie 优先
  const stripTrailSlash = (p) => p.replace(/\/+$/, '') || '/';

  app.use('/ncm-api', typeof requireAuth === 'function' ? requireAuth : (req, res, next) => next(), async (req, res, next) => {
    const ncmApp = await getNcmApp();
    if (!ncmApp) {
      res.status(503).json({ error: 'folia netease api unavailable' });
      return;
    }
    const p = stripTrailSlash(req.path);
    const serverCookie = readCookieFile('netease');

    if (p === '/logout') {
      res.json({ code: 200 });
      return;
    }
    if (p === '/register/anonimous') {
      if (serverCookie) {
        res.json({ code: 200, cookie: serverCookie });
        return;
      }
      ncmApp(req, res, next);
      return;
    }

    const hasClientCookie =
      (typeof req.query.cookie === 'string' && req.query.cookie) ||
      String(req.headers.cookie || '').includes('MUSIC_U=');
    const skipInject =
      p === '/login' ||
      p.startsWith('/register') ||
      (p.startsWith('/login/') && !p.startsWith('/login/status'));
    if (!hasClientCookie && !skipInject && serverCookie) {
      req.query.cookie = serverCookie;
    }
    ncmApp(req, res, next);
  });

  // ===== QQ 音乐 / 酷狗 网关 =====
  // 两个标准 API 包安装在 vendor/folia-major/node_modules 下，用锚定到该目录的
  // require 解析（宿主自己的 node_modules 里没有它们）。
  const requireVendor = createRequire(path.join(ROOT, 'vendor', 'folia-major', 'package.json'));

  // QQ 包 require 即自行监听端口（读 PORT 环境变量），只能本地起一个实例再反代。
  // 注意：express.json 已消费请求体，代理时需把 req.body 重新序列化。
  function proxyToHttp(port) {
    return (req, res) => {
      // 只转发挂载点之后的路径：app.use('/qq-api', …) 已经把 '/qq-api' 收进 req.baseUrl，
      // 再拼一次 baseUrl 会让上游收到 /qq-api/getHotkey 这类带前缀的路径，
      // 而 qq-music-api 的路由表本身没有这个前缀 → 全部 404。
      const targetPath = req.url || '/';
      const headers = { ...req.headers };
      delete headers.host;
      delete headers['content-length'];
      delete headers.connection;
      let body = null;
      if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        body = JSON.stringify(req.body);
        headers['content-type'] = 'application/json';
        headers['content-length'] = String(Buffer.byteLength(body));
      }
      const upstream = http.request({ host: '127.0.0.1', port, path: targetPath, method: req.method, headers }, (ur) => {
        res.writeHead(ur.statusCode, ur.headers);
        ur.pipe(res);
      });
      upstream.on('error', (e) => {
        res.status(502).json({ error: `upstream unavailable: ${e?.message || e}` });
      });
      if (body) upstream.write(body);
      upstream.end();
    };
  }

  let qqApiReady = null;
  const QQ_API_PORT = 3211;
  const ensureQqApi = () => {
    if (qqApiReady) return qqApiReady;
    qqApiReady = (async () => {
      const prevPort = process.env.PORT;
      process.env.PORT = String(QQ_API_PORT);
      try {
        requireVendor('@yakult-green-tea/qq-music-api');
        await new Promise((resolve) => setTimeout(resolve, 800));
        log(`folia: QQ 音乐 API 已内嵌启动 @ 127.0.0.1:${QQ_API_PORT}`);
        return true;
      } catch (e) {
        log(`folia: QQ 音乐 API 启动失败: ${e?.message || e}`);
        qqApiReady = null;
        return false;
      } finally {
        if (prevPort === undefined) delete process.env.PORT;
        else process.env.PORT = prevPort;
      }
    })();
    return qqApiReady;
  };

  // QQ 登录态说明：qq-music-api 只认它自己签发的会话（x-qq-session 头、qqmusic_session
  // cookie，或 ?cookie= 里的 qqmusic_session=…）。宿主 .qq-cookie 是网页版的 uin+qm_keyst，
  // 两者不是同一套凭据，注入过去不会被接受（它的 /user/setCookie 也被官方禁用，固定返回 403）。
  // 所以这里不做 cookie 注入：QQ 侧由用户在 Folia 里扫码登录，Folia 自己保存会话并附带
  // X-QQ-Session 头，网关原样转发即可。
  app.use('/qq-api', sameOriginGate, async (req, res) => {
    if (!(await ensureQqApi())) {
      res.status(503).json({ error: 'qq api unavailable' });
      return;
    }
    proxyToHttp(QQ_API_PORT)(req, res);
  });

  // 酷狗与 NCM 同款结构：startService 构建 express app 并监听 → 拿到 app 后关掉监听，
  // 进程内挂载到 /kugou-api（与 /ncm-api 一致），带 cookie 注入。
  let kgPromise = null;
  // 判断「客户端是否自带酷狗登录态」只看酷狗自己的字段：浏览器对同源请求一定会带上宿主
  // 自己的 cookie（hudui_token 等），拿「有没有 Cookie 头」当判据会让服务端共享账号
  // 永远注入不进去，歌单/播放一直按未登录处理。
  const KUGOU_SESSION_COOKIE_RE = /(?:^|;\s*)(?:token|userid|dfid|KuGoo|kg_mid|kg_dfid)=/i;
  const getKgApp = () => {
    if (!kgPromise) {
      kgPromise = (async () => {
        const prevPort = process.env.PORT;
        process.env.PORT = '0';
        try {
          const { startService } = requireVendor('kugoumusicapi');
          const kgApp = await startService();
          try { kgApp.service?.close(); } catch { /* ignore */ }
          log('folia: 酷狗 API 已内嵌启动（挂载 /kugou-api）');
          return kgApp;
        } catch (e) {
          log(`folia: 酷狗 API 启动失败: ${e?.message || e}`);
          kgPromise = null;
          return null;
        } finally {
          if (prevPort === undefined) delete process.env.PORT;
          else process.env.PORT = prevPort;
        }
      })();
    }
    return kgPromise;
  };

  app.use('/kugou-api', sameOriginGate, async (req, res, next) => {
    const kgApp = await getKgApp();
    if (!kgApp) {
      res.status(503).json({ error: 'kugou api unavailable' });
      return;
    }
    const p = stripTrailSlash(req.path);
    const hasClientCookie =
      (typeof req.query.cookie === 'string' && req.query.cookie) ||
      KUGOU_SESSION_COOKIE_RE.test(String(req.headers.cookie || ''));
    const skipInject =
      p === '/login' || p === '/logout' ||
      p.startsWith('/register') ||
      (p.startsWith('/login/') && !p.startsWith('/login/status'));
    if (!hasClientCookie && !skipInject) {
      const serverCookie = readCookieFile('kugou');
      if (serverCookie) req.query.cookie = serverCookie;
    }
    kgApp(req, res, next);
  });
}
