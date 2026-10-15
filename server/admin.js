// 运营后台 API：/api/admin/*
// 独立管理员账号体系（admin_accounts），与用户端登录态完全隔离。
// 所有写操作经 audit() 留痕。
import crypto from 'node:crypto';
import express from 'express';
import { db, stmts } from './db.js';
import { getFlags, setFlags, DEFAULT_FLAGS } from './feature-flags.js';
import {
  PERMISSIONS, ROLES, roleLabel,
  publicAdmin, getAdminById, listAdmins, createAdmin, updateAdmin, setAdminPassword,
  deleteAdmin, adminLogin, verifyAdminToken, revokeAdminSession, revokeAdminSessions,
  listAdminSessions, changeOwnPassword, hasPermission, permissionsOf,
  audit, listAuditLogs,
  getAllSettings, setSettings, DEFAULT_SETTINGS,
  banUser, unbanUser, isPlatformAdminUser,
} from './admin-store.js';
import {
  deviceOfUser, identityOfUser, usersOfDevice, banDevice, banSig, unbanDevice, listBannedDevices, isBannedRequest,
} from './device-ban.js';

function now() {
  return Date.now();
}

function parseJson(raw, def) {
  try {
    if (raw == null || raw === '') return def;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return def;
  }
}

function clientIp(req) {
  const fwd = String(req.get('x-forwarded-for') || '').split(',')[0].trim();
  return fwd || req.ip || req.socket?.remoteAddress || '';
}

function dayKey(ts) {
  const d = new Date(Number(ts));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 生成最近 n 天的日期桶（含今天），用于趋势图 */
function dayBuckets(days) {
  const out = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86400_000);
    out.push({ date: dayKey(d.getTime()), ts: d.getTime(), count: 0 });
  }
  return out;
}

function bucketize(rows, days) {
  const buckets = dayBuckets(days);
  const index = new Map(buckets.map((b, i) => [b.date, i]));
  for (const r of rows) {
    const k = dayKey(r.created_at ?? r.t);
    const i = index.get(k);
    if (i !== undefined) buckets[i].count += 1;
  }
  return buckets.map((b) => ({ date: b.date, count: b.count }));
}

function like(q) {
  return `%${String(q || '').replace(/[%_]/g, (m) => `\\${m}`)}%`;
}

// ---------- 鉴权中间件 ----------
function adminFromRequest(req, res) {
  if (req.admin) return req.admin;
  const token = req.get('Authorization')?.replace(/^Bearer /, '') || '';
  const admin = verifyAdminToken(token);
  if (!admin) {
    res.status(401).json({ error: '后台登录已失效，请重新登录', reason: 'admin_unauthorized' });
    return null;
  }
  req.admin = admin;
  req.adminToken = token;
  return admin;
}

function requirePerm(perm) {
  return (req, res, next) => {
    const admin = adminFromRequest(req, res);
    if (!admin) return;
    if (!hasPermission(admin, perm)) {
      res.status(403).json({ error: `缺少权限：${PERMISSIONS[perm] || perm}` });
      return;
    }
    next();
  };
}

/** 写操作统一包装：执行 fn，成功/失败都记审计 */
function write(module, action, perm, handler) {
  return [
    requirePerm(perm),
    async (req, res) => {
      const admin = req.admin;
      const ip = clientIp(req);
      try {
        const out = await handler(req, res);
        if (out === undefined || res.headersSent) return;
        if (out && out.error) {
          res.status(400).json(out);
          return;
        }
        if (out && out.notFound) {
          res.status(404).json({ error: out.notFound });
          return;
        }
        res.json(out);
      } catch (e) {
        audit({
          adminId: admin.id, adminName: admin.username, module, action,
          detail: `失败: ${e.message}`, ip,
        });
        res.status(500).json({ error: e.message || '操作失败' });
      }
    },
  ];
}

function logWrite(req, module, action, { targetType = '', targetId = '', detail = '' } = {}) {
  audit({
    adminId: req.admin?.id,
    adminName: req.admin?.username || '',
    module,
    action,
    targetType,
    targetId,
    detail,
    ip: clientIp(req),
  });
}

// ---------- 登录限流 ----------
const loginBuckets = new Map();
function loginLimited(key, limit = 8, windowMs = 10 * 60_000) {
  const t = now();
  const arr = (loginBuckets.get(key) || []).filter((x) => t - x < windowMs);
  if (arr.length >= limit) {
    loginBuckets.set(key, arr);
    return true;
  }
  arr.push(t);
  loginBuckets.set(key, arr);
  return false;
}

export function createAdminRouter() {
  const router = express.Router();

  // ============ 元信息 ============
  router.get('/meta', requirePerm('dashboard.view'), (req, res) => {
    res.json({
      permissions: Object.entries(PERMISSIONS).map(([key, label]) => ({ key, label })),
      roles: Object.entries(ROLES).map(([key, v]) => ({ key, label: v.label, permissions: v.permissions })),
      modules: MODULES,
      me: publicAdmin(req.admin),
    });
  });

  // ============ 登录 / 会话 ============
  router.post('/auth/login', (req, res) => {
    const ip = clientIp(req);
    const username = String(req.body?.username || '').trim();
    if (loginLimited(`${ip}:${username.toLowerCase()}`)) {
      return res.status(429).json({ error: '尝试次数过多，请 10 分钟后再试' });
    }
    const r = adminLogin(username, req.body?.password, { ip, userAgent: req.get('user-agent') || '' });
    if (r.error) return res.status(401).json({ error: r.error });
    res.json({ ...r, permissions: permissionsOf(getAdminById(r.admin.id)) });
  });

  router.post('/auth/logout', (req, res) => {
    const token = req.get('Authorization')?.replace(/^Bearer /, '') || '';
    const admin = verifyAdminToken(token);
    if (admin) {
      audit({
        adminId: admin.id, adminName: admin.username,
        module: 'auth', action: 'logout', ip: clientIp(req),
      });
    }
    revokeAdminSession(token);
    res.json({ ok: true });
  });

  router.get('/auth/me', (req, res) => {
    const admin = adminFromRequest(req, res);
    if (!admin) return;
    res.json({ admin: publicAdmin(admin), permissions: permissionsOf(admin) });
  });

  router.post('/auth/password', requirePerm('dashboard.view'), (req, res) => {
    const r = changeOwnPassword(
      req.admin.id, req.body?.oldPassword, req.body?.newPassword, req.adminToken
    );
    if (r.error) return res.status(400).json({ error: r.error });
    logWrite(req, 'auth', 'change-password', { detail: '修改本人密码' });
    res.json(r);
  });

  router.get('/auth/sessions', requirePerm('dashboard.view'), (req, res) => {
    res.json({ sessions: listAdminSessions(req.admin.id) });
  });

  // ============ 概览仪表盘 ============
  router.get('/dashboard', requirePerm('dashboard.view'), (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 14, 7), 30);
    const since = now() - days * 86400_000;
    const one = (sql, ...p) => db.prepare(sql).get(...p)?.n || 0;

    const totals = {
      users: one('SELECT COUNT(*) AS n FROM users'),
      bannedUsers: one('SELECT COUNT(*) AS n FROM users WHERE banned = 1'),
      groups: one('SELECT COUNT(*) AS n FROM groups'),
      messages: one('SELECT COUNT(*) AS n FROM messages'),
      moments: one('SELECT COUNT(*) AS n FROM moments'),
      friends: one('SELECT COUNT(*) AS n FROM friends'),
      adminAccounts: one('SELECT COUNT(*) AS n FROM admin_accounts'),
    };

    const todos = {
      pendingReports: one("SELECT COUNT(*) AS n FROM reports WHERE status = 'pending'"),
      processingReports: one("SELECT COUNT(*) AS n FROM reports WHERE status = 'processing'"),
      openFeedback: one("SELECT COUNT(*) AS n FROM feedback WHERE status = 'open'"),
      errors24h: one('SELECT COUNT(*) AS n FROM error_logs WHERE created_at > ?', now() - 86400_000),
      anomalies24h: one('SELECT COUNT(*) AS n FROM login_history WHERE created_at > ? AND anomaly = 1', now() - 86400_000),
    };

    const today = dayBuckets(1)[0].ts;
    const realtime = {
      newUsersToday: one('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', today),
      messagesToday: one('SELECT COUNT(*) AS n FROM messages WHERE created_at >= ?', today),
      momentsToday: one('SELECT COUNT(*) AS n FROM moments WHERE created_at >= ?', today),
      loginsToday: one('SELECT COUNT(*) AS n FROM login_history WHERE created_at >= ?', today),
      activeUsers7d: db.prepare(
        'SELECT COUNT(DISTINCT user_id) AS n FROM login_history WHERE created_at > ?'
      ).get(now() - 7 * 86400_000)?.n || 0,
      reportsToday: one('SELECT COUNT(*) AS n FROM reports WHERE created_at >= ?', today),
      feedbackToday: one('SELECT COUNT(*) AS n FROM feedback WHERE created_at >= ?', today),
    };

    const trends = {
      days,
      users: bucketize(db.prepare('SELECT created_at FROM users WHERE created_at > ?').all(since), days),
      messages: bucketize(db.prepare('SELECT created_at FROM messages WHERE created_at > ?').all(since), days),
      moments: bucketize(db.prepare('SELECT created_at FROM moments WHERE created_at > ?').all(since), days),
      reports: bucketize(db.prepare('SELECT created_at FROM reports WHERE created_at > ?').all(since), days),
      feedback: bucketize(db.prepare('SELECT created_at FROM feedback WHERE created_at > ?').all(since), days),
      errors: bucketize(db.prepare('SELECT created_at FROM error_logs WHERE created_at > ?').all(since), days),
      logins: bucketize(db.prepare('SELECT created_at FROM login_history WHERE created_at > ?').all(since), days),
    };

    const reportByCategory = db.prepare(
      'SELECT category, COUNT(*) AS n FROM reports GROUP BY category ORDER BY n DESC'
    ).all().map((r) => ({ category: r.category, count: r.n }));

    const feedbackByCategory = db.prepare(
      'SELECT category, COUNT(*) AS n FROM feedback GROUP BY category ORDER BY n DESC'
    ).all().map((r) => ({ category: r.category, count: r.n }));

    const topErrorFeatures = db.prepare(
      `SELECT feature, COUNT(*) AS n FROM error_logs WHERE created_at > ?
       GROUP BY feature ORDER BY n DESC LIMIT 8`
    ).all(now() - 7 * 86400_000).map((r) => ({ feature: r.feature || '(未标注)', count: r.n }));

    const recentUsers = db.prepare(
      'SELECT id, nickname, avatar, created_at FROM users ORDER BY id DESC LIMIT 8'
    ).all().map((u) => ({ id: u.id, nickname: u.nickname, avatar: u.avatar, createdAt: u.created_at }));

    const recentAudit = listAuditLogs({ limit: 8 }).logs;

    res.json({
      totals, todos, realtime, trends,
      reportByCategory, feedbackByCategory, topErrorFeatures, recentUsers, recentAudit,
      flags: getFlags(),
      settings: {
        maintenance: getAllSettings()['site.maintenance'] === '1',
        noticeEnabled: getAllSettings()['site.noticeEnabled'] === '1',
      },
    });
  });

  // ============ 用户管理 ============
  router.get('/users', requirePerm('users.view'), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '');
    const where = [];
    const params = [];
    if (q) {
      where.push('(u.nickname LIKE ? ESCAPE \'\\\' OR u.wxid LIKE ? ESCAPE \'\\\' OR CAST(u.id AS TEXT) = ?)');
      params.push(like(q), like(q), q);
    }
    if (status === 'banned') where.push('u.banned = 1');
    else if (status === 'active') where.push('COALESCE(u.banned,0) = 0');
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM users u ${clause}`).get(...params)?.n || 0;
    const rows = db.prepare(
      `SELECT u.id, u.nickname, u.avatar, u.avatar_color, u.wxid, u.region, u.gender,
              u.created_at, u.banned, u.ban_reason, u.settings,
              (SELECT COUNT(*) FROM friends f WHERE f.user_id = u.id) AS friend_count,
              (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id AND m.sender_type='user') AS msg_count,
              (SELECT COUNT(*) FROM moments mo WHERE mo.user_id = u.id) AS moment_count
       FROM users u ${clause}
       ORDER BY u.id DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({
      total, limit, offset,
      users: rows.map((u) => ({
        id: u.id,
        nickname: u.nickname,
        avatar: u.avatar,
        avatarColor: u.avatar_color,
        wxid: u.wxid,
        region: u.region,
        gender: u.gender || '',
        createdAt: u.created_at,
        banned: Number(u.banned || 0) === 1,
        banReason: u.ban_reason || '',
        isPlatformAdmin: parseJson(u.settings, {}).isAdmin === true,
        friendCount: u.friend_count,
        messageCount: u.msg_count,
        momentCount: u.moment_count,
      })),
    });
  });

  router.get('/users/:id', requirePerm('users.view'), (req, res) => {
    const uid = Number(req.params.id);
    const u = stmts.userById.get(uid);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    const one = (sql, ...p) => db.prepare(sql).get(...p)?.n || 0;
    const settings = parseJson(u.settings, {});
    const logins = db.prepare(
      'SELECT ip, device, status, anomaly, anomaly_note, created_at FROM login_history WHERE user_id = ? ORDER BY id DESC LIMIT 20'
    ).all(uid).map((r) => ({
      ip: r.ip, device: r.device, status: r.status,
      anomaly: Boolean(r.anomaly), anomalyNote: r.anomaly_note, createdAt: r.created_at,
    }));
    const groups = db.prepare(
      `SELECT g.id, g.name, gm.role FROM group_members gm JOIN groups g ON g.id = gm.group_id
       WHERE gm.user_id = ? ORDER BY g.id`
    ).all(uid).map((g) => ({ id: g.id, name: g.name, role: g.role }));
    const reportsAgainst = db.prepare(
      "SELECT id, category, status, detail, created_at FROM reports WHERE target_type = 'user' AND target_id = ? ORDER BY id DESC LIMIT 20"
    ).all(String(uid)).map((r) => ({
      id: r.id, category: r.category, status: r.status, detail: r.detail, createdAt: r.created_at,
    }));
    const { deviceId: userDeviceId, deviceSig: userDeviceSig } = identityOfUser(uid);
    const deviceBanned = isBannedRequest({ deviceId: userDeviceId, sig: userDeviceSig });
    const deviceSigCount = userDeviceSig
      ? db.prepare('SELECT COUNT(*) AS n FROM users WHERE device_sig = ?').get(userDeviceSig)?.n || 0
      : 0;
    res.json({
      user: {
        id: u.id,
        nickname: u.nickname,
        avatar: u.avatar,
        avatarColor: u.avatar_color,
        wxid: u.wxid,
        region: u.region,
        signature: u.signature,
        gender: u.gender || '',
        balance: u.balance ?? 0,
        createdAt: u.created_at,
        banned: Number(u.banned || 0) === 1,
        banReason: u.ban_reason || '',
        bannedAt: u.banned_at || null,
        bannedBy: u.banned_by || '',
        isPlatformAdmin: settings.isAdmin === true,
        deviceId: userDeviceId,
        deviceSig: userDeviceSig,
        deviceBanned,
        deviceUsers: (userDeviceId || userDeviceSig) ? usersOfDevice(userDeviceId, userDeviceSig) : [],
        deviceSigAccounts: deviceSigCount,
      },
      stats: {
        friends: one('SELECT COUNT(*) AS n FROM friends WHERE user_id = ?', uid),
        messages: one("SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND sender_type = 'user'", uid),
        moments: one('SELECT COUNT(*) AS n FROM moments WHERE user_id = ?', uid),
        groups: groups.length,
        sessions: one('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', uid),
        reportsMade: one('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ?', uid),
      },
      logins, groups, reportsAgainst,
    });
  });

  router.post('/users/:id/ban', ...write('users', 'ban', 'users.manage', (req) => {
    const uid = Number(req.params.id);
    const reason = String(req.body?.reason || '').slice(0, 200);
    const r = banUser(uid, { reason, by: req.admin.username });
    if (r.error) return r;
    logWrite(req, 'users', 'ban', {
      targetType: 'user', targetId: String(uid), detail: `封禁：${reason || '未填写原因'}`,
    });
    return { ok: true };
  }));

  router.post('/users/:id/unban', ...write('users', 'unban', 'users.manage', (req) => {
    const uid = Number(req.params.id);
    const r = unbanUser(uid);
    if (r.error) return r;
    logWrite(req, 'users', 'unban', { targetType: 'user', targetId: String(uid), detail: '解除封禁' });
    return { ok: true };
  }));

  router.post('/users/:id/password', ...write('users', 'reset-password', 'users.manage', (req) => {
    const uid = Number(req.params.id);
    const user = stmts.userById.get(uid);
    if (!user) return { notFound: '用户不存在' };
    const pwd = String(req.body?.password || '');
    if (pwd.length < 6 || pwd.length > 64) return { error: '密码需要 6-64 位' };
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(pwd, salt, 32).toString('hex');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(`${salt}:${hash}`, uid);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
    logWrite(req, 'users', 'reset-password', {
      targetType: 'user', targetId: String(uid), detail: '重置用户密码并下线其所有会话',
    });
    return { ok: true, message: '密码已重置，该用户需重新登录' };
  }));

  router.post('/users/:id/platform-admin', ...write('users', 'set-platform-admin', 'users.manage', (req) => {
    const uid = Number(req.params.id);
    const user = stmts.userById.get(uid);
    if (!user) return { notFound: '用户不存在' };
    const on = req.body?.isAdmin === true;
    const settings = parseJson(user.settings, {});
    settings.isAdmin = on;
    db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(settings), uid);
    logWrite(req, 'users', 'set-platform-admin', {
      targetType: 'user', targetId: String(uid),
      detail: on ? '授予用户端平台管理员标记' : '取消用户端平台管理员标记',
    });
    return { ok: true, isAdmin: on };
  }));

  router.post('/users/:id/logout-all', ...write('users', 'logout-all', 'users.manage', (req) => {
    const uid = Number(req.params.id);
    const n = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid).changes;
    logWrite(req, 'users', 'logout-all', {
      targetType: 'user', targetId: String(uid), detail: `强制下线 ${n} 个会话`,
    });
    return { ok: true, kicked: n };
  }));

  router.delete('/users/:id', ...write('users', 'delete', 'users.manage', (req) => {
    const uid = Number(req.params.id);
    const user = stmts.userById.get(uid);
    if (!user) return { notFound: '用户不存在' };
    if (isPlatformAdminUser(uid)) return { error: '不能删除平台管理员账号' };
    if (String(req.body?.confirm || '') !== user.nickname) {
      return { error: `危险操作：请在 confirm 字段填入用户昵称「${user.nickname}」以确认` };
    }
    const tables = [
      ['sessions', 'user_id'], ['friends', 'user_id'], ['friends', 'friend_id'],
      ['moment_likes', 'user_id'], ['moment_comments', 'user_id'], ['moment_visitors', 'visitor_id'],
      ['chat_reads', 'user_id'], ['chat_prefs', 'user_id'], ['favorites', 'user_id'],
      ['password_resets', 'user_id'], ['login_history', 'user_id'], ['cloud_backups', 'user_id'],
      ['group_announcement_reads', 'user_id'], ['group_join_requests', 'user_id'],
      ['feedback', 'user_id'], ['reports', 'reporter_id'], ['group_members', 'user_id'],
      ['tags', 'user_id'], ['tag_members', 'user_id'], ['user_cards', 'user_id'],
      ['oa_follows', 'user_id'], ['friend_requests', 'from_id'], ['friend_requests', 'to_id'],
    ];
    for (const [t, c] of tables) {
      try { db.prepare(`DELETE FROM ${t} WHERE ${c} = ?`).run(uid); } catch { /* ignore */ }
    }
    try { db.prepare('DELETE FROM moments WHERE user_id = ?').run(uid); } catch { /* ignore */ }
    try { db.prepare('UPDATE groups SET owner_id = NULL WHERE owner_id = ?').run(uid); } catch { /* ignore */ }
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    logWrite(req, 'users', 'delete', {
      targetType: 'user', targetId: String(uid), detail: `删除账号「${user.nickname}」及其关联数据`,
    });
    return { ok: true };
  }));

  // 批量用户操作（/users/bulk 与 /users/:id/* 段数不同，无路由冲突）
  router.post('/users/bulk', ...write('users', 'bulk', 'users.manage', (req) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 200);
    if (!ids.length) return { error: '请选择要操作的用户' };
    const action = String(req.body?.action || '');
    const failed = [];
    let done = 0;
    if (action === 'ban') {
      const reason = String(req.body?.reason || '').slice(0, 200);
      for (const uid of ids) {
        const r = banUser(uid, { reason, by: req.admin.username });
        if (r.error) failed.push(`#${uid}：${r.error}`);
        else done += 1;
      }
      logWrite(req, 'users', 'bulk', {
        targetType: 'user', targetId: ids.join(','),
        detail: `批量封禁 ${done}/${ids.length} 位用户（${reason || '未填写原因'}）`,
      });
      return { ok: true, count: done, failed };
    }
    if (action === 'unban') {
      for (const uid of ids) {
        const r = unbanUser(uid);
        if (r.error) failed.push(`#${uid}：${r.error}`);
        else done += 1;
      }
      logWrite(req, 'users', 'bulk', {
        targetType: 'user', targetId: ids.join(','),
        detail: `批量解封 ${done}/${ids.length} 位用户`,
      });
      return { ok: true, count: done, failed };
    }
    if (action === 'logout') {
      const stmt = db.prepare('DELETE FROM sessions WHERE user_id = ?');
      let kicked = 0;
      for (const uid of ids) kicked += stmt.run(uid).changes;
      logWrite(req, 'users', 'bulk', {
        targetType: 'user', targetId: ids.join(','),
        detail: `批量强制下线 ${ids.length} 位用户（${kicked} 个会话）`,
      });
      return { ok: true, count: ids.length, kicked };
    }
    return { error: '不支持的操作类型' };
  }));

  // ============ 设备封禁 ============
  router.get('/devices', requirePerm('users.view'), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const r = listBannedDevices({
      q: String(req.query.q || ''),
      limit, offset,
    });
    res.json({ ...r, limit, offset });
  });

  router.post('/devices/ban', ...write('devices', 'ban', 'users.manage', (req) => {
    const deviceId = String(req.body?.deviceId || '');
    const sig = String(req.body?.sig || '');
    const reason = String(req.body?.reason || '').slice(0, 200);
    let r;
    if (deviceId) {
      r = banDevice(deviceId, { reason, by: req.admin.username });
    } else if (sig) {
      r = banSig(sig, { reason, by: req.admin.username });
    } else {
      return { error: '缺少 deviceId 或 sig' };
    }
    if (r.error) return r;
    logWrite(req, 'devices', 'ban', {
      targetType: 'device', targetId: (deviceId || sig).slice(0, 16) + '…',
      detail: `封禁设备${sig ? '（含特征指纹）' : ''}：${reason || '未填写原因'}`,
    });
    return { ok: true };
  }));

  router.post('/devices/bulk-ban', ...write('devices', 'bulk-ban', 'users.manage', (req) => {
    const ids = (Array.isArray(req.body?.deviceIds) ? req.body.deviceIds : []).map(String).filter(Boolean).slice(0, 100);
    if (!ids.length) return { error: '请选择要封禁的设备' };
    const reason = String(req.body?.reason || '').slice(0, 200);
    let done = 0;
    for (const id of ids) {
      const r = banDevice(id, { reason, by: req.admin.username });
      if (!r.error) done += 1;
    }
    logWrite(req, 'devices', 'bulk-ban', {
      targetType: 'device', targetId: ids.map((s) => s.slice(0, 8)).join(','),
      detail: `批量封禁设备 ${done}/${ids.length}（${reason || '未填写原因'}）`,
    });
    return { ok: true, count: done };
  }));

  router.post('/devices/unban', ...write('devices', 'unban', 'users.manage', (req) => {
    const deviceId = String(req.body?.deviceId || '');
    const r = unbanDevice(deviceId);
    if (r.error) return r;
    logWrite(req, 'devices', 'unban', {
      targetType: 'device', targetId: deviceId.slice(0, 16) + '…', detail: '解除设备封禁',
    });
    return { ok: true };
  }));

  // ============ 举报管理 ============
  router.get('/reports', requirePerm('reports.view'), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const where = [];
    const params = [];
    if (req.query.status) { where.push('r.status = ?'); params.push(String(req.query.status)); }
    if (req.query.category) { where.push('r.category = ?'); params.push(String(req.query.category)); }
    if (req.query.targetType) { where.push('r.target_type = ?'); params.push(String(req.query.targetType)); }
    if (req.query.q) {
      where.push('(r.detail LIKE ? OR r.target_id LIKE ? OR CAST(r.id AS TEXT) = ?)');
      params.push(like(req.query.q), like(req.query.q), String(req.query.q));
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM reports r ${clause}`).get(...params)?.n || 0;
    const rows = db.prepare(
      `SELECT r.*, u.nickname AS reporter_name FROM reports r
       LEFT JOIN users u ON u.id = r.reporter_id
       ${clause} ORDER BY r.id DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    const stats = db.prepare('SELECT status, COUNT(*) AS n FROM reports GROUP BY status').all();
    res.json({
      total, limit, offset,
      stats: Object.fromEntries(stats.map((s) => [s.status, s.n])),
      reports: rows.map(mapReportRow),
    });
  });

  router.get('/reports/:id', requirePerm('reports.view'), (req, res) => {    const r = db.prepare(
      `SELECT r.*, u.nickname AS reporter_name, u.avatar AS reporter_avatar
       FROM reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE r.id = ?`
    ).get(Number(req.params.id));
    if (!r) return res.status(404).json({ error: '举报不存在' });
    const detail = mapReportRow(r);
    // 附带被举报对象上下文，便于处置
    let target = null;
    if (r.target_type === 'user') {
      const u = stmts.userById.get(Number(r.target_id));
      if (u) target = { type: 'user', id: u.id, nickname: u.nickname, avatar: u.avatar, banned: Number(u.banned || 0) === 1 };
    } else if (r.target_type === 'moment') {
      const m = db.prepare('SELECT id, user_id, content, images, created_at FROM moments WHERE id = ?').get(Number(r.target_id));
      if (m) target = { type: 'moment', id: m.id, userId: m.user_id, content: m.content, createdAt: m.created_at };
    } else if (r.target_type === 'message') {
      const m = db.prepare('SELECT id, sender_name, content, conversation_id, created_at FROM messages WHERE id = ?').get(Number(r.target_id));
      if (m) target = { type: 'message', id: m.id, senderName: m.sender_name, content: m.content, conversationId: m.conversation_id, createdAt: m.created_at };
    } else if (r.target_type === 'group') {
      const g = stmts.groupById.get(Number(r.target_id));
      if (g) target = { type: 'group', id: g.id, name: g.name, kind: g.kind };
    }
    res.json({ report: detail, target });
  });

  // 注意：必须注册在 /reports/:id 之前，否则 "bulk" 会被当作 :id 匹配
  router.post('/reports/bulk', ...write('reports', 'bulk-handle', 'reports.manage', (req) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 200);
    if (!ids.length) return { error: '请选择要处理的举报' };
    const status = ['pending', 'processing', 'done', 'rejected'].includes(req.body?.status)
      ? req.body.status : 'done';
    const note = String(req.body?.handlerNote || '').slice(0, 500);
    const stmt = db.prepare(
      'UPDATE reports SET status = ?, handler_note = ?, handler_id = ?, handled_at = ?, updated_at = ? WHERE id = ?'
    );
    for (const id of ids) stmt.run(status, note, req.admin.id, now(), now(), id);
    logWrite(req, 'reports', 'bulk-handle', {
      targetType: 'report', targetId: ids.join(','),
      detail: `批量处置 ${ids.length} 条 → ${status}`,
    });
    return { ok: true, count: ids.length };
  }));

  router.post('/reports/:id', ...write('reports', 'handle', 'reports.manage', (req) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
    if (!row) return { notFound: '举报不存在' };
    const allowed = ['pending', 'processing', 'done', 'rejected'];
    const status = allowed.includes(req.body?.status) ? req.body.status : 'processing';
    const note = String(req.body?.handlerNote || '').slice(0, 500);
    db.prepare(
      'UPDATE reports SET status = ?, handler_note = ?, handler_id = ?, handled_at = ?, updated_at = ? WHERE id = ?'
    ).run(status, note, req.admin.id, now(), now(), id);
    // 可选联动处置
    let extra = '';
    if (req.body?.banTarget === true && row.target_type === 'user') {
      const b = banUser(Number(row.target_id), { reason: `举报 #${id} 处置`, by: req.admin.username });
      extra = b.error ? `（封禁失败：${b.error}）` : '，并已封禁被举报用户';
    }
    logWrite(req, 'reports', 'handle', {
      targetType: 'report', targetId: String(id),
      detail: `状态 → ${status}${note ? `；备注：${note}` : ''}${extra}`,
    });
    const updated = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
    return { ok: true, report: mapReportRow(updated) };
  }));

  // ============ 反馈管理 ============
  router.get('/feedback', requirePerm('feedback.view'), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const where = [];
    const params = [];
    if (req.query.status) { where.push('f.status = ?'); params.push(String(req.query.status)); }
    if (req.query.category) { where.push('f.category = ?'); params.push(String(req.query.category)); }
    if (req.query.q) {
      where.push('(f.content LIKE ? OR f.contact LIKE ? OR CAST(f.id AS TEXT) = ?)');
      params.push(like(req.query.q), like(req.query.q), String(req.query.q));
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM feedback f ${clause}`).get(...params)?.n || 0;
    const rows = db.prepare(
      `SELECT f.*, u.nickname AS user_name FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       ${clause} ORDER BY f.id DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM feedback GROUP BY status').all();
    const byCategory = db.prepare('SELECT category, COUNT(*) AS n FROM feedback GROUP BY category').all();
    res.json({
      total, limit, offset,
      stats: {
        byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s.n])),
        byCategory: Object.fromEntries(byCategory.map((s) => [s.category, s.n])),
      },
      feedbacks: rows.map(mapFeedbackRow),
    });
  });

  router.post('/feedback/:id/reply', ...write('feedback', 'reply', 'feedback.manage', (req) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM feedback WHERE id = ?').get(id);
    if (!row) return { notFound: '反馈不存在' };
    const reply = String(req.body?.reply || '').trim();
    if (!reply) return { error: '回复内容不能为空' };
    db.prepare(
      "UPDATE feedback SET reply = ?, status = 'replied', handled_by = ?, updated_at = ? WHERE id = ?"
    ).run(reply.slice(0, 1000), req.admin.username, now(), id);
    logWrite(req, 'feedback', 'reply', {
      targetType: 'feedback', targetId: String(id), detail: `回复：${reply.slice(0, 200)}`,
    });
    return { ok: true };
  }));

  router.post('/feedback/:id/close', ...write('feedback', 'close', 'feedback.manage', (req) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM feedback WHERE id = ?').get(id);
    if (!row) return { notFound: '反馈不存在' };
    db.prepare(
      "UPDATE feedback SET status = 'closed', handled_by = ?, closed_at = ?, updated_at = ? WHERE id = ?"
    ).run(req.admin.username, now(), now(), id);
    logWrite(req, 'feedback', 'close', { targetType: 'feedback', targetId: String(id), detail: '关闭反馈' });
    return { ok: true };
  }));

  router.post('/feedback/:id/reopen', ...write('feedback', 'reopen', 'feedback.manage', (req) => {
    const id = Number(req.params.id);
    db.prepare("UPDATE feedback SET status = 'open', closed_at = NULL, updated_at = ? WHERE id = ?")
      .run(now(), id);
    logWrite(req, 'feedback', 'reopen', { targetType: 'feedback', targetId: String(id), detail: '重新打开反馈' });
    return { ok: true };
  }));

  // ============ 错误监控 ============
  router.get('/errors', requirePerm('errors.view'), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const where = [];
    const params = [];
    if (req.query.feature) { where.push('feature = ?'); params.push(String(req.query.feature)); }
    if (req.query.q) {
      where.push('(message LIKE ? OR stack LIKE ?)');
      params.push(like(req.query.q), like(req.query.q));
    }
    if (req.query.since) { where.push('created_at >= ?'); params.push(Number(req.query.since)); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM error_logs ${clause}`).get(...params)?.n || 0;
    const rows = db.prepare(
      `SELECT * FROM error_logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    res.json({
      total, limit, offset,
      errors: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        feature: r.feature || '',
        message: r.message,
        stack: r.stack || '',
        meta: parseJson(r.meta, {}),
        createdAt: r.created_at,
      })),
    });
  });

  router.get('/errors/stats', requirePerm('errors.view'), (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 14, 7), 30);
    const since = now() - days * 86400_000;
    const byFeature = db.prepare(
      'SELECT feature, COUNT(*) AS n FROM error_logs WHERE created_at > ? GROUP BY feature ORDER BY n DESC LIMIT 30'
    ).all(since).map((r) => ({ feature: r.feature || '(未标注)', count: r.n }));
    const trend = bucketize(
      db.prepare('SELECT created_at FROM error_logs WHERE created_at > ?').all(since), days
    );
    // 相同 message 聚合，便于识别高频崩溃
    const topMessages = db.prepare(
      `SELECT message, COUNT(*) AS n, MAX(created_at) AS last_at FROM error_logs
       WHERE created_at > ? GROUP BY message ORDER BY n DESC LIMIT 20`
    ).all(since).map((r) => ({ message: r.message, count: r.n, lastAt: r.last_at }));
    res.json({ days, byFeature, trend, topMessages });
  });

  router.delete('/errors/:id', ...write('errors', 'delete', 'errors.manage', (req) => {
    const id = Number(req.params.id);
    const r = db.prepare('DELETE FROM error_logs WHERE id = ?').run(id);
    if (!r.changes) return { notFound: '记录不存在' };
    logWrite(req, 'errors', 'delete', { targetType: 'error', targetId: String(id), detail: '删除错误记录' });
    return { ok: true };
  }));

  router.post('/errors/purge', ...write('errors', 'purge', 'errors.manage', (req) => {
    const before = Number(req.body?.before) || 0;
    const feature = String(req.body?.feature || '');
    let sql = 'DELETE FROM error_logs WHERE 1=1';
    const params = [];
    if (before) { sql += ' AND created_at < ?'; params.push(before); }
    if (feature) { sql += ' AND feature = ?'; params.push(feature); }
    if (!before && !feature) return { error: '请指定清理范围（时间或功能模块），避免误删全部' };
    const r = db.prepare(sql).run(...params);
    logWrite(req, 'errors', 'purge', {
      detail: `清理错误记录 ${r.changes} 条${before ? `（早于 ${new Date(before).toLocaleString('zh-CN')}）` : ''}${feature ? `（模块 ${feature}）` : ''}`,
    });
    return { ok: true, deleted: r.changes };
  }));

  // ============ 功能开关 ============
  router.get('/flags', requirePerm('flags.view'), (req, res) => {
    res.json({ flags: getFlags(), defaults: DEFAULT_FLAGS, meta: FLAG_META });
  });

  router.post('/flags', ...write('flags', 'update', 'flags.manage', (req) => {
    const patch = req.body?.flags || req.body || {};
    const before = getFlags();
    const r = setFlags(patch);
    if (r.error) return r;
    const changed = Object.keys(patch)
      .filter((k) => k in DEFAULT_FLAGS && Boolean(before[k]) !== Boolean(r.flags[k]))
      .map((k) => `${k}: ${before[k] ? '开' : '关'} → ${r.flags[k] ? '开' : '关'}`);
    logWrite(req, 'flags', 'update', {
      detail: changed.length ? `切换开关 ${changed.join('；')}` : '提交开关（无变化）',
    });
    return { ok: true, flags: r.flags };
  }));

  // ============ 审计日志 ============
  router.get('/audit', requirePerm('audit.view'), (req, res) => {
    res.json(listAuditLogs({
      module: req.query.module || '',
      adminId: req.query.adminId || '',
      q: req.query.q || '',
      limit: req.query.limit,
      offset: req.query.offset,
    }));
  });

  router.get('/audit/modules', requirePerm('audit.view'), (req, res) => {
    const rows = db.prepare('SELECT module, COUNT(*) AS n FROM admin_audit_logs GROUP BY module ORDER BY n DESC').all();
    res.json({ modules: rows.map((r) => ({ module: r.module, count: r.n })) });
  });

  // ============ 系统设置 ============
  router.get('/settings', requirePerm('settings.view'), (req, res) => {
    res.json({ settings: getAllSettings(), defaults: DEFAULT_SETTINGS, meta: SETTINGS_META });
  });

  router.post('/settings', ...write('settings', 'update', 'settings.manage', (req) => {
    const patch = req.body?.settings || req.body || {};
    const before = getAllSettings();
    const r = setSettings(patch, req.admin.username);
    if (r.error) return r;
    const changed = r.changed
      .filter((c) => String(before[c.key] ?? '') !== String(c.value))
      .map((c) => `${c.key}: ${JSON.stringify(before[c.key] ?? '')} → ${JSON.stringify(c.value)}`);
    logWrite(req, 'settings', 'update', {
      detail: changed.length ? `修改系统设置 ${changed.join('；')}` : '提交系统设置（无变化）',
    });
    return r;
  }));

  // ============ 内容治理 ============
  router.get('/content/messages', requirePerm('content.view'), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const where = ['m.recalled = 0'];
    const params = [];
    if (req.query.q) { where.push('m.content LIKE ? ESCAPE \'\\\''); params.push(like(req.query.q)); }
    if (req.query.conversationId) { where.push('m.conversation_id = ?'); params.push(String(req.query.conversationId)); }
    if (req.query.senderId) { where.push('m.sender_id = ?'); params.push(Number(req.query.senderId)); }
    const clause = `WHERE ${where.join(' AND ')}`;
    const total = db.prepare(`SELECT COUNT(*) AS n FROM messages m ${clause}`).get(...params)?.n || 0;
    const rows = db.prepare(
      `SELECT m.id, m.sender_type, m.sender_id, m.sender_name, m.content, m.media_type, m.media_url,
              m.conversation_id, m.created_at
       FROM messages m ${clause} ORDER BY m.id DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    res.json({
      total, limit, offset,
      messages: rows.map((m) => ({
        id: m.id,
        senderType: m.sender_type,
        senderId: m.sender_id,
        senderName: m.sender_name,
        content: String(m.content || '').slice(0, 500),
        mediaType: m.media_type || '',
        mediaUrl: m.media_url || '',
        conversationId: m.conversation_id || '',
        createdAt: m.created_at,
      })),
    });
  });

  router.delete('/content/messages/:id', ...write('content', 'delete-message', 'content.manage', (req) => {
    const id = Number(req.params.id);
    const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
    if (!m) return { notFound: '消息不存在' };
    if (req.body?.hard === true) {
      db.prepare('DELETE FROM messages WHERE id = ?').run(id);
    } else {
      db.prepare(
        "UPDATE messages SET recalled = 1, sender_type = 'system', content = '[该消息已被平台删除]', media_type = NULL, media_url = NULL WHERE id = ?"
      ).run(id);
    }
    logWrite(req, 'content', 'delete-message', {
      targetType: 'message', targetId: String(id),
      detail: `${req.body?.hard === true ? '彻底删除' : '撤回'}消息（会话 ${m.conversation_id || 'default'}，发送者 ${m.sender_name}）`,
    });
    return { ok: true };
  }));

  router.get('/content/moments', requirePerm('content.view'), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const where = [];
    const params = [];
    if (req.query.q) { where.push('m.content LIKE ? ESCAPE \'\\\''); params.push(like(req.query.q)); }
    if (req.query.userId) { where.push('m.user_id = ?'); params.push(Number(req.query.userId)); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM moments m ${clause}`).get(...params)?.n || 0;
    const rows = db.prepare(
      `SELECT m.*, u.nickname, u.avatar FROM moments m LEFT JOIN users u ON u.id = m.user_id
       ${clause} ORDER BY m.id DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    res.json({
      total, limit, offset,
      moments: rows.map((m) => ({
        id: m.id,
        userId: m.user_id,
        nickname: m.nickname || '',
        avatar: m.avatar || null,
        content: m.content,
        images: parseJson(m.images, []),
        visibility: m.visibility || 'public',
        createdAt: m.created_at,
      })),
    });
  });

  router.delete('/content/moments/:id', ...write('content', 'delete-moment', 'content.manage', (req) => {
    const id = Number(req.params.id);
    const m = db.prepare('SELECT * FROM moments WHERE id = ?').get(id);
    if (!m) return { notFound: '动态不存在' };
    db.prepare('DELETE FROM moment_likes WHERE moment_id = ?').run(id);
    db.prepare('DELETE FROM moment_comments WHERE moment_id = ?').run(id);
    db.prepare('DELETE FROM moment_visitors WHERE moment_id = ?').run(id);
    db.prepare('DELETE FROM moments WHERE id = ?').run(id);
    logWrite(req, 'content', 'delete-moment', {
      targetType: 'moment', targetId: String(id),
      detail: `删除动态（作者 #${m.user_id}）：${String(m.content || '').slice(0, 120)}`,
    });
    return { ok: true };
  }));

  router.get('/content/groups', requirePerm('content.view'), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const where = [];
    const params = [];
    if (req.query.q) { where.push('g.name LIKE ? ESCAPE \'\\\''); params.push(like(req.query.q)); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM groups g ${clause}`).get(...params)?.n || 0;
    const rows = db.prepare(
      `SELECT g.*,
              (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id IS NOT NULL) AS member_count,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = 'grp_' || g.id) AS msg_count
       FROM groups g ${clause} ORDER BY g.id LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    res.json({
      total, limit, offset,
      groups: rows.map((g) => ({
        id: g.id,
        name: g.name,
        kind: g.kind,
        ownerId: g.owner_id,
        requireApproval: Boolean(g.require_approval),
        announcement: g.announcement || g.notice || '',
        memberCount: g.member_count,
        messageCount: g.msg_count,
        createdAt: g.created_at,
      })),
    });
  });

  router.delete('/content/groups/:id', ...write('content', 'delete-group', 'content.manage', (req) => {
    const id = Number(req.params.id);
    const g = stmts.groupById.get(id);
    if (!g) return { notFound: '群组不存在' };
    if (String(req.body?.confirm || '') !== g.name) {
      return { error: `危险操作：请在 confirm 字段填入群名「${g.name}」以确认` };
    }
    db.prepare('DELETE FROM group_members WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM group_announcement_reads WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM group_join_requests WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(`grp_${id}`);
    db.prepare('DELETE FROM groups WHERE id = ?').run(id);
    logWrite(req, 'content', 'delete-group', {
      targetType: 'group', targetId: String(id), detail: `删除群组「${g.name}」及其成员与消息`,
    });
    return { ok: true };
  }));

  // 批量删除内容：消息（撤回/彻底删除）、动态（级联点赞评论访客）、群组（级联成员与消息）
  router.post('/content/bulk', ...write('content', 'bulk-delete', 'content.manage', (req) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 200);
    if (!ids.length) return { error: '请选择要删除的内容' };
    const type = String(req.body?.type || '');
    const hard = req.body?.hard === true;
    const stmt = (sql) => db.prepare(sql);
    let done = 0;

    if (type === 'messages') {
      const soft = stmt(
        "UPDATE messages SET recalled = 1, sender_type = 'system', content = '[该消息已被平台删除]', media_type = NULL, media_url = NULL WHERE id = ? AND recalled = 0"
      );
      const hardDel = stmt('DELETE FROM messages WHERE id = ?');
      for (const id of ids) {
        const r = hard ? hardDel.run(id) : soft.run(id);
        if (r.changes) done += 1;
      }
      logWrite(req, 'content', 'bulk-delete', {
        targetType: 'message', targetId: ids.join(','),
        detail: `批量${hard ? '彻底删除' : '撤回'}消息 ${done}/${ids.length} 条`,
      });
      return { ok: true, count: done };
    }

    if (type === 'moments') {
      for (const id of ids) {
        const m = db.prepare('SELECT id FROM moments WHERE id = ?').get(id);
        if (!m) continue;
        stmt('DELETE FROM moment_likes WHERE moment_id = ?').run(id);
        stmt('DELETE FROM moment_comments WHERE moment_id = ?').run(id);
        stmt('DELETE FROM moment_visitors WHERE moment_id = ?').run(id);
        stmt('DELETE FROM moments WHERE id = ?').run(id);
        done += 1;
      }
      logWrite(req, 'content', 'bulk-delete', {
        targetType: 'moment', targetId: ids.join(','),
        detail: `批量删除动态 ${done}/${ids.length} 条`,
      });
      return { ok: true, count: done };
    }

    if (type === 'groups') {
      // 与单条删除同级的危险操作：不逐个输群名，但要求确认短语
      if (String(req.body?.confirm || '') !== '批量删除') {
        return { error: '危险操作：请在 confirm 字段填入「批量删除」以确认' };
      }
      for (const id of ids) {
        const g = stmts.groupById.get(id);
        if (!g) continue;
        stmt('DELETE FROM group_members WHERE group_id = ?').run(id);
        stmt('DELETE FROM group_announcement_reads WHERE group_id = ?').run(id);
        stmt('DELETE FROM group_join_requests WHERE group_id = ?').run(id);
        stmt('DELETE FROM messages WHERE conversation_id = ?').run(`grp_${id}`);
        stmt('DELETE FROM groups WHERE id = ?').run(id);
        done += 1;
      }
      logWrite(req, 'content', 'bulk-delete', {
        targetType: 'group', targetId: ids.join(','),
        detail: `批量删除群组 ${done}/${ids.length} 个及其成员与消息`,
      });
      return { ok: true, count: done };
    }

    return { error: '不支持的内容类型' };
  }));

  // ============ 管理员账号 ============
  router.get('/admins', requirePerm('admins.view'), (req, res) => {
    res.json({
      admins: listAdmins(),
      roles: Object.entries(ROLES).map(([key, v]) => ({ key, label: v.label, permissions: v.permissions })),
      permissions: Object.entries(PERMISSIONS).map(([key, label]) => ({ key, label })),
      me: publicAdmin(req.admin),
    });
  });

  router.post('/admins', ...write('admins', 'create', 'admins.manage', (req) => {
    const r = createAdmin({
      username: req.body?.username,
      password: req.body?.password,
      displayName: req.body?.displayName,
      role: req.body?.role,
      permissions: req.body?.permissions,
      status: req.body?.status,
    });
    if (r.error) return r;
    logWrite(req, 'admins', 'create', {
      targetType: 'admin', targetId: String(r.admin.id),
      detail: `新建管理员 ${r.admin.username}（${r.admin.roleLabel}）`,
    });
    return r;
  }));

  router.patch('/admins/:id', ...write('admins', 'update', 'admins.manage', (req) => {
    const id = Number(req.params.id);
    const before = getAdminById(id);
    if (!before) return { notFound: '管理员不存在' };
    const r = updateAdmin(id, req.body || {});
    if (r.error) return r;
    const diffs = [];
    if (before.role !== r.admin.role) diffs.push(`角色 ${roleLabel(before.role)} → ${r.admin.roleLabel}`);
    if (before.status !== r.admin.status) diffs.push(`状态 ${before.status} → ${r.admin.status}`);
    if (before.display_name !== r.admin.displayName) diffs.push(`显示名 → ${r.admin.displayName}`);
    logWrite(req, 'admins', 'update', {
      targetType: 'admin', targetId: String(id),
      detail: diffs.length ? `修改 ${before.username}：${diffs.join('；')}` : `修改 ${before.username} 权限`,
    });
    return r;
  }));

  router.post('/admins/:id/password', ...write('admins', 'reset-password', 'admins.manage', (req) => {
    const id = Number(req.params.id);
    const before = getAdminById(id);
    if (!before) return { notFound: '管理员不存在' };
    const r = setAdminPassword(id, req.body?.password);
    if (r.error) return r;
    logWrite(req, 'admins', 'reset-password', {
      targetType: 'admin', targetId: String(id), detail: `重置 ${before.username} 的密码并踢下线`,
    });
    return r;
  }));

  router.delete('/admins/:id', ...write('admins', 'delete', 'admins.manage', (req) => {
    const id = Number(req.params.id);
    const before = getAdminById(id);
    if (!before) return { notFound: '管理员不存在' };
    const r = deleteAdmin(id, req.admin.id);
    if (r.error) return r;
    logWrite(req, 'admins', 'delete', {
      targetType: 'admin', targetId: String(id), detail: `删除管理员 ${before.username}`,
    });
    return r;
  }));

  router.post('/admins/:id/revoke-sessions', ...write('admins', 'revoke-sessions', 'admins.manage', (req) => {
    const id = Number(req.params.id);
    const before = getAdminById(id);
    if (!before) return { notFound: '管理员不存在' };
    revokeAdminSessions(id);
    logWrite(req, 'admins', 'revoke-sessions', {
      targetType: 'admin', targetId: String(id), detail: `强制 ${before.username} 下线`,
    });
    return { ok: true };
  }));

  return router;
}

// ---------- 行映射 ----------
function mapReportRow(r) {
  const statusLabel = r.status === 'pending' ? '待处理'
    : r.status === 'processing' ? '处理中'
      : r.status === 'done' ? '已处理'
        : r.status === 'rejected' ? '未违规' : r.status;
  return {
    id: r.id,
    reporterId: r.reporter_id,
    reporterName: r.reporter_name || '',
    targetType: r.target_type,
    targetId: r.target_id,
    category: r.category,
    categoryLabel: REPORT_CATEGORIES[r.category] || r.category,
    detail: r.detail,
    status: r.status,
    statusLabel,
    handlerNote: r.handler_note || '',
    handlerId: r.handler_id || null,
    handledAt: r.handled_at || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapFeedbackRow(r) {
  const statusLabel = r.status === 'open' ? '待处理'
    : r.status === 'replied' ? '已回复'
      : r.status === 'closed' ? '已关闭' : r.status;
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name || '',
    category: r.category,
    categoryLabel: FEEDBACK_CATEGORIES[r.category] || r.category,
    content: r.content,
    contact: r.contact,
    status: r.status,
    statusLabel,
    reply: r.reply || '',
    handledBy: r.handled_by || '',
    closedAt: r.closed_at || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---------- 静态元数据（前端直接渲染中文） ----------
export const REPORT_CATEGORIES = {
  spam: '垃圾广告', abuse: '辱骂骚扰', porn: '色情低俗',
  fraud: '诈骗欺诈', illegal: '违法违规', other: '其他',
};

export const FEEDBACK_CATEGORIES = {
  bug: '功能异常', suggestion: '产品建议', ui: '界面体验',
  account: '账号问题', other: '其他',
};

export const FLAG_META = {
  accountSecurity: { group: '账号安全', desc: '找回密码 / 登录记录 / 注销账号' },
  groupGovernance: { group: '群组治理', desc: '群管理员 / 入群验证 / 公告已读 / 群相册' },
  momentsSafety: { group: '内容安全', desc: '朋友圈访客 / 举报 / 敏感词过滤' },
  backupCloud: { group: '数据备份', desc: '聊天记录导出 / 云端备份恢复' },
  feedbackFaq: { group: '帮助支持', desc: '意见反馈 / FAQ / 举报进度' },
  searchEnhanced: { group: '搜索能力', desc: '聊天记录筛选 / 收藏分类' },
  adminPanel: { group: '运营后台', desc: '用户端「运营后台」入口（后台本身始终可访问，避免自锁）' },
};

export const SETTINGS_META = {
  'site.name': { group: '基础', label: '站点名称', type: 'text' },
  'site.notice': { group: '公告', label: '全局公告内容', type: 'textarea' },
  'site.noticeEnabled': { group: '公告', label: '启用全局公告', type: 'switch' },
  'site.maintenance': { group: '运维', label: '维护模式', type: 'switch' },
  'site.maintenanceMessage': { group: '运维', label: '维护提示文案', type: 'textarea' },
  'site.registrationOpen': { group: '注册', label: '开放注册', type: 'switch' },
  'site.registrationNotice': { group: '注册', label: '关闭注册提示', type: 'text' },
  'site.maxUploadMb': { group: '限制', label: '上传大小上限 (MB)', type: 'number' },
};

export const MODULES = [
  { key: 'dashboard', label: '概览', icon: '📊', perm: 'dashboard.view' },
  { key: 'users', label: '用户管理', icon: '👥', perm: 'users.view' },
  { key: 'devices', label: '设备封禁', icon: '📵', perm: 'users.view' },
  { key: 'reports', label: '举报管理', icon: '🚨', perm: 'reports.view' },
  { key: 'feedback', label: '反馈管理', icon: '💬', perm: 'feedback.view' },
  { key: 'errors', label: '错误监控', icon: '🐞', perm: 'errors.view' },
  { key: 'content', label: '内容治理', icon: '🧹', perm: 'content.view' },
  { key: 'flags', label: '功能开关', icon: '🎚️', perm: 'flags.view' },
  { key: 'settings', label: '系统设置', icon: '⚙️', perm: 'settings.view' },
  { key: 'audit', label: '审计日志', icon: '📜', perm: 'audit.view' },
  { key: 'admins', label: '管理员', icon: '🔑', perm: 'admins.view' },
];
