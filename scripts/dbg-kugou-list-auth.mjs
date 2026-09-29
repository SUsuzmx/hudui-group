import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { readCookieFile } from '../server/providers/common.js';

const require = createRequire(import.meta.url);
const kugou = require('../server/providers/kugou-api.cjs');
const cookie = readCookieFile('kugou');
const auth = kugou.extractKugouAuth(cookie);

const H5_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
const ANDROID_SALT = 'OIlwieks28dk2k092lksi2UIkp';

function signH5(params, bodyObj) {
  const parts = Object.keys(params).sort().map((k) => `${k}=${params[k]}`);
  if (bodyObj && typeof bodyObj === 'object') parts.push(JSON.stringify(bodyObj));
  return crypto.createHash('md5').update(`${H5_SALT}${parts.join('')}${H5_SALT}`).digest('hex');
}

function signAndroid(params, body) {
  const paramsString = Object.keys(params).sort().map((k) => `${k}=${typeof params[k] === 'object' ? JSON.stringify(params[k]) : params[k]}`).join('');
  return crypto.createHash('md5').update(`${ANDROID_SALT}${paramsString}${body || ''}${ANDROID_SALT}`).digest('hex');
}

const cookieStr = kugou.buildKugouRequestCookie
  ? kugou.buildKugouRequestCookie(cookie)
  : `KugooID=${auth.userid}; token=${auth.token}; kg_mid=${auth.mid}; kg_dfid=${auth.dfid}`;

async function tryOne(label, mode) {
  const now = Date.now();
  const bodyObj = {
    userid: Number(auth.userid),
    token: auth.token,
    total_ver: 979,
    type: 2,
    page: 1,
    pagesize: 20,
  };
  const bodyText = JSON.stringify(bodyObj);
  let params;
  if (mode === 'h5') {
    params = {
      srcappid: '2919',
      clientver: '20000',
      clienttime: now,
      mid: auth.mid,
      uuid: String(now),
      dfid: auth.dfid || '-',
      appid: 1014,
      token: auth.token,
      userid: Number(auth.userid),
      plat: '1',
    };
    params.signature = signH5(params, bodyObj);
  } else {
    params = {
      dfid: auth.dfid || '-',
      mid: auth.mid,
      uuid: '-',
      appid: 1005,
      clientver: 20489,
      clienttime: Math.floor(now / 1000),
      token: auth.token,
      userid: Number(auth.userid) || 0,
      plat: '1',
    };
    params.signature = signAndroid(params, bodyText);
  }
  const u = new URL('/v7/get_all_list', 'https://gateway.kugou.com');
  Object.keys(params).forEach((k) => u.searchParams.set(k, String(params[k])));
  const res = await fetch(u.toString(), {
    method: 'POST',
    headers: {
      'User-Agent': mode === 'h5'
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
        : 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi',
      'x-router': 'cloudlist.service.kugou.com',
      'Content-Type': 'application/json',
      Cookie: cookieStr,
    },
    body: bodyText,
  });
  const text = await res.text();
  console.log(label, res.status, text.slice(0, 300));
}

await tryOne('h5-orig', 'h5');
await new Promise((r) => setTimeout(r, 500));
await tryOne('android', 'android');
