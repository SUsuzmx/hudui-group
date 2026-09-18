// 探测生图接口正确格式
import fs from 'node:fs';
const cfg = JSON.parse(fs.readFileSync('config/ai.json', 'utf8'));

async function tryCompatible() {
  const res = await fetch(cfg.baseURL + '/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: 'qwen-image-2.0-pro', prompt: 'a cute orange cat wearing sunglasses', n: 1, size: '1024*1024' }),
  });
  console.log('[compatible /images/generations] HTTP', res.status);
  console.log((await res.text()).slice(0, 600));
}

async function tryMultimodal() {
  const res = await fetch(cfg.nativeBase + '/services/aigc/multimodal-generation/generation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: 'qwen-image-2.0-pro',
      input: { messages: [{ role: 'user', content: [{ text: 'a cute orange cat wearing sunglasses' }] }] },
    }),
  });
  console.log('[native multimodal-generation] HTTP', res.status);
  console.log((await res.text()).slice(0, 600));
}

await tryCompatible().catch((e) => console.log('compatible ERR:', e.message));
await tryMultimodal().catch((e) => console.log('multimodal ERR:', e.message));
process.exit(0);
