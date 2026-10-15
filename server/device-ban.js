// 设备封禁（双轨指纹）：持久 ID（localStorage）+ 特征指纹（sig，无存储依赖）。
// 封禁任一即拦；同一特征指纹限制注册频次，堵「清缓存/无痕反复注册」。
// 指纹由客户端 device-ban.js 采集，服务端只做哈希存储与匹配。
// 一行 = 一个持久 ID；同一 sig 多行 = 该设备清过缓存（换 ID 不换特征），封禁按 sig 传播到所有行。
import crypto from 'node:crypto';
import { db } from './db.js';

function now() {
  return Date.now();
}

function sha(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 40);
}

/** 幂等规范化：40 位十六进制视为已哈希，其余视为原始值再哈希 */
export function normalizeDeviceId(raw) {
  const s = String(raw || '').trim().slice(0, 300);
  if (!s) return '';
  if (/^[0-9a-f]{40}$/.test(s)) return s;
  return sha(s);
}

export const normalizeDeviceSig = normalizeDeviceId;

export function isDeviceBanned(deviceId) {
  const id = normalizeDeviceId(deviceId);
  if (!id) return false;
  try {
    const row = db.prepare('SELECT banned_at FROM banned_devices WHERE device_id = ?').get(id);
    return Boolean(row) && Number(row.banned_at || 0) > 0;
  } catch {
    return false;
  }
}

export function isSigBanned(sig) {
  const h = normalizeDeviceSig(sig);
  if (!h) return false;
  try {
    const row = db.prepare(
      'SELECT banned_at FROM banned_devices WHERE sig_hash = ? AND banned_at > 0 LIMIT 1'
    ).get(h);
    return Boolean(row);
  } catch {
    return false;
  }
}

/** 注册/登录入口的统一拦截判断（双轨任一命中即拦） */
export function isBannedRequest({ deviceId = '', sig = '' } = {}) {
  return isDeviceBanned(deviceId) || isSigBanned(sig);
}

/** 同一特征指纹 24h 内最多注册的账号数（纵深防御：换号也不给刷） */
export const SIG_REGISTER_LIMIT = { limit: 3, windowMs: 24 * 3600_000 };

export function sigRegisterLimited(sig) {
  const h = normalizeDeviceSig(sig);
  if (!h) return false;
  try {
    const since = now() - SIG_REGISTER_LIMIT.windowMs;
    const n = db.prepare(
      'SELECT COUNT(*) AS n FROM users WHERE device_sig = ? AND created_at > ?'
    ).get(h, since)?.n || 0;
    return n >= SIG_REGISTER_LIMIT.limit;
  } catch {
    return false;
  }
}

/** 查某用户最近登记的设备 ID / 特征指纹 */
export function identityOfUser(userId) {
  try {
    const r = db.prepare('SELECT device_id, device_sig FROM users WHERE id = ?').get(Number(userId));
    return {
      deviceId: String(r?.device_id || ''),
      deviceSig: String(r?.device_sig || ''),
    };
  } catch {
    return { deviceId: '', deviceSig: '' };
  }
}

export function deviceOfUser(userId) {
  return identityOfUser(userId).deviceId;
}

/** 用户详情展示：按设备 ID 和/或特征指纹反查所有关联账号（去重） */
export function usersOfDevice(deviceId, sigHash = '') {
  const id = normalizeDeviceId(deviceId);
  const sig = normalizeDeviceSig(sigHash);
  if (!id && !sig) return [];
  try {
    const sigs = new Set();
    if (sig) sigs.add(sig);
    if (id) {
      const s = db.prepare(
        'SELECT sig_hash FROM banned_devices WHERE device_id = ? AND sig_hash != \'\' LIMIT 1'
      ).get(id)?.sig_hash || '';
      if (s) sigs.add(s);
    }
    const ids = new Set();
    if (id) {
      for (const r of db.prepare('SELECT id FROM users WHERE device_id = ? ORDER BY id DESC LIMIT 50').all(id)) ids.add(r.id);
    }
    for (const s of sigs) {
      for (const r of db.prepare('SELECT id FROM users WHERE device_sig = ? ORDER BY id DESC LIMIT 50').all(s)) ids.add(r.id);
    }
    const sorted = [...ids].sort((a, b) => b - a).slice(0, 50);
    return sorted.map((uid) => {
      const u = db.prepare('SELECT id, nickname, avatar, banned FROM users WHERE id = ?').get(uid);
      return {
        id: u.id,
        nickname: u.nickname,
        avatar: u.avatar,
        banned: Number(u.banned || 0) === 1,
      };
    });
  } catch {
    return [];
  }
}

/** 登录/注册成功后登记双指纹（记最近使用信息；封禁设备也更新，便于后台看到动态） */
export function touchDevice({ userId, deviceId, sig = '', ip = '', userAgent = '' }) {
  const id = normalizeDeviceId(deviceId);
  const sigHash = normalizeDeviceSig(sig);
  if (!id && !sigHash) return;
  const t = now();
  const uid = Number(userId) || null;
  const ipClean = String(ip || '').slice(0, 64);
  const uaClean = String(userAgent || '').slice(0, 300);
  try {
    db.prepare('UPDATE users SET device_id = ?, device_sig = ? WHERE id = ?').run(id, sigHash, Number(userId));
    if (id) {
      db.prepare(
        `INSERT INTO banned_devices (device_id, sig_hash, reason, banned_by, banned_at, last_seen_at, last_user_id, last_ip, last_ua)
         VALUES (?, ?, '', '', 0, ?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET
           sig_hash = CASE WHEN excluded.sig_hash != '' THEN excluded.sig_hash ELSE banned_devices.sig_hash END,
           last_seen_at = excluded.last_seen_at,
           last_user_id = excluded.last_user_id,
           last_ip = excluded.last_ip,
           last_ua = excluded.last_ua`
      ).run(id, sigHash, t, uid, ipClean, uaClean);
    }
    // 无持久 ID 的行（device_id=''）只保留一条/sig：已有实 ID 行则跳过；仅 sig 行则刷新并升级为实 ID 行
    if (sigHash) {
      const existing = db.prepare(
        'SELECT device_id FROM banned_devices WHERE sig_hash = ? ORDER BY CASE WHEN device_id = \'\' THEN 1 ELSE 0 END LIMIT 1'
      ).get(sigHash);
      if (!existing) {
        db.prepare(
          `INSERT INTO banned_devices (device_id, sig_hash, reason, banned_by, banned_at, last_seen_at, last_user_id, last_ip, last_ua)
           VALUES ('', ?, '', '', 0, ?, ?, ?, ?)`
        ).run(sigHash, t, uid, ipClean, uaClean);
      } else if (existing.device_id === '' && id) {
        db.prepare(
          `UPDATE banned_devices SET device_id = ?, last_seen_at = ?, last_user_id = ?, last_ip = ?, last_ua = ?
           WHERE sig_hash = ? AND device_id = ''`
        ).run(id, t, uid, ipClean, uaClean, sigHash);
      } else if (existing.device_id === '') {
        db.prepare(
          `UPDATE banned_devices SET last_seen_at = ?, last_user_id = ?, last_ip = ?, last_ua = ?
           WHERE sig_hash = ? AND device_id = ''`
        ).run(t, uid, ipClean, uaClean, sigHash);
      }
    }
  } catch { /* ignore */ }
}

function killSessionsOfSig(sigHash) {
  if (!sigHash) return;
  try {
    for (const u of db.prepare('SELECT id FROM users WHERE device_sig = ?').all(sigHash)) {
      try { db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/** 把某特征指纹下的所有登记行置为封禁 */
function banAllSigRows(sigHash, { reason, by, bannedAt }) {
  db.prepare(
    `UPDATE banned_devices SET banned_at = ?, reason = ?, banned_by = ?
     WHERE sig_hash = ? AND banned_at = 0`
  ).run(bannedAt, String(reason || '').slice(0, 200), String(by || '').slice(0, 32), sigHash);
  killSessionsOfSig(sigHash);
}

export function banDevice(deviceId, { reason = '', by = '', userId = null } = {}) {
  const id = normalizeDeviceId(deviceId);
  if (!id) return { error: '设备标识无效' };
  const known = db.prepare('SELECT last_user_id, sig_hash FROM banned_devices WHERE device_id = ?').get(id);
  const ownerId = Number(userId) || Number(known?.last_user_id) || null;
  const sigHash = String(known?.sig_hash || '');
  db.prepare(
    `INSERT INTO banned_devices (device_id, sig_hash, reason, banned_by, banned_at, last_seen_at, last_user_id, last_ip, last_ua)
     VALUES (?, ?, ?, ?, ?, NULL, ?, '', '')
     ON CONFLICT(device_id) DO UPDATE SET
       reason = excluded.reason, banned_by = excluded.banned_by, banned_at = excluded.banned_at,
       sig_hash = CASE WHEN excluded.sig_hash != '' THEN excluded.sig_hash ELSE banned_devices.sig_hash END`
  ).run(
    id, sigHash, String(reason || '').slice(0, 200), String(by || '').slice(0, 32), now(),
    ownerId
  );
  if (sigHash) banAllSigRows(sigHash, { reason, by, bannedAt: now() });
  // 立即下线该设备上所有已登记用户的会话
  for (const u of usersOfDevice(id)) {
    try { db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id); } catch { /* ignore */ }
  }
  return { ok: true };
}

/** 直接按特征指纹封禁（设备行缺失或只有 sig 行时） */
export function banSig(sig, { reason = '', by = '' } = {}) {
  const sigHash = normalizeDeviceSig(sig);
  if (!sigHash) return { error: '指纹无效' };
  const withId = db.prepare(
    'SELECT device_id, last_user_id FROM banned_devices WHERE sig_hash = ? AND device_id != \'\' LIMIT 1'
  ).get(sigHash);
  if (withId) return banDevice(withId.device_id, { reason, by, userId: withId.last_user_id ?? null });
  const t = now();
  db.prepare(
    `UPDATE banned_devices SET banned_at = ?, reason = ?, banned_by = ? WHERE sig_hash = ? AND banned_at = 0`
  ).run(t, String(reason || '').slice(0, 200), String(by || '').slice(0, 32), sigHash);
  if (!db.prepare('SELECT device_id FROM banned_devices WHERE sig_hash = ? LIMIT 1').get(sigHash)) {
    db.prepare(
      `INSERT INTO banned_devices (device_id, sig_hash, reason, banned_by, banned_at, last_seen_at, last_user_id, last_ip, last_ua)
       VALUES ('', ?, ?, ?, ?, NULL, NULL, '', '')`
    ).run(sigHash, String(reason || '').slice(0, 200), String(by || '').slice(0, 32), t);
  }
  killSessionsOfSig(sigHash);
  return { ok: true };
}

/** 解封：清除该设备行及其特征指纹下的所有行（与封禁传播对称）。
 *  兼容传入特征指纹哈希（sig-only 行没有 device_id，按 sig 反查）。 */
export function unbanDevice(deviceId) {
  const id = normalizeDeviceId(deviceId);
  if (!id) return { error: '设备标识无效' };
  const row = db.prepare('SELECT sig_hash FROM banned_devices WHERE device_id = ? OR sig_hash = ?').get(id, id);
  if (!row) return { error: '该设备未被封禁' };
  const sigHash = String(row.sig_hash || '');
  const r = sigHash
    ? db.prepare('DELETE FROM banned_devices WHERE device_id = ? OR sig_hash = ?').run(id, sigHash)
    : db.prepare('DELETE FROM banned_devices WHERE device_id = ?').run(id);
  if (!r.changes) return { error: '该设备未被封禁' };
  return { ok: true };
}

export function listBannedDevices({ q = '', limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (q) {
    where.push('(bd.last_ip LIKE ? OR bd.last_ua LIKE ? OR u.nickname LIKE ? OR bd.device_id = ? OR bd.sig_hash = ?)');
    const like = `%${String(q).replace(/[%_]/g, (m) => `\\${m}`)}%`;
    params.push(like, like, like, String(q).trim(), String(q).trim());
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(
    `SELECT COUNT(*) AS n FROM banned_devices bd LEFT JOIN users u ON u.id = bd.last_user_id ${clause}`
  ).get(...params)?.n || 0;
  const rows = db.prepare(
    `SELECT bd.*, u.nickname AS last_user_nickname
     FROM banned_devices bd LEFT JOIN users u ON u.id = bd.last_user_id
     ${clause}
     ORDER BY CASE WHEN bd.banned_at > 0 THEN 0 ELSE 1 END, bd.banned_at DESC, bd.last_seen_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, Math.min(Number(limit) || 50, 200), Math.max(Number(offset) || 0, 0));
  return {
    total,
    devices: rows.map((r) => ({
      deviceId: r.device_id,
      sigHash: r.sig_hash || '',
      banned: Number(r.banned_at || 0) > 0,
      reason: r.reason || '',
      bannedBy: r.banned_by || '',
      bannedAt: r.banned_at || null,
      lastSeenAt: r.last_seen_at || null,
      lastUserId: r.last_user_id || null,
      lastUserNickname: r.last_user_nickname || '',
      lastIp: r.last_ip || '',
      lastUa: r.last_ua || '',
    })),
  };
}
