const CACHE_NAME = 'bar-cache-v2';
const basePath = self.location.pathname.includes('/TuksBar/') ? '/TuksBar' : '';
const filesToCache = [
  basePath + '/',
  basePath + '/index.html',
  basePath + '/style.css',
  basePath + '/app.js',
  basePath + '/lib/dexie.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(filesToCache)));
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(response => response || fetch(e.request)));
});