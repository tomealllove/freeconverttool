/* PDF to Images: upload -> pick format and resolution -> render page by page -> preview / per-page download / ZIP */
(function () {
  'use strict';

  FT.mountShell('pdf-to-img');

  var MAX_PDF = 100 * 1024 * 1024;
  var MAX_SIDE = 8192;
  var MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg' };

  var drop = FT.$('#drop');
  var input = FT.$('#file');
  var fileInfo = FT.$('#fileInfo');
  var list = FT.$('#list');
  var empty = FT.$('#empty');
  var emptyText = FT.$('#emptyText');
  var summary = FT.$('#summary');
  var format = FT.$('#format');
  var scale = FT.$('#scale');
  var quality = FT.$('#quality');
  var qualityVal = FT.$('#qualityVal');
  var qualityField = FT.$('#qualityField');
  var rangeInput = FT.$('#range');
  var convertBtn = FT.$('#convert');
  var downloadAll = FT.$('#downloadAll');
  var resetBtn = FT.$('#reset');
  var progress = FT.$('#progress');
  var tips = FT.$('#tips');

  var state = { file: null, doc: null, total: 0, pages: [], busy: false, cancel: false };

  if (!FT.pdfjsReady()) {
    FT.alert(tips, 'warn', '<b>PDF component not loaded</b><p>This page relies on pdf.js (CDN). If you are offline, please reconnect and refresh the page.</p>');
  }

  function parseRange(text, total) {
    var s = (text || '').trim();
    if (!s) return Array.from({ length: total }, function (_, i) { return i + 1; });
    var set = {};
    var parts = s.split(/[,，\s]+/).filter(Boolean);
    for (var i = 0; i < parts.length; i++) {
      var m = parts[i].match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return null;
      var a = parseInt(m[1], 10);
      var b = m[2] ? parseInt(m[2], 10) : a;
      if (a < 1 || b < a || b > total) return null;
      for (var k = a; k <= b; k++) set[k] = true;
    }
    return Object.keys(set).map(Number).sort(function (x, y) { return x - y; });
  }

  function resetAll(clearFile) {
    state.pages.forEach(function (p) { URL.revokeObjectURL(p.url); });
    state.pages = [];
    if (state.doc) { try { state.doc.destroy(); } catch (e) {} }
    state.doc = null;
    state.total = 0;
    state.cancel = true;
    if (clearFile) {
      state.file = null;
      input.value = '';
      fileInfo.innerHTML = '';
      summary.textContent = 'No PDF loaded';
      emptyText.textContent = 'Upload a PDF and click "Convert" — each page becomes one image';
    }
    convertBtn.disabled = true;
    downloadAll.disabled = true;
    downloadAll.textContent = 'Download ZIP';
    resetBtn.disabled = !state.file;
    list.innerHTML = '';
    if (clearFile) empty.hidden = false;
  }

  function loadPdf(file) {
    if (FT.extName(file.name) !== 'pdf' && file.type !== 'application/pdf') {
      FT.toast('Please select a PDF file', 'err');
      return;
    }
    if (file.size > MAX_PDF) {
      FT.toast('The PDF exceeds 100MB — please compress it first', 'err');
      return;
    }
    if (!FT.pdfjsReady()) {
      FT.toast('The PDF component is not loaded. Please reconnect and refresh the page', 'err');
      return;
    }

    resetAll(false);
    state.file = file;
    summary.textContent = 'Reading ' + file.name + ' …';
    FT.busyProgress(progress, 'Parsing PDF…');

    FT.readArrayBuffer(file)
      .then(function (buf) { return FT.loadPdf(new Uint8Array(buf)).then(function (doc) { return doc; }); })
      .then(function (doc) {
        state.doc = doc;
        state.total = doc.numPages;
        fileInfo.innerHTML = '<span class="file-chip"><span class="fc-name">' + FT.esc(file.name) + '</span>' +
          '<span class="fc-size">' + doc.numPages + ' pages · ' + FT.formatBytes(file.size) + '</span></span>';
        convertBtn.disabled = false;
        resetBtn.disabled = false;
        summary.textContent = file.name + ' · ' + doc.numPages + ' pages total';
        emptyText.textContent = 'Ready: ' + doc.numPages + ' pages. Click "Convert" to generate images';
        empty.hidden = false;
        FT.resetProgress(progress);
        FT.toast('PDF loaded: ' + doc.numPages + ' pages', 'ok');
      })
      .catch(function (err) {
        console.error(err);
        FT.resetProgress(progress);
        summary.textContent = 'Failed to read the PDF';
        state.file = null;
        resetBtn.disabled = true;
        FT.alert(tips, 'err', '<b>Could not parse this PDF</b><p>' + FT.esc((err && err.message) || 'The file may be corrupt, encrypted, or not a standard PDF') + '</p>');
      });
  }

  function pageCard(num) {
    var el = FT.el(
      '<article class="item page-card" data-page="' + num + '">' +
        '<div class="item-head"><span class="page-num">Page ' + num + '</span><span class="badge">Rendering…</span></div>' +
        '<div class="thumb checker"><div class="spinner"></div></div>' +
        '<div class="page-meta">Rendering…</div>' +
        '<div class="item-actions"><button class="btn btn-sm" data-act="dl" disabled>Download Page</button></div>' +
      '</article>'
    );
    list.appendChild(el);
    return el;
  }

  function fillCard(el, page, w, h, ext) {
    var tag = el.querySelector('.badge');
    tag.textContent = ext.toUpperCase();
    tag.className = 'badge ok';
    el.querySelector('.thumb').innerHTML = '<img src="' + FT.esc(page.url) + '" alt="Page ' + page.num + '" data-zoom>';
    el.querySelector('.page-meta').textContent = w + '×' + h + ' · ' + FT.formatBytes(page.blob.size);
    var dl = el.querySelector('[data-act="dl"]');
    dl.disabled = false;
    dl.addEventListener('click', function () { FT.saveBlob(page.blob, page.name); });
  }

  function failCard(el, msg) {
    var tag = el.querySelector('.badge');
    tag.textContent = 'Failed';
    tag.className = 'badge err';
    el.querySelector('.thumb').innerHTML = '<span class="muted">' + FT.esc(msg || 'Render failed') + '</span>';
    el.querySelector('.page-meta').textContent = '—';
  }

  function renderPage(num, mime, q) {
    return state.doc.getPage(num).then(function (page) {
      var dpi = [96, 192, 288][Number(scale.value) - 1] || 192;
      var s = dpi / 72;
      var viewport = page.getViewport({ scale: s });
      var maxDim = Math.max(viewport.width, viewport.height);
      if (maxDim > MAX_SIDE) {
        viewport = page.getViewport({ scale: s * (MAX_SIDE / maxDim) });
      }
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
        return FT.canvasToBlob(canvas, mime, q).then(function (blob) {
          return { blob: blob, w: canvas.width, h: canvas.height };
        });
      });
    });
  }

  convertBtn.addEventListener('click', function () {
    if (!state.doc || state.busy) return;
    var pages = parseRange(rangeInput.value, state.total);
    if (!pages) {
      FT.toast('Invalid page range, e.g. 1-5,8 (max ' + state.total + ' pages)', 'err');
      return;
    }
    if (pages.length > 60 && !confirm('This will convert ' + pages.length + ' pages. It may take a while and use a lot of memory. Continue?')) return;

    state.busy = true;
    state.cancel = false;
    tips.innerHTML = '';
    convertBtn.disabled = true;
    downloadAll.disabled = true;
    state.pages.forEach(function (p) { URL.revokeObjectURL(p.url); });
    state.pages = [];
    list.innerHTML = '';
    empty.hidden = true;

    var mime = FT.supportsMime(format.value) ? format.value : 'image/png';
    if (mime !== format.value) FT.toast('This browser does not support that format — using PNG instead', 'warn');
    var q = Number(quality.value) / 100;
    var ext = MIME_EXT[mime] || 'png';
    var base = FT.safeName(FT.baseName(state.file.name));
    var done = 0, failed = 0, i = 0;

    FT.setBusy(convertBtn, true, 'Converting…');

    function step() {
      if (state.cancel) return finish();
      if (i >= pages.length) return finish();
      var num = pages[i];
      var el = pageCard(num);
      FT.setProgress(progress, i / pages.length, (i + 1) + ' / ' + pages.length + ' pages');
      i++;
      renderPage(num, mime, q).then(function (res) {
        var page = {
          num: num,
          blob: res.blob,
          url: URL.createObjectURL(res.blob),
          name: base + '-page-' + String(num).padStart(3, '0') + '.' + ext
        };
        state.pages.push(page);
        fillCard(el, page, res.w, res.h, ext);
        done++;
      }).catch(function (err) {
        console.error(err);
        failCard(el, 'Render failed');
        failed++;
      }).then(function () {
        if (i >= pages.length) FT.setProgress(progress, 1, 'Completed ' + done + ' pages');
        step();
      });
    }

    function finish() {
      state.busy = false;
      FT.setBusy(convertBtn, false);
      convertBtn.disabled = false;
      downloadAll.disabled = state.pages.length === 0;
      downloadAll.textContent = state.pages.length > 1 ? 'Download ZIP (' + state.pages.length + ')' : 'Download ZIP';
      summary.textContent = state.file.name + ' · ' + state.total + ' pages total · ' + state.pages.length + ' converted';
      if (state.cancel) {
        FT.resetProgress(progress);
        FT.toast('Conversion cancelled', 'warn');
      } else {
        FT.toast('Conversion complete: ' + done + ' page(s) done' + (failed ? ', ' + failed + ' failed' : ''), failed ? 'warn' : 'ok');
        setTimeout(function () { FT.resetProgress(progress); }, 1800);
      }
    }

    step();
  });

  downloadAll.addEventListener('click', function () {
    if (!state.pages.length) return;
    if (state.pages.length === 1) { FT.saveBlob(state.pages[0].blob, state.pages[0].name); return; }
    var folder = FT.safeName(FT.baseName(state.file.name));
    FT.setBusy(downloadAll, true, 'Zipping…');
    FT.setProgress(progress, 0.3, 'Packing ' + state.pages.length + ' pages…');
    FT.makeZip(state.pages.map(function (p) { return { name: folder + '/' + p.name, blob: p.blob }; }))
      .then(function (zip) {
        FT.saveBlob(zip, folder + '-images.zip');
        FT.setProgress(progress, 1, 'Packing done');
        FT.toast('Packed ' + state.pages.length + ' page images', 'ok');
      })
      .catch(function (err) { FT.toast('Pack failed: ' + (err.message || err), 'err'); })
      .then(function () {
        FT.setBusy(downloadAll, false);
        setTimeout(function () { FT.resetProgress(progress); }, 1500);
      });
  });

  resetBtn.addEventListener('click', function () {
    state.cancel = true;
    resetAll(true);
    FT.resetProgress(progress);
    tips.innerHTML = '';
  });

  format.addEventListener('change', function () {
    qualityField.hidden = format.value !== 'image/jpeg';
  });
  quality.addEventListener('input', function () { qualityVal.textContent = quality.value + '%'; });

  FT.bindDropzone(drop, input, function (files) { if (files[0]) loadPdf(files[0]); });
  resetAll(true);
})();
