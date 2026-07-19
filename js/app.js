/* WRI Respond — boot + tab routing.
 * Boot: fetch incident (open GET), then route:
 *   closed incident        -> friendly closed notice
 *   valid same-day session -> revalidate against the API -> main app
 *   stale/dead session     -> clear + sign-in (expired notice)
 *   no session             -> PIN gate (if required) or sign-in
 * No google.script.run, no ArcGIS token anywhere.
 */
(function () {
  'use strict';

  window.APP = {
    incident: null,
    session: null,
    resourceCount: 0,
    currentTab: 'map',
    mapInited: false,
    reconMapInited: false
  };

  /* ═══════════════════════════════════════════
     TAB SWITCHING (lazy inits per tab)
     ═══════════════════════════════════════════ */
  window.switchTab = function (name) {
    APP.currentTab = name;

    var btns = document.querySelectorAll('.tab-bar button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
    var btn = document.getElementById('tabBtn-' + name);
    if (btn) btn.classList.add('active');

    var panes = document.querySelectorAll('.tab-pane');
    for (var j = 0; j < panes.length; j++) panes[j].classList.remove('active');
    var pane = document.getElementById('tab-' + name);
    if (pane) pane.classList.add('active');

    if (name === 'map') {
      if (!APP.mapInited) {
        APP.mapInited = true;
        initMainMap();       // lazy-loads the ArcGIS SDK on first open
      }
    } else if (name === 'recon') {
      if (!APP.reconMapInited) {
        APP.reconMapInited = true;
        initReconMiniMap();
      }
      // Only auto-acquire GPS when no point is set yet, so a map-tapped
      // point survives tab switches (legacy stomped it every time).
      if (!window.reconPoint) captureReconGPS();
    } else if (name === 'sitstat') {
      loadSitStat();
      startSitStatAutoRefresh();
    } else if (name === 'resources') {
      loadMyResources();
      loadAllResources();
    }

    if (name !== 'sitstat') stopSitStatAutoRefresh();
  };

  /* ═══════════════════════════════════════════
     BOOT
     ═══════════════════════════════════════════ */
  function renderIncidentClosed() {
    document.body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;' +
      'padding:24px;text-align:center;font-family:inherit;">' +
      '<div><div style="font-size:48px;margin-bottom:16px;">&#128721;</div>' +
      '<h2 style="margin:0 0 8px;">Incident Closed</h2>' +
      '<p style="opacity:0.8;max-width:420px;">This incident response has ended and check-in is no longer ' +
      'available. If you believe this is an error, contact your WRI point of contact.</p></div></div>';
  }

  function renderBootError(err) {
    hideLoading();
    document.body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;' +
      'padding:24px;text-align:center;font-family:inherit;">' +
      '<div><div style="font-size:48px;margin-bottom:16px;">&#9888;&#65039;</div>' +
      '<h2 style="margin:0 0 8px;">Could Not Load</h2>' +
      '<p style="opacity:0.8;max-width:420px;">' + esc(friendlyError(err)) +
      '</p><button onclick="location.reload()" style="margin-top:16px;padding:12px 24px;background:#cc0000;' +
      'color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;">' +
      'Retry</button></div></div>';
  }

  function showSigninExpired() {
    document.getElementById('signinExpiredMsg').classList.remove('hidden');
    showScreen('signin');
  }

  function showPinGate() {
    showScreen('pin');
    var first = document.getElementById('pin-1');
    if (first) first.focus();
  }

  function route() {
    var stored = Session.get();

    // ── Returning user with a stored session ──
    if (stored && stored.checkin_id) {
      if (!Session.isToday()) {
        Session.clear();
        hideLoading();
        showSigninExpired();
        return;
      }
      // Revalidate with the server before dropping into the main app
      apiGet('session')
        .then(function (result) {
          hideLoading();
          if (!result || !result.valid) {
            Session.clear();
            showSigninExpired();
            return;
          }
          if (result.session) {
            Session.set(Object.assign({}, Session.get() || {}, result.session));
          }
          APP.session = Session.get();
          if (result.incident) {
            APP.incident = result.incident;
            setIncidentName();
          }
          showWelcomeBanner();
          enterMainApp();
        })
        .catch(function (err) {
          hideLoading();
          var code = err && err.code;
          if (code === 'bad_token' || code === 'checked_out' || code === 'auth_required') {
            Session.clear();
            showSigninExpired();
          } else {
            // Transient (network) failure — offer the resume screen so the
            // user can retry without losing their session.
            populateResumeScreen();
            showScreen('resume');
          }
        });
      return;
    }

    // ── New user ──
    hideLoading();
    if (APP.incident && APP.incident.require_pin && !Session.pinOk.get()) {
      showPinGate();
    } else {
      showScreen('signin');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    showLoading('Loading incident...');
    apiGet('incident')
      .then(function (incident) {
        APP.incident = incident || {};
        if (APP.incident.active === false) {
          hideLoading();
          renderIncidentClosed();
          return;
        }
        initSigninScreen(); // roles datalist, incident name, profile prefill
        route();
      })
      .catch(function (err) {
        renderBootError(err);
      });
  });
})();
