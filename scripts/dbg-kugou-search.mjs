import { createRequire } from 'node:module';
import { readCookieFile } from '../server/providers/common.js';

const require = createRequire(import.meta.url);
const kugou = require('../server/providers/kugou-api.cjs');
const cookie = readCookieFile('kugou');

const s = await kugou.handleKugouSearch('周杰伦', 5, cookie, 0).catch((e) => e);
console.log('search', Array.isArray(s) ? s.length : s.message || s.error);
const p = await kugou.handleKugouUserPlaylists(cookie);
console.log('playlists', (p.playlists || []).length, 'err', p.error, 'code', p.upstreamCode);
