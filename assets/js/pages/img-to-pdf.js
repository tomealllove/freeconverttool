/* 图片转 PDF：多图上传 → 调整页序 → 设置页面参数 → pdf-lib 合成 → 下载 */
(function () {
  'use strict';

  FT.mountShell('img-to-pdf');

  var MAX_SIZE = 20 * 1024 * 1024;
  var MAX_COUNT = 60;
  var MM = 2.83465;                 // 1mm 对应的 pt 数
  var A4W = 595.28, A4H = 841.89;   // A4 尺寸（pt）
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

  /* ---------------- 上传 ---------------- */

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
    if (added) msgs.push('已添加 ' + added + ' 张');
    if (skipMany) msgs.push(skipMany + ' 个超过 ' + MAX_COUNT + ' 张上限');
    if (skipBig) msgs.push(skipBig + ' 个超过 20MB');
    if (skipType) msgs.push(skipType + ' 个不是支持的图片');
    if (!added) FT.toast(msgs.join('，') || '没有可添加的图片', 'err');
    else if (msgs.length > 1) FT.toast(msgs.join('，'), 'warn');

    renderAll();
  }

  /* ---------------- 列表与排序 ---------------- */

  function cardHTML(item, idx, last) {
    var meta = item.w ? item.w + '×' + item.h + ' · ' + FT.formatBytes(item.file.size) : '读取中…';
    return '' +
      '<div class="item-head">' +
        '<span class="page-num">第 ' + (idx + 1) + ' 页</span>' +
        '<span class="grow"></span>' +
        '<button class="icon-btn act" data-act="up" title="上移" aria-label="上移"' +
          (idx === 0 ? ' disabled' : '') + '>' + FT.svg(ICON_UP, 15) + '</button>' +
        '<button class="icon-btn act" data-act="down" title="下移" aria-label="下移"' +
          (idx === last ? ' disabled' : '') + '>' + FT.svg(ICON_DOWN, 15) + '</button>' +
        '<button class="icon-btn" data-act="remove" title="移除" aria-label="移除">' + FT.svg(ICON_X, 15) + '</button>' +
      '</div>' +
      '<div class="thumb checker"><img src="' + FT.esc(item.srcUrl) + '" alt="第 ' + (idx + 1) + ' 页" data-zoom draggable="false"></div>' +
      '<div class="page-meta">' + meta + '</div>';
  }

  function renderAll() {
    var last = items.length - 1;
    empty.hidden = items.length > 0;
    list.innerHTML = '';
    chips.innerHTML = items.map(function (it, i) {
      return '<span class="file-chip"><span class="fc-name">' + FT.esc(it.name) + '</span>' +
        '<span class="fc-size">' + FT.formatBytes(it.file.size) + '</span>' +
        '<button class="icon-btn" data-chip="' + i + '" aria-label="移除">' + FT.svg(ICON_X, 15) + '</button></span>';
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
        try { e.dataTransfer.setData('text/plain', String(idx)); } catch (err) { /* 忽略 */ }
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
    summary.textContent = !has ? '还没有添加图片'
      : '共 ' + items.length + ' 张 · 原图合计 ' +
        FT.formatBytes(items.reduce(function (s, i) { return s + i.file.size; }, 0));
  }

  /* ---------------- 合成 PDF ---------------- */

  function jpegBytes(item, q) {
    return FT.loadImage(item.srcUrl).then(function (img) {
      var w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) throw new Error('无法读取图片尺寸');
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
          // 少数渐进式 / CMYK JPEG 无法直接嵌入，退回重压缩
          return jpegBytes(item, q).then(function (b) { return doc.embedJpg(b); });
        });
    });
  }

  function build() {
    if (!items.length) { FT.toast('请先添加图片', 'err'); return; }
    if (typeof PDFLib === 'undefined') {
      FT.alert(tips, 'err', '<b>pdf-lib 组件未加载</b>' +
        '<p>本页依赖 pdf-lib 生成 PDF，请检查网络后刷新页面重试。</p>');
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

    // 计算图片在页面上的绘制区域：contain 居中留白，cover 铺满（超出部分被页面裁掉）
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
      FT.setProgress(progress, i / (total + 1), '正在处理 ' + (i + 1) + '/' + total);
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

    FT.setBusy(buildBtn, true, '合成中…');
    FT.setProgress(progress, 0, '准备中…');

    calcPage()
      .then(function () { return PDFLib.PDFDocument.create(); })
      .then(function (d) { doc = d; return step(); })
      .then(function () {
        FT.setProgress(progress, (total + 0.6) / (total + 1), '正在写入 PDF…');
        return doc.save();
      })
      .then(function (bytes) {
        outBlob = new Blob([bytes], { type: 'application/pdf' });
        outCard.hidden = false;
        downloadBtn.disabled = false;
        outStats.innerHTML =
          stat('页数', String(total)) +
          stat('页面尺寸', Math.round(pw) + '×' + Math.round(ph) + ' pt') +
          stat('文件体积', FT.formatBytes(outBlob.size)) +
          stat('原图合计', FT.formatBytes(items.reduce(function (s, it) { return s + it.file.size; }, 0)));
        FT.setProgress(progress, 1, '完成 ' + total + ' 页');
        FT.toast('PDF 合成完成，共 ' + total + ' 页', 'ok');
        setTimeout(function () { FT.resetProgress(progress); }, 2200);
      })
      .catch(function (err) {
        FT.alert(tips, 'err', '<b>合成失败</b><p>' +
          FT.esc(err && err.message ? err.message : '未知错误') + '</p>');
        FT.toast('PDF 合成失败', 'err');
        FT.resetProgress(progress);
      })
      .then(function () { FT.setBusy(buildBtn, false); });
  }

  /* ---------------- 事件 ---------------- */

  buildBtn.addEventListener('click', build);

  downloadBtn.addEventListener('click', function () {
    if (!outBlob) {
      FT.toast('尚未生成 PDF，请先点击「开始合成」', 'warn');
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
    FT.alert(tips, 'err', '<b>pdf-lib 组件未加载</b>' +
      '<p>本页依赖 pdf-lib 生成 PDF，请检查网络后刷新页面重试。</p>');
  }
  renderAll();
})();
