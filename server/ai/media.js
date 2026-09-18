// 媒体生成: 生图/视频走 DashScope 原生异步接口。
// 按顺序故障转移, 单模型失败冷却 10 分钟后重试。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../db.js';
import { loadAiCfg, mediaConfigEnabled } from './config.js';

const MEDIA_DIR = path.join(ROOT, 'data', 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

function loadCfg() {
  return loadAiCfg();
}

export function isMediaEnabled() {
  return mediaConfigEnabled(loadAiCfg());
}

// 兼容旧布尔引用: 模块加载时求值; 热更新请用 isMediaEnabled()
export const mediaEnabled = mediaConfigEnabled(loadAiCfg());

const TIMEOUT_MS = 60_000;
const TASK_TIMEOUT_MS = 180_000;
const POLL_MS = 5_000;
const MODEL_COOLDOWN_MS = 600_000;

const blockedUntil = new Map(); // `${kind}:${model}` -> ts

function isBlocked(kind, model, now = Date.now()) {
  return (blockedUntil.get(`${kind}:${model}`) ?? 0) > now;
}

function blockModel(kind, model) {
  blockedUntil.set(`${kind}:${model}`, Date.now() + MODEL_COOLDOWN_MS);
  console.log(`[media] 冷却 ${kind}:${model} 10分钟`);
}

function pickModels(kind, preferred = null) {
  const cfg = loadCfg();
  const all =
    kind === 'image' ? (cfg.imageModels ?? [])
    : kind === 't2v' ? (cfg.videoModels ?? [])
    : kind === 'i2v' ? (cfg.i2vModels ?? [])
    : [];
  const now = Date.now();
  const pool = (preferred?.length ? preferred : all).filter((m) => all.includes(m) || preferred?.includes(m));
  const usable = (pool.length ? pool : all).filter((m) => !isBlocked(kind, m, now));
  return usable.length ? usable : all; // 全被冷却时仍尝试, 避免完全停摆
}

async function fetchJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function downloadTo(url, filename) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS * 2);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error('下载内容过小, 疑似无效');
    const file = path.join(MEDIA_DIR, filename);
    fs.writeFileSync(file, buf);
    return `/media/${filename}`;
  } finally {
    clearTimeout(timer);
  }
}

async function pollTask(taskId, filename) {
  if (!taskId) throw new Error('没有 task_id');
  const deadline = Date.now() + TASK_TIMEOUT_MS;
  const cfg = loadCfg();
  const base = String(cfg.nativeBase || '').replace(/\/$/, '');
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const t = await fetchJson(`${base}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    const status = t?.output?.task_status;
    if (status === 'SUCCEEDED') {
      const url = t.output?.results?.[0]?.url ?? t.output?.video_url;
      if (!url) throw new Error('任务成功但没有产物 URL');
      return await downloadTo(url, filename);
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      const msg = t.output?.message ?? t.output?.code ?? status;
      throw new Error(`任务失败: ${msg}`);
    }
  }
  throw new Error('任务超时');
}

async function createNativeTask(endpoint, model, body) {
  const cfg = loadCfg();
  const base = String(cfg.nativeBase || '').replace(/\/$/, '');
  return await fetchJson(`${base}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({ model, ...body }),
  });
}

async function tryImageModel(model, prompt, idx) {
  const name = `img-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
  console.log(`[media] 生图任务: ${model}`);
  const task = await createNativeTask(
    '/services/aigc/text2image/image-synthesis',
    model,
    { input: { prompt }, parameters: { n: 1, size: '1024*1024' } },
  );
  return await pollTask(task?.output?.task_id, `${name}.png`);
}

/**
 * 生图: preferred 可传人设/群分配的模型列表
 */
export async function genImage(prompt, preferred = null) {
  if (!isMediaEnabled()) return null;
  const models = pickModels('image', preferred);
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      const url = await tryImageModel(model, prompt, i);
      if (url) return url;
    } catch (err) {
      console.error(`[media] 生图 ${model} 失败: ${err.message}`);
      blockModel('image', model);
    }
  }
  return null;
}

async function tryT2V(model, prompt, idx) {
  console.log(`[media] 文生视频: ${model}`);
  const task = await createNativeTask(
    '/services/aigc/video-generation/video-synthesis',
    model,
    { input: { prompt } },
  );
  return await pollTask(task?.output?.task_id, `vid-${Date.now()}-${idx}.mp4`);
}

async function tryI2V(model, prompt, imgUrl, idx) {
  console.log(`[media] 图生视频: ${model}`);
  const task = await createNativeTask(
    '/services/aigc/video-generation/video-synthesis',
    model,
    { input: { prompt, img_url: imgUrl } },
  );
  return await pollTask(task?.output?.task_id, `vid-${Date.now()}-i2v-${idx}.mp4`);
}

/**
 * 视频: 优先文生视频; 可选传 imageUrl 走图生视频
 */
export async function genVideo(prompt, { preferred = null, imageUrl = null } = {}) {
  if (!isMediaEnabled()) return null;

  if (imageUrl) {
    const i2v = pickModels('i2v', preferred);
    for (let i = 0; i < i2v.length; i++) {
      try {
        const url = await tryI2V(i2v[i], prompt, imageUrl, i);
        if (url) return url;
      } catch (err) {
        console.error(`[media] 图生视频 ${i2v[i]} 失败: ${err.message}`);
        blockModel('i2v', i2v[i]);
      }
    }
  }

  const t2v = pickModels('t2v', preferred);
  for (let i = 0; i < t2v.length; i++) {
    try {
      const url = await tryT2V(t2v[i], prompt, i);
      if (url) return url;
    } catch (err) {
      console.error(`[media] 文生视频 ${t2v[i]} 失败: ${err.message}`);
      blockModel('t2v', t2v[i]);
    }
  }

  // 兜底: 先出图再 i2v
  const publicBase = (loadCfg().publicBase || '').replace(/\/$/, '');
  const imgUrl = await genImage(prompt, preferred);
  if (!imgUrl || !publicBase) return null;
  const publicImg = `${publicBase}${imgUrl}`;
  const i2v = pickModels('i2v');
  for (let i = 0; i < i2v.length; i++) {
    try {
      const url = await tryI2V(i2v[i], prompt, publicImg, i);
      if (url) return url;
    } catch (err) {
      console.error(`[media] 兜底图生视频 ${i2v[i]} 失败: ${err.message}`);
      blockModel('i2v', i2v[i]);
    }
  }
  return null;
}

export function getImageModels() {
  return loadCfg().imageModels ?? [];
}
export function getVideoModels() {
  return loadCfg().videoModels ?? [];
}
export function getI2vModels() {
  return loadCfg().i2vModels ?? [];
}
