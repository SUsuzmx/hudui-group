// 聊天消息展示层纯函数：群聊 / 私聊共用
// 不依赖 Vue，方便单测与复用。

export function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return hm;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

export function fmtDayLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return '今天';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 消息 ext 字段统一解析为对象 */
export function parseExt(m) {
  if (!m) return {};
  if (m.ext && typeof m.ext === 'object') return m.ext;
  if (typeof m.ext === 'string') {
    try {
      return JSON.parse(m.ext) || {};
    } catch {
      return {};
    }
  }
  return {};
}

export function isMineMessage(m, myNickname) {
  if (m?.localPending) return true;
  return m?.senderType === 'user' && m?.senderName === myNickname;
}

/** 是否展示时间戳（间隔 > 5 分钟） */
export function shouldShowTime(messages, i) {
  if (i === 0) return true;
  const prev = messages[i - 1];
  const cur = messages[i];
  if (!prev?.createdAt || !cur?.createdAt) return false;
  return cur.createdAt - prev.createdAt > 5 * 60_000;
}

/** 同一人连续短消息合并气泡 */
export function isSameSenderAsPrev(messages, i) {
  if (i === 0) return false;
  const prev = messages[i - 1];
  const cur = messages[i];
  if (!prev || !cur) return false;
  if (prev.senderType === 'system' || cur.senderType === 'system') return false;
  if (shouldShowTime(messages, i)) return false;
  return prev.senderName === cur.senderName && prev.senderType === cur.senderType;
}

/** 跨日分隔线 */
export function shouldShowDateSep(messages, i) {
  if (i === 0) return true;
  const prev = messages[i - 1];
  const cur = messages[i];
  if (!prev?.createdAt || !cur?.createdAt) return false;
  const a = new Date(prev.createdAt);
  const b = new Date(cur.createdAt);
  return (
    a.getFullYear() !== b.getFullYear() ||
    a.getMonth() !== b.getMonth() ||
    a.getDate() !== b.getDate()
  );
}

/** 消息头像：AI / 文件 / 色块 */
export function avatarFromMessage(m, aiAvatarMap = {}) {
  if (m.senderType === 'ai') {
    const a = aiAvatarMap[m.senderName];
    return {
      name: m.senderName,
      avatar: a?.avatar ?? null,
      emoji: a?.emoji ?? '😊',
      color: '#07c160',
      size: 40,
    };
  }
  const av = m.avatar;
  const isFile = av && (av.startsWith('/') || /\.(png|jpe?g|webp|gif)$/i.test(av));
  return {
    name: m.senderName,
    avatar: isFile ? av : null,
    emoji: null,
    color: isFile ? '#4f6ef7' : av || '#4f6ef7',
    size: 40,
  };
}

/** 语音条宽度（与 ChatView / PrivateChatView 对齐） */
export function voiceBarWidth(durationSec) {
  const s = Math.max(1, Math.min(60, Number(durationSec) || 1));
  return Math.round(60 + (s / 60) * 120);
}
