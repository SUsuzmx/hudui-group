// 运营后台核心：独立管理员账号体系、会话、权限、审计、系统设置、用户封禁。
// 与用户端 users/sessions 完全隔离：后台账号存 admin_accounts，后台会话存 admin_sessions。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, stmts, ROOT } from './db.js';

const SESSION_HOURS = 12;

function now() {
  return Date.now();
}

// ---------- 权限模型 ----------
export const PERMISSIONS = {
  'dashboard.view': '查看概览',
  'users.view': '查看用户',
  'users.manage': '管理用户（封禁/解封/改密/授权）',
  'reports.view': '查看举报',
  'reports.manage': '处置举报',
  'feedback.view': '查看反馈',
  'feedback.manage': '回复 / 关闭反馈',
  'errors.view': '查看错误监控',
  'errors.manage': '清理错误记录',
  'flags.view': '查看功能开关',
  'flags.manage': '修改功能开关',
  'audit.view': '查看审计日志',
  'settings.view': '查看系统设置',
  'settings.manage': '修改系统设置',
  'content.view': '查看内容治理',
  'content.manage': '处置内容（删除消息/动态/群组）',
  'admins.view': '查看管理员账号',
  'admins.manage': '管理管理员账号',
};

// 只读角色：可查看业务数据，但不含系统设置与管理员账号（最小权限）
const VIEW_ONLY = [
  'dashboard.view',
  'users.view',
  'reports.view',
  'feedback.view',
  'errors.view',
  'content.view',
  'flags.view',
];

export const ROLES = {
  super: { label: '超级管理员', permissions: Object.keys(PERMISSIONS) },
  operator: {
    label: '运营',
    permissions: [
      'dashboard.view',
      'users.view', 'users.manage',
      'reports.view', 'reports.manage',
      'feedback.view', 'feedback.manage',
      'errors.view', 'errors.manage',
      'flags.view',
      'audit.view',
      'settings.view',
      'content.view', 'content.manage',
      'admins.view',
    ],
  },
  viewer: { label: '只读', permissions: VIEW_ONLY },
};

export function roleLabel(role) {
  return ROLES[role]?.label || role || '未知';
}

/** 解析账号最终权限 = 角色预设 ∪ 额外授权 */
export function permissionsOf(admin) {
  if (!admin) return [];
  if (admin.role === 'super') return Object.keys(PERMISSIONS);
  const base = new Set(ROLES[admin.role]?.permissions || []);
  for (const p of parseJson(admin.permissions, [])) {
    if (p in PERMISSIONS) base.add(p);
  }
  return [...base];
}

export function hasPermission(admin, perm) {
  if (!admin) return false;
  if (admin.role === 'super') return true;
  return permissionsOf(admin).includes(perm);
}

function parseJson(raw, def) {
  try {
    if (raw == null || raw === '') return def;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return def;
  }
}

// ---------- 密码 ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  try {
    const check = crypto.scryptSync(String(password ?? ''), salt, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch {
    return false;
  }
}

export function validatePassword(pwd) {
  const s = String(pwd ?? '');
  if (s.length < 8) return '密码至少 8 位';
  if (s.length > 64) return '密码最多 64 位';
  if (!/[a-zA-Z]/.test(s) || !/[0-9]/.test(s)) return '密码需同时包含字母和数字';
  return null;
}

// ---------- 账号 ----------
export function publicAdmin(a) {
  if (!a) return null;
  return {
    id: a.id,
    username: a.username,
    displayName: a.display_name || a.username,
    role: a.role,
    roleLabel: roleLabel(a.role),
    permissions: permissionsOf(a),
    status: a.status,
    lastLoginAt: a.last_login_at || null,
    lastLoginIp: a.last_login_ip || '',
    createdAt: a.created_at,
  };
}

export function getAdminById(id) {
  return db.prepare('SELECT * FROM admin_accounts WHERE id = ?').get(Number(id)) || null;
}

export function getAdminByUsername(username) {
  return db.prepare('SELECT * FROM admin_accounts WHERE username = ? COLLATE NOCASE')
    .get(String(username || '').trim()) || null;
}

export function listAdmins() {
  return db.prepare('SELECT * FROM admin_accounts ORDER BY id').all().map(publicAdmin);
}

export function countActiveSupers(exceptId = null) {
  const rows = db.prepare(
    "SELECT id FROM admin_accounts WHERE role = 'super' AND status = 'active'"
  ).all();
  return rows.filter((r) => Number(r.id) !== Number(exceptId)).length;
}

export function createAdmin({ username, password, displayName, role, permissions, status = 'active' }) {
  const name = String(username || '').trim();
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(name)) {
    return { error: '用户名需 3-32 位字母、数字、下划线、点或短横线' };
  }
  const pwdErr = validatePassword(password);
  if (pwdErr) return { error: pwdErr };
  if (getAdminByUsername(name)) return { error: '该用户名已存在' };
  const r = ROLES[role] ? role : 'operator';
  const perms = (Array.isArray(permissions) ? permissions : []).filter((p) => p in PERMISSIONS);
  const t = now();
  const res = db.prepare(
    `INSERT INTO admin_accounts
       (username, password_hash, display_name, role, permissions, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    name, hashPassword(password), String(displayName || name).slice(0, 32),
    r, JSON.stringify(perms), status === 'disabled' ? 'disabled' : 'active', t, t
  );
  return { ok: true, admin: publicAdmin(getAdminById(Number(res.lastInsertRowid))) };
}

export function updateAdmin(id, patch = {}) {
  const admin = getAdminById(id);
  if (!admin) return { error: '管理员不存在' };
  const nextRole = ROLES[patch.role] ? patch.role : admin.role;
  const nextStatus = patch.status === 'disabled' || patch.status === 'active' ? patch.status : admin.status;
  // 保护：不能把最后一个可用超管降级或停用
  if (admin.role === 'super' && (nextRole !== 'super' || nextStatus !== 'active')) {
    if (countActiveSupers(admin.id) === 0) {
      return { error: '系统需保留至少一个启用的超级管理员' };
    }
  }
  const perms = Array.isArray(patch.permissions)
    ? patch.permissions.filter((p) => p in PERMISSIONS)
    : parseJson(admin.permissions, []);
  const displayName = patch.displayName !== undefined
    ? String(patch.displayName || admin.username).slice(0, 32)
    : admin.display_name;
  db.prepare(
    `UPDATE admin_accounts
       SET display_name = ?, role = ?, permissions = ?, status = ?, updated_at = ?
     WHERE id = ?`
  ).run(displayName, nextRole, JSON.stringify(perms), nextStatus, now(), admin.id);
  if (nextStatus === 'disabled') revokeAdminSessions(admin.id);
  return { ok: true, admin: publicAdmin(getAdminById(admin.id)) };
}

export function setAdminPassword(id, newPassword) {
  const admin = getAdminById(id);
  if (!admin) return { error: '管理员不存在' };
  const err = validatePassword(newPassword);
  if (err) return { error: err };
  db.prepare('UPDATE admin_accounts SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(hashPassword(newPassword), now(), admin.id);
  revokeAdminSessions(admin.id);
  return { ok: true };
}

export function deleteAdmin(id, operatorId) {
  const admin = getAdminById(id);
  if (!admin) return { error: '管理员不存在' };
  if (Number(id) === Number(operatorId)) return { error: '不能删除当前登录账号' };
  if (admin.role === 'super' && countActiveSupers(admin.id) === 0) {
    return { error: '系统需保留至少一个启用的超级管理员' };
  }
  db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(admin.id);
  db.prepare('DELETE FROM admin_accounts WHERE id = ?').run(admin.id);
  return { ok: true };
}

// ---------- 会话 ----------
export function createAdminSession(adminId, { ip = '', userAgent = '' } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const t = now();
  db.prepare(
    `INSERT INTO admin_sessions (token, admin_id, ip, user_agent, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    token, Number(adminId), String(ip || '').slice(0, 64),
    String(userAgent || '').slice(0, 300), t, t, t + SESSION_HOURS * 3600_000
  );
  return token;
}

export function verifyAdminToken(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM admin_sessions WHERE token = ?').get(String(token));
  if (!row) return null;
  if (Number(row.expires_at) < now()) {
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(String(token));
    return null;
  }
  const admin = getAdminById(row.admin_id);
  if (!admin || admin.status !== 'active') return null;
  // 滑动续期：每次访问把过期时间顺延
  try {
    db.prepare('UPDATE admin_sessions SET last_seen_at = ?, expires_at = ? WHERE token = ?')
      .run(now(), now() + SESSION_HOURS * 3600_000, String(token));
  } catch { /* ignore */ }
  return admin;
}

export function revokeAdminSession(token) {
  db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(String(token || ''));
}

export function revokeAdminSessions(adminId) {
  db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(Number(adminId));
}

export function listAdminSessions(adminId) {
  return db.prepare(
    `SELECT token, ip, user_agent, created_at, last_seen_at, expires_at
     FROM admin_sessions WHERE admin_id = ? AND expires_at > ? ORDER BY last_seen_at DESC`
  ).all(Number(adminId), now()).map((r) => ({
    token: String(r.token).slice(0, 8) + '…',
    ip: r.ip,
    userAgent: r.user_agent,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    expiresAt: r.expires_at,
  }));
}

export function cleanupAdminSessions() {
  try {
    db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(now());
  } catch { /* ignore */ }
}

// ---------- 登录 ----------
export function adminLogin(username, password, { ip = '', userAgent = '' } = {}) {
  const admin = getAdminByUsername(username);
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    return { error: '用户名或密码不正确' };
  }
  if (admin.status !== 'active') return { error: '该账号已被停用' };
  const token = createAdminSession(admin.id, { ip, userAgent });
  db.prepare('UPDATE admin_accounts SET last_login_at = ?, last_login_ip = ? WHERE id = ?')
    .run(now(), String(ip || '').slice(0, 64), admin.id);
  audit({
    adminId: admin.id,
    adminName: admin.username,
    module: 'auth',
    action: 'login',
    detail: `登录成功（${ip || '未知 IP'}）`,
    ip,
  });
  return { ok: true, token, admin: publicAdmin(getAdminById(admin.id)) };
}

export function changeOwnPassword(adminId, oldPassword, newPassword, currentToken) {
  const admin = getAdminById(adminId);
  if (!admin) return { error: '管理员不存在' };
  if (!verifyPassword(oldPassword, admin.password_hash)) return { error: '原密码不正确' };
  const err = validatePassword(newPassword);
  if (err) return { error: err };
  db.prepare('UPDATE admin_accounts SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(hashPassword(newPassword), now(), admin.id);
  // 保留当前会话，踢掉其它
  db.prepare('DELETE FROM admin_sessions WHERE admin_id = ? AND token != ?')
    .run(admin.id, String(currentToken || ''));
  return { ok: true };
}

// ---------- 审计日志 ----------
export function audit({
  adminId = null, adminName = '', module = '', action = '',
  targetType = '', targetId = '', detail = '', ip = '',
} = {}) {
  try {
    db.prepare(
      `INSERT INTO admin_audit_logs
         (admin_id, admin_name, module, action, target_type, target_id, detail, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      adminId ? Number(adminId) : null,
      String(adminName || '').slice(0, 32),
      String(module || '').slice(0, 32),
      String(action || '').slice(0, 64),
      String(targetType || '').slice(0, 32),
      String(targetId || '').slice(0, 64),
      typeof detail === 'string' ? detail.slice(0, 1000) : JSON.stringify(detail || {}).slice(0, 1000),
      String(ip || '').slice(0, 64),
      now()
    );
  } catch { /* ignore */ }
}

export function listAuditLogs({ module = '', adminId = '', q = '', limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (module) { where.push('module = ?'); params.push(String(module)); }
  if (adminId) { where.push('admin_id = ?'); params.push(Number(adminId)); }
  if (q) {
    where.push('(action LIKE ? OR target_id LIKE ? OR detail LIKE ? OR admin_name LIKE ?)');
    const like = `%${String(q)}%`;
    params.push(like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM admin_audit_logs ${clause}`).get(...params)?.n || 0;
  const rows = db.prepare(
    `SELECT * FROM admin_audit_logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, Math.min(Number(limit) || 50, 200), Math.max(Number(offset) || 0, 0));
  return {
    total,
    logs: rows.map((r) => ({
      id: r.id,
      adminId: r.admin_id,
      adminName: r.admin_name,
      module: r.module,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      detail: r.detail,
      ip: r.ip,
      createdAt: r.created_at,
    })),
  };
}

// ---------- 系统设置 ----------
export const DEFAULT_SETTINGS = {
  'site.name': 'WeChat',
  'site.notice': '',
  'site.noticeEnabled': '0',
  'site.maintenance': '0',
  'site.maintenanceMessage': '系统维护中，请稍后再试。',
  'site.registrationOpen': '1',
  'site.registrationNotice': '',
  'site.maxUploadMb': '45',
};

export function getSetting(key, def = '') {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(String(key));
    if (row) return row.value;
  } catch { /* ignore */ }
  return key in DEFAULT_SETTINGS ? DEFAULT_SETTINGS[key] : def;
}

export function getAllSettings() {
  const out = { ...DEFAULT_SETTINGS };
  try {
    for (const r of db.prepare('SELECT key, value, updated_at, updated_by FROM app_settings').all()) {
      out[r.key] = r.value;
    }
  } catch { /* ignore */ }
  return out;
}

export function setSettings(patch = {}, by = '') {
  const stmt = db.prepare(
    `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  );
  const changed = [];
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    // 公告正文放宽到 2000 字，其余设置维持 500
    const limit = k === 'site.notice' ? 2000 : 500;
    const val = String(v ?? '').slice(0, limit);
    stmt.run(k, val, now(), String(by || '').slice(0, 32));
    changed.push({ key: k, value: val });
  }
  return { ok: true, changed, settings: getAllSettings() };
}

export function isMaintenanceMode() {
  return getSetting('site.maintenance') === '1';
}

// ---------- 用户封禁 ----------
export function isUserBanned(userId) {
  try {
    const r = db.prepare('SELECT banned FROM users WHERE id = ?').get(Number(userId));
    return Number(r?.banned || 0) === 1;
  } catch {
    return false;
  }
}

export function banUser(userId, { reason = '', by = '' } = {}) {
  const uid = Number(userId);
  const user = stmts.userById.get(uid);
  if (!user) return { error: '用户不存在' };
  if (isPlatformAdminUser(uid)) return { error: '不能封禁平台管理员账号' };
  db.prepare(
    'UPDATE users SET banned = 1, ban_reason = ?, banned_at = ?, banned_by = ? WHERE id = ?'
  ).run(String(reason || '').slice(0, 200), now(), String(by || '').slice(0, 32), uid);
  // 立即下线该用户所有会话
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
  return { ok: true };
}

export function unbanUser(userId) {
  const uid = Number(userId);
  const user = stmts.userById.get(uid);
  if (!user) return { error: '用户不存在' };
  // 注意：SQLite 中双引号是标识符，字符串必须用单引号
  db.prepare(
    "UPDATE users SET banned = 0, ban_reason = '', banned_at = NULL, banned_by = '' WHERE id = ?"
  ).run(uid);
  return { ok: true };
}

/** 是否为旧的平台管理员（users.settings.isAdmin === true） */
export function isPlatformAdminUser(userId) {
  try {
    const r = stmts.getUserSettingsRaw.get(Number(userId));
    const s = parseJson(r?.settings, {});
    return s.isAdmin === true;
  } catch {
    return false;
  }
}

// ---------- 引导初始化 ----------
const BOOTSTRAP_FILE = path.join(ROOT, 'data', 'admin-bootstrap.txt');

/**
 * 首次启动时建立后台账号：
 * 1) 把用户端已有的平台管理员（users.settings.isAdmin）迁移为后台超管，沿用原密码；
 * 2) 若一个都没有，创建 admin 账号并生成随机密码，写入 data/admin-bootstrap.txt。
 * @returns {{ created: string[], migrated: string[], bootstrapPassword: string|null }}
 */
export function bootstrapAdmins() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM admin_accounts').get()?.n || 0;
  if (existing > 0) return { created: [], migrated: [], bootstrapPassword: null };

  const migrated = [];
  try {
    const rows = db.prepare('SELECT id, nickname, password_hash, settings FROM users').all();
    for (const u of rows) {
      const s = parseJson(u.settings, {});
      if (s.isAdmin !== true) continue;
      const username = String(u.nickname || '').trim();
      if (!username || getAdminByUsername(username)) continue;
      const t = now();
      db.prepare(
        `INSERT INTO admin_accounts
           (username, password_hash, display_name, role, permissions, status, created_at, updated_at)
         VALUES (?, ?, ?, 'super', '[]', 'active', ?, ?)`
      ).run(username, u.password_hash, username, t, t);
      migrated.push(username);
    }
  } catch { /* ignore */ }

  if (migrated.length) {
    return { created: [], migrated, bootstrapPassword: null };
  }

  // 没有任何可迁移的管理员 → 生成初始账号
  const password = `Adm${crypto.randomBytes(6).toString('hex')}9`;
  const res = createAdmin({
    username: 'admin',
    password,
    displayName: '超级管理员',
    role: 'super',
  });
  if (res.error) return { created: [], migrated: [], bootstrapPassword: null };
  try {
    fs.mkdirSync(path.dirname(BOOTSTRAP_FILE), { recursive: true });
    fs.writeFileSync(
      BOOTSTRAP_FILE,
      `运营后台初始账号\n用户名: admin\n密码: ${password}\n`
      + `生成时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}\n`
      + `请登录 http://<host>/admin 后立即修改密码，并删除本文件。\n`
    );
  } catch { /* ignore */ }
  return { created: ['admin'], migrated: [], bootstrapPassword: password };
}
