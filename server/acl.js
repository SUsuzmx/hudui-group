// 会话访问控制: HTTP 与 Socket 共用。
// 产品约定: 所有登录用户可访问全部群; 私聊仅会话双方/本人 AI 会话。

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

export function canAccessGroup(conversationId, getGroup) {
  if (!conversationId || typeof conversationId !== 'string' || !conversationId.startsWith('grp_')) return false;
  const id = Number(conversationId.slice(4));
  return Number.isInteger(id) && id > 0 && Boolean(getGroup(id));
}

/** default / grp_* / pv_* 统一入口 */
export function canAccessConversation(userId, conversationId, getGroup) {
  const conv = conversationId == null || conversationId === '' ? 'default' : String(conversationId);
  if (conv === 'default') return true;
  if (conv.startsWith('pv_')) return canAccessPrivate(userId, conv);
  if (conv.startsWith('grp_')) return canAccessGroup(conv, getGroup);
  return false;
}

/**
 * 全局搜索可见范围: 默认群 + 全部群 + 本人私聊。
 * 返回 SQL 条件片段与参数 (不含 LIKE 关键字本身)。
 */
export function searchVisibilitySql(userId) {
  return {
    sql: `(
      m.conversation_id IS NULL
      OR m.conversation_id LIKE 'grp_%'
      OR m.conversation_id LIKE ? ESCAPE '\\'
      OR m.conversation_id LIKE ? ESCAPE '\\'
      OR m.conversation_id LIKE ? ESCAPE '\\'
    )`,
    params: [
      `pv\\_${userId}\\_%`,
      `pv\\_u\\_${userId}\\_%`,
      `pv\\_u\\_%\\_${userId}`,
    ],
  };
}
