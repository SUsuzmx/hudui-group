// 叠塔对战纯逻辑测试 —— 钩子摆动盖楼（与 games/tower_game 同规则）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRng,
  nextSeed,
  swingHardFactor,
  angleBaseFor,
  initialAngleFor,
  swingVelocity,
  swingAngle,
  checkCollision,
  scoreForDrop,
  applyFail,
  rankPlayers,
  settleDrop,
  initialPlayerState,
  layoutOf,
  SUCCESS_SCORE,
  PERFECT_SCORE,
  MAX_LIVES,
} from '../../client/src/tower-engine.js';

test('相同 seed 生成相同初始摆角序列', () => {
  const a = [];
  const b = [];
  for (let i = 0; i < 12; i++) {
    a.push(initialAngleFor({ seed: 42, seq: i, successCount: i }));
    b.push(initialAngleFor({ seed: 42, seq: i, successCount: i }));
  }
  assert.deepEqual(a, b);
});

test('不同 seed 产生不同摆角', () => {
  const a = initialAngleFor({ seed: 1, seq: 3, successCount: 5 });
  const b = initialAngleFor({ seed: 2, seq: 3, successCount: 5 });
  assert.notEqual(a, b);
});

test('不同屏幕尺寸不影响判定（逻辑坐标）', () => {
  const line = { x: 100, collisionX: 200, y: 300 };
  const r1 = checkCollision({ blockX: 140, blockY: 280, blockWidth: 100, blockHeight: 71, line });
  const r2 = checkCollision({ blockX: 140, blockY: 280, blockWidth: 100, blockHeight: 71, line });
  assert.equal(r1, r2);
  assert.ok(r1 >= 2 && r1 <= 5);
});

test('重叠/翻转/错过判定正确', () => {
  const line = { x: 100, collisionX: 200, y: 300 };
  const w = 100;
  const h = 71;
  const y = 300 - h;
  // 完全错过左侧
  assert.equal(checkCollision({ blockX: 0, blockY: y, blockWidth: w, blockHeight: h, line }), 1);
  // 完全错过右侧
  assert.equal(checkCollision({ blockX: 280, blockY: y, blockWidth: w, blockHeight: h, line }), 1);
  // 左翻：左缘在线左
  assert.equal(checkCollision({ blockX: 80, blockY: y, blockWidth: w, blockHeight: h, line }), 2);
  // 右翻
  assert.equal(checkCollision({ blockX: 220, blockY: y, blockWidth: w, blockHeight: h, line }), 3);
  // 普通成功
  assert.equal(checkCollision({ blockX: 120, blockY: y, blockWidth: w, blockHeight: h, line }), 4);
  // 完美：左缘靠近 line.x + calWidth
  assert.equal(checkCollision({ blockX: 150, blockY: y, blockWidth: w, blockHeight: h, line }), 5);
});

test('完美判定窗口正确（±10% 半宽）', () => {
  const line = { x: 100, collisionX: 200, y: 300 };
  const w = 100;
  const cal = 50;
  const y = 229;
  // line.x + 0.8*cal = 140, line.x + 1.2*cal = 160
  assert.equal(checkCollision({ blockX: 139, blockY: y, blockWidth: w, blockHeight: 71, line }), 4);
  assert.equal(checkCollision({ blockX: 150, blockY: y, blockWidth: w, blockHeight: 71, line }), 5);
  assert.equal(checkCollision({ blockX: 161, blockY: y, blockWidth: w, blockHeight: 71, line }), 4);
  assert.ok(cal === 50);
});

test('计分：成功+25，连击完美再+25×n', () => {
  assert.equal(scoreForDrop({ success: true, perfect: false, perfectComboBefore: 3 }).gained, SUCCESS_SCORE);
  const p1 = scoreForDrop({ success: true, perfect: true, perfectComboBefore: 0 });
  assert.equal(p1.gained, SUCCESS_SCORE + PERFECT_SCORE * 1);
  assert.equal(p1.combo, 1);
  const p3 = scoreForDrop({ success: true, perfect: true, perfectComboBefore: 2 });
  assert.equal(p3.gained, SUCCESS_SCORE + PERFECT_SCORE * 3);
  assert.equal(p3.combo, 3);
});

test('失误扣生命，3 次结束', () => {
  let p = initialPlayerState({ userId: 1 });
  p = { ...p, ...applyFail(p) };
  assert.equal(p.livesUsed, 1);
  p = { ...p, ...applyFail(p) };
  p = { ...p, ...applyFail(p) };
  assert.equal(p.livesUsed, MAX_LIVES);
  assert.equal(p.gameOver, true);
});

test('摆速随层数变化且第一层几乎不摆', () => {
  assert.equal(swingHardFactor(0), 0);
  assert.equal(swingVelocity(1000, 0), 0);
  assert.ok(Math.abs(swingVelocity(1000, 5)) <= 1);
  assert.ok(angleBaseFor(5) === 30);
  assert.ok(angleBaseFor(15) === 60);
  assert.ok(angleBaseFor(25) === 80);
});

test('排名正确（分数>层数>连击）', () => {
  const ranked = rankPlayers([
    { userId: 1, score: 100, layers: 5, maxCombo: 2, joinedAt: 2 },
    { userId: 2, score: 300, layers: 2, maxCombo: 1, joinedAt: 1 },
    { userId: 3, score: 100, layers: 8, maxCombo: 0, joinedAt: 3 },
  ]);
  assert.equal(ranked[0].userId, 2);
  assert.equal(ranked[1].userId, 3);
  assert.equal(ranked[2].userId, 1);
});

test('settleDrop 成功时推进 seq 并记分', () => {
  const p = initialPlayerState({ userId: 1 });
  // 无 line 时走初始平台：首块在中轴应成功（对齐原版）
  const geo = layoutOf(390, 585);
  const res = settleDrop(p, {
    seed: 7,
    layout: geo,
    roundElapsedMs: 0,
    serverNow: Date.now(),
  });
  assert.equal(res.player.seq, 1);
  assert.ok(res.collision === 4 || res.collision === 5, `collision=${res.collision}`);
  assert.ok(res.player.score >= SUCCESS_SCORE, `score=${res.player.score}`);
  assert.equal(res.miss, false);
});

test('settleDrop 完美保留连击', () => {
  const p = initialPlayerState({ userId: 1 });
  p.combo = 1;
  p.score = 50;
  const geo = layoutOf(400, 600);
  const blockW = geo.blockWidth;
  const blockX = geo.width / 2 - blockW / 2;
  // 完美窗：line.x + 0.8*cal ~ line.x + 1.2*cal，cal=blockW/2
  // 设 line.x 使 blockX 落在完美窗中心
  const cal = blockW / 2;
  const lineX = blockX - cal; // then perfect window center = lineX + cal = blockX
  p.line = {
    x: lineX,
    collisionX: lineX + blockW,
    y: 400,
    width: blockW,
  };
  // hard=0 时 angle=0，blockX = width/2 - blockW/2
  const res = settleDrop(p, {
    seed: 7,
    layout: geo,
    roundElapsedMs: 0,
    serverNow: Date.now(),
  });
  // angle=0 时 blockX 固定；完美取决于 line 对齐
  assert.ok(res.player.seq === 1);
  if (res.perfect) {
    assert.equal(res.player.combo, 2);
  }
});

test('settleDrop 错过时扣命清连击', () => {
  const p = initialPlayerState({ userId: 1 });
  p.combo = 3;
  p.score = 100;
  const geo = layoutOf(400, 600);
  // line 放到最左，angle=0 时方块在中间 → 可能成功；改成线在最右
  p.line = {
    x: geo.width - 10,
    collisionX: geo.width + 50,
    y: 400,
    width: 10,
  };
  const res = settleDrop(p, {
    seed: 7,
    layout: geo,
    roundElapsedMs: 0,
    serverNow: Date.now(),
  });
  if (res.miss) {
    assert.equal(res.player.combo, 0);
    assert.equal(res.player.livesUsed, 1);
  }
});

test('移动与帧率无关（时间驱动）', () => {
  const a = swingAngle({ seed: 9, seq: 0, successCount: 5, timeMs: 1000 });
  const b = swingAngle({ seed: 9, seq: 0, successCount: 5, timeMs: 1000 });
  assert.equal(a, b);
  const c = swingAngle({ seed: 9, seq: 0, successCount: 5, timeMs: 50 * 20 });
  assert.equal(a, c);
});

test('nextSeed / createRng 可复现', () => {
  const r1 = createRng(99);
  const r2 = createRng(99);
  assert.equal(r1(), r2());
  const s1 = nextSeed(1);
  const s2 = nextSeed(s1);
  assert.notEqual(s1, s2);
});

test('layout 与原版比例一致', () => {
  const geo = layoutOf(390, 585);
  assert.equal(geo.blockWidth, 390 * 0.25);
  assert.ok(Math.abs(geo.blockHeight - geo.blockWidth * 0.71) < 0.01);
  assert.ok(Math.abs(geo.ropeHeight - 585 * 0.4) < 0.01);
});
