<script setup>
import { computed } from 'vue';

const props = defineProps({
  name: { type: String, default: '' },
  color: { type: String, default: '#4f6ef7' },
  avatar: { type: String, default: null },
  emoji: { type: String, default: null },
  size: { type: Number, default: 40 },
});

const isImage = computed(() => {
  const a = props.avatar;
  if (!a || typeof a !== 'string') return false;
  // 颜色值不当作图片
  if (a.startsWith('#') || a.startsWith('rgb')) return false;
  return a.startsWith('/') || a.startsWith('data:') || a.startsWith('http') || /\.(png|jpe?g|webp|gif)$/i.test(a);
});
const isEmoji = computed(() => !isImage.value && Boolean(props.emoji));
const src = computed(() => {
  if (!isImage.value) return '';
  if (props.avatar.startsWith('/') || props.avatar.startsWith('data:') || props.avatar.startsWith('http')) {
    return props.avatar;
  }
  return `/avatars/${encodeURIComponent(props.avatar)}`;
});
const letter = computed(() => props.name?.slice(0, 1) ?? '?');
const bg = computed(() => {
  if (isImage.value) return 'transparent';
  if (props.color && (props.color.startsWith('#') || props.color.startsWith('rgb'))) return props.color;
  return '#4f6ef7';
});
</script>

<template>
  <div
    class="avatar"
    :class="{ emoji: isEmoji }"
    :style="{
      width: size + 'px',
      height: size + 'px',
      borderRadius: Math.max(4, size * 0.15) + 'px',
      fontSize: size * 0.42 + 'px',
      background: bg,
    }"
  >
    <img v-if="isImage" :src="src" :alt="name" loading="lazy" />
    <span v-else-if="isEmoji">{{ emoji }}</span>
    <span v-else>{{ letter }}</span>
  </div>
</template>

<style scoped>
.avatar {
  flex-shrink: 0;
  color: #fff;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.avatar.emoji {
  background: #07c160 !important;
  font-size: 1.15em;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
