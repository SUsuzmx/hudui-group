<script setup>
import { ref, watch } from 'vue';
import { api } from '../api.js';
import UserAvatar from './UserAvatar.vue';

const props = defineProps({
  me: { type: Object, default: null },
  initialQuery: { type: String, default: '' },
});
const emit = defineEmits(['back', 'open-chat', 'open-contact', 'open-private']);

const q = ref(props.initialQuery || '');
const loading = ref(false);
const contacts = ref([]);
const groups = ref([]);
const messages = ref([]);
const localChats = ref([]);
let timer = null;

async function runSearch() {
  const key = q.value.trim();
  if (!key) {
    contacts.value = [];
    groups.value = [];
    messages.value = [];
    localChats.value = [];
    return;
  }
  loading.value = true;
  try {
    const [data, chats] = await Promise.all([
      api.searchGlobal(key),
      api.chats().catch(() => ({ chats: [] })),
    ]);
    contacts.value = data.contacts || [];
    groups.value = data.groups || [];
    messages.value = data.messages || [];
    const lower = key.toLowerCase();
    localChats.value = (chats.chats || []).filter(
      (c) => String(c.name || '').toLowerCase().includes(lower)
        || String(c.lastMessage || '').toLowerCase().includes(lower)
    ).slice(0, 10);
  } catch {
    contacts.value = [];
    groups.value = [];
    messages.value = [];
    localChats.value = [];
  } finally {
    loading.value = false;
  }
}

watch(q, () => {
  clearTimeout(timer);
  timer = setTimeout(runSearch, 280);
});

function pickContact(c) {
  if (c.isAI) {
    emit('open-private', {
      isAI: true,
      nickname: c.nickname,
      avatar: c.avatar,
      avatarUrl: c.avatar,
      emoji: c.emoji,
      avatarEmoji: c.emoji,
      personaId: c.personaId || c.id,
    });
    return;
  }
  emit('open-contact', c);
}

function pickGroup(g) {
  emit('open-chat', {
    conversationId: g.conversationId,
    groupId: g.id,
    kind: g.kind,
    name: g.name,
    isDefault: Boolean(g.isDefault),
  });
}

function pickChat(c) {
  if (c.type === 'group') {
    emit('open-chat', c);
    return;
  }
  emit('open-private', {
    isAI: Boolean(c.isAI),
    nickname: c.name,
    avatar: c.avatars?.[0],
    avatarUrl: typeof c.avatars?.[0] === 'string' && String(c.avatars[0]).startsWith('/') ? c.avatars[0] : null,
    emoji: typeof c.avatars?.[0] === 'string' && !String(c.avatars[0]).startsWith('/') ? c.avatars[0] : null,
    personaId: c.personaId,
    userId: c.peerId,
  });
}

function pickMessage(m) {
  const conv = m.conversationId;
  if (!conv || conv === 'default') {
    emit('open-chat', { conversationId: null, name: 'WeChat', isDefault: true });
    return;
  }
  if (conv.startsWith('grp_')) {
    const g = groups.value.find((x) => x.conversationId === conv);
    pickGroup(g || { conversationId: conv, id: Number(conv.slice(4)), name: '群聊', isDefault: false });
    return;
  }
  // 私聊: 尽量从会话列表匹配
  const c = localChats.value.find((x) => x.conversationId === conv) || localChats.value.find((x) => x.id === conv);
  if (c) pickChat(c);
  else emit('open-chat', { conversationId: conv, name: m.senderName || '聊天', isDefault: false });
}

const hasAny = () => contacts.value.length || groups.value.length || messages.value.length || localChats.value.length;
</script>

<template>
  <div class="page">
    <header class="nav">
      <div class="search-field">
        <span class="si"></span>
        <input v-model="q" type="search" placeholder="搜索联系人、群聊、聊天记录" autofocus />
      </div>
      <button class="cancel" type="button" @click="emit('back')">取消</button>
    </header>
    <main class="body scroll-y">
      <div v-if="!q.trim()" class="hint">输入关键词，搜索联系人 / 群 / 聊天内容</div>
      <div v-else-if="loading" class="hint">搜索中…</div>
      <div v-else-if="!hasAny()" class="hint">无结果</div>

      <section v-if="contacts.length" class="sec">
        <div class="cat">联系人</div>
        <button v-for="c in contacts" :key="'c' + c.id + (c.personaId || '')" class="item" @click="pickContact(c)">
          <UserAvatar :name="c.nickname" :avatar="c.avatar" :emoji="c.emoji" :color="c.avatarColor || '#07c160'" :size="40" />
          <div class="main">
            <div class="name">{{ c.nickname }}<span v-if="c.isAI" class="tag">AI</span></div>
            <div class="sub">{{ c.remark || c.wxid || (c.isAI ? 'AI 联系人' : '联系人') }}</div>
          </div>
        </button>
      </section>

      <section v-if="groups.length" class="sec">
        <div class="cat">群聊</div>
        <button v-for="g in groups" :key="'g' + g.id" class="item" @click="pickGroup(g)">
          <div class="group-av">👥</div>
          <div class="main">
            <div class="name">{{ g.name }}</div>
            <div class="sub">{{ g.lastMessage || g.kind }}</div>
          </div>
        </button>
      </section>

      <section v-if="localChats.length" class="sec">
        <div class="cat">聊天</div>
        <button v-for="c in localChats" :key="'l' + c.id" class="item" @click="pickChat(c)">
          <UserAvatar
            :name="c.name"
            :avatar="typeof c.avatars?.[0] === 'string' && String(c.avatars[0]).startsWith('/') ? c.avatars[0] : null"
            :emoji="typeof c.avatars?.[0] === 'string' && !String(c.avatars[0]).startsWith('/') ? c.avatars[0] : null"
            :color="'#07c160'"
            :size="40"
          />
          <div class="main">
            <div class="name">{{ c.name }}</div>
            <div class="sub">{{ c.lastMessage || '' }}</div>
          </div>
        </button>
      </section>

      <section v-if="messages.length" class="sec">
        <div class="cat">聊天记录</div>
        <button v-for="m in messages" :key="'m' + m.id" class="item" @click="pickMessage(m)">
          <UserAvatar :name="m.senderName" :color="'#888'" :size="40" />
          <div class="main">
            <div class="name">{{ m.senderName }}</div>
            <div class="sub">{{ m.content }}</div>
          </div>
        </button>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page { flex: 1; display: flex; flex-direction: column; min-height: 0; width: 100%; background: var(--bg); }
.nav {
  display: flex; align-items: center; gap: 8px;
  height: var(--nav-h); padding: 0 10px; background: var(--bg);
  border-bottom: 0.5px solid var(--divider); flex-shrink: 0;
}
.search-field {
  flex: 1; display: flex; align-items: center; gap: 8px;
  height: 34px; padding: 0 10px; background: var(--white); border-radius: 6px;
}
.search-field input { flex: 1; border: 0; outline: 0; background: transparent; font-size: 14px; color: var(--text); min-width: 0; }
.si { width: 14px; height: 14px; border: 1.5px solid var(--text-3); border-radius: 50%; position: relative; flex-shrink: 0; }
.si::after { content: ""; position: absolute; width: 5px; height: 1.5px; background: var(--text-3); right: -4px; bottom: -1px; transform: rotate(45deg); }
.cancel { border: 0; background: transparent; color: var(--green); font-size: 14px; padding: 8px 4px; }
.body { flex: 1; min-height: 0; }
.hint { padding: 40px 16px; text-align: center; color: var(--text-3); font-size: 13px; }
.sec { margin-bottom: 8px; background: var(--white); }
.cat { padding: 8px 12px 4px; font-size: 12px; color: var(--text-2); }
.item {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border: 0; background: transparent; text-align: left;
}
.item:active { background: var(--press); }
.main { min-width: 0; flex: 1; }
.name { font-size: 15px; color: var(--text); display: flex; align-items: center; gap: 6px; }
.tag { font-size: 10px; color: #07c160; border: 1px solid #07c160; border-radius: 3px; padding: 0 3px; }
.sub { margin-top: 2px; font-size: 12px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group-av {
  width: 40px; height: 40px; border-radius: 6px; background: #444; color: #fff;
  display: flex; align-items: center; justify-content: center; font-size: 18px;
}
</style>
