<script setup>
import { ref, onMounted, computed } from 'vue';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { loadFriendExtras, isStarFriend, setStarFriend } from '../profile-extras.js';

const props = defineProps({
  user: { type: Object, required: true },
  me: { type: Object, default: null },
});
const emit = defineEmits(['back', 'open-detail', 'deleted', 'updated']);

const profile = ref(null);
const blacklisted = ref(false);
const starred = ref(false);
const permission = ref('all');
const showPermission = ref(false);
const extras = ref(loadFriendExtras(props.user?.userId ?? props.user?.id));

const uid = () => Number(profile.value?.userId ?? profile.value?.id ?? props.user?.userId ?? props.user?.id);
const displayName = computed(() => profile.value?.remark || profile.value?.nickname || props.user?.nickname || '');
const permLabel = computed(() => {
  const p = permission.value;
  if (p === 'block' || blacklisted.value) return '已加入黑名单';
  if (p === 'chat') return '仅聊天';
  return '聊天、朋友圈等';
});

const starKey = (id) => `wx_star_friend_${id}`;

async function load() {
  try {
    const id = uid();
    const data = await api.user(id);
    profile.value = data.user || props.user;
    blacklisted.value = Boolean(profile.value.blacklisted);
    permission.value = blacklisted.value ? 'block' : (profile.value.permission || 'all');
  } catch {
    profile.value = { ...props.user };
  }
  const id = uid();
  // 默认不星标，仅当用户手动开启过才显示开启
  starred.value = isStarFriend(id);
  extras.value = loadFriendExtras(id);
}

function openProfileInfo() {
  emit('open-detail', {
    id: uid(),
    userId: uid(),
    nickname: displayName.value,
    remark: profile.value?.remark || null,
    avatar: profile.value?.avatar,
    avatarColor: profile.value?.avatarColor,
    wxid: profile.value?.wxid,
    region: profile.value?.region,
    signature: profile.value?.signature,
    isAI: Boolean(profile.value?.isAI),
  });
}

async function savePermission(p) {
  showPermission.value = false;
  const id = uid();
  try {
    if (p === 'block') {
      await api.setFriendBlacklist(id, true);
      blacklisted.value = true;
      permission.value = 'block';
    } else {
      if (blacklisted.value) {
        await api.setFriendBlacklist(id, false);
        blacklisted.value = false;
      }
      await api.setFriendPermission(id, p);
      permission.value = p;
    }
    toast('权限已更新');
    emit('updated', profile.value);
  } catch (e) {
    toast(e.message || '设置失败');
  }
}

async function toggleStar() {
  const id = uid();
  const next = !starred.value;
  starred.value = setStarFriend(id, next);
  extras.value = loadFriendExtras(id);
  toast(starred.value ? '已设为星标朋友' : '已取消星标');
}

async function toggleBlacklist() {
  const id = uid();
  const next = !blacklisted.value;
  const name = displayName.value || '该好友';
  if (!confirm(next ? `将「${name}」加入黑名单？\n对方将无法给你发消息，也看不到你的朋友圈更新。` : `将「${name}」移出黑名单？`)) {
    return;
  }
  try {
    const d = await api.setFriendBlacklist(id, next);
    blacklisted.value = Boolean(d?.blacklisted ?? next);
    permission.value = blacklisted.value ? 'block' : 'all';
    toast(blacklisted.value ? '已加入黑名单' : '已移出黑名单');
    emit('updated', profile.value);
  } catch (e) {
    toast(e.message || '操作失败');
  }
}

function recommendToFriend() {
  const name = displayName.value;
  const wxid = profile.value?.wxid || '';
  const text = `推荐朋友：${name}${wxid ? `（微信号 ${wxid}）` : ''}`;
  try {
    api.addFavorite({
      kind: 'text',
      content: text,
      fromName: props.me?.nickname || '我',
    }).then(() => {
      toast('已生成推荐名片，可在「收藏」中查看并转发');
    }).catch(() => {
      toast('推荐内容已生成');
    });
  } catch {
    toast('推荐内容已生成');
  }
}

function addToDesktop() {
  const id = uid();
  const name = displayName.value;
  extras.value = saveFriendExtras(id, { desktopShortcut: true });
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(`weixin://chat/${profile.value?.wxid || id}`).catch(() => {});
  }
  toast(`已尝试将「${name}」添加到桌面（演示环境请用浏览器添加到主屏幕）`);
}

function reportFriend() {
  const reason = prompt('请选择投诉原因：\n1 违法违规 2 欺诈 3 骚扰 4 其他（输入数字）', '3');
  if (!reason) return;
  const map = { '1': '违法违规', '2': '欺诈', '3': '骚扰', '4': '其他' };
  const label = map[String(reason).trim()] || '其他';
  api.addFavorite({
    kind: 'text',
    content: `[投诉] ${label} — 好友 ${displayName.value} (${uid()})`,
    fromName: '系统',
  }).then(() => {
    toast('已收到投诉，我们会尽快处理');
  }).catch(() => {
    toast('已收到投诉，我们会尽快处理');
  });
}

async function deleteFriend() {
  const id = uid();
  const name = displayName.value || '该好友';
  if (!confirm(`确定删除好友「${name}」吗？删除后将同时从通讯录移除。`)) return;
  try {
    await api.removeFriend(id);
    toast('已删除好友');
    emit('deleted', profile.value);
    emit('back');
  } catch (e) {
    toast(e.message || '删除失败');
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <header class="nav">
      <button class="nav-back" type="button" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title">朋友设置</div>
      <div class="nav-right"></div>
    </header>

    <main class="content scroll-y">
      <section class="cell-group">
        <button class="cell-row" type="button" @click="openProfileInfo">
          <span class="cell-label">设置朋友资料</span>
          <span class="cell-value">{{ displayName }}</span>
          <span class="cell-arrow"></span>
        </button>
        <button class="cell-row" type="button" @click="showPermission = true">
          <span class="cell-label">朋友权限</span>
          <span class="cell-value">{{ permLabel }}</span>
          <span class="cell-arrow"></span>
        </button>
      </section>

      <section class="cell-group">
        <button class="cell-row" type="button" @click="recommendToFriend">
          <span class="cell-label">把他推荐给朋友</span>
          <span class="cell-arrow"></span>
        </button>
        <button class="cell-row" type="button" @click="addToDesktop">
          <span class="cell-label">添加到桌面</span>
          <span class="cell-arrow"></span>
        </button>
      </section>

      <section class="cell-group">
        <button class="cell-row" type="button" @click="toggleStar">
          <span class="cell-label">设为星标朋友</span>
          <span class="switch" :class="{ on: starred }"></span>
        </button>
      </section>

      <section class="cell-group">
        <button class="cell-row" type="button" @click="toggleBlacklist">
          <span class="cell-label">加入黑名单</span>
          <span class="switch" :class="{ on: blacklisted }"></span>
        </button>
        <button class="cell-row" type="button" @click="reportFriend">
          <span class="cell-label">投诉</span>
          <span class="cell-arrow"></span>
        </button>
      </section>

      <section class="cell-group danger-group">
        <button class="cell-row delete-row" type="button" @click="deleteFriend">
          <span class="cell-label danger">删除</span>
        </button>
      </section>
    </main>

    <div v-if="showPermission" class="mask sheet-mask" @click.self="showPermission = false">
      <div class="sheet">
        <div class="sheet-title">朋友权限</div>
        <button class="sheet-item" type="button" @click="savePermission('all')">聊天、朋友圈等</button>
        <button class="sheet-item" type="button" @click="savePermission('chat')">仅聊天</button>
        <button class="sheet-item" type="button" @click="savePermission('block')">加入黑名单</button>
        <button class="sheet-item cancel" type="button" @click="showPermission = false">取消</button>
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
.nav {
  height: var(--nav-h);
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  background: var(--bg);
  border-bottom: 0.5px solid var(--divider);
  padding: 0 4px;
}
.nav-back {
  width: 44px;
  height: 44px;
  border: 0;
  background: transparent;
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
}
.nav-right { width: 44px; margin-left: auto; }
.content { flex: 1; min-height: 0; padding-bottom: 24px; }

.cell-group { background: var(--white); margin-top: 10px; }
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
  flex-shrink: 0;
  font-size: 16px;
  color: var(--text);
}
.cell-label.danger { color: var(--red, #fa5151); }
.cell-value {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 16px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cell-arrow {
  width: 8px;
  height: 8px;
  border-right: 1.5px solid #c7c7cc;
  border-top: 1.5px solid #c7c7cc;
  transform: rotate(45deg);
  flex-shrink: 0;
  margin-left: 4px;
}
.switch {
  width: 51px;
  height: 31px;
  border-radius: 16px;
  background: #e5e5e5;
  position: relative;
  flex-shrink: 0;
  margin-left: auto;
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

.delete-row {
  justify-content: center;
}
.delete-row .cell-label {
  flex: 0 0 auto;
  font-size: 16px;
}

.mask {
  position: fixed;
  inset: 0;
  background: var(--mask);
  z-index: 80;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.sheet {
  width: 100%;
  background: var(--white);
  border-radius: 12px 12px 0 0;
  padding-bottom: calc(8px + var(--safe-b));
}
.sheet-title {
  padding: 14px 16px;
  text-align: center;
  font-size: 15px;
  color: var(--text-2);
  border-bottom: 0.5px solid var(--divider);
}
.sheet-item {
  width: 100%;
  min-height: 52px;
  border: 0;
  border-bottom: 0.5px solid var(--divider-soft);
  background: var(--white);
  color: var(--text);
  font-size: 16px;
  text-align: center;
}
.sheet-item.cancel {
  color: var(--text-2);
  border-bottom: 0;
  margin-top: 6px;
  border-top: 0.5px solid var(--divider);
}
</style>
