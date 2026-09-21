<script setup>
import { ref, onMounted, onBeforeUnmount, defineAsyncComponent, computed } from 'vue';
import { getToken, setToken, api } from './api.js';
import { createNavStack } from './nav-stack.js';
import { toast } from './toast.js';
import { notifyMessage } from './notify.js';
import { getSocket, bindSocket, releaseSocket } from './socket-store.js';
import ToastHost from './components/ToastHost.vue';
import LoginView from './components/LoginView.vue';
import MainView from './components/MainView.vue';
import ChatView from './components/ChatView.vue';
import PrivateChatView from './components/PrivateChatView.vue';

// 次要页面异步加载, 缩小首包
const GroupSettingsView = defineAsyncComponent(() => import('./components/GroupSettingsView.vue'));
const MomentsView = defineAsyncComponent(() => import('./components/MomentsView.vue'));
const EditProfileView = defineAsyncComponent(() => import('./components/EditProfileView.vue'));
const AddFriendView = defineAsyncComponent(() => import('./components/AddFriendView.vue'));
const FriendProfileView = defineAsyncComponent(() => import('./components/FriendProfileView.vue'));
const FriendDetailView = defineAsyncComponent(() => import('./components/FriendDetailView.vue'));
const FriendSettingsView = defineAsyncComponent(() => import('./components/FriendSettingsView.vue'));
const CreateGroupView = defineAsyncComponent(() => import('./components/CreateGroupView.vue'));
const SettingsView = defineAsyncComponent(() => import('./components/SettingsView.vue'));
const QrCodeView = defineAsyncComponent(() => import('./components/QrCodeView.vue'));
const ChatInfoView = defineAsyncComponent(() => import('./components/ChatInfoView.vue'));
const FeaturePage = defineAsyncComponent(() => import('./components/FeaturePage.vue'));
const DeepFeatureView = defineAsyncComponent(() => import('./components/DeepFeatureView.vue'));
const VideoCallView = defineAsyncComponent(() => import('./components/VideoCallView.vue'));
const CallFloatBar = defineAsyncComponent(() => import('./components/CallFloatBar.vue'));
const callSession = ref(null); // { target, callMode, role, callId, incoming, minimized }
const callViewRef = ref(null);
const GlobalSearchView = defineAsyncComponent(() => import('./components/GlobalSearchView.vue'));
const ListenView = defineAsyncComponent(() => import('./components/ListenView.vue'));
const LookView = defineAsyncComponent(() => import('./components/LookView.vue'));
const MusicFloatBar = defineAsyncComponent(() => import('./components/MusicFloatBar.vue'));
import { musicPlayer } from './music-player.js';

const view = ref('loading');
const me = ref(null);
const justRegistered = ref(false);
const privateTarget = ref(null);
const subView = ref(null);
const groupMembers = ref({ onlineUsers: [], aiMembers: [], allUsers: [] });
const transitionName = ref('page-fade');
const activeChat = ref(null);
const pendingSearch = ref(false);

const showMusicFloat = computed(() => {
  const onListen = view.value === 'sub' && subView.value?.type === 'listen';
  return Boolean(musicPlayer.state.current) && !onListen;
});

function openListenFromFloat() {
  openSub({ type: 'listen' });
}

const nav = createNavStack({
  view,
  subView,
  activeChat,
  privateTarget,
  pendingSearch,
  onBack: () => {
    // 浏览器/手势返回与页面内返回同一逻辑
    goBack();
  },
});

function goBack() {
  transitionName.value = 'page-pop';
  const depth = nav.depth();
  const prevView = nav.back('main');
  // 回到聊天时清 sub, 避免残留通话/设置页
  if (prevView === 'chat' || prevView === 'private-chat' || prevView === 'main') {
    if (prevView !== 'sub') subView.value = null;
  }
  // 栈空且回主界面: 保持 MainView 的 Tab(localStorage), 不强制切到消息
  return { prevView, depth };
}

function goHomeChats() {
  transitionName.value = 'page-pop';
  nav.reset('main');
  view.value = 'main';
  subView.value = null;
  try { localStorage.setItem('hudui_main_tab', 'chats'); } catch { /* ignore */ }
}

function handleAuthed({ token, user, isNew }) {
  setToken(token);
  me.value = user;
  justRegistered.value = isNew;
  transitionName.value = 'page-fade';
  nav.reset('main');
  view.value = 'main';
  try {
    unbindKick?.();
    getSocket();
    unbindKick = bindSocket('auth:kicked', onAuthKicked);
  } catch { /* ignore */ }
}

let unbindKick = null;

function forceLogout(reason = 'session') {
  setToken(null);
  me.value = null;
  callSession.value = null;
  try { releaseSocket(); } catch { /* ignore */ }
  nav.reset('login');
  transitionName.value = 'page-fade';
  view.value = 'login';
  if (reason === 'login_elsewhere') {
    toast('该账号已在其他地方登录');
  } else if (reason === 'session_expired') {
    toast('登录已失效，请重新登录');
  }
}

function onAuthKicked() {
  forceLogout('login_elsewhere');
}

function onWindowLogout(e) {
  forceLogout(e?.detail?.reason || 'session');
}

onMounted(async () => {
  window.addEventListener('hudui:logout', onWindowLogout);
  if (!getToken()) {
    view.value = 'login';
    return;
  }
  try {
    const { user } = await api.me();
    me.value = user;
    nav.reset('main');
    view.value = 'main';
    // 单端登录：被挤下线时立刻回登录页
    try {
      getSocket();
      unbindKick = bindSocket('auth:kicked', onAuthKicked);
    } catch { /* ignore */ }
  } catch {
    setToken(null);
    view.value = 'login';
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('hudui:logout', onWindowLogout);
  try { unbindKick?.(); } catch { /* ignore */ }
});

function openChat(chat = null) {
  nav.push();
  activeChat.value = chat;
  transitionName.value = 'page-push';
  view.value = 'chat';
}

function openPrivateChat(contact) {
  nav.push();
  const uid = Number(contact.userId ?? contact.id ?? contact.peerId ?? 0);
  if (contact.isAI) {
    privateTarget.value = {
      nickname: contact.nickname,
      avatar: contact.avatar ?? contact.avatarUrl ?? null,
      avatarUrl: contact.avatar ?? contact.avatarUrl ?? null,
      avatarEmoji: contact.emoji ?? contact.avatarEmoji ?? null,
      emoji: contact.emoji ?? contact.avatarEmoji ?? null,
      color: contact.color ?? '#07c160',
      isAI: true,
      personaId: contact.personaId ?? contact.key?.replace('ai-', ''),
    };
  } else {
    privateTarget.value = {
      nickname: contact.nickname,
      avatar: contact.avatar ?? contact.avatarUrl ?? null,
      color: contact.color ?? contact.avatarColor ?? '#4f6ef7',
      isAI: false,
      userId: Number.isInteger(uid) && uid > 0 ? uid : contact.userId,
      remark: contact.remark || null,
    };
  }
  transitionName.value = 'page-push';
  view.value = 'private-chat';
}

function openSub(payload) {
  if (payload?.type === 'video-call') {
    openVideoCall(payload);
    return;
  }
  nav.push();
  subView.value = payload;
  transitionName.value = 'page-push';
  view.value = 'sub';
}

function openUserMoments(user) {
  openMomentsForUser(user);
}

function handleLogout() {
  forceLogout('manual');
}

function onGroupMembers(data) {
  groupMembers.value = data;
}

function handleProfileUpdated(user) {
  me.value = user;
}

function openChatFromFriend(contact) {
  openPrivateChat(contact);
}

function openChatFromSearch(chat) {
  openChat(chat);
}

function openProfileFromChat(user) {
  openSub({ type: 'friend-profile', user });
}

function openMomentsForUser(user) {
  if (!user) return;
  const uid = Number(user.userId ?? user.id ?? 0);
  const isSelf = uid && me.value?.id && uid === Number(me.value.id);
  openSub({
    type: 'moments',
    mode: isSelf || !uid ? 'mine' : 'user',
    user: isSelf || !uid
      ? null
      : {
          id: uid,
          userId: uid,
          nickname: user.nickname || user.remark || '',
          avatar: user.avatar ?? user.avatarUrl ?? null,
          avatarColor: user.avatarColor ?? user.color ?? null,
          isAI: Boolean(user.isAI),
        },
  });
}

function onVideoCallEnd() {
  callSession.value = null;
}

function openVideoCall(payload) {
  if (!payload) return;
  callSession.value = {
    target: payload.target || null,
    callMode: payload.callMode || payload.mode || 'video',
    role: payload.role || 'caller',
    callId: payload.callId || '',
    incoming: payload.incoming || null,
    minimized: false,
  };
}

function minimizeCall() {
  if (callSession.value) {
    callSession.value = { ...callSession.value, minimized: true };
  }
}

function restoreCall() {
  if (callSession.value) {
    callSession.value = { ...callSession.value, minimized: false };
  }
}

function hangupFromFloat() {
  const inst = callViewRef.value;
  if (inst?.hangup) inst.hangup();
  callSession.value = null;
}

function callSeconds() {
  return Number(callViewRef.value?.seconds || 0);
}

function onFeatureBack(payload) {
  if (payload?.then === 'status-updated') {
    if (payload.user) handleProfileUpdated(payload.user);
    goBack();
    return;
  }
  if (!payload?.then) {
    goBack();
    return;
  }
  // then 语义: 替换当前 feature 页, 不叠加栈
  if (payload.then === 'add-friend') {
    subView.value = { type: 'add-friend' };
    transitionName.value = 'page-push';
    view.value = 'sub';
    return;
  }
  if (payload.then === 'moments') {
    subView.value = { type: 'moments', mode: 'feed' };
    transitionName.value = 'page-push';
    view.value = 'sub';
    return;
  }
  if (payload.then === 'wallet') {
    subView.value = { type: 'feature', feature: 'wallet', title: '钱包' };
    transitionName.value = 'page-push';
    view.value = 'sub';
    return;
  }
  if (payload.then === 'services') {
    subView.value = { type: 'deep-feature', feature: 'servicesHome', title: '服务' };
    transitionName.value = 'page-push';
    view.value = 'sub';
    return;
  }
  if (payload.then === 'cards') {
    subView.value = { type: 'feature', feature: 'cards', title: '卡包' };
    transitionName.value = 'page-push';
    view.value = 'sub';
    return;
  }
  if (payload.then === 'deep') {
    subView.value = { type: 'deep-feature', feature: payload.feature, title: payload.title, payload: payload.payload || {} };
    transitionName.value = 'page-push';
    view.value = 'sub';
    return;
  }
  if (payload.then === 'create-group') {
    subView.value = { type: 'create-group' };
    transitionName.value = 'page-push';
    view.value = 'sub';
    return;
  }
  if (payload.then === 'open-search') {
    const info = payload.payload || {};
    goBack();
    setTimeout(() => {
      openChat({
        conversationId: info.conversationId,
        groupId: info.groupId,
        kind: 'group',
        name: info.groupName || 'WeChat',
        isDefault: false,
      });
      setTimeout(() => { pendingSearch.value = true; }, 240);
    }, 60);
    return;
  }
  subView.value = { type: 'stub', title: payload.title || '功能页' };
  transitionName.value = 'page-push';
  view.value = 'sub';
}

function onGroupCreated(group) {
  // 回到主界面并直接进入新群聊
  transitionName.value = 'page-pop';
  nav.reset('main');
  view.value = 'main';
  subView.value = null;
  setTimeout(() => openChat({
    conversationId: group.conversationId,
    groupId: group.id,
    kind: null,
    name: group.name,
    isDefault: false,
  }), 60);
}

function onLeftGroup() {
  transitionName.value = 'page-pop';
  nav.reset('main');
  view.value = 'main';
  subView.value = null;
  activeChat.value = null;
  try { localStorage.setItem('hudui_main_tab', 'chats'); } catch { /* ignore */ }
}

function chatRemindKey(conv) {
  return `wx_remind_${conv || 'default'}`;
}

function openChatInfo(payload) {
  // 私聊详情走 ChatInfoView；群聊信息统一走 GroupSettingsView
  if (payload?.isGroup === false) {
    const target = payload.target || privateTarget.value || {};
    const conv = payload?.conversationId || '';
    openSub({
      type: 'chat-info',
      conversationId: conv,
      groupName: payload?.groupName || target.nickname || '',
      isGroup: false,
      muted: Boolean(payload?.muted),
      pinned: Boolean(payload?.pinned),
      folded: Boolean(payload?.folded),
      remind: Boolean(payload?.remind) || localStorage.getItem(chatRemindKey(conv)) === '1',
      peerUserId: payload?.peerUserId ?? target.userId ?? null,
      target,
    });
    return;
  }
  const conv = payload?.conversationId || activeChat.value?.conversationId || '';
  const gid = payload?.groupId
    ?? (conv?.startsWith('grp_') ? Number(String(conv).replace(/^grp_/, '')) : activeChat.value?.groupId)
    ?? null;
  openSub({
    type: 'group-settings',
    conversationId: conv,
    groupId: gid,
    groupName: payload?.groupName || activeChat.value?.name || 'WeChat',
  });
}

async function onChatInfoAction(action) {
  const conv = subView.value?.conversationId || 'default';
  if (action === 'clear') {
    if (!confirm('确定清空该聊天记录？')) return;
    try {
      await api.chatClear(conv);
      toast('已清空');
      goBack();
    } catch (e) {
      toast(e.message || '操作失败');
    }
    return;
  }
  if (action === 'search-history') {
    pendingSearch.value = true;
    // 返回上一层聊天
    goBack();
    return;
  }
  if (action === 'create-group-from-chat') {
    openSub({ type: 'create-group' });
    return;
  }
  if (action === 'invite-member') {
    openSub({ type: 'create-group' });
    return;
  }
  if (action === 'remind' || action === 'toggle-remind') {
    notifyMessage({ title: '聊天提醒已开启', body: '该会话来新消息时会系统提醒', tag: 'remind' });
    toast('已开启提醒，来消息将系统通知');
    return;
  }
  if (action === 'report') {
    const reason = prompt('请选择投诉原因：\n1 违法违规 2 欺诈 3 骚扰 4 其他（输入数字）', '3');
    if (!reason) return;
    const map = { '1': '违法违规', '2': '欺诈', '3': '骚扰', '4': '其他' };
    try {
      await api.addFavorite({ kind: 'text', content: `[投诉] ${map[reason.trim()] || '其他'} — 会话 ${conv}`, fromName: '系统' });
      toast('已收到投诉，我们会尽快处理');
    } catch {
      toast('已收到投诉，我们会尽快处理');
    }
    return;
  }
  if (action === 'appearance' || action === 'bg-settings') {
    openSub({ type: 'settings' });
    setTimeout(() => { /* 设置页内选择聊天背景 */ }, 0);
    return;
  }
  if (action === 'bg') {
    const presets = ['默认', '浅灰', '淡蓝', '淡绿', '米色', '深色'];
    const pick = prompt('选择当前聊天背景：\n' + presets.map((s, i) => `${i + 1} ${s}`).join('\n') + '\n（输入数字）', '1');
    if (!pick) return;
    const idx = Number(pick.trim());
    if (!(idx >= 1 && idx <= presets.length)) { toast('无效选择'); return; }
    try {
      await api.chatPref({ conversationId: conv, bgKey: String(idx - 1) });
      toast('聊天背景已更新');
    } catch (e) {
      toast(e.message || '设置失败');
    }
    return;
  }
}

async function onChatInfoToggle({ key, value }) {
  if (!subView.value) return;
  subView.value = { ...subView.value, [key]: value };
  const conv = subView.value.conversationId || 'default';
  if (key === 'remind') {
    try { localStorage.setItem(chatRemindKey(conv), value ? '1' : '0'); } catch { /* ignore */ }
  }
  try {
    await api.chatPref({
      conversationId: conv,
      muted: subView.value.muted,
      pinned: subView.value.pinned,
      folded: subView.value.folded,
    });
  } catch { /* ignore */ }
}
</script>

<template>
  <div class="app-shell">
    <ToastHost />
    <Transition :name="transitionName" mode="out-in">
      <LoginView v-if="view === 'login'" key="login" @authed="handleAuthed" />
      <MainView
        v-else-if="view === 'main'"
        key="main"
        :me="me"
        :initial-tab="justRegistered ? 'contacts' : ''"
        @open-chat="openChat"
        @open-private-chat="openPrivateChat"
        @open-view="openSub"
        @status-updated="handleProfileUpdated"
        @logout="handleLogout"
      />
      <ChatView
        v-else-if="view === 'chat'"
        key="chat"
        :me="me"
        :just-registered="justRegistered"
        :chat="activeChat"
        :pending-search="pendingSearch"
        @back="goBack"
        @open-chat-info="openChatInfo"
        @members="onGroupMembers"
        @search-used="pendingSearch = false"
        @open-video-call="openVideoCall"
      />
      <PrivateChatView
        v-else-if="view === 'private-chat'"
        key="private"
        :me="me"
        :target="privateTarget"
        :pending-search="pendingSearch"
        @back="goBack"
        @open-profile="openProfileFromChat"
        @open-chat-info="openChatInfo"
        @search-used="pendingSearch = false"
        @open-video-call="openVideoCall"
      />
      <GroupSettingsView
        v-else-if="view === 'sub' && subView?.type === 'group-settings'"
        key="group-settings"
        :me="me"
        :group-name="subView.groupName || 'WeChat'"
        :group-id="subView.groupId || null"
        :conversation-id="subView.conversationId || null"
        :members="groupMembers"
        @back="goBack"
        @open-private="openChatFromFriend"
        @open-profile="openProfileFromChat"
        @left-group="onLeftGroup"
        @open-search="(p) => onFeatureBack({ then: 'open-search', payload: p })"
      />
      <GlobalSearchView
        v-else-if="view === 'sub' && subView?.type === 'global-search'"
        key="global-search"
        :me="me"
        :initial-query="subView.q || ''"
        @back="goBack"
        @open-chat="openChatFromSearch"
        @open-contact="(c) => openSub({ type: 'friend-profile', user: c })"
        @open-private="openPrivateChat"
      />
      <MomentsView
        v-else-if="view === 'sub' && subView?.type === 'moments'"
        key="moments"
        :me="me"
        :mode="subView.mode || 'feed'"
        :user="subView.user || null"
        @back="goBack"
        @updated="handleProfileUpdated"
        @open-user-moments="openUserMoments"
      />
      <EditProfileView
        v-else-if="view === 'sub' && subView?.type === 'edit-profile'"
        key="edit-profile"
        :me="me"
        @back="goBack"
        @updated="handleProfileUpdated"
        @open-view="openSub"
      />
      <AddFriendView
        v-else-if="view === 'sub' && subView?.type === 'add-friend'"
        key="add-friend"
        @back="goBack"
      />
      <FriendProfileView
        v-else-if="view === 'sub' && subView?.type === 'friend-profile'"
        key="friend"
        :user="subView.user"
        :me="me"
        @back="goBack"
        @open-chat="openChatFromFriend"
        @open-video-call="openVideoCall"
        @open-moments="openMomentsForUser"
        @open-detail="(u) => openSub({ type: 'friend-detail', user: u })"
        @open-settings="(u) => openSub({ type: 'friend-settings', user: u })"
        @open-channel="(p) => openSub({ type: 'deep-feature', feature: 'videoChannels', title: p?.channel?.name || '视频号', payload: p })"
      />
      <FriendSettingsView
        v-else-if="view === 'sub' && subView?.type === 'friend-settings'"
        key="friend-settings"
        :user="subView.user"
        :me="me"
        @back="goBack"
        @open-detail="(u) => openSub({ type: 'friend-detail', user: u })"
        @deleted="(u) => { goBack(); }"
        @updated="() => {}"
      />
      <FriendDetailView
        v-else-if="view === 'sub' && subView?.type === 'friend-detail'"
        key="friend-detail"
        :user="subView.user"
        :me="me"
        @back="goBack"
        @open-chat="openChatFromFriend"
        @open-moments="openMomentsForUser"
      />
      <QrCodeView
        v-else-if="view === 'sub' && subView?.type === 'qrcode'"
        key="qrcode"
        :me="me"
        @back="goBack"
      />
      <ChatInfoView
        v-else-if="view === 'sub' && subView?.type === 'chat-info'"
        key="chat-info"
        :title="'聊天信息'"
        :group-name="subView.groupName || ''"
        :is-group="subView.isGroup !== false"
        :muted="Boolean(subView.muted)"
        :pinned="Boolean(subView.pinned)"
        :folded="Boolean(subView.folded)"
        :remind="Boolean(subView.remind)"
        :target="subView.target || null"
        @back="goBack"
        @action="onChatInfoAction"
        @toggle="onChatInfoToggle"
        @open-profile="openProfileFromChat"
        @open-video-call="openVideoCall"
        @open-moments="openMomentsForUser"
      />
      <SettingsView
        v-else-if="view === 'sub' && subView?.type === 'settings'"
        key="settings"
        :me="me"
        @back="goBack"
        @logout="handleLogout"
      />
      <FeaturePage
        v-else-if="view === 'sub' && subView?.type === 'feature'"
        :key="'feature-' + subView.feature"
        :type="subView.feature"
        :me="me"
        @back="onFeatureBack"
      />
      <ListenView
        v-else-if="view === 'sub' && subView?.type === 'listen'"
        key="listen"
        @back="goBack"
      />
      <LookView
        v-else-if="view === 'sub' && subView?.type === 'look'"
        key="look"
        :me="me"
        @back="goBack"
      />
      <DeepFeatureView
        v-else-if="view === 'sub' && subView?.type === 'deep-feature'"
        :key="'deep-' + (subView.feature || 'x')"
        :type="subView.feature"
        :me="me"
        :payload="subView.payload || {}"
        @back="onFeatureBack"
        @open-chat="openChatFromSearch"
        @open-private="openPrivateChat"
      />
      <CreateGroupView
        v-else-if="view === 'sub' && subView?.type === 'create-group'"
        key="create-group"
        @back="goBack"
        @created="onGroupCreated"
      />
      <div v-else-if="view === 'sub'" :key="'stub-' + (subView?.title || 'x')" class="stub-fallback">
        <p>{{ subView?.title || '功能页' }}</p>
        <button type="button" @click="goBack">返回</button>
      </div>
      <div v-else key="boot" class="boot-loading">加载中…</div>
    </Transition>

    <!-- 通话：挂载后可最小化，不卸载以保持 WebRTC -->
    <div v-if="callSession" class="call-host" :class="{ hidden: callSession.minimized }">
      <VideoCallView
        ref="callViewRef"
        key="video-call"
        :target="callSession.target"
        :me="me"
        :mode="callSession.callMode"
        :role="callSession.role"
        :call-id="callSession.callId"
        :incoming="callSession.incoming"
        @end="onVideoCallEnd"
        @minimize="minimizeCall"
      />
    </div>
    <CallFloatBar
      v-if="callSession?.minimized"
      :session="callSession"
      :seconds="callSeconds()"
      @restore="restoreCall"
      @hangup="hangupFromFloat"
    />

    <!-- 听一听：退出页面后音乐继续，侧边悬浮窗可拖拽/播放/回到列表 -->
    <MusicFloatBar
      :visible="showMusicFloat"
      @open-listen="openListenFromFloat"
    />
  </div>
</template>

<style scoped>
.stub-fallback {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: #999;
  font-size: 15px;
  width: 100%;
}
.stub-fallback button {
  background: #07c160;
  color: #fff;
  border-radius: 8px;
  padding: 10px 28px;
  font-size: 15px;
  min-height: 44px;
}
.boot-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 14px;
  width: 100%;
  height: 100%;
}

.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 180ms ease;
}
.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
}

.page-push-enter-active,
.page-push-leave-active,
.page-pop-enter-active,
.page-pop-leave-active {
  transition: transform 220ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity 220ms ease;
}

.page-push-enter-from {
  transform: translateX(28px);
  opacity: 0.4;
}
.page-push-leave-to {
  transform: translateX(-12px);
  opacity: 0.6;
}

.page-pop-enter-from {
  transform: translateX(-12px);
  opacity: 0.6;
}
.page-pop-leave-to {
  transform: translateX(28px);
  opacity: 0.4;
}
</style>
