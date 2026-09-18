// 下载可公开使用的头像到 img/, 并按人设命名
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const IMG = path.join(ROOT, 'img');
fs.mkdirSync(IMG, { recursive: true });

// randomuser.me 肖像 (CC0 风格公开图库, 常用于演示)
// 也用 pravatar / thispersondoesnotexist 备选
const targets = [
  // 核心群友
  { file: '思琪.jpg', url: 'https://randomuser.me/api/portraits/women/44.jpg' },
  { file: 'Perry.jpg', url: 'https://randomuser.me/api/portraits/men/32.jpg' },
  { file: '像牛奶不是牛奶.png', url: 'https://randomuser.me/api/portraits/women/68.jpg' },
  // 群成员
  { file: '小辣椒.jpg', url: 'https://randomuser.me/api/portraits/women/21.jpg' },
  { file: '妈妈.jpg', url: 'https://randomuser.me/api/portraits/women/65.jpg' },
  { file: '爸爸.jpg', url: 'https://randomuser.me/api/portraits/mens/54.jpg' },
  { file: '王也.jpg', url: 'https://randomuser.me/api/portraits/men/22.jpg' },
  { file: '叶修.jpg', url: 'https://randomuser.me/api/portraits/men/41.jpg' },
  { file: '方圆.jpg', url: 'https://randomuser.me/api/portraits/women/33.jpg' },
  { file: '阿强.jpg', url: 'https://randomuser.me/api/portraits/men/75.jpg' },
  // 通讯录 AI
  { file: '林晓.jpg', url: 'https://randomuser.me/api/portraits/women/12.jpg' },
  { file: '周凯.jpg', url: 'https://randomuser.me/api/portraits/men/18.jpg' },
  { file: '陈总.jpg', url: 'https://randomuser.me/api/portraits/men/86.jpg' },
  { file: '苏老师.jpg', url: 'https://randomuser.me/api/portraits/women/90.jpg' },
  { file: '学霸小北.jpg', url: 'https://randomuser.me/api/portraits/men/29.jpg' },
  { file: '姐姐.jpg', url: 'https://randomuser.me/api/portraits/women/79.jpg' },
  { file: '舅舅.jpg', url: 'https://randomuser.me/api/portraits/men/62.jpg' },
  { file: '阿哲.jpg', url: 'https://randomuser.me/api/portraits/men/11.jpg' },
  { file: '小雨.jpg', url: 'https://randomuser.me/api/portraits/women/17.jpg' },
  { file: '广告小哥.jpg', url: 'https://randomuser.me/api/portraits/men/36.jpg' },
  { file: '小米客服.jpg', url: 'https://randomuser.me/api/portraits/women/25.jpg' },
  { file: '房产顾问.jpg', url: 'https://randomuser.me/api/portraits/men/52.jpg' },
];

async function downloadOne(t) {
  const dest = path.join(IMG, t.file);
  try {
    const res = await fetch(t.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000) throw new Error('too small ' + buf.length);
    fs.writeFileSync(dest, buf);
    console.log('OK', t.file, buf.length);
    return true;
  } catch (e) {
    console.log('FAIL', t.file, e.message);
    return false;
  }
}

let ok = 0;
for (const t of targets) {
  if (await downloadOne(t)) ok += 1;
  await new Promise((r) => setTimeout(r, 120));
}
console.log(`done ${ok}/${targets.length}`);
process.exit(ok >= 15 ? 0 : 1);
