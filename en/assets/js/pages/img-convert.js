/* Image Format Converter: upload images → pick a target format → convert → compare preview / download */
(function () {
  'use strict';

  FT.mountShell('img-convert');

  var MAX_SIZE = 20 * 1024 * 1024;
  var MAX_SIDE = 8192;
  var MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/bmp': 'bmp' };
  var EXT_MAP = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif'
  };

  var drop = FT.$('#drop');
  var input = FT.$('#file');
  var chips = FT.$('#chips');
  var list = FT.$('#list');
  var empty = FT.$('#empty');
  var summary = FT.$('#summary');
  var format = FT.$('#format');
  var quality = FT.$('#quality');
  var qualityVal = FT.$('#qualityVal');
  var qualityField = FT.$('#qualityField');
  var convertAll = FT.$('#convertAll');
  var downloadAll = FT.$('#downloadAll');
  var clearBtn = FT.$('#clear');
  var progress = FT.$('#progress');

  var items = [];

  function detectType(file) {
    if (file.type && file.type.indexOf('image/') === 0) return file.type;
    return EXT_MAP[FT.extName(file.name)] || '';
  }

  function addFiles(files) {
    var added = 0, skipBig = 0, skipType = 0;
    files.forEach(function (file) {
      if (file.size > MAX_SIZE) { skipBig++; return; }
      if (!detectType(file)) { skipType++; return; }
      items.push({
        file: file,
        name: file.name,
        type: detectType(file),
        target: format.value,
        srcUrl: URL.createObjectURL(file),
        w: 0, h: 0,
        blob: null, url: null, outName: '', mime: '',
        status: 'idle', error: ''
      });
      added++;
    });

    var msgs = [];
    if (added) msgs.push('Added ' + added + ' image(s)');
    if (skipBig) msgs.push(skipBig + ' over 20MB');
    if (skipType) msgs.push(skipType + ' not a supported image');
    if (!added) FT.toast(msgs.join(', ') || 'No images could be added', 'err');
    else if (msgs.length > 1) FT.toast(msgs.join(', '), 'warn');

    renderAll();
  }

  function cardHTML(item) {
    var tag = item.status === 'done' ? '<span class="badge ok">Done</span>'
      : item.status === 'error' ? '<span class="badge err">Failed</span>'
      : item.status === 'working' ? '<span class="badge">Converting…</span>'
      : '<span class="badge">Pending</span>';

    var out = item.status === 'done'
      ? '<img src="' + FT.esc(item.url) + '" alt="Result" data-zoom>'
      : '<div class="ph">' + (item.status === 'error' ? 'Conversion failed' : 'Not converted yet') + '</div>';

    var outCap = item.status === 'done'
      ? '<b>' + (MIME_EXT[item.mime] || '').toUpperCase() + '</b> · ' + item.w + '×' + item.h + ' · ' + FT.formatBytes(item.blob.size)
      : (item.status === 'error' ? FT.esc(item.error || 'Conversion failed') : 'Waiting for conversion');

    var origCap = item.w
      ? '<b>' + (FT.extName(item.name).toUpperCase() || 'ORIGINAL') + '</b> · ' + item.w + '×' + item.h + ' · ' + FT.formatBytes(item.file.size)
      : '<b>' + (FT.extName(item.name).toUpperCase() || 'ORIGINAL') + '</b> · ' + FT.formatBytes(item.file.size);

    var opts = Object.keys(MIME_EXT).map(function (m) {
      return '<option value="' + m + '"' + (m === item.target ? ' selected' : '') + '>' + MIME_EXT[m].toUpperCase() + '</option>';
    }).join('');

    return '' +
      '<div class="item-head">' +
        '<span class="item-name" title="' + FT.esc(item.name) + '">' + FT.esc(item.name) + '</span>' + tag +
        '<button class="icon-btn" data-act="remove" title="Remove" aria-label="Remove">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="compare">' +
        '<figure><div class="ph checker"><img src="' + FT.esc(item.srcUrl) + '" alt="Original" data-zoom></div>' +
          '<figcaption>Original · ' + origCap + '</figcaption></figure>' +
        '<figure><div class="ph checker">' + out + '</div><figcaption>Result · ' + outCap + '</figcaption></figure>' +
      '</div>' +
      '<div class="item-actions">' +
        '<select data-act="fmt" aria-label="Target format">' + opts + '</select>' +
        '<button class="btn btn-sm btn-primary" data-act="convert">Convert</button>' +
        '<button class="btn btn-sm" data-act="download"' + (item.status === 'done' ? '' : ' disabled') + '>Download</button>' +
      '</div>';
  }

  function renderAll() {
    empty.hidden = items.length > 0;
    list.innerHTML = '';
    chips.innerHTML = items.map(function (it, i) {
      return '<span class="file-chip"><span class="fc-name">' + FT.esc(it.name) + '</span>' +
        '<span class="fc-size">' + FT.formatBytes(it.file.size) + '</span>' +
        '<button class="icon-btn" data-chip="' + i + '" aria-label="Remove">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button></span>';
    }).join('');

    items.forEach(function (item) {
      var el = FT.el('<article class="item">' + cardHTML(item) + '</article>');
      item.el = el;
      list.appendChild(el);
      bind(item);
      if (!item.w) {
        FT.loadImage(item.srcUrl).then(function (img) {
          item.w = img.naturalWidth;
          item.h = img.naturalHeight;
          refresh(item);
        }).catch(function () {});
      }
    });
    updateBar();
  }

  function bind(item) {
    var sel = item.el.querySelector('[data-act="fmt"]');
    sel.addEventListener('change', function () { item.target = sel.value; });
    item.el.querySelector('[data-act="remove"]').addEventListener('click', function () { remove(item); });
    item.el.querySelector('[data-act="convert"]').addEventListener('click', function () { convert(item); });
    item.el.querySelector('[data-act="download"]').addEventListener('click', function () {
      if (item.blob) FT.saveBlob(item.blob, item.outName);
    });
  }

  function refresh(item) {
    if (!item.el) return;
    var fresh = FT.el('<article class="item">' + cardHTML(item) + '</article>');
    item.el.replaceWith(fresh);
    item.el = fresh;
    bind(item);
  }

  function release(item) {
    URL.revokeObjectURL(item.srcUrl);
    if (item.url) URL.revokeObjectURL(item.url);
  }

  function remove(item) {
    release(item);
    items = items.filter(function (i) { return i !== item; });
    renderAll();
  }

  function updateBar() {
    var has = items.length > 0;
    var done = items.filter(function (i) { return i.status === 'done'; });
    convertAll.disabled = !has;
    clearBtn.disabled = !has;
    downloadAll.disabled = done.length === 0;
    downloadAll.textContent = done.length > 1 ? 'Download ZIP (' + done.length + ')' : 'Download ZIP';
    summary.textContent = !has ? 'No images added yet'
      : items.length + ' images · ' + done.length + ' converted · original total ' +
        FT.formatBytes(items.reduce(function (s, i) { return s + i.file.size; }, 0));
  }

  function convert(item, silent) {
    var mime = item.target || format.value;
    var q = Number(quality.value) / 100;
    if (!FT.supportsMime(mime)) {
      if (!silent) FT.toast('Your browser cannot export ' + (MIME_EXT[mime] || '').toUpperCase() + ', switched to PNG', 'warn');
      mime = 'image/png';
    }
    item.status = 'working';
    item.error = '';
    refresh(item);
    updateBar();

    return FT.loadImage(item.srcUrl).then(function (img) {
      item.w = img.naturalWidth;
      item.h = img.naturalHeight;
      if (!item.w || !item.h) throw new Error('Unable to read image dimensions');
      var size = FT.fitSide(item.w, item.h, MAX_SIDE);
      var opaque = (mime === 'image/jpeg' || mime === 'image/bmp');
      var canvas = FT.drawToCanvas(img, size.w, size.h, opaque);
      return FT.canvasToBlob(canvas, mime, q);
    }).then(function (blob) {
      if (item.url) URL.revokeObjectURL(item.url);
      item.blob = blob;
      item.url = URL.createObjectURL(blob);
      item.mime = blob.type || mime;
      item.outName = FT.safeName(FT.baseName(item.name)) + '.' + (MIME_EXT[item.mime] || 'png');
      item.status = 'done';
    }).catch(function (err) {
      item.status = 'error';
      item.error = err && err.message ? err.message : 'Conversion failed';
      if (!silent) FT.toast('Failed to convert "' + item.name + '": ' + item.error, 'err');
    }).then(function () {
      refresh(item);
      updateBar();
      return item.status === 'done';
    });
  }

  convertAll.addEventListener('click', function () {
    if (!items.length) return;
    var total = items.length, ok = 0, i = 0;
    FT.setBusy(convertAll, true, 'Converting…');
    function step() {
      if (i >= total) {
        FT.setBusy(convertAll, false);
        FT.setProgress(progress, 1, 'Done ' + ok + '/' + total);
        FT.toast('Conversion complete, ' + ok + ' succeeded' + (ok < total ? ', ' + (total - ok) + ' failed' : ''), ok ? 'ok' : 'err');
        setTimeout(function () { FT.resetProgress(progress); }, 1800);
        return;
      }
      FT.setProgress(progress, i / total, 'Converting ' + (i + 1) + '/' + total);
      i++;
      convert(items[i - 1], true).then(function (good) {
        if (good) ok++;
        step();
      });
    }
    step();
  });

  downloadAll.addEventListener('click', function () {
    var done = items.filter(function (i) { return i.status === 'done'; });
    if (!done.length) return;
    if (done.length === 1) { FT.saveBlob(done[0].blob, done[0].outName); return; }
    FT.setBusy(downloadAll, true, 'Zipping…');
    FT.setProgress(progress, 0.3, 'Packaging…');
    FT.makeZip(done.map(function (i) { return { name: i.outName, blob: i.blob }; }))
      .then(function (zip) {
        FT.saveBlob(zip, 'converted-images-' + done.length + '.zip');
        FT.setProgress(progress, 1, 'Zip ready');
        FT.toast('Zipped ' + done.length + ' images', 'ok');
      })
      .catch(function (err) { FT.toast('Failed to create ZIP: ' + (err.message || err), 'err'); })
      .then(function () {
        FT.setBusy(downloadAll, false);
        setTimeout(function () { FT.resetProgress(progress); }, 1500);
      });
  });

  clearBtn.addEventListener('click', function () {
    items.forEach(release);
    items = [];
    renderAll();
    FT.resetProgress(progress);
  });

  quality.addEventListener('input', function () { qualityVal.textContent = quality.value + '%'; });
  format.addEventListener('change', function () {
    qualityField.hidden = !(format.value === 'image/jpeg' || format.value === 'image/webp');
    items.forEach(function (i) {
      i.target = format.value;
      if (i.el) i.el.querySelector('[data-act="fmt"]').value = format.value;
    });
  });

  chips.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-chip]');
    if (!btn) return;
    remove(items[Number(btn.getAttribute('data-chip'))]);
  });

  FT.bindDropzone(drop, input, addFiles, { multiple: true });
  renderAll();
})();
