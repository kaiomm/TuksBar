const CACHE_NAME = 'bar-cache-v3';
const basePath = self.location.pathname.includes('/TuksBar/') ? '/TuksBar' : '';
const filesToCache = [
  basePath + '/',
  basePath + '/index.html',
  basePath + '/style.css',
  basePath + '/app.js',
  basePath + '/manifest.json',
  basePath + '/lib/dexie.js',
  // GIF processing libraries for offline crop support
  basePath + '/lib/gif.js',
  basePath + '/lib/gif.worker.js',
  basePath + '/lib/gifuct-js.js',
  basePath + '/lib/gif-transform.js',
  // Common assets used as fallbacks/placeholders
  basePath + '/asset/drink-512.png',
  basePath + '/asset/bottle-512.png',
  basePath + '/asset/camera-512.png',
  basePath + '/asset/tucano-256.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(filesToCache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => {
        if (k !== CACHE_NAME) return caches.delete(k);
      }))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(response => response || fetch(e.request)));
});