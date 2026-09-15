/* PDF 压缩：轻度（pdf-lib 重排 + 清元数据）/ 重印（pdf.js 渲染 JPEG + pdf-lib 合成）*/
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
      FT.alert(tips, 'warn', '<b>重印压缩会把文字变成图片</b>' +
        '<p>每一页都会被渲染成 JPEG 再贴回 PDF，<b>文字将不可选中、不可搜索、不可复制</b>，' +
        '放大后会模糊，仅适合存档 / 打印 / 归档分发；请勿对还需要编辑或检索的文件使用。</p>' +
        '<p>真正的「字体子集化 + 有损图像重采样」级压缩在纯前端代价极高（需内置字体与图像重编码管线），' +
        '本页采用上述重印方案作为替代。若需保留文字，请改用「轻度压缩」。</p>');
    } else {
      FT.alert(tips, 'info', '<b>轻度压缩：主要去除冗余结构与元数据</b>' +
        '<p>用 pdf-lib 重新保存 PDF（启用对象流）并清除标题 / 作者 / 主题 / 关键词等元数据，' +
        '<b>文字保持可选中可搜索，页面内容不变</b>。体积通常仅下降若干百分点；' +
        '若源文件本身已很紧凑，结果可能反而略大。</p>' +
        '<p>如需显著减小体积，可改用「重印压缩」（文字会变成图片）。</p>');
    }
  }

  if (typeof PDFLib === 'undefined') {
    FT.depMissing(tips, 'pdf-lib', '本页依赖 pdf-lib 读写 PDF，请检查网络后刷新页面重试。');
  } else {
    showLevelTip();
  }

  /* ---------------- 上传 ---------------- */

  function resetAll(clearFile) {
    state.cancel = true;
    state.busy = false;
    if (state.doc) { try { state.doc.destroy(); } catch (e) { /* 忽略 */ } }
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
      summary.textContent = '还没有加载 PDF';
      emptyText.textContent = '上传 PDF 后点击「开始压缩」，这里会显示体积对比';
      empty.hidden = false;
    }
    runBtn.disabled = !state.doc;
    resetBtn.disabled = !state.file;
  }

  function loadPdf(file) {
    if (FT.extName(file.name) !== 'pdf' && file.type !== 'application/pdf') {
      FT.toast('请选择 PDF 格式的文件', 'err');
      return;
    }
    if (file.size > MAX_PDF) {
      FT.toast('PDF 超过 100MB，请拆分后再试', 'err');
      return;
    }
    if (typeof PDFLib === 'undefined') {
      FT.depMissing(tips, 'pdf-lib', '本页依赖 pdf-lib 读写 PDF，请检查网络后刷新页面重试。');
      return;
    }

    resetAll(false);
    state.file = file;
    state.base = FT.safeName(FT.baseName(file.name));
    summary.textContent = '正在读取 ' + file.name + ' …';
    FT.busyProgress(progress, '正在解析 PDF…');

    FT.readArrayBuffer(file)
      .then(function (buf) { return FT.loadPdf(new Uint8Array(buf)); })
      .then(function (doc) {
        state.doc = doc;
        state.total = doc.numPages;
        fileInfo.innerHTML = '<span class="file-chip"><span class="fc-name">' + FT.esc(file.name) + '</span>' +
          '<span class="fc-size">' + doc.numPages + ' 页 · ' + FT.formatBytes(file.size) + '</span></span>';
        runBtn.disabled = false;
        resetBtn.disabled = false;
        summary.textContent = file.name + ' · 共 ' + doc.numPages + ' 页 · ' + FT.formatBytes(file.size);
        emptyText.textContent = '已就绪，共 ' + doc.numPages + ' 页，点击「开始压缩」';
        empty.hidden = false;
        FT.resetProgress(progress);
        FT.toast('PDF 读取成功，共 ' + doc.numPages + ' 页', 'ok');
      })
      .catch(function (err) {
        console.error(err);
        FT.resetProgress(progress);
        state.file = null;
        resetBtn.disabled = true;
        summary.textContent = 'PDF 读取失败';
        FT.alert(tips, 'err', '<b>无法解析该 PDF</b><p>' +
          FT.esc((err && err.message) || '文件可能已损坏、加密或不是标准 PDF') + '</p>' +
          '<p>若仅用于轻度压缩，可刷新后重试；仍失败说明该 PDF 结构特殊。</p>');
      });
  }

  /* ---------------- 轻度压缩 ---------------- */

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
        } catch (e) { /* 部分 PDF 不允许修改元数据，忽略 */ }
        return doc.save({ useObjectStreams: true });
      })
      .then(function (bytes) {
        return { blob: new Blob([bytes], { type: 'application/pdf' }), failed: 0 };
      });
  }

  /* ---------------- 重印压缩 ---------------- */

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
      FT.setProgress(progress, i / state.total, '正在处理 ' + num + '/' + state.total);
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
        FT.setProgress(progress, 0.94, '正在写入 PDF…');
        return doc.save({ useObjectStreams: true });
      })
      .then(function (bytes) {
        if (!bytes) return null;
        return { blob: new Blob([bytes], { type: 'application/pdf' }), failed: failed };
      });
  }

  /* ---------------- 执行 ---------------- */

  function run() {
    if (!state.file || state.busy) return;
    if (typeof PDFLib === 'undefined') {
      FT.depMissing(tips, 'pdf-lib', '本页依赖 pdf-lib 读写 PDF，请检查网络后刷新页面重试。');
      return;
    }
    if (isReprint() && !FT.pdfjsReady()) {
      FT.depMissing(tips, 'pdf.js', '重印压缩依赖 pdf.js 渲染页面，请检查网络后刷新页面重试。');
      return;
    }
    if (isReprint() && state.total > 60 &&
      !confirm('本次将重印 ' + state.total + ' 页，耗时较长且占用较多内存，是否继续？')) return;

    state.busy = true;
    state.cancel = false;
    outBlob = null;
    outCard.hidden = true;
    downloadBtn.disabled = true;
    empty.hidden = true;
    showLevelTip();

    var startSize = state.file.size;
    var t0 = Date.now();
    FT.setBusy(runBtn, true, '压缩中…');
    FT.setProgress(progress, 0, '准备中…');

    var job = isReprint() ? compressReprint() : compressLight();

    job.then(function (res) {
      if (state.cancel) { FT.toast('已取消压缩', 'warn'); return; }
      if (!res) return;
      var blob = res.blob;
      outBlob = blob;
      var delta = FT.pct(blob.size, startSize);
      var smaller = blob.size < startSize;
      var sec = ((Date.now() - t0) / 1000).toFixed(1);

      stats.innerHTML =
        stat('原始大小', FT.formatBytes(startSize)) +
        stat('压缩后', FT.formatBytes(blob.size)) +
        stat('体积变化', delta, smaller ? 'down' : 'up') +
        stat('页数 / 耗时', state.total + ' 页 · ' + sec + 's');
      outCard.hidden = false;
      downloadBtn.disabled = false;
      summary.textContent = state.file.name + ' · 体积 ' + delta + (smaller ? '（已减小）' : '（变大了）');
      FT.setProgress(progress, 1, '完成');

      if (!smaller) {
        FT.alert(tips, 'warn', '<b>压缩后体积没有下降</b>' +
          '<p>该 PDF 可能已经是紧凑结构' + (isReprint() ? '' : '（轻度压缩主要去除冗余结构与元数据，幅度有限）') +
          '，结果比原文件略大。' + (isReprint() ? '可降低清晰度或质量后重试。' : '可改用「重印压缩」获得更大降幅。') + '</p>', true);
      }
      FT.toast('压缩完成：' + FT.formatBytes(startSize) + ' → ' + FT.formatBytes(blob.size) +
        (res.failed ? '（' + res.failed + ' 页失败）' : ''), res.failed ? 'warn' : 'ok');
      setTimeout(function () { FT.resetProgress(progress); }, 1800);
    }).catch(function (err) {
      console.error(err);
      FT.resetProgress(progress);
      empty.hidden = false;
      FT.alert(tips, 'err', '<b>压缩失败</b><p>' +
        FT.esc((err && err.message) || '未知错误') + '</p>' +
        '<p>文件可能已加密、损坏或使用了特殊结构。</p>', true);
      FT.toast('压缩失败', 'err');
    }).then(function () {
      state.busy = false;
      FT.setBusy(runBtn, false);
      runBtn.disabled = !state.doc;
    });
  }

  /* ---------------- 事件 ---------------- */

  runBtn.addEventListener('click', run);

  downloadBtn.addEventListener('click', function () {
    if (!outBlob) {
      FT.toast('尚未生成压缩文件，请先点击「开始压缩」', 'warn');
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
