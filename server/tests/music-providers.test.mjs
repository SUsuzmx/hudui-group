// 音源 provider 公共层单测（纯函数，无需起服务）
// 覆盖 server/providers/common.js：缓存、签名、Cookie 解析、会员归一、
// 限制分类、音频魔数探测、曲目同一性判定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryCache,
  md5,
  qqSearchSign,
  makePlayResult,
  classifyRestriction,
  normalizeNeteaseMembership,
  normalizeQqMembership,
  mergeMembership,
  matchAudioMagic,
  parseCookieString,
  normalizeCookieHeader,
  serializeCookieObject,
  joinCookiePairs,
  normalizeTitle,
  normalizeArtistSet,
  isSameRecording,
  remainingBudget,
  withTimeout,
  URL_CACHE_TTL_MS,
  NETEASE_QUALITY_LADDER,
  QQ_QUALITY_CANDIDATES,
} from '../providers/common.js';

test('MemoryCache 命中与过期', () => {
  const c = new MemoryCache();
  c.set('k', 'v', 1000);
  assert.equal(c.get('k'), 'v');
  c.set('gone', 'v', -1); // 立即过期
  assert.equal(c.get('gone'), undefined);
  assert.equal(c.get('missing'), undefined);
});

test('MemoryCache delete / clear', () => {
  const c = new MemoryCache();
  c.set('a', 1, 1000);
  c.delete('a');
  assert.equal(c.get('a'), undefined);
  c.set('b', 2, 1000);
  c.clear();
  assert.equal(c.get('b'), undefined);
});

test('md5 稳定且为 32 位十六进制', () => {
  assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.match(md5('任意中文'), /^[0-9a-f]{32}$/);
  assert.equal(md5(123), md5('123')); // 非字符串入参先 String()
});

test('qqSearchSign 是确定性的且带 zzc 前缀', () => {
  const a = qqSearchSign('{"comm":{"ct":24}}');
  const b = qqSearchSign('{"comm":{"ct":24}}');
  assert.equal(a, b);
  assert.ok(a.startsWith('zzc'));
  assert.match(a, /^[0-9a-z]+$/); // 已 toLowerCase，且去掉了 +/=
  assert.notEqual(a, qqSearchSign('{"comm":{"ct":25}}'));
});

test('qqSearchSign 对空输入不抛错', () => {
  assert.doesNotThrow(() => qqSearchSign(''));
  assert.doesNotThrow(() => qqSearchSign(undefined));
});

test('makePlayResult 只有 playable 且有 url 才算可播', () => {
  assert.equal(makePlayResult({ url: 'http://x/1.mp3' }).playable, false);
  assert.equal(makePlayResult({ playable: true, url: '' }).playable, false);
  assert.equal(makePlayResult({ playable: true, url: 'http://x/1.mp3' }).playable, true);
  assert.deepEqual(makePlayResult().probeFailures, []);
});

test('classifyRestriction：可播时无限制', () => {
  assert.equal(classifyRestriction({ playable: true, url: 'http://x/1.mp3' }), null);
});

test('classifyRestriction：分类与 action 对齐', () => {
  assert.equal(classifyRestriction({ category: 'verification_required' }).action, 'login');
  assert.equal(classifyRestriction({ copyrightOk: false }).category, 'copyright_unavailable');
  assert.equal(classifyRestriction({ needsLogin: true }).category, 'login_required');
  assert.equal(classifyRestriction({ paidRequired: true, loggedIn: true }).category, 'paid_required');
  assert.equal(classifyRestriction({ vipRequired: true, loggedIn: true }).category, 'vip_required');
  assert.equal(classifyRestriction({ trial: true, loggedIn: true }).category, 'trial_only');
  assert.equal(classifyRestriction({}).category, 'url_unavailable');
});

test('classifyRestriction：未登录 + 试听/会员 → 先要求登录', () => {
  assert.equal(classifyRestriction({ trial: true, loggedIn: false }).category, 'login_required');
  assert.equal(classifyRestriction({ vipRequired: true, loggedIn: false }).category, 'login_required');
});

test('normalizeNeteaseMembership 识别 svip / vip / 无', () => {
  assert.equal(normalizeNeteaseMembership(null).membershipKnown, false);
  assert.equal(normalizeNeteaseMembership({ vipType: 0 }).isVip, false);
  assert.equal(normalizeNeteaseMembership({ vipType: 11 }).isVip, true);
  assert.equal(normalizeNeteaseMembership({ vipType: 11 }).isSvip, false);
  assert.equal(normalizeNeteaseMembership({ vipType: 100 }).isSvip, true);
  assert.equal(normalizeNeteaseMembership({ svip: true }).vipLevel, 'svip');
  assert.equal(normalizeNeteaseMembership({ vipType: 11 }).vipLabel, 'VIP');
});

test('normalizeQqMembership 识别会员字段', () => {
  assert.equal(normalizeQqMembership(null).membershipKnown, false);
  assert.equal(normalizeQqMembership({}).membershipKnown, false); // 无相关字段
  assert.equal(normalizeQqMembership({ viptype: 1 }).isVip, true);
  assert.equal(normalizeQqMembership({ viptype: 1 }).membershipKnown, true);
  assert.equal(normalizeQqMembership({ issvip: 1 }).isSvip, true);
  assert.equal(normalizeQqMembership({ greenvip: 1 }).isVip, true);
});

test('mergeMembership：探测成功时以新结果为准', () => {
  const next = { isVip: true, isSvip: false, membershipKnown: true };
  assert.deepEqual(mergeMembership({ isVip: false }, next), { ...next, stale: false });
  // 探测成功但结果未知 → 清空，不保留旧值
  const unknown = mergeMembership({ isVip: true, membershipKnown: true }, { membershipKnown: false });
  assert.equal(unknown.isVip, false);
  assert.equal(unknown.stale, false);
});

test('mergeMembership：探测失败时保留旧会员态并标 stale', () => {
  const prev = { isVip: true, isSvip: true, membershipKnown: true };
  const merged = mergeMembership(prev, {}, { probeFailed: true });
  assert.equal(merged.isVip, true);
  assert.equal(merged.stale, true);
});

test('matchAudioMagic 识别常见音频容器', () => {
  assert.equal(matchAudioMagic(Buffer.from('ID3\u0003\u0000')), 'ID3');
  assert.equal(matchAudioMagic(Buffer.from([0xff, 0xfb, 0x90, 0x00])), 'MPEG');
  assert.equal(matchAudioMagic(Buffer.from('fLaC\u0000\u0000\u0000\u0022')), 'fLaC');
  assert.equal(matchAudioMagic(Buffer.from('OggS\u0000\u0002\u0000\u0000')), 'OggS');
  assert.equal(matchAudioMagic(Buffer.from('RIFF\u0000\u0000\u0000\u0000WAVE')), 'RIFF');
  assert.equal(matchAudioMagic(Buffer.from('\u0000\u0000\u0000\u0018ftypM4A ')), 'ftyp');
});

test('matchAudioMagic 对无效输入返回 null', () => {
  assert.equal(matchAudioMagic(null), null);
  assert.equal(matchAudioMagic(Buffer.alloc(0)), null);
  assert.equal(matchAudioMagic(Buffer.from([0x01, 0x02, 0x03])), null); // 不足 4 字节
  assert.equal(matchAudioMagic(Buffer.from('<!DOCTYPE html>')), null); // HTML 不是音频
});

test('parseCookieString 解析键值对', () => {
  const o = parseCookieString('a=1; b=2\nc=3');
  assert.equal(o.a, '1');
  assert.equal(o.b, '2');
  assert.equal(o.c, '3');
  assert.deepEqual(parseCookieString(''), {});
});

test('normalizeCookieHeader 丢弃 Cookie 属性行', () => {
  const h = normalizeCookieHeader('a=1; Path=/; b=2; HttpOnly; SameSite=Lax; Domain=.x.com');
  assert.match(h, /a=1/);
  assert.match(h, /b=2/);
  assert.doesNotMatch(h, /Path/);
  assert.doesNotMatch(h, /HttpOnly/);
  assert.doesNotMatch(h, /SameSite/);
  assert.doesNotMatch(h, /Domain/);
});

test('normalizeCookieHeader 支持 name/value 数组与字符串入参', () => {
  assert.equal(normalizeCookieHeader([{ name: 'k', value: 'v' }]), 'k=v');
  assert.equal(normalizeCookieHeader('a=1; Path=/'), 'a=1');
  assert.equal(normalizeCookieHeader(null), '');
  // 注意：普通对象映射 {a:'1'} 不走此函数（它只识别 {name,value} 形状），
  // 对象映射应使用 serializeCookieObject。
  assert.equal(normalizeCookieHeader({ a: '1' }), '');
  assert.equal(serializeCookieObject({ a: '1' }), 'a=1');
});

test('serializeCookieObject / joinCookiePairs 过滤空值', () => {
  assert.equal(serializeCookieObject({ a: '1', b: '', c: null }), 'a=1');
  assert.equal(joinCookiePairs({ a: '1', b: undefined }), 'a=1');
});

test('normalizeTitle 忽略大小写与空白括号', () => {
  assert.equal(normalizeTitle('Hello World'), 'helloworld');
  assert.equal(normalizeTitle(' 歌 曲 (Live) '), '歌曲live');
  assert.equal(normalizeTitle(null), '');
});

test('normalizeArtistSet 拆分多歌手并去重', () => {
  const s = normalizeArtistSet('周杰伦/费玉清');
  assert.equal(s.size, 2);
  assert.ok(s.has('周杰伦'));
  assert.ok(s.has('费玉清'));
  const obj = normalizeArtistSet([{ name: 'A' }, { name: 'a' }]);
  assert.equal(obj.size, 1); // 归一化后大小写视为同一人
});

test('isSameRecording：同名同歌手同时长才算同一版本', () => {
  const target = { title: '夜曲', artists: ['周杰伦'], durationMs: 226000 };
  assert.equal(isSameRecording(target, { title: '夜曲', artists: ['周杰伦'], durationMs: 226000 }), true);
  // 同名不同歌手 → 否
  assert.equal(isSameRecording(target, { title: '夜曲', artists: ['其他人'], durationMs: 226000 }), false);
  // 同名同歌手但时长差 > 3s（如 Live 版）→ 否
  assert.equal(isSameRecording(target, { title: '夜曲', artists: ['周杰伦'], durationMs: 300000 }), false);
  // 缺候选 → 否
  assert.equal(isSameRecording(target, null), false);
  // 无时长信息时不因时长否决
  assert.equal(isSameRecording(target, { title: '夜曲', artists: ['周杰伦'] }), true);
});

test('remainingBudget 不为负', () => {
  assert.equal(remainingBudget(Date.now() + 10000) > 0, true);
  assert.equal(remainingBudget(Date.now() - 10000), 0);
});

test('withTimeout 超时抛错，正常返回原值', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 1000), 'ok');
  await assert.rejects(() => withTimeout(new Promise(() => {}), 10, 'too_slow'), /too_slow/);
  await assert.rejects(() => withTimeout(Promise.resolve(1), 0), /timeout/);
});

test('质量梯度常量符合预期顺序', () => {
  assert.deepEqual(NETEASE_QUALITY_LADDER, ['lossless', 'exhigh', 'higher', 'standard']);
  assert.equal(QQ_QUALITY_CANDIDATES[0].ext, 'flac');
  assert.equal(QQ_QUALITY_CANDIDATES[0].prefix, 'F000');
  // 码率递减
  const brs = QQ_QUALITY_CANDIDATES.map((c) => c.br);
  assert.deepEqual(brs, [...brs].sort((a, b) => b - a));
  assert.ok(URL_CACHE_TTL_MS > 0);
});
