/* WRI Respond — client session state (localStorage).
 * Stores the server-issued session_token (NOT any ArcGIS token — there is none).
 */
(function () {
  var KEY = 'wri_respond_session';
  var PROFILE_KEY = 'wri_user_profile';   // prefill for the sign-in form
  var PIN_KEY = 'wri_respond_pin_ok';

  window.Session = {
    get: function () {
      try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
    },
    set: function (s) {
      s.session_date = new Date().toISOString().slice(0, 10); // day-scoped, like legacy
      localStorage.setItem(KEY, JSON.stringify(s));
    },
    clear: function () { localStorage.removeItem(KEY); },

    // Offline check-in placeholder: the real checkin_id/session_token don't
    // exist until the queued record drains. Outbox.reconcile() replaces this
    // with the server result (Session.set) once delivered. `outbox_id` links
    // the placeholder to its outbox record.
    setPending: function (p) {
      p.pending = true;
      p.session_date = new Date().toISOString().slice(0, 10);
      localStorage.setItem(KEY, JSON.stringify(p));
    },
    isPending: function () {
      var s = this.get();
      return !!(s && s.pending);
    },

    // day-scoped validity: a session from a previous day is stale
    isToday: function () {
      var s = this.get();
      return !!(s && s.session_date === new Date().toISOString().slice(0, 10));
    },

    profile: {
      get: function () { try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; } catch (e) { return {}; } },
      set: function (p) { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }
    },

    pinOk: {
      // G4 2026-11-10: an entered code lets this phone check in for 30 minutes; any later
      // visit without an active check-in asks again (a shared phone's next person got in
      // without it). Stored as the time it was entered; the old 'true' counts as expired.
      get: function () {
        var v = Number(localStorage.getItem(PIN_KEY));
        return isFinite(v) && v > 0 && Date.now() - v < 30 * 60 * 1000;
      },
      set: function (v) { v ? localStorage.setItem(PIN_KEY, String(Date.now())) : localStorage.removeItem(PIN_KEY); }
    }
  };
})();
