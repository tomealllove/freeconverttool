/* Traditional & Simplified Chinese Converter: text/file upload → pick direction → OpenCC lexicon conversion → preview / copy / download / reverse */
(function () {
  'use strict';

  FT.mountShell('zh-convert');

  var MAX_TXT = 5 * 1024 * 1024;
  var CHUNK = 20000;

  var DIRS = {
    'cn-t': { label: 'Simplified → Traditional', from: 'cn', to: 't' },
    't-cn': { label: 'Traditional → Simplified', from: 't', to: 'cn' },
    'cn-tw': { label: 'Simplified → Taiwan standard', from: 'cn', to: 'tw' },
    'cn-hk': { label: 'Simplified → Hong Kong Traditional', from: 'cn', to: 'hk' },
    'twp-cn': { label: 'Traditional → Simplified (Taiwan wording)', from: 'twp', to: 'cn' },
    'hk-cn': { label: 'Traditional → Simplified (Hong Kong wording)', from: 'hk', to: 'cn' }
  };

  var src = FT.$('#src');
  var drop = FT.$('#drop');
  var fileInput = FT.$('#file');
  var fileInfo = FT.$('#fileInfo');
  var dirSel = FT.$('#dir');
  var convertBtn = FT.$('#convert');
  var clearBtn = FT.$('#clear');
  var progress = FT.$('#progress');
  var tips = FT.$('#tips');
  var empty = FT.$('#empty');
  var resultBox = FT.$('#result');
  var outEl = FT.$('#out');
  var summary = FT.$('#summary');
  var statIn = FT.$('#statIn');
  var statOut = FT.$('#statOut');
  var statTime = FT.$('#statTime');
  var statDir = FT.$('#statDir');
  var copyBtn = FT.$('#copy');
  var dlBtn = FT.$('#download');
  var revBtn = FT.$('#reverse');

  var lastOutput = '';
  var busy = false;
  var ready = typeof window.OpenCC !== 'undefined';

  function findDir(from, to) {
    var keys = Object.keys(DIRS);
    for (var i = 0; i < keys.length; i++) {
      if (DIRS[keys[i]].from === from && DIRS[keys[i]].to === to) return keys[i];
    }
    return '';
  }

  function makeConverter(from, to) {
    if (!ready) return null;
    try {
      return window.OpenCC.Converter({ from: from, to: to });
    } catch (e) {
      console.warn('OpenCC dictionary combination unavailable: ' + from + '→' + to, e);
      return null;
    }
  }

  // Split by lines so very long texts never block the main thread for too long
  function splitChunks(text) {
    if (text.length <= CHUNK) return [text];
    var lines = text.split('\n');
    var chunks = [];
    var buf = '';
    for (var i = 0; i < lines.length; i++) {
      buf += lines[i] + '\n';
      if (buf.length >= CHUNK) { chunks.push(buf); buf = ''; }
    }
    if (buf) chunks.push(buf);
    return chunks.length ? chunks : [text];
  }

  function run(overrideFrom, overrideTo) {
    if (busy) return;
    var text = src.value;
    if (!text.trim()) {
      FT.toast('Please enter or upload the text you want to convert', 'err');
      src.focus();
      return;
    }
    if (!ready) {
      FT.toast('Conversion component not loaded, please check your connection and reload', 'err');
      return;
    }

    var cfg = DIRS[dirSel.value] || DIRS['cn-t'];
    var from = overrideFrom || cfg.from;
    var to = overrideTo || cfg.to;
    var label = (DIRS[findDir(from, to)] || {}).label || (from + ' → ' + to);

    var converter = makeConverter(from, to);
    if (!converter) {
      FT.toast('Dictionary unavailable for this direction, please try another one', 'err');
      FT.alert(tips, 'err', '<b>Dictionary initialization failed</b><p>The lexicon for direction <b>' + FT.esc(label) +
        '</b> could not be loaded. Reload the page or use "Simplified → Traditional / Traditional → Simplified" instead.</p>');
      return;
    }

    busy = true;
    tips.innerHTML = '';
    FT.setBusy(convertBtn, true, 'Converting…');
    FT.busyProgress(progress, 'Loading dictionary…');

    FT.nextFrame().then(function () {
      return FT.nextFrame();
    }).then(function () {
      var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
      var chunks = splitChunks(text);
      var out = '';
      try {
        for (var i = 0; i < chunks.length; i++) {
          out += converter(chunks[i]);
          if (chunks.length > 1) {
            FT.setProgress(progress, (i + 1) / chunks.length, 'Converting ' + (i + 1) + '/' + chunks.length);
          }
        }
      } catch (err) {
        throw err;
      }
      var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
      return { out: out, ms: Math.max(1, Math.round(t1 - t0)) };
    }).then(function (res) {
      lastOutput = res.out;
      outEl.textContent = res.out;
      statIn.textContent = String(text.length);
      statOut.textContent = String(res.out.length);
      statTime.textContent = res.ms < 1000 ? res.ms + ' ms' : (res.ms / 1000).toFixed(2) + ' s';
      statDir.textContent = label;
      resultBox.hidden = false;
      empty.hidden = true;
      copyBtn.disabled = false;
      dlBtn.disabled = false;
      summary.textContent = 'Done · ' + label + ' · ' + res.out.length + ' characters out';
      FT.setProgress(progress, 1, 'Conversion complete');
      FT.toast('Conversion complete, ' + res.out.length + ' characters', 'ok');
      setTimeout(function () { FT.resetProgress(progress); }, 1500);
    }).catch(function (err) {
      console.error(err);
      FT.resetProgress(progress);
      FT.alert(tips, 'err', '<b>Conversion failed</b><p>' + FT.esc((err && err.message) || 'Lexicon execution error') + '</p>');
    }).then(function () {
      busy = false;
      FT.setBusy(convertBtn, false);
    });
  }

  function loadTxt(files) {
    var file = files && files[0];
    if (!file) return;
    var ext = FT.extName(file.name);
    if (ext !== 'txt' && file.type !== 'text/plain') {
      FT.toast('Please select a .txt text file', 'err');
      return;
    }
    if (file.size > MAX_TXT) {
      FT.toast('File is larger than 5MB, please split it first', 'err');
      return;
    }
    FT.busyProgress(progress, 'Reading file…');
    FT.readText(file).then(function (text) {
      src.value = text;
      fileInfo.innerHTML = '<span class="file-chip"><span class="fc-name">' + FT.esc(file.name) + '</span>' +
        '<span class="fc-size">' + FT.formatBytes(file.size) + '</span>' +
        '<button class="icon-btn" id="removeFile" aria-label="Remove">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button></span>';
      var rm = FT.$('#removeFile');
      if (rm) {
        rm.addEventListener('click', function (e) {
          e.stopPropagation();
          fileInfo.innerHTML = '';
        });
      }
      FT.resetProgress(progress);
      summary.textContent = 'Loaded ' + file.name + ' · ' + text.length + ' characters';
      FT.toast('Read ' + text.length + ' characters', 'ok');
    }).catch(function (err) {
      FT.resetProgress(progress);
      FT.toast('Failed to read: ' + ((err && err.message) || err), 'err');
    });
  }

  convertBtn.addEventListener('click', function () { run(); });

  clearBtn.addEventListener('click', function () {
    src.value = '';
    fileInfo.innerHTML = '';
    lastOutput = '';
    outEl.textContent = '';
    resultBox.hidden = true;
    copyBtn.disabled = true;
    dlBtn.disabled = true;
    empty.hidden = false;
    summary.textContent = 'Not converted yet';
    tips.innerHTML = '';
    FT.resetProgress(progress);
  });

  copyBtn.addEventListener('click', function () {
    if (!lastOutput) { FT.toast('Nothing to copy yet', 'err'); return; }
    FT.copyText(lastOutput);
  });

  dlBtn.addEventListener('click', function () {
    if (!lastOutput) { FT.toast('Nothing to download yet', 'err'); return; }
    var cfg = DIRS[dirSel.value] || DIRS['cn-t'];
    FT.saveText(lastOutput, FT.safeName('zh-convert-' + cfg.from + '-' + cfg.to) + '.txt');
  });

  revBtn.addEventListener('click', function () {
    if (!lastOutput) { FT.toast('Please run a conversion first', 'err'); return; }
    var cfg = DIRS[dirSel.value] || DIRS['cn-t'];
    var back = findDir(cfg.to, cfg.from);
    if (back) {
      dirSel.value = back;
    } else {
      FT.toast('Direction swapped manually (not in the preset list)', 'warn');
    }
    src.value = lastOutput;
    outEl.textContent = '';
    run(cfg.to, cfg.from);
  });

  src.addEventListener('input', function () {
    if (summary.textContent.indexOf('Done') === 0) summary.textContent = 'Input changed, you can convert again';
  });

  FT.bindDropzone(drop, fileInput, loadTxt);

  /* ---------- Dependency check ---------- */
  if (!ready) {
    FT.depMissing(tips, 'Simplified & Traditional conversion', 'This feature relies on the opencc-js dictionary component (about 1MB). Please check your connection and reload the page.');
    FT.alert(tips, 'info', '<b>Why not a simple character-by-character map?</b>' +
      '<p>A plain character table cannot handle one-to-many mappings: 「发」 in 「头发 / 发展」 and 「干」 in 「干部 / 干净」 ' +
      'correspond to different glyphs; Taiwan and Hong Kong also use their own vocabulary (「软件 / 软体」, 「信息 / 资讯」). ' +
      'This page therefore uses the <b>full OpenCC lexicon plus regional vocabulary</b> and converts by phrase context, ' +
      'which is far more accurate than per-character replacement.</p>', true);
    convertBtn.disabled = true;
    revBtn.disabled = true;
  } else {
    FT.alert(tips, 'info', '<b>About conversion accuracy</b>' +
      '<p>This page uses the complete OpenCC lexicon instead of a per-character map, so it handles cases such as ' +
      '「头发 / 发展」 and 「干 / 乾」 correctly, and covers the vocabulary differences used in Taiwan and Hong Kong. ' +
      'Very long texts are processed in chunks, everything runs locally in your browser and nothing is ever uploaded.</p>');
  }
})();
