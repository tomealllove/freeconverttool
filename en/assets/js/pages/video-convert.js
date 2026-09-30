/* Video Converter: MP4 / WebM / MOV via WebCodecs (mediabunny) */
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

  var LIMIT_HTML = '<b>Please read the performance limits first</b>' +
    '<p>This tool uses the browser\'s native <b>WebCodecs</b> API, which can be hardware accelerated. ' +
    'When the original codec can be reused (for example MP4 to MOV), conversion is fast and lossless. ' +
    'It is still bound by browser memory limits, so this tool is only suitable for <b>short clips</b> ' +
    '(a few seconds up to a few minutes); long videos or large files can be extremely slow or fail.</p>';

  function showLimitTip() { FT.alert(tips, 'warn', LIMIT_HTML); }
  if (typeof window.VideoEncoder === 'undefined' || typeof window.VideoDecoder === 'undefined') {
    FT.alert(tips, 'err', '<b>Your browser does not support WebCodecs</b><p>Please use the latest version of Chrome, Edge or Safari.</p>');
    runBtn.disabled = true;
  } else {
    showLimitTip();
  }

  /* ---------------- Helpers ---------------- */

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
      return Promise.reject(new Error('Your browser does not support WebCodecs'));
    }
    FT.busyProgress(progress, 'Loading the conversion engine…');
    mbLoading = import(MB_URL).then(function (mod) {
      mb = mod;
      return mb;
    }).catch(function (e) {
      mbLoading = null;
      throw new Error('Failed to load the conversion engine, please check your connection and try again (' + (e && e.message || e) + '）');
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
      v.onerror = function () { reject(new Error('Could not read the video, the browser may not support this container or codec')); };
      v.src = url;
    });
  }

  /* ---------------- Upload ---------------- */

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
      summary.textContent = 'No video loaded yet';
      emptyText.textContent = 'Upload a video, pick a target format, then click "Convert"';
      empty.hidden = false;
    }
    runBtn.disabled = !state.file;
    resetBtn.disabled = !state.file;
  }

  function loadFile(file) {
    var ext = FT.extName(file.name);
    var okType = (file.type && file.type.indexOf('video/') === 0) ||
      ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'ogv', 'ts', '3gp'].indexOf(ext) >= 0;
    if (!okType) { FT.toast('Please select a video file (MP4 / WebM / MOV, etc.)', 'err'); return; }
    if (file.size > MAX_SIZE) { FT.toast('Video exceeds 200MB, processing would be very slow — please trim it and try again', 'err'); return; }

    resetAll(true);
    state.file = file;
    state.url = URL.createObjectURL(file);
    runBtn.disabled = false;
    resetBtn.disabled = false;
    summary.textContent = 'Reading ' + file.name + ' …';
    fileInfo.innerHTML = '<span class="file-chip"><span class="fc-name">' + FT.esc(file.name) +
      '</span><span class="fc-size">' + FT.formatBytes(file.size) + '</span></span>';

    loadVideoMeta(state.url).then(function (v) {
      state.meta = { duration: v.duration, w: v.videoWidth, h: v.videoHeight };
      fileInfo.innerHTML = '<span class="file-chip"><span class="fc-name">' + FT.esc(file.name) +
        '</span><span class="fc-size">' + v.videoWidth + '×' + v.videoHeight + ' · ' +
        fmtDuration(v.duration) + ' · ' + FT.formatBytes(file.size) + '</span></span>';
      summary.textContent = file.name + ' · ' + v.videoWidth + '×' + v.videoHeight + ' · ' + fmtDuration(v.duration);
      FT.toast('Video is ready', 'ok');
    }).catch(function (err) {
      console.error(err);
      summary.textContent = file.name + ' · could not read metadata';
      FT.toast('Could not read video metadata — you can still try converting: ' + (err && err.message || err), 'warn');
    });
  }

  /* ---------------- transcode (WebCodecs) ---------------- */

  function runTranscode() {
    var fmt = tFormat.value;
    var mime = fmt === 'webm' ? 'video/webm' : (fmt === 'mov' ? 'video/quicktime' : 'video/mp4');
    var out = null;

    ensureMB().then(function (M) {
      FT.busyProgress(progress, 'Preparing conversion…');
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
      FT.busyProgress(progress, 'Converting…');
      return conv.execute();
    }).then(function () {
      var buf = out.target.buffer;
      if (!buf || !buf.byteLength) throw new Error('Conversion output is empty, the source codec may be unsupported');
      return { blob: new Blob([buf], { type: mime }), ext: fmt, kind: 'video' };
    }).then(function (res) {
      showMediaResult(res, { 'Target format': fmt.toUpperCase() });
      finish(true);
    }).catch(function (err) { failRun(err, 'Transcoding failed'); });
  }

  /* ---------------- Result ---------------- */

  function showMediaResult(res, params) {
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultBlob = res.blob;
    state.resultUrl = URL.createObjectURL(res.blob);
    state.resultName = FT.safeName(FT.baseName(state.file.name)) + '.' + res.ext;

    if (res.kind === 'video') {
      previewBox.innerHTML = '<video controls src="' + FT.esc(state.resultUrl) + '"></video>';
    } else {
      previewBox.innerHTML = '<img src="' + FT.esc(state.resultUrl) + '" alt="Result" data-zoom>';
    }

    var rows = '';
    Object.keys(params).forEach(function (k) { rows += stat(k, params[k]); });
    rows += stat('Original size', FT.formatBytes(state.file.size));
    var cls = res.blob.size <= state.file.size ? 'down' : 'up';
    rows += stat('Output size', FT.formatBytes(res.blob.size) + ' (' + FT.pct(res.blob.size, state.file.size) + ')', cls);
    stats.innerHTML = rows;

    downloadBtn.disabled = false;
    empty.hidden = true;
    resultCard.hidden = false;
    summary.textContent = state.file.name + ' → ' + state.resultName;
  }

  function failRun(err, title) {
    console.error(err);
    FT.alert(tips, 'err', '<b>' + FT.esc(title) + '</b><p>' + FT.esc(err && err.message || 'Unknown error') +
      '</p><p>Possible causes: connection dropped, not enough browser memory, or an unsupported source codec. Please try a shorter, smaller video.</p>', true);
    FT.toast(title + ': ' + (err && err.message || err), 'err');
    finish(false);
  }

  function finish(ok) {
    state.busy = false;
    FT.setBusy(runBtn, false);
    runBtn.disabled = !state.file;
    if (ok) {
      FT.setProgress(progress, 1, 'Done');
      setTimeout(function () { FT.resetProgress(progress); }, 1600);
    } else {
      FT.resetProgress(progress);
    }
  }

  /* ---------------- Events ---------------- */

  runBtn.addEventListener('click', function () {
    if (!state.file || state.busy) return;
    state.busy = true;
    tips.innerHTML = '';
    showLimitTip();
    resetResult();
    empty.hidden = true;
    FT.setBusy(runBtn, true, 'Converting…');
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
