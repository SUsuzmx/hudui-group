<script setup>
import { ref, onMounted, computed } from 'vue';
import { getToken, api } from '../api.js';
import { io } from 'socket.io-client';
import UserAvatar from './UserAvatar.vue';

const props = defineProps({
  me: { type: Object, required: true },
  ids: { type: Array, required: true }, // 源消息 id 列表
  excludeConv: { type: String, default: '' }, // 当前会话, 可仍允许转发
});
const emit = defineEmits(['close', 'done']);

const targets = ref([]);
const sending = ref(false);
const picked = ref(null);

const title = computed(() => (props.ids.length > 1 ? `合并转发 ${props.ids.length} 条` : '转发消息'));

onMounted(async () => {
  const list = [];
  try {
    const data = await api.chats();
    for (const c of data.chats || []) {
      if (c.type === 'group') {
        list.push({
          key: c.id,
          conversationId: c.conversationId || c.id,
          name: c.name,
          avatar: c.avatars?.[0],
          kind: '群聊',
        });
      }
    }
  } catch { /* ignore */ }

  // AI 私聊目标
  let socket = null;
  try {
    socket = io('/', { auth: { token: getToken() }, transports: ['polling', 'websocket'] });
    const members = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 2000);
      socket.once('members:update', (d) => {
        clearTimeout(timer);
        resolve(d);
      });
    });
    const ai = members?.aiMembers || [];
    for (const a of ai) {
      list.push({
        key: 'ai-' + a.id,
        conversationId: `pv_${props.me.id}_ai_${a.id}`,
        name: a.nickname,
        avatar: a.avatarUrl,
        emoji: a.avatarUrl ? null : a.avatarEmoji,
        kind: '私聊',
      });
    }
  } catch { /* ignore */ } finally {
    try { socket?.disconnect(); } catch { /* ignore */ }
  }

  targets.value = list;
});

function pick(t) {
  picked.value = t;
}

async function confirmForward() {
  if (!picked.value || sending.value) return;
  sending.value = true;
  try {
    const token = getToken();
    const socket = io('/', { auth: { token }, transports: ['polling', 'websocket'] });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      setTimeout(() => reject(new Error('连接失败')), 5000);
    });
    const res = await new Promise((resolve) => {
      socket.emit(
        'message:forward',
        { ids: props.ids, toConversationId: picked.value.conversationId },
        resolve
      );
    });
    socket.disconnect();
    if (res?.error) {
      alert(res.error);
      return;
    }
    emit('done', { conversationId: picked.value.conversationId, name: picked.value.name, ids: res?.ids || [] });
  } catch (e) {
    alert(e.message || '转发失败');
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="fwd-mask" @click.self="emit('close')">
    <div class="fwd-panel">
      <div class="fwd-bar">
        <button class="fwd-btn" @click="emit('close')">取消</button>
        <div class="fwd-title">{{ title }}</div>
        <button
          class="fwd-btn ok"
          :disabled="!picked || sending"
          @click="confirmForward"
        >{{ sending ? '…' : '发送' }}</button>
      </div>
      <div class="fwd-hint">选择转发到的会话</div>
      <div class="fwd-list scroll-y">
        <button
          v-for="t in targets"
          :key="t.key"
          class="fwd-item"
          :class="{ active: picked?.key === t.key }"
          @click="pick(t)"
        >
          <UserAvatar :name="t.name" :avatar="t.avatar" :emoji="t.emoji" :color="'#07c160'" :size="40" />
          <div class="fwd-main">
            <div class="fwd-name">{{ t.name }}</div>
            <div class="fwd-kind">{{ t.kind }}</div>
          </div>
          <span v-if="picked?.key === t.key" class="fwd-check">✓</span>
        </button>
        <div v-if="!targets.length" class="fwd-empty">暂无可转发的会话</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fwd-mask {
  position: absolute;
  inset: 0;
  background: var(--mask);
  z-index: 55;
  display: flex;
  align-items: flex-end;
  animation: fadeIn 160ms var(--ease);
}
.fwd-panel {
  width: 100%;
  max-height: 70%;
  background: var(--bg);
  border-radius: 12px 12px 0 0;
  display: flex;
  flex-direction: column;
  padding-bottom: var(--safe-b);
  animation: panelUp 200ms var(--ease);
}
.fwd-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 0.5px solid var(--divider);
  background: var(--white);
  border-radius: 12px 12px 0 0;
}
.fwd-btn {
  min-width: 48px;
  min-height: 40px;
  font-size: 15px;
  color: var(--text-2);
}
.fwd-btn.ok { color: #07c160; font-weight: 500; }
.fwd-btn:disabled { color: var(--text-3); }
.fwd-title { font-size: 16px; font-weight: 500; }
.fwd-hint {
  padding: 8px 14px;
  font-size: 12px;
  color: var(--text-3);
}
.fwd-list { flex: 1; min-height: 0; background: var(--white); }
.fwd-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  min-height: 60px;
  text-align: left;
  border-bottom: 0.5px solid var(--divider-soft);
  background: var(--white);
}
.fwd-item:active { background: var(--press); }
.fwd-item.active { background: rgba(7, 193, 96, 0.08); }
.fwd-main { flex: 1; min-width: 0; }
.fwd-name {
  font-size: 16px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fwd-kind { margin-top: 2px; font-size: 12px; color: var(--text-3); }
.fwd-check { color: #07c160; font-size: 18px; font-weight: 600; }
.fwd-empty {
  padding: 32px;
  text-align: center;
  color: var(--text-3);
  font-size: 13px;
}
</style>
