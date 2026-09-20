# WeChat 风格群聊应用（Hudui Group）

微信风格的 Web 即时通讯应用：多群会话、**群聊 AI 群友（Agent 能力）**、私聊、朋友圈、好友体系、红包/转账/名片/文件/接龙/群收款等消息类型，并按真实微信截图对齐主界面、群聊详情、通话、好友资料等页面 UI。

| 项目 | 说明 |
|------|------|
| **线上地址** | https://chat.supeiji.top/ |
| **GitHub** | https://github.com/SUsuzmx/hudui-group |
| **技术栈** | Node.js + Express + Socket.IO + SQLite（`node:sqlite`）+ Vue 3 + Vite |
| **AI** | 阿里云百炼 DashScope（聊天 / 生图 / 视频 / **Agent 任务**），多模型故障转移 |
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
│       ├── components/      # 主界面/聊天/朋友圈/群详情/通话/服务等页面
│       ├── pinyin-initial.js # 通讯录拼音首字母 A–Z
│       ├── api.js           # HTTP 封装
│       ├── socket-store.js  # 共享 Socket.IO
│       └── ...
├── client-dist/             # 构建产物（npm run build，不入库）
├── config/
│   ├── app.json             # 群名、端口、AI 频率
│   ├── ai.json              # AI 模型与密钥（勿提交公开仓库）
│   └── ai.example.json
├── data/                    # 运行时数据（.gitignore）
├── games/                   # 发现页小游戏静态产物（第三方体积大，.gitignore）
├── img/                     # AI/系统头像（文件名以人名开头自动匹配）
├── prototype/               # 静态原型 https://chat.supeiji.top/prototype/
├── scripts/
│   ├── run-app.cmd          # Windows 守护进程
│   ├── check-ai.mjs
│   ├── e2e-test.mjs
│   ├── regression-all.mjs
│   ├── smoke-security.mjs
│   └── archive/             # 红包/通话/私聊支付等冒烟脚本
├── server/
│   ├── index.js             # Express + Socket.IO 入口
│   ├── db.js                # SQLite schema
│   ├── auth.js              # 注册/登录/资料/限流
│   ├── chat.js              # 群/私聊消息、红包转账、通话信令
│   ├── groups.js            # 群种子 + 成员表
│   ├── rp.js                # 红包拆分/领取/超时退回
│   ├── wallet.js            # 演示钱包
│   ├── ai/
│   │   ├── engine.js        # 群聊触发 + Agent 调度
│   │   ├── agent.js         # 提醒 / 办公文件生成
│   │   ├── agent_gen.py     # xlsx/docx/pptx/pdf 生成脚本
│   │   ├── personas.js      # AI 人设
│   │   └── provider.js      # LLM / 多模型
│   └── ...
├── package.json
└── vite.config.js
```

---

## 环境要求

| 项目 | 要求 |
|------|------|
| Node.js | **≥ 20**（`node:sqlite`） |
| Python | **可选**（Agent 生成 Excel/Word/PPT/PDF；环境变量 `MIMO_PYTHON` 或 `python`） |
| 磁盘 | ≥ 1GB |
| 网络 | `dashscope.aliyuncs.com`；可出站 Cloudflare |
| 可选 | `cloudflared`（绑定 https://chat.supeiji.top/） |

Python 侧常用库（Agent 文件生成）：`openpyxl`、`python-docx`、`python-pptx`、`reportlab`（桌面环境若已预装办公库可直接使用）。

---

## 功能总览

### 主界面 UI（对齐微信截图）

- **微信**：标题居中 `微信(n)`；会话行、未读角标、免打扰铃、折叠的聊天、下拉刷新；底栏 SVG 图标
- **通讯录**：功能入口（新的朋友/群聊/标签/公众号/服务号）+ 企业微信 + 星标朋友 + **拼音 A–Z 分组** + 右侧索引可点击跳转；**仅展示好友**（AI 群友不进通讯录）
- **发现**：朋友圈 / 视频号 / 直播 / 听一听 / 游戏 等分组入口
- **我**：大头像资料卡（点进个人信息）+ 服务 / 收藏 / 朋友圈 / 状态 / 小店与卡包 / 表情 / 设置
- **聊天页点头像**：群聊/私聊均可点击头像进入资料页（对方或自己）

### 账号与个人中心

- 注册 / 登录（限流）；资料：昵称、头像（预置或**上传**）、微信号、地区、签名、性别
- **个人信息页**：改资料后「完成」写入服务器
- 二维码名片、扫码/搜索加好友
- 状态页（心情/专注等）；PWA 可安装

### 会话与消息

- 预置群：WeChat / 产品设计 / 家庭 / 爬山 / 工作 / 开黑（启动播种，并写入群成员）
- 自定义群：创建、邀请（好友，可在群设置中管理 AI 成员）、退群、改名、群公告
- 会话偏好：置顶 / 免打扰 / 折叠 / 浮窗 / 草稿 / 会话背景 / 清空
- 消息类型：文字、表情、图、语音（进度条）、视频、文件、名片、位置、**红包**、**转账**、**群接龙**、**群收款**、**合并转发卡片**
- 操作：复制、引用、撤回、转发、**合并转发展开页**、多选、收藏、拍一拍、@所有人

### 红包 / 转账（演示钱包）

- 专属红包 / **拼手气红包**（二倍均值拆分）
- 5 款红包封面；领取记录、手气最佳
- 私聊与群聊均可发送/领取；24h 未领/未收自动退回
- 群收款：成员可点卡片从零钱支付

### 群聊详情页（对齐截图）

- 标题 `聊天信息(n)` + 免打扰铃；**成员头像墙** + 虚线「+」
- 群聊名称 / 群二维码 / 群公告 / 备注
- 查找聊天记录；免打扰 / 折叠 / 以下消息仍通知 / 置顶 / 保存到通讯录
- 我在群里的昵称；显示群成员昵称；删除并退出

### 私聊与通话

- 私聊红包/转账、引用、收藏；已读提示
- **音视频通话**：WebRTC + 信令；模糊等待页、麦克风/扬声器/摄像头状态、双向挂断；通话记录写入私聊

### 朋友圈

- 封面图可**更换**（相机按钮上传）
- 发图文、点赞、评论/回复/删除；可见范围（公开/好友/部分/私密）
- AI 随机点赞评论；「我的朋友圈 / 作品」相册

### 服务 / 小程序 / 表情 / 游戏

- **服务页**：绿色收付款/钱包头图 + 金融理财/生活服务/交通出行/购物消费
- **小程序**：最近使用 / 我的小程序
- **表情详情**：收藏表情，聊天表情面板可发送
- **游戏中心**（发现页）：静态小游戏托管于 `/games/<id>/`，由 `server/index.js` 的 `GAME_APPS` 注册；运行时可通过 `GET /api/games` 列出可用游戏。本地示例：叠塔挑战（`games/tower_game`）。第三方完整仓库体积较大，默认不入库。

### AI 群友（仅群聊 + Agent）

- **出现范围**：AI 人设主要出现在**群聊**（欢迎 / 插话 / 冷场 / @提及 / 媒体生成）
- **不可加好友**：通讯录、全局搜索不把 AI 当联系人；好友添加接口拒绝 AI/persona 参数
- **资料页说明**：从群成员/历史会话进入 AI 资料时，提示「仅在群聊中互动」
- **Agent 能力**（群内 `@人设名` + 指令，`server/ai/agent.js`）：

  | 指令示例 | 行为 |
  |----------|------|
  | `@思琪 提醒我明天 10:30 开会` | 创建提醒；到点在会话推送 |
  | `@思琪 提醒我 5分钟后 喝水` | 相对时间提醒 |
  | `@思琪 帮我生成一份关于产品路线的ppt` | 生成 `.pptx` 文件消息 |
  | `@思琪 做个excel 关于销售数据` | 生成 `.xlsx` |
  | `@思琪 写一份word 关于会议纪要` | 生成 `.docx` |
  | `@思琪 导出 pdf 关于通知` | 生成 `.pdf` |

- 生成文件写入 `data/media/`，以聊天 **文件消息** 发出；提醒持久化在 `data/ai-reminders.json`
- 无 LLM Key 时仍可走 Agent 确认文案；普通闲聊回退 canned 台词

---

## 配置

| 文件 | 作用 |
|------|------|
| `config/app.json` | 端口、AI 频率 |
| `config/ai.json` | 模型与密钥（勿公开） |
| `.env.example` | `DASHSCOPE_API_KEY` 模板 |
| `server/ai/personas.js` | AI 人设，改完重启 |
| `server/groups.js` | 群种子与成员播种 |
| `server/ai/agent.js` | Agent 指令解析 / 提醒 / 文件调度 |
| `server/ai/agent_gen.py` | 本地 Python 生成 xlsx/docx/pptx/pdf |

`publicBase` 建议：`https://chat.supeiji.top`

---

## 从零部署（新服务器，继续用 https://chat.supeiji.top/）

### 获取代码与数据

- **方案 A 整机拷贝**（推荐）：旧机打包排除 `node_modules`，新机解压到相同路径  
- **方案 B 源码+数据**：拷贝 `server/ client/ client-dist/ config/ data/ img/ package.json` 等  
- **方案 C 空库**：仅源码 + 模板，启动自动建库并播种群  

拷贝数据库前先停服（含 `chat.db` / `-wal` / `-shm` 与 `data/media/`）。

### 安装与构建

```bash
cd C:\perry   # 或 Linux 项目目录
npm config set registry https://registry.npmmirror.com   # 可选
npm install
npm run build
```

确认：`client-dist/index.html`、`config/ai.json` 或已设 `DASHSCOPE_API_KEY`。

Agent 文件生成依赖 Python（可选）：

```bash
# 有 MIMO_PYTHON 时会优先使用该解释器
"$MIMO_PYTHON" -c "import openpyxl, docx, pptx, reportlab; print('ok')"
```

### 配置 AI

```bash
cp config/ai.example.json config/ai.json
# 填写 apiKey；publicBase 保持 https://chat.supeiji.top
npm run check:ai
```

或环境变量：`setx DASHSCOPE_API_KEY "sk-..."` / `export DASHSCOPE_API_KEY=...`

### 本地启动

```bash
npm start
# http://localhost:3000
npm run dev   # 开发：前端 5173，代理到 3000（注意：/games 由 Express 提供，请用 3000 访问游戏）
```

### Windows 常驻

```powershell
schtasks /create /tn "HuduiGroup" /tr "C:\perry\scripts\run-app.cmd" /sc onstart /ru SYSTEM /rl highest /f
schtasks /run /tn "HuduiGroup"
```

`run-app.cmd` 路径若与安装目录不一致，请先改脚本。

Linux systemd：`ExecStart=/usr/bin/node server/index.js`，`Restart=always`，WorkingDirectory 指向项目根。

### 绑定 https://chat.supeiji.top/

Cloudflare Tunnel → `http://localhost:3000`（隧道名如 `werewolf`）。

1. 新机安装 `cloudflared`，登录并 `cloudflared tunnel create werewolf`（或复用旧 credentials）  
2. 配置 ingress：`hostname: chat.supeiji.top` → `service: http://localhost:3000`  
3. DNS：`chat` CNAME → `<TunnelID>.cfargotunnel.com`（Proxied）  
4. **同一时间仅一台机器**提供该域名；换机前先停旧隧道  
5. 验收：

```bash
curl -I https://chat.supeiji.top/
curl -I https://chat.supeiji.top/sw.js
curl -I https://chat.supeiji.top/api/games
```

Windows 隧道常驻可用计划任务调用 `cloudflared ... run werewolf`。

### 回归

```bash
npm run test:smoke
npm run test:security
npm run check:ai
```

人工：登录、群聊、私聊红包/转账、朋友圈封面、群详情头像墙、音视频通话、通讯录 A–Z、群内 @AI 提醒/生成文件、聊天点头像进资料页、发现页游戏。

---

## 日常运维

```bash
npm run build
schtasks /end /tn "HuduiGroup" ; schtasks /run /tn "HuduiGroup"
# 日志
Get-Content C:\perry\data\app.log -Tail 50
Get-Content C:\perry\data\service.log -Tail 50
```

仅改 `server/` 或 `config/` 时可不 build，重启进程即可。

---

## 常用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | Vite 开发 |
| `npm run build` | 构建到 `client-dist/` |
| `npm start` | 启动后端 |
| `npm run check:ai` | AI 连通性 |
| `npm run test:e2e` | 端到端 |
| `npm run test:smoke` / `test:security` | 回归 / 安全冒烟 |

---

## API 速查（与本次迭代相关）

| 接口 | 说明 |
|------|------|
| `GET /api/games` | 列出已注册小游戏 |
| `GET /games/<id>/` | 静态游戏入口（需 `games/<id>/index.html`） |
| `GET /api/ai-contacts` | AI 人设元数据（`groupOnly: true`，不作通讯录） |
| `POST /api/friends/add` | 加好友；拒绝 AI/persona |

---

## 安全注意事项

- `config/ai.json`、`data/`、`.env` 勿提交公开仓库  
- `games/` 第三方完整仓库/压缩包默认 `.gitignore`，避免仓库膨胀  
- 生产对外仅通过 Tunnel；防火墙勿裸暴露 3000（若机器有公网 IP）  
- 迁移后建议轮换 AI 密钥  
- 钱包/红包/转账均为**演示**，非真实支付  
- AI 生成的提醒与文件保存在本机 `data/`，勿当真实协作存储  

---

## 故障排查

| 现象 | 排查 |
|------|------|
| 线上 502/522 | Node 是否运行；Tunnel 是否指向 3000；旧隧道是否未停 |
| 旧前端 | `npm run build` 后重启；浏览器强刷（SW 已对 `/games/**` 强制走网络） |
| 登录失败 | `data/app.log`；`chat.db` 可写性 |
| AI 不回复 | `npm run check:ai`；密钥与额度 |
| AI 不在通讯录 | **预期行为**：AI 仅群聊；请在群内 @TA |
| Agent 生成文件失败 | 检查 `MIMO_PYTHON`/`python` 与 openpyxl 等依赖；看 `data/app.log` |
| 游戏打不开 | `curl /api/games`；确认 `games/<id>/index.html` 存在且已在 `GAME_APPS` 注册 |
| 私聊红包不能发 | 确认对方有有效 `userId`；「+」面板按钮；余额 |
| 通话无画面 | 双方在线、HTTPS、摄像头权限；网络/STUN |
| 通讯录乱 | 清理测试账号脚本见 `scripts/archive/cleanup-test-users.mjs` |

---

## /prototype/

独立静态原型：https://chat.supeiji.top/prototype/

---

## Git

远程：`https://github.com/SUsuzmx/hudui-group.git`

```bash
git add -A
git commit -m "your message"
git push
```
