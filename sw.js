// Šiandien Service Worker
// Caches the app shell for offline use

const CACHE = 'siandien-v1';
const OFFLINE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// Install — cache everything
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => {
      return cache.addAll(OFFLINE_URLS);
    })
  );
  self.skipWaiting();
});

// Activate — clear old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — serve from cache first, network as fallback
self.addEventListener('fetch', e => {
  // Don't cache API calls or external resources
  if(
    e.request.url.includes('netlify/functions') ||
    e.request.url.includes('googleapis') ||
    e.request.url.includes('bigdatacloud') ||
    e.request.url.includes('meetingguide') ||
    e.request.url.includes('google.com/favicon')
  ) {
    return; // let these go to network directly
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if(cached) return cached;
      return fetch(e.request).then(response => {
        // Cache successful GET requests for app shell files
        if(
          e.request.method === 'GET' &&
          response.status === 200 &&
          (e.request.url.endsWith('.html') ||
           e.request.url.endsWith('.js') ||
           e.request.url.endsWith('.css') ||
           e.request.url.endsWith('.png') ||
           e.request.url.endsWith('.json'))
        ) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback — return cached index
        if(e.request.destination === 'document') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
