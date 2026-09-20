<script setup>
const props = defineProps({
  open: { type: Boolean, default: false },
  name: { type: String, default: '文件' },
  url: { type: String, default: '' },
  sizeLabel: { type: String, default: '' },
  sender: { type: String, default: '' },
});
const emit = defineEmits(['close']);

function download() {
  if (!props.url) return;
  const a = document.createElement('a');
  a.href = props.url;
  a.download = props.name || 'file';
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function fileIcon() {
  const n = (props.name || '').toLowerCase();
  if (/\.(xlsx|xls|csv)$/.test(n)) return '📊';
  if (/\.(doc|docx)$/.test(n)) return '📝';
  if (/\.(ppt|pptx)$/.test(n)) return '📽';
  if (/\.pdf$/.test(n)) return '📕';
  if (/\.(png|jpe?g|gif|webp)$/.test(n)) return '🖼';
  if (/\.(mp3|wav|ogg)$/.test(n)) return '🎵';
  if (/\.(mp4|mov|webm)$/.test(n)) return '🎬';
  return '📄';
}
</script>

<template>
  <div v-if="open" class="fp-mask" @click.self="emit('close')">
    <div class="fp-page">
      <header class="fp-nav">
        <button class="fp-back" type="button" @click="emit('close')">‹</button>
        <div class="fp-title">文件预览</div>
        <div class="fp-side"></div>
      </header>
      <main class="fp-body">
        <div class="fp-icon">{{ fileIcon() }}</div>
        <div class="fp-name">{{ name }}</div>
        <div class="fp-meta">
          <span v-if="sizeLabel">{{ sizeLabel }}</span>
          <span v-if="sender">来自 {{ sender }}</span>
        </div>
        <div v-if="url" class="fp-hint">浏览器将打开该文件，或可下载到本地</div>
        <div v-else class="fp-hint">演示消息，暂无真实附件</div>
        <div class="fp-actions">
          <button v-if="url" class="fp-btn primary" type="button" @click="download">下载</button>
          <button v-if="url" class="fp-btn" type="button" @click="window.open(url, '_blank')">用其他应用打开</button>
          <button class="fp-btn ghost" type="button" @click="emit('close')">关闭</button>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.fp-mask {
  position: fixed; inset: 0; z-index: 70;
  background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.fp-page {
  width: min(360px, 100%);
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
}
.fp-nav {
  height: 48px; display: flex; align-items: center; justify-content: space-between;
  border-bottom: 0.5px solid #e5e5e5; padding: 0 6px;
}
.fp-back {
  width: 40px; height: 40px; border: 0; background: transparent;
  font-size: 26px; color: #111; cursor: pointer;
}
.fp-title { font-size: 16px; font-weight: 600; }
.fp-side { width: 40px; }
.fp-body { padding: 28px 20px 24px; text-align: center; }
.fp-icon { font-size: 56px; line-height: 1; margin-bottom: 12px; }
.fp-name {
  font-size: 16px; font-weight: 600; color: #111;
  word-break: break-all; line-height: 1.4;
}
.fp-meta {
  margin-top: 8px; font-size: 12px; color: #888;
  display: flex; flex-direction: column; gap: 2px;
}
.fp-hint { margin-top: 14px; font-size: 13px; color: #888; line-height: 1.5; }
.fp-actions {
  margin-top: 22px; display: grid; gap: 10px;
}
.fp-btn {
  min-height: 44px; border: 0; border-radius: 8px;
  background: #f2f2f2; color: #111; font-size: 15px; cursor: pointer;
}
.fp-btn.primary { background: #07c160; color: #fff; font-weight: 500; }
.fp-btn.ghost { background: transparent; color: #888; }
</style>
