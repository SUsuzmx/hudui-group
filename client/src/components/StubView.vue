<script setup>
const props = defineProps({
  title: { type: String, default: '功能页' },
});
const emit = defineEmits(['back']);
</script>

<template>
  <div class="page">
    <header class="nav-bar">
      <button class="icon-btn nav-back" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title">{{ title }}</div>
      <div class="nav-right"></div>
    </header>
    <main class="content">
      <div class="empty-icon">💬</div>
      <p class="text">{{ title }}</p>
      <p class="sub">该入口已接入导航，完整业务可继续扩展</p>
      <button class="btn" @click="emit('back')">返回</button>
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
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
}
.empty-icon {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: var(--white);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  color: var(--text-3);
}
.text { font-size: 16px; color: var(--text); }
.sub { font-size: 13px; color: var(--text-2); text-align: center; }
.btn {
  margin-top: 16px;
  background: #07c160;
  color: #fff;
  border-radius: 8px;
  padding: 10px 28px;
  font-size: 15px;
  min-height: 44px;
}
.btn:active { background: #06ad56; }
</style>
