import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { stmts, ROOT, db } from './db.js';

const SESSION_DAYS = 30;
const AVATAR_COLORS = [
  '#4f6ef7', '#e6433d', '#e6a23c', '#67c23a', '#9a5fe6',
  '#e67e9c', '#17b3a3', '#5a8dee', '#c06a3a', '#7f8fa6',
];
export const IMG_DIR = path.join(ROOT, 'img');
fs.mkdirSync(IMG_DIR, { recursive: true });

// img 文件夹里可用的头像文件 (每次调用都扫, 用户新增图片无需重启)
export function listAvatars() {
  try {
    return fs.readdirSync(IMG_DIR)
      .filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f))
      .map((f) => ({ file: f, url: `/avatars/${encodeURIComponent(f)}` }));
  } catch {
    return [];
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  try {
    const check = crypto.scryptSync(password ?? '', salt, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch {
    return false;
  }
}

// 简易内存限流: key -> timestamps[]
// 阈值与 scripts/e2e-test.mjs、scripts/smoke-security.mjs 对齐
export const LOGIN_RATE = { limit: 10, windowMs: 15 * 60_000 };
export const REGISTER_RATE = { limit: 20, windowMs: 60 * 60_000 };

const rateBuckets = new Map();
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const arr = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    rateBuckets.set(key, arr);
    return true;
  }
  arr.push(now);
  rateBuckets.set(key, arr);
  return false;
}

export function loginRateLimited(ip, nickname) {
  return rateLimited(
    `login:${ip}:${String(nickname || '').toLowerCase()}`,
    LOGIN_RATE.limit,
    LOGIN_RATE.windowMs
  );
}

export function registerRateLimited(ip) {
  return rateLimited(`register:${ip}`, REGISTER_RATE.limit, REGISTER_RATE.windowMs);
}

export function publicUser(u) {
  return {
    id: u.id,
    nickname: u.nickname,
    avatarColor: u.avatar_color ?? u.avatarColor,
    avatar: u.avatar ?? null,
    wxid: u.wxid ?? null,
    region: u.region ?? null,
    signature: u.signature ?? null,
    gender: u.gender ?? '',
    momentsCover: u.moments_cover ?? null,
  };
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  stmts.insertSession.run(token, userId, now, now + SESSION_DAYS * 86400_000);
  return token;
}

function defaultWxid(nickname) {
  const slug = String(nickname || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 12) || 'wx';
  return `wx_${slug}_${Math.random().toString(36).slice(2, 8)}`;
}

export function register(nickname, password, avatar) {
  nickname = (nickname ?? '').trim();
  if (nickname.length < 1 || nickname.length > 16) return { error: '昵称需要 1-16 个字符' };
  if (/\s/.test(nickname)) return { error: '昵称不能包含空格' };
  if (!password || password.length < 6) return { error: '密码至少 6 位' };
  if (password.length > 64) return { error: '密码最多 64 位' };
  if (stmts.userByName.get(nickname)) return { error: '这个昵称已经被占用了' };
  let avatarFile = 'amdin.png';
  if (avatar && typeof avatar === 'string') {
    if (listAvatars().some((a) => a.file === avatar)) avatarFile = avatar;
  }
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const wxid = defaultWxid(nickname);
  const r = stmts.insertUser.run(
    nickname, hashPassword(password), color, Date.now(), avatarFile, wxid, '中国', ''
  );
  const user = stmts.userById.get(Number(r.lastInsertRowid));
  // 新用户: 把已有会话历史记为已读, 避免一上来刷几百条未读
  try {
    const now = Date.now();
    const mid = stmts.maxMessageIdNull.get()?.mid || 0;
    stmts.upsertChatRead.run(user.id, 'default', mid, 0, now);
    for (const g of stmts.allGroups.all()) {
      const conv = `grp_${g.id}`;
      const gid = stmts.maxMessageId.get(conv)?.mid || 0;
      stmts.upsertChatRead.run(user.id, conv, gid, 0, now);
    }
  } catch { /* ignore */ }
  return { token: createSession(user.id), user: publicUser(user), isNew: true };
}

export function login(nickname, password) {
  const user = stmts.userByName.get((nickname ?? '').trim());
  if (!user || !verifyPassword(password ?? '', user.password_hash)) {
    return { error: '昵称或密码不对' };
  }
  return { token: createSession(user.id), user: publicUser(user), isNew: false };
}

export function verifyToken(token) {
  if (!token) return null;
  const row = stmts.sessionByToken.get(token);
  if (!row || row.expires_at < Date.now()) return null;
  return {
    id: row.id,
    nickname: row.nickname,
    avatarColor: row.avatar_color,
    avatar: row.avatar,
    wxid: row.wxid,
    region: row.region,
    signature: row.signature,
  };
}

export function updateProfile(userId, { nickname, avatar, wxid, region, signature, gender, momentsCover }) {
  const user = stmts.userById.get(userId);
  if (!user) return { error: '用户不存在' };

  let nextNickname = user.nickname;
  if (nickname !== undefined && nickname !== null) {
    nextNickname = String(nickname).trim();
    if (nextNickname.length < 1 || nextNickname.length > 16) return { error: '昵称需要 1-16 个字符' };
    if (/\s/.test(nextNickname)) return { error: '昵称不能包含空格' };
    const exist = stmts.userByName.get(nextNickname);
    if (exist && exist.id !== userId) return { error: '这个昵称已经被占用了' };
  }

  let nextAvatar = user.avatar;
  if (avatar !== undefined && avatar !== null) {
    if (avatar === '') {
      nextAvatar = null;
    } else if (listAvatars().some((a) => a.file === avatar)) {
      nextAvatar = avatar;
    } else if (String(avatar).startsWith('/media/')) {
      nextAvatar = String(avatar).slice(0, 200);
    } else {
      return { error: '头像不存在' };
    }
  }

  let nextWxid = user.wxid ?? defaultWxid(user.nickname);
  if (wxid !== undefined && wxid !== null) {
    nextWxid = String(wxid).trim();
    if (nextWxid.length < 3 || nextWxid.length > 20) return { error: '微信号需要 3-20 个字符' };
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(nextWxid)) return { error: '微信号以字母开头, 只能含字母数字下划线短横线' };
  }

  const nextRegion = region !== undefined && region !== null ? String(region).trim().slice(0, 30) : (user.region ?? '');
  const nextSignature = signature !== undefined && signature !== null ? String(signature).trim().slice(0, 60) : (user.signature ?? '');
  const nextGender = gender !== undefined && gender !== null
    ? (['male', 'female', ''].includes(String(gender)) ? String(gender) : user.gender ?? '')
    : (user.gender ?? '');
  const nextCover = momentsCover !== undefined && momentsCover !== null
    ? String(momentsCover).trim().slice(0, 300)
    : (user.moments_cover ?? null);

  stmts.setUserProfile.run(nextNickname, nextAvatar, nextWxid, nextRegion, nextSignature, userId);
  try {
    db.prepare('UPDATE users SET gender = ?, moments_cover = ? WHERE id = ?')
      .run(nextGender || '', nextCover, Number(userId));
  } catch { /* ignore */ }
  const updated = stmts.userById.get(userId);
  return { user: publicUser(updated) };
}

export function publicProfile(u) {
  return {
    id: u.id,
    nickname: u.nickname,
    avatarColor: u.avatar_color ?? u.avatarColor,
    avatar: u.avatar ?? null,
    wxid: u.wxid ?? null,
    region: u.region ?? null,
    signature: u.signature ?? null,
    gender: u.gender ?? '',
    momentsCover: u.moments_cover ?? null,
  };
}
