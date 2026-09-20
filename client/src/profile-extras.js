// 个人/好友资料扩展字段（手机号、拍一拍、铃声等演示数据，本地持久化）
const PROFILE_KEY = 'wx_profile_extras_v1';
const FRIEND_KEY = 'wx_friend_extras_v1';

function readMap(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') || {};
  } catch {
    return {};
  }
}

function writeMap(key, map) {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch { /* ignore */ }
}

const PROFILE_DEFAULTS = {
  phone: '',
  pat: '',
  ringtone: '',
  address: '',
  invoiceTitle: '',
  wechatBeans: 0,
};

export function loadProfileExtras(userId) {
  const map = readMap(PROFILE_KEY);
  return { ...PROFILE_DEFAULTS, ...(map[String(userId)] || {}) };
}

export function saveProfileExtras(userId, patch) {
  const id = String(userId);
  const map = readMap(PROFILE_KEY);
  const next = { ...PROFILE_DEFAULTS, ...(map[id] || {}), ...patch };
  map[id] = next;
  writeMap(PROFILE_KEY, map);
  return next;
}

export function maskPhone(phone) {
  const s = String(phone || '').replace(/\D/g, '');
  if (s.length < 7) return phone || '';
  return `${s.slice(0, 3)}******${s.slice(-2)}`;
}

const FRIEND_DEFAULTS = {
  phone: '',
  tags: '',
  memo: '',
  photos: [],
  source: '通过搜索账号添加',
};

export function loadFriendExtras(friendId) {
  const map = readMap(FRIEND_KEY);
  return { ...FRIEND_DEFAULTS, ...(map[String(friendId)] || {}) };
}

export function saveFriendExtras(friendId, patch) {
  const id = String(friendId);
  const map = readMap(FRIEND_KEY);
  const next = { ...FRIEND_DEFAULTS, ...(map[id] || {}), ...patch };
  map[id] = next;
  writeMap(FRIEND_KEY, map);
  return next;
}

export function formatFriendSince(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

export function permissionLabel(p) {
  if (!p || p === 'all') return '聊天、朋友圈、微信运动等';
  if (p === 'chat') return '仅聊天';
  if (p === 'hide-moments') return '不让他看我';
  if (p === 'block') return '加入黑名单';
  return String(p);
}
