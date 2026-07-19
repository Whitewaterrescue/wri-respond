/* WRI Respond — static config. All values here are public, non-secret. */
window.CONFIG = {
  // Dedicated GAS JSON API deployment (token-free, session-gated). See Api.gs.
  API_URL: 'https://script.google.com/macros/s/AKfycbx7p4-A8F6G_VedgHsw3RDJgwJK1GKVAFcvSah1JdjIdG5g7PAcvXhHRKHk_ULIhdL0KA/exec',

  // Public read-only view layers (create_public_views.py). No token needed.
  RECON_VIEW_URL:    'https://services6.arcgis.com/Ji79lWGR5B33LhY7/arcgis/rest/services/WRI_Recon_v3_public/FeatureServer/0',
  RESOURCE_VIEW_URL: 'https://services6.arcgis.com/Ji79lWGR5B33LhY7/arcgis/rest/services/WRI_Resource_Manager_public/FeatureServer/0',

  // Per-incident public COP web map (activate_gateway_map.py). When set, the
  // map shows the incident's operational layers; when '', it falls back to
  // satellite + recon/resource views. The API's ?api=incident value wins if set.
  GATEWAY_WEBMAP_ID: '4dca3c1597974f6b8a037109e0e5bb63',

  // ArcGIS JS SDK (AMD build, lazy-loaded on first Map-tab open)
  ARCGIS_JS:  'https://js.arcgis.com/4.29/',
  ARCGIS_CSS: 'https://js.arcgis.com/4.29/esri/themes/dark/main.css',

  // Montana-ish default view when no gateway webmap is set
  DEFAULT_CENTER: [-113.994, 46.8721],
  DEFAULT_ZOOM: 7,

  // ICS positions for the sign-in datalist (ported from wri-gateway Config.gs GW.ROLES)
  ROLES: [
    'Incident Commander', 'Deputy Incident Commander', 'Safety Officer',
    'Public Information Officer', 'Liaison Officer', 'Operations Section Chief',
    'Planning Section Chief', 'Logistics Section Chief', 'Finance/Admin Section Chief',
    'Division Supervisor', 'Group Supervisor', 'Strike Team Leader',
    'Task Force Leader', 'Staging Area Manager', 'Field Observer',
    'Boat Operator', 'Vessel Crew', 'Drone Pilot', 'Water Safety Technician',
    'Wildlife Specialist', 'HazMat Technician', 'Equipment Operator',
    'Volunteer', 'Contractor', 'Agency Representative', 'Other'
  ]
};
