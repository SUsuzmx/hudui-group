// 猜歌抢答纯逻辑：选项生成 / 标题归一 / 计分 / 时间轴
// 服务端与客户端共用，不依赖 DOM / Socket。

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const SONG_COUNT_OPTIONS = [5, 10, 15];
export const DEFAULT_SONG_COUNT = 10;

export const ROUND_MAX_MS = 24_000;
export const PREPARE_MS = 2_000;
export const CLIP_MIN_MS = 8_000;
export const CLIP_MAX_MS = 10_000;
export const ANSWER_MS = 5_000;
export const ARTIST_MS = 5_000;
export const HINT_AT_MS = [6_000, 12_000, 18_000];

export const MAIN_SCORE = 100;
export const MAIN_WRONG_PENALTY = 15;
export const ARTIST_SCORE = 40;
export const ARTIST_WRONG_PENALTY = 5;

export const TRACK_FIELDS = [
  'source', 'id', 'mid', 'mediaMid', 'hash', 'albumId', 'albumAudioId', 'mixSongId',
  'title', 'artist', 'cover', 'duration', 'durationMs', 'privilege',
  'hqHash', 'sqHash', 'resHash',
];

/** 去掉 Live / 伴奏 / 翻唱等后缀，用于「几乎同名」判定 */
export function normalizeTitle(title) {
  let t = String(title || '')
    .toLowerCase()
    .replace(/[（(【[].*?(live|伴奏|纯音乐|钢琴|remix|remaster|demo|cover|acoustic|unplugged|explicit|feat\.?).*?[）)】\]]/gi, ' ')
    .replace(/[-–—_·|]\s*(live|伴奏|纯音乐|钢琴版?|remix|remaster|demo|cover|acoustic|unplugged).*$/gi, ' ')
    .replace(/\b(live|伴奏|纯音乐|remix|remaster|demo|cover|acoustic|unplugged|karaoke|explicit)\b/gi, ' ')
    .replace(/[（(【[].*?[）)】\]]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
  return t || String(title || '').trim().toLowerCase();
}

/** 保留曲目取流所需字段，多余字段丢弃 */
export function keepTrackFields(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const k of TRACK_FIELDS) {
    const v = raw[k];
    if (v === undefined || v === null) {
      if (k === 'privilege') continue;
      out[k] = k === 'duration' || k === 'durationMs' ? 0 : '';
      continue;
    }
    if (k === 'privilege') {
      out[k] = v && typeof v === 'object' ? v : undefined;
    } else if (k === 'duration' || k === 'durationMs') {
      out[k] = Math.max(0, Number(v) || 0);
    } else {
      out[k] = String(v).slice(0, 120);
    }
  }
  if (!out.source || !out.id) return null;
  if (!out.title) out.title = '未知歌曲';
  if (!out.artist) out.artist = '未知歌手';
  return out;
}

export function trackKey(t) {
  return t ? `${t.source || ''}:${t.id || ''}` : '';
}

/** 歌名几乎相同（归一化后相同或互相包含且较短） */
export function titlesTooSimilar(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const minLen = Math.min(na.length, nb.length);
  if (minLen >= 4 && (na.includes(nb) || nb.includes(na))) {
    const longer = na.length >= nb.length ? na : nb;
    if (longer.length - minLen <= 2) return true;
  }
  return false;
}

/** 同曲不同版本（Live / 伴奏等）视为重复 */
export function isSameRecordingVariant(a, b) {
  const na = normalizeTitle(a?.title || a);
  const nb = normalizeTitle(b?.title || b);
  if (!na || !nb) return false;
  if (na !== nb) return false;
  const artA = normalizeTitle(a?.artist || '');
  const artB = normalizeTitle(b?.artist || '');
  if (!artA || !artB) return true;
  return artA === artB || artA.includes(artB) || artB.includes(artA);
}

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 占位/演示曲：不能当干扰项，否则选项里会露出「演示曲目」 */
export function isPlaceholderTrack(t) {
  if (!t) return true;
  const title = String(t.title || '');
  const id = String(t.id || '');
  const source = String(t.source || '');
  if (source === 'pad') return true;
  if (/^未收录曲目/.test(title) || /^演示曲目/.test(title) || /^补充曲目/.test(title)) return true;
  if (/^演示歌手/.test(String(t.artist || ''))) return true;
  if (id.startsWith('pad-') || id.startsWith('local-extra-')) return true;
  return false;
}

export function isPlaceholderArtist(name) {
  const a = String(name || '');
  return !a || /^演示歌手/.test(a) || /^神秘歌手/.test(a) || a === '未知歌手' || a === 'Hudui Demo';
}

/** 真实存在的金曲名：曲库不够时作干扰项（只借歌名，不借音频） */
export const REAL_SONG_TITLES = [
  '晴天', '七里香', '稻香', '夜曲', '青花瓷', '告白气球', '简单爱', '搁浅',
  '演员', '丑八怪', '认真的雪', '像风一样', '消愁', '像我这样的人', '不染',
  '泡沫', '光年之外', '句号', '倒数', '画',
  '十年', '浮夸', '富士山下', '好久不见', '红玫瑰', '孤勇者',
  '江南', '她说', '修炼爱情', '可惜没如果', '小酒窝', '曹操',
  '遇见', '绿光', '天黑黑', '后来', '很爱很爱你', '当爱在靠近',
  '小幸运', '追光者', '说散就散', '体面', '起风了', '大鱼',
  '成都', '南山南', '董小姐', '斑马斑马', '理想三旬', '春风十里',
  '海阔天空', '光辉岁月', '真的爱你', '喜欢你', '冷雨夜',
  '倔强', '知足', '突然好想你', '温柔', '星空',
  '小星星', '童话', '暖暖', '宁夏', '崇拜', '会呼吸的痛',
  '说好不哭', '等你下课', 'mojito', '本草纲目', '双截棍', '霍元甲',
  'Lemon', '夜に駆ける', '打上花火', '小幸運', '那些年', '追梦赤子心',
  '平凡之路', '夜空中最亮的星', '奔跑', '怒放的生命', '曾经的你',
];

/** 真实存在的歌手名 */
export const REAL_ARTIST_NAMES = [
  '周杰伦', '林俊杰', '陈奕迅', '薛之谦', '毛不易', '李荣浩', '许嵩', '汪苏泷',
  '邓紫棋', '张惠妹', '孙燕姿', '梁静茹', '蔡依林', '王菲', '那英', '田馥甄',
  '五月天', '苏打绿', '信乐团', 'Beyond', '逃跑计划', '痛仰乐队',
  '张学友', '刘德华', '郭富城', '黎明', '周华健', '李宗盛', '罗大佑',
  '华晨宇', '周深', '张杰', '许巍', '朴树', '郑钧', '汪峰', '李健',
  '陈粒', '赵雷', '马頔', '宋冬野', '好妹妹乐队', '隔壁老樊',
  'Adele', 'Taylor Swift', 'Ed Sheeran', 'Bruno Mars', '周传雄', '张信哲',
];

/**
 * 生成 4 个选项：正确答案 + 3 干扰项
 * - 干扰项优先来自候选池里的真实曲目
 * - 不够时从真实金曲名单补，绝不编造假歌名
 * - 避免几乎相同歌名 / 同曲 Live·伴奏变体
 */
export function buildOptions(correctTrack, pool, { count = 4, rng = Math.random, usedTitles = new Set() } = {}) {
  if (!correctTrack?.title) return [];
  const distractors = [];
  const tryPush = (title, artist, id, source) => {
    if (distractors.length >= count - 1) return;
    if (!title || titlesTooSimilar(title, correctTrack.title)) return;
    const n = normalizeTitle(title);
    if (usedTitles.has(n)) return;
    if (distractors.some((d) => titlesTooSimilar(d.title, title) || isSameRecordingVariant(d, { title, artist }))) return;
    distractors.push({ title, artist: artist || '未知歌手', id: id || `real-${n}`, source: source || 'real' });
    usedTitles.add(n);
  };

  const candidates = shuffle(
    (pool || []).filter((t) => {
      if (!t?.title) return false;
      if (isPlaceholderTrack(t)) return false;
      if (trackKey(t) === trackKey(correctTrack)) return false;
      return true;
    }),
    rng
  );
  for (const t of candidates) {
    if (distractors.length >= count - 1) break;
    tryPush(t.title, t.artist, t.id, t.source);
  }
  // 曲库不够时用真实金曲歌名补满
  const realTitles = shuffle(REAL_SONG_TITLES, rng);
  for (const title of realTitles) {
    if (distractors.length >= count - 1) break;
    tryPush(title, '真实歌手', `real-${normalizeTitle(title)}`, 'real');
  }
  const opts = [
    { title: correctTrack.title, artist: correctTrack.artist, isCorrect: true },
    ...distractors.map((d) => ({ title: d.title, artist: d.artist, isCorrect: false })),
  ];
  return shuffle(opts, rng).map((o, i) => ({
    optionId: `opt_${i}_${Math.floor(rng() * 1e9).toString(36)}`,
    title: o.title,
    artist: o.artist,
    // 正确标记仅保留给服务端内部，下发前会剥离
    _correct: o.isCorrect,
  }));
}

/** 歌手阶段选项：正确歌手 + 真实歌手干扰项 */
export function buildArtistOptions(track, pool, { count = 4, rng = Math.random } = {}) {
  const correct = String(track?.artist || '未知歌手');
  const used = new Set([normalizeTitle(correct)]);
  const distractors = [];
  const tryPushArtist = (name) => {
    if (distractors.length >= count - 1) return;
    if (!name || isPlaceholderArtist(name)) return;
    const n = normalizeTitle(name);
    if (used.has(n)) return;
    if (titlesTooSimilar(name, correct)) return;
    distractors.push(name);
    used.add(n);
  };

  const candidates = shuffle(
    (pool || []).map((t) => t?.artist).filter((a) => a && !isPlaceholderArtist(a)),
    rng
  );
  for (const a of candidates) {
    if (distractors.length >= count - 1) break;
    tryPushArtist(a);
  }
  for (const name of shuffle(REAL_ARTIST_NAMES, rng)) {
    if (distractors.length >= count - 1) break;
    tryPushArtist(name);
  }
  const opts = [correct, ...distractors];
  return shuffle(opts, rng).map((a, i) => ({
    optionId: `art_${i}_${Math.floor(rng() * 1e9).toString(36)}`,
    label: a,
    _correct: normalizeTitle(a) === normalizeTitle(correct),
  }));
}

/** 剥离正确标记后再发给客户端 */
export function publicOptions(options) {
  return (options || []).map((o) => ({
    optionId: o.optionId,
    title: o.title,
    label: o.label,
    artist: o.artist,
  }));
}

export function pickClipWindow(durationMs, rng = Math.random) {
  const dur = Math.max(0, Number(durationMs) || 0);
  const clipLen = CLIP_MIN_MS + Math.floor(rng() * (CLIP_MAX_MS - CLIP_MIN_MS + 1));
  if (dur <= clipLen + 1000) {
    return { clipStartMs: 0, clipDurationMs: Math.min(clipLen, dur || clipLen) };
  }
  const maxStart = dur - clipLen - 500;
  const clipStartMs = Math.floor(rng() * Math.max(0, maxStart));
  return { clipStartMs, clipDurationMs: clipLen };
}

/** 阶段时间轴：便于客户端倒计时 */
export function roundTimeline({ clipDurationMs = CLIP_MAX_MS, answerMs = ANSWER_MS, artistMs = ARTIST_MS } = {}) {
  return {
    prepareMs: PREPARE_MS,
    clipDurationMs,
    answerMs,
    artistMs,
    hintAtMs: HINT_AT_MS.slice(),
  };
}

export function scoreMainCorrect() {
  return MAIN_SCORE;
}
export function scoreMainWrong() {
  return -MAIN_WRONG_PENALTY;
}
export function scoreArtistCorrect() {
  return ARTIST_SCORE;
}
export function scoreArtistWrong() {
  return -ARTIST_WRONG_PENALTY;
}

export function canBuzz({ phase, audioStarted, alreadyBuzzed, myWrongLocked, disconnected, hasActiveAnswer }) {
  if (disconnected) return false;
  if (!audioStarted) return false;
  if (hasActiveAnswer || alreadyBuzzed) return false;
  if (myWrongLocked) return false;
  return phase === 'playing';
}

export function initialPlayer(userId, nickname, avatar, avatarColor) {
  return {
    userId: Number(userId),
    nickname: String(nickname || '玩家').slice(0, 32),
    avatar: avatar ?? null,
    avatarColor: avatarColor || '#e85d4c',
    score: 0,
    ready: false,
    online: true,
    disconnectedAt: 0,
    joinedAt: Date.now(),
    // 本轮
    mainWrong: false,
    answeredMain: false,
    answeredArtist: false,
    lastCommandId: '',
  };
}

export function resetPlayerForRound(p) {
  if (!p) return p;
  p.mainWrong = false;
  p.answeredMain = false;
  p.answeredArtist = false;
  return p;
}

export function rankPlayers(players) {
  return (players || [])
    .slice()
    .sort((a, b) => {
      const sa = Number(b.score) || 0;
      const sb = Number(a.score) || 0;
      if (sa !== sb) return sa - sb;
      return String(a.nickname || '').localeCompare(String(b.nickname || ''), 'zh');
    })
    .map((p, i) => ({
      userId: p.userId,
      nickname: p.nickname,
      avatar: p.avatar,
      avatarColor: p.avatarColor,
      score: Number(p.score) || 0,
      rank: i + 1,
    }));
}

export function validSongCount(n) {
  const v = Number(n);
  return SONG_COUNT_OPTIONS.includes(v) ? v : DEFAULT_SONG_COUNT;
}
