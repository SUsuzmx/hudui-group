// 日志轮转：超过阈值改名为 .1，避免 data/*.log 无限膨胀
// 用法: node scripts/rotate-logs.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'data');
const MAX = Number(process.env.LOG_MAX_BYTES) || 5 * 1024 * 1024;

const targets = ['app.log', 'service.log', 'boot.log', 'cloudflared-err.log', 'app-boot-err.log'];

function rotate(file) {
  const p = path.join(DATA, file);
  try {
    const st = fs.statSync(p);
    if (st.size < MAX) {
      console.log(`ok  ${file} (${(st.size / 1024).toFixed(0)}KB)`);
      return;
    }
    const bak = `${p}.1`;
    fs.rmSync(bak, { force: true });
    fs.renameSync(p, bak);
    console.log(`rotated ${file} (${(st.size / 1024 / 1024).toFixed(1)}MB -> .1)`);
  } catch {
    console.log(`skip ${file}`);
  }
}

for (const f of targets) rotate(f);
