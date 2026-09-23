/* WRI Respond — ArcGIS map (lazy-loaded, fully anonymous).
 *
 * The whole point of this rebuild: NO ArcGIS org token anywhere.
 *  - Main map: public gateway webmap (if configured) or satellite basemap +
 *    two public view layers (recon / resources) filtered by definitionExpression.
 *  - Attachments are fetched anonymously from the public view layer.
 *  - The SDK itself is injected only when the Map tab (or recon mini-map)
 *    first needs it.
 */
(function () {
  'use strict';

  var arcgisPromise = null;
  var mapView = null;
  var reconMiniView = null;
  var mapTapHandler = null;

  // The recon point chosen by GPS or map tap; read by recon.js on submit.
  window.reconPoint = null;

  /* ═══════════════════════════════════════════
     SDK LAZY LOADER
     ═══════════════════════════════════════════ */
  function loadArcGIS() {
    if (arcgisPromise) return arcgisPromise;
    arcgisPromise = new Promise(function (resolve, reject) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CONFIG.ARCGIS_CSS;
      document.head.appendChild(link);

      var script = document.createElement('script');
      script.src = CONFIG.ARCGIS_JS;
      script.onload = function () { resolve(window.require); };
      script.onerror = function () {
        arcgisPromise = null; // allow retry on next tab open
        reject(new Error('Could not load the map library. Check your connection.'));
      };
      document.head.appendChild(script);
    });
    return arcgisPromise;
  }

  // Warm the SDK during the PIN/sign-in dwell (called from app.js boot).
  // Pulls init.js + the exact module set initMainMap needs; instantiates
  // nothing, so no DOM is touched. initMainMap later joins the same memoized
  // promise. Failures stay silent — loadArcGIS resets arcgisPromise on error,
  // so the real map init retries from scratch.
  window.warmArcGIS = function () {
    loadArcGIS().then(function (require) {
      require([
        'esri/Map',
        'esri/views/MapView',
        'esri/layers/FeatureLayer',
        'esri/widgets/Locate',
        'esri/widgets/LayerList',
        'esri/widgets/Search',
        'esri/WebMap',
        'esri/identity/IdentityManager',
        'esri/config'
      ], function () {});
    }).catch(function () {});
  };

  function sqlEscape(v) {
    return String(v == null ? '' : v).replace(/'/g, "''");
  }

  function layerBaseUrl(inc, kind) {
    if (kind === 'recon') return (inc && inc.recon_view_url) || CONFIG.RECON_VIEW_URL;
    return (inc && inc.resource_view_url) || CONFIG.RESOURCE_VIEW_URL;
  }

  /* ═══════════════════════════════════════════
     POPUPS (attribute table + anonymous attachments)
     ═══════════════════════════════════════════ */
  var SKIP_FIELDS = {
    OBJECTID: 1, objectid: 1, GlobalID: 1, globalid: 1, Shape: 1,
    CreationDate: 1, Creator: 1, EditDate: 1, Editor: 1,
    Shape__Area: 1, Shape__Length: 1
  };

  // A field whose value is an http(s) URL is rendered as a link, not as escaped
  // text. Without this a *_url field is dead text you cannot open on a phone.
  function attrCell(val) {
    var s = String(val);
    if (/^https?:\/\/\S+$/.test(s)) {
      return '<a href="' + escAttr(s) + '" target="_blank" rel="noopener" ' +
             'style="color:var(--accent);word-break:break-all;">' + esc(s) + '</a>';
    }
    return esc(val);
  }

  function buildAttrTable(attrs) {
    var tbl = '<table style="width:100%;font-size:12px;border-collapse:collapse;">';
    for (var k in attrs) {
      if (!attrs.hasOwnProperty(k)) continue;
      if (SKIP_FIELDS[k] || attrs[k] === null || attrs[k] === '' || attrs[k] === undefined) continue;
      tbl += '<tr><td style="padding:3px 6px;color:#999;white-space:nowrap;">' + esc(k.replace(/_/g, ' ')) +
             '</td><td style="padding:3px 6px;">' + attrCell(attrs[k]) + '</td></tr>';
    }
    tbl += '</table>';
    return tbl;
  }

  function getObjectId(attrs) {
    return attrs.OBJECTID != null ? attrs.OBJECTID : attrs.objectid;
  }

  // Popup content function that also loads attachments — anonymously.
  // No ?token= parameter anywhere: the view layer is public.
  function makeAttachmentPopupContent(layerUrl) {
    return function (feature) {
      var div = document.createElement('div');
      var attrs = feature.graphic.attributes;
      var oid = getObjectId(attrs);
      var uid = 'att-' + Math.random().toString(36).slice(2) + '-' + oid;
      div.innerHTML = buildAttrTable(attrs) +
        '<div id="' + uid + '" style="margin-top:8px;color:#999;font-size:11px;">Loading attachments...</div>';

      fetch(layerUrl + '/' + oid + '/attachments?f=json')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var el = document.getElementById(uid);
          if (!el) return;
          if (!data.attachmentInfos || data.attachmentInfos.length === 0) {
            el.textContent = 'No attachments';
            return;
          }
          var html = '';
          data.attachmentInfos.forEach(function (att) {
            var attUrl = layerUrl + '/' + oid + '/attachments/' + att.id;
            var ct = (att.contentType || '').toLowerCase();
            var name = att.name || ('attachment-' + att.id);
            if (ct.indexOf('image/') === 0) {
              html += '<img src="' + escAttr(attUrl) + '" style="max-width:100%;border-radius:4px;margin-bottom:6px;display:block;" />';
            } else {
              var label = ct === 'application/pdf' ? 'PDF' : 'FILE';
              // Public view layer — a plain anonymous link works; no proxy needed.
              html += '<a href="' + escAttr(attUrl) + '" target="_blank" rel="noopener" ' +
                'style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:4px;' +
                'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:4px;' +
                'color:var(--accent);text-decoration:none;font-size:12px;">' +
                '<span style="font-weight:700;font-size:10px;padding:2px 5px;background:var(--accent);color:#fff;' +
                'border-radius:3px;min-width:32px;text-align:center;">' + label + '</span>' +
                '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(name) + '</span></a>';
            }
          });
          el.innerHTML = html;
        })
        .catch(function () {
          var el = document.getElementById(uid);
          if (el) el.textContent = 'Could not load attachments';
        });
      return div;
    };
  }

  function makeSimplePopupContent() {
    return function (feature) {
      var div = document.createElement('div');
      div.innerHTML = buildAttrTable(feature.graphic.attributes);
      return div;
    };
  }

  /* ═══════════════════════════════════════════
     PHONE TRIM (ported from the Field App's ortho-trim widget)
     ═══════════════════════════════════════════
     The staff stable map carries ~115 layers, drone KML overlays and orthos.
     Two rules, both learned the hard way on 2026-09-17 when Chrome iOS started
     killing the Field App's renderer:
       - a HIDDEN KML GroundOverlay still downloads its PNG (31 MB on one
         incident map), so on a phone KML is REMOVED as the web map adds it,
         before anything loads — hiding is not enough.
       - LERC tiled imagery ('imagery-tile') is decoded and held as textures;
         it is switched off and scale-gated on phones. Dynamic jpgpng orthos
         ('imagery', the JPEG route) are a picture per view and stay on.
     Desktop is untouched, and nothing is ever written back to AGOL. */
  var PHONE_ORTHO_MIN_SCALE = 5000;

  function isPhone() {
    try {
      return window.matchMedia('(pointer: coarse)').matches &&
        Math.min(window.screen.width, window.screen.height) <= 820;
    } catch (e) { return false; }
  }

  // Purge KML before load: watch the layer collection as the web map fills it.
  function purgeKmlOnPhone(map) {
    if (!isPhone() || !map.allLayers) return;
    function drop(lyr) {
      if (!lyr || lyr.type !== 'kml') return;
      var parent = lyr.parent && lyr.parent.layers ? lyr.parent : map;
      try { parent.layers.remove(lyr); } catch (e) {}
    }
    map.allLayers.forEach(drop);
    map.allLayers.on('change', function (e) { (e.added || []).forEach(drop); });
  }

  function gateOrthosOnPhone(map) {
    if (!isPhone() || !map.allLayers) return 0;
    var n = 0;
    map.allLayers.forEach(function (lyr) {
      if (lyr.type !== 'imagery-tile') return;   // dynamic 'imagery' is phone-safe
      lyr.visible = false;
      lyr.minScale = PHONE_ORTHO_MIN_SCALE;
      n++;
    });
    return n;
  }

  /* ═══════════════════════════════════════════
     MAIN MAP
     ═══════════════════════════════════════════ */
  // Set once the gateway web map has been read: the stable incident map a
  // signed-in staff member gets instead. activate_gateway_map.py stamps it into
  // the gateway map's own JSON (`wriGateway.stableMapId`) on every rebuild, so
  // it follows the active incident with no per-incident push to this app.
  var stableMapId = null;

  /* The sign-in / sign-out control that lives on the map. Deliberately small and
   * out of the way: responders never need it, and the public map is what the
   * QR promises. Only shown once the gateway map has told us there IS a stable
   * map to switch to. */
  function buildStaffSignIn(isStaffView) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;align-items:flex-start;max-width:78vw;';
    var btn = document.createElement('button');
    btn.style.cssText = 'background:var(--panel);border:1px solid var(--border);color:var(--text);' +
      'padding:7px 11px;border-radius:6px;cursor:pointer;font-size:12px;font-family:var(--font);font-weight:600;';
    var note = document.createElement('div');
    note.style.cssText = 'background:var(--panel);border:1px solid var(--border);color:var(--text-muted);' +
      'padding:6px 9px;border-radius:6px;font-size:11px;line-height:1.35;display:none;';

    function paint() {
      var auth = window.ArcgisAuth && ArcgisAuth.get();
      if (isStaffView && auth) {
        btn.textContent = 'WRI staff map · ' + (auth.username || 'signed in') + ' — sign out';
        note.style.display = 'none';
      } else if (!stableMapId) {
        btn.textContent = 'WRI staff sign-in';
        btn.disabled = true;
        btn.title = 'No stable incident map is published for this incident yet.';
      } else {
        btn.textContent = 'WRI staff sign-in';
      }
    }

    function say(msg, bad) {
      note.textContent = msg;
      note.style.color = bad ? 'var(--danger)' : 'var(--text-muted)';
      note.style.display = msg ? 'block' : 'none';
    }

    btn.onclick = function () {
      var auth = window.ArcgisAuth && ArcgisAuth.get();
      if (auth) {
        ArcgisAuth.signOut();
        window.reloadMainMap();
        return;
      }
      say('Opening ArcGIS sign-in…');
      btn.disabled = true;
      ArcgisAuth.signIn().then(function () {
        say('');
        window.reloadMainMap();
      }).catch(function (err) {
        btn.disabled = false;
        say(err.message || 'Sign-in failed.', true);
      });
    };

    paint();
    wrap.appendChild(btn);
    wrap.appendChild(note);
    if (isStaffView) {
      say('Full incident map — everything your ArcGIS account can see. Sign out to return to the public map.');
    }
    return wrap;
  }

  /* Rebuild the Map tab after a sign-in or sign-out. The view owns the map, so
   * it has to be destroyed rather than re-pointed. */
  window.reloadMainMap = function () {
    if (mapView) {
      try { mapView.destroy(); } catch (e) {}
      mapView = null;
    }
    window.initMainMap();
  };

  function loadStableMapId(gatewayId) {
    if (stableMapId || !gatewayId) return Promise.resolve(stableMapId);
    return fetch('https://www.arcgis.com/sharing/rest/content/items/' + gatewayId +
                 '/data?f=json', { credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        stableMapId = (d && d.wriGateway && d.wriGateway.stableMapId) || null;
        return stableMapId;
      })
      .catch(function () { return null; });
  }

  window.initMainMap = function () {
    var inc0 = (window.APP && APP.incident) || {};
    // Which stable map a staff sign-in would switch to. Resolved before the SDK
    // work so the control can paint correctly on the first render; a failure
    // here just means the button says there is no staff map.
    loadStableMapId(inc0.gateway_webmap_id || CONFIG.GATEWAY_WEBMAP_ID || '')
      .then(loadArcGIS).then(function (require) {
      require([
        'esri/Map',
        'esri/views/MapView',
        'esri/layers/FeatureLayer',
        'esri/widgets/Locate',
        'esri/widgets/LayerList',
        'esri/widgets/Search',
        'esri/WebMap',
        'esri/identity/IdentityManager',
        'esri/config'
      ], function (EsriMap, MapView, FeatureLayer, Locate, LayerList, Search, WebMap, esriId, esriConfig) {
        var inc = (window.APP && APP.incident) || {};
        var reconUrl = layerBaseUrl(inc, 'recon');
        var resourceUrl = layerBaseUrl(inc, 'resource');
        // API value wins; fall back to the static config id.
        var webmapId = inc.gateway_webmap_id || CONFIG.GATEWAY_WEBMAP_ID || '';

        // OPT-IN staff view: a WRI member who signed in gets the full stable
        // incident map on their OWN token. Everyone else — the default — gets
        // the public gateway map with no token at all.
        var auth = window.ArcgisAuth && ArcgisAuth.get();
        var staffMap = !!(auth && stableMapId);

        // Identity follows sign-in state, and this has to be set BEFORE any layer
        // request goes out. Signed out, the SDK must never consult IdentityManager:
        // a single org-secured layer on the public map otherwise 403s and the SDK
        // answers by popping its OWN sign-in dialog — which is what responders saw
        // on 2026-09-23 (WRI_LPO_ResponseSite 2024 was shared as an item but not as
        // a service). With useIdentity off, such a layer just fails to draw, which
        // is the right outcome for a token-free public app, and the gateway is
        // immune to the next secured layer someone adds rather than only to that
        // one. The staff path turns it back on so registerToken is honoured.
        try { esriConfig.request.useIdentity = !!staffMap; } catch (e) {}

        if (staffMap) {
          // Hand the user's token to the SDK for this portal + its services, so
          // the org-private map and its layers load as that person.
          [ArcgisAuth.PORTAL + '/sharing/rest',
           'https://services6.arcgis.com/Ji79lWGR5B33LhY7/arcgis/rest/services'
          ].forEach(function (server) {
            try { esriId.registerToken({ server: server, token: auth.token, expires: auth.expires }); } catch (e) {}
          });
          webmapId = stableMapId;
        }

        var usingWebMap = !!webmapId;
        var map;

        if (usingWebMap) {
          // Public gateway webmap (anonymous, no token) unless staffMap above.
          map = new WebMap({ portalItem: { id: webmapId } });
          purgeKmlOnPhone(map);          // must be wired BEFORE the map loads
        } else {
          map = new EsriMap({ basemap: 'satellite' });

          var resourceLayer = new FeatureLayer({
            url: resourceUrl,
            title: 'Resources',
            outFields: ['*'],
            popupEnabled: true,
            // Real field name on the resource layer is lowercase incident_id.
            definitionExpression: "incident_id = '" + sqlEscape(inc.incident_id) + "'",
            popupTemplate: {
              title: '{identifier}',
              content: makeSimplePopupContent()
            }
          });

          var reconLayer = new FeatureLayer({
            url: reconUrl,
            title: 'Recon Points',
            outFields: ['*'],
            popupEnabled: true,
            // NOTE: the recon layer has NO incident_id field — filter by
            // project_name (this was a live bug in the legacy gateway).
            definitionExpression: "project_name = '" + sqlEscape(inc.recon_project) + "'",
            popupTemplate: {
              title: '{observation_type}',
              content: makeAttachmentPopupContent(reconUrl)
            }
          });

          map.addMany([resourceLayer, reconLayer]); // recon points render on top
        }

        var viewProps = {
          container: 'mapDiv',
          map: map,
          ui: { components: ['zoom'] }
        };
        if (!usingWebMap) {
          viewProps.center = CONFIG.DEFAULT_CENTER;
          viewProps.zoom = CONFIG.DEFAULT_ZOOM;
        }
        mapView = new MapView(viewProps);

        mapView.when(function () {
          mapView.ui.add(new Locate({ view: mapView }), 'top-right');
          gateOrthosOnPhone(map);
          mapView.ui.add(buildStaffSignIn(staffMap), 'bottom-left');

          // Deferred: constructing Search immediately fetches world-geocoder
          // metadata, competing with the first tile/feature window on slow links.
          setTimeout(function () {
            if (mapView) mapView.ui.add(new Search({ view: mapView, popupEnabled: false }), 'top-right');
          }, 4000);

          // LayerList inside a small toggle panel (ported from legacy UX).
          // Constructed on first open: its per-layer legend queries otherwise
          // also land inside the initial tile/feature window.
          var layerList = null;
          var layerToggle = document.createElement('div');
          layerToggle.style.cssText = 'position:relative;';
          var layerBtn = document.createElement('button');
          layerBtn.innerHTML = '&#9776;';
          layerBtn.title = 'Layers';
          layerBtn.style.cssText = 'background:var(--panel);border:1px solid var(--border);color:var(--text);' +
            'padding:8px 10px;border-radius:4px;cursor:pointer;font-size:16px;';
          var layerPanel = document.createElement('div');
          layerPanel.style.cssText = 'display:none;position:absolute;top:40px;left:0;background:var(--panel);' +
            'border:1px solid var(--border);border-radius:6px;padding:8px;min-width:220px;max-height:300px;' +
            'overflow-y:auto;z-index:100;';
          layerBtn.onclick = function () {
            if (!layerList) {
              layerList = new LayerList({
                view: mapView,
                listItemCreatedFunction: function (event) {
                  event.item.panel = { content: 'legend', open: false };
                },
                container: document.createElement('div')
              });
              layerPanel.appendChild(layerList.container);
            }
            layerPanel.style.display = layerPanel.style.display === 'none' ? 'block' : 'none';
          };
          layerToggle.appendChild(layerBtn);
          layerToggle.appendChild(layerPanel);
          mapView.ui.add(layerToggle, 'top-left');

          // On a webmap, wire attachment-aware popups onto any feature layer
          // that supports attachments (anonymous fetch — no token, no proxy).
          if (usingWebMap && map.allLayers) {
            // Name anything that fails to load. With useIdentity off a secured
            // layer fails silently, which is the right behaviour for responders
            // but leaves no trace for us — this is how the next
            // shared-as-an-item-but-not-as-a-service layer gets noticed.
            map.allLayers.forEach(function (lyr) {
              lyr.when(null, function (err) {
                console.warn('[gateway] layer did not load: ' + (lyr.title || lyr.id) +
                             ' — ' + ((err && err.message) || err));
              });
            });
            map.allLayers.forEach(function (lyr) {
              if (lyr.type !== 'feature') return;
              lyr.when(function () {
                // A layer that arrived with its OWN popup configured in the web
                // map keeps it. This used to overwrite unconditionally, which
                // threw away the 360 pano layer's "Open 360° viewer" link and
                // left pano_url as a dead string in the attribute table. Layers
                // composed by activate_gateway_map.py carry no popupInfo, so
                // they still get the generated table below.
                if (lyr.popupTemplate && lyr.popupTemplate.content) return;
                var lyrUrl = lyr.url + '/' + lyr.layerId;
                var hasAtt = lyr.capabilities && lyr.capabilities.data && lyr.capabilities.data.supportsAttachment;
                lyr.popupTemplate = {
                  title: (lyr.popupTemplate && lyr.popupTemplate.title) || (lyr.title || 'Feature'),
                  content: hasAtt ? makeAttachmentPopupContent(lyrUrl) : makeSimplePopupContent()
                };
              });
            });
          }
        });
      });
    }).catch(function (err) {
      showToast(err.message || 'Map failed to load', true);
    });
  };

  /* ═══════════════════════════════════════════
     ADD-TO-COP PICKER MAP + GPS / TAP PLACEMENT
     ═══════════════════════════════════════════ */
  // Same public gateway webmap as the main Map tab (its own WebMap instance —
  // a Map can only live in one view), so responders place points against the
  // real COP layers. Tap-to-place is ALWAYS on: every tap moves the point, so
  // an observation can be reported anywhere, not just where the reporter is.
  window.initReconMiniMap = function () {
    loadArcGIS().then(function (require) {
      require(['esri/Map', 'esri/views/MapView', 'esri/WebMap'], function (EsriMap, MapView, WebMap) {
        var inc = (window.APP && APP.incident) || {};
        var webmapId = inc.gateway_webmap_id || CONFIG.GATEWAY_WEBMAP_ID || '';
        var viewProps = {
          container: 'reconMiniMap',
          ui: { components: ['zoom'] },
          // Taps place the point — feature popups would swallow them.
          popupEnabled: false
        };
        if (webmapId) {
          viewProps.map = new WebMap({ portalItem: { id: webmapId } });
        } else {
          viewProps.map = new EsriMap({ basemap: 'satellite' });
          viewProps.center = CONFIG.DEFAULT_CENTER;
          viewProps.zoom = 10;
        }
        reconMiniView = new MapView(viewProps);
        window._reconView = reconMiniView; // headless test handle (no token, public map)
        reconMiniView.when(function () {
          window.reconMapReady = true; // signals tap-to-place is armed (tests key on this)
          // If GPS landed before the picker finished loading, draw it now.
          if (window.reconPoint) setReconGraphic(window.reconPoint.lat, window.reconPoint.lon);
          if (mapTapHandler) { mapTapHandler.remove(); }
          mapTapHandler = reconMiniView.on('click', function (event) {
            window.reconPoint = {
              lat: event.mapPoint.latitude,
              lon: event.mapPoint.longitude,
              accuracy: 0
            };
            var statusEl = document.getElementById('reconGpsStatus');
            statusEl.textContent = window.reconPoint.lat.toFixed(5) + ', ' +
              window.reconPoint.lon.toFixed(5) + ' (map placed)';
            statusEl.classList.add('acquired');
            var coordEl = document.getElementById('reconCoordDisplay');
            if (coordEl) coordEl.textContent = 'Tap again to move the point.';
            setReconGraphic(window.reconPoint.lat, window.reconPoint.lon, { noZoom: true });
          });
        });
      });
    }).catch(function (err) {
      var statusEl = document.getElementById('reconGpsStatus');
      if (statusEl) statusEl.textContent = err.message || 'Map failed to load';
    });
  };

  function setReconGraphic(lat, lon, opts) {
    if (!reconMiniView) return;
    loadArcGIS().then(function (require) {
      require(['esri/Graphic'], function (Graphic) {
        reconMiniView.graphics.removeAll();
        reconMiniView.graphics.add(new Graphic({
          geometry: { type: 'point', longitude: lon, latitude: lat },
          symbol: {
            type: 'simple-marker',
            color: [233, 69, 96],
            size: '14px',
            outline: { color: [255, 255, 255], width: 2 }
          }
        }));
        // A map-tapped point must NOT recenter/zoom — the user just chose
        // this view; only GPS placement flies the camera to the point.
        if (!(opts && opts.noZoom)) {
          reconMiniView.goTo({ center: [lon, lat], zoom: 14 }).catch(function () {});
        }
      });
    });
  }

  window.captureReconGPS = function () {
    var statusEl = document.getElementById('reconGpsStatus');
    var coordEl = document.getElementById('reconCoordDisplay');
    statusEl.textContent = 'Acquiring GPS...';
    statusEl.classList.remove('acquired');
    window.reconPoint = null;

    if (!navigator.geolocation) {
      statusEl.textContent = 'Geolocation not supported';
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        window.reconPoint = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
        statusEl.textContent = pos.coords.latitude.toFixed(5) + ', ' + pos.coords.longitude.toFixed(5) +
          ' (+-' + Math.round(pos.coords.accuracy) + 'm)';
        statusEl.classList.add('acquired');
        if (coordEl) coordEl.textContent = '';
        setReconGraphic(window.reconPoint.lat, window.reconPoint.lon);
      },
      function (err) {
        statusEl.textContent = 'GPS error: ' + err.message;
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  window.useDeviceLocation = function () {
    captureReconGPS();
  };
})();
