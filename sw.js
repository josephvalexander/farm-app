// ── V-PLANTATIONS SERVICE WORKER ─────────────────────────────────────────────
// Increment CACHE_VERSION every deployment to force update on all devices.
// If using GitHub Actions, replace this with a build step that injects the git SHA.
const CACHE_VERSION = 'vp-v6';
const CACHE_NAME = `vplantations-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  './',
  './index.html',
];

// ── INSTALL: cache app shell ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()) // activate immediately on first install
  );
});

// ── ACTIVATE: delete old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('vplantations-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim()) // take control of all open tabs
  );
});

// ── FETCH: network-first for index.html, cache-first for everything else ──────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  // Network-first for the main HTML page — ensures fresh content on load
  if (url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache the fresh response
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request)) // offline fallback
    );
    return;
  }

  // Cache-first for sw.js itself and other assets
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});

// ── MESSAGE: allow page to trigger skipWaiting for instant update ─────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
