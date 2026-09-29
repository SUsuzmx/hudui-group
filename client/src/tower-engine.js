// 叠塔对战纯逻辑 —— 与 games/tower_game 同款「钩子摆动落块」盖楼
// 服务端与客户端共用；时间驱动，不依赖帧率/屏幕像素。
export const SUCCESS_SCORE = 25;
export const PERFECT_SCORE = 25;
export const MAX_LIVES = 3;
export const ROUND_DURATION_MS = 90_000;
export const COUNTDOWN_MS = 3_000;
export const MAX_SEQ = 120;

/** mulberry32 */
export function createRng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function nextSeed(prev) {
  const rng = createRng((Number(prev) || 0) + 0x9e3779b9);
  return Math.floor(rng() * 0x7fffffff) || 1;
}

/** 摆动难度系数（与 utils.getSwingBlockVelocity 一致） */
export function swingHardFactor(successCount) {
  const n = Number(successCount) || 0;
  if (n < 1) return 0;
  if (n < 10) return 1;
  if (n < 20) return 0.8;
  if (n < 30) return 0.7;
  return 0.74;
}

/** 摆角幅度（度，与 utils.getAngleBase 一致） */
export function angleBaseFor(successCount) {
  const n = Number(successCount) || 0;
  if (n < 10) return 30;
  if (n < 20) return 60;
  return 80;
}

/**
 * 第 seq 块的初始摆角（弧度）。用 seed 保证双方同局一致。
 * 对应 animateFuncs: (PI * random(base, base+5) * sign) / 180
 */
export function initialAngleFor({ seed, seq, successCount }) {
  const rng = createRng((Number(seed) || 1) ^ ((Number(seq) + 1) * 0x9e3779b9));
  const base = angleBaseFor(successCount);
  const a = base + rng() * 5;
  const sign = rng() > 0.5 ? 1 : -1;
  return (Math.PI * a * sign) / 180;
}

/** 摆动速度 sin(t / (200/hard))，t 为全局时间（原版用 engine time） */
export function swingVelocity(timeMs, successCount) {
  const hard = swingHardFactor(successCount);
  if (hard <= 0) return 0;
  return Math.sin(Math.max(0, timeMs) / (200 / hard));
}

/** 当前摆角（弧度） */
export function swingAngle({ seed, seq, successCount, timeMs, swingElapsedMs }) {
  const t = timeMs != null ? timeMs : swingElapsedMs;
  return initialAngleFor({ seed, seq, successCount }) * swingVelocity(t, successCount);
}

/**
 * 逻辑画布几何（按 engine 尺寸换算，判定用相对比例）
 * width/height 为逻辑像素（如 390 x 585，比例 1.5）
 */
export function layoutOf(width, height) {
  const w = Number(width) || 390;
  const h = Number(height) || Math.round(w * 1.5);
  const blockWidth = w * 0.25;
  const blockHeight = blockWidth * 0.71;
  const ropeHeight = h * 0.4;
  return {
    width: w,
    height: h,
    calWidth: w / 2,
    blockWidth,
    blockHeight,
    calBlockWidth: blockWidth / 2,
    ropeHeight,
    cloudSize: w * 0.3,
  };
}

/** 钩子枢轴：屏幕顶部中央 */
export function hookPivot(width, ropeHeight, hookYOffset = 0) {
  return {
    x: width / 2,
    y: ropeHeight * -1.5 + hookYOffset,
  };
}

/** 绳端（方块中心）位置 */
export function weightPos({ hookX, hookY, angle, ropeHeight }) {
  return {
    x: hookX + Math.sin(angle) * ropeHeight,
    y: hookY + Math.cos(angle) * ropeHeight,
  };
}

/**
 * 与 block.checkCollision 相同的 0-5 判定
 * blockX = 方块左缘; line: { x, collisionX, y }
 * 0 下落中 1 完全错过 2 左翻 3 右翻 4 成功 5 完美
 */
export function checkCollision({ blockX, blockY, blockWidth, blockHeight, line }) {
  const calWidth = blockWidth / 2;
  if (blockY + blockHeight < line.y) return 0;
  if (blockX < line.x - calWidth || blockX > line.collisionX + calWidth) return 1;
  if (blockX < line.x) return 2;
  if (blockX > line.collisionX) return 3;
  if (blockX > line.x + calWidth * 0.8 && blockX < line.x + calWidth * 1.2) return 5;
  return 4;
}

/** 计分：成功 +25；连续完美再 +25×连击 */
export function scoreForDrop({ success, perfect, perfectComboBefore }) {
  if (!success) return { gained: 0, combo: 0 };
  const combo = perfect ? (Number(perfectComboBefore) || 0) + 1 : 0;
  const gained = SUCCESS_SCORE + PERFECT_SCORE * combo;
  return { gained, combo };
}

export function applyFail(player) {
  const lives = Math.min(MAX_LIVES, (Number(player.livesUsed) || 0) + 1);
  return {
    livesUsed: lives,
    gameOver: lives >= MAX_LIVES,
    combo: 0,
  };
}

/** 排名：分数 > 层数 > 最高连击 > 加入顺序 */
export function rankPlayers(players) {
  const list = [...(players || [])];
  list.sort((a, b) => {
    const ds = (Number(b.score) || 0) - (Number(a.score) || 0);
    if (ds) return ds;
    const dh = (Number(b.layers) || 0) - (Number(a.layers) || 0);
    if (dh) return dh;
    const dc = (Number(b.maxCombo) || 0) - (Number(a.maxCombo) || 0);
    if (dc) return dc;
    return (Number(a.joinedAt) || 0) - (Number(b.joinedAt) || 0);
  });
  return list.map((p, i) => ({ ...p, rank: i + 1 }));
}

export function initialPlayerState(base = {}) {
  return {
    userId: base.userId,
    nickname: base.nickname || '玩家',
    avatar: base.avatar ?? null,
    avatarColor: base.avatarColor || '#4f6ef7',
    joinedAt: base.joinedAt || Date.now(),
    online: base.online !== false,
    ready: Boolean(base.ready),
    retired: Boolean(base.retired),
    seq: 0,
    layers: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    livesUsed: 0,
    maxHeight: 0,
    lastDropAt: 0,
    disconnectedAt: 0,
    rttMs: 0,
    // 当前平台（与原版 line 一致：x 为左碰撞边）
    line: null,
    stack: [],
    // 当前摆块角度种子相位
    swingStartedAt: 0,
  };
}

/** 重置到新一局（保留用户信息） */
export function resetPlayerForRound(p) {
  p.ready = false;
  p.seq = 0;
  p.layers = 0;
  p.score = 0;
  p.combo = 0;
  p.maxCombo = 0;
  p.livesUsed = 0;
  p.maxHeight = 0;
  p.lastDropAt = 0;
  p.retired = false;
  p.line = null;
  p.stack = [];
  p.swingStartedAt = 0;
}

/**
 * 服务端权威一次落塔。
 * player 当前状态 + 落塔时刻 → 新状态与结果。
 * dropElapsedMs: 本块摆动经过时间
 */
export function settleDrop(player, {
  seed,
  layout,
  dropElapsedMs,
  roundElapsedMs,
  serverNow = Date.now(),
}) {
  const geo = layout || layoutOf(390, 585);
  const seq = Number(player.seq) || 0;
  const successCount = Number(player.layers) || 0;
  const angle = swingAngle({
    seed,
    seq,
    successCount,
    timeMs: roundElapsedMs != null ? roundElapsedMs : dropElapsedMs,
  });
  const pivot = hookPivot(geo.width, geo.ropeHeight);
  const weight = weightPos({
    hookX: pivot.x,
    hookY: pivot.y,
    angle,
    ropeHeight: geo.ropeHeight,
  });
  const blockWidth = geo.blockWidth;
  const blockHeight = geo.blockHeight;
  const calWidth = blockWidth / 2;
  const blockX = weight.x - calWidth;
  const blockY = weight.y + blockHeight * 0.3;

  // 初始平台：对齐原版 line.ready —— 只设 collisionX=width-blockWidth，x 不设（首块在中轴可成功）
  const line = player.line || {
    x: -geo.width * 4,
    collisionX: geo.width - blockWidth,
    y: geo.height * 0.62,
    width: blockWidth,
  };

  // 落塔瞬间：方块已到达平台线，按 X 判定
  const collision = checkCollision({
    blockX,
    blockY: line.y - blockHeight,
    blockWidth,
    blockHeight,
    line,
  }) || 4;

  const next = { ...player, seq: seq + 1, swingStartedAt: serverNow };

  if (collision === 0) {
    // 还没碰到线 —— 理论上服务端在 drop 时直接判，视作落到线
    // 用线位置强制碰撞
  }

  if (collision === 1 || collision === 2 || collision === 3) {
    const fail = applyFail(player);
    next.livesUsed = fail.livesUsed;
    next.combo = 0;
    next.lastDropAt = serverNow;
    next.gameOver = fail.gameOver;
    return {
      ok: true,
      miss: true,
      perfect: false,
      collision,
      gained: 0,
      combo: 0,
      block: { x: blockX, y: blockY, w: blockWidth, h: blockHeight, angle },
      line,
      player: next,
    };
  }

  const perfect = collision === 5;
  const scored = scoreForDrop({
    success: true,
    perfect,
    perfectComboBefore: player.combo,
  });
  next.score = Math.max(0, (Number(player.score) || 0) + scored.gained);
  next.combo = scored.combo;
  next.maxCombo = Math.max(Number(player.maxCombo) || 0, scored.combo);
  next.layers = successCount + 1;
  next.maxHeight = Math.max(Number(player.maxHeight) || 0, next.layers);
  next.lastDropAt = serverNow;
  // 新平台：原版 line.x = i.x - calWidth, collisionX = line.x + width
  const landY = line.y - blockHeight;
  next.line = {
    x: blockX - calWidth,
    collisionX: blockX - calWidth + blockWidth,
    y: landY,
    width: blockWidth,
    perfect,
  };
  const prevStack = Array.isArray(player.stack) ? player.stack : [];
  next.stack = [
    ...prevStack,
    { x: blockX, y: landY, w: blockWidth, h: blockHeight, perfect },
  ].slice(-60);
  return {
    ok: true,
    miss: false,
    perfect,
    collision,
    gained: scored.gained,
    combo: scored.combo,
    block: { x: blockX, y: landY, w: blockWidth, h: blockHeight, angle, perfect },
    line: next.line,
    player: next,
  };
}

/** 压缩给客户端的玩家摘要 */
export function playerSummary(p) {
  return {
    userId: p.userId,
    nickname: p.nickname,
    avatar: p.avatar,
    avatarColor: p.avatarColor,
    online: p.online,
    ready: p.ready,
    retired: p.retired,
    score: p.score,
    layers: p.layers,
    combo: p.combo,
    maxCombo: p.maxCombo,
    livesUsed: p.livesUsed,
    livesLeft: Math.max(0, MAX_LIVES - (Number(p.livesUsed) || 0)),
    seq: p.seq,
    joinedAt: p.joinedAt,
    line: p.line || null,
    stack: Array.isArray(p.stack) ? p.stack.slice(-40) : [],
    swingStartedAt: p.swingStartedAt || 0,
  };
}

export function titleFor(player, ranked) {
  if (!player) return '';
  if (ranked?.[0]?.userId === player.userId) return '本局最高';
  const maxComboAll = Math.max(0, ...ranked.map((r) => r.maxCombo || 0));
  if ((player.maxCombo || 0) >= 3 && (player.maxCombo || 0) === maxComboAll) return '完美连击';
  if ((player.livesUsed || 0) === 0 && (player.layers || 0) > 0) return '最稳玩家';
  return '';
}
