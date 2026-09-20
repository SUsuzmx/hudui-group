// PWA: 壳与 hashed 静态资源可缓存; HTML/SW/API/游戏中心 永远走网络, 避免发版白屏与游戏 0% 卡死。
const CACHE = 'wx-shell-v4';
const SHELL = ['/manifest.json', '/icon-192.png', '/icon-512.png', '/icon.svg'];

function isApi(pathname) {
  return pathname.startsWith('/api') || pathname.startsWith('/socket.io');
}

function isNoCacheDoc(pathname) {
  return pathname === '/' || pathname === '/index.html' || pathname === '/sw.js' || pathname === '/prototype' || pathname.startsWith('/prototype/');
}

function isGamesPath(pathname) {
  return pathname === '/games' || pathname.startsWith('/games/');
}

function isHashedAsset(pathname) {
  if (isGamesPath(pathname)) return false;
  return pathname.startsWith('/assets/') || /\.(?:js|css|woff2?|png|jpg|jpeg|webp|gif|svg)$/i.test(pathname);
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url.pathname)) return;
  // HTML / SW / prototype / games: network-only
  if (isNoCacheDoc(url.pathname) || isGamesPath(url.pathname)) return;

  // 媒体与头像: cache-first
  if (url.pathname.startsWith('/media') || url.pathname.startsWith('/avatars')) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }).catch(() => fetch(req))
    );
    return;
  }

  // hashed 静态资源: cache-first
  if (isHashedAsset(url.pathname)) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }).catch(() => fetch(req))
    );
    return;
  }

  // 其它 GET: network-first, 失败再回退缓存
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      if (list.length) return list[0].focus();
      return self.clients.openWindow('/');
    })
  );
});
