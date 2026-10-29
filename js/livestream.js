/* WRI Respond — Live Stream tab: Nova, and the WRI drones (drone.whitewaterrescue.com/live,
 * watch only: the drone page asks for the incident's Gateway PIN and never shows crew controls
 * here; we hand it the incident this device is on by postMessage).
 *
 * Same Nova workspace the Field App's Live Stream page (page_13) and the three
 * ICP viewers carry. Nova serves `Content-Security-Policy: frame-ancestors *`
 * and renders anonymously (verified 2026-09-17), so framing it from Pages works
 * with no sign-in and no token — which is the whole point on this app.
 *
 * The stream mounts ONLY on tap and unloads ~3 s after you leave the tab. That
 * is load-bearing, not tidiness: Nova runs its own WebGL map *and* video, and
 * the Map tab runs an ArcGIS WebGL view that stays alive once opened. Both
 * mounted at once is the phone-memory failure the Field App panel was written
 * around. Unlike that panel this needs no frameElement rect polling — the SPA
 * owns its tab state, so switchTab() tells us directly when we've been left.
 */
(function () {
  'use strict';

  var TEARDOWN_MS = (window.CONFIG && CONFIG.LIVE_TEARDOWN_MS) || 3000;
  var frame = null;
  var kind = 'nova';   // which feed the player shows: 'nova' | 'drones'
  var teardownTimer = null;

  function byId(id) { return document.getElementById(id); }

  function setStatus(msg) {
    var s = byId('liveStatus');
    if (s) s.textContent = msg || '';
  }

  function cancelTeardown() {
    if (teardownTimer) { clearTimeout(teardownTimer); teardownTimer = null; }
  }

  window.mountLive = function (which) {
    cancelTeardown();
    if (frame) return;
    kind = which === 'drones' ? 'drones' : 'nova';
    var host = byId('liveFrameHost');
    var player = byId('livePlayer');
    var launcher = byId('liveLauncher');
    if (!host || !player || !launcher) return;
    // Fresh element per open — reusing one leaves the stream's own history
    // entries behind and the back button stops matching the visible state.
    frame = document.createElement('iframe');
    frame.title = kind === 'drones' ? 'WRI drone video' : 'Nova live stream';
    frame.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
    frame.setAttribute('allowfullscreen', '');
    frame.referrerPolicy = 'no-referrer-when-downgrade';
    frame.src = kind === 'drones' ? CONFIG.DRONE_LIVE_URL : CONFIG.NOVA_LIVE_URL;
    var title = byId('liveBarTitle'), open2 = byId('liveOpenBtn2');
    if (title) title.textContent = kind === 'drones' ? 'WRI drones' : 'Nova Live Stream';
    if (open2) open2.style.display = kind === 'drones' ? 'none' : '';
    host.appendChild(frame);
    player.classList.add('on');
    launcher.style.display = 'none';
    setStatus('');
  };

  window.unmountLive = function (msg) {
    cancelTeardown();
    if (frame) {
      try { frame.src = 'about:blank'; } catch (e) {}
      frame.remove();
      frame = null;
    }
    var player = byId('livePlayer');
    var launcher = byId('liveLauncher');
    if (player) player.classList.remove('on');
    if (launcher) launcher.style.display = '';
    setStatus(msg || '');
  };

  /* Leaving the tab, or backgrounding the app, unloads the stream after a short
   * grace so a quick hop to the Map and straight back doesn't kill playback. */
  window.scheduleLiveTeardown = function () {
    if (!frame || teardownTimer) return;
    teardownTimer = setTimeout(function () {
      teardownTimer = null;
      window.unmountLive('Stream stopped when you left this tab. Tap Watch here to resume.');
    }, TEARDOWN_MS);
  };

  /* Called by switchTab on every open of the Live tab. Never mounts the frame —
   * Nova loads on tap only. */
  window.initLiveTab = function () {
    cancelTeardown();
    var off = byId('liveOffline');
    if (off) off.style.display = (navigator.onLine === false) ? '' : 'none';
    ['liveWatchBtn', 'droneWatchBtn'].forEach(function (id) {
      var b = byId(id);
      if (b) b.disabled = (navigator.onLine === false);
    });
  };

  /* The Nova URL lives in config.js only — the two "Open" anchors get it here
   * rather than being hardcoded a third and fourth time in the markup. */
  function wireOpenLinks() {
    var url = (window.CONFIG && CONFIG.NOVA_LIVE_URL) || '';
    ['liveOpenBtn', 'liveOpenBtn2'].forEach(function (id) {
      var a = byId(id);
      if (a && url) a.href = url;
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireOpenLinks);
  } else {
    wireOpenLinks();
  }

  // the drone page is ready: tell it which incident this device is on (id, project name, or '' = primary)
  window.addEventListener('message', function (e) {
    if (!frame || kind !== 'drones' || e.origin !== CONFIG.DRONE_LIVE_ORIGIN || !e.data || e.data.type !== 'wri-live-ready') return;
    var inc = '';
    try { inc = window.incidentPin ? window.incidentPin() : ''; } catch (x) {}
    frame.contentWindow.postMessage({ type: 'wri-live-auth', incident: String(inc || '') }, CONFIG.DRONE_LIVE_ORIGIN);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') window.scheduleLiveTeardown();
    else if (window.APP && APP.currentTab === 'live') cancelTeardown();
  });
  window.addEventListener('pagehide', function () { window.unmountLive(''); });

  function onNetChange() {
    if (window.APP && APP.currentTab === 'live') window.initLiveTab();
  }
  window.addEventListener('online', onNetChange);
  window.addEventListener('offline', onNetChange);
})();
