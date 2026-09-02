// ── V-PLANTATIONS SERVICE WORKER ─────────────────────────────────────────────
// CACHE_VERSION is injected by GitHub Actions on every push to main.
// Each new version busts the old cache and triggers a silent background update.
const CACHE_VERSION = 'vp-e2c917f';
const CACHE_NAME = `vp-${CACHE_VERSION}`;

// All app shell files — network-first so code updates deploy immediately
const APP_SHELL = [
  './',
  './index.html',
  './core.js',
  './drive.js',
  './insights.js',
  './render.js',
  './modals.js',
  './style.css',
];

// ── INSTALL: cache app shell ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()) // activate immediately on all tabs
  );
});

// ── ACTIVATE: delete old caches, take control of all tabs ────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating', CACHE_NAME);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('vp-') && k !== CACHE_NAME)
          .map(k => { console.log('[SW] Deleting old cache:', k); return caches.delete(k); })
      ))
      .then(() => self.clients.claim()) // take control of all open tabs immediately
      .then(() => {
        // Notify all tabs that a new version is active
        self.clients.matchAll({type:'window'}).then(clients => {
          clients.forEach(client => client.postMessage({type:'SW_UPDATED',version:CACHE_VERSION}));
        });
      })
  );
});

// ── FETCH: network-first for app shell, cache fallback for offline ─────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return; // don't intercept external requests

  // Check if this is an app shell file
  const isShell = url.pathname.endsWith('.js') ||
                  url.pathname.endsWith('.css') ||
                  url.pathname.endsWith('.html') ||
                  url.pathname === '/' ||
                  url.pathname.endsWith('/');

  if (isShell) {
    // Network-first: always try to get fresh code, fall back to cache when offline
    event.respondWith(
      fetch(event.request, {cache: 'no-cache'})
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request)) // offline fallback
    );
    return;
  }

  // Cache-first for everything else (icons etc.)
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

// ── MESSAGE: skip waiting (called by page when new SW installs) ──────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── PERIODIC SYNC: check for updates in background ───────────────────────────
// Browsers will call self.skipWaiting() on install, so new SW activates
// as soon as all tabs are refreshed or the page reloads for any reason.