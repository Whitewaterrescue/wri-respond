/* WRI Respond — GAS JSON API transport.
 *
 * GET reads:  apiGet(mode, params)   -> resolves to `data` or rejects with {code,message}
 * POST writes: apiPost(action, payload) -> same
 *
 * Transport notes (must match Api.gs):
 *  - POST uses Content-Type text/plain to stay a CORS "simple request" (no
 *    preflight; GAS web apps don't answer OPTIONS). GAS 302-redirects to
 *    googleusercontent, which the browser follows and returns JSON with
 *    Access-Control-Allow-Origin:*.
 *  - Every response is HTTP 200; success/failure lives in the {ok,...} body.
 *  - No ArcGIS token is ever requested or received here.
 */
(function () {
  function unwrap(json) {
    if (json && json.ok) return json.data;
    var err = (json && json.error) || { code: 'bad_response', message: 'Unexpected response' };
    var e = new Error(err.message || err.code);
    e.code = err.code;
    throw e;
  }

  window.apiGet = function (mode, params) {
    var q = Object.assign({ api: mode }, params || {});
    // attach session creds when present (harmless on open modes)
    var s = window.Session && Session.get();
    if (s && s.checkin_id) { q.cid = s.checkin_id; q.tok = s.session_token; }
    var url = CONFIG.API_URL + '?' + Object.keys(q)
      .filter(function (k) { return q[k] != null && q[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); })
      .join('&');
    return fetch(url, { method: 'GET', redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(unwrap);
  };

  window.apiPost = function (action, payload) {
    var s = window.Session && Session.get();
    var env = { action: action, payload: payload || {} };
    if (s && s.checkin_id) { env.checkin_id = s.checkin_id; env.session_token = s.session_token; }
    return fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(env),
      redirect: 'follow'
    })
      .then(function (r) { return r.json(); })
      .then(unwrap);
  };

  // Small helper for the PIN-gated public reads (users/usercerts)
  window.apiGetWithPin = function (mode, pin, params) {
    return apiGet(mode, Object.assign({ pin: pin }, params || {}));
  };
})();
