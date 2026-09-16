/* File converter toolbox · shared layer
 * Provides: sidebar nav, toast, progress, drag & drop, download/copy, ZIP packing, canvas helpers
 * Usage: include this file first, then pages/xxx.js, and call FT.mountShell('key')
 */
(function (window, document) {
  'use strict';

  var FT = {};

  /* ====================== Navigation config ====================== */

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
      key: 'img', name: 'Image Tools', icon: ICON.image, items: [
        { key: 'img-convert', name: 'Image Format Converter', file: 'img-convert.html' },
        { key: 'img-to-pdf', name: 'Images to PDF', file: 'img-to-pdf.html' },
        { key: 'img-to-gif', name: 'Images to GIF', file: 'img-to-gif.html' },
        { key: 'img-compress', name: 'Image Compressor', file: 'img-compress.html' }
      ]
    },
    {
      key: 'pdf', name: 'PDF Tools', icon: ICON.doc, items: [
        { key: 'pdf-to-word', name: 'PDF to Word', file: 'pdf-to-word.html' },
        { key: 'pdf-merge', name: 'Merge & Split PDF', file: 'pdf-merge.html' },
        { key: 'pdf-compress', name: 'PDF Compressor', file: 'pdf-compress.html' },
        { key: 'pdf-to-img', name: 'PDF to Images', file: 'pdf-to-img.html' }
      ]
    },
    {
      key: 'conv', name: 'Converters', icon: ICON.swap, items: [
        { key: 'audio-convert', name: 'Audio Converter', file: 'audio-convert.html' },
        { key: 'video-convert', name: 'Video Converter', file: 'video-convert.html' },
        { key: 'ebook-convert', name: 'Ebook Converter', file: 'ebook-convert.html' }
      ]
    },
    {
      key: 'han', name: 'Chinese Text Tools', icon: ICON.type, items: [
        { key: 'zh-convert', name: 'Traditional & Simplified Chinese Converter', file: 'zh-convert.html' },
        { key: 'han-case', name: 'Chinese Number & Currency Converter', file: 'han-case.html' }
      ]
    },
    {
      key: 'idcode', name: 'ID Photo & QR Code', icon: ICON.idcard, items: [
        { key: 'id-photo', name: 'ID Photo Maker', file: 'id-photo.html' },
        { key: 'qrcode', name: 'QR Code Generator', file: 'qrcode.html' }
      ]
    }
  ];

  function svg(paths, size) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" width="' + (size || 16) + '" height="' + (size || 16) + '">' + paths + '</svg>';
  }
  FT.svg = svg;

  /* ====================== Sidebar ====================== */

  var COLLAPSE_KEY = 'ft-nav-collapsed';

  function loadCollapsed() {
    try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || []; } catch (e) { return []; }
  }
  function saveCollapsed(list) {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(list)); } catch (e) { /* may be unavailable on file:// */ }
  }

  FT.mountShell = function (activeKey) {
    var side = document.getElementById('sidebar');
    if (!side) return;

    var collapsed = loadCollapsed();
    var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    var html = '' +
      '<a class="sidebar-brand" href="index.html">' +
        '<span class="brand-icon">' + svg('<path d="M4 7h7l2 2.5H20v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7z"/><path d="M8 15.5h8"/>', 19) + '</span>' +
        '<span><b>FreeConvertBox</b><span>Free · Fast · Secure</span></span>' +
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

    html += '</nav><div class="sidebar-foot">No uploads, no retention. Your privacy is fully protected.</div>';
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

    // Mobile drawer
    var shell = document.querySelector('.shell');
    var overlay = document.getElementById('navOverlay');
    var menuBtn = document.getElementById('menuBtn');
    function closeNav() { if (shell) shell.classList.remove('nav-open'); }
    if (menuBtn) menuBtn.addEventListener('click', function () { shell.classList.toggle('nav-open'); });
    if (overlay) overlay.addEventListener('click', closeNav);
    side.addEventListener('click', function (e) {
      if (e.target.closest('.nav-link')) closeNav();
    });

    // Sync topbar title
    var topTitle = document.getElementById('topTitle');
    var h1 = document.querySelector('.page-title');
    if (topTitle && h1) topTitle.textContent = h1.textContent;

    FT.mountLangSwitch();
  };

  /* ---------- Language switch (English ⇄ Chinese) ---------- */

  FT.mountLangSwitch = function () {
    if (document.querySelector('.lang-switch')) return;

    var isEn = /(^|\/)en\//.test(String(location.pathname).replace(/\\/g, '/'));
    var file = String(location.pathname).split('/').pop() || 'index.html';
    if (!/\.html?$/i.test(file)) file = 'index.html';
    var href = isEn ? '../' + file : 'en/' + file;
    var tip = isEn ? 'Switch to Simplified Chinese' : 'Switch to English version';

    var bar = document.createElement('div');
    bar.className = 'lang-bar';

    var a = document.createElement('a');
    a.className = 'lang-switch';
    a.href = href;
    a.title = tip;
    a.setAttribute('aria-label', tip);
    a.innerHTML = '<span class="ls-opt' + (isEn ? '' : ' on') + '">简体中文</span>' +
      '<span class="ls-opt' + (isEn ? ' on' : '') + '">English</span>';
    a.addEventListener('click', function () {
      try { localStorage.setItem('ft-lang', isEn ? 'zh' : 'en'); } catch (e) {}
    });

    bar.appendChild(a);

    /* Footer bottom-right, right above the copyright line; fall back to the end of the content area */
    var footer = document.querySelector('.footer-inner') || document.querySelector('.site-footer');
    if (footer) {
      var copy = footer.querySelector('.footer-copy');
      if (copy) footer.insertBefore(bar, copy);
      else footer.appendChild(bar);
    } else {
      var host = document.querySelector('.content-inner') || document.querySelector('.content');
      if (host) host.appendChild(bar);
    }

    try { localStorage.setItem('ft-lang', isEn ? 'en' : 'zh'); } catch (e) {}
  };

  /* ====================== Utilities ====================== */

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

  /* ---------- Progress ---------- */

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

  /* ---------- Alert bar ---------- */

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

  /* ---------- Download / Copy ---------- */

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
      return navigator.clipboard.writeText(text).then(function () { FT.toast('Copied to clipboard', 'ok'); });
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
        FT.toast('Copied to clipboard', 'ok');
      } catch (e) {
        FT.toast('Copy failed, please select and copy manually', 'err');
      }
      ta.remove();
      resolve();
    });
  };

  /* ---------- File reading ---------- */

  FT.readArrayBuffer = function (file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Failed to read the file')); };
      r.readAsArrayBuffer(file);
    });
  };
  FT.readText = function (file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = function () { reject(new Error('Failed to read the file')); };
      r.readAsText(file, 'utf-8');
    });
  };
  FT.readDataURL = function (file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = function () { reject(new Error('Failed to read the file')); };
      r.readAsDataURL(file);
    });
  };

  /* ---------- Drag & drop upload ---------- */

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

  // Prevent the browser from opening files dropped outside the zone
  ['dragover', 'drop'].forEach(function (evt) {
    window.addEventListener(evt, function (e) { e.preventDefault(); });
  });

  /* ---------- Image / Canvas ---------- */

  FT.loadImage = function (src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Failed to decode image, this format may not be supported by your browser')); };
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
        blob ? resolve(blob) : reject(new Error('Failed to encode image'));
      }, mime, quality);
    });
  };

  FT.fitSide = function (w, h, maxSide) {
    var m = Math.max(w, h);
    if (m <= maxSide) return { w: Math.round(w), h: Math.round(h) };
    var r = maxSide / m;
    return { w: Math.round(w * r), h: Math.round(h * r) };
  };

  // Draw into a new canvas at the target size; when opaque, fill white first
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

  /* ---------- Lightbox preview ---------- */

  document.addEventListener('click', function (e) {
    var img = e.target.closest && e.target.closest('img[data-zoom]');
    if (!img) return;
    var box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = '<button class="lightbox-close" aria-label="Close">&times;</button>' +
      '<img src="' + esc(img.src) + '" alt="Preview">';
    var close = function () { box.remove(); document.removeEventListener('keydown', onKey); };
    var onKey = function (ev) { if (ev.key === 'Escape') close(); };
    box.addEventListener('click', function (ev) {
      if (ev.target === box || ev.target.classList.contains('lightbox-close')) close();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(box);
  });

  /* ---------- ZIP packing (JSZip first, built-in store fallback) ---------- */

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
          console.warn('JSZip failed, using built-in packer', err);
        }
      }
      return buildZipStore(entries);
    });
  };

  // Same as makeZip but takes strings (for text entries like EPUB / DOCX)
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
        console.warn('JSZip failed, using built-in packer', err);
      }
    }
    return Promise.resolve(buildZipStore(entries));
  };

  // Read zip (fallback parser when JSZip is missing)
  FT.unzip = function (arrayBuffer) {
    if (typeof JSZip === 'undefined') {
      return Promise.reject(new Error('Missing JSZip component, cannot extract. Check your network and reload'));
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

  /* ---------- PDF.js loader ---------- */

  FT.PDFJS_VERSION = '3.11.174';
  FT.pdfjsReady = function () {
    return typeof pdfjsLib !== 'undefined';
  };
  var PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + FT.PDFJS_VERSION + '/build/';
  var workerReady = null;

  // Prefer fetching the worker code into a local Blob:
  // cross-origin workers are blocked on file://, CDN workers can hang silently
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
        // fall back to the CDN directly, guarded by the timeout below
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
   * Load a PDF document.
   * @param {Uint8Array} bytes
   * @param {{timeout?: number}} [opts] timeout defaults to 25s
   */
  FT.loadPdf = function (bytes, opts) {
    if (typeof pdfjsLib === 'undefined') {
      return Promise.reject(new Error('PDF component not loaded, check your network and reload'));
    }
    var timeout = (opts && opts.timeout) || 25000;
    var src = bytes;
    return ensureWorker().then(function () {
      return withTimeout(
        pdfjsLib.getDocument({ data: src.slice(0) }).promise,
        timeout,
        'PDF parsing timed out, check your network and try again'
      );
    }).catch(function (err) {
      // First failure: drop the worker cache and retry once on the main thread
      workerReady = null;
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = '';
        return withTimeout(
          pdfjsLib.getDocument({ data: src.slice(0), disableWorker: true }).promise,
          timeout,
          'PDF parsing timed out, check your network and try again'
        );
      } catch (e) { /* ignore */ }
      throw err;
    });
  };

  /* ---------- Dependency check ---------- */

  FT.ready = function (globalName) { return typeof window[globalName] !== 'undefined'; };

  FT.depMissing = function (container, name, tip) {
    FT.alert(container, 'err', '<b>' + esc(name) + ' is not loaded</b>' +
      '<p>' + esc(tip || 'This feature requires a CDN component. Check your network and reload.') + '</p>');
  };

  window.FT = FT;
})(window, document);
