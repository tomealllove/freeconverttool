/* PDF 转图片：上传 → 选格式与清晰度 → 逐页渲染 → 预览 / 单页下载 / 打包 */
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
    FT.alert(tips, 'warn', '<b>PDF 组件尚未加载</b><p>本页依赖 pdf.js（CDN）。若当前离线，请联网后刷新页面。</p>');
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
      summary.textContent = '还没有加载 PDF';
      emptyText.textContent = '上传 PDF 后点击「开始转换」，每一页会生成一张图片';
    }
    convertBtn.disabled = true;
    downloadAll.disabled = true;
    downloadAll.textContent = '打包下载';
    resetBtn.disabled = !state.file;
    list.innerHTML = '';
    if (clearFile) empty.hidden = false;
  }

  function loadPdf(file) {
    if (FT.extName(file.name) !== 'pdf' && file.type !== 'application/pdf') {
      FT.toast('请选择 PDF 格式的文件', 'err');
      return;
    }
    if (file.size > MAX_PDF) {
      FT.toast('PDF 超过 100MB，请压缩后再试', 'err');
      return;
    }
    if (!FT.pdfjsReady()) {
      FT.toast('PDF 组件未加载，请联网后刷新页面', 'err');
      return;
    }

    resetAll(false);
    state.file = file;
    summary.textContent = '正在读取 ' + file.name + ' …';
    FT.busyProgress(progress, '正在解析 PDF…');

    FT.readArrayBuffer(file)
      .then(function (buf) { return FT.loadPdf(new Uint8Array(buf)).then(function (doc) { return doc; }); })
      .then(function (doc) {
        state.doc = doc;
        state.total = doc.numPages;
        fileInfo.innerHTML = '<span class="file-chip"><span class="fc-name">' + FT.esc(file.name) + '</span>' +
          '<span class="fc-size">' + doc.numPages + ' 页 · ' + FT.formatBytes(file.size) + '</span></span>';
        convertBtn.disabled = false;
        resetBtn.disabled = false;
        summary.textContent = file.name + ' · 共 ' + doc.numPages + ' 页';
        emptyText.textContent = '已就绪，共 ' + doc.numPages + ' 页，点击「开始转换」生成图片';
        empty.hidden = false;
        FT.resetProgress(progress);
        FT.toast('PDF 读取成功，共 ' + doc.numPages + ' 页', 'ok');
      })
      .catch(function (err) {
        console.error(err);
        FT.resetProgress(progress);
        summary.textContent = 'PDF 读取失败';
        state.file = null;
        resetBtn.disabled = true;
        FT.alert(tips, 'err', '<b>无法解析该 PDF</b><p>' + FT.esc((err && err.message) || '文件可能已损坏、加密或不是标准 PDF') + '</p>');
      });
  }

  function pageCard(num) {
    var el = FT.el(
      '<article class="item page-card" data-page="' + num + '">' +
        '<div class="item-head"><span class="page-num">第 ' + num + ' 页</span><span class="badge">渲染中…</span></div>' +
        '<div class="thumb checker"><div class="spinner"></div></div>' +
        '<div class="page-meta">渲染中…</div>' +
        '<div class="item-actions"><button class="btn btn-sm" data-act="dl" disabled>下载</button></div>' +
      '</article>'
    );
    list.appendChild(el);
    return el;
  }

  function fillCard(el, page, w, h, ext) {
    var tag = el.querySelector('.badge');
    tag.textContent = ext.toUpperCase();
    tag.className = 'badge ok';
    el.querySelector('.thumb').innerHTML = '<img src="' + FT.esc(page.url) + '" alt="第 ' + page.num + ' 页" data-zoom>';
    el.querySelector('.page-meta').textContent = w + '×' + h + ' · ' + FT.formatBytes(page.blob.size);
    var dl = el.querySelector('[data-act="dl"]');
    dl.disabled = false;
    dl.addEventListener('click', function () { FT.saveBlob(page.blob, page.name); });
  }

  function failCard(el, msg) {
    var tag = el.querySelector('.badge');
    tag.textContent = '失败';
    tag.className = 'badge err';
    el.querySelector('.thumb').innerHTML = '<span class="muted">' + FT.esc(msg || '渲染失败') + '</span>';
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
      FT.toast('页码范围格式不正确，示例：1-5,8（最大 ' + state.total + ' 页）', 'err');
      return;
    }
    if (pages.length > 60 && !confirm('本次将转换 ' + pages.length + ' 页，页数较多可能耗时较长且占用内存，是否继续？')) return;

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
    if (mime !== format.value) FT.toast('当前浏览器不支持该格式，已改用 PNG', 'warn');
    var q = Number(quality.value) / 100;
    var ext = MIME_EXT[mime] || 'png';
    var base = FT.safeName(FT.baseName(state.file.name));
    var done = 0, failed = 0, i = 0;

    FT.setBusy(convertBtn, true, '转换中…');

    function step() {
      if (state.cancel) return finish();
      if (i >= pages.length) return finish();
      var num = pages[i];
      var el = pageCard(num);
      FT.setProgress(progress, i / pages.length, (i + 1) + ' / ' + pages.length + ' 页');
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
        failCard(el, '渲染失败');
        failed++;
      }).then(function () {
        if (i >= pages.length) FT.setProgress(progress, 1, '完成 ' + done + ' 页');
        step();
      });
    }

    function finish() {
      state.busy = false;
      FT.setBusy(convertBtn, false);
      convertBtn.disabled = false;
      downloadAll.disabled = state.pages.length === 0;
      downloadAll.textContent = state.pages.length > 1 ? '打包下载 (' + state.pages.length + ')' : '打包下载';
      summary.textContent = state.file.name + ' · 共 ' + state.total + ' 页 · 已转换 ' + state.pages.length + ' 页';
      if (state.cancel) {
        FT.resetProgress(progress);
        FT.toast('已取消转换', 'warn');
      } else {
        FT.toast('转换完成：成功 ' + done + ' 页' + (failed ? '，失败 ' + failed + ' 页' : ''), failed ? 'warn' : 'ok');
        setTimeout(function () { FT.resetProgress(progress); }, 1800);
      }
    }

    step();
  });

  downloadAll.addEventListener('click', function () {
    if (!state.pages.length) return;
    if (state.pages.length === 1) { FT.saveBlob(state.pages[0].blob, state.pages[0].name); return; }
    var folder = FT.safeName(FT.baseName(state.file.name));
    FT.setBusy(downloadAll, true, '打包中…');
    FT.setProgress(progress, 0.3, '正在打包 ' + state.pages.length + ' 页…');
    FT.makeZip(state.pages.map(function (p) { return { name: folder + '/' + p.name, blob: p.blob }; }))
      .then(function (zip) {
        FT.saveBlob(zip, folder + '-images.zip');
        FT.setProgress(progress, 1, '打包完成');
        FT.toast('已打包 ' + state.pages.length + ' 页图片', 'ok');
      })
      .catch(function (err) { FT.toast('打包失败：' + (err.message || err), 'err'); })
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
