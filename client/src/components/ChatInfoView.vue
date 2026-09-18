<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  title: { type: String, default: '聊天信息' },
  groupName: { type: String, default: '' },
  isGroup: { type: Boolean, default: true },
  muted: { type: Boolean, default: false },
  pinned: { type: Boolean, default: false },
  folded: { type: Boolean, default: false },
});
const emit = defineEmits(['back', 'action', 'toggle']);

const groupItems = [
  { key: 'search-history', label: '查找聊天记录' },
  { key: 'mute', label: '消息免打扰', toggle: 'muted' },
  { key: 'fold', label: '折叠该聊天', toggle: 'folded' },
  { key: 'pin', label: '置顶聊天', toggle: 'pinned' },
  { key: 'remind', label: '提醒' },
  { key: 'bg', label: '设置当前聊天背景' },
  { key: 'clear', label: '清空聊天记录' },
  { key: 'report', label: '投诉' },
];

const privateItems = [
  { key: 'search-history', label: '查找聊天记录' },
  { key: 'mute', label: '消息免打扰', toggle: 'muted' },
  { key: 'fold', label: '折叠该聊天', toggle: 'folded' },
  { key: 'pin', label: '置顶聊天', toggle: 'pinned' },
  { key: 'bg', label: '设置当前聊天背景' },
  { key: 'clear', label: '清空聊天记录' },
  { key: 'report', label: '投诉' },
];

const items = computed(() => (props.isGroup ? groupItems : privateItems));

function isOn(item) {
  if (!item.toggle) return false;
  return Boolean(props[item.toggle]);
}

function onClick(item) {
  if (item.toggle) {
    emit('toggle', { key: item.toggle, value: !props[item.toggle] });
    return;
  }
  emit('action', item.key === 'search-history' ? 'search-history' : item.key);
}
</script>

<template>
  <div class="page">
    <header class="nav-bar">
      <button class="icon-btn nav-back" aria-label="返回" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title">聊天信息</div>
      <div class="nav-right"></div>
    </header>

    <main class="content scroll-y">
      <div v-if="groupName" class="name-card">
        <div class="name">{{ groupName }}</div>
        <div class="sub">{{ isGroup ? '群聊' : '聊天' }}</div>
      </div>

      <div class="cell-group">
        <button
          v-for="item in items"
          :key="item.key"
          class="cell-row"
          @click="onClick(item)"
        >
          <span class="cell-label" :class="{ danger: item.key === 'clear' || item.key === 'report' }">{{ item.label }}</span>
          <span v-if="item.toggle" class="switch" :class="{ on: isOn(item) }"></span>
          <span v-else class="cell-arrow"></span>
        </button>
      </div>
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
.nav-title { font-size: 17px; font-weight: 600; }

.content { flex: 1; min-height: 0; padding-bottom: 24px; }

.name-card {
  background: #fff;
  margin-top: 10px;
  padding: 18px 16px;
}
.name {
  font-size: 17px;
  font-weight: 500;
  color: #111;
  word-break: break-all;
}
.sub {
  margin-top: 6px;
  font-size: 13px;
  color: #999;
}

.cell-group { background: var(--white); margin-top: 10px; }
.cell-row {
  background: var(--white);
}
.cell-label { color: var(--text); }
.name-card { background: var(--white); }
.name { color: var(--text); }
.sub { color: var(--text-2); }
.switch { background: #e5e5e5; }
.cell-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  min-height: 52px;
  text-align: left;
}
.cell-row:active { background: #e5e5e5; }
.cell-label {
  flex: 1;
  font-size: 16px;
  display: flex;
  align-items: center;
  min-height: 52px;
  color: #111;
}
.cell-label.danger { color: #fa5151; }
.cell-arrow {
  width: 8px;
  height: 8px;
  border-right: 1.5px solid #c7c7cc;
  border-top: 1.5px solid #c7c7cc;
  transform: rotate(45deg);
  flex-shrink: 0;
}
.switch {
  width: 44px;
  height: 26px;
  border-radius: 13px;
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
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  transition: transform 160ms ease;
}
.switch.on {
  background: #07c160;
}
.switch.on::after {
  transform: translateX(18px);
}
</style>
