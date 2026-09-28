/* Merge & Split PDF: merge mode (reorder and concatenate several files) / split mode (by page count or page ranges) · built on pdf-lib */
(function () {
  'use strict';

  FT.mountShell('pdf-merge');

  var MAX_PDF = 100 * 1024 * 1024;
  var ICON_UP = '<polyline points="18 15 12 9 6 15"/>';
  var ICON_DOWN = '<polyline points="6 9 12 15 18 9"/>';
  var ICON_X = '<path d="M6 6l12 12M18 6L6 18"/>';

  var drop = FT.$('#drop');
  var input = FT.$('#file');
  var chips = FT.$('#chips');
  var modeSel = FT.$('#mode');
  var dzTitle = FT.$('#dzTitle');
  var dzSub = FT.$('#dzSub');
  var mergeOpts = FT.$('#mergeOpts');
  var splitOpts = FT.$('#splitOpts');
  var splitBy = FT.$('#splitBy');
  var everyField = FT.$('#everyField');
  var everyN = FT.$('#everyN');
  var rangesField = FT.$('#rangesField');
  var ranges = FT.$('#ranges');
  var splitHelp = FT.$('#splitHelp');
  var runBtn = FT.$('#run');
  var clearBtn = FT.$('#clear');
  var progress = FT.$('#progress');
  var tips = FT.$('#tips');
  var resultTitle = FT.$('#resultTitle');
  var summary = FT.$('#summary');
  var empty = FT.$('#empty');
  var emptyText = FT.$('#emptyText');
  var list = FT.$('#list');
  var outCard = FT.$('#outCard');
  var outTitle = FT.$('#outTitle');
  var outStats = FT.$('#outStats');
  var splitList = FT.$('#splitList');
  var outActions = FT.$('#outActions');

  var state = { mode: 'merge', files: [], busy: false };
  var outBlob = null;
  var parts = [];

  function stat(k, v, cls) {
    return '<div class="stat"><div class="k">' + k + '</div>' +
      '<div class="v' + (cls ? ' ' + cls : '') + '">' + v + '</div></div>';
  }

  function pad3(n) { return String(n).padStart(3, '0'); }

  if (typeof PDFLib === 'undefined') {
    FT.depMissing(tips, 'pdf-lib', 'This page relies on pdf-lib to read and write PDFs. Please check your connection and refresh the page.');
  }

  /* ---------------- Loading ---------------- */

  function checkFile(file) {
    if (FT.extName(file.name) !== 'pdf' && file.type !== 'application/pdf') {
      FT.toast('"' + file.name + '" is not a PDF', 'err');
      return false;
    }
    if (file.size > MAX_PDF) {
      FT.toast('"' + file.name + '" exceeds 100MB — please compress it first', 'err');
      return false;
    }
    if (typeof PDFLib === 'undefined') {
      FT.depMissing(tips, 'pdf-lib', 'This page relies on pdf-lib to read and write PDFs. Please check your connection and refresh the page.');
      return false;
    }
    return true;
  }

  function loadOne(file) {
    return FT.readArrayBuffer(file)
      .then(function (buf) { return PDFLib.PDFDocument.load(new Uint8Array(buf)); })
      .then(function (doc) {
        return { file: file, name: file.name, size: file.size, pages: doc.getPageCount(), doc: doc };
      });
  }

  function addFiles(files) {
    if (state.busy) return;
    if (state.mode === 'split') {
      var one = files[0];
      if (!one || !checkFile(one)) return;
      FT.busyProgress(progress, 'Reading PDF…');
      loadOne(one).then(function (rec) {
        releaseAll();
        state.files = [rec];
        renderAll();
        FT.resetProgress(progress);
        FT.toast('Loaded ' + rec.name + ', ' + rec.pages + ' pages', 'ok');
      }).catch(function (err) {
        console.error(err);
        FT.resetProgress(progress);
        FT.alert(tips, 'err', '<b>Could not parse this PDF</b><p>' +
          FT.esc((err && err.message) || 'The file may be corrupt, encrypted, or not a standard PDF') + '</p>');
      });
      return;
    }

    var todo = files.filter(checkFile);
    if (!todo.length) return;
    var i = 0, added = 0;
    FT.setProgress(progress, 0, 'Reading…');
    (function step() {
      if (i >= todo.length) {
        FT.resetProgress(progress);
        renderAll();
        FT.toast(added ? 'Added ' + added + ' PDF(s)' : 'No files could be added', added ? 'ok' : 'err');
        return;
      }
      FT.setProgress(progress, i / todo.length, 'Reading ' + (i + 1) + '/' + todo.length);
      var file = todo[i++];
      loadOne(file).then(function (rec) {
        state.files.push(rec);
        added++;
      }).catch(function (err) {
        console.error(err);
        FT.toast('"' + file.name + '" failed to load: ' + ((err && err.message) || 'Could not parse'), 'err');
      }).then(step);
    })();
  }

  function releaseAll() {
    state.files = [];
  }

  /* ---------------- Rendering ---------------- */

  function cardHTML(rec, idx, last, isMerge) {
    var meta = rec.pages + ' pages · ' + FT.formatBytes(rec.size);
    var head = isMerge
      ? '<div class="item-head">' +
          '<span class="page-num">' + (idx + 1) + '</span>' +
          '<span class="item-name" title="' + FT.esc(rec.name) + '">' + FT.esc(rec.name) + '</span>' +
          '<button class="icon-btn" data-act="up" title="Move up" aria-label="Move up"' + (idx === 0 ? ' disabled' : '') + '>' + FT.svg(ICON_UP, 15) + '</button>' +
          '<button class="icon-btn" data-act="down" title="Move down" aria-label="Move down"' + (idx === last ? ' disabled' : '') + '>' + FT.svg(ICON_DOWN, 15) + '</button>' +
          '<button class="icon-btn" data-act="remove" title="Remove" aria-label="Remove">' + FT.svg(ICON_X, 15) + '</button>' +
        '</div>'
      : '<div class="item-head">' +
          '<span class="item-name" title="' + FT.esc(rec.name) + '">' + FT.esc(rec.name) + '</span>' +
          '<button class="icon-btn" data-act="remove" title="Remove" aria-label="Remove">' + FT.svg(ICON_X, 15) + '</button>' +
        '</div>';
    return head + '<div class="page-meta">' + meta + '</div>';
  }

  function renderAll() {
    var isMerge = state.mode === 'merge';
    var last = state.files.length - 1;
    empty.hidden = state.files.length > 0;
    chips.innerHTML = state.files.map(function (it, i) {
      return '<span class="file-chip"><span class="fc-name">' + FT.esc(it.name) + '</span>' +
        '<span class="fc-size">' + it.pages + ' pages · ' + FT.formatBytes(it.size) + '</span>' +
        '<button class="icon-btn" data-chip="' + i + '" aria-label="Remove">' + FT.svg(ICON_X, 15) + '</button></span>';
    }).join('');

    list.innerHTML = '';
    state.files.forEach(function (rec, idx) {
      var el = FT.el('<article class="item">' + cardHTML(rec, idx, last, isMerge) + '</article>');
      list.appendChild(el);
      var up = el.querySelector('[data-act="up"]');
      var down = el.querySelector('[data-act="down"]');
      if (up) up.addEventListener('click', function () { move(idx, idx - 1); });
      if (down) down.addEventListener('click', function () { move(idx, idx + 1); });
      el.querySelector('[data-act="remove"]').addEventListener('click', function () { removeAt(idx); });
    });
    updateBar();
  }

  function updateBar() {
    var has = state.files.length > 0;
    var isMerge = state.mode === 'merge';
    clearBtn.disabled = !has;
    runBtn.disabled = !has || state.busy;
    runBtn.textContent = isMerge ? 'Merge' : 'Split';

    var totalPages = state.files.reduce(function (s, r) { return s + r.pages; }, 0);
    var totalSize = state.files.reduce(function (s, r) { return s + r.size; }, 0);
    summary.textContent = !has ? 'No PDF added yet'
      : (isMerge
        ? state.files.length + ' files · ' + totalPages + ' pages · ' + FT.formatBytes(totalSize) + ' total'
        : state.files[0].name + ' · ' + totalPages + ' pages · ' + FT.formatBytes(totalSize));

    if (has) {
      empty.hidden = true;
    } else {
      empty.hidden = false;
      emptyText.textContent = isMerge
        ? 'Add two or more PDFs to reorder and merge them here'
        : 'Upload one PDF to split it into several files here';
    }
  }

  function move(from, to) {
    if (from < 0 || to < 0 || from >= state.files.length || to >= state.files.length || from === to) return;
    var it = state.files[from];
    state.files.splice(from, 1);
    state.files.splice(to, 0, it);
    renderAll();
  }

  function removeAt(idx) {
    var rec = state.files[idx];
    if (!rec) return;
    state.files.splice(idx, 1);
    renderAll();
  }

  /* ---------------- Merge ---------------- */

  function doMerge() {
    if (state.files.length < 2) { FT.toast('Merge mode needs at least 2 PDFs', 'err'); return; }
    if (typeof PDFLib === 'undefined') {
      FT.depMissing(tips, 'pdf-lib', 'This page relies on pdf-lib to read and write PDFs. Please check your connection and refresh the page.');
      return;
    }
    var out = null, i = 0, failed = [];
    state.busy = true;
    runBtn.disabled = true;
    clearBtn.disabled = true;
    tips.innerHTML = '';
    outCard.hidden = true;
    outBlob = null;
    parts = [];
    splitList.innerHTML = '';

    function step() {
      if (i >= state.files.length) return Promise.resolve();
      var rec = state.files[i];
      FT.setProgress(progress, i / state.files.length, 'Processing ' + (i + 1) + '/' + state.files.length);
      return FT.nextFrame().then(function () {
        return out.copyPages(rec.doc, rec.doc.getPageIndices());
      }).then(function (copied) {
        copied.forEach(function (p) { out.addPage(p); });
        i++;
        return step();
      }).catch(function (err) {
        console.error(err);
        failed.push(rec.name);
        i++;
        return step();
      });
    }

    FT.setBusy(runBtn, true, 'Merging…');
    FT.setProgress(progress, 0, 'Preparing…');
    PDFLib.PDFDocument.create()
      .then(function (d) { out = d; return step(); })
      .then(function () {
        FT.setProgress(progress, 0.9, 'Writing PDF…');
        return out.save();
      })
      .then(function (bytes) {
        outBlob = new Blob([bytes], { type: 'application/pdf' });
        var totalPages = state.files.reduce(function (s, r) { return s + r.pages; }, 0);
        var totalSize = state.files.reduce(function (s, r) { return s + r.size; }, 0);
        outTitle.textContent = 'Merge Result';
        outStats.innerHTML =
          stat('Files merged', state.files.length) +
          stat('Total pages', String(totalPages)) +
          stat('Output size', FT.formatBytes(outBlob.size)) +
          stat('Source total', FT.formatBytes(totalSize));
        outActions.innerHTML = '<button class="btn btn-primary" id="dlMerged">Download Merged PDF</button>';
        FT.$('#dlMerged').addEventListener('click', function () {
          if (!outBlob) return;
          FT.saveBlob(outBlob, FT.safeName(FT.baseName(state.files[0].name)) + '-merged.pdf');
        });
        outCard.hidden = false;
        FT.setProgress(progress, 1, 'Done');
        FT.toast('Merge complete: ' + totalPages + ' pages' + (failed.length ? ', ' + failed.length + ' file(s) failed' : ''),
          failed.length ? 'warn' : 'ok');
        setTimeout(function () { FT.resetProgress(progress); }, 1800);
      })
      .catch(function (err) {
        console.error(err);
        FT.resetProgress(progress);
        FT.alert(tips, 'err', '<b>Merge failed</b><p>' +
          FT.esc((err && err.message) || 'Unknown error') + '</p>');
        FT.toast('Merge failed', 'err');
      })
      .then(function () {
        state.busy = false;
        FT.setBusy(runBtn, false);
        updateBar();
      });
  }

  /* ---------------- Split ---------------- */

  function buildSplitRanges(total) {
    var out = [];
    if (splitBy.value === 'every') {
      var n = parseInt(everyN.value, 10);
      if (!(n >= 1)) {
        FT.toast('Pages per part must be an integer of at least 1', 'err');
        return null;
      }
      for (var s = 1; s <= total; s += n) out.push({ start: s, end: Math.min(s + n - 1, total) });
      return out;
    }
    var txt = (ranges.value || '').trim();
    if (!txt) {
      FT.toast('Please enter page ranges, e.g. 1-3,4-8,9-12', 'err');
      return null;
    }
    var segs = txt.split(/[,，\s]+/).filter(Boolean);
    for (var i = 0; i < segs.length; i++) {
      var m = segs[i].match(/^(\d+)(?:-(\d+))?$/);
      if (!m) {
        FT.toast('Invalid page range: ' + segs[i], 'err');
        return null;
      }
      var a = parseInt(m[1], 10);
      var b = m[2] ? parseInt(m[2], 10) : a;
      if (a < 1 || b < a || b > total) {
        FT.toast('Page out of range (' + total + ' pages total): ' + segs[i], 'err');
        return null;
      }
      out.push({ start: a, end: b });
    }
    return out;
  }

  function doSplit() {
    var rec = state.files[0];
    if (!rec) { FT.toast('Please upload a PDF first', 'err'); return; }
    if (typeof PDFLib === 'undefined') {
      FT.depMissing(tips, 'pdf-lib', 'This page relies on pdf-lib to read and write PDFs. Please check your connection and refresh the page.');
      return;
    }
    var segs = buildSplitRanges(rec.pages);
    if (!segs || !segs.length) return;

    state.busy = true;
    runBtn.disabled = true;
    clearBtn.disabled = true;
    tips.innerHTML = '';
    outCard.hidden = true;
    outBlob = null;
    parts = [];
    splitList.innerHTML = '';
    outStats.innerHTML = '';
    outActions.innerHTML = '';

    var base = FT.safeName(FT.baseName(rec.name));
    var i = 0, failed = 0;

    function step() {
      if (i >= segs.length) return Promise.resolve();
      var seg = segs[i];
      FT.setProgress(progress, i / segs.length, 'Processing ' + (i + 1) + '/' + segs.length);
      var indices = [];
      for (var p = seg.start; p <= seg.end; p++) indices.push(p - 1);
      var partDoc = null;
      return FT.nextFrame()
        .then(function () { return PDFLib.PDFDocument.create(); })
        .then(function (d) {
          partDoc = d;
          return d.copyPages(rec.doc, indices);
        })
        .then(function (copied) {
          copied.forEach(function (p) { partDoc.addPage(p); });
          return partDoc.save();
        })
        .then(function (bytes) {
          var blob = new Blob([bytes], { type: 'application/pdf' });
          parts.push({
            name: base + '-p' + pad3(seg.start) + '-' + pad3(seg.end) + '.pdf',
            range: 'Pages ' + seg.start + '-' + seg.end,
            blob: blob
          });
          i++;
          return step();
        })
        .catch(function (err) {
          console.error(err);
          failed++;
          i++;
          return step();
        });
    }

    FT.setBusy(runBtn, true, 'Splitting…');
    FT.setProgress(progress, 0, 'Preparing…');
    step().then(function () {
      renderSplit(rec, failed);
      FT.setProgress(progress, 1, 'Done');
      FT.toast('Split complete: ' + parts.length + ' file(s)' + (failed ? ', ' + failed + ' segment(s) failed' : ''),
        failed ? 'warn' : 'ok');
      setTimeout(function () { FT.resetProgress(progress); }, 1800);
    }).catch(function (err) {
      console.error(err);
      FT.resetProgress(progress);
      FT.alert(tips, 'err', '<b>Split failed</b><p>' + FT.esc((err && err.message) || 'Unknown error') + '</p>');
      FT.toast('Split failed', 'err');
    }).then(function () {
      state.busy = false;
      FT.setBusy(runBtn, false);
      updateBar();
    });
  }

  function renderSplit(rec, failed) {
    if (!parts.length) {
      FT.alert(tips, 'err', '<b>No files were generated</b><p>Please check the split rules and try again.</p>');
      return;
    }
    outTitle.textContent = 'Split Result';
    var totalOut = parts.reduce(function (s, p) { return s + p.blob.size; }, 0);
    outStats.innerHTML =
      stat('Source file', rec.pages + ' pages') +
      stat('Segments', String(parts.length)) +
      stat('Output total', FT.formatBytes(totalOut)) +
      stat('Failed segments', String(failed || 0));

    splitList.innerHTML = '';
    parts.forEach(function (p) {
      var el = FT.el(
        '<article class="item">' +
          '<div class="item-head"><span class="item-name" title="' + FT.esc(p.name) + '">' + FT.esc(p.name) + '</span>' +
          '<span class="badge acc">' + p.range + '</span></div>' +
          '<div class="page-meta">' + FT.formatBytes(p.blob.size) + '</div>' +
          '<div class="item-actions"><button class="btn btn-sm" data-act="dl">Download</button></div>' +
        '</article>'
      );
      el.querySelector('[data-act="dl"]').addEventListener('click', function () {
        FT.saveBlob(p.blob, p.name);
      });
      splitList.appendChild(el);
    });

    outActions.innerHTML = '<button class="btn btn-primary" id="dlZip">Download ZIP (' + parts.length + ')</button>';
    FT.$('#dlZip').addEventListener('click', function () {
      if (!parts.length) return;
      if (parts.length === 1) { FT.saveBlob(parts[0].blob, parts[0].name); return; }
      var btn = FT.$('#dlZip');
      FT.setBusy(btn, true, 'Zipping…');
      FT.setProgress(progress, 0.3, 'Packing…');
      FT.makeZip(parts.map(function (p) { return { name: p.name, blob: p.blob }; }))
        .then(function (zip) {
          FT.saveBlob(zip, FT.safeName(FT.baseName(rec.name)) + '-split-' + parts.length + '.zip');
          FT.setProgress(progress, 1, 'Packing done');
          FT.toast('Packed ' + parts.length + ' files', 'ok');
        })
        .catch(function (err) { FT.toast('Pack failed: ' + ((err && err.message) || err), 'err'); })
        .then(function () {
          FT.setBusy(btn, false);
          setTimeout(function () { FT.resetProgress(progress); }, 1500);
        });
    });
    outCard.hidden = false;
  }

  /* ---------------- Events ---------------- */

  function switchMode() {
    state.mode = modeSel.value;
    releaseAll();
    parts = [];
    outBlob = null;
    outCard.hidden = true;
    outStats.innerHTML = '';
    splitList.innerHTML = '';
    outActions.innerHTML = '';
    splitOpts.hidden = state.mode !== 'split';
    mergeOpts.hidden = state.mode !== 'merge';
    dzTitle.textContent = state.mode === 'merge'
      ? 'Click to select files, or drag & drop them here'
      : 'Click to select one PDF, or drag & drop it here';
    dzSub.textContent = state.mode === 'merge'
      ? 'Up to 100MB per PDF; select several at once or add them in batches'
      : 'Up to 100MB per PDF; uploading again replaces the current file';
    resultTitle.textContent = state.mode === 'merge' ? 'Files to Merge' : 'File to Split';
    tips.innerHTML = '';
    input.value = '';
    FT.resetProgress(progress);
    renderAll();
  }

  runBtn.addEventListener('click', function () {
    if (state.busy) return;
    if (state.mode === 'merge') doMerge();
    else doSplit();
  });

  clearBtn.addEventListener('click', function () {
    if (state.busy) return;
    releaseAll();
    parts = [];
    outBlob = null;
    outCard.hidden = true;
    outStats.innerHTML = '';
    splitList.innerHTML = '';
    outActions.innerHTML = '';
    input.value = '';
    tips.innerHTML = '';
    FT.resetProgress(progress);
    renderAll();
  });

  splitBy.addEventListener('change', function () {
    var every = splitBy.value === 'every';
    everyField.hidden = !every;
    rangesField.hidden = every;
    splitHelp.textContent = every
      ? 'Splits sequentially by page count; the last part may be shorter than the set size.'
      : 'Each range produces one file, e.g. 1-3,4-8,9-12';
  });

  chips.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-chip]');
    if (!btn) return;
    removeAt(Number(btn.getAttribute('data-chip')));
  });

  modeSel.addEventListener('change', switchMode);

  FT.bindDropzone(drop, input, addFiles, { multiple: true });
  switchMode();
})();
