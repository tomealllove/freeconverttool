/* 图片格式化：多图上传 → 选目标格式 → 转换 → 对比预览 / 下载 */
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
    if (added) msgs.push('已添加 ' + added + ' 张');
    if (skipBig) msgs.push(skipBig + ' 个超过 20MB');
    if (skipType) msgs.push(skipType + ' 个不是支持的图片');
    if (!added) FT.toast(msgs.join('，') || '没有可添加的图片', 'err');
    else if (msgs.length > 1) FT.toast(msgs.join('，'), 'warn');

    renderAll();
  }

  function cardHTML(item) {
    var tag = item.status === 'done' ? '<span class="badge ok">已转换</span>'
      : item.status === 'error' ? '<span class="badge err">失败</span>'
      : item.status === 'working' ? '<span class="badge">转换中…</span>'
      : '<span class="badge">待转换</span>';

    var out = item.status === 'done'
      ? '<img src="' + FT.esc(item.url) + '" alt="结果" data-zoom>'
      : '<div class="ph">' + (item.status === 'error' ? '转换失败' : '尚未转换') + '</div>';

    var outCap = item.status === 'done'
      ? '<b>' + (MIME_EXT[item.mime] || '').toUpperCase() + '</b> · ' + item.w + '×' + item.h + ' · ' + FT.formatBytes(item.blob.size)
      : (item.status === 'error' ? FT.esc(item.error || '转换失败') : '等待转换');

    var origCap = item.w
      ? '<b>' + (FT.extName(item.name).toUpperCase() || '原图') + '</b> · ' + item.w + '×' + item.h + ' · ' + FT.formatBytes(item.file.size)
      : '<b>' + (FT.extName(item.name).toUpperCase() || '原图') + '</b> · ' + FT.formatBytes(item.file.size);

    var opts = Object.keys(MIME_EXT).map(function (m) {
      return '<option value="' + m + '"' + (m === item.target ? ' selected' : '') + '>' + MIME_EXT[m].toUpperCase() + '</option>';
    }).join('');

    return '' +
      '<div class="item-head">' +
        '<span class="item-name" title="' + FT.esc(item.name) + '">' + FT.esc(item.name) + '</span>' + tag +
        '<button class="icon-btn" data-act="remove" title="移除" aria-label="移除">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="compare">' +
        '<figure><div class="ph checker"><img src="' + FT.esc(item.srcUrl) + '" alt="原图" data-zoom></div>' +
          '<figcaption>原图 · ' + origCap + '</figcaption></figure>' +
        '<figure><div class="ph checker">' + out + '</div><figcaption>结果 · ' + outCap + '</figcaption></figure>' +
      '</div>' +
      '<div class="item-actions">' +
        '<select data-act="fmt" aria-label="目标格式">' + opts + '</select>' +
        '<button class="btn btn-sm btn-primary" data-act="convert">转换</button>' +
        '<button class="btn btn-sm" data-act="download"' + (item.status === 'done' ? '' : ' disabled') + '>下载</button>' +
      '</div>';
  }

  function renderAll() {
    empty.hidden = items.length > 0;
    list.innerHTML = '';
    chips.innerHTML = items.map(function (it, i) {
      return '<span class="file-chip"><span class="fc-name">' + FT.esc(it.name) + '</span>' +
        '<span class="fc-size">' + FT.formatBytes(it.file.size) + '</span>' +
        '<button class="icon-btn" data-chip="' + i + '" aria-label="移除">' +
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
    downloadAll.textContent = done.length > 1 ? '打包下载 (' + done.length + ')' : '打包下载';
    summary.textContent = !has ? '还没有添加图片'
      : '共 ' + items.length + ' 张 · 已转换 ' + done.length + ' 张 · 原图合计 ' +
        FT.formatBytes(items.reduce(function (s, i) { return s + i.file.size; }, 0));
  }

  function convert(item, silent) {
    var mime = item.target || format.value;
    var q = Number(quality.value) / 100;
    if (!FT.supportsMime(mime)) {
      if (!silent) FT.toast('当前浏览器不支持导出 ' + (MIME_EXT[mime] || '').toUpperCase() + '，已改用 PNG', 'warn');
      mime = 'image/png';
    }
    item.status = 'working';
    item.error = '';
    refresh(item);
    updateBar();

    return FT.loadImage(item.srcUrl).then(function (img) {
      item.w = img.naturalWidth;
      item.h = img.naturalHeight;
      if (!item.w || !item.h) throw new Error('无法读取图片尺寸');
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
      item.error = err && err.message ? err.message : '转换失败';
      if (!silent) FT.toast('「' + item.name + '」转换失败：' + item.error, 'err');
    }).then(function () {
      refresh(item);
      updateBar();
      return item.status === 'done';
    });
  }

  convertAll.addEventListener('click', function () {
    if (!items.length) return;
    var total = items.length, ok = 0, i = 0;
    FT.setBusy(convertAll, true, '转换中…');
    function step() {
      if (i >= total) {
        FT.setBusy(convertAll, false);
        FT.setProgress(progress, 1, '完成 ' + ok + '/' + total);
        FT.toast('转换完成，成功 ' + ok + ' 张' + (ok < total ? '，失败 ' + (total - ok) + ' 张' : ''), ok ? 'ok' : 'err');
        setTimeout(function () { FT.resetProgress(progress); }, 1800);
        return;
      }
      FT.setProgress(progress, i / total, '正在转换 ' + (i + 1) + '/' + total);
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
    FT.setBusy(downloadAll, true, '打包中…');
    FT.setProgress(progress, 0.3, '正在打包…');
    FT.makeZip(done.map(function (i) { return { name: i.outName, blob: i.blob }; }))
      .then(function (zip) {
        FT.saveBlob(zip, 'converted-images-' + done.length + '.zip');
        FT.setProgress(progress, 1, '打包完成');
        FT.toast('已打包 ' + done.length + ' 张图片', 'ok');
      })
      .catch(function (err) { FT.toast('打包失败：' + (err.message || err), 'err'); })
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
