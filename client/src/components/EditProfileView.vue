<script setup>
import { ref, onMounted } from 'vue';
import { api, compressImage } from '../api.js';
import { toast } from '../toast.js';
import UserAvatar from './UserAvatar.vue';
import { loadProfileExtras, saveProfileExtras, maskPhone } from '../profile-extras.js';

const props = defineProps({
  me: { type: Object, required: true },
});
const emit = defineEmits(['back', 'updated', 'open-view']);

const profile = ref({
  nickname: props.me.nickname || '',
  avatar: props.me.avatar || null,
  avatarColor: props.me.avatarColor || '#4f6ef7',
  gender: props.me.gender || '',
  region: props.me.region || '',
  wxid: props.me.wxid || '',
  signature: props.me.signature || '',
});
const extras = ref(loadProfileExtras(props.me.id));
const avatarList = ref([]);
const showPicker = ref(false);
const pickerType = ref('');
const editField = ref('');
const editValue = ref('');
const saving = ref(false);

const genderText = () => {
  if (profile.value.gender === 'male') return '男';
  if (profile.value.gender === 'female') return '女';
  return '';
};

const phoneText = () => (extras.value.phone ? maskPhone(extras.value.phone) : '');
const patText = () => {
  const p = extras.value.pat || '';
  return p ? `说：“${p}”` : '';
};

onMounted(async () => {
  try {
    const { user } = await api.me();
    if (user) {
      profile.value = { ...profile.value, ...user, avatarColor: user.avatarColor || profile.value.avatarColor };
      emit('updated', user);
    }
  } catch { /* ignore */ }
  try {
    const { avatars } = await api.avatars();
    avatarList.value = avatars || [];
  } catch { avatarList.value = []; }
});

async function persistMe(patch) {
  if (saving.value) return null;
  saving.value = true;
  try {
    const { user } = await api.updateMe(patch);
    profile.value = { ...profile.value, ...user };
    emit('updated', user);
    return user;
  } catch (e) {
    toast(e.message || '保存失败');
    return null;
  } finally {
    saving.value = false;
  }
}

function openEdit(field) {
  editField.value = field;
  if (field === 'nickname') editValue.value = profile.value.nickname || '';
  else if (field === 'region') editValue.value = profile.value.region || '';
  else if (field === 'wxid') editValue.value = profile.value.wxid || '';
  else if (field === 'signature') editValue.value = profile.value.signature || '';
  else if (field === 'phone') editValue.value = extras.value.phone || '';
  else if (field === 'pat') editValue.value = extras.value.pat || '';
  else if (field === 'ringtone') editValue.value = extras.value.ringtone || '';
  else if (field === 'address') editValue.value = extras.value.address || '';
  else if (field === 'invoiceTitle') editValue.value = extras.value.invoiceTitle || '';
  else if (field === 'wechatBeans') editValue.value = String(extras.value.wechatBeans ?? 0);
  else editValue.value = '';
}

async function saveEdit() {
  const field = editField.value;
  const val = String(editValue.value || '').trim();
  if (field === 'nickname') {
    const user = await persistMe({ nickname: val });
    if (user) editField.value = '';
    return;
  }
  if (field === 'region') {
    const user = await persistMe({ region: val });
    if (user) editField.value = '';
    return;
  }
  if (field === 'wxid') {
    const user = await persistMe({ wxid: val });
    if (user) editField.value = '';
    return;
  }
  if (field === 'signature') {
    const user = await persistMe({ signature: val });
    if (user) editField.value = '';
    return;
  }
  if (field === 'phone' || field === 'pat' || field === 'ringtone' || field === 'address' || field === 'invoiceTitle' || field === 'wechatBeans') {
    const patch = field === 'wechatBeans'
      ? { wechatBeans: Number(val) || 0 }
      : { [field]: val };
    extras.value = saveProfileExtras(props.me.id, patch);
    editField.value = '';
    toast('已保存');
    return;
  }
  editField.value = '';
}

function openGender() {
  pickerType.value = 'gender';
  showPicker.value = true;
}

async function pickGender(g) {
  showPicker.value = false;
  await persistMe({ gender: g });
}

function openAvatar() {
  pickerType.value = 'avatar';
  showPicker.value = true;
}

async function pickAvatar(a) {
  showPicker.value = false;
  await persistMe({ avatar: a });
}

async function onUploadAvatar(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = await compressImage(file, 800, 0.85);
    const { url } = await api.uploadMomentImage(data);
    if (!url) throw new Error('上传失败');
    await persistMe({ avatar: url });
  } catch (err) {
    toast(err.message || '上传失败');
  }
}

function onRow(key) {
  if (key === 'avatar') { openAvatar(); return; }
  if (key === 'gender') { openGender(); return; }
  if (key === 'wxid') { openEdit('wxid'); return; }
  if (key === 'qrcode') {
    emit('open-view', { type: 'qrcode' });
    return;
  }
  if (key === 'address') { openEdit('address'); return; }
  if (key === 'invoiceTitle') { openEdit('invoiceTitle'); return; }
  if (key === 'wechatBeans') { openEdit('wechatBeans'); return; }
  if (key === 'ringtone') { openEdit('ringtone'); return; }
  if (key === 'pat') { openEdit('pat'); return; }
  if (key === 'signature') { openEdit('signature'); return; }
  if (key === 'region') { openEdit('region'); return; }
  if (key === 'phone') { openEdit('phone'); return; }
  if (key === 'nickname') { openEdit('nickname'); return; }
}
</script>

<template>
  <div class="page">
    <header class="nav">
      <button class="nav-back" type="button" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title">个人资料</div>
      <div class="nav-right"></div>
    </header>

    <main class="content scroll-y">
      <section class="cell-group">
        <button class="cell-row" type="button" @click="onRow('avatar')">
          <span class="cell-label">头像</span>
          <UserAvatar
            class="cell-avatar"
            :name="profile.nickname"
            :avatar="profile.avatar"
            :color="profile.avatarColor"
            :size="48"
          />
          <span class="cell-arrow"></span>
        </button>
        <button class="cell-row" type="button" @click="onRow('nickname')">
          <span class="cell-label">名字</span>
          <span class="cell-value">{{ profile.nickname || '未设置' }}</span>
          <span class="cell-arrow"></span>
        </button>
        <button class="cell-row" type="button" @click="onRow('gender')">
          <span class="cell-label">性别</span>
          <span class="cell-value">{{ genderText() || '未设置' }}</span>
          <span class="cell-arrow"></span>
        </button>
        <button class="cell-row" type="button" @click="onRow('region')">
          <span class="cell-label">地区</span>
          <span class="cell-value">{{ profile.region || '未设置' }}</span>
          <span class="cell-arrow"></span>
        </button>
        <button class="cell-row" type="button" @click="onRow('phone')">
          <span class="cell-label">手机号</span>
          <span class="cell-value">{{ phoneText() || '未设置' }}</span>
          <span class="cell-arrow"></span>
        </button>
        <button class="cell-row" type="button" @click="onRow('wxid')">
          <span class="cell-label">微信号</span>
          <span class="cell-value">{{ profile.wxid || '未设置' }}</span>
          <span class="cell-arrow"></span>
        </button>
        <button class="cell-row" type="button" @click="onRow('qrcode')">
          <span class="cell-label">我的二维码</span>
          <span class="qr-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6">
              <rect x="4" y="4" width="6" height="6" rx="1"/>
              <rect x="14" y="4" width="6" height="6" rx="1"/>
              <rect x="4" y="14" width="6" height="6" rx="1"/>
              <path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" fill="currentColor" stroke="none"/>
            </svg>
          </span>
          <span class="cell-arrow"></span>
        </button>
        <button class="cell-row" type="button" @click="onRow('pat')">
          <span class="cell-label">拍一拍</span>
          <span class="cell-value">{{ patText() || '设置拍一拍文案' }}</span>
          <span class="cell-arrow"></span>
        </button>
        <button class="cell-row" type="button" @click="onRow('signature')">
          <span class="cell-label">签名</span>
          <span class="cell-value clamp">{{ profile.signature || '未设置' }}</span>
          <span class="cell-arrow"></span>
        </button>
      </section>

      <section class="cell-group">
        <button class="cell-row" type="button" @click="onRow('ringtone')">
          <span class="cell-label">来电铃声</span>
          <span class="cell-value">{{ extras.ringtone || '默认铃声' }}</span>
          <span class="cell-arrow"></span>
        </button>
      </section>

      <section class="cell-group">
        <button class="cell-row" type="button" @click="onRow('address')">
          <span class="cell-label">我的地址</span>
          <span class="cell-value">{{ extras.address || '' }}</span>
          <span class="cell-arrow"></span>
        </button>
        <button class="cell-row" type="button" @click="onRow('invoiceTitle')">
          <span class="cell-label">我的发票抬头</span>
          <span class="cell-value">{{ extras.invoiceTitle || '' }}</span>
          <span class="cell-arrow"></span>
        </button>
      </section>

      <section class="cell-group">
        <button class="cell-row" type="button" @click="onRow('wechatBeans')">
          <span class="cell-label">微信豆</span>
          <span class="cell-value">{{ extras.wechatBeans || 0 }}</span>
          <span class="cell-arrow"></span>
        </button>
      </section>
    </main>

    <!-- 编辑弹层 -->
    <div v-if="editField" class="mask" @click.self="editField = ''">
      <div class="dialog">
        <div class="dialog-title">
          {{
            editField === 'nickname' ? '名字'
              : editField === 'region' ? '地区'
                : editField === 'wxid' ? '微信号'
                  : editField === 'signature' ? '签名'
                    : editField === 'phone' ? '手机号'
                      : editField === 'pat' ? '拍一拍'
                        : editField === 'ringtone' ? '来电铃声'
                          : editField === 'address' ? '我的地址'
                            : editField === 'invoiceTitle' ? '我的发票抬头'
                              : editField === 'wechatBeans' ? '微信豆' : '编辑'
          }}
        </div>
        <input
          v-model="editValue"
          :placeholder="editField === 'pat' ? '例如：哎呦，不错哦' : '请输入'"
          :maxlength="editField === 'signature' ? 60 : 40"
        />
        <div class="dialog-actions">
          <button type="button" @click="editField = ''">取消</button>
          <button type="button" class="ok" @click="saveEdit">完成</button>
        </div>
      </div>
    </div>

    <!-- 选择器 -->
    <div v-if="showPicker" class="mask sheet-mask" @click.self="showPicker = false">
      <div class="sheet">
        <div class="sheet-title">{{ pickerType === 'gender' ? '性别' : '头像' }}</div>
        <template v-if="pickerType === 'gender'">
          <button class="sheet-item" type="button" @click="pickGender('male')">男</button>
          <button class="sheet-item" type="button" @click="pickGender('female')">女</button>
          <button class="sheet-item" type="button" @click="pickGender('')">保密</button>
        </template>
        <template v-else>
          <label class="sheet-item">
            上传新头像
            <input type="file" accept="image/*" hidden @change="onUploadAvatar" />
          </label>
          <div class="avatar-grid">
            <button
              v-for="a in avatarList"
              :key="a"
              type="button"
              class="avatar-cell"
              :class="{ on: profile.avatar === a }"
              @click="pickAvatar(a)"
            >
              <img :src="`/avatars/${encodeURIComponent(a)}`" :alt="a" />
            </button>
          </div>
        </template>
        <button class="sheet-item cancel" type="button" @click="showPicker = false">取消</button>
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
.cell-group:first-child { margin-top: 0; }
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
.cell-value.clamp { max-width: 55%; }
.cell-avatar {
  margin-left: auto;
  border-radius: 6px !important;
}
.qr-ico {
  margin-left: auto;
  color: var(--text-2);
  display: flex;
  align-items: center;
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
.dialog-actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
.dialog-actions button {
  flex: 1;
  min-height: 40px;
  border: 0;
  border-radius: 8px;
  background: var(--divider-soft);
  color: var(--text);
}
.dialog-actions button.ok {
  background: #07c160;
  color: #fff;
}
.sheet {
  width: 100%;
  background: var(--white);
  border-radius: 12px 12px 0 0;
  padding-bottom: calc(8px + var(--safe-b));
  max-height: 75%;
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
  text-align: center;
}
.sheet-item.cancel { color: var(--text-2); border-bottom: 0; margin-top: 8px; border-top: 0.5px solid var(--divider); }
.avatar-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  padding: 14px;
}
.avatar-cell {
  border: 2px solid transparent;
  border-radius: 8px;
  overflow: hidden;
  padding: 0;
  aspect-ratio: 1;
  background: var(--divider-soft);
}
.avatar-cell.on { border-color: #07c160; }
.avatar-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
