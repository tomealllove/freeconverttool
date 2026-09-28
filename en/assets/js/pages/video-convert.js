/* Video Converter: transcode / GIF (ffmpeg.wasm) + frame extraction (native video + canvas) */
(function () {
  'use strict';

  FT.mountShell('video-convert');

  var MAX_SIZE = 200 * 1024 * 1024;
  var MAX_FRAMES = 60;
  var FFMPEG_CORE = 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js';

  var drop = FT.$('#drop');
  var input = FT.$('#file');
  var fileInfo = FT.$('#fileInfo');
  var taskSel = FT.$('#task');

  var tFormat = FT.$('#tFormat');
  var tRes = FT.$('#tRes');
  var tCrf = FT.$('#tCrf');
  var tNoAudio = FT.$('#tNoAudio');

  var gFps = FT.$('#gFps');
  var gWidth = FT.$('#gWidth');
  var gStart = FT.$('#gStart');
  var gDur = FT.$('#gDur');

  var fMode = FT.$('#fMode');
  var fInterval = FT.$('#fInterval');
  var fIntervalField = FT.$('#fIntervalField');
  var fPoint = FT.$('#fPoint');
  var fPointField = FT.$('#fPointField');
  var fFormat = FT.$('#fFormat');

  var runBtn = FT.$('#run');
  var resetBtn = FT.$('#reset');
  var downloadAll = FT.$('#downloadAll');
  var progress = FT.$('#progress');
  var tips = FT.$('#tips');
  var summary = FT.$('#summary');
  var empty = FT.$('#empty');
  var emptyText = FT.$('#emptyText');
  var resultCard = FT.$('#resultCard');
  var previewBox = FT.$('#previewBox');
  var stats = FT.$('#stats');
  var downloadBtn = FT.$('#download');
  var frameList = FT.$('#frameList');

  var state = {
    file: null, url: null, meta: null, busy: false,
    resultBlob: null, resultUrl: null, resultName: '',
    frames: []
  };
  var ff = null, ffLoading = null;

  var LIMIT_HTML = '<b>Please read the performance limits first</b>' +
    '<p>ffmpeg.wasm in the browser has <b>no hardware acceleration</b>; it is pure CPU software encoding and decoding, ' +
    'roughly <b>1/10 to 1/30</b> the speed of a native tool, and it is bound by browser memory limits. ' +
    'So this tool is only suitable for <b>short clips</b> (a few seconds up to a few minutes) for transcoding and GIF conversion; ' +
    'long videos or large files can be extremely slow or fail from running out of memory.</p>' +
    '<p><b>Frame extraction</b> uses the browser\'s native decoder, needs no engine download and is fast — a good lightweight alternative.</p>';

  function showLimitTip() { FT.alert(tips, 'warn', LIMIT_HTML); }
  showLimitTip();

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

  function ensureFfmpeg() {
    if (ff) return Promise.resolve(ff);
    if (ffLoading) return ffLoading;
    if (typeof FFmpeg === 'undefined') {
      return Promise.reject(new Error('The conversion engine (ffmpeg.wasm) is not loaded, please check your connection and reload the page'));
    }
    FT.busyProgress(progress, 'Loading the conversion engine (~30 MB, first run only)…');
    var inst;
    try {
      inst = FFmpeg.createFFmpeg({ corePath: FFMPEG_CORE, log: false });
    } catch (e) {
      return Promise.reject(new Error('Conversion engine initialization failed: ' + (e && e.message || e)));
    }
    ffLoading = inst.load().then(function () {
      ff = inst;
      return ff;
    }).catch(function (e) {
      ffLoading = null;
      throw new Error('Failed to load the conversion engine, please check your connection or available memory and try again (' + (e && e.message || e) + ')');
    });
    return ffLoading;
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

  function clearFrames() {
    state.frames.forEach(function (f) { URL.revokeObjectURL(f.url); });
    state.frames = [];
    frameList.innerHTML = '';
  }

  function resetResult() {
    if (state.resultUrl) { URL.revokeObjectURL(state.resultUrl); state.resultUrl = null; }
    state.resultBlob = null;
    state.resultName = '';
    resultCard.hidden = true;
    previewBox.innerHTML = '';
    stats.innerHTML = '';
    downloadBtn.disabled = true;
    clearFrames();
    downloadAll.disabled = true;
    downloadAll.textContent = 'Download all';
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
      emptyText.textContent = 'Upload a video, set your options, then click "Start" to generate the result';
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
      FT.toast('Could not read video metadata, frame extraction may not work — try transcoding: ' + (err && err.message || err), 'warn');
    });
  }

  /* ---------------- ffmpeg: transcode / GIF ---------------- */

  function writeInput() {
    var srcExt = FT.extName(state.file.name) || 'mp4';
    var inName = 'input.' + srcExt;
    return FT.readArrayBuffer(state.file).then(function (buf) {
      ff.FS('writeFile', inName, new Uint8Array(buf));
      return inName;
    });
  }

  function bindFfmpegProgress() {
    try {
      ff.setProgress(function (p) {
        if (p && typeof p.ratio === 'number' && p.ratio >= 0 && p.ratio <= 1) {
          FT.setProgress(progress, p.ratio, Math.round(p.ratio * 100) + '%');
        }
      });
    } catch (e) { /* ignore */ }
  }

  function runTranscode() {
    var fmt = tFormat.value;
    var res = Number(tRes.value) || 0;
    var crf = Number(tCrf.value) || 23;
    var noAudio = tNoAudio.checked;
    var outName = 'output.' + fmt;

    ensureFfmpeg().then(function () {
      return writeInput();
    }).then(function (inName) {
      var args = ['-i', inName];
      if (res) args.push('-vf', 'scale=-2:' + res);

      if (fmt === 'webm') {
        args.push('-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0');
        if (!noAudio) args.push('-c:a', 'libopus', '-b:a', '128k');
      } else {
        // mp4 / mov both go through H.264
        args.push('-c:v', 'libx264', '-crf', String(crf), '-preset', 'veryfast', '-pix_fmt', 'yuv420p');
        if (!noAudio) args.push('-c:a', 'aac', '-b:a', '128k');
      }
      if (noAudio) args.push('-an');
      args.push(outName);

      bindFfmpegProgress();
      FT.busyProgress(progress, 'Transcoding, please be patient…');
      return ff.run.apply(ff, args).then(function () {
        var data = ff.FS('readFile', outName);
        try { ff.FS('unlink', inName); } catch (e) {}
        try { ff.FS('unlink', outName); } catch (e) {}
        if (!data || !data.length) throw new Error('Transcode output is empty, the source codec may not be supported');
        var mime = fmt === 'webm' ? 'video/webm' : (fmt === 'mov' ? 'video/quicktime' : 'video/mp4');
        return { blob: new Blob([data.buffer], { type: mime }), ext: fmt, kind: 'video' };
      });
    }).then(function (res2) {
      showMediaResult(res2, { 'Target format': fmt.toUpperCase(), 'CRF': String(crf), 'Resolution': res ? res + 'p' : 'Original' });
      finish(true);
    }).catch(function (err) { failRun(err, 'Transcoding failed'); });
  }

  function runGif() {
    var fps = Number(gFps.value) || 15;
    var width = Number(gWidth.value) || 480;
    var start = Math.max(0, Number(gStart.value) || 0);
    var dur = Math.max(0.5, Number(gDur.value) || 5);
    var outName = 'output.gif';

    ensureFfmpeg().then(function () {
      return writeInput();
    }).then(function (inName) {
      var args = ['-ss', String(start), '-t', String(dur), '-i', inName,
        '-vf', 'fps=' + fps + ',scale=' + width + ':-1:flags=lanczos', outName];
      bindFfmpegProgress();
      FT.busyProgress(progress, 'Generating GIF…');
      return ff.run.apply(ff, args).then(function () {
        var data = ff.FS('readFile', outName);
        try { ff.FS('unlink', inName); } catch (e) {}
        try { ff.FS('unlink', outName); } catch (e) {}
        if (!data || !data.length) throw new Error('GIF output is empty');
        return { blob: new Blob([data.buffer], { type: 'image/gif' }), ext: 'gif', kind: 'image' };
      });
    }).then(function (res) {
      showMediaResult(res, { 'FPS': String(fps), 'Width': width + 'px', 'Clip': start + 's ~ ' + (start + dur) + 's' });
      finish(true);
    }).catch(function (err) { failRun(err, 'GIF generation failed'); });
  }

  /* ---------------- Native: frame extraction ---------------- */

  function grabFrame(video, t, mime, q) {
    return new Promise(function (resolve, reject) {
      var done = false;
      function draw() {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', draw);
        try {
          var w = video.videoWidth, h = video.videoHeight;
          if (!w || !h) throw new Error('Invalid video dimensions');
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(video, 0, 0, w, h);
          FT.canvasToBlob(canvas, mime, q).then(function (blob) {
            resolve({ blob: blob, w: w, h: h });
          }, reject);
        } catch (e) { reject(e); }
      }
      video.addEventListener('seeked', draw);
      var target = Math.min(t, Math.max(0, (video.duration || 0) - 0.03));
      try { video.currentTime = target; } catch (e) { reject(e); return; }
      setTimeout(function () { if (!done) draw(); }, 4000);
    });
  }

  function runFrames() {
    var mime = fFormat.value;
    var ext = mime === 'image/jpeg' ? 'jpg' : 'png';
    var q = 0.92;
    var duration = state.meta ? state.meta.duration : 0;

    var times = [];
    if (fMode.value === 'point') {
      times = [Math.max(0, Number(fPoint.value) || 0)];
    } else {
      var step = Math.max(0.2, Number(fInterval.value) || 2);
      if (!duration || !isFinite(duration)) {
        failRun(new Error('Could not get the video duration, please use "Single time point" extraction instead'), 'Frame extraction failed');
        return;
      }
      for (var t = 0; t < duration && times.length < MAX_FRAMES; t += step) times.push(t);
      if (!times.length) times.push(0);
    }
    if (times.length >= MAX_FRAMES) {
      FT.toast('That is a lot of frames, only the first ' + MAX_FRAMES + ' will be captured', 'warn');
    }

    empty.hidden = true;
    resultCard.hidden = true;
    clearFrames();
    var base = FT.safeName(FT.baseName(state.file.name));

    loadVideoMeta(state.url).then(function (video) {
      var i = 0, ok = 0;
      function next() {
        if (i >= times.length) return done();
        FT.setProgress(progress, i / times.length, 'Extracting frame ' + (i + 1) + '/' + times.length);
        var t = times[i];
        i++;
        return grabFrame(video, t, mime, q).then(function (r) {
          var url = URL.createObjectURL(r.blob);
          var frame = {
            blob: r.blob, url: url, w: r.w, h: r.h, t: t,
            name: base + '-' + t.toFixed(1) + 's.' + ext
          };
          state.frames.push(frame);
          appendFrameCard(frame);
          ok++;
        }).catch(function (e) {
          console.error(e);
        }).then(next);
      }
      function done() {
        FT.setProgress(progress, 1, 'Done, ' + ok + ' frames');
        downloadAll.disabled = state.frames.length === 0;
        downloadAll.textContent = state.frames.length > 1 ? 'Download all (' + state.frames.length + ')' : 'Download all';
        summary.textContent = state.file.name + ' · ' + ok + ' frames extracted';
        if (!state.frames.length) {
          empty.hidden = false;
          FT.toast('No frames could be captured', 'err');
        } else {
          FT.toast('Frame extraction complete, ' + ok + ' frames', 'ok');
        }
        finish(state.frames.length > 0);
      }
      next();
    }).catch(function (err) { failRun(err, 'Frame extraction failed'); });
  }

  function appendFrameCard(frame) {
    var el = FT.el(
      '<article class="item page-card">' +
        '<div class="item-head"><span class="page-num">' + frame.t.toFixed(1) + 's</span><span class="badge ok">' +
          (FT.extName(frame.name).toUpperCase()) + '</span></div>' +
        '<div class="thumb checker"><img src="' + FT.esc(frame.url) + '" alt="Frame" data-zoom></div>' +
        '<div class="page-meta">' + frame.w + '×' + frame.h + ' · ' + FT.formatBytes(frame.blob.size) + '</div>' +
        '<div class="item-actions"><button class="btn btn-sm" data-act="dl">Download</button></div>' +
      '</article>'
    );
    el.querySelector('[data-act="dl"]').addEventListener('click', function () {
      FT.saveBlob(frame.blob, frame.name);
    });
    frameList.appendChild(el);
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
    FT.setBusy(runBtn, true, 'Processing…');
    var task = taskSel.value;
    if (task === 'transcode') runTranscode();
    else if (task === 'gif') runGif();
    else runFrames();
  });

  downloadBtn.addEventListener('click', function () {
    if (state.resultBlob) FT.saveBlob(state.resultBlob, state.resultName);
  });

  downloadAll.addEventListener('click', function () {
    if (!state.frames.length) return;
    if (state.frames.length === 1) { FT.saveBlob(state.frames[0].blob, state.frames[0].name); return; }
    var folder = FT.safeName(FT.baseName(state.file.name)) + '-frames';
    FT.setBusy(downloadAll, true, 'Packing…');
    FT.setProgress(progress, 0.3, 'Packing ' + state.frames.length + ' frames…');
    FT.makeZip(state.frames.map(function (f) { return { name: folder + '/' + f.name, blob: f.blob }; }))
      .then(function (zip) {
        FT.saveBlob(zip, folder + '.zip');
        FT.setProgress(progress, 1, 'Packing complete');
        FT.toast('Packed ' + state.frames.length + ' frames', 'ok');
      })
      .catch(function (err) { FT.toast('Packing failed: ' + (err.message || err), 'err'); })
      .then(function () {
        FT.setBusy(downloadAll, false);
        setTimeout(function () { FT.resetProgress(progress); }, 1500);
      });
  });

  resetBtn.addEventListener('click', function () {
    resetAll(true);
    FT.resetProgress(progress);
    tips.innerHTML = '';
    showLimitTip();
  });

  function syncTaskFields() {
    var task = taskSel.value;
    FT.$$('[data-grp="transcode"]').forEach(function (el) { el.hidden = task !== 'transcode'; });
    FT.$$('[data-grp="gif"]').forEach(function (el) { el.hidden = task !== 'gif'; });
    FT.$$('[data-grp="frames"]').forEach(function (el) { el.hidden = task !== 'frames'; });
    if (task === 'frames') {
      fIntervalField.hidden = fMode.value !== 'interval';
      fPointField.hidden = fMode.value !== 'point';
    }
    // Frame extraction needs no extra handling beyond the pack button;
    // hiding the pack button for transcode / GIF keeps the UI clear
    downloadAll.hidden = task !== 'frames';
  }

  taskSel.addEventListener('change', syncTaskFields);
  fMode.addEventListener('change', function () {
    fIntervalField.hidden = fMode.value !== 'interval';
    fPointField.hidden = fMode.value !== 'point';
  });

  FT.bindDropzone(drop, input, function (files) { if (files[0]) loadFile(files[0]); });
  syncTaskFields();
  resetAll(true);
})();
