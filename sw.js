// not2day Service Worker v4
//
// Strategy (this is what makes updates reach people automatically):
//   • HTML / navigations  → NETWORK-FIRST. Always fetch the freshest page;
//                           fall back to cache only when offline. This is the
//                           fix for "I pushed new code but still see the old
//                           version" — the old worker was cache-first for HTML.
//   • Static assets        → CACHE-FIRST (icons, manifest, fonts). They rarely
//     (icons/manifest/fonts) change and load instantly from cache.
//   • APIs / external      → NOT cached (always live).
//
// Auto-update: a new worker skips waiting and claims clients immediately, and
// the page reloads once when control passes to it (see the controllerchange
// listener in index.html). No manual cache-clearing, ever.

const VERSION    = 'not2day-v4';
const APP_SHELL  = '/index.html';

// Precached on install. Kept small and stable on purpose — the HTML is fetched
// fresh each load, so only rarely-changing assets live here.
const PRECACHE = [
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  APP_SHELL,   // also cached, but only used as an OFFLINE fallback (see fetch)
];

// -- Install: precache the stable shell, then activate immediately --
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())   // don't wait for old tabs to close
  );
});

// -- Activate: drop every old cache version, take control now --
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// -- Allow the page to tell a waiting worker to activate right away --
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Hosts whose responses must never be cached (always live).
function isNoCache(url) {
  return (
    url.includes('/.netlify/functions') ||
    url.includes('googleapis.com') ||
    url.includes('bigdatacloud.net') ||
    url.includes('meetingguide.org') ||
    url.includes('corsproxy.io') ||
    url.includes('allorigins.win') ||
    url.includes('thingproxy') ||
    url.includes('fonts.gstatic.com') ||   // font files: let the browser handle
    url.includes('/favicon')
  );
}

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = req.url;

  // Only GET is cacheable; everything else goes straight to network.
  if (req.method !== 'GET') return;

  // Never intercept live API / external calls.
  if (isNoCache(url)) return;

  // -- HTML / navigations -> NETWORK-FIRST --
  // A navigation request (opening/reloading the app) or any request that
  // accepts HTML. Try the network first so new deploys show up immediately;
  // fall back to the cached shell only when offline.
  const isNavigation =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then(res => {
          // Keep the shell copy fresh for offline use.
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(APP_SHELL, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(APP_SHELL).then(r => r || caches.match('/')))
    );
    return;
  }

  // -- Google Fonts stylesheet -> cache-first (stable, safe to cache) --
  if (url.includes('fonts.googleapis.com')) {
    event.respondWith(
      caches.open(VERSION).then(cache =>
        cache.match(req).then(hit =>
          hit || fetch(req).then(res => { cache.put(req, res.clone()); return res; })
        )
      )
    );
    return;
  }

  // -- Everything else (icons, manifest, same-origin assets) -> cache-first --
  event.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
