/* WRI Respond — optional ArcGIS sign-in for WRI staff.
 *
 * The app stays token-free for responders: the Map tab renders the public
 * gateway web map with no token, and that is the default for everyone. This
 * module adds an OPT-IN path so a WRI staff member on the same link can sign in
 * as THEMSELVES and get the full stable incident map instead.
 *
 * Why this is not the 2026-07 security bug all over again: the defect there was
 * the SERVER handing an org-privileged token to every anonymous responder and
 * parking it in localStorage. Here nothing is issued by us. The user completes
 * their own AGOL OAuth, the token is theirs, it never touches storage (memory
 * only, so closing the tab ends it), and AGOL — not this app — decides what
 * that account may read.
 *
 * Flow: popup → /sharing/rest/oauth2/authorize (implicit) → oauth-callback-201
 * .html (already on this origin, already a registered redirect URI for the
 * Field App's OAuth app) → postMessage back here. The callback posts with
 * targetOrigin '*' because its usual opener is an unpredictable GAS sandbox;
 * our opener is this very origin, so we check event.origin strictly.
 *
 * The service worker never sees any of it: every ArcGIS request is
 * cross-origin, and sw.js returns early for those, so no token-bearing
 * response can land in Cache Storage.
 */
(function () {
  'use strict';

  var PORTAL = 'https://wrienviro.maps.arcgis.com';
  var ORG_ID = 'Ji79lWGR5B33LhY7';
  var CLIENT_ID = 'zXmBr5FFTyHWfh24';        // the Field App's OAuth app; this callback is registered on it
  var CALLBACK = location.origin + location.pathname.replace(/[^/]*$/, '') + 'oauth-callback-201.html';
  var EXPIRATION_MIN = 120;

  var session = null;      // {token, username, expires} — memory only, never stored
  var listeners = [];
  var pending = null;      // {resolve, reject, win, timer}

  function emit() {
    listeners.forEach(function (fn) { try { fn(session); } catch (e) {} });
  }

  function clearPending(err) {
    if (!pending) return;
    clearInterval(pending.timer);
    var p = pending;
    pending = null;
    if (err) p.reject(err); else p.resolve(session);
  }

  function getJson(url) {
    return fetch(url, { credentials: 'omit' }).then(function (r) { return r.json(); });
  }

  window.ArcgisAuth = {
    PORTAL: PORTAL,

    get: function () {
      if (session && session.expires && session.expires <= Date.now()) {
        session = null;
        emit();
      }
      return session;
    },

    onChange: function (fn) { listeners.push(fn); },

    signOut: function () {
      session = null;
      emit();
    },

    /* Opens the AGOL sign-in popup. Resolves with the session, or rejects with a
     * message fit to show the user. Must be called from a click handler — a
     * popup opened outside one is blocked. */
    signIn: function () {
      if (pending) return Promise.reject(new Error('Sign-in already in progress'));
      var url = PORTAL + '/sharing/rest/oauth2/authorize'
        + '?client_id=' + encodeURIComponent(CLIENT_ID)
        + '&response_type=token'
        + '&expiration=' + EXPIRATION_MIN
        + '&redirect_uri=' + encodeURIComponent(CALLBACK);
      var win = window.open(url, 'wri_arcgis_signin', 'width=520,height=640');
      if (!win) return Promise.reject(new Error('Your browser blocked the sign-in window. Allow pop-ups for this site and try again.'));

      return new Promise(function (resolve, reject) {
        pending = { resolve: resolve, reject: reject, win: win, timer: null };
        // The popup can be closed by hand, which fires no message at all.
        pending.timer = setInterval(function () {
          if (pending && pending.win && pending.win.closed) {
            clearPending(new Error('Sign-in was cancelled.'));
          }
        }, 700);
      });
    }
  };

  window.addEventListener('message', function (e) {
    // Same origin as us: the callback page lives in this app.
    if (e.origin !== location.origin) return;
    var d = e.data;
    if (!d || d.type !== 'arcgis-auth' || !pending) return;
    if (d.error || !d.token) {
      clearPending(new Error(d.error || 'ArcGIS did not return a sign-in token.'));
      return;
    }
    // Org check. AGOL already enforces what the account can read, but a member
    // of some other organisation would otherwise get a map of failing layers
    // and no idea why.
    getJson(PORTAL + '/sharing/rest/portals/self?f=json&token=' + encodeURIComponent(d.token))
      .then(function (self_) {
        if (!self_ || self_.error) throw new Error('Could not verify the account with ArcGIS.');
        if (self_.id !== ORG_ID) {
          throw new Error('That account is not in the WRI organisation, so it cannot open the incident map.');
        }
        session = {
          token: d.token,
          username: d.username || (self_.user && self_.user.username) || '',
          expires: Date.now() + (Number(d.expires_in) || EXPIRATION_MIN * 60) * 1000
        };
        emit();
        clearPending(null);
      })
      .catch(function (err) {
        session = null;
        clearPending(err);
      });
  });
})();
