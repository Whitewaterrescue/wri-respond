/* WRI Respond — resource upload flow + Resources tab.
 * Modes: photo / document (AI parse via API), CSV (client-side column
 * mapping), manual form, voice (Web Speech, optional). All writes go through
 * the token-free JSON API; parsed cards are user-editable before submit.
 */
(function () {
  'use strict';

  var pendingResources = [];
  var activeLocations = [];
  var voiceRecognition = null;
  var voiceIsRecording = false;
  var voiceTranscriptText = '';

  var CSV_FIELDS = ['resource_type', 'identifier', 'capability', 'crew_count', 'status', 'notes', '-- skip --'];

  /* ═══════════════════════════════════════════
     SCREEN ENTRY / EXIT
     ═══════════════════════════════════════════ */
  window.openResourceUpload = function () {
    pendingResources = [];
    resetUploadWorkspace();
    loadActiveLocations();
    showScreen('resource-upload');
  };

  window.skipResourceUpload = function () {
    enterMainApp();
  };

  /* ═══════════════════════════════════════════
     INPUT MODE SELECTION
     ═══════════════════════════════════════════ */
  window.selectInputMode = function (mode) {
    // Highlight the tapped button. Inline handlers don't pass the event, so
    // use window.event when available; otherwise match the button by its
    // onclick attribute.
    var buttons = document.querySelectorAll('.mode-btn');
    for (var i = 0; i < buttons.length; i++) buttons[i].classList.remove('selected');
    var evt = window.event;
    if (evt && evt.currentTarget && evt.currentTarget.classList) {
      evt.currentTarget.classList.add('selected');
    } else {
      for (var j = 0; j < buttons.length; j++) {
        var oc = buttons[j].getAttribute('onclick') || '';
        if (oc.indexOf("'" + mode + "'") > -1) { buttons[j].classList.add('selected'); break; }
      }
    }

    var panels = document.querySelectorAll('.workspace-panel');
    for (var k = 0; k < panels.length; k++) panels[k].classList.remove('active');
    var ws = document.getElementById('ws-' + mode);
    if (ws) ws.classList.add('active');

    // Every workspace takes the whole viewport on phones — hide the header +
    // mode grid while one is active (the shared top bar has a Back button).
    setModeFull(true, MODE_TITLES[mode] || 'Log Resources');
    if (mode === 'wrrl') initWrrlMode();
  };

  var MODE_TITLES = {
    photo: 'Photo of Equipment',
    document: 'Photo of Document',
    csv: 'Upload File',
    manual: 'Fill Out Form',
    voice: 'Voice Entry',
    wrrl: 'Company Equipment List'
  };

  function setModeFull(on, title) {
    var screen = document.getElementById('screen-resource-upload');
    if (screen) screen.classList.toggle('mode-full', !!on);
    var titleEl = document.getElementById('wsTopbarTitle');
    if (titleEl) titleEl.textContent = on ? (title || '') : '';
  }

  // Back button on the shared top bar: restore the mode grid. Pending review
  // cards are kept — adding another resource re-opens the review view.
  window.exitModeFull = function () {
    setModeFull(false);
    var panels = document.querySelectorAll('.workspace-panel');
    for (var i = 0; i < panels.length; i++) panels[i].classList.remove('active');
    var buttons = document.querySelectorAll('.mode-btn');
    for (var j = 0; j < buttons.length; j++) buttons[j].classList.remove('selected');
  };

  function resetUploadWorkspace() {
    setModeFull(false);
    var panels = document.querySelectorAll('.workspace-panel');
    for (var i = 0; i < panels.length; i++) panels[i].classList.remove('active');
    var buttons = document.querySelectorAll('.mode-btn');
    for (var j = 0; j < buttons.length; j++) buttons[j].classList.remove('selected');
    document.getElementById('photoPreview').innerHTML = '';
    document.getElementById('docPreview').innerHTML = '';
    document.getElementById('csvWorkArea').innerHTML = '';
    document.getElementById('confirmCards').innerHTML = '';
    document.getElementById('voiceTranscript').textContent = 'Your speech will appear here...';
    voiceTranscriptText = '';
    // WRRL checklist: drop selections but keep the loaded org/catalog so
    // "+ Add More" doesn't force a re-pick (initWrrlMode refreshes dup badges).
    wrrlSelected = {};
    wrrlBoomFt = {};
    var wrrlBody = document.getElementById('wrrlListBody');
    if (wrrlBody) wrrlBody.innerHTML = '';
    var wrrlStatus = document.getElementById('wrrlStatus');
    if (wrrlStatus) wrrlStatus.textContent = '';
    var success = document.getElementById('ws-success');
    if (success) success.parentNode.removeChild(success);
  }

  function showAnalyzing(msg) {
    var panels = document.querySelectorAll('.workspace-panel');
    for (var i = 0; i < panels.length; i++) panels[i].classList.remove('active');
    document.getElementById('ws-analyzing').classList.add('active');
    document.getElementById('analyzingText').textContent = msg || 'Analyzing...';
  }

  function hideAnalyzing() {
    document.getElementById('ws-analyzing').classList.remove('active');
  }

  // Server may return an array of cards or a wrapped shape — normalize.
  function normalizeParsed(result) {
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.resources)) return result.resources;
    if (result && (result.identifier || result.resource_type)) return [result];
    return [];
  }

  /* ═══════════════════════════════════════════
     PHOTO / DOCUMENT CAPTURE  (mode: 'photo' | 'document')
     ═══════════════════════════════════════════ */
  window.handlePhotoCapture = function (event, type) {
    var file = event.target.files[0];
    event.target.value = ''; // allow re-picking the same file
    if (!file) return;

    showAnalyzing(type === 'photo' ? 'Analyzing photo...' : 'Analyzing document...');

    downscaleImage(file, function (dataUri) {
      if (!dataUri) {
        hideAnalyzing();
        document.getElementById('ws-' + type).classList.add('active');
        showToast('Could not read that image.', true);
        return;
      }
      apiPost('resource-parse', { mode: type, data: dataUri })
        .then(function (result) {
          hideAnalyzing();
          var resources = normalizeParsed(result);
          if (resources.length) {
            pendingResources = resources;
            showConfirmationCards();
          } else {
            showToast('No resources detected. Try another image or use manual entry.', true);
            document.getElementById('ws-' + type).classList.add('active');
          }
        })
        .catch(function (err) {
          hideAnalyzing();
          document.getElementById('ws-' + type).classList.add('active');
          if (handleAuthError(err)) return;
          showToast('Analysis error: ' + friendlyError(err), true);
        });
    });
  };

  /* ═══════════════════════════════════════════
     FILE UPLOAD (CSV / image / PDF)
     ═══════════════════════════════════════════ */
  window.handleFileUpload = function (event) {
    var file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    var name = file.name.toLowerCase();

    // CSV / TSV / TXT — parse and map columns client-side
    if (/\.(csv|tsv|txt)$/.test(name)) {
      var reader = new FileReader();
      reader.onload = function (e) {
        var rows = parseCSV(e.target.result);
        if (rows.length < 2) { showToast('File has no data rows.', true); return; }
        showCSVMapping(rows[0], rows.slice(1));
      };
      reader.readAsText(file);
      return;
    }

    // Images — downscale then AI-parse as document
    if (/\.(jpg|jpeg|png|gif|webp)$/.test(name)) {
      showAnalyzing('Analyzing image...');
      downscaleImage(file, function (dataUri) {
        if (!dataUri) { hideAnalyzing(); showToast('Could not read that image.', true); return; }
        parseAsDocument(dataUri);
      });
      return;
    }

    // PDFs — send raw data URI (no canvas downscale for PDFs)
    if (/\.pdf$/.test(name)) {
      var pdfReader = new FileReader();
      pdfReader.onload = function (e) {
        showAnalyzing('Analyzing PDF...');
        parseAsDocument(e.target.result);
      };
      pdfReader.readAsDataURL(file);
      return;
    }

    if (/\.(xls|xlsx|doc|docx)$/.test(name)) {
      alert('Excel and Word files cannot be analyzed directly. Please either:\n\n' +
        '1. Save as CSV and upload again\n' +
        '2. Take a photo/screenshot of the document\n' +
        '3. Use manual entry for each resource');
      return;
    }

    showToast('Unsupported file type. Use CSV, PDF, or image files.', true);
  };

  function parseAsDocument(dataUri) {
    apiPost('resource-parse', { mode: 'document', data: dataUri })
      .then(function (result) {
        hideAnalyzing();
        var resources = normalizeParsed(result);
        if (!resources.length) {
          showToast('No resources detected in that file.', true);
          document.getElementById('ws-csv').classList.add('active');
          return;
        }
        pendingResources = resources;
        showConfirmationCards();
      })
      .catch(function (err) {
        hideAnalyzing();
        document.getElementById('ws-csv').classList.add('active');
        if (handleAuthError(err)) return;
        showToast('Analysis failed: ' + friendlyError(err), true);
      });
  }

  /* ── CSV parsing + client-side column mapping ── */
  function parseCSV(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    return lines.map(function (line) {
      var result = [];
      var current = '';
      var inQuotes = false;
      for (var i = 0; i < line.length; i++) {
        var c = line[i];
        if (c === '"') {
          inQuotes = !inQuotes;
        } else if ((c === ',' || c === '\t') && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += c;
        }
      }
      result.push(current.trim());
      return result;
    });
  }

  // Client-side replacement for the legacy server-side suggestCSVMapping:
  // ordered keyword heuristics over the header names.
  function suggestCSVMapping(headers) {
    var mappings = {};
    headers.forEach(function (h) {
      var l = String(h || '').toLowerCase();
      if (!l) return;
      if (/crew|pax|personnel|staff/.test(l)) mappings[h] = 'crew_count';
      else if (/status|state|avail/.test(l)) mappings[h] = 'status';
      else if (/note|comment|remark/.test(l)) mappings[h] = 'notes';
      else if (/type|category|kind|class/.test(l)) mappings[h] = 'resource_type';
      else if (/capab|desc|function|mission|equip/.test(l)) mappings[h] = 'capability';
      else if (/name|ident|unit|call\s?sign|asset|resource|^id$|\bid\b/.test(l)) mappings[h] = 'identifier';
    });
    return mappings;
  }

  function showCSVMapping(headers, dataRows) {
    var workArea = document.getElementById('csvWorkArea');
    renderCSVMappingUI(headers, dataRows, suggestCSVMapping(headers), workArea);
  }

  function renderCSVMappingUI(headers, dataRows, mappings, container) {
    var html = '<h4 class="mb-12">Map Columns</h4>';
    html += '<table class="csv-mapping-table"><thead><tr><th>CSV Column</th><th>Maps To</th></tr></thead><tbody>';
    headers.forEach(function (h, i) {
      var suggested = mappings[h] || mappings[i] || '-- skip --';
      html += '<tr>';
      html += '<td>' + esc(h) + '</td>';
      html += '<td><select class="csv-map-select" data-col="' + i + '">';
      CSV_FIELDS.forEach(function (f) {
        var sel = (f === suggested) ? ' selected' : '';
        html += '<option value="' + f + '"' + sel + '>' + f + '</option>';
      });
      html += '</select></td></tr>';
    });
    html += '</tbody></table>';

    html += '<h4 class="mb-8 mt-16">Preview (first 3 rows)</h4>';
    html += '<div class="csv-preview"><table><thead><tr>';
    headers.forEach(function (h) { html += '<th>' + esc(h) + '</th>'; });
    html += '</tr></thead><tbody>';
    dataRows.slice(0, 3).forEach(function (row) {
      html += '<tr>';
      row.forEach(function (cell) { html += '<td>' + esc(cell) + '</td>'; });
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    html += '<button class="btn btn-primary btn-block mt-16" onclick="processCSVMapping()">Process ' + dataRows.length + ' Rows</button>';

    container.innerHTML = html;
    container._csvHeaders = headers;
    container._csvData = dataRows;
  }

  window.processCSVMapping = function () {
    var workArea = document.getElementById('csvWorkArea');
    var dataRows = workArea._csvData || [];

    var selects = document.querySelectorAll('.csv-map-select');
    var colMap = {};
    for (var i = 0; i < selects.length; i++) {
      var col = parseInt(selects[i].getAttribute('data-col'), 10);
      var field = selects[i].value;
      if (field !== '-- skip --') colMap[col] = field;
    }

    pendingResources = dataRows.map(function (row) {
      var r = { resource_type: 'other', identifier: '', capability: '', crew_count: '', status: 'available', notes: '' };
      Object.keys(colMap).forEach(function (col) {
        r[colMap[col]] = row[parseInt(col, 10)] || '';
      });
      return r;
    }).filter(function (r) {
      return r.identifier || r.capability || r.resource_type !== 'other';
    });

    if (pendingResources.length === 0) {
      showToast('No valid resources found. Check your column mapping.', true);
      return;
    }
    showConfirmationCards();
  };

  /* ═══════════════════════════════════════════
     VOICE (optional — Web Speech API)
     ═══════════════════════════════════════════ */
  window.toggleVoiceRecording = function () {
    if (voiceIsRecording) stopVoiceRecording();
    else startVoiceRecording();
  };

  function startVoiceRecording() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      showToast('Speech recognition is not supported in this browser.', true);
      return;
    }
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    voiceRecognition = new SpeechRecognition();
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = true;
    voiceRecognition.lang = 'en-US';
    voiceTranscriptText = '';

    voiceRecognition.onresult = function (event) {
      var finalText = '';
      var interim = '';
      for (var i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript + ' ';
        else interim += event.results[i][0].transcript;
      }
      voiceTranscriptText = finalText;
      document.getElementById('voiceTranscript').textContent = finalText + interim;
    };
    voiceRecognition.onend = function () {
      if (voiceIsRecording) { try { voiceRecognition.start(); } catch (e) {} }
    };

    voiceRecognition.start();
    voiceIsRecording = true;
    var btn = document.getElementById('voiceRecordBtn');
    btn.textContent = 'Stop Recording';
    btn.classList.add('btn-danger');
    btn.classList.remove('btn-primary');
    document.getElementById('voiceStatus').innerHTML = '<span class="pulse-dot"></span> Recording...';
    document.getElementById('voiceAnalyzeBtn').classList.add('hidden');
  }

  function stopVoiceRecording() {
    voiceIsRecording = false;
    if (voiceRecognition) { voiceRecognition.stop(); voiceRecognition = null; }
    var btn = document.getElementById('voiceRecordBtn');
    btn.textContent = 'Start Recording';
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-primary');
    document.getElementById('voiceStatus').textContent = 'Recording stopped';
    if (voiceTranscriptText.trim()) {
      document.getElementById('voiceAnalyzeBtn').classList.remove('hidden');
    }
  }

  window.analyzeVoiceTranscript = function () {
    if (!voiceTranscriptText.trim()) {
      showToast('No transcript to analyze.', true);
      return;
    }
    showAnalyzing('Analyzing transcript...');
    apiPost('resource-parse', { mode: 'voice', data: voiceTranscriptText })
      .then(function (result) {
        hideAnalyzing();
        var resources = normalizeParsed(result);
        if (resources.length) {
          pendingResources = resources;
          showConfirmationCards();
        } else {
          showToast('No resources detected from transcript. Try manual entry.', true);
          document.getElementById('ws-voice').classList.add('active');
        }
      })
      .catch(function (err) {
        hideAnalyzing();
        document.getElementById('ws-voice').classList.add('active');
        if (handleAuthError(err)) return;
        showToast('Analysis error: ' + friendlyError(err), true);
      });
  };

  /* ═══════════════════════════════════════════
     MANUAL ENTRY
     ═══════════════════════════════════════════ */
  window.addManualResource = function () {
    var identifier = document.getElementById('manualIdentifier').value.trim();
    if (!identifier) {
      showToast('Identifier / Name is required.', true);
      return;
    }
    pendingResources.push({
      resource_type: document.getElementById('manualType').value,
      identifier: identifier,
      capability: document.getElementById('manualCapability').value.trim(),
      crew_count: document.getElementById('manualCrew').value || '',
      status: document.getElementById('manualStatus').value,
      notes: document.getElementById('manualNotes').value.trim()
    });

    document.getElementById('manualIdentifier').value = '';
    document.getElementById('manualCapability').value = '';
    document.getElementById('manualCrew').value = '';
    document.getElementById('manualNotes').value = '';

    showConfirmationCards();
  };

  /* ═══════════════════════════════════════════
     WRRL COMPANY EQUIPMENT CHECKLIST
     Search your org, tick the catalog items you brought; selections feed the
     same confirmation-card flow as every other mode, carrying wrrl_id /
     org_code so the server stamps the catalog identity onto the record.
     ═══════════════════════════════════════════ */
  var wrrlOrgs = null;      // [{code, count}] — fetched once per app load
  var wrrlOrg = '';         // chosen org code
  var wrrlItems = [];       // catalog items for the chosen org
  var wrrlExisting = {};    // WRRL_ID -> true (already submitted this incident)
  var wrrlSelected = {};    // catalog position (item._i) -> true
  var wrrlBoomFt = {};      // catalog position (item._i) -> user-entered boom feet
  var wrrlWired = false;

  function initWrrlMode() {
    if (!wrrlWired) {
      wrrlWired = true;
      var body = document.getElementById('wrrlListBody');
      body.addEventListener('change', onWrrlListChange);
      body.addEventListener('input', onWrrlBoomInput);
      document.getElementById('wrrlOrgResults').addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.wrrl-org-row') : null;
        if (btn && btn.getAttribute('data-org')) loadWrrlOrg(btn.getAttribute('data-org'));
      });
    }
    // Prefill with the organization typed at check-in
    var search = document.getElementById('wrrlOrgSearch');
    if (!search.value) {
      var s = window.Session && Session.get();
      if (s && s.organization) search.value = s.organization;
    }
    if (wrrlOrg && wrrlItems.length) {
      // Returning to the mode: refresh the list (dup badges may have changed
      // after a submit) without making the user re-pick their org.
      loadWrrlOrg(wrrlOrg);
      return;
    }
    if (wrrlOrgs) { renderWrrlOrgResults(); return; }
    var statusEl = document.getElementById('wrrlStatus');
    statusEl.textContent = 'Loading organizations...';
    apiGet('wrrlorgs')
      .then(function (data) {
        wrrlOrgs = (data && data.orgs) || [];
        statusEl.textContent = '';
        renderWrrlOrgResults();
      })
      .catch(function (err) {
        if (handleAuthError(err)) return;
        statusEl.textContent = 'Could not load organizations: ' + friendlyError(err);
      });
  }
  window.initWrrlMode = initWrrlMode;

  window.renderWrrlOrgResults = function () {
    var box = document.getElementById('wrrlOrgResults');
    if (!wrrlOrgs) { box.innerHTML = ''; return; }
    var q = (document.getElementById('wrrlOrgSearch').value || '').trim().toUpperCase();
    var matches = q ? wrrlOrgs.filter(function (o) { return o.code.toUpperCase().indexOf(q) > -1; }) : wrrlOrgs;
    // Free-text org names ("County Fire Dept") won't match a code — show the
    // full code list rather than a dead end.
    if (!matches.length) matches = wrrlOrgs;
    var html = '';
    matches.forEach(function (o) {
      html += '<button type="button" class="wrrl-org-row" data-org="' + escAttr(o.code) + '">' +
        '<span>' + esc(o.code) + '</span><span class="wrrl-org-count">' + o.count + ' items</span></button>';
    });
    box.innerHTML = html;
  };

  window.loadWrrlOrg = function (code) {
    wrrlOrg = code;
    wrrlSelected = {};
    wrrlBoomFt = {};
    var statusEl = document.getElementById('wrrlStatus');
    statusEl.textContent = 'Loading ' + code + ' equipment...';
    document.getElementById('wrrlOrgResults').innerHTML = '';
    apiGet('wrrlitems', { org: code })
      .then(function (data) {
        wrrlItems = (data && data.items) || [];
        // Selection state is keyed by catalog POSITION, not WRRL_ID — the
        // catalog contains duplicate WRRL_IDs (e.g. WRI 61155 covers both a
        // Mavic 3 and a Mini 4), and id-keyed checkboxes made twins toggle
        // together.
        wrrlItems.forEach(function (it, i) { it._i = i; });
        wrrlExisting = {};
        ((data && data.existing_ids) || []).forEach(function (id) { wrrlExisting[id] = true; });
        if (!wrrlItems.length) {
          statusEl.textContent = 'No equipment found for ' + code + '.';
          document.getElementById('wrrlListArea').classList.add('hidden');
          return;
        }
        statusEl.textContent = '';
        document.getElementById('wrrlOrgChosen').innerHTML =
          '<strong>' + esc(code) + '</strong> &mdash; ' + wrrlItems.length + ' catalog items ' +
          '<button type="button" class="link-btn" onclick="changeWrrlOrg()">change</button>';
        document.getElementById('wrrlItemSearch').value = '';
        document.getElementById('wrrlListArea').classList.remove('hidden');
        renderWrrlList();
      })
      .catch(function (err) {
        if (handleAuthError(err)) return;
        statusEl.textContent = 'Could not load equipment: ' + friendlyError(err);
      });
  };

  window.changeWrrlOrg = function () {
    document.getElementById('wrrlListArea').classList.add('hidden');
    renderWrrlOrgResults();
  };

  window.renderWrrlList = function () {
    var body = document.getElementById('wrrlListBody');
    var q = (document.getElementById('wrrlItemSearch').value || '').trim().toLowerCase();
    var shown = wrrlItems.filter(function (it) {
      if (!q) return true;
      return (it.id + ' ' + it.kind + ' ' + it.type + ' ' + it.ident + ' ' + it.spec)
        .toLowerCase().indexOf(q) > -1;
    });
    var groups = {};
    shown.forEach(function (it) {
      var k = it.kind || 'Other';
      (groups[k] = groups[k] || []).push(it);
    });
    var html = '';
    Object.keys(groups).sort().forEach(function (k) {
      html += '<div class="group-header">' + esc(k) + ' (' + groups[k].length + ')</div>';
      groups[k].forEach(function (it) {
        var isBoom = (it.kind || '').toLowerCase().indexOf('boom') > -1;
        var key = String(it._i); // position key — WRRL_IDs are NOT unique
        var cbId = 'wrrlcb-' + key;
        html += '<div class="wrrl-row' + (wrrlExisting[it.id] ? ' dup' : '') + '">';
        html += '<input type="checkbox" id="' + cbId + '" data-wrrl="' + key + '"' +
          (wrrlSelected[key] ? ' checked' : '') + '>';
        html += '<label for="' + cbId + '">';
        html += '<span class="wrrl-name">' + esc(it.ident || it.type || it.id) + '</span>';
        html += '<span class="wrrl-detail">' + esc(it.type || '') + (it.spec ? ' — ' + esc(it.spec) : '') + '</span>';
        if (wrrlExisting[it.id]) html += '<span class="wrrl-dup-badge">&#9888; already added</span>';
        html += '</label>';
        if (isBoom && wrrlSelected[key]) {
          var ft = wrrlBoomFt[key] != null ? wrrlBoomFt[key]
            : (String(it.boom || '').replace(/\D/g, '') || '');
          html += '<input type="number" class="wrrl-boom" data-boom="' + key + '" value="' +
            escAttr(ft) + '" min="1" max="99999" placeholder="ft" title="Boom feet">';
        }
        html += '</div>';
      });
    });
    body.innerHTML = html || '<div class="empty-state"><p>No matches</p></div>';
    updateWrrlAddBtn();
  };

  function onWrrlListChange(e) {
    var id = e.target.getAttribute && e.target.getAttribute('data-wrrl');
    if (!id) return;
    if (e.target.checked) wrrlSelected[id] = true;
    else delete wrrlSelected[id];
    renderWrrlList(); // re-render so boom inputs appear/disappear
  }

  function onWrrlBoomInput(e) {
    var id = e.target.getAttribute && e.target.getAttribute('data-boom');
    if (!id) return;
    wrrlBoomFt[id] = String(e.target.value || '').replace(/\D/g, '');
  }

  function updateWrrlAddBtn() {
    var n = Object.keys(wrrlSelected).length;
    var btn = document.getElementById('wrrlAddBtn');
    btn.disabled = n === 0;
    btn.textContent = n ? 'Add ' + n + ' Selected Item(s)' : 'Select items to add';
  }

  function mapWrrlKind(kind) {
    var k = String(kind || '').toLowerCase();
    if (k === 'vessel') return 'Vessel';
    if (k === 'vehicle') return 'Vehicle';
    if (k === 'aircraft') return 'Aircraft';
    return k ? 'Equipment' : 'Other';
  }

  window.addWrrlSelected = function () {
    var keys = Object.keys(wrrlSelected);
    if (!keys.length) return;
    keys.forEach(function (key) {
      var it = wrrlItems[parseInt(key, 10)];
      if (!it) return;
      var isBoom = (it.kind || '').toLowerCase().indexOf('boom') > -1;
      var boomFt = isBoom
        ? (wrrlBoomFt[key] || String(it.boom || '').replace(/\D/g, ''))
        : String(it.boom || '');
      var capParts = [];
      if (it.spec) capParts.push(it.spec);
      if (boomFt) capParts.push('Boom: ' + boomFt + ' ft');
      if (it.rec) capParts.push('Recovery: ' + it.rec);
      if (it.stor) capParts.push('Storage: ' + it.stor);
      pendingResources.push({
        resource_type: mapWrrlKind(it.kind),
        identifier: it.ident || ((it.type || it.kind || 'WRRL') + ' ' + it.id),
        capability: capParts.join(' | '),
        crew_count: String(it.ppl || '').replace(/\D/g, ''),
        status: 'available',
        notes: 'WRRL ' + it.id + (it.type ? ' (' + it.type + ')' : ''),
        wrrl_id: it.id,
        wrrl_group: it.grp || '',
        org_code: wrrlOrg,
        wrrl_type: it.type || '',
        wrrl_recovery: it.rec || '',
        wrrl_storage: it.stor || '',
        wrrl_boom: boomFt || ''
      });
    });
    wrrlSelected = {};
    wrrlBoomFt = {};
    showConfirmationCards();
  };

  /* ═══════════════════════════════════════════
     CONFIRMATION CARDS
     ═══════════════════════════════════════════ */
  function showConfirmationCards() {
    setModeFull(true, ''); // full-page; the panel's own "Review N" heading is the title
    var panels = document.querySelectorAll('.workspace-panel');
    for (var i = 0; i < panels.length; i++) panels[i].classList.remove('active');
    document.getElementById('ws-confirm').classList.add('active');
    document.getElementById('confirmTitle').textContent = 'Review ' + pendingResources.length + ' Resource(s)';
    renderConfirmCards();
  }
  window.showConfirmationCards = showConfirmationCards;

  function renderConfirmCards() {
    var container = document.getElementById('confirmCards');
    var html = '';

    pendingResources.forEach(function (r, idx) {
      var lowConf = r._low_confidence || [];
      html += '<div class="resource-card" data-idx="' + idx + '">';
      html += '<div class="card-header">';
      html += '<span class="badge badge-' + getTypeBadgeClass(r.resource_type) + '">' + esc(r.resource_type || 'other') + '</span>';
      html += '<button class="btn-icon" onclick="removeResource(' + idx + ')" title="Remove" style="color:var(--danger);">&#10005;</button>';
      html += '</div>';

      html += '<div class="card-field' + (lowConf.indexOf('resource_type') > -1 ? ' low-confidence' : '') + '">';
      html += '<label>Type</label>';
      html += '<select onchange="updatePendingField(' + idx + ', \'resource_type\', this.value)">';
      ['Vessel', 'Vehicle', 'Equipment', 'Aircraft', 'Other'].forEach(function (t) {
        html += '<option value="' + t + '"' + ((r.resource_type || '').toLowerCase() === t.toLowerCase() ? ' selected' : '') + '>' + t + '</option>';
      });
      html += '</select></div>';

      html += '<div class="card-field' + (lowConf.indexOf('identifier') > -1 ? ' low-confidence' : '') + '">';
      html += '<label>Identifier</label>';
      html += '<input type="text" value="' + escAttr(r.identifier || '') + '" onchange="updatePendingField(' + idx + ', \'identifier\', this.value)">';
      html += '</div>';

      html += '<div class="card-field' + (lowConf.indexOf('capability') > -1 ? ' low-confidence' : '') + '">';
      html += '<label>Capability</label>';
      html += '<input type="text" value="' + escAttr(r.capability || '') + '" onchange="updatePendingField(' + idx + ', \'capability\', this.value)">';
      html += '</div>';

      html += '<div class="card-field">';
      html += '<label>Crew Count</label>';
      html += '<input type="number" value="' + escAttr(r.crew_count || '') + '" min="0" onchange="updatePendingField(' + idx + ', \'crew_count\', this.value)">';
      html += '</div>';

      html += '<div class="card-field">';
      html += '<label>Status</label>';
      html += '<select onchange="updatePendingField(' + idx + ', \'status\', this.value)">';
      ['available', 'assigned', 'out_of_service'].forEach(function (s) {
        html += '<option value="' + s + '"' + (r.status === s ? ' selected' : '') + '>' + s.replace(/_/g, ' ') + '</option>';
      });
      html += '</select></div>';

      // Location picker (grouped by type from the incident's active locations)
      html += '<div class="card-field">';
      html += '<label>Location</label>';
      html += '<select onchange="handleLocationSelect(' + idx + ', this)">';
      html += '<option value="">Select location...</option>';
      if (activeLocations.length > 0) {
        var types = {};
        activeLocations.forEach(function (loc) {
          var t = loc.type || 'Other';
          if (!types[t]) types[t] = [];
          types[t].push(loc);
        });
        Object.keys(types).forEach(function (t) {
          html += '<optgroup label="' + escAttr(t) + '">';
          types[t].forEach(function (loc) {
            var sel = (r.location_name === loc.name) ? ' selected' : '';
            html += '<option value="' + escAttr(loc.name) + '"' + sel + '>' + esc(loc.name) + '</option>';
          });
          html += '</optgroup>';
        });
      }
      html += '<option value="__custom__">Location not listed...</option>';
      html += '</select>';
      if (r.location_name_custom !== undefined && r.location_name_custom !== null && !isListedLocation(r.location_name)) {
        html += '<input type="text" placeholder="Enter location name" value="' + escAttr(r.location_name_custom) + '" ' +
          'onchange="updatePendingField(' + idx + ', \'location_name\', this.value); updatePendingField(' + idx + ', \'location_name_custom\', this.value);" ' +
          'style="margin-top:8px;">';
      }
      html += '</div>';

      html += '<div class="card-field">';
      html += '<label>Notes</label>';
      html += '<textarea onchange="updatePendingField(' + idx + ', \'notes\', this.value)">' + esc(r.notes || '') + '</textarea>';
      html += '</div>';

      html += '</div>';
    });

    container.innerHTML = html;
    document.getElementById('confirmSubmitArea').style.display = pendingResources.length > 0 ? 'block' : 'none';
  }

  function isListedLocation(name) {
    if (!name) return false;
    for (var i = 0; i < activeLocations.length; i++) {
      if (activeLocations[i].name === name) return true;
    }
    return false;
  }

  window.updatePendingField = function (idx, field, value) {
    if (pendingResources[idx]) pendingResources[idx][field] = value;
  };

  window.handleLocationSelect = function (idx, selectEl) {
    if (!pendingResources[idx]) return;
    if (selectEl.value === '__custom__') {
      pendingResources[idx].location_name = '';
      pendingResources[idx].location_name_custom = '';
      renderConfirmCards();
    } else {
      pendingResources[idx].location_name = selectEl.value;
      delete pendingResources[idx].location_name_custom;
    }
  };

  window.removeResource = function (idx) {
    pendingResources.splice(idx, 1);
    if (pendingResources.length === 0) {
      exitModeFull(); // nothing left to review — back to the mode grid
      document.getElementById('confirmTitle').textContent = 'Review Resources';
    } else {
      document.getElementById('confirmTitle').textContent = 'Review ' + pendingResources.length + ' Resource(s)';
      renderConfirmCards();
    }
  };

  function loadActiveLocations() {
    apiGet('locations')
      .then(function (data) {
        activeLocations = (data && data.locations) || [];
      })
      .catch(function () {
        activeLocations = [];
      });
  }
  window.loadActiveLocations = loadActiveLocations;

  /* ═══════════════════════════════════════════
     SUBMIT
     ═══════════════════════════════════════════ */
  window.submitAllResources = function () {
    if (!pendingResources.length) return;

    var cleaned = pendingResources.map(function (r) {
      return {
        resource_type: r.resource_type || 'Other',
        identifier: r.identifier || '',
        capability: r.capability || '',
        crew_count: r.crew_count || '',
        status: r.status || 'available',
        location_name: r.location_name || '',
        notes: r.notes || '',
        // WRRL catalog identity (present only on checklist-mode cards; the
        // server stamps these onto the Reviewed Resources columns and falls
        // back to the legacy 'EXT' org when absent)
        wrrl_id: r.wrrl_id || '',
        wrrl_group: r.wrrl_group || '',
        org_code: r.org_code || '',
        wrrl_type: r.wrrl_type || '',
        wrrl_recovery: r.wrrl_recovery || '',
        wrrl_storage: r.wrrl_storage || '',
        wrrl_boom: r.wrrl_boom || ''
      };
    });

    showLoading('Submitting ' + cleaned.length + ' resource(s)...');

    apiPost('resource-submit', { resources: cleaned })
      .then(function (result) {
        hideLoading();
        if (result && result.success) {
          var count = result.count || cleaned.length;
          var allWrrl = cleaned.length > 0 && cleaned.every(function (r) { return r.wrrl_id; });
          pendingResources = [];
          if (window.APP) APP.resourceCount = (APP.resourceCount || 0) + count;
          showResourceSuccessMessage(count, allWrrl);
        } else {
          showToast('Submit failed: unexpected server response.', true);
        }
      })
      .catch(function (err) {
        hideLoading();
        if (handleAuthError(err)) return;
        if (err && err.transient) {
          // Resources are NOT queued offline in this pilot — cards stay on
          // screen so nothing is lost; resubmit when connected.
          showToast('No connection — resource upload needs signal. Your entries are still here; try again when connected.', true);
          return;
        }
        showToast('Submit error: ' + friendlyError(err), true);
      });
  };

  function showResourceSuccessMessage(count, allWrrl) {
    var container = document.getElementById('uploadWorkspace');
    var panels = document.querySelectorAll('.workspace-panel');
    for (var i = 0; i < panels.length; i++) panels[i].classList.remove('active');

    var panel = document.getElementById('ws-success');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'ws-success';
      panel.className = 'workspace-panel';
      panel.style.cssText = 'text-align:center;padding:40px 0;';
      container.appendChild(panel);
    }
    panel.innerHTML =
      '<div style="font-size:2.5rem;color:var(--success);margin-bottom:12px;">&#10003;</div>' +
      '<h3>' + count + ' Resource(s) Submitted</h3>' +
      '<p class="text-muted mt-12">' + (allWrrl
        ? 'Resources added to the incident.'
        : 'Resources are pending review by incident management.') + '</p>' +
      '<button class="btn btn-primary mt-20" onclick="enterMainApp()">Continue to App</button>';
    panel.classList.add('active');
  }

  /* ═══════════════════════════════════════════
     RESOURCES TAB (My Submissions + All Active)
     ═══════════════════════════════════════════ */
  window.loadMyResources = function () {
    var container = document.getElementById('myResourcesList');
    apiGet('myresources')
      .then(function (data) {
        var resources = (data && data.resources) || [];
        if (!resources.length) {
          container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128230;</div><p>No resources submitted yet</p></div>';
          return;
        }
        var html = '';
        resources.forEach(function (r) {
          html += '<div class="resource-item">';
          html += '<div class="res-info">';
          html += '<div class="res-name"><span class="badge badge-' + getTypeBadgeClass(r.resource_type) +
            '" style="margin-right:6px;">' + esc(r.resource_type || 'other') + '</span>' + esc(r.identifier || 'Unknown') + '</div>';
          html += '<div class="res-detail">' + esc(r.capability || '') + (r.location_name ? ' | ' + esc(r.location_name) : '') + '</div>';
          if (String(r.review_status || '').toLowerCase() === 'rejected' && r.notes) {
            html += '<div class="res-detail" style="color:var(--danger);">Reason: ' + esc(r.notes) + '</div>';
          }
          html += '</div>';
          html += '<div class="res-status">' + getReviewStatusBadge(r.review_status) + '</div>';
          html += '</div>';
        });
        container.innerHTML = html;
      })
      .catch(function (err) {
        if (handleAuthError(err)) return;
        container.innerHTML = '<div class="empty-state"><p>Error: ' + esc(friendlyError(err)) + '</p></div>';
      });
  };

  window.loadAllResources = function () {
    var container = document.getElementById('allResourcesList');
    apiGet('allresources')
      .then(function (data) {
        if (!data || !data.locations || Object.keys(data.locations).length === 0) {
          container.innerHTML = '<div class="empty-state"><p>No active resources</p></div>';
          return;
        }
        var html = '';
        Object.keys(data.locations).forEach(function (locName) {
          var resources = data.locations[locName];
          html += '<div class="location-group">';
          html += '<div class="group-header">' + esc(locName) + ' (' + resources.length + ')</div>';
          resources.forEach(function (r) {
            html += '<div class="resource-item">';
            html += '<div class="res-info">';
            html += '<div class="res-name"><span class="badge badge-' + getTypeBadgeClass(r.resource_type) +
              '" style="margin-right:6px;">' + esc(r.resource_type || 'other') + '</span>' + esc(r.identifier || 'Unknown') + '</div>';
            html += '<div class="res-detail">' + esc(r.capability || '') + (r.crew_count ? ' | Crew: ' + esc(r.crew_count) : '') + '</div>';
            html += '</div>';
            html += '<div class="res-status"><span class="badge badge-active">' + esc(r.status || 'Active') + '</span></div>';
            html += '</div>';
          });
          html += '</div>';
        });
        container.innerHTML = html;
      })
      .catch(function (err) {
        if (handleAuthError(err)) return;
        container.innerHTML = '<div class="empty-state"><p>Error: ' + esc(friendlyError(err)) + '</p></div>';
      });
  };
})();
