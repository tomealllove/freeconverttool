/* PDF to Word: upload -> page range -> extract text with pdf.js -> rebuild lines/paragraphs by coordinate -> hand-written OOXML packed as .docx */
(function () {
  'use strict';

  FT.mountShell('pdf-to-word');

  var MAX_PDF = 100 * 1024 * 1024;
  var DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  // Closing punctuation commonly found at the end of a line: marks the end of a sentence / paragraph
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

  var LIMIT_HTML = '<b>What to expect (known limits of a browser-only tool)</b>' +
    '<p>This page rebuilds the layout from the PDF <b>text layer</b>: native text-based PDFs work best; ' +
    'multi-column layouts, tables and mixed text/image pages are only partially restored, and headers, ' +
    'footers, footnotes, images and formulas are not preserved.</p>' +
    '<p><b>Scanned pages are not OCR-processed; text-layer PDFs only.</b> A scan (no text layer) contains ' +
    'no extractable text and produces empty output; OCR in the browser is too costly, so this page does not ' +
    'offer it. Please use a text-layer PDF, or run it through a dedicated OCR tool first.</p>';

  function showLimitTip() {
    FT.alert(tips, 'warn', LIMIT_HTML);
  }
  showLimitTip();

  if (!FT.pdfjsReady()) {
    FT.depMissing(tips, 'pdf.js', 'This page relies on pdf.js to parse the PDF text layer. Please check your connection and refresh the page.');
  }

  /* ---------------- Helpers ---------------- */

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

  // Strip control characters that XML 1.0 does not allow
  function cleanText(s) {
    return String(s == null ? '' : s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  function stat(k, v, cls) {
    return '<div class="stat"><div class="k">' + k + '</div>' +
      '<div class="v' + (cls ? ' ' + cls : '') + '">' + v + '</div></div>';
  }

  /* ---------------- Layout rebuild ---------------- */

  // Group a page's textContent into rows by y coordinate (tolerance +/-3), then join items sorted by x
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
        // Insert a space when the gap inside a row is large, so English words do not run together
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

  // Rows -> paragraphs: a gap clearly larger than the line height (>1.6x) starts a new paragraph;
  // when splitting is enabled, finer-grained cuts are applied as well
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
          if (gap > lh * 1.15 && TERMINAL.test(prev.text)) brk = true;   // line ends with closing punctuation and the gap is wide
          else if (gap > lh * 2.0 && !TERMINAL.test(prev.text)) brk = true; // no punctuation but a very wide gap
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

  /* ---------------- Minimal OOXML / DOCX ---------------- */

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

  /* ---------------- Upload ---------------- */

  function resetAll(clearFile) {
    state.cancel = true;
    state.busy = false;
    state.paras = [];
    state.docx = null;
    if (state.doc) { try { state.doc.destroy(); } catch (e) { /* ignore */ } }
    state.doc = null;
    if (clearFile) {
      state.file = null;
      state.total = 0;
      input.value = '';
      fileInfo.innerHTML = '';
      summary.textContent = 'No PDF loaded';
      emptyText.textContent = 'Upload a PDF and click "Convert" — the extracted text appears here';
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
      FT.toast('Please select a PDF file', 'err');
      return;
    }
    if (file.size > MAX_PDF) {
      FT.toast('The PDF exceeds 100MB — please compress it first', 'err');
      return;
    }
    if (!FT.pdfjsReady()) {
      FT.toast('The PDF component is not loaded. Please reconnect and refresh the page', 'err');
      return;
    }

    resetAll(false);
    state.file = file;
    state.base = FT.safeName(FT.baseName(file.name));
    summary.textContent = 'Reading ' + file.name + ' …';
    FT.busyProgress(progress, 'Parsing PDF…');

    FT.readArrayBuffer(file)
      .then(function (buf) { return FT.loadPdf(new Uint8Array(buf)); })
      .then(function (doc) {
        state.doc = doc;
        state.total = doc.numPages;
        fileInfo.innerHTML = '<span class="file-chip"><span class="fc-name">' + FT.esc(file.name) + '</span>' +
          '<span class="fc-size">' + doc.numPages + ' pages · ' + FT.formatBytes(file.size) + '</span></span>';
        convertBtn.disabled = false;
        resetBtn.disabled = false;
        summary.textContent = file.name + ' · ' + doc.numPages + ' pages total';
        emptyText.textContent = 'Ready: ' + doc.numPages + ' pages. Click "Convert" to extract the text';
        empty.hidden = false;
        FT.resetProgress(progress);
        FT.toast('PDF loaded: ' + doc.numPages + ' pages', 'ok');
      })
      .catch(function (err) {
        console.error(err);
        FT.resetProgress(progress);
        state.file = null;
        resetBtn.disabled = true;
        summary.textContent = 'Failed to read the PDF';
        FT.alert(tips, 'err', '<b>Could not parse this PDF</b><p>' +
          FT.esc((err && err.message) || 'The file may be corrupt, encrypted, or not a standard PDF') + '</p>');
      });
  }

  /* ---------------- Conversion ---------------- */

  function run() {
    if (!state.doc || state.busy) return;
    var pages = parseRange(rangeInput.value, state.total);
    if (!pages) {
      FT.toast('Invalid page range, e.g. 1-5,8 (max ' + state.total + ' pages)', 'err');
      return;
    }
    if (!FT.pdfjsReady()) {
      FT.depMissing(tips, 'pdf.js', 'This page relies on pdf.js to parse the PDF text layer. Please check your connection and refresh the page.');
      return;
    }
    if (pages.length > 80 &&
      !confirm('You are about to extract ' + pages.length + ' pages. This may take a while. Continue?')) return;

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
    FT.setBusy(convertBtn, true, 'Converting…');

    function step() {
      if (state.cancel) return finish();
      if (i >= pages.length) return finish();
      var num = pages[i];
      FT.setProgress(progress, i / pages.length, 'Processing ' + (i + 1) + '/' + pages.length);
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
        FT.toast('Conversion cancelled', 'warn');
        return;
      }

      state.paras = paras;
      var text = paras.join('\n\n');
      var chars = text.replace(/\s/g, '').length;

      if (!paras.length) {
        FT.resetProgress(progress);
        summary.textContent = state.file.name + ' · no text extracted';
        preview.textContent = '';
        resultCard.hidden = true;
        empty.hidden = false;
        FT.alert(tips, 'warn', '<b>No text was extracted</b>' +
          '<p>This PDF is most likely a scan (image-only, no text layer). This page does not run OCR — please use a text-layer PDF.</p>', true);
        FT.toast('No text extracted — the file may be a scan', 'err');
        return;
      }

      stats.innerHTML = stat('Pages converted', String(pages.length)) +
        stat('Paragraphs', String(paras.length)) +
        stat('Characters', String(chars)) +
        stat('Output file', 'Generating…');
      preview.textContent = paras.slice(0, 40).join('\n\n').slice(0, 4000) +
        (paras.length > 40 || text.length > 4000 ? '\n\n…… (preview limited to the first 40 paragraphs; download the file for the full text)' : '');
      resultCard.hidden = false;
      empty.hidden = true;

      if (blankPages.length) {
        var shown = blankPages.slice(0, 10).join(', ');
        FT.alert(tips, 'warn', '<b>No text found on page ' + shown + (blankPages.length > 10 ? ' and others' : '') +
          '</b><p>' + blankPages.length +
          ' page(s) look like scans or image-only pages (no text layer). Scanned pages are not OCR-processed; text-layer PDFs only.</p>', true);
      }

      FT.setProgress(progress, 0.92, 'Generating Word…');
      buildDocx(paras).then(function (blob) {
        state.docx = blob;
        stats.innerHTML = stat('Pages converted', String(pages.length)) +
          stat('Paragraphs', String(paras.length)) +
          stat('Characters', String(chars)) +
          stat('Output file', FT.formatBytes(blob.size));
        downloadDocx.disabled = false;
        FT.setProgress(progress, 1, 'Done');
        FT.toast('Conversion complete: ' + paras.length + ' paragraphs / ' + chars + ' characters' +
          (failed.length ? ', ' + failed.length + ' page(s) failed' : ''), failed.length ? 'warn' : 'ok');
        setTimeout(function () { FT.resetProgress(progress); }, 1800);
      }).catch(function (err) {
        console.error(err);
        FT.resetProgress(progress);
        FT.alert(tips, 'err', '<b>Failed to generate the Word file</b><p>' +
          FT.esc((err && err.message) || 'Unknown error') + '</p>' +
          '<p>You can still use "Download TXT" to export plain text.</p>', true);
      }).then(function () {
        downloadTxt.disabled = false;
        copyBtn.disabled = false;
      });

      summary.textContent = state.file.name + ' · ' + pages.length + ' pages · ' + paras.length + ' paragraphs';
    }

    step();
  }

  /* ---------------- Events ---------------- */

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
