<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
import UserAvatar from './UserAvatar.vue';

const props = defineProps({
  groupName: { type: String, default: 'WeChat' },
  groupId: { type: [Number, String, null], default: null },
  conversationId: { type: String, default: null },
  members: { type: Object, default: () => ({ onlineUsers: [], aiMembers: [], allUsers: [] }) },
});
const emit = defineEmits(['back', 'open-private', 'open-profile']);

const showQR = ref(false);
const notice = ref('');
const editingNotice = ref(false);
const noticeDraft = ref('');
const savingNotice = ref(false);

function resolveGroupId() {
  if (props.groupId) return Number(props.groupId);
  if (props.conversationId?.startsWith('grp_')) {
    return Number(props.conversationId.replace(/^grp_/, ''));
  }
  return null;
}

async function loadNotice() {
  const gid = resolveGroupId();
  if (!gid) return;
  try {
    const d = await api.groupInfo(gid);
    notice.value = d?.group?.notice || '';
  } catch { /* ignore */ }
}

async function saveNotice() {
  const gid = resolveGroupId();
  if (!gid) return;
  savingNotice.value = true;
  try {
    const d = await api.groupNotice(gid, noticeDraft.value);
    notice.value = d?.group?.notice ?? noticeDraft.value.trim();
    editingNotice.value = false;
  } catch (e) {
    alert(e.message || '保存失败');
  } finally {
    savingNotice.value = false;
  }
}

onMounted(loadNotice);

const allMemberList = () => {
  const seen = new Set();
  const list = [];
  for (const a of props.members.aiMembers ?? []) {
    const key = 'ai-' + a.nickname;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({
      key,
      nickname: a.nickname,
      avatar: a.avatarUrl,
      emoji: a.avatarUrl ? null : a.avatarEmoji,
      color: '#07c160',
      isAI: true,
      personaId: a.id,
    });
  }
  for (const u of props.members.allUsers ?? []) {
    const key = 'u-' + u.nickname;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({
      key,
      nickname: u.nickname,
      avatar: u.avatar,
      emoji: null,
      color: u.avatarColor,
      online: u.online,
      isAI: false,
      userId: u.id,
    });
  }
  return list;
};

function openMember(m) {
  // 先进资料页
  emit('open-profile', {
    id: m.userId ?? m.personaId ?? m.key,
    userId: m.userId,
    nickname: m.nickname,
    avatar: m.avatar,
    avatarUrl: m.avatar,
    emoji: m.emoji,
    avatarEmoji: m.emoji,
    color: m.color,
    avatarColor: m.color,
    isAI: Boolean(m.isAI),
    personaId: m.personaId ?? null,
    isFriend: !m.isAI,
    local: true,
  });
}

const memberCount = () =>
  (props.members.allUsers?.length ?? 0) + (props.members.aiMembers?.length ?? 0);
</script>

<template>
  <div class="page">
    <header class="nav">
      <button class="nav-back" @click="emit('back')">‹</button>
      <div class="nav-title">聊天信息</div>
      <div class="nav-right"></div>
    </header>

    <main class="content">
      <!-- 群公告 -->
      <section class="card notice-card">
        <div class="notice-head">
          <span class="notice-title">群公告</span>
          <button class="notice-edit" type="button" @click="editingNotice = true; noticeDraft = notice">
            {{ notice ? '编辑' : '设置' }}
          </button>
        </div>
        <div v-if="!editingNotice" class="notice-body">
          {{ notice || '未设置群公告，成员进群后可在此查看' }}
        </div>
        <div v-else class="notice-edit-box">
          <textarea v-model="noticeDraft" rows="3" maxlength="500" placeholder="输入群公告，发送后会通知群成员"></textarea>
          <div class="notice-actions">
            <button type="button" @click="editingNotice = false">取消</button>
            <button type="button" class="primary" :disabled="savingNotice" @click="saveNotice">
              {{ savingNotice ? '保存中…' : '发布' }}
            </button>
          </div>
        </div>
      </section>

      <!-- 群成员 -->
      <section class="card">
        <div class="member-grid">
          <div
            v-for="m in allMemberList()"
            :key="m.key"
            class="member-cell"
            @click="openMember(m)"
          >
            <UserAvatar :name="m.nickname" :avatar="m.avatar" :emoji="m.emoji" :color="m.color" :size="52" />
            <span class="member-name">{{ m.nickname }}</span>
          </div>
          <div class="member-cell action">
            <div class="icon-btn plus">+</div>
            <span class="member-name">添加</span>
          </div>
          <div class="member-cell action">
            <div class="icon-btn minus">−</div>
            <span class="member-name">删除</span>
          </div>
        </div>
        <div class="cell-row">
          <span class="cell-label">全部群成员</span>
          <span class="cell-value">{{ (members.allUsers?.length ?? 0) + (members.aiMembers?.length ?? 0) }}人</span>
          <span class="arrow">›</span>
        </div>
      </section>

      <!-- 群设置项 -->
      <section class="card">
        <div class="cell-row">
          <span class="cell-label">群聊名称</span>
          <span class="cell-value">{{ groupName }}</span>
          <span class="arrow">›</span>
        </div>
        <div class="cell-row" @click="showQR = true">
          <span class="cell-label">群二维码</span>
          <span class="cell-value"></span>
          <span class="arrow">›</span>
        </div>
        <div class="cell-row">
          <span class="cell-label">群公告</span>
          <span class="cell-value muted">未设置</span>
          <span class="arrow">›</span>
        </div>
        <div class="cell-row">
          <span class="cell-label">群管理</span>
          <span class="cell-value"></span>
          <span class="arrow">›</span>
        </div>
      </section>

      <section class="card">
        <div class="cell-row">
          <span class="cell-label">消息免打扰</span>
          <span class="switch"></span>
        </div>
        <div class="cell-row">
          <span class="cell-label">置顶聊天</span>
          <span class="switch"></span>
        </div>
        <div class="cell-row">
          <span class="cell-label">保存到通讯录</span>
          <span class="switch"></span>
        </div>
        <div class="cell-row">
          <span class="cell-label">我在本群的昵称</span>
          <span class="cell-value"></span>
          <span class="arrow">›</span>
        </div>
      </section>

      <section class="card">
        <div class="cell-row center danger">
          <span class="cell-label">删除并退出</span>
        </div>
      </section>
    </main>

    <!-- 二维码弹层 -->
    <div v-if="showQR" class="mask" @click="showQR = false">
      <div class="qr-panel" @click.stop>
        <div class="qr-title">{{ groupName }}</div>
        <div class="qr-box">
          <div class="qr-fake">
            <div v-for="i in 49" :key="i" class="qr-dot" :class="{ on: ((i * 17) % 7) < 3 }"></div>
          </div>
        </div>
        <p class="qr-tip">扫一扫二维码，加入群聊</p>
        <button class="qr-close" @click="showQR = false">完成</button>
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
  background: #ededed;
}
.nav {
  height: 52px;
  background: #ededed;
  border-bottom: 1px solid #d9d9d9;
  display: flex;
  align-items: center;
  padding: 0 14px;
  flex-shrink: 0;
}
.nav-back {
  width: 36px;
  background: none;
  font-size: 30px;
  color: #111;
  line-height: 1;
  padding-bottom: 4px;
  margin-left: -8px;
}
.nav-title {
  flex: 1;
  text-align: center;
  font-size: 17px;
  font-weight: 500;
  color: #111;
}
.nav-right { width: 36px; }

.content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-bottom: 24px;
}

.card {
  background: #fff;
  margin-top: 10px;
}

.member-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 14px 8px;
  padding: 16px 12px 8px;
}
.member-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.member-name {
  font-size: 11px;
  color: #888;
  max-width: 56px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}
.icon-btn {
  width: 52px;
  height: 52px;
  border-radius: 6px;
  border: 1px dashed #ccc;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  color: #999;
  background: #fafafa;
}

.cell-row {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  border-top: 1px solid #f0f0f0;
  cursor: pointer;
  background: #fff;
}
.cell-row:active { background: #f5f5f5; }
.cell-row.center { justify-content: center; }
.cell-row.danger .cell-label { color: #fa5151; width: auto; }
.cell-label {
  font-size: 16px;
  color: #111;
  flex: 1;
}
.cell-value {
  font-size: 15px;
  color: #999;
  margin-right: 6px;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cell-value.muted { color: #c0c0c0; }
.arrow {
  color: #c0c0c0;
  font-size: 18px;
}
.switch {
  width: 44px;
  height: 26px;
  border-radius: 13px;
  background: #e5e5e5;
  position: relative;
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
}

.mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.qr-panel {
  width: 280px;
  background: #fff;
  border-radius: 12px;
  padding: 24px 20px 16px;
  text-align: center;
}
.qr-title {
  font-size: 17px;
  font-weight: 500;
  margin-bottom: 16px;
}
.qr-box {
  width: 180px;
  height: 180px;
  margin: 0 auto;
  border: 1px solid #eee;
  padding: 10px;
}
.qr-fake {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-template-rows: repeat(7, 1fr);
  gap: 2px;
}
.qr-dot { background: #f0f0f0; border-radius: 1px; }
.qr-dot.on { background: #111; }
.qr-tip {
  margin: 14px 0 16px;
  font-size: 13px;
}
.notice-card { padding: 12px 14px; }
.notice-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px;
}
.notice-title { font-size: 14px; font-weight: 600; color: var(--text); }
.notice-edit {
  border: 0; background: transparent; color: var(--green); font-size: 13px; padding: 4px;
}
.notice-body { font-size: 13px; color: var(--text-2); line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.notice-edit-box textarea {
  width: 100%; box-sizing: border-box; border: 1px solid var(--divider); border-radius: 8px;
  padding: 8px; font-size: 14px; resize: none; background: var(--white); color: var(--text);
}
.notice-actions {
  margin-top: 8px; display: flex; justify-content: flex-end; gap: 8px;
}
.notice-actions button {
  border: 0; background: var(--divider-soft); color: var(--text-2);
  border-radius: 6px; padding: 6px 14px; font-size: 13px; min-height: 32px;
}
.notice-actions button.primary {
  background: var(--green); color: #fff;
}
.qr-close {
  width: 100%;
  height: 40px;
  border-radius: 8px;
  background: #07c160;
  color: #fff;
  font-size: 15px;
}
</style>
