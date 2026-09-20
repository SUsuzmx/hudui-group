<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { api } from '../api.js';
import { toast } from '../toast.js';

const props = defineProps({
  images: { type: Array, default: () => [] },
  index: { type: Number, default: 0 },
  enableActions: { type: Boolean, default: true },
});
const emit = defineEmits(['close', 'change', 'forward']);

const idx = ref(props.index);
const touchX = ref(0);

const current = computed(() => props.images[idx.value] || null);

function go(delta) {
  if (!props.images.length) return;
  const n = (idx.value + delta + props.images.length) % props.images.length;
  idx.value = n;
  emit('change', n);
}

function onTouchStart(e) {
  touchX.value = e.touches?.[0]?.clientX ?? 0;
}
function onTouchEnd(e) {
  const x = e.changedTouches?.[0]?.clientX ?? 0;
  const dx = x - touchX.value;
  if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1);
}

function onKey(e) {
  if (e.key === 'Escape') emit('close');
  if (e.key === 'ArrowLeft') go(-1);
  if (e.key === 'ArrowRight') go(1);
}

async function saveImage() {
  const url = current.value;
  if (!url) return;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement('a');
    const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    a.href = URL.createObjectURL(blob);
    a.download = `wechat-img-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('已保存图片');
  } catch {
    window.open(url, '_blank');
  }
}

async function favoriteImage() {
  const url = current.value;
  if (!url) return;
  try {
    await api.addFavorite({ kind: 'image', content: url, mediaUrl: url });
    toast('已收藏');
  } catch (e) {
    toast(e.message || '收藏失败');
  }
}

function forwardImage() {
  emit('forward', current.value);
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div class="ip-mask" @click="emit('close')">
    <button class="ip-close" type="button" @click.stop="emit('close')">✕</button>
    <div class="ip-stage" @click.stop @touchstart="onTouchStart" @touchend="onTouchEnd">
      <img v-if="current" :src="current" alt="预览" class="ip-img" />
      <div v-else class="ip-empty">无图片</div>
      <div v-if="images.length > 1" class="ip-pager">{{ idx + 1 }} / {{ images.length }}</div>
      <button v-if="images.length > 1" class="ip-nav ip-prev" type="button" @click.stop="go(-1)">‹</button>
      <button v-if="images.length > 1" class="ip-nav ip-next" type="button" @click.stop="go(1)">›</button>
    </div>
    <div v-if="enableActions && current" class="ip-actions" @click.stop>
      <button type="button" @click="forwardImage">发送给朋友</button>
      <button type="button" @click="favoriteImage">收藏</button>
      <button type="button" @click="saveImage">保存图片</button>
    </div>
  </div>
</template>

<style scoped>
.ip-mask {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(0, 0, 0, 0.92);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.ip-close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 18px;
}
.ip-stage {
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 12px 16px;
  box-sizing: border-box;
}
.ip-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
}
.ip-empty { color: #999; }
.ip-pager {
  position: absolute;
  bottom: 8px;
  left: 0;
  right: 0;
  text-align: center;
  color: #fff;
  font-size: 13px;
  opacity: 0.85;
}
.ip-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: 24px;
  line-height: 1;
}
.ip-prev { left: 10px; }
.ip-next { right: 10px; }
.ip-actions {
  width: 100%;
  display: flex;
  justify-content: space-around;
  gap: 8px;
  padding: 12px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  border-top: 0.5px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.55);
  flex-shrink: 0;
}
.ip-actions button {
  border: 0;
  background: transparent;
  color: #fff;
  font-size: 14px;
  min-height: 40px;
  padding: 0 10px;
}
.ip-actions button:active { opacity: 0.65; }
</style>
