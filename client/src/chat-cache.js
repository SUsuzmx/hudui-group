// 会话消息本地缓存: 进页立刻绘制, 再后台拉最新
const MAX = 100;
const KEY = (id) => `hudui_msgs_${id || 'default'}`;
const HIDDEN_KEY = 'hudui_hidden_chats';

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

export function readHiddenChatIds() {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

export function writeHiddenChatIds(set) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

export function isHiddenChatId(id) {
  return readHiddenChatIds().has(String(id));
}

export function addHiddenChatId(id) {
  if (!id) return;
  const set = readHiddenChatIds();
  set.add(String(id));
  writeHiddenChatIds(set);
}

export function removeHiddenChatId(id) {
  if (!id) return;
  const set = readHiddenChatIds();
  set.delete(String(id));
  writeHiddenChatIds(set);
}
