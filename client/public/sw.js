const CACHE = 'wx-shell-v14';
const SHELL = ['/manifest.json', '/icon-192.png', '/icon-512.png', '/icon.svg', '/offline.html'];
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
    // 网络优先，离线回退缓存（舞台/媒体体积大，不挡首屏）
    e.respondWith(fetch(req).catch(() => caches.match(req).then((h) => h || Response.error())));
    return;
  }
  if (isHashedAsset(url.pathname)) {
    // 内容 hash 资源：缓存优先，命中后后台刷新
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) {
          fetch(req).then((res) => {
            if (canStore(req, res)) {
              const copy = res.clone();
              c.put(req, copy).catch(() => {});
            }
          }).catch(() => {});
          return hit;
        }
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
  }).catch(() => caches.match(req).then((h) => h || offlineFallback(req))));
});

function offlineFallback(req) {
  const dest = req.destination || '';
  if (dest === 'document' || (req.headers && req.headers.get('accept') || '').includes('text/html')) {
    return caches.match('/offline.html').then((h) => h || new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>离线</title><body style="font-family:sans-serif;padding:32px;background:#ededed;color:#191919"><h2>当前处于离线</h2><p>聊天、在线音乐等需要网络。已缓存的页面资源仍可浏览。</p><p><a href="/">重试</a></p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    ));
  }
  return Response.error();
}

// ── Web Push：页面关闭后由系统唤起通知 ──
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    try { data = { body: event.data ? event.data.text() : '' }; } catch { data = {}; }
  }
  const title = data.title || '微信';
  const body = data.body || '你收到一条新消息';
  const tag = data.tag || 'hudui-push';
  const url = data.url || '/';
  event.waitUntil((async () => {
    try {
      await self.registration.showNotification(title, {
        body,
        tag,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url, conversationId: data.conversationId || null, kind: data.kind || 'message' },
        requireInteraction: false,
      });
    } catch { /* ignore */ }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification?.data?.url || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      try {
        if ('focus' in c) {
          await c.focus();
          if (c.navigate) await c.navigate(target);
          return;
        }
      } catch { /* ignore */ }
    }
    try {
      await self.clients.openWindow(target);
    } catch { /* ignore */ }
  })());
});

// 同步型本地通知（页面在后台时由页面调用，比 new Notification 更稳）
self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d && d.type === 'show-notification') {
    event.waitUntil((async () => {
      try {
        await self.registration.showNotification(d.title || '微信', {
          body: d.body || '',
          tag: d.tag || 'hudui-msg',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          data: { url: d.url || '/', conversationId: d.conversationId || null },
        });
      } catch { /* ignore */ }
    })());
  }
});

