// 用 node:sqlite? 不, 用纯 JS 生成纯色圆角图标 PNG —— 避免引入额外依赖。
// 通过最小编码器手写 PNG 太繁琐, 这里用 canvas 也不行(无浏览器), 所以直接用
// 内置 zlib + 手写 PNG chunk 生成简单的"绿色圆角方块+白色气泡"图标。
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function makeIcon(size) {
  const r = size * 0.22;
  const cx = size / 2, cy = size / 2;
  const rows = [];
  const inRoundedRect = (x, y, x0, y0, x1, y1, rad) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const dx = Math.max(x0 + rad - x, 0, x - (x1 - rad));
    const dy = Math.max(y0 + rad - y, 0, y - (y1 - rad));
    return dx * dx + dy * dy <= rad * rad;
  };
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4, 255); // filter 0 + RGBA
    for (let x = 0; x < size; x++) {
      let cr, cg, cb, ca = 0;
      if (inRoundedRect(x, y, 0, 0, size - 1, size - 1, r)) {
        [cr, cg, cb, ca] = [0x07, 0xc1, 0x60, 255]; // #07C160
        // 白色气泡(椭圆 + 小尾巴)
        const ex = (x - cx) / (size * 0.34), ey = (y - cy * 0.94) / (size * 0.26);
        const tailY = cy * 0.94 + size * 0.26;
        const tail = x > cx - size * 0.16 && x < cx - size * 0.02 &&
          y > tailY - size * 0.02 && y < tailY + size * 0.1 &&
          (x - (cx - size * 0.02)) > (y - tailY) * 1.1;
        if (ex * ex + ey * ey <= 1 || tail) [cr, cg, cb, ca] = [255, 255, 255, 255];
      }
      const o = 1 + x * 4;
      row[o] = cr ?? 0; row[o + 1] = cg ?? 0; row[o + 2] = cb ?? 0; row[o + 3] = ca;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const s of [192, 512]) {
  fs.writeFileSync(path.join(OUT, `icon-${s}.png`), makeIcon(s));
  console.log(`icon-${s}.png done`);
}
