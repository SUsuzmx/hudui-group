<script setup>
import { computed } from 'vue';
import UserAvatar from './UserAvatar.vue';

const props = defineProps({
  title: { type: String, default: '聊天信息' },
  groupName: { type: String, default: '' },
  isGroup: { type: Boolean, default: true },
  muted: { type: Boolean, default: false },
  pinned: { type: Boolean, default: false },
  folded: { type: Boolean, default: false },
  remind: { type: Boolean, default: false },
  target: { type: Object, default: null },
});
const emit = defineEmits(['back', 'action', 'toggle', 'open-profile', 'open-video-call', 'open-moments']);

const isPrivate = computed(() => props.isGroup === false);
const t = computed(() => props.target || {});

const displayName = computed(() => t.value.remark || props.groupName || t.value.nickname || '');
const avatarProps = computed(() => ({
  name: displayName.value,
  avatar: t.value.avatar ?? t.value.avatarUrl ?? null,
  emoji: t.value.emoji ?? t.value.avatarEmoji ?? null,
  color: t.value.avatarColor ?? t.value.color ?? '#d9d9d9',
  size: 72,
}));

function isOn(key) {
  return Boolean(props[key]);
}

function profilePayload() {
  const p = t.value || {};
  return {
    id: p.userId ?? p.id ?? null,
    userId: Number(p.userId ?? p.id ?? 0) || null,
    nickname: p.nickname || props.groupName,
    avatar: p.avatar ?? p.avatarUrl ?? null,
    avatarUrl: p.avatar ?? p.avatarUrl ?? null,
    emoji: p.emoji ?? p.avatarEmoji ?? null,
    avatarEmoji: p.emoji ?? p.avatarEmoji ?? null,
    color: p.color ?? p.avatarColor ?? '#4f6ef7',
    avatarColor: p.color ?? p.avatarColor ?? '#4f6ef7',
    isAI: Boolean(p.isAI),
    personaId: p.personaId ?? null,
    isFriend: !p.isAI,
    local: Boolean(p.isAI),
  };
}

function onAvatar() {
  if (isPrivate.value) {
    emit('open-profile', profilePayload());
    return;
  }
  emit('action', 'members');
}

function onPlus() {
  emit('action', isPrivate.value ? 'create-group-from-chat' : 'invite-member');
}

function onRow(kind) {
  if (kind === 'mute') {
    emit('toggle', { key: 'muted', value: !props.muted });
    return;
  }
  if (kind === 'pin') {
    emit('toggle', { key: 'pinned', value: !props.pinned });
    return;
  }
  if (kind === 'remind') {
    emit('toggle', { key: 'remind', value: !props.remind });
    return;
  }
  emit('action', kind);
}
</script>

<template>
  <div class="page">
    <header class="nav-bar">
      <button class="icon-btn nav-back" aria-label="返回" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title">{{ isPrivate ? '聊天信息' : (title || '聊天信息') }}</div>
      <div class="nav-right"></div>
    </header>

    <main class="content scroll-y">
      <!-- 成员墙 -->
      <section class="member-wall">
        <div class="member-item">
          <button class="member-avatar-btn" type="button" @click="onAvatar">
            <UserAvatar class="member-avatar" v-bind="avatarProps" />
          </button>
          <div class="member-name">{{ displayName || '用户' }}</div>
        </div>
        <button class="member-add" type="button" aria-label="添加" @click="onPlus">
          <span class="plus">+</span>
        </button>
      </section>

      <!-- 查找聊天记录 -->
      <section class="cell-group">
        <button class="cell-row" type="button" @click="onRow('search-history')">
          <span class="cell-label">查找聊天记录</span>
          <span class="cell-arrow"></span>
        </button>
      </section>

      <!-- 免打扰 / 置顶 / 提醒 -->
      <section class="cell-group">
        <button class="cell-row" type="button" @click="onRow('mute')">
          <span class="cell-label">消息免打扰</span>
          <span class="switch" :class="{ on: isOn('muted') }"></span>
        </button>
        <button class="cell-row" type="button" @click="onRow('pin')">
          <span class="cell-label">置顶聊天</span>
          <span class="switch" :class="{ on: isOn('pinned') }"></span>
        </button>
        <button class="cell-row" type="button" @click="onRow('remind')">
          <span class="cell-label">提醒</span>
          <span class="switch" :class="{ on: isOn('remind') }"></span>
        </button>
      </section>

      <!-- 背景 -->
      <section class="cell-group">
        <button class="cell-row" type="button" @click="onRow('bg')">
          <span class="cell-label">设置当前聊天背景</span>
          <span class="cell-arrow"></span>
        </button>
      </section>

      <!-- 清空 -->
      <section class="cell-group">
        <button class="cell-row" type="button" @click="onRow('clear')">
          <span class="cell-label">清空聊天记录</span>
          <span class="cell-arrow"></span>
        </button>
      </section>

      <!-- 投诉 -->
      <section class="cell-group">
        <button class="cell-row" type="button" @click="onRow('report')">
          <span class="cell-label">投诉</span>
          <span class="cell-arrow"></span>
        </button>
      </section>
    </main>
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
.nav-title { font-size: 17px; font-weight: 600; color: var(--text); }
.content { flex: 1; min-height: 0; padding-bottom: 28px; }

.member-wall {
  background: var(--white);
  display: flex;
  flex-wrap: wrap;
  gap: 18px 22px;
  padding: 22px 20px 18px;
  margin-top: 0;
}
.member-item {
  width: 72px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.member-avatar-btn {
  border: 0;
  padding: 0;
  background: transparent;
  line-height: 0;
}
.member-avatar {
  border-radius: 8px !important;
  overflow: hidden;
}
.member-name {
  width: 72px;
  text-align: center;
  font-size: 13px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.member-add {
  width: 72px;
  height: 72px;
  border-radius: 8px;
  border: 1.5px dashed #c8c8c8;
  background: transparent;
  color: #b0b0b0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.member-add .plus {
  font-size: 32px;
  line-height: 1;
  font-weight: 300;
  margin-top: -2px;
}

.cell-group {
  background: var(--white);
  margin-top: 10px;
}
.cell-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  min-height: 54px;
  text-align: left;
  border: 0;
  background: var(--white);
  position: relative;
}
.cell-row + .cell-row::before {
  content: '';
  position: absolute;
  left: 16px;
  right: 0;
  top: 0;
  height: 0.5px;
  background: var(--divider);
}
.cell-row:active { background: var(--press); }
.cell-label {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  color: var(--text);
  display: flex;
  align-items: center;
  min-height: 54px;
}
.cell-arrow {
  width: 8px;
  height: 8px;
  border-right: 1.5px solid #c7c7cc;
  border-top: 1.5px solid #c7c7cc;
  transform: rotate(45deg);
  flex-shrink: 0;
}
.switch {
  width: 51px;
  height: 31px;
  border-radius: 16px;
  background: #e5e5e5;
  position: relative;
  flex-shrink: 0;
  transition: background 160ms ease;
}
.switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 27px;
  height: 27px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  transition: transform 160ms ease;
}
.switch.on { background: #4cd964; }
.switch.on::after { transform: translateX(20px); }
</style>
