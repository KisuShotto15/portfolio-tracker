// Sello de build (lo inyecta vite.config.js): sin bytes nuevos en sw.js los
// navegadores nunca detectan version nueva (ni updatefound, ni toast).
const BUILD = '__BUILD__';
const CACHE = 'portfolio-v10-' + BUILD;

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
        // Self-hosted fonts (referenced from CSS, not the HTML): precache so the
        // first cold open renders text without a network round-trip.
        urls.push(
          '/fonts/instrumentsans-latin.woff2',
          '/fonts/instrumentsans-latin-ext.woff2',
          '/fonts/splinesansmono-latin.woff2',
          '/fonts/splinesansmono-latin-ext.woff2'
        );
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
  // /api/* nunca se cachea: son datos financieros vivos (sync, precios) y el
  // Cache API indexa por URL, no por Authorization — serviria el doc de otra
  // cuenta en un navegador compartido y congelaria el pull hasta el proximo deploy.
  if (new URL(e.request.url).pathname.startsWith('/api/')) return;

  // Navigations (HTML): network-first so a new deploy applies immediately;
  // fall back to the cached shell when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' }).then(res => {
        // Solo cacheamos un 200 directo. Servirle despues a una navegacion una
        // respuesta redirigida es un network error ("a redirected response was
        // used for a request whose redirect mode is not 'follow'") = pantalla en
        // blanco hasta hard refresh; y un 404/500 cacheado congela ese estado.
        // vercel.json tiene redirects activos, asi que esto pasa de verdad.
        if (res.ok && !res.redirected) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put('/', clone));
        }
        return res;
      }).catch(() =>
        // Offline: el shell cacheado, pero nunca uno redirigido (mismo motivo).
        caches.match('/').then(r => (r && !r.redirected) ? r : Response.error())
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
