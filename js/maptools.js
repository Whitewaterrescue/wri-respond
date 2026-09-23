/* WRI Respond — Map tools.
 *
 * Analysis tools that share the Map tab's ONE MapView rather than each carrying its
 * own map. The ExB originals (downgradient, spill-trace, wri-resource-search) are React
 * widgets bound to jimu-core; their domain logic is framework-free and is what gets
 * reused here. The alternative — iframing the standalone embeds — would put a second
 * WebGL map on a responder's phone next to this one, and inherit a desktop light-theme
 * panel that has never been exercised on a phone.
 *
 * One tool is active at a time. A tool owns map clicks while active and must clean up
 * its graphics on deactivate: the map outlives every tool.
 *
 * Everything here runs TOKENLESS. Downgradient reads USGS 3DEP only — no WRI data, no
 * key, no sign-in — which is exactly why it is safe to hand a class.
 */
(function () {
  'use strict';

  // The ESM libs below are fetched by the browser, not by a <script src> in index.html, so
  // they carry no ?v= of their own -- and GitHub Pages serves with max-age=600. Without a
  // stamp a redeployed trace-engine.js can be served up to 10 minutes stale, which for the
  // safety-relevant engine is the one file that must never be. Inherit this script's own
  // stamp (captured at parse time -- document.currentScript is null inside a later call)
  // so index.html stays the single place a version is bumped.
  var STAMP = (function () {
    try { return (new URL(document.currentScript.src).search || ''); } catch (e) { return ''; }
  })();
  var LIB_BASE = new URL('js/lib/', document.baseURI).href;
  function lib(name) { return LIB_BASE + name + STAMP; }

  var V = null;          // the shared MapView
  var E = null;          // esri modules, passed in from map.js (already loaded there)
  var active = null;     // the active tool's name
  var clickHandle = null;
  var gfx = null;        // one GraphicsLayer, reused and emptied between tools

  var TOOLS = {};        // name -> { label, icon, activate(), deactivate(), onClick(pt) }

  /* ── panel ─────────────────────────────────────────────────────────── */
  function panelEl() { return document.getElementById('mapToolPanel'); }
  function bodyEl() { return document.getElementById('mapToolBody'); }

  function openPanel(title) {
    var p = panelEl();
    if (!p) return;
    document.getElementById('mapToolTitle').textContent = title;
    p.classList.add('on');
  }

  function closePanel() {
    var p = panelEl();
    if (p) p.classList.remove('on');
  }

  function setBody(html) {
    var b = bodyEl();
    if (b) b.innerHTML = html;
  }

  /* ── activation ────────────────────────────────────────────────────── */
  window.activateMapTool = function (name) {
    if (active === name) { deactivate(); return; }
    deactivate();
    var t = TOOLS[name];
    if (!t || !V) return;
    active = name;
    var btn = document.getElementById('mapToolBtn-' + name);
    if (btn) btn.classList.add('on');
    openPanel(t.label);
    setBody(t.intro || '');
    if (t.onClick) {
      clickHandle = V.on('click', function (e) {
        if (!e.mapPoint) return;
        t.onClick(e.mapPoint);
      });
    }
    if (t.activate) t.activate();
  };

  function deactivate() {
    if (!active) return;
    var t = TOOLS[active];
    var btn = document.getElementById('mapToolBtn-' + active);
    if (btn) btn.classList.remove('on');
    if (clickHandle) { clickHandle.remove(); clickHandle = null; }
    if (t && t.deactivate) t.deactivate();
    if (gfx) gfx.removeAll();
    active = null;
    closePanel();
  }
  window.closeMapTool = deactivate;

  /* Feed the active tool a point without a map click. This is the same idea as the
   * downgradient embed's ?at=lat,lon deep link: it is how a headless check drives the
   * tool (synthetic Esri hit-testing is unreliable), and it is the hook a future
   * "analyse this recon point" action would use. */
  /* Graphics the active tool has on the map. Same purpose as mapToolAt: a headless check
   * cannot see WebGL, so the count is the only honest proof that a plume was actually
   * drawn rather than merely computed. */
  window.mapToolGraphicCount = function () { return gfx ? gfx.graphics.length : -1; };

  window.mapToolAt = function (lat, lon) {
    var t = active && TOOLS[active];
    if (t && t.onClick) t.onClick({ latitude: lat, longitude: lon });
  };

  /* ── downgradient ──────────────────────────────────────────────────── */
  // Ported from downgradient-widget/embed/index.html. gradient.js and elevation.js are
  // BYTE-IDENTICAL copies of that widget's libs — do not edit them here; edit the widget
  // and re-copy, the same rule the repo mirror already carries.
  var RADII = [5, 15, 50], K = 16, ARROW_PX = 78, M_TO_FT = 3.280839895;
  var DG = null;         // the two ESM modules, imported on first use
  var dgLast = null, dgInflight = null, dgZoomTimer = null, dgZoomWatch = null;

  var BADGE = {
    CONSISTENT: { c: '#2E7D32', t: 'CONSISTENT', b: 'All radii agree. The arrow is trustworthy at this scale.' },
    'SCALE-DEPENDENT': { c: '#B8791B', t: 'SCALE-DEPENDENT', b: 'Direction changes with the radius. Read all arrows before siting containment.' },
    DIVERGENT: { c: '#EC2329', t: 'DIVERGENT', b: 'Radii disagree sharply — micro-topography controls this point. There is no single answer.' },
    SINGLE: { c: '#B8791B', t: 'SINGLE SCALE ONLY', b: 'Only one radius was usable here, so no cross-scale check was possible.' },
    NONE: { c: '#6B6E6E', t: 'INDETERMINATE', b: 'No radius produced a defensible direction.' }
  };

  // When no radius fine enough to see a ditch survived the gates, "the radii agree" only
  // means "we never looked where the ditch is" — downgrade the badge. (From the widget.)
  function badgeFor(res) {
    var base = BADGE[res.agreement.level] || BADGE.NONE;
    if (res.ditchScaleResolved) return base;
    if (res.agreement.level === 'CONSISTENT') {
      return { c: '#B8791B', t: 'CONSISTENT — LANDFORM ONLY',
        b: 'The radii that ran agree, but none was fine enough to see a ditch, shoulder or crown here. Those control the first few metres and were not sampled.' };
    }
    if (res.agreement.level === 'SINGLE') {
      return { c: '#B8791B', t: 'LANDFORM SCALE ONLY',
        b: 'One usable radius, and it is too coarse to see a ditch or shoulder. Treat this as the landform trend, not the path off the prism.' };
    }
    return base;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function dgDraw(res) {
    if (!gfx) return;
    gfx.removeAll();
    gfx.add(new E.Graphic({
      geometry: new E.Point({ longitude: res.lon, latitude: res.lat }),
      symbol: { type: 'simple-marker', style: 'circle', size: 9, color: [236, 35, 41, 0.9],
                outline: { color: [255, 255, 255, 0.95], width: 1.5 } }
    }));
    var allUsable = res.radii.filter(function (r) { return r.usable && r.azimuth != null; });
    if (!allUsable.length) return;
    // CONSISTENT means the radii agree, so one arrow IS the answer.
    var usable = (res.agreement.level === 'CONSISTENT' && res.primary) ? [res.primary] : allUsable;
    var bad = badgeFor(res);
    var rgb = [parseInt(bad.c.slice(1, 3), 16), parseInt(bad.c.slice(3, 5), 16), parseInt(bad.c.slice(5, 7), 16)];
    var maxR = Math.max.apply(null, usable.map(function (r) { return r.radiusM; }));
    var per = DG.mPerDeg(res.lat);
    var showLabels = usable.length > 1 && res.agreement.level !== 'CONSISTENT';
    // Ground metres per screen pixel: view.resolution is in Web Mercator units, which
    // overstate true ground distance by 1/cos(lat). A constant pixel length keeps the
    // arrow readable at every zoom instead of a smudge at z13 and a spike at z19.
    var mPerPx = V.resolution * Math.cos(res.lat * Math.PI / 180);
    var baseLen = ARROW_PX * mPerPx;
    usable.slice().sort(function (a, b) { return b.radiusM - a.radiusM; }).forEach(function (r, i) {
      var len = baseLen * Math.max(0.4, r.radiusM / maxR);
      var az = r.azimuth * Math.PI / 180;
      var lon1 = res.lon + (len * Math.sin(az)) / per.mLon;
      var lat1 = res.lat + (len * Math.cos(az)) / per.mLat;
      var width = 2 + i;
      gfx.add(new E.Graphic({
        geometry: new E.Polyline({ paths: [[[res.lon, res.lat], [lon1, lat1]]], spatialReference: { wkid: 4326 } }),
        symbol: { type: 'simple-line', color: rgb.concat([0.95]), width: width, cap: 'butt' }
      }));
      gfx.add(new E.Graphic({
        geometry: new E.Point({ longitude: lon1, latitude: lat1 }),
        symbol: { type: 'simple-marker', style: 'triangle', size: 11 + width, angle: r.azimuth,
                  color: rgb.concat([0.95]), outline: { color: [255, 255, 255, 0.9], width: 1 } }
      }));
      if (showLabels) {
        gfx.add(new E.Graphic({
          geometry: new E.Point({ longitude: lon1, latitude: lat1 }),
          symbol: { type: 'text', text: r.radiusM + ' m', color: '#ffffff', haloColor: '#3A3C3C',
                    haloSize: 2, font: { size: 10, weight: 'bold' }, yoffset: -16 }
        }));
      }
    });
  }

  function dgRender(res) {
    var bad = badgeFor(res), p = res.primary, elev = res.centerElevM;
    var srcRes = (res.radii.filter(function (r) { return r.resolutionM != null; })[0] || {}).resolutionM;
    var h = '<div class="dg-badge" style="background:' + bad.c + '">' + bad.t;
    if (res.agreement.maxDiffDeg != null && res.agreement.comparedRadii.length > 1) {
      h += ' · spread ' + res.agreement.maxDiffDeg.toFixed(0) + '°';
    }
    h += '</div><p class="dg-blurb">' + esc(bad.b) + '</p>';
    if (p) {
      h += '<div class="dg-az">' + p.azimuth.toFixed(0) + '° <small>' + esc(p.cardinal) + '</small></div>' +
           '<div class="dg-det">downgradient at ' + p.radiusM + ' m · ' +
           p.slopePct.toFixed(1) + '% grade (' + p.slopeDeg.toFixed(1) + '°)</div>';
    } else {
      h += '<div class="dg-az" style="font-size:1rem">Indeterminate</div>' +
           '<div class="dg-det">No arrow drawn — see the per-radius detail.</div>';
    }
    h += '<table class="dg-tbl"><thead><tr><th>Radius</th><th>Azimuth</th><th>Grade</th><th>R²</th></tr></thead><tbody>';
    res.radii.forEach(function (r) {
      h += '<tr class="' + (r.usable ? '' : 'drop') + '"><td>' + r.radiusM + ' m</td><td>' +
        (r.azimuth == null ? '—' : r.azimuth.toFixed(0) + '° ' + esc(r.cardinal)) + '</td><td>' +
        (r.slopePct == null ? '—' : r.slopePct.toFixed(1) + '%') + '</td><td>' +
        (r.r2 == null ? 'flat' : r.r2.toFixed(2)) + '</td></tr>';
    });
    h += '</tbody></table>';
    res.radii.forEach(function (r) {
      if (!r.usable && r.reason) h += '<div class="dg-why"><b>' + r.radiusM + ' m:</b> ' + esc(r.reason) + '</div>';
    });
    (res.notes || []).forEach(function (n) { h += '<div class="dg-note">' + esc(n) + '</div>'; });
    h += '<div class="dg-meta"><div>Elevation: ' +
      (elev == null ? '—' : elev.toFixed(1) + ' m (' + (elev * M_TO_FT).toFixed(0) + ' ft)') + '</div>' +
      '<div>Source: ' + esc(DG.sourceLabel(srcRes == null ? null : srcRes)) + '</div>' +
      '<div>' + res.lat.toFixed(5) + ', ' + res.lon.toFixed(5) + '</div></div>';
    setBody(h);
    var b = bodyEl();
    if (b) b.dataset.ready = '1';
  }

  function dgRun(lat, lon) {
    if (dgInflight) dgInflight.abort();
    var ac = new AbortController();
    dgInflight = ac;
    setBody('<p class="dg-hint">Sampling elevation…</p>');
    // The libs are ES modules and these files are classic scripts, so they arrive by
    // dynamic import on first use — which also keeps them off the boot path.
    // Absolute URL from the document base. A bare './lib/...' is ambiguous here —
    // dynamic import() in a CLASSIC script resolves against the script URL in some
    // engines and the document URL in others, and the two differ by the js/ segment.
    var load = DG ? Promise.resolve(DG) : Promise.all([
      import(lib('gradient.js')), import(lib('elevation.js'))
    ]).then(function (m) {
      DG = { ringPlan: m[0].ringPlan, analyze: m[0].analyze, mPerDeg: m[0].mPerDeg,
             sampleElevations: m[1].sampleElevations, sourceLabel: m[1].sourceLabel };
      return DG;
    });
    load.then(function () {
      var plan = DG.ringPlan(lat, lon, RADII, K);
      return DG.sampleElevations(plan.points, { signal: ac.signal }).then(function (s) {
        if (ac.signal.aborted) return;
        if (!s.answered) {
          if (gfx) gfx.removeAll();
          setBody('<p class="dg-err">No elevation data here — outside DEM coverage. ' +
                  'USGS 3DEP covers North America.</p>');
          return;
        }
        dgLast = DG.analyze(lat, lon, plan, s.values, s.resolutions);
        dgDraw(dgLast);
        dgRender(dgLast);
      });
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return;
      if (gfx) gfx.removeAll();
      setBody('<p class="dg-err">' + esc(e && e.message ? e.message : String(e)) + '</p>');
    }).then(function () {
      if (dgInflight === ac) dgInflight = null;
    });
  }

  TOOLS.downgradient = {
    short: 'Gradient',
    label: 'Downgradient',
    intro: '<p class="dg-hint">Tap the map where the spill is. Elevation comes from USGS 3DEP ' +
           '(North America) — nothing is saved.</p>',
    onClick: function (pt) { dgRun(pt.latitude, pt.longitude); },
    activate: function () {
      // Arrows are sized in screen pixels, so they must be rebuilt on zoom.
      // Accessor.watch() is gone in newer SDKs; reactiveUtils works in both.
      dgZoomWatch = E.reactiveUtils.watch(function () { return V.resolution; }, function () {
        if (!dgLast) return;
        clearTimeout(dgZoomTimer);
        dgZoomTimer = setTimeout(function () { if (dgLast) dgDraw(dgLast); }, 120);
      });
    },
    deactivate: function () {
      if (dgInflight) { dgInflight.abort(); dgInflight = null; }
      if (dgZoomWatch) { dgZoomWatch.remove(); dgZoomWatch = null; }
      clearTimeout(dgZoomTimer);
      dgLast = null;
    }
  };

  /* -- spill trajectory (river tier) --------------------------------- */
  // The engine (trace-engine.js, byte-identical copy of the canonical one) is
  // dependency-free ESM with injectable providers, which is what makes this portable.
  // Cody's call 2026-09-23: the plume belongs ON THE COP, next to the GRP strategies
  // and recon points, rather than in an iframe carrying its own map. River/stream tier
  // only -- an open-water spill says so plainly and links to the full widget instead of
  // silently returning nothing.
  var FULL_WIDGET = 'https://whitewaterrescue.github.io/wri-exb-widgets/embed/?config=all-grps';

  // ONLY anonymously-readable services. Every one is probed in the rig; a secured layer
  // here would make the SDK prompt a responder to sign in, which is the one thing this
  // app must never do. Snake, Jocko, BNSF FRP, WA ECY and Duluth are deliberately absent.
  var SVC = 'https://services6.arcgis.com/Ji79lWGR5B33LhY7/arcgis/rest/services/';
  var SITE_LAYERS = [
    { url: SVC + 'Clarkfork_River_GRP_Points_2025/FeatureServer/0', nameField: 'Site_Name' },
    { url: SVC + 'Missouri_River_GRP_Points_2025/FeatureServer/0', nameField: 'Location_Description' },
    { url: SVC + 'Upper_Colorado_GRP_Points_2025/FeatureServer/0', nameField: 'Site_Name' },
    { url: SVC + 'Yellowstone_River_GRP_Points_2025_5/FeatureServer/0', nameField: 'Site_Name' },
    { url: SVC + 'Lochsa_River_GRP_Points_2025/FeatureServer/0', nameField: 'Location_Description' },
    { url: SVC + 'Kootenai_River_GRP_Points_2025/FeatureServer/0', nameField: 'Site_Name' },
    { url: SVC + 'Upper_Kootenai_River_GRP_Points_2025/FeatureServer/0', nameField: 'Location_Description' },
    { url: SVC + 'MF_Flathead_GRP_Points_2025_WFL1/FeatureServer/0', nameField: 'Site_Name' },
    { url: SVC + 'WRI_GRP_WAB_pub/FeatureServer/0', nameField: 'site_name' }
  ];
  // timingModel MUST match the response viewers. 'jobson' tracks the LEADING EDGE
  // (t_lead, USGS WRIR 96-4013 dye-study regressions); 'hydraulic' tracks the PEAK
  // (cum_time). The gateway shipped on hydraulic and read ~36% short against the WRI
  // viewer on the same Wabash click (46.7 km vs 63.4 km at 24 h, measured 2026-09-23)
  // -- and hydraulic mode emits no hourly.band, so the uncertainty underlay below never
  // drew either, making the plume look shorter still. Leading edge is also the right
  // question for response: boom has to be in the water BEFORE the first oil arrives.
  // Apps on 'jobson': Field App (both maps), BNSF, UP, WRI, MT/WY -- and now this.
  var ST_CFG = { safetyFactor: 1.5, timingModel: 'jobson', minStreamOrder: 4,
                 maxHours: 24, maxDistanceKm: 300, asOf: null, verbose: false };
  var ST = null, stInflight = null;

  function bandColor(hr) { return hr < 3 ? '#d7191c' : hr < 12 ? '#fdae61' : '#2c7bb6'; }
  function hexRgb(x) {
    return [parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)];
  }

  // A single query is capped at the layer's maxRecordCount (often 2000); large GRP sets
  // truncate silently without paging.
  function queryAll(fl, q) {
    var out = [];
    q.num = 2000;
    function page() {
      q.start = out.length;
      return fl.queryFeatures(q).then(function (fs) {
        out = out.concat(fs.features);
        if (!fs.exceededTransferLimit || !fs.features.length || out.length > 50000) return out;
        return page();
      });
    }
    return page();
  }

  function siteProviders(notes) {
    return SITE_LAYERS.map(function (lc) {
      return {
        buffer_m: 500,
        fetch: function () {
          var fl = new E.FeatureLayer({ url: lc.url });
          var q = fl.createQuery();
          q.where = '1=1';
          q.outFields = [lc.nameField];
          q.returnGeometry = true;
          q.outSpatialReference = { wkid: 4326 };
          return queryAll(fl, q).then(function (feats) {
            return feats.filter(function (f) { return f.geometry && f.geometry.type === 'point'; })
              .map(function (f) {
                return { name: f.attributes[lc.nameField], lat: f.geometry.y, lon: f.geometry.x };
              });
          }).catch(function () {
            notes.push(lc.url.split('/services/')[1].split('/')[0] + ' unavailable');
            return [];
          });
        }
      };
    });
  }

  function stDraw(res, lat, lon) {
    if (!gfx) return;
    gfx.removeAll();
    gfx.add(new E.Graphic({
      geometry: new E.Point({ latitude: lat, longitude: lon }),
      symbol: { type: 'simple-marker', style: 'x', size: 14, outline: { color: '#000', width: 3 } }
    }));
    var rows = res.trace || [];
    // Mirror the engine's own timeOf(): in jobson mode the meaningful clock is the LEADING
    // EDGE (t_lead), in hydraulic it is the peak (cum_time). Colouring bands by cum_time
    // while the hour marks are placed by t_lead would put the 3 h colour change in a
    // visibly different place from the "3 hr" label on the same line.
    var jobson = (res.timing_model || ST_CFG.timingModel) === 'jobson';
    var tOf = function (r) { return jobson ? r.t_lead : r.cum_time; };
    var b0 = 0;
    for (var i = 1; i <= rows.length; i++) {
      var done = i === rows.length;
      var changed = !done && bandColor(tOf(rows[i])) !== bandColor(tOf(rows[b0]));
      if (done || changed) {
        var seg = rows.slice(b0, Math.min(i + 1, rows.length));
        gfx.add(new E.Graphic({
          geometry: new E.Polyline({ paths: [seg.map(function (r) { return [r.lon, r.lat]; })],
                                     spatialReference: { wkid: 4326 } }),
          symbol: { type: 'simple-line', color: bandColor(tOf(rows[b0])), width: 4 }
        }));
        b0 = i;
      }
    }
    // Jobson uncertainty band: peak position -> 99% leading edge, translucent underlay
    (res.hourly || []).forEach(function (h) {
      if (!h.band) return;
      var i0 = Math.min(h.band.peak.i, h.band.fastest.i), i1 = Math.max(h.band.peak.i, h.band.fastest.i);
      if (i1 <= i0) return;
      var seg = rows.slice(i0, i1 + 1);
      gfx.add(new E.Graphic({
        geometry: new E.Polyline({ paths: [seg.map(function (r) { return [r.lon, r.lat]; })],
                                   spatialReference: { wkid: 4326 } }),
        symbol: { type: 'simple-line', color: hexRgb(bandColor(h.hour)).concat([0.28]), width: 14, cap: 'round' }
      }));
    });
    (res.hourly || []).forEach(function (h) {
      gfx.add(new E.Graphic({
        geometry: new E.Point({ latitude: h.lat, longitude: h.lon }),
        symbol: { type: 'simple-marker', size: 7, color: bandColor(h.hour),
                  outline: { color: '#fff', width: 1 } }
      }));
      gfx.add(new E.Graphic({
        geometry: new E.Point({ latitude: h.lat, longitude: h.lon }),
        symbol: { type: 'text', text: h.hour + ' hr', color: bandColor(h.hour),
                  haloColor: '#000000', haloSize: 1.5, yoffset: 9,
                  font: { size: 10, weight: 'bold' } }
      }));
    });
  }

  function stRender(res, notes) {
    var h = '<div class="dg-az">' + (res.distance_km_24h != null ? res.distance_km_24h.toFixed(1) : '-') +
            ' km <small>in ' + ST_CFG.maxHours + ' h</small></div>' +
            '<div class="dg-det">' + esc(res.river_name || 'Trace') + '</div>';
    var sites = res.sites || [];
    if (sites.length) {
      h += '<table class="dg-tbl"><thead><tr><th>GRP site</th><th>ETA</th><th>km down</th></tr></thead><tbody>';
      sites.forEach(function (s) {
        // engine field is dist_km (km downstream along the trace); offset_m is how far
        // the site sits OFF the trace line -- both come from proximity() in trace-engine.js
        h += '<tr><td>' + esc(s.name) +
             (s.offset_m == null ? '' : ' <small>' + s.offset_m + ' m off</small>') + '</td><td>' +
             (s.eta_hr == null ? '-' : s.eta_hr.toFixed(1) + ' h') + '</td><td>' +
             (s.dist_km == null ? '-' : s.dist_km.toFixed(1)) + '</td></tr>';
      });
      h += '</tbody></table>';
    } else {
      h += '<p class="dg-hint">No GRP site within 500 m of the trace.</p>';
    }
    (res.warnings || []).forEach(function (w) { h += '<div class="dg-why">' + esc(w) + '</div>'; });
    notes.forEach(function (n) { h += '<div class="dg-note">' + esc(n) + '</div>'; });
    h += '<div class="dg-meta">Engine ' + esc(ST ? ST.ENGINE_VERSION : '') +
         ' &middot; leading edge (' + ST_CFG.timingModel + ')' +
         ' &middot; safety factor ' + ST_CFG.safetyFactor +
         ' &middot; USGS NLDI/NWIS &middot; nothing is saved</div>';
    setBody(h);
    var b = bodyEl();
    if (b) b.dataset.ready = '1';
  }

  function stRun(lat, lon) {
    if (stInflight) stInflight.cancelled = true;
    var job = stInflight = { cancelled: false };
    setBody('<p class="dg-hint">Tracing downstream&hellip;</p>');
    var notes = [];
    // Every call below is USGS, and USGS latency swings wildly — measured 0.2 s and
    // 24 s for the SAME endpoint minutes apart on 2026-09-23. On a phone over cell
    // data an un-timed await is a spinner that never ends, so each stage is raced and
    // degrades to something the user can act on.
    function withTimeout(p, ms, marker) {
      return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(marker); }, ms); })]);
    }
    var TIMED_OUT = {};

    (ST ? Promise.resolve(ST) : import(lib('trace-engine.js')).then(function (m) { ST = m; return m; }))
      .then(function () {
        // The open-water check hits the wmadata geoserver, the slowest of the USGS
        // endpoints (and the one sunsetting 2026-12-31). If it does not answer, carry
        // on as a river — the overwhelmingly common case — and say the check was skipped
        // rather than stall the whole trace on it.
        return withTimeout(ST.resolveTraceMode(lat, lon, ST_CFG), 20000, TIMED_OUT);
      })
      .then(function (mode) {
        if (job.cancelled) return;
        if (mode === TIMED_OUT) {
          notes.push('Open-water check timed out (USGS slow) — traced as a river.');
          mode = { mode: 'river' };
        }
        // engine >=1.12.1 answers a FAILED National Map probe the same way rather than
        // throwing (hydro.nationalmap.gov served 504s for hours on 2026-09-23). Say so:
        // a lake click silently traced as a river would otherwise look authoritative.
        if (mode && mode.probe_failed) notes.push(mode.probe_failed);
        // Open water is a different model entirely. Say so rather than return nothing.
        if (mode && mode.mode && mode.mode !== 'river') {
          if (gfx) gfx.removeAll();
          setBody('<p class="dg-hint">This point is in open water' +
                  (mode.waterbody && mode.waterbody.name ? ' (' + esc(mode.waterbody.name) + ')' : '') +
                  '. The gateway models rivers and streams; open-water drift needs the full ' +
                  'trajectory widget.</p><p><a class="btn btn-primary" target="_blank" rel="noopener" href="' +
                  FULL_WIDGET + '">Open the full widget &nearr;</a></p>');
          var bo = bodyEl(); if (bo) bo.dataset.ready = '1';
          return;
        }
        var cfg = Object.assign({}, ST_CFG, { siteProviders: siteProviders(notes) });
        setBody('<p class="dg-hint">Fetching hydrology from USGS…</p>');
        return withTimeout(ST.fetchTraceData(lat, lon, cfg), 150000, TIMED_OUT)
          .then(function (data) {
            if (job.cancelled) return;
            if (data === TIMED_OUT) {
              if (gfx) gfx.removeAll();
              setBody('<p class="dg-err">USGS did not answer in time.</p>' +
                      '<p class="dg-hint">Their hydrology service is intermittently slow. ' +
                      'Tap the map again to retry — nothing was lost.</p>');
              var bt = bodyEl(); if (bt) bt.dataset.ready = '1';
              return;
            }
            var res = ST.computeTrace(data, cfg);
            stDraw(res, lat, lon);
            stRender(res, notes);
          });
      })
      .catch(function (e) {
        if (job.cancelled) return;
        if (gfx) gfx.removeAll();
        setBody('<p class="dg-err">' + esc(e && e.message ? e.message : String(e)) + '</p>');
        var b = bodyEl(); if (b) b.dataset.ready = '1';
      })
      .then(function () { if (stInflight === job) stInflight = null; });
  }

  TOOLS.spilltrace = {
    short: 'Trajectory',
    label: 'Spill trajectory',
    intro: '<p class="dg-hint">Tap the map at the spill point. Traces downstream for 24 h ' +
           'using USGS hydrology and flags GRP sites within 500 m. Nothing is saved.</p>',
    onClick: function (pt) { stRun(pt.latitude, pt.longitude); },
    deactivate: function () { if (stInflight) { stInflight.cancelled = true; stInflight = null; } }
  };

  /* ── resource search ───────────────────────────────────────────────── */
  // Ported from the ExB widget wri-resource-search (widget.tsx). Only the domain logic
  // comes across — haversineMi, the SQL builder, the row mapper and the search itself;
  // the other ~500 lines there are React panel chrome that this shell replaces.
  //
  // The data plane is WRI_WRRL_Resources_pub, a field-filtered PUBLIC VIEW minted by
  // wri-respond/create_wrrl_public_view.py. The underlying WRI_WRRL_Resources is org-only
  // and must stay that way -- four other apps read it. Contact fields are exposed by
  // Cody's call 2026-09-23; if that is ever reversed, re-run that script with
  // --no-contacts and this tool degrades on its own (the contact line just vanishes).
  var RS_URL = 'https://services6.arcgis.com/Ji79lWGR5B33LhY7/arcgis/rest/services/' +
               'WRI_WRRL_Resources_pub/FeatureServer/0';
  var RS_MAX = 200;           // matches the widget's maxResults; the count shows "200+"
  var RS_DETOUR = 1.3;        // straight-line -> road factor
  var RS_MPH = 35;            // responders are towing trailers, not driving free-flow
  var RS_RADII = [25, 50, 100, 250];
  var R_EARTH_MI = 3958.8;

  var rs = { origin: null, radius: 50, kind: '', text: '', trailers: false,
             rows: [], run: 0, layer: null, kinds: null };

  function haversineMi(aLat, aLon, bLat, bLon) {
    var rad = Math.PI / 180;
    var dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
    var s = Math.pow(Math.sin(dLat / 2), 2) +
            Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.pow(Math.sin(dLon / 2), 2);
    return 2 * R_EARTH_MI * Math.asin(Math.sqrt(s));
  }

  // SQL string literal — WRRL free text is full of apostrophes (O'Brien Boom).
  function sq(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

  function rsLayer() {
    if (!rs.layer) rs.layer = new E.FeatureLayer({ url: RS_URL });
    return rs.layer;
  }

  function rsWhere() {
    var parts = ['1=1'];
    if (rs.kind) parts.push('resource_kind = ' + sq(rs.kind));
    if (rs.trailers) parts.push("is_parent = 1 AND resource_kind = 'Trailer'");
    var t = (rs.text || '').trim();
    if (t) {
      var like = sq('%' + t + '%');
      parts.push('(' + ['identification', 'specification', 'resource_kind',
                        'resource_kindtype', 'org_code', 'wrrl_id']
        .map(function (f) { return 'UPPER(' + f + ') LIKE UPPER(' + like + ')'; })
        .join(' OR ') + ')');
    }
    return parts.join(' AND ');
  }

  var RS_FIELDS = ['org_code', 'wrrl_id', 'wrrl_group_id', 'is_parent', 'child_count',
                   'resource_kind', 'resource_kindtype', 'identification', 'specification',
                   'boom_ft', 'storage_bbl', 'recovery_bbl', 'people',
                   'city', 'state', 'address', 'contact_name', 'contact_phone', 'loc_source'];

  function rsRow(f, o) {
    var a = f.attributes, g = f.geometry;
    var lat = g ? g.latitude : 0, lon = g ? g.longitude : 0;
    return {
      org: a.org_code || '', wrrlId: String(a.wrrl_id == null ? '' : a.wrrl_id),
      groupId: String(a.wrrl_group_id == null ? '' : a.wrrl_group_id),
      isParent: !!a.is_parent, childCount: a.child_count || 0,
      kind: a.resource_kind || '', kindType: a.resource_kindtype || '',
      name: a.identification || '', spec: a.specification || '',
      boomFt: a.boom_ft || 0, storageBbl: a.storage_bbl || 0,
      recoveryBbl: a.recovery_bbl || 0, people: a.people || 0,
      city: a.city || '', state: a.state || '', address: a.address || '',
      contactName: a.contact_name || '', contactPhone: a.contact_phone || '',
      locSource: a.loc_source || '',
      lat: lat, lon: lon, distMi: haversineMi(o.lat, o.lon, lat, lon)
    };
  }

  function rsCapability(r) {
    var bits = [];
    if (r.boomFt) bits.push(Math.round(r.boomFt).toLocaleString() + ' ft boom');
    if (r.storageBbl) bits.push(Math.round(r.storageBbl).toLocaleString() + ' bbl storage');
    if (r.recoveryBbl) bits.push(Math.round(r.recoveryBbl).toLocaleString() + ' bbl/day recovery');
    if (r.people) bits.push(r.people + ' people');
    return bits.join(' · ');
  }

  function rsDrive(mi) {
    var road = mi * RS_DETOUR, min = (road / RS_MPH) * 60;
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    return Math.round(road) + ' mi · ' + (h ? h + ' h ' + m + ' m' : m + ' m') + ' (est)';
  }

  function rsDraw() {
    if (!gfx) return;
    gfx.removeAll();
    if (rs.origin) {
      gfx.add(new E.Graphic({
        geometry: new E.Point({ latitude: rs.origin.lat, longitude: rs.origin.lon }),
        symbol: { type: 'simple-marker', style: 'x', size: 14, outline: { color: '#EC2329', width: 3 } }
      }));
    }
    rs.rows.forEach(function (r) {
      gfx.add(new E.Graphic({
        geometry: new E.Point({ latitude: r.lat, longitude: r.lon }),
        symbol: { type: 'simple-marker', size: 7, color: [58, 60, 60, 0.95],
                  outline: { color: '#fff', width: 1 } },
        attributes: { name: r.name },
        popupTemplate: { title: '{name}' }
      }));
    });
  }

  function rsResultsHtml(status) {
    var h = '<div class="rs-status">' + esc(status) + '</div>';
    if (!rs.rows.length) return h;
    h += '<div class="rs-list">';
    rs.rows.forEach(function (r) {
      h += '<div class="rs-item">' +
           '<div class="rs-name">' + esc(r.name || r.kindType || r.kind || 'Resource') +
           (r.isParent && r.childCount ? ' <small>trailer · ' + r.childCount + ' items</small>' : '') +
           '</div>' +
           '<div class="rs-sub">' + esc(r.org) +
             (r.kindType ? ' · ' + esc(r.kindType) : '') + '</div>';
      var cap = rsCapability(r);
      if (cap) h += '<div class="rs-cap">' + esc(cap) + '</div>';
      // 2,257 WRRL rows sit on a town centroid, so searching from that town puts them at
      // literally 0.0 mi -- "0 mi · 0 m (est)" reads like the tool is broken. Say what it
      // actually means instead, and let the approx-location badge below carry the caveat.
      h += '<div class="rs-dist">' + (r.distMi < 1
             ? 'about here'
             : r.distMi.toFixed(1) + ' mi straight · ' + esc(rsDrive(r.distMi)) +
               ' @ ' + RS_MPH + ' mph') + '</div>';
      var where = [r.city, r.state].filter(Boolean).join(', ');
      if (where) {
        h += '<div class="rs-loc">' + esc(where) +
             (r.locSource === 'city' ? ' <em>approx location</em>' : '') + '</div>';
      }
      if (r.contactName || r.contactPhone) {
        h += '<div class="rs-contact">' + esc(r.contactName);
        if (r.contactPhone) {
          h += ' <a href="tel:' + esc(String(r.contactPhone).replace(/[^\d+]/g, '')) + '">' +
               esc(r.contactPhone) + '</a>';
        }
        h += '</div>';
      }
      h += '<div class="rs-links"><a target="_blank" rel="noopener" href="' +
           'https://www.google.com/maps/dir/?api=1&destination=' + r.lat + ',' + r.lon +
           (rs.origin ? '&origin=' + rs.origin.lat + ',' + rs.origin.lon : '') +
           '">Directions &nearr;</a></div>';
      h += '</div>';
    });
    return h + '</div>';
  }

  // `busy` keeps dataset.ready off while a search is in flight -- that flag is what the
  // headless rig waits on, and marking "Searching..." as ready would let a check read the
  // previous result and call it a pass.
  function rsSetResults(status, busy) {
    var el = document.getElementById('rsResults');
    if (el) el.innerHTML = rsResultsHtml(status);
    var b = bodyEl();
    if (b) b.dataset.ready = busy ? '' : '1';
  }

  function rsSearch() {
    if (!rs.origin) { rsSetResults('Tap the map to set a search origin.'); return; }
    var run = ++rs.run;
    var b = bodyEl(); if (b) b.dataset.ready = '';
    rsSetResults('Searching…', true);
    var fl = rsLayer();
    var q = fl.createQuery();
    q.where = rsWhere();
    q.outFields = RS_FIELDS;
    q.returnGeometry = true;
    q.outSpatialReference = { wkid: 4326 };
    q.geometry = new E.Point({ latitude: rs.origin.lat, longitude: rs.origin.lon });
    q.distance = rs.radius;
    q.units = 'miles';
    q.spatialRelationship = 'intersects';
    q.num = RS_MAX;
    fl.queryFeatures(q).then(function (fs) {
      if (run !== rs.run) return;                 // a newer search already ran
      rs.rows = fs.features.filter(function (f) { return f.geometry; })
        .map(function (f) { return rsRow(f, rs.origin); })
        .sort(function (a, b2) { return a.distMi - b2.distMi; });
      rsDraw();
      var capped = rs.rows.length >= RS_MAX;
      rsSetResults(rs.rows.length + (capped ? '+' : '') + ' resource(s) within ' +
                   rs.radius + ' mi');
    }).catch(function (e) {
      if (run !== rs.run) return;
      rs.rows = [];
      rsSetResults('Search failed: ' + String(e && e.message ? e.message : e).slice(0, 120));
    });
  }

  function rsControlsHtml() {
    var h = '<div class="rs-ctl">';
    h += '<div class="rs-origin" id="rsOrigin">' +
         (rs.origin ? 'Origin: ' + rs.origin.lat.toFixed(4) + ', ' + rs.origin.lon.toFixed(4) +
                      ' — tap again to move it'
                    : 'Tap the map to set a search origin.') + '</div>';
    h += '<div class="rs-chips">';
    RS_RADII.forEach(function (r) {
      h += '<button type="button" class="rs-chip' + (rs.radius === r ? ' on' : '') +
           '" data-radius="' + r + '">' + r + ' mi</button>';
    });
    h += '</div>';
    h += '<select id="rsKind" class="rs-in"><option value="">All resource kinds</option>';
    (rs.kinds || []).forEach(function (k) {
      h += '<option value="' + esc(k) + '"' + (rs.kind === k ? ' selected' : '') + '>' +
           esc(k) + '</option>';
    });
    h += '</select>';
    h += '<input id="rsText" class="rs-in" type="search" placeholder="Name, spec, org or WRRL ID" ' +
         'value="' + esc(rs.text) + '">';
    h += '<label class="rs-chk"><input id="rsTrailers" type="checkbox"' +
         (rs.trailers ? ' checked' : '') + '> Whole trailers only</label>';
    h += '<button type="button" id="rsGo" class="btn btn-primary rs-go">Search</button>';
    h += '</div><div id="rsResults"></div>';
    return h;
  }

  function rsRender() {
    setBody(rsControlsHtml());
    rsSetResults(rs.rows.length ? rs.rows.length + ' resource(s) within ' + rs.radius + ' mi'
                                : 'Set an origin and search.');
    var b = bodyEl();
    if (!b) return;
    // #mapToolBody is a PERSISTENT element -- setBody only swaps its innerHTML. Attaching
    // on every render would stack a listener per activation and fire the search N times
    // on one chip tap. Delegate once, read state at click time.
    if (b.dataset.rsWired === '1') return;
    b.dataset.rsWired = '1';
    b.addEventListener('click', function (e) {
      if (active !== 'resourcesearch') return;
      var chip = e.target.closest ? e.target.closest('[data-radius]') : null;
      if (chip) {
        rs.radius = Number(chip.dataset.radius);
        [].forEach.call(b.querySelectorAll('[data-radius]'), function (c) {
          c.classList.toggle('on', Number(c.dataset.radius) === rs.radius);
        });
        if (rs.origin) rsSearch();
        return;
      }
      if (e.target.id === 'rsGo') { rsSync(); rsSearch(); }
    });
  }

  function rsSync() {
    var k = document.getElementById('rsKind'), t = document.getElementById('rsText'),
        c = document.getElementById('rsTrailers');
    if (k) rs.kind = k.value;
    if (t) rs.text = t.value;
    if (c) rs.trailers = c.checked;
  }

  // The kind facet is 22 normalized values; fetched once per session, and a failure here
  // must not disable the search — the dropdown simply stays at "All resource kinds".
  function rsLoadKinds() {
    if (rs.kinds) return Promise.resolve();
    var fl = rsLayer();
    var q = fl.createQuery();
    q.where = "resource_kind IS NOT NULL AND resource_kind <> ''";
    q.outFields = ['resource_kind'];
    q.returnDistinctValues = true;
    q.returnGeometry = false;
    q.orderByFields = ['resource_kind'];
    q.num = 200;
    return fl.queryFeatures(q).then(function (fs) {
      rs.kinds = fs.features.map(function (f) { return f.attributes.resource_kind; })
        .filter(Boolean);
    }).catch(function () { rs.kinds = []; });
  }

  TOOLS.resourcesearch = {
    short: 'Resources',
    label: 'Resource search',
    intro: '<p class="dg-hint">Loading resource kinds&hellip;</p>',
    activate: function () {
      rs.rows = [];
      rsLoadKinds().then(function () {
        if (active === 'resourcesearch') rsRender();
      });
    },
    onClick: function (pt) {
      rs.origin = { lat: pt.latitude, lon: pt.longitude };
      var o = document.getElementById('rsOrigin');
      if (o) {
        o.textContent = 'Origin: ' + rs.origin.lat.toFixed(4) + ', ' +
                        rs.origin.lon.toFixed(4) + ' — tap again to move it';
      }
      rsSync();
      rsSearch();
    },
    deactivate: function () { rs.run++; rs.origin = null; rs.rows = []; }
  };

  /* ── wiring ────────────────────────────────────────────────────────── */
  // Called from js/map.js inside mapView.when(), with the modules it already loaded.
  window.initMapTools = function (view, modules) {
    V = view;
    E = modules;
    if (gfx) { try { gfx.destroy(); } catch (e) {} }
    gfx = new E.GraphicsLayer({ title: 'Map tools (ephemeral)', listMode: 'hide' });
    V.map.add(gfx);

    var bar = document.createElement('div');
    bar.className = 'maptool-bar';
    Object.keys(TOOLS).forEach(function (name) {
      var b = document.createElement('button');
      b.id = 'mapToolBtn-' + name;
      b.type = 'button';
      // Short on the bar (three full labels overflow a 390px phone and collide with
      // the zoom controls); the panel head still shows the full name.
      b.textContent = TOOLS[name].short || TOOLS[name].label;
      b.onclick = function () { window.activateMapTool(name); };
      bar.appendChild(b);
    });
    V.ui.add(bar, 'bottom-right');
  };
})();
