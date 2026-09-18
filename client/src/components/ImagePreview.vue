<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps({
  images: { type: Array, default: () => [] },
  index: { type: Number, default: 0 },
});
const emit = defineEmits(['close', 'change']);

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
  </div>
</template>

<style scoped>
.ip-mask {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(0, 0, 0, 0.92);
  display: flex;
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
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 12px 24px;
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
  bottom: 20px;
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
</style>
