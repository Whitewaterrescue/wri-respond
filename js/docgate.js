/* WRI Respond: incident documents through the Gateway, not open Drive links (2026-11-18).
 *
 * The HASP, 205, 208, 201 map and 201 attachments are private Drive files. The Gateway's
 * POST {action:'doc', id} returns one of them to a checked-in responder of this incident
 * (DocGate.gs); this file turns the answer into a local blob: URL for an <img>, an <iframe>
 * preview, or an Open / Download link. Nobody needs a Google account.
 *
 * Markup (sitstat.js builds it):
 *   <img data-doc-img="ID">        filled with the image
 *   <iframe data-doc-frame="ID">   filled with the PDF
 *   <a data-doc-open="ID" data-doc-name="ICS 205">   opens it in a new tab on tap
 *   <a data-doc-download="ID" data-doc-name="HASP"> saves it
 */
(function () {
  'use strict';
  var urls = {}, pending = {}, errors = {};

  /** The Drive file id in a Drive / Docs URL ('' when it is not one). */
  window.docIdFromUrl = function (u) {
    var m = /(?:\/d\/|[?&]id=)([A-Za-z0-9_-]{20,})/.exec(String(u || ''));
    return m ? m[1] : '';
  };
  /** The blob URL for a document already fetched, else '' (lets a redraw keep identical markup). */
  window.docSrc = function (id) { return (urls[id] && urls[id].url) || ''; };

  function b64ToBlob(b64, mime) {
    var bin = atob(b64), n = bin.length, a = new Uint8Array(n);
    for (var i = 0; i < n; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: mime || 'application/octet-stream' });
  }

  /** Fetch one incident document. Resolves {url, name, mime}. */
  window.incidentDoc = function (id) {
    if (urls[id]) return Promise.resolve(urls[id]);
    if (pending[id]) return pending[id];
    pending[id] = apiPost('doc', { id: id }, { maxAttempts: 2 }).then(function (d) {
      var v = { url: URL.createObjectURL(b64ToBlob(d.b64, d.mime)), name: d.name || 'document', mime: d.mime };
      urls[id] = v; delete errors[id];
      return v;
    }, function (e) {
      errors[id] = (e && e.message) || 'Could not open the document';
      throw e;
    }).then(function (v) { delete pending[id]; return v; }, function (e) { delete pending[id]; throw e; });
    return pending[id];
  };

  function note(el, msg) {
    var p = document.createElement('div');
    p.className = 'doc-note';
    p.style.cssText = 'font-size:0.8rem;color:var(--text-muted);padding:6px 0;';
    p.textContent = msg;
    el.replaceWith ? el.replaceWith(p) : el.parentNode.replaceChild(p, el);
  }

  /** Fill every gated <img>/<iframe> in root that has no source yet. */
  window.docGateHydrate = function (root) {
    root = root || document;
    [].forEach.call(root.querySelectorAll('img[data-doc-img]:not([src]), iframe[data-doc-frame]:not([src])'), function (el) {
      var id = el.getAttribute('data-doc-img') || el.getAttribute('data-doc-frame');
      if (!id || el.__docLoading) return;
      el.__docLoading = true;
      incidentDoc(id).then(function (v) { el.setAttribute('src', v.url); }, function () {
        note(el, el.tagName === 'IMG' ? 'Map not available right now.' : 'Preview not available right now. Use Open below.');
      });
    });
  };

  // One tap handler for Open / Download. A blank tab is opened during the tap (popup
  // blockers allow that) and pointed at the document when it arrives.
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest && ev.target.closest('[data-doc-open],[data-doc-download]');
    if (!a) return;
    ev.preventDefault();
    var id = a.getAttribute('data-doc-open') || a.getAttribute('data-doc-download');
    var save = a.hasAttribute('data-doc-download');
    var label = a.getAttribute('data-doc-name') || 'document';
    var tab = null;
    if (!save) { try { tab = window.open('', '_blank'); } catch (e) { tab = null; } }
    if (tab) { try { tab.document.title = label; tab.document.body.textContent = 'Opening ' + label + '…'; } catch (e2) {} }
    var old = a.textContent;
    a.setAttribute('aria-busy', 'true');
    a.style.opacity = '0.6';
    a.style.pointerEvents = 'none';
    incidentDoc(id).then(function (v) {
      if (save) {
        var dl = document.createElement('a');
        dl.href = v.url; dl.download = v.name; document.body.appendChild(dl); dl.click(); dl.remove();
      } else if (tab) {
        tab.location.href = v.url;
      } else {
        window.open(v.url, '_blank') || (location.href = v.url);
      }
    }, function (e) {
      if (tab) { try { tab.close(); } catch (e3) {} }
      alert((e && e.message) || ('Could not open ' + label));
    }).then(function () {
      a.removeAttribute('aria-busy'); a.style.opacity = ''; a.style.pointerEvents = ''; a.textContent = old;
    });
  });
})();
