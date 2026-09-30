/* 视频格式互转：MP4 / WebM / MOV，基于 WebCodecs（mediabunny） */
(function () {
  'use strict';

  FT.mountShell('video-convert');

  var MAX_SIZE = 200 * 1024 * 1024;
  var MB_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.61.0/+esm';

  var drop = FT.$('#drop');
  var input = FT.$('#file');
  var fileInfo = FT.$('#fileInfo');

  var tFormat = FT.$('#tFormat');



  var runBtn = FT.$('#run');
  var resetBtn = FT.$('#reset');
  var progress = FT.$('#progress');
  var tips = FT.$('#tips');
  var summary = FT.$('#summary');
  var empty = FT.$('#empty');
  var emptyText = FT.$('#emptyText');
  var resultCard = FT.$('#resultCard');
  var previewBox = FT.$('#previewBox');
  var stats = FT.$('#stats');
  var downloadBtn = FT.$('#download');

  var state = {
    file: null, url: null, meta: null, busy: false,
    resultBlob: null, resultUrl: null, resultName: ''
  };
  var mb = null, mbLoading = null;

  var LIMIT_HTML = '<b>请先了解性能边界</b>' +
    '<p>本工具基于浏览器原生 <b>WebCodecs</b> 编解码，可硬件加速；若能直接复用原编码（如 MP4 转 MOV），速度很快且画质无损。' +
    '但仍受浏览器内存限制，因此仅适合<b>短视频</b>（几十秒到几分钟）；' +
    '长视频/大文件可能非常慢甚至因内存不足失败。</p>';

  function showLimitTip() { FT.alert(tips, 'warn', LIMIT_HTML); }
  if (typeof window.VideoEncoder === 'undefined' || typeof window.VideoDecoder === 'undefined') {
    FT.alert(tips, 'err', '<b>当前浏览器不支持 WebCodecs</b><p>请使用最新版 Chrome / Edge / Safari。</p>');
    runBtn.disabled = true;
  } else {
    showLimitTip();
  }

  /* ---------------- 工具 ---------------- */

  function stat(k, v, cls) {
    return '<div class="stat"><div class="k">' + FT.esc(k) + '</div>' +
      '<div class="v' + (cls ? ' ' + cls : '') + '">' + FT.esc(v) + '</div></div>';
  }

  function fmtDuration(sec) {
    if (!sec && sec !== 0) return '-';
    sec = Math.round(sec);
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function ensureMB() {
    if (mb) return Promise.resolve(mb);
    if (mbLoading) return mbLoading;
    if (typeof window.VideoEncoder === 'undefined' || typeof window.VideoDecoder === 'undefined') {
      return Promise.reject(new Error('当前浏览器不支持 WebCodecs'));
    }
    FT.busyProgress(progress, '正在加载转换引擎…');
    mbLoading = import(MB_URL).then(function (mod) {
      mb = mod;
      return mb;
    }).catch(function (e) {
      mbLoading = null;
      throw new Error('转换引擎加载失败，请检查网络后重试（' + (e && e.message || e) + '）');
    });
    return mbLoading;
  }

  function loadVideoMeta(url) {
    return new Promise(function (resolve, reject) {
      var v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.playsInline = true;
      v.onloadedmetadata = function () { resolve(v); };
      v.onerror = function () { reject(new Error('无法读取视频，浏览器可能不支持该封装或编码')); };
      v.src = url;
    });
  }

  /* ---------------- 上传 ---------------- */

  function resetResult() {
    if (state.resultUrl) { URL.revokeObjectURL(state.resultUrl); state.resultUrl = null; }
    state.resultBlob = null;
    state.resultName = '';
    resultCard.hidden = true;
    previewBox.innerHTML = '';
    stats.innerHTML = '';
    downloadBtn.disabled = true;
  }

  function resetAll(clearFile) {
    state.busy = false;
    resetResult();
    if (clearFile) {
      if (state.url) { URL.revokeObjectURL(state.url); state.url = null; }
      state.file = null;
      state.meta = null;
      input.value = '';
      fileInfo.innerHTML = '';
      summary.textContent = '还没有加载视频';
      emptyText.textContent = '上传视频并选择目标格式，点击「开始转换」';
      empty.hidden = false;
    }
    runBtn.disabled = !state.file;
    resetBtn.disabled = !state.file;
  }

  function loadFile(file) {
    var ext = FT.extName(file.name);
    var okType = (file.type && file.type.indexOf('video/') === 0) ||
      ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'ogv', 'ts', '3gp'].indexOf(ext) >= 0;
    if (!okType) { FT.toast('请选择视频文件（MP4 / WebM / MOV 等）', 'err'); return; }
    if (file.size > MAX_SIZE) { FT.toast('视频超过 200MB，处理会非常慢，请裁剪后再试', 'err'); return; }

    resetAll(true);
    state.file = file;
    state.url = URL.createObjectURL(file);
    runBtn.disabled = false;
    resetBtn.disabled = false;
    summary.textContent = '正在读取 ' + file.name + ' …';
    fileInfo.innerHTML = '<span class="file-chip"><span class="fc-name">' + FT.esc(file.name) +
      '</span><span class="fc-size">' + FT.formatBytes(file.size) + '</span></span>';

    loadVideoMeta(state.url).then(function (v) {
      state.meta = { duration: v.duration, w: v.videoWidth, h: v.videoHeight };
      fileInfo.innerHTML = '<span class="file-chip"><span class="fc-name">' + FT.esc(file.name) +
        '</span><span class="fc-size">' + v.videoWidth + '×' + v.videoHeight + ' · ' +
        fmtDuration(v.duration) + ' · ' + FT.formatBytes(file.size) + '</span></span>';
      summary.textContent = file.name + ' · ' + v.videoWidth + '×' + v.videoHeight + ' · ' + fmtDuration(v.duration);
      FT.toast('视频已就绪', 'ok');
    }).catch(function (err) {
      console.error(err);
      summary.textContent = file.name + ' · 无法读取元信息';
      FT.toast('无法读取视频元信息，可直接尝试转换：' + (err && err.message || err), 'warn');
    });
  }

  /* ---------------- 转码（WebCodecs） ---------------- */

  function runTranscode() {
    var fmt = tFormat.value;
    var mime = fmt === 'webm' ? 'video/webm' : (fmt === 'mov' ? 'video/quicktime' : 'video/mp4');
    var out = null;

    ensureMB().then(function (M) {
      FT.busyProgress(progress, '正在准备转换…');
      var input = new M.Input({
        source: new M.BlobSource(state.file),
        formats: M.ALL_FORMATS
      });
      var format = fmt === 'webm' ? new M.WebMOutputFormat()
        : (fmt === 'mov' ? new M.MovOutputFormat() : new M.Mp4OutputFormat());
      out = new M.Output({ format: format, target: new M.BufferTarget() });
      return M.Conversion.init({ input: input, output: out });
    }).then(function (conv) {
      conv.onProgress = function (p) {
        if (typeof p === 'number' && p >= 0 && p <= 1) {
          FT.setProgress(progress, p, Math.round(p * 100) + '%');
        }
      };
      FT.busyProgress(progress, '正在转换…');
      return conv.execute();
    }).then(function () {
      var buf = out.target.buffer;
      if (!buf || !buf.byteLength) throw new Error('转换输出为空，源编码可能不受支持');
      return { blob: new Blob([buf], { type: mime }), ext: fmt, kind: 'video' };
    }).then(function (res) {
      showMediaResult(res, { '目标格式': fmt.toUpperCase() });
      finish(true);
    }).catch(function (err) { failRun(err, '转码失败'); });
  }

  /* ---------------- 结果 ---------------- */

  function showMediaResult(res, params) {
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultBlob = res.blob;
    state.resultUrl = URL.createObjectURL(res.blob);
    state.resultName = FT.safeName(FT.baseName(state.file.name)) + '.' + res.ext;

    if (res.kind === 'video') {
      previewBox.innerHTML = '<video controls src="' + FT.esc(state.resultUrl) + '"></video>';
    } else {
      previewBox.innerHTML = '<img src="' + FT.esc(state.resultUrl) + '" alt="结果" data-zoom>';
    }

    var rows = '';
    Object.keys(params).forEach(function (k) { rows += stat(k, params[k]); });
    rows += stat('原始体积', FT.formatBytes(state.file.size));
    var cls = res.blob.size <= state.file.size ? 'down' : 'up';
    rows += stat('输出体积', FT.formatBytes(res.blob.size) + '（' + FT.pct(res.blob.size, state.file.size) + '）', cls);
    stats.innerHTML = rows;

    downloadBtn.disabled = false;
    empty.hidden = true;
    resultCard.hidden = false;
    summary.textContent = state.file.name + ' → ' + state.resultName;
  }

  function failRun(err, title) {
    console.error(err);
    FT.alert(tips, 'err', '<b>' + FT.esc(title) + '</b><p>' + FT.esc(err && err.message || '未知错误') +
      '</p><p>可能原因：网络中断、浏览器内存不足或源编码不受支持。请尝试更短、更小的视频。</p>', true);
    FT.toast(title + '：' + (err && err.message || err), 'err');
    finish(false);
  }

  function finish(ok) {
    state.busy = false;
    FT.setBusy(runBtn, false);
    runBtn.disabled = !state.file;
    if (ok) {
      FT.setProgress(progress, 1, '完成');
      setTimeout(function () { FT.resetProgress(progress); }, 1600);
    } else {
      FT.resetProgress(progress);
    }
  }

  /* ---------------- 事件 ---------------- */

  runBtn.addEventListener('click', function () {
    if (!state.file || state.busy) return;
    state.busy = true;
    tips.innerHTML = '';
    showLimitTip();
    resetResult();
    empty.hidden = true;
    FT.setBusy(runBtn, true, '转换中…');
    runTranscode();
  });

  downloadBtn.addEventListener('click', function () {
    if (state.resultBlob) FT.saveBlob(state.resultBlob, state.resultName);
  });

  resetBtn.addEventListener('click', function () {
    resetAll(true);
    FT.resetProgress(progress);
    tips.innerHTML = '';
    showLimitTip();
  });

  FT.bindDropzone(drop, input, function (files) { if (files[0]) loadFile(files[0]); });
  resetAll(true);
})();
