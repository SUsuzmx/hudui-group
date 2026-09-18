<script setup>
import { ref, onMounted } from 'vue';
import { getAppearance, setAppearance } from '../appearance.js';

const props = defineProps({
  me: { type: Object, required: true },
});
const emit = defineEmits(['back', 'logout']);

const appearance = ref(getAppearance());
const section = ref('root'); // root | appearance | about | notify | chat | account

const bgPresets = [
  { key: 'default', label: '默认', value: null },
  { key: 'gray', label: '浅灰', value: '#e7e7e7' },
  { key: 'blue', label: '淡蓝', value: '#dce9f7' },
  { key: 'green', label: '淡绿', value: '#e3f0e6' },
  { key: 'warm', label: '米色', value: '#f3efe6' },
  { key: 'dark', label: '深灰', value: '#2a2a2a' },
];

const notifyOn = ref(localStorage.getItem('wx_notify') !== '0');
const notifyPerm = ref(typeof Notification !== 'undefined' ? Notification.permission : 'default');
const enterSend = ref(localStorage.getItem('wx_enter_send') !== '0');
const showPreview = ref(localStorage.getItem('wx_show_preview') !== '0');
const themeFollow = ref(localStorage.getItem('wx_theme_follow') !== '0');

function toggleEnterSend() {
  enterSend.value = !enterSend.value;
  localStorage.setItem('wx_enter_send', enterSend.value ? '1' : '0');
}

async function toggleNotify() {
  notifyOn.value = !notifyOn.value;
  localStorage.setItem('wx_notify', notifyOn.value ? '1' : '0');
  if (notifyOn.value && typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try {
      const p = await Notification.requestPermission();
      notifyPerm.value = p;
    } catch { /* ignore */ }
  }
}

function togglePreview() {
  showPreview.value = !showPreview.value;
  localStorage.setItem('wx_show_preview', showPreview.value ? '1' : '0');
}

function toggleThemeFollow() {
  themeFollow.value = !themeFollow.value;
  localStorage.setItem('wx_theme_follow', themeFollow.value ? '1' : '0');
}

function applyPatch(patch) {
  appearance.value = setAppearance(patch);
}

function pickBg(p) {
  const dark = appearance.value.dark;
  const value = p.value || (dark ? '#111111' : '#ededed');
  applyPatch({ chatBg: value });
}

function currentBg() {
  return appearance.value.chatBg || (appearance.value.dark ? '#111111' : '#ededed');
}

onMounted(() => {
  appearance.value = getAppearance();
});
</script>

<template>
  <div class="page">
    <header class="nav-bar">
      <button class="icon-btn nav-back" @click="section === 'root' ? emit('back') : (section = 'root')">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title">{{ section === 'appearance' ? '聊天背景与显示' : section === 'about' ? '关于' : '设置' }}</div>
      <div class="nav-right"></div>
    </header>

    <main v-if="section === 'root'" class="content scroll-y">
      <section class="card">
        <div class="row">
          <span class="label">账号</span>
          <span class="value">{{ me.nickname }}</span>
        </div>
      </section>
      <section class="card">
        <button class="row" @click="section = 'account'">
          <span class="label">账号与安全</span>
          <span class="arrow">›</span>
        </button>
        <button class="row" @click="section = 'notify'">
          <span class="label">新消息通知</span>
          <span class="arrow">›</span>
        </button>
        <button class="row" @click="section = 'chat'">
          <span class="label">聊天</span>
          <span class="arrow">›</span>
        </button>
        <button class="row" @click="section = 'appearance'">
          <span class="label">通用 / 显示</span>
          <span class="arrow">›</span>
        </button>
        <button class="row" @click="section = 'about'">
          <span class="label">关于</span>
          <span class="arrow">›</span>
        </button>
      </section>
      <section class="card">
        <button class="row center danger" @click="emit('logout')">
          <span class="label">退出登录</span>
        </button>
      </section>
    </main>

    <main v-else-if="section === 'notify'" class="content scroll-y">
      <section class="card">
        <div class="row">
          <span class="label">接收新消息通知</span>
          <button class="switch" :class="{ on: notifyOn }" @click="toggleNotify"></button>
        </div>
        <div class="row">
          <span class="label">系统权限</span>
          <span class="value">{{ notifyPerm === 'granted' ? '已允许' : notifyPerm === 'denied' ? '已拒绝' : '未请求' }}</span>
        </div>
      </section>
      <p class="hint">开启后，后台收到消息可尝试系统通知（需浏览器权限）。</p>
    </main>

    <main v-else-if="section === 'chat'" class="content scroll-y">
      <section class="card">
        <button class="row" @click="section = 'appearance'">
          <span class="label">聊天背景</span>
          <span class="value">去设置</span>
          <span class="arrow">›</span>
        </button>
        <div class="row">
          <span class="label">回车发送</span>
          <button class="switch" :class="{ on: enterSend }" @click="toggleEnterSend"></button>
        </div>
        <div class="row">
          <span class="label">消息预览</span>
          <button class="switch" :class="{ on: showPreview }" @click="togglePreview"></button>
        </div>
        <div class="row">
          <span class="label">拍一拍</span>
          <span class="value">双击头像</span>
        </div>
      </section>
    </main>

    <main v-else-if="section === 'account'" class="content scroll-y">
      <section class="card">
        <div class="row"><span class="label">微信号</span><span class="value">{{ me.wxid || '未设置' }}</span></div>
        <div class="row"><span class="label">昵称</span><span class="value">{{ me.nickname }}</span></div>
        <div class="row"><span class="label">地区</span><span class="value">{{ me.region || '未设置' }}</span></div>
      </section>
      <p class="hint">可在「我」页修改头像、昵称、微信号等资料。</p>
    </main>

    <main v-else-if="section === 'appearance'" class="content scroll-y">
      <section class="card">
        <div class="row">
          <span class="label">深色模式</span>
          <button
            class="switch"
            :class="{ on: appearance.dark }"
            @click="applyPatch({ dark: !appearance.dark, chatBg: !appearance.dark ? '#111111' : '#ededed' })"
          ></button>
        </div>
        <div class="row">
          <span class="label">跟随系统外观</span>
          <button class="switch" :class="{ on: themeFollow }" @click="toggleThemeFollow"></button>
        </div>
        <div class="row col">
          <div class="row-head">
            <span class="label">字体大小</span>
            <span class="value">{{ Math.round((appearance.fontScale || 1) * 100) }}%</span>
          </div>
          <input
            class="range"
            type="range"
            min="0.9"
            max="1.3"
            step="0.05"
            :value="appearance.fontScale || 1"
            @input="applyPatch({ fontScale: Number($event.target.value) })"
          />
        </div>
      </section>

      <section class="card">
        <div class="row"><span class="label">聊天背景</span></div>
        <div class="bg-grid">
          <button
            v-for="p in bgPresets"
            :key="p.key"
            class="bg-item"
            :class="{ active: currentBg() === (p.value || (appearance.dark ? '#111111' : '#ededed')) }"
            :style="{ background: p.value || (appearance.dark ? '#111111' : '#ededed') }"
            @click="pickBg(p)"
          >
            <span class="bg-label">{{ p.label }}</span>
          </button>
        </div>
      </section>
    </main>

    <main v-else class="content scroll-y">
      <section class="card">
        <div class="row"><span class="label">当前版本</span><span class="value">1.0.0</span></div>
        <div class="row"><span class="label">产品</span><span class="value">WeChat 克隆演示</span></div>
      </section>
    </main>
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
.nav-bar {
  height: var(--nav-h);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background: var(--bg);
  border-bottom: 0.5px solid var(--divider);
  padding: 0 8px;
}
.nav-back { position: absolute; left: 0; top: 0; bottom: 0; margin: auto 0; }
.nav-right { width: 44px; }
.nav-title { font-size: 17px; font-weight: 600; }

.content { flex: 1; min-height: 0; padding-bottom: 24px; }
.card { background: var(--white); margin-top: 10px; }
.row {
  width: 100%;
  display: flex;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 0.5px solid var(--divider-soft);
  background: var(--white);
  text-align: left;
  min-height: 52px;
}
.row:last-child { border-bottom: none; }
.row.col { display: block; }
.row-head { display: flex; align-items: center; margin-bottom: 8px; }
.row.center { justify-content: center; }
.row.danger .label { color: var(--red); width: auto; }
.label { flex: 1; font-size: 16px; color: var(--text); }
.value { font-size: 15px; color: var(--text-2); margin-right: 6px; }
.arrow { color: #c0c0c0; font-size: 18px; }

.switch {
  width: 44px;
  height: 26px;
  border-radius: 13px;
  background: #e5e5e5;
  position: relative;
  flex-shrink: 0;
  transition: background 160ms ease;
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

.range { width: 100%; accent-color: #07c160; }

.bg-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  padding: 12px 16px 16px;
}
.bg-item {
  height: 72px;
  border-radius: 8px;
  border: 2px solid transparent;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 6px;
}
.bg-item.active { border-color: #07c160; }
.bg-label {
  font-size: 12px;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.35);
}
.hint {
  padding: 12px 16px;
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.5;
}
</style>
