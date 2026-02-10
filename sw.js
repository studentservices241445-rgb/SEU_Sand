/* =========================================
   Service Worker - Offline cache for GitHub Pages PWA
   Strategy: Cache-first for same-origin assets/pages,
   Network fallback + offline page for navigations.
   ========================================= */

const CACHE_NAME = 'seu-ss-cache-v1';
const PRECACHE = [
  './',
  './index.html',
  './services.html',
  './order.html',
  './dashboard.html',
  './guides.html',
  './step.html',
  './support.html',
  './about.html',
  './faq.html',
  './privacy.html',
  './terms.html',
  './offline.html',
  './manifest.webmanifest',
  './assets/css/style.css',
  './assets/js/app.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './catalog.html',
  './course.html',
  './assets/data/catalog.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k)))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // For navigations, provide offline fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match('./offline.html'))
    );
    return;
  }

  // Cache-first for assets + pages
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => caches.match('./offline.html'));
    })
  );
});
