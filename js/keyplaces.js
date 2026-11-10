/* WRI Respond — Key places on the map (2026-11-10, same list as the Field App's incident-scope
 * key-places.tsx). A "📍 Key places" button on the map opens a list to tap and fly to: the incident
 * location, command post, staging, boat ramps, decon, landing zones, aid stations and hospitals,
 * each with its straight-line distance from the incident.
 *
 * Source: the incident's PUBLIC recon view (APP.incident.recon_view_url, project_name filter) —
 * not the gateway web map's layers, which can lag a move (its recon layer is still the old v3
 * view). The public view leaves out the Safety category, never these place types. Hospital: the
 * recon hospital points, plus the HASP card's nearest hospital (no coordinates: a Directions link).
 * A tapped place gets a marker + label on the map, since it may not be drawn by any map layer.
 */
(function () {
  'use strict';

  // Same groups and order as the Field App (Cody 2026-11-04: from the incident's Recon points only)
  var GROUPS = [
    { key: 'icp', label: 'kp.icp', types: { icp: 'kp.t.icp' }, max: 2 },
    { key: 'staging', label: 'kp.staging', types: { staging_area: 'kp.t.staging', planned_staging_area: 'kp.t.planned' }, max: 4, empty: 'kp.noStaging' },
    { key: 'ramp', label: 'kp.ramp', types: { boat_ramp: 'kp.t.ramp' }, max: 6 },
    { key: 'decon', label: 'kp.decon', types: { decon: 'kp.t.decon' }, max: 3 },
    { key: 'lz', label: 'kp.lz', types: { landing_zone: 'kp.t.lz' }, max: 3 },
    { key: 'aid', label: 'kp.aid', types: { aid_station: 'kp.t.aid' }, max: 3 },
    { key: 'hospital', label: 'kp.hospital', types: { hospital: 'kp.t.hospital' }, max: 3 }
  ];
  var TYPE_GROUP = {};
  GROUPS.forEach(function (g) { Object.keys(g.types).forEach(function (t) { TYPE_GROUP[t] = g; }); });
  var TTL = 2 * 60 * 1000;

  var view = null, esri = null, marker = null, cache = null, cacheAt = 0, cacheFor = '', loading = null;

  function tt(k, v) { return window.t ? window.t(k, v) : k; }
  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inc() { return (window.APP && APP.incident) || {}; }
  function miles(lon1, lat1, lon2, lat2) {
    var r = Math.PI / 180, a = Math.pow(Math.sin((lat2 - lat1) * r / 2), 2) +
      Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.pow(Math.sin((lon2 - lon1) * r / 2), 2);
    return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function fmt(m) { return !isFinite(m) ? '' : m < 0.1 ? tt('kp.atIncident') : (m < 10 ? m.toFixed(1) : Math.round(m)) + ' mi'; }

  function load() {
    var i = inc(), id = String(i.incident_id || '');
    if (cache && cacheFor === id && Date.now() - cacheAt < TTL) return Promise.resolve(cache);
    if (loading) return loading;
    var siteP = window.wriIncidentSite ? wriIncidentSite() : Promise.resolve(null);
    var url = (i.recon_view_url || CONFIG.RECON_VIEW_URL) + '/query';
    var proj = String(i.recon_project || i.project_key || i.incident_name || '').replace(/'/g, "''");
    var types = Object.keys(TYPE_GROUP).map(function (t) { return "'" + t + "'"; }).join(',');
    var q = new URLSearchParams({ where: "project_name = '" + proj + "' AND observation_type IN (" + types + ")",
      outFields: '*', outSR: '4326', returnGeometry: 'true', resultRecordCount: '200', f: 'json' });
    var reconP = fetch(url + '?' + q.toString(), { credentials: 'omit' }).then(function (r) { return r.json(); })
      .then(function (j) { if (j.error) throw new Error(j.error.message || 'query failed'); return j.features || []; });
    var haspP = window.loadHaspCard ? loadHaspCard().catch(function () { return {}; }) : Promise.resolve({});
    loading = Promise.all([siteP, reconP.then(function (f) { return { ok: true, f: f }; }, function () { return { ok: false, f: [] }; }), haspP])
      .then(function (a) {
        var site = a[0], recon = a[1], hasp = a[2] || {};
        var out = { site: site, groups: {}, reconFailed: !recon.ok, hospitalCard: null };
        GROUPS.forEach(function (g) { out.groups[g.key] = []; });
        var seen = {};
        recon.f.forEach(function (f) {
          var at = f.attributes || {}, g = TYPE_GROUP[at.observation_type], geo = f.geometry;
          if (!g || !geo || !isFinite(geo.x)) return;
          var label = String(at.description || '').split('\n')[0].trim().slice(0, 80) || tt(g.types[at.observation_type]);
          var id = g.key + ':' + label + ':' + geo.x.toFixed(5) + ',' + geo.y.toFixed(5);
          if (seen[id]) return; seen[id] = 1;
          out.groups[g.key].push({ label: label, sub: tt(g.types[at.observation_type]), lon: geo.x, lat: geo.y,
            miles: site ? miles(site.lon, site.lat, geo.x, geo.y) : NaN });
        });
        GROUPS.forEach(function (g) {
          out.groups[g.key].sort(function (x, y) { return (isFinite(x.miles) ? x.miles : 1e9) - (isFinite(y.miles) ? y.miles : 1e9); });
          out.groups[g.key] = out.groups[g.key].slice(0, g.max);
        });
        // the HASP card's hospital when no recon point has the same name
        var h = hasp && hasp.hospital;
        if (h && h.name && !out.groups.hospital.some(function (p) { return p.label.toLowerCase().indexOf(String(h.name).toLowerCase().slice(0, 12)) > -1; })) {
          out.hospitalCard = h;
        }
        cache = out; cacheAt = recon.ok ? Date.now() : 0; cacheFor = String(inc().incident_id || '');
        return out;
      })
      .then(function (v) { loading = null; return v; }, function (err) { loading = null; throw err; });
    return loading;
  }
  window.loadKeyPlaces = load;

  function sheet() {
    var el = document.getElementById('keyPlacesSheet');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'keyPlacesSheet';
    el.className = 'kp-sheet hidden';
    el.innerHTML = '<div class="kp-card" role="dialog" aria-labelledby="kpTitle"><div class="kp-top"><b id="kpTitle"></b>' +
      '<button type="button" class="kp-x" onclick="hideKeyPlaces()"></button></div><div id="kpBody"></div></div>';
    el.addEventListener('click', function (ev) { if (ev.target === el) hideKeyPlaces(); });
    document.body.appendChild(el);
    return el;
  }

  function render(data, busy) {
    var i = inc();
    document.getElementById('kpTitle').textContent = tt('kp.title') + ' · ' + (i.incident_name || '');
    document.querySelector('#keyPlacesSheet .kp-x').textContent = tt('gh.close');
    var h = '<div class="kp-note">' + e(tt('kp.straight')) + '</div>';
    var site = data && data.site;
    if (site) h += row(tt('kp.incident'), i.incident_name || '', site.lon, site.lat, '');
    if (busy) h += '<div class="kp-note"><span class="spinner spinner-sm"></span> ' + e(tt('kp.finding')) + '</div>';
    if (!busy && data) {
      GROUPS.forEach(function (g) {
        var rows = data.groups[g.key] || [];
        var hcard = g.key === 'hospital' ? data.hospitalCard : null;
        if (!rows.length && !g.empty && !hcard) return;
        h += '<div class="kp-hd">' + e(tt(g.label)) + '</div>';
        rows.forEach(function (p) { h += row(p.label, p.sub, p.lon, p.lat, fmt(p.miles)); });
        if (hcard) {
          h += '<div class="kp-it kp-static"><span>' + e(hcard.name) + '<small>' + e(hcard.address || '') +
            (hcard.driveTime ? ' · ' + e(hcard.driveTime) + ' ' + e(tt('kp.byRoad')) : '') + '</small></span>' +
            (hcard.directionsUrl ? '<a class="btn btn-sm btn-secondary" target="_blank" rel="noopener" href="' + e(hcard.directionsUrl) + '">' + e(tt('gh.directions')) + ' &nearr;</a>' : '') + '</div>';
        }
        if (!rows.length && g.empty) h += '<div class="kp-note">' + e(data.reconFailed ? tt('kp.failed') : tt(g.empty)) + '</div>';
      });
    }
    document.getElementById('kpBody').innerHTML = h;
  }
  function row(label, sub, lon, lat, dist) {
    return '<button type="button" class="kp-it" onclick="flyToPlace(' + Number(lon) + ',' + Number(lat) + ',' + JSON.stringify(String(label)).replace(/"/g, '&quot;') + ')">' +
      '<span>' + e(label) + '<small>' + e(sub) + '</small></span><b class="kp-mi">' + e(dist) + '</b></button>';
  }

  window.showKeyPlaces = function () {
    var el = sheet();
    el.classList.remove('hidden');
    render(cache, !cache);
    load().then(function (d) { render(d, false); }, function () { render({ groups: {}, reconFailed: true }, false); });
  };
  window.hideKeyPlaces = function () { var el = document.getElementById('keyPlacesSheet'); if (el) el.classList.add('hidden'); };

  /** Fly the map to a place and mark it (the place may not be drawn by any layer). */
  window.flyToPlace = function (lon, lat, label) {
    hideKeyPlaces();
    if (window.hideFirstStop) hideFirstStop();
    if (window.APP && APP.currentTab !== 'map' && window.switchTab) switchTab('map');
    var go = function () {
      var v = view || window.wriMapView;
      if (!v) return;
      if (esri && esri.Graphic) {
        if (marker) v.graphics.removeMany(marker);
        var pt = { type: 'point', longitude: lon, latitude: lat };
        marker = [
          new esri.Graphic({ geometry: pt, symbol: { type: 'simple-marker', style: 'circle', size: 18, color: [236, 35, 41, 0.9], outline: { color: [255, 255, 255], width: 2 } } }),
          new esri.Graphic({ geometry: pt, symbol: { type: 'text', text: String(label || ''), color: [255, 255, 255], haloColor: [0, 0, 0], haloSize: 2,
            yoffset: 16, font: { size: 13, weight: 'bold' } } })
        ];
        v.graphics.addMany(marker);
      }
      v.goTo({ center: [lon, lat], scale: 6000 }).catch(function () {});
    };
    var v0 = view || window.wriMapView;
    if (v0 && v0.ready) go(); else setTimeout(go, 2500);
  };

  /** map.js calls this once the main map view is ready. */
  window.initKeyPlaces = function (mapView, modules) {
    view = mapView; esri = modules || {};
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'map-keyplaces';
    btn.innerHTML = '&#128205; <span>' + e(tt('kp.button')) + '</span>';
    btn.onclick = function () { showKeyPlaces(); };
    window.addEventListener('wri-lang', function () { btn.querySelector('span').textContent = tt('kp.button'); });
    load().catch(function () {});   // warm, so the list opens filled
    return btn;
  };
})();
