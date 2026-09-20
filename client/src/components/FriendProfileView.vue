<script setup>
import { ref, onMounted, computed } from 'vue';
import { api } from '../api.js';
import UserAvatar from './UserAvatar.vue';

const props = defineProps({
  user: { type: Object, required: true },
  me: { type: Object, required: true },
});
const emit = defineEmits(['back', 'open-chat', 'deleted', 'open-video-call', 'open-moments', 'open-detail']);

const profile = ref(null);
const loading = ref(true);
const error = ref('');
const isSelf = computed(() => profile.value?.id === props.me.id);
const isAI = computed(() => Boolean(profile.value?.isAI || props.user?.isAI));
const remark = ref('');
const blacklisted = ref(false);
const permission = ref('all');
const tags = ref([]);
const showRemark = ref(false);
const showTags = ref(false);
const tagsAll = ref([]);
const pickedTagIds = ref(new Set());
const blockedByPeer = ref(false);

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
      region: props.user.region || '',
      signature: props.user.signature || '',
      isFriend: props.user.isFriend ?? true,
      isAI: Boolean(props.user.isAI),
      personaId: props.user.personaId ?? null,
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
    blockedByPeer.value = Boolean(profile.value.blockedByPeer);
    permission.value = profile.value.permission || 'all';
    tags.value = profile.value.tags || [];
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
  } catch (e) { alert(e.message); }
}

async function toggleBlacklist() {
  if (!profile.value || isAI.value) return;
  const next = !blacklisted.value;
  const tip = next
    ? `将「${profile.value.nickname}」加入黑名单？\n对方将无法给你发消息，也看不到你的朋友圈更新。`
    : `将「${profile.value.nickname}」移出黑名单？`;
  if (!confirm(tip)) return;
  try {
    const d = await api.setFriendBlacklist(profile.value.id, next);
    blacklisted.value = Boolean(d?.blacklisted ?? next);
    permission.value = blacklisted.value ? 'block' : 'all';
    profile.value = {
      ...profile.value,
      blacklisted: blacklisted.value,
      permission: permission.value,
    };
  } catch (e) { alert(e.message); }
}

async function openFriendDetail() {
  if (!profile.value || isAI.value || isSelf.value) {
    if (!isAI.value && !isSelf.value) showRemark.value = true;
    return;
  }
  emit('open-detail', {
    id: profile.value.userId ?? profile.value.id,
    userId: profile.value.userId ?? profile.value.id,
    nickname: profile.value.remark || profile.value.nickname,
    remark: profile.value.remark || null,
    avatar: profile.value.avatar,
    avatarColor: profile.value.avatarColor,
    signature: profile.value.signature,
    wxid: profile.value.wxid,
    isAI: false,
  });
}

async function openTagPicker() {
  if (!profile.value || isAI.value) return;
  showTags.value = true;
  try {
    const data = await api.tags();
    tagsAll.value = data.tags || [];
    const current = new Set((tags.value || []).map((t) => t.id));
    pickedTagIds.value = current;
  } catch {
    tagsAll.value = [];
  }
}

function toggleTag(id) {
  const set = new Set(pickedTagIds.value);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  pickedTagIds.value = set;
}

async function saveTags() {
  showTags.value = false;
  if (!profile.value) return;
  const ids = [...pickedTagIds.value];
  try {
    const d = await api.setFriendTags(profile.value.id, ids);
    tags.value = d.tags || tagsAll.value.filter((t) => ids.includes(t.id));
    profile.value = { ...profile.value, tags: tags.value };
  } catch (e) {
    alert(e.message || '保存失败');
  }
}

async function removeFriend() {
  if (!profile.value || isAI.value) return;
  if (!confirm(`确定删除好友「${profile.value.nickname}」吗？`)) return;
  try {
    await api.removeFriend(profile.value.id);
    emit('deleted', profile.value);
    emit('back');
  } catch (e) { alert(e.message); }
}

function startChat() {
  if (!profile.value) return;
  // AI 仅在群聊中互动, 不打开私聊
  if (isAI.value) {
    alert('AI 群友仅在群聊中互动，请在群聊里 @TA（可创建提醒、生成文件）');
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

function startCall() {
  if (!profile.value) return;
  emit('open-video-call', {
    callMode: 'video',
    role: 'caller',
    target: {
      nickname: profile.value.nickname,
      avatar: profile.value.avatar,
      emoji: profile.value.emoji,
      color: profile.value.avatarColor,
      userId: Number(profile.value.userId ?? profile.value.id) || null,
    },
  });
}

function openMoments() {
  if (!profile.value) return;
  emit('open-moments', {
    id: profile.value.userId ?? profile.value.id,
    userId: profile.value.userId ?? profile.value.id,
    nickname: profile.value.remark || profile.value.nickname,
    avatar: profile.value.avatar,
    avatarColor: profile.value.avatarColor,
    isAI: Boolean(profile.value.isAI),
    isSelf: isSelf.value,
  });
}

async function addFriend() {
  if (!profile.value || isAI.value) return;
  if (isAI.value) {
    alert('AI 群友仅在群聊中互动，无法添加为好友');
    return;
  }
  try {
    await api.addFriend(profile.value.id);
    profile.value = { ...profile.value, isFriend: true };
  } catch (e) { alert(e.message); }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <header class="nav-bar">
      <button class="icon-btn nav-back" aria-label="返回" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 4.5L7.5 12 15 19.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title"></div>
      <button class="icon-btn nav-more" type="button" aria-label="更多" @click="showRemark = true">
        <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>
      </button>
    </header>

    <main v-if="loading" class="loading">加载中…</main>
    <main v-else-if="error" class="loading">{{ error }}</main>

    <main v-else-if="profile" class="content">
      <section class="hero">
        <UserAvatar
          class="hero-avatar"
          :name="profile.nickname"
          :avatar="profile.avatar"
          :emoji="profile.emoji"
          :color="profile.avatarColor"
          :size="72"
        />
        <div class="hero-main">
          <div class="hero-name">
            {{ profile.remark || profile.nickname }}
            <span class="hero-gender" aria-hidden="true">👤</span>
          </div>
          <div class="hero-wxid">微信号: {{ profile.wxid || '未设置' }}</div>
        </div>
      </section>

      <section class="card block">
        <button class="row-link" type="button" @click="openFriendDetail">
          <div class="row-title">朋友资料</div>
          <div class="row-desc">
            备注名、标签{{ tags?.length ? '（' + tags.map((t) => t.name).join('、') + '）' : '' }}、备忘、照片与朋友权限
          </div>
          <span class="arrow">›</span>
        </button>
        <button v-if="!isAI && !isSelf" class="row-link" type="button" @click="openTagPicker">
          <div class="row-title">设置标签</div>
          <div class="row-desc">{{ tags?.length ? tags.map((t) => t.name).join('、') : '未设置' }}</div>
          <span class="arrow">›</span>
        </button>
      </section>

      <section class="card block">
        <button class="row-link" type="button" @click="openMoments">
          <div class="row-title">朋友圈</div>
          <span class="arrow">›</span>
        </button>
      </section>

      <section v-if="!isSelf" class="card actions">
        <button class="action-btn" type="button" @click="startChat">
          <span class="action-ico">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4.5 6.5A2.5 2.5 0 017 4h10a2.5 2.5 0 012.5 2.5v7A2.5 2.5 0 0117 16H9l-4 3.2V6.5z"/></svg>
          </span>
          <span>发消息</span>
        </button>
        <button v-if="!isAI" class="action-btn" type="button" @click="startCall">
          <span class="action-ico">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6.2 4.5h3l1.4 3.6-2 1.4c.8 2.2 2.6 4 4.8 4.8l1.4-2 3.6 1.4v3c0 1-.8 1.8-1.8 1.8C10.2 18.5 5.5 13.8 5.5 6.3c0-1 .7-1.8 1.7-1.8z"/><rect x="14.5" y="13.5" width="5.5" height="4" rx="1"/><path d="M16 13.5v-1.2c0-.6.5-1.1 1.1-1.1h2.8c.6 0 1.1.5 1.1 1.1v1.2"/></svg>
          </span>
          <span>音视频通话</span>
        </button>
      </section>

      <p v-if="blacklisted && !blockedByPeer" class="black-tip">已在黑名单 · 对方无法给你发消息</p>
      <p v-else-if="blockedByPeer" class="black-tip">对方设置了权限，你可能无法发送消息</p>

      <section v-if="isAI" class="card block">
        <div class="row-link" style="cursor:default">
          <div class="row-title">AI 群友</div>
          <div class="row-desc">仅在群聊中互动，可 @TA 创建提醒、生成 Word/Excel/PPT/PDF 等文件；无法添加为好友</div>
        </div>
      </section>

      <section v-if="!isSelf && !isAI && profile.isFriend" class="card block">
        <button class="row-link" :class="{ danger: blacklisted }" type="button" @click="toggleBlacklist">
          <div class="row-title">{{ blacklisted ? '移出黑名单' : '加入黑名单' }}</div>
          <div v-if="!blacklisted" class="row-desc">对方将无法发送消息给你，也看不到你的朋友圈</div>
          <span class="arrow">›</span>
        </button>
        <button class="row-link danger" type="button" @click="removeFriend">
          <div class="row-title">删除联系人</div>
        </button>
      </section>

      <section v-else-if="!isSelf && !isAI && !profile.isFriend" class="card block">
        <button class="row-link primary" type="button" @click="addFriend">
          <div class="row-title">添加到通讯录</div>
        </button>
      </section>
    </main>

    <div v-if="showRemark" class="mask" @click.self="showRemark = false">
      <div class="dialog">
        <div class="dialog-title">设置备注</div>
        <input v-model="remark" maxlength="20" placeholder="备注名" />
        <div class="dialog-actions">
          <button type="button" @click="showRemark = false">取消</button>
          <button type="button" class="ok" @click="saveRemark">保存</button>
        </div>
      </div>
    </div>

    <div v-if="showTags" class="mask" @click.self="showTags = false">
      <div class="dialog tag-dialog">
        <div class="dialog-title">设置标签</div>
        <div v-if="!tagsAll.length" class="tag-empty">暂无标签，请先在通讯录「标签」中创建</div>
        <div v-else class="tag-list">
          <button
            v-for="t in tagsAll"
            :key="t.id"
            type="button"
            class="tag-item"
            :class="{ on: pickedTagIds.has(t.id) }"
            @click="toggleTag(t.id)"
          >
            <span class="tag-check">{{ pickedTagIds.has(t.id) ? '✓' : '' }}</span>
            {{ t.name }}
          </button>
        </div>
        <div class="dialog-actions">
          <button type="button" @click="showTags = false">取消</button>
          <button type="button" class="ok" @click="saveTags">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--bg); width: 100%; }
.nav-bar {
  height: var(--nav-h); flex-shrink: 0; position: relative;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 4px; background: var(--bg);
}
.nav-title { position: absolute; left: 50%; transform: translateX(-50%); }
.icon-btn { width: 44px; height: 44px; border: 0; background: transparent; color: var(--text); display: flex; align-items: center; justify-content: center; }
.loading { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-2); }
.black-tip {
  margin: 8px 16px 0;
  font-size: 12px;
  color: var(--text-3);
  text-align: center;
}
.tag-dialog { max-height: 60vh; overflow: auto; }
.tag-empty { padding: 16px; text-align: center; color: var(--text-3); font-size: 13px; }
.tag-list { max-height: 40vh; overflow-y: auto; margin: 8px 0; }
.tag-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  border: 0;
  border-bottom: 0.5px solid var(--divider-soft);
  background: transparent;
  color: var(--text);
  font-size: 15px;
  text-align: left;
  padding: 0 4px;
}
.tag-item.on { color: #07c160; }
.tag-check { width: 18px; color: #07c160; font-weight: 700; }
.row-link.danger .row-title { color: var(--red); }
.content { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 24px; background: var(--bg); }

.hero {
  display: flex; align-items: flex-start; gap: 16px;
  padding: 24px 16px 20px; background: var(--white);
}
.hero-avatar :deep(.avatar) { border-radius: 8px !important; }
.hero-main { flex: 1; min-width: 0; padding-top: 6px; }
.hero-name { font-size: 22px; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 6px; }
.hero-gender { font-size: 16px; opacity: 0.85; }
.hero-wxid { margin-top: 10px; font-size: 15px; color: var(--text-2); }

.card { background: var(--white); margin-top: 10px; }
.block { display: flex; flex-direction: column; }
.row-link {
  width: 100%; display: block; text-align: left; border: 0;
  background: var(--white); padding: 16px 40px 16px 16px; position: relative;
  min-height: 56px; color: var(--text);
}
.row-link + .row-link::before {
  content: ''; position: absolute; left: 16px; right: 0; top: 0; height: 0.5px; background: var(--divider);
}
.row-title { font-size: 17px; font-weight: 600; color: var(--text); }
.row-desc { margin-top: 8px; font-size: 14px; color: var(--text-2); line-height: 1.5; padding-right: 8px; }
.row-link.danger .row-title { color: var(--red); font-weight: 500; }
.row-link.primary .row-title { color: var(--green); }
.arrow { position: absolute; right: 16px; top: 50%; transform: translateY(-50%); color: #c7c7cc; font-size: 18px; }

.actions { display: flex; flex-direction: column; }
.action-btn {
  width: 100%; min-height: 64px; border: 0; background: var(--white);
  color: var(--blue, #576b95); font-size: 18px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; gap: 10px;
}
.action-btn + .action-btn { border-top: 0.5px solid var(--divider-soft); }
.action-ico { display: flex; color: var(--blue, #576b95); }

.mask { position: fixed; inset: 0; background: var(--mask); z-index: 80; display: flex; align-items: center; justify-content: center; }
.dialog {
  width: min(300px, 86%); background: var(--white); border-radius: 12px; padding: 18px 16px 12px;
}
.dialog-title { font-size: 16px; font-weight: 600; text-align: center; margin-bottom: 12px; color: var(--text); }
.dialog input {
  width: 100%; box-sizing: border-box; border: 1px solid var(--divider); border-radius: 8px;
  padding: 10px; font-size: 15px; background: var(--white); color: var(--text);
}
.dialog-actions { display: flex; gap: 10px; margin-top: 14px; }
.dialog-actions button {
  flex: 1; min-height: 40px; border: 0; border-radius: 8px; background: var(--divider-soft); color: var(--text);
}
.dialog-actions button.ok { background: #07c160; color: #fff; }
</style>
