// 群聊种子数据: 默认主群 + 多个业务群。非默认群 AI 不主动插话。
import { stmts, db } from './db.js';
import { personas, personasForGroup } from './ai/personas.js';
import { aiAvatarFile } from './ai/avatars.js';

export const DEFAULT_GROUP_KIND = 'main';

export const SEED_GROUPS = [
  {
    kind: 'main',
    name: 'WeChat',
    avatars: ['思琪', 'Perry', '小辣椒', '阿强'],
    seed: [],
  },
  {
    kind: 'product',
    name: '产品设计小分队（8）',
    avatars: ['💅', '🎮', '🧋', '🍜', '📐', '🎧', '📷', '🚀'],
    seed: [
      { from: 'ai', name: '思琪', emoji: '💅', content: '这版首页改稿我传群里了, 大家看看', ago: 3 * 3600000 },
      { from: 'ai', name: 'Perry', emoji: '🎮', content: '导航层级有点深, 建议再压一压', ago: 2.5 * 3600000 },
      { from: 'ai', name: '小辣椒', emoji: '🌶', content: '同意, 二级入口上提一层就行', ago: 2.4 * 3600000 },
    ],
  },
  {
    kind: 'work',
    name: '工作对接群',
    avatars: ['💼', '📊', '📎', '🗓️', '✅', '🖥️', '📞', '📝', '📈'],
    seed: [
      { from: 'ai', name: '方圆', emoji: '📐', content: '@所有人 明天上午十点例会', ago: 5 * 3600000 },
    ],
  },
];

// 启动时清理的无关/测试群（按名称或 kind）
const UNWANTED_GROUP_KINDS = new Set(['family', 'climb', 'game']);
const UNWANTED_GROUP_NAME_RE = /(验收改名|爬山|开黑|家庭群)/;

function deleteGroupDeep(groupId, convId) {
  try { db.prepare('DELETE FROM group_members WHERE group_id = ?').run(groupId); } catch { /* ignore */ }
  try { db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(convId); } catch { /* ignore */ }
  try { db.prepare('DELETE FROM chat_prefs WHERE conversation_id = ?').run(convId); } catch { /* ignore */ }
  try { db.prepare('DELETE FROM chat_reads WHERE conversation_id = ?').run(convId); } catch { /* ignore */ }
  try { db.prepare('DELETE FROM groups WHERE id = ?').run(groupId); } catch { /* ignore */ }
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
  if (m.isAI || m.personaKey) {
    const p = personas.find((x) => x.name === name) || personas.find((x) => m.personaKey === `ai:${x.name}`);
    return {
      ...m,
      nickname: p?.name || name,
      avatar: aiAvatarFile(p?.name || name),
      emoji: p?.emoji || m.emoji || '🤖',
      isAI: true,
      personaId: p?.id || (m.personaKey || '').replace(/^ai:/, ''),
      color: '#07c160',
    };
  }
  if (m.userId) {
    const u = stmts.userById.get(Number(m.userId));
    return {
      ...m,
      nickname: u?.nickname || name,
      avatar: u?.avatar || null,
      emoji: null,
      color: u?.avatar_color || '#4f6ef7',
      wxid: u?.wxid || null,
      isAI: false,
    };
  }
  // 纯昵称: 优先匹配 AI 人设/头像文件
  const p = personas.find((x) => x.name === name);
  if (p) {
    return {
      ...m,
      avatar: aiAvatarFile(p.name),
      emoji: p.emoji,
      isAI: true,
      personaId: p.id,
      personaKey: m.personaKey || `ai:${p.name}`,
      color: '#07c160',
    };
  }
  return {
    ...m,
    avatar: aiAvatarFile(name) || null,
    emoji: /^\p{Extended_Pictographic}$/u.test(String(name)) ? name : null,
    color: '#07c160',
    isAI: Boolean(m.isAI),
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
    // 播种成员表, 保证详情页能展示头像
    try {
      const existing = stmts.listGroupMembers.all(row.id) || [];
      if (!existing.length) {
        const pool = personasForGroup(g.kind);
        const names = new Set((g.avatars || []).map(String));
        // 种子消息里的人名也进成员
        for (const s of g.seed || []) {
          if (s.from === 'ai' && s.name) names.add(s.name);
        }
        for (const p of pool) {
          if (!names.size || names.has(p.name) || names.has(p.emoji)) {
            stmts.insertGroupMember.run(row.id, null, `ai:${p.name}`, p.name, 'member', now);
          }
        }
        // 若 names 里还有未覆盖的 emoji/昵称, 也写入
        for (const n of names) {
          const already = stmts.listGroupMembers.all(row.id).some((m) => m.nickname === n);
          if (already) continue;
          const p = personas.find((x) => x.name === n || x.emoji === n);
          if (p) {
            stmts.insertGroupMember.run(row.id, null, `ai:${p.name}`, p.name, 'member', now);
          } else {
            stmts.insertGroupMember.run(row.id, null, null, String(n).slice(0, 32), 'member', now);
          }
        }
      }
    } catch { /* ignore */ }
    created.push(row);
  }
  return created;
}

export function listGroups() {
  return stmts.allGroups.all().map((g) => {
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
  };
}

export function setGroupNotice(groupId, notice) {
  const text = String(notice || '').trim().slice(0, 500);
  stmts.setGroupNotice.run(text, Number(groupId));
  return text;
}

export function renameGroup(groupId, name) {
  const text = String(name || '').trim().slice(0, 20);
  if (!text) return null;
  stmts.setGroupName.run(text, Number(groupId));
  return getGroup(groupId);
}

function memberRowToApi(r) {
  return {
    userId: r.user_id ?? null,
    personaKey: r.persona_key || null,
    nickname: r.nickname,
    role: r.role || 'member',
    isAI: Boolean(r.persona_key) && !r.user_id,
  };
}

export function addGroupMembers(groupId, { userIds = [], aiNames = [], ownerNickname = null, ownerId = null } = {}) {
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
  for (const n of aiNames || []) {
    const name = String(n || '').trim().slice(0, 32);
    if (!name) continue;
    if (ownerNickname && name === ownerNickname) continue;
    const key = 'ai:' + name;
    stmts.insertGroupMember.run(gid, null, key, name, 'member', now);
    added.push({ personaKey: key, nickname: name, isAI: true });
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
    const key = m.personaKey || (m.userId ? `u${m.userId}` : `n:${m.nickname}`);
    if (seen.has(key) || seen.has(`n:${m.nickname}`)) return;
    seen.add(key);
    seen.add(`n:${m.nickname}`);
    out.push(m);
  };
  if (rows.length) {
    for (const r of rows) push(enrichMember(memberRowToApi(r)));
    return out;
  }
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

// 用户自建群聊
export function createGroup({ name, memberNames, userIds = [], aiNames = [], creatorNickname = null, creatorId = null }) {
  const cleanName = String(name || '').trim().slice(0, 20) || '新建群聊';
  const avatars = (memberNames || []).slice(0, 9).map((n) => String(n).slice(0, 12));
  const r = stmts.insertGroup.run(cleanName, 'custom', JSON.stringify(avatars), Date.now());
  const gid = Number(r.lastInsertRowid);
  if (creatorNickname || creatorId) {
    addGroupMembers(gid, {
      userIds,
      aiNames,
      ownerNickname: creatorNickname,
      ownerId: creatorId,
    });
  } else {
    addGroupMembers(gid, { userIds, aiNames });
  }
  return getGroup(gid);
}
