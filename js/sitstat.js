/* WRI Respond — Sit Stat tab.
 * Renders the same section structure the legacy gateway built from
 * getSitStatData: pending banner, weather, ICS 201, notifications, actions,
 * org chart, T-cards, assignments, open requests, HASP (Google Docs preview
 * iframe), roster (when the API includes it), and 201 attachments.
 * Auto-refreshes every 60s while the tab is active.
 */
(function () {
  'use strict';

  var sitStatTimer = null;
  // 90s base + up to 30s per-client jitter: with a crowd on this tab, fixed
  // 60s intervals synchronized into request spikes against a GAS backend
  // that caps at ~30 simultaneous executions. Jitter spreads the polls out.
  var REFRESH_MS = 90 * 1000;
  var REFRESH_JITTER_MS = 30 * 1000;

  function nextRefreshDelay() {
    return REFRESH_MS + Math.floor(Math.random() * REFRESH_JITTER_MS);
  }

  var OBJ_TEXTS = {
    // NWACP Section 4500 hierarchy (nw codes from the Ops Dashboard ICS 201)
    'nw1': 'Ensure the safety of citizens and response personnel',
    'nw2': 'Control the source of the spill',
    'nw3': 'Maximize protection of environmentally sensitive areas',
    'nw4': 'Contain and recover spilled product',
    'nw5': 'Recover and rehabilitate injured wildlife',
    'nw6': 'Manage a coordinated response effort',
    'nw7': 'Remove oil from impacted areas',
    'nw8': 'Minimize damage to economically sensitive areas',
    'nw9': 'Keep the public and stakeholders informed',
    '1': 'Ensure Safety of Response Personnel and Public',
    '2': 'Control the Source of the Spilled Material',
    '3': 'Stabilize Incident and Minimize Impact to Critical Infrastructure',
    '4': 'Manage Response Effort in Coordinated Manner',
    '5': 'Protect Environmentally Sensitive Areas',
    '6': 'Contain and Recover Spilled Material',
    '7': 'Recover and Rehabilitate Injured Wildlife',
    '8': 'Clean-up Spilled Materials from Impacted Areas',
    '9': 'Keep the Public and Stakeholders Informed of Response Actions',
    '10': 'Minimize Service Interruption and Economic Impacts',
    '11': 'Terminate the Response (Demobilization)'
  };

  var ICS_POSITION_LABELS = {
    ic: 'Incident Commander', deputy_ic: 'Deputy IC',
    sofr: 'Safety Officer', pio: 'Public Info Officer', lofr: 'Liaison Officer',
    fosc: 'FOSC', sosc: 'SOSC', losc: 'LOSC',
    osc: 'Operations Section Chief', deputy_osc: 'Deputy Operations Chief',
    psc: 'Planning Section Chief', deputy_psc: 'Deputy Planning Chief',
    lsc: 'Logistics Section Chief', deputy_lsc: 'Deputy Logistics Chief',
    fsc: 'Finance Section Chief', deputy_fsc: 'Deputy Finance Chief',
    sitl: 'Situation Unit Leader', resl: 'Resource Unit Leader',
    docl: 'Documentation Unit Leader', demob: 'Demobilization Unit Leader',
    envl: 'Environmental Unit Leader', tech: 'Technical Specialist',
    fdul: 'Food Unit Leader', medl: 'Medical Unit Leader',
    coml: 'Communications Unit Leader', supl: 'Supply Unit Leader',
    gsl: 'Ground Support Unit Leader',
    cost: 'Cost Unit Leader', time: 'Time Unit Leader',
    proc: 'Procurement Unit Leader', comp: 'Compensation/Claims Unit Leader',
    stam: 'Staging Area Manager', divs: 'Division Supervisor', grps: 'Group Supervisor',
    tfld: 'Task Force Leader', strl: 'Strike Team Leader'
  };

  window.positionLabel = function (k) { return ICS_POSITION_LABELS[k] || String(k || '').replace(/_/g, ' '); };

  var ICS_SECTIONS = {
    command: ['ic', 'deputy_ic', 'sofr', 'pio', 'lofr', 'fosc', 'sosc', 'losc'],
    operations: ['osc', 'deputy_osc', 'stam', 'divs', 'grps', 'tfld', 'strl'],
    planning: ['psc', 'deputy_psc', 'sitl', 'resl', 'docl', 'demob', 'envl', 'tech'],
    logistics: ['lsc', 'deputy_lsc', 'fdul', 'medl', 'coml', 'supl', 'gsl'],
    finance: ['fsc', 'deputy_fsc', 'cost', 'time', 'proc', 'comp']
  };

  var SITSTAT_SNAP_KEY = 'wri_sitstat_snapshot';

  window.loadSitStat = function () {
    var contentEl = document.getElementById('sitstatContent');
    var refreshEl = document.getElementById('sitstatLastRefresh');
    // G4 2026-11-10: show the last copy at once while the fresh one loads (it took ~55 s)
    if (!contentEl.querySelector('.status-box')) {
      var snap0 = null;
      try { snap0 = JSON.parse(localStorage.getItem(SITSTAT_SNAP_KEY)); } catch (e) {}
      var inc0 = String(((window.APP && APP.incident) || {}).incident_id || '');
      if (snap0 && snap0.data && (!snap0.incident_id || snap0.incident_id === inc0)) {
        window.__sitstat = snap0.data;
        renderSitStat(snap0.data, contentEl);
        refreshEl.innerHTML = '<span class="spinner spinner-sm"></span> ' + esc(window.t ? t('st.updating') : 'Updating…');
      }
    }

    apiGet('sitstat')
      .then(function (data) {
        if (!data) {
          contentEl.innerHTML = '<div class="empty-state"><p>No situational data available</p></div>';
          return;
        }
        // Last-known-good snapshot for offline rendering. localStorage quota
        // can overflow on huge attachment lists — snapshot is best-effort.
        try {
          localStorage.setItem(SITSTAT_SNAP_KEY, JSON.stringify({
            data: data, fetched_at: new Date().toISOString(),
            incident_id: String(((window.APP && APP.incident) || {}).incident_id || '')
          }));
        } catch (e) {}
        window.__sitstat = data;
        renderSitStat(data, contentEl);
        if (window.ensureSafetyData) ensureSafetyData(function () { if (window.__sitstat) renderSitStat(window.__sitstat, contentEl); });
        // G3 2026-11-10: say how old the INFORMATION is, not when the page loaded
        var newest = newestInfo(data);
        refreshEl.innerHTML = esc(window.t('ss.checked', { time: formatTime(new Date().toISOString()) })) +
          (isFinite(newest) ? ' &middot; ' + esc(window.t('ss.newest', { ago: ago(newest) })) : '');
        refreshEl.classList.toggle('stale-text', isFinite(newest) && Date.now() - newest > STALE_MS);
      })
      .catch(function (err) {
        // Offline / unreachable: render the stale snapshot with an explicit
        // "as of" banner rather than an error (design rule: staleness must
        // be visible, but stale beats blank in the field).
        if (err && err.transient) {
          var snap = null;
          try { snap = JSON.parse(localStorage.getItem(SITSTAT_SNAP_KEY)); } catch (e) {}
          if (snap && snap.data) {
            renderSitStat(snap.data, contentEl);
            contentEl.insertAdjacentHTML('afterbegin',
              '<div style="background:#78350f;color:#fde68a;padding:8px 12px;border-radius:8px;' +
              'margin-bottom:12px;font-size:13px;font-weight:600;text-align:center;">' +
              'Offline — showing data as of ' + esc(formatTime(snap.fetched_at)) + '</div>');
            refreshEl.textContent = 'Offline';
            return;
          }
          contentEl.innerHTML = '<div class="empty-state"><p>No connection — situational data will load when signal returns.</p></div>';
          refreshEl.textContent = 'Offline';
          return;
        }
        if (handleAuthError(err)) return;
        contentEl.innerHTML = '<div class="empty-state"><p>Error loading data: ' + esc(friendlyError(err)) + '</p></div>';
        refreshEl.textContent = 'Update failed';
      });
  };

  function renderSitStat(data, container) {
    // Same box the printed ICS 201 carries on a drill/exercise
    var html = data.drill ? '<div style="border:3px solid #c00;background:#fff;color:#c00;text-align:center;' +
      'font:bold 15px Arial,sans-serif;letter-spacing:1px;padding:6px 8px;margin-bottom:16px;">' +
      'EXERCISE / DRILL - THIS IS NOT A REAL INCIDENT</div>' : '';
    try {

      if (window.firstStopHtml) html += firstStopHtml(data);
      if (window.safetyTodayHtml) html += safetyTodayHtml(data);
      html += statusBox(data);

      // ---------- Pending Count Banner ----------
      if (data.pendingCount && data.pendingCount > 0) {
        html += '<div class="sitstat-card" style="border-left:4px solid var(--warning); margin-bottom:16px;">';
        html += '<div class="card-body" style="color:var(--warning); font-weight:600;">';
        html += esc(String(data.pendingCount)) + ' resource(s) pending ICP review';
        html += '</div></div>';
      }

      // ---------- Weather (NWS) ----------
      if (data.weather && data.weather.periods && data.weather.periods.length) {
        html += '<div class="sitstat-section">';
        html += '<div class="sitstat-section-header"><h3>Weather</h3></div>';
        html += '<div style="display:flex; gap:10px; flex-wrap:wrap;">';
        data.weather.periods.forEach(function (p) {
          html += '<div class="sitstat-card" style="flex:1; min-width:160px;">';
          html += '<div class="card-title">' + esc(p.name || '') + '</div>';
          html += '<div class="card-body" style="font-size:1.2rem; font-weight:700; color:var(--text-bright);">' + esc(String(p.temperature || '')) + '&deg;F</div>';
          html += '<div class="card-body">' + esc(p.shortForecast || '') + '</div>';
          html += '<div class="card-body" style="font-size:0.78rem;">Wind: ' + esc(p.windSpeed || '') + ' ' + esc(p.windDirection || '') + '</div>';
          html += '</div>';
        });
        html += '</div></div>';
      } else if (data.weather && data.weather.error) {
        html += '<div class="sitstat-section">';
        html += '<div class="sitstat-section-header"><h3>Weather</h3></div>';
        html += '<div class="sitstat-card"><div class="card-body" style="color:var(--text-muted);">' + esc(data.weather.error) + '</div></div>';
        html += '</div>';
      }

      // ---------- ICS 201 ----------
      if (data.ics201 && data.ics201.incident_name) {
        html += '<div class="sitstat-section">';
        html += '<div class="sitstat-section-header"><h3>ICS 201 - Incident Summary</h3>' + asOf(data.ics201.datetime) + '</div>';
        html += '<div class="sitstat-card">';
        html += '<div class="card-title">' + esc(data.ics201.incident_name) + '</div>';
        html += '<div class="card-body" style="font-size:0.78rem; margin-bottom:8px;">';
        if (data.ics201.datetime) html += esc(data.ics201.datetime);
        if (data.ics201.prepared_by) html += ' &mdash; Prepared by ' + esc(data.ics201.prepared_by);
        html += '</div>';
        if (data.ics201.situation) {
          html += '<div class="card-body" style="margin-bottom:8px;"><strong>Situation:</strong> ' + esc(data.ics201.situation) + '</div>';
        }
        var objs = data.ics201.objectives || [];
        var customObjs = data.ics201.customObjectives || [];
        if (objs.length || customObjs.length) {
          html += '<div class="card-body"><strong>Objectives:</strong></div>';
          html += '<ul style="margin:4px 0 0 18px; padding:0; font-size:0.85rem; color:var(--text);">';
          objs.forEach(function (num) {
            var key = String(num).trim();
            html += '<li>' + esc(OBJ_TEXTS[key] || ('Objective #' + key)) + '</li>';
          });
          customObjs.forEach(function (c) {
            html += '<li>' + esc(String(c)) + '</li>';
          });
          html += '</ul>';
        }
        // The 201 map: a Drive JPG shared by link. Offline it just doesn't load (no image in the snapshot).
        if (data.ics201.map_image_url) {
          var mapView = 'https://drive.google.com/file/d/' + encodeURIComponent((/[?&]id=([\w-]+)/.exec(data.ics201.map_image_url) || [])[1] || '') + '/view';
          html += '<div class="card-body" style="margin-top:8px;"><strong>Map:</strong>' +
            '<a href="' + esc(mapView) + '" target="_blank" rel="noopener"><img src="' + esc(data.ics201.map_image_url) +
            '" alt="ICS 201 map" loading="lazy" style="display:block;width:100%;height:auto;margin-top:4px;border-radius:6px;" onerror="this.style.display=\'none\'"></a></div>';
        }
        html += '</div></div>';
      }

      // ---------- ICS 205 Radio Communications Plan (Logistics) ----------
      // One card per channel: a 5-column table overflows on mobile.
      var cp = data.comms205;
      if (cp && !cp.error && ((cp.channels || []).length || cp.specialInstructions)) {
        html += '<div class="sitstat-section">';
        html += '<div class="sitstat-section-header"><h3>ICS 205 - Communications Plan</h3>' + asOfShift(cp.opFrom, cp.opTo) + '</div>';
        html += '<div class="card-body" style="font-size:0.78rem; margin-bottom:8px;">' + esc(cp.status || 'Draft');
        if (cp.opFrom || cp.opTo) html += ' &mdash; Op period ' + esc(cp.opFrom || '') + (cp.opTo ? ' to ' + esc(cp.opTo) : '');
        if (cp.preparedBy) html += ' &mdash; Prepared by ' + esc(cp.preparedBy);
        html += '</div>';
        (cp.channels || []).forEach(function (ch) {
          var tone = function (f, t) { return [f, t ? '(' + t + ')' : ''].filter(Boolean).join(' '); };
          var rx = tone(ch.RxFreq, ch.RxTone), tx = tone(ch.TxFreq, ch.TxTone);
          var freq = (!tx || tx === rx) ? esc(rx) : 'RX ' + esc(rx || '-') + ' / TX ' + esc(tx);
          html += '<div class="sitstat-card">';
          html += '<div class="card-title">' + esc([ch['Channel#'], ch.ChannelName].filter(Boolean).join(' - ') || 'Channel') +
            (ch['Zone/Group'] ? ' <span style="font-weight:400; color:var(--text-muted);">(' + esc(ch['Zone/Group']) + ')</span>' : '') + '</div>';
          if (freq) html += '<div class="card-body"><strong>Freq:</strong> ' + freq + (ch.Mode ? ' &middot; Mode ' + esc(ch.Mode) : '') + '</div>';
          if (ch.Function || ch.Assignment) html += '<div class="card-body">' + [ch.Function, ch.Assignment].filter(Boolean).map(esc).join(' &mdash; ') + '</div>';
          if (ch.Remarks) html += '<div class="card-body" style="color:var(--text-muted);">' + esc(ch.Remarks) + '</div>';
          html += '</div>';
        });
        if (cp.specialInstructions) {
          html += '<div class="sitstat-card"><div class="card-body" style="white-space:pre-wrap;"><strong>Special instructions:</strong> ' + esc(cp.specialInstructions) + '</div></div>';
        }
        if (cp.pdfUrl) html += '<div class="card-body"><a href="' + esc(cp.pdfUrl) + '" target="_blank" rel="noopener">ICS 205 PDF</a></div>';
        html += '</div>';
      }

      // ---------- Notifications ----------
      // Full-width stacked cards (a 6-column table overflows on mobile).
      if (data.notifications && data.notifications.length) {
        html += '<div class="sitstat-section">';
        html += '<div class="sitstat-section-header"><h3>Notifications</h3></div>';
        data.notifications.forEach(function (n) {
          var title = esc(n.organization || n.person || 'Notification');
          html += '<div class="sitstat-card">';
          html += '<div class="card-title">' + title +
            (n.datetime ? ' <span style="font-weight:400;color:var(--text-muted);font-size:0.82em;">' + esc(n.datetime) + '</span>' : '') +
            '</div>';
          html += '<div class="card-body">';
          if (n.person && n.organization) html += '<div>' + esc(n.person) + '</div>';
          if (n.phone) html += '<div>' + esc(n.phone) + '</div>';
          if (n.notified_by) html += '<div>Notified by ' + esc(n.notified_by) + '</div>';
          if (n.notes) html += '<div>' + esc(n.notes) + '</div>';
          html += '</div></div>';
        });
        html += '</div>';
      }

      // ---------- Actions ----------
      var currentActions = (data.actions && data.actions.current) || [];
      var plannedActions = (data.actions && data.actions.planned) || [];
      if (currentActions.length || plannedActions.length) {
        html += '<div class="sitstat-section">';
        html += '<div class="sitstat-section-header"><h3>Actions</h3>' + asOf(newestOf(currentActions.concat(plannedActions).map(function (a) { return a.datetime; }))) + '</div>';
        html += '<table class="sitstat-table"><thead><tr>' +
          '<th style="white-space:nowrap;width:1%;">Type</th>' +
          '<th style="white-space:nowrap;">Time</th>' +
          '<th>Action</th></tr></thead><tbody>';
        currentActions.forEach(function (a) {
          html += '<tr><td style="text-align:center;"><span class="badge badge-active" style="font-weight:700;">C</span></td>';
          html += '<td style="white-space:nowrap;">' + esc(a.datetime || '') + '</td>';
          html += '<td>' + esc(maskSerials(a.action || '')) + '</td></tr>';
        });
        plannedActions.forEach(function (a) {
          html += '<tr><td style="text-align:center;"><span class="badge badge-pending" style="font-weight:700;">P</span></td>';
          html += '<td style="white-space:nowrap;">' + esc(a.datetime || '') + '</td>';
          html += '<td>' + esc(a.action || '') + '</td></tr>';
        });
        html += '</tbody></table></div>';
      }

      // ---------- Org Chart ----------
      if (data.orgChart && data.orgChart.icsAssignments) {
        html += '<div class="sitstat-section">';
        html += '<div class="sitstat-section-header"><h3>Organization</h3></div>';

        var assignments = data.orgChart.icsAssignments;
        var activeRaw = data.orgChart.activePositions || '';
        var activePositions;
        if (Array.isArray(activeRaw)) {
          activePositions = activeRaw;
        } else if (typeof activeRaw === 'string' && activeRaw) {
          activePositions = activeRaw.split(',').map(function (s) { return s.trim(); });
        } else {
          activePositions = Object.keys(assignments);
        }

        var sectionNames = { command: 'Command', operations: 'Operations', planning: 'Planning', logistics: 'Logistics', finance: 'Finance/Admin' };
        var rendered = {};

        Object.keys(ICS_SECTIONS).forEach(function (section) {
          var rows = [];
          ICS_SECTIONS[section].forEach(function (posKey) {
            if (activePositions.indexOf(posKey) === -1 && !assignments[posKey]) return;
            var raw = assignments[posKey];
            if (!raw) return;
            rendered[posKey] = true;
            var names = peopleNames(raw, data.contacts);
            if (!names) return;
            var label = ICS_POSITION_LABELS[posKey] || posKey.toUpperCase();
            rows.push('<tr><td>' + esc(label) + '</td><td>' + names + '</td></tr>');
          });
          if (rows.length) {
            html += orgSectionHeader(sectionNames[section]);
            html += '<table class="sitstat-table"><thead><tr><th>Position</th><th>Personnel</th></tr></thead><tbody>';
            html += rows.join('');
            html += '</tbody></table>';
          }
        });

        // Positions not in the standard sections
        var extraRows = [];
        Object.keys(assignments).forEach(function (posKey) {
          if (rendered[posKey]) return;
          if (activePositions.indexOf(posKey) === -1) return;
          var raw = assignments[posKey];
          if (!raw) return;
          var names = peopleNames(raw, data.contacts);
          if (!names) return;
          var label = ICS_POSITION_LABELS[posKey] ||
            posKey.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
          extraRows.push('<tr><td>' + esc(label) + '</td><td>' + names + '</td></tr>');
        });
        if (extraRows.length) {
          html += orgSectionHeader('Other');
          html += '<table class="sitstat-table"><thead><tr><th>Position</th><th>Personnel</th></tr></thead><tbody>';
          html += extraRows.join('');
          html += '</tbody></table>';
        }

        html += '</div>';
      }

      // ---------- Resources (T-Cards) ----------
      if (data.tCards && data.tCards.length) {
        html += '<div class="sitstat-section">';
        html += '<div class="sitstat-section-header"><h3>Resources</h3></div>';
        var groups = {};
        data.tCards.forEach(function (tc) {
          var grp = tc.assignment || 'Unassigned';
          if (!groups[grp]) groups[grp] = [];
          groups[grp].push(tc);
        });
        Object.keys(groups).forEach(function (grp) {
          html += '<div style="margin-bottom:6px; font-size:0.78rem; font-weight:600; text-transform:uppercase; color:var(--text-muted); padding-top:6px;">' + esc(grp) + '</div>';
          groups[grp].forEach(function (tc) {
            var statusLower = (tc.status || '').toLowerCase();
            var statusClass = statusLower === 'available' || statusLower === 'staged' ? 'status-available' :
              statusLower === 'assigned' || statusLower === 'deployed' ? 'status-assigned' : 'status-oos';
            html += '<div class="t-card ' + statusClass + '">';
            html += '<div class="t-header">';
            html += '<span class="t-name">' + esc(maskSerials(tc.identifier || 'Unknown')) + '</span>';
            html += '<span class="badge badge-' + getTypeBadgeClass(tc.type) + '">' + esc(tc.type || 'other') + '</span>';
            html += '</div>';
            if (tc.capability) html += '<div class="t-type">' + esc(maskSerials(tc.capability)) + '</div>';
            html += '<div class="t-detail">Status: ' + esc(tc.status || 'Unknown') + '</div>';
            html += '</div>';
          });
        });
        html += '</div>';
      }

      // ---------- Work assignments (G3 2026-11-10: cards, not a table that scrolls sideways) ----------
      if (data.assignments && data.assignments.length) {
        html += '<div class="sitstat-section">';
        html += '<div class="sitstat-section-header"><h3>Work Assignments (Operations)</h3>' +
          asOf(data.assignments.map(function (a) { return String(a.date || ''); }).sort().pop() || '') + '</div>';
        data.assignments.forEach(function (a) {
          var lines = String(a.tactics || '').split('\n');
          var head = lines.shift() || a.location || 'Assignment';
          var when = [a.date ? fmtDay(a.date) : '', [a.start, a.finish].filter(Boolean).join('\u2013')].filter(Boolean).join(' ');
          html += '<div class="sitstat-card wa-card">';
          html += '<div class="card-title">' + esc(maskSerials(head)) + statusBadge(a.status) + '</div>';
          html += '<div class="card-body wa-meta">' + [a.location, [a.branch, a.group].filter(Boolean).join(' / '), when]
            .filter(Boolean).map(esc).join(' &middot; ') + '</div>';
          var rest = lines.join('\n').trim();
          if (rest) html += '<div class="card-body" style="white-space:pre-wrap;">' + esc(maskSerials(rest)) + '</div>';
          html += '</div>';
        });
        html += '</div>';
      }

      // ---------- Open Requests ----------
      if (data.openRequests && data.openRequests.length) {
        html += '<div class="sitstat-section">';
        html += '<div class="sitstat-section-header"><h3>Open Requests</h3></div>';
        html += '<table class="sitstat-table"><thead><tr><th>ID</th><th>Item</th><th>Qty</th><th>Priority</th><th>Status</th><th>Requester</th></tr></thead><tbody>';
        data.openRequests.forEach(function (r) {
          html += '<tr>';
          html += '<td>' + esc(r.request_id || '') + '</td>';
          html += '<td>' + esc(r.requested_item || '') + '</td>';
          html += '<td>' + esc(String(r.qty || '')) + '</td>';
          html += '<td>' + esc(r.priority || '') + '</td>';
          html += '<td>' + esc(r.status || '') + '</td>';
          html += '<td>' + esc(r.requester_name || '') + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div>';
      }

      // ---------- HASP (Google Docs preview iframe) ----------
      if (data.hasp && !data.hasp.error) {
        html += '<div class="sitstat-section">';
        html += '<div class="sitstat-section-header"><h3>HASP</h3>' + asOf(data.hasp.timestamp) + '</div>';
        html += '<div class="sitstat-card">';
        if (data.hasp.projectName) html += '<div class="card-title">' + esc(data.hasp.projectName) + '</div>';
        html += '<div class="card-body" style="font-size:0.78rem; margin-bottom:8px;">';
        if (data.hasp.client) html += 'Client: ' + esc(data.hasp.client) + '<br>';
        if (data.hasp.location) html += 'Location: ' + esc(data.hasp.location) + '<br>';
        if (data.hasp.creator) html += 'Created by: ' + esc(data.hasp.creator) + '<br>';
        if (data.hasp.timestamp) html += 'Written: ' + esc(isFinite(parseWhen(data.hasp.timestamp)) ? fmtDay(data.hasp.timestamp) : data.hasp.timestamp);
        html += '</div>';
        if (data.hasp.docUrl) {
          var previewUrl = data.hasp.docUrl.replace(/\/edit.*$/, '/preview');
          html += '<div style="margin:8px 0;"><iframe src="' + escAttr(previewUrl) + '" style="width:100%; height:400px; border:1px solid var(--border); border-radius:var(--radius-sm);" loading="lazy"></iframe></div>';
          html += '<div style="display:flex; gap:10px; margin-top:8px;">';
          html += '<a href="' + escAttr(data.hasp.docUrl) + '" target="_blank" rel="noopener" style="color:var(--info); font-size:0.82rem;">Open in Docs</a>';
          if (data.hasp.url) {
            html += '<a href="' + escAttr(data.hasp.url) + '" target="_blank" rel="noopener" style="color:var(--info); font-size:0.82rem;">Download PDF</a>';
          }
          html += '</div>';
        }
        html += '</div></div>';
      } else if (data.hasp && data.hasp.error) {
        html += '<div class="sitstat-section">';
        html += '<div class="sitstat-section-header"><h3>HASP</h3></div>';
        html += '<div class="sitstat-card"><div class="card-body" style="color:var(--text-muted);">' + esc(data.hasp.error) + '</div></div>';
        html += '</div>';
      }

      // ---------- Check-In Roster (when the API includes it) ----------
      if (Array.isArray(data.roster)) {
        html += '<div class="sitstat-section" id="rosterSection">';
        html += '<div class="sitstat-section-header"><h3>Check-In Roster</h3></div>';
        html += '<div id="rosterContent">' + buildRosterHtml(data.roster) + '</div>';
        html += '</div>';
      }

      // ---------- 201 Attachments (PDFs) ----------
      var attachments = data.attachments;
      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        html += '<div class="sitstat-section">';
        html += '<div class="sitstat-section-header"><h3>201 Attachments (' + attachments.length + ')</h3></div>';
        html += '<div style="display:flex;flex-direction:column;gap:6px;">';
        attachments.forEach(function (a) {
          html += '<a href="' + escAttr(a.url || '#') + '" target="_blank" rel="noopener" ' +
            'style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--panel-light);' +
            'border:1px solid var(--border);border-radius:4px;color:var(--text);' +
            'text-decoration:none;font-size:0.85rem;">' +
            '<span style="font-size:16px;">&#128196;</span>' +
            '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(a.name || 'Attachment') + '</span>' +
            '<span style="font-size:0.7rem;color:var(--text-muted);">PDF</span>' +
            '</a>';
        });
        html += '</div></div>';
      }

      if (!html) {
        html = '<div class="empty-state"><p>No situational data posted yet</p></div>';
      }

    } catch (e) {
      html = '<div style="color:#e94560;padding:20px;">Sit Stat render error: ' + esc(e.message) + '</div>';
    }
    container.innerHTML = html;
  }

  /* ---------- G3 2026-11-10: how old each section is, and a current-status box ---------- */
  var STALE_MS = 12 * 3600 * 1000;   // one shift
  function ago(ms) {
    var m = Math.round((Date.now() - ms) / 60000);
    if (m < 60) return m <= 1 ? 'just now' : m + ' min ago';
    var h = Math.round(m / 60); if (h < 36) return h + ' h ago';
    return Math.round(h / 24) + ' days ago';
  }
  function fmtDay(v) {
    var t = parseWhen(v); if (!isFinite(t)) return String(v || '');
    var dateOnly = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
    return new Date(t).toLocaleString([], dateOnly ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function newestOf(list) {
    var best = NaN;
    (list || []).forEach(function (v) { var t = parseWhen(v); if (isFinite(t) && t <= Date.now() + 36e5 && !(t <= best)) best = t; });
    return best;
  }
  /** "as of" chip for a section; amber "older than this shift" past STALE_MS. */
  function asOf(v) {
    var t = typeof v === 'number' ? v : parseWhen(v);
    if (!isFinite(t)) return '';
    var dayOnly = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
    var old = Date.now() - (dayOnly ? t + 864e5 : t) > STALE_MS;
    if (dayOnly) return '<span class="asof' + (old ? ' asof-old' : '') + '">' + (old ? '&#9888; ' : '') + 'for ' + esc(fmtDay(v)) +
      (old ? ' &middot; older than this shift' : '') + '</span>';
    return '<span class="asof' + (old ? ' asof-old' : '') + '">' + (old ? '&#9888; ' : '') + 'as of ' + esc(fmtDay(t)) +
      (old ? ' &middot; older than this shift' : '') + '</span>';
  }
  /** A plan with an operational period: stale once that period has ended. */
  function asOfShift(from, to) {
    var end = parseWhen(to), start = parseWhen(from);
    if (isFinite(end)) {
      var over = end < Date.now();
      return '<span class="asof' + (over ? ' asof-old' : '') + '">' + (over ? '&#9888; shift ended ' : 'until ') + esc(fmtDay(end)) + '</span>';
    }
    return asOf(start);
  }
  function statusBadge(st) {
    var s = String(st || '').trim(); if (!s) return '';
    var cls = /complete|done/i.test(s) ? 'badge-active' : /progress|working|assigned/i.test(s) ? 'badge-type' : 'badge-pending';
    return ' <span class="badge ' + cls + '" style="margin-left:6px;">' + esc(s) + '</span>';
  }
  function newestInfo(d) {
    var acts = ((d.actions && d.actions.current) || []).concat((d.actions && d.actions.planned) || []);
    return newestOf([d.ics201 && d.ics201.datetime, d.comms205 && d.comms205.opFrom, d.hasp && d.hasp.timestamp]
      .concat(acts.map(function (a) { return a.datetime; }))
      .concat((d.assignments || []).map(function (a) { return a.date; })));
  }
  function workChartPeople(oc) {
    var names = {};
    if (!oc || !oc.icsAssignments) return 0;
    Object.keys(oc.icsAssignments).forEach(function (k) {
      var raw = oc.icsAssignments[k], people = [];
      try { people = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []); } catch (e) { people = raw ? [{ name: String(raw) }] : []; }
      people.forEach(function (p) { var n = String((p && p.name) || '').trim().toLowerCase(); if (n) names[n] = 1; });
    });
    return Object.keys(names).length;
  }
  function statusBox(d) {
    var acts = ((d.actions && d.actions.current) || []).slice();
    acts.sort(function (a, b) { return (parseWhen(b.datetime) || 0) - (parseWhen(a.datetime) || 0); });
    var latest = acts[0];
    var newest = newestInfo(d), old = isFinite(newest) && Date.now() - newest > STALE_MS;
    var onScene = Array.isArray(d.roster) ? d.roster.length : null;
    var staff = workChartPeople(d.orgChart);
    var byType = {};
    (d.tCards || []).forEach(function (t) { var k = String(t.type || 'Other').trim() || 'Other'; byType[k] = (byType[k] || 0) + 1; });
    var equip = Object.keys(byType).sort().map(function (k) { return byType[k] + ' ' + k.toLowerCase(); }).join(', ');
    var openReq = (d.openRequests || []).length;
    var sm = d.safetyMessage && !d.safetyMessage.error ? d.safetyMessage : null;
    var h = '<div class="sitstat-card status-box' + (old ? ' status-old' : '') + '">';
    h += '<div class="card-title">' + esc(window.t('st.title')) + '</div>';
    if (isFinite(newest)) h += '<div class="status-age' + (old ? ' asof-old' : '') + '">' + (old ? '&#9888; ' : '') +
      esc(window.t('st.newest')) + ' ' + esc(fmtDay(newest)) + ' (' + esc(ago(newest)) + ')' +
      (old ? '. ' + esc(window.t('st.oldTail')) : '') + '</div>';
    if (latest) h += '<div class="status-row"><b>' + esc(window.t('st.latest')) + '</b> ' + esc(latest.action || '') +
      (latest.datetime ? ' <span class="muted">(' + esc(fmtDay(latest.datetime)) + ')</span>' : '') + '</div>';
    h += '<div class="status-row"><b>' + esc(window.t('st.people')) + '</b> ' + (onScene != null ? esc(window.t('st.checkedIn', { n: onScene })) : esc(window.t('st.noCheckins'))) +
      (staff ? ' &middot; ' + esc(window.t('st.onChart', { n: staff })) : '') + '</div>';
    if (equip) h += '<div class="status-row"><b>' + esc(window.t('st.equip')) + '</b> ' + esc(equip) + '</div>';
    h += '<div class="status-row"><b>' + esc(window.t('st.req')) + '</b> ' + esc(String(openReq)) + '</div>';
    if (sm && (sm.message || (sm.hazards || []).length)) {
      h += '<div class="status-row"><b>' + esc(window.t('st.safety')) + '</b> ' + esc(String(sm.message || '').split('\n')[0].slice(0, 160)) +
        ((sm.hazards || []).length ? ' <span class="muted">(' + sm.hazards.length + ' hazards listed)</span>' : '') + '</div>';
    }
    return h + '</div>';
  }

  window.addEventListener('wri-lang', function () {
    var el = document.getElementById('sitstatContent');
    if (window.__sitstat && el && el.querySelector('.status-box')) renderSitStat(window.__sitstat, el);
  });

  function orgSectionHeader(label) {
    return '<div style="margin-bottom:8px; font-size:0.78rem; font-weight:600; text-transform:uppercase; color:var(--text-muted); padding-top:6px;">' + esc(label) + '</div>';
  }

  function peopleNames(raw, contacts) {
    var phones = (contacts && contacts.phones) || {};
    var people = [];
    try {
      people = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
    } catch (e) {
      people = [{ name: String(raw), org: '' }];
    }
    if (!people.length) return '';
    return people.map(function (p) {
      var display = esc(p.name || '');
      if (p.org) display += ' (' + esc(p.org) + ')';
      var ph = phones[String(p.name || '').trim().toLowerCase().replace(/\s+/g, ' ')];
      if (ph) display += ' ' + phoneCell(ph);   // G4: call buttons on the org chart
      return display;
    }).join(', ');
  }

  function buildRosterHtml(roster) {
    if (!roster || !roster.length) {
      return '<div class="empty-state"><p>No check-ins recorded</p></div>';
    }
    // The API roster only contains people currently on site (check-out rows
    // remove them server-side), so there is no Check Out column — Phone
    // rides in its place as a tap-to-call link.
    var html = '<table class="sitstat-table"><thead><tr><th>Name</th><th>Org</th><th>Position</th><th>Phone</th><th>Check In</th></tr></thead><tbody>';
    roster.forEach(function (r) {
      html += '<tr>';
      html += '<td>' + esc(r.name || '') + '</td>';
      html += '<td>' + esc(r.organization || '') + '</td>';
      html += '<td>' + esc(r.position || '') + '</td>';
      html += '<td>' + phoneCell(r.phone) + '</td>';
      html += '<td>' + esc(r.check_in_time || '') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function phoneCell(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    var digits = s.replace(/[^\d+]/g, '');
    if (digits.replace(/\D/g, '').length < 7) return esc(s);
    return '<a href="tel:' + escAttr(digits) + '" style="color:inherit;white-space:nowrap;">' + esc(s) + '</a>';
  }

  /* ═══════════════════════════════════════════
     AUTO REFRESH (90s ± jitter while tab is active and page visible)
     ═══════════════════════════════════════════ */
  function sitStatTabActive() {
    return window.APP && APP.currentTab === 'sitstat' && APP.session;
  }

  window.startSitStatAutoRefresh = function () {
    stopSitStatAutoRefresh();
    sitStatTimer = setTimeout(function tick() {
      // Skip the poll when the tab/phone is backgrounded — a pocketed phone
      // polling every 60s was steady load that scaled with crowd size.
      var visible = (typeof document.hidden === 'undefined') || !document.hidden;
      if (visible && sitStatTabActive()) loadSitStat();
      sitStatTimer = setTimeout(tick, nextRefreshDelay());
    }, nextRefreshDelay());
  };

  window.stopSitStatAutoRefresh = function () {
    if (sitStatTimer) {
      clearTimeout(sitStatTimer);
      sitStatTimer = null;
    }
  };

  // Refresh once on regaining visibility so a returning user isn't stale
  // (polls were skipped while hidden).
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && sitStatTimer && sitStatTabActive()) loadSitStat();
  });
})();
