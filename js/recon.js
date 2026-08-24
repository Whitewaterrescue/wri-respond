/* WRI Respond — "Add to COP" observation submit.
 * Type catalog + icons come from js/obstypes.js (mirrors the Recon app).
 * Location comes from window.reconPoint (map.js GPS/tap — tap is always on,
 * so the point can be anywhere, not just where the reporter stands).
 * Reporter identity is attached server-side from the session — never sent here.
 */
(function () {
  'use strict';

  var MAX_PHOTOS = 3;
  var MAX_DIM = 1600;
  var JPEG_QUALITY = 0.8;

  // Guarded: obstypes.js could be missing under HTTP-cache version skew —
  // degrade rather than kill this module at load (endless-spinner class of bug).
  var selectedCategory = (self.OBS_CATEGORIES || ['Observations'])[0];
  var selectedType = null;     // code string
  var selectedSubtype = null;  // code string or null
  var reconPhotos = [];        // downscaled JPEG data URIs, capped at MAX_PHOTOS

  /* ═══════════════════════════════════════════
     IMAGE DOWNSCALE HELPER (shared — resources.js uses it too)
     ═══════════════════════════════════════════ */
  // Reads an image File, scales its longest edge to <= maxDim, and calls
  // cb(jpegDataURI). Falls back to the raw file data URI if decoding fails.
  window.downscaleImage = function (file, cb) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var rawDataUrl = e.target.result;
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var scale = Math.min(1, MAX_DIM / Math.max(w, h));
          if (scale >= 1) {
            // Already small — still re-encode as JPEG to strip weight/EXIF.
            scale = 1;
          }
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          cb(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
        } catch (err) {
          cb(rawDataUrl); // canvas failed (odd format) — send original
        }
      };
      img.onerror = function () { cb(rawDataUrl); };
      img.src = rawDataUrl;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  };

  /* ═══════════════════════════════════════════
     TYPE PICKER (category tabs + icon card grid + subtype chips)
     ═══════════════════════════════════════════ */
  function renderCatTabs() {
    var tabs = document.getElementById('reconCatTabs');
    tabs.innerHTML = '';
    self.OBS_CATEGORIES.forEach(function (cat) {
      var t = document.createElement('button');
      t.type = 'button';
      t.className = 'cat-tab' + (cat === selectedCategory ? ' active' : '');
      t.textContent = cat;
      t.onclick = function () {
        selectedCategory = cat;
        renderCatTabs();
        renderTypeCards();
      };
      tabs.appendChild(t);
    });
  }

  function renderTypeCards() {
    var grid = document.getElementById('reconObsGrid');
    grid.innerHTML = '';
    self.OBS_TYPES.filter(function (t) { return t.category === selectedCategory; })
      .forEach(function (t) {
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'obs-card' + (selectedType === t.code ? ' selected' : '');
        card.innerHTML = '<img src="assets/obs/' + t.icon + '.png" alt="" loading="lazy">' +
          '<span>' + esc(t.label) + '</span>';
        card.onclick = function () { selectType(t); };
        grid.appendChild(card);
      });
    syncSubtypeSection();
  }

  function selectType(t) {
    selectedType = t.code;
    selectedSubtype = null;
    renderTypeCards();
  }

  function currentTypeObj() {
    for (var i = 0; i < self.OBS_TYPES.length; i++) {
      if (self.OBS_TYPES[i].code === selectedType) return self.OBS_TYPES[i];
    }
    return null;
  }

  function syncSubtypeSection() {
    var section = document.getElementById('reconSubtypeSection');
    var t = currentTypeObj();
    var subs = (t && t.has_subtype && self.OBS_SUBTYPES[t.code]) || null;
    if (!subs) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    var chips = document.getElementById('reconSubtypeChips');
    chips.innerHTML = '';
    subs.forEach(function (s) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (selectedSubtype === s.code ? ' selected' : '');
      chip.textContent = s.label;
      chip.onclick = function () {
        selectedSubtype = (selectedSubtype === s.code) ? null : s.code;
        syncSubtypeSection();
      };
      chips.appendChild(chip);
    });
  }

  // Built once on first entry into the Add to COP tab (app.js switchTab).
  var pickerBuilt = false;
  window.initReconTypePicker = function () {
    if (pickerBuilt) return;
    pickerBuilt = true;
    renderCatTabs();
    renderTypeCards();
  };

  /* ═══════════════════════════════════════════
     PHOTO PREVIEW (downscaled at pick time, thumbnails w/ remove)
     ═══════════════════════════════════════════ */
  function renderPhotoPreview() {
    var wrap = document.getElementById('reconPhotoPreview');
    wrap.innerHTML = '';
    reconPhotos.forEach(function (uri, i) {
      var d = document.createElement('div');
      d.className = 'recon-photo-thumb';
      d.innerHTML = '<img src="' + uri + '" alt="">' +
        '<button type="button" aria-label="Remove photo">&times;</button>';
      d.querySelector('button').onclick = function () {
        reconPhotos.splice(i, 1);
        renderPhotoPreview();
      };
      wrap.appendChild(d);
    });
  }

  var reconPhotoEl = document.getElementById('reconPhoto');
  if (reconPhotoEl) reconPhotoEl.addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files || [], 0, MAX_PHOTOS - reconPhotos.length);
    e.target.value = ''; // same file can be re-picked after a remove
    function next(i) {
      if (i >= files.length) { renderPhotoPreview(); return; }
      downscaleImage(files[i], function (uri) {
        if (uri && reconPhotos.length < MAX_PHOTOS) reconPhotos.push(uri);
        next(i + 1);
      });
    }
    next(0);
  });

  /* ═══════════════════════════════════════════
     FORM SUBMIT
     ═══════════════════════════════════════════ */
  var reconFormEl = document.getElementById('reconForm');
  if (reconFormEl) reconFormEl.addEventListener('submit', function (e) {
    e.preventDefault();

    if (!window.reconPoint) {
      showToast('No location set. Tap the map to place the point, or use "Use My Location".', true);
      return;
    }
    if (!selectedType) {
      showToast('Select an observation type.', true);
      return;
    }

    var btn = document.getElementById('reconSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-sm"></span> Submitting...';

    var payload = {
      observation_type: selectedType,
      observation_subtype: selectedSubtype || '',
      description: document.getElementById('reconNotes').value.trim(),
      latitude: window.reconPoint.lat,
      longitude: window.reconPoint.lon,
      photos: reconPhotos.slice(0, MAX_PHOTOS)
    };

    apiPost('recon-submit', payload)
      .then(function (result) {
        btn.disabled = false;
        btn.textContent = 'Add to COP';
        if (result && result.success) {
          document.getElementById('reconForm').classList.add('hidden');
          document.getElementById('reconSuccess').classList.remove('hidden');
        } else {
          showToast('Submit failed: unexpected server response.', true);
        }
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Add to COP';
        if (handleAuthError(err)) return;
        if (err && err.transient) {
          // Observations are NOT queued offline in this pilot — the entry
          // stays on screen so nothing is lost; resubmit when connected.
          showToast('No connection — this needs signal. Your entry stays on this screen; try again when connected.', true);
          return;
        }
        showToast('Submit error: ' + friendlyError(err), true);
      });
  });

  /* ═══════════════════════════════════════════
     RESET
     ═══════════════════════════════════════════ */
  window.resetReconForm = function () {
    document.getElementById('reconForm').classList.remove('hidden');
    document.getElementById('reconSuccess').classList.add('hidden');
    document.getElementById('reconForm').reset();
    selectedType = null;
    selectedSubtype = null;
    reconPhotos = [];
    renderPhotoPreview();
    renderTypeCards();
    captureReconGPS();
  };
})();
