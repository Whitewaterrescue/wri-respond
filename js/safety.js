/* WRI Respond — Get help, Your first stop, Safety today (G4 persona, 2026-11-10).
 *
 * Get help: a red button in the header on every main screen -> Call 911, call the
 * Safety Officer (work chart, phone from the Gateway's contacts), the WRI 24-hour
 * line and the nearest hospital (HASP card), and one-tap "someone hurt" / "stop work"
 * reports (those alert the IC + Safety Officer server-side).
 * First stop: the incident's staging point (public recon view) + who to ask for.
 * Safety today: the ICS 208 message when there is one, else the HASP's PPE with
 * picture signs, the meeting point, and the stop-work rule.
 * Sources: Sit Stat (window.__sitstat, set by sitstat.js), the Mission Hub HASP card
 * (?api=hasp, public, same as the Field App's HASP page), the public recon view.
 */
(function () {
  'use strict';
  var HASP_API = 'https://script.google.com/macros/s/AKfycbzcg-yD3_ALkdGYVEOuGY3VR8NrlsPRoxL6k-4LKX3SqEI6NlaKkpprKCtez2xo9C2u/exec';
  var TTL = 5 * 60 * 1000;
  var hasp = null, haspAt = 0, haspP = null, staging = null, stagingAt = 0, stagingP = null;

  function inc() { return (window.APP && APP.incident) || {}; }
  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function telHref(p) { var d = String(p || '').replace(/[^\d+]/g, ''); return d.replace(/\D/g, '').length >= 3 ? 'tel:' + d : ''; }
  function callBtn(label, phone, cls) {
    var h = telHref(phone);
    return h ? '<a class="btn ' + (cls || 'btn-secondary') + ' btn-block call-btn" href="' + e(h) + '">&#128222; ' + e(label) +
      '<span class="call-num">' + e(phone) + '</span></a>' : '';
  }

  /* ---------- data ---------- */
  window.loadHaspCard = function () {
    var id = String(inc().incident_id || '');
    if (hasp && Date.now() - haspAt < TTL && hasp._for === id) return Promise.resolve(hasp);
    if (haspP) return haspP;
    haspP = fetch(HASP_API + '?api=hasp&incident=' + encodeURIComponent(id), { redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (j) { hasp = (j && j.summary) || {}; hasp._for = id; haspAt = Date.now(); return hasp; })
      .catch(function () { return hasp || {}; })
      .then(function (v) { haspP = null; return v; });
    return haspP;
  };
  window.loadStaging = function () {
    var i = inc();
    if (staging && Date.now() - stagingAt < TTL) return Promise.resolve(staging);
    if (stagingP) return stagingP;
    var url = (i.recon_view_url || CONFIG.RECON_VIEW_URL) + '/query';
    var proj = String(i.recon_project || i.project_key || i.incident_name || '').replace(/'/g, "''");
    var q = new URLSearchParams({ where: "project_name = '" + proj + "' AND observation_type IN ('staging_area','planned_staging_area')",
      outFields: '*', outSR: '4326', f: 'json' });
    stagingP = fetch(url + '?' + q.toString(), { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (j) {
      var f = (j.features || []).slice().sort(function (a, b) {   // a real staging area before a planned one
        return (a.attributes.observation_type === 'staging_area' ? 0 : 1) - (b.attributes.observation_type === 'staging_area' ? 0 : 1);
      })[0];
      staging = f ? { name: String(f.attributes.description || 'Staging').split('\n')[0].slice(0, 80), lat: f.geometry.y, lon: f.geometry.x } : null;
      stagingAt = Date.now();
      return staging;
    }).catch(function () { return staging; }).then(function (v) { stagingP = null; return v; });
    return stagingP;
  };
  function sitstat() { return window.__sitstat || null; }
  function contacts() { var d = sitstat(); return (d && d.contacts) || null; }
  function firstWithPhone(list) { return (list || []).filter(function (p) { return p.phone; })[0] || (list || [])[0] || null; }
  window.safetyOfficer = function () {
    var c = contacts(), s = c && firstWithPhone(c.sofr);
    if (s) return s;
    return hasp && hasp.safetyOfficer ? { name: hasp.safetyOfficer, phone: '' } : null;
  };

  /* ---------- Get help ---------- */
  window.showGetHelp = function () {
    var ov = document.getElementById('getHelpOverlay');
    render();
    ov.classList.add('active');
    var need = [];
    if (!sitstat() && window.apiGet) need.push(apiGet('sitstat').then(function (d) { window.__sitstat = d; }).catch(function () {}));
    need.push(loadHaspCard());
    Promise.all(need).then(render, render);
    function render() {
      var body = document.getElementById('getHelpBody');
      var s = safetyOfficer(), h = hasp || {};
      var line = (h.call || []).filter(function (c) { return !/911/.test(c.number || ''); })[0];
      var html = '<p class="gh-first">' + e(t('gh.first')) + '</p>';
      html += '<a class="btn btn-danger btn-block call-btn big" href="tel:911">&#128222; ' + e(t('gh.911')) + '</a>';
      if (s && s.phone) html += callBtn(t('gh.sofr') + ': ' + s.name, s.phone, 'btn-primary');
      else if (sitstat() || haspAt) html += '<p class="gh-note">' + e(s ? t('gh.sofr') + ': ' + s.name + '. ' : '') + e(t('gh.noSofr')) + '</p>';
      else html += '<p class="gh-note"><span class="spinner spinner-sm"></span> ' + e(t('gh.loading')) + '</p>';
      if (line) html += callBtn(t('gh.line'), line.number);
      html += '<div class="gh-row"><button type="button" class="btn btn-secondary gh-report" onclick="reportFromHelp(\'injury\')">' +
        '<img src="assets/obs/injury.png" alt=""> ' + e(t('gh.injury')) + '</button>' +
        '<button type="button" class="btn btn-secondary gh-report" onclick="reportFromHelp(\'stop_work\')">' +
        '<img src="assets/obs/stop_work.png" alt=""> ' + e(t('gh.stop')) + '</button></div>';
      if (h.hospital && h.hospital.name) {
        html += '<div class="gh-hosp"><b>' + e(t('gh.hospital')) + ':</b> ' + e(h.hospital.name) +
          (h.hospital.driveTime ? ' (' + e(h.hospital.driveTime) + ')' : '') + '<br>' + e(h.hospital.address || '') +
          '<div class="gh-row">' + (h.hospital.tel ? '<a class="btn btn-sm btn-secondary" href="tel:' + e(h.hospital.tel) + '">&#128222; ' + e(h.hospital.phone || '') + '</a>' : '') +
          (h.hospital.directionsUrl ? '<a class="btn btn-sm btn-secondary" target="_blank" rel="noopener" href="' + e(h.hospital.directionsUrl) + '">' + e(t('gh.directions')) + ' &nearr;</a>' : '') +
          '</div></div>';
      }
      body.innerHTML = html;
    }
  };
  window.hideGetHelp = function () { document.getElementById('getHelpOverlay').classList.remove('active'); };
  window.reportFromHelp = function (kind) {
    hideGetHelp();
    switchTab('recon');
    if (window.presetReportType) presetReportType(kind);
  };

  /* ---------- First stop + Safety today (top of Status; first stop also right after check-in) ---------- */
  function norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function myChartJob(d) {
    var me = norm(((window.Session && Session.get()) || {}).name);
    var asg = d && d.orgChart && d.orgChart.icsAssignments;
    if (!me || !asg) return '';
    var hit = '';
    Object.keys(asg).some(function (pos) {
      var raw = asg[pos], list = [];
      try { list = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []); } catch (x) { list = []; }
      if ((list || []).some(function (p) { return p && norm(p.name) === me; })) { hit = pos; return true; }
      return false;
    });
    return hit ? (window.positionLabel ? positionLabel(hit) : hit) : '';
  }
  window.firstStopHtml = function (d) {
    var c = (d && d.contacts) || {};
    var ask = firstWithPhone(c.stam) || firstWithPhone(c.sofr) || firstWithPhone(c.ic);
    var askRole = ask ? t(c.stam && c.stam.indexOf(ask) > -1 ? 'role.stam' : c.sofr && c.sofr.indexOf(ask) > -1 ? 'role.sofr' : 'role.ic') : '';
    var job = myChartJob(d);
    var h = '<div class="sitstat-card first-stop"><div class="card-title">&#128205; ' + e(t('fs.title')) + '</div>';
    h += '<div class="fs-row"><b>' + e(t('fs.go')) + '</b> ' + (staging ? e(staging.name) +
      ' <button type="button" class="btn btn-sm btn-secondary" onclick="showStagingOnMap()">' + e(t('fs.show')) + '</button>' : e(t('fs.noPlace'))) + '</div>';
    if (ask) h += '<div class="fs-row"><b>' + e(t('fs.ask')) + '</b> ' + e(ask.name) + ' <span class="muted">(' + e(askRole) + ')</span>' +
      (telHref(ask.phone) ? ' <a class="btn btn-sm btn-primary" href="' + e(telHref(ask.phone)) + '">&#128222; ' + e(t('fs.call')) + '</a>' : '') + '</div>';
    if (job) h += '<div class="fs-row"><b>' + e(t('fs.job')) + '</b> ' + e(job) + '</div>';
    return h + '</div>';
  };
  window.showStagingOnMap = function () {
    if (!staging) return;
    hideFirstStop();
    switchTab('map');
    var go = function () { if (window.wriMapView) wriMapView.goTo({ center: [staging.lon, staging.lat], zoom: 16 }).catch(function () {}); };
    if (window.wriMapView && wriMapView.ready) go(); else setTimeout(go, 2500);
  };
  window.safetyTodayHtml = function (d) {
    var sm = d && d.safetyMessage && !d.safetyMessage.error && (d.safetyMessage.message || (d.safetyMessage.hazards || []).length) ? d.safetyMessage : null;
    var h = hasp || {}, ppe = (h.ppe && h.ppe.items) || [];
    var out = '<div class="sitstat-card safety-today"><div class="card-title">&#9888;&#65039; ' + e(t('sf.title')) + '</div>';
    if (sm) {
      if (sm.message) out += '<div class="sf-msg"><b>' + e(t('sf.from208')) + ':</b> ' + e(String(sm.message).slice(0, 400)) + '</div>';
      var hz = (sm.hazards || []).map(function (x) { return typeof x === 'string' ? x : (x && (x.hazard || x.name || x.label)) || ''; }).filter(Boolean);
      if (hz.length) out += '<div class="sf-msg"><b>' + e(t('sf.hazards')) + '</b> ' + e(hz.slice(0, 6).join(', ')) + '</div>';
      if (sm.ppe) out += '<div class="sf-msg"><b>' + e(t('sf.wear')) + '</b> ' + e(sm.ppe) + '</div>';
    }
    if (ppe.length && !(sm && sm.ppe)) {
      // G2b 2026-11-10: grouped, from the HASP list only (never invented): everyone / water / by task
      var WATER = /pfd|life jacket|drysuit|dry suit|wetsuit|float/i, TASK = /respirator|chemical|face shield|tyvek|scba|apron/i;
      var groups = { everyone: [], water: [], task: [] }, seen = {};
      ppe.forEach(function (p) {
        var it = ppeItem(p); if (seen[it.label]) return; seen[it.label] = 1;
        (WATER.test(p) ? groups.water : TASK.test(p) ? groups.task : groups.everyone).push(it);
      });
      var chips = function (list) { return list.map(function (it) { return '<span class="ppe"><span class="ppe-i">' + it.icon + '</span>' + e(it.label) + '</span>'; }).join(''); };
      out += '<div class="sf-wear"><b>' + e(t('sf.wear')) + '</b>';
      [['everyone', 'sf.everyone'], ['water', 'sf.water'], ['task', 'sf.task']].forEach(function (g) {
        if (groups[g[0]].length) out += '<div class="ppe-group">' + e(t(g[1])) + '</div><div class="ppe-grid">' + chips(groups[g[0]]) + '</div>';
      });
      out += '</div>';
    }
    if (h.meetingPoint) out += '<div class="sf-msg"><b>' + e(t('sf.meet')) + '</b> ' + e(h.meetingPoint) + '</div>';
    out += '<div class="sf-rule">&#9995; ' + e(t('sf.rule')) + '</div>';
    return out + '</div>';
  };
  /** Status tab: fetch the HASP card + staging once, then re-render Sit Stat with them. */
  window.ensureSafetyData = function (rerender) {
    var fresh = !(hasp && Date.now() - haspAt < TTL) || !(stagingAt && Date.now() - stagingAt < TTL);
    if (!fresh) return;
    Promise.all([loadHaspCard(), loadStaging()]).then(function () { if (rerender) rerender(); });
  };

  /* After check-in: the first-stop card once, as a sheet */
  window.showFirstStop = function () {
    var ov = document.getElementById('firstStopOverlay');
    if (!ov) return;
    var paint = function () { document.getElementById('firstStopBody').innerHTML = firstStopHtml(sitstat() || {}); };
    paint();
    ov.classList.add('active');
    Promise.all([loadStaging(), window.apiGet ? apiGet('sitstat').then(function (d) { window.__sitstat = d; }).catch(function () {}) : null]).then(paint, paint);
  };
  window.hideFirstStop = function () { var ov = document.getElementById('firstStopOverlay'); if (ov) ov.classList.remove('active'); };
})();
