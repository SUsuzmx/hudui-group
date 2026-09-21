import { ref } from 'vue';

// 个人/好友资料扩展字段（手机号、拍一拍、铃声等演示数据，本地持久化）
const PROFILE_KEY = 'wx_profile_extras_v1';
const FRIEND_KEY = 'wx_friend_extras_v1';
const STAR_KEY_PREFIX = 'wx_star_friend_';

/** 星标朋友变更时递增，供通讯录 computed 依赖刷新 */
export const starRevision = ref(0);

// 星标朋友：默认不星标，仅在「朋友设置」里手动打开
const starState = {
  ids: new Set(),
  loaded: false,
};

function loadStarsFromStorage() {
  const next = new Set();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STAR_KEY_PREFIX) && localStorage.getItem(k) === '1') {
        const id = Number(k.slice(STAR_KEY_PREFIX.length));
        if (Number.isFinite(id) && id > 0) next.add(id);
      }
    }
  } catch { /* ignore */ }
  starState.ids = next;
  starState.loaded = true;
}

export function refreshStarFriends() {
  loadStarsFromStorage();
  starRevision.value += 1;
  return starState.ids;
}

export function isStarFriend(userId) {
  if (!starState.loaded) loadStarsFromStorage();
  const id = Number(userId);
  return Number.isFinite(id) && id > 0 && starState.ids.has(id);
}

export function setStarFriend(userId, on) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return false;
  try {
    localStorage.setItem(STAR_KEY_PREFIX + id, on ? '1' : '0');
  } catch { /* ignore */ }
  if (on) starState.ids.add(id);
  else starState.ids.delete(id);
  starState.loaded = true;
  starRevision.value += 1;
  return Boolean(on);
}

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
  starred: false,
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
