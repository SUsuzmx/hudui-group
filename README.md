# WeChat 风格群聊应用（Hudui Group）

微信风格的 Web 即时通讯应用：多群会话、AI 群友、私聊、朋友圈、好友体系、红包/转账/名片/文件等消息类型。

| 项目 | 说明 |
|------|------|
| **线上地址** | https://chat.supeiji.top/ |
| **技术栈** | Node.js + Express + Socket.IO + SQLite（`node:sqlite`）+ Vue 3 + Vite |
| **AI** | 阿里云百炼 DashScope（聊天 / 生图 / 视频），多模型故障转移 |
| **默认端口** | `3000`（`config/app.json` 或环境变量 `PORT`） |
| **域名接入** | Cloudflare Tunnel（域名 `chat.supeiji.top`，隧道名 `werewolf`） |

---

## 目录结构

```
项目根目录（示例 Windows: C:\perry）
├── client/                  # Vue 3 前端源码
│   ├── index.html
│   ├── public/              # manifest.json / sw.js / PWA 图标
│   └── src/
│       ├── components/      # 登录/主界面/聊天/朋友圈/设置等页面
│       ├── api.js           # HTTP 封装
│       ├── socket-store.js  # Socket.IO 客户端
│       └── ...
├── client-dist/             # 构建产物（npm run build 生成，生产托管此目录）
├── config/
│   ├── app.json             # 群名、端口、AI 频率等运行参数
│   ├── ai.json              # AI 模型与密钥（含敏感信息，勿公开/勿提交）
│   └── ai.example.json      # AI 配置模板
├── data/                    # 运行时数据（勿提交仓库）
│   ├── chat.db              # SQLite 数据库（含 WAL：chat.db-wal / chat.db-shm）
│   ├── media/               # 聊天/朋友圈上传的图片、语音、视频
│   ├── app.log              # 应用业务日志
│   ├── service.log          # node 进程 stdout/stderr
│   ├── boot.log             # 守护脚本重启记录
│   ├── tunnel-config.json   # Cloudflare Tunnel 参考配置
│   └── dns-record.json      # DNS CNAME 参考记录
├── img/                     # AI/系统头像（文件名以人名开头自动匹配）
├── prototype/               # 独立静态微信风格原型（https://chat.supeiji.top/prototype/）
├── scripts/
│   ├── run-app.cmd          # Windows 守护进程（崩溃约 5 秒后自动重启）
│   ├── check-ai.mjs         # AI 连通性检查
│   ├── regression-all.mjs   # 冒烟回归
│   ├── smoke-security.mjs   # 安全冒烟
│   ├── e2e-test.mjs         # 端到端测试
│   └── archive/             # 历史调试/验收脚本
├── server/
│   ├── index.js             # Express + Socket.IO 入口
│   ├── db.js                # SQLite schema 与预处理语句
│   ├── auth.js              # 注册/登录/资料/限流
│   ├── chat.js              # 群聊/私聊/撤回/转发/红包/通话信令等
│   ├── meta.js              # 未读/草稿/偏好/标签/收藏/公众号
│   ├── moments.js           # 朋友圈
│   ├── moments-ai.js        # 朋友圈 AI 点赞/评论
│   ├── friends.js           # 好友/备注/黑名单/已读
│   ├── groups.js            # 多群种子与自定义群
│   ├── wallet.js            # 演示钱包
│   ├── acl.js               # 会话访问控制
│   ├── upload.js            # 媒体上传
│   └── ai/                  # LLM / 生图 / 视频 / 人设 / 头像
├── package.json
├── vite.config.js           # 前端构建与开发代理
└── .env.example             # DASHSCOPE_API_KEY 模板
```

---

## 环境要求

| 项目 | 要求 |
|------|------|
| Node.js | **≥ 20**（依赖内置 `node:sqlite`） |
| npm | 随 Node 安装 |
| 磁盘 | ≥ 1GB（媒体与日志会增长） |
| 网络 | 可访问 `dashscope.aliyuncs.com`；可出站到 Cloudflare |
| 可选 | `cloudflared`（绑定 https://chat.supeiji.top/ 必需） |

- **Windows**：Node 建议装在 `C:\Program Files\nodejs\`
- **Linux**：官方源安装 Node 20/22 LTS 即可

---

## 功能总览

### 1. 账号与个人中心

- 注册 / 登录（昵称唯一；注册、登录按 IP/账号限流）
- 个人资料：昵称、头像、微信号（wxid）、地区、个性签名
- 个人二维码名片；扫码/搜索解析用户后添加好友
- 状态（心情不错 / 有点累 / 专注中等）
- PWA：可安装到桌面/手机桌面（`client/public/manifest.json` + Service Worker）

### 2. 会话与消息列表（「微信」Tab）

- **预置多群**（`server/groups.js` 启动播种）：
  - `WeChat`（默认主群，kind=`main`）
  - 产品设计小分队（8）
  - 家庭群
  - 周末爬山群
  - 工作对接群
  - 开黑不解释
- **自定义群聊**：通讯录/更多入口创建，至少 3 人（创建者 + 2 位成员），系统消息提示入群
- 会话列表：最近消息摘要、时间、未读角标
- 会话偏好：**置顶 / 免打扰 / 折叠 / 草稿 / 聊天背景 / 清空本地聊天记录**
- 首页搜索 → **全局搜索**（联系人、AI 群友、群、聊天记录）

### 3. 群聊能力

- 实时收发（Socket.IO 房间按 `grp_{id}` 隔离）
- 消息类型：
  - 文字、表情
  - 图片（发送前压缩）、视频、语音（按住说话）
  - 文件、个人名片、位置（演示）
  - **微信红包**、**转账**（演示钱包联动）
- 消息操作：复制、引用、撤回、转发、多选、删除、收藏
- 正在输入（typing）提示
- 拍一拍
- 历史消息分页加载（`history:load`）
- 群公告（更新后系统消息广播）
- 群设置页（成员头像墙、公告等）

### 4. 私聊能力

- 与真实好友或 **AI 联系人** 一对一会话
- 支持文字 / 图片 / 语音 / 引用 / 撤回 / 转发 / 收藏
- 红包 / 转账（真人之间；AI 联系人入口隐藏支付）
- 对方已读状态（`private-read` / `private-peer-read`）
- 正在输入提示
- 音视频通话入口（见下文）

### 5. 音视频通话（信令）

- 私聊页可发起 **视频通话 / 语音通话**
- 服务端 Socket 事件：`call:invite` / `call:accept` / `call:reject` / `call:end`
- WebRTC 信令中继：`call:offer` / `call:answer` / `call:ice`
- 需浏览器授予麦克风/摄像头权限；穿透依赖 WebRTC 网络环境

### 6. AI 群友与智能体

| 能力 | 说明 |
|------|------|
| 人设 | `server/ai/personas.js`（如 思琪、Perry、小辣椒、阿强等），改文件后**重启生效** |
| 头像 | 放入 `img/`，文件名以 AI 名字开头（如 `思琪.jpg`）自动匹配，否则用 emoji |
| 群内触发 | 默认群可随机插话；@ 或点名高概率回复；新人入群欢迎；冷场开话题（tick） |
| 非默认群 | 真人发言可接话；不主动冷场发言 |
| 私聊 | 通讯录 AI 联系人可直接私聊，按上下文回复 |
| 媒体生成 | LLM 输出 `[图片:描述]` / `[视频:描述]` 会异步生图/生视频后发出 |
| 频率控制 | `config/app.json` → `ai.interjectRate` / `mentionRate` / `silenceMinutes` / `welcomeEnabled` / `maxAIMessagesPer10Min` |
| 模型调度 | `config/ai.json` 多模型列表 + `assignments` 按人设/群优先模型；失败/额度耗尽冷却 10 分钟并切换 |
| 朋友圈互动 | 用户发朋友圈后，AI 随机点赞/评论（`server/moments-ai.js`） |
| 兜底 | 未配置可用 Key 时使用人设 canned 台词，应用仍可演示 |

当前 AI 配置读取优先级：环境变量 `DASHSCOPE_API_KEY` / `AI_API_KEY` → `config/ai.json` 的 `apiKey`。

### 7. 通讯录

- 好友列表、搜索
- 添加好友（微信号 / 昵称 / 用户 ID / 二维码解析）
- 好友申请：发送、列表、通过/拒绝（「新的朋友」）
- 备注名、黑名单、朋友圈权限
- 标签分组（创建标签、分配成员、删除）
- 公众号（演示：关注/取关列表）
- AI 联系人列表
- 创建群聊入口

### 8. 朋友圈（发现）

- 发图文动态（可多图上传）
- 时间线浏览、我的朋友圈
- 点赞 / 取消点赞
- 评论、回复评论、删除评论
- **可见范围**：公开 / 私密 / 好友可见 / 部分可见（`visibleTo`）
- AI 随机互动（点赞/评论）
- 相册页汇总朋友圈图片

### 9. 演示钱包与支付

- 用户默认余额 **¥100**（演示数据，非真实支付）
- 红包发送扣余额；领取入账并写流水
- 转账发送/收款同样走演示钱包
- 「服务」页：手机充值、生活缴费等演示扣款（记流水）
- 钱包页：余额 + 流水（红包/转账/支付类型）
- 微信风格红包/转账卡片 UI（`WxPay*` 组件）

### 10. 发现页与「我」

**发现**：朋友圈、扫一扫、附近的人、购物、游戏、小程序、看一看、搜一搜  
（扫一扫/附近等为演示入口，不获取真实位置/摄像头以外数据；正式加好友请走「添加朋友」）

**我**：个人资料、二维码名片、状态、相册、收藏、服务/钱包、卡包、表情、设置

### 11. 设置与客户端体验

- 新消息通知（浏览器 Notification，需授权）
- 深色模式 / 跟随系统外观
- 聊天背景色板（含自定义色）
- 退出登录
- Toast 提示、导航栈返回
- 静态原型独立挂载：https://chat.supeiji.top/prototype/ （源码 `prototype/`，与正式应用互不影响）

### 12. 搜索

- 会话内搜索（`/api/chat/search`，仅本人可见范围：群 + 本人私聊）
- 全局搜索（`/api/search/global`）：好友 + AI 联系人 + 群 + 聊天记录

### 13. 权限与数据边界（实现层）

- 私聊会话 ID 形如 `pv_{uid}_{peer}` / `pv_u_{uid}_{peer}`，通过 `server/acl.js` 校验可访问性
- 群消息对群成员可见；搜索 SQL 按用户范围过滤
- 上传媒体落盘 `data/media/`，以 `/media/` 静态路径访问

---

## 配置说明

| 文件 | 作用 | 注意 |
|------|------|------|
| `config/app.json` | `groupName`、`port`、`ai` 频率参数 | 改端口需同步 Tunnel 与防火墙 |
| `config/ai.json` | `baseURL`、`apiKey`、模型列表、`publicBase`、`assignments` | **含密钥，禁止提交公开仓库** |
| `config/ai.example.json` | 配置模板 | 新机器可据此手写 `ai.json` |
| `.env.example` | `DASHSCOPE_API_KEY` 模板 | 可复制为 `.env` 或写入系统环境变量 |
| `server/ai/personas.js` | AI 人设与系统提示词 | 改完需重启服务 |
| `server/groups.js` | 群种子数据 | 空库启动时播种；已有消息的群不会覆盖 |
| `vite.config.js` | 构建输出 `client-dist/`；开发代理 `/api`、`/socket.io` → 3000 | |

`config/ai.json` 关键字段示例（**密钥请自行填写，勿照抄到公开处**）：

```json
{
  "baseURL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "nativeBase": "https://dashscope.aliyuncs.com/api/v1",
  "publicBase": "https://chat.supeiji.top",
  "apiKey": "sk-你的百炼密钥",
  "models": ["qwen3.7-max", "qwen3.7-flash"],
  "imageModels": ["wanx2.1-t2i-turbo"],
  "videoModels": ["wan2.2-t2v-plus"],
  "temperature": 0.85,
  "maxTokens": 280
}
```

`publicBase` 建议保持为线上域名 `https://chat.supeiji.top`，与 AI 生成媒体回调/展示地址一致。

---

## 注意事项（部署与运维必读）

1. **Node 版本**：必须 ≥ 20。旧版 Node 没有 `node:sqlite`，服务会直接起不来。
2. **密钥安全**：`config/ai.json`、系统环境变量中的 API Key 不要写入 Git、聊天记录或公开文档。迁移后建议轮换密钥。
3. **数据库 WAL**：`data/chat.db` 可能伴随 `chat.db-wal`、`chat.db-shm`。**拷贝/迁移前先停服**，三个文件与 `data/media/` 一起拷贝，否则可能丢最近消息或媒体 404。
4. **域名唯一绑定**：`chat.supeiji.top` 同一时间只能由**一台**机器的 Cloudflare Tunnel 提供服务。旧机隧道必须先停，再在新机启动，否则 502/522 或流量打到旧机。
5. **前端发版**：改了 `client/` 源码后必须 `npm run build`，再重启 Node，否则线上仍是旧前端。`index.html` 与 `sw.js` 已设为 `no-cache`，但用户浏览器仍可能需要强刷。
6. **路径写死**：`scripts/run-app.cmd` 默认 `cd /d C:\perry`，并优先使用 `C:\Program Files\nodejs\node.exe`。项目不在该路径时请同步修改脚本。
7. **监听范围**：服务监听 `0.0.0.0:3000`。生产对外仅通过 Tunnel 暴露即可；若服务器有公网 IP，请用防火墙限制 3000 端口，避免裸奔。
8. **上传大小**：聊天媒体约 9MB，朋友圈图约 3MB，JSON 体约 8MB。超限会 400。
9. **AI 非必需但影响体验**：无 Key 时群聊仍可用 canned 台词；有 Key 时才能稳定 LLM 回复与生图/生视频。生产环境可只配环境变量，不落盘 `ai.json`。
10. **演示性质**：钱包/红包/转账/手机充值均为**演示逻辑**，无真实资金与支付通道。附近的人、部分发现页入口为占位。
11. **日志与磁盘**：`data/media/`、`data/*.log`、`data/ui-*.png` 等调试产物会占磁盘，定期归档清理。
12. **并发与重启**：`uncaughtException` 会记日志后 `process.exit(1)`，依赖守护脚本拉起。勿在无守护的情况下仅用 `npm start` 长期挂生产。
13. **头像文件**：`img/` 下位图默认被 `.gitignore` 排除，新机需自行拷贝，否则 AI/系统头像可能只剩 emoji。
14. **注册限流**：线上会有限流（429）。批量导入用户时注意节奏，或临时调整 `server/auth.js` 中限流逻辑。
15. **HTTPS 与 Cookie**：经 Cloudflare 全站 HTTPS；前端 token 存 localStorage，隧道必须支持 **WebSocket**（Socket.IO 实时消息依赖）。

---

## 全新服务器部署（目标：继续使用 https://chat.supeiji.top/）

在一台**全新机器**上恢复本项目，并让域名 **https://chat.supeiji.top/** 仍然指向该新机器。

### 总览

```
用户浏览器
   │  HTTPS
   ▼
Cloudflare (chat.supeiji.top)
   │  Tunnel「werewolf」
   ▼
新服务器 cloudflared
   │  http://localhost:3000
   ▼
Node server/index.js  ── SQLite data/chat.db
                      ── 静态 client-dist/
                      ── AI DashScope（出站）
```

### 第 0 步：准备清单

| 项 | 说明 |
|----|------|
| 操作系统 | Windows Server / Windows 10+ 或 Linux |
| Node.js | ≥ 20 LTS |
| 旧机数据（可选） | 若要保留用户/聊天/媒体：`data/`、`config/ai.json`、`img/` |
| Cloudflare 账号 | 能管理 `supeiji.top` 区域与 Zero Trust / Tunnel |
| 百炼 API Key | `DASHSCOPE_API_KEY` 或 `config/ai.json` |
| 隧道信息（旧） | 名称 `werewolf`；DNS：`chat` → `<TunnelID>.cfargotunnel.com`（CNAME，已代理） |

参考 DNS 记录（`data/dns-record.json`）：

```
类型: CNAME
名称: chat
内容: <TunnelID>.cfargotunnel.com
代理: 已开启 (Proxied)
```

### 第 1 步：获取代码与数据

**方案 A — 整机打包迁移（推荐，保留用户/聊天/媒体）**

旧机（不含 `node_modules`）：

```powershell
cd C:\
tar -czf perry-backup.tar.gz --exclude=perry/node_modules perry
```

新机解压到同级路径：

```powershell
cd C:\
tar -xzf perry-backup.tar.gz
# 得到 C:\perry
```

**方案 B — 源码 + 关键数据**

从旧机拷贝到新机**相同目录结构**：

```
config/app.json
config/ai.json          # 含 API Key，务必私下传输
data/chat.db
data/chat.db-wal        # 若存在
data/chat.db-shm        # 若存在
data/media/
img/
scripts/run-app.cmd
server/  client/  client-dist/  prototype/
package.json  package-lock.json  vite.config.js
.env.example  .gitignore  README.md
```

若旧机已有可运行的 `client-dist/`，可先拷贝以便免构建启动；之后仍建议在新机重新 `npm run build`。

**方案 C — 全新空库（只保留功能，不保留历史）**

只需源码 + 配置模板。启动时自动创建 `data/chat.db`，并按 `server/groups.js` 播种群聊。仍需配置 `config/ai.json`（或环境变量）。

> 若 `scripts/run-app.cmd` 写死了 `C:\perry`，新机路径不同时请先改脚本。

### 第 2 步：安装依赖并构建前端

```bash
# Linux 示例路径 /srv/perry；Windows 示例 C:\perry
cd C:\perry

# 可选：国内镜像加速
npm config set registry https://registry.npmmirror.com

npm install
npm run build
```

确认存在：

- `client-dist/index.html`
- `client-dist/assets/index-*.js`
- `config/ai.json` **或** 已设置 `DASHSCOPE_API_KEY`

Linux 安装 Node 示例（版本号按需调整）：

```bash
# NodeSource 或官方二进制，确保 node -v >= 20
node -v
npm -v
```

Windows 安装 Node：https://nodejs.org/ （LTS），装到默认 `C:\Program Files\nodejs\` 最省事。

### 第 3 步：配置 AI

复制模板并填写，或从旧机拷贝 `config/ai.json`：

```bash
cp config/ai.example.json config/ai.json
# 编辑 config/ai.json，填入 apiKey；publicBase 保持 https://chat.supeiji.top
```

也可用环境变量，避免密钥写进文件：

```powershell
# Windows（当前用户）
setx DASHSCOPE_API_KEY "sk-你的密钥"
# 新开终端后生效
```

```bash
# Linux（systemd 见下一节 Environment=）
export DASHSCOPE_API_KEY="sk-你的密钥"
```

验证：

```bash
npm run check:ai
```

### 第 4 步：本地跑通（尚未切域名）

```bash
# 生产模式
npm start
# 浏览器打开 http://localhost:3000
```

开发模式（可选）：

```bash
npm run dev      # 前端 http://localhost:5173，代理 API/Socket 到 3000
# 另开终端
npm start
```

本地检查：

- 注册 / 登录成功
- 消息列表出现多个群
- 能收发文字
- 通讯录 / 发现 / 我 可切换
- 有 AI Key 时，在默认群发言后 AI 可能回复

日志：

- `data/app.log`
- `data/service.log`（守护模式）
- `data/boot.log`

### 第 5 步：进程常驻

#### Windows（计划任务 + 守护脚本）

```powershell
# 管理员 PowerShell
schtasks /create /tn "HuduiGroup" /tr "C:\perry\scripts\run-app.cmd" /sc onstart /ru SYSTEM /rl highest /f
schtasks /run /tn "HuduiGroup"

# 查询 / 停止
schtasks /query /tn "HuduiGroup" /v
schtasks /end /tn "HuduiGroup"
```

`scripts/run-app.cmd` 会在 node 退出后约 5 秒自动重启。

#### Linux（systemd）

```ini
# /etc/systemd/system/perry.service
[Unit]
Description=Perry WeChat Clone
After=network.target

[Service]
WorkingDirectory=/srv/perry
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
Environment=DASHSCOPE_API_KEY=sk-你的密钥
# 可选: Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now perry
sudo systemctl status perry
journalctl -u perry -n 50 --no-pager
```

### 第 6 步：绑定 https://chat.supeiji.top/（Cloudflare Tunnel）

域名通过 **Cloudflare Tunnel** 指向本机 `http://localhost:3000`。  
**不需要把 DNS A 记录改成新服务器公网 IP**；CNAME 继续指向 `<TunnelID>.cfargotunnel.com` 即可。

#### 6.1 安装 cloudflared

- Windows / Linux 官方下载：  
  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

```bash
cloudflared --version
```

#### 6.2 登录并创建/复用隧道（新服务器）

**情况 1：沿用旧隧道名称与 DNS（推荐）**

1. 在**旧服务器**停止 cloudflared 与相关计划任务/systemd。
2. 在 Cloudflare Zero Trust 控制台确认旧隧道可删除或已断开。
3. 在新服务器登录并创建同名隧道（或导入旧 credentials，视账号策略而定）：

```bash
cloudflared tunnel login
cloudflared tunnel create werewolf
# 记下输出的 Tunnel ID
```

**情况 2：新建隧道后改 DNS 指向**

创建任意名称隧道后，在 Zero Trust 里把 `chat.supeiji.top` 的 Public Hostname / DNS 改为**新** Tunnel ID 对应的 `*.cfargotunnel.com`。

配置文件示例（Windows）：

`C:\Users\Administrator\.cloudflared\config.yml`

```yaml
tunnel: <TunnelID>
credentials-file: C:\Users\Administrator\.cloudflared\<TunnelID>.json

ingress:
  - hostname: chat.supeiji.top
    service: http://localhost:3000
    originRequest:
      noTLSVerify: true
      connectTimeout: 10
  - service: http_status:503
```

项目内参考：`data/tunnel-config.json`。

Linux 配置路径通常为 `/etc/cloudflared/config.yml` 或 `~/.cloudflared/config.yml`。

#### 6.3 DNS / Public Hostname

Zero Trust 控制台：

1. Networks → Tunnels → 选中隧道（如 `werewolf`）→ Public Hostname
2. Hostname：`chat.supeiji.top`
3. Service：`http://localhost:3000`

或命令行路由 DNS：

```bash
cloudflared tunnel route dns werewolf chat.supeiji.top
```

期望 DNS（与 `data/dns-record.json` 一致）：

```
chat.supeiji.top  →  CNAME  →  <TunnelID>.cfargotunnel.com  (Proxied)
```

**重要**：同一 hostname 只能绑定一个活动隧道。旧机不停、新机再开会导致 502/流量打到旧机。

#### 6.4 启动隧道

前台测试：

```bash
# Windows
cloudflared.exe tunnel --config "C:\Users\Administrator\.cloudflared\config.yml" run werewolf
```

Windows 常驻：

```powershell
schtasks /create /tn "CloudflaredPerry" /tr "cloudflared.exe tunnel --config C:\Users\Administrator\.cloudflared\config.yml run werewolf" /sc onstart /ru SYSTEM /f
schtasks /run /tn "CloudflaredPerry"
```

Linux 常驻：

```bash
sudo cloudflared service install
# 或自建 systemd 指向同一 config.yml
sudo systemctl enable --now cloudflared
```

#### 6.5 验收线上域名

```bash
curl -I https://chat.supeiji.top/
curl -I https://chat.supeiji.top/sw.js
curl -I https://chat.supeiji.top/prototype/
```

期望均为 **200**。浏览器打开 https://chat.supeiji.top/ 应看到登录页。

再验证实时通道：登录后在两个浏览器窗口互发消息，或打开控制台确认 Socket.IO 已连接（无持续 WebSocket 错误）。

### 第 7 步：迁移动态数据（若第 1 步未包含）

方案 A/B 已包含 `data/chat.db` 与 `data/media/` 时，用户与聊天会保留。

若只拷了 db 没拷 media：历史图片/语音会 404，补拷 `data/media/` 即可。

**拷贝数据库前先停服**，避免 WAL 损坏：

```powershell
schtasks /end /tn "HuduiGroup"
# 拷贝 data/chat.db, data/chat.db-wal, data/chat.db-shm, data/media
# 以及 img/（AI 头像）
schtasks /run /tn "HuduiGroup"
```

Linux：

```bash
sudo systemctl stop perry
# rsync/scp data/ img/ config/ai.json
sudo systemctl start perry
```

### 第 8 步：迁移后回归

```bash
npm run test:smoke
npm run test:security
npm run check:ai
```

人工检查表：

| 检查项 | 期望 |
|--------|------|
| https://chat.supeiji.top/ | 可打开，可登录 |
| 消息列表 | 真实会话，未读/置顶正常 |
| 群聊 | 各群消息独立；默认群 AI 可回复（有 Key 时） |
| 私聊 | 文字/图片/语音可发；已读状态正常 |
| 朋友圈 | 发表、点赞、评论、图片可见 |
| 好友 | 添加/删除/备注/黑名单/申请 |
| 红包/转账/钱包 | 演示流程可走通，余额与流水合理 |
| 视频通话 | 可打开通话页并发起邀请 |
| 设置 | 深色模式、聊天背景生效 |
| /prototype/ | 静态原型可打开 |
| 日志 | `data/app.log` 无持续报错 |

---

## 日常运维

```bash
# 改前端后发版
npm run build
schtasks /end /tn "HuduiGroup"
schtasks /run /tn "HuduiGroup"

# 只改了 server/ 或 config/
schtasks /end /tn "HuduiGroup"
schtasks /run /tn "HuduiGroup"

# 查看日志（Windows PowerShell）
Get-Content C:\perry\data\app.log -Tail 50
Get-Content C:\perry\data\service.log -Tail 50
Get-Content C:\perry\data\boot.log -Tail 20
```

Linux 对应：`sudo systemctl restart perry`，日志用 `journalctl -u perry -n 50`。

---

## 本地开发

```bash
npm run dev    # 前端 5173，代理 /api 与 /socket.io 到 3000
npm start      # 另开终端启动后端（生产托管 client-dist）
```

PWA 静态资源在 `client/public/`，构建后进入 `client-dist/`。

常用 npm scripts：

| 命令 | 作用 |
|------|------|
| `npm run dev` | Vite 开发服务器 |
| `npm run build` | 构建前端到 `client-dist/` |
| `npm start` | 启动后端（Express + Socket.IO） |
| `npm run check:ai` | 检查 DashScope / AI 配置 |
| `npm run test:smoke` | 冒烟回归 |
| `npm run test:security` | 安全冒烟 |
| `npm run test:e2e` | Playwright 端到端 |
| `npm run gen:icons` | 生成 PWA 图标 |

---

## 故障排查

| 现象 | 排查 |
|------|------|
| 线上 502/522 | Node 是否在跑；Tunnel 是否指向 3000；旧隧道是否未停；`curl http://localhost:3000/` |
| 打开是旧前端 | 强刷；确认 `npm run build` 后已重启服务 |
| 登录失败 / 429 | `data/app.log`；是否触发限流；`data/chat.db` 是否可写 |
| AI 不回复 | `npm run check:ai`；apiKey / 环境变量；`data/service.log`；是否模型全部冷却 |
| 媒体发不出 / 404 | `data/media/` 是否存在、权限是否正确；上传接口日志；是否只拷了 db |
| Socket 连不上 | Tunnel 是否支持 WebSocket；浏览器控制台 WS 错误；origin/HTTPS 是否正常 |
| `node:sqlite` 报错 | Node 版本 < 20，升级 Node |
| 计划任务不起 | `run-app.cmd` 路径是否正确；任务是否以 SYSTEM/管理员创建；`data/boot.log` |
| 通话无声/无法接通 | 麦克风权限；HTTPS；对端是否在线；信令日志 |
| 群列表没有种子群 | 空库才会播种；检查 `server/groups.js` 与启动日志「群聊数据就绪」 |

---

## /prototype/

独立静态微信风格原型：https://chat.supeiji.top/prototype/  
源码在 `prototype/`，与正式 Vue 应用互不影响，仅通过 Express 静态托管。

---

## 安全摘要

- 生产访问入口仅保留 **Cloudflare Tunnel → localhost:3000**
- `config/ai.json`、`.env`、`data/` 不进公开仓库（见 `.gitignore`）
- SQLite 与 `data/media/` 仅应用运行账号可读写
- 注册/登录有基础限流；会话搜索有 ACL 范围过滤
- 迁移或泄露后**更换 AI 密钥**
- 明确：钱包与支付为演示，勿当作生产支付系统
