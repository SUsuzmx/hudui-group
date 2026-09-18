// 探测生图/视频可用接口与模型
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'ai.json'), 'utf8'));

async function tryFetch(label, url, options) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    console.log(`\n[${label}] ${res.status} ${url}`);
    console.log(text.slice(0, 400));
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    console.log(`\n[${label}] ERROR ${url}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

const base = cfg.baseURL.replace(/\/$/, '');
const native = cfg.nativeBase.replace(/\/$/, '');
const key = cfg.apiKey;

// 1. 列模型 (兼容模式)
await tryFetch('list-models', `${base}/models`, {
  headers: { Authorization: `Bearer ${key}` },
});

// 2. 试几个常见生图模型名
const imageCandidates = [
  'wanx2.1-t2i-turbo',
  'wanx2.1-t2i-plus',
  'wanx-v1',
  'qwen-image',
  'qwen-image-plus',
  'qwen-image-edit',
  'flux-schnell',
  'stable-diffusion-xl',
  ...(cfg.imageModels ?? []),
];

for (const model of imageCandidates.slice(0, 6)) {
  await tryFetch(`img-compat:${model}`, `${base}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, prompt: '一只可爱的橘猫', n: 1, size: '1024*1024' }),
  });
}

// 3. DashScope 原生 text2image
for (const model of ['wanx2.1-t2i-turbo', 'qwen-image', 'wanx2.1-t2i-plus']) {
  await tryFetch(`native-img:${model}`, `${native}/services/aigc/text2image/image-synthesis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({ model, input: { prompt: '一只可爱的橘猫' }, parameters: { n: 1, size: '1024*1024' } }),
  });
}

console.log('\n=== probe done ===');
