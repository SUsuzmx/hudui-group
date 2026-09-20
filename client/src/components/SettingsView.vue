<script setup>
import { ref, onMounted } from 'vue';
import { getAppearance, setAppearance, toggleDark } from '../appearance.js';
import { api } from '../api.js';
import { toast } from '../toast.js';

onMounted(async () => {
  try {
    const d = await api.settings();
    const s = d?.settings || {};
    if (Object.keys(s).length) {
      privacy.value = { ...privacy.value, ...s };
      general.value = { ...general.value, ...s };
      saveJson('wx_privacy', privacy.value);
      saveJson('wx_general', general.value);
    }
  } catch { /* ignore */ }
});

const props = defineProps({
  me: { type: Object, required: true },
});
const emit = defineEmits(['back', 'logout']);

const appearance = ref(getAppearance());
const section = ref('root');
// root | appearance | about | notify | chat | account | privacy | security | general | blacklist | storage

const bgPresets = [
  { key: 'default', label: '默认', value: null },
  { key: 'gray', label: '浅灰', value: '#e7e7e7' },
  { key: 'blue', label: '淡蓝', value: '#dce9f7' },
  { key: 'green', label: '淡绿', value: '#e3f0e6' },
  { key: 'warm', label: '米色', value: '#f3efe6' },
  { key: 'dark', label: '深灰', value: '#2a2a2a' },
];

const sectionTitle = {
  root: '设置',
  appearance: '通用 · 显示',
  about: '关于微信',
  notify: '新消息通知',
  chat: '聊天',
  account: '账号与安全',
  privacy: '隐私',
  security: '账号与安全',
  general: '通用',
  blacklist: '通讯录黑名单',
  storage: '存储空间',
};

const notifyOn = ref(localStorage.getItem('wx_notify') !== '0');
const notifyPerm = ref(typeof Notification !== 'undefined' ? Notification.permission : 'default');
const msgSound = ref(localStorage.getItem('hudui_msg_sound') !== '0');
const enterSend = ref(localStorage.getItem('wx_enter_send') !== '0');
const showPreview = ref(localStorage.getItem('wx_show_preview') !== '0');
const themeFollow = ref(localStorage.getItem('wx_theme_follow') !== '0');
const blackList = ref([]);
const privacy = ref(loadJson('wx_privacy', {
  allowFriendReq: true,
  showMobile: false,
  showQQ: false,
  momentsPublic: true,
  strangerSee10: false,
  addByGroup: true,
  addByQr: true,
  addByCard: true,
  searchMobile: true,
  searchWxid: true,
}));
const general = ref(loadJson('wx_general', {
  multiLogin: true,
  autoDownload: false,
  voiceInput: true,
  haptic: false,
  fontScaleFollow: true,
}));

function loadJson(key, def) {
  try { return { ...def, ...JSON.parse(localStorage.getItem(key) || '{}') }; }
  catch { return { ...def }; }
}
function saveJson(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

function toggleEnterSend() {
  enterSend.value = !enterSend.value;
  localStorage.setItem('wx_enter_send', enterSend.value ? '1' : '0');
}
function toggleMsgSound() {
  msgSound.value = !msgSound.value;
  localStorage.setItem('hudui_msg_sound', msgSound.value ? '1' : '0');
}
async function toggleNotify() {
  notifyOn.value = !notifyOn.value;
  localStorage.setItem('wx_notify', notifyOn.value ? '1' : '0');
  if (notifyOn.value && typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try { notifyPerm.value = await Notification.requestPermission(); } catch { /* ignore */ }
  }
}
function togglePreview() {
  showPreview.value = !showPreview.value;
  localStorage.setItem('wx_show_preview', showPreview.value ? '1' : '0');
}
function toggleThemeFollow() {
  themeFollow.value = !themeFollow.value;
  localStorage.setItem('wx_theme_follow', themeFollow.value ? '1' : '0');
  if (themeFollow.value && window.matchMedia) {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    appearance.value = toggleDark(dark);
  }
}
function applyPatch(patch) {
  appearance.value = setAppearance(patch);
}
function toggleDarkMode() {
  appearance.value = toggleDark();
}
function pickBg(p) {
  const dark = appearance.value.dark;
  applyPatch({ chatBg: p.value || (dark ? '#111111' : '#ededed') });
}
function currentBg() {
  return appearance.value.chatBg || (appearance.value.dark ? '#111111' : '#ededed');
}
function togglePrivacy(key) {
  const next = { ...privacy.value, [key]: !privacy.value[key] };
  privacy.value = next;
  saveJson('wx_privacy', privacy.value);
  api.updateSettings(next).then(() => toast('已保存')).catch(() => toast('已本地保存'));
}
function toggleGeneral(key) {
  const next = { ...general.value, [key]: !general.value[key] };
  general.value = next;
  saveJson('wx_general', general.value);
  api.updateSettings(next).catch(() => {});
}
async function openBlacklist() {
  section.value = 'blacklist';
  try {
    const d = await api.friends();
    blackList.value = (d.friends || []).filter((f) => f.blacklisted);
  } catch { blackList.value = []; }
}
async function removeFromBlack(f) {
  try {
    await api.setFriendBlacklist(f.id, false);
    blackList.value = blackList.value.filter((x) => x.id !== f.id);
    toast('已移出黑名单');
  } catch (e) { toast(e.message || '操作失败'); }
}

const titles = [
  '账号与安全', '新消息通知', '聊天', '通用', '隐私', '通讯录黑名单', '存储空间', '关于微信',
];
function goSection(label) {
  const map = {
    '账号与安全': 'security',
    '新消息通知': 'notify',
    '聊天': 'chat',
    '通用': 'general',
    '隐私': 'privacy',
    '通讯录黑名单': 'blacklist',
    '存储空间': 'storage',
    '关于微信': 'about',
  };
  const s = map[label];
  if (!s) return;
  if (s === 'blacklist') openBlacklist();
  else if (s === 'general') section.value = 'general';
  else section.value = s;
}

onMounted(() => { appearance.value = getAppearance(); });
</script>

<template>
  <div class="page">
    <header class="nav-bar">
      <button class="icon-btn nav-back" @click="section === 'root' ? emit('back') : (section = 'root')">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title">{{ sectionTitle[section] || '设置' }}</div>
      <div class="nav-right"></div>
    </header>

    <main v-if="section === 'root'" class="content scroll-y">
      <section class="card">
        <div class="row">
          <span class="label">账号</span>
          <span class="value">{{ me.nickname }}</span>
        </div>
        <div class="row">
          <span class="label">微信号</span>
          <span class="value">{{ me.wxid || '未设置' }}</span>
        </div>
      </section>
      <section class="card">
        <button v-for="t in titles" :key="t" class="row" @click="goSection(t)">
          <span class="label">{{ t }}</span>
          <span class="arrow">›</span>
        </button>
      </section>
      <section class="card">
        <button class="row" @click="section = 'appearance'">
          <span class="label">聊天背景与显示</span>
          <span class="arrow">›</span>
        </button>
      </section>
      <section class="card">
        <button class="row center danger" @click="emit('logout')">
          <span class="label">退出登录</span>
        </button>
      </section>
    </main>

    <main v-else-if="section === 'security'" class="content scroll-y">
      <section class="card">
        <div class="row"><span class="label">微信号</span><span class="value">{{ me.wxid || '未设置' }}</span></div>
        <div class="row"><span class="label">微信密码</span><span class="value">已设置</span><span class="arrow">›</span></div>
        <div class="row"><span class="label">声音锁</span><span class="value">未开启</span><span class="arrow">›</span></div>
        <div class="row"><span class="label">登录设备管理</span><span class="value">2 台</span><span class="arrow">›</span></div>
        <div class="row"><span class="label">更多安全设置</span><span class="arrow">›</span></div>
      </section>
      <p class="hint">演示环境：密码/设备管理为界面对齐，不接入真实风控。</p>
    </main>

    <main v-else-if="section === 'privacy'" class="content scroll-y">
      <section class="card">
        <div class="row"><span class="label">加我为朋友时需要验证</span>
          <button class="switch" :class="{ on: privacy.allowFriendReq }" @click="togglePrivacy('allowFriendReq')"></button></div>
        <div class="row"><span class="label">可通过手机号搜索到我</span>
          <button class="switch" :class="{ on: privacy.searchMobile }" @click="togglePrivacy('searchMobile')"></button></div>
        <div class="row"><span class="label">可通过微信号搜索到我</span>
          <button class="switch" :class="{ on: privacy.searchWxid }" @click="togglePrivacy('searchWxid')"></button></div>
        <div class="row"><span class="label">可通过群聊添加我</span>
          <button class="switch" :class="{ on: privacy.addByGroup }" @click="togglePrivacy('addByGroup')"></button></div>
        <div class="row"><span class="label">可通过二维码添加我</span>
          <button class="switch" :class="{ on: privacy.addByQr }" @click="togglePrivacy('addByQr')"></button></div>
        <div class="row"><span class="label">可通过名片添加我</span>
          <button class="switch" :class="{ on: privacy.addByCard }" @click="togglePrivacy('addByCard')"></button></div>
      </section>
      <section class="card">
        <div class="row"><span class="label">朋友圈权限 · 允许陌生人查看十条</span>
          <button class="switch" :class="{ on: privacy.strangerSee10 }" @click="togglePrivacy('strangerSee10')"></button></div>
        <div class="row"><span class="label">朋友圈更新提醒</span>
          <button class="switch" :class="{ on: privacy.momentsPublic }" @click="togglePrivacy('momentsPublic')"></button></div>
      </section>
      <p class="hint">开关保存在本机，用于完整复刻隐私设置页结构。</p>
    </main>

    <main v-else-if="section === 'general'" class="content scroll-y">
      <section class="card">
        <div class="row"><span class="label">多端同时登录</span>
          <button class="switch" :class="{ on: general.multiLogin }" @click="toggleGeneral('multiLogin')"></button></div>
        <div class="row"><span class="label">自动下载微信安装包</span>
          <button class="switch" :class="{ on: general.autoDownload }" @click="toggleGeneral('autoDownload')"></button></div>
        <div class="row"><span class="label">语音输入</span>
          <button class="switch" :class="{ on: general.voiceInput }" @click="toggleGeneral('voiceInput')"></button></div>
        <div class="row"><span class="label">触摸反馈</span>
          <button class="switch" :class="{ on: general.haptic }" @click="toggleGeneral('haptic')"></button></div>
      </section>
      <section class="card">
        <button class="row" @click="section = 'appearance'">
          <span class="label">字体大小与聊天背景</span>
          <span class="arrow">›</span>
        </button>
        <button class="row" @click="section = 'storage'">
          <span class="label">存储空间</span>
          <span class="arrow">›</span>
        </button>
      </section>
    </main>

    <main v-else-if="section === 'blacklist'" class="content scroll-y">
      <section v-if="blackList.length" class="card">
        <div v-for="f in blackList" :key="f.id" class="row">
          <span class="label">{{ f.remark || f.nickname }}</span>
          <button class="link-btn" type="button" @click="removeFromBlack(f)">移出</button>
        </div>
      </section>
      <div v-else class="empty-wrap">
        <div class="empty-icon">🚫</div>
        <div class="empty-text">黑名单为空</div>
        <div class="empty-tip">在好友资料页可将对方加入黑名单</div>
      </div>
    </main>

    <main v-else-if="section === 'storage'" class="content scroll-y">
      <section class="card">
        <div class="row"><span class="label">缓存</span><span class="value">演示 · 本地媒体</span></div>
        <div class="row"><span class="label">聊天记录</span><span class="value">SQLite 持久化</span></div>
        <div class="row"><span class="label">清理缓存</span><span class="value">需在服务器清理 data/media</span></div>
      </section>
      <p class="hint">Web 演示环境不在浏览器端做深度存储清理。</p>
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
        <div class="row">
          <span class="label">通知显示消息详情</span>
          <button class="switch" :class="{ on: showPreview }" @click="togglePreview"></button>
        </div>
        <div class="row">
          <span class="label">消息提示音</span>
          <button class="switch" :class="{ on: msgSound }" @click="toggleMsgSound"></button>
        </div>
      </section>
      <p class="hint">开启后，收到消息可提示音；后台时尝试系统通知（需浏览器权限）。</p>
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
        <div class="row">
          <span class="label">聊天记录迁移与备份</span>
          <span class="value">演示</span>
          <span class="arrow">›</span>
        </div>
      </section>
    </main>

    <main v-else-if="section === 'account'" class="content scroll-y">
      <section class="card">
        <div class="row"><span class="label">微信号</span><span class="value">{{ me.wxid || '未设置' }}</span></div>
        <div class="row"><span class="label">昵称</span><span class="value">{{ me.nickname }}</span></div>
        <div class="row"><span class="label">地区</span><span class="value">{{ me.region || '未设置' }}</span></div>
      </section>
    </main>

    <main v-else-if="section === 'appearance'" class="content scroll-y">
      <section class="card">
        <div class="row">
          <span class="label">深色模式</span>
          <button class="switch" :class="{ on: appearance.dark }"
            @click="toggleDarkMode"></button>
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
          <input class="range" type="range" min="0.9" max="1.3" step="0.05"
            :value="appearance.fontScale || 1"
            @input="applyPatch({ fontScale: Number($event.target.value) })" />
        </div>
      </section>
      <section class="card">
        <div class="row"><span class="label">聊天背景</span></div>
        <div class="bg-grid">
          <button v-for="p in bgPresets" :key="p.key" class="bg-item"
            :class="{ active: currentBg() === (p.value || (appearance.dark ? '#111111' : '#ededed')) }"
            :style="{ background: p.value || (appearance.dark ? '#111111' : '#ededed') }"
            @click="pickBg(p)">
            <span class="bg-label">{{ p.label }}</span>
          </button>
        </div>
      </section>
    </main>

    <main v-else class="content scroll-y">
      <section class="card">
        <div class="row"><span class="label">当前版本</span><span class="value">1.0.0</span></div>
        <div class="row"><span class="label">产品</span><span class="value">WeChat 克隆演示</span></div>
        <div class="row"><span class="label">线上地址</span><span class="value">chat.supeiji.top</span></div>
        <div class="row"><span class="label">技术栈</span><span class="value">Vue3 + Express + SQLite</span></div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--bg); width: 100%; }
.nav-bar {
  height: var(--nav-h); flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  position: relative; background: var(--bg); border-bottom: 0.5px solid var(--divider); padding: 0 8px;
}
.nav-back { position: absolute; left: 0; top: 0; bottom: 0; margin: auto 0; }
.nav-right { width: 44px; }
.nav-title { font-size: 17px; font-weight: 600; }
.content { flex: 1; min-height: 0; padding-bottom: 24px; }
.card { background: var(--white); margin-top: 10px; }
.row {
  width: 100%; display: flex; align-items: center; padding: 14px 16px;
  border-bottom: 0.5px solid var(--divider-soft); background: var(--white);
  text-align: left; min-height: 52px; border-left: 0; border-right: 0; border-top: 0;
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
  width: 44px; height: 26px; border-radius: 13px; background: #e5e5e5;
  position: relative; flex-shrink: 0; transition: background 160ms ease; border: 0;
}
.switch::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 22px; height: 22px;
  border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  transition: transform 160ms ease;
}
.switch.on { background: #07c160; }
.switch.on::after { transform: translateX(18px); }
.range { width: 100%; accent-color: #07c160; }
.bg-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 12px 16px 16px; }
.bg-item {
  height: 72px; border-radius: 8px; border: 2px solid transparent;
  display: flex; align-items: flex-end; justify-content: center; padding-bottom: 6px;
}
.bg-item.active { border-color: #07c160; }
.bg-label { font-size: 12px; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.35); }
.hint { padding: 12px 16px; font-size: 12px; color: var(--text-3); line-height: 1.5; }
.empty-wrap { padding: 64px 24px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.empty-icon {
  width: 64px; height: 64px; border-radius: 16px; background: var(--white);
  display: flex; align-items: center; justify-content: center; font-size: 28px;
}
.empty-text { font-size: 15px; color: var(--text); }
.empty-tip { font-size: 12px; color: var(--text-3); text-align: center; }
.link-btn {
  border: 0; background: transparent; color: #07c160; font-size: 14px; min-height: 40px; padding: 0 8px;
}
</style>
