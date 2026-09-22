/* WRI Respond — service worker.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ BUMP CACHE_VERSION IN EVERY COMMIT THAT CHANGES A PRECACHED     │
 * │ FILE — and bump the matching ?v= stamps in index.html (script/  │
 * │ css tags) AND in PRECACHE below to the same string. The stamps  │
 * │ pin each HTML build to its exact JS/CSS set; without them,      │
 * │ Pages' max-age=600 HTTP cache can serve old JS with new HTML    │
 * │ for ~10 min after a deploy (fatal skew, seen live 2026-08-24).  │
 * │ Runtime fetches are network-first, so a forgotten bump only     │
 * │ means OFFLINE users keep the previous build — online behavior   │
 * │ is always fresh. No skipWaiting(): a new version activates      │
 * │ when all tabs close ("updates apply on next open").            │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Caching rules (locked in the offline design):
 *  - Precache the whole shell; same-origin GETs are network-first (8s race)
 *    with cache fallback; navigations fall back to ./index.html.
 *  - Cross-origin requests are untouched — that structurally excludes the
 *    GAS API (script.google.com / googleusercontent), the ArcGIS portal, and
 *    the public FeatureServer views, so no session-bearing response can ever
 *    land in Cache Storage. SINGLE CARVE-OUT: the versioned, immutable
 *    ArcGIS JS SDK files (CONFIG.ARCGIS_JS, a public static CDN — no
 *    cookies, no auth, ACAO:*) are cache-first in their own bucket, so
 *    repeat visits don't re-download the multi-MB SDK. The invariant holds:
 *    sessions only ever ride the GAS origin, which stays bypassed.
 *  - Background Sync ('wri-outbox') drains the IndexedDB outbox with no
 *    page open (Android; iOS drains at app start instead).
 */
var CACHE_VERSION = '2026-09-22-2';
var CACHE_NAME = 'wri-respond-' + CACHE_VERSION;

importScripts('js/config.js', 'js/outbox.js');

// ArcGIS SDK cache: keyed to the SDK version (e.g. 'wri-arcgis-4.29'), NOT to
// CACHE_VERSION — it survives shell bumps and is dropped only when the SDK
// version in config.js changes.
var ARCGIS_PREFIX = CONFIG.ARCGIS_JS; // 'https://js.arcgis.com/4.29/'
var ARCGIS_CACHE = 'wri-arcgis-' + ARCGIS_PREFIX.split('/').filter(Boolean).pop();

var PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  // ?v= must match the stamps in index.html — that's the URL the page asks for.
  './css/app.css?v=2026-09-22-2',
  './js/config.js?v=2026-09-22-2',
  './js/obstypes.js?v=2026-09-22-2',
  './js/api.js?v=2026-09-22-2',
  './js/session.js?v=2026-09-22-2',
  './js/outbox.js?v=2026-09-22-2',
  './js/screens.js?v=2026-09-22-2',
  './js/arcgis-auth.js?v=2026-09-22-2',
  './js/map.js?v=2026-09-22-2',
  './js/recon.js?v=2026-09-22-2',
  './js/resources.js?v=2026-09-22-2',
  './js/requests.js?v=2026-09-22-2',
  './js/sitstat.js?v=2026-09-22-2',
  './js/livestream.js?v=2026-09-22-2',
  './js/app.js?v=2026-09-22-2',
  './assets/wri-logo.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  // Observation-type icons for the Add to COP picker (assets/obs/)
  './assets/obs/aid_station.png',
  './assets/obs/boat_ramp.png',
  './assets/obs/current_boom_site.png',
  './assets/obs/decon.png',
  './assets/obs/drone_flight.png',
  './assets/obs/fish_kill.png',
  './assets/obs/hospital.png',
  './assets/obs/incident_command_post.png',
  './assets/obs/injured_wildlife.png',
  './assets/obs/injury.png',
  './assets/obs/landing_zone.png',
  './assets/obs/near_miss.png',
  './assets/obs/oil_spotted.png',
  './assets/obs/other_action.png',
  './assets/obs/other_observation.png',
  './assets/obs/other_safety.png',
  './assets/obs/planned_boom_site.png',
  './assets/obs/planned_staging_area.png',
  './assets/obs/recovery_complete.png',
  './assets/obs/response_action.png',
  './assets/obs/river_hazard.png',
  './assets/obs/road_closure.png',
  './assets/obs/safety_briefing.png',
  './assets/obs/scat_point.png',
  './assets/obs/staging_area.png',
  './assets/obs/tactical_operational_team.png'
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
        .filter(function (n) {
          // Old SDK buckets die on SDK upgrade; the current one survives
          // shell CACHE_VERSION bumps.
          if (n.indexOf('wri-arcgis-') === 0) return n !== ARCGIS_CACHE;
          return n !== CACHE_NAME;
        })
        .map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Cache-first, cache-on-use for the immutable versioned SDK files. The SDK
// arrives via injected <script> tags (no-cors requests); we re-issue the
// fetch as CORS (js.arcgis.com serves ACAO:*) so the stored response is
// inspectable (resp.ok) and quota-cheap — an opaque response is quota-padded
// to ~7MB, and a few hundred of those would evict this origin's caches,
// including the offline shell.
function arcgisCacheFirst(request) {
  return caches.open(ARCGIS_CACHE).then(function (c) {
    return c.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(new Request(request.url, { mode: 'cors' })).then(function (resp) {
        if (resp && resp.ok) {
          var clone = resp.clone();
          c.put(request, clone).catch(function () {});
        }
        return resp;
      });
    });
  });
}

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
  if (request.url.indexOf(ARCGIS_PREFIX) === 0) {
    event.respondWith(arcgisCacheFirst(request)); // versioned SDK files only
    return;
  }
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // GAS API / portal / views / tiles: untouched
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
