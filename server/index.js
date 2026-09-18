// 应用入口: Express(HTTP API + 静态托管) + Socket.IO(实时聊天) + AI 引擎调度。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import { ROOT, stmts, db } from './db.js';
import { register, login, verifyToken, publicUser, listAvatars, updateProfile, IMG_DIR, loginRateLimited, registerRateLimited } from './auth.js';
import { initChat } from './chat.js';
import { createEngine } from './ai/engine.js';
import { isAiEnabled } from './ai/provider.js';
import { aiAvatarFile } from './ai/avatars.js';
import { personas } from './ai/personas.js';
import { createFriendsRouter } from './friends.js';
import { createMomentsRouter } from './moments.js';
import { createMetaRouter } from './meta.js';
import { seedGroups, listGroups, getGroup, groupConvId, DEFAULT_GROUP_KIND, setGroupNotice, createGroup } from './groups.js';
import { canAccessConversation } from './acl.js';
import { mediaFromBodyJson, mediaFromMultipart, mediaFromRaw, normalizeKind } from './upload.js';
import { getBalance, listTx, debit } from './wallet.js';

const LOG_FILE = path.join(ROOT, 'data', 'app.log');
let logQueue = [];
let logFlushing = false;
function flushLog() {
  if (logFlushing || !logQueue.length) return;
  logFlushing = true;
  const chunk = logQueue.join('');
  logQueue = [];
  fs.promises.appendFile(LOG_FILE, chunk)
    .catch(() => {})
    .finally(() => {
      logFlushing = false;
      if (logQueue.length) flushLog();
    });
}
export function log(msg) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${msg}`;
  console.log(line);
  logQueue.push(line + '\n');
  flushLog();
}

const defaults = { groupName: 'WeChat', port: 3000, ai: {} };
let config = defaults;
try {
  config = { ...defaults, ...JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'app.json'), 'utf8')) };
} catch {
  log('config/app.json 缺失或损坏, 使用默认配置');
}
const listenPort = Number(process.env.PORT) || config.port;

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  next();
});
app.use(express.json({ limit: '8mb' }));

function requireUser(req, res) {
  const user = verifyToken(req.get('Authorization')?.replace(/^Bearer /, ''));
  if (!user) {
    res.status(401).json({ error: '未登录' });
    return null;
  }
  return user;
}

// 聊天媒体上传: 优先 multipart / 原始二进制, 兼容旧 base64 JSON
app.post('/api/chat/upload', express.raw({ type: () => true, limit: '9mb' }), (req, res) => {
  if (!requireUser(req, res)) return;
  const ct = String(req.get('Content-Type') || '');
  const kind = normalizeKind(req.query.kind || req.get('x-media-kind') || 'image');
  let result;
  if (ct.includes('application/json')) {
    let body = req.body;
    if (Buffer.isBuffer(body)) {
      try { body = JSON.parse(body.toString('utf8')); } catch { body = {}; }
    }
    result = mediaFromBodyJson({ ...body, kind: body?.kind || kind });
  } else if (ct.includes('multipart/form-data')) {
    result = mediaFromMultipart(req.body, ct, kind);
  } else if (Buffer.isBuffer(req.body) && req.body.length) {
    result = mediaFromRaw(req.body, ct, kind, req.get('x-filename') || '');
  } else {
    result = { error: '不支持的上传格式' };
  }
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// 朋友圈配图上传
app.post('/api/moments/upload', express.raw({ type: () => true, limit: '3mb' }), (req, res) => {
  if (!requireUser(req, res)) return;
  const ct = String(req.get('Content-Type') || '');
  let result;
  if (ct.includes('application/json')) {
    let body = req.body;
    if (Buffer.isBuffer(body)) {
      try { body = JSON.parse(body.toString('utf8')); } catch { body = {}; }
    }
    const b64 = String(body?.data || '');
    const m = b64.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i);
    if (!m) return res.status(400).json({ error: '图片格式不支持' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length < 10 || buf.length > 2 * 1024 * 1024) {
      return res.status(400).json({ error: '图片大小不合适' });
    }
    result = mediaFromRaw(buf, `image/${m[1].toLowerCase().replace('jpeg', 'jpg')}`, 'image', '');
  } else if (ct.includes('multipart/form-data')) {
    result = mediaFromMultipart(req.body, ct, 'image');
  } else if (Buffer.isBuffer(req.body) && req.body.length) {
    result = mediaFromRaw(req.body, ct, 'image', req.get('x-filename') || '');
  } else {
    result = { error: '不支持的上传格式' };
  }
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ url: result.url });
});

// 头像与媒体
app.use('/avatars', express.static(IMG_DIR, { maxAge: '1h' }));
app.use('/media', express.static(path.join(ROOT, 'data', 'media'), { maxAge: '7d' }));

app.get('/api/avatars', (req, res) => res.json({ avatars: listAvatars() }));

// AI 联系人列表 (通讯录展示用)
app.get('/api/ai-contacts', (req, res) => {
  if (!requireUser(req, res)) return;
  const contacts = personas.map((p) => ({
    id: p.id,
    key: `ai-${p.id}`,
    nickname: p.name,
    emoji: p.emoji,
    avatar: aiAvatarFile(p.name),
    isAI: true,
    personaId: p.id,
  }));
  res.json({ contacts });
});

// 演示钱包
app.get('/api/wallet', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({ balance: getBalance(user.id), txs: listTx(user.id), demo: true });
});

// 演示支付: 手机充值 / 生活缴费等, 扣零钱记流水
app.post('/api/wallet/pay', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const amount = Math.round((Number(req.body?.amount) || 0) * 100) / 100;
  const note = String(req.body?.note || '消费').slice(0, 30);
  if (!(amount >= 0.01) || amount > 100000) return res.status(400).json({ error: '金额不合法' });
  const r = debit(user.id, amount, { type: 'pay', note });
  if (!r.ok) return res.status(400).json({ error: r.error, balance: r.balance });
  log(`演示支付: ${user.nickname} -¥${amount.toFixed(2)} (${note})`);
  res.json({ ok: true, balance: r.balance });
});

// 二维码/扫码解析用户
app.get('/api/users/resolve', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const code = String(req.query.code ?? req.query.q ?? '').trim();
  if (!code || code.length > 80) return res.status(400).json({ error: '二维码内容无效' });
  // 支持 hudui:U:{id}:{wxid} / 纯数字 id / wxid / 昵称
  let userId = null;
  let wxid = null;
  const m = code.match(/hudui:U:(\d+)(?::([^:]+))?/i) || code.match(/^U(\d+)$/i);
  if (m) {
    userId = Number(m[1]);
    wxid = m[2] ? decodeURIComponent(m[2]) : null;
  } else if (/^\d+$/.test(code)) {
    userId = Number(code);
  } else if (/^[a-zA-Z][a-zA-Z0-9_-]{2,19}$/.test(code)) {
    wxid = code;
  }
  let target = null;
  if (userId) target = stmts.userById.get(userId);
  if (!target && wxid) {
    try {
      target = db.prepare('SELECT * FROM users WHERE wxid = ?').get(wxid);
    } catch { target = null; }
  }
  if (!target && code) {
    target = stmts.userByName.get(code);
  }
  if (!target) return res.status(404).json({ error: '未找到对应用户' });
  if (target.id === user.id) return res.status(400).json({ error: '不能添加自己' });
  const fr = stmts.getFriend.get(user.id, target.id);
  res.json({
    user: {
      ...publicUser(target),
      avatarColor: target.avatar_color,
      isFriend: Boolean(fr),
    },
  });
});

// 聊天记录搜索 (仅本人可见范围: 群 + 本人私聊)
app.get('/api/chat/search', (req, res) => {
  const user = verifyToken(req.get('Authorization')?.replace(/^Bearer /, ''));
  if (!user) return res.status(401).json({ error: '未登录' });
  const q = String(req.query.q ?? '').trim();
  const conv = String(req.query.conversationId ?? '').trim();
  if (!q || q.length > 40) return res.json({ messages: [] });
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  let rows = [];
  try {
    if (conv) {
      if (!canAccessConversation(user.id, conv, getGroup)) {
        return res.status(403).json({ error: '无权搜索该会话' });
      }
      rows = stmts.searchMessagesConv.all(user.id, conv, like);
    } else {
      const uid = String(user.id);
      rows = stmts.searchMessagesScoped.all(
        user.id,
        like,
        `pv\\_${uid}\\_%`,
        `pv\\_u\\_${uid}\\_%`,
        `pv\\_u\\_%\\_${uid}`
      );
    }
  } catch {
    rows = [];
  }
  res.json({
    messages: rows.map((r) => ({
      id: r.id,
      senderName: r.sender_name,
      senderType: r.sender_type,
      content: r.content,
      createdAt: r.created_at,
      conversationId: r.conversation_id,
      mediaType: r.media_type ?? null,
    })),
  });
});

app.post('/api/register', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (registerRateLimited(ip)) return res.status(429).json({ error: '注册太频繁, 请稍后再试' });
  const r = register(req.body?.nickname, req.body?.password, req.body?.avatar);
  if (r.error) return res.status(400).json({ error: r.error });
  log(`新用户注册: ${r.user.nickname}`);
  res.json({ token: r.token, user: r.user, isNew: true });
});

app.post('/api/login', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (loginRateLimited(ip, req.body?.nickname)) {
    return res.status(429).json({ error: '尝试次数过多, 请稍后再试' });
  }
  const r = login(req.body?.nickname, req.body?.password);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ token: r.token, user: r.user, isNew: false });
});

app.get('/api/me', (req, res) => {
  const user = verifyToken(req.get('Authorization')?.replace(/^Bearer /, ''));
  if (!user) return res.status(401).json({ error: '未登录' });
  res.json({ user: publicUser({ ...user, avatar_color: user.avatarColor }) });
});

app.put('/api/me', (req, res) => {
  const user = verifyToken(req.get('Authorization')?.replace(/^Bearer /, ''));
  if (!user) return res.status(401).json({ error: '未登录' });
  const r = updateProfile(user.id, req.body ?? {});
  if (r.error) return res.status(400).json({ error: r.error });
  log(`用户更新资料: ${r.user.nickname}`);
  res.json({ user: r.user });
});

app.get('/api/users/:id', (req, res) => {
  const user = verifyToken(req.get('Authorization')?.replace(/^Bearer /, ''));
  if (!user) return res.status(401).json({ error: '未登录' });
  const target = stmts.userById.get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: '用户不存在' });
  const fr = stmts.getFriend.get(user.id, target.id);
  res.json({
    user: {
      id: target.id,
      nickname: target.nickname,
      avatarColor: target.avatar_color,
      avatar: target.avatar,
      wxid: target.wxid,
      region: target.region,
      signature: target.signature,
      isFriend: Boolean(fr),
      remark: fr?.remark || null,
      blacklisted: Boolean(fr?.blacklisted),
      permission: fr?.permission || null,
    },
  });
});

// 好友 + 会话元数据
let ioRef = null;
const metaApi = createMetaRouter({
  verifyToken,
  notify: (userId, payload) => {
    ioRef?.to(`user_${userId}`).emit('chat:sync', payload);
  },
});
const friendsApi = createFriendsRouter({ verifyToken });
app.get('/api/friends', friendsApi.requireAuth, friendsApi.list);
app.post('/api/friends', friendsApi.requireAuth, friendsApi.add);
app.delete('/api/friends/:friendId', friendsApi.requireAuth, friendsApi.remove);
app.get('/api/friends/search', friendsApi.requireAuth, friendsApi.search);
app.post('/api/friends/remark', friendsApi.requireAuth, friendsApi.setRemark);
app.post('/api/friends/blacklist', friendsApi.requireAuth, friendsApi.setBlacklist);
app.post('/api/friends/permission', friendsApi.requireAuth, friendsApi.setPermission);
app.post('/api/chat/private-read', friendsApi.requireAuth, friendsApi.privateRead);
app.get('/api/chat/private-peer-read', friendsApi.requireAuth, friendsApi.privatePeerRead);
app.post('/api/chat/group-read', friendsApi.requireAuth, friendsApi.groupRead);
app.get('/api/chat/group-peer-read', friendsApi.requireAuth, friendsApi.groupPeerRead);
app.post('/api/friends/request', metaApi.requireAuth, metaApi.sendFriendRequest);
app.get('/api/friends/requests', metaApi.requireAuth, metaApi.friendRequests);
app.post('/api/friends/request/handle', metaApi.requireAuth, metaApi.handleFriendRequest);

// 会话偏好/未读/清空
app.get('/api/chats', metaApi.requireAuth, metaApi.chats);
app.get('/api/chat/pref', metaApi.requireAuth, metaApi.getPref);
app.post('/api/chat/pref', metaApi.requireAuth, metaApi.upsertPref);
app.post('/api/chat/read', metaApi.requireAuth, metaApi.markRead);
app.post('/api/chat/clear', metaApi.requireAuth, metaApi.clearHistory);

// 标签
app.get('/api/tags', metaApi.requireAuth, metaApi.tags);
app.post('/api/tags', metaApi.requireAuth, metaApi.createTag);
app.post('/api/tags/delete', metaApi.requireAuth, metaApi.deleteTag);
app.post('/api/tags/members', metaApi.requireAuth, metaApi.setTagMembers);

// 收藏
app.get('/api/favorites', metaApi.requireAuth, metaApi.favorites);
app.post('/api/favorites', metaApi.requireAuth, metaApi.addFavorite);
app.post('/api/favorites/delete', metaApi.requireAuth, metaApi.removeFavorite);

// 公众号
app.get('/api/official', metaApi.requireAuth, metaApi.official);
app.post('/api/official/follow', metaApi.requireAuth, metaApi.followOfficial);
app.post('/api/official/unfollow', metaApi.requireAuth, metaApi.unfollowOfficial);

// 朋友圈
const momentsApi = createMomentsRouter({
  verifyToken,
  notify: (payload) => {
    ioRef?.emit('moments:update', payload);
  },
});
app.get('/api/moments', momentsApi.requireAuth, momentsApi.list);
app.get('/api/moments/mine', momentsApi.requireAuth, momentsApi.mine);
app.post('/api/moments', momentsApi.requireAuth, momentsApi.create);
app.delete('/api/moments/:id', momentsApi.requireAuth, momentsApi.remove);
app.post('/api/moments/like', momentsApi.requireAuth, momentsApi.like);
app.post('/api/moments/unlike', momentsApi.requireAuth, momentsApi.unlike);
app.post('/api/moments/comment', momentsApi.requireAuth, momentsApi.comment);
app.post('/api/moments/comment/delete', momentsApi.requireAuth, momentsApi.deleteComment);

// 创建群聊
app.post('/api/groups', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const name = String(req.body?.name || '').trim();
  const memberIds = Array.isArray(req.body?.memberIds) ? req.body.memberIds.slice(0, 50) : [];
  const aiMembers = Array.isArray(req.body?.aiMembers)
    ? req.body.aiMembers.map((n) => String(n || '').trim()).filter(Boolean).slice(0, 20)
    : [];
  const members = [user.nickname];
  for (const id of memberIds) {
    const t = stmts.userById.get(Number(id));
    if (t && !members.includes(t.nickname)) members.push(t.nickname);
  }
  for (const n of aiMembers) {
    if (!members.includes(n)) members.push(n);
  }
  if (members.length < 3) return res.status(400).json({ error: '至少再选择 2 位成员（好友或 AI 均可）' });
  const g = createGroup({ name: name || members.slice(0, 3).join('、') + '的群聊', memberNames: members });
  log(`创建群聊: ${g.name} (创建者 ${user.nickname}, 共 ${members.length} 人)`);
  try {
    chatApi?.addSystemMessage?.(
      `${user.nickname} 邀请 ${members.slice(1, 4).join('、')}${members.length > 4 ? '等' : ''} 加入群聊`,
      g.conversationId
    );
  } catch { /* ignore */ }
  res.json({ group: g });
});

app.get('/api/groups/:id', (req, res) => {
  const user = verifyToken(req.get('Authorization')?.replace(/^Bearer /, ''));
  if (!user) return res.status(401).json({ error: '未登录' });
  const g = getGroup(req.params.id);
  if (!g) return res.status(404).json({ error: '群不存在' });
  res.json({ group: g });
});

// 群公告 (在 chatApi 就绪后由下方补挂广播)
app.post('/api/groups/:id/notice', (req, res) => {
  const user = verifyToken(req.get('Authorization')?.replace(/^Bearer /, ''));
  if (!user) return res.status(401).json({ error: '未登录' });
  const g = getGroup(req.params.id);
  if (!g) return res.status(404).json({ error: '群不存在' });
  const notice = setGroupNotice(g.id, req.body?.notice);
  try {
    if (notice) {
      chatApi?.addSystemMessage?.(`「${user.nickname}」更新了群公告\n${notice}`, g.conversationId);
    }
  } catch { /* ignore */ }
  res.json({ ok: true, group: getGroup(g.id) });
});

app.post('/api/search/global', (req, res) => {
  const user = verifyToken(req.get('Authorization')?.replace(/^Bearer /, ''));
  if (!user) return res.status(401).json({ error: '未登录' });
  const q = String(req.body?.q ?? '').trim().slice(0, 40);
  if (!q) return res.json({ contacts: [], groups: [], messages: [] });
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  // 好友
  const friends = stmts.listFriends.all(user.id)
    .filter((f) => String(f.nickname || '').includes(q) || String(f.remark || '').includes(q) || String(f.wxid || '').includes(q))
    .slice(0, 20)
    .map((f) => ({
      id: f.id,
      nickname: f.nickname,
      avatar: f.avatar,
      avatarColor: f.avatar_color,
      wxid: f.wxid,
      remark: f.remark,
      isAI: false,
      isFriend: true,
    }));
  // AI 联系人
  const aiContacts = personas
    .filter((p) => String(p.name).includes(q) || String(p.id).includes(q.toLowerCase()))
    .map((p) => ({
      id: p.id,
      nickname: p.name,
      emoji: p.emoji,
      avatar: aiAvatarFile(p.name),
      isAI: true,
      personaId: p.id,
      isFriend: false,
    }));
  // 群
  const groups = listGroups()
    .filter((g) => String(g.name || '').includes(q) || String(g.kind || '').includes(q))
    .map((g) => ({
      id: g.id,
      name: g.name,
      conversationId: g.conversationId,
      kind: g.kind,
      isDefault: g.isDefault,
      avatars: g.avatars,
      lastMessage: g.lastMessage,
    }));
  // 聊天记录
  let messages = [];
  try {
    const uid = String(user.id);
    messages = stmts.searchMessagesScoped.all(
      user.id,
      like,
      `pv\\_${uid}\\_%`,
      `pv\\_u\\_${uid}\\_%`,
      `pv\\_u\\_%\\_${uid}`
    ).map((r) => ({
      id: r.id,
      senderName: r.sender_name,
      senderType: r.sender_type,
      content: r.content,
      createdAt: r.created_at,
      conversationId: r.conversation_id,
      mediaType: r.media_type ?? null,
    }));
  } catch {
    messages = [];
  }
  res.json({ contacts: [...aiContacts, ...friends], groups, messages });
});

// 设计原型: /prototype/ (与主应用并存, 不互相覆盖)
const PROTOTYPE = path.join(ROOT, 'prototype');
if (fs.existsSync(path.join(PROTOTYPE, 'index.html'))) {
  app.use('/prototype', express.static(PROTOTYPE, { maxAge: '1h' }));
}

const DIST = path.join(ROOT, 'client-dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    },
  }));
  app.get(/^\/(?!api\/|avatars|media|prototype).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(path.join(DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.send('前端未构建, 请先运行 npm run build'));
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true }, maxHttpBufferSize: 1e6 });
ioRef = io;

// 播种群聊数据
try {
  const groups = seedGroups();
  log(`群聊数据就绪: ${groups.map((g) => `${g.name}(${g.kind})`).join(', ')}`);
} catch (e) {
  log(`群聊播种失败: ${e.message}`);
}

let chatApi;
const engine = createEngine({
  config,
  deps: {
    sendAI: (persona, content, mediaType, mediaUrl, convId) => chatApi.addAIMessage(persona, content, mediaType, mediaUrl, convId),
    getRecentContext: (n) => chatApi.getRecentContext(n),
    getConvContext: (convId, n) => chatApi.getConvContext(convId, n),
    sendPrivateAI: (convId, persona, content, mediaType, mediaUrl) => chatApi.addPrivateAIMessage(convId, persona, content, mediaType, mediaUrl),
    getPrivateContext: (convId, n) => chatApi.getPrivateContext(convId, n),
  },
});
chatApi = initChat(io, { config, engine });

setInterval(() => engine.tick(), 30_000).unref();

process.on('uncaughtException', (err) => {
  log(`未捕获异常: ${err.stack || err}`);
  // 脏状态交给守护脚本重启
  setTimeout(() => process.exit(1), 200);
});
process.on('unhandledRejection', (err) => log(`未处理的 Promise 拒绝: ${err}`));

server.listen(listenPort, '0.0.0.0', () => {
  const users = stmts.allUsers.all().length;
  log(`「${config.groupName}」启动完成: http://localhost:${listenPort} (用户 ${users} 人, 头像 ${listAvatars().length} 张)`);
});
