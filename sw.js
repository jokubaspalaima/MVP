// not2day Service Worker v3
// Forces fresh cache on every deploy

const VERSION  = 'not2day-v3';
const SHELL    = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

// Install — cache app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activate — delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - Netlify functions & external APIs → network only (never cache)
// - App shell → cache first, network fallback
// - Everything else → network first, cache fallback
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Never cache: API calls, external resources
  if (
    url.includes('.netlify/functions') ||
    url.includes('googleapis.com') ||
    url.includes('bigdatacloud.net') ||
    url.includes('meetingguide.org') ||
    url.includes('corsproxy.io') ||
    url.includes('allorigins.win') ||
    url.includes('fonts.gstatic.com') ||
    url.includes('google.com/favicon')
  ) {
    return; // let browser handle normally
  }

  // Google Fonts CSS — cache aggressively
  if (url.includes('fonts.googleapis.com')) {
    e.respondWith(
      caches.open(VERSION).then(c =>
        c.match(e.request).then(cached =>
          cached || fetch(e.request).then(r => { c.put(e.request, r.clone()); return r; })
        )
      )
    );
    return;
  }

  // App shell — cache first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(r => {
        if (r.ok && e.request.method === 'GET') {
          caches.open(VERSION).then(c => c.put(e.request, r.clone()));
        }
        return r;
      }).catch(() => {
        // Offline fallback
        if (e.request.destination === 'document') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
