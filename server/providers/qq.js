import {
  QQ_QUALITY_CANDIDATES, URL_CACHE_TTL_MS, MEMBERSHIP_CACHE_TTL_MS, URL_RESOLVE_BUDGET_MS,
  urlCache, membershipCache, classifyRestriction, makePlayResult, normalizeQqMembership,
  mergeMembership, probeAudioUrl, withTimeout, readCookieFile, writeCookieFile,
  parseCookieString, normalizeCookieHeader, serializeCookieObject, qqSearchSign,
  isSameRecording, remainingBudget, logProvider,
} from './common.js';

const PROVIDER = 'qq';
const MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const MUSICS_SEARCH = 'https://u.y.qq.com/cgi-bin/musics.fcg';
const QQ_SMARTBOX = 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg';
const QQ_H5 = 'https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp';
const QQ_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const QQ_ANDROID_UA = 'QQMusic 14090508(android 12)';
const QQ_ANDROID_COMM = { ct: '11', cv: '14090508', v: '14090508', tmeAppID: 'qqmusic', phonetype: 'EBG-AN10', os_ver: '12', OpenUDID: '0', QIMEI36: '0', udid: '0', chid: '0', aid: '0', oaid: '0', taid: '0', tid: '0', wid: '0', uid: '0', sid: '0', modeSwitch: '6', teenMode: '0', ui_mode: '2', nettype: '1020' };

const cookie = () => readCookieFile(PROVIDER);
function parseJSONText(text) { return JSON.parse(String(text || '').trim().replace(/^callback\(([\s\S]*)\);?$/, '$1')); }

export function parseQqAuth(cookieStr) {
  const map = parseCookieString(cookieStr);
  const isWechat = !!map.wxopenid || Number(map.login_type) === 2;
  let raw = isWechat ? (map.wxuin || map.uin || map.p_uin) : (map.uin || map.qqmusic_uin || map.wxuin || map.p_uin || map.o_uin);
  let uin = String(raw || '').replace(/\D/g, '').replace(/^0+/, '') || String(raw || '').replace(/\D/g, '');
  const authst = map.qm_keyst || map.qqmusic_key || map.music_key || map.wxskey || '';
  return { uin: uin || '', authst, loggedIn: !!(uin && uin !== '0' && authst) };
}

export function qqCookieUin(obj) { return parseQqAuth(serializeCookieObject(obj || parseCookieString(cookie()))).uin; }
export function qqCookiePlaybackKey(obj) { return parseQqAuth(serializeCookieObject(obj || parseCookieString(cookie()))).authst; }

export function normalizeQQCookieInput(cookieText) {
  const obj = parseCookieString(normalizeCookieHeader(cookieText));
  if ((obj.wxopenid || Number(obj.login_type) === 2) && obj.wxuin) obj.uin = obj.wxuin;
  if (!obj.uin && (obj.qqmusic_uin || obj.p_uin)) obj.uin = obj.qqmusic_uin || obj.p_uin;
  if (obj.uin) obj.uin = String(obj.uin).replace(/\D/g, '').replace(/^0+/, '') || String(obj.uin).replace(/\D/g, '');
  return serializeCookieObject(obj);
}

async function musicu(reqs, { timeoutMs = 8000 } = {}) {
  const auth = parseQqAuth(cookie());
  const body = { comm: { uin: Number(auth.uin || 0) || 0, format: 'json', ct: 24, cv: 0, ...(auth.authst ? { authst: auth.authst } : {}) }, ...reqs };
  const res = await withTimeout(fetch(MUSICU, {
    method: 'POST',
    headers: { 'User-Agent': QQ_UA, Referer: 'https://y.qq.com/', 'Content-Type': 'application/json', ...(cookie() ? { Cookie: cookie() } : {}) },
    body: JSON.stringify(body),
  }), timeoutMs, 'qq_musicu_timeout');
  return parseJSONText(await res.text());
}

function qqAlbumCover(mid, size = 300) { return mid ? `https://y.qq.com/music/photo_new/T002R${size}x${size}M000${mid}.jpg?max_age=2592000` : ''; }
function toTrackShape(raw) {
  const artists = (raw.artists || []).map((a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean);
  return { ...raw, artists, title: raw.title || '未知歌曲', artist: raw.artist || artists.join(' / ') || '未知歌手', duration: Math.round(Number(raw.durationMs || 0) / 1000) || 0, durationMs: Number(raw.durationMs) || 0, genre: 'QQ音乐', source: PROVIDER, provider: PROVIDER };
}
function mapQQTrack(track, fallback = {}) {
  track = track || {};
  const album = track.album || {};
  const artists = (track.singer || []).map((a) => a?.name).filter(Boolean);
  const mid = track.mid || fallback.mid || '';
  return toTrackShape({
    id: track.id || fallback.id || mid, songId: track.id || fallback.songId || null,
    mid, songmid: mid, mediaMid: track.file?.media_mid || fallback.mediaMid || mid,
    title: track.name || fallback.title || '',
    artist: artists.join(' / ') || fallback.artist || '',
    artists, album: album.name || '', albumMid: album.mid || '',
    cover: qqAlbumCover(album.mid || fallback.albumMid) || fallback.cover || null,
    durationMs: (Number(track.interval) || 0) * 1000,
    pay: track.pay || fallback.pay || null,
    file: track.file || { media_mid: mid },
  });
}
function mapQQSmart(item = {}) {
  const mid = item.mid || item.songmid || item.id || '';
  return toTrackShape({ id: mid, mid, songmid: mid, mediaMid: mid, title: item.name || item.title || '', artist: item.singer || '', artists: item.singer ? [{ name: item.singer }] : [], cover: '', durationMs: 0, pay: null, file: { media_mid: mid } });
}
function mapQqH5(s) {
  return toTrackShape({
    id: s.songid || s.songmid, mid: s.songmid || '', songmid: s.songmid || '',
    mediaMid: s.strMediaMid || s.media_mid || s.songmid || '',
    title: s.songname || '', artists: (s.singer || []).map((x) => x.name).filter(Boolean),
    artist: (s.singer || []).map((x) => x.name).filter(Boolean).join(' / '),
    cover: qqAlbumCover(s.albummid) || null,
    durationMs: (Number(s.interval) || 0) * 1000,
    pay: s.pay || null, file: { media_mid: s.strMediaMid || s.media_mid || s.songmid || '' },
  });
}

export async function qqFullSongSearch(keywords, limit = 12, offset = 0) {
  const num = Math.max(1, Math.min(30, Number(limit) || 12));
  const off = Math.max(0, Number(offset) || 0);
  const payload = {
    comm: { ...QQ_ANDROID_COMM },
    req: {
      module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicMobile',
      param: { search_type: 0, searchid: String(Date.now()) + String(Math.random()).slice(2, 8), query: keywords, page_num: Math.floor(off / num) + 1, num_per_page: num, highlight: 0, nqc_flag: 0, multi_zhida: 0, cat: 2, grp: 1, sin: off, sem: 0 },
    },
  };
  const bodyText = JSON.stringify(payload);
  const sign = qqSearchSign(bodyText);
  const res = await withTimeout(fetch(`${MUSICS_SEARCH}?sign=${sign}`, {
    method: 'POST',
    headers: { 'User-Agent': QQ_ANDROID_UA, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyText), Referer: 'https://y.qq.com/' },
    body: bodyText,
  }), 10000, 'qq_search_sign_timeout');
  const json = parseJSONText(await res.text());
  const code = json?.req?.code ?? json?.code;
  if (code !== undefined && code !== 0 && code !== 200) throw new Error(`qq_search_sign_code_${code}`);
  const body = (json?.req?.data || json?.data || {}).body || json?.req?.data || {};
  const items = body.item_song || body.song?.list || body.list || [];
  return (Array.isArray(items) ? items : [])
    .map((item) => mapQQTrack(item?.track_info || item?.songInfo || item, {}))
    .filter((s) => s.title && (s.mid || s.id));
}

export async function qqSmartboxSearch(keywords, limit = 10) {
  const u = new URL(QQ_SMARTBOX);
  u.searchParams.set('format', 'json'); u.searchParams.set('key', keywords);
  u.searchParams.set('g_tk', '5381'); u.searchParams.set('loginUin', '0'); u.searchParams.set('hostUin', '0');
  u.searchParams.set('inCharset', 'utf8'); u.searchParams.set('outCharset', 'utf-8');
  u.searchParams.set('notice', '0'); u.searchParams.set('platform', 'yqq.json'); u.searchParams.set('needNewCode', '0');
  const text = await withTimeout(fetch(u.toString(), { headers: { 'User-Agent': QQ_UA, Referer: 'https://y.qq.com/' } }), 8000, 'qq_smartbox_timeout').then((r) => r.text());
  const items = parseJSONText(text)?.data?.song?.itemlist || [];
  return (Array.isArray(items) ? items : []).slice(0, Math.min(limit, 10)).map(mapQQSmart).filter((s) => s.title);
}

export async function search({ q = '', limit = 20 } = {}) {
  const keywords = String(q || '').trim() || '热歌';
  const num = Math.min(50, Number(limit) || 20);
  let base = [];
  try { base = await qqFullSongSearch(keywords, num, 0); } catch (e) { logProvider(`qq full search: ${e.message}`); }
  if (!base.length) {
    try { base = await qqSmartboxSearch(keywords, num); } catch (e) { logProvider(`qq smartbox: ${e.message}`); }
  }
  if (!base.length) {
    try {
      const qs = new URLSearchParams({ w: keywords, p: '1', n: String(num), format: 'json', inCharset: 'utf-8', outCharset: 'utf-8', platform: 'h5' });
      const text = await withTimeout(fetch(`${QQ_H5}?${qs}`, { headers: { 'User-Agent': QQ_UA, Referer: 'https://y.qq.com/' } }), 8000, 'qq_h5_timeout').then((r) => r.text());
      base = (parseJSONText(text)?.data?.song?.list || []).map(mapQqH5);
    } catch (e) { logProvider(`qq h5: ${e.message}`); }
  }
  const seen = new Set();
  return base.filter((s) => {
    const k = String(s.mid || s.id || s.title);
    if (!s.title || seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, num);
}

export async function lyric({ id, mid = '' }) {
  const songmid = String(mid || id || '');
  const data = await musicu({
    req_0: { module: 'music.musichallSong.PlayLyricInfo', method: 'GetPlayLyricInfo', param: { songMID: songmid, songID: Number(id) || 0 } },
  }, { timeoutMs: 6000 });
  const d = data?.req_0?.data || {};
  const dec = (b64) => { try { return Buffer.from(String(b64 || ''), 'base64').toString('utf8'); } catch { return ''; } };
  return { provider: PROVIDER, id, mid: songmid, lrc: dec(d.lyric), tlyric: dec(d.trans) };
}

export async function fetchVkey({ songmid, mediaMid, candidates, timeoutMs = 6000 }) {
  const mid = String(songmid || mediaMid || '');
  const media = String(mediaMid || songmid || '');
  if (!mid) return { ok: false, midurlinfo: [], sip: [] };
  const filenames = candidates.map((c) => `${c.prefix}${media}.${c.ext}`);
  const data = await musicu({
    req_0: {
      module: 'vkey.GetVkeyServer', method: 'CgiGetVkey',
      param: {
        guid: '1000000000', songtype: candidates.map(() => 0),
        uin: String(parseQqAuth(cookie()).uin || '0'), loginflag: 1, platform: '20',
        filename: filenames, songmid: candidates.map(() => mid),
      },
    },
  }, { timeoutMs });
  const body = data?.req_0?.data || {};
  return { ok: true, filenames, midurlinfo: body.midurlinfo || [], sip: body.sip || [], code: body.code };
}

export function buildVkeyUrls({ filenames = [], midurlinfo = [], sip = [], candidates = [] }) {
  const sips = (Array.isArray(sip) ? sip : [sip]).filter(Boolean);
  return filenames.map((fn, i) => {
    const info = midurlinfo[i] || midurlinfo.find((m) => m?.filename === fn);
    const purl = info?.purl || '';
    if (!purl) return { url: '', filename: fn, candidate: candidates[i] || null, reason: 'empty_purl' };
    const full = purl.startsWith('http') ? purl : `${(sips[0] || 'http://ws.stream.qqmusic.qq.com/').replace(/\/?$/, '/')}${purl.replace(/^\//, '')}`;
    return { url: full, filename: fn, candidate: candidates[i] || null };
  });
}

export async function getSongUrl({ id, mid, mediaMid, level = 'exhigh', songMeta = null } = {}) {
  const songId = id ?? songMeta?.id ?? null;
  const songmid = String(mid || songMeta?.mid || mediaMid || id || '');
  const media = String(mediaMid || songMeta?.mediaMid || songmid || '');
  const requestedQuality = level || 'exhigh';
  if (!songmid && !media) {
    return makePlayResult({ provider: PROVIDER, playable: false, restriction: classifyRestriction({ playable: false, copyrightOk: false }), requestedQuality });
  }
  const cacheKey = `qq:url:${songId || songmid}:${requestedQuality}`;
  const cached = urlCache.get(cacheKey);
  if (cached) return cached;
  const membership = await getMembership();
  const deadline = Date.now() + URL_RESOLVE_BUDGET_MS;
  const probeFailures = [];
  const candidates = QQ_QUALITY_CANDIDATES.slice();
  let best = null;
  let vkeyBundle = null;
  try {
    vkeyBundle = await fetchVkey({ songmid, mediaMid: media, candidates, timeoutMs: Math.min(4000, remainingBudget(deadline) || 1000) });
  } catch (e) { probeFailures.push({ reason: `vkey:${e.message}` }); }
  if (vkeyBundle?.ok) {
    const urls = buildVkeyUrls({ filenames: vkeyBundle.filenames, midurlinfo: vkeyBundle.midurlinfo, sip: vkeyBundle.sip, candidates });
    const preferred = urls.filter((u) => u.candidate?.level === requestedQuality);
    const rest = urls.filter((u) => u.candidate?.level !== requestedQuality);
    for (const item of [...preferred, ...rest]) {
      if (remainingBudget(deadline) <= 0) break;
      if (!item.url) { probeFailures.push({ filename: item.filename, reason: item.reason || 'empty_url' }); continue; }
      const tryUrls = item.url.startsWith('http://') ? [item.url.replace('http://', 'https://'), item.url] : [item.url];
      let probe = null; let used = '';
      for (const u of tryUrls) {
        probe = await probeAudioUrl(u, { headers: { Referer: 'https://y.qq.com/', 'User-Agent': QQ_UA }, timeoutMs: Math.min(2000, remainingBudget(deadline) || 800) });
        used = u;
        if (probe.ok) break;
      }
      if (!probe?.ok) { probeFailures.push({ filename: item.filename, reason: probe?.reason || 'probe_fail' }); continue; }
      const cand = item.candidate || candidates[0];
      best = { url: used, level: cand?.level || requestedQuality, quality: cand?.quality || requestedQuality, br: cand?.br || null, trial: false };
      break;
    }
  }
  const payPlay = Number(songMeta?.pay?.pay_play ?? 0) || 0;
  const vipRequired = !best && payPlay >= 1;
  const playable = !!best?.url;
  const copyrightOk = !(vkeyBundle && (vkeyBundle.code === 24001 || vkeyBundle.code === 20013));
  const restriction = classifyRestriction({
    playable, url: best?.url || '', trial: false,
    loggedIn: membership.loggedIn, vipRequired,
    copyrightOk,
    needsLogin: !membership.loggedIn && !playable && (vipRequired || payPlay > 0 || !vkeyBundle?.ok),
    level: best?.level || requestedQuality,
  });
  const result = makePlayResult({
    provider: PROVIDER, url: best?.url || '', playable,
    trial: false, loggedIn: membership.loggedIn, vipRequired, restriction,
    level: best?.level || requestedQuality, quality: best?.quality || requestedQuality,
    br: best?.br || null, requestedQuality, probeFailures,
  });
  urlCache.set(cacheKey, result, result.playable ? URL_CACHE_TTL_MS : 60000);
  return result;
}

export async function getMembership({ force = false } = {}) {
  const auth = parseQqAuth(cookie());
  if (!auth.loggedIn) {
    const next = { loggedIn: false, ...normalizeQqMembership(null), nickname: null };
    membershipCache.set('qq:membership', next, MEMBERSHIP_CACHE_TTL_MS);
    return next;
  }
  if (!force) { const hit = membershipCache.get('qq:membership'); if (hit) return hit; }
  try {
    const data = await musicu({ req_0: { module: 'music.UserInfo.userInfoServer', method: 'GetLoginUserInfo', param: {} } }, { timeoutMs: 6000 });
    const info = data?.req_0?.data?.creator || data?.req_0?.data || {};
    const raw = normalizeQqMembership({
      viptype: info.viptype ?? 0, greenvip: info.greenvip ?? 0,
      yellowvip: info.yellowvip ?? 0, issvip: info.issvip ?? info.isSvip,
    });
    const merged = mergeMembership(membershipCache.get('qq:membership'), raw, { probeFailed: false });
    const next = { loggedIn: true, ...merged, nickname: info.nick || info.nickname || null };
    membershipCache.set('qq:membership', next, MEMBERSHIP_CACHE_TTL_MS);
    return next;
  } catch (e) {
    const prev = membershipCache.get('qq:membership');
    const merged = { loggedIn: true, ...mergeMembership(prev, null, { probeFailed: true }), nickname: prev?.nickname || null };
    membershipCache.set('qq:membership', merged, 30000);
    logProvider(`qq membership fail: ${e.message}`);
    return merged;
  }
}

export async function loginByCookie(raw) {
  const normalized = normalizeQQCookieInput(raw);
  if (!normalized) return { ok: false, error: '请提供 QQ 音乐 Cookie', code: 'INVALID_QQ_COOKIE' };
  const obj = parseCookieString(normalized);
  const auth = parseQqAuth(normalized);
  if (!auth.uin || !auth.authst) {
    return { ok: false, partial: !!auth.uin, code: auth.uin ? 'QQ_PLAYBACK_AUTH_INCOMPLETE' : 'INVALID_QQ_COOKIE', error: auth.uin ? '缺少播放授权，请完成官方登录' : 'QQ cookie 缺少 uin 或 qm_keyst' };
  }
  writeCookieFile(PROVIDER, normalized);
  membershipCache.clear(); urlCache.clear();
  return { ok: true, loggedIn: true, userId: auth.uin, playbackKeyReady: true, nickname: null, message: 'QQ 音乐 Cookie 已生效' };
}

export async function loginStatus() {
  const auth = parseQqAuth(cookie());
  const s = auth.loggedIn ? await getMembership({ force: true }) : null;
  return {
    provider: PROVIDER, loggedIn: auth.loggedIn, hasCookie: !!cookie(), userId: auth.uin || '',
    playbackKeyReady: auth.loggedIn, nickname: s?.nickname || null,
    isVip: !!s?.isVip, isSvip: !!s?.isSvip, membershipKnown: !!s?.membershipKnown, stale: !!s?.stale,
  };
}
export async function logout() { writeCookieFile(PROVIDER, ''); membershipCache.clear(); urlCache.clear(); return { ok: true, loggedIn: false }; }

/** 用户歌单（我喜欢的音乐 + 自建/收藏） */
export async function listPlaylists() {
  const auth = parseQqAuth(cookie());
  if (!auth.loggedIn) {
    return { provider: PROVIDER, loggedIn: false, playlists: [], message: '请先登录 QQ 音乐' };
  }
  const data = await musicu({
    req_0: {
      module: 'music.playlist.PlayListFolderServer',
      method: 'GetUserBasicPlaylist',
      param: {
        uin: Number(auth.uin) || 0,
        userid: Number(auth.uin) || 0,
        last_order: 0,
        dirid: 1,
        taglist: 1,
        albumid: 1,
        pic: 1,
        songnum: 1,
        title: 1,
        tag: 1,
      },
    },
  }, { timeoutMs: 8000 });
  const reqCode = data?.req_0?.code;
  if (reqCode && reqCode !== 0) {
    return {
      provider: PROVIDER,
      loggedIn: true,
      playlists: [],
      userId: auth.uin,
      apiCode: reqCode,
      message: reqCode === 500003
        ? 'QQ 歌单接口鉴权失败（Cookie 可能过期或缺少权限），请重新导入 Cookie'
        : `QQ 歌单接口错误 code=${reqCode}`,
    };
  }
  const body = data?.req_0?.data || {};
  const groups = body.v_playlist || body.mydiss || body.created || body.list || [];
  const flat = [];
  const pushItem = (p) => {
    if (!p) return;
    const id = p.tid || p.dissid || p.id || p.content_id;
    if (!id) return;
    const name = p.title || p.dissname || p.name || '未命名歌单';
    flat.push({
      id: String(id),
      name,
      cover: p.logo || p.pic || p.picurl || (p.dissid ? qqAlbumCover(p.dissid) : null),
      trackCount: Number(p.songnum || p.song_cnt || p.total || 0),
      isFavorite: p.dirid === 1 || /我喜欢|favorite/i.test(String(name)),
      provider: PROVIDER,
    });
  };
  if (Array.isArray(groups)) {
    groups.forEach((g) => {
      if (Array.isArray(g?.v_playlist)) g.v_playlist.forEach(pushItem);
      else if (Array.isArray(g?.disslist)) g.disslist.forEach(pushItem);
      else if (Array.isArray(g?.list)) g.list.forEach(pushItem);
      else pushItem(g);
    });
  }
  return { provider: PROVIDER, loggedIn: true, playlists: flat, userId: auth.uin };
}

export async function playlistTracks({ id, limit = 100 } = {}) {
  if (!id) return { provider: PROVIDER, songs: [], message: '缺少歌单 id' };
  const data = await musicu({
    req_0: {
      module: 'music.srfDissInfo.DissInfo',
      method: 'CgiGetDiss',
      param: {
        disstid: Number(id) || String(id),
        song_begin: 0,
        song_num: Math.min(200, Number(limit) || 100),
        userinfo: 1,
        tag: 1,
      },
    },
  }, { timeoutMs: 8000 });
  const body = data?.req_0?.data || {};
  const list = body.songlist || body.song_list || [];
  const songs = (Array.isArray(list) ? list : []).map((s) => {
    const file = s.file || {};
    return toTrackShape({
      id: s.songid || s.id || s.mid,
      songId: s.songid || s.id,
      mid: s.songmid || s.mid,
      songmid: s.songmid || s.mid,
      mediaMid: file.media_mid || s.songmid || s.mid,
      title: s.songname || s.name || s.title || '未知歌曲',
      artists: (s.singer || []).map((x) => x.name).filter(Boolean),
      artist: (s.singer || []).map((x) => x.name).filter(Boolean).join(' / '),
      album: s.albumname || s.album?.name || '',
      albumMid: s.albummid || s.album?.mid || '',
      cover: s.albummid ? qqAlbumCover(s.albummid) : null,
      durationMs: (Number(s.interval) || 0) * 1000,
      pay: s.pay || null,
      file,
    });
  });
  return { provider: PROVIDER, id, songs, count: songs.length };
}

export async function listLikes() {
  const pl = await listPlaylists();
  const fav = (pl.playlists || []).find((p) => p.isFavorite)
    || (pl.playlists || []).find((p) => /我喜欢/.test(p.name || ''));
  if (!fav) {
    return {
      provider: PROVIDER,
      loggedIn: pl.loggedIn,
      songs: [],
      playlists: pl.playlists || [],
      message: pl.loggedIn ? '未找到「我喜欢」歌单' : '请先登录 QQ 音乐',
    };
  }
  const tracks = await playlistTracks({ id: fav.id, limit: 100 });
  return { ...tracks, playlist: fav, loggedIn: true };
}

export const qqProvider = {
  name: PROVIDER, search, lyric, getSongUrl, getMembership, loginByCookie, loginStatus, logout,
  parseQqAuth, normalizeQQCookieInput, qqCookieUin, qqCookiePlaybackKey, qqSearchSign, buildVkeyUrls, fetchVkey,
  listPlaylists, playlistTracks, listLikes,
};
export default qqProvider;
