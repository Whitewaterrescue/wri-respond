/* WRI Respond — service worker.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ BUMP CACHE_VERSION IN EVERY COMMIT THAT CHANGES A PRECACHED     │
 * │ FILE. Runtime fetches are network-first, so a forgotten bump    │
 * │ only means OFFLINE users keep the previous build — online        │
 * │ behavior is always fresh. No skipWaiting(): a new version       │
 * │ activates when all tabs close ("updates apply on next open").  │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Caching rules (locked in the offline design):
 *  - Precache the whole shell; same-origin GETs are network-first (8s race)
 *    with cache fallback; navigations fall back to ./index.html.
 *  - The SW NEVER touches cross-origin requests — that structurally
 *    excludes the GAS API (script.google.com / googleusercontent), the
 *    ArcGIS CDN, and the public FeatureServer views, so no session-bearing
 *    response can ever land in Cache Storage.
 *  - Background Sync ('wri-outbox') drains the IndexedDB outbox with no
 *    page open (Android; iOS drains at app start instead).
 */
var CACHE_VERSION = '2026-08-14-1';
var CACHE_NAME = 'wri-respond-' + CACHE_VERSION;

importScripts('js/config.js', 'js/outbox.js');

var PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/config.js',
  './js/api.js',
  './js/session.js',
  './js/outbox.js',
  './js/screens.js',
  './js/map.js',
  './js/recon.js',
  './js/resources.js',
  './js/sitstat.js',
  './js/app.js',
  './assets/wri-logo.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (c) { return c.addAll(PRECACHE); })
  );
  // Deliberately NO self.skipWaiting() — see the banner comment.
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names
        .filter(function (n) { return n !== CACHE_NAME; })
        .map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function networkFirst(request) {
  var timeout = new Promise(function (resolve, reject) {
    setTimeout(function () { reject(new Error('sw-timeout')); }, 8000);
  });
  return Promise.race([fetch(request), timeout])
    .then(function (resp) {
      if (resp && resp.ok) {
        var clone = resp.clone();
        caches.open(CACHE_NAME).then(function (c) { c.put(request, clone); }).catch(function () {});
      }
      return resp;
    })
    .catch(function () {
      return caches.match(request).then(function (hit) {
        if (hit) return hit;
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // GAS API / ArcGIS / views: untouched
  event.respondWith(networkFirst(request));
});

// Background Sync (Android): drain the outbox even with no page open.
// Outbox.drain throws when the pass stalls with records remaining, which
// rejects the sync event and triggers the browser's native retry backoff.
self.addEventListener('sync', function (event) {
  if (event.tag === 'wri-outbox') {
    event.waitUntil(Outbox.drain({ source: 'sync' }));
  }
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'drain') {
    Outbox.drain({ source: 'message' });
  }
});
