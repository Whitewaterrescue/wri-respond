/* WRI Respond — 213-RR resource requests from checked-in responders.
 *
 * Submits via the gateway API action 'rr-submit' (session-gated), which
 * relays through the logistics dashboard's single-writer funnel onto the
 * 213-RR ledger — the request appears on the RESL board (Resource Manager)
 * and the Logistics dashboard immediately. Requester identity comes from
 * the server-side session, never from this form.
 */
(function () {

  window.toggleRrForm = function () {
    var form = document.getElementById('rrForm');
    var open = form.style.display !== 'none';
    form.style.display = open ? 'none' : '';
    document.getElementById('rrFormToggle').textContent = open ? '+ New Request' : 'Cancel';
    if (!open) {
      var ok = document.getElementById('rrSuccess');
      if (ok) ok.style.display = 'none';
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
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    apiPost('rr-submit', {
      item: item,
      qty: (document.getElementById('rrQty').value || '1').trim(),
      uom: document.getElementById('rrUom').value,
      priority: document.getElementById('rrPriority').value,
      delivery: (document.getElementById('rrDelivery').value || '').trim(),
      arrival: (document.getElementById('rrArrival').value || '').trim(),
      notes: (document.getElementById('rrNotes').value || '').trim()
    }).then(function (data) {
      btn.disabled = false;
      btn.textContent = 'Submit Request';
      // Reset + confirm with the ledger id
      ['rrItem', 'rrQty', 'rrDelivery', 'rrArrival', 'rrNotes'].forEach(function (id) {
        document.getElementById(id).value = id === 'rrQty' ? '1' : '';
      });
      document.getElementById('rrForm').style.display = 'none';
      document.getElementById('rrFormToggle').textContent = '+ New Request';
      var ok = document.getElementById('rrSuccess');
      ok.innerHTML = 'Request <strong>' + (data.request_id || '') +
        '</strong> submitted — the Resource Unit has it and it is trackable at the ICP.';
      ok.style.display = 'block';
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
