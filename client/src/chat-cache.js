// 会话消息本地缓存: 进页立刻绘制, 再后台拉最新
const MAX = 100;
const KEY = (id) => `hudui_msgs_${id || 'default'}`;

export function saveMsgCache(convId, messages) {
  try {
    const list = (messages || []).slice(-MAX);
    localStorage.setItem(KEY(convId), JSON.stringify(list));
  } catch { /* ignore */ }
}

export function loadMsgCache(convId) {
  try {
    const raw = localStorage.getItem(KEY(convId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function clearMsgCache(convId) {
  try { localStorage.removeItem(KEY(convId)); } catch { /* ignore */ }
}
