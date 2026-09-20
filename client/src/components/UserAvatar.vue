<script setup>
import { computed } from 'vue';

const DEFAULT_AVATAR = '/avatars/amdin.png';

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
  if (!isImage.value) {
    // 无图片时：AI/emoji 走 emoji，否则默认头像或首字母
    return '';
  }
  const a = props.avatar;
  if (a.startsWith('/') || a.startsWith('data:') || a.startsWith('http')) return a;
  return `/avatars/${encodeURIComponent(a)}`;
});
// 默认头像：用户无自定义头像时展示 amdin.png
const useDefaultAvatar = computed(() => {
  if (isImage.value || isEmoji.value) return false;
  // 名称存在但没有头像文件 → 默认图
  return Boolean(props.name);
});
const letter = computed(() => props.name?.slice(0, 1) ?? '?');
const bg = computed(() => {
  if (isImage.value || useDefaultAvatar.value) return 'transparent';
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
    <img v-if="isImage" :src="src" :alt="name" loading="lazy" @error="$event.target.style.display='none'" />
    <img v-else-if="useDefaultAvatar" :src="DEFAULT_AVATAR" :alt="name" loading="lazy" />
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
  background: var(--divider-soft, #f0f0f0);
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
  background: #e8e8e8;
}
</style>
