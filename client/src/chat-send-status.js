// 微信式本地发送状态: sending → sent / failed
let seq = 0;

export function makeLocalMsg({ me, conversationId, content, mediaType = null, mediaUrl = null, quote = null, ext = null }) {
  seq += 1;
  return {
    id: `local-${Date.now()}-${seq}`,
    localPending: true,
    sendStatus: 'sending',
    senderType: 'user',
    senderId: me?.id ?? null,
    senderName: me?.nickname || '我',
    avatar: me?.avatar || me?.avatarColor || '#07c160',
    content: content || '',
    mediaType,
    mediaUrl,
    quote: quote || null,
    ext: ext || null,
    createdAt: Date.now(),
    conversationId,
    recalled: 0,
  };
}

export function patchLocalMsg(list, localId, patch) {
  const idx = list.findIndex((m) => m.id === localId);
  if (idx < 0) return -1;
  list[idx] = { ...list[idx], ...patch };
  return idx;
}

/** 服务端回声到达时，去掉同内容的乐观本地气泡，避免双份 */
export function dropLocalEcho(list, incoming, meNickname) {
  if (!incoming || incoming.senderName !== meNickname) return list;
  return list.filter((m) => {
    if (!m.localPending) return true;
    if (m.sendStatus === 'failed') return true;
    const sameContent = m.content === incoming.content;
    const sameMedia = (m.mediaType || null) === (incoming.mediaType || null)
      && (m.mediaUrl || null) === (incoming.mediaUrl || null);
    return !(sameContent && sameMedia);
  });
}

export function sendStatusMeta(status, { isAI = false, read = false } = {}) {
  if (status === 'sending') return { show: true, text: '发送中', cls: 'st-sending' };
  if (status === 'failed') return { show: true, text: '发送失败', cls: 'st-failed' };
  if (isAI) return { show: false, text: '', cls: '' };
  if (read) return { show: true, text: '已读', cls: 'st-read' };
  return { show: false, text: '', cls: '' };
}
