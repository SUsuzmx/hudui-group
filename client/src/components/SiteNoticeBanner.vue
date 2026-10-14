<script setup>
// 全局公告横幅：后台「系统设置 → 公告」启用后展示。
// 关闭按内容指纹记在 localStorage——公告更新（updatedAt 变化）后重新弹出。
import { ref, onMounted } from 'vue';
import { api } from '../api.js';

const DISMISS_KEY = 'hudui_site_notice_dismissed';

const visible = ref(false);
const content = ref('');
const updatedAt = ref(0);

const fingerprint = () => `${updatedAt.value}:${content.value}`;

onMounted(async () => {
  try {
    const notice = await api.siteNotice();
    if (!notice?.enabled || !notice.content?.trim()) return;
    if (localStorage.getItem(DISMISS_KEY) === `${notice.updatedAt || 0}:${notice.content}`) return;
    content.value = notice.content;
    updatedAt.value = notice.updatedAt || 0;
    visible.value = true;
  } catch { /* 公告拉取失败静默，不影响主流程 */ }
});

function dismiss() {
  visible.value = false;
  try { localStorage.setItem(DISMISS_KEY, fingerprint()); } catch { /* ignore */ }
}
</script>

<template>
  <div v-if="visible" class="notice-bar" role="status">
    <span class="icon">📢</span>
    <span class="text">{{ content }}</span>
    <button type="button" class="close" aria-label="关闭公告" @click="dismiss">知道了</button>
  </div>
</template>

<style scoped>
.notice-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: calc(8px + var(--safe-t, 0px)) 12px 8px;
  background: #e8f1ff;
  color: #1c4f9c;
  font-size: 12px;
  border-bottom: 0.5px solid rgba(28, 79, 156, 0.15);
  z-index: 200;
  flex-shrink: 0;
}
.icon { flex-shrink: 0; }
.text { flex: 1; min-width: 0; line-height: 1.5; white-space: pre-line; overflow-y: auto; max-height: 30vh; }
.close {
  border: 0;
  border-radius: 999px;
  padding: 6px 12px;
  background: rgba(28, 79, 156, 0.12);
  color: #1c4f9c;
  font-size: 12px;
  min-height: 32px;
  flex-shrink: 0;
}
</style>
