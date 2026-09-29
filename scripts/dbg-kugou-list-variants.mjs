import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { readCookieFile } from '../server/providers/common.js';

const require = createRequire(import.meta.url);
const kugou = require('../server/providers/kugou-api.cjs');
const cookie = readCookieFile('kugou');
const auth = kugou.extractKugouAuth(cookie);
console.log('userid', auth.userid, 'token', auth.token.slice(0, 8), 'mid', auth.mid);

// 试几种 type，看 20017 是否参数问题
const KUGOU_GATEWAY = 'https://gateway.kugou.com';

function signH5(params, bodyObj) {
  const parts = Object.keys(params).sort().map((k) => `${k}=${params[k]}`);
  if (bodyObj && typeof bodyObj === 'object') parts.push(JSON.stringify(bodyObj));
  // 与 kugou-api 相同 salt，若失败再试直接请求看错误
  return crypto.createHash('md5').update(`3100c3252b5611119a25b11113311111${parts.join('')}3100c3252b5611119a25b11113311111`).digest('hex');
}

async function tryList(type, extraBody = {}) {
  const params = {
    srcappid: 2919,
    clientver: 20000,
    clienttime: Math.floor(Date.now() / 1000),
    mid: auth.mid,
    uuid: '-',
    dfid: auth.dfid || '-',
  };
  const bodyObj = {
    userid: Number(auth.userid),
    token: auth.token,
    total_ver: 979,
    type,
    page: 1,
    pagesize: 20,
    ...extraBody,
  };
  params.signature = signH5(params, bodyObj);
  const u = new URL('/v7/get_all_list', KUGOU_GATEWAY);
  Object.keys(params).forEach((k) => u.searchParams.set(k, String(params[k])));
  const res = await fetch(u.toString(), {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
      'x-router': 'cloudlist.service.kugou.com',
      'Content-Type': 'application/json',
      Cookie: `KugooID=${auth.userid}; token=${auth.token}; kg_mid=${auth.mid}; kg_dfid=${auth.dfid || '-'}`,
    },
    body: JSON.stringify(bodyObj),
  });
  const text = await res.text();
  console.log('type', type, extraBody, '→', text.slice(0, 280));
}

for (const t of [1, 2, 3]) {
  await tryList(t);
  await new Promise((r) => setTimeout(r, 400));
}
await tryList(2, { total_ver: 1 });
await tryList(2, { is_pad: 0 });
