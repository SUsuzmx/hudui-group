<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api.js';
import { toast } from '../toast.js';
import UserAvatar from './UserAvatar.vue';

const emit = defineEmits(['back', 'created']);

const name = ref('');
const people = ref([]);
const picked = ref({});
const creating = ref(false);

onMounted(async () => {
  try {
    const [f, ai] = await Promise.all([
      api.friends().catch(() => ({ friends: [] })),
      api.aiContacts().catch(() => ({ contacts: [] })),
    ]);
    const list = [];
    for (const c of ai.contacts || []) {
      list.push({ key: 'ai-' + c.id, nickname: c.nickname, avatar: c.avatar, emoji: c.emoji, isAI: true, userId: null });
    }
    for (const f2 of f.friends || []) {
      list.push({ key: 'u-' + f2.id, nickname: f2.remark || f2.nickname, avatar: f2.avatar, color: f2.avatarColor, isAI: false, userId: f2.id });
    }
    people.value = list;
  } catch {
    people.value = [];
  }
});

const pickedCount = computed(() => Object.values(picked.value).filter(Boolean).length);
const defaultName = computed(() => {
  const names = people.value.filter((p) => picked.value[p.key]).slice(0, 3).map((p) => p.nickname);
  return names.length ? names.join('、') + '的群聊' : '';
});

function toggle(p) {
  picked.value = { ...picked.value, [p.key]: !picked.value[p.key] };
}

async function create() {
  if (pickedCount.value < 2 || creating.value) return;
  creating.value = true;
  try {
    const pickedPeople = people.value.filter((p) => picked.value[p.key]);
    const memberIds = pickedPeople.filter((p) => !p.isAI && p.userId).map((p) => p.userId);
    const aiMembers = pickedPeople.filter((p) => p.isAI).map((p) => p.nickname);
    const d = await api.createGroup(name.value.trim() || defaultName.value, memberIds, aiMembers);
    toast('群聊创建成功');
    emit('created', d.group);
  } catch (e) {
    toast(e.message || '创建失败');
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div class="page">
    <header class="nav-bar">
      <button class="icon-btn nav-back" @click="emit('back')">‹</button>
      <div class="nav-title">发起群聊</div>
      <button class="nav-ok" :disabled="pickedCount < 2 || creating" @click="create">
        {{ creating ? '…' : `完成(${pickedCount})` }}
      </button>
    </header>
    <main class="content scroll-y">
      <div class="name-field">
        <input v-model="name" :placeholder="defaultName || '群聊名称（可留空自动生成）'" maxlength="20" />
      </div>
      <p class="hint">选择至少 2 位成员（可选 AI 联系人；AI 会在新群里像真人一样说话）</p>
      <div class="pick-list">
        <button v-for="p in people" :key="p.key" class="pick-row" @click="toggle(p)">
          <UserAvatar :name="p.nickname" :avatar="p.avatar" :color="p.color || '#07c160'" :size="40" />
          <span class="pick-name">{{ p.nickname }}</span>
          <span v-if="p.isAI" class="ai-tag">AI</span>
          <span class="check" :class="{ on: picked[p.key] }">✓</span>
        </button>
        <div v-if="!people.length" class="empty-tip">暂无可选成员</div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.page { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--bg); width: 100%; }
.nav-bar {
  height: var(--nav-h); flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  position: relative; background: var(--bg); border-bottom: 0.5px solid var(--divider); padding: 0 8px;
}
.icon-btn {
  position: absolute; left: 0; top: 0; bottom: 0; margin: auto 0; width: 44px; height: 44px;
  border: 0; background: transparent; color: var(--text); font-size: 24px;
}
.nav-title { font-size: 17px; font-weight: 600; }
.nav-ok {
  position: absolute; right: 8px; border: 0; background: #07c160; color: #fff;
  border-radius: 6px; padding: 0 12px; min-height: 32px; font-size: 14px;
}
.nav-ok:disabled { opacity: 0.45; }
.content { flex: 1; min-height: 0; padding-bottom: 24px; }
.name-field { background: var(--white); margin-top: 8px; padding: 10px 16px; }
.name-field input { width: 100%; height: 36px; background: var(--divider-soft); border-radius: 6px; padding: 0 10px; font-size: 14px; color: var(--text); }
.hint { padding: 10px 16px 4px; font-size: 12px; color: var(--text-3); }
.pick-list { margin-top: 4px; background: var(--white); }
.pick-row {
  width: 100%; display: flex; align-items: center; gap: 12px; padding: 8px 16px;
  min-height: 56px; background: var(--white); border: 0; text-align: left; border-bottom: 0.5px solid var(--divider-soft);
}
.pick-row:active { background: var(--press); }
.pick-name { flex: 1; font-size: 16px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-tag { font-size: 10px; color: #07c160; border: 1px solid #07c160; border-radius: 3px; padding: 0 4px; margin-right: 6px; }
.check {
  width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid #ccc; color: transparent;
  display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0;
}
.check.on { background: #07c160; border-color: #07c160; color: #fff; }
.empty-tip { padding: 40px; text-align: center; font-size: 13px; color: var(--text-3); }
</style>
