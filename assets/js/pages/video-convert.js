/* 视频格式互转：转码 / 转 GIF（ffmpeg.wasm）+ 抽帧截图（原生 video+canvas） */
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

  var LIMIT_HTML = '<b>请先了解性能边界</b>' +
    '<p>浏览器内的 ffmpeg.wasm <b>没有硬件加速</b>，为纯 CPU 软件编解码，速度约为原生工具的 <b>1/10 ~ 1/30</b>，' +
    '并受浏览器内存限制。因此本工具仅适合<b>短视频</b>（几十秒到几分钟）的转码、转 GIF；' +
    '长视频/大文件可能非常慢甚至因内存不足失败。</p>' +
    '<p><b>抽帧截图</b>使用浏览器原生解码，无需加载引擎、速度快，可作为轻量替代方案。</p>';

  function showLimitTip() { FT.alert(tips, 'warn', LIMIT_HTML); }
  showLimitTip();

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

  function ensureFfmpeg() {
    if (ff) return Promise.resolve(ff);
    if (ffLoading) return ffLoading;
    if (typeof FFmpeg === 'undefined') {
      return Promise.reject(new Error('转换引擎（ffmpeg.wasm）未加载，请检查网络后刷新页面'));
    }
    FT.busyProgress(progress, '正在加载转换引擎（约 30MB，仅首次）…');
    var inst;
    try {
      inst = FFmpeg.createFFmpeg({ corePath: FFMPEG_CORE, log: false });
    } catch (e) {
      return Promise.reject(new Error('转换引擎初始化失败：' + (e && e.message || e)));
    }
    ffLoading = inst.load().then(function () {
      ff = inst;
      return ff;
    }).catch(function (e) {
      ffLoading = null;
      throw new Error('转换引擎加载失败，请检查网络或内存后重试（' + (e && e.message || e) + '）');
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
      v.onerror = function () { reject(new Error('无法读取视频，浏览器可能不支持该封装或编码')); };
      v.src = url;
    });
  }

  /* ---------------- 上传 ---------------- */

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
    downloadAll.textContent = '打包下载';
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
      emptyText.textContent = '上传视频后设置参数，点击「开始处理」生成结果';
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
      FT.toast('无法读取视频元信息，抽帧可能不可用，可尝试转码：' + (err && err.message || err), 'warn');
    });
  }

  /* ---------------- ffmpeg：转码 / GIF ---------------- */

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
    } catch (e) { /* 忽略 */ }
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
        // mp4 / mov 统一走 H.264
        args.push('-c:v', 'libx264', '-crf', String(crf), '-preset', 'veryfast', '-pix_fmt', 'yuv420p');
        if (!noAudio) args.push('-c:a', 'aac', '-b:a', '128k');
      }
      if (noAudio) args.push('-an');
      args.push(outName);

      bindFfmpegProgress();
      FT.busyProgress(progress, '转码中，请耐心等待…');
      return ff.run.apply(ff, args).then(function () {
        var data = ff.FS('readFile', outName);
        try { ff.FS('unlink', inName); } catch (e) {}
        try { ff.FS('unlink', outName); } catch (e) {}
        if (!data || !data.length) throw new Error('转码输出为空，源编码可能不受支持');
        var mime = fmt === 'webm' ? 'video/webm' : (fmt === 'mov' ? 'video/quicktime' : 'video/mp4');
        return { blob: new Blob([data.buffer], { type: mime }), ext: fmt, kind: 'video' };
      });
    }).then(function (res2) {
      showMediaResult(res2, { '目标格式': fmt.toUpperCase(), 'CRF': String(crf), '分辨率': res ? res + 'p' : '原始' });
      finish(true);
    }).catch(function (err) { failRun(err, '转码失败'); });
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
      FT.busyProgress(progress, '正在生成 GIF…');
      return ff.run.apply(ff, args).then(function () {
        var data = ff.FS('readFile', outName);
        try { ff.FS('unlink', inName); } catch (e) {}
        try { ff.FS('unlink', outName); } catch (e) {}
        if (!data || !data.length) throw new Error('GIF 输出为空');
        return { blob: new Blob([data.buffer], { type: 'image/gif' }), ext: 'gif', kind: 'image' };
      });
    }).then(function (res) {
      showMediaResult(res, { 'FPS': String(fps), '宽度': width + 'px', '片段': start + 's ~ ' + (start + dur) + 's' });
      finish(true);
    }).catch(function (err) { failRun(err, 'GIF 生成失败'); });
  }

  /* ---------------- 原生：抽帧 ---------------- */

  function grabFrame(video, t, mime, q) {
    return new Promise(function (resolve, reject) {
      var done = false;
      function draw() {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', draw);
        try {
          var w = video.videoWidth, h = video.videoHeight;
          if (!w || !h) throw new Error('视频尺寸无效');
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
        failRun(new Error('无法获取视频时长，请改用「单个时间点」抽帧'), '抽帧失败');
        return;
      }
      for (var t = 0; t < duration && times.length < MAX_FRAMES; t += step) times.push(t);
      if (!times.length) times.push(0);
    }
    if (times.length >= MAX_FRAMES) {
      FT.toast('帧数较多，本次仅截取前 ' + MAX_FRAMES + ' 张', 'warn');
    }

    empty.hidden = true;
    resultCard.hidden = true;
    clearFrames();
    var base = FT.safeName(FT.baseName(state.file.name));

    loadVideoMeta(state.url).then(function (video) {
      var i = 0, ok = 0;
      function next() {
        if (i >= times.length) return done();
        FT.setProgress(progress, i / times.length, '抽帧 ' + (i + 1) + '/' + times.length);
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
        FT.setProgress(progress, 1, '完成 ' + ok + ' 张');
        downloadAll.disabled = state.frames.length === 0;
        downloadAll.textContent = state.frames.length > 1 ? '打包下载 (' + state.frames.length + ')' : '打包下载';
        summary.textContent = state.file.name + ' · 抽帧 ' + ok + ' 张';
        if (!state.frames.length) {
          empty.hidden = false;
          FT.toast('未能截取到任何画面', 'err');
        } else {
          FT.toast('抽帧完成，共 ' + ok + ' 张', 'ok');
        }
        finish(state.frames.length > 0);
      }
      next();
    }).catch(function (err) { failRun(err, '抽帧失败'); });
  }

  function appendFrameCard(frame) {
    var el = FT.el(
      '<article class="item page-card">' +
        '<div class="item-head"><span class="page-num">' + frame.t.toFixed(1) + 's</span><span class="badge ok">' +
          (FT.extName(frame.name).toUpperCase()) + '</span></div>' +
        '<div class="thumb checker"><img src="' + FT.esc(frame.url) + '" alt="帧" data-zoom></div>' +
        '<div class="page-meta">' + frame.w + '×' + frame.h + ' · ' + FT.formatBytes(frame.blob.size) + '</div>' +
        '<div class="item-actions"><button class="btn btn-sm" data-act="dl">下载</button></div>' +
      '</article>'
    );
    el.querySelector('[data-act="dl"]').addEventListener('click', function () {
      FT.saveBlob(frame.blob, frame.name);
    });
    frameList.appendChild(el);
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
    FT.setBusy(runBtn, true, '处理中…');
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
    FT.setBusy(downloadAll, true, '打包中…');
    FT.setProgress(progress, 0.3, '正在打包 ' + state.frames.length + ' 张…');
    FT.makeZip(state.frames.map(function (f) { return { name: folder + '/' + f.name, blob: f.blob }; }))
      .then(function (zip) {
        FT.saveBlob(zip, folder + '.zip');
        FT.setProgress(progress, 1, '打包完成');
        FT.toast('已打包 ' + state.frames.length + ' 张', 'ok');
      })
      .catch(function (err) { FT.toast('打包失败：' + (err.message || err), 'err'); })
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
    // 抽帧不需要打包按钮之外的处理；转码/GIF 隐藏打包按钮更清晰
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
