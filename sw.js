const CACHE_NAME = 'bar-cache-v2';
const filesToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/lib/dexie.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(filesToCache)));
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(response => response || fetch(e.request)));
});