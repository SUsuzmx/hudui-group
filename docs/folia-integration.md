# 沉浸式听歌（Folia）集成说明

发现页的「沉浸式听歌」入口打开的是 [folia-major](https://github.com/chthollyphile/folia-major)
（Folia，全屏沉浸式歌词播放器）的 Web 版，以全屏 iframe 嵌入。

## 架构

```
浏览器
 发现页 → 沉浸式听歌（client/src/components/ImmersiveListenView.vue）
  └─ <iframe src="/folia/">                  ← Folia Web 版静态资源
       ├─ fetch('/ncm-api/...')              ← 网易云 API（带宿主登录态 Bearer token）
       ├─ fetch('/qq-api/...')               ← QQ 音乐 API（X-QQ-Session，Folia 内扫码登录）
       ├─ fetch('/kugou-api/...')            ← 酷狗 API（服务端注入 .kugou-cookie）
       └─ fetch('/api/lyric-proxy?url=...')  ← QQ/酷狗搜索、歌词、封面的统一跨域出口
 宿主应用其它功能不受影响

服务器（server/folia.js，由 server/index.js 挂载）
 ├─ /folia                → vendor/folia-major/dist 静态托管（SPA 回退 index.html）
 ├─ /folia-cover-sw.js     → 同上 dist 内的本地封面 Service Worker（Folia 用绝对路径注册）
 ├─ /ncm-api              → 内嵌 NeteaseCloudMusicApi express 应用（requireAuth）
 │    · 请求未带 cookie 时自动注入服务端 .netease-cookie（复用「听一听」的网易账号）
 │    · /login/*、/register/*、/logout* 跳过注入，允许在 Folia 里自行扫码登录
 ├─ /qq-api               → 反代内嵌的 @yakult-green-tea/qq-music-api（127.0.0.1:3211）
 ├─ /kugou-api            → 进程内挂载 kugoumusicapi 的 express app（带 .kugou-cookie 注入）
 ├─ /api/lyric-proxy      → 白名单域名的 GET/POST 代理
 └─ /runtime-config.js    → Folia index.html 引用的运行时配置（同官方 Docker 部署机制）
```

`/qq-api`、`/kugou-api`、`/api/lyric-proxy` 都挂 **同源闸门**（`sameOriginGate`）：
放行 `Sec-Fetch-Site: same-origin` 或带有效 Bearer 的请求，其余 401。这三个接口
会携带宿主的音源账号，不能做成无鉴权的开放代理。`/ncm-api` 另外还有 `requireAuth`
（Folia 侧由 `netease.ts` 补丁附上宿主 Bearer token）。

源码位置：`vendor/folia-major/`（第三方克隆仓库，已加入 .gitignore，
与 `games/` 的处理方式一致）。**它不入库，所以新机必须自行克隆并构建**，
详见 [MIGRATION.md](MIGRATION.md) §2.1。

> `server/folia.js` 对 `vendor/` 的依赖全部是**惰性**的（动态 `import()` / 锚定 require）。
> 缺少 `vendor/` 时服务器照常启动，只在用到相关功能时报错或 404——写成顶层静态
> `import` 会让全新克隆在启动阶段就崩掉。

## 构建步骤（首次或更新 Folia 时执行一次）

要求 Node.js ≥ 24。

```bash
# 1. 克隆/更新源码到 vendor/folia-major（保留其 .env.local、.npmrc、local-tars/）
git clone https://github.com/chthollyphile/folia-major vendor/folia-major
# 2. 安装依赖（.npmrc 已配置 npmmirror 镜像；可再加 ELECTRON_SKIP_BINARY_DOWNLOAD=1）
cd vendor/folia-major && npm install

# 3. 构建（base 固定为 /folia/）
npx vite build --base=/folia/
# 或在仓库根目录：npm run build:folia
```

构建产物输出到 `vendor/folia-major/dist/`，服务器启动时自动托管。
**未构建时服务器仍能正常启动**，只是 `/folia/` 返回 404 并在日志提示
`先运行 npm run build:folia`。

## 音源接入

### 网易云（/ncm-api）

复用「听一听」的服务端 `.netease-cookie`，Folia 开箱即用同一账号，无需二次扫码。

### QQ 音乐（/qq-api）

- 网关把 `/qq-api/**` 反代到内嵌的 `qq-music-api`。**注意转发路径不能带上 `/qq-api`
  前缀**：`app.use('/qq-api', …)` 已把前缀收进 `req.baseUrl`，拼 `baseUrl + req.url`
  会让上游收到 `/qq-api/login/qr/key` 而它没有这个前缀，全部 404。
- **登录态不复用 `.qq-cookie`**：`qq-music-api` 只认自己签发的会话
  （`x-qq-session` 头 / `qqmusic_session` cookie / `?cookie=` 里的 `qqmusic_session=…`），
  而 `.qq-cookie` 是网页版的 `uin=…; qm_keyst=…`，两者不是同一套凭据；它的
  `/user/setCookie` 也已被官方禁用（固定 403）。所以 QQ 侧由用户在 Folia 里扫码登录，
  Folia 把会话存在 localStorage 并附 `X-QQ-Session` 头，网关原样转发。
- QQ 的**搜索与歌词**并不走 `/qq-api`，而是走 `/api/lyric-proxy` 直连
  `u.y.qq.com/cgi-bin/musicu.fcg`（见 `src/utils/lyrics/providers/qqLyricProvider.ts`，
  `qqProvider.searchSongs` 复用的就是它）。该上游会限流：返回 `request.code = 2001` 时
  表现为搜不到结果，稍后重试即可恢复。
- `qq-music-api` 的 QR 启动有 single-flight 保护：并发第二次请求会得到
  `502 Unable to start QR login` + `retryAfterMs`，属预期行为，不是网关故障。

### 酷狗（/kugou-api + /api/lyric-proxy）

- **搜索/歌词/老播放接口走 `/api/lyric-proxy`**，不经过 `/kugou-api`：
  `kugouTransport.requestKugouAnonymousSearch` 直接请求
  `complexsearch.kugou.com/v2/search/song`（自带签名），`kugouLyricProvider` 请求
  `complexsearch/mobiles.kugou.com`，兜底播放信息请求 `m.kugou.com`。
  实测匿名搜索可用（`error_code = 0`，字段含 `FileHash/SongName/SingerName/AlbumName/
  Duration/MixSongID`，正是 `normalizeKugouSong` 需要的）。
- `/kugou-api`（`kugoumusicapi`，Android 网关）只有部分端点可用：
  `top/card/youth`、`everyday/recommend`、`search/hot`、`search/suggest` 正常；
  其 `/search` 对当前设备固定返回 `error_code 152`，`register/dev` 也拿不到 `dfid`；
  `user/*`、`playlist/detail` 等需要登录态的端点会拒绝网页格式的 `.kugou-cookie`
  （`error_code 20010`）——**酷狗用户歌单需要在 Folia 内单独登录**。
- cookie 注入判据只认酷狗自己的字段（`token|userid|dfid|KuGoo|kg_mid|kg_dfid`）。
  早期写法是「`req.headers.cookie` 非空即视为客户端自带登录态」，但浏览器对同源请求
  一定会带上宿主的 `hudui_token`，导致服务端 `.kugou-cookie` 永远注入不进去。

### /api/lyric-proxy

Folia Web 版把一切无法直连的第三方请求都塞进这个端点（QQ 歌词与搜索、酷狗歌词与匿名
搜索、封面图）。官方实现是 Vercel / Cloudflare 函数，集成里等价落到宿主 Express：

- **域名白名单**：`qq.com`、`*.qq.com`、`y.gtimg.cn`、`kugou.com`、`*.kugou.com`、
  `kgimg.com`、`*.kgimg.com`。比官方多放行 `kgimg.com`——`src/services/coverCache.ts`
  会主动把 `kgimg.com` 的封面走这个代理，官方那份 allowlist 漏了它，酷狗封面会 403。
- **闸门**：只放行同源页面请求（`Sec-Fetch-Site: same-origin`）或带有效 Bearer 的请求，
  其余 401，避免这台机器变成公开的任意代理。
- **不回 `Access-Control-Allow-Origin`**：Folia 是同源 iframe，不需要 CORS 放行；开着
  反而会让任意网站借这台机器代理 QQ/酷狗。
- 只透传上游状态与 `Content-Type`：`accept-encoding` 会被丢掉，因为 undici 已按它解压，
  透传编码头会让浏览器按 gzip 解析明文。

### 本地封面 Service Worker

`src/services/localCoverRuntime.ts` 以绝对路径注册 `navigator.serviceWorker.register(
'/folia-cover-sw.js', { scope: '/' })`。dist 挂在 `/folia` 下，所以宿主要在**根路径**
单独补一条 `/folia-cover-sw.js`，否则注册脚本 404、本地封面功能一直报错。该 SW 的 fetch
只接管 `/__folia_cover/` 前缀，其余请求直接放行，`scope: '/'` 不会干扰宿主应用。

首次加载时它可能报一次「readiness timed out after 10000ms」——那是 Folia 自己的 workbox
SW（scope `/folia/`）与它同时在 activate 的时序问题，刷新后即恢复正常。

## 对 Folia 源码的本地补丁（更新版本时需要重打）

- `src/services/netease.ts`：`fetchWithCreds` 与匿名注册请求附加
  `Authorization: Bearer <hudui_token>`（同源共享 localStorage 的 `hudui_token`）。
- `.env.local`：三个音源后端都指到宿主网关，AI 交给运行时配置：
  ```
  VITE_NETEASE_API_BASE=/ncm-api
  VITE_KUGOU_API_BASE=/kugou-api
  VITE_QQ_API_BASE=/qq-api
  VITE_AI_PROVIDER=google
  ```
- `.npmrc`：npmmirror 镜像 + 允许 remote tarball。
- `package.json`：`"kugoumusicapi": "file:local-tars/kugoumusicapi-1.6.0.tar.gz"`
  （本地 tarball 与 npm 上的 1.6.0 内容一致，只是为了构建时不去拉远端）。

## AI 主题生成

Folia Web 版的 AI 主题不在浏览器直连 AI，而是 POST `/api/generate-theme_openai`（官方为
Vercel serverless 函数）。集成把它适配到宿主 Express（`server/folia.js`，调用
`vendor/folia-major/api/` 下的编译产物），密钥只存服务端：

- 配置文件 `config/folia-ai.json`（gitignored）：
  `{ "apiKey", "apiUrl", "apiModel", "fallbackModels", "apiTemperature" }`，
  填任意 OpenAI 兼容接口（千问 DashScope compatible-mode、DeepSeek、各类中转均可）。
- 环境变量 `OPENAI_API_KEY` / `OPENAI_API_URL` / `OPENAI_API_MODEL` 优先于配置文件。
- 模型降级链：`apiModel` 失败自动依次尝试 `fallbackModels`，避免单一模型限流/故障卡死。
- 闸门：放行同源页面请求（iframe 内 fetch）与带有效 Bearer token 的请求，其余 401，
  防止未登录用户烧 AI 配额。
- 动态 `/folia/runtime-config.js` 注入 `aiProvider:"openai"`，前端因此走 OpenAI 兼容端点。

改动 `config/folia-ai.json` 或 `server/folia.js` 后需重启服务器（`scripts/restart-server.ps1`）
才生效——Node 进程加载的是启动时的代码，改磁盘文件不影响已运行实例。

## 注意事项

- Folia 的 `/folia/` 与 `/api/lyric-proxy` 用 `Sec-Fetch-Site` 判定同源，**只能从本机的
  应用页面里用**；直接用 curl / 浏览器地址栏访问 `/api/lyric-proxy` 会 401（浏览器地址栏
  导航是 `Sec-Fetch-Site: none`）。
- 网易云 VIP 歌曲能否播放取决于服务端 `.netease-cookie` 的账号会员状态；QQ / 酷狗同理，
  取决于 Folia 内该账号的会员状态。
- 重新构建 Folia 后需重启服务器进程（静态目录已存在则直接生效，无需重启）。
- QQ / 酷狗上游都不稳定：QQ 搜索会返回 `2001` 限流，酷狗 `kugoumusicapi` 的 Android
  网关 `152` / `20010` 随上游变动。这类失败要在 Folia 里重试，不是网关故障。
