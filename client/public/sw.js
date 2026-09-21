// Bump this on any change to force browsers to install the new SW and drop the
// old caches. The previous SW used cache-FIRST for navigations, so it served a
// stale index.html forever — and since index.html references hashed asset files
// (index-<hash>.js) that change every deploy, the cached HTML pointed at JS that
// no longer existed → blank white page. Network-first fixes that permanently.
const CACHE = 'mj-tracker-v3';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  // Nuke every old cache so no stale index.html / assets can linger.
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // API / uploads: never intercept — always hit the network for fresh data.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return;
  }

  // Navigations (the HTML document): network-FIRST so a redeploy is picked up
  // immediately; fall back to a cached copy only when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put('/index.html', clone));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets (hashed, immutable): cache-first is safe — a new build has a
  // new filename, so there's never a stale-content problem.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(request, clone));
        }
        return res;
      });
    })
  );
});
