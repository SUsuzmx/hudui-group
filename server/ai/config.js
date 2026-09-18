// AI 配置加载: 配置文件 + 环境变量覆盖, mtime 缓存。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../db.js';

const cfgPath = path.join(ROOT, 'config', 'ai.json');
let cache = null;
let cacheMtime = 0;

function readCfg() {
  try {
    const st = fs.statSync(cfgPath);
    if (cache && st.mtimeMs === cacheMtime) return cache;
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cacheMtime = st.mtimeMs;
    cache = applyEnv(raw);
    return cache;
  } catch {
    if (cache) return cache;
    cache = applyEnv({});
    cacheMtime = Date.now();
    return cache;
  }
}

function applyEnv(raw) {
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.AI_API_KEY || raw.apiKey || '';
  return { ...raw, apiKey };
}

export function loadAiCfg() {
  return readCfg();
}

export function aiConfigEnabled(cfg = readCfg()) {
  return Boolean(cfg.apiKey && cfg.baseURL && cfg.models?.length);
}

export function mediaConfigEnabled(cfg = readCfg()) {
  return Boolean(cfg.apiKey);
}
