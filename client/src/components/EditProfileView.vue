<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
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
    });
    emit('updated', user);
    emit('back');
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page">
    <header class="nav">
      <button class="nav-back" @click="emit('back')">‹</button>
      <div class="nav-title">个人信息</div>
      <button class="nav-save" :disabled="saving" @click="save">{{ saving ? '…' : '完成' }}</button>
    </header>

    <main class="content">
      <section class="card">
        <div class="row avatar-row" @click="showAvatarPicker = true">
          <span class="label">头像</span>
          <UserAvatar :name="nickname" :avatar="avatar" :color="me.avatarColor" :size="56" />
          <span class="arrow">›</span>
        </div>
        <div class="row">
          <span class="label">名字</span>
          <input v-model="nickname" maxlength="16" placeholder="昵称" />
        </div>
        <div class="row">
          <span class="label">微信号</span>
          <input v-model="wxid" maxlength="20" placeholder="微信号" />
        </div>
        <div class="row">
          <span class="label">地区</span>
          <input v-model="region" maxlength="30" placeholder="地区" />
        </div>
      </section>

      <section class="card">
        <div class="row col">
          <span class="label">个性签名</span>
          <textarea v-model="signature" maxlength="60" placeholder="未设置" rows="3"></textarea>
        </div>
      </section>

      <p v-if="error" class="error">{{ error }}</p>
    </main>

    <!-- 头像选择 -->
    <div v-if="showAvatarPicker" class="mask" @click.self="showAvatarPicker = false">
      <div class="picker">
        <div class="picker-bar">
          <button @click="showAvatarPicker = false">取消</button>
          <span>选择头像</span>
          <button class="ok" @click="showAvatarPicker = false">完成</button>
        </div>
        <div class="avatar-grid">
          <button
            type="button"
            class="avatar-cell default"
            :class="{ picked: !avatar }"
            @click="avatar = null"
          >{{ (nickname || '我').slice(0, 1) }}</button>
          <button
            v-for="a in avatarList"
            :key="a.file"
            type="button"
            class="avatar-cell"
            :class="{ picked: avatar === a.file }"
            @click="avatar = a.file"
          ><img :src="a.url" :alt="a.file" /></button>
        </div>
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
  width: 48px;
  background: none;
  font-size: 30px;
  color: #111;
  line-height: 1;
  padding-bottom: 4px;
  margin-left: -8px;
  text-align: left;
}
.nav-title {
  flex: 1;
  text-align: center;
  font-size: 17px;
  font-weight: 500;
}
.nav-save {
  width: 48px;
  background: none;
  color: #07c160;
  font-size: 15px;
  text-align: right;
}
.nav-save:disabled { color: #b2b2b2; }

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
.row {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid #f0f0f0;
  gap: 12px;
}
.row:last-child { border-bottom: none; }
.row.col {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
.label {
  width: 72px;
  font-size: 16px;
  color: #111;
  flex-shrink: 0;
}
.row.col .label { width: auto; }
.row input {
  flex: 1;
  border: none;
  font-size: 16px;
  color: #111;
  text-align: right;
  background: transparent;
}
.row.col textarea {
  border: none;
  font-size: 15px;
  color: #111;
  resize: none;
  line-height: 1.45;
  background: transparent;
}
.arrow { color: #c0c0c0; font-size: 18px; }
.avatar-row { cursor: pointer; }
.error {
  color: #fa5151;
  font-size: 13px;
  padding: 12px 16px;
}

.mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  z-index: 50;
  display: flex;
  align-items: flex-end;
}
.picker {
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  background: #fff;
  border-radius: 12px 12px 0 0;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom);
}
.picker-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 15px;
}
.picker-bar button {
  background: none;
  color: #666;
  min-width: 48px;
  text-align: left;
}
.picker-bar button.ok {
  color: #07c160;
  text-align: right;
  font-weight: 500;
}
.avatar-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
  justify-content: center;
}
.avatar-cell {
  width: 64px;
  height: 64px;
  border-radius: 10px;
  background: #fff;
  border: 3px solid transparent;
  overflow: hidden;
  padding: 0;
  font-size: 22px;
  color: #fff;
}
.avatar-cell.default { background: #07c160; }
.avatar-cell.picked { border-color: #07c160; }
.avatar-cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
