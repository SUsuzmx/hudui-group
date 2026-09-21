import { createRequire } from 'node:module';
import {
  NETEASE_QUALITY_LADDER, NETEASE_BR_BY_LEVEL, URL_CACHE_TTL_MS, MEMBERSHIP_CACHE_TTL_MS,
  URL_RESOLVE_BUDGET_MS, urlCache, membershipCache, classifyRestriction, makePlayResult,
  mergeMembership, probeAudioUrl, withTimeout, readCookieFile, writeCookieFile,
  parseCookieString, normalizeCookieHeader, isSameRecording, remainingBudget, logProvider,
} from './common.js';

const require = createRequire(import.meta.url);
const NeteaseApi = require('NeteaseCloudMusicApi');
const PROVIDER = 'netease';
const cookie = () => readCookieFile(PROVIDER);
const apiQuery = (extra = {}) => ({ ...extra, timestamp: Date.now(), ...(cookie() ? { cookie: cookie() } : {}) });
async function callApi(fn, q, ms = 8000) { return withTimeout(fn(q), ms, 'netease_timeout'); }

function pickUrlData(body) {
  const list = body?.data || body?.body?.data || [];
  return Array.isArray(list) ? list[0] || null : null;
}
function isTrialEntry(e) { return e?.freeTrialInfo != null && e.freeTrialInfo !== ''; }

function mapNeteaseSong(s) {
  const artists = (s.artists || s.ar || []).map((a) => a?.name).filter(Boolean);
  return {
    id: s.id, title: s.name || '未知歌曲',
    artist: artists.join(' / ') || '未知歌手', artists,
    cover: s.album?.picUrl || s.al?.picUrl || null,
    duration: Math.round((s.duration || s.dt || 0) / 1000),
    durationMs: Number(s.duration || s.dt || 0) || 0,
    fee: s.fee ?? null, privilege: s.privilege || null,
    genre: '网易云', source: PROVIDER, provider: PROVIDER,
  };
}

export async function getMembership({ force = false } = {}) {
  const c = cookie();
  if (!c) {
    const next = { loggedIn: false, userId: null, nickname: null, isVip: false, isSvip: false, membershipKnown: false, stale: false, vipType: 0, vipLevel: 'none', vipLabel: '无VIP' };
    membershipCache.set('netease:membership', next, MEMBERSHIP_CACHE_TTL_MS);
    return next;
  }
  if (!force) {
    const hit = membershipCache.get('netease:membership');
    if (hit) return hit;
  }
  try {
    const st = await callApi(NeteaseApi.login_status, apiQuery({}), 4000);
    const body = st?.body || {};
    const data = body.data || body;
    const profile = data.profile || body.profile || null;
    const account = data.account || body.account || null;
    const vipType = Number(profile?.vipType ?? account?.vipType ?? 0) || 0;
    const isSvip = profile?.svip === true || vipType === 100 || vipType === 200;
    const isVip = isSvip || vipType >= 11;
    const next = {
      loggedIn: Boolean(profile || account),
      userId: profile?.userId || account?.id || null,
      nickname: profile?.nickname || null,
      avatar: profile?.avatarUrl || '',
      isVip, isSvip, membershipKnown: true, stale: false,
      vipType, vipLevel: isSvip ? 'svip' : isVip ? 'vip' : 'none',
      vipLabel: isSvip ? 'SVIP' : isVip ? 'VIP' : '无VIP',
    };
    membershipCache.set('netease:membership', next, MEMBERSHIP_CACHE_TTL_MS);
    return next;
  } catch (e) {
    const prev = membershipCache.get('netease:membership');
    const merged = { loggedIn: !!prev?.loggedIn, ...mergeMembership(prev, null, { probeFailed: true }), nickname: prev?.nickname || null };
    membershipCache.set('netease:membership', merged, 30000);
    logProvider(`netease membership fail: ${e.message}`);
    return merged;
  }
}

export async function search({ q = '', limit = 20 } = {}) {
  const res = await callApi(NeteaseApi.search, apiQuery({ keywords: String(q || '热歌'), type: 1, limit: Math.min(50, Number(limit) || 20), offset: 0 }), 8000);
  const songs = res?.body?.result?.songs || [];
  return songs.map(mapNeteaseSong);
}

export async function lyric({ id }) {
  const res = await callApi(NeteaseApi.lyric, apiQuery({ id: Number(id) }), 6000);
  const body = res?.body || {};
  return { provider: PROVIDER, id: Number(id), lrc: body.lrc?.lyric || '', tlyric: body.tlyric?.lyric || '' };
}

async function tryResolveOne(id, level, deadline) {
  const remain = remainingBudget(deadline);
  if (remain <= 0) return { ok: false, level, reason: 'budget_exceeded' };
  const br = NETEASE_BR_BY_LEVEL[level] || 320000;
  let entry = null;
  try {
    const r = await callApi(NeteaseApi.song_url_v1, apiQuery({ id: Number(id), level }), Math.min(2200, remain));
    entry = pickUrlData(r?.body || r);
  } catch (e) { logProvider(`song_url_v1 ${id}/${level}: ${e.message}`); }
  if (!entry?.url) {
    const r2 = remainingBudget(deadline);
    if (r2 > 0) {
      try {
        const r = await callApi(NeteaseApi.song_url, apiQuery({ id: Number(id), br }), Math.min(1800, r2));
        entry = pickUrlData(r?.body || r);
      } catch (e) { logProvider(`song_url ${id}/${br}: ${e.message}`); }
    }
  }
  if (!entry?.url || String(entry.url).includes('404')) return { ok: false, level, reason: 'empty_or_404' };
  const trial = isTrialEntry(entry);
  const url = String(entry.url);
  const probe = await probeAudioUrl(url, { headers: { Referer: 'https://music.163.com/' }, timeoutMs: Math.min(2000, remainingBudget(deadline) || 500) });
  if (!probe.ok) return { ok: false, level, url, trial, reason: probe.reason };
  return { ok: true, level, url, trial, quality: entry.type || level, br: entry.br || br };
}

export async function getSongUrl({ id, level = 'exhigh', songMeta = null } = {}) {
  const songId = Number(id);
  if (!Number.isFinite(songId) || songId <= 0) {
    return makePlayResult({ provider: PROVIDER, playable: false, restriction: classifyRestriction({ playable: false, copyrightOk: false }) });
  }
  const requestedQuality = NETEASE_QUALITY_LADDER.includes(level) ? level : 'exhigh';
  const cacheKey = `netease:url:${songId}:${requestedQuality}`;
  const cached = urlCache.get(cacheKey);
  if (cached) return cached;
  const membership = await getMembership();
  const deadline = Date.now() + URL_RESOLVE_BUDGET_MS;
  const probeFailures = [];
  const ladder = NETEASE_QUALITY_LADDER.slice(NETEASE_QUALITY_LADDER.indexOf(requestedQuality));
  let best = null;
  let lastLevel = requestedQuality;
  for (const lv of ladder) {
    if (remainingBudget(deadline) <= 0) break;
    lastLevel = lv;
    const attempt = await tryResolveOne(songId, lv, deadline);
    if (!attempt.ok) probeFailures.push({ level: lv, reason: attempt.reason, url: attempt.url || '' });
    if (attempt.ok) { best = attempt; break; }
  }
  let detail = null;
  if (!best) {
    try {
      const r = await callApi(NeteaseApi.song_detail, apiQuery({ ids: String(songId) }), 4000);
      detail = r?.body?.songs?.[0] || null;
    } catch {}
  }
  const fee = Number(detail?.fee ?? songMeta?.fee ?? 0) || 0;
  const privilege = detail?.privilege || songMeta?.privilege || null;
  const noCopyright = Number(privilege?.st ?? 0) < 0;
  const vipRequired = !best && (fee === 1 || fee === 4 || privilege?.fee === 1);
  const paidRequired = !best && fee === 4;
  const playable = Boolean(best?.ok && best.url);
  const trial = Boolean(best?.trial);
  const restriction = classifyRestriction({
    playable, url: best?.url || '', trial,
    loggedIn: membership.loggedIn, vipRequired, paidRequired,
    copyrightOk: !noCopyright,
    needsLogin: !membership.loggedIn && !playable && (vipRequired || trial),
    level: best?.level || lastLevel,
  });
  const result = makePlayResult({
    provider: PROVIDER,
    url: playable ? best.url : '',
    playable, trial,
    loggedIn: membership.loggedIn,
    vipRequired, restriction,
    level: best?.level || lastLevel,
    quality: best?.quality || lastLevel,
    br: best?.br || null,
    requestedQuality,
    probeFailures,
  });
  urlCache.set(cacheKey, result, result.playable ? URL_CACHE_TTL_MS : 60000);
  return result;
}

export async function loginByCookie(raw) {
  const normalized = normalizeCookieHeader(raw);
  if (!normalized) return { ok: false, error: '请提供网易云 Cookie', code: 'INVALID_NETEASE_COOKIE' };
  if (!parseCookieString(normalized).MUSIC_U) return { ok: false, error: '网易云 cookie 缺少 MUSIC_U', code: 'INVALID_NETEASE_COOKIE' };
  writeCookieFile(PROVIDER, normalized);
  membershipCache.clear();
  urlCache.clear();
  const status = await getMembership({ force: true });
  return { ok: true, loggedIn: status.loggedIn, nickname: status.nickname || null, userId: status.userId || null, message: status.loggedIn ? '网易云 Cookie 已生效' : 'Cookie 已保存，平台校验未通过' };
}

export async function qrKey() {
  const res = await callApi(NeteaseApi.login_qr_key, apiQuery({}), 6000);
  const key = res?.body?.data?.unikey || null;
  return key ? { ok: true, key } : { ok: false, error: '获取二维码 key 失败' };
}
export async function qrCreate(key) {
  const res = await callApi(NeteaseApi.login_qr_create, { key: String(key), qrimg: true }, 6000);
  const d = res?.body?.data || {};
  return { ok: true, key: String(key), qrurl: d.qrurl || '', img: d.qrimg || '', qrimg: d.qrimg || '' };
}
export async function qrCheck(key) {
  let res = await callApi(NeteaseApi.login_qr_check, { key: String(key), noCookie: true }, 6000);
  let body = res?.body || {};
  let code = Number(body.code ?? 0);
  let newCookie = normalizeCookieHeader(res?.cookie || body.cookie || body.data?.cookie || '');
  if (code === 803 && !newCookie) {
    try {
      const retry = await callApi(NeteaseApi.login_qr_check, { key: String(key) }, 6000);
      const c = normalizeCookieHeader(retry?.cookie || retry?.body?.cookie || '');
      if (c) { res = retry; body = retry.body || body; code = Number(body.code ?? code); newCookie = c; }
    } catch {}
  }
  if (code === 803 && newCookie) {
    writeCookieFile(PROVIDER, newCookie);
    membershipCache.clear();
    const info = await getMembership({ force: true });
    return { ok: true, code, status: 'success', loggedIn: info.loggedIn, nickname: info.nickname, hasCookie: true };
  }
  return { ok: true, code, status: code === 800 ? 'expired' : code === 802 ? 'scanned' : 'waiting', message: code === 800 ? '二维码已过期' : code === 802 ? '已扫码请确认' : '等待扫码', nickname: body.nickname };
}

export async function loginStatus() {
  const s = await getMembership({ force: true });
  return { provider: PROVIDER, loggedIn: s.loggedIn, hasCookie: !!cookie(), userId: s.userId, nickname: s.nickname, isVip: !!s.isVip, isSvip: !!s.isSvip, membershipKnown: !!s.membershipKnown, stale: !!s.stale, vipType: s.vipType || 0, vipLevel: s.vipLevel || 'none', vipLabel: s.vipLabel || '无VIP' };
}
export async function logout() {
  writeCookieFile(PROVIDER, '');
  membershipCache.clear();
  urlCache.clear();
  return { ok: true, loggedIn: false };
}

/** 用户歌单（含「我喜欢的音乐」） */
export async function listPlaylists() {
  const membership = await getMembership({ force: true });
  if (!membership.loggedIn || !membership.userId) {
    return { provider: PROVIDER, loggedIn: false, playlists: [], message: '请先登录网易云' };
  }
  const res = await callApi(NeteaseApi.user_playlist, apiQuery({ uid: membership.userId, limit: 100 }), 8000);
  const raw = res?.body?.playlist || [];
  const playlists = raw.map((p) => ({
    id: p.id,
    name: p.name || '未命名歌单',
    cover: p.coverImgUrl || p.picUrl || null,
    trackCount: Number(p.trackCount || 0),
    creator: p.creator?.nickname || membership.nickname || '',
    isFavorite: p.specialType === 5 || /我喜欢|喜欢的音乐/.test(String(p.name || '')),
    provider: PROVIDER,
  }));
  return { provider: PROVIDER, loggedIn: true, playlists, userId: membership.userId };
}

export async function playlistTracks({ id, limit = 100 } = {}) {
  if (!id) return { provider: PROVIDER, songs: [], message: '缺少歌单 id' };
  const res = await callApi(NeteaseApi.playlist_track_all, apiQuery({ id: Number(id), limit: Math.min(200, Number(limit) || 100) }), 10000);
  const songs = (res?.body?.songs || []).map(mapNeteaseSong);
  return { provider: PROVIDER, id, songs, count: songs.length };
}

export async function listLikes() {
  const membership = await getMembership({ force: true });
  if (!membership.loggedIn || !membership.userId) {
    return { provider: PROVIDER, loggedIn: false, songs: [], message: '请先登录网易云' };
  }
  const likelist = await callApi(NeteaseApi.likelist, apiQuery({ uid: membership.userId }), 6000);
  const ids = likelist?.body?.ids || [];
  if (!ids.length) return { provider: PROVIDER, loggedIn: true, songs: [], count: 0 };
  const songs = [];
  for (let i = 0; i < ids.length && songs.length < 100; i += 100) {
    const batch = ids.slice(i, i + 100);
    try {
      const detail = await callApi(NeteaseApi.song_detail, apiQuery({ ids: batch.join(',') }), 8000);
      songs.push(...(detail?.body?.songs || []).map(mapNeteaseSong));
    } catch (e) {
      logProvider(`netease likes batch: ${e.message}`);
    }
  }
  return { provider: PROVIDER, loggedIn: true, songs, count: songs.length };
}

export const neteaseProvider = {
  name: PROVIDER, search, lyric, getSongUrl, getMembership, loginByCookie,
  qrKey, qrCreate, qrCheck, loginStatus, logout,
  listPlaylists, playlistTracks, listLikes,
  qualityLadder: NETEASE_QUALITY_LADDER,
};
export default neteaseProvider;
