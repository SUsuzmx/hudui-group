<script setup>
// 一次性弹窗：用户同意后自动开启通知 + 自动安装/添加到主屏幕
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue';
import { toast } from '../toast.js';
import {
  isIosSafari,
  isAndroid,
  isStandalone,
  subscribePush,
  registerServiceWorker,
} from '../push-client.js';

const props = defineProps({
  /** 登录完成后再弹，避免挡在登录页 */
  ready: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'done']);

const KEY = 'hudui_pwa_consent_v1';
const show = ref(false);
const asked = ref(false);
const busy = ref(false);
const showIosGuide = ref(false);
const phase = ref('ask'); // ask | working | success | failed
const resultTip = ref('');
const deferredPrompt = ref(null);
const stepTip = ref('');

const platformLine = computed(() => {
  if (isIosSafari()) return 'iPhone 将引导「添加到主屏幕」，并开启消息通知';
  if (isAndroid()) return '将安装为应用，并开启后台消息通知';
  return '将开启消息通知（可选安装到桌面）';
});

const titleText = computed(() => {
  if (phase.value === 'working') return '正在开启…';
  if (phase.value === 'success') return '已开启';
  if (phase.value === 'failed') return '未能全部开启';
  return '开启消息通知';
});

const bodyText = computed(() => {
  if (phase.value === 'working') return resultTip.value || '正在申请通知权限并安装…';
  if (phase.value === 'success') {
    return resultTip.value || '消息通知已开启，关闭网页也能收到新消息。';
  }
  if (phase.value === 'failed') {
    return resultTip.value || '部分能力未开启，可稍后在系统设置中允许通知。';
  }
  return `关闭网页后也能收到新消息；${platformLine.value}`;
});

function closeAll() {
  show.value = false;
  showIosGuide.value = false;
  emit('close');
}

function onBeforeInstall(e) {
  e.preventDefault();
  deferredPrompt.value = e;
}

async function autoInstall() {
  if (isStandalone()) return { installed: true, skipped: true };
  if (deferredPrompt.value) {
    const dp = deferredPrompt.value;
    deferredPrompt.value = null;
    try {
      // 部分浏览器 prompt/userChoice 可能挂起，加超时保证弹窗能收掉
      const choice = await Promise.race([
        (async () => {
          dp.prompt();
          return dp.userChoice;
        })(),
        new Promise((resolve) => setTimeout(() => resolve({ outcome: 'timeout' }), 8000)),
      ]);
      if (choice?.outcome === 'accepted') {
        toast('已添加到主屏幕');
        return { installed: true };
      }
      return { installed: false, skipped: choice?.outcome === 'dismissed' };
    } catch {
      return { installed: false, skipped: true };
    }
  }
  if (isIosSafari()) return { needGuide: true };
  return { installed: false, skipped: true };
}

async function autoPush() {
  try {
    await registerServiceWorker();
    const r = await subscribePush();
    if (r.ok) return { ok: true };
    return { ok: false, reason: r.reason };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

async function accept() {
  if (busy.value || phase.value === 'success') return;
  busy.value = true;
  phase.value = 'working';
  stepTip.value = '正在开启通知…';
  resultTip.value = '正在申请通知权限…';
  try {
    const push = await autoPush();
    stepTip.value = '正在安装…';
    resultTip.value = push.ok ? '通知已开启，正在处理安装…' : '通知未开启，继续安装…';
    const inst = await autoInstall();

    const pushOk = push.ok;
    if (pushOk) {
      phase.value = 'success';
      resultTip.value = inst.needGuide
        ? '消息通知已开启。接下来请添加到主屏幕，体验更完整。'
        : inst.installed || isStandalone()
          ? '消息通知已开启，已添加到主屏幕。关闭网页也能收到新消息。'
          : '消息通知已开启。关闭网页也能收到新消息。';
    } else {
      phase.value = 'failed';
      const map = {
        permission: '通知权限被拒绝，请在系统设置中允许通知后重试。',
        unsupported: '当前浏览器不支持 Web Push 推送。',
        'no-key': '服务器未启用推送，通知可能仅在应用打开时可用。',
      };
      resultTip.value = map[push.reason] || '通知未能开启；安装到主屏幕仍可进行。';
    }
    try { localStorage.setItem(KEY, 'done'); } catch { /* ignore */ }
    emit('done');

    if (inst.needGuide) {
      showIosGuide.value = true;
      return;
    }
    // 成功/失败都先展示结果文案，再自动收起
    setTimeout(() => {
      if (showIosGuide.value) return;
      closeAll();
    }, pushOk ? 1200 : 2200);
  } catch (e) {
    phase.value = 'failed';
    resultTip.value = e?.message || '开启失败，请稍后重试';
  } finally {
    busy.value = false;
    stepTip.value = '';
  }
}

function decline() {
  try { localStorage.setItem(KEY, 'declined'); } catch { /* ignore */ }
  closeAll();
}

function closeIosGuide() {
  closeAll();
}

function maybeShow() {
  if (asked.value || !props.ready) return;
  asked.value = true;
  try {
    const flag = localStorage.getItem(KEY);
    if (flag || isStandalone()) {
      if (!flag && isStandalone()) {
        autoPush().catch(() => {});
        try { localStorage.setItem(KEY, 'done'); } catch { /* ignore */ }
      }
      return;
    }
  } catch { /* ignore */ }
  setTimeout(() => { show.value = true; }, 800);
}

watch(() => props.ready, (on) => { if (on) maybeShow(); });

onMounted(() => {
  maybeShow();
  window.addEventListener('beforeinstallprompt', onBeforeInstall);
});

onBeforeUnmount(() => {
  window.removeEventListener('beforeinstallprompt', onBeforeInstall);
});
</script>

<template>
  <div v-if="show" class="consent-mask" @click.self="phase === 'ask' ? decline() : closeAll()">
    <div class="consent-card" role="dialog" aria-label="消息通知与安装">
      <div class="consent-icon">{{ phase === 'success' ? '✅' : phase === 'failed' ? '⚠️' : '🔔' }}</div>
      <h2 class="consent-title">{{ titleText }}</h2>
      <p class="consent-body">{{ bodyText }}</p>
      <ul v-if="phase === 'ask'" class="consent-list">
        <li>新消息系统通知，点击直达聊天</li>
        <li>锁屏可控制正在播放的音乐</li>
        <li>仅在你同意后才会开启</li>
      </ul>
      <div class="consent-actions">
        <template v-if="phase === 'ask'">
          <button class="btn ghost" type="button" :disabled="busy" @click="decline">暂不</button>
          <button class="btn primary" type="button" :disabled="busy" @click="accept">
            {{ busy ? (stepTip || '处理中…') : '同意并开启' }}
          </button>
        </template>
        <template v-else-if="phase === 'working'">
          <button class="btn primary wide" type="button" disabled>
            {{ stepTip || '处理中…' }}
          </button>
        </template>
        <template v-else>
          <button class="btn primary wide" type="button" @click="closeAll">
            {{ phase === 'success' ? '完成' : '知道了' }}
          </button>
        </template>
      </div>
    </div>
  </div>

  <div v-if="showIosGuide" class="consent-mask" @click.self="closeIosGuide">
    <div class="consent-card">
      <h2 class="consent-title">添加到主屏幕</h2>
      <ol class="ios-steps">
        <li>1. 点 Safari 底部<strong>分享</strong>（方框↑）</li>
        <li>2. 选择「<strong>添加到主屏幕</strong>」</li>
        <li>3. 点「添加」完成安装</li>
      </ol>
      <p class="consent-body">{{ resultTip || '通知权限已尝试开启；安装后体验更完整。' }}</p>
      <button class="btn primary wide" type="button" @click="closeIosGuide">知道了</button>
    </div>
  </div>
</template>

<style scoped>
.consent-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.consent-card {
  width: min(340px, 100%);
  background: var(--sheet-bg, #fff);
  border-radius: 16px;
  padding: 22px 20px 18px;
  text-align: center;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18);
}
.consent-icon {
  width: 56px; height: 56px; margin: 0 auto 12px;
  border-radius: 16px;
  background: rgba(7, 193, 96, 0.12);
  display: flex; align-items: center; justify-content: center;
  font-size: 28px;
}
.consent-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 8px;
}
.consent-body {
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.55;
  margin-bottom: 12px;
}
.consent-list {
  text-align: left;
  margin: 0 0 16px;
  padding: 12px 14px;
  background: var(--divider-soft, #f7f7f7);
  border-radius: 10px;
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.8;
  list-style: none;
}
.consent-actions {
  display: flex;
  gap: 10px;
}
.btn {
  flex: 1;
  border: 0;
  border-radius: 999px;
  min-height: 44px;
  font-size: 15px;
  padding: 10px 12px;
}
.btn.primary { background: var(--green, #07c160); color: #fff; }
.btn.ghost { background: var(--divider-soft, #f0f0f0); color: var(--text); }
.btn:disabled { opacity: 0.6; }
.btn.wide { width: 100%; margin-top: 8px; }
.ios-steps {
  text-align: left;
  margin: 8px 0 14px;
  padding-left: 4px;
  font-size: 14px;
  line-height: 1.9;
  color: var(--text);
  list-style: none;
}
</style>
