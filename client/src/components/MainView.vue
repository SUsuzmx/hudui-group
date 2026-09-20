<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { io } from 'socket.io-client';
import { getToken, api } from '../api.js';
import UserAvatar from './UserAvatar.vue';
import WxIcons from './WxIcons.vue';
import { pinyinInitial, groupContactsByLetter } from '../pinyin-initial.js';
import { statusGradient, statusIconPath, statusRemaining } from '../status-bg.js';
import { loadProfileExtras, saveProfileExtras } from '../profile-extras.js';
import { toast } from '../toast.js';

const props = defineProps({
  me: { type: Object, required: true },
  initialTab: { type: String, default: '' },
});
const emit = defineEmits([
  'open-chat',
  'logout',
  'open-group-settings',
  'open-private-chat',
  'open-view',
  'status-updated',
]);

const statusData = computed(() => props.me?.status || loadProfileExtras(props.me?.id).status || null);
const statusLabel = computed(() => {
  const st = statusData.value;
  const sig = String(props.me?.signature || '').trim();
  if (st?.label) return st.label;
  if (sig) return sig.length > 10 ? sig.slice(0, 10) + '…' : sig;
  return '';
});
const hasStatus = computed(() => Boolean(statusData.value?.key || statusData.value?.label || statusLabel.value));
const statusBgUrl = computed(() => statusData.value?.bgUrl || '');
const statusBgType = computed(() => statusData.value?.bgType || null);
const statusKey = computed(() => statusData.value?.key || '');
const statusIconD = computed(() => statusIconPath(statusData.value?.icon || statusKey.value || 'smile'));
/** 无自定义图/视频时，整块头图使用状态对应渐变色 */
const statusGradientCss = computed(() => {
  if (!hasStatus.value) return '';
  if (statusBgUrl.value) return '';
  return statusGradient(statusKey.value, statusLabel.value);
});
const statusRemainText = computed(() => statusRemaining(statusData.value?.at, statusData.value?.expiresInHours));

const showStatusSheet = ref(false);

function openStatusMenu() {
  if (hasStatus.value) {
    showStatusSheet.value = true;
  } else {
    emit('open-view', { type: 'deep-feature', feature: 'statusHome', title: '设个状态' });
  }
}

function goNewStatus() {
  showStatusSheet.value = false;
  emit('open-view', { type: 'deep-feature', feature: 'statusHome', title: '设个状态' });
}

function goEditStatus() {
  showStatusSheet.value = false;
  emit('open-view', { type: 'deep-feature', feature: 'statusHome', title: '修改状态' });
}

async function endStatus() {
  showStatusSheet.value = false;
  try {
    saveProfileExtras(props.me?.id, { status: null });
    const { user } = await api.updateMe({ status: null, signature: '' });
    emit('status-updated', user || { ...(props.me || {}), status: null, signature: '' });
  } catch (e) {
    toast(e.message || '结束状态失败');
  }
}

const TAB_KEY = 'hudui_main_tab';
const savedTab = (() => {
  try { return localStorage.getItem(TAB_KEY) || 'chats'; } catch { return 'chats'; }
})();

const tab = ref(props.initialTab || savedTab);
const chats = ref([]);
const members = ref({ aiMembers: [], allUsers: [] });
const friends = ref([]);
const showSearch = ref(false);
const showMore = ref(false);
const searchQuery = ref('');
const searchInputEl = ref(null);
const chatsScrollEl = ref(null);
const contactsScrollEl = ref(null);
const discoverScrollEl = ref(null);
const meScrollEl = ref(null);
const scrollPos = ref({ chats: 0, contacts: 0, discover: 0, me: 0 });
const unreadMap = ref({});
const unreadTotalServer = ref(0);
const momentsDot = ref(true);
const chatActionTarget = ref(null);
const friendRequests = ref({ incoming: [], outgoing: [], pending: 0 });
let longPressTimer = null;
const swipeId = ref(null);
let swipeStartX = 0;
let swipeStartY = 0;
let lastMoveX = 0;
let lastMoveY = 0;
const swipeAxis = ref(null);
let socket = null;
let chatsReloadTimer = null;

// 对齐真实微信截图的入口分组
const discoverGroups = [
  [{ icon: 'moments', label: '朋友圈', key: 'moments' }],
  [
    { icon: 'channels', label: '视频号', key: 'videoChannels' },
    { icon: 'live', label: '直播', key: 'live', extra: '演示直播入口', dot: true },
  ],
  [
    { icon: 'scan', label: '扫一扫', key: 'scan' },
    { icon: 'listen', label: '听一听', key: 'listen' },
  ],
  [
    { icon: 'search-page', label: '看一看', key: 'look' },
    { icon: 'search-page', label: '搜一搜', key: 'search' },
  ],
  [
    { icon: 'tag', label: '附近的人', key: 'nearby' },
    { icon: 'services', label: '购物', key: 'shopping' },
    { icon: 'game', label: '游戏', key: 'games' },
  ],
  [{ icon: 'works', label: '小程序', key: 'miniapp' }],
];
const meService = [{ icon: 'services', label: '服务', key: 'services' }];
const meGroup1 = [
  { icon: 'fav', label: '收藏', key: 'favorites' },
  { icon: 'album-me', label: '朋友圈', key: 'moments-mine' },
  { icon: 'works', label: '作品', key: 'works' },
  { icon: 'shop-cards', label: '小店与卡包', key: 'cards' },
  { icon: 'sticker', label: '表情', key: 'stickers' },
];
const meGroup2 = [{ icon: 'settings', label: '设置', key: 'settings' }];
const contactEntries = [
  { icon: 'new-friend', label: '新的朋友', key: 'newfriends' },
  { icon: 'chat-only', label: '仅聊天的朋友', key: 'chat-only' },
  { icon: 'group', label: '群聊', key: 'groupList' },
  { icon: 'tag', label: '标签', key: 'tags' },
  { icon: 'oa', label: '黑名单', key: 'blacklist' },
  { icon: 'service-oa', label: '公众号', key: 'official' },
];
const contactWork = [{ icon: 'work-wechat', label: '企业微信联系人', key: 'work-wecom' }];

const floatChats = ref([]);
const foldedOpen = ref(false);

const foldedChats = computed(() => chats.value.filter((c) => c.folded && !c.pinned));
const visibleChats = computed(() => {
  const foldedIds = new Set(foldedChats.value.map((c) => c.id));
  return chats.value.filter((c) => !foldedIds.has(c.id) || foldedOpen.value);
});

const navTitleText = computed(() => {
  if (tab.value === 'chats') {
    const n = unreadTotal.value || 0;
    return n > 0 ? `微信(${n > 99 ? '99+' : n})` : '微信';
  }
  return tab.value === 'contacts' ? '通讯录' : tab.value === 'discover' ? '发现' : '我';
});
const showNav = computed(() => tab.value !== 'me');
const starFriends = computed(() => contactPeople().filter((p) => p.isFriend && !p.isAI).slice(0, 4));
const contactLetterIds = computed(() => {
  const map = {};
  for (const g of contactGroups.value) {
    const first = g.people[0];
    if (first) map[g.letter] = 'ct-' + first.key;
  }
  return map;
});
const refreshing = ref(false);
const chatsPull = ref(0);
const extraAi = ref([]);
const contactIndexLetters = computed(() => {
  const has = new Set(contactGroups.value.map((g) => g.letter));
  return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').map((L) => ({ L, on: has.has(L) }));
});

function jumpToLetter(L) {
  const key = L === '↑' ? null : L;
  const scroller = contactsScrollEl.value;
  if (!scroller) return;
  if (!key) {
    scroller.scrollTop = 0;
    return;
  }
  const el =
    scroller.querySelector(`#ct-letter-${CSS.escape(key)}`) ||
    document.getElementById(`ct-letter-${key}`);
  if (!el) return;
  const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTo({ top: Math.max(0, top - 4), behavior: 'smooth' });
}

async function refreshChats() {
  if (refreshing.value) return;
  refreshing.value = true;
  try { await loadChats(); await loadFriendRequests(); }
  finally { refreshing.value = false; chatsPull.value = 0; }
}

function toggleFloatChat(c) {
  const exists = floatChats.value.find((x) => x.id === c.id);
  if (exists) {
    floatChats.value = floatChats.value.filter((x) => x.id !== c.id);
    return;
  }
  if (floatChats.value.length >= 3) {
    floatChats.value = floatChats.value.slice(1);
  }
  floatChats.value = [...floatChats.value, { id: c.id, name: c.name, type: c.type, conversationId: c.conversationId, peerId: c.peerId, personaId: c.personaId, isAI: c.isAI, remark: c.remark, personaAvatar: c.personaAvatar, personaEmoji: c.personaEmoji, kind: c.kind, isDefault: c.isDefault, groupId: c.groupId }];
}
function openFloat(c) {
  floatChats.value = floatChats.value.filter((x) => x.id !== c.id);
  openChatItem(c);
}

function sortChats(list) {
  list.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return (b.lastTime || 0) - (a.lastTime || 0);
  });
}

function fmtChatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) {
    if (Date.now() - ts < 60_000) return '刚刚';
    return hm;
  }
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return '昨天';
  if ((now - d) / 86400000 < 7) return '星期' + ['日','一','二','三','四','五','六'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtTime(ts) { return fmtChatTime(ts); }

function applyChats(apiChats, serverUnreadTotal) {
  const list = (apiChats || []).map((c) => ({ ...c }));
  const unreads = {};
  for (const c of list) if (c.unread) unreads[c.id] = c.unread;
  unreadMap.value = unreads;
  unreadTotalServer.value = serverUnreadTotal || list.reduce((s, c) => s + (c.unread || 0), 0);
  sortChats(list);
  chats.value = list;
}

async function loadChats() {
  try {
    const data = await api.chats();
    applyChats(data.chats, data.unreadTotal);
  } catch {
    applyChats([], 0);
  }
}

function scheduleReloadChats(delay = 400) {
  clearTimeout(chatsReloadTimer);
  chatsReloadTimer = setTimeout(() => { loadChats(); }, delay);
}

async function loadFriendRequests() {
  try { friendRequests.value = await api.friendRequests(); } catch { /* ignore */ }
}

async function loadFriends() {
  try {
    const data = await api.friends();
    friends.value = data.friends || [];
  } catch { /* ignore */ }
}

onMounted(async () => {
  loadContactTags();
  loadChats();
  loadFriends();
  loadFriendRequests();
  try {
    // AI 不进通讯录；群成员数据里仍保留 AI 供群聊展示
    extraAi.value = [];
  } catch { extraAi.value = []; }
  socket = io('/', {
    auth: { token: getToken() },
    transports: ['polling', 'websocket'],
    upgrade: true,
  });
  socket.on('members:update', (data) => { members.value = data; });
  socket.on('message:new', () => scheduleReloadChats());
  socket.on('group:message', () => scheduleReloadChats());
  socket.on('private:message', () => scheduleReloadChats());
  socket.on('chat:sync', () => scheduleReloadChats(600));
  socket.on('moments:update', (p) => {
    if (p && p.userId !== props.me?.id) momentsDot.value = true;
  });
  socket.on('call:incoming', (payload) => {
    if (!payload?.from) return;
    emit('open-view', {
      type: 'video-call',
      role: 'callee',
      callMode: payload.mode || 'video',
      callId: payload.callId,
      incoming: payload,
      target: {
        nickname: payload.from.nickname,
        avatar: payload.from.avatar,
        color: payload.from.avatarColor || '#07c160',
        userId: payload.from.userId,
      },
    });
  });
});

onBeforeUnmount(() => {
  clearTimeout(chatsReloadTimer);
  socket?.disconnect();
  clearTimeout(longPressTimer);
});

function scrollElOf(key) {
  return {
    chats: chatsScrollEl.value,
    contacts: contactsScrollEl.value,
    discover: discoverScrollEl.value,
    me: meScrollEl.value,
  }[key];
}

function switchTab(next) {
  if (tab.value === next) return;
  const cur = scrollElOf(tab.value);
  if (cur) scrollPos.value[tab.value] = cur.scrollTop;
  tab.value = next;
  try { localStorage.setItem(TAB_KEY, next); } catch { /* ignore */ }
  // 进通讯录时刷新好友/标签，保证黑名单与标签筛选同步
  if (next === 'contacts') {
    loadFriends();
    loadContactTags();
  }
  requestAnimationFrame(() => {
    const el = scrollElOf(next);
    if (el) el.scrollTop = scrollPos.value[next] || 0;
  });
}

const unreadTotal = computed(() =>
  unreadTotalServer.value || Object.values(unreadMap.value).reduce((s, n) => s + (n || 0), 0)
);
const pendingFriendCount = computed(() => friendRequests.value.pending || 0);

function clearUnread(id) {
  const conv = id || 'default';
  unreadMap.value = { ...unreadMap.value, [conv]: 0 };
  api.chatRead(conv).then(() => loadChats()).catch(() => {});
}

function privateAvatarParts(c) {
  const raw = c.avatars?.[0];
  const rawStr = typeof raw === 'string' ? raw : '';
  const isColor = Boolean(rawStr) && (rawStr.startsWith('#') || rawStr.startsWith('rgb'));
  const isPath = Boolean(rawStr) && (
    rawStr.startsWith('/')
    || rawStr.startsWith('data:')
    || rawStr.startsWith('http')
    || /\.(png|jpe?g|webp|gif)$/i.test(rawStr)
  );
  const isEmoji = Boolean(rawStr) && !isColor && !isPath && !rawStr.includes('.') && [...rawStr].length <= 4;
  const avatar = isPath
    ? rawStr
    : (c.personaAvatar && !String(c.personaAvatar).startsWith('#') && !String(c.personaAvatar).startsWith('rgb')
      ? c.personaAvatar
      : null);
  const emoji = isEmoji
    ? rawStr
    : (c.isAI && c.personaEmoji ? c.personaEmoji : null);
  const color = c.avatarColor
    || c.color
    || (isColor ? rawStr : '#4f6ef7');
  return { avatar, emoji, color };
}

function groupTileParts(av, groupName) {
  const s = typeof av === 'string' ? av : '';
  if (!s) return { avatar: null, emoji: null, name: groupName || '?' };
  const isPath = s.startsWith('/')
    || s.startsWith('data:')
    || s.startsWith('http')
    || /\.(png|jpe?g|webp|gif)$/i.test(s);
  if (isPath) return { avatar: s, emoji: null, name: groupName || s };
  const chars = [...s];
  const isEmojiLike = chars.length <= 2 && !/[\w\s\u4e00-\u9fa5]/.test(s);
  if (isEmojiLike) return { avatar: null, emoji: s, name: groupName || s };
  return { avatar: null, emoji: null, name: s };
}

function openChatItem(c) {
  clearUnread(c.id || c.conversationId);
  if (c.type === 'private') {
    const av = privateAvatarParts(c);
    const uid = Number(c.peerId ?? c.userId ?? 0);
    const isAi = Boolean(c.isAI);
    if (isAi) {
      emit('open-private-chat', {
        nickname: c.name,
        avatar: av.avatar,
        avatarUrl: av.avatar,
        emoji: av.emoji,
        avatarEmoji: av.emoji,
        color: av.color || '#07c160',
        isAI: true,
        key: 'ai-' + (c.personaId || c.id),
        personaId: c.personaId || 'siqi',
      });
      return;
    }
    emit('open-private-chat', {
      nickname: c.remark || c.name,
      avatar: av.avatar,
      color: av.color,
      isAI: false,
      userId: Number.isInteger(uid) && uid > 0 ? uid : null,
      remark: c.remark || null,
    });
    return;
  }
  emit('open-chat', {
    conversationId: c.conversationId || c.id,
    groupId: c.groupId ?? null,
    kind: c.kind || (c.isDefault ? 'main' : null),
    name: c.name,
    isDefault: c.isDefault !== false,
  });
}

function openSearch() {
  showSearch.value = false;
  showMore.value = false;
  emit('open-view', { type: 'global-search', q: searchQuery.value || '' });
}

function closeSearch() {
  showSearch.value = false;
  searchQuery.value = '';
}

const searchResults = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return { chats: [], people: [] };
  return {
    chats: chats.value.filter(
      (c) => String(c.name).toLowerCase().includes(q) || String(c.lastMessage || '').toLowerCase().includes(q)
    ),
    people: friends.value.filter((p) => String(p.nickname || '').toLowerCase().includes(q)),
  };
});

function pickSearchChat(c) {
  closeSearch();
  openChatItem(c);
}
function pickSearchPerson(p) {
  closeSearch();
  openContact({
    id: p.id,
    userId: p.id,
    nickname: p.remark || p.nickname,
    avatar: p.avatar,
    avatarColor: p.avatarColor,
    color: p.avatarColor,
    wxid: p.wxid,
    isFriend: true,
    isAI: false,
    local: false,
  });
}

function openFeature(key, title) {
  emit('open-view', { type: 'feature', feature: key, title });
}

function openDiscover(s) {
  showMore.value = false;
  if (s.key === 'moments' || s.key === 'moments-mine') {
    emit('open-view', { type: 'moments', mode: s.key === 'moments-mine' ? 'mine' : 'feed' });
    if (s.key === 'moments') momentsDot.value = false;
    return;
  }
  if (s.key === 'search') { openSearch(); return; }
  if (s.key === 'scan') { openFeature('scan', s.label); return; }
  if (s.key === 'listen') {
    emit('open-view', { type: 'listen' });
    return;
  }
  if (s.key === 'look') {
    emit('open-view', { type: 'look' });
    return;
  }
  if (s.key === 'nearby') {
    openFeature('nearby', s.label);
    return;
  }
  if (s.key === 'shopping') {
    emit('open-view', { type: 'deep-feature', feature: 'servicesHome', title: '购物' });
    return;
  }
  const deepMap = {
    miniapp: { feature: 'miniappHome', title: '小程序' },
    games: { feature: 'gameHome', title: '游戏' },
    videoChannels: { feature: 'videoChannels', title: '视频号' },
    live: { feature: 'videoChannels', title: '直播' },
  };
  if (deepMap[s.key]) {
    const d = deepMap[s.key];
    emit('open-view', { type: 'deep-feature', feature: d.feature, title: d.title || s.label });
    return;
  }
  openFeature(s.key, s.label);
}

function openMeCell(s) {
  if (s.key === 'moments-mine') {
    emit('open-view', { type: 'moments', mode: 'mine' });
  } else if (s.key === 'settings') {
    emit('open-view', { type: 'settings' });
  } else if (s.key === 'wallet') {
    emit('open-view', { type: 'feature', feature: 'wallet', title: '钱包' });
  } else if (s.key === 'services') {
    emit('open-view', { type: 'deep-feature', feature: 'servicesHome', title: '服务' });
  } else if (s.key === 'cards') {
    emit('open-view', { type: 'feature', feature: 'cards', title: '小店与卡包' });
  } else if (s.key === 'statusHome') {
    emit('open-view', { type: 'deep-feature', feature: 'statusHome', title: '状态' });
  } else if (s.key === 'stickers') {
    emit('open-view', { type: 'deep-feature', feature: 'stickerDetail', title: '表情' });
  } else if (s.key === 'works' || s.key === 'album') {
    emit('open-view', { type: 'feature', feature: 'album', title: '作品' });
  } else if (['favorites', 'tags', 'stickers', 'scan'].includes(s.key)) {
    emit('open-view', { type: 'feature', feature: s.key, title: s.label });
  } else {
    openFeature(s.key, s.label);
  }
}

function openContactEntry(s) {
  if (s.key === 'newfriends') {
    openNewFriendsPage();
    return;
  }
  if (s.key === 'groupList') {
    emit('open-view', { type: 'deep-feature', feature: 'groupList', title: '群聊' });
    return;
  }
  if (s.key === 'tags' || s.key === 'official' || s.key === 'blacklist') {
    emit('open-view', { type: 'feature', feature: s.key, title: s.label });
    return;
  }
  emit('open-view', { type: 'feature', feature: s.key, title: s.label });
}


function openEditProfile() { emit('open-view', { type: 'edit-profile' }); }
function openAddFriend() { showMore.value = false; emit('open-view', { type: 'add-friend' }); }
function openQr() { emit('open-view', { type: 'qrcode' }); }

function openContact(c) {
  emit('open-view', {
    type: 'friend-profile',
    user: {
      id: c.userId ?? c.id,
      userId: c.userId ?? c.id,
      nickname: c.nickname,
      avatar: c.avatar,
      avatarUrl: c.avatar,
      emoji: c.emoji,
      avatarEmoji: c.emoji,
      color: c.color,
      avatarColor: c.avatarColor || c.color,
      wxid: c.wxid,
      isAI: Boolean(c.isAI),
      personaId: c.personaId || null,
      isFriend: c.isFriend ?? !c.isAI,
      local: Boolean(c.isAI),
      remark: c.remark || null,
    },
  });
}

function openFriend(f) {
  openContact({ ...f, isAI: false, local: false, userId: f.id });
}

function openSubNewFriends() {
  emit('open-view', { type: 'feature', feature: 'newfriends', title: '新的朋友' });
}

// 从子页返回时刷新好友申请角标
defineExpose({
  reloadFriendRequests: loadFriendRequests,
});

// 打开新的朋友时先刷新角标
function openNewFriendsPage() {
  loadFriendRequests();
  emit('open-view', { type: 'feature', feature: 'newfriends', title: '新的朋友' });
}

function contactPeople() {
  const seen = new Set();
  const list = [];
  const push = (p) => {
    const key = p.nickname;
    if (!key || seen.has(key)) return;
    seen.add(key);
    list.push(p);
  };
  const aiMembers = []; // AI 仅出现在群聊, 不进通讯录
  // 通讯录仅展示好友（AI 群友不作为联系人）
  const friendList = friends.value || [];
  const tagFilterId = contactTagFilter.value;
  const tagMemberSet = contactTagMemberSet.value;
  for (const f of friendList) {
    // 黑名单默认不进通讯录列表
    if (f.blacklisted) continue;
    if (tagFilterId) {
      if (!tagMemberSet.has(f.id)) continue;
    }
    push({
      key: 'f-' + f.id,
      nickname: f.remark || f.nickname,
      avatar: f.avatar,
      emoji: null,
      color: f.avatarColor,
      wxid: f.wxid,
      userId: f.id,
      isAI: false,
      isFriend: true,
      remark: f.remark || null,
      tags: f.tags || [],
      blacklisted: Boolean(f.blacklisted),
    });
  }
  return list;
}

const contactTags = ref([]);
const contactTagFilter = ref(0);
const contactTagMemberSet = computed(() => {
  if (!contactTagFilter.value) return new Set();
  const t = contactTags.value.find((x) => x.id === contactTagFilter.value);
  return new Set((t?.members || []).map(Number));
});

async function loadContactTags() {
  try {
    const d = await api.tags();
    contactTags.value = d.tags || [];
  } catch {
    contactTags.value = [];
  }
}

function setContactTagFilter(id) {
  contactTagFilter.value = Number(id) || 0;
}

function alphaOf(name) {
  return pinyinInitial(name);
}

const contactGroups = computed(() => groupContactsByLetter(contactPeople()));
const contactCount = computed(() => contactGroups.value.reduce((s, g) => s + g.people.length, 0));

function toggleMore() { showMore.value = !showMore.value; }

function toastAction(label) {
  showMore.value = false;
  if (label === '添加朋友') { openAddFriend(); return; }
  if (label === '发起群聊') {
    emit('open-view', { type: 'create-group' });
    return;
  }
  if (label === '扫一扫') { openFeature('scan', label); return; }
  if (label === '收付款') { openFeature('services', label); return; }
  if (label === '服务') { openFeature('services', label); return; }
  emit('open-view', { type: 'stub', title: label });
}

function startChatLongPress(c, e) {
  clearTimeout(longPressTimer);
  // 左滑手势中不触发长按菜单
  if (swipeId.value) return;
  const startX = e?.clientX ?? 0;
  const startY = e?.clientY ?? 0;
  longPressTimer = setTimeout(() => {
    // 期间有明显位移则取消
    if (Math.abs((lastMoveX ?? startX) - startX) > 12 || Math.abs((lastMoveY ?? startY) - startY) > 12) return;
    chatActionTarget.value = c;
  }, 480);
}
function clearChatLongPress() { clearTimeout(longPressTimer); }

function onSwipeStart(id, e) {
  swipeStartX = e.clientX ?? 0;
  swipeStartY = e.clientY ?? 0;
  lastMoveX = swipeStartX;
  lastMoveY = swipeStartY;
  swipeAxis.value = null;
}
function onSwipeMove(id, e) {
  const x = e.clientX ?? 0;
  const y = e.clientY ?? 0;
  lastMoveX = x;
  lastMoveY = y;
  const dx = x - swipeStartX;
  const dy = y - swipeStartY;
  // 先判断轴向: 纵向滑动则忽略, 避免滚动列表时误滑出操作
  if (!swipeAxis.value) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    swipeAxis.value = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  }
  if (swipeAxis.value !== 'x') return;
  if (dx < -36) {
    if (swipeId.value !== id) swipeId.value = id;
  } else if (dx > 24) {
    if (swipeId.value === id) swipeId.value = null;
  }
}
function onChatItemClick(c) {
  // 左滑展开时, 点击先收起而不是进聊天
  if (swipeId.value === c.id) {
    swipeId.value = null;
    return;
  }
  if (swipeId.value) {
    swipeId.value = null;
    return;
  }
  openChatItem(c);
}

function hideSwiped(id) {
  chats.value = chats.value.filter((x) => x.id !== id);
  api.chatClear(id).then(() => loadChats()).catch(() => {});
  swipeId.value = null;
}

let pullStartY = 0;
function onChatsTouchStart(e) {
  pullStartY = e.touches?.[0]?.clientY ?? 0;
  chatsPull.value = 0;
}
function onChatsTouchMove(e) {
  const y = e.touches?.[0]?.clientY ?? 0;
  const el = chatsScrollEl.value;
  if (el && el.scrollTop > 2) { chatsPull.value = 0; return; }
  const dy = y - pullStartY;
  chatsPull.value = dy > 0 ? Math.min(80, dy * 0.5) : 0;
}
function onChatsTouchEnd() {
  if (chatsPull.value > 48) refreshChats();
  else chatsPull.value = 0;
}

function doChatAction(kind) {
  const c = chatActionTarget.value;
  chatActionTarget.value = null;
  if (!c) return;
  const conv = c.id || c.conversationId || 'default';
  if (kind === 'read') clearUnread(conv);
  if (kind === 'mute') {
    const next = !c.muted;
    chats.value = chats.value.map((x) => (x.id === c.id ? { ...x, muted: next } : x));
    api.chatPref({ conversationId: conv, muted: next }).catch(() => {});
  }
  if (kind === 'pin') {
    const next = !c.pinned;
    chats.value = chats.value.map((x) => (x.id === c.id ? { ...x, pinned: next } : x));
    sortChats(chats.value);
    api.chatPref({ conversationId: conv, pinned: next }).catch(() => {});
  }
  if (kind === 'float') {
    toggleFloatChat(c);
    return;
  }
  if (kind === 'fold') {
    chats.value = chats.value.map((x) => (x.id === c.id ? { ...x, folded: true, pinned: false } : x));
    api.chatPref({ conversationId: conv, folded: true, pinned: false }).catch(() => {});
    return;
  }
  if (kind === 'delete' || kind === 'hide') {
    hideSwiped(c.id);
  }
}
</script>

<template>
  <div class="main-page">
    <header v-if="showNav" class="nav-bar">
      <div class="nav-spacer"></div>
      <div class="nav-title">
        <span class="nav-title-text">{{ navTitleText }}</span>
      </div>
      <div class="nav-actions">
        <button class="icon-btn" aria-label="搜索" @click="openSearch">
          <WxIcons name="search" :size="22" />
        </button>
        <button class="icon-btn" aria-label="更多" @click="tab === 'chats' ? toggleMore() : openSearch()">
          <WxIcons name="plus" :size="22" />
        </button>
      </div>
    </header>

    <main class="content">
      <!-- 微信会话列表 -->
      <div
        v-show="tab === 'chats'"
        class="tab-pane scroll-y"
        ref="chatsScrollEl"
        @touchstart.passive="onChatsTouchStart"
        @touchmove.passive="onChatsTouchMove"
        @touchend="onChatsTouchEnd"
      >
        <div v-if="chatsPull > 12 || refreshing" class="pull-tip">{{ refreshing ? '刷新中…' : '下拉刷新' }}</div>
        <ul class="msg-list">
          <li
            v-for="c in visibleChats"
            :key="c.id"
            class="msg-item"
            :class="{ pinned: c.pinned, swiped: swipeId === c.id }"
            @click="onChatItemClick(c)"
            @pointerdown="startChatLongPress(c, $event); onSwipeStart(c.id, $event)"
            @pointermove="onSwipeMove(c.id, $event)"
            @pointerup="clearChatLongPress"
            @pointerleave="clearChatLongPress"
            @pointercancel="clearChatLongPress"
          >
            <button v-show="swipeId === c.id" class="swipe-del" type="button" @click.stop="hideSwiped(c.id)">不显示</button>
            <div class="msg-swipe">
              <div class="msg-avatar-wrap">
                <UserAvatar
                  v-if="c.type === 'private'"
                  :name="c.remark || c.name"
                  :avatar="privateAvatarParts(c).avatar"
                  :emoji="privateAvatarParts(c).emoji"
                  :color="privateAvatarParts(c).color"
                  :size="52"
                />
                <div v-else class="group-avatar" :class="'n' + Math.min(9, (c.avatars || []).length || 1)">
                  <UserAvatar
                    v-for="(av, i) in (c.avatars || []).slice(0, 9)"
                    :key="i"
                    :name="groupTileParts(av, c.name).name"
                    :avatar="groupTileParts(av, c.name).avatar"
                    :emoji="groupTileParts(av, c.name).emoji"
                    :size="(c.avatars || []).length > 1 ? 16 : 22"
                  />
                </div>
                <span v-if="unreadMap[c.id]" class="msg-badge">{{ unreadMap[c.id] > 99 ? '99+' : unreadMap[c.id] }}</span>
              </div>
              <div class="msg-main">
                <div class="msg-top">
                  <div class="msg-name">{{ c.remark || c.name }}</div>
                  <div class="msg-time-col">
                    <div class="msg-time">{{ fmtTime(c.lastTime) }}</div>
                    <WxIcons v-if="c.muted" name="mute" :size="12" class="mute-bell" />
                  </div>
                </div>
                <div class="msg-bottom">
                  <div class="msg-preview">
                    <span v-if="c.draft" class="draft-tag">[草稿]</span>{{ c.draft || c.lastMessage }}
                  </div>
                </div>
              </div>
            </div>
          </li>
          <li v-if="foldedChats.length" class="msg-item folded-bar">
            <div class="msg-swipe" @click="foldedOpen = !foldedOpen">
              <div class="msg-avatar-wrap">
                <div class="folder-avatar"><WxIcons name="folder" :size="26" /></div>
              </div>
              <div class="msg-main">
                <div class="msg-top">
                  <div class="msg-name">折叠的聊天</div>
                </div>
                <div class="msg-bottom">
                  <div class="msg-preview">{{ foldedOpen ? '点击收起' : `共 ${foldedChats.length} 个会话` }}</div>
                </div>
              </div>
            </div>
          </li>
        </ul>
        <div v-if="!chats.length" class="empty-state">
          <div class="empty-illu">💬</div>
          <div class="empty-title">暂无消息</div>
          <div class="empty-sub">可添加好友或进入群聊开始聊天</div>
        </div>
      </div>

      <!-- 通讯录：滚动区 + 固定字母索引 -->
      <div v-show="tab === 'contacts'" class="tab-pane contacts-pane">
        <div class="scroll-y contacts-scroll" ref="contactsScrollEl">
          <div class="cell-group flat">
            <button v-for="s in contactEntries" :key="s.key" class="cell-row" @click="openContactEntry(s)">
              <WxIcons :name="s.icon" :size="28" />
              <span class="cell-label">{{ s.label }}</span>
              <span v-if="s.key === 'newfriends' && pendingFriendCount" class="msg-badge inline">{{ pendingFriendCount > 99 ? '99+' : pendingFriendCount }}</span>
              <span class="cell-arrow"></span>
            </button>
          </div>
          <div v-if="contactTags.length" class="tag-filter-bar">
            <button
              type="button"
              class="tag-chip"
              :class="{ on: !contactTagFilter }"
              @click="setContactTagFilter(0)"
            >全部</button>
            <button
              v-for="t in contactTags"
              :key="'tf-'+t.id"
              type="button"
              class="tag-chip"
              :class="{ on: contactTagFilter === t.id }"
              @click="setContactTagFilter(t.id)"
            >{{ t.name }}<span class="tag-chip-n">{{ (t.members || []).length }}</span></button>
          </div>
          <div class="section-bar">我的企业及企业联系人</div>
          <div class="cell-group flat">
            <button v-for="s in contactWork" :key="s.key" class="cell-row" @click="openContactEntry(s)">
              <WxIcons :name="s.icon" :size="28" />
              <span class="cell-label">{{ s.label }}</span>
              <span class="cell-arrow"></span>
            </button>
          </div>
          <div v-if="starFriends.length" class="section-bar">星标朋友</div>
          <div v-if="starFriends.length" class="cell-group flat">
            <button v-for="p in starFriends" :key="'star-'+p.key" class="contact-row" @click="openContact(p)">
              <UserAvatar :name="p.nickname" :avatar="p.avatar" :emoji="p.emoji" :color="p.color || '#07c160'" :size="44" />
              <div class="contact-name-wrap">
                <div class="contact-name">{{ p.nickname }}</div>
                <div v-if="p.tags?.length" class="contact-sub">{{ (p.tags || []).map((t) => t.name || t).join('、') }}</div>
              </div>
            </button>
          </div>
          <template v-for="g in contactGroups" :key="g.letter">
            <div class="alpha-bar" :id="'ct-letter-' + g.letter">{{ g.letter }}</div>
            <button
              v-for="p in g.people"
              :key="p.key"
              :id="'ct-' + p.key"
              class="contact-row"
              @click="openContact(p)"
            >
              <UserAvatar :name="p.nickname" :avatar="p.avatar" :emoji="p.emoji" :color="p.color || '#07c160'" :size="44" />
              <div class="contact-name-wrap">
                <div class="contact-name">{{ p.nickname }}</div>
                <div v-if="p.tags?.length" class="contact-sub">{{ (p.tags || []).map((t) => t.name || t).join('、') }}</div>
              </div>
            </button>
          </template>
          <div class="alpha-footer">{{ contactCount }} 位联系人</div>
        </div>
        <div class="alpha-index" aria-label="字母索引">
          <button type="button" class="idx-up" @click="jumpToLetter('↑')">↑</button>
          <button
            v-for="it in contactIndexLetters"
            :key="it.L"
            type="button"
            :class="{ on: it.on }"
            :aria-label="'跳到 ' + it.L"
            @click="jumpToLetter(it.L)"
          >{{ it.L }}</button>
        </div>
      </div>

      <!-- 发现 -->
      <div v-show="tab === 'discover'" class="tab-pane discover-pane scroll-y" ref="discoverScrollEl">
        <div v-for="(group, gi) in discoverGroups" :key="gi" class="cell-group flat gap">
          <button v-for="s in group" :key="s.key" class="cell-row" @click="openDiscover(s)">
            <WxIcons :name="s.icon" :size="24" />
            <span class="cell-label">{{ s.label }}</span>
            <span v-if="s.extra" class="cell-extra">{{ s.extra }}</span>
            <span v-if="s.dot || (s.key === 'moments' && momentsDot)" class="red-dot"></span>
            <span class="cell-arrow"></span>
          </button>
        </div>
      </div>

      <!-- 我 -->
      <div v-show="tab === 'me'" class="tab-pane me-pane scroll-y" ref="meScrollEl">
        <section
          class="me-hero"
          :class="{ 'has-status-bg': !!(statusBgUrl || statusGradientCss) }"
          :style="!statusBgUrl && statusGradientCss ? { backgroundImage: statusGradientCss } : undefined"
        >
          <video
            v-if="statusBgUrl && statusBgType === 'video'"
            class="status-bg-media"
            :src="statusBgUrl"
            autoplay
            muted
            loop
            playsinline
          ></video>
          <img
            v-else-if="statusBgUrl"
            class="status-bg-media"
            :src="statusBgUrl"
            alt="状态背景"
          />
          <div class="me-hero-top">
            <button class="me-profile-hit" type="button" @click="openEditProfile">
              <UserAvatar
                class="profile-avatar"
                :name="me?.nickname"
                :avatar="me?.avatar"
                :color="me?.avatarColor"
                :size="72"
              />
              <div class="profile-main">
                <div class="profile-name">{{ me?.nickname }}</div>
                <div class="profile-wxid">微信号：{{ me?.wxid || '未设置' }}</div>
              </div>
            </button>
            <div class="profile-side">
              <span class="qr-entry" @click.stop="openQr"><WxIcons name="qr" :size="22" /></span>
              <span class="side-arrow" aria-hidden="true"></span>
            </div>
          </div>
          <div class="me-hero-status">
            <button class="status-hit" type="button" @click="openStatusMenu">
              <svg v-if="hasStatus" class="status-ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path :d="statusIconD" />
              </svg>
              <span class="status-text">{{ hasStatus ? statusLabel : '设个状态' }}</span>
              <span class="status-chev">›</span>
            </button>
            <button class="status-more" type="button" aria-label="状态菜单" @click="openStatusMenu">
              <span></span><span></span><span></span>
            </button>
          </div>
        </section>

        <div class="cell-group flat gap">
          <button v-for="s in meService" :key="s.key" class="cell-row" @click="openMeCell(s)">
            <WxIcons :name="s.icon" :size="24" />
            <span class="cell-label">{{ s.label }}</span>
            <span class="cell-arrow"></span>
          </button>
        </div>
        <div class="cell-group flat gap">
          <button v-for="s in meGroup1" :key="s.key" class="cell-row" @click="openMeCell(s)">
            <WxIcons :name="s.icon" :size="24" />
            <span class="cell-label">{{ s.label }}</span>
            <span class="cell-arrow"></span>
          </button>
        </div>
        <div class="cell-group flat gap">
          <button v-for="s in meGroup2" :key="s.key" class="cell-row" @click="openMeCell(s)">
            <WxIcons :name="s.icon" :size="24" />
            <span class="cell-label">{{ s.label }}</span>
            <span class="cell-arrow"></span>
          </button>
        </div>
      </div>
    </main>

    <!-- 状态底部菜单（对齐微信截图） -->
    <div v-if="showStatusSheet" class="status-sheet-mask" @click.self="showStatusSheet = false">
      <div class="status-sheet">
        <button type="button" class="sheet-row" @click="goNewStatus">设个新状态</button>
        <button type="button" class="sheet-row" @click="goEditStatus">修改状态</button>
        <button type="button" class="sheet-row" @click="endStatus">
          <div class="sheet-row-main">结束状态</div>
          <div v-if="statusRemainText" class="sheet-row-sub">{{ statusRemainText }}</div>
        </button>
        <div class="sheet-gap"></div>
        <button type="button" class="sheet-row cancel" @click="showStatusSheet = false">取消</button>
      </div>
    </div>

    <div v-if="showMore" class="mask" @click="showMore = false">
      <div class="pop-menu">
        <button class="pop-item" @click="toastAction('发起群聊')">发起群聊</button>
        <button class="pop-item" @click="openAddFriend">添加朋友</button>
        <button class="pop-item" @click="toastAction('扫一扫')">扫一扫</button>
        <button class="pop-item" @click="toastAction('收付款')">收付款</button>
      </div>
    </div>

    <section v-if="showSearch" class="search-page">
      <header class="search-nav">
        <div class="search-field">
          <span class="search-entry-icon"></span>
          <input ref="searchInputEl" v-model="searchQuery" type="search" placeholder="搜索" />
        </div>
        <button class="text-btn" @click="closeSearch">取消</button>
      </header>
      <div class="search-body scroll-y">
        <div v-if="!searchQuery.trim()" class="search-hint">搜索指定内容</div>
        <template v-else>
          <div v-if="!searchResults.chats.length && !searchResults.people.length" class="search-hint">无结果</div>
          <div v-if="searchResults.chats.length" class="search-results">
            <div class="search-cat">聊天</div>
            <button v-for="c in searchResults.chats" :key="c.id" class="search-item" @click="pickSearchChat(c)">
              <div class="search-item-main">
                <div class="search-item-name">{{ c.remark || c.name }}</div>
                <div class="search-item-sub">{{ c.lastMessage }}</div>
              </div>
            </button>
          </div>
          <div v-if="searchResults.people.length" class="search-results">
            <div class="search-cat">联系人</div>
            <button v-for="p in searchResults.people" :key="p.id" class="search-item" @click="pickSearchPerson(p)">
              <div class="search-item-main">
                <div class="search-item-name">{{ p.remark || p.nickname }}</div>
                <div class="search-item-sub">联系人</div>
              </div>
            </button>
          </div>
        </template>
      </div>
    </section>

    <div v-if="chatActionTarget" class="mask" @click="chatActionTarget = null">
      <div class="pop-menu wide">
        <button class="pop-item" @click="doChatAction('read')">标为未读/已读</button>
        <button class="pop-item" @click="doChatAction('mute')">消息免打扰</button>
        <button class="pop-item" @click="doChatAction('pin')">置顶聊天</button>
        <button class="pop-item" @click="doChatAction('float')">浮窗</button>
        <button class="pop-item" @click="doChatAction('fold')">折叠该聊天</button>
        <button class="pop-item danger" @click="doChatAction('hide')">不显示该聊天</button>
      </div>
    </div>

    <div v-if="floatChats.length" class="float-stack">
      <button
        v-for="fc in floatChats"
        :key="'float-' + fc.id"
        class="float-bubble"
        type="button"
        @click="openFloat(fc)"
      >{{ (fc.name || '会').slice(0, 2) }}</button>
    </div>

    <nav class="tab-bar">
      <button class="tab-item" :class="{ active: tab === 'chats' }" @click="switchTab('chats')">
        <span class="tab-ico"><WxIcons :name="tab === 'chats' ? 'tab-chats-on' : 'tab-chats'" :size="26" /></span>
        <span>微信</span>
        <span v-if="unreadTotal > 0" class="tab-badge">{{ unreadTotal > 99 ? '99+' : unreadTotal }}</span>
      </button>
      <button class="tab-item" :class="{ active: tab === 'contacts' }" @click="switchTab('contacts')">
        <span class="tab-ico"><WxIcons :name="tab === 'contacts' ? 'tab-contacts-on' : 'tab-contacts'" :size="26" /></span>
        <span>通讯录</span>
        <span v-if="pendingFriendCount > 0" class="tab-badge">{{ pendingFriendCount > 99 ? '99+' : pendingFriendCount }}</span>
      </button>
      <button class="tab-item" :class="{ active: tab === 'discover' }" @click="switchTab('discover')">
        <span class="tab-ico"><WxIcons :name="tab === 'discover' ? 'tab-discover-on' : 'tab-discover'" :size="26" /></span>
        <span>发现</span>
        <span v-if="momentsDot" class="tab-dot"></span>
      </button>
      <button class="tab-item" :class="{ active: tab === 'me' }" @click="switchTab('me')">
        <span class="tab-ico"><WxIcons :name="tab === 'me' ? 'tab-me-on' : 'tab-me'" :size="26" /></span>
        <span>我</span>
      </button>
    </nav>
  </div>
</template>

<script>
/* removed extra options API */
</script>

<style scoped>
.main-page { display: flex; flex-direction: column; min-height: 0; flex: 1; width: 100%; background: var(--bg); position: relative; }
.nav-bar {
  height: var(--nav-h);
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
  background: var(--bg);
  border-bottom: 0.5px solid var(--divider);
}
.nav-spacer { width: 88px; flex-shrink: 0; }
.nav-title {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  max-width: 64%;
  z-index: 1;
  pointer-events: none;
}
.nav-title-text {
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
  line-height: 1;
  white-space: nowrap;
}
.nav-unread {
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
  line-height: 1;
}
.nav-actions {
  display: flex;
  align-items: center;
  min-height: 44px;
  margin-left: auto;
  z-index: 2;
}
.icon-btn {
  width: 44px; height: 44px; border: 0; background: transparent; color: var(--text);
  display: flex; align-items: center; justify-content: center;
}
.content { flex: 1; min-height: 0; position: relative; }
.group-avatar {
  width: 52px; height: 52px; border-radius: 6px; overflow: hidden;
  display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--divider-soft);
  padding: 2px; box-sizing: border-box;
}
.group-avatar.n1 { display: flex; align-items: center; justify-content: center; padding: 0; }
.contacts-pane {
  position: absolute; inset: 0; overflow: hidden;
  padding-bottom: calc(var(--tab-h) + var(--safe-b) + 8px);
}
.tag-filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg);
}
.tag-chip {
  border: 0;
  background: var(--white);
  color: var(--text-2);
  font-size: 12px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 14px;
}
.tag-chip.on {
  background: rgba(7, 193, 96, 0.12);
  color: var(--green);
  font-weight: 600;
}
.tag-chip-n {
  margin-left: 4px;
  font-size: 10px;
  opacity: 0.75;
}
.contacts-scroll {
  position: absolute; inset: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding-bottom: calc(var(--tab-h) + var(--safe-b) + 8px);
}
.alpha-bar {
  padding: 6px 16px 6px 28px; font-size: 13px; color: var(--text-2); background: var(--bg);
  scroll-margin-top: 0;
}
.contact-row {
  width: 100%; display: flex; align-items: center; gap: 12px; padding: 0 36px 0 16px;
  background: var(--white); border: 0; text-align: left; box-sizing: border-box; min-height: 60px;
  position: relative;
}
.contact-row::after {
  content: ''; position: absolute; left: 72px; right: 0; bottom: 0; height: 0.5px; background: var(--divider);
}
.contact-name { font-size: 17px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; }
.pull-tip {
  text-align: center; font-size: 12px; color: var(--text-3); padding: 8px 0 4px;
  background: var(--bg);
}
.empty-state {
  padding: 64px 24px; text-align: center; color: var(--text-2);
}
.empty-illu { font-size: 40px; margin-bottom: 10px; }
.empty-title { font-size: 16px; color: var(--text); }
.empty-sub { margin-top: 6px; font-size: 13px; color: var(--text-3); }
.tab-pane { position: absolute; inset: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: calc(var(--tab-h) + var(--safe-b) + 8px); }
.tab-pane.contacts-pane { overflow: hidden; }

.search-entry {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  width: calc(100% - 24px); margin: 8px auto 0; height: 36px; border: 0; border-radius: 6px;
  background: var(--white); color: var(--text-3); font-size: 14px;
}
.search-entry-icon {
  width: 14px; height: 14px; border: 1.5px solid var(--text-3); border-radius: 50%; position: relative; flex-shrink: 0;
}
.search-entry-icon::after {
  content: ''; position: absolute; width: 5px; height: 1.5px; background: var(--text-3); right: -4px; bottom: -1px; transform: rotate(45deg);
}
.msg-list { list-style: none; margin-top: 8px; background: var(--white); }
.folded-bar { background: var(--white); }
.folded-btn {
  width: 100%; border: 0; background: transparent; color: var(--text-2);
  min-height: 48px; font-size: 14px; text-align: left; padding: 0 16px;
}
.float-stack {
  position: absolute; right: 10px; bottom: calc(var(--tab-h) + var(--safe-b) + 16px);
  display: flex; flex-direction: column; gap: 8px; z-index: 20;
}
.float-bubble {
  width: 44px; height: 44px; border-radius: 50%; border: 0;
  background: #07c160; color: #fff; font-size: 12px; font-weight: 600;
  box-shadow: 0 4px 12px rgba(0,0,0,0.18);
}
.msg-item { position: relative; overflow: hidden; background: var(--white); touch-action: pan-y; }
.msg-item + .msg-item .msg-swipe::before {
  content: ''; position: absolute; left: 72px; right: 0; top: 0; height: 0.5px; background: var(--divider); z-index: 1;
}
.msg-swipe {
  position: relative; z-index: 1; width: 100%; box-sizing: border-box;
  display: flex; align-items: center; gap: 12px;
  min-height: 64px; padding: 10px 16px; background: var(--white);
  transition: transform 0.22s ease;
}
.msg-item.swiped .msg-swipe { transform: translateX(-72px); }
.msg-item.pinned .msg-swipe { background: var(--divider-soft); }
.msg-avatar-wrap { position: relative; width: 48px; height: 48px; flex-shrink: 0; }
.msg-badge {
  position: absolute; top: -4px; right: -8px; min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 9px; background: var(--red); color: #fff; font-size: 11px; line-height: 18px;
  text-align: center; box-sizing: border-box; z-index: 2; font-weight: 500;
}
.msg-badge.inline { position: static; display: inline-block; margin-right: 4px; }
.msg-main { flex: 1; min-width: 0; }
.msg-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.msg-name { flex: 1; min-width: 0; font-size: 17px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msg-time-col { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
.msg-time { font-size: 12px; color: var(--text-3); }
.msg-bottom { margin-top: 4px; }
.draft-tag { color: #fa5151; margin-right: 2px; font-weight: 500; }
.msg-time { font-size: 12px; color: var(--text-3); white-space: nowrap; }
.msg-preview { font-size: 14px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msg-badge {
  position: absolute; top: 0; right: 0;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 9px; background: #fa5151; color: #fff;
  font-size: 11px; line-height: 18px; text-align: center;
  box-sizing: border-box; z-index: 1;
}
.msg-badge.inline { position: static; display: inline-block; margin-right: 4px; }
.folded-bar .folder-avatar {
  width: 44px; height: 44px; border-radius: 6px;
  background: #c8c9cc; color: #fff;
  display: grid; place-items: center;
}
.mute-bell { margin-left: 4px; opacity: 0.45; vertical-align: middle; }
.draft-tag { color: var(--red); }
.swipe-del {
  position: absolute; right: 0; top: 0; bottom: 0; width: 72px;
  border: 0; background: var(--red); color: #fff; font-size: 14px;
  z-index: 2;
}
.group-avatar { display: grid; gap: 1px; width: 48px; height: 48px; border-radius: 4px; overflow: hidden; background: #f2f2f2; padding: 2px; }
.group-avatar.n1,.group-avatar.n2,.group-avatar.n3,.group-avatar.n4 { grid-template-columns: repeat(2,1fr); grid-template-rows: repeat(2,1fr); }
.group-avatar.n5,.group-avatar.n6,.group-avatar.n7 { grid-template-columns: repeat(3,1fr); grid-template-rows: repeat(2,1fr); }
.group-avatar.n8,.group-avatar.n9 { grid-template-columns: repeat(3,1fr); grid-template-rows: repeat(3,1fr); }
.empty-state { padding: 48px 16px; text-align: center; color: var(--text-3); font-size: 14px; }
.cell-group { background: var(--white); margin-top: 8px; }
.cell-group.flat { background: var(--white); margin-top: 0; }
.cell-group.flat.gap { margin-top: 8px; }
.section-bar {
  padding: 8px 16px; font-size: 13px; color: var(--text-2); background: var(--bg);
}
.cell-row {
  width: 100%; display: flex; align-items: center; gap: 12px; padding: 0 16px;
  min-height: 54px; text-align: left; box-sizing: border-box; border: 0; background: var(--white);
  position: relative;
}
.cell-row + .cell-row::before {
  content: ''; position: absolute; left: 56px; right: 0; top: 0; height: 0.5px; background: var(--divider);
}
.cell-row:active { background: var(--press); }
.cell-label { flex: 1; min-width: 0; font-size: 16px; color: var(--text); }
.cell-extra {
  max-width: 42%; font-size: 13px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cell-arrow { width: 8px; height: 8px; border-right: 1.5px solid #c7c7cc; border-top: 1.5px solid #c7c7cc; transform: rotate(45deg); flex-shrink: 0; margin-left: 2px; color: #c7c7cc; }
.red-dot { width: 8px; height: 8px; border-radius: 4px; background: var(--red); margin-right: 6px; flex-shrink: 0; }
.alpha-bar { padding: 6px 16px; font-size: 13px; color: var(--text-2); background: var(--bg); }
.contact-row {
  width: 100%; display: flex; align-items: center; gap: 12px; padding: 8px 16px;
  background: var(--white); border: 0; text-align: left; box-sizing: border-box; min-height: 60px;
  position: relative;
}
.contact-row::after {
  content: ''; position: absolute; left: 72px; right: 0; bottom: 0; height: 0.5px; background: var(--divider);
}
.contact-row:last-child::after { display: none; }
.contact-name-wrap { min-width: 0; flex: 1; }
.contact-name { font-size: 17px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.contact-sub { margin-top: 2px; font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.alpha-footer { padding: 16px; text-align: center; font-size: 12px; color: var(--text-3); }
/* 字母索引固定在通讯录右侧, 不随列表滚动 */
.alpha-index {
  position: absolute; right: 0; top: 50%; transform: translateY(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 0;
  z-index: 20; padding: 4px 1px; pointer-events: auto;
  max-height: calc(100% - 24px); overflow: hidden;
}
.alpha-index button {
  border: 0; background: transparent; color: var(--text-3); font-size: 10px;
  width: 20px; min-height: 16px; padding: 0; line-height: 16px; font-weight: 500;
  pointer-events: auto; cursor: pointer; flex-shrink: 0;
}
.alpha-index button.on { color: var(--text); font-weight: 600; }
.alpha-index button.idx-up { color: var(--text-2); }
.alpha-index button:active { color: var(--green); }
.discover-pane, .me-pane { background: var(--bg); }
/* 「我」页头图区（对齐微信：渐变铺满 + 状态行） */
.me-hero {
  position: relative;
  padding: calc(20px + env(safe-area-inset-top, 0px)) 16px 16px;
  background: var(--white);
  overflow: hidden;
}
.me-hero.has-status-bg {
  background-color: transparent;
  background-size: cover !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
}
.me-hero-top {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.me-profile-hit {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 16px;
  border: 0;
  background: transparent;
  padding: 8px 0;
  text-align: left;
  cursor: pointer;
}
.profile-avatar {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  border-radius: 8px;
}
.me-hero.has-status-bg .profile-avatar {
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.55);
}
.profile-main {
  flex: 1;
  min-width: 0;
  padding-top: 4px;
  position: relative;
  z-index: 1;
}
.profile-name { font-size: 22px; font-weight: 600; color: var(--text); }
.profile-wxid { margin-top: 8px; font-size: 14px; color: var(--text-2); }
.me-hero.has-status-bg .profile-name,
.me-hero.has-status-bg .profile-wxid {
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}
.profile-side {
  margin-left: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding-top: 10px;
  flex-shrink: 0;
  min-width: 28px;
  position: relative;
  z-index: 1;
}
.qr-entry {
  font-size: 20px;
  color: var(--text-2);
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}
.side-arrow {
  width: 8px;
  height: 8px;
  border-right: 1.5px solid #c7c7cc;
  border-top: 1.5px solid #c7c7cc;
  transform: rotate(45deg);
  display: block;
}
.me-hero.has-status-bg .qr-entry,
.me-hero.has-status-bg .side-arrow {
  color: #fff;
  border-color: rgba(255, 255, 255, 0.85);
}
.me-hero-status {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18px;
  min-height: 36px;
}
.status-hit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  padding: 4px 0;
  font-size: 15px;
  color: var(--text-2);
  cursor: pointer;
}
.me-hero.has-status-bg .status-hit { color: rgba(255, 255, 255, 0.95); }
.status-ico { opacity: 0.95; }
.status-chev { opacity: 0.75; font-size: 16px; }
.status-more {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  cursor: pointer;
  padding: 0;
}
.me-hero.has-status-bg .status-more { background: rgba(255, 255, 255, 0.22); }
.status-more span {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-3);
}
.me-hero.has-status-bg .status-more span { background: #fff; }

.status-bg-media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 0;
  pointer-events: none;
}

/* 状态底部菜单 */
.status-sheet-mask {
  position: absolute;
  inset: 0;
  z-index: 80;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-end;
}
.status-sheet {
  width: 100%;
  background: #f7f7f7;
  border-radius: 12px 12px 0 0;
  overflow: hidden;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.sheet-row {
  width: 100%;
  min-height: 54px;
  border: 0;
  border-bottom: 0.5px solid #e5e5e5;
  background: #fff;
  color: var(--text);
  font-size: 17px;
  text-align: center;
  cursor: pointer;
  padding: 10px 16px;
}
.sheet-row:last-child { border-bottom: 0; }
.sheet-row-main { font-size: 17px; color: var(--text); }
.sheet-row-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-3);
}
.sheet-gap {
  height: 8px;
  background: #f0f0f0;
}
.sheet-row.cancel {
  margin-top: 0;
  font-weight: 500;
}
.tab-bar {
  position: absolute; left: 0; right: 0; bottom: 0; height: calc(var(--tab-h) + var(--safe-b));
  padding-bottom: var(--safe-b); background: var(--white); border-top: 0.5px solid var(--divider);
  display: flex; z-index: 30; align-items: stretch;
}
.tab-item {
  flex: 1; border: 0; background: transparent; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 2px; color: var(--text-2); font-size: 10px; position: relative; min-height: 52px;
}
.tab-item.active { color: var(--green); }
.tab-ico { font-size: 22px; line-height: 1; }
.tab-badge {
  position: absolute; top: 4px; left: calc(50% + 6px); min-width: 16px; height: 16px; padding: 0 4px;
  border-radius: 8px; background: var(--red); color: #fff; font-size: 10px; line-height: 16px; text-align: center;
  font-weight: 500;
}
.tab-dot { position: absolute; top: 8px; left: calc(50% + 8px); width: 8px; height: 8px; border-radius: 4px; background: var(--red); }
.mask { position: absolute; inset: 0; background: var(--mask); z-index: 30; }
.pop-menu {
  position: absolute; top: 4px; right: 8px; width: 168px;
  background: #4c4c4c; border-radius: 6px; overflow: hidden;
  box-shadow: 0 8px 24px rgba(0,0,0,0.25);
  z-index: 45; transform-origin: top right; animation: popIn 160ms var(--ease);
}
.pop-menu.wide { width: 176px; }
.pop-item {
  width: 100%; height: 48px; padding: 0 14px; color: #fff; font-size: 15px;
  text-align: left; display: flex; align-items: center; position: relative;
  border: 0; background: transparent; cursor: pointer;
}
.pop-item:active { background: rgba(255,255,255,0.12); }
.pop-item.danger { color: #ff6b6b; }
.pop-item + .pop-item::before {
  content: ""; position: absolute; left: 14px; right: 0; top: 0;
  height: 0.5px; background: rgba(255,255,255,0.12);
}
.pop-menu.wide { width: 168px; }
.pop-item { width: 100%; height: 48px; padding: 0 14px; color: #fff; font-size: 15px; border: 0; background: transparent; text-align: left; display: flex; align-items: center; }
.pop-item:active { background: rgba(255,255,255,0.12); }
.pop-item.danger { color: #ff6b6b; }
.search-page { position: absolute; inset: 0; background: var(--bg); z-index: 40; display: flex; flex-direction: column; }
.search-nav { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 0.5px solid var(--divider); }
.search-field { flex: 1; display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px; background: var(--white); border-radius: 6px; }
.search-field input { flex: 1; border: 0; outline: 0; background: transparent; font-size: 14px; color: var(--text); min-width: 0; }
.text-btn { border: 0; background: transparent; color: var(--green); font-size: 14px; padding: 8px 4px; }
.search-body { flex: 1; overflow: auto; }
.search-hint { padding: 40px 16px; text-align: center; color: var(--text-3); font-size: 13px; }
.search-cat { padding: 10px 16px 4px; font-size: 12px; color: var(--text-2); }
.search-item { width: 100%; padding: 12px 16px; background: var(--white); border: 0; text-align: left; display: flex; gap: 10px; }
.search-item + .search-item { border-top: 0.5px solid var(--divider); }
.search-item-name { font-size: 16px; color: var(--text); }
.search-item-sub { margin-top: 2px; font-size: 13px; color: var(--text-2); }
</style>
