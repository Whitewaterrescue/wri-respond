/* WRI Respond — static config. All values here are public, non-secret.
 * Attached to `self` (not `window`) so sw.js can importScripts() this file —
 * in a page self === window, so nothing changes for the app modules. */
self.CONFIG = {
  // Dedicated GAS JSON API deployment (token-free, session-gated). See Api.gs.
  API_URL: 'https://script.google.com/macros/s/AKfycbx7p4-A8F6G_VedgHsw3RDJgwJK1GKVAFcvSah1JdjIdG5g7PAcvXhHRKHk_ULIhdL0KA/exec',

  // Public read-only view layers (create_public_views.py). No token needed.
  RECON_VIEW_URL:    'https://services6.arcgis.com/Ji79lWGR5B33LhY7/arcgis/rest/services/WRI_Recon_v3_public/FeatureServer/0',
  RESOURCE_VIEW_URL: 'https://services6.arcgis.com/Ji79lWGR5B33LhY7/arcgis/rest/services/WRI_Resource_Manager_public/FeatureServer/0',

  // Per-incident public COP web map (activate_gateway_map.py). When set, the
  // map shows the incident's operational layers; when '', it falls back to
  // satellite + recon/resource views. The API's ?api=incident value wins if set.
  GATEWAY_WEBMAP_ID: 'e6c53a5f666c459b81953d01331df165',

  // ICS 201 v2 generator (201 tab) — one route on the Ops Dashboard GAS project.
  // Deployment AKfycbytFBip… is the live one (@285, confirmed via clasp deployments
  // and corroborated by wri-safety-dashboard + the ExB app-1 widgets). NOTE: an
  // unknown ?page value silently serves the Ops Dashboard kanban board rather than
  // erroring, so a typo here looks like the wrong app, not a 404.
  ICS201_URL: 'https://script.google.com/macros/s/AKfycbytFBip-cbr-ohGpVGFoFBQ3spMLCswlbP26B4Syw0rrDs_x2hO4FqpdFzR6Mb3h9Ke/exec?page=v2-ics201',

  // Nova live stream (Live tab). Same workspace the Field App's Live Stream
  // page and the BNSF/WRI/MT-WY ICP viewers embed — hardcoded there too, so a
  // workspace change is a deliberate edit in each. Nova renders anonymously and
  // serves `frame-ancestors *`, so no token and no sign-in are involved.
  NOVA_LIVE_URL: 'https://app.mapnova.com/live?workspaceId=c9c97b46-4d56-4869-89ed-fba4ed6467de',
  LIVE_TEARDOWN_MS: 3000,   // hidden/left this long -> unload the stream

  // ArcGIS JS SDK (AMD build, lazy-loaded on first Map-tab open)
  ARCGIS_JS:  'https://js.arcgis.com/4.29/',
  ARCGIS_CSS: 'https://js.arcgis.com/4.29/esri/themes/dark/main.css',

  // Montana-ish default view when no gateway webmap is set
  DEFAULT_CENTER: [-113.994, 46.8721],
  DEFAULT_ZOOM: 7
};
