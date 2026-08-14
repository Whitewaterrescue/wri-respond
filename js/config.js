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

  // ArcGIS JS SDK (AMD build, lazy-loaded on first Map-tab open)
  ARCGIS_JS:  'https://js.arcgis.com/4.29/',
  ARCGIS_CSS: 'https://js.arcgis.com/4.29/esri/themes/dark/main.css',

  // Montana-ish default view when no gateway webmap is set
  DEFAULT_CENTER: [-113.994, 46.8721],
  DEFAULT_ZOOM: 7,

  // ICS positions for the sign-in dropdown — BAKED FALLBACK ONLY (used when
  // both the live ?api=staffrefs fetch and its localStorage snapshot are
  // unavailable, i.e. a first-ever offline open). The live list is the ICS
  // Positions tab of the shared check-in workbook — same list as the
  // check-in/out app. Keep this copy in sync when that tab changes.
  ROLES: [
    'Field Technician',
    'Incident Commander (IC)', 'Deputy Incident Commander', 'Safety Officer (SOFR)',
    'Asst Safety Officer 1 (ASOFR)', 'Asst Safety Officer 2 (ASOFR)', 'Asst Safety Officer 3 (ASOFR)',
    'Public Information Officer (PIO)', 'Liaison Officer (LOFR)', 'Intelligence Officer (INTEL)',
    'Operations Section Chief (OSC)', 'Deputy Operations Section Chief (DOSC)',
    'Staging Area Manager (STAM)', 'Operations Branch 1 (OB1)', 'Operations Branch 2 (OB2)',
    'Operations Branch 3 (OB3)', 'Division Supervisor A (DIVS-A)', 'Division Supervisor B (DIVS-B)',
    'Air Operations Branch (AOBD)',
    'Planning Section Chief (PSC)', 'Deputy Planning Section Chief (DPSC)',
    'Situation Unit Leader (SITL)', 'Resource Unit Leader (RESL)',
    'Documentation Unit Leader (DOCL)', 'Environmental Unit Leader (ENVL)',
    'Logistics Section Chief (LSC)', 'Deputy Logistics Section Chief (DLSC)',
    'Communications Unit Leader (COML)', 'Medical Unit Leader (MEDL)',
    'Supply Unit Leader (SUPL)', 'Facilities Unit Leader (FACL)',
    'Finance Section Chief (FSC)', 'Time Unit Leader (TIME)',
    'Procurement Unit Leader (PROC)', 'Cost Unit Leader (COST)'
  ]
};
