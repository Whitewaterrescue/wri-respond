/* WRI Respond — ICS 201 tab.
 *
 * Embeds the Ops Dashboard's ICS 201 v2 generator (?page=v2-ics201) so a
 * checked-in responder can read and work the incident briefing without leaving
 * the gateway.
 *
 * MOUNT ONCE, NEVER TEAR DOWN — deliberately the opposite of the Live Stream
 * tab. That one destroys its frame 3s after you leave because Nova runs WebGL
 * and video forever. The 201 is a FORM: unloading it would throw away whatever
 * the user has typed and not yet saved. So it mounts the first time the tab is
 * opened (not at boot — the page is ~460KB inline plus six sheet round-trips)
 * and then stays for the life of the session.
 *
 * No `sandbox` attribute on purpose: the 201 needs window.open for print, Doc
 * export, mobile PDF delivery and the AGOL OAuth popup. A plain iframe permits
 * those; a sandboxed one would need allow-popups added back to get to the same
 * place. `allow` covers navigator.share, which its mobile PDF handoff uses.
 */
(function () {
  'use strict';

  var frame = null;

  window.initIcs201Tab = function () {
    if (frame) return;                       // already mounted — leave it alone
    var host = document.getElementById('ics201FrameHost');
    var note = document.getElementById('ics201Note');
    if (!host) return;
    if (!CONFIG.ICS201_URL) {
      if (note) note.textContent = 'The ICS 201 is not configured for this incident.';
      return;
    }
    if (navigator.onLine === false) {
      if (note) {
        note.textContent = 'You are offline — the ICS 201 needs a connection. It will load when signal returns.';
        note.style.display = '';
      }
      return;
    }
    if (note) note.style.display = 'none';
    frame = document.createElement('iframe');
    frame.title = 'ICS 201 Incident Briefing';
    frame.setAttribute('allow', 'web-share; clipboard-write');
    frame.src = CONFIG.ICS201_URL;
    host.appendChild(frame);
  };

  /* ── AGOL token bridge ───────────────────────────────────────────────
   * The 201's Live Map (V2LiveMap.html) asks window.top for an existing AGOL
   * session before it falls back to its own popup sign-in, and it only accepts
   * a reply from https://whitewaterrescue.github.io — which is exactly where
   * this app lives. So if the user signed in with ArcGIS on the Map tab, the
   * embedded 201 gets the incident webmap with no second sign-in.
   *
   * Staying SILENT is the designed fallback: no reply within 1.5s and the 201
   * loads the public gateway map instead. That is what a responder who never
   * signed in should get, so there is nothing to handle for that case.
   *
   * The request arrives from the GAS sandbox frame, which is *.googleusercontent
   * .com — same origin check the Field App's bridge uses. The token itself stays
   * memory-only here exactly as arcgis-auth.js holds it; nothing is persisted.
   */
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'wri-agol-token-request' || !e.source) return;
    var ok = false;
    try { ok = /\.googleusercontent\.com$/.test(new URL(e.origin).hostname); } catch (err) { ok = false; }
    if (!ok) return;
    var auth = window.ArcgisAuth && ArcgisAuth.get();
    if (!auth || !auth.token) return;        // silence => the 201 uses the public map
    try {
      e.source.postMessage({
        type: 'wri-agol-token',
        token: auth.token,
        username: auth.username || '',
        expiresAt: auth.expires || (Date.now() + 20 * 60 * 1000)
      }, e.origin);
    } catch (err) {}
  });
})();
