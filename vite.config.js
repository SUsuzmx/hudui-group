import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

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
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
