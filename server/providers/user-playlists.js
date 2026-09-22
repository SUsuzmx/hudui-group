/**
 * 网页云 + QQ 用户歌单（移植自 Mineradio qq-netease-playlists.js）
 * - 网页云：分页拉全量 / 单页；曲目三级降级
 * - QQ：创建 + 收藏 +「我喜欢」(musicu dirid=201) 合并
 */
import {
  readCookieFile, parseCookieString, serializeCookieObject, normalizeCookieHeader,
  withTimeout, logProvider,
} from './common.js';
import { parseQqAuth, normalizeQQCookieInput } from './qq.js';
import * as ncm from 'NeteaseCloudMusicApi';

const NETEASE_PLAYLIST_SYNC_PAGE_SIZE = 200;
const NETEASE_PLAYLIST_SYNC_MAX_PAGES = 80;
const NETEASE_TRACK_SYNC_PAGE_SIZE = 500;
const NETEASE_TRACK_SYNC_MAX_PAGES = 80;
const NETEASE_TRACK_STREAM_PAGE_SIZE = 200;
const NETEASE_PLAYLIST_TRACK_INDEX_TTL_MS = 10 * 60 * 1000;
const QQ_PLAYLIST_SYNC_PAGE_SIZE = 200;
const QQ_PLAYLIST_SYNC_MAX_PAGES = 25;

export const QQ_LIKED_PLAYLIST_ID = 'liked';
const QQ_LIKED_DIRID = 201;
const QQ_LIKED_PLAYLIST_NAME = 'QQ 音乐·我的喜欢';
const QQ_LIKED_PLAYLIST_COVER = 'https://y.gtimg.cn/mediastyle/global/img/cover_like.png';
const QQ_LIKED_AUTH_MESSAGE = 'QQ 音乐「我的喜欢」需要完整 QQ 音乐授权。请重新打开官方 QQ 音乐登录窗口，等待进入播放器页后再关闭。';
const QQ_LIKED_AUTH_CODES = [1000, 10004, 104003, 301, -100008];
const MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QQ_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function neteaseCookie() {
  try { return readCookieFile('netease') || undefined; } catch { return undefined; }
}
function qqCookie() {
  try { return readCookieFile('qq') || ''; } catch { return ''; }
}
export function getQQLoginInfo() {
  const auth = parseQqAuth(qqCookie());
  return {
    loggedIn: auth.loggedIn,
    userId: auth.uin,
    uin: auth.uin,
    nickname: 'QQ 音乐',
    playbackKeyReady: !!auth.authst,
  };
}
function getNeteaseLoginInfo() {
  const raw = neteaseCookie() || '';
  const map = parseCookieString(raw);
  const uid = String(map.__csrf && map.MUSIC_U ? '' : '') || extractNcmUid(map);
  const loggedIn = !!map.MUSIC_U;
  return { loggedIn, userId: uid || map.userId || map.uid || '' };
}
function extractNcmUid(map) {
  // MUSIC_U 解码后常含用户 id 片段；无则用 cookie 里的 uid 字段
  return String(map.uid || map.userId || map.userid || '');
}

function mapArtists(raw) {
  return (raw || []).map((a) => ({ id: a && a.id, name: (a && a.name) || '' })).filter((a) => a.name);
}

function mapNeteaseSongRecord(s) {
  s = s || {};
  const artists = mapArtists(s.ar || s.artists);
  const album = s.al || s.album || {};
  return {
    provider: 'netease', source: 'netease', type: 'song',
    id: s.id, name: s.name, title: s.name,
    artist: artists.map((a) => a.name).join(' / '),
    artists, artistId: artists[0] && artists[0].id,
    album: album.name || '', albumId: album.id || '',
    cover: album.picUrl || album.coverUrl || '',
    duration: Math.round((s.dt || s.duration || 0) / 1000) || 0,
    durationMs: s.dt || s.duration || 0,
    popularity: Number(s.pop || s.popularity || s.score || s.hotScore || 0) || 0,
    fee: s.fee,
  };
}

function mapNeteasePlaylistMeta(pl, fallbackId) {
  pl = pl || {};
  return {
    provider: 'netease', source: 'netease',
    id: pl.id || fallbackId,
    name: pl.name || '',
    cover: pl.coverImgUrl || pl.cover || '',
    trackCount: pl.trackCount || pl.track_count || 0,
    playCount: pl.playCount || pl.play_count || 0,
    creator: (pl.creator && pl.creator.nickname) || pl.creatorNickname || '',
    subscribed: !!pl.subscribed,
    specialType: pl.specialType || 0,
  };
}

function mapQQArtists(raw) {
  return (raw || []).map((a) => ({ id: a && a.id, mid: a && a.mid, name: (a && (a.name || a.title)) || '' })).filter((a) => a.name);
}

function qqAlbumCover(albumMid, size = 300) {
  if (!albumMid) return '';
  return `https://y.qq.com/music/photo_new/T002R${size}x${size}M000${albumMid}.jpg?max_age=2592000`;
}

export function decodeQQName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const candidates = [raw];
  if (/^(?:[0-9a-fA-F]{2}){2,}$/.test(raw)) {
    try {
      const decodedHex = Buffer.from(raw, 'hex').toString('utf8').trim();
      if (decodedHex && /[^ -~]/.test(decodedHex)) candidates.push(decodedHex);
    } catch { /* ignore */ }
  }
  const plusSafe = raw.replace(/\+/g, '%20');
  try { candidates.push(decodeURIComponent(plusSafe).trim()); } catch { /* ignore */ }
  for (const item of candidates) {
    if (item && /[一-鿿]/.test(item)) return item;
  }
  return candidates[0] || '';
}

function isQQLikedPlaylistId(id) {
  const v = String(id || '').trim().toLowerCase();
  return v === QQ_LIKED_PLAYLIST_ID || v === 'qq-liked' || v === String(QQ_LIKED_DIRID);
}

export function isQQFavoritePlaylist(pl) {
  if (pl && (isQQLikedPlaylistId(pl.id) || Number(pl.dirid || 0) === QQ_LIKED_DIRID)) return true;
  const name = String((pl && pl.name) || (pl && pl.diss_name) || '').trim();
  const n = name.replace(/[·•・_\-\s]+/g, '').toLowerCase();
  return ['我喜欢', '我的喜欢', '喜欢的音乐', 'qq音乐我喜欢', 'qq音乐我的喜欢', 'qq音乐喜欢的音乐'].includes(n);
}

function isQzoneBackgroundPlaylist(pl) {
  const text = String(((pl && pl.name) || '') + ' ' + ((pl && pl.creator) || '')).toLowerCase();
  return /qzone|空间|背景音乐/i.test(text);
}

function mapQQPlaylist(pl, kind) {
  pl = pl || {};
  const dirid = pl.dirid || pl.dir_id || '';
  const liked = Number(dirid || 0) === QQ_LIKED_DIRID || isQQFavoritePlaylist(pl);
  const id = liked ? QQ_LIKED_PLAYLIST_ID : (pl.dissid || pl.tid || dirid || pl.id || pl.diss_id);
  const rawName = pl.diss_name || pl.name || pl.title || '';
  return {
    provider: 'qq', source: 'qq',
    id: id ? String(id) : '',
    dirid: dirid ? String(dirid) : '',
    virtual: liked,
    name: liked ? QQ_LIKED_PLAYLIST_NAME : (decodeQQName(rawName) || rawName),
    cover: liked ? QQ_LIKED_PLAYLIST_COVER : (pl.diss_cover || pl.logo || pl.picurl || pl.cover || ''),
    trackCount: pl.song_cnt || pl.songnum || pl.total_song_num || pl.song_count || 0,
    playCount: pl.listen_num || pl.visitnum || pl.play_count || 0,
    creator: pl.hostname || pl.nick || pl.creator || 'QQ 音乐',
    subscribed: kind === 'collect',
    specialType: liked ? 5 : 0,
  };
}

function mapQQPlaylistTrack(raw) {
  raw = raw || {};
  const track = (raw.songid || raw.songmid || raw.mid || raw.name) ? raw : (raw.track_info || raw.songInfo || raw.songinfo || raw.song || {});
  const album = track.album || {};
  const artists = mapQQArtists(track.singer || track.singers || []);
  const mid = track.mid || track.songmid || raw.mid || raw.songmid || '';
  const albumMid = album.mid || track.albummid || raw.albummid || '';
  return {
    provider: 'qq', source: 'qq', type: 'song',
    id: mid || String(track.id || track.songid || raw.id || raw.songid || ''),
    songId: track.id || track.songid || raw.id || raw.songid || null,
    mid, songmid: mid,
    mediaMid: (track.file && track.file.media_mid) || track.strMediaMid || track.media_mid || raw.strMediaMid || mid,
    name: track.name || track.songname || raw.songname || '',
    title: track.name || track.songname || raw.songname || '',
    artist: artists.map((a) => a.name).join(' / ') || track.singername || raw.singername || '',
    artists,
    album: album.name || album.title || track.albumname || raw.albumname || '',
    albumMid,
    cover: qqAlbumCover(albumMid, 300),
    duration: Number(track.interval || raw.interval) || 0,
    durationMs: (Number(track.interval || raw.interval) || 0) * 1000,
    fee: track.pay && Number(track.pay.pay_play) ? 1 : 0,
  };
}

async function musicu(reqs, { timeoutMs = 8000 } = {}) {
  const auth = parseQqAuth(qqCookie());
  const body = {
    comm: { uin: Number(auth.uin || 0) || 0, format: 'json', ct: 24, cv: 0, ...(auth.authst ? { authst: auth.authst } : {}) },
    ...reqs,
  };
  const res = await withTimeout(fetch(MUSICU, {
    method: 'POST',
    headers: {
      'User-Agent': QQ_UA,
      Referer: 'https://y.qq.com/',
      'Content-Type': 'application/json',
      ...(qqCookie() ? { Cookie: qqCookie() } : {}),
    },
    body: JSON.stringify(body),
  }), timeoutMs, 'qq_musicu_timeout');
  return JSON.parse(String(await res.text() || '').trim().replace(/^callback\(([\s\S]*)\);?$/, '$1'));
}

async function qqGetJSON(targetUrl, params, opts = {}) {
  const u = new URL(targetUrl);
  Object.keys(params || {}).forEach((key) => {
    if (params[key] !== undefined && params[key] !== null) u.searchParams.set(key, params[key]);
  });
  const headers = {
    Referer: (opts.headers && opts.headers.Referer) || 'https://y.qq.com/',
    'User-Agent': QQ_UA,
  };
  if (opts.cookie !== false) {
    const c = qqCookie();
    if (c) headers.Cookie = c;
  }
  const res = await withTimeout(fetch(u.toString(), { headers, redirect: 'follow' }), opts.timeoutMs || 10000, 'qq_get_json');
  return res.json();
}

// ---------- 网易云歌单 ----------

function mergeUniqueNeteasePlaylists(target, incoming, seen) {
  (incoming || []).forEach((pl) => {
    const id = String((pl && pl.id) || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    target.push(pl);
  });
}

async function fetchAllNeteaseUserPlaylists(uid, maxItems) {
  const playlists = [];
  const seen = new Set();
  let offset = 0;
  let total = 0;
  for (let page = 0; page < NETEASE_PLAYLIST_SYNC_MAX_PAGES; page += 1) {
    const r = await ncm.user_playlist({
      uid, limit: NETEASE_PLAYLIST_SYNC_PAGE_SIZE, offset,
      cookie: neteaseCookie(), timestamp: Date.now(),
    });
    const body = r.body || r || {};
    const raw = Array.isArray(body.playlist) ? body.playlist : [];
    total = Number(body.total || body.count || total) || total;
    mergeUniqueNeteasePlaylists(playlists, raw, seen);
    if (maxItems && playlists.length >= maxItems) break;
    if (!raw.length || raw.length < NETEASE_PLAYLIST_SYNC_PAGE_SIZE) break;
    if (total && playlists.length >= total) break;
    offset += NETEASE_PLAYLIST_SYNC_PAGE_SIZE;
  }
  return maxItems ? playlists.slice(0, maxItems) : playlists;
}

export async function handleNeteaseUserPlaylists(opts = {}) {
  const info = getNeteaseLoginInfo();
  if (!info.loggedIn) return { loggedIn: false, provider: 'netease', playlists: [] };
  // uid 可能只在 cookie 里缺失，尝试从 user_account 拉
  let uid = info.userId;
  if (!uid) {
    try {
      const acc = await ncm.user_account({ cookie: neteaseCookie(), timestamp: Date.now() });
      uid = String(acc?.body?.account?.id || acc?.body?.profile?.userId || '');
    } catch (e) { logProvider(`netease uid: ${e.message}`); }
  }
  if (!uid) return { loggedIn: true, provider: 'netease', playlists: [], message: '缺少网易云 uid' };
  const rawPlaylists = await fetchAllNeteaseUserPlaylists(uid, opts.maxItems || 0);
  return {
    loggedIn: true, provider: 'netease', userId: uid,
    playlists: rawPlaylists.map((pl) => mapNeteasePlaylistMeta(pl, pl && pl.id)),
  };
}

function neteaseRawTrackKey(track, fallback) {
  track = track || {};
  const privilege = track.privilege || {};
  const album = track.al || track.album || {};
  return String(track.id || track.songId || privilege.id || ((track.name || '') + '|' + (album.id || album.name || '') + '|' + fallback));
}

function mergeUniqueNeteaseTracks(target, incoming, seen) {
  let added = 0;
  (incoming || []).forEach((track, index) => {
    const key = neteaseRawTrackKey(track, target.length + ':' + index);
    if (!key || seen.has(key)) return;
    seen.add(key);
    target.push(track);
    added += 1;
  });
  return added;
}

const neteasePlaylistTrackIndexCache = new Map();
const neteasePlaylistTrackIndexInflight = new Map();

function pruneNeteasePlaylistTrackIndexCache() {
  const now = Date.now();
  for (const [key, entry] of neteasePlaylistTrackIndexCache.entries()) {
    if (!entry || now - entry.updatedAt > NETEASE_PLAYLIST_TRACK_INDEX_TTL_MS) neteasePlaylistTrackIndexCache.delete(key);
  }
}

async function fetchNeteasePlaylistDetailMeta(id) {
  const detail = await ncm.playlist_detail({ id, s: 0, cookie: neteaseCookie(), timestamp: Date.now() });
  const pl = (detail.body && detail.body.playlist) || {};
  return { playlistMeta: mapNeteasePlaylistMeta(pl, id), tracks: Array.isArray(pl.tracks) ? pl.tracks : [] };
}

async function fetchNeteasePlaylistTrackIndex(id) {
  const key = String(id || '');
  if (!key) return null;
  pruneNeteasePlaylistTrackIndexCache();
  const cached = neteasePlaylistTrackIndexCache.get(key);
  if (cached && Date.now() - cached.updatedAt <= NETEASE_PLAYLIST_TRACK_INDEX_TTL_MS) {
    neteasePlaylistTrackIndexCache.delete(key);
    neteasePlaylistTrackIndexCache.set(key, cached);
    return cached;
  }
  if (neteasePlaylistTrackIndexInflight.has(key)) return neteasePlaylistTrackIndexInflight.get(key);
  const pending = (async () => {
    const detail = await ncm.playlist_detail({ id, s: 0, cookie: neteaseCookie(), timestamp: Date.now() });
    const pl = (detail.body && detail.body.playlist) || {};
    const rawIds = (Array.isArray(pl.trackIds) && pl.trackIds.length ? pl.trackIds : (pl.tracks || []));
    const trackIds = rawIds.map((item) => item && (item.id || item.songId || item.trackId)).filter(Boolean);
    const entry = { playlistMeta: mapNeteasePlaylistMeta(pl, id), trackIds, updatedAt: Date.now() };
    if (!entry.playlistMeta.trackCount) entry.playlistMeta.trackCount = trackIds.length;
    neteasePlaylistTrackIndexCache.set(key, entry);
    pruneNeteasePlaylistTrackIndexCache();
    return entry;
  })().finally(() => { neteasePlaylistTrackIndexInflight.delete(key); });
  neteasePlaylistTrackIndexInflight.set(key, pending);
  return pending;
}

async function fetchAllNeteasePlaylistTracks(id) {
  let playlistMeta = { id, name: '', cover: '', trackCount: 0 };
  let detailTracks = [];
  try {
    const detail = await fetchNeteasePlaylistDetailMeta(id);
    playlistMeta = detail.playlistMeta || playlistMeta;
    detailTracks = detail.tracks || [];
  } catch (err) {
    logProvider(`netease playlist_detail meta: ${err.message}`);
  }
  const rawTracks = [];
  const seen = new Set();
  const expectedTotal = Number(playlistMeta.trackCount || 0) || 0;
  let offset = 0;
  for (let page = 0; page < NETEASE_TRACK_SYNC_MAX_PAGES; page += 1) {
    try {
      const all = await ncm.playlist_track_all({
        id, limit: NETEASE_TRACK_SYNC_PAGE_SIZE, offset,
        cookie: neteaseCookie(), timestamp: Date.now(),
      });
      const body = all.body || all || {};
      const rows = body.songs || body.tracks || [];
      const added = mergeUniqueNeteaseTracks(rawTracks, rows, seen);
      if (!rows.length || !added) break;
      if (expectedTotal && rawTracks.length >= expectedTotal) break;
      if (!expectedTotal && rows.length < NETEASE_TRACK_SYNC_PAGE_SIZE) break;
      offset += NETEASE_TRACK_SYNC_PAGE_SIZE;
    } catch (err) {
      logProvider(`netease playlist_track_all: ${err.message}`);
      break;
    }
  }
  if (!rawTracks.length && detailTracks.length) mergeUniqueNeteaseTracks(rawTracks, detailTracks, seen);
  return { playlistMeta, rawTracks };
}

export async function handleNeteasePlaylistTracks(id, opts = {}) {
  const mapTracks = (t) => t.map(mapNeteaseSongRecord).filter((x) => x.id);
  const synced = await fetchAllNeteasePlaylistTracks(id);
  const playlist = synced.playlistMeta || { id, name: '', cover: '', trackCount: 0 };
  const tracks = mapTracks(synced.rawTracks || []);
  if (!playlist.trackCount) playlist.trackCount = tracks.length;
  return { provider: 'netease', source: 'netease', playlist, tracks };
}

// ---------- QQ 我喜欢 ----------

const qqLikedPlaylistCoverByUser = new Map();

function buildQQLikedPlaylistCard(info, likedPage, warning) {
  const tracks = (likedPage && likedPage.tracks) || [];
  const firstTrack = tracks[0] || null;
  const pageOffset = Math.max(0, Number(likedPage && likedPage.offset) || 0);
  const key = String((info && (info.userId || info.uin)) || '');
  if (likedPage && pageOffset === 0 && firstTrack && firstTrack.cover && key) qqLikedPlaylistCoverByUser.set(key, firstTrack.cover);
  const stableCover = key ? String(qqLikedPlaylistCoverByUser.get(key) || '') : '';
  const count = Number(likedPage && likedPage.total) || tracks.length || 0;
  return {
    provider: 'qq', source: 'qq',
    id: QQ_LIKED_PLAYLIST_ID,
    dirid: String(QQ_LIKED_DIRID),
    virtual: true,
    name: QQ_LIKED_PLAYLIST_NAME,
    cover: stableCover || (pageOffset === 0 && firstTrack && firstTrack.cover) || QQ_LIKED_PLAYLIST_COVER,
    trackCount: count,
    playCount: 0,
    creator: (info && (info.nickname || info.userId)) || 'QQ 音乐',
    subscribed: false,
    specialType: 5,
    requiresPlaybackKey: warning === 'QQ_LIKED_REQUIRES_PLAYBACK_LOGIN',
    warning: warning || '',
  };
}

async function fetchQQLikedPlaylistPage(opts = {}) {
  const limit = Math.max(1, Math.min(100, parseInt(opts.limit || '48', 10) || 48));
  const offset = Math.max(0, parseInt(opts.offset || '0', 10) || 0);
  const body = await musicu({
    req_0: {
      module: 'music.srfDissInfo.DissInfo',
      method: 'CgiGetDiss',
      param: {
        disstid: 0,
        dirid: QQ_LIKED_DIRID,
        tag: 1,
        song_begin: offset,
        song_num: limit,
        userinfo: 1,
        orderlist: 1,
      },
    },
  }, { timeoutMs: 10000 });
  const block = body && body.req_0;
  const data = (block && block.data) || {};
  const code = Number((body && body.code)) || Number(block && block.code) || Number(data.code) || Number(data.subcode) || 0;
  if (!block || code !== 0) {
    const err = new Error('QQ_LIKED_SYNC_FAILED_' + code);
    err.code = QQ_LIKED_AUTH_CODES.includes(code) ? 'QQ_LIKED_REQUIRES_PLAYBACK_LOGIN' : 'QQ_LIKED_SYNC_FAILED';
    err.qqCode = code;
    throw err;
  }
  const rawTracks = Array.isArray(data.songlist) ? data.songlist : [];
  const tracks = rawTracks.map(mapQQPlaylistTrack).filter((song) => song.name && (song.mid || song.id));
  const pageSpan = Math.max(Number(data.songlist_size) || 0, rawTracks.length);
  const upstreamTotal = Math.max(0, Number(data.total_song_num) || 0);
  const total = upstreamTotal || offset + pageSpan;
  const nextOffset = offset + pageSpan;
  return {
    tracks, total, offset, limit, pageSpan, nextOffset,
    hasmore: !!Number(data.hasmore) || nextOffset < total,
    hasMore: !!Number(data.hasmore) || nextOffset < total,
    dirinfo: data.dirinfo || {},
  };
}

export async function fetchQQLikedPlaylistPagePublic(opts) { return fetchQQLikedPlaylistPage(opts); }

async function getQQLikedPlaylistCard(info) {
  if (!info || !info.playbackKeyReady) return buildQQLikedPlaylistCard(info, null, 'QQ_LIKED_REQUIRES_PLAYBACK_LOGIN');
  try {
    const likedPage = await fetchQQLikedPlaylistPage({ limit: 1, offset: 0 });
    return buildQQLikedPlaylistCard(info, likedPage, '');
  } catch (err) {
    return buildQQLikedPlaylistCard(info, null, err.code || err.message || 'QQ_LIKED_UNAVAILABLE');
  }
}

// ---------- QQ 创建 / 收藏 ----------

async function fetchQQCreatedPlaylists(uin) {
  const out = [];
  for (let page = 0; page < QQ_PLAYLIST_SYNC_MAX_PAGES; page += 1) {
    const sin = page * QQ_PLAYLIST_SYNC_PAGE_SIZE;
    const body = await qqGetJSON('https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss', {
      hostUin: 0, hostuin: uin, sin, size: QQ_PLAYLIST_SYNC_PAGE_SIZE,
      g_tk: 5381, loginUin: uin, format: 'json', inCharset: 'utf8', outCharset: 'utf-8',
      notice: 0, platform: 'yqq.json', needNewCode: 0,
    }, { headers: { Referer: 'https://y.qq.com/portal/profile.html' } });
    const rows = (body && body.data && Array.isArray(body.data.disslist)) ? body.data.disslist : [];
    out.push(...rows);
    if (rows.length < QQ_PLAYLIST_SYNC_PAGE_SIZE) break;
  }
  return out;
}

async function fetchQQCollectedPlaylists(uin) {
  const out = [];
  for (let page = 0; page < QQ_PLAYLIST_SYNC_MAX_PAGES; page += 1) {
    const sin = page * QQ_PLAYLIST_SYNC_PAGE_SIZE;
    const body = await qqGetJSON('https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg', {
      ct: 20, cid: 205360956, userid: uin, reqtype: 3,
      sin, ein: sin + QQ_PLAYLIST_SYNC_PAGE_SIZE - 1,
    }, { headers: { Referer: 'https://y.qq.com/portal/profile.html' } });
    const rows = (body && body.data && Array.isArray(body.data.cdlist)) ? body.data.cdlist : [];
    out.push(...rows);
    if (rows.length < QQ_PLAYLIST_SYNC_PAGE_SIZE) break;
  }
  return out;
}

export async function handleQQUserPlaylists() {
  const info = getQQLoginInfo();
  if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'qq', playlists: [] };
  const uin = info.userId;
  const [createdRaw, collectRaw, likedRaw] = await Promise.allSettled([
    fetchQQCreatedPlaylists(uin),
    fetchQQCollectedPlaylists(uin),
    getQQLikedPlaylistCard(info),
  ]);
  const created = createdRaw.status === 'fulfilled' && Array.isArray(createdRaw.value)
    ? createdRaw.value.map((pl) => mapQQPlaylist(pl, 'created')) : [];
  const collected = collectRaw.status === 'fulfilled' && Array.isArray(collectRaw.value)
    ? collectRaw.value.map((pl) => mapQQPlaylist(pl, 'collect')) : [];
  const likedCard = likedRaw.status === 'fulfilled'
    ? likedRaw.value
    : buildQQLikedPlaylistCard(info, null, 'QQ_LIKED_UNAVAILABLE');
  const seen = new Set();
  const base = created.concat(collected).filter((pl) => !isQQFavoritePlaylist(pl));
  base.unshift(likedCard);
  const playlists = base.filter((pl) => {
    if (!pl.id || !pl.name || seen.has(pl.id)) return false;
    if (isQzoneBackgroundPlaylist(pl)) return false;
    seen.add(pl.id);
    return true;
  }).sort((a, b) => Number(isQQFavoritePlaylist(b)) - Number(isQQFavoritePlaylist(a)));
  return { loggedIn: true, provider: 'qq', userId: uin, playlists };
}

export async function handleQQPlaylistTracks(id, opts = {}) {
  const info = getQQLoginInfo();
  if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'qq', tracks: [] };
  const pid = String(id || '').trim();
  if (!pid) return { loggedIn: true, provider: 'qq', error: 'Missing QQ playlist id', tracks: [] };
  if (isQQLikedPlaylistId(pid)) {
    if (!info.playbackKeyReady) {
      return {
        loggedIn: true, provider: 'qq',
        playlist: buildQQLikedPlaylistCard(info, null, 'QQ_LIKED_REQUIRES_PLAYBACK_LOGIN'),
        tracks: [], error: 'QQ_LIKED_REQUIRES_PLAYBACK_LOGIN', message: QQ_LIKED_AUTH_MESSAGE,
        requiresPlaybackKey: true,
      };
    }
    try {
      const likedPage = await fetchQQLikedPlaylistPage({ limit: 100, offset: 0 });
      return {
        loggedIn: true, provider: 'qq',
        playlist: buildQQLikedPlaylistCard(info, likedPage, ''),
        tracks: likedPage.tracks,
        total: likedPage.total,
        limit: likedPage.limit,
        offset: likedPage.offset,
        nextOffset: likedPage.nextOffset,
        hasMore: likedPage.hasMore,
      };
    } catch (err) {
      const requiresPlaybackKey = err && err.code === 'QQ_LIKED_REQUIRES_PLAYBACK_LOGIN';
      return {
        loggedIn: true, provider: 'qq',
        playlist: buildQQLikedPlaylistCard(info, null, err.code || 'QQ_LIKED_UNAVAILABLE'),
        tracks: [],
        error: err.code || err.message || 'QQ_LIKED_UNAVAILABLE',
        message: requiresPlaybackKey ? QQ_LIKED_AUTH_MESSAGE : 'QQ 音乐「我的喜欢」同步失败，请稍后刷新重试。',
        requiresPlaybackKey,
      };
    }
  }
  const result = await qqGetJSON('https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg', {
    type: 1, utf8: 1, disstid: pid,
    song_begin: 0, song_num: 300,
    loginUin: info.userId, format: 'json', inCharset: 'utf8', outCharset: 'utf-8',
    notice: 0, platform: 'yqq.json', needNewCode: 0,
  }, { headers: { Referer: 'https://y.qq.com/n/yqq/playlist' } });
  const detail = (result && result.cdlist && result.cdlist[0]) ? result.cdlist[0] : {};
  const rawTracks = Array.isArray(detail.songlist) ? detail.songlist : [];
  const totalHint = Number(detail.total_song_num || detail.songnum || detail.song_cnt || detail.song_count || 0) || 0;
  const tracks = rawTracks.map(mapQQPlaylistTrack).filter((s) => s.name && (s.mid || s.id));
  const total = totalHint || tracks.length;
  const playlist = {
    provider: 'qq', source: 'qq',
    id: pid,
    name: decodeQQName(detail.dissname || detail.diss_name || detail.name || '') || (detail.dissname || detail.diss_name || detail.name || ''),
    cover: detail.logo || detail.diss_cover || '',
    trackCount: total,
  };
  return {
    loggedIn: true, provider: 'qq', playlist, tracks,
    offset: 0, limit: tracks.length, nextOffset: tracks.length,
    hasMore: tracks.length < total, total,
  };
}
