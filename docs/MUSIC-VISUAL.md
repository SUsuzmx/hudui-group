# 网易云 / QQ 音乐接入与视觉舞台（踩坑记录）

本文记录 `hudui-group` 中「听一听」音源与 Mineradio 视觉舞台的实现要点与常见坑。

---

## 1. 视觉舞台踩坑

### 1.1 必须单 script 拼接（函数提升）

参考项目 `public/js/index-loader.js` 把模块 **同步 XHR 拼成一个 script**。  
若拆成多个 `<script>` 顺序加载，会出现：

- `readCurrentFxAutosaveRaw is not defined`（`00-state/06-fx-runtime-layout.js` 初始化时调用了后加载模块里的函数）

**做法**：`scripts/build-visual-bundle.mjs` 预拼接 `mineradio-bundle.js`，`visual-loader.js` 只加载 vendor + 该 bundle。

### 1.2 粒子透明度 `uAlpha` 初始为 0

粒子材质用 `uAlpha` 做启动淡入；原工程在 home/empty 模块里赋 `≈0.96`。  
裁剪后无人赋值 → **有 canvas 但看不见粒子**。

**做法**：loader / `visual-stage.js` 在初始化后强制 `uniforms.uAlpha.value = 0.96`。

### 1.3 3D 歌词时间被卡在 0

```js
var preview = getProgressDragPreviewSeconds();
if (preview != null && isFinite(preview)) return preview;
```

桩函数若返回 `-1`（有限数字）会被当成「拖动预览时间」→ **歌词永远停在第 0 秒**。

**做法**：无拖动时必须返回 `null`/`undefined`/`NaN`，再读 `audio.currentTime`。

### 1.4 主循环裸调用未移植函数

`11-main-loop.js` 的 `animate()` 会无 `typeof` 保护地调用：

- `tickGestureRotation`
- `syncDesktopOverlayState`
- `tickLyricsParticles` / `updateStageLyrics3D`
- `updateCamera` / `updateRipples` 等

缺一个就整帧中断，表现为：**无粒子 / 无歌词 / 控制台 ReferenceError**。

**做法**：`00-visual-stubs.js` 用 **function 声明**补齐；loader 运行时再挂 `window.xxx` 兜底。

### 1.5 手势：缩放有效、左右拖无效

主循环转粒子读 **`gestureRotation`**，不是 `orbit.userTheta`。  
只改 orbit 时：滚轮/捏合（读 `userRadius`）有效，**拖拽看起来没反应**。

**做法**：拖拽同时写 `orbit.userTheta/Phi` **和** `gestureRotation.x/y`，并清 `centerLocked`。

### 1.6 默认舞台预设

每次进详情页若不 `setPreset`，粒子可能未按预期形态渲染（或依赖本地未初始化的 `fx.preset`）。

**做法**：进详情页后自动应用 `hudui_visual_preset`（默认 **0 丝绸/封面粒子**），FX 面板可切换并记住选择。

### 1.7 其它

| 坑 | 说明 |
|----|------|
| SW cache-first `/visual/*.js` | 旧模块缓存导致引擎超时；SW 应对 `/visual/` **network-only** |
| 相对路径 skull bin | `assets/xxx.bin` 被 SPA 回退成 HTML → `invalid skull asset`；改用 `/visual/assets/...` |
| `crossOrigin` 与 CDN | 音频若设 CORS 可能误报 error；播放优先用服务端解析的 URL |
| 同步 XHR 过多 | 线上 Cloudflare 下易超时；改预拼接 bundle |

---

## 2. 网易云 / QQ 接入与登录

### 2.1 网易云

- **依赖**：`NeteaseCloudMusicApi` npm 包（禁止手写协议）
- **Cookie 文件**：项目根目录 `.netease-cookie`（**永不通过 API 回传**）
- **Cookie 导入**：`POST /api/netease/login/cookie`，body `{ cookie }`，**必须含 `MUSIC_U`**
- **扫码**：`/api/netease/login/qr/key` → `create` → `check`（前端轮询）
  - `check` 先 `noCookie:true`；**code 803 且无 cookie 时要重试一次**
- **登录态**：`login_status` 主 → `user_account` 降级 → `vip_info_v2` 增强
- **会员**：以 `vipType` 为主，区分 SVIP（如 100/200、redplus 等）
- **播放**：`song_url_v1(level)` → 失败降级 `song_url(br)`；梯度 `lossless→exhigh→higher→standard`，总预算 ≤5s
- **探测**：URL 必须 Range 取前 8KB 校验魔数（ID3/fLaC/OggS/RIFF/ftyp），失败换下一档

**易踩坑**

1. Cookie 无 `MUSIC_U` 却当登录成功 → 后续播放全空  
2. 仅凭 Cookie 字段判断 `loggedIn` → 应用 `profile/account` 回落  
3. 扫码 803 只查一次 → 偶发拿不到 Cookie  
4. 试听 `freeTrialInfo` 非空时 `trial=true`，restriction 应为 `trial_only`  
5. 无版权 `privilege.st < 0` → `copyright_unavailable`，不要误判成「没登录」

### 2.2 QQ 音乐

- **无官方 SDK**：服务端手写 `musicu.fcg` / `musics.fcg`
- **Cookie 文件**：`.qq-cookie`（`uin` + `qm_keyst`）
- **Cookie 归一化**：微信登录 `wxopenid/login_type=2` 时把 **`wxuin` 写入 `uin`**
- **双级校验**
  - 完整：`uin` + 播放票据（`qm_keyst` 等）
  - `partial`：仅有网页票据（能浏览不能播 VIP）
- **搜索签名**（Mineradio 安卓协议，不是 md5+zza）
  - `comm` 伪装安卓：`ct:'11', cv:'14090508'`
  - UA：`QQMusic 14090508(android 12)`（**不能用 Chrome UA**）
  - sign：sha1 + 索引乱序 + XOR，前缀 `zzc`；**body 字符串与签名对象必须同一实例**
- **播放**：`vkey.GetVkeyServer` / `CgiGetVkey`；filename 为 `音质前缀 + mediaMid + 扩展名`（`F000*.flac`、`M800*.mp3`…）；`purl + sip` 拼 CDN 后逐个探测
- **音质降级**：勿只试 `standard` 的 m4a；应 **高→低完整梯度**，并优先 https
- **会员字段**：归一化 `{isVip, isSvip, membershipKnown}`；探测失败保留上次正结果并标 `stale`

**易踩坑**

1. 用 md5(zz a+nonce) 签名 → 恒 `code 2000`  
2. Web `comm.ct:24` + Chrome UA → 签名失败  
3. `mediaMid` 与 `songmid` 混用 → vkey 空  
4. `musics.fcg` 上游可能长期 2000 → 需 musicu / smartbox / h5 兜底  
5. Cookie 不回传前端，仅服务端文件

### 2.3 统一 API（本项目）

```
GET  /api/{netease|qq}/search?q=&limit=
GET  /api/{netease|qq}/song/url?id=&mid=&mediaMid=&level=
GET  /api/{netease|qq}/lyric?id=&mid=
GET  /api/{netease|qq}/playlists
GET  /api/{netease|qq}/playlist/tracks?id=
GET  /api/{netease|qq}/likes
POST /api/{netease|qq}/login/cookie
GET  /api/{netease|qq}/login/status
POST /api/{netease|qq}/logout
```

播放统一结构：

```json
{
  "provider": "qq|netease",
  "url": "",
  "playable": false,
  "trial": false,
  "loggedIn": true,
  "vipRequired": false,
  "restriction": { "category": "...", "message": "...", "action": "login|upgrade|purchase|switch_source" }
}
```

### 2.4 缓存与端口

- 播放地址 TTL ≤4min；会员状态 TTL ≤2min  
- 本机 **3000 常被桌面进程占用**，应用默认 **3010**（`config/app.json`）  
- Cloudflare Tunnel 的 Public Hostname 需指向实际监听端口  

### 2.5 前端听一听

- 音源仅 **QQ / 网易云**；默认 **QQ**  
- 详情页为全屏视觉舞台；FX 可换 13 档预设  
- 拿不到地址时按 `restriction.action` 提示登录/升级/换源，不静默失败  

---

## 3. 本地开发

```bash
npm install
npm run build:visual   # 生成 client/public/visual/mineradio-bundle.js
npm run build
npm start              # 默认 PORT=3010
```

听一听 → 播放 → 详情页查看舞台。  
预览引擎：`/visual/preview.html`

---

## 4. 播放台 UI / 手势 / 预设（Mineradio 对齐）

### 4.1 window 导出桥
bundle 顶层 var（orbit / gestureRotation / setPreset）与 window 不同步时，外部手势和 setVisualPreset 会打到空壳对象。
做法：visual-exports.js 在拼接末尾把同一对象挂到 window。

### 4.2 centerLocked 吞掉拖拽
主循环 targetRotY 在 centerLocked 时强制 0，updateCamera 也忽略 userTheta。
做法：pointerdown/move 调 unlockOrbit（centerLocked=false, recentering=false）。

### 4.3 双封面卡片
UI 只保留底栏 control-cover + 曲名，不要 thumb-wrap 浮层。

### 4.4 构建
export 源必须是字符串文件拼进 bundle，不能写在 .mjs 里 IIFE（Node 无 window）。

---

## 4. 播放台 UI / 手势 / 预设（Mineradio 对齐）

### 4.1 window 导出桥
bundle 顶层 var（orbit / gestureRotation / setPreset）与 window 不同步时，外部手势和 setVisualPreset 会打到空壳对象。
做法：visual-exports.js 在拼接末尾把同一对象挂到 window。

### 4.2 centerLocked 吞掉拖拽
主循环 targetRotY 在 centerLocked 时强制 0，updateCamera 也忽略 userTheta。
做法：pointerdown/move 调 unlockOrbit（centerLocked=false, recentering=false）。

### 4.3 双封面卡片
UI 只保留底栏 control-cover + 曲名，不要 thumb-wrap 浮层。

### 4.4 构建
export 源必须是字符串文件拼进 bundle，不能写在 .mjs 里 IIFE（Node 无 window）。
