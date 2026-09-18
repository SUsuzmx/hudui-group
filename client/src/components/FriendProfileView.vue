<script setup>
import { ref, onMounted, computed } from 'vue';
import { api } from '../api.js';
import UserAvatar from './UserAvatar.vue';

const props = defineProps({
  user: { type: Object, required: true },
  me: { type: Object, required: true },
});
const emit = defineEmits(['back', 'open-chat', 'deleted', 'open-video-call']);

const profile = ref(null);
const loading = ref(true);
const error = ref('');
const isSelf = computed(() => profile.value?.id === props.me.id);
const isAI = computed(() => Boolean(profile.value?.isAI || props.user?.isAI));
const remark = ref('');
const blacklisted = ref(false);
const permission = ref('all');
const showRemark = ref(false);

async function load() {
  loading.value = true;
  error.value = '';

  if (props.user?.isAI || props.user?.local) {
    profile.value = {
      id: props.user.id ?? props.user.userId ?? props.user.key,
      nickname: props.user.nickname,
      avatar: props.user.avatar ?? props.user.avatarUrl ?? null,
      emoji: props.user.emoji ?? props.user.avatarEmoji ?? null,
      avatarColor: props.user.color ?? props.user.avatarColor ?? '#07c160',
      wxid: props.user.wxid || null,
      region: props.user.region || '未知',
      signature: props.user.signature || '',
      isFriend: props.user.isFriend ?? true,
      isAI: Boolean(props.user.isAI),
      personaId: props.user.personaId ?? null,
      categoryLabel: props.user.categoryLabel || null,
      title: props.user.title || null,
      remark: props.user.remark || null,
    };
    remark.value = profile.value.remark || '';
    loading.value = false;
    return;
  }

  try {
    const data = await api.user(props.user.id ?? props.user.userId);
    profile.value = data.user;
    remark.value = profile.value.remark || '';
    blacklisted.value = Boolean(profile.value.blacklisted);
    permission.value = profile.value.permission || 'all';
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function saveRemark() {
  if (!profile.value || isAI.value) return;
  try {
    const data = await api.setFriendRemark(profile.value.id, remark.value.trim());
    profile.value = { ...profile.value, remark: data.remark };
    showRemark.value = false;
  } catch (e) {
    alert(e.message);
  }
}

async function toggleBlacklist() {
  if (!profile.value || isAI.value) return;
  const next = !blacklisted.value;
  if (!confirm(next ? `将「${profile.value.nickname}」加入黑名单？` : '移出黑名单？')) return;
  try {
    await api.setFriendBlacklist(profile.value.id, next);
    blacklisted.value = next;
  } catch (e) {
    alert(e.message);
  }
}

async function setPermission(p) {
  if (!profile.value || isAI.value) return;
  try {
    await api.setFriendPermission(profile.value.id, p);
    permission.value = p;
  } catch (e) {
    alert(e.message);
  }
}

async function removeFriend() {
  if (!profile.value || isAI.value) return;
  if (!confirm(`确定删除好友「${profile.value.nickname}」吗？`)) return;
  try {
    await api.removeFriend(profile.value.id);
    emit('deleted', profile.value);
    emit('back');
  } catch (e) {
    alert(e.message);
  }
}

function startChat() {
  if (!profile.value) return;
  if (isAI.value) {
    emit('open-chat', {
      key: 'ai-' + (profile.value.personaId || profile.value.id),
      nickname: profile.value.nickname,
      avatar: profile.value.avatar,
      avatarUrl: profile.value.avatar,
      emoji: profile.value.emoji,
      avatarEmoji: profile.value.emoji,
      color: '#07c160',
      isAI: true,
      personaId: profile.value.personaId ?? profile.value.id,
    });
    return;
  }
  emit('open-chat', {
    key: 'u-' + profile.value.nickname,
    nickname: profile.value.nickname,
    avatar: profile.value.avatar,
    emoji: null,
    color: profile.value.avatarColor,
    isAI: false,
    userId: profile.value.id,
  });
}

async function addFriend() {
  if (!profile.value || isAI.value) return;
  try {
    await api.addFriend(profile.value.id);
    profile.value = { ...profile.value, isFriend: true };
  } catch (e) {
    alert(e.message);
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <header class="nav-bar">
      <button class="icon-btn nav-back" aria-label="返回" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title">个人信息</div>
      <div class="nav-right"></div>
    </header>

    <main v-if="loading" class="loading">加载中…</main>
    <main v-else-if="error" class="loading">{{ error }}</main>

    <main v-else-if="profile" class="content">
      <section class="profile-card">
        <UserAvatar
          :name="profile.nickname"
          :avatar="profile.avatar"
          :emoji="profile.emoji"
          :color="profile.avatarColor"
          :size="64"
        />
        <div class="profile-info">
          <div class="name">{{ profile.remark || profile.nickname }}</div>
          <div v-if="profile.remark" class="meta">昵称：{{ profile.nickname }}</div>
          <div v-if="profile.title || profile.categoryLabel" class="meta">
            {{ profile.categoryLabel || '' }}{{ profile.title ? ' · ' + profile.title : '' }}
          </div>
          <div class="meta">微信号：{{ profile.wxid || '未设置' }}</div>
          <div class="meta">地区：{{ profile.region || '未设置' }}</div>
        </div>
      </section>

      <section v-if="profile.signature" class="card">
        <div class="row">
          <span class="label">个性签名</span>
          <span class="value">{{ profile.signature }}</span>
        </div>
      </section>

      <section v-if="!isSelf && !isAI && profile.isFriend" class="card">
        <button class="cell-btn" @click="showRemark = true">
          设置备注
          <span class="cell-val">{{ profile.remark || '未设置' }}</span>
        </button>
        <div class="cell-btn perm-row">
          <span>朋友权限</span>
          <div class="perm-btns">
            <button :class="{ on: permission === 'all' }" @click="setPermission('all')">聊天和朋友圈</button>
            <button :class="{ on: permission === 'hide-moments' }" @click="setPermission('hide-moments')">仅聊天</button>
          </div>
        </div>
        <button class="cell-btn" @click="toggleBlacklist">
          {{ blacklisted ? '移出黑名单' : '加入黑名单' }}
        </button>
      </section>

      <section v-if="!isSelf" class="card">
        <button class="cell-btn" @click="startChat">发消息</button>
        <button v-if="!isAI" class="cell-btn" @click="emit('open-video-call', { callMode: 'video', role: 'caller', target: { nickname: profile.nickname, avatar: profile.avatar, emoji: profile.emoji, color: profile.avatarColor, userId: profile.userId || profile.id } })">音视频通话</button>
      </section>

      <section v-if="!isSelf && !isAI && profile.isFriend" class="card">
        <button class="cell-btn danger" @click="removeFriend">删除联系人</button>
      </section>

      <section v-else-if="!isSelf && !isAI && !profile.isFriend" class="card">
        <button class="cell-btn primary" @click="addFriend">添加到通讯录</button>
      </section>

      <section v-if="isAI" class="card">
        <div class="row">
          <span class="label">来源</span>
          <span class="value">{{ profile.categoryLabel || 'AI 联系人' }}{{ profile.title ? ' · ' + profile.title : '' }}</span>
        </div>
      </section>
    </main>

    <div v-if="showRemark" class="remark-mask" @click.self="showRemark = false">
      <div class="remark-panel">
        <div class="remark-bar">
          <button @click="showRemark = false">取消</button>
          <span>设置备注</span>
          <button class="ok" @click="saveRemark">完成</button>
        </div>
        <div class="remark-body">
          <input v-model="remark" maxlength="20" placeholder="备注名" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
  width: 100%;
}
.nav-bar {
  height: var(--nav-h);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background: var(--bg);
  border-bottom: 0.5px solid var(--divider);
  padding: 0 8px;
}
.nav-back { position: absolute; left: 0; top: 0; bottom: 0; margin: auto 0; }
.nav-right { width: 44px; }
.nav-title { font-size: 17px; font-weight: 600; }

.loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 14px;
}

.content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-bottom: 24px;
}

.profile-card {
  display: flex;
  gap: 16px;
  background: var(--white);
  padding: 24px 16px;
  margin-top: 10px;
}
.name { color: var(--text); }
.meta { color: var(--text-2); }
.card { background: var(--white); }
.cell-btn {
  background: var(--white);
  border-bottom: 0.5px solid var(--divider-soft);
  color: var(--text);
}
.profile-info {
  flex: 1;
  min-width: 0;
  padding-top: 4px;
}
.name {
  font-size: 20px;
  font-weight: 500;
  color: #111;
  margin-bottom: 10px;
  word-break: break-all;
}
.meta {
  font-size: 13px;
  color: #999;
  margin-bottom: 6px;
}

.card {
  background: #fff;
  margin-top: 10px;
}
.row {
  display: flex;
  padding: 14px 16px;
  gap: 12px;
  align-items: flex-start;
}
.label {
  width: 72px;
  font-size: 15px;
  color: #999;
  flex-shrink: 0;
}
.value {
  flex: 1;
  font-size: 15px;
  color: #111;
  word-break: break-word;
}
.cell-btn {
  width: 100%;
  background: #fff;
  padding: 15px 16px;
  font-size: 16px;
  color: #111;
  border-bottom: 1px solid #f0f0f0;
  text-align: center;
}
.cell-btn:last-child { border-bottom: none; }
.cell-btn.danger { color: #fa5151; }
.cell-btn.primary { color: #07c160; font-weight: 500; }
.cell-val { float: right; color: var(--text-2); font-size: 14px; margin-left: 8px; }
.perm-row { display: block; }
.perm-btns {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.perm-btns button {
  flex: 1;
  height: 36px;
  border-radius: 4px;
  background: #f5f5f5;
  font-size: 13px;
  color: var(--text-2);
}
.perm-btns button.on {
  background: rgba(7,193,96,0.12);
  color: #07c160;
}
.remark-mask {
  position: absolute; inset: 0; background: var(--mask); z-index: 50;
  display: flex; animation: fadeIn 160ms var(--ease);
}
.remark-panel {
  width: 100%; margin-top: auto;
  background: var(--bg);
  border-radius: 12px 12px 0 0;
  animation: panelUp 200ms var(--ease);
}
.remark-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; background: var(--white);
  border-radius: 12px 12px 0 0;
  font-size: 15px;
}
.remark-bar button { min-height: 40px; color: var(--text-2); }
.remark-bar button.ok { color: #07c160; font-weight: 500; }
.remark-body { padding: 16px; }
.remark-body input {
  width: 100%; height: 44px; border-radius: 6px;
  background: var(--white); padding: 0 12px; font-size: 16px;
}
.cell-btn:active { background: #f5f5f5; }
</style>
