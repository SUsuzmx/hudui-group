<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { io } from 'socket.io-client';
import { getToken, api } from '../api.js';
import UserAvatar from './UserAvatar.vue';

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
]);

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

const discoverSections = [
  { icon: '📷', label: '朋友圈', key: 'moments', color: '#3a7' },
  { icon: '▦', label: '扫一扫', key: 'scan', color: '#3a7' },
  { icon: '🔍', label: '搜一搜', key: 'search', color: '#3a7' },
];
const meSections = [
  { icon: '⭐', label: '收藏', key: 'favorites', color: '#f85' },
  { icon: '🖼', label: '相册', key: 'album', color: '#3a7' },
  { icon: '📷', label: '朋友圈', key: 'moments-mine', color: '#3a7' },
  { icon: '💳', label: '服务', key: 'services', color: '#5b9' },
  { icon: '💰', label: '钱包', key: 'wallet', color: '#e6a23c' },
  { icon: '🏷', label: '标签', key: 'tags', color: '#57c' },
];
const settingsSections = [
  { icon: '⚙️', label: '设置', key: 'settings', color: '#999' },
];

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
  loadChats();
  loadFriends();
  loadFriendRequests();
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

function openChatItem(c) {
  clearUnread(c.id || c.conversationId);
  if (c.type === 'private') {
    if (c.peerId || c.isAI === false) {
      emit('open-private-chat', {
        nickname: c.remark || c.name,
        avatar: c.personaAvatar,
        color: c.personaAvatar ? undefined : '#4f6ef7',
        isAI: false,
        userId: c.peerId,
        remark: c.remark || null,
      });
    } else {
      emit('open-private-chat', {
        nickname: c.name,
        avatar: c.personaAvatar,
        avatarUrl: c.personaAvatar,
        emoji: c.personaEmoji,
        isAI: true,
        key: 'ai-' + (c.personaId || c.id),
        personaId: c.personaId || 'siqi',
      });
    }
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
    wxid: p.wxid,
    isFriend: true,
    isAI: false,
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
  openFeature(s.key, s.label);
}

function openMeCell(s) {
  if (s.key === 'moments-mine') {
    emit('open-view', { type: 'moments', mode: 'mine' });
  } else if (s.key === 'settings') {
    emit('open-view', { type: 'settings' });
  } else if (s.key === 'wallet') {
    emit('open-view', { type: 'feature', feature: 'wallet', title: '钱包' });
  } else if (s.key === 'album' || s.key === 'services' || s.key === 'favorites' || s.key === 'tags') {
    emit('open-view', { type: 'feature', feature: s.key, title: s.label });
  } else {
    openFeature(s.key, s.label);
  }
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

function contactPeople() {
  const seen = new Set();
  const list = [];
  const push = (p) => {
    const key = p.nickname;
    if (!key || seen.has(key)) return;
    seen.add(key);
    list.push(p);
  };
  const aiMembers = members.value.aiMembers || [];
  const allUsers = members.value.allUsers || [];
  const friendList = friends.value || [];
  for (const f of friendList) {
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
    });
  }
  for (const a of aiMembers) {
    push({
      key: 'ai-' + a.id,
      nickname: a.nickname,
      avatar: a.avatarUrl,
      emoji: a.avatarUrl ? null : a.avatarEmoji,
      color: '#07c160',
      isAI: true,
      personaId: a.id,
      isFriend: false,
    });
  }
  for (const u of allUsers) {
    if (u.id === props.me?.id) continue;
    push({
      key: 'u-' + u.id,
      nickname: u.nickname,
      avatar: u.avatar,
      emoji: null,
      color: u.avatarColor,
      wxid: u.wxid,
      userId: u.id,
      isAI: false,
      isFriend: friendList.some((f) => f.id === u.id),
    });
  }
  return list;
}

function alphaOf(name) {
  const ch = (name || '?')[0].toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
}

const contactGroups = computed(() => {
  const map = new Map();
  for (const p of contactPeople()) {
    const a = alphaOf(p.nickname);
    if (!map.has(a)) map.set(a, []);
    map.get(a).push(p);
  }
  return [...map.entries()]
    .sort((x, y) => (x[0] === '#' ? 1 : y[0] === '#' ? -1 : x[0].localeCompare(y[0])))
    .map(([letter, people]) => ({ letter, people }));
});

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
  if (kind === 'delete' || kind === 'hide') {
    hideSwiped(c.id);
  }
}
</script>

<template>
  <div class="main-page">
    <header class="nav-bar">
      <div class="nav-title">
        {{ tab === 'chats' ? '微信' : tab === 'contacts' ? '通讯录' : tab === 'discover' ? '发现' : '我' }}
        <span v-if="tab === 'chats' && unreadTotal > 0" class="nav-unread">{{ unreadTotal > 99 ? '99+' : unreadTotal }}</span>
      </div>
      <div class="nav-actions">
        <button v-if="tab === 'chats'" class="icon-btn" aria-label="搜索" @click="openSearch">
          <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        <button v-if="tab === 'chats'" class="icon-btn" aria-label="更多" @click="toggleMore">
          <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/></svg>
        </button>
        <button v-if="tab === 'contacts'" class="icon-btn" aria-label="添加朋友" @click="openAddFriend">
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
    </header>

    <main class="content">
      <div v-show="tab === 'chats'" class="tab-pane scroll-y" ref="chatsScrollEl">
        <button class="search-entry" @click="openSearch">
          <span class="search-entry-icon"></span>
          <span>搜索</span>
        </button>
        <ul class="msg-list">
          <li
            v-for="c in chats"
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
            <button
              v-show="swipeId === c.id"
              class="swipe-del"
              type="button"
              @click.stop="hideSwiped(c.id)"
            >不显示</button>
            <div class="msg-swipe">
              <div class="msg-avatar-wrap">
                <UserAvatar
                  v-if="c.type === 'private'"
                  :name="c.remark || c.name"
                  :avatar="typeof c.avatars?.[0] === 'string' && String(c.avatars[0]).startsWith('/') ? c.avatars[0] : null"
                  :emoji="typeof c.avatars?.[0] === 'string' && !String(c.avatars[0]).startsWith('/') ? c.avatars[0] : null"
                  :size="48"
                />
                <div v-else class="group-avatar" :class="'n' + Math.min(9, (c.avatars || []).length || 1)">
                  <UserAvatar
                    v-for="(av, i) in (c.avatars || []).slice(0, 9)"
                    :key="i"
                    :name="c.name"
                    :avatar="typeof av === 'string' && String(av).startsWith('/') ? av : null"
                    :emoji="typeof av === 'string' && !String(av).startsWith('/') ? av : null"
                    :size="14"
                  />
                </div>
                <span v-if="unreadMap[c.id]" class="msg-badge">{{ unreadMap[c.id] > 99 ? '99+' : unreadMap[c.id] }}</span>
              </div>
              <div class="msg-main">
                <div class="msg-top">
                  <div class="msg-name">{{ c.remark || c.name }}</div>
                  <div class="msg-time-col">
                    <div class="msg-time">{{ fmtTime(c.lastTime) }}</div>
                    <svg v-if="c.muted" class="mute-bell" viewBox="0 0 24 24" width="12" height="12"><path d="M8 10a4 4 0 0 1 8 0v1l2 2H6l2-2v-1z" fill="none" stroke="#c0c0c0" stroke-width="1.6"/><path d="M4 4l16 16" stroke="#c0c0c0" stroke-width="1.6" stroke-linecap="round"/></svg>
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
        </ul>
        <div v-if="!chats.length" class="empty-state">暂无消息</div>
      </div>

      <div v-show="tab === 'contacts'" class="tab-pane scroll-y" ref="contactsScrollEl">
        <button class="search-entry" @click="openSearch">
          <span class="search-entry-icon"></span>
          <span>搜索</span>
        </button>
        <div class="cell-group">
          <button class="cell-row" @click="openSubNewFriends">
            <span class="cell-icon" style="background:#07c160">👤</span>
            <span class="cell-label">新的朋友</span>
            <span v-if="pendingFriendCount" class="msg-badge inline">{{ pendingFriendCount > 99 ? '99+' : pendingFriendCount }}</span>
            <span class="cell-arrow"></span>
          </button>
          <button class="cell-row" @click="openFeature('tags', '标签')">
            <span class="cell-icon" style="background:#57c">🏷</span>
            <span class="cell-label">标签</span>
            <span class="cell-arrow"></span>
          </button>
          <button class="cell-row" @click="openFeature('official', '公众号')">
            <span class="cell-icon" style="background:#57c">📢</span>
            <span class="cell-label">公众号</span>
            <span class="cell-arrow"></span>
          </button>
        </div>
        <template v-for="g in contactGroups" :key="g.letter">
          <div class="alpha-bar">{{ g.letter }}</div>
          <button
            v-for="p in g.people"
            :key="p.key"
            class="contact-row"
            @click="openContact(p)"
          >
            <UserAvatar :name="p.nickname" :avatar="p.avatar" :emoji="p.emoji" :color="p.color || '#07c160'" :size="40" />
            <div class="contact-name-wrap">
              <div class="contact-name">{{ p.nickname }}</div>
              <div v-if="p.isAI || p.remark" class="contact-sub">{{ p.isAI ? 'AI 联系人' : (p.remark || '') }}</div>
            </div>
          </button>
        </template>
        <div class="alpha-footer">共 {{ contactCount }} 位联系人</div>
      </div>

      <div v-show="tab === 'discover'" class="tab-pane scroll-y" ref="discoverScrollEl">
        <div class="cell-group">
          <button v-for="(s, i) in discoverSections" :key="s.key" class="cell-row" @click="openDiscover(s)">
            <span class="cell-icon" :style="{ background: s.color }">{{ s.icon }}</span>
            <span class="cell-label">{{ s.label }}</span>
            <span v-if="i === 0 && momentsDot" class="red-dot"></span>
            <span class="cell-arrow"></span>
          </button>
        </div>
        <div class="discover-tip">已对齐微信发现页核心入口</div>
      </div>

      <div v-show="tab === 'me'" class="tab-pane scroll-y" ref="meScrollEl">
        <button class="profile-card" type="button" @click="openEditProfile">
          <UserAvatar :name="me?.nickname" :avatar="me?.avatar" :color="me?.avatarColor" :size="64" />
          <div class="profile-main">
            <div class="profile-name">{{ me?.nickname }}</div>
            <div class="profile-wxid">微信号：{{ me?.wxid || '未设置' }}</div>
          </div>
          <span class="qr-entry" @click.stop="openQr">▦</span>
          <span class="cell-arrow"></span>
        </button>
        <div class="cell-group">
          <button v-for="s in meSections" :key="s.key" class="cell-row" @click="openMeCell(s)">
            <span class="cell-icon" :style="{ background: s.color }">{{ s.icon }}</span>
            <span class="cell-label">{{ s.label }}</span>
            <span class="cell-arrow"></span>
          </button>
        </div>
        <div class="cell-group">
          <button v-for="s in settingsSections" :key="s.key" class="cell-row" @click="openMeCell(s)">
            <span class="cell-icon" :style="{ background: s.color }">{{ s.icon }}</span>
            <span class="cell-label">{{ s.label }}</span>
            <span class="cell-arrow"></span>
          </button>
        </div>
      </div>
    </main>

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
        <button class="pop-item" @click="doChatAction('read')">标为已读</button>
        <button class="pop-item" @click="doChatAction('mute')">消息免打扰</button>
        <button class="pop-item" @click="doChatAction('pin')">置顶聊天</button>
        <button class="pop-item danger" @click="doChatAction('hide')">不显示该聊天</button>
      </div>
    </div>

    <nav class="tab-bar">
      <button class="tab-item" :class="{ active: tab === 'chats' }" @click="switchTab('chats')">
        <span class="tab-ico">💬</span>
        <span>微信</span>
        <span v-if="unreadTotal > 0" class="tab-badge">{{ unreadTotal > 99 ? '99+' : unreadTotal }}</span>
      </button>
      <button class="tab-item" :class="{ active: tab === 'contacts' }" @click="switchTab('contacts')">
        <span class="tab-ico">👥</span>
        <span>通讯录</span>
        <span v-if="pendingFriendCount > 0" class="tab-badge">{{ pendingFriendCount > 99 ? '99+' : pendingFriendCount }}</span>
      </button>
      <button class="tab-item" :class="{ active: tab === 'discover' }" @click="switchTab('discover')">
        <span class="tab-ico">🧭</span>
        <span>发现</span>
        <span v-if="momentsDot" class="tab-dot"></span>
      </button>
      <button class="tab-item" :class="{ active: tab === 'me' }" @click="switchTab('me')">
        <span class="tab-ico">👤</span>
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
  height: var(--nav-h); flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
  padding: 0 8px 0 16px; background: var(--bg); border-bottom: 0.5px solid var(--divider);
}
.nav-title { font-size: 17px; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 6px; }
.nav-unread { font-size: 12px; color: var(--red); font-weight: 400; }
.nav-actions { display: flex; align-items: center; }
.icon-btn { width: 40px; height: 40px; border: 0; background: transparent; color: var(--text); display: flex; align-items: center; justify-content: center; }
.content { flex: 1; min-height: 0; position: relative; }
.tab-pane { position: absolute; inset: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: calc(var(--tab-h) + var(--safe-b) + 8px); }
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
.msg-item.pinned .msg-swipe { background: #f7f7f7; }
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
.msg-preview { font-size: 14px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
.cell-row {
  width: 100%; display: flex; align-items: center; gap: 12px; padding: 0 16px;
  min-height: var(--wx-cell-h); text-align: left; box-sizing: border-box; border: 0; background: transparent;
}
.cell-row + .cell-row::before { content: ''; display: block; }
.cell-row:active { background: var(--press); }
.cell-icon { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 15px; color: #fff; flex-shrink: 0; }
.cell-label { flex: 1; min-width: 0; font-size: 16px; color: var(--text); }
.cell-arrow { width: 8px; height: 8px; border-right: 1.5px solid #c7c7cc; border-top: 1.5px solid #c7c7cc; transform: rotate(45deg); flex-shrink: 0; margin-left: 2px; }
.red-dot { width: 8px; height: 8px; border-radius: 4px; background: var(--red); margin-right: 6px; }
.alpha-bar { padding: 6px 16px; font-size: 13px; color: var(--text-2); background: var(--bg); }
.contact-row {
  width: 100%; display: flex; align-items: center; gap: 12px; padding: 8px 16px;
  background: var(--white); border: 0; text-align: left; box-sizing: border-box; min-height: 56px;
}
.contact-row + .contact-row { border-top: 0.5px solid var(--divider); }
.contact-name-wrap { min-width: 0; flex: 1; }
.contact-name { font-size: 17px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.contact-sub { margin-top: 2px; font-size: 12px; color: var(--text-2); }
.alpha-footer { padding: 16px; text-align: center; font-size: 12px; color: var(--text-3); }
.discover-tip { padding: 16px; text-align: center; font-size: 12px; color: var(--text-3); }
.profile-card {
  width: 100%; display: flex; align-items: center; gap: 14px; padding: 20px 16px;
  background: var(--white); border: 0; text-align: left; margin-top: 8px; box-sizing: border-box;
}
.profile-main { flex: 1; min-width: 0; }
.profile-name { font-size: 20px; font-weight: 500; color: var(--text); }
.profile-wxid { margin-top: 6px; font-size: 14px; color: var(--text-2); }
.qr-entry { font-size: 20px; color: var(--text-2); margin-right: 4px; }
.tab-bar {
  position: absolute; left: 0; right: 0; bottom: 0; height: calc(var(--tab-h) + var(--safe-b));
  padding-bottom: var(--safe-b); background: #f7f7f7; border-top: 0.5px solid var(--divider);
  display: flex; z-index: 20;
}
.tab-item {
  flex: 1; border: 0; background: transparent; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 2px; color: var(--text-2); font-size: 10px; position: relative; min-height: 48px;
}
.tab-item.active { color: var(--green); }
.tab-ico { font-size: 20px; line-height: 1; }
.tab-badge {
  position: absolute; top: 2px; right: 22%; min-width: 16px; height: 16px; padding: 0 4px;
  border-radius: 8px; background: var(--red); color: #fff; font-size: 10px; line-height: 16px; text-align: center;
}
.tab-dot { position: absolute; top: 6px; right: 28%; width: 8px; height: 8px; border-radius: 4px; background: var(--red); }
.mask { position: absolute; inset: 0; background: var(--mask); z-index: 30; }
.pop-menu {
  position: absolute; top: 4px; right: 8px; width: 148px; background: #4c4c4c; border-radius: 6px; overflow: hidden;
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
