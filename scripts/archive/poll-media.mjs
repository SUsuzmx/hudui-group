// 轮询刚才的生图任务 + 探测视频
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'ai.json'), 'utf8'));
const native = cfg.nativeBase.replace(/\/$/, '');
const key = cfg.apiKey;

async function poll(taskId, label) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(`${native}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const t = await res.json();
    const status = t?.output?.task_status;
    console.log(`[${label}] ${status}`, JSON.stringify(t?.output ?? t).slice(0, 300));
    if (status === 'SUCCEEDED') {
      const url = t.output?.results?.[0]?.url ?? t.output?.video_url;
      console.log(`  URL: ${url}`);
      return url;
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') return null;
  }
  console.log(`[${label}] timeout`);
  return null;
}

// 刚才创建的任务
const tasks = [
  ['wanx2.1-t2i-turbo', 'ca097ac5-66c3-4fb8-ac10-6c4bc517c694'],
  ['qwen-image', '473e76ac-5619-4f24-8dd4-37738a46409d'],
  ['wanx2.1-t2i-plus', '336a9649-011c-423b-a00d-932645619f57'],
];

for (const [model, id] of tasks) {
  const url = await poll(id, model);
  if (url) {
    // 下载验证
    try {
      const r = await fetch(url);
      const buf = Buffer.from(await r.arrayBuffer());
      console.log(`  downloaded ${buf.length} bytes, content-type=${r.headers.get('content-type')}`);
    } catch (e) {
      console.log(`  download fail: ${e.message}`);
    }
    break; // 有一个成功就够
  }
}

// 探测视频模型
console.log('\n=== video probe ===');
for (const model of ['wan2.2-i2v-plus', 'wan2.1-i2v-plus', 'wan2.1-i2v-flash', 'wan2.2-t2v-plus', 'wan2.1-t2v-turbo']) {
  try {
    const res = await fetch(`${native}/services/aigc/video-generation/video-synthesis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model,
        input: { prompt: '一只橘猫在草地上打滚，阳光明媚' },
      }),
    });
    const t = await res.json();
    console.log(`[vid ${model}] ${res.status}`, JSON.stringify(t).slice(0, 250));
  } catch (e) {
    console.log(`[vid ${model}] ERR ${e.message}`);
  }
}

process.exit(0);
