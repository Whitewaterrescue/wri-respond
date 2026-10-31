/* WRI Respond — floating ICS 214 button (2026-10-31, same as the Field App's).
 *
 * A round "214" button on the main screen, above the tab bar. It opens WRI
 * Field Forms' 214 tab (?embed=214) in a panel. Field Forms lives on the same
 * origin (whitewaterrescue.github.io/wri-recon), so the panel shares its saved
 * name, incident PIN and offline outbox: entries save on the phone first and
 * upload when there's signal. The incident is this device's pick
 * (incidentPin()), the name the check-in session's. The frame stays loaded
 * after the first open, so a save still finishes after the panel is closed.
 *
 * Before loading, the phone's Field Forms service worker is asked to update;
 * after loading, the page must be the 214-only view, else an "old copy" note
 * covers it (an old cached Field Forms opens on the Recon steps).
 */
(function () {
  var FORMS = 'https://whitewaterrescue.github.io/wri-recon/';
  var fab, panel, frame, loadEl, staleEl, retryBtn, src = '', opening = false, okTimer = null;

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function freshenForms() {
    try {
      var sw = navigator.serviceWorker;
      if (!sw || !navigator.onLine) return Promise.resolve();
      return sw.getRegistration(new URL(FORMS).pathname).then(function (reg) {
        if (!reg) return;
        return Promise.race([reg.update(), wait(8000)]).then(function () {
          var next = reg.installing || reg.waiting;
          if (!next) return;
          return Promise.race([new Promise(function (resolve) {
            var done = function () { if (next.state === 'activated' || next.state === 'redundant') resolve(); };
            next.addEventListener('statechange', done); done();
          }), wait(4000)]);
        });
      }).catch(function () {});
    } catch (e) { return Promise.resolve(); }
  }

  function isEmbed214() {
    try {
      var w = frame && frame.contentWindow;
      return !!(w && w.CONFIG && w.CONFIG.QUICK_214 && w.document.body.classList.contains('embed'));
    } catch (e) { return true; }   // not readable (another origin): trust it
  }

  function wantUrl() {
    var inc = (window.incidentPin && window.incidentPin()) || '';
    var s = (window.Session && Session.get()) || {};
    return FORMS + '?embed=214' + (inc ? '&incident=' + encodeURIComponent(inc) : '') +
      (s.name ? '&name=' + encodeURIComponent(s.name) : '') + '#214';
  }

  function show(el, on) { el.classList.toggle('hidden', !on); }

  function openPanel(retry) {
    if (opening) return;
    var want = wantUrl();
    show(panel, true); fab.classList.add('hidden');
    if (want === src && !retry && !panel.classList.contains('stale')) {
      try { frame.contentWindow.postMessage({ type: 'wri-214', action: 'open' }, location.origin); } catch (e) {}
      return;
    }
    opening = true; panel.classList.remove('stale');
    show(loadEl, true); show(staleEl, false);
    retryBtn.disabled = true; retryBtn.textContent = 'Updating…';
    freshenForms().then(function () {
      opening = false; retryBtn.disabled = false; retryBtn.textContent = 'Retry';
      if (want === src) { try { frame.contentWindow.location.reload(); return; } catch (e) {} }
      src = want; frame.src = want;
    });
  }

  function closePanel() { show(panel, false); fab.classList.remove('hidden'); }

  function build() {
    var main = document.getElementById('screen-main');
    if (!main) return;
    fab = document.createElement('button');
    fab.type = 'button'; fab.className = 'wri-214-fab'; fab.textContent = '214';
    fab.title = 'ICS 214 activity log'; fab.setAttribute('aria-label', 'Open the ICS 214 activity log');
    fab.addEventListener('click', function () { openPanel(false); });
    main.appendChild(fab);   // inside the main screen: hidden with it on sign-in / PIN screens

    panel = document.createElement('div');
    panel.className = 'wri-214-panel hidden'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'ICS 214 activity log');
    panel.innerHTML =
      '<div class="wri-214-bar"><b>ICS 214 Log</b><button type="button" class="wri-214-x">Close &#x2715;</button></div>' +
      '<div class="wri-214-body"><iframe title="ICS 214 log"></iframe>' +
      '<div class="wri-214-load"><span class="wri-214-spin"></span>Opening the 214 log&hellip;</div>' +
      '<div class="wri-214-load wri-214-stale hidden"><div>The 214 log saved on this phone is an old copy, so it can&rsquo;t open here yet.</div>' +
      '<div>Get signal, then tap Retry.</div><button type="button" class="wri-214-x">Retry</button></div></div>';
    document.body.appendChild(panel);
    frame = panel.querySelector('iframe');
    loadEl = panel.querySelector('.wri-214-load');
    staleEl = panel.querySelector('.wri-214-stale');
    retryBtn = staleEl.querySelector('button');
    panel.querySelector('.wri-214-bar .wri-214-x').addEventListener('click', closePanel);
    retryBtn.addEventListener('click', function () { openPanel(true); });
    frame.addEventListener('load', function () {
      if (!src) return;
      show(loadEl, false);
      var ok = isEmbed214();
      panel.classList.toggle('stale', !ok); show(staleEl, !ok);
    });

    // "saved" from the panel: flash the button green (useful once it's closed)
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (e.origin !== location.origin || !d || d.type !== 'wri-214' || d.action !== 'saved') return;
      fab.classList.add('ok'); fab.textContent = '✓';
      clearTimeout(okTimer);
      okTimer = setTimeout(function () { fab.classList.remove('ok'); fab.textContent = '214'; }, 3000);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
