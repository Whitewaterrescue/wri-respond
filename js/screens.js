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
      incident_mismatch: 'The incident changed while this was waiting to send. Please check in to the current incident.',
      blocked: 'Waiting on a saved check-in that could not be sent.',
      server_error: 'Server error — please try again.'
    };
    return map[code] || (err && err.message) || 'Something went wrong. Please try again.';
  };

  // Returns true when the error means the session is dead; clears it and
  // returns the user to sign-in.
  window.handleAuthError = function (err) {
    // A pending (queued offline) check-in has no server session yet — an
    // auth rejection here must NOT clear it, or the queued state's UI is
    // lost and the user could double-queue a second check-in.
    if (window.Session && Session.isPending && Session.isPending()) {
      showToast('Your check-in is still waiting to send — this needs it delivered first.', true);
      return true;
    }
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

  // When true, the PIN screen is re-verifying a rotated code so queued
  // outbox records can deliver (drain-time re-PIN). The queue is never
  // dropped — a verified code is rewritten onto every needs_pin record.
  var drainPinMode = false;
  var PIN_DEFAULT_MSG = 'Enter the access code provided by the incident team.';

  window.showDrainPinPrompt = function () {
    if (drainPinMode) return;
    drainPinMode = true;
    var el = document.getElementById('pinInstructions');
    if (el) el.textContent = 'The access code changed while your saved check-in was waiting to send. Enter the current code to deliver it.';
    showScreen('pin');
    clearPinBoxes();
  };

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
        if (drainPinMode) {
          drainPinMode = false;
          var el = document.getElementById('pinInstructions');
          if (el) el.textContent = PIN_DEFAULT_MSG;
          if (window.Outbox) {
            Outbox.updatePin(pin).then(function () { Outbox.drain({ source: 'repin' }); });
          }
          var s = Session.get();
          if (s && (s.checkin_id || s.pending)) { enterMainApp(); } else { showScreen('signin'); }
          return;
        }
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
     SIGN-IN SUBMIT (online-first; queues offline)
     ═══════════════════════════════════════════ */
  // Offline path: enqueue the check-in with a pending placeholder session.
  // The outbox drain response back-fills the real session (Outbox.reconcile).
  function queueCheckin(payload, idemKey, hasResources) {
    var inc = (window.APP && APP.incident) || {};
    return Outbox.enqueue({
      id: idemKey,
      action: 'checkin',
      payload: payload,
      session: null,
      depends_on: null,
      queued_at: new Date().toISOString(),
      queued_incident_id: inc.incident_id || '',
      queued_incident_name: inc.incident_name || ''
    }).then(function () {
      Session.setPending({
        outbox_id: idemKey,
        name: payload.name,
        organization: payload.organization,
        role: payload.role,
        incident_id: inc.incident_id || '',
        incident_name: inc.incident_name || '',
        checkin_time: new Date().toISOString()
      });
      if (window.APP) APP.session = Session.get();
      saveUserProfile(payload);
      document.getElementById('signinExpiredMsg').classList.add('hidden');
      document.getElementById('headerUser').textContent = payload.name;
      enterMainApp();
      if (window.updateOutboxBanner) updateOutboxBanner();
      showToast('✓ Check-in saved on this device — it will send when signal returns.');
      if (hasResources) {
        setTimeout(function () {
          showToast('Resource logging needs a connection — use Resources → + Add More once your check-in has sent.', true);
        }, 4500);
      }
    });
  }

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

    // Key minted at SUBMIT time and shared by the direct attempt AND any
    // queued record — if the direct POST landed but its response was lost,
    // the later drain replays server-side instead of double-writing.
    var idemKey = apiUuid();

    function resetBtn() { btn.disabled = false; btn.textContent = 'Check In'; }

    // navigator.onLine === false is trustworthy (true is not) — skip the
    // network entirely and queue.
    if (navigator.onLine === false && window.Outbox) {
      resetBtn();
      queueCheckin(payload, idemKey, hasResources);
      return;
    }

    apiPost('checkin', payload, { idempotencyKey: idemKey, maxAttempts: 2 })
      .then(function (result) {
        resetBtn();
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
        resetBtn();
        if (err && err.transient && window.Outbox) {
          // Couldn't reach the server — save the check-in for delivery.
          queueCheckin(payload, idemKey, hasResources);
          return;
        }
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

  /* ═══════════════════════════════════════════
     CHECK-OUT CORE (shared by overlay + resign paths)
     ═══════════════════════════════════════════ */
  // Snapshot the session creds INTO the outbox record before anything clears
  // them — the old flow swallowed checkout failures ("thank you" either way)
  // and the departure was simply lost. done(queued) runs after the direct
  // send OR the enqueue; the caller clears the live session afterwards,
  // which is safe because a queued record carries its own creds.
  window.submitCheckout_ = function (done) {
    var creds = Session.get() || {};
    var inc = (window.APP && APP.incident) || {};
    var idemKey = apiUuid();

    function queueIt() {
      if (!window.Outbox) { done(false); return; }
      var pendingId = creds.pending ? creds.outbox_id : null;
      Outbox.enqueue({
        id: idemKey,
        action: 'checkout',
        payload: {},
        session: (!pendingId && creds.checkin_id)
          ? { checkin_id: creds.checkin_id, session_token: creds.session_token }
          : null,
        depends_on: pendingId || null,
        queued_at: new Date().toISOString(),
        queued_incident_id: creds.incident_id || inc.incident_id || ''
      }).then(function () { done(true); }, function () { done(false); });
    }

    // Check-in itself still queued — the checkout can only ride behind it.
    if (creds.pending) { queueIt(); return; }
    if (!creds.checkin_id) { done(false); return; }
    if (navigator.onLine === false && window.Outbox) { queueIt(); return; }

    apiPost('checkout', {}, { idempotencyKey: idemKey, maxAttempts: 2 })
      .then(function () { done(false); })
      .catch(function (err) {
        if (err && err.transient && window.Outbox) { queueIt(); return; }
        // checked_out = goal state already holds; other terminal errors:
        // clearing locally is the only sane move (matches legacy behavior).
        done(false);
      });
  };

  window.checkOutAndResign = function () {
    showLoading('Checking out...');
    submitCheckout_(function (queued) {
      Session.clear();
      if (window.APP) APP.session = null;
      hideLoading();
      if (queued) showToast('✓ Check-out saved — it will send when signal returns.');
      showScreen('signin');
    });
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
    submitCheckout_(function (queued) {
      hideLoading();
      showThankYou(queued);
    });
  };

  window.showThankYou = function (queued) {
    if (window.stopSitStatAutoRefresh) stopSitStatAutoRefresh();
    var s = Session.get() || {};
    var inc = (window.APP && APP.incident) || {};
    var msg = document.getElementById('tyMessage');
    if (msg) {
      msg.textContent = queued
        ? 'Your check-out is saved on this device and will send when signal returns.'
        : 'You have been checked out of the incident.';
    }
    document.getElementById('tyIncident').textContent = inc.incident_name || s.incident_name || '';
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

  /* ═══════════════════════════════════════════
     OUTBOX STATUS BANNER + DETAILS (offline queue surface)
     ═══════════════════════════════════════════ */
  // Persistent strip under the main-app header while anything is queued or
  // failed. Amber = saved-and-waiting; red = needs attention (tap-through).
  window.updateOutboxBanner = function () {
    if (!window.Outbox) return;
    Outbox.pending().then(function (p) {
      var el = document.getElementById('outboxBanner');
      var queued = p.queued.length;
      var failed = p.failed.length;
      var needsPin = p.failed.some(function (r) { return r.needs_pin; });
      if (!queued && !failed) {
        if (el) el.style.display = 'none';
        return;
      }
      if (!el) {
        el = document.createElement('div');
        el.id = 'outboxBanner';
        el.style.cssText = 'padding:9px 14px;font-size:13px;font-weight:600;text-align:center;cursor:default;';
        var main = document.getElementById('screen-main');
        var header = main && main.querySelector('.app-header');
        if (!header) return;
        header.parentNode.insertBefore(el, header.nextSibling);
      }
      if (needsPin) {
        el.style.background = '#7f1d1d'; el.style.color = '#fff'; el.style.cursor = 'pointer';
        el.textContent = 'Access code needed to send your saved check-in — tap here.';
        el.onclick = function () { showDrainPinPrompt(); };
      } else if (failed) {
        el.style.background = '#7f1d1d'; el.style.color = '#fff'; el.style.cursor = 'pointer';
        el.textContent = failed + ' saved record' + (failed === 1 ? '' : 's') + ' could not be sent — tap for details.';
        el.onclick = function () { showOutboxDetails(); };
      } else {
        el.style.background = '#78350f'; el.style.color = '#fde68a'; el.style.cursor = 'default';
        el.textContent = '✓ ' + queued + ' record' + (queued === 1 ? '' : 's') + ' saved on this device — will send when signal returns.';
        el.onclick = null;
      }
      el.style.display = 'block';
    });
  };

  window.showOutboxDetails = function () {
    if (!window.Outbox) return;
    Outbox.pending().then(function (p) {
      var overlay = document.getElementById('outboxOverlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'outboxOverlay';
        overlay.className = 'overlay';
        document.body.appendChild(overlay);
      }
      var rows = '';
      p.failed.concat(p.queued).forEach(function (r) {
        var label = r.action === 'checkin' ? 'Check-in' : 'Check-out';
        var when = formatTime(r.queued_at);
        var state = r.status === 'failed'
          ? '<span style="color:#ef4444;">' + esc(friendlyError(r.last_error || {})) + '</span>'
          : '<span style="color:#fde68a;">Waiting to send</span>';
        rows += '<div style="border:1px solid var(--border,#55595a);border-radius:8px;padding:10px 12px;margin-bottom:10px;text-align:left;font-size:13px;">' +
          '<div style="font-weight:700;margin-bottom:2px;">' + label + ' — saved ' + esc(when) + '</div>' +
          '<div style="margin-bottom:6px;">' + state + '</div>';
        if (r.status === 'failed') {
          rows += '<div style="display:flex;gap:8px;">' +
            (r.needs_pin
              ? '<button class="btn btn-primary" style="flex:1;padding:8px;" onclick="hideOutboxDetails();showDrainPinPrompt();">Enter Code</button>'
              : '<button class="btn btn-secondary" style="flex:1;padding:8px;" onclick="outboxRetry(\'' + escAttr(r.id) + '\')">Retry</button>') +
            '<button class="btn btn-danger" style="flex:1;padding:8px;" onclick="outboxDiscard(\'' + escAttr(r.id) + '\', this)">Discard</button>' +
            '</div>';
        }
        rows += '</div>';
      });
      if (!rows) rows = '<p class="text-muted">Nothing waiting to send.</p>';
      overlay.innerHTML =
        '<div class="overlay-card">' +
        '<h2>Saved Records</h2>' +
        '<div style="max-height:50vh;overflow-y:auto;margin:12px 0;">' + rows + '</div>' +
        '<div class="btn-row"><button class="btn btn-secondary" onclick="hideOutboxDetails()">Close</button></div>' +
        '</div>';
      overlay.classList.add('active');
    });
  };

  window.hideOutboxDetails = function () {
    var overlay = document.getElementById('outboxOverlay');
    if (overlay) overlay.classList.remove('active');
  };

  window.outboxRetry = function (id) {
    hideOutboxDetails();
    Outbox.retry(id).then(function () { updateOutboxBanner(); });
  };

  // Two-tap inline confirm — native confirm() is suppressed inside embedded
  // iframes (field-observed 2026-08-10 on the staff app; applies here too).
  window.outboxDiscard = function (id, btn) {
    if (btn && btn.getAttribute('data-armed') !== '1') {
      btn.setAttribute('data-armed', '1');
      var orig = btn.textContent;
      btn.textContent = 'Tap again to discard';
      setTimeout(function () {
        btn.setAttribute('data-armed', '');
        btn.textContent = orig;
      }, 5000);
      return;
    }
    Outbox.discard(id).then(function () {
      hideOutboxDetails();
      updateOutboxBanner();
      // Discarding a pending check-in's record orphans the placeholder
      // session — clear it so the user can check in again.
      var s = Session.get();
      if (s && s.pending && s.outbox_id === id) {
        Session.clear();
        if (window.APP) APP.session = null;
        showScreen('signin');
      }
    });
  };

  // Attach autocomplete once the DOM is parsed (scripts sit at end of <body>).
  setupUserAutocomplete();
})();
