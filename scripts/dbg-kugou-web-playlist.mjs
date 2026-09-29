import { createRequire } from 'node:module';
import { readCookieFile } from '../server/providers/common.js';

const require = createRequire(import.meta.url);
const kugou = require('../server/providers/kugou-api.cjs');
const cookie = readCookieFile('kugou');
const auth = kugou.extractKugouAuth(cookie);
const cookieStr = kugou.buildKugouRequestCookie(cookie);

const urls = [
  'https://www.kugou.com/yy/rank/home/1-8888.html',
  `https://m.kugou.com/mcomment/index?userid=${auth.userid}`,
  `https://www2.kugou.kugou.com/app/rank2/list.html?rankid=8888`,
];

// 试官方网页接口拿用户歌单
const web = `https://www.kugou.com/yy/html/static/html/home/personal.html`;
try {
  const r = await fetch(web, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Cookie: cookieStr,
      Referer: 'https://www.kugou.com/',
    },
  });
  console.log('web personal', r.status, (await r.text()).slice(0, 120));
} catch (e) {
  console.log('web err', e.message);
}

// 尝试 openapi 变体
const open = new URL('https://gateway.kugou.com/v1/get_list_baseinfo');
open.searchParams.set('listid', '0');
open.searchParams.set('appid', '1005');
open.searchParams.set('clientver', '20489');
open.searchParams.set('token', auth.token);
open.searchParams.set('userid', auth.userid);
open.searchParams.set('mid', auth.mid);
open.searchParams.set('clienttime', String(Math.floor(Date.now() / 1000)));
try {
  const r = await fetch(open.toString(), {
    headers: {
      'User-Agent': 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi',
      Cookie: cookieStr,
    },
  });
  console.log('baseinfo', r.status, (await r.text()).slice(0, 200));
} catch (e) {
  console.log('baseinfo err', e.message);
}
