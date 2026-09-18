// 深入探测生图/特殊视频接口
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'ai.json'), 'utf8'));
const native = cfg.nativeBase.replace(/\/$/, '');
const compat = cfg.baseURL.replace(/\/$/, '');
const key = cfg.apiKey;

async function post(url, body, headers = {}) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        ...headers,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* raw */ }
    return { status: res.ok, code: res.status, json, text: text.slice(0, 180) };
  } catch (e) {
    return { status: false, code: 0, text: e.message };
  }
}

// 1) 已知可用基线
console.log('=== baseline wanx2.1-t2i-turbo ===');
let r = await post(`${native}/services/aigc/text2image/image-synthesis`, {
  model: 'wanx2.1-t2i-turbo',
  input: { prompt: '一只可爱的橘猫' },
  parameters: { n: 1, size: '1024*1024' },
}, { 'X-DashScope-Async': 'enable' });
console.log(r.code, r.text);

// 2) qwen-image 用 multimodal
console.log('\n=== qwen-image multimodal ===');
r = await post(`${native}/services/aigc/multimodal-generation/generation`, {
  model: 'qwen-image',
  input: { prompt: '一只可爱的橘猫' },
});
console.log(r.code, r.text);

// 3) qwen-image-2.0-pro 用 multimodal
console.log('\n=== qwen-image-2.0-pro multimodal ===');
r = await post(`${native}/services/aigc/multimodal-generation/generation`, {
  model: 'qwen-image-2.0-pro',
  input: { prompt: '一只可爱的橘猫' },
});
console.log(r.code, r.text);

// 4) wan2.7-image 用不同 size / 不带 parameters
console.log('\n=== wan2.7-image no params ===');
r = await post(`${native}/services/aigc/text2image/image-synthesis`, {
  model: 'wan2.7-image',
  input: { prompt: '一只可爱的橘猫' },
}, { 'X-DashScope-Async': 'enable' });
console.log(r.code, r.text);

console.log('\n=== wan2.7-image 1024*1024 ===');
r = await post(`${native}/services/aigc/text2image/image-synthesis`, {
  model: 'wan2.7-image',
  input: { prompt: '一只可爱的橘猫' },
  parameters: { size: '1024*1024' },
}, { 'X-DashScope-Async': 'enable' });
console.log(r.code, r.text);

// 5) 兼容模式 qwen-image
console.log('\n=== compat qwen-image ===');
r = await post(`${compat}/images/generations`, {
  model: 'qwen-image',
  prompt: '一只可爱的橘猫',
  n: 1,
  size: '1024*1024',
});
console.log(r.code, r.text);

// 6) 兼容模式 qwen-image-2.0-pro
console.log('\n=== compat qwen-image-2.0-pro ===');
r = await post(`${compat}/images/generations`, {
  model: 'qwen-image-2.0-pro',
  prompt: '一只可爱的橘猫',
  n: 1,
  size: '1024*1024',
});
console.log(r.code, r.text);

// 7) wan2.6-image 原生
console.log('\n=== wan2.6-image native ===');
r = await post(`${native}/services/aigc/text2image/image-synthesis`, {
  model: 'wan2.6-image',
  input: { prompt: '一只可爱的橘猫' },
  parameters: { n: 1, size: '1024*1024' },
}, { 'X-DashScope-Async': 'enable' });
console.log(r.code, r.text);

// 8) 特殊视频: animate 需要 image_url
console.log('\n=== wan2.2-animate-move with img ===');
r = await post(`${native}/services/aigc/video-generation/video-synthesis`, {
  model: 'wan2.2-animate-move',
  input: {
    prompt: '人物跳舞',
    image_url: 'https://dashscope.oss-cn-beijing.aliyuncs.com/images/dog_and_girl.jpeg',
  },
}, { 'X-DashScope-Async': 'enable' });
console.log(r.code, r.text);

console.log('\n=== wan2.2-s2v with audio/img ===');
r = await post(`${native}/services/aigc/video-generation/video-synthesis`, {
  model: 'wan2.2-s2v',
  input: {
    image_url: 'https://dashscope.oss-cn-beijing.aliyuncs.com/images/dog_and_girl.jpeg',
    audio_url: 'https://dashscope.oss-cn-beijing.aliyuncs.com/audios/welcome.wav',
  },
}, { 'X-DashScope-Async': 'enable' });
console.log(r.code, r.text);
