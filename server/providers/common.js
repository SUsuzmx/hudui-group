// 音源 provider 公共层
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
export const URL_CACHE_TTL_MS = 4 * 60 * 1000;
export const MEMBERSHIP_CACHE_TTL_MS = 2 * 60 * 1000;
export const URL_RESOLVE_BUDGET_MS = 5000;
export const NETEASE_QUALITY_LADDER = ['lossless', 'exhigh', 'higher', 'standard'];
export const NETEASE_BR_BY_LEVEL = { lossless: 999000, exhigh: 320000, higher: 192000, standard: 128000 };
export const QQ_QUALITY_CANDIDATES = [
  { prefix: 'F000', ext: 'flac', level: 'lossless', quality: 'flac', br: 999000 },
  { prefix: 'M800', ext: 'mp3', level: 'exhigh', quality: '320k', br: 320000 },
  { prefix: 'M500', ext: 'mp3', level: 'higher', quality: '192k', br: 192000 },
  { prefix: 'O600', ext: 'm4a', level: 'standard', quality: '128k', br: 128000 },
];

export class MemoryCache {
  constructor() { this.map = new Map(); }
  get(k) { const h = this.map.get(k); if (!h) return undefined; if (h.expiresAt < Date.now()) { this.map.delete(k); return undefined; } return h.value; }
  set(k, v, ttl) { this.map.set(k, { value: v, expiresAt: Date.now() + ttl }); return v; }
  delete(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
export const urlCache = new MemoryCache();
export const membershipCache = new MemoryCache();
export const md5 = (s) => crypto.createHash('md5').update(String(s)).digest('hex');

export function qqSearchSign(bodyText) {
  const text = String(bodyText || '');
  const hash = crypto.createHash('sha1').update(text).digest('hex');
  const part1 = [23, 14, 6, 36, 16, 40, 7, 19].map((i) => hash[i]).join('');
  const part2 = [16, 1, 32, 12, 19, 27, 8, 5].map((i) => hash[i]).join('');
  const scramble = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];
  const bytes = scramble.map((v, i) => v ^ parseInt(hash.slice(i * 2, i * 2 + 2), 16));
  const middle = Buffer.from(bytes).toString('base64').replace(/[\\/+=]/g, '');
  return `zzc${part1}${middle}${part2}`.toLowerCase();
}

export function makePlayResult(p = {}) {
  return {
    provider: p.provider || null,
    url: p.url || '',
    playable: Boolean(p.playable && p.url),
    trial: Boolean(p.trial),
    loggedIn: Boolean(p.loggedIn),
    vipRequired: Boolean(p.vipRequired),
    restriction: p.restriction || null,
    level: p.level ?? null,
    quality: p.quality ?? null,
    br: p.br ?? null,
    requestedQuality: p.requestedQuality ?? null,
    probeFailures: Array.isArray(p.probeFailures) ? p.probeFailures : [],
  };
}

export function classifyRestriction({
  playable = false, url = '', trial = false, loggedIn = false,
  vipRequired = false, paidRequired = false, copyrightOk = true,
  needsLogin = false, level = null, category = null,
} = {}) {
  if (playable && url) return null;
  if (category === 'verification_required') {
    return { category: 'verification_required', message: '酷狗需要官方安全验证，请打开酷狗官方登录窗口完成验证', action: 'login' };
  }
  if (!copyrightOk) return { category: 'copyright_unavailable', message: '该歌曲暂无版权，无法播放', action: 'switch_source' };
  if (needsLogin || (!loggedIn && (vipRequired || trial))) {
    return { category: 'login_required', message: '需要登录音乐平台后才能播放', action: 'login' };
  }
  if (paidRequired) return { category: 'paid_required', message: '该歌曲需要单独购买后才能完整播放', action: 'purchase' };
  if (vipRequired && !trial) return { category: 'vip_required', message: '该歌曲需要平台会员才能播放', action: 'upgrade' };
  if (trial && !playable) return { category: 'trial_only', message: '仅试听片段，完整播放需要会员', action: 'upgrade' };
  return { category: 'url_unavailable', message: '暂时没有可用的播放地址，可稍后重试或换源', action: 'switch_source' };
}

export function normalizeNeteaseMembership(profile = null) {
  if (!profile) return { isVip: false, isSvip: false, membershipKnown: false, vipType: 0, stale: false };
  const vipType = Number(profile.vipType ?? 0) || 0;
  const isSvip = profile.svip === true || vipType === 100 || vipType === 200;
  const isVip = isSvip || vipType >= 11;
  return { isVip: !!isVip, isSvip: !!isSvip, membershipKnown: true, vipType, stale: false, vipLevel: isSvip ? 'svip' : isVip ? 'vip' : 'none', vipLabel: isSvip ? 'SVIP' : isVip ? 'VIP' : '无VIP' };
}

export function normalizeQqMembership(raw = null) {
  if (!raw) return { isVip: false, isSvip: false, membershipKnown: false, stale: false };
  const present = ['viptype', 'greenvip', 'issvip'].some((k) => raw[k] !== undefined && raw[k] !== null);
  const n = (k) => Number(raw[k] ?? 0) || 0;
  const isSvip = raw.issvip === 1 || raw.issvip === true || raw.svip === true || n('svip') > 0;
  const isVip = isSvip || n('viptype') > 0 || n('greenvip') > 0 || n('yellowvip') > 0;
  return { isVip: !!isVip, isSvip: !!isSvip, membershipKnown: present, stale: false };
}

export function mergeMembership(prev, next, { probeFailed = false } = {}) {
  if (!probeFailed) {
    if (next?.membershipKnown) return { ...next, stale: false };
    return { isVip: false, isSvip: false, membershipKnown: false, stale: false };
  }
  if (prev && prev.membershipKnown && (prev.isVip || prev.isSvip)) return { ...prev, stale: true };
  return { isVip: !!next?.isVip, isSvip: !!next?.isSvip, membershipKnown: !!(next?.membershipKnown || prev?.membershipKnown), stale: true };
}

export function matchAudioMagic(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'ID3';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'MPEG';
  const s = buf.toString('latin1', 0, 8);
  if (s.startsWith('fLaC')) return 'fLaC';
  if (s.startsWith('OggS')) return 'OggS';
  if (s.startsWith('RIFF')) return 'RIFF';
  if (buf.length >= 8 && buf.toString('latin1', 4, 8) === 'ftyp') return 'ftyp';
  return null;
}

export async function probeAudioUrl(url, { headers = {}, fetchImpl = globalThis.fetch, timeoutMs = 2500 } = {}) {
  if (!url) return { ok: false, reason: 'empty_url' };
  try {
    const res = await fetchImpl(url, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-8191', ...headers }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok && res.status !== 206) return { ok: false, reason: `http_${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, 8192);
    const magic = matchAudioMagic(buf);
    if (!magic) return { ok: false, reason: 'bad_magic' };
    return { ok: true, magic };
  } catch (e) { return { ok: false, reason: e.message || 'probe_error' }; }
}

export function remainingBudget(deadline) { return Math.max(0, deadline - Date.now()); }
export async function withTimeout(promise, ms, label = 'timeout') {
  if (ms <= 0) throw new Error(label);
  let timer;
  try { return await Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(label)), ms); })]); }
  finally { clearTimeout(timer); }
}

export function cookieFilePath(provider) {
  if (provider === 'qq') return path.join(ROOT, '.qq-cookie');
  if (provider === 'kugou') return path.join(ROOT, '.kugou-cookie');
  return path.join(ROOT, '.netease-cookie');
}
export function readCookieFile(provider) {
  try { const p = cookieFilePath(provider); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : ''; } catch { return ''; }
}
export function writeCookieFile(provider, cookie) {
  const p = cookieFilePath(provider);
  const v = String(cookie || '').trim();
  if (!v) { try { fs.unlinkSync(p); } catch {} return ''; }
  fs.writeFileSync(p, v, 'utf8');
  return v;
}
export function parseCookieString(text) {
  const out = {};
  for (const part of String(text || '').split(/[\n;]+/)) {
    const raw = part.trim();
    const i = raw.indexOf('=');
    if (i <= 0) continue;
    out[raw.slice(0, i).trim()] = raw.slice(i + 1).trim();
  }
  return out;
}
export function parseCookiePairs(s) { return parseCookieString(s); }
const ATTRS = new Set(['path','domain','expires','max-age','samesite','secure','httponly']);
export function normalizeCookieHeader(input) {
  const map = new Map();
  function put(k, v) {
    k = String(k || '').trim();
    if (!k || ATTRS.has(k.toLowerCase())) return;
    if (v == null) return;
    const s = String(v).trim();
    if (s) map.set(k, s);
  }
  function walk(x) {
    if (x == null) return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (typeof x === 'object') {
      if (x.name && 'value' in x) { put(x.name, x.value); return; }
      Object.keys(x).forEach((k) => walk(x[k]));
      return;
    }
    for (const line of String(x).split(/\r?\n/)) {
      for (const part of line.split(';')) {
        const i = part.indexOf('=');
        if (i > 0) put(part.slice(0, i), part.slice(i + 1));
      }
    }
  }
  walk(input);
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
export function serializeCookieObject(obj) {
  return Object.keys(obj || {}).filter((k) => obj[k] != null && String(obj[k]) !== '').map((k) => `${k}=${obj[k]}`).join('; ');
}
export function joinCookiePairs(map) {
  return Object.entries(map || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${v}`).join('; ');
}
export function normalizeTitle(s) { return String(s || '').toLowerCase().replace(/[\s\[\]()（）]/g, ''); }
export function normalizeArtistSet(artists) {
  return new Set((Array.isArray(artists) ? artists : String(artists || '').split(/[\/,]/)).map((a) => normalizeTitle(typeof a === 'object' ? a.name : a)).filter(Boolean));
}
export function isSameRecording(target, cand) {
  if (!cand) return false;
  if (normalizeTitle(target?.title) !== normalizeTitle(cand.title)) return false;
  const ta = normalizeArtistSet(target?.artists);
  const ca = normalizeArtistSet(cand.artists);
  if (!ta.size || !ca.size) return false;
  let hit = false;
  for (const a of ca) if (ta.has(a)) { hit = true; break; }
  if (!hit) return false;
  const dt = Number(cand.durationMs || cand.duration || 0);
  const tt = Number(target?.durationMs || 0);
  return !tt || !dt || Math.abs(dt - tt) <= 3000;
}
export function logProvider(msg) {
  try { fs.appendFileSync(path.join(ROOT, 'data', 'app.log'), `[music] ${msg}\n`); } catch {}
}
export function legacyQqSearchSignMd5(body, nonce) { return { sign: md5((nonce || 'zza') + body), nonce: nonce || 'zza' }; }
