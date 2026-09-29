// 猜歌抢答纯逻辑单测
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTitle,
  titlesTooSimilar,
  isSameRecordingVariant,
  isPlaceholderTrack,
  isPlaceholderArtist,
  REAL_SONG_TITLES,
  REAL_ARTIST_NAMES,
  buildOptions,
  buildArtistOptions,
  publicOptions,
  pickClipWindow,
  keepTrackFields,
  canBuzz,
  rankPlayers,
  validSongCount,
  MIN_PLAYERS,
  MAX_PLAYERS,
  CLIP_MIN_MS,
  CLIP_MAX_MS,
  MAIN_SCORE,
  MAIN_WRONG_PENALTY,
  ARTIST_SCORE,
} from '../../client/src/guess-song-engine.js';

test('normalizeTitle 去掉 Live/伴奏后缀', () => {
  assert.equal(normalizeTitle('晴天 (Live)'), normalizeTitle('晴天'));
  assert.equal(normalizeTitle('晴天 - Live'), normalizeTitle('晴天'));
  assert.equal(normalizeTitle('晴天（伴奏）'), normalizeTitle('晴天'));
  assert.notEqual(normalizeTitle('晴天'), normalizeTitle('七里香'));
});

test('titlesTooSimilar 识别几乎同名', () => {
  assert.equal(titlesTooSimilar('晴天', '晴天'), true);
  assert.equal(titlesTooSimilar('晴天 Live', '晴天'), true);
  assert.equal(titlesTooSimilar('晴天', '七里香'), false);
});

test('isSameRecordingVariant 识别同曲变体', () => {
  assert.equal(
    isSameRecordingVariant({ title: '晴天 Live', artist: '周杰伦' }, { title: '晴天', artist: '周杰伦' }),
    true
  );
  assert.equal(
    isSameRecordingVariant({ title: '晴天', artist: '周杰伦' }, { title: '晴天', artist: '林俊杰' }),
    false
  );
});

test('buildOptions 正确项唯一且顺序打乱', () => {
  const correct = { title: '晴天', artist: '周杰伦', id: '1', source: 'qq' };
  const pool = [
    { title: '七里香', artist: '周杰伦', id: '2', source: 'qq' },
    { title: '夜曲', artist: '周杰伦', id: '3', source: 'qq' },
    { title: '稻香', artist: '周杰伦', id: '4', source: 'qq' },
    { title: '晴天 Live', artist: '周杰伦', id: '5', source: 'qq' },
    { title: '晴天（伴奏）', artist: '周杰伦', id: '6', source: 'qq' },
  ];
  const opts = buildOptions(correct, pool, { rng: () => 0.5 });
  assert.equal(opts.length, 4);
  const corrects = opts.filter((o) => o._correct);
  assert.equal(corrects.length, 1);
  assert.equal(corrects[0].title, '晴天');
  // 不含 Live / 伴奏变体
  assert.ok(!opts.some((o) => /live|伴奏/i.test(o.title)));
  // optionId 不透明
  for (const o of opts) {
    assert.ok(String(o.optionId).startsWith('opt_'));
    assert.ok(!String(o.optionId).includes('correct'));
  }
});

test('buildOptions 池不足时补占位且不与正确项撞车', () => {
  const correct = { title: '独曲', artist: '甲', id: '1', source: 'qq' };
  const opts = buildOptions(correct, [], { rng: () => 0.3 });
  assert.equal(opts.length, 4);
  assert.equal(opts.filter((o) => o._correct).length, 1);
});

test('干扰项不含演示曲目/占位曲', () => {
  const correct = { title: '晴天', artist: '周杰伦', id: '1', source: 'qq' };
  const pool = [
    { title: '演示曲目 1', artist: '演示歌手1', id: 'local-extra-0', source: 'local' },
    { title: '演示曲目 2', artist: '演示歌手2', id: 'local-extra-1', source: 'local' },
    { title: '未收录曲目 1', artist: '未知歌手', id: 'pad-1', source: 'pad' },
    { title: '七里香', artist: '周杰伦', id: '2', source: 'qq' },
    { title: '夜曲', artist: '周杰伦', id: '3', source: 'qq' },
    { title: '稻香', artist: '周杰伦', id: '4', source: 'qq' },
  ];
  const opts = buildOptions(correct, pool, { rng: () => 0.5 });
  const titles = opts.map((o) => o.title);
  assert.ok(!titles.some((t) => /演示曲目|未收录曲目|补充曲目|晚风信件|城市灯火/.test(t)), titles.join(','));
  assert.equal(opts.filter((o) => o._correct).length, 1);
});

test('池不足时干扰项用真实金曲名，不用假歌名', () => {
  const correct = { title: '独曲测试专用', artist: '甲', id: '1', source: 'qq' };
  const opts = buildOptions(correct, [], { rng: () => 0.2 });
  assert.equal(opts.length, 4);
  const wrong = opts.filter((o) => !o._correct);
  assert.equal(wrong.length, 3);
  for (const o of wrong) {
    assert.ok(REAL_SONG_TITLES.includes(o.title), `假歌名: ${o.title}`);
    assert.ok(!/晚风信件|城市灯火|未寄出的信|夏日回声|未收录|演示/.test(o.title));
  }
});

test('歌手干扰项用真实歌手名', () => {
  const track = { title: '晴天', artist: '周杰伦', id: '1', source: 'qq' };
  const opts = buildArtistOptions(track, [], { rng: () => 0.3 });
  assert.equal(opts.length, 4);
  const wrong = opts.filter((o) => !o._correct);
  assert.equal(wrong.length, 3);
  for (const o of wrong) {
    assert.ok(REAL_ARTIST_NAMES.includes(o.label), `假歌手: ${o.label}`);
    assert.ok(!/演示歌手|神秘歌手|林晚|陈屿/.test(o.label));
  }
});

test('isPlaceholderTrack 识别占位曲', () => {
  assert.equal(isPlaceholderTrack({ title: '演示曲目 1', id: 'x', source: 'local' }), true);
  assert.equal(isPlaceholderTrack({ title: '未收录曲目 2', id: 'pad-1', source: 'pad' }), true);
  assert.equal(isPlaceholderTrack({ title: '晴天', id: '1', source: 'qq' }), false);
  assert.equal(isPlaceholderArtist('演示歌手1'), true);
  assert.equal(isPlaceholderArtist('周杰伦'), false);
});

test('publicOptions 剥离正确标记', () => {
  const correct = { title: 'A', artist: 'x', id: '1', source: 'qq' };
  const opts = buildOptions(correct, [{ title: 'B', artist: 'y', id: '2', source: 'qq' }], { rng: () => 0.1 });
  const pub = publicOptions(opts);
  assert.ok(pub.every((o) => o._correct === undefined));
  assert.ok(pub.every((o) => o.optionId));
});

test('buildArtistOptions 含正确歌手', () => {
  const track = { title: '晴天', artist: '周杰伦', id: '1', source: 'qq' };
  const pool = [
    { title: 'x', artist: '林俊杰', id: '2', source: 'qq' },
    { title: 'y', artist: '陈奕迅', id: '3', source: 'qq' },
    { title: 'z', artist: '薛之谦', id: '4', source: 'qq' },
  ];
  const opts = buildArtistOptions(track, pool, { rng: () => 0.2 });
  assert.equal(opts.length, 4);
  assert.equal(opts.filter((o) => o._correct).length, 1);
  assert.equal(opts.find((o) => o._correct).label, '周杰伦');
});

test('pickClipWindow 片段长度在 8–10 秒', () => {
  const w = pickClipWindow(200_000, () => 0.5);
  assert.ok(w.clipDurationMs >= CLIP_MIN_MS && w.clipDurationMs <= CLIP_MAX_MS);
  assert.ok(w.clipStartMs >= 0);
  assert.ok(w.clipStartMs + w.clipDurationMs <= 200_000);
});

test('pickClipWindow 短曲从 0 开始', () => {
  const w = pickClipWindow(3000, () => 0.5);
  assert.equal(w.clipStartMs, 0);
});

test('keepTrackFields 保留取流字段', () => {
  const t = keepTrackFields({
    source: 'qq',
    id: 'abc',
    mid: 'm1',
    mediaMid: 'mm1',
    hash: 'h1',
    albumId: 'al1',
    albumAudioId: 'aa1',
    mixSongId: 'mx1',
    title: '晴天',
    artist: '周杰伦',
    cover: 'http://x/c.jpg',
    duration: 200,
    durationMs: 200000,
    privilege: { a: 1 },
    hqHash: 'hq',
    sqHash: 'sq',
    resHash: 'res',
    extra: '丢弃',
  });
  assert.equal(t.source, 'qq');
  assert.equal(t.mid, 'm1');
  assert.equal(t.mediaMid, 'mm1');
  assert.equal(t.hash, 'h1');
  assert.equal(t.albumId, 'al1');
  assert.equal(t.albumAudioId, 'aa1');
  assert.equal(t.mixSongId, 'mx1');
  assert.equal(t.hqHash, 'hq');
  assert.equal(t.sqHash, 'sq');
  assert.equal(t.resHash, 'res');
  assert.equal(t.extra, undefined);
  assert.equal(keepTrackFields({ title: 'x' }), null);
});

test('canBuzz 规则', () => {
  assert.equal(
    canBuzz({ phase: 'playing', audioStarted: true, alreadyBuzzed: false, myWrongLocked: false, disconnected: false, hasActiveAnswer: false }),
    true
  );
  assert.equal(
    canBuzz({ phase: 'playing', audioStarted: false, alreadyBuzzed: false, myWrongLocked: false, disconnected: false, hasActiveAnswer: false }),
    false
  );
  assert.equal(
    canBuzz({ phase: 'playing', audioStarted: true, alreadyBuzzed: true, myWrongLocked: false, disconnected: false, hasActiveAnswer: false }),
    false
  );
  assert.equal(
    canBuzz({ phase: 'playing', audioStarted: true, alreadyBuzzed: false, myWrongLocked: true, disconnected: false, hasActiveAnswer: false }),
    false
  );
  assert.equal(
    canBuzz({ phase: 'answering', audioStarted: true, alreadyBuzzed: false, myWrongLocked: false, disconnected: false, hasActiveAnswer: true }),
    false
  );
});

test('rankPlayers 按分数排序', () => {
  const r = rankPlayers([
    { userId: 1, nickname: '甲', score: 10 },
    { userId: 2, nickname: '乙', score: 30 },
    { userId: 3, nickname: '丙', score: 20 },
  ]);
  assert.equal(r[0].userId, 2);
  assert.equal(r[1].userId, 3);
  assert.equal(r[2].userId, 1);
  assert.equal(r[0].rank, 1);
});

test('validSongCount 只允许 5/10/15', () => {
  assert.equal(validSongCount(5), 5);
  assert.equal(validSongCount(10), 10);
  assert.equal(validSongCount(15), 15);
  assert.equal(validSongCount(7), 10);
  assert.equal(validSongCount('abc'), 10);
});

test('常量符合产品规则', () => {
  assert.equal(MIN_PLAYERS, 2);
  assert.equal(MAX_PLAYERS, 8);
  assert.equal(MAIN_SCORE, 100);
  assert.equal(MAIN_WRONG_PENALTY, 15);
  assert.equal(ARTIST_SCORE, 40);
});
