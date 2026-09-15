/* 在线文件工具站 · 公共层
 * 提供：侧边导航、Toast、进度、拖拽上传、下载/复制、ZIP 打包、Canvas 编码等通用能力
 * 用法：每个页面先引本文件，再引自己的 pages/xxx.js，并调用 FT.mountShell('key')
 */
(function (window, document) {
  'use strict';

  var FT = {};

  /* ====================== 导航配置 ====================== */

  var ICON = {
    image: '<path d="M3 5h18v14H3z"/><circle cx="8.5" cy="10" r="1.5"/><path d="m4 17 4.5-4.5 3.5 3.5 3-3 5 5"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    type: '<path d="M5 6h14M12 6v13M9 19h6"/>',
    idcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M14 10h4M14 14h4M6 16h.01"/>',
    layers: '<path d="M12 3 3 8l9 5 9-5-9-5z"/><path d="m3 13 9 5 9-5"/>'
  };

  FT.NAV = [
    {
      key: 'img', name: '图片工具', icon: ICON.image, items: [
        { key: 'img-convert', name: '图片格式化', file: 'img-convert.html' },
        { key: 'img-to-pdf', name: '图片转 PDF', file: 'img-to-pdf.html' },
        { key: 'img-to-gif', name: '图片转 GIF', file: 'img-to-gif.html' },
        { key: 'img-compress', name: '图片压缩', file: 'img-compress.html' }
      ]
    },
    {
      key: 'pdf', name: 'PDF 工具', icon: ICON.doc, items: [
        { key: 'pdf-to-word', name: 'PDF 转 Word', file: 'pdf-to-word.html' },
        { key: 'pdf-merge', name: 'PDF 合并拆分', file: 'pdf-merge.html' },
        { key: 'pdf-compress', name: 'PDF 压缩', file: 'pdf-compress.html' },
        { key: 'pdf-to-img', name: 'PDF 转图片', file: 'pdf-to-img.html' }
      ]
    },
    {
      key: 'conv', name: '转换工具', icon: ICON.swap, items: [
        { key: 'audio-convert', name: '音频格式转换', file: 'audio-convert.html' },
        { key: 'video-convert', name: '视频格式互转', file: 'video-convert.html' },
        { key: 'ebook-convert', name: '电子书格式互转', file: 'ebook-convert.html' }
      ]
    },
    {
      key: 'han', name: '汉字转换', icon: ICON.type, items: [
        { key: 'zh-convert', name: '繁简汉字转换', file: 'zh-convert.html' },
        { key: 'han-case', name: '汉字大小写转换', file: 'han-case.html' }
      ]
    },
    {
      key: 'idcode', name: '证件照与码工具', icon: ICON.idcard, items: [
        { key: 'id-photo', name: '证件照生成', file: 'id-photo.html' },
        { key: 'qrcode', name: '二维码生成', file: 'qrcode.html' }
      ]
    }
  ];

  function svg(paths, size) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" width="' + (size || 16) + '" height="' + (size || 16) + '">' + paths + '</svg>';
  }
  FT.svg = svg;

  /* ====================== 侧边导航 ====================== */

  var COLLAPSE_KEY = 'ft-nav-collapsed';

  function loadCollapsed() {
    try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || []; } catch (e) { return []; }
  }
  function saveCollapsed(list) {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(list)); } catch (e) { /* file:// 下可能不可用 */ }
  }

  FT.mountShell = function (activeKey) {
    var side = document.getElementById('sidebar');
    if (!side) return;

    var collapsed = loadCollapsed();
    var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    var html = '' +
      '<a class="sidebar-brand" href="index.html">' +
        '<span class="brand-icon">' + svg('<path d="M4 7h7l2 2.5H20v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7z"/><path d="M8 15.5h8"/>', 19) + '</span>' +
        '<span><b>文件转换站</b><span>全免费 · 快速处理</span></span>' +
      '</a>' +
      '<nav class="nav">';

    FT.NAV.forEach(function (group) {
      var isCollapsed = collapsed.indexOf(group.key) >= 0;
      var countOpen = group.items.some(function (it) { return it.key === activeKey; });
      if (isCollapsed && countOpen) isCollapsed = false;
      html += '<div class="nav-group' + (isCollapsed ? ' collapsed' : '') + '" data-group="' + group.key + '">' +
        '<button class="nav-group-title" type="button">' +
          '<span class="gicon">' + svg(group.icon, 15) + '</span>' +
          '<span>' + group.name + '</span>' +
          '<span class="count">' + group.items.length + '</span>' +
          '<span class="chev">' + svg('<polyline points="6 9 12 15 18 9"/>', 12) + '</span>' +
        '</button>' +
        '<ul class="nav-list">';
      group.items.forEach(function (item) {
        var active = item.key === activeKey || item.file.toLowerCase() === here;
        html += '<li><a class="nav-link' + (active ? ' active' : '') + '" href="' + item.file + '">' +
          esc(item.name) + '</a></li>';
      });
      html += '</ul></div>';
    });

    html += '</nav><div class="sidebar-foot">即开即用不留存，隐私安全有保障</div>';
    side.innerHTML = html;

    side.addEventListener('click', function (e) {
      var btn = e.target.closest('.nav-group-title');
      if (!btn) return;
      var group = btn.parentNode;
      var key = group.getAttribute('data-group');
      var nowCollapsed = !group.classList.contains('collapsed');
      group.classList.toggle('collapsed', nowCollapsed);
      var list = loadCollapsed().filter(function (k) { return k !== key; });
      if (nowCollapsed) list.push(key);
      saveCollapsed(list);
    });

    // 移动端抽屉
    var shell = document.querySelector('.shell');
    var overlay = document.getElementById('navOverlay');
    var menuBtn = document.getElementById('menuBtn');
    function closeNav() { if (shell) shell.classList.remove('nav-open'); }
    if (menuBtn) menuBtn.addEventListener('click', function () { shell.classList.toggle('nav-open'); });
    if (overlay) overlay.addEventListener('click', closeNav);
    side.addEventListener('click', function (e) {
      if (e.target.closest('.nav-link')) closeNav();
    });

    // 顶栏标题同步
    var topTitle = document.getElementById('topTitle');
    var h1 = document.querySelector('.page-title');
    if (topTitle && h1) topTitle.textContent = h1.textContent;
  };

  /* ====================== 小工具 ====================== */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  FT.esc = esc;

  FT.formatBytes = function (bytes) {
    if (!bytes && bytes !== 0) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  };

  FT.pct = function (a, b) {
    if (!b) return '0%';
    var d = (1 - a / b) * 100;
    return (d >= 0 ? '-' : '+') + Math.abs(d).toFixed(1) + '%';
  };

  FT.baseName = function (name) {
    var i = String(name).lastIndexOf('.');
    return i > 0 ? String(name).slice(0, i) : String(name);
  };
  FT.extName = function (name) {
    var i = String(name).lastIndexOf('.');
    return i < 0 ? '' : String(name).slice(i + 1).toLowerCase();
  };
  FT.safeName = function (name) {
    return String(name).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'file';
  };

  FT.el = function (html) {
    var t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  };

  FT.$ = function (sel, root) { return (root || document).querySelector(sel); };
  FT.$$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  /* ---------- Toast ---------- */

  var toastEl = null, toastTimer = null;
  FT.toast = function (msg, type) {
    if (!toastEl) toastEl = document.getElementById('toast');
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, type === 'err' ? 3800 : 2400);
  };

  /* ---------- 进度 ---------- */

  FT.setProgress = function (el, ratio, text) {
    if (!el) return;
    el.hidden = false;
    el.classList.remove('is-indeterminate');
    var bar = el.querySelector('.progress-bar > i');
    if (bar) bar.style.width = Math.max(0, Math.min(1, ratio)) * 100 + '%';
    var t = el.querySelector('.progress-text');
    if (t && text != null) t.textContent = text;
  };
  FT.busyProgress = function (el, text) {
    if (!el) return;
    el.hidden = false;
    el.classList.add('is-indeterminate');
    var t = el.querySelector('.progress-text');
    if (t && text != null) t.textContent = text;
  };
  FT.resetProgress = function (el) {
    if (!el) return;
    el.hidden = true;
    el.classList.remove('is-indeterminate');
    var bar = el.querySelector('.progress-bar > i');
    if (bar) bar.style.width = '0%';
  };

  FT.setBusy = function (btn, busy, busyText) {
    if (!btn) return;
    if (busy) {
      btn.dataset._text = btn.textContent;
      if (busyText) btn.textContent = busyText;
      btn.classList.add('is-loading');
      btn.disabled = true;
    } else {
      if (btn.dataset._text) btn.textContent = btn.dataset._text;
      btn.classList.remove('is-loading');
      btn.disabled = false;
    }
  };

  /* ---------- 提示条 ---------- */

  var ALERT_ICON = {
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    err: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'
  };
  FT.alertHTML = function (type, html) {
    return '<div class="alert alert-' + (type || 'info') + '">' + svg(ALERT_ICON[type] || ALERT_ICON.info, 16) +
      '<div>' + html + '</div></div>';
  };
  FT.alert = function (container, type, html, append) {
    if (!container) return;
    if (!append) container.innerHTML = '';
    container.insertAdjacentHTML('beforeend', FT.alertHTML(type, html));
  };

  /* ---------- 下载 / 复制 ---------- */

  FT.saveBlob = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  };

  FT.saveText = function (text, filename, mime) {
    FT.saveBlob(new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' }), filename);
  };

  FT.copyText = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { FT.toast('已复制到剪贴板', 'ok'); });
    }
    return new Promise(function (resolve) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        FT.toast('已复制到剪贴板', 'ok');
      } catch (e) {
        FT.toast('复制失败，请手动选中复制', 'err');
      }
      ta.remove();
      resolve();
    });
  };

  /* ---------- 文件读取 ---------- */

  FT.readArrayBuffer = function (file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('文件读取失败')); };
      r.readAsArrayBuffer(file);
    });
  };
  FT.readText = function (file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = function () { reject(new Error('文件读取失败')); };
      r.readAsText(file, 'utf-8');
    });
  };
  FT.readDataURL = function (file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = function () { reject(new Error('文件读取失败')); };
      r.readAsDataURL(file);
    });
  };

  /* ---------- 拖拽上传 ---------- */

  FT.bindDropzone = function (zone, input, handler, opts) {
    opts = opts || {};
    if (!zone || !input) return;
    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      if (!opts.multiple) files = files.slice(0, 1);
      if (files.length) handler(files);
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault(); e.stopPropagation();
        zone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault(); e.stopPropagation();
        if (evt === 'dragleave' && zone.contains(e.relatedTarget)) return;
        zone.classList.remove('is-dragover');
      });
    });
    zone.addEventListener('drop', function (e) {
      var dt = e.dataTransfer;
      if (!dt) return;
      var files = Array.prototype.slice.call(dt.files || []);
      if (!opts.multiple) files = files.slice(0, 1);
      if (files.length) handler(files);
    });
  };

  // 防止拖到页面其他地方时浏览器直接打开文件
  ['dragover', 'drop'].forEach(function (evt) {
    window.addEventListener(evt, function (e) { e.preventDefault(); });
  });

  /* ---------- 图片 / Canvas ---------- */

  FT.loadImage = function (src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('图片解码失败，该格式可能不被当前浏览器支持')); };
      img.src = src;
    });
  };

  var mimeCache = {};
  function canvasSupports(mime) {
    try {
      var c = document.createElement('canvas');
      c.width = c.height = 1;
      return c.toDataURL(mime).indexOf('data:' + mime) === 0;
    } catch (e) { return false; }
  }
  FT.supportsMime = function (mime) {
    if (!(mime in mimeCache)) mimeCache[mime] = canvasSupports(mime);
    return mimeCache[mime];
  };

  FT.canvasToBlob = function (canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        blob ? resolve(blob) : reject(new Error('图片编码失败'));
      }, mime, quality);
    });
  };

  FT.fitSide = function (w, h, maxSide) {
    var m = Math.max(w, h);
    if (m <= maxSide) return { w: Math.round(w), h: Math.round(h) };
    var r = maxSide / m;
    return { w: Math.round(w * r), h: Math.round(h * r) };
  };

  // 按目标尺寸（含缩放比例）绘制到新 canvas，opaque=true 时先铺白底
  FT.drawToCanvas = function (source, w, h, opaque) {
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    var ctx = canvas.getContext('2d');
    if (opaque) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    else { ctx.clearRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  };

  FT.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  FT.nextFrame = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

  /* ---------- 灯箱预览 ---------- */

  document.addEventListener('click', function (e) {
    var img = e.target.closest && e.target.closest('img[data-zoom]');
    if (!img) return;
    var box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = '<button class="lightbox-close" aria-label="关闭">&times;</button>' +
      '<img src="' + esc(img.src) + '" alt="预览">';
    var close = function () { box.remove(); document.removeEventListener('keydown', onKey); };
    var onKey = function (ev) { if (ev.key === 'Escape') close(); };
    box.addEventListener('click', function (ev) {
      if (ev.target === box || ev.target.classList.contains('lightbox-close')) close();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(box);
  });

  /* ---------- ZIP 打包（JSZip 优先，内置 store 兜底） ---------- */

  function crc32(buf) {
    var table = crc32._t;
    if (!table) {
      table = crc32._t = new Uint32Array(256);
      for (var i = 0; i < 256; i++) {
        var c = i;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var j = 0; j < buf.length; j++) crc = table[(crc ^ buf[j]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  function buildZipStore(entries) {
    var enc = new TextEncoder();
    var dt = dosDateTime(new Date());
    var chunks = [], centrals = [], offset = 0;

    entries.forEach(function (entry) {
      var nameBytes = enc.encode(entry.name);
      var data = entry.data;
      var crc = crc32(data);
      var size = data.length;

      var local = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, dt.time, true);
      lv.setUint16(12, dt.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      chunks.push(local, data);

      var central = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dt.time, true);
      cv.setUint16(14, dt.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      central.set(nameBytes, 46);
      centrals.push(central);

      offset += local.length + size;
    });

    var centralSize = 0;
    centrals.forEach(function (c) { centralSize += c.length; });

    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    return new Blob(chunks.concat(centrals, [eocd]), { type: 'application/zip' });
  }

  // items: [{ name, blob }] → Promise<Blob>
  FT.makeZip = function (items, onProgress) {
    var entries = [];
    return items.reduce(function (chain, item, idx) {
      return chain.then(function () {
        return item.blob.arrayBuffer().then(function (buf) {
          entries.push({ name: item.name, data: new Uint8Array(buf) });
          if (onProgress) onProgress((idx + 1) / items.length);
        });
      });
    }, Promise.resolve()).then(function () {
      if (typeof JSZip !== 'undefined') {
        try {
          var zip = new JSZip();
          entries.forEach(function (e) { zip.file(e.name, e.data); });
          return zip.generateAsync({ type: 'blob', compression: 'STORE' });
        } catch (err) {
          console.warn('JSZip 失败，改用内置打包', err);
        }
      }
      return buildZipStore(entries);
    });
  };

  // 与 makeZip 相同，但输入为字符串（用于 EPUB / DOCX 这类文本条目）
  FT.makeZipText = function (items) {
    var enc = new TextEncoder();
    var entries = items.map(function (it) {
      return { name: it.name, data: enc.encode(it.text) };
    });
    if (typeof JSZip !== 'undefined') {
      try {
        var zip = new JSZip();
        entries.forEach(function (e) { zip.file(e.name, e.data); });
        return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      } catch (err) {
        console.warn('JSZip 失败，改用内置打包', err);
      }
    }
    return Promise.resolve(buildZipStore(entries));
  };

  // 读取 zip（JSZip 缺失时用简单解析兜底：仅支持 store/deflate 需要 DecompressionStream）
  FT.unzip = function (arrayBuffer) {
    if (typeof JSZip === 'undefined') {
      return Promise.reject(new Error('缺少 JSZip 组件，无法解压，请检查网络后刷新'));
    }
    return JSZip.loadAsync(arrayBuffer).then(function (zip) {
      var out = {};
      var jobs = [];
      zip.forEach(function (path, entry) {
        if (entry.dir) return;
        jobs.push(entry.async('uint8array').then(function (data) { out[path] = data; }));
      });
      return Promise.all(jobs).then(function () { return out; });
    });
  };

  /* ---------- PDF.js 统一加载 ---------- */

  FT.PDFJS_VERSION = '3.11.174';
  FT.pdfjsReady = function () {
    return typeof pdfjsLib !== 'undefined';
  };
  var PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + FT.PDFJS_VERSION + '/build/';
  var workerReady = null;

  // 优先把 worker 代码抓成本地 Blob 再注入：
  // file:// 下跨域 worker 会被拦截，部分环境直连 CDN worker 也会静默挂起
  function ensureWorker() {
    if (workerReady) return workerReady;
    var url = PDFJS_CDN + 'pdf.worker.min.js';
    pdfjsLib.GlobalWorkerOptions.workerSrc = url;
    workerReady = fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (code) {
        var blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        pdfjsLib.GlobalWorkerOptions.workerSrc = blobUrl;
        return blobUrl;
      })
      .catch(function () {
        // 抓不到（离线 / 无 CORS）就退回直连 CDN，由下面的超时兜底
        pdfjsLib.GlobalWorkerOptions.workerSrc = url;
        return url;
      });
    return workerReady;
  }

  function withTimeout(promise, ms, msg) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error(msg)); }, ms);
      promise.then(
        function (v) { clearTimeout(timer); resolve(v); },
        function (e) { clearTimeout(timer); reject(e); }
      );
    });
  }

  /**
   * 加载 PDF 文档。
   * @param {Uint8Array} bytes
   * @param {{timeout?: number}} [opts] timeout 默认 25 秒
   */
  FT.loadPdf = function (bytes, opts) {
    if (typeof pdfjsLib === 'undefined') {
      return Promise.reject(new Error('PDF 组件未加载，请检查网络后刷新页面'));
    }
    var timeout = (opts && opts.timeout) || 25000;
    var src = bytes;
    return ensureWorker().then(function () {
      return withTimeout(
        pdfjsLib.getDocument({ data: src.slice(0) }).promise,
        timeout,
        'PDF 解析超时，请检查网络后重试'
      );
    }).catch(function (err) {
      // 首次失败：清掉 worker 缓存，改用主线程兜底重试一次
      workerReady = null;
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = '';
        return withTimeout(
          pdfjsLib.getDocument({ data: src.slice(0), disableWorker: true }).promise,
          timeout,
          'PDF 解析超时，请检查网络后重试'
        );
      } catch (e) { /* ignore */ }
      throw err;
    });
  };

  /* ---------- 依赖检测 ---------- */

  FT.ready = function (globalName) { return typeof window[globalName] !== 'undefined'; };

  FT.depMissing = function (container, name, tip) {
    FT.alert(container, 'err', '<b>' + esc(name) + ' 组件未加载</b>' +
      '<p>' + esc(tip || '该能力依赖 CDN 组件，请检查网络后刷新页面重试。') + '</p>');
  };

  window.FT = FT;
})(window, document);
