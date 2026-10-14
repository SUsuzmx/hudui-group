// 群聊种子数据: 仅保留默认主群(纯真人)。群聊不再有 AI 群友, 业务演示群已移除。
import { stmts, db } from './db.js';

export const DEFAULT_GROUP_KIND = 'main';

export const SEED_GROUPS = [
  {
    kind: 'main',
    name: 'WeChat',
    avatars: ['👥'],
    seed: [],
  },
];

// 启动时清理的无关/测试群（按名称或 kind）
// product / work 为早期带 AI 群友的演示群, 现已下线, 启动时一并清掉。
const UNWANTED_GROUP_KINDS = new Set(['family', 'climb', 'game', 'product', 'work']);
const UNWANTED_GROUP_NAME_RE = /(验收改名|爬山|开黑|家庭群|产品设计小分队|工作对接群)/;

function deleteGroupDeep(groupId, convId) {
  try { db.prepare('DELETE FROM group_members WHERE group_id = ?').run(groupId); } catch { /* ignore */ }
  try { db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(convId); } catch { /* ignore */ }
  try { db.prepare('DELETE FROM chat_prefs WHERE conversation_id = ?').run(convId); } catch { /* ignore */ }
  try { db.prepare('DELETE FROM chat_reads WHERE conversation_id = ?').run(convId); } catch { /* ignore */ }
  try { db.prepare('DELETE FROM groups WHERE id = ?').run(groupId); } catch { /* ignore */ }
}

/** 清掉历史遗留的 AI 群成员(早期版本写入过 persona_key), 群聊只保留真人 */
function cleanupAiGroupMembers() {
  try {
    return db.prepare("DELETE FROM group_members WHERE persona_key IS NOT NULL AND user_id IS NULL").run().changes || 0;
  } catch {
    return 0;
  }
}

/**
 * 清掉群会话里的历史 AI 消息(早期版本 AI 群友发的), 群聊变成干净的真人会话。
 * 只删群会话: grp_* 以及旧版无 conversation_id(NULL) 的默认群消息; 私聊 AI 会话不动。
 */
function cleanupAiGroupMessages() {
  try {
    return db.prepare(
      `DELETE FROM messages
        WHERE sender_type = 'ai'
          AND (conversation_id LIKE 'grp\\_%' ESCAPE '\\' OR conversation_id IS NULL)`
    ).run().changes || 0;
  } catch {
    return 0;
  }
}

function cleanupUnwantedGroups() {
  const removed = [];
  const rows = db.prepare('SELECT id, name, kind FROM groups').all();
  for (const row of rows) {
    const name = String(row.name || '');
    const kind = String(row.kind || '');
    if (UNWANTED_GROUP_KINDS.has(kind) || UNWANTED_GROUP_NAME_RE.test(name)) {
      deleteGroupDeep(row.id, groupConvId(row.id));
      removed.push(name);
    }
  }
  return removed;
}

export function groupConvId(groupId) {
  return `grp_${groupId}`;
}

function enrichMember(m) {
  const name = m.nickname;
  if (m.userId) {
    const u = stmts.userById.get(Number(m.userId));
    return {
      ...m,
      // 群昵称优先（我在群里的昵称），否则回落账号昵称
      nickname: name || u?.nickname,
      avatar: u?.avatar || null,
      emoji: null,
      color: u?.avatar_color || '#4f6ef7',
      wxid: u?.wxid || null,
      isAI: false,
    };
  }
  // 纯昵称成员(建群时登记的展示名), 群聊不再有 AI 人设
  return {
    ...m,
    avatar: null,
    emoji: /^\p{Extended_Pictographic}$/u.test(String(name)) ? name : null,
    color: '#4f6ef7',
    isAI: false,
  };
}

export function seedGroups() {
  const now = Date.now();
  const created = [];
  try {
    const removed = cleanupUnwantedGroups();
    if (removed.length) {
      // 同步打日志, 便于运维确认清理结果
      console.log(`[groups] 已移除无关群: ${removed.join(', ')}`);
    }
    const dropped = cleanupAiGroupMembers();
    if (dropped) console.log(`[groups] 已移除历史 AI 群成员: ${dropped} 条`);
    const droppedMsgs = cleanupAiGroupMessages();
    if (droppedMsgs) console.log(`[groups] 已移除群内历史 AI 消息: ${droppedMsgs} 条`);
  } catch (e) {
    console.log(`[groups] 清理无关群失败: ${e.message}`);
  }
  for (const g of SEED_GROUPS) {
    let row = stmts.groupByKind.get(g.kind);
    if (!row) {
      const r = stmts.insertGroup.run(g.name, g.kind, JSON.stringify(g.avatars), now);
      row = stmts.groupById.get(Number(r.lastInsertRowid));
    }
    const convId = groupConvId(row.id);
    // 仅在该会话还没有消息时播种
    const has = stmts.lastGroupMessage.get(convId);
    if (!has) {
      for (const s of g.seed) {
        stmts.insertMessage.run(
          s.from, null, s.name, s.emoji, s.content, now - s.ago, null, null, convId
        );
      }
    }
    // 主群保持"全员在群"的演示语义: 全体用户落库为成员。
    // 自建群(custom)为严格成员制, 只有被邀请/审批通过才在群内。
    try {
      for (const u of stmts.allUsers.all()) {
        stmts.insertGroupMember.run(row.id, u.id, null, '', 'member', now);
      }
    } catch { /* ignore */ }
    created.push(row);
  }
  return created;
}

export function listGroups(userId = null) {
  let rows;
  if (userId) {
    // 成员制: 只返回我加入的群
    rows = stmts.listMemberGroups.all(Number(userId));
  } else {
    rows = stmts.allGroups.all();
  }
  return rows.map((g) => {
    let avatars = [];
    try { avatars = JSON.parse(g.avatars || '[]'); } catch { avatars = []; }
    const last = stmts.lastGroupMessage.get(groupConvId(g.id));
    return {
      id: g.id,
      kind: g.kind,
      name: g.name,
      avatars,
      isDefault: g.kind === DEFAULT_GROUP_KIND,
      conversationId: groupConvId(g.id),
      lastId: last?.id ?? 0,
      lastMessage: last
        ? (last.media_type === 'image' ? '[图片]'
          : last.media_type === 'video' ? '[视频]'
          : `${last.sender_name}: ${last.content}`.slice(0, 40))
        : '还没有消息, 快来打破沉默',
      lastTime: last?.created_at ?? g.created_at,
    };
  });
}

export function getGroup(groupId) {
  const g = stmts.groupById.get(Number(groupId));
  if (!g) return null;
  let avatars = [];
  try { avatars = JSON.parse(g.avatars || '[]'); } catch { avatars = []; }
  return {
    id: g.id,
    kind: g.kind,
    name: g.name,
    avatars,
    isDefault: g.kind === DEFAULT_GROUP_KIND,
    conversationId: groupConvId(g.id),
    notice: g.notice || '',
    ownerId: g.owner_id ?? null,
    requireApproval: Boolean(g.require_approval),
    announcement: g.announcement || g.notice || '',
    announcementAt: g.announcement_at || null,
  };
}

export function setGroupNotice(groupId, notice) {
  const text = String(notice || '').trim().slice(0, 500);
  // 记录公告版本时间: 已读状态按该时间判断, 新公告会让旧已读失效
  if (text) {
    db.prepare('UPDATE groups SET notice = ?, announcement_at = ? WHERE id = ?')
      .run(text, Date.now(), Number(groupId));
  } else {
    stmts.setGroupNotice.run('', Number(groupId));
  }
  return text;
}

/** 是否为群的自然人成员 */
export function isGroupMember(groupId, userId) {
  const gid = Number(groupId);
  const uid = Number(userId);
  if (!gid || !uid) return false;
  try {
    return Boolean(stmts.getGroupMemberRole.get(gid, uid));
  } catch {
    return false;
  }
}

/** 群的自然人成员(实时资料), 供 socket 成员广播/已读统计使用 */
export function groupHumanMembers(groupId) {
  const gid = Number(groupId);
  if (!gid) return [];
  try {
    return stmts.listHumanGroupMembers.all(gid) || [];
  } catch {
    return [];
  }
}

export function renameGroup(groupId, name) {
  const text = String(name || '').trim().slice(0, 20);
  if (!text) return null;
  stmts.setGroupName.run(text, Number(groupId));
  return getGroup(groupId);
}

/** 修改「我在群里的昵称」（写入 group_members.nickname） */
export function setMyGroupNickname(groupId, userId, nickname) {
  const gid = Number(groupId);
  const uid = Number(userId);
  const g = getGroup(gid);
  if (!g) return { error: '群不存在' };
  const text = String(nickname || '').trim().slice(0, 20);
  const rows = stmts.listGroupMembers.all(gid) || [];
  const mine = rows.find((r) => Number(r.user_id) === uid);
  if (!mine) return { error: '你不在该群聊中' };
  // 空昵称则恢复账号昵称
  let next = text;
  if (!next) {
    const u = stmts.userById.get(uid);
    next = u?.nickname || mine.nickname || '';
  }
  try {
    db.prepare('UPDATE group_members SET nickname = ? WHERE group_id = ? AND user_id = ?').run(next, gid, uid);
  } catch (e) {
    return { error: e.message || '保存失败' };
  }
  return { ok: true, nickname: next };
}

function memberRowToApi(r) {
  return {
    userId: r.user_id ?? null,
    personaKey: r.persona_key || null,
    nickname: r.nickname,
    role: r.role || 'member',
    isAI: false,
  };
}

/** 邀请群成员。群聊已去掉 AI 群友, 这里只接受真人 userIds。 */
export function addGroupMembers(groupId, { userIds = [], ownerNickname = null, ownerId = null } = {}) {
  const gid = Number(groupId);
  const now = Date.now();
  const added = [];
  if (ownerNickname) {
    stmts.insertGroupMember.run(gid, ownerId || null, null, String(ownerNickname).slice(0, 32), 'owner', now);
  }
  for (const id of userIds || []) {
    const uid = Number(id);
    if (!Number.isInteger(uid) || uid <= 0) continue;
    if (ownerId && uid === Number(ownerId)) continue;
    const u = stmts.userById.get(uid);
    if (!u) continue;
    if (ownerNickname && u.nickname === ownerNickname) continue;
    stmts.insertGroupMember.run(gid, uid, null, u.nickname, 'member', now);
    added.push({ userId: uid, nickname: u.nickname, isAI: false });
  }
  return added;
}

export function listGroupMembers(groupId) {
  const gid = Number(groupId);
  const g = getGroup(gid);
  if (!g) return null;
  const rows = stmts.listGroupMembers.all(gid) || [];
  const seen = new Set();
  const out = [];
  const push = (m) => {
    const key = m.userId ? `u${m.userId}` : `n:${m.nickname}`;
    if (seen.has(key) || seen.has(`n:${m.nickname}`)) return;
    seen.add(key);
    seen.add(`n:${m.nickname}`);
    out.push(m);
  };
  // 历史 AI 成员行直接跳过(启动时已清理, 这里兜底)
  for (const r of rows) {
    if (!r.user_id && r.persona_key) continue;
    push(enrichMember(memberRowToApi(r)));
  }
  if (out.length) return out;
  try {
    const avatars = JSON.parse(g.avatars || '[]');
    for (const a of avatars) {
      push(enrichMember({ userId: null, personaKey: null, nickname: String(a), role: 'member', isAI: false }));
    }
  } catch { /* ignore */ }
  return out;
}

export function leaveGroup(groupId, userId) {
  const gid = Number(groupId);
  const g = getGroup(gid);
  if (!g) return { error: '群不存在' };
  if (g.kind === DEFAULT_GROUP_KIND) return { error: '默认群不可退出' };
  stmts.deleteGroupMemberByUser.run(gid, Number(userId));
  return { ok: true, group: g };
}

export function removeGroupMember(groupId, key) {
  const gid = Number(groupId);
  const raw = String(key || '');
  if (raw.startsWith('ai:')) {
    stmts.deleteGroupMember.run(gid, -1, raw);
  } else {
    const uid = Number(raw.replace(/^u/, ''));
    stmts.deleteGroupMember.run(gid, uid, raw);
  }
  return { ok: true };
}

// 用户自建群聊（仅真人成员）
export function createGroup({ name, memberNames, userIds = [], creatorNickname = null, creatorId = null }) {
  const cleanName = String(name || '').trim().slice(0, 20) || '新建群聊';
  const avatars = (memberNames || []).slice(0, 9).map((n) => String(n).slice(0, 12));
  const r = stmts.insertGroup.run(cleanName, 'custom', JSON.stringify(avatars), Date.now());
  const gid = Number(r.lastInsertRowid);
  try {
    if (creatorId) {
      db.prepare('UPDATE groups SET owner_id = ? WHERE id = ?').run(Number(creatorId), gid);
    }
  } catch { /* ignore */ }
  if (creatorNickname || creatorId) {
    addGroupMembers(gid, {
      userIds,
      ownerNickname: creatorNickname,
      ownerId: creatorId,
    });
  } else {
    addGroupMembers(gid, { userIds });
  }
  return getGroup(gid);
}
