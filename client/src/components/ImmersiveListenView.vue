<script setup>
</script>

<template>
  <div class="page immersive-page">
    <iframe
      class="folia-frame"
      src="/folia/"
      title="沉浸式听歌"
      allow="autoplay; fullscreen; encrypted-media; clipboard-write"
    ></iframe>
  </div>
</template>

<style scoped>
/* 全屏融入 Folia 的暗色视觉（背景 #09090b）：不显示宿主标题栏，也不放宿主返回按钮，
   返回依赖 Folia 自己的 UI 或系统/手势后退（nav-stack 的 popstate 会触发 goBack） */
.page { flex: 1; display: flex; flex-direction: column; min-height: 0; background: #09090b; width: 100%; position: relative; }
.folia-frame { flex: 1 1 auto; width: 100%; min-height: 0; border: 0; background: #09090b; }
</style>
