/* 电子书格式互转：EPUB→TXT/HTML、TXT/HTML→EPUB、EPUB/TXT/HTML→PDF（文本重排） */
(function () {
  'use strict';

  FT.mountShell('ebook-convert');

  var MAX_SIZE = 100 * 1024 * 1024;
  var MAX_PDF_PAGES = 200;
  var PREVIEW_CHARS = 2000;
  var BLOCK_TAGS = {
    P: 1, DIV: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, LI: 1, UL: 1, OL: 1,
    TABLE: 1, TR: 1, BLOCKQUOTE: 1, SECTION: 1, ARTICLE: 1, HEADER: 1, FOOTER: 1, PRE: 1
  };

  var drop = FT.$('#drop');
  var input = FT.$('#file');
  var fileInfo = FT.$('#fileInfo');
  var direction = FT.$('#direction');
  var gbkChk = FT.$('#gbk');
  var pFontSize = FT.$('#pFontSize');
  var pMargin = FT.$('#pMargin');
  var pLineHeight = FT.$('#pLineHeight');
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
  var downloadBtn = FT.$('#download');
  var copyBtn = FT.$('#copyText');

  var state = {
    file: null, kind: '', busy: false,
    outBlob: null, outName: '', outText: ''
  };

  var INTRO_HTML = '<b>支持范围与格式说明</b>' +
    '<p>本页支持 <b>EPUB / TXT / HTML</b> 的本地互转。<b>MOBI / AZW3 属于私有格式</b>，' +
    '纯前端缺少可用的解析库，本页<b>不支持</b>：请先用 Calibre 等桌面工具转成 EPUB，再回到本页处理。</p>' +
    '<p>导出 PDF 是<b>按文本重排的简化版式</b>（Canvas 绘制后合成），<b>不保留</b>原书的排版、字体、图片与目录样式。</p>';

  function showIntro() { FT.alert(tips, 'warn', INTRO_HTML); }
  showIntro();

  /* ---------------- 工具 ---------------- */

  function stat(k, v, cls) {
    return '<div class="stat"><div class="k">' + FT.esc(k) + '</div>' +
      '<div class="v' + (cls ? ' ' + cls : '') + '">' + FT.esc(v) + '</div></div>';
  }

  function decodeBytes(bytes, encoding) {
    try {
      return new TextDecoder(encoding || 'utf-8').decode(bytes);
    } catch (e) {
      throw new Error('当前浏览器不支持 ' + (encoding || 'utf-8') + ' 解码');
    }
  }

  function countChars(text) {
    return String(text).replace(/\s/g, '').length;
  }

  // 把块级元素/换行还原为文本换行
  function extractText(root) {
    var out = [];
    (function walk(node) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var n = node.childNodes[i];
        if (n.nodeType === 3) {
          out.push(n.nodeValue.replace(/[\r\n\t]+/g, ' '));
        } else if (n.nodeType === 1) {
          var tag = n.tagName.toUpperCase();
          if (tag === 'SCRIPT' || tag === 'STYLE') continue;
          if (tag === 'BR') { out.push('\n'); continue; }
          var block = !!BLOCK_TAGS[tag];
          if (block) out.push('\n');
          walk(n);
          if (block) out.push('\n');
        }
      }
    })(root);
    return out.join('')
      .replace(/[ \u00a0]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n').map(function (l) { return l.trim(); }).join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function parseHTML(text, mime) {
    var doc = new DOMParser().parseFromString(text, mime || 'text/html');
    if (!doc) throw new Error('文档解析失败');
    return doc;
  }

  function docTitle(doc, fallback) {
    var el = doc.querySelector('h1, h2, h3, title');
    var t = el ? String(el.textContent || '').trim() : '';
    if (t.length > 80) t = t.slice(0, 80);
    return t || fallback;
  }

  /* ---------------- EPUB 解析 ---------------- */

  function joinPath(dir, href) {
    var h = String(href || '').split('#')[0].split('?')[0];
    try { h = decodeURIComponent(h); } catch (e) { /* 保持原样 */ }
    if (!h) return '';
    var raw = h.charAt(0) === '/' ? h.slice(1) : (dir || '') + h;
    var out = [];
    raw.split('/').forEach(function (p) {
      if (!p || p === '.') return;
      if (p === '..') { out.pop(); return; }
      out.push(p);
    });
    return out.join('/');
  }

  function makeFileGetter(files) {
    var lower = {};
    Object.keys(files).forEach(function (k) { lower[k.toLowerCase()] = files[k]; });
    return function (path) {
      if (!path) return null;
      if (files[path]) return files[path];
      var lk = path.toLowerCase();
      if (lower[lk]) return lower[lk];
      try {
        var enc = encodeURI(path);
        if (files[enc]) return files[enc];
        if (lower[enc.toLowerCase()]) return lower[enc.toLowerCase()];
      } catch (e) { /* 忽略 */ }
      return null;
    };
  }

  // 返回 [{ title, text, html }]
  function parseEpub(files) {
    var get = makeFileGetter(files);

    var containerBytes = get('META-INF/container.xml');
    if (!containerBytes) throw new Error('不是标准 EPUB：缺少 META-INF/container.xml');
    var containerDoc = parseHTML(decodeBytes(containerBytes), 'application/xml');
    var rootEl = containerDoc.querySelector('rootfile');
    var opfPath = rootEl ? rootEl.getAttribute('full-path') : '';
    if (!opfPath) throw new Error('不是标准 EPUB：container.xml 中未找到 OPF 路径');
    opfPath = joinPath('', opfPath);

    var opfBytes = get(opfPath);
    if (!opfBytes) throw new Error('不是标准 EPUB：找不到 OPF 文件 ' + opfPath);
    var opfDoc = parseHTML(decodeBytes(opfBytes), 'application/xml');
    var opfDir = opfPath.replace(/[^/]*$/, '');

    // manifest：id → { href, type }
    var manifest = {};
    FT.$$('manifest > item', opfDoc).forEach(function (it) {
      var id = it.getAttribute('id');
      if (!id) return;
      manifest[id] = {
        href: it.getAttribute('href') || '',
        type: (it.getAttribute('media-type') || '').toLowerCase()
      };
    });

    // spine 决定章节顺序
    var order = FT.$$('spine > itemref', opfDoc).map(function (r) { return r.getAttribute('idref'); })
      .filter(function (id) { return id && manifest[id]; });

    if (!order.length) {
      order = Object.keys(manifest).filter(function (id) {
        return manifest[id].type.indexOf('xhtml') >= 0 || /\.x?html?$/i.test(manifest[id].href);
      });
    }

    var chapters = [];
    order.forEach(function (id, idx) {
      var item = manifest[id];
      var isDoc = item.type.indexOf('xhtml') >= 0 || item.type === 'text/html' || /\.x?html?$/i.test(item.href);
      if (!isDoc) return;
      var path = joinPath(opfDir, item.href);
      var bytes = get(path);
      if (!bytes) return;
      var doc;
      try {
        doc = parseHTML(decodeBytes(bytes), 'text/html');
      } catch (e) {
        return;
      }
      var body = doc.body || doc.documentElement;
      if (!body) return;
      var text = extractText(body);
      if (!text) return;
      chapters.push({
        title: docTitle(doc, '第 ' + (chapters.length + 1) + ' 章'),
        text: text,
        html: body.innerHTML
      });
    });

    if (!chapters.length) throw new Error('未从该 EPUB 中解析出任何正文章节');
    return chapters;
  }

  /* ---------------- 读取来源 → 章节 ---------------- */

  function readSourceText() {
    if (gbkChk.checked) {
      return FT.readArrayBuffer(state.file).then(function (buf) {
        return decodeBytes(new Uint8Array(buf), 'gbk');
      });
    }
    return FT.readText(state.file);
  }

  function loadChapters() {
    if (state.kind === 'epub') {
      if (typeof JSZip === 'undefined') {
        return Promise.reject(new Error('缺少 JSZip 组件，无法解压 EPUB，请检查网络后刷新'));
      }
      FT.busyProgress(progress, '正在解压并解析 EPUB…');
      return FT.readArrayBuffer(state.file)
        .then(function (buf) { return FT.unzip(buf); })
        .then(function (files) { return parseEpub(files); });
    }

    FT.busyProgress(progress, '正在读取文本…');
    return readSourceText().then(function (text) {
      if (state.kind === 'html') {
        var doc = parseHTML(text, 'text/html');
        var body = doc.body || doc.documentElement;
        return [{
          title: docTitle(doc, FT.baseName(state.file.name)),
          text: extractText(body),
          html: body ? body.innerHTML : FT.esc(text)
        }];
      }
      // TXT：按空行分段，整篇作为一章
      var plain = String(text).replace(/\r\n?/g, '\n');
      if (/\ufffd/.test(plain) && !gbkChk.checked) {
        FT.alert(tips, 'warn', '<b>检测到疑似乱码</b>' +
          '<p>该 TXT 可能不是 UTF-8 编码。请勾选「按 GBK 解码」后重新转换。</p>', true);
      }
      return [{
        title: FT.baseName(state.file.name),
        text: plain.trim(),
        html: plain.split(/\n{2,}/).map(function (p) {
          return '<p>' + FT.esc(p).replace(/\n/g, '<br>') + '</p>';
        }).join('\n')
      }];
    });
  }

  /* ---------------- 输出：TXT / HTML ---------------- */

  function chaptersToTxt(chapters) {
    return chapters.map(function (c) {
      return (c.title ? c.title + '\n\n' : '') + c.text;
    }).join('\n\n\n');
  }

  function chaptersToHtml(chapters, title) {
    var body = chapters.map(function (c, i) {
      return '<section class="chapter">\n<h2>' + FT.esc(c.title || ('第 ' + (i + 1) + ' 章')) + '</h2>\n' +
        c.html + '\n</section>';
    }).join('\n\n');

    return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + FT.esc(title) + '</title>\n<style>\n' +
      'body{max-width:760px;margin:0 auto;padding:32px 20px;line-height:1.8;font-size:17px;' +
      'font-family:-apple-system,"PingFang SC","Microsoft YaHei",serif;color:#222;}\n' +
      'h1{font-size:26px;margin:0 0 28px;}\n' +
      'h2{font-size:20px;margin:44px 0 14px;padding-top:18px;border-top:1px solid #e5e5e5;}\n' +
      'img{max-width:100%;height:auto;}\n' +
      'p{margin:0 0 14px;text-indent:2em;}\n' +
      '.chapter:first-of-type h2{border-top:0;padding-top:0;}\n' +
      '</style>\n</head>\n<body>\n<h1>' + FT.esc(title) + '</h1>\n\n' + body + '\n</body>\n</html>\n';
  }

  /* ---------------- 输出：EPUB（mimetype 必须 STORE 且第一个） ---------------- */

  function buildEpub(chapters, title) {
    if (typeof JSZip === 'undefined') {
      return Promise.reject(new Error('缺少 JSZip 组件，无法生成 EPUB'));
    }
    var uid = 'urn:uuid:ft-' + Date.now().toString(16);
    var zip = new JSZip();

    // mimetype 必须是第一个条目且不压缩
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

    zip.file('META-INF/container.xml',
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
      '  <rootfiles>\n' +
      '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n' +
      '  </rootfiles>\n</container>\n', { compression: 'DEFLATE' });

    var items = [], itemrefs = [], navPoints = [];
    chapters.forEach(function (c, i) {
      var n = i + 1;
      var fname = 'chapter' + n + '.xhtml';
      var ctitle = c.title || ('第 ' + n + ' 章');
      zip.file('OEBPS/' + fname,
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">\n<head>\n' +
        '<meta charset="UTF-8"/>\n<title>' + FT.esc(ctitle) + '</title>\n</head>\n<body>\n' +
        '<h2>' + FT.esc(ctitle) + '</h2>\n' +
        c.text.split(/\n{2,}/).map(function (p) {
          return '<p>' + FT.esc(p).replace(/\n/g, '<br/>') + '</p>';
        }).join('\n') +
        '\n</body>\n</html>\n', { compression: 'DEFLATE' });

      items.push('    <item id="ch' + n + '" href="' + fname + '" media-type="application/xhtml+xml"/>');
      itemrefs.push('    <itemref idref="ch' + n + '"/>');
      navPoints.push('    <navPoint id="np' + n + '" playOrder="' + n + '">\n' +
        '      <navLabel><text>' + FT.esc(ctitle) + '</text></navLabel>\n' +
        '      <content src="' + fname + '"/>\n    </navPoint>');
    });

    zip.file('OEBPS/content.opf',
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">\n' +
      '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">\n' +
      '    <dc:title>' + FT.esc(title) + '</dc:title>\n' +
      '    <dc:language>zh-CN</dc:language>\n' +
      '    <dc:identifier id="BookId">' + FT.esc(uid) + '</dc:identifier>\n' +
      '    <dc:creator>在线文件工具站</dc:creator>\n' +
      '  </metadata>\n  <manifest>\n' +
      '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n' +
      items.join('\n') + '\n  </manifest>\n  <spine toc="ncx">\n' +
      itemrefs.join('\n') + '\n  </spine>\n</package>\n', { compression: 'DEFLATE' });

    zip.file('OEBPS/toc.ncx',
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n' +
      '  <head>\n    <meta name="dtb:uid" content="' + FT.esc(uid) + '"/>\n' +
      '    <meta name="dtb:depth" content="1"/>\n  </head>\n' +
      '  <docTitle><text>' + FT.esc(title) + '</text></docTitle>\n  <navMap>\n' +
      navPoints.join('\n') + '\n  </navMap>\n</ncx>\n', { compression: 'DEFLATE' });

    return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
  }

  /* ---------------- 输出：PDF（Canvas 分页 + pdf-lib） ---------------- */

  function wrapLines(text, ctx, maxWidth) {
    var lines = [];
    String(text).split('\n').forEach(function (para) {
      if (!para) { lines.push(''); return; }
      var line = '';
      for (var i = 0; i < para.length; i++) {
        var ch = para[i];
        if (ctx.measureText(line + ch).width > maxWidth && line) {
          lines.push(line);
          line = ch;
        } else {
          line += ch;
        }
      }
      if (line) lines.push(line);
    });
    return lines;
  }

  function textToPdf(text, opt, onProg) {
    if (typeof PDFLib === 'undefined') {
      return Promise.reject(new Error('缺少 pdf-lib 组件，无法生成 PDF'));
    }
    var W = 595, H = 842, scale = 2;
    var cw = W * scale, chh = H * scale;
    var margin = opt.margin * scale;
    var fs = opt.fontSize * scale;
    var lh = fs * opt.lineHeight;
    var maxW = cw - margin * 2;

    var measure = document.createElement('canvas').getContext('2d');
    measure.font = fs + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    var lines = wrapLines(text, measure, maxW);
    var perPage = Math.max(1, Math.floor((chh - margin * 2) / lh));

    var pages = [];
    for (var i = 0; i < lines.length && pages.length < MAX_PDF_PAGES; i += perPage) {
      pages.push(lines.slice(i, i + perPage));
    }
    var truncated = lines.length > pages.length * perPage;

    return PDFLib.PDFDocument.create().then(function (pdf) {
      var idx = 0;
      function step() {
        if (idx >= pages.length) {
          return pdf.save().then(function (bytes) {
            return {
              blob: new Blob([bytes], { type: 'application/pdf' }),
              pages: pages.length,
              truncated: truncated
            };
          });
        }
        var pageLines = pages[idx];
        idx++;
        var canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = chh;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cw, chh);
        ctx.fillStyle = '#000000';
        ctx.textBaseline = 'alphabetic';
        ctx.font = fs + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        pageLines.forEach(function (line, k) {
          if (line) ctx.fillText(line, margin, margin + fs + k * lh);
        });

        if (onProg) onProg(idx / pages.length);
        return FT.canvasToBlob(canvas, 'image/png')
          .then(function (blob) { return blob.arrayBuffer(); })
          .then(function (buf) { return pdf.embedPng(buf); })
          .then(function (img) {
            var page = pdf.addPage([W, H]);
            page.drawImage(img, { x: 0, y: 0, width: W, height: H });
            return FT.nextFrame();
          })
          .then(step);
      }
      return step();
    });
  }

  /* ---------------- 上传 ---------------- */

  function resetResult() {
    state.outBlob = null;
    state.outName = '';
    state.outText = '';
    resultCard.hidden = true;
    stats.innerHTML = '';
    preview.textContent = '';
    downloadBtn.disabled = true;
    copyBtn.disabled = true;
  }

  function resetAll(clearFile) {
    state.busy = false;
    resetResult();
    if (clearFile) {
      state.file = null;
      state.kind = '';
      input.value = '';
      fileInfo.innerHTML = '';
      summary.textContent = '还没有加载电子书';
      emptyText.textContent = '上传电子书后选择方向，点击「开始转换」生成结果';
      empty.hidden = false;
    }
    convertBtn.disabled = !state.file;
    resetBtn.disabled = !state.file;
  }

  function loadFile(file) {
    var ext = FT.extName(file.name);

    // MOBI / AZW3：明确拒绝并说明原因
    if (ext === 'mobi' || ext === 'azw3' || ext === 'azw' || ext === 'prc') {
      FT.alert(tips, 'warn', '<b>暂不支持 ' + FT.esc(ext.toUpperCase()) + ' 格式</b>' +
        '<p><b>MOBI / AZW3 是 Amazon 的私有格式</b>（含 PalmDOC 压缩、HUFF/CDIC 编码，部分还带 DRM），' +
        '纯前端缺少可用的解析库，本页<b>不做伪装支持</b>。</p>' +
        '<p><b>替代方案</b>：先用 <b>Calibre</b>（免费桌面工具）把它转换成 <b>EPUB</b>，再回到本页即可转 TXT / HTML / PDF。</p>', true);
      FT.toast('不支持 ' + ext.toUpperCase() + '，请先用 Calibre 转成 EPUB', 'err');
      return;
    }

    var kind = ext === 'epub' ? 'epub'
      : (ext === 'html' || ext === 'htm') ? 'html'
      : ext === 'txt' ? 'txt' : '';
    if (!kind) {
      FT.toast('请选择 EPUB / TXT / HTML 文件', 'err');
      return;
    }
    if (file.size > MAX_SIZE) {
      FT.toast('文件超过 100MB，请拆分后再试', 'err');
      return;
    }

    resetAll(true);
    state.file = file;
    state.kind = kind;
    convertBtn.disabled = false;
    resetBtn.disabled = false;
    fileInfo.innerHTML = '<span class="file-chip"><span class="fc-name">' + FT.esc(file.name) +
      '</span><span class="fc-size">' + kind.toUpperCase() + ' · ' + FT.formatBytes(file.size) + '</span></span>';
    summary.textContent = file.name + ' · ' + FT.formatBytes(file.size);

    // 按来源类型给出默认方向
    direction.value = kind === 'epub' ? 'epub-txt' : 'txt-epub';
    syncPdfFields();
    FT.toast('已加载，请选择转换方向', 'ok');
  }

  /* ---------------- 转换主流程 ---------------- */

  function checkDirection(dir) {
    if ((dir === 'epub-txt' || dir === 'epub-html') && state.kind !== 'epub') {
      FT.toast('该方向需要上传 EPUB 文件', 'err');
      return false;
    }
    if (dir === 'txt-epub' && state.kind === 'epub') {
      FT.toast('来源已是 EPUB，请选择 EPUB → TXT / HTML / PDF', 'err');
      return false;
    }
    return true;
  }

  function finish(ok) {
    state.busy = false;
    FT.setBusy(convertBtn, false);
    convertBtn.disabled = !state.file;
    if (ok) {
      FT.setProgress(progress, 1, '完成');
      setTimeout(function () { FT.resetProgress(progress); }, 1600);
    } else {
      FT.resetProgress(progress);
    }
  }

  function showResult(chapters, extra, blob, name, text) {
    state.outBlob = blob;
    state.outName = name;
    state.outText = text || '';

    var chars = countChars(chaptersToTxt(chapters));
    var rows = stat('章节数', String(chapters.length)) + stat('字数', String(chars));
    Object.keys(extra || {}).forEach(function (k) { rows += stat(k, extra[k]); });
    rows += stat('输出体积', FT.formatBytes(blob.size));
    stats.innerHTML = rows;

    var src = state.outText || chaptersToTxt(chapters);
    preview.textContent = src.slice(0, PREVIEW_CHARS) +
      (src.length > PREVIEW_CHARS ? '\n\n……（仅预览前 ' + PREVIEW_CHARS + ' 字，完整内容请下载）' : '');

    downloadBtn.disabled = false;
    copyBtn.disabled = !src;
    empty.hidden = true;
    resultCard.hidden = false;
    summary.textContent = state.file.name + ' → ' + name;
    FT.toast('转换完成：' + chapters.length + ' 章 / ' + chars + ' 字', 'ok');
  }

  function run() {
    if (!state.file || state.busy) return;
    var dir = direction.value;
    if (!checkDirection(dir)) return;

    state.busy = true;
    tips.innerHTML = '';
    showIntro();
    resetResult();
    FT.setBusy(convertBtn, true, '转换中…');

    var base = FT.safeName(FT.baseName(state.file.name));

    loadChapters().then(function (chapters) {
      if (dir === 'epub-txt') {
        var txt = chaptersToTxt(chapters);
        return {
          chapters: chapters,
          blob: new Blob([txt], { type: 'text/plain;charset=utf-8' }),
          name: base + '.txt',
          text: txt,
          extra: { '输出格式': 'TXT' }
        };
      }

      if (dir === 'epub-html') {
        var html = chaptersToHtml(chapters, FT.baseName(state.file.name));
        return {
          chapters: chapters,
          blob: new Blob([html], { type: 'text/html;charset=utf-8' }),
          name: base + '.html',
          text: chaptersToTxt(chapters),
          extra: { '输出格式': 'HTML' }
        };
      }

      if (dir === 'txt-epub') {
        FT.busyProgress(progress, '正在生成 EPUB…');
        return buildEpub(chapters, FT.baseName(state.file.name)).then(function (blob) {
          return {
            chapters: chapters,
            blob: blob,
            name: base + '.epub',
            text: chaptersToTxt(chapters),
            extra: { '输出格式': 'EPUB' }
          };
        });
      }

      // to-pdf
      var text = chaptersToTxt(chapters);
      FT.setProgress(progress, 0, '正在排版 PDF…');
      var opt = {
        fontSize: Number(pFontSize.value) || 14,
        margin: Number(pMargin.value) || 48,
        lineHeight: Number(pLineHeight.value) || 1.6
      };
      return textToPdf(text, opt, function (r) {
        FT.setProgress(progress, r, '绘制页面 ' + Math.round(r * 100) + '%');
      }).then(function (res) {
        if (res.truncated) {
          FT.alert(tips, 'warn', '<b>内容较长，已截断</b>' +
            '<p>为避免浏览器内存不足，本次仅导出前 <b>' + MAX_PDF_PAGES + ' 页</b>。' +
            '如需完整导出，请拆分原文件后分批转换。</p>', true);
        }
        return {
          chapters: chapters,
          blob: res.blob,
          name: base + '.pdf',
          text: text,
          extra: { '输出格式': 'PDF', '页数': String(res.pages) }
        };
      });
    }).then(function (out) {
      showResult(out.chapters, out.extra, out.blob, out.name, out.text);
      finish(true);
    }).catch(function (err) {
      console.error(err);
      FT.alert(tips, 'err', '<b>转换失败</b><p>' + FT.esc(err && err.message || '未知错误') + '</p>', true);
      FT.toast('转换失败：' + (err && err.message || err), 'err');
      finish(false);
    });
  }

  /* ---------------- 事件 ---------------- */

  convertBtn.addEventListener('click', run);

  downloadBtn.addEventListener('click', function () {
    if (state.outBlob) FT.saveBlob(state.outBlob, state.outName);
  });

  copyBtn.addEventListener('click', function () {
    if (state.outText) FT.copyText(state.outText);
  });

  resetBtn.addEventListener('click', function () {
    resetAll(true);
    FT.resetProgress(progress);
    tips.innerHTML = '';
    showIntro();
  });

  function syncPdfFields() {
    var isPdf = direction.value === 'to-pdf';
    FT.$$('[data-grp="pdf"]').forEach(function (el) { el.hidden = !isPdf; });
  }

  direction.addEventListener('change', syncPdfFields);

  FT.bindDropzone(drop, input, function (files) { if (files[0]) loadFile(files[0]); });
  syncPdfFields();
  resetAll(true);
})();
