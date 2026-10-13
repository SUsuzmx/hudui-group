// 会话访问控制: HTTP 与 Socket 共用。
// 产品约定: 群聊按成员制访问(需在 group_members 中); 私聊仅会话双方/本人 AI 会话。

export function canAccessPrivate(userId, conversationId) {
  if (typeof conversationId !== 'string' || !conversationId.startsWith('pv_')) return false;
  const parts = conversationId.split('_');
  if (parts[1] === 'u') {
    const a = parseInt(parts[2], 10);
    const b = parseInt(parts[3], 10);
    return Number.isInteger(a) && Number.isInteger(b) && (userId === a || userId === b);
  }
  const owner = parseInt(parts[1], 10);
  return Number.isInteger(owner) && owner === userId;
}

export function canAccessGroup(conversationId, getGroup, isMember = null) {
  if (!conversationId || typeof conversationId !== 'string' || !conversationId.startsWith('grp_')) return false;
  const id = Number(conversationId.slice(4));
  if (!Number.isInteger(id) || id <= 0) return false;
  if (!getGroup(id)) return false;
  // 成员制: 未提供成员校验时保持旧行为(仅群存在即放行)
  if (isMember && !isMember(id)) return false;
  return true;
}

/** default / grp_* / pv_* 统一入口 */
export function canAccessConversation(userId, conversationId, getGroup, isMember = null) {
  const conv = conversationId == null || conversationId === '' ? 'default' : String(conversationId);
  if (conv === 'default') return true;
  if (conv.startsWith('pv_')) return canAccessPrivate(userId, conv);
  if (conv.startsWith('grp_')) return canAccessGroup(conv, getGroup, isMember);
  return false;
}

/**
 * 全局搜索可见范围: 默认群 + 我加入的群 + 本人私聊。
 * 返回 SQL 条件片段与参数 (不含 LIKE 关键字本身)。
 */
export function searchVisibilitySql(userId) {
  return {
    sql: `(
      m.conversation_id IS NULL
      OR m.conversation_id IN (SELECT 'grp_' || group_id FROM group_members WHERE user_id = ?)
      OR m.conversation_id LIKE ? ESCAPE '\\'
      OR m.conversation_id LIKE ? ESCAPE '\\'
      OR m.conversation_id LIKE ? ESCAPE '\\'
    )`,
    params: [
      userId,
      `pv\\_${userId}\\_%`,
      `pv\\_u\\_${userId}\\_%`,
      `pv\\_u\\_%\\_${userId}`,
    ],
  };
}
