<script setup>
import { ref } from 'vue';
import { api } from '../api.js';

const emit = defineEmits(['logged-in']);

const username = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');

async function submit() {
  if (busy.value) return;
  error.value = '';
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码';
    return;
  }
  busy.value = true;
  try {
    const r = await api.login(username.value.trim(), password.value);
    emit('logged-in', r);
  } catch (e) {
    error.value = e.message || '登录失败';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <form class="login-card" @submit.prevent="submit">
      <div class="login-logo">🛡️</div>
      <div class="login-title">运营后台</div>
      <div class="login-sub">请使用管理员账号登录</div>

      <div class="field">
        <label>用户名</label>
        <input
          v-model="username"
          class="input"
          type="text"
          autocomplete="username"
          placeholder="管理员用户名"
          autofocus
        />
      </div>
      <div class="field">
        <label>密码</label>
        <input
          v-model="password"
          class="input"
          type="password"
          autocomplete="current-password"
          placeholder="密码"
        />
      </div>

      <p v-if="error" class="hint" style="color:#dc2626;margin-bottom:12px">{{ error }}</p>

      <button type="submit" class="btn primary" style="width:100%;justify-content:center" :disabled="busy">
        {{ busy ? '登录中…' : '登录' }}
      </button>

      <div class="login-foot">后台与用户端登录态相互独立</div>
    </form>
  </div>
</template>
