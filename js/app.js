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

    // Pending (queued offline) check-in: session-gated tabs can't work until
    // the check-in delivers — show a clear notice instead of auth errors.
    var isPending = window.Session && Session.isPending && Session.isPending();
    function pendingNotice(elId) {
      var el = document.getElementById(elId);
      if (el) el.innerHTML = '<div class="empty-state"><div class="empty-icon">&#9203;</div>' +
        '<p>Available once your saved check-in has sent.</p></div>';
    }

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
      if (isPending) {
        pendingNotice('sitstatContent');
        var refreshEl = document.getElementById('sitstatLastRefresh');
        if (refreshEl) refreshEl.textContent = 'Waiting for check-in to send';
      } else {
        loadSitStat();
        startSitStatAutoRefresh();
      }
    } else if (name === 'resources') {
      if (isPending) {
        pendingNotice('myResourcesList');
        pendingNotice('allResourcesList');
      } else {
        loadMyResources();
        loadAllResources();
      }
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

    // ── Pending offline check-in (queued, not yet delivered) ──
    if (stored && stored.pending) {
      hideLoading();
      if (!Session.isToday()) {
        // Yesterday's queued check-in still delivers from the outbox (its
        // record is untouched), but today needs a fresh check-in.
        Session.clear();
        showSigninExpired();
        return;
      }
      APP.session = stored;
      enterMainApp();
      if (window.updateOutboxBanner) updateOutboxBanner();
      return;
    }

    // ── Returning user with a stored session ──
    if (stored && stored.checkin_id) {
      if (!Session.isToday()) {
        Session.clear();
        hideLoading();
        showSigninExpired();
        return;
      }
      // Revalidate with the server before dropping into the main app.
      // Prefer the pre-fired boot-time call (overlaps the incident fetch);
      // fall back to a fresh call if none was fired.
      var sessionCall = earlySession || apiGet('session');
      earlySession = null;
      sessionCall
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

  var INC_SNAP_KEY = 'wri_incident_snapshot';

  // Pre-fired session revalidation (see DOMContentLoaded): lets the session
  // GAS leg overlap the incident GAS leg instead of running after it.
  var earlySession = null;

  function bootWithIncident(incident, offlineAsOf) {
    APP.incident = incident || {};
    if (APP.incident.active === false) {
      hideLoading();
      renderIncidentClosed();
      return;
    }
    APP.offline = !!offlineAsOf;
    initSigninScreen(); // roles datalist, incident name, profile prefill
    // Warm the ArcGIS SDK while the user is on the PIN/sign-in screens — the
    // map is the default tab, so these bytes are needed within a minute.
    // Skipped on offline boots (nothing to download).
    if (!offlineAsOf && window.warmArcGIS) setTimeout(window.warmArcGIS, 0);
    if (offlineAsOf) {
      setTimeout(function () {
        showToast('Offline — incident info as of ' + formatTime(offlineAsOf) + '.', true);
      }, 400);
    }
    // Fold any drained outbox results into the session BEFORE routing, so a
    // check-in delivered by Background Sync while the app was closed signs
    // the user straight in.
    if (window.Outbox) {
      Outbox.reconcile().then(route, route);
    } else {
      route();
    }
  }

  function onOutboxChanged() {
    if (!window.Outbox) return;
    Outbox.reconcile().then(function () {
      if (window.updateOutboxBanner) updateOutboxBanner();
      Outbox.pending().then(function (p) {
        var needsPin = p.failed.some(function (r) { return r.needs_pin; });
        if (needsPin && window.showDrainPinPrompt) showDrainPinPrompt();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    showLoading('Loading incident...');

    // Outbox event wiring: page-side drains emit a DOM event; SW-side
    // (Background Sync) drains postMessage through the SW registration.
    document.addEventListener('outbox:changed', onOutboxChanged);
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'outbox:changed') onOutboxChanged();
      });
    }

    // Pre-fire the session revalidation for a returning same-day user so it
    // overlaps the incident fetch below — route() consumes this promise
    // instead of issuing a second, serialized GAS round trip. Safe to fire
    // before Outbox.reconcile(): the guard (real checkin_id, not pending,
    // same-day) means reconcile can't change the credentials it was sent with.
    var s0 = window.Session && Session.get();
    if (s0 && s0.checkin_id && !s0.pending && Session.isToday()) {
      earlySession = apiGet('session');
      earlySession.catch(function () {}); // consumed in route(); silence unhandled-rejection noise
    }

    // Stale-while-revalidate: a recent incident snapshot boots the app
    // immediately (no waiting out a GAS cold start); the live fetch below
    // then corrects name/webmap/closed-state in the background. A snapshot
    // that says "closed" never fast-boots — that verdict must come live.
    var booted = false;
    function bootOnce(incident, offlineAsOf) {
      if (booted) return;
      booted = true;
      bootWithIncident(incident, offlineAsOf);
    }
    var snap = null;
    try { snap = JSON.parse(localStorage.getItem(INC_SNAP_KEY)); } catch (e) {}
    var snapAgeMs = (snap && snap.fetched_at) ? (Date.now() - new Date(snap.fetched_at).getTime()) : Infinity;
    if (snap && snap.incident && snap.incident.active !== false && snapAgeMs < 12 * 3600 * 1000) {
      bootOnce(snap.incident, null);
    }

    apiGet('incident')
      .then(function (incident) {
        try {
          localStorage.setItem(INC_SNAP_KEY, JSON.stringify({
            incident: incident, fetched_at: new Date().toISOString()
          }));
        } catch (e) {}
        if (!booted) { bootOnce(incident, null); return; }
        // Background refresh after a snapshot boot: swap in the live incident
        // without re-running the full boot (which would stomp a form the user
        // is already typing into).
        APP.incident = incident || {};
        if (APP.incident.active === false) { renderIncidentClosed(); return; }
        if (window.setIncidentName) setIncidentName();
      })
      .catch(function (err) {
        if (booted) {
          // Snapshot boot is already on screen; the refresh just failed.
          if (err && err.transient) {
            APP.offline = true;
            showToast('Offline — incident info as of ' + formatTime(snap.fetched_at || 'unknown') + '.', true);
          }
          return;
        }
        // Transient failure (offline) + a snapshot from a previous visit:
        // boot against last-known incident info instead of a dead end. The
        // precached shell got us this far; the snapshot gets us to sign-in.
        if (err && err.transient && snap && snap.incident) {
          bootOnce(snap.incident, snap.fetched_at || 'unknown');
          return;
        }
        renderBootError(err);
      });

    // Drain anything left over from a previous visit (iOS delivery path:
    // drain at every app start — there is no Background Sync there).
    if (window.Outbox) {
      setTimeout(function () { Outbox.drain({ source: 'boot' }); }, 1500);
    }
  });
})();
