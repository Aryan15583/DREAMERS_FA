// Dreamers FA service worker: makes the site installable as an app and lets
// pages open offline from the last copy. Data (/api) is never cached.
const CACHE = 'dreamers-v1';
const SHELL = ['/', '/register', '/admin', '/css/style.css', '/js/common.js', '/js/site.js', '/js/register.js', '/js/admin.js',
  '/img/logo.webp', '/img/logo-sm.webp', '/img/favicon.png', '/img/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api')) return;
  // Network first, so the app always shows the latest version; fall back to the saved copy when offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('/')))
  );
});
