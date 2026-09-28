/* 二维码生成：文本/模板 → 容错·尺寸·配色·边距·Logo → canvas 绘制 → PNG / SVG / 剪贴板 */
(function () {
  'use strict';

  FT.mountShell('qrcode');

  var TPL = {
    text: '这是一段示例文本，扫码后即可看到。',
    url: 'https://example.com/?from=qrcode',
    wifi: 'WIFI:T:WPA;S:MyWiFi;P:12345678;;',
    vcard: 'BEGIN:VCARD\nVERSION:3.0\nN:张三\nFN:张三\nTEL;TYPE=CELL:13800138000\nEMAIL:zhangsan@example.com\nORG:某某科技有限公司\nEND:VCARD'
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

  // qrcode-generator 默认逐字符取低 8 位，中文会乱码，这里改为真正的 UTF-8 字节序列
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
      } catch (e2) { /* 保持默认，中文可能异常 */ }
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
      FT.depMissing(tips, '二维码生成', '该能力依赖 qrcode-generator 组件，请检查网络后刷新页面。');
      FT.toast('二维码组件未加载，请联网后刷新页面', 'err');
      return;
    }
    var text = textEl.value;
    if (!text) {
      FT.toast('请输入要编码的内容', 'err');
      textEl.focus();
      return;
    }

    tips.innerHTML = '';
    FT.setBusy(generateBtn, true, '生成中…');
    FT.busyProgress(progress, '正在编码…');

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
      r.canvas.setAttribute('aria-label', '生成的二维码');
      qrBox.appendChild(r.canvas);

      var version = (r.n - 17) / 4;
      statsBox.innerHTML = [
        { k: '版本 / 模块', v: 'V' + version + ' · ' + r.n + '×' + r.n },
        { k: '输出尺寸', v: r.size + '×' + r.size + ' px' },
        { k: '容错等级', v: r.level },
        { k: '内容长度', v: byteLen(textEl.value) + ' 字节' }
      ].map(function (s) {
        return '<div class="stat"><div class="k">' + FT.esc(s.k) + '</div><div class="v">' + FT.esc(s.v) + '</div></div>';
      }).join('');

      resultBox.hidden = false;
      empty.hidden = true;
      dlPng.disabled = false;
      dlSvg.disabled = false;
      copyImg.disabled = false;
      summary.textContent = '已生成 · V' + version + ' · ' + r.n + '×' + r.n + ' 模块';
      FT.setProgress(progress, 1, '生成完成');
      FT.toast('二维码已生成', 'ok');
      setTimeout(function () { FT.resetProgress(progress); }, 1200);

      if (logoImg && r.level !== 'H') {
        FT.alert(tips, 'warn', '<b>已添加中心 Logo，建议把容错等级调到 H</b>' +
          '<p>Logo 会遮挡一部分码点，容错等级越高越不容易影响识别。</p>');
      }
    }).catch(function (err) {
      console.error(err);
      FT.resetProgress(progress);
      if (err && err.message === 'CAPACITY') {
        FT.alert(tips, 'err', '<b>内容超出二维码容量</b>' +
          '<p>当前容错等级下装不下这些内容。建议：<b>缩短文本</b>、' +
          '<b>把容错等级调低</b>（H → M / L，可显著提升容量），或改成链接指向完整内容。</p>' +
          '<p class="muted">' + FT.esc(err.raw || '') + '</p>');
      } else {
        FT.alert(tips, 'err', '<b>生成失败</b><p>' + FT.esc((err && err.message) || '编码过程异常') + '</p>');
      }
    }).then(function () {
      FT.setBusy(generateBtn, false);
    });
  }

  /* ---------- 事件 ---------- */

  function updateCount() {
    countEl.textContent = textEl.value.length + ' 字符 · ' + byteLen(textEl.value) + ' 字节';
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
      FT.toast('Logo 建议不超过 2MB，已忽略', 'err');
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
      FT.toast('Logo 已添加', 'ok');
    }).catch(function () {
      logoImg = null;
      FT.toast('Logo 解析失败', 'err');
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
    if (!lastCanvas) { FT.toast('还没有可下载的二维码', 'err'); return; }
    FT.canvasToBlob(lastCanvas, 'image/png').then(function (blob) {
      FT.saveBlob(blob, 'qrcode-' + (Number(sizeEl.value) || 256) + '.png');
    }).catch(function () { FT.toast('PNG 导出失败', 'err'); });
  });

  dlSvg.addEventListener('click', function () {
    if (!lastSvg) { FT.toast('请先生成二维码', 'err'); return; }
    FT.saveText(lastSvg, 'qrcode-' + (Number(sizeEl.value) || 256) + '.svg', 'image/svg+xml');
  });

  copyImg.addEventListener('click', function () {
    if (!lastCanvas) { FT.toast('请先生成二维码', 'err'); return; }
    if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') {
      FT.toast('当前浏览器不支持复制图片，请使用「下载 PNG」', 'warn');
      return;
    }
    FT.canvasToBlob(lastCanvas, 'image/png').then(function (blob) {
      return navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
    }).then(function () {
      FT.toast('二维码已复制到剪贴板', 'ok');
    }).catch(function (err) {
      console.warn(err);
      FT.toast('复制失败，请改用「下载 PNG」', 'err');
    });
  });

  /* ---------- 初始化 ---------- */
  if (typeof window.qrcode === 'undefined') {
    FT.depMissing(tips, '二维码生成', '该能力依赖 qrcode-generator 组件（极小），请检查网络后刷新页面。');
    generateBtn.disabled = true;
  } else {
    FT.alert(tips, 'info', '<b>使用提示</b>' +
      '<p>内容支持中文（按 UTF-8 编码）；内容越长、容错等级越高，二维码的点阵越密。' +
      '排版的码点越小，建议保存后用原尺寸打印或展示。</p>');
  }
  updateCount();
})();
