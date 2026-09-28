/* PDF 转 Word：上传 → 页码范围 → pdf.js 提取文本 → 按坐标重建行/段落 → 手写 OOXML 打包 .docx */
(function () {
  'use strict';

  FT.mountShell('pdf-to-word');

  var MAX_PDF = 100 * 1024 * 1024;
  var DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  // 行尾常见的收束标点，出现时可视作一句 / 一段的结束
  var TERMINAL = /[。！？；…!?;:：）)】」』”"']$/;

  var drop = FT.$('#drop');
  var input = FT.$('#file');
  var fileInfo = FT.$('#fileInfo');
  var rangeInput = FT.$('#range');
  var paraSplit = FT.$('#paraSplit');
  var convertBtn = FT.$('#convert');
  var resetBtn = FT.$('#reset');
  var progress = FT.$('#progress');
  var tips = FT.$('#tips');
  var summary = FT.$('#summary');
  var empty = FT.$('#empty');
  var emptyText = FT.$('#emptyText');
  var resultCard = FT.$('#resultCard');
  var stats = FT.$('#stats');
  var preview = FT.$('#preview');
  var downloadDocx = FT.$('#downloadDocx');
  var downloadTxt = FT.$('#downloadTxt');
  var copyBtn = FT.$('#copyText');

  var state = {
    file: null, doc: null, total: 0,
    paras: [], docx: null, base: '',
    busy: false, cancel: false
  };

  var LIMIT_HTML = '<b>转换效果说明（纯前端的已知边界）</b>' +
    '<p>本页基于 PDF 的<b>文本层</b>重建排版：原生文本型 PDF 效果较好；' +
    '多栏、表格、图文混排的还原度有限，页眉页脚、脚注、图片、公式不会保留。</p>' +
    '<p><b>扫描件（无文本层）不含可提取文字</b>，会转换出空白内容；前端 OCR 成本过高，本页不提供，' +
    '请先使用带文本层的 PDF，或用专业 OCR 工具处理后再上传。</p>';

  function showLimitTip() {
    FT.alert(tips, 'warn', LIMIT_HTML);
  }
  showLimitTip();

  if (!FT.pdfjsReady()) {
    FT.depMissing(tips, 'pdf.js', '本页依赖 pdf.js 解析 PDF 文本层，请检查网络后刷新页面重试。');
  }

  /* ---------------- 工具 ---------------- */

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

  // 去掉 XML 1.0 不允许的控制字符
  function cleanText(s) {
    return String(s == null ? '' : s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  function stat(k, v, cls) {
    return '<div class="stat"><div class="k">' + k + '</div>' +
      '<div class="v' + (cls ? ' ' + cls : '') + '">' + v + '</div></div>';
  }

  /* ---------------- 排版重建 ---------------- */

  // 把一页的 textContent 按 y 坐标（容差 ±3）聚成行，行内按 x 排序拼接
  function buildRows(textContent) {
    var items = [];
    (textContent.items || []).forEach(function (it) {
      if (!it.str) return;
      items.push({
        x: it.transform[4],
        y: it.transform[5],
        w: typeof it.width === 'number' ? it.width : 0,
        h: Math.abs(it.height) || Math.abs(it.transform[3]) || 10,
        s: it.str
      });
    });
    if (!items.length) return [];

    items.sort(function (a, b) { return (b.y - a.y) || (a.x - b.x); });

    var rows = [];
    items.forEach(function (it) {
      var row = rows.length ? rows[rows.length - 1] : null;
      if (row && Math.abs(row.y - it.y) <= 3) { row.items.push(it); return; }
      rows.push({ y: it.y, items: [it] });
    });

    var out = [];
    rows.forEach(function (row) {
      row.items.sort(function (a, b) { return a.x - b.x; });
      var text = '', prevEnd = null, h = 0;
      row.items.forEach(function (it) {
        // 同一行内间隔过大时补一个空格，避免英文单词粘连
        if (prevEnd !== null && it.x - prevEnd > Math.max(1.2, it.h * 0.28)) text += ' ';
        text += it.s;
        prevEnd = it.x + it.w;
        if (it.h > h) h = it.h;
      });
      text = text.replace(/\s+$/, '');
      if (text) out.push({ text: text, y: row.y, h: h || 10 });
    });
    return out;
  }

  // 行 → 段落：y 间距明显大于行高（>1.6×）视为分段；开启分段时再做细粒度切分
  function rowsToParagraphs(rows, doSplit) {
    var paras = [], buf = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var prev = i ? rows[i - 1] : null;
      if (prev) {
        var lh = Math.max(1, row.h || prev.h);
        var gap = prev.y - row.y;
        var brk = gap > lh * 1.6;
        if (!brk && doSplit) {
          if (gap > lh * 1.15 && TERMINAL.test(prev.text)) brk = true;   // 行尾有收束标点且间距偏大
          else if (gap > lh * 2.0 && !TERMINAL.test(prev.text)) brk = true; // 行尾无标点但间距很大
        }
        if (brk) {
          if (buf.length) paras.push(buf.join(''));
          buf = [];
        }
      }
      buf.push(row.text);
    }
    if (buf.length) paras.push(buf.join(''));
    return paras;
  }

  /* ---------------- 最小 OOXML / DOCX ---------------- */

  function decl() { return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'; }

  function buildDocx(paragraphs) {
    var body = paragraphs.map(function (p) {
      return '<w:p><w:r><w:t xml:space="preserve">' + FT.esc(cleanText(p)) + '</w:t></w:r></w:p>';
    }).join('');
    if (!body) body = '<w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>';

    var documentXml = decl() +
      '<w:document xmlns:w="' + W_NS + '"><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>' +
      '</w:body></w:document>';

    var contentTypes = decl() +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>';

    var rels = decl() +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
      'Target="word/document.xml"/>' +
      '</Relationships>';

    return FT.makeZipText([
      { name: '[Content_Types].xml', text: contentTypes },
      { name: '_rels/.rels', text: rels },
      { name: 'word/document.xml', text: documentXml }
    ]).then(function (blob) {
      return new Blob([blob], { type: DOCX_MIME });
    });
  }

  /* ---------------- 上传 ---------------- */

  function resetAll(clearFile) {
    state.cancel = true;
    state.busy = false;
    state.paras = [];
    state.docx = null;
    if (state.doc) { try { state.doc.destroy(); } catch (e) { /* 忽略 */ } }
    state.doc = null;
    if (clearFile) {
      state.file = null;
      state.total = 0;
      input.value = '';
      fileInfo.innerHTML = '';
      summary.textContent = '还没有加载 PDF';
      emptyText.textContent = '上传 PDF 后点击「开始转换」，这里会显示提取到的文本';
      empty.hidden = false;
    }
    resultCard.hidden = true;
    stats.innerHTML = '';
    preview.textContent = '';
    downloadDocx.disabled = true;
    downloadTxt.disabled = true;
    copyBtn.disabled = true;
    convertBtn.disabled = !state.doc;
    resetBtn.disabled = !state.file;
  }

  function loadPdf(file) {
    if (FT.extName(file.name) !== 'pdf' && file.type !== 'application/pdf') {
      FT.toast('请选择 PDF 格式的文件', 'err');
      return;
    }
    if (file.size > MAX_PDF) {
      FT.toast('PDF 超过 100MB，请先压缩后再试', 'err');
      return;
    }
    if (!FT.pdfjsReady()) {
      FT.toast('PDF 组件未加载，请联网后刷新页面', 'err');
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
        convertBtn.disabled = false;
        resetBtn.disabled = false;
        summary.textContent = file.name + ' · 共 ' + doc.numPages + ' 页';
        emptyText.textContent = '已就绪，共 ' + doc.numPages + ' 页，点击「开始转换」提取文本';
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
          FT.esc((err && err.message) || '文件可能已损坏、加密或不是标准 PDF') + '</p>');
      });
  }

  /* ---------------- 转换 ---------------- */

  function run() {
    if (!state.doc || state.busy) return;
    var pages = parseRange(rangeInput.value, state.total);
    if (!pages) {
      FT.toast('页码范围格式不正确，示例：1-5,8（最大 ' + state.total + ' 页）', 'err');
      return;
    }
    if (!FT.pdfjsReady()) {
      FT.depMissing(tips, 'pdf.js', '本页依赖 pdf.js 解析 PDF 文本层，请检查网络后刷新页面重试。');
      return;
    }
    if (pages.length > 80 &&
      !confirm('本次将提取 ' + pages.length + ' 页，页数较多可能耗时较长，是否继续？')) return;

    state.busy = true;
    state.cancel = false;
    state.paras = [];
    state.docx = null;
    resultCard.hidden = true;
    downloadDocx.disabled = true;
    downloadTxt.disabled = true;
    copyBtn.disabled = true;
    empty.hidden = true;
    showLimitTip();

    var paras = [], blankPages = [], failed = [], i = 0;
    FT.setBusy(convertBtn, true, '转换中…');

    function step() {
      if (state.cancel) return finish();
      if (i >= pages.length) return finish();
      var num = pages[i];
      FT.setProgress(progress, i / pages.length, '正在处理 ' + (i + 1) + '/' + pages.length);
      i++;
      return state.doc.getPage(num)
        .then(function (page) { return page.getTextContent(); })
        .then(function (tc) {
          var got = rowsToParagraphs(buildRows(tc), paraSplit.checked);
          if (!got.length) blankPages.push(num);
          got.forEach(function (p) { paras.push(p); });
        })
        .catch(function (err) {
          console.error(err);
          failed.push(num);
        })
        .then(step);
    }

    function finish() {
      state.busy = false;
      FT.setBusy(convertBtn, false);
      convertBtn.disabled = false;

      if (state.cancel) {
        FT.resetProgress(progress);
        state.paras = [];
        empty.hidden = false;
        FT.toast('已取消转换', 'warn');
        return;
      }

      state.paras = paras;
      var text = paras.join('\n\n');
      var chars = text.replace(/\s/g, '').length;

      if (!paras.length) {
        FT.resetProgress(progress);
        summary.textContent = state.file.name + ' · 未提取到文本';
        preview.textContent = '';
        resultCard.hidden = true;
        empty.hidden = false;
        FT.alert(tips, 'warn', '<b>没有提取到任何文本</b>' +
          '<p>该 PDF 很可能是扫描件（图片型，无文本层）。本页不做 OCR，请改用带文本层的 PDF。</p>', true);
        FT.toast('未提取到文本，可能是扫描件', 'err');
        return;
      }

      stats.innerHTML = stat('转换页数', String(pages.length)) +
        stat('段落数', String(paras.length)) +
        stat('提取字数', String(chars)) +
        stat('输出文件', '生成中…');
      preview.textContent = paras.slice(0, 40).join('\n\n').slice(0, 4000) +
        (paras.length > 40 || text.length > 4000 ? '\n\n……（仅预览前 40 段，完整内容请下载）' : '');
      resultCard.hidden = false;
      empty.hidden = true;

      if (blankPages.length) {
        var shown = blankPages.slice(0, 10).join('、');
        FT.alert(tips, 'warn', '<b>第 ' + shown + (blankPages.length > 10 ? ' 等' : '') +
          ' 页未提取到文本</b><p>共 ' + blankPages.length +
          ' 页疑似扫描件或纯图片页（无文本层）。本页不做 OCR，请使用带文本层的 PDF。</p>', true);
      }

      FT.setProgress(progress, 0.92, '正在生成 Word…');
      buildDocx(paras).then(function (blob) {
        state.docx = blob;
        stats.innerHTML = stat('转换页数', String(pages.length)) +
          stat('段落数', String(paras.length)) +
          stat('提取字数', String(chars)) +
          stat('输出文件', FT.formatBytes(blob.size));
        downloadDocx.disabled = false;
        FT.setProgress(progress, 1, '完成');
        FT.toast('转换完成：' + paras.length + ' 段 / ' + chars + ' 字' +
          (failed.length ? '，' + failed.length + ' 页失败' : ''), failed.length ? 'warn' : 'ok');
        setTimeout(function () { FT.resetProgress(progress); }, 1800);
      }).catch(function (err) {
        console.error(err);
        FT.resetProgress(progress);
        FT.alert(tips, 'err', '<b>Word 文件生成失败</b><p>' +
          FT.esc((err && err.message) || '未知错误') + '</p>' +
          '<p>你仍可使用「下载 TXT」导出纯文本。</p>', true);
      }).then(function () {
        downloadTxt.disabled = false;
        copyBtn.disabled = false;
      });

      summary.textContent = state.file.name + ' · ' + pages.length + ' 页 · ' + paras.length + ' 段';
    }

    step();
  }

  /* ---------------- 事件 ---------------- */

  convertBtn.addEventListener('click', run);

  downloadDocx.addEventListener('click', function () {
    if (!state.docx) return;
    FT.saveBlob(state.docx, state.base + '.docx');
  });

  downloadTxt.addEventListener('click', function () {
    if (!state.paras.length) return;
    FT.saveText(state.paras.join('\n\n'), state.base + '.txt', 'text/plain');
  });

  copyBtn.addEventListener('click', function () {
    if (!state.paras.length) return;
    FT.copyText(state.paras.join('\n\n'));
  });

  resetBtn.addEventListener('click', function () {
    resetAll(true);
    FT.resetProgress(progress);
    showLimitTip();
  });

  FT.bindDropzone(drop, input, function (files) { if (files[0]) loadPdf(files[0]); });
  resetAll(true);
})();
