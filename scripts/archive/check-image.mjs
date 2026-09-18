// 验证生图链路: 走 media.js 的 genImage, 检查产物落盘。
import { genImage } from '../server/ai/media.js';
import fs from 'node:fs';

const t0 = Date.now();
const url = await genImage('一只戴墨镜的橘猫坐在便利店门口喝冰可乐，赛博朋克霓虹灯，手机随手拍风格');
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s, url = ${url}`);
if (url) {
  const f = 'data' + url.slice('/media'.length);
  console.log('文件大小:', fs.existsSync('C:/perry/' + f) ? fs.statSync('C:/perry/' + f).size + ' bytes' : 'MISSING');
}
process.exit(url ? 0 : 1);
