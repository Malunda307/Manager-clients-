const CACHE_NAME = 'dinner-burger-v9';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
];

self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE_NAME; })
            .map(function(k){ return caches.delete(k); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  e.respondWith(
    fetch(e.request)
      .then(function(res){
        // Update cache with fresh copy when online
        var resClone = res.clone();
        caches.open(CACHE_NAME).then(function(cache){
          cache.put(e.request, resClone);
        });
        return res;
      })
      .catch(function(){
        // Offline: serve from cache, fallback to index.html for navigation
        return caches.match(e.request).then(function(cached){
          return cached || caches.match('./index.html');
        });
      })
  );
});