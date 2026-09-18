// 快速探测用户提供的模型是否可创建任务
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'ai.json'), 'utf8'));
const native = cfg.nativeBase.replace(/\/$/, '');
const key = cfg.apiKey;

const llms = [
  'qwen3.7-max','qwen3.7-max-2026-06-08','qwen3.7-max-2026-05-20','qwen3.7-max-2026-05-17',
  'qwen3.7-max-preview','qwen3.7-flash','qwen3.7-flash-2026-07-15','qwen3.6-max-preview',
  'qwen3.6-plus','qwen3.6-plus-2026-04-02','qwen3.5-plus','qwen3.5-plus-2026-04-20',
];

const images = [
  'qwen-image-2.0-pro-2026-06-22','qwen-image-2.0-pro-2026-04-22','qwen-image-2.0-pro-2026-03-03',
  'wan2.7-image-pro','wan2.7-image','wan2.6-image','wan2.5-i2i-preview','wanx2.1-imageedit',
];

const t2v = [
  'wan2.6-t2v','wan2.5-t2v-preview','wan2.2-t2v-plus','wanx2.1-t2v-plus','wanx2.1-t2v-turbo',
];

const i2v = [
  'wan2.5-i2v-preview','wan2.6-i2v','wan2.2-i2v-flash','wan2.2-i2v-plus',
  'wanx2.1-i2v-turbo','wanx2.1-i2v-plus',
];

const special = [
  'wan2.2-animate-move','wan2.2-animate-mix','wan2.2-kf2v-flash','wan2.2-s2v','wanx2.1-kf2v-plus',
];

async function tryLLM(model) {
  try {
    const res = await fetch(`${cfg.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }),
    });
    const t = await res.text();
    return { model, ok: res.ok, status: res.status, msg: t.slice(0, 80) };
  } catch (e) {
    return { model, ok: false, status: 0, msg: e.message };
  }
}

async function tryTask(label, endpoint, model, body) {
  try {
    const res = await fetch(`${native}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({ model, ...body }),
    });
    const t = await res.json().catch(() => ({}));
    const taskId = t?.output?.task_id;
    return { model, ok: res.ok && Boolean(taskId), status: res.status, taskId, msg: JSON.stringify(t).slice(0, 100) };
  } catch (e) {
    return { model, ok: false, status: 0, msg: e.message };
  }
}

console.log('=== LLM ===');
for (const m of llms) {
  const r = await tryLLM(m);
  console.log(r.ok ? 'OK' : 'NO', r.status, m, r.msg);
}

console.log('\n=== IMAGE t2i ===');
for (const m of images) {
  const r = await tryTask('img', '/services/aigc/text2image/image-synthesis', m, {
    input: { prompt: '一只可爱的橘猫' },
    parameters: { n: 1, size: '1024*1024' },
  });
  console.log(r.ok ? 'OK' : 'NO', r.status, m, r.taskId || r.msg);
}

console.log('\n=== VIDEO t2v ===');
for (const m of t2v) {
  const r = await tryTask('t2v', '/services/aigc/video-generation/video-synthesis', m, {
    input: { prompt: '一只橘猫在草地上打滚' },
  });
  console.log(r.ok ? 'OK' : 'NO', r.status, m, r.taskId || r.msg);
}

console.log('\n=== VIDEO i2v ===');
for (const m of i2v) {
  const r = await tryTask('i2v', '/services/aigc/video-generation/video-synthesis', m, {
    input: { prompt: '动起来', img_url: 'https://dashscope.oss-cn-beijing.aliyuncs.com/images/dog_and_girl.jpeg' },
  });
  console.log(r.ok ? 'OK' : 'NO', r.status, m, r.taskId || r.msg);
}

console.log('\n=== VIDEO special ===');
for (const m of special) {
  const r = await tryTask('sp', '/services/aigc/video-generation/video-synthesis', m, {
    input: { prompt: '跳舞' },
  });
  console.log(r.ok ? 'OK' : 'NO', r.status, m, r.taskId || r.msg);
}
