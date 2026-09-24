const CACHE = 'wx-shell-v11';
const SHELL = ['/manifest.json', '/icon-192.png', '/icon-512.png', '/icon.svg'];
function isApi(p) { return p.startsWith('/api') || p.startsWith('/socket.io'); }
function isNoCacheDoc(p) { return p === '/' || p === '/index.html' || p === '/sw.js'; }
function isVisualStagePath(p) { return p.startsWith('/visual/') || p.startsWith('/assets/skull'); }
function isMediaPath(p) {
  return /\.(?:mp3|m4a|aac|ogg|wav|flac|mp4|webm|mov|m4v|ogv)$/i.test(p) || p.startsWith('/media/');
}
function isHashedAsset(p) {
  if (isVisualStagePath(p)) return false;
  if (isMediaPath(p)) return false;
  return p.startsWith('/assets/') || /\.(?:js|css|woff2?|png|jpg|jpeg|webp|gif|svg)$/i.test(p);
}
/** Cache.put 不接受 206 Partial / Range 响应 */
function canStore(req, res) {
  if (!res || res.status !== 200) return false;
  if (res.type && res.type !== 'basic' && res.type !== 'default' && res.type !== 'cors') return false;
  if (req.headers && req.headers.has('range')) return false;
  if (req.destination === 'audio' || req.destination === 'video') return false;
  return true;
}
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url.pathname) || isNoCacheDoc(url.pathname)) return;
  if (isVisualStagePath(url.pathname) || isMediaPath(url.pathname)) {
    e.respondWith(fetch(req).catch(() => caches.match(req).then((h) => h || Response.error())));
    return;
  }
  if (isHashedAsset(url.pathname)) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        // 必须同步 clone，body 一旦被页面读取就不能再 clone；206 不可写入 Cache
        if (canStore(req, res)) {
          const copy = res.clone();
          c.put(req, copy).catch(() => {});
        }
        return res;
      }).catch(() => fetch(req))
    );
    return;
  }
  e.respondWith(fetch(req).then((res) => {
    // 必须同步 clone，否则 caches.open 之后 body 已被消费 → "Response body is already used"
    if (canStore(req, res)) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  }).catch(() => caches.match(req)));
});
