/* 图片压缩：多图上传 → 质量模式 / 目标体积模式 → Canvas 重编码 → 对比预览 / 打包下载 */
(function () {
  'use strict';

  FT.mountShell('img-compress');

  var MAX_SIZE = 20 * 1024 * 1024;
  var MAX_ITER = 6;
  var MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/bmp': 'bmp' };
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
  var mode = FT.$('#mode');
  var quality = FT.$('#quality');
  var qualityVal = FT.$('#qualityVal');
  var qualityField = FT.$('#qualityField');
  var format = FT.$('#format');
  var maxW = FT.$('#maxW');
  var targetField = FT.$('#targetField');
  var targetKb = FT.$('#targetKb');
  var modeTip = FT.$('#modeTip');
  var compressAll = FT.$('#compressAll');
  var downloadAll = FT.$('#downloadAll');
  var clearBtn = FT.$('#clear');
  var progress = FT.$('#progress');
  var stats = FT.$('#stats');

  var items = [];

  function detectType(file) {
    if (file.type && file.type.indexOf('image/') === 0) return file.type;
    return EXT_MAP[FT.extName(file.name)] || '';
  }

  function stat(k, v, cls) {
    return '<div class="stat"><div class="k">' + k + '</div>' +
      '<div class="v' + (cls ? ' ' + cls : '') + '">' + v + '</div></div>';
  }

  /* ---------------- 上传 ---------------- */

  function addFiles(files) {
    var added = 0, skipBig = 0, skipType = 0;
    files.forEach(function (file) {
      if (file.size > MAX_SIZE) { skipBig++; return; }
      if (!detectType(file)) { skipType++; return; }
      items.push({
        file: file,
        name: file.name,
        type: detectType(file),
        srcUrl: URL.createObjectURL(file),
        w: 0, h: 0,
        ow: 0, oh: 0,
        blob: null, url: null, outName: '', mime: '', q: 0,
        status: 'idle', error: '', reached: true,
        el: null
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

  /* ---------------- 列表渲染 ---------------- */

  function cardHTML(item) {
    var tag = item.status === 'done' ? '<span class="badge ok">已压缩</span>'
      : item.status === 'error' ? '<span class="badge err">失败</span>'
      : item.status === 'working' ? '<span class="badge">压缩中…</span>'
      : '<span class="badge">待压缩</span>';

    var out = item.status === 'done'
      ? '<img src="' + FT.esc(item.url) + '" alt="压缩后" data-zoom>'
      : '<div class="ph">' + (item.status === 'error' ? '压缩失败' : '尚未压缩') + '</div>';

    var origCap = '<b>' + (FT.extName(item.name).toUpperCase() || '原图') + '</b> · ' +
      (item.w ? item.w + '×' + item.h : '读取中…') + ' · ' + FT.formatBytes(item.file.size);
    var outCap = item.status === 'done'
      ? '<b>' + (MIME_EXT[item.mime] || '').toUpperCase() + '</b> · ' + item.ow + '×' + item.oh +
        ' · ' + FT.formatBytes(item.blob.size)
      : (item.status === 'error' ? FT.esc(item.error || '压缩失败') : '等待压缩');

    var statHtml = item.status === 'done'
      ? '<div class="stat-row">' +
          stat('压缩前', FT.formatBytes(item.file.size)) +
          stat('压缩后', FT.formatBytes(item.blob.size)) +
          stat('体积变化', FT.pct(item.blob.size, item.file.size),
            item.blob.size <= item.file.size ? 'down' : 'up') +
          stat('输出尺寸', item.ow + '×' + item.oh) +
        '</div>'
      : '';

    return '' +
      '<div class="item-head">' +
        '<span class="item-name" title="' + FT.esc(item.name) + '">' + FT.esc(item.name) + '</span>' + tag +
        '<button class="icon-btn" data-act="remove" title="移除" aria-label="移除">' + FT.svg(ICON_X, 15) + '</button>' +
      '</div>' +
      '<div class="compare">' +
        '<figure><div class="ph checker"><img src="' + FT.esc(item.srcUrl) + '" alt="原图" data-zoom></div>' +
          '<figcaption>压缩前 · ' + origCap + '</figcaption></figure>' +
        '<figure><div class="ph checker">' + out + '</div><figcaption>压缩后 · ' + outCap + '</figcaption></figure>' +
      '</div>' +
      statHtml +
      '<div class="item-actions">' +
        '<button class="btn btn-sm btn-primary" data-act="compress">压缩</button>' +
        '<button class="btn btn-sm" data-act="download"' + (item.status === 'done' ? '' : ' disabled') + '>下载</button>' +
      '</div>';
  }

  function renderAll() {
    empty.hidden = items.length > 0;
    list.innerHTML = '';
    chips.innerHTML = items.map(function (it, i) {
      return '<span class="file-chip"><span class="fc-name">' + FT.esc(it.name) + '</span>' +
        '<span class="fc-size">' + FT.formatBytes(it.file.size) + '</span>' +
        '<button class="icon-btn" data-chip="' + i + '" aria-label="移除">' + FT.svg(ICON_X, 15) + '</button></span>';
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
    item.el.querySelector('[data-act="remove"]').addEventListener('click', function () { remove(item); });
    item.el.querySelector('[data-act="compress"]').addEventListener('click', function () {
      compress(item, false);
    });
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

  function remove(item) {
    URL.revokeObjectURL(item.srcUrl);
    if (item.url) URL.revokeObjectURL(item.url);
    items = items.filter(function (i) { return i !== item; });
    renderAll();
  }

  function updateBar() {
    var has = items.length > 0;
    var done = items.filter(function (i) { return i.status === 'done'; });
    compressAll.disabled = !has;
    clearBtn.disabled = !has;
    downloadAll.disabled = done.length === 0;
    downloadAll.textContent = done.length > 1 ? '打包下载 (' + done.length + ')' : '打包下载';
    summary.textContent = !has ? '还没有添加图片'
      : '共 ' + items.length + ' 张 · 已压缩 ' + done.length + ' 张 · 原图合计 ' +
        FT.formatBytes(items.reduce(function (s, i) { return s + i.file.size; }, 0));
    renderStats();
  }

  function renderStats() {
    var done = items.filter(function (i) { return i.status === 'done'; });
    if (!done.length) { stats.hidden = true; stats.innerHTML = ''; return; }
    var before = items.reduce(function (s, i) { return s + i.file.size; }, 0);
    var after = done.reduce(function (s, i) { return s + i.blob.size; }, 0);
    var d = before ? 1 - after / before : 0;
    stats.hidden = false;
    stats.innerHTML =
      stat('原始总计', FT.formatBytes(before)) +
      stat('压缩后', FT.formatBytes(after)) +
      stat('体积变化', FT.pct(after, before), d >= 0 ? 'down' : 'up') +
      stat('已压缩', done.length + ' / ' + items.length);
  }

  /* ---------------- 压缩 ---------------- */

  function pickMime(item) {
    var v = format.value;
    if (v === 'image/jpeg') return 'image/jpeg';
    if (v === 'image/webp') return FT.supportsMime('image/webp') ? 'image/webp' : 'image/jpeg';
    // 保持原格式：Canvas 只能编码 png / jpeg / webp，其余回落为 png
    var t = item.type;
    if (t === 'image/jpeg') return 'image/jpeg';
    if (t === 'image/webp' && FT.supportsMime('image/webp')) return 'image/webp';
    return 'image/png';
  }

  // 二分逼近目标体积：保留不超过目标的最高画质结果
  function encodeToTarget(canvas, mime, target) {
    var lo = 0.05, hi = 1, best = null, bestQ = 0, last = null, lastQ = 0, n = 0;

    function attempt() {
      var q = (lo + hi) / 2;
      return FT.canvasToBlob(canvas, mime, q).then(function (blob) {
        n++;
        last = blob;
        lastQ = q;
        if (blob.size <= target) {
          if (!best || q > bestQ) { best = blob; bestQ = q; }
          lo = q;
        } else {
          hi = q;
        }
        if (n >= MAX_ITER) {
          return { blob: best || last, q: best ? bestQ : lastQ, reached: !!best };
        }
        return attempt();
      });
    }
    return attempt();
  }

  function compress(item, silent) {
    var targetMode = mode.value === 'target';
    var target = Math.max(1, Math.round(Number(targetKb.value) || 0)) * 1024;
    var mime = pickMime(item);
    var maxSide = Number(maxW.value) || 0;
    var size = { w: 0, h: 0 };

    item.status = 'working';
    item.error = '';
    refresh(item);
    updateBar();

    return FT.loadImage(item.srcUrl).then(function (img) {
      item.w = img.naturalWidth;
      item.h = img.naturalHeight;
      if (!item.w || !item.h) throw new Error('无法读取图片尺寸');
      size = maxSide ? FT.fitSide(item.w, item.h, maxSide) : { w: item.w, h: item.h };
      var canvas = FT.drawToCanvas(img, size.w, size.h, mime === 'image/jpeg');
      if (targetMode) return encodeToTarget(canvas, mime, target);
      var q = Number(quality.value) / 100;
      return FT.canvasToBlob(canvas, mime, q).then(function (blob) {
        return { blob: blob, q: q, reached: true };
      });
    }).then(function (res) {
      if (item.url) URL.revokeObjectURL(item.url);
      if (!res.blob) throw new Error('图片编码失败');
      item.blob = res.blob;
      item.url = URL.createObjectURL(res.blob);
      item.mime = res.blob.type || mime;
      item.q = res.q;
      item.reached = res.reached;
      item.ow = size.w;
      item.oh = size.h;
      item.outName = FT.safeName(FT.baseName(item.name)) + '-min.' + (MIME_EXT[item.mime] || 'png');
      item.status = 'done';
    }).catch(function (err) {
      item.status = 'error';
      item.error = err && err.message ? err.message : '压缩失败';
      if (!silent) FT.toast('「' + item.name + '」压缩失败：' + item.error, 'err');
    }).then(function () {
      refresh(item);
      updateBar();
      return item.status === 'done';
    });
  }

  /* ---------------- 批量操作 ---------------- */

  compressAll.addEventListener('click', function () {
    if (!items.length) return;
    if (mode.value === 'target' && !(Number(targetKb.value) > 0)) {
      FT.toast('请填写目标体积（KB）', 'err');
      return;
    }
    var total = items.length, ok = 0, i = 0, missed = 0;
    FT.setBusy(compressAll, true, '压缩中…');
    function step() {
      if (i >= total) {
        FT.setBusy(compressAll, false);
        FT.setProgress(progress, 1, '完成 ' + ok + '/' + total);
        FT.toast('压缩完成，成功 ' + ok + ' 张' + (ok < total ? '，失败 ' + (total - ok) + ' 张' : ''), ok ? 'ok' : 'err');
        if (missed) FT.toast(missed + ' 张无法压缩到目标体积，已保留最接近的结果', 'warn');
        setTimeout(function () { FT.resetProgress(progress); }, 2200);
        return;
      }
      FT.setProgress(progress, i / total, '正在压缩 ' + (i + 1) + '/' + total);
      i++;
      compress(items[i - 1], true).then(function (good) {
        if (good) {
          ok++;
          if (!items[i - 1].reached) missed++;
        }
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
        FT.saveBlob(zip, 'compressed-images-' + done.length + '.zip');
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
    items.forEach(function (it) {
      URL.revokeObjectURL(it.srcUrl);
      if (it.url) URL.revokeObjectURL(it.url);
    });
    items = [];
    stats.hidden = true;
    stats.innerHTML = '';
    tips.innerHTML = '';
    FT.resetProgress(progress);
    renderAll();
  });

  /* ---------------- 参数联动 ---------------- */

  quality.addEventListener('input', function () { qualityVal.textContent = quality.value + '%'; });

  mode.addEventListener('change', function () {
    var isTarget = mode.value === 'target';
    qualityField.hidden = isTarget;
    targetField.hidden = !isTarget;
    modeTip.textContent = isTarget
      ? '目标体积模式：自动二分逼近目标大小，最多迭代 6 次，画质由算法决定。'
      : '质量模式：按固定质量重编码，速度快、结果稳定。';
  });

  chips.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-chip]');
    if (!btn) return;
    var item = items[Number(btn.getAttribute('data-chip'))];
    if (item) remove(item);
  });

  FT.bindDropzone(drop, input, addFiles, { multiple: true });

  if (!FT.supportsMime('image/webp')) {
    FT.alert(tips, 'warn', '<b>当前浏览器不支持 WebP 编码</b>' +
      '<p>选择 WebP 或保持 WebP 原格式时会自动改用 JPG 输出。</p>');
  }
  renderAll();
})();
