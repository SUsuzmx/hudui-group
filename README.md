# WeChat 风格群聊应用（Hudui Group）

微信风格的 Web 即时通讯应用：多群会话、AI 群友、私聊、朋友圈、好友体系、红包/转账/名片/文件/接龙/群收款等消息类型，并按真实微信截图对齐主界面、群聊详情、通话、好友资料等页面 UI。

| 项目 | 说明 |
|------|------|
| **线上地址** | https://chat.supeiji.top/ |
| **GitHub** | https://github.com/SUsuzmx/hudui-group |
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
│       ├── components/      # 主界面/聊天/朋友圈/群详情/通话/服务等页面
│       ├── pinyin-initial.js # 通讯录拼音首字母 A–Z
│       ├── api.js           # HTTP 封装
│       ├── socket-store.js  # 共享 Socket.IO
│       └── ...
├── client-dist/             # 构建产物（npm run build）
├── config/
│   ├── app.json             # 群名、端口、AI 频率
│   ├── ai.json              # AI 模型与密钥（勿提交公开仓库）
│   └── ai.example.json
├── data/                    # 运行时数据（.gitignore）
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
│   └── ...
├── package.json
└── vite.config.js
```

---

## 环境要求

| 项目 | 要求 |
|------|------|
| Node.js | **≥ 20**（`node:sqlite`） |
| 磁盘 | ≥ 1GB |
| 网络 | `dashscope.aliyuncs.com`；可出站 Cloudflare |
| 可选 | `cloudflared`（绑定 https://chat.supeiji.top/） |

---

## 功能总览

### 主界面 UI（对齐微信截图）

- **微信**：标题居中 `微信(n)`；会话行、未读角标、免打扰铃、折叠的聊天、下拉刷新；底栏 SVG 图标
- **通讯录**：功能入口（新的朋友/群聊/标签/公众号/服务号）+ 企业微信 + 星标朋友 + **拼音 A–Z 分组** + 右侧索引可点击跳转；仅展示好友 + AI，不塞全库用户
- **发现**：朋友圈 / 视频号 / 直播 / 听一听 / 游戏 等分组入口
- **我**：大头像资料卡（点进个人信息）+ 服务 / 收藏 / 朋友圈 / 状态 / 小店与卡包 / 表情 / 设置

### 账号与个人中心

- 注册 / 登录（限流）；资料：昵称、头像（预置或**上传**）、微信号、地区、签名、性别
- **个人信息页**：改资料后「完成」写入服务器
- 二维码名片、扫码/搜索加好友
- 状态页（心情/专注等）；PWA 可安装

### 会话与消息

- 预置群：WeChat / 产品设计 / 家庭 / 爬山 / 工作 / 开黑（启动播种，并写入群成员）
- 自定义群：创建、邀请（好友+AI）、退群、改名、群公告
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

### 服务 / 小程序 / 表情

- **服务页**：绿色收付款/钱包头图 + 金融理财/生活服务/交通出行/购物消费
- **小程序**：最近使用 / 我的小程序
- **表情详情**：收藏表情，聊天表情面板可发送

### AI

- 人设 `server/ai/personas.js`；群内插话/欢迎/冷场/媒体生成
- 私聊 AI；多模型故障转移；朋友圈互动
- 无 Key 时可用 canned 台词

---

## 配置

| 文件 | 作用 |
|------|------|
| `config/app.json` | 端口、AI 频率 |
| `config/ai.json` | 模型与密钥（勿公开） |
| `.env.example` | `DASHSCOPE_API_KEY` 模板 |
| `server/ai/personas.js` | AI 人设，改完重启 |
| `server/groups.js` | 群种子与成员播种 |

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
npm run dev   # 开发：前端 5173，代理到 3000
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
```

Windows 隧道常驻可用计划任务调用 `cloudflared ... run werewolf`。

### 回归

```bash
npm run test:smoke
npm run test:security
npm run check:ai
```

人工：登录、群聊、私聊红包/转账、朋友圈封面、群详情头像墙、音视频通话、通讯录 A–Z。

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

## 安全注意事项

- `config/ai.json`、`data/`、`.env` 勿提交公开仓库  
- 生产对外仅通过 Tunnel；防火墙勿裸暴露 3000（若机器有公网 IP）  
- 迁移后建议轮换 AI 密钥  
- 钱包/红包/转账均为**演示**，非真实支付  

---

## 故障排查

| 现象 | 排查 |
|------|------|
| 线上 502/522 | Node 是否运行；Tunnel 是否指向 3000；旧隧道是否未停 |
| 旧前端 | `npm run build` 后重启；浏览器强刷 |
| 登录失败 | `data/app.log`；`chat.db` 可写性 |
| AI 不回复 | `npm run check:ai`；密钥与额度 |
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
