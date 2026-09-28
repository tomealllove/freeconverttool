/* Images to GIF: upload images → set frame options → encode with gif.js → preview / download */
(function () {
  'use strict';

  FT.mountShell('img-to-gif');

  var MAX_SIZE = 20 * 1024 * 1024;
  var MAX_COUNT = 60;
  var WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js';
  var EXT_MAP = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif'
  };
  var ICON_X = '<path d="M6 6l12 12M18 6L6 18"/>';

  var drop = FT.$('#drop');
  var input = FT.$('#file');
  var chips = FT.$('#chips');
  var list = FT.$('#list');
  var empty = FT.$('#empty');
  var summary = FT.$('#summary');
  var tips = FT.$('#tips');
  var sizeMode = FT.$('#sizeMode');
  var wField = FT.$('#wField');
  var hField = FT.$('#hField');
  var gifW = FT.$('#gifW');
  var gifH = FT.$('#gifH');
  var delay = FT.$('#delay');
  var loop = FT.$('#loop');
  var quality = FT.$('#quality');
  var qualityVal = FT.$('#qualityVal');
  var buildBtn = FT.$('#build');
  var clearBtn = FT.$('#clear');
  var progress = FT.$('#progress');
  var outCard = FT.$('#outCard');
  var outStats = FT.$('#outStats');
  var preview = FT.$('#preview');
  var downloadBtn = FT.$('#download');

  var items = [];
  var outBlob = null;
  var outUrl = '';
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

  /* ---------------- Frame list and ordering ---------------- */

  function cardHTML(item, idx) {
    var meta = item.w ? item.w + '×' + item.h + ' · ' + FT.formatBytes(item.file.size) : 'Loading…';
    return '' +
      '<div class="item-head">' +
        '<span class="page-num">Frame ' + (idx + 1) + '</span>' +
        '<span class="grow"></span>' +
        '<button class="icon-btn" data-act="remove" title="Remove" aria-label="Remove">' + FT.svg(ICON_X, 15) + '</button>' +
      '</div>' +
      '<div class="thumb checker"><img src="' + FT.esc(item.srcUrl) + '" alt="Frame ' + (idx + 1) + '" data-zoom draggable="false"></div>' +
      '<div class="page-meta">' + meta + '</div>';
  }

  function renderAll() {
    empty.hidden = items.length > 0;
    list.innerHTML = '';
    chips.innerHTML = items.map(function (it, i) {
      return '<span class="file-chip"><span class="fc-name">' + FT.esc(it.name) + '</span>' +
        '<span class="fc-size">' + FT.formatBytes(it.file.size) + '</span>' +
        '<button class="icon-btn" data-chip="' + i + '" aria-label="Remove">' + FT.svg(ICON_X, 15) + '</button></span>';
    }).join('');

    items.forEach(function (item, idx) {
      var el = FT.el('<article class="item page-card">' + cardHTML(item, idx) + '</article>');
      item.el = el;
      list.appendChild(el);
      bind(item, idx);
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

  function bind(item, idx) {
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
      : items.length + ' frames · original total ' +
        FT.formatBytes(items.reduce(function (s, i) { return s + i.file.size; }, 0));
  }

  /* ---------------- Build the GIF ---------------- */

  // A cross-origin Worker is blocked by the browser, so fetch the script into a same-origin blob first; if that fails, fall back to the CDN URL
  function workerUrl() {
    return fetch(WORKER)
      .then(function (r) {
        if (!r.ok) throw new Error('Failed to download worker');
        return r.text();
      })
      .then(function (code) {
        return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      })
      .catch(function () { return WORKER; });
  }

  function readSize() {
    if (sizeMode.value === 'custom') {
      var w = Math.max(16, Math.min(1600, Math.round(Number(gifW.value) || 480)));
      var h = Math.max(16, Math.min(1600, Math.round(Number(gifH.value) || 480)));
      return Promise.resolve({ w: w, h: h });
    }
    var first = items[0];
    if (first.w && first.h) return Promise.resolve({ w: first.w, h: first.h });
    return FT.loadImage(first.srcUrl).then(function (img) {
      first.w = img.naturalWidth;
      first.h = img.naturalHeight;
      if (!first.w || !first.h) throw new Error('Unable to read the first image dimensions');
      return { w: first.w, h: first.h };
    });
  }

  // Draw every frame onto an equally sized canvas (GIF has no alpha channel, so fill with white)
  function buildFrames(w, h, total) {
    var frames = [];
    var i = 0;
    function next() {
      if (i >= total) return Promise.resolve(frames);
      var item = items[i];
      FT.setProgress(progress, (i / total) * 0.4, 'Processing ' + (i + 1) + '/' + total);
      return FT.nextFrame()
        .then(function () { return FT.loadImage(item.srcUrl); })
        .then(function (img) {
          if (!item.w) { item.w = img.naturalWidth; item.h = img.naturalHeight; }
          frames.push(FT.drawToCanvas(img, w, h, true));
          i++;
          return next();
        });
    }
    return next();
  }

  function encode(frames, opts) {
    return new Promise(function (resolve, reject) {
      var encoder = null;
      try {
        encoder = new GIF({
          workers: 2,
          quality: opts.quality,
          width: opts.w,
          height: opts.h,
          repeat: opts.repeat,
          workerScript: opts.worker
        });
      } catch (err) {
        reject(err);
        return;
      }
      frames.forEach(function (canvas) {
        encoder.addFrame(canvas, { delay: opts.delay, copy: true });
      });
      encoder.on('progress', function (p) {
        FT.setProgress(progress, 0.4 + p * 0.6, 'Encoding ' + Math.round(p * 100) + '%');
      });
      encoder.on('finished', function (blob) { resolve(blob); });
      encoder.on('abort', function () { reject(new Error('GIF encoding aborted')); });
      try {
        encoder.render();
      } catch (err) {
        reject(err);
      }
    });
  }

  function build() {
    if (!items.length) { FT.toast('Please add images first', 'err'); return; }
    if (typeof GIF === 'undefined') {
      FT.alert(tips, 'err', '<b>The gif.js component failed to load</b>' +
        '<p>This page relies on gif.js to encode GIFs. Check your connection and reload the page.</p>');
      return;
    }
    var d = Math.max(50, Math.min(2000, Math.round(Number(delay.value) || 500)));
    var q = Math.max(1, Math.min(30, Math.round(Number(quality.value) || 10)));
    var repeat = Math.max(0, Math.round(Number(loop.value) || 0));
    var total = items.length;
    var size = null;

    tips.innerHTML = '';
    FT.setBusy(buildBtn, true, 'Building…');
    downloadBtn.disabled = true;
    FT.setProgress(progress, 0, 'Preparing…');

    readSize()
      .then(function (s) { size = s; return buildFrames(s.w, s.h, total); })
      .then(function (frames) {
        return workerUrl().then(function (worker) {
          return encode(frames, {
            w: size.w, h: size.h, quality: q, delay: d, worker: worker, repeat: repeat
          });
        });
      })
      .then(function (blob) {
        if (outUrl) URL.revokeObjectURL(outUrl);
        outBlob = blob;
        outUrl = URL.createObjectURL(blob);
        preview.src = outUrl;
        outCard.hidden = false;
        downloadBtn.disabled = false;
        outStats.innerHTML =
          stat('Frames', String(total)) +
          stat('Size', size.w + '×' + size.h) +
          stat('File size', FT.formatBytes(blob.size)) +
          stat('Duration', (total * d / 1000).toFixed(1) + ' s') +
          stat('Loop', repeat === 0 ? 'Infinite' : repeat + ' times');
        FT.setProgress(progress, 1, 'Encoding complete');
        FT.toast('GIF created with ' + total + ' frames', 'ok');
        setTimeout(function () { FT.resetProgress(progress); }, 2200);
      })
      .catch(function (err) {
        FT.alert(tips, 'err', '<b>Failed to build</b><p>' +
          FT.esc(err && err.message ? err.message : 'Unknown error') + '</p>');
        FT.toast('Failed to build the GIF', 'err');
        FT.resetProgress(progress);
      })
      .then(function () { FT.setBusy(buildBtn, false); });
  }

  /* ---------------- Events ---------------- */

  buildBtn.addEventListener('click', build);

  downloadBtn.addEventListener('click', function () {
    if (!outBlob) {
      FT.toast('No GIF yet. Click "Build GIF" first.', 'warn');
      return;
    }
    FT.saveBlob(outBlob, 'animation-' + items.length + 'f.gif');
  });

  clearBtn.addEventListener('click', function () {
    items.forEach(function (it) { URL.revokeObjectURL(it.srcUrl); });
    items = [];
    outBlob = null;
    if (outUrl) { URL.revokeObjectURL(outUrl); outUrl = ''; }
    preview.removeAttribute('src');
    outCard.hidden = true;
    outStats.innerHTML = '';
    tips.innerHTML = '';
    downloadBtn.disabled = true;
    FT.resetProgress(progress);
    renderAll();
  });

  quality.addEventListener('input', function () { qualityVal.textContent = quality.value; });
  sizeMode.addEventListener('change', function () {
    var custom = sizeMode.value === 'custom';
    wField.hidden = !custom;
    hField.hidden = !custom;
  });

  chips.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-chip]');
    if (!btn) return;
    var item = items[Number(btn.getAttribute('data-chip'))];
    if (item) remove(item);
  });

  FT.bindDropzone(drop, input, addFiles, { multiple: true });

  if (typeof GIF === 'undefined') {
    FT.alert(tips, 'err', '<b>The gif.js component failed to load</b>' +
      '<p>This page relies on gif.js to encode GIFs. Check your connection and reload the page.</p>');
  }
  renderAll();
})();
