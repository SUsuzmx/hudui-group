<script setup>
import { ref, onMounted, defineAsyncComponent } from 'vue';
import { getToken, setToken, api } from './api.js';
import { createNavStack } from './nav-stack.js';
import { toast } from './toast.js';
import { notifyMessage } from './notify.js';
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
const CreateGroupView = defineAsyncComponent(() => import('./components/CreateGroupView.vue'));
const SettingsView = defineAsyncComponent(() => import('./components/SettingsView.vue'));
const QrCodeView = defineAsyncComponent(() => import('./components/QrCodeView.vue'));
const ChatInfoView = defineAsyncComponent(() => import('./components/ChatInfoView.vue'));
const FeaturePage = defineAsyncComponent(() => import('./components/FeaturePage.vue'));
const VideoCallView = defineAsyncComponent(() => import('./components/VideoCallView.vue'));
const GlobalSearchView = defineAsyncComponent(() => import('./components/GlobalSearchView.vue'));

const view = ref('loading');
const me = ref(null);
const justRegistered = ref(false);
const privateTarget = ref(null);
const subView = ref(null);
const groupMembers = ref({ onlineUsers: [], aiMembers: [], allUsers: [] });
const transitionName = ref('page-fade');
const activeChat = ref(null);
const pendingSearch = ref(false);

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
}

onMounted(async () => {
  if (!getToken()) {
    view.value = 'login';
    return;
  }
  try {
    const { user } = await api.me();
    me.value = user;
    nav.reset('main');
    view.value = 'main';
  } catch {
    setToken(null);
    view.value = 'login';
  }
});

function openChat(chat = null) {
  nav.push();
  activeChat.value = chat;
  transitionName.value = 'page-push';
  view.value = 'chat';
}

function openPrivateChat(contact) {
  nav.push();
  if (contact.isAI) {
    privateTarget.value = {
      nickname: contact.nickname,
      avatar: contact.avatar,
      avatarUrl: contact.avatar,
      avatarEmoji: contact.emoji,
      emoji: contact.emoji,
      isAI: true,
      personaId: contact.personaId ?? contact.key?.replace('ai-', ''),
    };
  } else {
    privateTarget.value = {
      nickname: contact.nickname,
      avatar: contact.avatar,
      color: contact.color,
      isAI: false,
      userId: contact.userId,
    };
  }
  transitionName.value = 'page-push';
  view.value = 'private-chat';
}

function openSub(payload) {
  nav.push();
  subView.value = payload;
  transitionName.value = 'page-push';
  view.value = 'sub';
}

function handleLogout() {
  setToken(null);
  me.value = null;
  nav.reset('login');
  transitionName.value = 'page-fade';
  view.value = 'login';
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

function onVideoCallEnd() {
  // 离开通话页: 优先回到上一层(通常是私聊), 以便查看通话系统消息
  goBack();
}

function openVideoCall(payload) {
  const returnChat = view.value === 'private-chat' || view.value === 'chat'
    ? { view: view.value, target: view.value === 'private-chat' ? privateTarget.value : null, chat: activeChat.value }
    : null;
  openSub({
    type: 'video-call',
    ...payload,
    role: payload.role || 'caller',
    callId: payload.callId || '',
    returnChat,
  });
}

function onFeatureBack(payload) {
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
  if (payload.then === 'create-group') {
    subView.value = { type: 'create-group' };
    transitionName.value = 'page-push';
    view.value = 'sub';
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

function openChatInfo(payload) {
  openSub({ type: 'chat-info', ...payload });
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
  if (action === 'remind') {
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
        @open-chat="openChat"
        @open-private-chat="openPrivateChat"
        @open-view="openSub"
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
        :group-name="subView.groupName || 'WeChat'"
        :group-id="subView.groupId || null"
        :conversation-id="subView.conversationId || null"
        :members="groupMembers"
        @back="goBack"
        @open-private="openChatFromFriend"
        @open-profile="openProfileFromChat"
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
        @back="goBack"
      />
      <EditProfileView
        v-else-if="view === 'sub' && subView?.type === 'edit-profile'"
        key="edit-profile"
        :me="me"
        @back="goBack"
        @updated="handleProfileUpdated"
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
        @back="goBack"
        @action="onChatInfoAction"
        @toggle="onChatInfoToggle"
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
      <VideoCallView
        v-else-if="view === 'sub' && subView?.type === 'video-call'"
        key="video-call"
        :target="subView.target"
        :me="me"
        :mode="subView.callMode || 'video'"
        :role="subView.role || 'caller'"
        :call-id="subView.callId || ''"
        :incoming="subView.incoming || null"
        @end="onVideoCallEnd"
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
