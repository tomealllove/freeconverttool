/* Audio Converter: upload → browser decoding → export WAV / MP3 → playback preview / download */
(function () {
  'use strict';

  FT.mountShell('audio-convert');

  var MAX_SIZE = 200 * 1024 * 1024;
  var drop = FT.$('#drop');
  var input = FT.$('#file');
  var fileInfo = FT.$('#fileInfo');
  var nformat = FT.$('#nformat');
  var nrate = FT.$('#nrate');
  var nbitrate = FT.$('#nbitrate');
  var nbitrateField = FT.$('#nbitrateField');
  var convertBtn = FT.$('#convert');
  var resetBtn = FT.$('#reset');
  var progress = FT.$('#progress');
  var tips = FT.$('#tips');
  var summary = FT.$('#summary');
  var empty = FT.$('#empty');
  var emptyText = FT.$('#emptyText');
  var resultCard = FT.$('#resultCard');
  var stats = FT.$('#stats');
  var player = FT.$('#player');
  var downloadBtn = FT.$('#download');

  var state = {
    file: null, info: null, busy: false,
    resultBlob: null, resultUrl: null, resultName: ''
  };
  var LIMIT_HTML = '<b>About conversion capability</b>' +
    '<p>This tool uses the browser\'s built-in decoder (instant startup), but browsers <b>ship no general purpose encoder</b>, ' +
    'so only <b>WAV</b> (hand written PCM container) and <b>MP3</b> (lamejs encoding) are offered; ' +
    'OGG / AAC / FLAC have no universal front-end encoder and cannot be exported.</p>' +
    '<p><b>Sample rate</b>: with "<b>Keep original</b>" selected, <b>lossless formats such as WAV keep the exact source sample rate</b>; ' +
    'compressed formats like MP3 do not expose their original rate to the browser, so the decoded rate is used instead ' +
    '(pick a specific value if you need exact control).</p>' +
    '<p><b>Input formats</b> depend on your browser\'s decoding ability; MP3, WAV, OGG and M4A generally work. ' +
    'If you see a decoding error, that codec is not supported by your browser.</p>';

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

  // Read the real sample rate from the WAV header so "Keep original" is not resampled
  function parseWavSampleRate(buf) {
    try {
      var dv = new DataView(buf);
      if (dv.byteLength < 44) return 0;
      if (dv.getUint32(0, false) !== 0x52494646) return 0; // 'RIFF'
      if (dv.getUint32(8, false) !== 0x57415645) return 0; // 'WAVE'
      var off = 12;
      while (off + 8 <= dv.byteLength) {
        var id = dv.getUint32(off, false);
        var size = dv.getUint32(off + 4, true);
        if (id === 0x666d7420) { return dv.getUint32(off + 12, true); } // 'fmt ' sampleRate
        off += 8 + size + (size & 1);
      }
    } catch (e) {}
    return 0;
  }

  // Decode in a context as close as possible to the target sample rate so decodeAudioData
  // does not force resampling to the device rate; if the browser snaps the context to
  // another rate, resample() corrects it back to preferredRate.
  function decodeAudioBuffer(buf, preferredRate) {
    return new Promise(function (resolve, reject) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) { reject(new Error('This browser does not support Web Audio, so conversion is not possible')); return; }
      var useRate = (preferredRate && preferredRate >= 8000 && preferredRate <= 96000) ? preferredRate : null;
      var ctx;
      try { ctx = useRate ? new Ctx({ sampleRate: useRate }) : new Ctx(); }
      catch (e) { try { ctx = new Ctx(); } catch (e2) { reject(new Error('Could not create an audio context')); return; } }
      var decodedRate = ctx.sampleRate;
      ctx.decodeAudioData(buf.slice(0), function (ab) {
        try { ctx.close(); } catch (e) {}
        if (preferredRate && preferredRate !== decodedRate) {
          resample(ab, preferredRate).then(resolve, function () { resolve(ab); });
        } else {
          resolve(ab);
        }
      }, function () {
        try { ctx.close(); } catch (e) {}
        reject(new Error('The browser cannot decode this audio (the codec may be unsupported)'));
      });
    });
  }

  /* ---------------- Native encoding ---------------- */

  function resample(audioBuffer, targetRate) {
    if (!targetRate || audioBuffer.sampleRate === targetRate) return Promise.resolve(audioBuffer);
    var OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtx) return Promise.resolve(audioBuffer);
    var numCh = audioBuffer.numberOfChannels;
    var len = Math.max(1, Math.ceil(audioBuffer.duration * targetRate));
    var off = new OfflineCtx(numCh, len, targetRate);
    var src = off.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(off.destination);
    src.start(0);
    return off.startRendering();
  }

  function f32ToI16(f32) {
    var out = new Int16Array(f32.length);
    for (var i = 0; i < f32.length; i++) {
      var s = f32[i];
      if (s > 1) s = 1; else if (s < -1) s = -1;
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
  }

  function writeStr(view, offset, str) {
    for (var i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  // Interleave left/right channels, 16bit PCM, little endian
  function encodeWav(audioBuffer) {
    var numCh = audioBuffer.numberOfChannels;
    var sr = audioBuffer.sampleRate;
    var len = audioBuffer.length;
    var blockAlign = numCh * 2;
    var dataSize = len * blockAlign;
    var buffer = new ArrayBuffer(44 + dataSize);
    var view = new DataView(buffer);

    writeStr(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(view, 8, 'WAVE');
    writeStr(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);            // PCM
    view.setUint16(22, numCh, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);           // bits per sample
    writeStr(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    var channels = [];
    for (var c = 0; c < numCh; c++) channels.push(audioBuffer.getChannelData(c));

    var offset = 44;
    for (var s = 0; s < len; s++) {
      for (var ch = 0; ch < numCh; ch++) {
        var sample = channels[ch][s];
        if (sample > 1) sample = 1; else if (sample < -1) sample = -1;
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  // Call lamejs in chunks so the main thread is not blocked for too long
  function encodeMp3(audioBuffer, kbps, onProg) {
    return new Promise(function (resolve, reject) {
      try {
        if (typeof lamejs === 'undefined') throw new Error('The MP3 encoder component (lamejs) is not loaded');
        var numCh = Math.min(2, audioBuffer.numberOfChannels);
        var sr = audioBuffer.sampleRate;
        var enc = new lamejs.Mp3Encoder(numCh, sr, kbps);
        var left = f32ToI16(audioBuffer.getChannelData(0));
        var right = numCh > 1 ? f32ToI16(audioBuffer.getChannelData(1)) : null;
        var blockSize = 1152;
        var data = [];
        var i = 0, total = left.length;

        function chunk() {
          var count = 0;
          while (i < total && count < 400) {
            var l = left.subarray(i, i + blockSize);
            var mp3buf = right
              ? enc.encodeBuffer(l, right.subarray(i, i + blockSize))
              : enc.encodeBuffer(l);
            if (mp3buf.length > 0) data.push(new Uint8Array(mp3buf));
            i += blockSize;
            count++;
          }
          if (onProg) onProg(total ? Math.min(1, i / total) : 1);
          if (i < total) {
            setTimeout(chunk, 0);
          } else {
            var end = enc.flush();
            if (end.length > 0) data.push(new Uint8Array(end));
            resolve(new Blob(data, { type: 'audio/mpeg' }));
          }
        }
        chunk();
      } catch (e) { reject(e); }
    });
  }

  /* ---------------- Upload ---------------- */

  function resetResult() {
    if (state.resultUrl) { URL.revokeObjectURL(state.resultUrl); state.resultUrl = null; }
    state.resultBlob = null;
    state.resultName = '';
    resultCard.hidden = true;
    stats.innerHTML = '';
    try { player.pause(); } catch (e) {}
    player.removeAttribute('src');
    downloadBtn.disabled = true;
  }

  function resetAll(clearFile) {
    state.busy = false;
    resetResult();
    if (clearFile) {
      state.file = null;
      state.info = null;
      input.value = '';
      fileInfo.innerHTML = '';
      summary.textContent = 'No audio loaded yet';
      emptyText.textContent = 'Upload audio, set your options, then click "Convert" to generate the result';
      empty.hidden = false;
    }
    convertBtn.disabled = !state.file;
    resetBtn.disabled = !state.file;
  }

  function loadFile(file) {
    var ext = FT.extName(file.name);
    var okType = (file.type && file.type.indexOf('audio/') === 0) ||
      ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'weba', 'wma', 'aiff', 'aif'].indexOf(ext) >= 0;
    if (!okType) { FT.toast('Please select an audio file (MP3 / WAV / OGG / M4A, etc.)', 'err'); return; }
    if (file.size > MAX_SIZE) { FT.toast('Audio exceeds 200MB, please compress or trim it and try again', 'err'); return; }

    resetAll(false);
    state.file = file;
    state.info = null;
    convertBtn.disabled = false;
    resetBtn.disabled = false;
    summary.textContent = 'Reading ' + file.name + ' …';
    fileInfo.innerHTML = '<span class="file-chip"><span class="fc-name">' + FT.esc(file.name) +
      '</span><span class="fc-size">' + FT.formatBytes(file.size) + '</span></span>';
    FT.busyProgress(progress, 'Decoding to read file info…');

    // Read duration / sample rate / channels with the native decoder (best effort)
    FT.readArrayBuffer(file).then(function (buf) {
      var parsed = parseWavSampleRate(buf);
      var eff = (parsed >= 8000 && parsed <= 96000) ? parsed : 0;
      return decodeAudioBuffer(buf, eff).catch(function () { return null; });
    }).then(function (audioBuffer) {
      FT.resetProgress(progress);
      if (audioBuffer) {
        state.info = {
          duration: audioBuffer.duration,
          sampleRate: audioBuffer.sampleRate,
          channels: audioBuffer.numberOfChannels
        };
        fileInfo.innerHTML = '<span class="file-chip"><span class="fc-name">' + FT.esc(file.name) +
          '</span><span class="fc-size">' + fmtDuration(audioBuffer.duration) + ' · ' +
          audioBuffer.sampleRate + ' Hz · ' + FT.formatBytes(file.size) + '</span></span>';
        summary.textContent = file.name + ' · ' + fmtDuration(audioBuffer.duration) + ' · ' + audioBuffer.sampleRate + ' Hz';
      } else {
        summary.textContent = file.name + ' · the browser cannot decode it natively';
        FT.alert(tips, 'warn', '<b>The browser cannot natively decode "' + FT.esc(file.name) + '"</b>' +
          '<p>This encoding (possibly AAC/FLAC/WMA, etc.) has no built-in decoder in your browser, so it <b>cannot be converted</b>. Convert it to WAV or MP3 elsewhere first, then upload again.</p>', true);
      }
      FT.toast('Audio is ready', 'ok');
    }).catch(function (err) {
      console.error(err);
      FT.resetProgress(progress);
      summary.textContent = file.name;
      FT.toast('Could not read file info: ' + (err && err.message || err), 'warn');
    });
  }

  /* ---------------- Main conversion flow ---------------- */

  function decodeForNative() {
    var targetRate = Number(nrate.value) || 0; // 0 = keep original
    return FT.readArrayBuffer(state.file).then(function (buf) {
      var parsed = parseWavSampleRate(buf);
      // Decode as close as possible to the final sample rate: use the target if specified,
      // otherwise use the real WAV sample rate
      var effective = (targetRate > 0)
        ? targetRate
        : ((parsed >= 8000 && parsed <= 96000) ? parsed : 0);
      return decodeAudioBuffer(buf, effective).then(function (ab) {
        return resample(ab, targetRate);
      });
    });
  }

  function runNative() {
    var fmt = nformat.value;                       // wav | mp3
    var targetRate = Number(nrate.value) || 0;     // 0 = keep
    var kbps = Number(nbitrate.value) || 192;

    if (fmt === 'mp3' && typeof lamejs === 'undefined') {
      FT.depMissing(tips, 'lamejs', 'MP3 export depends on lamejs (CDN). Please check your connection and reload the page.');
      finish(false);
      return;
    }

    FT.busyProgress(progress, 'Decoding audio…');
    decodeForNative().then(function (audioBuffer) {
      return resample(audioBuffer, targetRate);
    }).then(function (audioBuffer) {
      if (fmt === 'wav') {
        FT.busyProgress(progress, 'Building the WAV container…');
        return FT.nextFrame().then(function () {
          return { blob: encodeWav(audioBuffer), rate: audioBuffer.sampleRate, ch: audioBuffer.numberOfChannels, dur: audioBuffer.duration, ext: 'wav' };
        });
      }
      FT.setProgress(progress, 0, 'Encoding MP3…');
      return encodeMp3(audioBuffer, kbps, function (r) {
        FT.setProgress(progress, r, 'Encoding MP3 ' + Math.round(r * 100) + '%');
      }).then(function (blob) {
        return { blob: blob, rate: audioBuffer.sampleRate, ch: audioBuffer.numberOfChannels, dur: audioBuffer.duration, ext: 'mp3' };
      });
    }).then(function (res) {
      showResult(res.blob, res.ext, { rate: res.rate, ch: res.ch, dur: res.dur });
      finish(true);
    }).catch(function (err) {
      console.error(err);
      FT.alert(tips, 'err', '<b>Conversion failed</b><p>' + FT.esc(err && err.message || 'Unknown error') + '</p>', true);
      FT.toast('Conversion failed: ' + (err && err.message || err), 'err');
      finish(false);
    });
  }

  function finish(ok) {
    state.busy = false;
    FT.setBusy(convertBtn, false);
    convertBtn.disabled = !state.file;
    if (ok) {
      FT.setProgress(progress, 1, 'Done');
      setTimeout(function () { FT.resetProgress(progress); }, 1500);
    } else {
      FT.resetProgress(progress);
    }
  }

  function showResult(blob, ext, meta) {
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultBlob = blob;
    state.resultUrl = URL.createObjectURL(blob);
    state.resultName = FT.safeName(FT.baseName(state.file.name)) + '.' + ext;

    player.src = state.resultUrl;
    var origSize = state.file.size;
    var rows = '';
    rows += stat('Output format', ext.toUpperCase());
    if (meta && meta.dur) rows += stat('Duration', fmtDuration(meta.dur));
    if (meta && meta.rate) rows += stat('Sample rate', meta.rate + ' Hz');
    if (meta && meta.ch) rows += stat('Channels', meta.ch >= 2 ? 'Stereo' : 'Mono');
    rows += stat('Original size', FT.formatBytes(origSize));
    var cls = blob.size <= origSize ? 'down' : 'up';
    rows += stat('Output size', FT.formatBytes(blob.size) + ' (' + FT.pct(blob.size, origSize) + ')', cls);
    stats.innerHTML = rows;

    downloadBtn.disabled = false;
    empty.hidden = true;
    resultCard.hidden = false;
    summary.textContent = state.file.name + ' → ' + state.resultName;
    FT.toast('Conversion complete', 'ok');
  }

  /* ---------------- Events ---------------- */

  convertBtn.addEventListener('click', function () {
    if (!state.file || state.busy) return;
    state.busy = true;
    tips.innerHTML = '';
    showLimitTip();
    resetResult();
    FT.setBusy(convertBtn, true, 'Converting…');
    runNative();
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

  nformat.addEventListener('change', function () { nbitrateField.hidden = nformat.value !== 'mp3'; });
  FT.bindDropzone(drop, input, function (files) { if (files[0]) loadFile(files[0]); });
  resetAll(true);
})();
