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

  function buildAttrTable(attrs) {
    var tbl = '<table style="width:100%;font-size:12px;border-collapse:collapse;">';
    for (var k in attrs) {
      if (!attrs.hasOwnProperty(k)) continue;
      if (SKIP_FIELDS[k] || attrs[k] === null || attrs[k] === '' || attrs[k] === undefined) continue;
      tbl += '<tr><td style="padding:3px 6px;color:#999;white-space:nowrap;">' + esc(k.replace(/_/g, ' ')) +
             '</td><td style="padding:3px 6px;">' + esc(attrs[k]) + '</td></tr>';
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
     MAIN MAP
     ═══════════════════════════════════════════ */
  window.initMainMap = function () {
    loadArcGIS().then(function (require) {
      require([
        'esri/Map',
        'esri/views/MapView',
        'esri/layers/FeatureLayer',
        'esri/widgets/Locate',
        'esri/widgets/LayerList',
        'esri/widgets/Search',
        'esri/WebMap'
      ], function (EsriMap, MapView, FeatureLayer, Locate, LayerList, Search, WebMap) {
        var inc = (window.APP && APP.incident) || {};
        var reconUrl = layerBaseUrl(inc, 'recon');
        var resourceUrl = layerBaseUrl(inc, 'resource');
        var usingWebMap = !!inc.gateway_webmap_id;
        var map;

        if (usingWebMap) {
          // Public webmap, loaded anonymously — no portal token.
          map = new WebMap({ portalItem: { id: inc.gateway_webmap_id } });
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
          mapView.ui.add(new Search({ view: mapView, popupEnabled: false }), 'top-right');

          // LayerList inside a small toggle panel (ported from legacy UX)
          var layerList = new LayerList({
            view: mapView,
            listItemCreatedFunction: function (event) {
              event.item.panel = { content: 'legend', open: false };
            },
            container: document.createElement('div')
          });
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
          layerPanel.appendChild(layerList.container);
          layerBtn.onclick = function () {
            layerPanel.style.display = layerPanel.style.display === 'none' ? 'block' : 'none';
          };
          layerToggle.appendChild(layerBtn);
          layerToggle.appendChild(layerPanel);
          mapView.ui.add(layerToggle, 'top-left');

          // On a webmap, wire attachment-aware popups onto any feature layer
          // that supports attachments (anonymous fetch — no token, no proxy).
          if (usingWebMap && map.allLayers) {
            map.allLayers.forEach(function (lyr) {
              if (lyr.type !== 'feature') return;
              lyr.when(function () {
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
     RECON MINI-MAP + GPS / TAP PLACEMENT
     ═══════════════════════════════════════════ */
  window.initReconMiniMap = function () {
    loadArcGIS().then(function (require) {
      require(['esri/Map', 'esri/views/MapView'], function (EsriMap, MapView) {
        var miniMap = new EsriMap({ basemap: 'satellite' });
        reconMiniView = new MapView({
          container: 'reconMiniMap',
          map: miniMap,
          center: CONFIG.DEFAULT_CENTER,
          zoom: 10,
          ui: { components: [] }
        });
        // If GPS landed before the mini-map finished loading, draw it now.
        reconMiniView.when(function () {
          if (window.reconPoint) setReconGraphic(window.reconPoint.lat, window.reconPoint.lon);
        });
      });
    }).catch(function (err) {
      var statusEl = document.getElementById('reconGpsStatus');
      if (statusEl) statusEl.textContent = err.message || 'Map failed to load';
    });
  };

  function setReconGraphic(lat, lon) {
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
        reconMiniView.goTo({ center: [lon, lat], zoom: 14 }).catch(function () {});
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

  window.enableMapTap = function () {
    if (!reconMiniView) { showToast('Map not ready yet', true); return; }
    var statusEl = document.getElementById('reconGpsStatus');
    var coordEl = document.getElementById('reconCoordDisplay');
    statusEl.textContent = 'Tap map to set location';
    statusEl.classList.remove('acquired');
    coordEl.textContent = 'Pan and zoom, then tap to place point';

    reconMiniView.constraints = { snapToZoom: false };

    if (mapTapHandler) { mapTapHandler.remove(); mapTapHandler = null; }
    mapTapHandler = reconMiniView.on('click', function (event) {
      mapTapHandler.remove();
      mapTapHandler = null;
      window.reconPoint = {
        lat: event.mapPoint.latitude,
        lon: event.mapPoint.longitude,
        accuracy: 0
      };
      statusEl.textContent = window.reconPoint.lat.toFixed(5) + ', ' + window.reconPoint.lon.toFixed(5) + ' (map placed)';
      statusEl.classList.add('acquired');
      coordEl.textContent = '';
      setReconGraphic(window.reconPoint.lat, window.reconPoint.lon);
    });
  };
})();
