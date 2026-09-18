<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
import { toast } from '../toast.js';
import UserAvatar from './UserAvatar.vue';

const props = defineProps({
  me: { type: Object, default: null },
  groupName: { type: String, default: 'WeChat' },
  groupId: { type: [Number, String, null], default: null },
  conversationId: { type: String, default: null },
  members: { type: Object, default: () => ({ onlineUsers: [], aiMembers: [], allUsers: [] }) },
});
const emit = defineEmits(['back', 'open-private', 'open-profile', 'left-group']);

const showQR = ref(false);
const showInvite = ref(false);
const notice = ref('');
const editingNotice = ref(false);
const noticeDraft = ref('');
const savingNotice = ref(false);
const renaming = ref(false);
const nameDraft = ref('');
const members = ref([]);
const friends = ref([]);
const aiList = ref([]);
const picked = ref({});
const prefs = ref({ muted: false, pinned: false, saved: false, folded: false });
const busy = ref(false);

function resolveGroupId() {
  if (props.groupId) return Number(props.groupId);
  if (props.conversationId?.startsWith('grp_')) {
    return Number(props.conversationId.replace(/^grp_/, ''));
  }
  return null;
}

function memberKey(m) {
  if (m.personaKey) return m.personaKey;
  if (m.userId) return 'u' + m.userId;
  return 'n:' + m.nickname;
}

async function loadAll() {
  const gid = resolveGroupId();
  if (gid) {
    try {
      const d = await api.groupInfo(gid);
      notice.value = d?.group?.notice || '';
    } catch { /* ignore */ }
    try {
      const d = await api.groupMembers(gid);
      members.value = d.members || [];
    } catch { members.value = []; }
  }
  // 回退: 用 socket 广播的成员
  if (!members.value.length) {
    const seen = new Set();
    const list = [];
    for (const a of props.members.aiMembers ?? []) {
      const key = 'ai:' + a.nickname;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        personaKey: key,
        nickname: a.nickname,
        avatar: a.avatarUrl,
        emoji: a.avatarUrl ? null : a.avatarEmoji,
        color: '#07c160',
        isAI: true,
        personaId: a.id,
        role: 'member',
      });
    }
    for (const u of props.members.allUsers ?? []) {
      const key = 'u' + u.id;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        userId: u.id,
        nickname: u.nickname,
        avatar: u.avatar,
        color: u.avatarColor,
        online: u.online,
        isAI: false,
        role: 'member',
      });
    }
    members.value = list;
  } else {
    members.value = members.value.map((m) => {
      if (m.isAI) {
        return {
          ...m,
          color: '#07c160',
          emoji: m.emoji || '🤖',
        };
      }
      return { ...m, color: m.color || '#4f6ef7' };
    });
  }

  try {
    const [f, ai] = await Promise.all([
      api.friends().catch(() => ({ friends: [] })),
      api.aiContacts().catch(() => ({ contacts: [] })),
    ]);
    friends.value = (f.friends || []).map((x) => ({
      id: x.id,
      nickname: x.remark || x.nickname,
      avatar: x.avatar,
      color: x.avatarColor,
    }));
    aiList.value = (ai?.contacts || []).map((x) => ({
      nickname: x.nickname,
      avatar: x.avatar,
      emoji: x.emoji,
      isAI: true,
    }));
  } catch { /* ignore */ }

  if (props.conversationId) {
    try {
      const d = await api.getChatPref(props.conversationId);
      const p = d?.pref || {};
      prefs.value = {
        muted: Boolean(p.muted),
        pinned: Boolean(p.pinned),
        folded: Boolean(p.folded),
        saved: false,
      };
    } catch { /* ignore */ }
  }
}

async function saveNotice() {
  const gid = resolveGroupId();
  if (!gid) return;
  savingNotice.value = true;
  try {
    const d = await api.groupNotice(gid, noticeDraft.value);
    notice.value = d?.group?.notice ?? noticeDraft.value.trim();
    editingNotice.value = false;
    toast('群公告已发布');
  } catch (e) {
    toast(e.message || '保存失败');
  } finally {
    savingNotice.value = false;
  }
}

async function saveRename() {
  const gid = resolveGroupId();
  if (!gid || !nameDraft.value.trim()) return;
  busy.value = true;
  try {
    const d = await api.renameGroup(gid, nameDraft.value.trim());
    renaming.value = false;
    toast(`已改名为「${d.group?.name || nameDraft.value.trim()}」`);
  } catch (e) {
    toast(e.message || '改名失败');
  } finally {
    busy.value = false;
  }
}

async function togglePref(key) {
  if (!props.conversationId && key !== 'folded') return;
  const next = { ...prefs.value, [key]: !prefs.value[key] };
  prefs.value = next;
  if (key === 'folded' && !props.conversationId) {
    toast(next.folded ? '已折叠' : '已取消折叠');
    return;
  }
  try {
    await api.chatPref({
      conversationId: props.conversationId,
      muted: next.muted,
      pinned: next.pinned,
      folded: next.folded,
    });
    toast('已保存');
  } catch (e) {
    prefs.value = { ...prefs.value, [key]: !next[key] };
    toast(e.message || '设置失败');
  }
}

function togglePick(item) {
  const key = item.isAI ? 'ai:' + item.nickname : 'u' + item.id;
  picked.value = { ...picked.value, [key]: !picked.value[key] };
}

async function doInvite() {
  const gid = resolveGroupId();
  if (!gid) return;
  const userIds = [];
  const aiNames = [];
  for (const [k, on] of Object.entries(picked.value)) {
    if (!on) continue;
    if (k.startsWith('ai:')) aiNames.push(k.slice(3));
    else if (k.startsWith('u')) userIds.push(Number(k.slice(1)));
  }
  if (!userIds.length && !aiNames.length) {
    toast('请先选择成员');
    return;
  }
  busy.value = true;
  try {
    const d = await api.inviteGroupMembers(gid, userIds, aiNames);
    members.value = (d.members || []).map((m) => ({ ...m, color: m.isAI ? '#07c160' : (m.color || '#4f6ef7') }));
    picked.value = {};
    showInvite.value = false;
    toast(`已邀请 ${d.added?.length || 0} 人`);
  } catch (e) {
    toast(e.message || '邀请失败');
  } finally {
    busy.value = false;
  }
}

async function leaveGroup() {
  const gid = resolveGroupId();
  if (!gid) return;
  if (!confirm('确定删除并退出该群聊？')) return;
  busy.value = true;
  try {
    await api.leaveGroup(gid);
    toast('已退出群聊');
    emit('left-group');
    emit('back');
  } catch (e) {
    toast(e.message || '退出失败');
  } finally {
    busy.value = false;
  }
}

function openMember(m) {
  emit('open-profile', {
    id: m.userId ?? m.personaId ?? memberKey(m),
    userId: m.userId,
    nickname: m.nickname,
    avatar: m.avatar,
    avatarUrl: m.avatar,
    emoji: m.emoji,
    avatarEmoji: m.emoji,
    color: m.color,
    avatarColor: m.color,
    isAI: Boolean(m.isAI),
    personaId: m.personaId ?? (m.personaKey ? m.personaKey.replace(/^ai:/, '') : null),
    isFriend: !m.isAI,
    local: true,
  });
}

onMounted(loadAll);
</script>

<template>
  <div class="page">
    <header class="nav">
      <button class="nav-back" type="button" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 4.5L7.5 12 15 19.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title">
        <span>聊天信息({{ members.length || 0 }})</span>
        <span v-if="prefs.muted" class="nav-mute">🔕</span>
      </div>
      <button class="nav-right icon-btn" type="button" aria-label="搜索">
        <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M15.8 15.8L20 20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>
    </header>

    <main class="content">
      <!-- 成员头像墙 + 添加 -->
      <section class="card members-card">
        <div class="member-grid">
          <div
            v-for="m in members"
            :key="memberKey(m)"
            class="member-cell"
            @click="openMember(m)"
          >
            <UserAvatar
              :name="m.nickname"
              :avatar="m.avatar"
              :emoji="m.emoji"
              :color="m.color || '#07c160'"
              :size="56"
            />
          </div>
          <div class="member-cell action" @click="showInvite = true">
            <div class="icon-btn plus">+</div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="cell-row" @click="renaming = true; nameDraft = groupName">
          <span class="cell-label">群聊名称</span>
          <span class="cell-value">{{ groupName }}</span>
          <span class="arrow">›</span>
        </div>
        <div class="cell-row" @click="showQR = true">
          <span class="cell-label">群二维码</span>
          <span class="cell-value qr-mini">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#888" stroke-width="1.3"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" fill="#888" stroke="none"/></svg>
          </span>
          <span class="arrow">›</span>
        </div>
        <div class="cell-row" @click="editingNotice = true; noticeDraft = notice">
          <span class="cell-label">群公告</span>
          <span class="arrow">›</span>
        </div>
        <div class="cell-row" @click="showInvite = true">
          <span class="cell-label">备注</span>
          <span class="cell-value">{{ notice ? '已设置' : '' }}</span>
          <span class="arrow">›</span>
        </div>
      </section>

      <section class="card">
        <div class="cell-row" @click="showInvite = true">
          <span class="cell-label">查找聊天记录</span>
          <span class="arrow">›</span>
        </div>
      </section>

      <section class="card">
        <div class="cell-row" @click="togglePref('muted')">
          <span class="cell-label">消息免打扰</span>
          <button class="switch" :class="{ on: prefs.muted }" type="button" aria-label="消息免打扰"></button>
        </div>
        <div class="cell-row indent" @click="togglePref('folded')">
          <span class="cell-label">折叠该聊天</span>
          <button class="switch" :class="{ on: prefs.folded }" type="button" aria-label="折叠该聊天"></button>
        </div>
        <div class="cell-row indent" @click="toast('@我、@所有人和群公告 · 演示')">
          <span class="cell-label">
            以下消息仍通知
            <span class="cell-sub">@我、@所有人和群公告</span>
          </span>
          <span class="arrow">›</span>
        </div>
        <div class="cell-row" @click="togglePref('pinned')">
          <span class="cell-label">置顶聊天</span>
          <button class="switch" :class="{ on: prefs.pinned }" type="button" aria-label="置顶聊天"></button>
        </div>
        <div class="cell-row" @click="toast('已保存到通讯录（演示）')">
          <span class="cell-label">保存到通讯录</span>
          <button class="switch" type="button" aria-label="保存到通讯录"></button>
        </div>
      </section>

      <section class="card">
        <div class="cell-row" @click="renaming = true; nameDraft = groupName">
          <span class="cell-label">我在群里的昵称</span>
          <span class="cell-value">{{ me?.nickname || '—' }}</span>
          <span class="arrow">›</span>
        </div>
        <div class="cell-row" @click="toast('已开启显示群成员昵称')">
          <span class="cell-label">显示群成员昵称</span>
          <button class="switch on" type="button" aria-label="显示群成员昵称"></button>
        </div>
      </section>

      <section class="card">
        <button class="cell-row center danger" type="button" :disabled="busy" @click="leaveGroup">
          <span class="cell-label">删除并退出</span>
        </button>
      </section>
    </main>

    <div v-if="renaming" class="mask" @click.self="renaming = false">
      <div class="dialog">
        <div class="dialog-title">修改群名</div>
        <input v-model="nameDraft" maxlength="20" placeholder="群聊名称" />
        <div class="dialog-actions">
          <button type="button" @click="renaming = false">取消</button>
          <button type="button" class="primary" :disabled="busy || !nameDraft.trim()" @click="saveRename">确定</button>
        </div>
      </div>
    </div>

    <div v-if="showInvite" class="mask" @click.self="showInvite = false">
      <div class="sheet">
        <div class="sheet-bar">
          <button type="button" @click="showInvite = false">取消</button>
          <span>邀请加入群聊</span>
          <button type="button" class="primary" :disabled="busy" @click="doInvite">确定</button>
        </div>
        <div class="sheet-body scroll-y">
          <div class="sec">好友</div>
          <button v-for="f in friends" :key="'f'+f.id" class="pick-row" type="button" @click="togglePick(f)">
            <UserAvatar :name="f.nickname" :avatar="f.avatar" :color="f.color || '#4f6ef7'" :size="40" />
            <span class="pick-name">{{ f.nickname }}</span>
            <span class="check" :class="{ on: picked['u'+f.id] }">✓</span>
          </button>
          <div class="sec">AI 联系人</div>
          <button v-for="a in aiList" :key="'ai'+a.nickname" class="pick-row" type="button" @click="togglePick(a)">
            <UserAvatar :name="a.nickname" :avatar="a.avatar" :emoji="a.emoji" :color="'#07c160'" :size="40" />
            <span class="pick-name">{{ a.nickname }}</span>
            <span class="ai-tag">AI</span>
            <span class="check" :class="{ on: picked['ai:'+a.nickname] }">✓</span>
          </button>
          <div v-if="!friends.length && !aiList.length" class="empty-tip" style="padding:24px">暂无可邀请对象</div>
        </div>
      </div>
    </div>

    <div v-if="showQR" class="mask" @click="showQR = false">
      <div class="qr-panel" @click.stop>
        <div class="qr-title">{{ groupName }}</div>
        <div class="qr-box">
          <div class="qr-fake">
            <div v-for="i in 49" :key="i" class="qr-dot" :class="{ on: ((i * 17 + (resolveGroupId()||1)) % 7) < 3 }"></div>
          </div>
        </div>
        <p class="qr-tip">群 ID：{{ resolveGroupId() || '—' }} · 扫码加入（演示）</p>
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
  background: var(--bg, #ededed);
  width: 100%;
}
.nav {
  height: var(--nav-h, 44px);
  background: var(--bg, #ededed);
  border-bottom: 0.5px solid var(--divider, #d9d9d9);
  display: flex;
  align-items: center;
  padding: 0 4px;
  flex-shrink: 0;
  position: relative;
}
.nav-back {
  width: 44px; height: 44px; border: 0; background: transparent; color: var(--text, #111);
  display: flex; align-items: center; justify-content: center; z-index: 2;
}
.nav-title {
  position: absolute; left: 50%; top: 0; bottom: 0; transform: translateX(-50%);
  display: flex; align-items: center; gap: 6px;
  font-size: 17px; font-weight: 600; color: var(--text, #111); pointer-events: none;
  max-width: 70%;
}
.nav-mute { font-size: 13px; opacity: 0.7; }
.nav-right { width: 44px; height: 44px; margin-left: auto; z-index: 2; display: flex; align-items: center; justify-content: center; }
.icon-btn { border: 0; background: transparent; color: var(--text); }

.content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-bottom: 24px;
}

.card {
  background: var(--white, #fff);
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
  color: var(--text-3, #888);
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
  width: 100%;
  display: flex;
  align-items: center;
  padding: 14px 16px;
  border-top: 0.5px solid var(--divider-soft, #f0f0f0);
  cursor: pointer;
  background: var(--white, #fff);
  border-left: 0;
  border-right: 0;
  border-bottom: 0;
  text-align: left;
  min-height: 52px;
}
.cell-row.static { cursor: default; }
.cell-row:active { background: var(--press, #f5f5f5); }
.cell-row.center { justify-content: center; }
.cell-row.danger .cell-label { color: var(--red, #fa5151); width: auto; }
.cell-label {
  font-size: 16px;
  color: var(--text, #111);
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cell-sub { font-size: 12px; color: var(--text-3); font-weight: 400; }
.cell-row.indent { padding-left: 28px; }
.cell-row.indent .cell-label { position: relative; }
.cell-row.indent .cell-label::before {
  content: '−'; position: absolute; left: -16px; color: var(--text-3);
}
.members-card { margin-top: 0; padding: 14px 12px 8px; }
.cell-value.qr-mini { display: flex; align-items: center; }
.cell-value {
  font-size: 15px;
  color: var(--text-2, #999);
  margin-right: 6px;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cell-value.muted { color: var(--text-3, #c0c0c0); }
.arrow { color: #c0c0c0; font-size: 18px; }
.switch {
  width: 44px;
  height: 26px;
  border-radius: 13px;
  background: #e5e5e5;
  position: relative;
  border: 0;
  flex-shrink: 0;
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
.switch.on { background: #07c160; }
.switch.on::after { transform: translateX(18px); }

.mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.dialog {
  width: min(300px, 86%);
  background: var(--white, #fff);
  border-radius: 12px;
  padding: 18px 16px 12px;
}
.dialog-title { font-size: 16px; font-weight: 600; margin-bottom: 12px; text-align: center; color: var(--text); }
.dialog input {
  width: 100%; box-sizing: border-box; border: 1px solid var(--divider); border-radius: 8px;
  padding: 10px; font-size: 15px; background: var(--white); color: var(--text);
}
.dialog-actions { display: flex; gap: 10px; margin-top: 14px; }
.dialog-actions button {
  flex: 1; min-height: 40px; border: 0; border-radius: 8px; background: var(--divider-soft); color: var(--text);
}
.dialog-actions button.primary { background: #07c160; color: #fff; }

.sheet {
  width: 100%; max-height: 80%; margin-top: auto;
  background: var(--bg); border-radius: 12px 12px 0 0;
  display: flex; flex-direction: column;
}
.sheet-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; background: var(--white); border-radius: 12px 12px 0 0; font-size: 15px; color: var(--text);
}
.sheet-bar button { border: 0; background: transparent; color: var(--text-2); min-height: 40px; font-size: 14px; }
.sheet-bar button.primary { color: #07c160; font-weight: 600; }
.sheet-body { flex: 1; min-height: 200px; overflow-y: auto; background: var(--white); padding-bottom: 16px; }
.sec { padding: 10px 14px 4px; font-size: 12px; color: var(--text-3); }
.pick-row {
  width: 100%; display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; min-height: 56px; border: 0; border-bottom: 0.5px solid var(--divider-soft);
  background: var(--white); text-align: left;
}
.pick-name { flex: 1; font-size: 16px; color: var(--text); }
.ai-tag { font-size: 11px; color: #07c160; background: rgba(7,193,96,0.1); padding: 2px 6px; border-radius: 3px; }
.check {
  width: 22px; height: 22px; border-radius: 50%;
  border: 1.5px solid #ccc; color: transparent;
  display: flex; align-items: center; justify-content: center; font-size: 14px;
}
.check.on { background: #07c160; border-color: #07c160; color: #fff; }

.qr-panel {
  width: 280px;
  background: var(--white, #fff);
  border-radius: 12px;
  padding: 24px 20px 16px;
  text-align: center;
}
.qr-title { font-size: 17px; font-weight: 500; margin-bottom: 16px; color: var(--text); }
.qr-box { width: 180px; height: 180px; margin: 0 auto; border: 1px solid #eee; padding: 10px; }
.qr-fake {
  width: 100%; height: 100%;
  display: grid; grid-template-columns: repeat(7, 1fr); grid-template-rows: repeat(7, 1fr); gap: 2px;
}
.qr-dot { background: #f0f0f0; border-radius: 1px; }
.qr-dot.on { background: #111; }
.qr-tip { margin: 14px 0 16px; font-size: 13px; color: var(--text-2); }
.qr-close {
  width: 100%; height: 40px; border-radius: 8px; background: #07c160; color: #fff; font-size: 15px; border: 0;
}
.notice-card { padding: 12px 14px; }
.notice-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.notice-title { font-size: 14px; font-weight: 600; color: var(--text); }
.notice-edit { border: 0; background: transparent; color: var(--green, #07c160); font-size: 13px; padding: 4px; }
.notice-body { font-size: 13px; color: var(--text-2); line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.notice-edit-box textarea {
  width: 100%; box-sizing: border-box; border: 1px solid var(--divider); border-radius: 8px;
  padding: 8px; font-size: 14px; resize: none; background: var(--white); color: var(--text);
}
.notice-actions { margin-top: 8px; display: flex; justify-content: flex-end; gap: 8px; }
.notice-actions button {
  border: 0; background: var(--divider-soft); color: var(--text-2);
  border-radius: 6px; padding: 6px 14px; font-size: 13px; min-height: 32px;
}
.notice-actions button.primary { background: var(--green); color: #fff; }
.empty-tip { font-size: 12px; color: var(--text-3); text-align: center; }
</style>
