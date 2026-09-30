// 平台能力：账号安全、群治理、内容安全、备份、反馈、搜索、运营
import crypto from 'node:crypto';
import { db, stmts } from './db.js';

function now() {
  return Date.now();
}

function parseJson(raw, def = null) {
  if (raw == null || raw === '') return def;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return def;
  }
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// ---------- 登录记录 / 异常提醒 ----------
export function recordLogin({ userId, token = '', ip = '', userAgent = '', status = 'ok' }) {
  const ua = String(userAgent || '').slice(0, 300);
  const device = detectDevice(ua);
  const anomalyInfo = detectAnomaly(userId, ip, ua);
  try {
    db.prepare(
      `INSERT INTO login_history (user_id, token, ip, user_agent, device, city, status, anomaly, anomaly_note, created_at)
       VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?)`
    ).run(
      userId, String(token || '').slice(0, 64), String(ip || '').slice(0, 64), ua, device,
      status, anomalyInfo.anomaly ? 1 : 0, anomalyInfo.note || '', now()
    );
  } catch { /* ignore */ }
  return anomalyInfo;
}

function detectDevice(ua) {
  const s = String(ua || '');
  if (/iPhone|iPad|iPod/i.test(s)) return 'iOS';
  if (/Android/i.test(s)) return 'Android';
  if (/Windows/i.test(s)) return 'Windows';
  if (/Macintosh|Mac OS/i.test(s)) return 'macOS';
  if (/Linux/i.test(s)) return 'Linux';
  return s ? '未知设备' : '未知';
}

function detectAnomaly(userId, ip, ua) {
  try {
    const recent = db.prepare(
      'SELECT ip, user_agent FROM login_history WHERE user_id = ? AND status = ? ORDER BY id DESC LIMIT 20'
    ).all(userId, 'ok');
    if (!recent.length) return { anomaly: false, note: '' };
    const knownIp = recent.some((r) => r.ip === ip);
    const knownUa = recent.some((r) => r.user_agent === ua);
    if (!knownIp && !knownUa) {
      return { anomaly: true, note: `新设备/新网络登录（${detectDevice(ua)}）` };
    }
    if (!knownIp) {
      return { anomaly: true, note: `异地网络登录（IP ${ip || '未知'}）` };
    }
    return { anomaly: false, note: '' };
  } catch {
    return { anomaly: false, note: '' };
  }
}

export function listLoginHistory(userId, limit = 30) {
  const rows = db.prepare(
    'SELECT * FROM login_history WHERE user_id = ? ORDER BY id DESC LIMIT ?'
  ).all(Number(userId), Math.min(Number(limit) || 30, 100));
  return rows.map((r) => ({
    id: r.id,
    ip: r.ip,
    device: r.device,
    userAgent: r.user_agent,
    status: r.status,
    anomaly: Boolean(r.anomaly),
    anomalyNote: r.anomaly_note || '',
    createdAt: r.created_at,
  }));
}

// ---------- 找回密码 / 恢复码 ----------
export function generateRecoveryCode(userId) {
  const code = crypto.randomBytes(6).toString('hex').toUpperCase();
  db.prepare(
    'INSERT INTO password_resets (user_id, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).run(Number(userId), sha256(code), now() + 365 * 86400_000, now());
  return code;
}

export function requestPasswordReset(nickname) {
  const user = stmts.userByName.get(String(nickname || '').trim());
  if (!user) return { ok: true, message: '若昵称存在，已生成找回指引' };
  // 真实产品应走邮件/短信；演示环境生成一次性找回码（存 hash）
  const code = generateRecoveryCode(user.id);
  return {
    ok: true,
    message: '已生成找回码，请使用找回码重置密码',
    // 仅演示返回；生产应走带外渠道
    recoveryCode: code,
  };
}

export function resetPasswordWithCode(nickname, code, newPassword) {
  const user = stmts.userByName.get(String(nickname || '').trim());
  if (!user) return { error: '账号不存在' };
  const next = String(newPassword || '');
  if (next.length < 6 || next.length > 64) return { error: '新密码需要 6-64 位' };
  if (/\s/.test(next)) return { error: '新密码不能包含空格' };
  const row = db.prepare(
    `SELECT * FROM password_resets
     WHERE user_id = ? AND code_hash = ? AND used_at IS NULL AND expires_at > ?
     ORDER BY id DESC LIMIT 1`
  ).get(user.id, sha256(String(code || '').trim()), now());
  if (!row) return { error: '找回码无效或已过期' };
  // 与 auth.hashPassword 相同格式
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(next, salt, 32).toString('hex');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(`${salt}:${hash}`, user.id);
  db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(now(), row.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  return { ok: true, message: '密码已重置，请重新登录' };
}

export function revokeRecoveryCodes(userId) {
  db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
    .run(now(), Number(userId));
  return { ok: true };
}

// ---------- 账号注销 ----------
export function requestAccountDeletion(userId, reason = '') {
  db.prepare(
    `INSERT INTO account_deletions (user_id, reason, status, requested_at)
     VALUES (?, ?, 'pending', ?)`
  ).run(Number(userId), String(reason || '').slice(0, 500), now());
  return { ok: true, message: '注销申请已提交，将立即清理账号数据' };
}

export function deleteAccountData(userId) {
  const uid = Number(userId);
  if (!uid) return { error: '无效用户' };
  const tables = [
    ['sessions', 'user_id'],
    ['friends', 'user_id'],
    ['friends', 'friend_id'],
    ['moment_likes', 'user_id'],
    ['moment_comments', 'user_id'],
    ['moment_visitors', 'visitor_id'],
    ['chat_reads', 'user_id'],
    ['chat_prefs', 'user_id'],
    ['favorites', 'user_id'],
    ['password_resets', 'user_id'],
    ['login_history', 'user_id'],
    ['group_announcement_reads', 'user_id'],
    ['group_join_requests', 'user_id'],
    ['cloud_backups', 'user_id'],
    ['feedback', 'user_id'],
    ['reports', 'reporter_id'],
    ['group_members', 'user_id'],
  ];
  for (const [table, col] of tables) {
    try {
      db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(uid);
    } catch { /* ignore */ }
  }
  try {
    db.prepare('DELETE FROM moments WHERE user_id = ?').run(uid);
  } catch { /* ignore */ }
  try {
    db.prepare("UPDATE groups SET owner_id = NULL WHERE owner_id = ?").run(uid);
  } catch { /* ignore */ }
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  } catch (e) {
    return { error: '删除账号失败: ' + e.message };
  }
  db.prepare(
    `INSERT INTO account_deletions (user_id, reason, status, requested_at, processed_at)
     VALUES (?, 'auto', 'done', ?, ?)`
  ).run(uid, now(), now());
  return { ok: true, message: '账号与相关数据已删除' };
}

// ---------- 敏感内容过滤 ----------
const SENSITIVE_PATTERNS = [
  /赌博|博彩|赌场|六合彩/,
  /毒品|冰毒|摇头丸|K粉/,
  /枪支|军火|买卖枪/,
  /诈骗|刷单|返利|杀猪盘/,
  /色情|约炮|裸聊|援交/,
  /办证|代开发票|套现/,
  /法轮|暴恐|恐怖袭击/,
];

export function checkSensitiveContent(text, kind = 'text') {
  const s = String(text || '');
  const hits = [];
  for (const re of SENSITIVE_PATTERNS) {
    const m = s.match(re);
    if (m) hits.push(m[0]);
  }
  if (kind === 'text' && hits.length) {
    return { blocked: true, reason: `包含敏感词：${hits.slice(0, 3).join('、')}`, hits };
  }
  return { blocked: false, hits };
}

export function filterContentOrError(text) {
  const r = checkSensitiveContent(text, 'text');
  if (r.blocked) return { error: r.reason };
  return { ok: true };
}

// ---------- 举报与处理 ----------
export function createReport({ reporterId, targetType, targetId, category, detail }) {
  const cats = ['spam', 'abuse', 'porn', 'fraud', 'illegal', 'other'];
  const cat = cats.includes(category) ? category : 'other';
  const r = db.prepare(
    `INSERT INTO reports (reporter_id, target_type, target_id, category, detail, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(
    Number(reporterId),
    String(targetType || 'user').slice(0, 32),
    String(targetId || '').slice(0, 64),
    cat,
    String(detail || '').slice(0, 1000),
    now(), now()
  );
  return { ok: true, id: Number(r.lastInsertRowid) };
}

export function listMyReports(userId) {
  return db.prepare(
    'SELECT * FROM reports WHERE reporter_id = ? ORDER BY id DESC LIMIT 50'
  ).all(Number(userId)).map(mapReport);
}

function mapReport(r) {
  return {
    id: r.id,
    reporterId: r.reporter_id,
    targetType: r.target_type,
    targetId: r.target_id,
    category: r.category,
    detail: r.detail,
    status: r.status,
    handlerNote: r.handler_note || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    statusLabel: r.status === 'pending' ? '待处理'
      : r.status === 'processing' ? '处理中'
        : r.status === 'done' ? '已处理'
          : r.status === 'rejected' ? '未违规' : r.status,
  };
}

export function handleReport(reportId, { status, handlerNote, adminId }) {
  const map = {
    pending: 'pending',
    processing: 'processing',
    done: 'done',
    rejected: 'rejected',
  };
  const st = map[status] || 'processing';
  db.prepare(
    'UPDATE reports SET status = ?, handler_note = ?, updated_at = ? WHERE id = ?'
  ).run(st, String(handlerNote || '').slice(0, 500), now(), Number(reportId));
  try {
    logError({ userId: adminId, feature: 'report-handle', message: `report#${reportId} -> ${st}` });
  } catch { /* ignore */ }
  return { ok: true, report: mapReport(db.prepare('SELECT * FROM reports WHERE id = ?').get(Number(reportId))) };
}

// ---------- 意见反馈 ----------
export function createFeedback({ userId, category, content, contact }) {
  const cats = ['bug', 'suggestion', 'ui', 'account', 'other'];
  const cat = cats.includes(category) ? category : 'suggestion';
  const r = db.prepare(
    `INSERT INTO feedback (user_id, category, content, contact, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'open', ?, ?)`
  ).run(
    Number(userId), cat,
    String(content || '').slice(0, 2000),
    String(contact || '').slice(0, 100),
    now(), now()
  );
  return { ok: true, id: Number(r.lastInsertRowid) };
}

export function listMyFeedback(userId) {
  return db.prepare(
    'SELECT * FROM feedback WHERE user_id = ? ORDER BY id DESC LIMIT 50'
  ).all(Number(userId)).map((r) => ({
    id: r.id,
    category: r.category,
    content: r.content,
    contact: r.contact,
    status: r.status,
    reply: r.reply || '',
    createdAt: r.created_at,
    statusLabel: r.status === 'open' ? '已提交'
      : r.status === 'replied' ? '已回复'
        : r.status === 'closed' ? '已关闭' : r.status,
  }));
}

export function replyFeedback(feedbackId, reply) {
  db.prepare(
    "UPDATE feedback SET reply = ?, status = 'replied', updated_at = ? WHERE id = ?"
  ).run(String(reply || '').slice(0, 1000), now(), Number(feedbackId));
  return { ok: true };
}

export const FAQ_LIST = [
  { q: '如何找回密码？', a: '在登录页点「找回密码」，用注册时保存的找回码重置。也可在「设置 → 账号与安全」重新生成找回码。' },
  { q: '如何注销账号？', a: '设置 → 账号与安全 → 注销账号。确认后会删除账号、好友、朋友圈与聊天相关数据，操作不可恢复。' },
  { q: '如何导出聊天记录？', a: '设置 → 聊天 → 聊天记录迁移与备份，可导出含消息与媒体索引的 JSON，或备份到云端以便换机恢复。' },
  { q: '群主如何管理群？', a: '群设置中，群主/管理员可改群名、移出成员、审批入群、发群公告。群主可设置「需要验证才能入群」。' },
  { q: '朋友圈如何设置不可见？', a: '隐私设置支持「不给谁看」「仅好友可见」「最近三天/半年」，发布时也可单独设置可见范围。' },
  { q: '举报后多久处理？', a: '提交举报后可在「帮助与反馈 → 我的举报」查看进度，一般 1–3 个工作日内更新处理结果。' },
  { q: '如何开启高对比度？', a: '设置 → 通用 · 显示 → 高对比度。也可允许页面缩放，方便放大阅读。' },
  { q: '消息搜索支持筛选吗？', a: '聊天记录搜索支持关键词、时间范围与类型（文本/图片/文件/语音）筛选。' },
];

// ---------- 朋友圈访客 ----------
export function recordMomentVisit(momentId, visitorId) {
  const mid = Number(momentId);
  const vid = Number(visitorId);
  if (!mid || !vid) return;
  try {
    db.prepare(
      'INSERT OR IGNORE INTO moment_visitors (moment_id, visitor_id, created_at) VALUES (?, ?, ?)'
    ).run(mid, vid, now());
  } catch { /* ignore */ }
}

export function listMomentVisitors(momentId, ownerId) {
  const mid = Number(momentId);
  const moment = stmts.momentById.get(mid);
  if (!moment || Number(moment.user_id) !== Number(ownerId)) {
    return { error: '无权查看' };
  }
  const rows = db.prepare(
    `SELECT v.created_at, u.id, u.nickname, u.avatar, u.avatar_color
     FROM moment_visitors v JOIN users u ON u.id = v.visitor_id
     WHERE v.moment_id = ? ORDER BY v.created_at DESC LIMIT 100`
  ).all(mid);
  return {
    visitors: rows.map((r) => ({
      id: r.id,
      nickname: r.nickname,
      avatar: r.avatar,
      avatarColor: r.avatar_color,
      visitedAt: r.created_at,
    })),
    count: rows.length,
  };
}

// ---------- 群公告已读 ----------
export function markAnnouncementRead(groupId, userId) {
  db.prepare(
    `INSERT INTO group_announcement_reads (group_id, user_id, read_at)
     VALUES (?, ?, ?)
     ON CONFLICT(group_id, user_id) DO UPDATE SET read_at = excluded.read_at`
  ).run(Number(groupId), Number(userId), now());
  return { ok: true };
}

export function listAnnouncementReads(groupId, requesterId) {
  const g = stmts.groupById.get(Number(groupId));
  if (!g) return { error: '群不存在' };
  // 群主/管理员可看
  const members = stmts.listGroupMembers.all(Number(groupId)) || [];
  const me = members.find((m) => Number(m.user_id) === Number(requesterId));
  const role = me?.role || 'member';
  if (role !== 'owner' && role !== 'admin') {
    return { error: '仅群主或管理员可查看已读情况' };
  }
  const reads = db.prepare(
    `SELECT r.read_at, u.id, u.nickname, u.avatar FROM group_announcement_reads r
     JOIN users u ON u.id = r.user_id WHERE r.group_id = ? ORDER BY r.read_at DESC`
  ).all(Number(groupId));
  const humanMembers = members.filter((m) => m.user_id);
  const readIds = new Set(reads.map((r) => Number(r.id)));
  return {
    reads: reads.map((r) => ({
      id: r.id, nickname: r.nickname, avatar: r.avatar, readAt: r.read_at,
    })),
    unread: humanMembers
      .filter((m) => !readIds.has(Number(m.user_id)))
      .map((m) => ({ id: Number(m.user_id), nickname: m.nickname })),
    total: humanMembers.length,
  };
}

// ---------- 入群验证 ----------
export function setGroupJoinApproval(groupId, ownerId, requireApproval) {
  const g = stmts.groupById.get(Number(groupId));
  if (!g) return { error: '群不存在' };
  if (Number(g.owner_id) !== Number(ownerId)) return { error: '仅群主可设置入群验证' };
  db.prepare('UPDATE groups SET require_approval = ? WHERE id = ?')
    .run(requireApproval ? 1 : 0, Number(groupId));
  return { ok: true, requireApproval: Boolean(requireApproval) };
}

export function requestJoinGroup(groupId, userId, reason = '') {
  const g = stmts.groupById.get(Number(groupId));
  if (!g) return { error: '群不存在' };
  const existing = stmts.listGroupMembers.all(Number(groupId)) || [];
  if (existing.some((m) => Number(m.user_id) === Number(userId))) {
    return { error: '你已在群中' };
  }
  if (!g.require_approval) {
    stmts.insertGroupMember.run(Number(groupId), Number(userId), null, '', 'member', now());
    return { ok: true, autoJoined: true };
  }
  const pending = db.prepare(
    `SELECT id FROM group_join_requests WHERE group_id = ? AND user_id = ? AND status = 'pending'`
  ).get(Number(groupId), Number(userId));
  if (pending) return { ok: true, pending: true, id: pending.id };
  const r = db.prepare(
    `INSERT INTO group_join_requests (group_id, user_id, reason, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)`
  ).run(Number(groupId), Number(userId), String(reason || '').slice(0, 200), now());
  return { ok: true, pending: true, id: Number(r.lastInsertRowid) };
}

export function listJoinRequests(groupId, requesterId) {
  const g = stmts.groupById.get(Number(groupId));
  if (!g) return { error: '群不存在' };
  const members = stmts.listGroupMembers.all(Number(groupId)) || [];
  const me = members.find((m) => Number(m.user_id) === Number(requesterId));
  const role = me?.role || (Number(g.owner_id) === Number(requesterId) ? 'owner' : 'member');
  if (role !== 'owner' && role !== 'admin') return { error: '无权查看' };
  const rows = db.prepare(
    `SELECT r.*, u.nickname, u.avatar FROM group_join_requests r
     JOIN users u ON u.id = r.user_id
     WHERE r.group_id = ? ORDER BY r.id DESC LIMIT 50`
  ).all(Number(groupId));
  return {
    requests: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      nickname: r.nickname,
      avatar: r.avatar,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
    })),
  };
}

export function handleJoinRequest(requestId, { approve, handlerId }) {
  const row = db.prepare('SELECT * FROM group_join_requests WHERE id = ?').get(Number(requestId));
  if (!row) return { error: '申请不存在' };
  if (row.status !== 'pending') return { error: '已处理' };
  const members = stmts.listGroupMembers.all(row.group_id) || [];
  const me = members.find((m) => Number(m.user_id) === Number(handlerId));
  const g = stmts.groupById.get(row.group_id);
  const role = me?.role || (Number(g?.owner_id) === Number(handlerId) ? 'owner' : 'member');
  if (role !== 'owner' && role !== 'admin') return { error: '无权处理' };

  if (approve) {
    stmts.insertGroupMember.run(row.group_id, row.user_id, null, '', 'member', now());
    db.prepare("UPDATE group_join_requests SET status = 'approved', handled_at = ?, handled_by = ? WHERE id = ?")
      .run(now(), Number(handlerId), Number(requestId));
    return { ok: true, status: 'approved' };
  }
  db.prepare("UPDATE group_join_requests SET status = 'rejected', handled_at = ?, handled_by = ? WHERE id = ?")
    .run(now(), Number(handlerId), Number(requestId));
  return { ok: true, status: 'rejected' };
}

// ---------- 群管理员权限 ----------
export function setMemberRole(groupId, ownerId, targetUserId, role) {
  const g = stmts.groupById.get(Number(groupId));
  if (!g) return { error: '群不存在' };
  if (Number(g.owner_id) !== Number(ownerId)) return { error: '仅群主可设置管理员' };
  const allowed = ['member', 'admin'];
  const next = allowed.includes(role) ? role : 'member';
  if (Number(targetUserId) === Number(ownerId)) return { error: '群主无需设置' };
  db.prepare(
    'UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?'
  ).run(next, Number(groupId), Number(targetUserId));
  return { ok: true, role: next };
}

export function canManageGroup(groupId, userId) {
  const g = stmts.groupById.get(Number(groupId));
  if (!g) return { role: 'member', can: false };
  if (Number(g.owner_id) === Number(userId)) return { role: 'owner', can: true };
  const members = stmts.listGroupMembers.all(Number(groupId)) || [];
  const me = members.find((m) => Number(m.user_id) === Number(userId));
  const role = me?.role || 'member';
  return { role, can: role === 'owner' || role === 'admin' };
}

export function canEditGroupMeta(groupId, userId) {
  const { role, can } = canManageGroup(groupId, userId);
  // 改群名：群主/管理员
  return { role, can };
}

export function canKickMember(groupId, userId, targetUserId) {
  const { role, can } = canManageGroup(groupId, userId);
  if (!can) return { can: false, reason: '无管理权限' };
  const g = stmts.groupById.get(Number(groupId));
  if (Number(targetUserId) === Number(g?.owner_id)) return { can: false, reason: '不能移出群主' };
  if (role === 'admin') {
    const members = stmts.listGroupMembers.all(Number(groupId)) || [];
    const t = members.find((m) => Number(m.user_id) === Number(targetUserId));
    if (t?.role === 'admin') return { can: false, reason: '管理员不能移出其他管理员' };
    if (t?.role === 'owner') return { can: false, reason: '不能移出群主' };
  }
  return { can: true, role };
}

// ---------- 群相册 ----------
export function listGroupAlbum(groupId, requesterId, limit = 100) {
  const conv = `grp_${Number(groupId)}`;
  const { can } = canManageGroup(groupId, requesterId);
  const members = stmts.listGroupMembers.all(Number(groupId)) || [];
  const isMember = members.some((m) => Number(m.user_id) === Number(requesterId));
  if (!isMember && !can) return { error: '仅群成员可查看群相册' };

  const rows = db.prepare(
    `SELECT id, sender_name, sender_id, media_type, media_url, content, created_at
     FROM messages
     WHERE conversation_id = ? AND media_type = 'image' AND media_url IS NOT NULL AND recalled = 0
     ORDER BY id DESC LIMIT ?`
  ).all(conv, Math.min(Number(limit) || 100, 200));
  return {
    images: rows.map((r) => ({
      id: r.id,
      url: r.media_url,
      senderName: r.sender_name,
      senderId: r.sender_id,
      createdAt: r.created_at,
      thumb: r.media_url,
    })),
    count: rows.length,
  };
}

// ---------- 聊天记录导出 / 云备份 ----------
export function exportChatHistory(userId, { conversationId = null, limit = 500 } = {}) {
  const uid = Number(userId);
  const lim = Math.min(Number(limit) || 500, 2000);
  let messages = [];
  if (conversationId) {
    messages = db.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?'
    ).all(String(conversationId), lim).reverse();
    // 权限：私聊双方 / 群成员
    const conv = String(conversationId);
    if (conv.startsWith('grp_')) {
      const gid = Number(conv.replace(/^grp_/, ''));
      const members = stmts.listGroupMembers.all(gid) || [];
      if (!members.some((m) => Number(m.user_id) === uid)) {
        return { error: '无权导出该会话' };
      }
    } else if (conv.startsWith('p:')) {
      const parts = conv.split(':').map(Number).filter(Boolean);
      if (!parts.includes(uid)) return { error: '无权导出该会话' };
    }
  } else {
    // 本人相关：私聊会话 + 所在群
    const prefs = db.prepare(
      'SELECT conversation_id FROM chat_prefs WHERE user_id = ?'
    ).all(uid).map((r) => r.conversation_id);
    const groups = db.prepare(
      'SELECT group_id FROM group_members WHERE user_id = ?'
    ).all(uid).map((r) => `grp_${r.group_id}`);
    const convs = new Set([...prefs, ...groups]);
    for (const c of convs) {
      const rows = db.prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 200'
      ).all(c);
      messages.push(...rows);
    }
    messages.sort((a, b) => a.id - b.id);
    if (messages.length > lim) messages = messages.slice(-lim);
  }
  const payload = {
    version: 1,
    exportedAt: now(),
    userId: uid,
    conversationId: conversationId || 'all',
    count: messages.length,
    messages: messages.map((m) => ({
      id: m.id,
      conversationId: m.conversation_id,
      senderType: m.sender_type,
      senderId: m.sender_id,
      senderName: m.sender_name,
      content: m.content,
      mediaType: m.media_type,
      mediaUrl: m.media_url,
      createdAt: m.created_at,
      recalled: Boolean(m.recalled),
    })),
  };
  return { ok: true, payload };
}

export function saveCloudBackup(userId, payload) {
  const text = JSON.stringify(payload || {});
  if (text.length > 2_000_000) return { error: '备份内容过大' };
  db.prepare(
    'INSERT INTO cloud_backups (user_id, kind, payload, size, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(Number(userId), 'full', text, text.length, now());
  return { ok: true, size: text.length };
}

export function listCloudBackups(userId) {
  return db.prepare(
    'SELECT id, kind, size, created_at FROM cloud_backups WHERE user_id = ? ORDER BY id DESC LIMIT 20'
  ).all(Number(userId)).map((r) => ({
    id: r.id, kind: r.kind, size: r.size, createdAt: r.created_at,
  }));
}

export function restoreCloudBackup(userId, backupId) {
  const row = db.prepare(
    'SELECT * FROM cloud_backups WHERE id = ? AND user_id = ?'
  ).get(Number(backupId), Number(userId));
  if (!row) return { error: '备份不存在' };
  try {
    return { ok: true, payload: JSON.parse(row.payload) };
  } catch {
    return { error: '备份数据损坏' };
  }
}

// ---------- 搜索增强 ----------
export function searchMessagesEnhanced(userId, { q, conversationId, mediaType, from, to, limit = 30 } = {}) {
  const uid = Number(userId);
  const lim = Math.min(Number(limit) || 30, 100);
  const like = `%${String(q || '').replace(/[%_]/g, (m) => '\\' + m)}%`;
  const params = [uid];
  let sql = `
    SELECT m.* FROM messages m
    LEFT JOIN chat_prefs p ON p.conversation_id = m.conversation_id AND p.user_id = ?
    WHERE m.recalled = 0
      AND (p.cleared_before IS NULL OR m.id > p.cleared_before)
      AND (
        m.conversation_id IS NULL
        OR m.conversation_id LIKE 'grp\\_%' ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM group_members gm
          WHERE gm.user_id = ? AND ('grp_' || gm.group_id) = m.conversation_id
        )
        OR (
          m.conversation_id LIKE ? ESCAPE '\\'
          OR m.conversation_id LIKE ? ESCAPE '\\'
        )
      )
  `;
  params.push(uid, `p:${uid}:%`, `%:p:${uid}`);
  if (q) {
    sql += ' AND (m.content LIKE ? OR m.sender_name LIKE ?)';
    params.push(like, like);
  }
  if (conversationId) {
    sql += ' AND m.conversation_id = ?';
    params.push(String(conversationId));
  }
  if (mediaType === 'image' || mediaType === 'file' || mediaType === 'voice' || mediaType === 'video') {
    sql += ' AND m.media_type = ?';
    params.push(mediaType);
  } else if (mediaType === 'text') {
    sql += ' AND (m.media_type IS NULL OR m.media_type = \'\')';
  }
  if (from) {
    sql += ' AND m.created_at >= ?';
    params.push(Number(from));
  }
  if (to) {
    sql += ' AND m.created_at <= ?';
    params.push(Number(to));
  }
  sql += ' ORDER BY m.id DESC LIMIT ?';
  params.push(lim);
  const rows = db.prepare(sql).all(...params);
  return {
    messages: rows.map((m) => ({
      id: m.id,
      conversationId: m.conversation_id,
      senderName: m.sender_name,
      senderId: m.sender_id,
      content: m.content,
      mediaType: m.media_type,
      mediaUrl: m.media_url,
      createdAt: m.created_at,
    })),
  };
}

export function listFavoritesByType(userId, type) {
  const uid = Number(userId);
  const rows = db.prepare(
    'SELECT * FROM favorites WHERE user_id = ? ORDER BY id DESC LIMIT 200'
  ).all(uid);
  let list = rows.map((r) => ({
    id: r.id,
    content: r.content,
    kind: r.kind || 'text',
    url: r.media_url || null,
    fromName: r.from_name || '',
    createdAt: r.created_at,
  }));
  if (type && type !== 'all') {
    list = list.filter((x) => x.kind === type);
  }
  return { favorites: list, types: summarizeFavTypes(rows) };
}

function summarizeFavTypes(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = r.kind || 'text';
    map.set(k, (map.get(k) || 0) + 1);
  }
  return { all: rows.length, ...Object.fromEntries(map) };
}

// ---------- 错误监控 ----------
export function logError({ userId = null, feature = '', message, stack = '', meta = {} } = {}) {
  try {
    db.prepare(
      'INSERT INTO error_logs (user_id, feature, message, stack, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      userId ? Number(userId) : null,
      String(feature || '').slice(0, 64),
      String(message || '').slice(0, 500),
      String(stack || '').slice(0, 2000),
      JSON.stringify(meta || {}).slice(0, 1000),
      now()
    );
  } catch { /* ignore */ }
}

export function listErrorLogs({ feature, limit = 50 } = {}) {
  const lim = Math.min(Number(limit) || 50, 200);
  if (feature) {
    return db.prepare(
      'SELECT * FROM error_logs WHERE feature = ? ORDER BY id DESC LIMIT ?'
    ).all(String(feature), lim).map(mapError);
  }
  return db.prepare('SELECT * FROM error_logs ORDER BY id DESC LIMIT ?').all(lim).map(mapError);
}

function mapError(r) {
  return {
    id: r.id,
    userId: r.user_id,
    feature: r.feature,
    message: r.message,
    stack: r.stack,
    meta: parseJson(r.meta, {}),
    createdAt: r.created_at,
  };
}

// ---------- 管理后台 ----------
export function isPlatformAdmin(userId) {
  // 仅 settings.isAdmin 为真；不默认给 id=1
  try {
    const r = stmts.getUserSettingsRaw.get(Number(userId));
    const s = parseJson(r?.settings, {});
    return s.isAdmin === true;
  } catch {
    return false;
  }
}

export function requireAdmin(req, res, next) {
  // 延迟导入避免循环
  const uid = req.user?.id;
  if (!uid || !isPlatformAdmin(uid)) {
    res.status(403).json({ error: '需要管理员权限' });
    return;
  }
  next();
}

export function adminOverview() {
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get()?.n || 0;
  const groups = db.prepare('SELECT COUNT(*) AS n FROM groups').get()?.n || 0;
  const messages = db.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n || 0;
  const moments = db.prepare('SELECT COUNT(*) AS n FROM moments').get()?.n || 0;
  const pendingReports = db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'pending'").get()?.n || 0;
  const openFeedback = db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE status = 'open'").get()?.n || 0;
  const errors24h = db.prepare(
    'SELECT COUNT(*) AS n FROM error_logs WHERE created_at > ?'
  ).get(now() - 86400_000)?.n || 0;
  const logins24h = db.prepare(
    'SELECT COUNT(*) AS n FROM login_history WHERE created_at > ?'
  ).get(now() - 86400_000)?.n || 0;
  const anomalies24h = db.prepare(
    'SELECT COUNT(*) AS n FROM login_history WHERE created_at > ? AND anomaly = 1'
  ).get(now() - 86400_000)?.n || 0;
  const recentUsers = db.prepare(
    'SELECT id, nickname, avatar, created_at FROM users ORDER BY id DESC LIMIT 10'
  ).all().map((u) => ({
    id: u.id,
    nickname: u.nickname,
    avatar: u.avatar,
    createdAt: u.created_at,
  }));
  return {
    users,
    groups,
    messages,
    moments,
    pendingReports,
    openFeedback,
    errors24h,
    logins24h,
    anomalies24h,
    recentUsers,
  };
}

export function adminListUsers(q = '', limit = 50) {
  const like = `%${String(q || '').replace(/[%_]/g, (m) => '\\' + m)}%`;
  return db.prepare(
    `SELECT id, nickname, avatar, wxid, created_at FROM users
     WHERE nickname LIKE ? OR wxid LIKE ? ORDER BY id DESC LIMIT ?`
  ).all(like, like, Math.min(Number(limit) || 50, 200));
}

export function adminListReports(status = '', limit = 50) {
  if (status) {
    return db.prepare(
      'SELECT * FROM reports WHERE status = ? ORDER BY id DESC LIMIT ?'
    ).all(status, Math.min(Number(limit) || 50, 200)).map(mapReport);
  }
  return db.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT ?')
    .all(Math.min(Number(limit) || 50, 200)).map(mapReport);
}

export function adminListFeedback(status = '', limit = 50) {
  const sql = status
    ? 'SELECT * FROM feedback WHERE status = ? ORDER BY id DESC LIMIT ?'
    : 'SELECT * FROM feedback ORDER BY id DESC LIMIT ?';
  const params = status
    ? [status, Math.min(Number(limit) || 50, 200)]
    : [Math.min(Number(limit) || 50, 200)];
  return db.prepare(sql).all(...params).map((r) => ({
    id: r.id,
    userId: r.user_id,
    category: r.category,
    content: r.content,
    contact: r.contact,
    status: r.status,
    reply: r.reply || '',
    createdAt: r.created_at,
  }));
}
