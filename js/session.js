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
      get: function () { return localStorage.getItem(PIN_KEY) === 'true'; },
      set: function (v) { v ? localStorage.setItem(PIN_KEY, 'true') : localStorage.removeItem(PIN_KEY); }
    }
  };
})();
