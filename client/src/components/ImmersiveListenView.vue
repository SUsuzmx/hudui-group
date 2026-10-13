<script setup>
const emit = defineEmits(['back']);
</script>

<template>
  <div class="page immersive-page">
    <header class="nav">
      <button class="nav-back" type="button" @click="emit('back')">‹</button>
      <div class="nav-title">沉浸式听歌</div>
      <div class="nav-actions"></div>
    </header>
    <iframe
      class="folia-frame"
      src="/folia/"
      title="沉浸式听歌"
      allow="autoplay; fullscreen; encrypted-media; clipboard-write"
    ></iframe>
  </div>
</template>

<style scoped>
/* 顶栏跟随 Folia 的暗色视觉（背景 #09090b），与 iframe 内播放器融为一体 */
.page { flex: 1; display: flex; flex-direction: column; min-height: 0; background: #09090b; width: 100%; position: relative; }
.nav {
  height: var(--nav-h); flex-shrink: 0; position: relative; display: flex; align-items: center;
  padding: 0 8px; background: #09090b; border-bottom: none;
}
.nav::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 1px; background: rgba(255, 255, 255, 0.06); }
.nav-back { width: 40px; height: 44px; border: 0; background: transparent; color: rgba(255, 255, 255, 0.88); font-size: 28px; line-height: 1; }
.nav-title { position: absolute; left: 50%; transform: translateX(-50%); font-size: 15px; font-weight: 500; letter-spacing: 0.02em; color: rgba(255, 255, 255, 0.72); }
.nav-actions { margin-left: auto; display: flex; gap: 6px; align-items: center; }
.folia-frame { flex: 1 1 auto; width: 100%; min-height: 0; border: 0; background: #09090b; }
</style>
