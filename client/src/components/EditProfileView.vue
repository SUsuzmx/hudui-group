<script setup>
import { ref, onMounted } from 'vue';
import { api, compressImage } from '../api.js';
import { toast } from '../toast.js';
import UserAvatar from './UserAvatar.vue';

const props = defineProps({
  me: { type: Object, required: true },
});
const emit = defineEmits(['back', 'updated']);

const nickname = ref(props.me.nickname || '');
const wxid = ref(props.me.wxid || '');
const region = ref(props.me.region || '');
const signature = ref(props.me.signature || '');
const avatar = ref(props.me.avatar || null);
const gender = ref(props.me.gender || '');
const avatarList = ref([]);
const showAvatarPicker = ref(false);
const saving = ref(false);
const error = ref('');

onMounted(async () => {
  try {
    const { avatars } = await api.avatars();
    avatarList.value = avatars;
  } catch { /* ignore */ }
});

async function save() {
  if (saving.value) return;
  error.value = '';
  saving.value = true;
  try {
    const { user } = await api.updateMe({
      nickname: nickname.value.trim(),
      avatar: avatar.value ?? '',
      wxid: wxid.value.trim(),
      region: region.value.trim(),
      signature: signature.value.trim(),
      gender: gender.value,
    });
    emit('updated', user);
    toast('资料已保存');
    emit('back');
  } catch (e) {
    error.value = e.message;
    toast(e.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

function pickAvatarFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  api.uploadMomentImage(file).then((d) => {
    if (d?.url) {
      avatar.value = d.url;
      toast('头像已更新，点右上角完成保存');
    }
  }).catch((err) => {
    toast(err.message || '上传失败');
    showAvatarPicker.value = true;
  });
}
</script>

<template>
  <div class="page">
    <header class="nav">
      <button class="nav-back" type="button" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 4.5L7.5 12 15 19.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title">个人信息</div>
      <button class="nav-save" :disabled="saving" type="button" @click="save">{{ saving ? '…' : '完成' }}</button>
    </header>

    <main class="content">
      <section class="card">
        <button class="row" type="button" @click="showAvatarPicker = true">
          <span class="label">头像</span>
          <UserAvatar :name="nickname" :avatar="avatar" :color="me.avatarColor" :size="56" />
          <span class="arrow">›</span>
        </button>
        <label class="row file-row">
          <span class="label">上传新头像</span>
          <span class="value">支持 jpg/png</span>
          <span class="arrow">›</span>
          <input type="file" accept="image/*" hidden @change="pickAvatarFile" />
        </label>
        <button class="row" type="button" @click="showAvatarPicker = true">
          <span class="label">更换预置头像</span>
          <span class="arrow">›</span>
        </button>
        <div class="row">
          <span class="label">名字</span>
          <input v-model="nickname" maxlength="16" placeholder="昵称" />
        </div>
        <div class="row">
          <span class="label">微信号</span>
          <input v-model="wxid" maxlength="20" placeholder="微信号" />
        </div>
        <div class="row">
          <span class="label">我的地址</span>
          <span class="value muted">未设置</span>
          <span class="arrow">›</span>
        </div>
      </section>

      <section class="card">
        <div class="row">
          <span class="label">性别</span>
          <div class="gender-pick">
            <button type="button" :class="{ on: gender === 'male' }" @click="gender = gender === 'male' ? '' : 'male'">男</button>
            <button type="button" :class="{ on: gender === 'female' }" @click="gender = gender === 'female' ? '' : 'female'">女</button>
            <button type="button" :class="{ on: !gender }" @click="gender = ''">保密</button>
          </div>
        </div>
        <div class="row">
          <span class="label">地区</span>
          <input v-model="region" maxlength="30" placeholder="地区" />
        </div>
        <div class="row col">
          <span class="label">个性签名</span>
          <textarea v-model="signature" maxlength="60" rows="3" placeholder="设置个性签名"></textarea>
        </div>
      </section>

      <p v-if="error" class="error">{{ error }}</p>
      <p class="hint">修改后点右上角「完成」保存到服务器</p>
    </main>

    <div v-if="showAvatarPicker" class="mask" @click.self="showAvatarPicker = false">
      <div class="avatar-sheet">
        <div class="sheet-title">选择头像</div>
        <div class="avatar-grid">
          <button
            v-for="a in avatarList"
            :key="a"
            type="button"
            class="avatar-cell"
            :class="{ on: avatar === a }"
            @click="avatar = a; showAvatarPicker = false"
          >
            <img :src="`/avatars/${encodeURIComponent(a)}`" :alt="a" />
          </button>
        </div>
        <button type="button" class="sheet-close" @click="showAvatarPicker = false">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--bg); width: 100%; }
.nav {
  height: var(--nav-h); flex-shrink: 0; position: relative;
  display: flex; align-items: center; padding: 0 4px; background: var(--bg);
  border-bottom: 0.5px solid var(--divider);
}
.nav-back { width: 44px; height: 44px; border: 0; background: transparent; color: var(--text); display: flex; align-items: center; justify-content: center; }
.nav-title { position: absolute; left: 50%; transform: translateX(-50%); font-size: 17px; font-weight: 600; color: var(--text); }
.nav-save {
  margin-left: auto; border: 0; background: transparent; color: var(--green);
  font-size: 15px; min-height: 44px; padding: 0 12px;
}
.nav-save:disabled { opacity: 0.5; }
.content { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 24px; }
.card { background: var(--white); margin-top: 10px; }
.row {
  width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  border-bottom: 0.5px solid var(--divider-soft); background: var(--white);
  text-align: left; min-height: 56px; position: relative; border-left: 0; border-right: 0; border-top: 0;
}
.row:last-child { border-bottom: none; }
.row.col { display: block; }
.label { flex: 1; font-size: 16px; color: var(--text); }
.row.col .label { display: block; margin-bottom: 8px; }
.value { font-size: 15px; color: var(--text-2); }
.value.muted { color: var(--text-3); }
.arrow { color: #c7c7cc; font-size: 18px; }
.row input, .row textarea {
  flex: 1; border: 0; outline: none; background: transparent;
  font-size: 16px; color: var(--text); text-align: right; resize: none;
}
.row.col textarea { text-align: left; width: 100%; font-size: 15px; }
.qr-box { width: 28px; height: 28px; color: var(--text-2); display: flex; align-items: center; justify-content: center; }
.gender-pick { display: flex; gap: 8px; margin-left: auto; }
.gender-pick button {
  min-width: 52px; min-height: 32px; border-radius: 16px; border: 1px solid var(--divider);
  background: var(--white); color: var(--text-2); font-size: 13px;
}
.gender-pick button.on { background: #07c160; border-color: #07c160; color: #fff; }
.error { padding: 8px 16px; color: var(--red); font-size: 13px; }
.hint { padding: 12px 16px; font-size: 12px; color: var(--text-3); }
.mask { position: fixed; inset: 0; background: var(--mask); z-index: 80; display: flex; align-items: flex-end; }
.avatar-sheet {
  width: 100%; max-height: 70%; background: var(--white); border-radius: 12px 12px 0 0;
  display: flex; flex-direction: column; padding-bottom: calc(12px + var(--safe-b));
}
.sheet-title { padding: 14px 16px; font-size: 16px; font-weight: 600; text-align: center; color: var(--text); border-bottom: 0.5px solid var(--divider); }
.avatar-grid { flex: 1; overflow: auto; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding: 14px; }
.avatar-cell {
  border: 2px solid transparent; border-radius: 8px; overflow: hidden; padding: 0; background: var(--divider-soft);
  aspect-ratio: 1;
}
.avatar-cell.on { border-color: #07c160; }
.avatar-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sheet-close {
  margin: 8px 16px 0; min-height: 44px; border: 0; border-radius: 8px;
  background: var(--divider-soft); color: var(--text); font-size: 15px;
}
</style>
