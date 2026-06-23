const CACHE = 'portfolio-v8';

// Precache the app shell + hashed JS/CSS on install, reading the asset URLs out
// of index.html. This guarantees offline works even on the first load after a
// new SW activates (when the page's own requests bypassed the SW).
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      const res = await fetch('/', { cache: 'no-cache' });
      if (res.ok && !res.redirected) {
        await cache.put('/', res.clone());
        const html = await res.text();
        const urls = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)]
          .map(m => m[1]).filter(u => u.startsWith('/'));
        // Chart.js is lazy-loaded (not in the HTML), so precache it explicitly for offline.
        urls.push('/chart.umd.js?v=4.4.1');
        await Promise.all(urls.map(u => cache.add(u).catch(() => {})));
      }
    } catch (err) { /* offline at install — runtime caching will fill in */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;

  // Navigations (HTML): network-first so a new deploy applies immediately;
  // fall back to the cached shell when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(res => {
        caches.open(CACHE).then(c => c.put('/', res.clone()));
        return res;
      }).catch(() =>
        caches.match(e.request, { ignoreSearch: true })
          .then(r => r || caches.match('/'))
      )
    );
    return;
  }

  // Static assets (content-hashed): cache-first for instant offline loads.
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
    )
  );
});
