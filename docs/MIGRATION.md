# 服务器迁移手册（Hudui Group）

把本项目从旧机迁到新机时，按本文顺序操作。目标：数据不丢、域名 `https://chat.supeiji.top/` 可继续用、听一听歌单可同步。

> **端口约定**：应用默认监听 **`3010`**（`config/app.json` 的 `port`，或环境变量 `PORT`）。  
> Cloudflare Tunnel 的 `service` 必须指向同一端口，例如 `http://localhost:3010`。

---

## 0. 迁移前检查清单

| 项 | 旧机路径 / 说明 | 是否必须 |
|----|-----------------|----------|
| 源码 | `client/` `server/` `scripts/` `config/app.json` `package.json` `vite.config.js` | 是（或直接 `git clone`） |
| 数据库 | `data/chat.db` **以及** `data/chat.db-wal` `data/chat.db-shm` | 保留业务数据则必须 |
| 媒体 | `data/media/`（上传图/语音/文件/视频） | 保留聊天媒体则必须 |
| AI 配置 | `config/ai.json`（或新机用 `config/ai.example.json` + `DASHSCOPE_API_KEY`） | 要用 AI 则必须 |
| 音乐 Cookie | 项目根 `.netease-cookie` `.qq-cookie` `.kugou-cookie`（**永不入库、永不回传前端**） | 听一听要继续用原账号则必须 |
| 小游戏 | `games/`（第三方体积大，默认 gitignore；**叠塔对战不需要**） | 只在要玩单人练习/第三方游戏时 |
| 隧道 | Cloudflare Tunnel 凭证 / `cloudflared` 配置（隧道名如 `werewolf`） | 继续用域名则必须 |
| 默认头像 | `img/amdin.png`（若被清理需补回） | 建议 |
| 依赖 | Node.js **≥ 20**；可选 Python + openpyxl/docx/pptx/reportlab | 是 |

**迁移前必须停服**（含 Node 与旧隧道），再拷贝 `chat.db*`，避免 SQLite WAL 撕裂。

```powershell
# Windows：停应用与隧道
schtasks /end /tn "HuduiGroup"
# 若 cloudflared 也挂了计划任务，一并结束
Get-Process node, cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
```

打包建议（排除依赖与日志）：

```powershell
# 旧机项目根执行；输出 hudui-migrate.zip
tar -a -cf hudui-migrate.zip `
  client server scripts config img docs prototype `
  package.json package-lock.json vite.config.js README.md .env.example .gitignore `
  data/chat.db data/chat.db-wal data/chat.db-shm data/media `
  .netease-cookie .qq-cookie .kugou-cookie `
  games
# 若暂无 games/ 或 cookie，可从命令里去掉对应项
```

也可用 Git 拉源码 + 单独拷贝「密钥与数据」（见下文方案 B）。

---

## 1. 三种获取代码方式

### 方案 A：整包拷贝（最省事，推荐）

1. 旧机停服后打包（上节命令）
2. 新机解压到例如 `C:\perry`（或 `/opt/hudui-group`）
3. 直接进入 [§2 安装依赖](#2-安装依赖与构建)

### 方案 B：Git 源码 + 数据/密钥单独拷贝

```bash
git clone https://github.com/SUsuzmx/hudui-group.git
cd hudui-group
```

再从旧机拷贝（**不要提交到 Git**）：

- `data/chat.db` `data/chat.db-wal` `data/chat.db-shm`
- `data/media/`
- `data/vapid.json`（Web Push 密钥，可选；不拷则新机自动生成，旧订阅失效）
- `data/feature-flags.json`（可选，功能开关覆盖）
- `config/ai.json`
- `.netease-cookie` `.qq-cookie` `.kugou-cookie`
- `games/`（可选）
- `music/`（可选，本地曲库 / 猜歌兜底，体积大）
- `vendor/folia-major/`（可选，沉浸式听歌；**体积大且属第三方仓库，建议在新机重新克隆构建**，见 §2.1）

### 方案 C：空库全新装

只克隆源码，不拷 `data/`。首次 `npm start` 会自动建库并播种预置群。用户需重新注册；听一听需重新导入音乐 Cookie。

---

## 2. 安装依赖与构建

```bash
# Node.js ≥ 20
node -v

# 可选：国内镜像
npm config set registry https://registry.npmmirror.com

npm install
npm run build
```

确认产物存在：`client-dist/index.html`。

可选 Python（群聊 Agent 生成 xlsx/docx/pptx/pdf）：

```bash
# 有 MIMO_PYTHON 时优先使用
python -c "import openpyxl, docx, pptx, reportlab; print('ok')"
```

### 2.1 沉浸式听歌（Folia，可选）

发现页「沉浸式听歌」依赖第三方仓库 [folia-major](https://github.com/chthollyphile/folia-major)，
它**不入库**（`vendor/` 在 .gitignore 里），新机必须自行克隆并构建：

```bash
git clone https://github.com/chthollyphile/folia-major vendor/folia-major
cd vendor/folia-major && npm install
cd ../.. && npm run build:folia
```

> 构建前请先按 [folia-integration.md](folia-integration.md)「对 Folia 源码的本地补丁」一节
> 配好 `.env.local`（三个音源基址指向宿主网关 `/ncm-api` `/qq-api` `/kugou-api`）与
> `.npmrc`，否则 Folia 会去连 localhost:3000 之类的默认地址。

**未构建不影响其它功能**：服务器照常启动，只是 `/folia/` 返回 404，日志会提示
`先运行 npm run build:folia`。构建产物在 `vendor/folia-major/dist/`，重启进程后生效。

---

## 3. 配置

### 3.1 端口

| 方式 | 示例 |
|------|------|
| 配置文件 | `config/app.json` → `"port": 3010` |
| 环境变量 | `PORT=3010`（优先于配置文件时以代码实际读取为准；本项目默认 3010） |

新机防火墙：若仅通过 Tunnel 对外，**不要**把 3010 裸暴露公网。

### 3.2 AI（可选）

```bash
cp config/ai.example.json config/ai.json
# 填写 apiKey；publicBase 保持 https://chat.supeiji.top
npm run check:ai
```

或：`DASHSCOPE_API_KEY=sk-...`（可写入 `.env`，参考 `.env.example`）。

**迁移后建议轮换 DashScope 密钥。**

### 3.3 听一听音源 Cookie（可选）

文件位于项目根（gitignore，勿提交）：

| 文件 | 要求 |
|------|------|
| `.netease-cookie` | 含 `MUSIC_U` |
| `.qq-cookie` | 含 `uin` + 播放票据 `qm_keyst` 等 |

也可在应用内：听一听 →「音源」→ 粘贴 Cookie 导入。  
服务端会持久化到上述文件。歌单接口：

- `GET /api/{netease|qq}/playlists`
- `GET /api/{netease|qq}/playlist/tracks?id=`
- `GET /api/{netease|qq}/likes`

详见 [MUSIC-VISUAL.md](./MUSIC-VISUAL.md)。

### 3.4 叠塔对战与小游戏

**叠塔对战（推荐，随源码一起迁移）**

- 入口：发现 → 游戏 →「叠塔对战 / 发起对战」
- 2–6 人实时比拼，90 秒一局；邀请卡片一键加入，**无需房间码**
- 房间状态在服务端内存：**重启 Node 会结束当前比赛**，历史邀请卡显示「邀请已经散场」
- 个人统计写入 `data/chat.db` 的 `tower_stats`；邀请记录在 `tower_invites`
- 本地存在 `games/tower_game` 时，游戏中心额外显示「叠塔练习」单人 iframe；不存在则只保留实时对战
- 部署后验证：`PORT=3011 node scripts/tower-test-server.mjs`，再 `BASE=http://127.0.0.1:3011 node scripts/test-tower-battle.mjs`

**第三方小游戏（可选）**

将第三方游戏放到 `games/<id>/index.html`，并在服务端 `GAME_APPS` 注册后可见 `/api/games`。`games/` 默认 gitignore。

---

## 4. 启动与常驻

### 本地验证

```bash
npm start
# 浏览器打开 http://localhost:3010
```

### Windows 计划任务

```powershell
# 先按实际路径修改 scripts\run-app.cmd 内的 cd 与 node 路径
schtasks /create /tn "HuduiGroup" /tr "C:\perry\scripts\run-app.cmd" /sc onstart /ru SYSTEM /rl highest /f
schtasks /run /tn "HuduiGroup"
```

`run-app.cmd` 会在进程退出后约 5 秒拉起，日志：`data/service.log`、`data/boot.log`。

### Linux systemd 示例

```ini
[Unit]
Description=Hudui Group
After=network.target

[Service]
WorkingDirectory=/opt/hudui-group
ExecStart=/usr/bin/node server/index.js
Restart=always
Environment=PORT=3010
Environment=DASHSCOPE_API_KEY=sk-...

[Install]
WantedBy=multi-user.target
```

---

## 5. Cloudflare Tunnel（继续用 chat.supeiji.top + admin.supeiji.top）

> **重要**：本项目当前以「**远程托管**」模式运行隧道
> （`cloudflared tunnel run --token-file C:\ProgramData\cloudflared\token`）。
> 该模式下 ingress 与 DNS 由 Cloudflare 后台下发，**本地 `config.yml` 不生效**。
> 下面的 YAML 仅在切换到本地托管模式（`cloudflared tunnel run werewolf`）时才被读取。

1. **先停旧机隧道**（同一时间只能一台机器宣告该域名）
2. 新机安装 `cloudflared` 并登录 Cloudflare
3. 复用旧 Tunnel（推荐）：
   - 拷贝旧机 `cloudflared` 配置目录（Windows 通常在 `%USERPROFILE%\.cloudflared\`，含 `credentials-<tunnelid>.json` 与 `config.yml`）
   - 或 `cloudflared tunnel create werewolf` 新建后改 DNS
4. ingress **必须**指向应用端口（本地托管模式）：

```yaml
ingress:
  - hostname: chat.supeiji.top
    service: http://localhost:3010
  - hostname: admin.supeiji.top
    service: http://localhost:3010
  - service: http_status:503
```

5. **远程托管模式**下改为在 Cloudflare 后台配置：
   `Networks → Tunnels → werewolf → Public Hostname → Add`，分别添加
   `chat.supeiji.top` 与 `admin.supeiji.top`，Type `HTTP`、URL `localhost:3010`。
   Cloudflare 会自动创建对应 CNAME。
   也可用助手脚本一次完成（需 `CLOUDFLARE_API_TOKEN`）：
   `CLOUDFLARE_API_TOKEN=xxx npm run admin:domain -- --apply`

6. DNS（本地托管模式需手动建）：`chat` 与 `admin` CNAME → `<TunnelID>.cfargotunnel.com`（Proxied）  
   本项目曾用隧道 ID 示例：`71d22e72-82d6-437c-84a2-c7044320137c`（以你账号实际为准）
7. 启动隧道：`cloudflared tunnel run werewolf`（或 `--token-file`）
8. 验收：

```bash
curl -I https://chat.supeiji.top/
curl -I https://chat.supeiji.top/sw.js
curl -I https://chat.supeiji.top/api/games
curl -I https://admin.supeiji.top/          # 运营后台独立域名
curl -I https://chat.supeiji.top/admin      # 运营后台备用入口
# 听一听歌单（需先登录应用拿 Token，或在页面里点「Perry的…歌单」）
curl -I https://chat.supeiji.top/api/netease/playlists
```

9. 后台域名自检：`npm run admin:domain`（只读检查解析与 Host 路由是否就绪）

> 换新域名时只需改 `config/app.json` 的 `adminHosts` / `siteHost`，服务端无需改代码。

---

## 6. 迁移后回归清单

```bash
npm run test:smoke
npm run test:security
npm run check:ai
npm run test:tower   # 需先 PORT=3011 node scripts/tower-test-server.mjs
node scripts/smoke-platform.mjs
node scripts/verify-group-fixes.mjs
```

人工必点：

- [ ] 注册/登录（单端挤下）
- [ ] 群聊收发、@AI、红包/转账
- [ ] 群详情：成员头像墙、群公告、我在群里的昵称、查找聊天记录
- [ ] 私聊、朋友验证
- [ ] 朋友圈封面与点赞
- [ ] 通讯录 A–Z
- [ ] 音视频通话
- [ ] **听一听**：搜索播放、Perry 歌单入口、「我喜欢」与自建/收藏曲目、底部播放台进度条
- [ ] 音源 Cookie 导入后歌单可同步
- [ ] **沉浸式听歌**：发现页入口打开不白屏；网易云直接可见账号（服务端 `.netease-cookie`）；QQ 扫码可登录；酷狗可搜索
- [ ] **叠塔对战**：发起 → 邀请卡 → 点卡加入 → 准备开局 → 90 秒对局 → 结算再来一局
- [ ] 发现页游戏（若已部署）
- [ ] PWA / Service Worker 强刷后正常
- [ ] 账号安全：登录记录 / 找回密码；推送订阅（HTTPS）

---

## 7. 常见问题

| 现象 | 处理 |
|------|------|
| 线上 502/522 | Node 是否在听 3010；Tunnel `service` 是否仍指向旧端口 3000 |
| 页面是旧 UI | `npm run build` 后重启；浏览器 Ctrl+F5 |
| 登录即失效 | `data/chat.db` 是否完整拷贝（含 -wal/-shm）；是否拷贝后又在旧机写库 |
| 网易云歌单「网络异常」 | 确认 `MUSIC_U` 有效；看服务端日志里的 uid 与 SDK `e.body`；勿前端直连网易云 |
| QQ「我喜欢」要重新授权 | Cookie 缺播放票据 `qm_keyst`，重新走官方 QQ 音乐登录窗口 |
| 歌单接口 502 is not defined | 服务进程未加载最新 `server/providers/music-routes.js`，重启 Node |
| 沉浸式听歌白屏 / 404 | `vendor/folia-major/dist` 未构建：按 §2.1 克隆并 `npm run build:folia`，再重启进程 |
| 沉浸式听歌资料库「暂无内容」 | 网易云看 `/ncm-api/login/status` 是否返回账号；QQ/酷狗需在 Folia 内单独登录 |
| `/api/lyric-proxy` 返回 401 | 该接口只放行同源页面请求，直接浏览器访问地址栏或 curl 会被拒（`Sec-Fetch-Site` 不匹配） |
| AI 不回复 | `npm run check:ai`；密钥与额度 |
| 两台机同时跑 | 必须停旧 Node + 旧 Tunnel，避免库写冲突与 DNS 切换失败 |

---

## 8. 迁移完成后建议

1. 轮换 `DASHSCOPE_API_KEY`
2. 确认 `.netease-cookie` / `.qq-cookie` / `config/ai.json` 权限收紧（仅服务账户可读）
3. 旧机数据保留一份冷备份后再清理
4. 在 Git 打 tag，例如 `post-migration-YYYYMMDD`
