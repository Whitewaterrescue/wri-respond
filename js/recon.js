/* WRI Respond — recon observation submit.
 * Reads window.reconPoint (set by map.js GPS/tap), downscales the optional
 * photo client-side, and POSTs through the token-free JSON API.
 * Reporter identity is attached server-side from the session — never sent here.
 */
(function () {
  'use strict';

  var MAX_PHOTOS = 3;
  var MAX_DIM = 1600;
  var JPEG_QUALITY = 0.8;

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
     FORM SUBMIT
     ═══════════════════════════════════════════ */
  document.getElementById('reconForm').addEventListener('submit', function (e) {
    e.preventDefault();

    if (!window.reconPoint) {
      showToast('GPS position not acquired. Use "Use My Location" or "Tap Map to Place".', true);
      return;
    }
    var obsType = document.getElementById('reconType').value;
    if (!obsType) {
      showToast('Select an observation type.', true);
      return;
    }

    var btn = document.getElementById('reconSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-sm"></span> Submitting...';

    var photoInput = document.getElementById('reconPhoto');
    var files = photoInput.files ? Array.prototype.slice.call(photoInput.files, 0, MAX_PHOTOS) : [];

    collectPhotos(files, function (photos) {
      var payload = {
        observation_type: obsType,
        description: document.getElementById('reconNotes').value.trim(),
        latitude: window.reconPoint.lat,
        longitude: window.reconPoint.lon,
        photos: photos
      };

      apiPost('recon-submit', payload)
        .then(function (result) {
          btn.disabled = false;
          btn.textContent = 'Submit Recon Point';
          if (result && result.success) {
            document.getElementById('reconForm').classList.add('hidden');
            document.getElementById('reconSuccess').classList.remove('hidden');
          } else {
            showToast('Submit failed: unexpected server response.', true);
          }
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Submit Recon Point';
          if (handleAuthError(err)) return;
          showToast('Submit error: ' + friendlyError(err), true);
        });
    });
  });

  // Downscale each selected photo in sequence; skip any that fail to read.
  function collectPhotos(files, done) {
    var photos = [];
    function next(i) {
      if (i >= files.length) { done(photos); return; }
      downscaleImage(files[i], function (dataUri) {
        if (dataUri) photos.push(dataUri);
        next(i + 1);
      });
    }
    next(0);
  }

  /* ═══════════════════════════════════════════
     RESET
     ═══════════════════════════════════════════ */
  window.resetReconForm = function () {
    document.getElementById('reconForm').classList.remove('hidden');
    document.getElementById('reconSuccess').classList.add('hidden');
    document.getElementById('reconForm').reset();
    var s = Session.get() || {};
    document.getElementById('reconReporter').value = s.name || '';
    captureReconGPS();
  };
})();
