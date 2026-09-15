/* PDF 合并拆分：合并模式（多文件排序拼接）/ 拆分模式（按页数或页码范围切分）· 基于 pdf-lib */
(function () {
  'use strict';

  FT.mountShell('pdf-merge');

  var MAX_PDF = 100 * 1024 * 1024;
  var ICON_UP = '<polyline points="18 15 12 9 6 15"/>';
  var ICON_DOWN = '<polyline points="6 9 12 15 18 9"/>';
  var ICON_X = '<path d="M6 6l12 12M18 6L6 18"/>';

  var drop = FT.$('#drop');
  var input = FT.$('#file');
  var chips = FT.$('#chips');
  var modeSel = FT.$('#mode');
  var dzTitle = FT.$('#dzTitle');
  var dzSub = FT.$('#dzSub');
  var mergeOpts = FT.$('#mergeOpts');
  var splitOpts = FT.$('#splitOpts');
  var splitBy = FT.$('#splitBy');
  var everyField = FT.$('#everyField');
  var everyN = FT.$('#everyN');
  var rangesField = FT.$('#rangesField');
  var ranges = FT.$('#ranges');
  var splitHelp = FT.$('#splitHelp');
  var runBtn = FT.$('#run');
  var clearBtn = FT.$('#clear');
  var progress = FT.$('#progress');
  var tips = FT.$('#tips');
  var resultTitle = FT.$('#resultTitle');
  var summary = FT.$('#summary');
  var empty = FT.$('#empty');
  var emptyText = FT.$('#emptyText');
  var list = FT.$('#list');
  var outCard = FT.$('#outCard');
  var outTitle = FT.$('#outTitle');
  var outStats = FT.$('#outStats');
  var splitList = FT.$('#splitList');
  var outActions = FT.$('#outActions');

  var state = { mode: 'merge', files: [], busy: false };
  var outBlob = null;
  var parts = [];

  function stat(k, v, cls) {
    return '<div class="stat"><div class="k">' + k + '</div>' +
      '<div class="v' + (cls ? ' ' + cls : '') + '">' + v + '</div></div>';
  }

  function pad3(n) { return String(n).padStart(3, '0'); }

  if (typeof PDFLib === 'undefined') {
    FT.depMissing(tips, 'pdf-lib', '本页依赖 pdf-lib 读写 PDF，请检查网络后刷新页面重试。');
  }

  /* ---------------- 读取 ---------------- */

  function checkFile(file) {
    if (FT.extName(file.name) !== 'pdf' && file.type !== 'application/pdf') {
      FT.toast('「' + file.name + '」不是 PDF 格式', 'err');
      return false;
    }
    if (file.size > MAX_PDF) {
      FT.toast('「' + file.name + '」超过 100MB，请先压缩后再试', 'err');
      return false;
    }
    if (typeof PDFLib === 'undefined') {
      FT.depMissing(tips, 'pdf-lib', '本页依赖 pdf-lib 读写 PDF，请检查网络后刷新页面重试。');
      return false;
    }
    return true;
  }

  function loadOne(file) {
    return FT.readArrayBuffer(file)
      .then(function (buf) { return PDFLib.PDFDocument.load(new Uint8Array(buf)); })
      .then(function (doc) {
        return { file: file, name: file.name, size: file.size, pages: doc.getPageCount(), doc: doc };
      });
  }

  function addFiles(files) {
    if (state.busy) return;
    if (state.mode === 'split') {
      var one = files[0];
      if (!one || !checkFile(one)) return;
      FT.busyProgress(progress, '正在读取 PDF…');
      loadOne(one).then(function (rec) {
        releaseAll();
        state.files = [rec];
        renderAll();
        FT.resetProgress(progress);
        FT.toast('已加载 ' + rec.name + '，共 ' + rec.pages + ' 页', 'ok');
      }).catch(function (err) {
        console.error(err);
        FT.resetProgress(progress);
        FT.alert(tips, 'err', '<b>无法解析该 PDF</b><p>' +
          FT.esc((err && err.message) || '文件可能已损坏、加密或不是标准 PDF') + '</p>');
      });
      return;
    }

    var todo = files.filter(checkFile);
    if (!todo.length) return;
    var i = 0, added = 0;
    FT.setProgress(progress, 0, '读取中…');
    (function step() {
      if (i >= todo.length) {
        FT.resetProgress(progress);
        renderAll();
        FT.toast(added ? '已添加 ' + added + ' 个 PDF' : '没有可添加的文件', added ? 'ok' : 'err');
        return;
      }
      FT.setProgress(progress, i / todo.length, '正在读取 ' + (i + 1) + '/' + todo.length);
      var file = todo[i++];
      loadOne(file).then(function (rec) {
        state.files.push(rec);
        added++;
      }).catch(function (err) {
        console.error(err);
        FT.toast('「' + file.name + '」读取失败：' + ((err && err.message) || '无法解析'), 'err');
      }).then(step);
    })();
  }

  function releaseAll() {
    state.files = [];
  }

  /* ---------------- 渲染 ---------------- */

  function cardHTML(rec, idx, last, isMerge) {
    var meta = rec.pages + ' 页 · ' + FT.formatBytes(rec.size);
    var head = isMerge
      ? '<div class="item-head">' +
          '<span class="page-num">' + (idx + 1) + '</span>' +
          '<span class="item-name" title="' + FT.esc(rec.name) + '">' + FT.esc(rec.name) + '</span>' +
          '<button class="icon-btn" data-act="up" title="上移" aria-label="上移"' + (idx === 0 ? ' disabled' : '') + '>' + FT.svg(ICON_UP, 15) + '</button>' +
          '<button class="icon-btn" data-act="down" title="下移" aria-label="下移"' + (idx === last ? ' disabled' : '') + '>' + FT.svg(ICON_DOWN, 15) + '</button>' +
          '<button class="icon-btn" data-act="remove" title="移除" aria-label="移除">' + FT.svg(ICON_X, 15) + '</button>' +
        '</div>'
      : '<div class="item-head">' +
          '<span class="item-name" title="' + FT.esc(rec.name) + '">' + FT.esc(rec.name) + '</span>' +
          '<button class="icon-btn" data-act="remove" title="移除" aria-label="移除">' + FT.svg(ICON_X, 15) + '</button>' +
        '</div>';
    return head + '<div class="page-meta">' + meta + '</div>';
  }

  function renderAll() {
    var isMerge = state.mode === 'merge';
    var last = state.files.length - 1;
    empty.hidden = state.files.length > 0;
    chips.innerHTML = state.files.map(function (it, i) {
      return '<span class="file-chip"><span class="fc-name">' + FT.esc(it.name) + '</span>' +
        '<span class="fc-size">' + it.pages + ' 页 · ' + FT.formatBytes(it.size) + '</span>' +
        '<button class="icon-btn" data-chip="' + i + '" aria-label="移除">' + FT.svg(ICON_X, 15) + '</button></span>';
    }).join('');

    list.innerHTML = '';
    state.files.forEach(function (rec, idx) {
      var el = FT.el('<article class="item">' + cardHTML(rec, idx, last, isMerge) + '</article>');
      list.appendChild(el);
      var up = el.querySelector('[data-act="up"]');
      var down = el.querySelector('[data-act="down"]');
      if (up) up.addEventListener('click', function () { move(idx, idx - 1); });
      if (down) down.addEventListener('click', function () { move(idx, idx + 1); });
      el.querySelector('[data-act="remove"]').addEventListener('click', function () { removeAt(idx); });
    });
    updateBar();
  }

  function updateBar() {
    var has = state.files.length > 0;
    var isMerge = state.mode === 'merge';
    clearBtn.disabled = !has;
    runBtn.disabled = !has || state.busy;
    runBtn.textContent = isMerge ? '开始合并' : '开始拆分';

    var totalPages = state.files.reduce(function (s, r) { return s + r.pages; }, 0);
    var totalSize = state.files.reduce(function (s, r) { return s + r.size; }, 0);
    summary.textContent = !has ? '还没有添加 PDF'
      : (isMerge
        ? '共 ' + state.files.length + ' 个文件 · ' + totalPages + ' 页 · 合计 ' + FT.formatBytes(totalSize)
        : state.files[0].name + ' · 共 ' + totalPages + ' 页 · ' + FT.formatBytes(totalSize));

    if (has) {
      empty.hidden = true;
    } else {
      empty.hidden = false;
      emptyText.textContent = isMerge
        ? '添加 2 个以上 PDF 后，可在这里调整顺序并合并'
        : '上传 1 个 PDF 后，可按规则拆分成多个文件';
    }
  }

  function move(from, to) {
    if (from < 0 || to < 0 || from >= state.files.length || to >= state.files.length || from === to) return;
    var it = state.files[from];
    state.files.splice(from, 1);
    state.files.splice(to, 0, it);
    renderAll();
  }

  function removeAt(idx) {
    var rec = state.files[idx];
    if (!rec) return;
    state.files.splice(idx, 1);
    renderAll();
  }

  /* ---------------- 合并 ---------------- */

  function doMerge() {
    if (state.files.length < 2) { FT.toast('合并模式至少需要 2 个 PDF', 'err'); return; }
    if (typeof PDFLib === 'undefined') {
      FT.depMissing(tips, 'pdf-lib', '本页依赖 pdf-lib 读写 PDF，请检查网络后刷新页面重试。');
      return;
    }
    var out = null, i = 0, failed = [];
    state.busy = true;
    runBtn.disabled = true;
    clearBtn.disabled = true;
    tips.innerHTML = '';
    outCard.hidden = true;
    outBlob = null;
    parts = [];
    splitList.innerHTML = '';

    function step() {
      if (i >= state.files.length) return Promise.resolve();
      var rec = state.files[i];
      FT.setProgress(progress, i / state.files.length, '正在处理 ' + (i + 1) + '/' + state.files.length);
      return FT.nextFrame().then(function () {
        return out.copyPages(rec.doc, rec.doc.getPageIndices());
      }).then(function (copied) {
        copied.forEach(function (p) { out.addPage(p); });
        i++;
        return step();
      }).catch(function (err) {
        console.error(err);
        failed.push(rec.name);
        i++;
        return step();
      });
    }

    FT.setBusy(runBtn, true, '合并中…');
    FT.setProgress(progress, 0, '准备中…');
    PDFLib.PDFDocument.create()
      .then(function (d) { out = d; return step(); })
      .then(function () {
        FT.setProgress(progress, 0.9, '正在写入 PDF…');
        return out.save();
      })
      .then(function (bytes) {
        outBlob = new Blob([bytes], { type: 'application/pdf' });
        var totalPages = state.files.reduce(function (s, r) { return s + r.pages; }, 0);
        var totalSize = state.files.reduce(function (s, r) { return s + r.size; }, 0);
        outTitle.textContent = '合并结果';
        outStats.innerHTML =
          stat('合并文件', state.files.length + ' 个') +
          stat('总页数', String(totalPages)) +
          stat('输出体积', FT.formatBytes(outBlob.size)) +
          stat('原文件合计', FT.formatBytes(totalSize));
        outActions.innerHTML = '<button class="btn btn-primary" id="dlMerged">下载合并后的 PDF</button>';
        FT.$('#dlMerged').addEventListener('click', function () {
          if (!outBlob) return;
          FT.saveBlob(outBlob, FT.safeName(FT.baseName(state.files[0].name)) + '-merged.pdf');
        });
        outCard.hidden = false;
        FT.setProgress(progress, 1, '完成');
        FT.toast('合并完成，共 ' + totalPages + ' 页' + (failed.length ? '，' + failed.length + ' 个文件失败' : ''),
          failed.length ? 'warn' : 'ok');
        setTimeout(function () { FT.resetProgress(progress); }, 1800);
      })
      .catch(function (err) {
        console.error(err);
        FT.resetProgress(progress);
        FT.alert(tips, 'err', '<b>合并失败</b><p>' +
          FT.esc((err && err.message) || '未知错误') + '</p>');
        FT.toast('合并失败', 'err');
      })
      .then(function () {
        state.busy = false;
        FT.setBusy(runBtn, false);
        updateBar();
      });
  }

  /* ---------------- 拆分 ---------------- */

  function buildSplitRanges(total) {
    var out = [];
    if (splitBy.value === 'every') {
      var n = parseInt(everyN.value, 10);
      if (!(n >= 1)) {
        FT.toast('每段页数需为不小于 1 的整数', 'err');
        return null;
      }
      for (var s = 1; s <= total; s += n) out.push({ start: s, end: Math.min(s + n - 1, total) });
      return out;
    }
    var txt = (ranges.value || '').trim();
    if (!txt) {
      FT.toast('请填写页码范围，示例：1-3,4-8,9-12', 'err');
      return null;
    }
    var segs = txt.split(/[,，\s]+/).filter(Boolean);
    for (var i = 0; i < segs.length; i++) {
      var m = segs[i].match(/^(\d+)(?:-(\d+))?$/);
      if (!m) {
        FT.toast('页码范围格式不正确：' + segs[i], 'err');
        return null;
      }
      var a = parseInt(m[1], 10);
      var b = m[2] ? parseInt(m[2], 10) : a;
      if (a < 1 || b < a || b > total) {
        FT.toast('页码超出范围（共 ' + total + ' 页）：' + segs[i], 'err');
        return null;
      }
      out.push({ start: a, end: b });
    }
    return out;
  }

  function doSplit() {
    var rec = state.files[0];
    if (!rec) { FT.toast('请先上传一个 PDF', 'err'); return; }
    if (typeof PDFLib === 'undefined') {
      FT.depMissing(tips, 'pdf-lib', '本页依赖 pdf-lib 读写 PDF，请检查网络后刷新页面重试。');
      return;
    }
    var segs = buildSplitRanges(rec.pages);
    if (!segs || !segs.length) return;

    state.busy = true;
    runBtn.disabled = true;
    clearBtn.disabled = true;
    tips.innerHTML = '';
    outCard.hidden = true;
    outBlob = null;
    parts = [];
    splitList.innerHTML = '';
    outStats.innerHTML = '';
    outActions.innerHTML = '';

    var base = FT.safeName(FT.baseName(rec.name));
    var i = 0, failed = 0;

    function step() {
      if (i >= segs.length) return Promise.resolve();
      var seg = segs[i];
      FT.setProgress(progress, i / segs.length, '正在处理 ' + (i + 1) + '/' + segs.length);
      var indices = [];
      for (var p = seg.start; p <= seg.end; p++) indices.push(p - 1);
      var partDoc = null;
      return FT.nextFrame()
        .then(function () { return PDFLib.PDFDocument.create(); })
        .then(function (d) {
          partDoc = d;
          return d.copyPages(rec.doc, indices);
        })
        .then(function (copied) {
          copied.forEach(function (p) { partDoc.addPage(p); });
          return partDoc.save();
        })
        .then(function (bytes) {
          var blob = new Blob([bytes], { type: 'application/pdf' });
          parts.push({
            name: base + '-p' + pad3(seg.start) + '-' + pad3(seg.end) + '.pdf',
            range: '第 ' + seg.start + '-' + seg.end + ' 页',
            blob: blob
          });
          i++;
          return step();
        })
        .catch(function (err) {
          console.error(err);
          failed++;
          i++;
          return step();
        });
    }

    FT.setBusy(runBtn, true, '拆分中…');
    FT.setProgress(progress, 0, '准备中…');
    step().then(function () {
      renderSplit(rec, failed);
      FT.setProgress(progress, 1, '完成');
      FT.toast('拆分完成，共 ' + parts.length + ' 个文件' + (failed ? '，' + failed + ' 段失败' : ''),
        failed ? 'warn' : 'ok');
      setTimeout(function () { FT.resetProgress(progress); }, 1800);
    }).catch(function (err) {
      console.error(err);
      FT.resetProgress(progress);
      FT.alert(tips, 'err', '<b>拆分失败</b><p>' + FT.esc((err && err.message) || '未知错误') + '</p>');
      FT.toast('拆分失败', 'err');
    }).then(function () {
      state.busy = false;
      FT.setBusy(runBtn, false);
      updateBar();
    });
  }

  function renderSplit(rec, failed) {
    if (!parts.length) {
      FT.alert(tips, 'err', '<b>没有生成任何文件</b><p>请检查拆分规则后重试。</p>');
      return;
    }
    outTitle.textContent = '拆分结果';
    var totalOut = parts.reduce(function (s, p) { return s + p.blob.size; }, 0);
    outStats.innerHTML =
      stat('原文件', rec.pages + ' 页') +
      stat('拆分段数', parts.length + ' 段') +
      stat('输出合计', FT.formatBytes(totalOut)) +
      stat('失败段数', String(failed || 0));

    splitList.innerHTML = '';
    parts.forEach(function (p) {
      var el = FT.el(
        '<article class="item">' +
          '<div class="item-head"><span class="item-name" title="' + FT.esc(p.name) + '">' + FT.esc(p.name) + '</span>' +
          '<span class="badge acc">' + p.range + '</span></div>' +
          '<div class="page-meta">' + FT.formatBytes(p.blob.size) + '</div>' +
          '<div class="item-actions"><button class="btn btn-sm" data-act="dl">下载</button></div>' +
        '</article>'
      );
      el.querySelector('[data-act="dl"]').addEventListener('click', function () {
        FT.saveBlob(p.blob, p.name);
      });
      splitList.appendChild(el);
    });

    outActions.innerHTML = '<button class="btn btn-primary" id="dlZip">打包下载 (' + parts.length + ')</button>';
    FT.$('#dlZip').addEventListener('click', function () {
      if (!parts.length) return;
      if (parts.length === 1) { FT.saveBlob(parts[0].blob, parts[0].name); return; }
      var btn = FT.$('#dlZip');
      FT.setBusy(btn, true, '打包中…');
      FT.setProgress(progress, 0.3, '正在打包…');
      FT.makeZip(parts.map(function (p) { return { name: p.name, blob: p.blob }; }))
        .then(function (zip) {
          FT.saveBlob(zip, FT.safeName(FT.baseName(rec.name)) + '-split-' + parts.length + '.zip');
          FT.setProgress(progress, 1, '打包完成');
          FT.toast('已打包 ' + parts.length + ' 个文件', 'ok');
        })
        .catch(function (err) { FT.toast('打包失败：' + ((err && err.message) || err), 'err'); })
        .then(function () {
          FT.setBusy(btn, false);
          setTimeout(function () { FT.resetProgress(progress); }, 1500);
        });
    });
    outCard.hidden = false;
  }

  /* ---------------- 事件 ---------------- */

  function switchMode() {
    state.mode = modeSel.value;
    releaseAll();
    parts = [];
    outBlob = null;
    outCard.hidden = true;
    outStats.innerHTML = '';
    splitList.innerHTML = '';
    outActions.innerHTML = '';
    splitOpts.hidden = state.mode !== 'split';
    mergeOpts.hidden = state.mode !== 'merge';
    dzTitle.textContent = state.mode === 'merge'
      ? '点击选择多个 PDF，或拖拽文件到此处'
      : '点击选择 1 个 PDF，或拖拽文件到此处';
    dzSub.textContent = state.mode === 'merge'
      ? '每个 PDF 不超过 100MB，可一次选择多个或分次添加'
      : '单个 PDF 不超过 100MB，重复上传会替换当前文件';
    resultTitle.textContent = state.mode === 'merge' ? '待合并文件' : '待拆分文件';
    tips.innerHTML = '';
    input.value = '';
    FT.resetProgress(progress);
    renderAll();
  }

  runBtn.addEventListener('click', function () {
    if (state.busy) return;
    if (state.mode === 'merge') doMerge();
    else doSplit();
  });

  clearBtn.addEventListener('click', function () {
    if (state.busy) return;
    releaseAll();
    parts = [];
    outBlob = null;
    outCard.hidden = true;
    outStats.innerHTML = '';
    splitList.innerHTML = '';
    outActions.innerHTML = '';
    input.value = '';
    tips.innerHTML = '';
    FT.resetProgress(progress);
    renderAll();
  });

  splitBy.addEventListener('change', function () {
    var every = splitBy.value === 'every';
    everyField.hidden = !every;
    rangesField.hidden = every;
    splitHelp.textContent = every
      ? '按固定页数依次切分，最后一段可能不足设定页数。'
      : '每段范围生成一个文件，示例：1-3,4-8,9-12';
  });

  chips.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-chip]');
    if (!btn) return;
    removeAt(Number(btn.getAttribute('data-chip')));
  });

  modeSel.addEventListener('change', switchMode);

  FT.bindDropzone(drop, input, addFiles, { multiple: true });
  switchMode();
})();
