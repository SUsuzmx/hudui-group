import { createRequire } from 'node:module';
import { readCookieFile } from '../server/providers/common.js';

const require = createRequire(import.meta.url);
const kugou = require('../server/providers/kugou-api.cjs');
const cookie = readCookieFile('kugou');

// 直接打 gateway 看原始响应
const auth = kugou.extractKugouAuth ? kugou.extractKugouAuth(cookie) : null;
console.log('auth', auth && { userid: auth.userid, tokenLen: (auth.token || '').length, playbackReady: auth.playbackReady });

const r = await kugou.handleKugouUserPlaylists(cookie);
console.log('result', JSON.stringify({
  error: r.error,
  upstreamCode: r.upstreamCode,
  message: r.message,
  n: (r.playlists || []).length,
}, null, 2));
