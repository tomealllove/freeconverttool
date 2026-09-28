/* QR Code Generator: text/templates → error correction · size · colors · margin · logo → canvas drawing → PNG / SVG / clipboard */
(function () {
  'use strict';

  FT.mountShell('qrcode');

  var TPL = {
    text: 'This is a sample text — scan the code to read it.',
    url: 'https://example.com/?from=qrcode',
    wifi: 'WIFI:T:WPA;S:MyWiFi;P:12345678;;',
    vcard: 'BEGIN:VCARD\nVERSION:3.0\nN:Smith;John\nFN:John Smith\nTEL;TYPE=CELL:+1-555-0100\nEMAIL:john.smith@example.com\nORG:Example Technologies Inc.\nEND:VCARD'
  };

  var textEl = FT.$('#text');
  var countEl = FT.$('#count');
  var levelEl = FT.$('#level');
  var sizeEl = FT.$('#size');
  var fgEl = FT.$('#fg');
  var bgEl = FT.$('#bg');
  var marginEl = FT.$('#margin');
  var marginVal = FT.$('#marginVal');
  var logoInput = FT.$('#logo');
  var logoInfo = FT.$('#logoInfo');
  var pickLogo = FT.$('#pickLogo');
  var clearLogo = FT.$('#clearLogo');
  var clearText = FT.$('#clearText');
  var generateBtn = FT.$('#generate');
  var progress = FT.$('#progress');
  var tips = FT.$('#tips');
  var empty = FT.$('#empty');
  var resultBox = FT.$('#result');
  var qrBox = FT.$('#qrBox');
  var statsBox = FT.$('#stats');
  var summary = FT.$('#summary');
  var dlPng = FT.$('#dlPng');
  var dlSvg = FT.$('#dlSvg');
  var copyImg = FT.$('#copyImg');

  var logoImg = null;
  var logoUrl = '';
  var lastCanvas = null;
  var lastSvg = '';

  function byteLen(s) {
    try { return new TextEncoder().encode(s).length; } catch (e) { return s.length; }
  }

  // qrcode-generator takes the low 8 bits of each character by default, which garbles Chinese; patch it to real UTF-8 bytes
  function ensureUtf8() {
    var lib = window.qrcode;
    if (!lib || lib.__utf8Patched) return;
    try {
      var utf8 = function (s) {
        return Array.prototype.slice.call(new TextEncoder().encode(s));
      };
      lib.stringToBytes = utf8;
      if (lib.stringToBytesFuncs && lib.stringToBytesFuncs['default']) {
        lib.stringToBytesFuncs['default'] = utf8;
      }
      lib.__utf8Patched = true;
    } catch (e) {
      try {
        if (lib.stringToBytesFuncs && lib.stringToBytesFuncs['UTF-8']) {
          lib.stringToBytes = lib.stringToBytesFuncs['UTF-8'];
          lib.__utf8Patched = true;
        }
      } catch (e2) { /* keep the default, Chinese may break */ }
    }
  }

  function drawQr(q, n, size, margin, fg, bg) {
    var total = n + margin * 2;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var c = canvas.getContext('2d');
    c.fillStyle = bg;
    c.fillRect(0, 0, size, size);
    c.fillStyle = fg;
    var s = size / total;
    for (var r = 0; r < n; r++) {
      for (var col = 0; col < n; col++) {
        if (!q.isDark(r, col)) continue;
        var x0 = Math.round((col + margin) * s);
        var y0 = Math.round((r + margin) * s);
        var x1 = Math.round((col + margin + 1) * s);
        var y1 = Math.round((r + margin + 1) * s);
        c.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      }
    }

    if (logoImg) {
      var side = Math.round(size * 0.22);
      var pad = Math.max(2, Math.round(side * 0.08));
      var x = Math.round((size - side) / 2);
      var y = Math.round((size - side) / 2);
      c.fillStyle = bg;
      c.fillRect(x - pad, y - pad, side + pad * 2, side + pad * 2);
      var iw = logoImg.naturalWidth, ih = logoImg.naturalHeight;
      var k = Math.min(side / iw, side / ih);
      var dw = Math.max(1, Math.round(iw * k));
      var dh = Math.max(1, Math.round(ih * k));
      c.drawImage(logoImg, x + (side - dw) / 2, y + (side - dh) / 2, dw, dh);
    }
    return canvas;
  }

  function buildSvg(q, n, size, margin, fg, bg) {
    var total = n + margin * 2;
    var d = '';
    for (var r = 0; r < n; r++) {
      for (var col = 0; col < n; col++) {
        if (!q.isDark(r, col)) continue;
        d += 'M' + (col + margin) + ' ' + (r + margin) + 'h1v1h-1z';
      }
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
      '" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges">' +
      '<rect width="' + total + '" height="' + total + '" fill="' + bg + '"/>' +
      '<path d="' + d + '" fill="' + fg + '"/></svg>';
  }

  function generate() {
    if (typeof window.qrcode === 'undefined') {
      FT.depMissing(tips, 'QR code generation', 'This feature relies on the qrcode-generator component. Please check your connection and reload the page.');
      FT.toast('QR code component not loaded, please check your connection and reload', 'err');
      return;
    }
    var text = textEl.value;
    if (!text) {
      FT.toast('Please enter the content to encode', 'err');
      textEl.focus();
      return;
    }

    tips.innerHTML = '';
    FT.setBusy(generateBtn, true, 'Generating…');
    FT.busyProgress(progress, 'Encoding…');

    FT.nextFrame().then(function () {
      ensureUtf8();
      var q;
      try {
        q = window.qrcode(0, levelEl.value);
        q.addData(text);
        q.make();
      } catch (err) {
        var e = new Error('CAPACITY');
        e.raw = (err && err.message) || String(err);
        throw e;
      }
      var n = q.getModuleCount();
      var size = Number(sizeEl.value) || 256;
      var margin = Number(marginEl.value) || 0;
      var canvas = drawQr(q, n, size, margin, fgEl.value, bgEl.value);
      var svg = buildSvg(q, n, size, margin, fgEl.value, bgEl.value);
      return { q: q, n: n, size: size, canvas: canvas, svg: svg, level: levelEl.value };
    }).then(function (r) {
      lastCanvas = r.canvas;
      lastSvg = r.svg;
      qrBox.innerHTML = '';
      r.canvas.setAttribute('aria-label', 'Generated QR code');
      qrBox.appendChild(r.canvas);

      var version = (r.n - 17) / 4;
      statsBox.innerHTML = [
        { k: 'Version / modules', v: 'V' + version + ' · ' + r.n + '×' + r.n },
        { k: 'Output size', v: r.size + '×' + r.size + ' px' },
        { k: 'Error correction level', v: r.level },
        { k: 'Content length', v: byteLen(textEl.value) + ' bytes' }
      ].map(function (s) {
        return '<div class="stat"><div class="k">' + FT.esc(s.k) + '</div><div class="v">' + FT.esc(s.v) + '</div></div>';
      }).join('');

      resultBox.hidden = false;
      empty.hidden = true;
      dlPng.disabled = false;
      dlSvg.disabled = false;
      copyImg.disabled = false;
      summary.textContent = 'Generated · V' + version + ' · ' + r.n + '×' + r.n + ' modules';
      FT.setProgress(progress, 1, 'Generation complete');
      FT.toast('QR code generated', 'ok');
      setTimeout(function () { FT.resetProgress(progress); }, 1200);

      if (logoImg && r.level !== 'H') {
        FT.alert(tips, 'warn', '<b>A center logo was added — set the error correction level to H</b>' +
          '<p>The logo covers part of the code; a higher error correction level keeps it scannable.</p>');
      }
    }).catch(function (err) {
      console.error(err);
      FT.resetProgress(progress);
      if (err && err.message === 'CAPACITY') {
        FT.alert(tips, 'err', '<b>Content exceeds the QR code capacity</b>' +
          '<p>It does not fit at the current error correction level. Try to <b>shorten the text</b>, ' +
          '<b>lower the error correction level</b> (H → M / L greatly increases capacity), or link to the full content instead.</p>' +
          '<p class="muted">' + FT.esc(err.raw || '') + '</p>');
      } else {
        FT.alert(tips, 'err', '<b>Generation failed</b><p>' + FT.esc((err && err.message) || 'Encoding error') + '</p>');
      }
    }).then(function () {
      FT.setBusy(generateBtn, false);
    });
  }

  /* ---------- Events ---------- */

  function updateCount() {
    countEl.textContent = textEl.value.length + ' characters · ' + byteLen(textEl.value) + ' bytes';
  }

  textEl.addEventListener('input', updateCount);

  clearText.addEventListener('click', function () {
    textEl.value = '';
    updateCount();
    tips.innerHTML = '';
    textEl.focus();
  });

  FT.$$('[data-tpl]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-tpl');
      textEl.value = TPL[key] || '';
      updateCount();
      tips.innerHTML = '';
      textEl.focus();
    });
  });

  marginEl.addEventListener('input', function () { marginVal.textContent = marginEl.value; });

  pickLogo.addEventListener('click', function () { logoInput.click(); });

  logoInput.addEventListener('change', function () {
    var file = logoInput.files && logoInput.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      FT.toast('Logo should be under 2MB, it was ignored', 'err');
      logoInput.value = '';
      return;
    }
    if (logoUrl) URL.revokeObjectURL(logoUrl);
    logoUrl = URL.createObjectURL(file);
    FT.loadImage(logoUrl).then(function (img) {
      logoImg = img;
      logoInfo.innerHTML = '<span class="file-chip"><span class="fc-name">' + FT.esc(file.name) + '</span>' +
        '<span class="fc-size">' + FT.formatBytes(file.size) + '</span></span>';
      clearLogo.hidden = false;
      FT.toast('Logo added', 'ok');
    }).catch(function () {
      logoImg = null;
      FT.toast('Logo could not be parsed', 'err');
    });
    logoInput.value = '';
  });

  clearLogo.addEventListener('click', function () {
    logoImg = null;
    if (logoUrl) { URL.revokeObjectURL(logoUrl); logoUrl = ''; }
    logoInfo.innerHTML = '';
    clearLogo.hidden = true;
  });

  generateBtn.addEventListener('click', generate);

  dlPng.addEventListener('click', function () {
    if (!lastCanvas) { FT.toast('No QR code to download yet', 'err'); return; }
    FT.canvasToBlob(lastCanvas, 'image/png').then(function (blob) {
      FT.saveBlob(blob, 'qrcode-' + (Number(sizeEl.value) || 256) + '.png');
    }).catch(function () { FT.toast('PNG export failed', 'err'); });
  });

  dlSvg.addEventListener('click', function () {
    if (!lastSvg) { FT.toast('Please generate a QR code first', 'err'); return; }
    FT.saveText(lastSvg, 'qrcode-' + (Number(sizeEl.value) || 256) + '.svg', 'image/svg+xml');
  });

  copyImg.addEventListener('click', function () {
    if (!lastCanvas) { FT.toast('Please generate a QR code first', 'err'); return; }
    if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') {
      FT.toast('This browser cannot copy images, please use "Download PNG"', 'warn');
      return;
    }
    FT.canvasToBlob(lastCanvas, 'image/png').then(function (blob) {
      return navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
    }).then(function () {
      FT.toast('QR code copied to clipboard', 'ok');
    }).catch(function (err) {
      console.warn(err);
      FT.toast('Copy failed, please use "Download PNG" instead', 'err');
    });
  });

  /* ---------- Initialization ---------- */
  if (typeof window.qrcode === 'undefined') {
    FT.depMissing(tips, 'QR code generation', 'This feature relies on the qrcode-generator component (very small). Please check your connection and reload the page.');
    generateBtn.disabled = true;
  } else {
    FT.alert(tips, 'info', '<b>Usage tips</b>' +
      '<p>Content supports Chinese (encoded as UTF-8). The longer the content and the higher the error correction level, ' +
      'the denser the matrix gets, so the dots become smaller — print or display the code at its original size.</p>');
  }
  updateCount();
})();
