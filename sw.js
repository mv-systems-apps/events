/* Service worker voor de events-editor.
   Strategie: stale-while-revalidate — meteen uit de cache serveren en
   op de achtergrond verversen. Verhoog CACHE_VERSION (of draai
   update_cache_version.py) om de oude cache op te ruimen. */

const CACHE_VERSION = 38;
const CACHE_NAME = 'events-editor-v' + CACHE_VERSION;

const ASSETS = [
  './',
  './index.html',
  './events-editor.html',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(c){
      /* Elk bestand apart cachen. Met addAll zou een enkel ontbrekend bestand
         de hele installatie afbreken, en dan is er geen service worker - en
         zonder service worker beschouwt de browser de site niet als app. */
      return Promise.all(ASSETS.map(function(u){
        return c.add(u).catch(function(){ /* ontbreekt: later alsnog ophalen */ });
      }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys()
      .then(function(keys){
        return Promise.all(keys.map(function(k){
          return k === CACHE_NAME ? null : caches.delete(k);
        }));
      })
      .then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  if(e.request.method !== 'GET') return;
  if(new URL(e.request.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.match(e.request).then(function(gecached){
        const netwerk = fetch(e.request).then(function(res){
          if(res && res.status === 200) cache.put(e.request, res.clone());
          return res;
        }).catch(function(){ return gecached; });
        return gecached || netwerk;
      });
    })
  );
});