// 上游媒体代理的共享约束：域名白名单 + Cookie/Bearer 双通道鉴权。
//
// 背景：/api/audio、/api/cover 这类「同源媒体代理」必须能被 <audio src> / <img src>
// 直接引用，而这两个标签无法携带 Authorization 头，只能依赖登录时种下的
// HttpOnly Cookie。因此不能直接用 requireAuth（它只读 Authorization 头）。
//
// 同时这类接口历史上只校验 URL 前缀（/^https?:\/\//），等于免鉴权开放代理，
// 可被用来打内网与云元数据（SSRF）。这里按 hostname 白名单收敛。
import { verifyToken, extractBearerToken } from './auth.js';

/** 允许代理的上游域名（各音源官方 CDN）。按 hostname 精确/后缀匹配。 */
const EXACT_HOSTS = new Set([
  'music.163.com',
  'y.qq.com',
  'y.gtimg.cn',
  'kugou.com',
  'kgimg.com',
]);
const SUFFIX_HOSTS = [
  '.music.126.net',   // 网易云音频 CDN（m701.music.126.net 等）
  '.126.net',
  '.qq.com',
  '.qqmusic.qq.com',
  '.gtimg.cn',
  '.kugou.com',
  '.kgimg.com',
];

export function isAllowedMediaHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return false;
  return EXACT_HOSTS.has(h) || SUFFIX_HOSTS.some((s) => h.endsWith(s));
}

/**
 * 解析并校验上游 URL。
 * 拒绝非 http(s)、带凭据（user:pass@）以及不在白名单内的 host。
 * 返回 URL 对象；不合法时抛错（调用方转 400）。
 */
export function parseAllowedMediaUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || ''));
  } catch {
    throw new Error('invalid url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('invalid protocol');
  if (u.username || u.password) throw new Error('credentials not allowed');
  if (!isAllowedMediaHost(u.hostname)) throw new Error('host not allowed');
  return u;
}

/**
 * Cookie 或 Bearer 双通道鉴权（供 <audio>/<img> 直接引用）。
 * 注意：不接受 query 传 token——令牌会泄漏进访问日志、Referer 与浏览器历史。
 * 成功返回 user，失败返回 null（不写响应，由调用方决定状态码）。
 */
export function userFromCookieOrBearer(req) {
  const bearer = extractBearerToken(req);
  if (bearer) {
    const u = verifyToken(bearer);
    if (u) return u;
  }
  const cookie = req.headers.cookie || '';
  const m = /(?:^|;\s*)hudui_token=([^;]+)/.exec(cookie);
  if (m?.[1]) {
    const u = verifyToken(decodeURIComponent(m[1]));
    if (u) return u;
  }
  return null;
}

/**
 * 带逐跳校验的 fetch：默认 redirect:'follow' 会被上游 302 带到白名单之外的
 * 地址（SSRF 绕过）。这里手动处理重定向，每一跳都重新校验 host，最多 3 跳。
 */
export async function fetchAllowedMedia(rawUrl, { maxHops = 3, ...init } = {}) {
  let target = parseAllowedMediaUrl(rawUrl);
  for (let hop = 0; hop <= maxHops; hop += 1) {
    const res = await fetch(target, { ...init, redirect: 'manual' });
    const isRedirect = res.status >= 300 && res.status < 400 && res.headers.get('location');
    if (!isRedirect) return res;
    if (hop === maxHops) throw new Error('too many redirects');
    // 重新校验下一跳：不在白名单内直接拒绝，避免跳到内网
    target = parseAllowedMediaUrl(new URL(res.headers.get('location'), target).toString());
  }
  throw new Error('too many redirects');
}
