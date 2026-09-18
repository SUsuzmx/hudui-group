<script setup>
import { computed } from 'vue';
import UserAvatar from './UserAvatar.vue';
import { qrMatrix, payloadForUser } from '../qr.js';

const props = defineProps({
  me: { type: Object, required: true },
});
const emit = defineEmits(['back']);

const wxid = computed(() => props.me?.wxid || `wx_${String(props.me?.id ?? 0).padStart(4, '0')}`);
const payload = computed(() => payloadForUser({ id: props.me?.id, wxid: wxid.value }));
const matrix = computed(() => qrMatrix(payload.value));
const cells = computed(() => {
  const m = matrix.value;
  if (!m) return [];
  const out = [];
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m[r].length; c++) {
      if (m[r][c]) out.push({ r, c });
    }
  }
  return out;
});
const n = computed(() => matrix.value?.length || 21);

function copyPayload() {
  navigator.clipboard?.writeText(payload.value)?.catch(() => {});
  alert('名片码已复制：' + payload.value);
}
</script>

<template>
  <div class="page">
    <header class="nav-bar">
      <button class="icon-btn nav-back" aria-label="返回" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title">二维码名片</div>
      <div class="nav-right"></div>
    </header>

    <main class="content">
      <div class="qr-card">
        <UserAvatar :name="me.nickname" :avatar="me.avatar" :color="me.avatarColor" :size="64" />
        <div class="name">{{ me.nickname }}</div>
        <div class="meta">微信号：{{ wxid }}</div>
        <div class="meta">地区：{{ me.region || '未设置' }}</div>
        <div class="qr-box" :style="{ '--n': n }">
          <svg class="qr-svg" :viewBox="`0 0 ${n} ${n}`" shape-rendering="crispEdges">
            <rect :width="n" :height="n" fill="#fff" />
            <rect
              v-for="(cell, i) in cells"
              :key="i"
              :x="cell.c"
              :y="cell.r"
              width="1"
              height="1"
              fill="#111"
            />
          </svg>
        </div>
        <p class="payload">{{ payload }}</p>
        <p class="tip">对方用微信「扫一扫」或本应用「扫一扫」扫描，即可添加你</p>
        <button class="copy-btn" type="button" @click="copyPayload">复制名片码</button>
      </div>
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

.content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 20px 40px;
}

.qr-card {
  background: var(--white);
  border-radius: 8px;
  padding: 28px 20px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.name {
  margin-top: 14px;
  font-size: 20px;
  font-weight: 500;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-2);
}
.qr-box {
  margin-top: 20px;
  width: 220px;
  height: 220px;
  padding: 10px;
  border: 1px solid var(--divider);
  border-radius: 4px;
  background: #fff;
}
.qr-svg {
  width: 100%;
  height: 100%;
  display: block;
  image-rendering: pixelated;
}
.payload {
  margin-top: 10px;
  font-size: 11px;
  color: var(--text-3);
  word-break: break-all;
  max-width: 240px;
}
.tip {
  margin-top: 10px;
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.5;
}
.copy-btn {
  margin-top: 14px;
  border: 0;
  background: var(--green);
  color: #fff;
  border-radius: 8px;
  padding: 10px 20px;
  font-size: 14px;
  min-height: 40px;
}
.copy-btn:active { opacity: 0.9; }
</style>
