<script setup>
// 会话选择器：给叠塔对战发邀请（复用 /api/chats，过滤 AI）
import { ref, computed, onMounted } from 'vue';
import { api } from '../api.js';
import { toast } from '../toast.js';
import UserAvatar from './UserAvatar.vue';

const props = defineProps({
  invited: { type: Object, default: () => ({}) },
  sending: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'send']);

const q = ref('');
const loading = ref(true);
const chats = ref([]);
const busyId = ref('');
const tab = ref('all'); // all | private | group

onMounted(async () => {
  try {
    const d = await api.chats();
    const list = Array.isArray(d?.chats) ? d.chats : [];
    chats.value = list.filter((c) => {
      if (c.type === 'ai' || c.isAI) return false;
      const conv = String(c.conversationId || c.id || '');
      if (conv.includes('_ai_')) return false;
      if (c.type === 'private' && !conv.startsWith('pv_u_')) return false;
      return true;
    });
  } catch {
    chats.value = [];
  } finally {
    loading.value = false;
  }
});

const filtered = computed(() => {
  let list = chats.value;
  if (tab.value === 'private') list = list.filter((c) => c.type !== 'group');
  if (tab.value === 'group') list = list.filter((c) => c.type === 'group');
  const key = q.value.trim().toLowerCase();
  if (!key) return list;
  return list.filter((c) => {
    const name = String(c.remark || c.name || '').toLowerCase();
    return name.includes(key);
  });
});

function labelOf(c) {
  return c.remark || c.name || c.nickname || '会话';
}

function subOf(c) {
  const t = c.type === 'group' ? '群聊' : '好友';
  const last = c.lastMessage ? String(c.lastMessage).slice(0, 16) : '';
  return last ? `${t} · ${last}` : t;
}

function avatarOf(c) {
  if (c.type === 'group') {
    const a = Array.isArray(c.avatars) ? c.avatars[0] : null;
    return typeof a === 'string' && !a.startsWith('#') && !a.startsWith('http') && !a.includes('/')
      ? a
      : null;
  }
  return c.avatar || null;
}

function colorOf(c) {
  return c.avatarColor || c.color || '#5b7cfa';
}

function nameOf(c) {
  return String(labelOf(c)).slice(0, 1) || '会';
}

async function sendTo(c) {
  const conv = String(c.conversationId || c.id || '');
  if (!conv) return;
  if (props.invited[conv]) {
    toast('已经叫过他们啦。');
    return;
  }
  if (busyId.value) return;
  busyId.value = conv;
  try {
    emit('send', { conversationId: conv, chat: c });
  } finally {
    setTimeout(() => {
      if (busyId.value === conv) busyId.value = '';
    }, 400);
  }
}
</script>

<template>
  <div class="gip-mask" @click.self="emit('close')">
    <div class="gip-panel" role="dialog" aria-label="找人一起玩">
      <div class="gip-grab" />
      <header class="gip-head">
        <div>
          <div class="gip-title">找人一起玩</div>
          <div class="gip-subtitle">选一个会话，发张邀请卡</div>
        </div>
        <button type="button" class="gip-close" @click="emit('close')" aria-label="关闭">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="gip-search-wrap">
        <svg class="gip-search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input v-model="q" class="gip-search" type="search" placeholder="搜索好友或群聊" />
      </div>

      <div class="gip-tabs">
        <button type="button" class="gip-tab" :class="{ on: tab === 'all' }" @click="tab = 'all'">全部</button>
        <button type="button" class="gip-tab" :class="{ on: tab === 'private' }" @click="tab = 'private'">好友</button>
        <button type="button" class="gip-tab" :class="{ on: tab === 'group' }" @click="tab = 'group'">群聊</button>
      </div>

      <div class="gip-list">
        <div v-if="loading" class="gip-empty">
          <div class="gip-spinner" />
          <p>正在拉取会话…</p>
        </div>
        <div v-else-if="!filtered.length" class="gip-empty">
          <div class="gip-empty-ico">🔍</div>
          <p>没有找到合适的会话</p>
        </div>
        <button
          v-for="c in filtered"
          :key="c.conversationId || c.id"
          type="button"
          class="gip-item"
          :class="{ invited: invited[String(c.conversationId || c.id)] }"
          :disabled="Boolean(invited[String(c.conversationId || c.id)]) || busyId === String(c.conversationId || c.id)"
          @click="sendTo(c)"
        >
          <UserAvatar
            :name="labelOf(c)"
            :avatar="avatarOf(c)"
            :color="colorOf(c)"
            :emoji="avatarOf(c) && String(avatarOf(c)).length <= 4 ? avatarOf(c) : null"
            :size="44"
          />
          <div class="gip-meta">
            <div class="gip-name">{{ labelOf(c) }}</div>
            <div class="gip-desc">{{ subOf(c) }}</div>
          </div>
          <div class="gip-action" :class="{ done: invited[String(c.conversationId || c.id)] }">
            <span v-if="invited[String(c.conversationId || c.id)]">已邀请</span>
            <span v-else-if="busyId === String(c.conversationId || c.id)">发出中…</span>
            <span v-else>邀请</span>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gip-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 12, 20, 0.52);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 80;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.gip-panel {
  width: min(520px, 100%);
  max-height: min(78vh, 640px);
  background: #fff;
  color: #1c1917;
  border-radius: 22px 22px 0 0;
  display: flex;
  flex-direction: column;
  box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}
.gip-grab {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: #e7e5e4;
  margin: 10px auto 0;
}
.gip-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 12px 18px 6px;
}
.gip-title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.gip-subtitle {
  font-size: 12px;
  color: #a8a29e;
  margin-top: 2px;
}
.gip-close {
  border: 0;
  width: 34px;
  height: 34px;
  border-radius: 12px;
  background: #f5f5f4;
  color: #78716c;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.gip-search-wrap {
  position: relative;
  padding: 10px 18px 6px;
}
.gip-search-ico {
  position: absolute;
  left: 30px;
  top: 22px;
  color: #a8a29e;
  pointer-events: none;
}
.gip-search {
  width: 100%;
  border: 0;
  border-radius: 12px;
  background: #f5f5f4;
  padding: 11px 12px 11px 36px;
  font-size: 14px;
  outline: none;
  color: #1c1917;
}
.gip-search::placeholder { color: #a8a29e; }
.gip-tabs {
  display: flex;
  gap: 6px;
  padding: 8px 18px 4px;
}
.gip-tab {
  border: 0;
  background: #f5f5f4;
  color: #78716c;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 999px;
  cursor: pointer;
}
.gip-tab.on {
  background: #1c1917;
  color: #fff;
}
.gip-list {
  overflow: auto;
  padding: 6px 10px 22px;
  flex: 1;
}
.gip-empty {
  text-align: center;
  color: #a8a29e;
  padding: 36px 12px;
  font-size: 13px;
}
.gip-empty-ico { font-size: 28px; margin-bottom: 8px; }
.gip-spinner {
  width: 22px;
  height: 22px;
  border: 2px solid #e7e5e4;
  border-top-color: #f97316;
  border-radius: 50%;
  margin: 0 auto 10px;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.gip-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 0;
  background: transparent;
  padding: 10px;
  border-radius: 14px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}
.gip-item:hover { background: #fafaf9; }
.gip-item:active { background: #f5f5f4; }
.gip-item.invited {
  opacity: 0.55;
  cursor: default;
}
.gip-meta { flex: 1; min-width: 0; }
.gip-name {
  font-size: 15px;
  font-weight: 600;
  color: #1c1917;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gip-desc {
  font-size: 12px;
  color: #a8a29e;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gip-action {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #fb923c, #f97316);
  padding: 7px 14px;
  border-radius: 999px;
}
.gip-action.done {
  background: #f5f5f4;
  color: #a8a29e;
}
</style>
