<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
import { toast } from '../toast.js';
import {
  loadFriendExtras,
  saveFriendExtras,
  formatFriendSince,
  permissionLabel,
} from '../profile-extras.js';

const props = defineProps({
  user: { type: Object, required: true },
  me: { type: Object, default: null },
});
const emit = defineEmits(['back', 'open-profile', 'open-chat', 'open-moments']);

const loading = ref(true);
const error = ref('');
const profile = ref(null);
const friendRow = ref(null);
const extras = ref(loadFriendExtras(props.user?.userId ?? props.user?.id));
const commonGroups = ref(0);
const editField = ref('');
const editValue = ref('');
const showPermission = ref(false);
const showTags = ref(false);
const showPhotos = ref(false);
const tagsAll = ref([]);
const pickedTagIds = ref(new Set());

const uid = () => Number(props.user?.userId ?? props.user?.id ?? profile.value?.id ?? 0);

const displayName = () => profile.value?.remark || profile.value?.nickname || props.user?.nickname || '';
const signatureText = () => profile.value?.signature || '未填写';
const sourceText = () => extras.value.source || '通过搜索账号添加';
const sinceText = () => formatFriendSince(friendRow.value?.friendSince || profile.value?.friendSince || props.user?.friendSince) || '—';
const permText = () => permissionLabel(profile.value?.permission || friendRow.value?.permission);
const tagsText = () => {
  const fromServer = (profile.value?.tags || friendRow.value?.tags || []).map((t) => t.name).filter(Boolean);
  if (fromServer.length) return fromServer.join('、');
  return extras.value.tags || '';
};

function openEdit(field) {
  editField.value = field;
  if (field === 'remark') editValue.value = profile.value?.remark || '';
  else if (field === 'phone') editValue.value = extras.value.phone || '';
  else if (field === 'memo') editValue.value = extras.value.memo || '';
  else editValue.value = '';
}

async function saveEdit() {
  const field = editField.value;
  const val = String(editValue.value || '').trim();
  const id = uid();
  if (!id) {
    editField.value = '';
    return;
  }
  if (field === 'remark') {
    try {
      const data = await api.setFriendRemark(id, val);
      profile.value = { ...(profile.value || {}), remark: data.remark };
      friendRow.value = { ...(friendRow.value || {}), remark: data.remark };
      toast('备注已保存');
    } catch (e) {
      toast(e.message || '保存失败');
      return;
    }
    editField.value = '';
    return;
  }
  if (field === 'phone' || field === 'memo') {
    extras.value = saveFriendExtras(id, { [field]: val });
    toast('已保存');
    editField.value = '';
  }
}

async function savePermission(p) {
  showPermission.value = false;
  const id = uid();
  if (!id) return;
  if (p === 'block') {
    if (!confirm('加入黑名单后，对方将无法给你发消息，也看不到你的朋友圈。继续？')) return;
  }
  try {
    const d = await api.setFriendPermission(id, p);
    profile.value = {
      ...(profile.value || {}),
      permission: p,
      blacklisted: Boolean(d?.blacklisted ?? p === 'block'),
    };
    friendRow.value = {
      ...(friendRow.value || {}),
      permission: p,
      blacklisted: Boolean(d?.blacklisted ?? p === 'block'),
    };
    toast(p === 'block' ? '已加入黑名单' : '权限已更新');
  } catch (e) {
    toast(e.message || '设置失败');
  }
}

async function openTagPicker() {
  const id = uid();
  if (!id) return;
  showTags.value = true;
  try {
    const data = await api.tags();
    tagsAll.value = data.tags || [];
    const current = new Set((profile.value?.tags || friendRow.value?.tags || []).map((t) => t.id));
    if (!current.size && extras.value.tags) {
      // 本地文本标签无 id，仅展示
    }
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
  const id = uid();
  if (!id) return;
  const ids = [...pickedTagIds.value];
  try {
    await api.setFriendTags(id, ids);
    const names = tagsAll.value.filter((t) => ids.includes(t.id)).map((t) => t.name);
    extras.value = saveFriendExtras(id, { tags: names.join('、') });
    if (profile.value) {
      profile.value = {
        ...profile.value,
        tags: tagsAll.value.filter((t) => ids.includes(t.id)),
      };
    }
    toast('标签已保存');
  } catch (e) {
    toast(e.message || '保存失败');
  }
}

function addPhoto(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const list = [...(extras.value.photos || []), reader.result].slice(0, 9);
    extras.value = saveFriendExtras(uid(), { photos: list });
  };
  reader.readAsDataURL(file);
}

function removePhoto(i) {
  const list = [...(extras.value.photos || [])];
  list.splice(i, 1);
  extras.value = saveFriendExtras(uid(), { photos: list });
}

function openCommonGroups() {
  if (!commonGroups.value) {
    toast('暂无共同群聊');
    return;
  }
  toast(`与对方有 ${commonGroups.value} 个共同群聊`);
}

onMounted(async () => {
  loading.value = true;
  const id = uid();
  try {
    const data = await api.user(id);
    profile.value = data.user || null;
    const list = await api.friends().catch(() => ({ friends: [] }));
    friendRow.value = (list.friends || []).find((f) => Number(f.id) === id) || null;
    if (friendRow.value?.friendSince && profile.value) {
      profile.value = { ...profile.value, friendSince: friendRow.value.friendSince };
    }
    if (friendRow.value?.remark && profile.value && !profile.value.remark) {
      profile.value = { ...profile.value, remark: friendRow.value.remark };
    }
    if (typeof profile.value?.commonGroupCount === 'number') {
      commonGroups.value = profile.value.commonGroupCount;
    }
    extras.value = loadFriendExtras(id);
  } catch (e) {
    error.value = e.message || '加载失败';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page">
    <header class="nav">
      <button class="nav-back" type="button" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title">朋友资料</div>
      <div class="nav-right"></div>
    </header>

    <main v-if="loading" class="loading">加载中…</main>
    <main v-else-if="error" class="loading">{{ error }}</main>

    <main v-else class="content scroll-y">
      <div class="section-bar">备注</div>
      <section class="cell-group">
        <button class="cell-row" type="button" @click="openEdit('remark')">
          <span class="cell-label">备注名</span>
          <span class="cell-value">{{ displayName() || '' }}</span>
          <span class="cell-arrow"></span>
        </button>
        <button class="cell-row" type="button" @click="openEdit('phone')">
          <span class="cell-label">电话</span>
          <span class="cell-value">{{ extras.phone || '' }}</span>
          <span class="cell-arrow"></span>
        </button>
        <button class="cell-row" type="button" @click="openTagPicker">
          <span class="cell-label">标签</span>
          <span class="cell-value">{{ tagsText() || '' }}</span>
          <span class="cell-arrow"></span>
        </button>
        <button class="cell-row" type="button" @click="openEdit('memo')">
          <span class="cell-label">备忘</span>
          <span class="cell-value clamp">{{ extras.memo || '' }}</span>
          <span class="cell-arrow"></span>
        </button>
        <button class="cell-row" type="button" @click="showPhotos = true">
          <span class="cell-label">照片</span>
          <span class="cell-value">{{ (extras.photos || []).length ? `${extras.photos.length}张` : '' }}</span>
          <span class="cell-arrow"></span>
        </button>
      </section>

      <div class="section-bar">朋友权限</div>
      <section class="cell-group">
        <button class="cell-row" type="button" @click="showPermission = true">
          <span class="cell-label">权限</span>
          <span class="cell-value">{{ permText() }}</span>
          <span class="cell-arrow"></span>
        </button>
        <div class="cell-row static">
          <span class="cell-label">黑名单</span>
          <span class="cell-value">{{ profile?.blacklisted || friendRow?.blacklisted ? '已加入' : '未加入' }}</span>
        </div>
        <div class="cell-row static">
          <span class="cell-label">标签</span>
          <span class="cell-value clamp">{{ tagsText() || '未设置' }}</span>
        </div>
      </section>

      <div class="section-bar">更多信息</div>
      <section class="cell-group">
        <button class="cell-row" type="button" @click="openCommonGroups">
          <span class="cell-label">我和她的共同群聊</span>
          <span class="cell-value">{{ commonGroups }}个</span>
          <span class="cell-arrow"></span>
        </button>
        <div class="cell-row static">
          <span class="cell-label">签名</span>
          <span class="cell-value clamp">{{ signatureText() }}</span>
        </div>
        <div class="cell-row static">
          <span class="cell-label">来源</span>
          <span class="cell-value">{{ sourceText() }}</span>
        </div>
        <div class="cell-row static">
          <span class="cell-label">添加时间</span>
          <span class="cell-value">{{ sinceText() }}</span>
        </div>
      </section>
    </main>

    <div v-if="editField" class="mask" @click.self="editField = ''">
      <div class="dialog">
        <div class="dialog-title">
          {{ editField === 'remark' ? '备注名' : editField === 'phone' ? '电话' : editField === 'memo' ? '备忘' : '编辑' }}
        </div>
        <input v-model="editValue" placeholder="请输入" maxlength="40" />
        <div class="dialog-actions">
          <button type="button" @click="editField = ''">取消</button>
          <button type="button" class="ok" @click="saveEdit">完成</button>
        </div>
      </div>
    </div>

    <div v-if="showPermission" class="mask sheet-mask" @click.self="showPermission = false">
      <div class="sheet">
        <div class="sheet-title">朋友权限</div>
        <button class="sheet-item" type="button" @click="savePermission('all')">聊天、朋友圈、微信运动等</button>
        <button class="sheet-item" type="button" @click="savePermission('chat')">仅聊天</button>
        <button class="sheet-item" type="button" @click="savePermission('hide-moments')">不让他看我</button>
        <button class="sheet-item danger" type="button" @click="savePermission('block')">加入黑名单</button>
        <button class="sheet-item cancel" type="button" @click="showPermission = false">取消</button>
      </div>
    </div>

    <div v-if="showTags" class="mask sheet-mask" @click.self="showTags = false">
      <div class="sheet">
        <div class="sheet-title">标签</div>
        <div v-if="!tagsAll.length" class="sheet-hint">暂无标签，可在通讯录「标签」中创建</div>
        <button
          v-for="t in tagsAll"
          :key="t.id"
          class="sheet-item"
          type="button"
          :class="{ on: pickedTagIds.has(t.id) }"
          @click="toggleTag(t.id)"
        >{{ t.name }}</button>
        <button class="sheet-item ok" type="button" @click="saveTags">完成</button>
        <button class="sheet-item cancel" type="button" @click="showTags = false">取消</button>
      </div>
    </div>

    <div v-if="showPhotos" class="mask sheet-mask" @click.self="showPhotos = false">
      <div class="sheet">
        <div class="sheet-title">照片</div>
        <div class="photo-grid">
          <div v-for="(p, i) in (extras.photos || [])" :key="i" class="photo-cell">
            <img :src="p" alt="照片" />
            <button type="button" class="photo-del" @click="removePhoto(i)">×</button>
          </div>
          <label class="photo-add">
            +
            <input type="file" accept="image/*" hidden @change="addPhoto" />
          </label>
        </div>
        <button class="sheet-item cancel" type="button" @click="showPhotos = false">完成</button>
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
.loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-2);
}
.content { flex: 1; min-height: 0; padding-bottom: 24px; }

.section-bar {
  padding: 12px 16px 8px;
  font-size: 13px;
  color: var(--text-2);
  background: var(--bg);
}
.cell-group { background: var(--white); }
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
.cell-row:not(.static):active { background: var(--press); }
.cell-label {
  flex-shrink: 0;
  font-size: 16px;
  color: var(--text);
}
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
.cell-value.clamp { max-width: 58%; white-space: normal; text-align: right; }
.cell-arrow {
  width: 8px;
  height: 8px;
  border-right: 1.5px solid #c7c7cc;
  border-top: 1.5px solid #c7c7cc;
  transform: rotate(45deg);
  flex-shrink: 0;
  margin-left: 4px;
}

.mask {
  position: fixed;
  inset: 0;
  background: var(--mask);
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sheet-mask { align-items: flex-end; }
.dialog {
  width: min(300px, 86%);
  background: var(--white);
  border-radius: 12px;
  padding: 18px 16px 12px;
}
.dialog-title {
  font-size: 16px;
  font-weight: 600;
  text-align: center;
  margin-bottom: 12px;
  color: var(--text);
}
.dialog input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--divider);
  border-radius: 8px;
  padding: 10px;
  font-size: 15px;
  background: var(--white);
  color: var(--text);
  outline: none;
}
.dialog-actions { display: flex; gap: 10px; margin-top: 14px; }
.dialog-actions button {
  flex: 1;
  min-height: 40px;
  border: 0;
  border-radius: 8px;
  background: var(--divider-soft);
  color: var(--text);
}
.dialog-actions button.ok { background: #07c160; color: #fff; }

.sheet {
  width: 100%;
  background: var(--white);
  border-radius: 12px 12px 0 0;
  padding-bottom: calc(8px + var(--safe-b));
  max-height: 70%;
  overflow: auto;
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
}
.sheet-item.on { color: #07c160; font-weight: 600; }
.sheet-item.ok { color: #07c160; }
.sheet-item.danger { color: var(--red); }
.sheet-item.cancel { color: var(--text-2); border-bottom: 0; margin-top: 6px; border-top: 0.5px solid var(--divider); }
.sheet-hint { padding: 20px 16px; text-align: center; color: var(--text-3); font-size: 13px; }

.photo-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 12px;
}
.photo-cell {
  position: relative;
  aspect-ratio: 1;
  border-radius: 6px;
  overflow: hidden;
  background: var(--divider-soft);
}
.photo-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.photo-del {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 50%;
  background: rgba(0,0,0,0.55);
  color: #fff;
  font-size: 14px;
  line-height: 1;
}
.photo-add {
  aspect-ratio: 1;
  border: 1.5px dashed #c8c8c8;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #b0b0b0;
  font-size: 28px;
  cursor: pointer;
}
</style>
