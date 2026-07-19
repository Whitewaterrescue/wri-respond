/* WRI Respond — screen flow: PIN gate, sign-in, resume, checkout, thank-you.
 * Shared UI helpers (esc, toasts, loading, screen switching) also live here
 * because this is the first app module loaded after the transport layer.
 * Plain ES5, no modules — everything public hangs off window.
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════
     SHARED HELPERS
     ═══════════════════════════════════════════ */
  window.esc = function (str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  window.escAttr = function (str) {
    return window.esc(str);
  };

  window.formatTime = function (isoStr) {
    if (!isoStr) return '';
    try {
      var d = new Date(isoStr);
      if (isNaN(d.getTime())) return String(isoStr);
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } catch (e) {
      return String(isoStr);
    }
  };

  window.showLoading = function (msg) {
    document.getElementById('loadingText').textContent = msg || 'Loading...';
    document.getElementById('loadingOverlay').style.display = 'flex';
  };

  window.hideLoading = function () {
    document.getElementById('loadingOverlay').style.display = 'none';
  };

  window.showScreen = function (name) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
    var target = document.getElementById('screen-' + name);
    if (target) target.classList.add('active');
  };

  // Lightweight toast (no markup dependency in index.html)
  var toastTimer = null;
  window.showToast = function (msg, isError) {
    var el = document.getElementById('gwToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gwToast';
      el.style.cssText = 'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);' +
        'max-width:88%;padding:10px 16px;border-radius:8px;font-size:14px;z-index:9999;' +
        'box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:opacity 0.3s;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.style.background = isError ? '#7f1d1d' : '#1f2937';
    el.style.color = '#fff';
    el.style.border = '1px solid ' + (isError ? '#ef4444' : '#4b5563');
    el.textContent = msg;
    el.style.opacity = '1';
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.style.display = 'none'; }, 350);
    }, 4000);
  };

  window.friendlyError = function (err) {
    var code = err && err.code;
    var map = {
      pin_invalid: 'Incorrect access code.',
      auth_required: 'Your session has ended. Please sign in again.',
      bad_token: 'Your session has ended. Please sign in again.',
      checked_out: 'You have been checked out. Please sign in again.',
      rate_limited: 'Too many requests — please wait a moment and try again.',
      validation: (err && err.message) || 'Some information is missing or invalid.',
      server_error: 'Server error — please try again.'
    };
    return map[code] || (err && err.message) || 'Something went wrong. Please try again.';
  };

  // Returns true when the error means the session is dead; clears it and
  // returns the user to sign-in.
  window.handleAuthError = function (err) {
    var code = err && err.code;
    if (code === 'checked_out' || code === 'bad_token' || code === 'auth_required') {
      Session.clear();
      if (window.APP) window.APP.session = null;
      if (window.stopSitStatAutoRefresh) stopSitStatAutoRefresh();
      var expired = document.getElementById('signinExpiredMsg');
      if (expired) expired.classList.remove('hidden');
      showToast(friendlyError(err), true);
      showScreen('signin');
      return true;
    }
    return false;
  };

  window.getTypeBadgeClass = function (type) {
    var t = (type || '').toLowerCase();
    if (t === 'vehicle') return 'vehicle';
    if (t === 'boat' || t === 'vessel') return 'boat';
    if (t === 'personnel') return 'personnel';
    if (t === 'equipment') return 'equipment';
    if (t === 'aircraft') return 'aircraft';
    return 'other';
  };

  window.getReviewStatusBadge = function (status) {
    var s = (status || 'pending').toLowerCase();
    if (s === 'active' || s === 'approved') return '<span class="badge badge-active">Active</span>';
    if (s === 'rejected') return '<span class="badge badge-rejected">Rejected</span>';
    return '<span class="badge badge-pending">Pending</span>';
  };

  /* ═══════════════════════════════════════════
     PIN GATE
     ═══════════════════════════════════════════ */
  var PIN_STORE_KEY = 'wri_respond_pin';
  // Keep the verified PIN around: the checkin POST payload requires it, and
  // Session.pinOk only remembers *that* a PIN passed, not which one.
  window._gwPin = '';
  try { window._gwPin = localStorage.getItem(PIN_STORE_KEY) || ''; } catch (e) {}

  var pinSubmitting = false;

  window.pinInput = function (el, nextId) {
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    if (el.value.length === 1 && nextId) {
      document.getElementById('pin-' + nextId).focus();
    }
    var full = readPinBoxes();
    if (full.length === 4) submitPin();
  };

  function readPinBoxes() {
    return document.getElementById('pin-1').value +
           document.getElementById('pin-2').value +
           document.getElementById('pin-3').value +
           document.getElementById('pin-4').value;
  }

  function clearPinBoxes() {
    for (var i = 1; i <= 4; i++) document.getElementById('pin-' + i).value = '';
    document.getElementById('pin-1').focus();
  }

  window.submitPin = function () {
    if (pinSubmitting) return;
    var pin = readPinBoxes();
    var errEl = document.getElementById('pin-error');
    if (pin.length !== 4) {
      errEl.textContent = 'Enter all 4 digits.';
      return;
    }
    errEl.textContent = 'Verifying...';
    pinSubmitting = true;
    // Cheap validity probe: the 'users' mode is PIN-gated; a wrong PIN
    // rejects with code pin_invalid, a right one returns (possibly empty) users.
    apiGet('users', { pin: pin, q: 'zz' })
      .then(function () {
        pinSubmitting = false;
        window._gwPin = pin;
        try { localStorage.setItem(PIN_STORE_KEY, pin); } catch (e) {}
        Session.pinOk.set(true);
        errEl.textContent = '';
        showScreen('signin');
      })
      .catch(function (err) {
        pinSubmitting = false;
        if (err && err.code === 'pin_invalid') {
          errEl.textContent = 'Incorrect access code.';
          clearPinBoxes();
        } else {
          errEl.textContent = friendlyError(err);
        }
      });
  };

  /* ═══════════════════════════════════════════
     SIGN-IN SCREEN SETUP
     ═══════════════════════════════════════════ */
  window.populateRoles = function () {
    var datalist = document.getElementById('roleList');
    if (!datalist || datalist.children.length) return;
    (CONFIG.ROLES || []).forEach(function (r) {
      var opt = document.createElement('option');
      opt.value = r;
      datalist.appendChild(opt);
    });
  };

  window.setIncidentName = function () {
    var inc = (window.APP && APP.incident) || {};
    document.getElementById('signinIncidentName').textContent = inc.incident_name || 'Unknown Incident';
    document.getElementById('headerIncident').textContent = inc.incident_name || '';
  };

  window.prefillFromLocalStorage = function () {
    try {
      var profile = Session.profile.get();
      if (!profile) return;
      if (profile.name) document.getElementById('signinName').value = profile.name;
      if (profile.organization) document.getElementById('signinOrg').value = profile.organization;
      if (profile.role) document.getElementById('signinRole').value = profile.role;
      if (profile.phone) document.getElementById('signinPhone').value = profile.phone;
      if (profile.email) document.getElementById('signinEmail').value = profile.email;
      // Programmatic field set doesn't fire blur — trigger cert prefill explicitly.
      if (profile.name && profile.email) gwTryPrefillCerts();
    } catch (e) {}
  };

  function saveUserProfile(data) {
    try {
      Session.profile.set({
        name: data.name || '',
        organization: data.organization || '',
        role: data.role || '',
        phone: data.phone || '',
        email: data.email || ''
      });
    } catch (e) {}
  }

  // Called once from app.js boot after the incident loads.
  window.initSigninScreen = function () {
    populateRoles();
    setIncidentName();
    prefillFromLocalStorage();
  };

  /* ── User autocomplete (User Database via PIN-gated 'users' mode) ── */
  var userSearchTimeout = null;

  function setupUserAutocomplete() {
    var nameInput = document.getElementById('signinName');
    if (!nameInput) return;
    var dropdown = document.createElement('div');
    dropdown.id = 'userAutocomplete';
    dropdown.style.cssText = 'position:absolute;left:0;right:0;top:100%;background:var(--panel);' +
      'border:1px solid var(--border);border-radius:0 0 8px 8px;max-height:200px;overflow-y:auto;' +
      'z-index:100;display:none;';
    nameInput.parentElement.style.position = 'relative';
    nameInput.parentElement.appendChild(dropdown);

    nameInput.addEventListener('input', function () {
      var q = nameInput.value.trim();
      if (q.length < 2) { dropdown.style.display = 'none'; return; }
      clearTimeout(userSearchTimeout);
      userSearchTimeout = setTimeout(function () {
        apiGetWithPin('users', window._gwPin, { q: q })
          .then(function (data) {
            var results = (data && data.users) || [];
            if (!results.length) { dropdown.style.display = 'none'; return; }
            var html = '';
            results.forEach(function (u) {
              html += '<div style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:14px;" ' +
                'onmouseover="this.style.background=\'var(--bg-hover)\'" onmouseout="this.style.background=\'none\'" ' +
                'onclick="selectUser(this)" ' +
                'data-name="' + escAttr(u.name) + '" data-company="' + escAttr(u.company) + '" ' +
                'data-phone="' + escAttr(u.phone) + '" data-email="' + escAttr(u.email) + '">';
              html += '<strong>' + esc(u.name) + '</strong>';
              if (u.company) html += '<span style="color:var(--text-muted);margin-left:8px;">' + esc(u.company) + '</span>';
              html += '</div>';
            });
            dropdown.innerHTML = html;
            dropdown.style.display = 'block';
          })
          .catch(function () { dropdown.style.display = 'none'; });
      }, 300);
    });

    nameInput.addEventListener('blur', function () {
      setTimeout(function () { dropdown.style.display = 'none'; }, 200);
    });
  }

  window.selectUser = function (el) {
    document.getElementById('signinName').value = el.getAttribute('data-name') || '';
    document.getElementById('signinOrg').value = el.getAttribute('data-company') || '';
    document.getElementById('signinPhone').value = el.getAttribute('data-phone') || '';
    document.getElementById('signinEmail').value = el.getAttribute('data-email') || '';
    var dd = document.getElementById('userAutocomplete');
    if (dd) dd.style.display = 'none';
    gwTryPrefillCerts();
  };

  /* ═══════════════════════════════════════════
     CERTIFICATIONS (opt-in)
     ═══════════════════════════════════════════ */
  var GW_ACTIVE_CERTS = [];
  var GW_CERTS_LOADED = false;
  var GW_CERTS_PROMISE = null;
  var GW_LAST_PREFILL_KEY = '';

  function gwLastNameToken(full) {
    var s = String(full || '').trim();
    if (!s) return '';
    var parts = s.split(/\s+/);
    return parts[parts.length - 1].toLowerCase();
  }

  function ensureCertsLoaded() {
    if (GW_CERTS_PROMISE) return GW_CERTS_PROMISE;
    GW_CERTS_PROMISE = apiGet('certs')
      .then(function (data) {
        GW_ACTIVE_CERTS = (data && data.certifications) || [];
        GW_CERTS_LOADED = true;
        gwRenderCertList();
      })
      .catch(function () {
        GW_CERTS_LOADED = true;
        var loading = document.getElementById('gwCertLoading');
        if (loading) loading.textContent = 'Could not load certifications.';
      });
    return GW_CERTS_PROMISE;
  }

  function gwRenderCertList() {
    var wrap = document.getElementById('gwCertList');
    var loading = document.getElementById('gwCertLoading');
    if (!GW_CERTS_LOADED) { loading.style.display = 'block'; wrap.innerHTML = ''; return; }
    loading.style.display = 'none';
    if (!GW_ACTIVE_CERTS.length) {
      wrap.innerHTML = '<div style="font-size:12px;color:#666;font-style:italic">No active certifications configured.</div>';
      return;
    }
    var groups = {};
    GW_ACTIVE_CERTS.forEach(function (c) {
      var cat = c.category || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(c);
    });
    var html = '';
    Object.keys(groups).sort().forEach(function (cat) {
      html += '<div style="margin-bottom:10px">';
      html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--color-primary,#1E90FF);letter-spacing:.4px;margin-bottom:6px;padding-bottom:3px;border-bottom:1px solid #ddd">' + esc(cat) + '</div>';
      groups[cat].forEach(function (c) {
        var id = 'gw_cert_' + c.code;
        html += '<div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0">';
        html += '<input type="checkbox" id="' + escAttr(id) + '" data-code="' + escAttr(c.code) + '" style="width:18px;height:18px;flex-shrink:0;margin-top:1px">';
        html += '<label for="' + escAttr(id) + '" style="font-size:13px;line-height:1.35;cursor:pointer;flex:1">' + esc(c.name);
        if (c.description) html += '<span style="display:block;font-size:11px;color:#666;font-weight:400;margin-top:2px">' + esc(c.description) + '</span>';
        html += '</label></div>';
      });
      html += '</div>';
    });
    wrap.innerHTML = html;
  }

  function gwGetCheckedCertCodes() {
    var checked = document.querySelectorAll('#gwCertList input[type="checkbox"]:checked');
    var codes = [];
    for (var i = 0; i < checked.length; i++) codes.push(checked[i].getAttribute('data-code'));
    return codes;
  }

  function gwSetCheckedCertCodes(codes) {
    var set = {};
    codes.forEach(function (c) { set[c] = true; });
    var boxes = document.querySelectorAll('#gwCertList input[type="checkbox"]');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].checked = !!set[boxes[i].getAttribute('data-code')];
    }
  }

  window.gwTryPrefillCerts = function () {
    var email = document.getElementById('signinEmail').value.trim();
    var last = gwLastNameToken(document.getElementById('signinName').value);
    if (!email || !last) return;
    var key = email.toLowerCase() + '|' + last;
    if (key === GW_LAST_PREFILL_KEY) return;
    GW_LAST_PREFILL_KEY = key;
    ensureCertsLoaded().then(function () {
      apiGetWithPin('usercerts', window._gwPin, { email: email, last: last })
        .then(function (data) {
          var codes = (data && data.codes) || [];
          if (!codes.length) return;
          var toggle = document.getElementById('gwCertToggle');
          if (!toggle.checked) {
            toggle.checked = true;
            document.getElementById('gwCertSection').style.display = 'block';
          }
          gwSetCheckedCertCodes(codes);
          var msg = document.getElementById('gwCertPrefilledMsg');
          msg.textContent = '✓ Loaded ' + codes.length + ' saved certification' + (codes.length === 1 ? '' : 's') +
            '. Uncheck the toggle above to skip, or adjust below.';
          msg.style.display = 'block';
        })
        .catch(function () { /* silent — prefill is best-effort */ });
    });
  };

  /* ═══════════════════════════════════════════
     SIGN-IN SUBMIT
     ═══════════════════════════════════════════ */
  document.getElementById('signinForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = document.getElementById('signinBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-sm"></span> Checking in...';

    var hasResources = document.getElementById('signinHasResources').checked;
    var payload = {
      pin: window._gwPin,
      name: document.getElementById('signinName').value.trim(),
      organization: document.getElementById('signinOrg').value.trim(),
      role: document.getElementById('signinRole').value,
      phone: document.getElementById('signinPhone').value.trim(),
      email: document.getElementById('signinEmail').value.trim(),
      checkin_location: document.getElementById('signinLocation').value.trim(),
      work_description: document.getElementById('signinWorkDesc').value.trim(),
      safety_briefing: document.getElementById('signinSafetyBriefing').checked,
      certifications: document.getElementById('gwCertToggle').checked ? gwGetCheckedCertCodes() : []
    };

    apiPost('checkin', payload)
      .then(function (result) {
        btn.disabled = false;
        btn.textContent = 'Check In';
        if (!result || !result.checkin_id) {
          showToast('Check-in failed: unexpected server response.', true);
          return;
        }
        Session.set(result);
        if (window.APP) {
          APP.session = Session.get();
          if (result.incident) APP.incident = result.incident;
        }
        saveUserProfile(payload);
        document.getElementById('signinExpiredMsg').classList.add('hidden');
        document.getElementById('headerUser').textContent = result.name || payload.name;

        if (hasResources) {
          openResourceUpload();
        } else {
          enterMainApp();
        }
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Check In';
        if (err && err.code === 'pin_invalid') {
          // Stored PIN no longer valid (rotated) — send back through the gate.
          window._gwPin = '';
          try { localStorage.removeItem(PIN_STORE_KEY); } catch (e2) {}
          Session.pinOk.set(false);
          showToast('Access code changed — please re-enter it.', true);
          showScreen('pin');
          document.getElementById('pin-1').focus();
          return;
        }
        showToast('Check-in error: ' + friendlyError(err), true);
      });
  });

  document.getElementById('gwCertToggle').addEventListener('change', function () {
    var on = this.checked;
    document.getElementById('gwCertSection').style.display = on ? 'block' : 'none';
    if (on) {
      ensureCertsLoaded();
      gwTryPrefillCerts();
    } else {
      document.getElementById('gwCertPrefilledMsg').style.display = 'none';
      GW_LAST_PREFILL_KEY = '';
    }
  });
  document.getElementById('signinEmail').addEventListener('blur', function () { gwTryPrefillCerts(); });
  document.getElementById('signinName').addEventListener('blur', function () { gwTryPrefillCerts(); });

  /* ═══════════════════════════════════════════
     RESUME SESSION
     ═══════════════════════════════════════════ */
  window.populateResumeScreen = function () {
    var s = Session.get() || {};
    var initial = (s.name || 'R').charAt(0).toUpperCase();
    document.getElementById('resumeAvatar').textContent = initial;
    document.getElementById('resumeWelcome').textContent = 'Welcome back, ' + (s.name || 'Responder');
    document.getElementById('resumeOrg').textContent = s.organization || '-';
    document.getElementById('resumeRole').textContent = s.role || '-';
    document.getElementById('resumeTime').textContent = s.checkin_time ? formatTime(s.checkin_time) : '-';
  };

  window.resumeSession = function () {
    var btn = document.getElementById('resumeContinueBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-sm"></span> Refreshing...';

    apiGet('session')
      .then(function (result) {
        btn.disabled = false;
        btn.textContent = 'Continue Session';
        if (!result || !result.valid) {
          Session.clear();
          if (window.APP) APP.session = null;
          document.getElementById('signinExpiredMsg').classList.remove('hidden');
          showScreen('signin');
          return;
        }
        if (result.session) {
          Session.set(Object.assign({}, Session.get() || {}, result.session));
        }
        if (window.APP) {
          APP.session = Session.get();
          if (result.incident) APP.incident = result.incident;
        }
        showWelcomeBanner();
        enterMainApp();
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Continue Session';
        if (handleAuthError(err)) return;
        showToast('Resume error: ' + friendlyError(err), true);
      });
  };

  window.checkOutAndResign = function () {
    showLoading('Checking out...');
    apiPost('checkout', {})
      .then(finishResign)
      .catch(finishResign); // clear locally even if the server call fails
    function finishResign() {
      Session.clear();
      if (window.APP) APP.session = null;
      hideLoading();
      showScreen('signin');
    }
  };

  /* ═══════════════════════════════════════════
     ENTER MAIN APP
     ═══════════════════════════════════════════ */
  window.enterMainApp = function () {
    var s = Session.get() || {};
    var inc = (window.APP && APP.incident) || {};
    document.getElementById('headerUser').textContent = s.name || '';
    document.getElementById('headerIncident').textContent = inc.incident_name || '';
    document.getElementById('reconReporter').value = s.name || '';
    showScreen('main');
    switchTab('map'); // lazily boots the map on first entry
  };

  window.showWelcomeBanner = function () {
    var s = Session.get() || {};
    var banner = document.getElementById('welcomeBanner');
    banner.textContent = 'Welcome back, ' + (s.name || 'Responder');
    banner.classList.add('show');
    setTimeout(function () { banner.classList.remove('show'); }, 4000);
  };

  /* ═══════════════════════════════════════════
     CHECK-OUT
     ═══════════════════════════════════════════ */
  window.showCheckoutOverlay = function () {
    document.getElementById('checkoutOverlay').classList.add('active');
  };

  window.hideCheckoutOverlay = function () {
    document.getElementById('checkoutOverlay').classList.remove('active');
  };

  window.confirmCheckOut = function () {
    hideCheckoutOverlay();
    showLoading('Checking out...');
    apiPost('checkout', {})
      .then(function () { hideLoading(); showThankYou(); })
      .catch(function () {
        // Still show thank-you on failure so the user isn't trapped (legacy behavior)
        hideLoading();
        showThankYou();
      });
  };

  window.showThankYou = function () {
    if (window.stopSitStatAutoRefresh) stopSitStatAutoRefresh();
    var s = Session.get() || {};
    var inc = (window.APP && APP.incident) || {};
    document.getElementById('tyIncident').textContent = inc.incident_name || '';
    document.getElementById('tyCheckinTime').textContent = s.checkin_time ? formatTime(s.checkin_time) : '-';
    document.getElementById('tyCheckoutTime').textContent = formatTime(new Date().toISOString());
    document.getElementById('tyResourceCount').textContent = String((window.APP && APP.resourceCount) || 0);
    Session.clear();
    if (window.APP) APP.session = null;
    showScreen('thankyou');
  };

  window.restartApp = function () {
    Session.clear();
    location.reload();
  };

  // Attach autocomplete once the DOM is parsed (scripts sit at end of <body>).
  setupUserAutocomplete();
})();
