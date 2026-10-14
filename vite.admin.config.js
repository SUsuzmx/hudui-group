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

// 运营后台独立构建：产物 admin-dist，由 Express 挂在 /admin 与后台独立域名根路径
export default defineConfig({
  plugins: [vue()],
  root: 'admin',
  base: '/admin/',
  build: {
    outDir: '../admin-dist',
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/vue') || id.includes('node_modules/@vue')) return 'vue';
        },
      },
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': API_TARGET,
    },
  },
});
