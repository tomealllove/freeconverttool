/* Images to PDF: upload images → adjust page order → set page options → build with pdf-lib → download */
(function () {
  'use strict';

  FT.mountShell('img-to-pdf');

  var MAX_SIZE = 20 * 1024 * 1024;
  var MAX_COUNT = 60;
  var MM = 2.83465;                 // pt per millimetre
  var A4W = 595.28, A4H = 841.89;   // A4 size in pt
  var EXT_MAP = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif'
  };
  var ICON_UP = '<polyline points="18 15 12 9 6 15"/>';
  var ICON_DOWN = '<polyline points="6 9 12 15 18 9"/>';
  var ICON_X = '<path d="M6 6l12 12M18 6L6 18"/>';

  var drop = FT.$('#drop');
  var input = FT.$('#file');
  var chips = FT.$('#chips');
  var list = FT.$('#list');
  var empty = FT.$('#empty');
  var summary = FT.$('#summary');
  var tips = FT.$('#tips');
  var pageSize = FT.$('#pageSize');
  var margin = FT.$('#margin');
  var fit = FT.$('#fit');
  var quality = FT.$('#quality');
  var qualityVal = FT.$('#qualityVal');
  var recompress = FT.$('#recompress');
  var buildBtn = FT.$('#build');
  var clearBtn = FT.$('#clear');
  var progress = FT.$('#progress');
  var outCard = FT.$('#outCard');
  var outStats = FT.$('#outStats');
  var downloadBtn = FT.$('#download');

  var items = [];
  var outBlob = null;
  var dragFrom = -1;

  function detectType(file) {
    if (file.type && file.type.indexOf('image/') === 0) return file.type;
    return EXT_MAP[FT.extName(file.name)] || '';
  }

  function stat(k, v, cls) {
    return '<div class="stat"><div class="k">' + k + '</div>' +
      '<div class="v' + (cls ? ' ' + cls : '') + '">' + v + '</div></div>';
  }

  /* ---------------- Upload ---------------- */

  function addFiles(files) {
    var added = 0, skipBig = 0, skipType = 0, skipMany = 0;
    files.forEach(function (file) {
      if (items.length >= MAX_COUNT) { skipMany++; return; }
      if (file.size > MAX_SIZE) { skipBig++; return; }
      if (!detectType(file)) { skipType++; return; }
      items.push({
        file: file,
        name: file.name,
        type: detectType(file),
        srcUrl: URL.createObjectURL(file),
        w: 0, h: 0,
        el: null
      });
      added++;
    });

    var msgs = [];
    if (added) msgs.push('Added ' + added + ' image(s)');
    if (skipMany) msgs.push(skipMany + ' over the ' + MAX_COUNT + '-image limit');
    if (skipBig) msgs.push(skipBig + ' over 20MB');
    if (skipType) msgs.push(skipType + ' not a supported image');
    if (!added) FT.toast(msgs.join(', ') || 'No images could be added', 'err');
    else if (msgs.length > 1) FT.toast(msgs.join(', '), 'warn');

    renderAll();
  }

  /* ---------------- List and ordering ---------------- */

  function cardHTML(item, idx, last) {
    var meta = item.w ? item.w + '×' + item.h + ' · ' + FT.formatBytes(item.file.size) : 'Loading…';
    return '' +
      '<div class="item-head">' +
        '<span class="page-num">Page ' + (idx + 1) + '</span>' +
        '<span class="grow"></span>' +
        '<button class="icon-btn act" data-act="up" title="Move up" aria-label="Move up"' +
          (idx === 0 ? ' disabled' : '') + '>' + FT.svg(ICON_UP, 15) + '</button>' +
        '<button class="icon-btn act" data-act="down" title="Move down" aria-label="Move down"' +
          (idx === last ? ' disabled' : '') + '>' + FT.svg(ICON_DOWN, 15) + '</button>' +
        '<button class="icon-btn" data-act="remove" title="Remove" aria-label="Remove">' + FT.svg(ICON_X, 15) + '</button>' +
      '</div>' +
      '<div class="thumb checker"><img src="' + FT.esc(item.srcUrl) + '" alt="Page ' + (idx + 1) + '" data-zoom draggable="false"></div>' +
      '<div class="page-meta">' + meta + '</div>';
  }

  function renderAll() {
    var last = items.length - 1;
    empty.hidden = items.length > 0;
    list.innerHTML = '';
    chips.innerHTML = items.map(function (it, i) {
      return '<span class="file-chip"><span class="fc-name">' + FT.esc(it.name) + '</span>' +
        '<span class="fc-size">' + FT.formatBytes(it.file.size) + '</span>' +
        '<button class="icon-btn" data-chip="' + i + '" aria-label="Remove">' + FT.svg(ICON_X, 15) + '</button></span>';
    }).join('');

    items.forEach(function (item, idx) {
      var el = FT.el('<article class="item page-card">' + cardHTML(item, idx, last) + '</article>');
      item.el = el;
      list.appendChild(el);
      bind(item, idx, last);
      if (!item.w) {
        FT.loadImage(item.srcUrl).then(function (img) {
          item.w = img.naturalWidth;
          item.h = img.naturalHeight;
          if (item.el) {
            var m = item.el.querySelector('.page-meta');
            if (m) m.textContent = item.w + '×' + item.h + ' · ' + FT.formatBytes(item.file.size);
          }
        }).catch(function () {});
      }
    });
    updateBar();
  }

  function bind(item, idx, last) {
    item.el.querySelector('[data-act="up"]').addEventListener('click', function () {
      if (idx > 0) move(idx, idx - 1);
    });
    item.el.querySelector('[data-act="down"]').addEventListener('click', function () {
      if (idx < last) move(idx, idx + 1);
    });
    item.el.querySelector('[data-act="remove"]').addEventListener('click', function () { remove(item); });

    item.el.draggable = true;
    item.el.addEventListener('dragstart', function (e) {
      dragFrom = idx;
      item.el.style.opacity = '.45';
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(idx)); } catch (err) { /* ignore */ }
      }
    });
    item.el.addEventListener('dragend', function () {
      dragFrom = -1;
      item.el.style.opacity = '';
    });
    item.el.addEventListener('dragover', function (e) {
      if (dragFrom >= 0) e.preventDefault();
    });
    item.el.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (dragFrom >= 0 && dragFrom !== idx) move(dragFrom, idx);
      dragFrom = -1;
    });
  }

  function move(from, to) {
    if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return;
    var it = items[from];
    items.splice(from, 1);
    items.splice(to, 0, it);
    renderAll();
  }

  function remove(item) {
    URL.revokeObjectURL(item.srcUrl);
    items = items.filter(function (i) { return i !== item; });
    renderAll();
  }

  function updateBar() {
    var has = items.length > 0;
    buildBtn.disabled = !has;
    clearBtn.disabled = !has;
    summary.textContent = !has ? 'No images added yet'
      : items.length + ' images · original total ' +
        FT.formatBytes(items.reduce(function (s, i) { return s + i.file.size; }, 0));
  }

  /* ---------------- Build the PDF ---------------- */

  function jpegBytes(item, q) {
    return FT.loadImage(item.srcUrl).then(function (img) {
      var w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) throw new Error('Unable to read image dimensions');
      var canvas = FT.drawToCanvas(img, w, h, true);
      return FT.canvasToBlob(canvas, 'image/jpeg', q);
    }).then(function (blob) {
      return blob.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    });
  }

  function embedItem(doc, item, q) {
    var t = item.type;
    var direct = !recompress.checked && (t === 'image/jpeg' || t === 'image/png');
    if (!direct) {
      return jpegBytes(item, q).then(function (bytes) { return doc.embedJpg(bytes); });
    }
    return FT.readArrayBuffer(item.file).then(function (buf) {
      var bytes = new Uint8Array(buf);
      return Promise.resolve()
        .then(function () { return t === 'image/png' ? doc.embedPng(bytes) : doc.embedJpg(bytes); })
        .catch(function () {
          // A few progressive / CMYK JPEGs cannot be embedded directly, so fall back to recompression
          return jpegBytes(item, q).then(function (b) { return doc.embedJpg(b); });
        });
    });
  }

  function build() {
    if (!items.length) { FT.toast('Please add images first', 'err'); return; }
    if (typeof PDFLib === 'undefined') {
      FT.alert(tips, 'err', '<b>The pdf-lib component failed to load</b>' +
        '<p>This page relies on pdf-lib to generate PDFs. Check your connection and reload the page.</p>');
      return;
    }
    tips.innerHTML = '';

    var q = Number(quality.value) / 100;
    var total = items.length;
    var i = 0, doc = null, pw = A4W, ph = A4H;

    function calcPage() {
      if (pageSize.value === 'a4l') { pw = A4H; ph = A4W; return Promise.resolve(); }
      if (pageSize.value !== 'auto') { pw = A4W; ph = A4H; return Promise.resolve(); }
      var first = items[0];
      if (first.w && first.h) {
        pw = Math.max(72, first.w);
        ph = Math.max(72, first.h);
        return Promise.resolve();
      }
      return FT.loadImage(first.srcUrl).then(function (img) {
        first.w = img.naturalWidth;
        first.h = img.naturalHeight;
        pw = Math.max(72, first.w);
        ph = Math.max(72, first.h);
      });
    }

    // Compute the drawing box on the page: contain centers the image with padding, cover fills the page
    function place(iw, ih) {
      var m = Number(margin.value) * MM;
      var boxW = pw - m * 2, boxH = ph - m * 2;
      if (boxW < 1 || boxH < 1) { boxW = pw; boxH = ph; }
      var s = fit.value === 'cover'
        ? Math.max(boxW / iw, boxH / ih)
        : Math.min(boxW / iw, boxH / ih);
      var dw = iw * s, dh = ih * s;
      return { x: (pw - dw) / 2, y: (ph - dh) / 2, w: dw, h: dh };
    }

    function step() {
      if (i >= total) return Promise.resolve();
      var item = items[i];
      FT.setProgress(progress, i / (total + 1), 'Processing ' + (i + 1) + '/' + total);
      return FT.nextFrame()
        .then(function () { return embedItem(doc, item, q); })
        .then(function (image) {
          var r = place(image.width, image.height);
          var page = doc.addPage([pw, ph]);
          page.drawImage(image, { x: r.x, y: r.y, width: r.w, height: r.h });
          i++;
          return step();
        });
    }

    FT.setBusy(buildBtn, true, 'Building…');
    FT.setProgress(progress, 0, 'Preparing…');

    calcPage()
      .then(function () { return PDFLib.PDFDocument.create(); })
      .then(function (d) { doc = d; return step(); })
      .then(function () {
        FT.setProgress(progress, (total + 0.6) / (total + 1), 'Writing PDF…');
        return doc.save();
      })
      .then(function (bytes) {
        outBlob = new Blob([bytes], { type: 'application/pdf' });
        outCard.hidden = false;
        downloadBtn.disabled = false;
        outStats.innerHTML =
          stat('Pages', String(total)) +
          stat('Page size', Math.round(pw) + '×' + Math.round(ph) + ' pt') +
          stat('File size', FT.formatBytes(outBlob.size)) +
          stat('Original total', FT.formatBytes(items.reduce(function (s, it) { return s + it.file.size; }, 0)));
        FT.setProgress(progress, 1, 'Done, ' + total + ' pages');
        FT.toast('PDF created with ' + total + ' pages', 'ok');
        setTimeout(function () { FT.resetProgress(progress); }, 2200);
      })
      .catch(function (err) {
        FT.alert(tips, 'err', '<b>Failed to build</b><p>' +
          FT.esc(err && err.message ? err.message : 'Unknown error') + '</p>');
        FT.toast('Failed to build the PDF', 'err');
        FT.resetProgress(progress);
      })
      .then(function () { FT.setBusy(buildBtn, false); });
  }

  /* ---------------- Events ---------------- */

  buildBtn.addEventListener('click', build);

  downloadBtn.addEventListener('click', function () {
    if (!outBlob) {
      FT.toast('No PDF yet. Click "Build PDF" first.', 'warn');
      return;
    }
    FT.saveBlob(outBlob, 'images-' + items.length + 'p.pdf');
  });

  clearBtn.addEventListener('click', function () {
    items.forEach(function (it) { URL.revokeObjectURL(it.srcUrl); });
    items = [];
    outBlob = null;
    outCard.hidden = true;
    downloadBtn.disabled = true;
    outStats.innerHTML = '';
    tips.innerHTML = '';
    FT.resetProgress(progress);
    renderAll();
  });

  quality.addEventListener('input', function () { qualityVal.textContent = quality.value + '%'; });

  chips.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-chip]');
    if (!btn) return;
    var item = items[Number(btn.getAttribute('data-chip'))];
    if (item) remove(item);
  });

  FT.bindDropzone(drop, input, addFiles, { multiple: true });

  if (typeof PDFLib === 'undefined') {
    FT.alert(tips, 'err', '<b>The pdf-lib component failed to load</b>' +
      '<p>This page relies on pdf-lib to generate PDFs. Check your connection and reload the page.</p>');
  }
  renderAll();
})();
