import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import fs from 'node:fs';

// 后端端口以 config/app.json 为准，避免 dev 代理写死导致端口漂移
function backendPort() {
  try {
    const cfg = JSON.parse(fs.readFileSync(new URL('./config/app.json', import.meta.url), 'utf8'));
    return Number(process.env.PORT) || Number(cfg.port) || 3010;
  } catch {
    return Number(process.env.PORT) || 3010;
  }
}
const API_TARGET = `http://localhost:${backendPort()}`;

export default defineConfig({
  plugins: [vue()],
  root: 'client',
  base: '/',
  build: {
    outDir: '../client-dist',
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/vue') || id.includes('node_modules/@vue')) return 'vue';
          if (id.includes('node_modules/socket.io') || id.includes('node_modules/engine.io')) return 'socket';
          // 拼音表体积偏大，单独成包（通讯录动态 import / 朋友圈按需）
          if (id.includes('pinyin-initial')) return 'pinyin';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': API_TARGET,
      '/socket.io': { target: API_TARGET, ws: true },
    },
  },
});
