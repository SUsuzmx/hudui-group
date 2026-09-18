<script setup>
import { ref } from 'vue';
import { api } from '../api.js';

const emit = defineEmits(['authed']);

const step = ref('account'); // account | code | avatar
const mode = ref('login');
const phone = ref('');
const code = ref('');
const nickname = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);
const codeSent = ref(false);
const codeCountdown = ref(0);
const avatarList = ref([]);
const chosenAvatar = ref(null);
let timer = null;

function validPhone(p) {
  return /^1\d{10}$/.test(p);
}

async function sendCode() {
  error.value = '';
  if (!validPhone(phone.value)) {
    error.value = '请输入 11 位手机号';
    return;
  }
  // 演示环境固定验证码
  codeSent.value = true;
  code.value = '123456';
  codeCountdown.value = 60;
  clearInterval(timer);
  timer = setInterval(() => {
    codeCountdown.value -= 1;
    if (codeCountdown.value <= 0) {
      clearInterval(timer);
      codeCountdown.value = 0;
    }
  }, 1000);
}

async function submitAccount() {
  if (loading.value) return;
  error.value = '';
  if (!validPhone(phone.value)) {
    error.value = '请输入 11 位手机号';
    return;
  }
  if (mode.value === 'register' && code.value !== '123456') {
    error.value = '验证码不正确（演示为 123456）';
    return;
  }
  const minPwd = mode.value === 'register' ? 6 : 4;
  if (!password.value || password.value.length < minPwd) {
    error.value = mode.value === 'register' ? '密码至少 6 位' : '密码至少 4 位';
    return;
  }
  loading.value = true;
  try {
    if (mode.value === 'register') {
      const { avatars } = await api.avatars();
      avatarList.value = avatars;
      // 手机号作默认昵称前缀
      if (!nickname.value.trim()) {
        nickname.value = '微信用户' + phone.value.slice(-4);
      }
      step.value = 'avatar';
      loading.value = false;
      return;
    }
    // 登录: 用手机号作为昵称尝试, 或已有昵称
    const name = nickname.value.trim() || ('微信用户' + phone.value.slice(-4));
    emit('authed', await api.login(name, password.value));
  } catch (e) {
    error.value = e.message;
    loading.value = false;
  }
}

async function submitRegister() {
  if (loading.value) return;
  if (!nickname.value.trim()) {
    error.value = '请填写昵称';
    return;
  }
  loading.value = true;
  try {
    emit('authed', await api.register(nickname.value.trim(), password.value, chosenAvatar.value));
  } catch (e) {
    error.value = e.message;
    step.value = 'account';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="logo">
      <div class="logo-bubble">💬</div>
      <h1>WeChat</h1>
      <p>连接你我，分享生活</p>
    </div>

    <form v-if="step === 'account'" class="form" @submit.prevent="submitAccount">
      <div class="field phone-field">
        <span class="prefix">+86</span>
        <input
          v-model="phone"
          type="tel"
          placeholder="手机号"
          maxlength="11"
          autocomplete="tel"
        />
      </div>
      <div v-if="mode === 'register'" class="field code-field">
        <input v-model="code" placeholder="验证码" maxlength="6" inputmode="numeric" />
        <button type="button" class="code-btn" :disabled="codeCountdown > 0" @click="sendCode">
          {{ codeCountdown > 0 ? `${codeCountdown}s` : codeSent ? '重新获取' : '获取验证码' }}
        </button>
      </div>
      <div class="field">
        <input v-model="nickname" placeholder="昵称（登录用，可选）" maxlength="16" autocomplete="username" />
      </div>
      <div class="field">
        <input v-model="password" type="password" placeholder="密码" maxlength="64" autocomplete="current-password" />
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <button class="submit" type="submit" :disabled="loading">
        {{ loading ? '请稍候…' : mode === 'login' ? '登录' : '下一步: 选头像' }}
      </button>
      <button
        class="switch"
        type="button"
        @click="mode = mode === 'login' ? 'register' : 'login'; error = ''; codeSent = false"
      >
        {{ mode === 'login' ? '用手机号注册' : '已有账号？直接登录' }}
      </button>
      <p class="demo-tip">演示环境验证码固定为 123456</p>
    </form>

    <form v-else class="form avatar-step" @submit.prevent="submitRegister">
      <h2 class="step-title">选一个头像</h2>
      <p class="step-sub">{{ phone }} · {{ nickname }}</p>
      <div class="avatar-grid">
        <button
          type="button"
          class="avatar-cell default"
          :class="{ picked: chosenAvatar === null }"
          @click="chosenAvatar = null"
        >{{ nickname.trim().slice(0, 1) || '我' }}</button>
        <button
          v-for="a in avatarList"
          :key="a.file"
          type="button"
          class="avatar-cell"
          :class="{ picked: chosenAvatar === a.file }"
          @click="chosenAvatar = a.file"
        ><img :src="a.url" :alt="a.file" loading="lazy" /></button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <button class="submit" type="submit" :disabled="loading">
        {{ loading ? '注册中…' : '注册并进入' }}
      </button>
      <button class="switch" type="button" @click="step = 'account'; error = ''">上一步</button>
    </form>
  </div>
</template>

<style scoped>
.login-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 32px;
  background: var(--bg);
  overflow-y: auto;
  width: 100%;
}

.logo {
  margin-top: 10vh;
  text-align: center;
}
.logo-bubble {
  width: 72px;
  height: 72px;
  margin: 0 auto 14px;
  border-radius: 18px;
  background: #07c160;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  color: #fff;
}
.logo h1 {
  font-size: 22px;
  color: var(--text);
  letter-spacing: 1px;
}
.logo p {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-2);
}

.form {
  width: 100%;
  margin-top: 36px;
  padding-bottom: 24px;
}
.field {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
  background: var(--white);
  border-radius: 8px;
  min-height: 48px;
  padding: 0 14px;
  gap: 8px;
}
.prefix {
  font-size: 16px;
  color: var(--text-2);
  flex-shrink: 0;
}
.field input {
  flex: 1;
  min-width: 0;
  height: 48px;
  font-size: 16px;
  color: var(--text);
  background: transparent;
}
.field input::placeholder { color: var(--text-3); }
.code-btn {
  flex-shrink: 0;
  color: #07c160;
  font-size: 14px;
  min-height: 36px;
  padding: 0 4px;
}
.code-btn:disabled { color: var(--text-3); }

.error {
  color: var(--red);
  font-size: 13px;
  margin: 4px 0 8px;
}
.submit {
  width: 100%;
  height: 48px;
  border-radius: 8px;
  background: #07c160;
  color: #fff;
  font-size: 17px;
  font-weight: 500;
  margin-top: 8px;
}
.submit:disabled { opacity: 0.6; }
.switch {
  width: 100%;
  color: #576b95;
  font-size: 14px;
  margin-top: 18px;
  min-height: 44px;
}
.demo-tip {
  margin-top: 12px;
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
}

.step-title { font-size: 18px; color: var(--text); text-align: center; }
.step-sub { font-size: 13px; color: var(--text-2); text-align: center; margin: 8px 0 16px; }
.avatar-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  margin-bottom: 8px;
}
.avatar-cell {
  width: 60px;
  height: 60px;
  border-radius: 10px;
  background: var(--white);
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
