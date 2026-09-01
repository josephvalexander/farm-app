// ── V-PLANTATIONS SERVICE WORKER ─────────────────────────────────────────────
// CACHE_VERSION is auto-updated by GitHub Actions on every push to main.
// Do not edit this line manually — it will be overwritten on next deploy.
const CACHE_VERSION = 'vp-75edd9a';
const CACHE_NAME = `vplantations-${CACHE_VERSION}`;

// App shell files — all use network-first so updates deploy immediately
const APP_FILES = ['./', './index.html', './app.js', './style.css', './sw.js'];

// ── INSTALL ───────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(['./index.html']))
      .then(() => self.skipWaiting())
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
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: network-first for all app files, cache fallback for offline ────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  // Network-first for all app files — guarantees fresh code on every load
  const isAppFile = APP_FILES.some(f =>
    url.pathname.endsWith(f.replace('./', '/')) || url.pathname === '/'
  );

  if (isAppFile || url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for everything else (icons, fonts etc.)
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

// ── MESSAGE: allow page to trigger skipWaiting ────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});