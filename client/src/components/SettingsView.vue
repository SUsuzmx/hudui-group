<script setup>
import { ref, reactive, onMounted } from 'vue';
import { getAppearance, setAppearance, toggleDark } from '../appearance.js';
import { api } from '../api.js';
import { toast } from '../toast.js';

onMounted(async () => {
  estimateCache();
  try {
    const d = await api.settings();
    const s = d?.settings || {};
    if (Object.keys(s).length) {
      privacy.value = { ...privacy.value, ...s };
      general.value = { ...general.value, ...s };
      voiceLock.value = s.voiceLock !== false && general.value.voiceLock !== false
        ? Boolean(s.voiceLock ?? general.value.voiceLock)
        : Boolean(s.voiceLock);
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
// root | appearance | about | notify | chat | account | privacy | security | general | blacklist | storage | help | admin

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
  about: '关于',
  notify: '新消息通知',
  chat: '聊天',
  account: '账号与安全',
  privacy: '隐私',
  security: '账号与安全',
  general: '通用',
  blacklist: '通讯录黑名单',
  storage: '存储空间',
  help: '帮助与反馈',
  admin: '运营后台',
  backup: '聊天记录备份',
  loginHistory: '登录记录',
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

// ── 账号与安全 ──
const voiceLock = ref(localStorage.getItem('wx_voice_lock') !== '0');
const showPwd = ref(false);
const pwdOld = ref('');
const pwdNew = ref('');
const pwdBusy = ref(false);
const cacheSize = ref('—');
const loginItems = ref([]);
const recoveryCode = ref('');
const showDeleteAccount = ref(false);
const deleteReason = ref('');
const deleteBusy = ref(false);
const faqList = ref([]);
const myReports = ref([]);
const myFeedbacks = ref([]);
const feedbackText = ref('');
const feedbackCategory = ref('suggestion');
const feedbackBusy = ref(false);
const cloudBackups = ref([]);
const exportBusy = ref(false);
const adminData = ref(null);
const highContrast = ref(Boolean(getAppearance().highContrast));

function toggleVoiceLock() {
  voiceLock.value = !voiceLock.value;
  try { localStorage.setItem('wx_voice_lock', voiceLock.value ? '1' : '0'); } catch { /* ignore */ }
  api.updateSettings({ voiceLock: voiceLock.value }).catch(() => {});
  toast(voiceLock.value ? '声音锁已开启' : '声音锁已关闭');
}

async function kickOthers() {
  try {
    const d = await api.kickOtherDevices();
    const n = Number(d?.kicked || 0);
    toast(n > 0 ? `已下线其它 ${n} 台设备` : '当前仅本设备在线');
  } catch (e) {
    toast(e.message || '操作失败');
  }
}

async function submitPassword() {
  if (pwdBusy.value) return;
  if (pwdNew.value.length < 6) { toast('新密码至少 6 位'); return; }
  pwdBusy.value = true;
  try {
    const d = await api.changePassword(pwdOld.value, pwdNew.value);
    if (d?.token) {
      try { localStorage.setItem('hudui_token', d.token); } catch { /* ignore */ }
    }
    showPwd.value = false;
    pwdOld.value = '';
    pwdNew.value = '';
    toast('密码已修改，其它设备已下线');
  } catch (e) {
    toast(e.message || '修改失败');
  } finally {
    pwdBusy.value = false;
  }
}

// ── 存储空间 ──
function estimateCache() {
  let bytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      const v = localStorage.getItem(k) || '';
      bytes += (k.length + v.length) * 2;
    }
  } catch { bytes = 0; }
  cacheSize.value = bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ── 登录记录 / 找回码 / 注销 ──
async function openLoginHistory() {
  section.value = 'loginHistory';
  try {
    const d = await api.loginHistory();
    loginItems.value = d?.items || [];
  } catch (e) {
    toast(e.message || '加载失败');
    loginItems.value = [];
  }
}

async function makeRecoveryCode() {
  try {
    const d = await api.generateRecoveryCode();
    recoveryCode.value = d?.recoveryCode || '';
    toast('找回码已生成，请妥善保存');
  } catch (e) {
    toast(e.message || '生成失败');
  }
}

async function confirmDeleteAccount() {
  if (deleteBusy.value) return;
  deleteBusy.value = true;
  try {
    await api.deleteAccount(deleteReason.value);
    toast('账号已注销');
    emit('logout');
  } catch (e) {
    toast(e.message || '注销失败');
  } finally {
    deleteBusy.value = false;
    showDeleteAccount.value = false;
  }
}

// ── 帮助与反馈 ──
async function openHelp() {
  section.value = 'help';
  try {
    const [f, r, fb] = await Promise.all([
      api.faq().catch(() => ({ faq: [] })),
      api.myReports().catch(() => ({ reports: [] })),
      api.myFeedback().catch(() => ({ feedbacks: [] })),
    ]);
    faqList.value = f?.faq || [];
    myReports.value = r?.reports || [];
    myFeedbacks.value = fb?.feedbacks || [];
  } catch { /* ignore */ }
}

async function submitFeedback() {
  if (feedbackBusy.value) return;
  if (!feedbackText.value.trim() || feedbackText.value.trim().length < 4) {
    toast('请填写具体反馈内容');
    return;
  }
  feedbackBusy.value = true;
  try {
    await api.createFeedback({
      category: feedbackCategory.value,
      content: feedbackText.value,
    });
    feedbackText.value = '';
    toast('反馈已提交');
    const d = await api.myFeedback().catch(() => ({ feedbacks: [] }));
    myFeedbacks.value = d?.feedbacks || [];
  } catch (e) {
    toast(e.message || '提交失败');
  } finally {
    feedbackBusy.value = false;
  }
}

// ── 备份 ──
async function openBackup() {
  section.value = 'backup';
  try {
    const d = await api.cloudBackups();
    cloudBackups.value = d?.backups || [];
  } catch { cloudBackups.value = []; }
}

function downloadExport(payload, name) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name || `hudui-chat-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function doExportChat() {
  if (exportBusy.value) return;
  exportBusy.value = true;
  try {
    const d = await api.exportChat({ limit: 500 });
    if (d?.payload) {
      downloadExport(d.payload);
      toast(`已导出 ${d.payload.count || 0} 条消息`);
    }
  } catch (e) {
    toast(e.message || '导出失败');
  } finally {
    exportBusy.value = false;
  }
}

async function doCloudBackup() {
  if (exportBusy.value) return;
  exportBusy.value = true;
  try {
    const d = await api.cloudBackup({ limit: 500 });
    toast(`已备份到云端（${d?.count || 0} 条）`);
    const list = await api.cloudBackups();
    cloudBackups.value = list?.backups || [];
  } catch (e) {
    toast(e.message || '备份失败');
  } finally {
    exportBusy.value = false;
  }
}

async function doRestoreBackup(id) {
  try {
    const d = await api.restoreCloudBackup(id);
    if (d?.payload) {
      downloadExport(d.payload, `hudui-restore-${id}.json`);
      toast('已下载恢复包');
    }
  } catch (e) {
    toast(e.message || '恢复失败');
  }
}

// ── 高对比度 ──
function toggleHighContrast() {
  highContrast.value = !highContrast.value;
  applyPatch({ highContrast: highContrast.value });
  toast(highContrast.value ? '已开启高对比度' : '已关闭高对比度');
}

// ── 管理后台 ──
const isAdmin = ref(Boolean(props.me?.isAdmin));
const adminTab = ref('overview'); // overview | reports | feedback | errors
const adminReports = ref([]);
const adminFeedbacks = ref([]);
const adminErrors = ref([]);
const adminUsers = ref([]);
const adminBusy = ref(false);
const adminFlags = ref({});
const replyDraft = reactive({});
const adminNoteOpen = ref(false);
const adminNoteTarget = ref(null); // { id, status, type: 'report' | 'feedback' }
const adminNoteText = ref('');

function menuTitles() {
  const base = [
    '账号与安全', '新消息通知', '聊天', '通用', '隐私', '通讯录黑名单', '存储空间', '帮助与反馈', '关于',
  ];
  if (isAdmin.value) base.splice(base.length - 1, 0, '运营后台');
  return base;
}

async function refreshAdminLists() {
  if (!isAdmin.value) return;
  try {
    const [rep, fb, err, users] = await Promise.all([
      api.adminReports().catch(() => ({ reports: [] })),
      api.adminFeedback().catch(() => ({ feedbacks: [] })),
      api.adminErrors().catch(() => ({ errors: [] })),
      api.adminUsers().catch(() => ({ users: [] })),
    ]);
    adminReports.value = rep?.reports || [];
    adminFeedbacks.value = fb?.feedbacks || [];
    adminErrors.value = err?.errors || [];
    adminUsers.value = users?.users || [];
    const flags = await api.adminFlags().catch(() => ({ flags: {} }));
    adminFlags.value = flags?.flags || {};
  } catch { /* ignore */ }
}

async function openAdmin() {
  if (!isAdmin.value) {
    toast('需要管理员权限');
    return;
  }
  section.value = 'admin';
  adminTab.value = 'overview';
  try {
    adminData.value = await api.adminOverview();
    await refreshAdminLists();
  } catch (e) {
    adminData.value = null;
    toast(e.message || '需要管理员权限');
  }
}

async function handleAdminReport(id, status) {
  adminNoteTarget.value = { id, status, type: 'report' };
  adminNoteText.value = '';
  adminNoteOpen.value = true;
}

function closeAdminNote() {
  adminNoteOpen.value = false;
  adminNoteTarget.value = null;
  adminNoteText.value = '';
}

async function confirmAdminNote() {
  const t = adminNoteTarget.value;
  if (!t || adminBusy.value) return;
  adminBusy.value = true;
  try {
    if (t.type === 'report') {
      await api.adminHandleReport(t.id, {
        status: t.status,
        handlerNote: adminNoteText.value.trim(),
      });
      toast('举报已更新');
    } else {
      const text = (adminNoteText.value || '').trim();
      if (!text) {
        toast('请填写回复内容');
        adminBusy.value = false;
        return;
      }
      await api.adminReplyFeedback(t.id, text);
      replyDraft[String(t.id)] = '';
      toast('已回复反馈');
    }
    closeAdminNote();
    await refreshAdminLists();
    if (adminData.value) adminData.value = await api.adminOverview();
  } catch (e) {
    toast(e.message || '操作失败');
  } finally {
    adminBusy.value = false;
  }
}

function openFeedbackReply(id) {
  adminNoteTarget.value = { id, status: 'replied', type: 'feedback' };
  adminNoteText.value = replyDraft[String(id)] || '';
  adminNoteOpen.value = true;
}

async function replyAdminFeedback(id) {
  openFeedbackReply(id);
}

const FLAG_LABELS = {
  accountSecurity: '账号安全（找回/设备/注销）',
  groupGovernance: '群治理（管理员/入群验证）',
  momentsSafety: '朋友圈安全（访客/举报/过滤）',
  backupCloud: '备份与云端恢复',
  feedbackFaq: '反馈与 FAQ',
  searchEnhanced: '搜索增强',
  adminPanel: '运营后台',
};

async function toggleFlag(key) {
  const next = !adminFlags.value[key];
  try {
    const d = await api.adminSetFlags({ [key]: next });
    adminFlags.value = d?.flags || { ...adminFlags.value, [key]: next };
    toast(next ? '已开启' : '已关闭');
  } catch (e) {
    toast(e.message || '设置失败');
  }
}

async function checkAdminAccess() {
  try {
    const d = await api.adminOverview();
    if (d && typeof d.users === 'number') {
      isAdmin.value = true;
      titles.value = menuTitles();
    }
  } catch {
    // 以 me.isAdmin 为准
  }
}

function fmtTime(ts) {
  if (!ts) return '';
  try {
    return new Date(Number(ts)).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return '';
  }
}

function clearLocalCache() {
  const removed = [];
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    for (const k of keys) {
      // 清理会话/消息缓存，保留登录与偏好设置
      if (
        k.startsWith('hudui_msg_')
        || k.startsWith('hudui_chat_')
        || k.startsWith('wx_friend_extras')
        || k.startsWith('wx_profile_extras')
      ) {
        localStorage.removeItem(k);
        removed.push(k);
      }
    }
  } catch { /* ignore */ }
  estimateCache();
  toast(removed.length ? `已清理 ${removed.length} 项本地缓存` : '没有可清理的缓存');
}

const titles = ref([
  '账号与安全', '新消息通知', '聊天', '通用', '隐私', '通讯录黑名单', '存储空间', '帮助与反馈', '关于',
]);
function goSection(label) {
  const map = {
    '账号与安全': 'security',
    '新消息通知': 'notify',
    '聊天': 'chat',
    '通用': 'general',
    '隐私': 'privacy',
    '通讯录黑名单': 'blacklist',
    '存储空间': 'storage',
    '帮助与反馈': 'help',
    '运营后台': 'admin',
    '关于': 'about',
    '关于微信': 'about',
  };
  const s = map[label];
  if (!s) return;
  if (s === 'blacklist') openBlacklist();
  else if (s === 'help') openHelp();
  else if (s === 'admin') openAdmin();
  else if (s === 'general') section.value = 'general';
  else section.value = s;
}

onMounted(() => {
  appearance.value = getAppearance();
  isAdmin.value = Boolean(props.me?.isAdmin);
  titles.value = menuTitles();
  // me 未带 isAdmin 时用接口探测（仅成功才显示入口）
  if (!isAdmin.value) checkAdminAccess();
});
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
        <button class="row" type="button" @click="showPwd = true">
          <span class="label">微信密码</span>
          <span class="value">修改</span>
          <span class="arrow">›</span>
        </button>
        <div class="row">
          <span class="label">声音锁</span>
          <button class="switch" :class="{ on: voiceLock }" @click="toggleVoiceLock"></button>
        </div>
        <button class="row" type="button" @click="kickOthers">
          <span class="label">登录设备管理</span>
          <span class="value">单端 · 下线其它</span>
          <span class="arrow">›</span>
        </button>
        <button class="row" type="button" @click="openLoginHistory">
          <span class="label">登录记录</span>
          <span class="value">设备 / 异地提醒</span>
          <span class="arrow">›</span>
        </button>
      </section>
      <section class="card">
        <button class="row" type="button" @click="makeRecoveryCode">
          <span class="label">生成找回码</span>
          <span class="value">忘记密码时用</span>
          <span class="arrow">›</span>
        </button>
        <div v-if="recoveryCode" class="row col">
          <div class="row-head"><span class="label">本次找回码</span></div>
          <div class="code-box">{{ recoveryCode }}</div>
          <p class="hint" style="padding:8px 0 0">请立即抄写保存，仅显示这一次。</p>
        </div>
      </section>
      <section class="card">
        <button class="row danger" type="button" @click="showDeleteAccount = true">
          <span class="label">注销账号</span>
          <span class="value">删除账号与数据</span>
          <span class="arrow">›</span>
        </button>
      </section>
      <p class="hint">修改密码后其它设备会自动下线；登录记录会标注异常登录。注销后好友、朋友圈、聊天相关数据将被删除，不可恢复。</p>
    </main>

    <main v-else-if="section === 'loginHistory'" class="content scroll-y">
      <section class="card">
        <div v-for="it in loginItems" :key="it.id" class="row col">
          <div class="row-head">
            <span class="label">{{ it.device }} · {{ it.ip || '未知 IP' }}</span>
            <span class="value">{{ fmtTime(it.createdAt) }}</span>
          </div>
          <div class="meta-line">
            <span v-if="it.anomaly" class="tag-warn">{{ it.anomalyNote || '异常登录' }}</span>
            <span v-else class="tag-ok">{{ it.status === 'ok' ? '正常' : it.status }}</span>
            <span class="ua">{{ (it.userAgent || '').slice(0, 60) }}</span>
          </div>
        </div>
        <div v-if="!loginItems.length" class="empty-tip" style="padding:24px">暂无登录记录</div>
      </section>
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
        <div class="row"><span class="label">允许陌生人查看我的朋友圈</span>
          <button class="switch" :class="{ on: privacy.momentsPublic }" @click="togglePrivacy('momentsPublic')"></button></div>
        <div class="row"><span class="label">陌生人最多查看十条</span>
          <button class="switch" :class="{ on: privacy.strangerSee10 }" @click="togglePrivacy('strangerSee10')"></button></div>
      </section>
      <p class="hint">隐私开关已同步服务端并作用于真实展示：不让他看我、陌生人可见范围、状态仅自己可见等都会按设置过滤。关闭「通过微信号搜索到我」后，扫码/搜索将无法找到你。</p>
    </main>

    <main v-else-if="section === 'general'" class="content scroll-y">
      <section class="card">
        <div class="row"><span class="label">单端登录</span>
          <button class="switch on" type="button" disabled title="同一账号仅允许一处登录"></button>
        </div>
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
        <div class="row"><span class="label">本地缓存</span><span class="value">{{ cacheSize }}</span></div>
        <div class="row"><span class="label">聊天记录</span><span class="value">服务端 SQLite 保留</span></div>
        <button class="row" type="button" @click="clearLocalCache">
          <span class="label">清理本地缓存</span>
          <span class="value">消息缓存 / 表情</span>
          <span class="arrow">›</span>
        </button>
        <button class="row" type="button" @click="estimateCache">
          <span class="label">重新计算缓存</span>
          <span class="arrow">›</span>
        </button>
      </section>
      <p class="hint">清理后重新进会话会从服务器拉取历史消息。</p>
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
          <span class="value">双击对方头像</span>
        </div>
        <button class="row" type="button" @click="openBackup">
          <span class="label">聊天记录迁移与备份</span>
          <span class="value">导出 / 云端恢复</span>
          <span class="arrow">›</span>
        </button>
      </section>
    </main>

    <main v-else-if="section === 'backup'" class="content scroll-y">
      <section class="card">
        <button class="row" type="button" :disabled="exportBusy" @click="doExportChat">
          <span class="label">导出聊天记录</span>
          <span class="value">JSON 含消息</span>
          <span class="arrow">›</span>
        </button>
        <button class="row" type="button" :disabled="exportBusy" @click="doCloudBackup">
          <span class="label">备份到云端</span>
          <span class="value">换机可恢复</span>
          <span class="arrow">›</span>
        </button>
      </section>
      <section class="card">
        <div class="row"><span class="label">云端备份列表</span></div>
        <div v-for="b in cloudBackups" :key="b.id" class="row">
          <span class="label">{{ fmtTime(b.createdAt) }}</span>
          <span class="value">{{ Math.round((b.size || 0) / 1024) }} KB</span>
          <button class="link-btn" type="button" @click="doRestoreBackup(b.id)">恢复</button>
        </div>
        <div v-if="!cloudBackups.length" class="empty-tip" style="padding:16px">还没有云端备份</div>
      </section>
      <p class="hint">导出包含本人可见会话的消息文本与媒体索引。云端备份可在新设备登录后恢复导出包。</p>
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
          <span class="label">高对比度</span>
          <button class="switch" :class="{ on: highContrast }" @click="toggleHighContrast"></button>
        </div>
        <div class="row">
          <span class="label">允许页面缩放</span>
          <span class="value">已启用</span>
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

    <main v-else-if="section === 'help'" class="content scroll-y">
      <section class="card">
        <div class="row"><span class="label">常见问题</span></div>
        <div v-for="(f, i) in faqList" :key="i" class="row col">
          <div class="row-head"><span class="label">{{ f.q }}</span></div>
          <p class="faq-a">{{ f.a }}</p>
        </div>
      </section>
      <section class="card">
        <div class="row"><span class="label">意见反馈</span></div>
        <div class="row col">
          <select v-model="feedbackCategory" class="input">
            <option value="suggestion">功能建议</option>
            <option value="bug">问题反馈</option>
            <option value="ui">界面体验</option>
            <option value="account">账号问题</option>
            <option value="other">其它</option>
          </select>
          <textarea v-model="feedbackText" class="input area" rows="3" placeholder="请描述你的问题或建议"></textarea>
          <button class="row" type="button" :disabled="feedbackBusy" @click="submitFeedback">
            <span class="label">{{ feedbackBusy ? '提交中…' : '提交反馈' }}</span>
          </button>
        </div>
      </section>
      <section class="card">
        <div class="row"><span class="label">我的反馈</span></div>
        <div v-for="f in myFeedbacks" :key="f.id" class="row col">
          <div class="row-head">
            <span class="label">{{ f.content.slice(0, 40) }}</span>
            <span class="value">{{ f.statusLabel }}</span>
          </div>
          <p v-if="f.reply" class="faq-a">回复：{{ f.reply }}</p>
        </div>
      </section>
      <section class="card">
        <div class="row"><span class="label">我的举报进度</span></div>
        <div v-for="r in myReports" :key="r.id" class="row">
          <span class="label">{{ r.category }} · {{ (r.detail || '').slice(0, 20) }}</span>
          <span class="value">{{ r.statusLabel }}</span>
        </div>
        <div v-if="!myReports.length" class="empty-tip" style="padding:12px">暂无举报记录</div>
      </section>
    </main>

    <main v-else-if="section === 'admin'" class="content scroll-y">
      <template v-if="adminData">
        <div class="admin-tabs">
          <button
            v-for="t in [['overview','概览'],['reports','举报'],['feedback','反馈'],['errors','错误'],['flags','开关']]"
            :key="t[0]"
            type="button"
            class="admin-tab"
            :class="{ on: adminTab === t[0] }"
            @click="adminTab = t[0]"
          >{{ t[1] }}</button>
        </div>

        <template v-if="adminTab === 'overview'">
          <section class="card">
            <div class="row"><span class="label">用户数</span><span class="value">{{ adminData.users }}</span></div>
            <div class="row"><span class="label">群组数</span><span class="value">{{ adminData.groups }}</span></div>
            <div class="row"><span class="label">消息数</span><span class="value">{{ adminData.messages }}</span></div>
            <div class="row"><span class="label">朋友圈</span><span class="value">{{ adminData.moments }}</span></div>
          </section>
          <section class="card">
            <div class="row"><span class="label">待处理举报</span><span class="value">{{ adminData.pendingReports }}</span></div>
            <div class="row"><span class="label">待回复反馈</span><span class="value">{{ adminData.openFeedback }}</span></div>
            <div class="row"><span class="label">24h 错误</span><span class="value">{{ adminData.errors24h }}</span></div>
            <div class="row"><span class="label">24h 登录 / 异常</span><span class="value">{{ adminData.logins24h }} / {{ adminData.anomalies24h }}</span></div>
          </section>
          <section class="card">
            <div class="row"><span class="label">最近注册</span></div>
            <div v-for="u in adminData.recentUsers" :key="u.id" class="row">
              <span class="label">#{{ u.id }} {{ u.nickname }}</span>
              <span class="value">{{ fmtTime(u.createdAt) }}</span>
            </div>
          </section>
          <section class="card">
            <div class="row"><span class="label">用户检索（{{ adminUsers.length }}）</span></div>
            <div v-for="u in adminUsers.slice(0, 20)" :key="'u' + u.id" class="row">
              <span class="label">#{{ u.id }} {{ u.nickname }}</span>
              <span class="value">{{ u.wxid || '' }}</span>
            </div>
          </section>
        </template>

        <template v-else-if="adminTab === 'reports'">
          <section class="card">
            <div v-for="r in adminReports" :key="r.id" class="row col">
              <div class="row-head">
                <span class="label">#{{ r.id }} {{ r.category }} · {{ r.targetType }}</span>
                <span class="value">{{ r.statusLabel }}</span>
              </div>
              <p class="faq-a">{{ r.detail || '（无描述）' }}</p>
              <div class="meta-line">
                <span class="ua">举报人 #{{ r.reporterId || '—' }} · {{ fmtTime(r.createdAt) }}</span>
              </div>
              <div class="admin-actions" v-if="r.status === 'pending' || r.status === 'processing'">
                <button type="button" class="action-btn" :disabled="adminBusy" @click="handleAdminReport(r.id, 'processing')">处理中</button>
                <button type="button" class="action-btn primary" :disabled="adminBusy" @click="handleAdminReport(r.id, 'done')">已处理</button>
                <button type="button" class="action-btn" :disabled="adminBusy" @click="handleAdminReport(r.id, 'rejected')">未违规</button>
              </div>
              <p v-if="r.handlerNote" class="faq-a">处理备注：{{ r.handlerNote }}</p>
            </div>
            <div v-if="!adminReports.length" class="empty-tip" style="padding:16px">暂无举报</div>
          </section>
        </template>

        <template v-else-if="adminTab === 'feedback'">
          <section class="card">
            <div v-for="f in adminFeedbacks" :key="f.id" class="row col">
              <div class="row-head">
                <span class="label">#{{ f.id }} {{ f.category }}</span>
                <span class="value">{{ f.status }}</span>
              </div>
              <p class="faq-a">{{ f.content }}</p>
              <p v-if="f.reply" class="faq-a">已回复：{{ f.reply }}</p>
              <div class="admin-actions">
                <input
                  :value="replyDraft[String(f.id)] || ''"
                  class="input"
                  type="text"
                  placeholder="输入回复内容"
                  @input="replyDraft[String(f.id)] = $event.target.value"
                />
                <button type="button" class="action-btn primary" :disabled="adminBusy" @click="replyAdminFeedback(f.id)">回复</button>
              </div>
            </div>
            <div v-if="!adminFeedbacks.length" class="empty-tip" style="padding:16px">暂无反馈</div>
          </section>
        </template>

        <template v-else-if="adminTab === 'errors'">
          <section class="card">
            <div v-for="e in adminErrors" :key="e.id" class="row col">
              <div class="row-head">
                <span class="label">{{ e.feature || 'client' }}</span>
                <span class="value">{{ fmtTime(e.createdAt) }}</span>
              </div>
              <p class="faq-a">{{ e.message }}</p>
            </div>
            <div v-if="!adminErrors.length" class="empty-tip" style="padding:16px">暂无错误记录</div>
          </section>
        </template>

        <template v-else>
          <section class="card">
            <div class="row"><span class="label">功能开关（可随时关闭）</span></div>
            <div v-for="(label, key) in FLAG_LABELS" :key="key" class="row">
              <span class="label">{{ label }}</span>
              <button
                class="switch"
                :class="{ on: adminFlags[key] !== false }"
                type="button"
                :aria-label="label"
                @click="toggleFlag(key)"
              ></button>
            </div>
          </section>
          <p class="hint">关闭后对应接口返回 503，便于出问题时快速止血。</p>
        </template>
      </template>
      <div v-else class="empty-wrap">
        <div class="empty-icon">🔒</div>
        <div class="empty-text">需要管理员权限</div>
        <div class="empty-tip">仅授权管理员账号可访问</div>
      </div>
    </main>

    <main v-else class="content scroll-y">
      <section class="card">
        <div class="row"><span class="label">当前版本</span><span class="value">1.1.0</span></div>
        <div class="row"><span class="label">产品</span><span class="value">WeChat 克隆演示</span></div>
        <div class="row"><span class="label">线上地址</span><span class="value">chat.supeiji.top</span></div>
        <div class="row"><span class="label">作者</span><span class="value">由 Perry 制作</span></div>
      </section>
      <p class="about-foot">希望你和朋友在这里玩得开心。— Perry</p>
    </main>

    <div v-if="adminNoteOpen" class="mask" @click.self="closeAdminNote">
      <div class="dialog">
        <div class="dialog-title">
          {{ adminNoteTarget?.type === 'feedback' ? '回复反馈' : '处理举报' }}
        </div>
        <textarea
          v-model="adminNoteText"
          class="input area"
          rows="3"
          :placeholder="adminNoteTarget?.type === 'feedback' ? '请输入回复内容' : '处理说明（可选）'"
        ></textarea>
        <div class="dialog-actions">
          <button type="button" @click="closeAdminNote">取消</button>
          <button type="button" class="ok" :disabled="adminBusy" @click="confirmAdminNote">
            {{ adminBusy ? '提交中…' : '确定' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="showDeleteAccount" class="mask" @click.self="showDeleteAccount = false">
      <div class="dialog">
        <div class="dialog-title">注销账号</div>
        <p class="hint" style="padding:0 0 10px">将删除账号、好友关系、朋友圈与相关数据，不可恢复。</p>
        <input v-model="deleteReason" type="text" placeholder="注销原因（可选）" />
        <div class="dialog-actions">
          <button type="button" @click="showDeleteAccount = false">取消</button>
          <button type="button" class="ok" :disabled="deleteBusy" @click="confirmDeleteAccount">
            {{ deleteBusy ? '处理中…' : '确认注销' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="showPwd" class="mask" @click.self="showPwd = false">
      <div class="dialog">
        <div class="dialog-title">修改微信密码</div>
        <input v-model="pwdOld" type="password" placeholder="原密码" autocomplete="current-password" />
        <input v-model="pwdNew" type="password" placeholder="新密码（至少 6 位）" autocomplete="new-password" />
        <div class="dialog-actions">
          <button type="button" @click="showPwd = false">取消</button>
          <button type="button" class="ok" :disabled="pwdBusy || !pwdOld || pwdNew.length < 6" @click="submitPassword">
            {{ pwdBusy ? '提交中…' : '确定' }}
          </button>
        </div>
      </div>
    </div>
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
.mask {
  position: absolute; inset: 0; z-index: 60; background: var(--mask);
  display: flex; align-items: center; justify-content: center;
}
.dialog {
  width: min(320px, 88%);
  background: var(--white);
  border-radius: 12px;
  padding: 16px;
}
.dialog-title { font-size: 16px; font-weight: 600; margin-bottom: 12px; text-align: center; color: var(--text); }
.dialog input {
  width: 100%; min-height: 40px; margin-bottom: 10px;
  border: 0; border-radius: 8px; background: var(--divider-soft);
  padding: 0 12px; font-size: 15px; color: var(--text);
}
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.dialog-actions button {
  border: 0; background: transparent; color: var(--text-2);
  min-height: 36px; padding: 0 12px; font-size: 14px;
}
.dialog-actions button.ok { color: #07c160; font-weight: 600; }
.dialog-actions button.ok:disabled { opacity: 0.45; }
.code-box {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 20px; letter-spacing: 2px; padding: 12px; border-radius: 8px;
  background: var(--divider-soft); color: var(--text); text-align: center;
}
.meta-line { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.tag-ok { font-size: 12px; color: var(--green); }
.tag-warn { font-size: 12px; color: var(--red); background: rgba(250,81,81,0.12); padding: 2px 6px; border-radius: 4px; }
.ua { font-size: 11px; color: var(--text-3); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.faq-a { font-size: 13px; color: var(--text-2); line-height: 1.55; }
.input {
  width: 100%; min-height: 40px; border: 0; border-radius: 8px;
  background: var(--divider-soft); padding: 8px 12px; font-size: 15px; color: var(--text);
  margin-bottom: 8px;
}
.input.area { resize: vertical; min-height: 80px; }
.admin-tabs {
  display: flex; gap: 6px; padding: 10px 12px 0;
}
.admin-tab {
  flex: 1; min-height: 36px; border: 0; border-radius: 8px;
  background: var(--divider-soft); color: var(--text-2); font-size: 13px;
}
.admin-tab.on {
  background: var(--green); color: #fff; font-weight: 600;
}
.admin-actions {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px;
}
.admin-actions .input {
  flex: 1; min-width: 140px; margin-bottom: 0;
}
.action-btn {
  border: 0; border-radius: 8px; min-height: 36px; padding: 0 14px;
  background: var(--divider-soft); color: var(--text); font-size: 13px;
  cursor: pointer; touch-action: manipulation;
}
.action-btn.primary {
  background: var(--green); color: #fff; font-weight: 600;
}
.action-btn:disabled {
  opacity: 0.5;
}
.action-btn:active {
  filter: brightness(0.95);
}
</style>
<style scoped>
.about-foot {
  margin: 16px 8px 24px;
  text-align: center;
  font-size: 11px;
  color: rgba(120, 120, 120, 0.85);
  line-height: 1.5;
}
</style>
