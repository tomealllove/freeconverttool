/* PDF Compressor: light (pdf-lib re-save + metadata cleanup) / reprint (pdf.js renders JPEG + pdf-lib assembles) */
(function () {
  'use strict';

  FT.mountShell('pdf-compress');

  var MAX_PDF = 100 * 1024 * 1024;
  var MAX_SIDE = 8192;

  var drop = FT.$('#drop');
  var input = FT.$('#file');
  var fileInfo = FT.$('#fileInfo');
  var level = FT.$('#level');
  var dpiSel = FT.$('#dpi');
  var dpiField = FT.$('#dpiField');
  var quality = FT.$('#quality');
  var qualityVal = FT.$('#qualityVal');
  var qualityField = FT.$('#qualityField');
  var runBtn = FT.$('#run');
  var resetBtn = FT.$('#reset');
  var progress = FT.$('#progress');
  var tips = FT.$('#tips');
  var summary = FT.$('#summary');
  var empty = FT.$('#empty');
  var emptyText = FT.$('#emptyText');
  var outCard = FT.$('#outCard');
  var stats = FT.$('#stats');
  var downloadBtn = FT.$('#download');

  var state = { file: null, doc: null, total: 0, base: '', busy: false, cancel: false };
  var outBlob = null;

  function stat(k, v, cls) {
    return '<div class="stat"><div class="k">' + k + '</div>' +
      '<div class="v' + (cls ? ' ' + cls : '') + '">' + v + '</div></div>';
  }

  function isReprint() { return level.value === 'reprint'; }

  function showLevelTip() {
    if (isReprint()) {
      FT.alert(tips, 'warn', '<b>Reprint compression turns text into images</b>' +
        '<p>Every page is rendered as JPEG and pasted back into the PDF, so <b>text will no longer be selectable, searchable or copyable</b> ' +
        'and will look blurry when zoomed in. Use it only for archiving, printing or distribution — not for files you still need to edit or search.</p>' +
        '<p>True "font subsetting + lossy image resampling" compression is far too costly in a browser (it needs bundled fonts and an image re-encoding pipeline), ' +
        'so this page uses the reprint approach instead. Use "Light" if you need to keep the text.</p>');
    } else {
      FT.alert(tips, 'info', '<b>Light compression: mainly removes redundant structure and metadata</b>' +
        '<p>The PDF is re-saved with pdf-lib (object streams enabled) and title / author / subject / keywords metadata is cleared; ' +
        '<b>text stays selectable and searchable and the page content is unchanged</b>. Size usually drops only a few percent, ' +
        'and if the source file is already compact the result may even be slightly larger.</p>' +
        '<p>For a much smaller file, use "Reprint" (text becomes images).</p>');
    }
  }

  if (typeof PDFLib === 'undefined') {
    FT.depMissing(tips, 'pdf-lib', 'This page relies on pdf-lib to read and write PDFs. Please check your connection and refresh the page.');
  } else {
    showLevelTip();
  }

  /* ---------------- Upload ---------------- */

  function resetAll(clearFile) {
    state.cancel = true;
    state.busy = false;
    if (state.doc) { try { state.doc.destroy(); } catch (e) { /* ignore */ } }
    state.doc = null;
    outBlob = null;
    outCard.hidden = true;
    downloadBtn.disabled = true;
    stats.innerHTML = '';
    if (clearFile) {
      state.file = null;
      state.total = 0;
      input.value = '';
      fileInfo.innerHTML = '';
      summary.textContent = 'No PDF loaded';
      emptyText.textContent = 'Upload a PDF and click "Compress" — the size comparison appears here';
      empty.hidden = false;
    }
    runBtn.disabled = !state.doc;
    resetBtn.disabled = !state.file;
  }

  function loadPdf(file) {
    if (FT.extName(file.name) !== 'pdf' && file.type !== 'application/pdf') {
      FT.toast('Please select a PDF file', 'err');
      return;
    }
    if (file.size > MAX_PDF) {
      FT.toast('The PDF exceeds 100MB — please split it first', 'err');
      return;
    }
    if (typeof PDFLib === 'undefined') {
      FT.depMissing(tips, 'pdf-lib', 'This page relies on pdf-lib to read and write PDFs. Please check your connection and refresh the page.');
      return;
    }

    resetAll(false);
    state.file = file;
    state.base = FT.safeName(FT.baseName(file.name));
    summary.textContent = 'Reading ' + file.name + ' …';
    FT.busyProgress(progress, 'Parsing PDF…');

    FT.readArrayBuffer(file)
      .then(function (buf) { return FT.loadPdf(new Uint8Array(buf)); })
      .then(function (doc) {
        state.doc = doc;
        state.total = doc.numPages;
        fileInfo.innerHTML = '<span class="file-chip"><span class="fc-name">' + FT.esc(file.name) + '</span>' +
          '<span class="fc-size">' + doc.numPages + ' pages · ' + FT.formatBytes(file.size) + '</span></span>';
        runBtn.disabled = false;
        resetBtn.disabled = false;
        summary.textContent = file.name + ' · ' + doc.numPages + ' pages · ' + FT.formatBytes(file.size);
        emptyText.textContent = 'Ready: ' + doc.numPages + ' pages. Click "Compress"';
        empty.hidden = false;
        FT.resetProgress(progress);
        FT.toast('PDF loaded: ' + doc.numPages + ' pages', 'ok');
      })
      .catch(function (err) {
        console.error(err);
        FT.resetProgress(progress);
        state.file = null;
        resetBtn.disabled = true;
        summary.textContent = 'Failed to read the PDF';
        FT.alert(tips, 'err', '<b>Could not parse this PDF</b><p>' +
          FT.esc((err && err.message) || 'The file may be corrupt, encrypted, or not a standard PDF') + '</p>' +
          '<p>For light compression you can refresh and retry; repeated failure means this PDF has an unusual structure.</p>');
      });
  }

  /* ---------------- Light compression ---------------- */

  function compressLight() {
    return FT.readArrayBuffer(state.file)
      .then(function (buf) { return PDFLib.PDFDocument.load(new Uint8Array(buf), { updateMetadata: false }); })
      .then(function (doc) {
        try {
          doc.setTitle('');
          doc.setAuthor('');
          doc.setSubject('');
          doc.setKeywords([]);
          doc.setProducer('');
          doc.setCreator('');
        } catch (e) { /* Some PDFs do not allow metadata edits, ignore */ }
        return doc.save({ useObjectStreams: true });
      })
      .then(function (bytes) {
        return { blob: new Blob([bytes], { type: 'application/pdf' }), failed: 0 };
      });
  }

  /* ---------------- Reprint compression ---------------- */

  function renderPageJpeg(num, dpi, q) {
    return state.doc.getPage(num).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var pw = base.width, ph = base.height;
      var s = dpi / 72;
      var maxDim = Math.max(pw, ph) * s;
      if (maxDim > MAX_SIDE) s = s * (MAX_SIDE / maxDim);
      var viewport = page.getViewport({ scale: s });
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: viewport }).promise
        .then(function () { return FT.canvasToBlob(canvas, 'image/jpeg', q); })
        .then(function (blob) { return blob.arrayBuffer(); })
        .then(function (buf) { return { bytes: new Uint8Array(buf), pw: pw, ph: ph }; });
    });
  }

  function compressReprint() {
    var dpi = Number(dpiSel.value) || 96;
    var q = Number(quality.value) / 100;
    var doc = null, i = 0, failed = 0;

    function step() {
      if (state.cancel) return Promise.resolve();
      if (i >= state.total) return Promise.resolve();
      var num = i + 1;
      FT.setProgress(progress, i / state.total, 'Processing ' + num + '/' + state.total);
      i++;
      return renderPageJpeg(num, dpi, q).then(function (res) {
        return doc.embedJpg(res.bytes).then(function (img) {
          var page = doc.addPage([res.pw, res.ph]);
          page.drawImage(img, { x: 0, y: 0, width: res.pw, height: res.ph });
        });
      }).catch(function (err) {
        console.error(err);
        failed++;
      }).then(step);
    }

    return PDFLib.PDFDocument.create()
      .then(function (d) { doc = d; return step(); })
      .then(function () {
        if (state.cancel) return null;
        FT.setProgress(progress, 0.94, 'Writing PDF…');
        return doc.save({ useObjectStreams: true });
      })
      .then(function (bytes) {
        if (!bytes) return null;
        return { blob: new Blob([bytes], { type: 'application/pdf' }), failed: failed };
      });
  }

  /* ---------------- Run ---------------- */

  function run() {
    if (!state.file || state.busy) return;
    if (typeof PDFLib === 'undefined') {
      FT.depMissing(tips, 'pdf-lib', 'This page relies on pdf-lib to read and write PDFs. Please check your connection and refresh the page.');
      return;
    }
    if (isReprint() && !FT.pdfjsReady()) {
      FT.depMissing(tips, 'pdf.js', 'Reprint compression relies on pdf.js to render pages. Please check your connection and refresh the page.');
      return;
    }
    if (isReprint() && state.total > 60 &&
      !confirm('This will reprint ' + state.total + ' pages — it takes a while and uses a lot of memory. Continue?')) return;

    state.busy = true;
    state.cancel = false;
    outBlob = null;
    outCard.hidden = true;
    downloadBtn.disabled = true;
    empty.hidden = true;
    showLevelTip();

    var startSize = state.file.size;
    var t0 = Date.now();
    FT.setBusy(runBtn, true, 'Compressing…');
    FT.setProgress(progress, 0, 'Preparing…');

    var job = isReprint() ? compressReprint() : compressLight();

    job.then(function (res) {
      if (state.cancel) { FT.toast('Compression cancelled', 'warn'); return; }
      if (!res) return;
      var blob = res.blob;
      outBlob = blob;
      var delta = FT.pct(blob.size, startSize);
      var smaller = blob.size < startSize;
      var sec = ((Date.now() - t0) / 1000).toFixed(1);

      stats.innerHTML =
        stat('Original size', FT.formatBytes(startSize)) +
        stat('Compressed', FT.formatBytes(blob.size)) +
        stat('Size change', delta, smaller ? 'down' : 'up') +
        stat('Pages / time', state.total + ' pages · ' + sec + 's');
      outCard.hidden = false;
      downloadBtn.disabled = false;
      summary.textContent = state.file.name + ' · size ' + delta + (smaller ? ' (reduced)' : ' (larger)');
      FT.setProgress(progress, 1, 'Done');

      if (!smaller) {
        FT.alert(tips, 'warn', '<b>Size did not shrink</b>' +
          '<p>This PDF may already be compact' + (isReprint() ? '' : ' (light compression mainly removes redundant structure and metadata, so gains are limited)') +
          ', so the result is slightly larger than the original. ' + (isReprint() ? 'Try a lower resolution or quality.' : 'Use "Reprint" for a bigger reduction.') + '</p>', true);
      }
      FT.toast('Compression complete: ' + FT.formatBytes(startSize) + ' → ' + FT.formatBytes(blob.size) +
        (res.failed ? ' (' + res.failed + ' page(s) failed)' : ''), res.failed ? 'warn' : 'ok');
      setTimeout(function () { FT.resetProgress(progress); }, 1800);
    }).catch(function (err) {
      console.error(err);
      FT.resetProgress(progress);
      empty.hidden = false;
      FT.alert(tips, 'err', '<b>Compression failed</b><p>' +
        FT.esc((err && err.message) || 'Unknown error') + '</p>' +
        '<p>The file may be encrypted, corrupt, or use an unusual structure.</p>', true);
      FT.toast('Compression failed', 'err');
    }).then(function () {
      state.busy = false;
      FT.setBusy(runBtn, false);
      runBtn.disabled = !state.doc;
    });
  }

  /* ---------------- Events ---------------- */

  runBtn.addEventListener('click', run);

  downloadBtn.addEventListener('click', function () {
    if (!outBlob) {
      FT.toast('No compressed file yet — click "Compress" first', 'warn');
      return;
    }
    FT.saveBlob(outBlob, state.base + (isReprint() ? '-reprint' : '-min') + '.pdf');
  });

  resetBtn.addEventListener('click', function () {
    resetAll(true);
    FT.resetProgress(progress);
    if (typeof PDFLib !== 'undefined') showLevelTip();
  });

  level.addEventListener('change', function () {
    dpiField.hidden = !isReprint();
    qualityField.hidden = !isReprint();
    showLevelTip();
  });
  quality.addEventListener('input', function () { qualityVal.textContent = quality.value + '%'; });

  FT.bindDropzone(drop, input, function (files) { if (files[0]) loadPdf(files[0]); });
})();
