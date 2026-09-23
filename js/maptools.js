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
    var LIB = new URL('js/lib/', document.baseURI).href;
    var load = DG ? Promise.resolve(DG) : Promise.all([
      import(LIB + 'gradient.js'), import(LIB + 'elevation.js')
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
      b.textContent = TOOLS[name].label;
      b.onclick = function () { window.activateMapTool(name); };
      bar.appendChild(b);
    });
    V.ui.add(bar, 'bottom-right');
  };
})();
