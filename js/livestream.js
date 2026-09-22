/* WRI Respond — Live Stream tab (Nova).
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
  var teardownTimer = null;

  function byId(id) { return document.getElementById(id); }

  function setStatus(msg) {
    var s = byId('liveStatus');
    if (s) s.textContent = msg || '';
  }

  function cancelTeardown() {
    if (teardownTimer) { clearTimeout(teardownTimer); teardownTimer = null; }
  }

  window.mountLive = function () {
    cancelTeardown();
    if (frame) return;
    var host = byId('liveFrameHost');
    var player = byId('livePlayer');
    var launcher = byId('liveLauncher');
    if (!host || !player || !launcher) return;
    // Fresh element per open — reusing one leaves the stream's own history
    // entries behind and the back button stops matching the visible state.
    frame = document.createElement('iframe');
    frame.title = 'Nova live stream';
    frame.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
    frame.setAttribute('allowfullscreen', '');
    frame.referrerPolicy = 'no-referrer-when-downgrade';
    frame.src = CONFIG.NOVA_LIVE_URL;
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
    var watch = byId('liveWatchBtn');
    if (watch) watch.disabled = (navigator.onLine === false);
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
