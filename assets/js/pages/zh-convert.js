/* 繁简汉字转换：文本/文件上传 → 选方向 → OpenCC 词库转换 → 预览 / 复制 / 下载 / 反向转换 */
(function () {
  'use strict';

  FT.mountShell('zh-convert');

  var MAX_TXT = 5 * 1024 * 1024;
  var CHUNK = 20000;

  var DIRS = {
    'cn-t': { label: '简体 → 繁体', from: 'cn', to: 't' },
    't-cn': { label: '繁体 → 简体', from: 't', to: 'cn' },
    'cn-tw': { label: '简体 → 台湾正体', from: 'cn', to: 'tw' },
    'cn-hk': { label: '简体 → 香港繁体', from: 'cn', to: 'hk' },
    'twp-cn': { label: '繁体 → 简体（台湾用词）', from: 'twp', to: 'cn' },
    'hk-cn': { label: '繁体 → 简体（香港用词）', from: 'hk', to: 'cn' }
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
      console.warn('OpenCC 词典组合不可用：' + from + '→' + to, e);
      return null;
    }
  }

  // 按行切块，避免超长文本长时间占用主线程
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
      FT.toast('请先输入或上传需要转换的文本', 'err');
      src.focus();
      return;
    }
    if (!ready) {
      FT.toast('繁简转换组件未加载，请联网后刷新页面', 'err');
      return;
    }

    var cfg = DIRS[dirSel.value] || DIRS['cn-t'];
    var from = overrideFrom || cfg.from;
    var to = overrideTo || cfg.to;
    var label = (DIRS[findDir(from, to)] || {}).label || (from + ' → ' + to);

    var converter = makeConverter(from, to);
    if (!converter) {
      FT.toast('该转换方向的词典不可用，请换一个方向试试', 'err');
      FT.alert(tips, 'err', '<b>词典初始化失败</b><p>方向 <b>' + FT.esc(label) +
        '</b> 的词库未能载入，请刷新页面或改用「简体 → 繁体 / 繁体 → 简体」。</p>');
      return;
    }

    busy = true;
    tips.innerHTML = '';
    FT.setBusy(convertBtn, true, '转换中…');
    FT.busyProgress(progress, '正在加载词库…');

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
            FT.setProgress(progress, (i + 1) / chunks.length, '转换中 ' + (i + 1) + '/' + chunks.length);
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
      summary.textContent = '已完成 · ' + label + ' · 输出 ' + res.out.length + ' 字符';
      FT.setProgress(progress, 1, '转换完成');
      FT.toast('转换完成，共 ' + res.out.length + ' 字符', 'ok');
      setTimeout(function () { FT.resetProgress(progress); }, 1500);
    }).catch(function (err) {
      console.error(err);
      FT.resetProgress(progress);
      FT.alert(tips, 'err', '<b>转换失败</b><p>' + FT.esc((err && err.message) || '词库执行异常') + '</p>');
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
      FT.toast('请选择 .txt 文本文件', 'err');
      return;
    }
    if (file.size > MAX_TXT) {
      FT.toast('文件超过 5MB，请拆分后再试', 'err');
      return;
    }
    FT.busyProgress(progress, '正在读取文件…');
    FT.readText(file).then(function (text) {
      src.value = text;
      fileInfo.innerHTML = '<span class="file-chip"><span class="fc-name">' + FT.esc(file.name) + '</span>' +
        '<span class="fc-size">' + FT.formatBytes(file.size) + '</span>' +
        '<button class="icon-btn" id="removeFile" aria-label="移除">' +
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
      summary.textContent = '已载入 ' + file.name + ' · ' + text.length + ' 字符';
      FT.toast('已读取 ' + text.length + ' 字符', 'ok');
    }).catch(function (err) {
      FT.resetProgress(progress);
      FT.toast('读取失败：' + ((err && err.message) || err), 'err');
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
    summary.textContent = '尚未开始转换';
    tips.innerHTML = '';
    FT.resetProgress(progress);
  });

  copyBtn.addEventListener('click', function () {
    if (!lastOutput) { FT.toast('还没有可复制的结果', 'err'); return; }
    FT.copyText(lastOutput);
  });

  dlBtn.addEventListener('click', function () {
    if (!lastOutput) { FT.toast('还没有可下载的结果', 'err'); return; }
    var cfg = DIRS[dirSel.value] || DIRS['cn-t'];
    FT.saveText(lastOutput, FT.safeName('zh-convert-' + cfg.from + '-' + cfg.to) + '.txt');
  });

  revBtn.addEventListener('click', function () {
    if (!lastOutput) { FT.toast('请先执行一次转换', 'err'); return; }
    var cfg = DIRS[dirSel.value] || DIRS['cn-t'];
    var back = findDir(cfg.to, cfg.from);
    if (back) {
      dirSel.value = back;
    } else {
      FT.toast('已手动交换方向（该组合不在预设列表中）', 'warn');
    }
    src.value = lastOutput;
    outEl.textContent = '';
    run(cfg.to, cfg.from);
  });

  src.addEventListener('input', function () {
    if (summary.textContent.indexOf('已完成') === 0) summary.textContent = '输入已修改，可再次转换';
  });

  FT.bindDropzone(drop, fileInput, loadTxt);

  /* ---------- 依赖检测 ---------- */
  if (!ready) {
    FT.depMissing(tips, '繁简转换', '该能力依赖 opencc-js 词典组件（约 1MB），请检查网络后刷新页面。');
    FT.alert(tips, 'info', '<b>为什么不是简单的单字映射？</b>' +
      '<p>单纯的字表替换无法处理一词多义，例如「头发 / 发展」中的「发」、「干部 / 干净」中的「干」，' +
      '在简繁对应关系里分别对应不同的字形；台湾与香港还各有惯用词（如「软件 / 软体」、「信息 / 资讯」）。' +
      '因此本页使用 <b>OpenCC 完整词库 + 地区惯用词</b> 方案，按词组上下文做转换，准确度远高于单字映射。</p>', true);
    convertBtn.disabled = true;
    revBtn.disabled = true;
  } else {
    FT.alert(tips, 'info', '<b>关于转换准确度</b>' +
      '<p>本页使用 OpenCC 完整词库方案，而非单字映射：可以正确处理「头发 / 发展」「干 / 乾」这类一词多义，' +
      '并支持台湾、香港的惯用词差异。超长文本会分块处理，全部在本地浏览器完成，不会上传任何内容。</p>');
  }
})();
