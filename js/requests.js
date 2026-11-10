/* WRI Respond — 213-RR resource requests from checked-in responders.
 *
 * Submits via the gateway API action 'rr-submit' (session-gated), which
 * relays through the logistics dashboard's single-writer funnel onto the
 * 213-RR ledger — the request appears on the RESL board (Resource Manager)
 * and the Logistics dashboard immediately. Requester identity comes from
 * the server-side session, never from this form.
 *
 * My Requests (G2 persona, 2026-11-10: a request vanished after its banner,
 * so the only way to follow it was to call). Each REQ id is kept on this
 * phone per check-in; its status comes from the Logistics 'offline_rr_status'
 * read (the same call as the Field App's "Mine" list), which checks the
 * incident's Gateway PIN — the access code this person already entered.
 */
(function () {
  var STORE_PREFIX = 'wri_respond_rr_';
  var DEVICE_KEY = 'wri_respond_device';
  var STATUS_TTL_MS = 60 * 1000;
  var lastStatusAt = 0, statusCache = {}, refreshing = false;

  function incidentId() { return String(((window.APP && APP.incident) || {}).incident_id || ''); }
  function checkinId() { var s = (window.Session && Session.get()) || {}; return String(s.checkin_id || ''); }
  function storeKey() { return STORE_PREFIX + incidentId(); }

  function readAll() {
    try { return JSON.parse(localStorage.getItem(storeKey()) || '[]') || []; } catch (e) { return []; }
  }
  function writeAll(list) {
    try { localStorage.setItem(storeKey(), JSON.stringify(list.slice(-40))); } catch (e) {}
  }
  /** This check-in's requests on this phone (a shared phone shows each person only theirs). */
  function mine() {
    var cid = checkinId();
    return readAll().filter(function (r) { return !cid || !r.checkin_id || r.checkin_id === cid; });
  }
  window.myRequestCount = function () { return mine().length; };
  window.myRequestIds = function () { return mine().map(function (r) { return r.id; }); };

  function deviceId() {
    try {
      var d = localStorage.getItem(DEVICE_KEY);
      if (!d) { d = 'gw-' + (window.apiUuid ? apiUuid() : String(Date.now()) + Math.random().toString(36).slice(2)); localStorage.setItem(DEVICE_KEY, d); }
      return d;
    } catch (e) { return 'gw-anon'; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  var BADGE = { new: 'badge-pending', assigned: 'badge-active', ordering: 'badge-active', ordered: 'badge-active',
                filled: 'badge-active', rejected: 'badge-rejected' };

  function render() {
    var list = mine().slice().reverse();
    var head = document.getElementById('rrMineHead');
    var box = document.getElementById('rrMineList');
    if (!head || !box) return;
    head.style.display = list.length ? '' : 'none';
    if (!list.length) { box.innerHTML = ''; return; }
    var html = '';
    list.forEach(function (r) {
      var st = statusCache[r.id];
      var label = st ? st.label : 'Sent to the Resource Unit';
      var cls = st ? (BADGE[st.status] || 'badge-pending') : 'badge-pending';
      html += '<div class="resource-item">';
      html += '<div class="res-info"><div class="res-name">' + esc(r.id) + ' &middot; ' + esc(r.item) + '</div>';
      html += '<div class="res-detail">' + esc(r.qty || '1') + ' ' + esc(r.uom || '') +
        (r.delivery ? ' | to ' + esc(r.delivery) : '') + (r.at ? ' | ' + esc(fmtTime(r.at)) : '') +
        (st && st.eta ? ' | ETA ' + esc(/^\d{4}-/.test(st.eta) ? fmtTime(st.eta) : st.eta) : '') + '</div></div>';
      html += '<div class="res-status"><span class="badge ' + cls + '">' + esc(label) + '</span></div>';
      html += '</div>';
    });
    box.innerHTML = html;
  }

  /** Status for this person's requests from the 213-RR ledger. Quiet on failure: the list still shows. */
  window.refreshMyRequests = function (force) {
    render();
    var list = mine();
    if (!list.length || refreshing) return Promise.resolve();
    if (!force && Date.now() - lastStatusAt < STATUS_TTL_MS) return Promise.resolve();
    var pin = window._gwPin || '';
    if (!pin || !CONFIG.LOGISTICS_API) return Promise.resolve();
    var btn = document.getElementById('rrMineRefresh');
    refreshing = true;
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner spinner-sm"></span>'; }
    return fetch(CONFIG.LOGISTICS_API, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'offline_rr_status', payload: {
        pin: pin, device: deviceId(), incident_id: incidentId(),
        request_ids: list.map(function (r) { return r.id; }) } })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok && j.data && j.data.requests) {
        statusCache = Object.assign(statusCache, j.data.requests);
        lastStatusAt = Date.now();
      }
    }).catch(function () {}).then(function () {
      refreshing = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Refresh'; }
      render();
    });
  };

  function deliveryValue() {
    var sel = document.getElementById('rrDeliverySel');
    var txt = (document.getElementById('rrDelivery').value || '').trim();
    if (!sel || sel.value === '__custom__' || !sel.value) return txt;
    return sel.value;
  }

  window.toggleRrForm = function () {
    var form = document.getElementById('rrForm');
    var open = form.style.display !== 'none';
    form.style.display = open ? 'none' : '';
    document.getElementById('rrFormToggle').textContent = open ? '+ New Request' : 'Cancel';
    if (!open) {
      var ok = document.getElementById('rrSuccess');
      if (ok) ok.style.display = 'none';
      if (window.loadActiveLocations) loadActiveLocations();   // fills the Deliver to list
    }
  };

  window.submitRrRequest = function () {
    var item = (document.getElementById('rrItem').value || '').trim();
    var errEl = document.getElementById('rrError');
    errEl.style.display = 'none';
    if (!item) {
      errEl.textContent = 'Describe what you need.';
      errEl.style.display = 'block';
      return;
    }
    var btn = document.getElementById('rrSubmitBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-sm"></span> Submitting…';

    var sent = {
      item: item,
      qty: (document.getElementById('rrQty').value || '1').trim(),
      uom: document.getElementById('rrUom').value,
      priority: document.getElementById('rrPriority').value,
      delivery: deliveryValue(),
      arrival: (document.getElementById('rrArrival').value || '').trim(),
      notes: (document.getElementById('rrNotes').value || '').trim()
    };
    apiPost('rr-submit', sent).then(function (data) {
      btn.disabled = false;
      btn.textContent = 'Submit Request';
      var id = (data && data.request_id) || '';
      if (id) {
        var all = readAll();
        all.push({ id: id, item: sent.item, qty: sent.qty, uom: sent.uom, delivery: sent.delivery,
                   at: new Date().toISOString(), checkin_id: checkinId() });
        writeAll(all);
      }
      // Reset + confirm with the ledger id
      ['rrItem', 'rrQty', 'rrDelivery', 'rrArrival', 'rrNotes'].forEach(function (fid) {
        document.getElementById(fid).value = fid === 'rrQty' ? '1' : '';
      });
      var sel = document.getElementById('rrDeliverySel');
      if (sel) sel.value = '';
      document.getElementById('rrDelivery').classList.add('hidden');
      document.getElementById('rrForm').style.display = 'none';
      document.getElementById('rrFormToggle').textContent = '+ New Request';
      var ok = document.getElementById('rrSuccess');
      ok.innerHTML = 'Request <strong>' + esc(id) +
        '</strong> sent to the Resource Unit. Follow it under <b>My Requests</b> below.';
      ok.style.display = 'block';
      statusCache[id] = null;
      render();
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = 'Submit Request';
      errEl.textContent = (e && e.code === 'rate_limited')
        ? (e.message || 'System busy — try again in a moment.')
        : ('Could not submit: ' + ((e && e.message) || 'unknown error') + ' — please retry.');
      errEl.style.display = 'block';
    });
  };
})();
