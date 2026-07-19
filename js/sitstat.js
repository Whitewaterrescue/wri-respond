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
  var REFRESH_MS = 60 * 1000;

  var OBJ_TEXTS = {
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

  var ICS_SECTIONS = {
    command: ['ic', 'deputy_ic', 'sofr', 'pio', 'lofr', 'fosc', 'sosc', 'losc'],
    operations: ['osc', 'deputy_osc', 'stam', 'divs', 'grps', 'tfld', 'strl'],
    planning: ['psc', 'deputy_psc', 'sitl', 'resl', 'docl', 'demob', 'envl', 'tech'],
    logistics: ['lsc', 'deputy_lsc', 'fdul', 'medl', 'coml', 'supl', 'gsl'],
    finance: ['fsc', 'deputy_fsc', 'cost', 'time', 'proc', 'comp']
  };

  window.loadSitStat = function () {
    var contentEl = document.getElementById('sitstatContent');
    var refreshEl = document.getElementById('sitstatLastRefresh');

    apiGet('sitstat')
      .then(function (data) {
        if (!data) {
          contentEl.innerHTML = '<div class="empty-state"><p>No situational data available</p></div>';
          return;
        }
        renderSitStat(data, contentEl);
        refreshEl.textContent = 'Updated ' + formatTime(new Date().toISOString());
      })
      .catch(function (err) {
        if (handleAuthError(err)) return;
        contentEl.innerHTML = '<div class="empty-state"><p>Error loading data: ' + esc(friendlyError(err)) + '</p></div>';
        refreshEl.textContent = 'Update failed';
      });
  };

  function renderSitStat(data, container) {
    var html = '';
    try {

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
        html += '<div class="sitstat-section-header"><h3>ICS 201 - Incident Summary</h3></div>';
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
        html += '</div></div>';
      }

      // ---------- Notifications ----------
      if (data.notifications && data.notifications.length) {
        html += '<div class="sitstat-section">';
        html += '<div class="sitstat-section-header"><h3>Notifications</h3></div>';
        html += '<table class="sitstat-table"><thead><tr>';
        html += '<th>DateTime</th><th>Organization</th><th>Person</th><th>Phone</th><th>Notified By</th><th>Notes</th>';
        html += '</tr></thead><tbody>';
        data.notifications.forEach(function (n) {
          html += '<tr>';
          html += '<td>' + esc(n.datetime || '') + '</td>';
          html += '<td>' + esc(n.organization || '') + '</td>';
          html += '<td>' + esc(n.person || '') + '</td>';
          html += '<td>' + esc(n.phone || '') + '</td>';
          html += '<td>' + esc(n.notified_by || '') + '</td>';
          html += '<td>' + esc(n.notes || '') + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div>';
      }

      // ---------- Actions ----------
      var currentActions = (data.actions && data.actions.current) || [];
      var plannedActions = (data.actions && data.actions.planned) || [];
      if (currentActions.length || plannedActions.length) {
        html += '<div class="sitstat-section">';
        html += '<div class="sitstat-section-header"><h3>Actions</h3></div>';
        html += '<table class="sitstat-table"><thead><tr>' +
          '<th style="white-space:nowrap;width:1%;">Type</th>' +
          '<th style="white-space:nowrap;">Time</th>' +
          '<th>Action</th></tr></thead><tbody>';
        currentActions.forEach(function (a) {
          html += '<tr><td style="text-align:center;"><span class="badge badge-active" style="font-weight:700;">C</span></td>';
          html += '<td style="white-space:nowrap;">' + esc(a.datetime || '') + '</td>';
          html += '<td>' + esc(a.action || '') + '</td></tr>';
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
            var names = peopleNames(raw);
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
          var names = peopleNames(raw);
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
            html += '<span class="t-name">' + esc(tc.identifier || 'Unknown') + '</span>';
            html += '<span class="badge badge-' + getTypeBadgeClass(tc.type) + '">' + esc(tc.type || 'other') + '</span>';
            html += '</div>';
            if (tc.capability) html += '<div class="t-type">' + esc(tc.capability) + '</div>';
            html += '<div class="t-detail">Status: ' + esc(tc.status || 'Unknown') + '</div>';
            html += '</div>';
          });
        });
        html += '</div>';
      }

      // ---------- Assignments ----------
      if (data.assignments && data.assignments.length) {
        html += '<div class="sitstat-section">';
        html += '<div class="sitstat-section-header"><h3>Assignments</h3></div>';
        html += '<table class="sitstat-table"><thead><tr>' +
          '<th style="white-space:nowrap;">Location</th>' +
          '<th style="white-space:nowrap;">Group</th>' +
          '<th style="white-space:nowrap;">Tactic</th></tr></thead><tbody>';
        data.assignments.forEach(function (a) {
          html += '<tr>';
          html += '<td>' + esc(a.location || '') + '</td>';
          html += '<td>' + esc(a.group || '') + '</td>';
          html += '<td>' + esc(a.tactics || '') + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div>';
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
        html += '<div class="sitstat-section-header"><h3>HASP</h3></div>';
        html += '<div class="sitstat-card">';
        if (data.hasp.projectName) html += '<div class="card-title">' + esc(data.hasp.projectName) + '</div>';
        html += '<div class="card-body" style="font-size:0.78rem; margin-bottom:8px;">';
        if (data.hasp.client) html += 'Client: ' + esc(data.hasp.client) + '<br>';
        if (data.hasp.location) html += 'Location: ' + esc(data.hasp.location) + '<br>';
        if (data.hasp.creator) html += 'Created by: ' + esc(data.hasp.creator) + '<br>';
        if (data.hasp.timestamp) html += 'Timestamp: ' + esc(data.hasp.timestamp);
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

  function orgSectionHeader(label) {
    return '<div style="margin-bottom:8px; font-size:0.78rem; font-weight:600; text-transform:uppercase; color:var(--text-muted); padding-top:6px;">' + esc(label) + '</div>';
  }

  function peopleNames(raw) {
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
      return display;
    }).join(', ');
  }

  function buildRosterHtml(roster) {
    if (!roster || !roster.length) {
      return '<div class="empty-state"><p>No check-ins recorded</p></div>';
    }
    var html = '<table class="sitstat-table"><thead><tr><th>Name</th><th>Org</th><th>Position</th><th>Check In</th><th>Check Out</th></tr></thead><tbody>';
    roster.forEach(function (r) {
      html += '<tr>';
      html += '<td>' + esc(r.name || '') + '</td>';
      html += '<td>' + esc(r.organization || '') + '</td>';
      html += '<td>' + esc(r.position || '') + '</td>';
      html += '<td>' + esc(r.check_in_time || '') + '</td>';
      html += '<td>' + esc(r.check_out_time || '') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  /* ═══════════════════════════════════════════
     AUTO REFRESH (60s while tab is active)
     ═══════════════════════════════════════════ */
  window.startSitStatAutoRefresh = function () {
    stopSitStatAutoRefresh();
    sitStatTimer = setInterval(function () {
      if (window.APP && APP.currentTab === 'sitstat' && APP.session) loadSitStat();
    }, REFRESH_MS);
  };

  window.stopSitStatAutoRefresh = function () {
    if (sitStatTimer) {
      clearInterval(sitStatTimer);
      sitStatTimer = null;
    }
  };
})();
