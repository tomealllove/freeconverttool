/* ID Photo Maker: upload → crop framing → change background (solid-color tolerance / AI segmentation) → preview, download / print layout */
(function () {
  'use strict';

  FT.mountShell('id-photo');

  var MAX_SIZE = 20 * 1024 * 1024;
  var DPI = 300;
  var MM = 25.4;
  var AI_MJS = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
  var AI_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
  var AI_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite';
  var MAX_SIDE = 4096;

  var drop = FT.$('#drop');
  var fileInput = FT.$('#file');
  var fileInfo = FT.$('#fileInfo');
  var stageWrap = FT.$('#stageWrap');
  var stage = FT.$('#stage');
  var zoom = FT.$('#zoom');
  var zoomVal = FT.$('#zoomVal');
  var fitBtn = FT.$('#fit');
  var centerBtn = FT.$('#center');
  var preset = FT.$('#preset');
  var customWrap = FT.$('#customWrap');
  var customSize = FT.$('#customSize');
  var bgSel = FT.$('#bg');
  var bgColorWrap = FT.$('#bgColorWrap');
  var bgColor = FT.$('#bgColor');
  var matteSel = FT.$('#matte');
  var tolField = FT.$('#tolField');
  var tol = FT.$('#tol');
  var tolVal = FT.$('#tolVal');
  var fmtSel = FT.$('#fmt');
  var alphaWrap = FT.$('#alphaWrap');
  var alphaChk = FT.$('#alpha');
  var layoutChk = FT.$('#layout');
  var generateBtn = FT.$('#generate');
  var progress = FT.$('#progress');
  var tips = FT.$('#tips');
  var empty = FT.$('#empty');
  var resultBox = FT.$('#result');
  var summary = FT.$('#summary');
  var outImg = FT.$('#outImg');
  var statsBox = FT.$('#stats');
  var downloadBtn = FT.$('#download');
  var paperBtn = FT.$('#downloadPaper');
  var sizeInfo = FT.$('#sizeInfo');

  var ctx = stage.getContext('2d');
  var state = {
    img: null, file: null, url: '', base: 1, scale: 1, ox: 0, oy: 0,
    cssW: 0, cssH: 0, dpr: 1, busy: false,
    blob: null, paperBlob: null, name: ''
  };
  var ptrs = {};
  var pinchDist = 0;

  /* ---------- Sizes ---------- */

  function targetSize() {
    var v = preset.value;
    if (v === 'custom') {
      var m = /^\s*(\d{2,4})\s*[×xX*,\s\-]\s*(\d{2,4})\s*$/.exec(customSize.value || '');
      if (!m) return null;
      var w = parseInt(m[1], 10), h = parseInt(m[2], 10);
      if (w < 50 || h < 50 || w > MAX_SIDE || h > MAX_SIDE) return null;
      return { w: w, h: h };
    }
    var p = /^(\d{2,4})x(\d{2,4})$/.exec(v);
    return p ? { w: parseInt(p[1], 10), h: parseInt(p[2], 10) } : null;
  }

  function updateSizeInfo() {
    var t = targetSize();
    if (!t) {
      sizeInfo.textContent = 'Custom size format is invalid, please use something like 800×1000 (50 ~ ' + MAX_SIDE + ' px)';
      return;
    }
    var mw = Math.round(t.w / DPI * MM * 10) / 10;
    var mh = Math.round(t.h / DPI * MM * 10) / 10;
    var label = preset.selectedOptions && preset.selectedOptions[0]
      ? preset.selectedOptions[0].textContent.split(' (')[0].trim() : 'Custom';
    sizeInfo.textContent = label + ' · ' + t.w + '×' + t.h + ' px ≈ ' + mw + '×' + mh +
      ' mm (at ' + DPI + ' DPI, 1 inch = ' + DPI + 'px)';
  }

  /* ---------- Framing box and drawing ---------- */

  function frameRect() {
    var t = targetSize() || { w: 295, h: 413 };
    var ar = t.w / t.h;
    var pad = 18;
    var availW = Math.max(40, state.cssW - pad * 2);
    var availH = Math.max(40, state.cssH - pad * 2);
    var w = availW, h = w / ar;
    if (h > availH) { h = availH; w = h * ar; }
    return { x: (state.cssW - w) / 2, y: (state.cssH - h) / 2, w: w, h: h };
  }

  function resizeCanvas() {
    var w = stageWrap.clientWidth || 640;
    var h = stageWrap.clientHeight || 440;
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    state.cssW = w;
    state.cssH = h;
    stage.width = Math.round(w * state.dpr);
    stage.height = Math.round(h * state.dpr);
    draw();
  }

  function draw() {
    var dpr = state.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, state.cssW, state.cssH);
    ctx.fillStyle = '#f1f2f7';
    ctx.fillRect(0, 0, state.cssW, state.cssH);

    if (!state.img) {
      ctx.fillStyle = '#8b91a6';
      ctx.font = '13px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Please upload a portrait photo first', state.cssW / 2, state.cssH / 2);
      return;
    }

    var iw = state.img.naturalWidth * state.scale;
    var ih = state.img.naturalHeight * state.scale;
    ctx.drawImage(state.img, state.ox, state.oy, iw, ih);

    var f = frameRect();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, state.cssW, state.cssH);
    ctx.rect(f.x, f.y, f.w, f.h);
    ctx.fillStyle = 'rgba(16,18,32,.46)';
    ctx.fill('evenodd');
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 2;
    ctx.strokeRect(f.x + 1, f.y + 1, f.w - 2, f.h - 2);
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(f.x + f.w / 3, f.y); ctx.lineTo(f.x + f.w / 3, f.y + f.h);
    ctx.moveTo(f.x + f.w * 2 / 3, f.y); ctx.lineTo(f.x + f.w * 2 / 3, f.y + f.h);
    ctx.stroke();
    ctx.restore();
  }

  function clampScale(s) {
    var lo = state.base * 0.2, hi = state.base * 8;
    return Math.max(lo, Math.min(hi, s));
  }

  function clampView() {
    if (!state.img) return;
    var f = frameRect();
    var iw = state.img.naturalWidth * state.scale;
    var ih = state.img.naturalHeight * state.scale;
    if (iw <= f.w) state.ox = f.x + (f.w - iw) / 2;
    else state.ox = Math.min(f.x, Math.max(f.x + f.w - iw, state.ox));
    if (ih <= f.h) state.oy = f.y + (f.h - ih) / 2;
    else state.oy = Math.min(f.y, Math.max(f.y + f.h - ih, state.oy));
  }

  function syncZoom() {
    if (!state.base) return;
    var v = Math.max(20, Math.min(400, Math.round(state.scale / state.base * 100)));
    zoom.value = String(v);
    zoomVal.textContent = v + '%';
  }

  function zoomAt(cx, cy, factor) {
    if (!state.img) return;
    var ns = clampScale(state.scale * factor);
    var r = ns / state.scale;
    state.ox = cx - (cx - state.ox) * r;
    state.oy = cy - (cy - state.oy) * r;
    state.scale = ns;
    clampView();
    syncZoom();
    draw();
  }

  function fitView() {
    if (!state.img) return;
    var f = frameRect();
    state.base = Math.max(f.w / state.img.naturalWidth, f.h / state.img.naturalHeight);
    state.scale = state.base;
    state.ox = f.x + (f.w - state.img.naturalWidth * state.scale) / 2;
    state.oy = f.y + (f.h - state.img.naturalHeight * state.scale) / 2;
    clampView();
    syncZoom();
    draw();
  }

  function centerView() {
    if (!state.img) return;
    var f = frameRect();
    state.ox = f.x + (f.w - state.img.naturalWidth * state.scale) / 2;
    state.oy = f.y + (f.h - state.img.naturalHeight * state.scale) / 2;
    clampView();
    draw();
  }

  /* ---------- Pointer interaction (drag + pinch zoom) ---------- */

  function localPoint(e) {
    var r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function ptrCount() { return Object.keys(ptrs).length; }

  stage.addEventListener('pointerdown', function (e) {
    if (!state.img) return;
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* not supported by some browsers */ }
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    stageWrap.classList.add('dragging');
    pinchDist = 0;
  });

  stage.addEventListener('pointermove', function (e) {
    var p = ptrs[e.pointerId];
    if (!p) return;
    var prevX = p.x, prevY = p.y;
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };

    if (ptrCount() >= 2) {
      var ids = Object.keys(ptrs).slice(0, 2);
      var a = ptrs[ids[0]], b = ptrs[ids[1]];
      var dist = Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
      var mid = localPoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      if (pinchDist > 0 && dist > 0) zoomAt(mid.x, mid.y, dist / pinchDist);
      pinchDist = dist;
      return;
    }
    state.ox += e.clientX - prevX;
    state.oy += e.clientY - prevY;
    clampView();
    draw();
  });

  function endPointer(e) {
    delete ptrs[e.pointerId];
    if (ptrCount() === 0) {
      stageWrap.classList.remove('dragging');
      pinchDist = 0;
    }
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  stage.addEventListener('wheel', function (e) {
    if (!state.img) return;
    e.preventDefault();
    var p = localPoint(e);
    zoomAt(p.x, p.y, e.deltaY < 0 ? 1.08 : 1 / 1.08);
  }, { passive: false });

  /* ---------- Cutout algorithms ---------- */

  function hexToRgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
    if (!m) return { r: 255, g: 255, b: 255 };
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }

  // Take the median of edge pixels as the background estimate; more robust against hair and collars than the four corners
  function estimateBg(d, w, h) {
    var rs = [], gs = [], bs = [];
    function px(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      var i = (y * w + x) * 4;
      rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]);
    }
    var step = Math.max(1, Math.floor(Math.min(w, h) / 40));
    var b = Math.max(1, Math.min(8, Math.floor(Math.min(w, h) * 0.04)));
    for (var x = 0; x < w; x += step) { for (var k = 0; k < b; k++) { px(x, k); px(x, h - 1 - k); } }
    for (var y = 0; y < h; y += step) { for (var k2 = 0; k2 < b; k2++) { px(k2, y); px(w - 1 - k2, y); } }
    function med(arr) {
      if (!arr.length) return 255;
      arr.sort(function (p, q) { return p - q; });
      return arr[arr.length >> 1];
    }
    return { r: med(rs), g: med(gs), b: med(bs) };
  }

  // Solid-color tolerance cutout: edges are feathered once to reduce jaggies
  function colorKey(canvas, bgHex, tolerance, keepAlpha) {
    var c = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var id = c.getImageData(0, 0, w, h);
    var d = id.data;
    var est = estimateBg(d, w, h);
    var bg = hexToRgb(bgHex);
    var inner = tolerance * 0.7;
    var outer = tolerance * 1.3;
    var span = Math.max(1, outer - inner);
    for (var i = 0; i < d.length; i += 4) {
      var dr = d[i] - est.r, dg = d[i + 1] - est.g, db = d[i + 2] - est.b;
      var dist = Math.sqrt(dr * dr + dg * dg + db * db);
      var a = dist <= inner ? 0 : (dist >= outer ? 1 : (dist - inner) / span);
      if (keepAlpha) {
        d[i + 3] = Math.round(a * 255);
      } else {
        d[i] = Math.round(d[i] * a + bg.r * (1 - a));
        d[i + 1] = Math.round(d[i + 1] * a + bg.g * (1 - a));
        d[i + 2] = Math.round(d[i + 2] * a + bg.b * (1 - a));
        d[i + 3] = 255;
      }
    }
    c.putImageData(id, 0, 0);
  }

  function downscale(canvas, maxSide) {
    var s = FT.fitSide(canvas.width, canvas.height, maxSide);
    var c = document.createElement('canvas');
    c.width = s.w; c.height = s.h;
    c.getContext('2d').drawImage(canvas, 0, 0, s.w, s.h);
    return c;
  }

  function pickMask(res, w, h) {
    var cm = res.categoryMask || (res.categoryMasks && res.categoryMasks[0]);
    var fg = 1;
    if (cm) {
      var arr = cm.getAsFloat32Array ? cm.getAsFloat32Array()
        : (cm.getAsUint8Array ? cm.getAsUint8Array() : null);
      if (arr) {
        var mw = cm.width || w, mh = cm.height || h;
        var sum = 0, cnt = 0;
        for (var y = Math.floor(mh * 0.35); y < mh * 0.65; y += 2) {
          for (var x = Math.floor(mw * 0.35); x < mw * 0.65; x += 2) { sum += arr[y * mw + x]; cnt++; }
        }
        fg = (cnt && sum / cnt > 0.5) ? 1 : 0;   // the center of the frame tells us which class is the person
      }
    }
    var list = res.confidenceMasks || [];
    if (list.length > fg && list[fg]) {
      var m = list[fg];
      return { data: m.getAsFloat32Array(), w: m.width, h: m.height };
    }
    if (list.length === 1) {
      var m1 = list[0];
      return { data: m1.getAsFloat32Array(), w: m1.width, h: m1.height };
    }
    if (cm && arr) {
      var out = new Float32Array(arr.length);
      for (var i = 0; i < arr.length; i++) out[i] = Math.abs(arr[i] - fg) < 0.5 ? 1 : 0;
      return { data: out, w: cm.width || w, h: cm.height || h };
    }
    throw new Error('No portrait segmentation mask returned');
  }

  function resizeMask(src, sw, sh, dw, dh) {
    var out = new Float32Array(dw * dh);
    if (sw === dw && sh === dh) { out.set(src); return out; }
    var rx = sw / dw, ry = sh / dh;
    for (var y = 0; y < dh; y++) {
      var sy = Math.max(0, Math.min(sh - 1, (y + 0.5) * ry - 0.5));
      var y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), fy = sy - y0;
      for (var x = 0; x < dw; x++) {
        var sx = Math.max(0, Math.min(sw - 1, (x + 0.5) * rx - 0.5));
        var x0 = Math.floor(sx), x1 = Math.min(sw - 1, x0 + 1), fx = sx - x0;
        var v00 = src[y0 * sw + x0], v01 = src[y0 * sw + x1];
        var v10 = src[y1 * sw + x0], v11 = src[y1 * sw + x1];
        out[y * dw + x] = (v00 * (1 - fx) + v01 * fx) * (1 - fy) + (v10 * (1 - fx) + v11 * fx) * fy;
      }
    }
    return out;
  }

  function blurAlpha(a, w, h) {
    var tmp = new Float32Array(a.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var s = 0, c = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var yy = y + dy, xx = x + dx;
            if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
            s += a[yy * w + xx]; c++;
          }
        }
        tmp[y * w + x] = s / c;
      }
    }
    a.set(tmp);
  }

  function applyAlpha(canvas, alpha, bgHex, keepAlpha) {
    var c = canvas.getContext('2d');
    var id = c.getImageData(0, 0, canvas.width, canvas.height);
    var d = id.data;
    var bg = hexToRgb(bgHex);
    for (var i = 0, p = 0; p < alpha.length && i < d.length; p++, i += 4) {
      var a = alpha[p];
      a = a < 0 ? 0 : (a > 1 ? 1 : a);
      if (keepAlpha) {
        d[i + 3] = Math.round(a * 255);
      } else {
        d[i] = Math.round(d[i] * a + bg.r * (1 - a));
        d[i + 1] = Math.round(d[i + 1] * a + bg.g * (1 - a));
        d[i + 2] = Math.round(d[i + 2] * a + bg.b * (1 - a));
        d[i + 3] = 255;
      }
    }
    c.putImageData(id, 0, 0);
  }

  // AI portrait segmentation: dynamically import MediaPipe; on failure the caller falls back to solid-color tolerance
  function aiAlpha(canvas) {
    return Promise.resolve()
      .then(function () { return import(/* webpackIgnore: true */ AI_MJS); })
      .then(function (vision) {
        return vision.FilesetResolver.forVisionTasks(AI_WASM).then(function (fileset) {
          return vision.ImageSegmenter.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: AI_MODEL, delegate: 'CPU' },
            runningMode: 'IMAGE',
            outputCategoryMask: true,
            outputConfidenceMasks: true
          });
        });
      })
      .then(function (seg) {
        try {
          var small = downscale(canvas, 512);
          var res = seg.segment(small);
          var mask = pickMask(res, small.width, small.height);
          var a = resizeMask(mask.data, mask.w, mask.h, canvas.width, canvas.height);
          blurAlpha(a, canvas.width, canvas.height);
          for (var i = 0; i < a.length; i++) a[i] = (a[i] - 0.25) / 0.35;   // soften the threshold
          return a;
        } finally {
          try { seg.close(); } catch (e) { /* ignore release errors */ }
        }
      });
  }

  /* ---------- Generation ---------- */

  function cropTo(tw, th) {
    var f = frameRect();
    var sx = (f.x - state.ox) / state.scale;
    var sy = (f.y - state.oy) / state.scale;
    var sw = f.w / state.scale;
    var sh = f.h / state.scale;
    var canvas = document.createElement('canvas');
    canvas.width = tw; canvas.height = th;
    var c = canvas.getContext('2d');
    c.imageSmoothingEnabled = true;
    if (c.imageSmoothingQuality) c.imageSmoothingQuality = 'high';
    c.drawImage(state.img, sx, sy, sw, sh, 0, 0, tw, th);
    return canvas;
  }

  function flatten(canvas, bgHex) {
    var out = document.createElement('canvas');
    out.width = canvas.width; out.height = canvas.height;
    var c = out.getContext('2d');
    c.fillStyle = bgHex;
    c.fillRect(0, 0, out.width, out.height);
    c.drawImage(canvas, 0, 0);
    return out;
  }

  function buildPaper(photo) {
    var pw = Math.round(89 / MM * DPI);
    var ph = Math.round(127 / MM * DPI);
    var c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    var cx = c.getContext('2d');
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, pw, ph);

    var gap = 24;
    var k = Math.min(1, (pw - 40) / photo.width, (ph - 40) / photo.height);
    var iw = Math.round(photo.width * k);
    var ih = Math.round(photo.height * k);
    var cols = Math.max(1, Math.floor((pw + gap) / (iw + gap)));
    var rows = Math.max(1, Math.floor((ph + gap) / (ih + gap)));
    var count = Math.min(8, cols * rows);
    var usedCols = Math.max(1, Math.min(cols, count));
    var usedRows = Math.ceil(count / usedCols);
    var totalW = usedCols * iw + (usedCols - 1) * gap;
    var totalH = usedRows * ih + (usedRows - 1) * gap;
    var sx = (pw - totalW) / 2;
    var sy = (ph - totalH) / 2;

    for (var i = 0; i < count; i++) {
      var r = Math.floor(i / usedCols);
      var cc = i % usedCols;
      var inRow = Math.min(usedCols, count - r * usedCols);
      var rowW = inRow * iw + (inRow - 1) * gap;
      var x = sx + (totalW - rowW) / 2 + cc * (iw + gap);
      var y = sy + r * (ih + gap);
      cx.drawImage(photo, x, y, iw, ih);
      cx.strokeStyle = '#d5d9e6';
      cx.lineWidth = 1;
      cx.strokeRect(x + 0.5, y + 0.5, iw - 1, ih - 1);
    }
    return c;
  }

  function generate() {
    if (state.busy) return;
    if (!state.img) { FT.toast('Please upload a portrait photo first', 'err'); return; }
    var t = targetSize();
    if (!t) {
      FT.toast(customWrap.hidden ? 'The size preset is invalid' : 'Custom size format is invalid, please use something like 800×1000', 'err');
      return;
    }

    state.busy = true;
    tips.innerHTML = '';
    FT.setBusy(generateBtn, true, 'Generating…');
    FT.setProgress(progress, 0.2, 'Cropping the framing…');

    var bgMode = bgSel.value;
    var bgHex = bgMode === 'custom' ? bgColor.value : (bgMode === 'keep' ? '#ffffff' : bgMode);
    var matte = matteSel.value;
    var fmt = FT.supportsMime(fmtSel.value) ? fmtSel.value : 'image/png';
    var keepAlpha = fmt === 'image/png' && alphaChk.checked;

    FT.nextFrame().then(function () {
      var canvas = cropTo(t.w, t.h);
      if (matte === 'none' || bgMode === 'keep') {
        return { canvas: canvas, note: bgMode === 'keep' ? 'Original background kept' : 'Crop only' };
      }
      if (matte === 'ai') {
        FT.busyProgress(progress, 'Loading the AI model (about 1.9MB)…');
        return aiAlpha(canvas).then(function (alpha) {
          applyAlpha(canvas, alpha, bgHex, keepAlpha);
          return { canvas: canvas, note: 'AI portrait segmentation' };
        }).catch(function (err) {
          console.warn('AI cutout failed, falling back to solid-color tolerance: ', err);
          FT.alert(tips, 'warn', '<b>AI cutout unavailable, fell back automatically</b><p>' +
            FT.esc((err && err.message) || 'Model failed to load') + ' — this run used the "solid-color tolerance" method instead. ' +
            'Try adjusting the tolerance slider for a better result.</p>');
          colorKey(canvas, bgHex, Number(tol.value), keepAlpha);
          return { canvas: canvas, note: 'Solid-color tolerance (AI fallback)' };
        });
      }
      FT.setProgress(progress, 0.55, 'Cutting out and replacing the background…');
      colorKey(canvas, bgHex, Number(tol.value), keepAlpha);
      return { canvas: canvas, note: 'Solid-color tolerance' };
    }).then(function (r) {
      var canvas = r.canvas;
      if (fmt === 'image/jpeg') {
        canvas = flatten(canvas, bgMode === 'keep' ? '#ffffff' : bgHex);
      }
      FT.setProgress(progress, 0.8, 'Encoding the output…');
      return FT.canvasToBlob(canvas, fmt, 0.92).then(function (blob) {
        return { blob: blob, canvas: canvas, note: r.note };
      }).then(function (res) {
        if (!layoutChk.checked) return Promise.resolve({ blob: res.blob, canvas: res.canvas, note: res.note, paper: null });
        FT.setProgress(progress, 0.9, 'Laying out the photo sheet…');
        var paper = buildPaper(res.canvas);
        return FT.canvasToBlob(paper, 'image/jpeg', 0.92).then(function (pb) {
          return { blob: res.blob, canvas: res.canvas, note: res.note, paper: pb };
        });
      });
    }).then(function (res) {
      var ext = fmt === 'image/jpeg' ? 'jpg' : 'png';
      state.blob = res.blob;
      state.paperBlob = res.paper;
      state.name = 'id-photo-' + t.w + 'x' + t.h + '.' + ext;

      if (outImg.dataset.url) URL.revokeObjectURL(outImg.dataset.url);
      var url = URL.createObjectURL(res.blob);
      outImg.dataset.url = url;
      outImg.src = url;

      var mw = Math.round(t.w / DPI * MM * 10) / 10;
      var mh = Math.round(t.h / DPI * MM * 10) / 10;
      statsBox.innerHTML = [
        { k: 'Output size', v: t.w + '×' + t.h + ' px' },
        { k: 'Size in mm', v: mw + '×' + mh + ' mm' },
        { k: 'File size', v: FT.formatBytes(res.blob.size) },
        { k: 'Processing method', v: res.note }
      ].map(function (s) {
        return '<div class="stat"><div class="k">' + FT.esc(s.k) + '</div><div class="v">' + FT.esc(s.v) + '</div></div>';
      }).join('');

      resultBox.hidden = false;
      empty.hidden = true;
      downloadBtn.disabled = false;
      paperBtn.hidden = !res.paper;
      paperBtn.disabled = !res.paper;
      summary.textContent = 'Generated · ' + t.w + '×' + t.h + ' px · ' + res.note;
      FT.setProgress(progress, 1, 'Generation complete');
      FT.toast('ID photo generated', 'ok');
      setTimeout(function () { FT.resetProgress(progress); }, 1500);
    }).catch(function (err) {
      console.error(err);
      FT.resetProgress(progress);
      FT.alert(tips, 'err', '<b>Generation failed</b><p>' + FT.esc((err && err.message) || 'Image processing error') + '</p>');
    }).then(function () {
      state.busy = false;
      FT.setBusy(generateBtn, false);
    });
  }

  /* ---------- File loading ---------- */

  function loadFile(files) {
    var file = files && files[0];
    if (!file) return;
    var ext = FT.extName(file.name);
    if (!/^image\//.test(file.type) && ['png', 'jpg', 'jpeg', 'webp'].indexOf(ext) < 0) {
      FT.toast('Please select a JPG / PNG / WebP image', 'err');
      return;
    }
    if (file.size > MAX_SIZE) {
      FT.toast('Image is larger than 20MB, please compress it first', 'err');
      return;
    }
    FT.busyProgress(progress, 'Reading the image…');
    var url = URL.createObjectURL(file);
    FT.loadImage(url).then(function (img) {
      if (state.url) URL.revokeObjectURL(state.url);
      state.url = url;
      state.img = img;
      state.file = file;
      fileInfo.innerHTML = '<span class="file-chip"><span class="fc-name">' + FT.esc(file.name) + '</span>' +
        '<span class="fc-size">' + img.naturalWidth + '×' + img.naturalHeight + ' · ' + FT.formatBytes(file.size) + '</span></span>';
      generateBtn.disabled = false;
      resultBox.hidden = true;
      downloadBtn.disabled = true;
      paperBtn.disabled = true;
      empty.hidden = false;
      summary.textContent = 'Loaded ' + file.name + ', adjust the framing then generate';
      resizeCanvas();
      fitView();
      FT.resetProgress(progress);
      FT.toast('Image loaded', 'ok');
    }).catch(function (err) {
      URL.revokeObjectURL(url);
      FT.resetProgress(progress);
      FT.toast('Failed to read the image: ' + ((err && err.message) || err), 'err');
    });
  }

  /* ---------- Event binding ---------- */

  preset.addEventListener('change', function () {
    customWrap.hidden = preset.value !== 'custom';
    updateSizeInfo();
    if (state.img) { clampView(); draw(); }
  });
  customSize.addEventListener('input', function () {
    updateSizeInfo();
    if (state.img) { clampView(); draw(); }
  });
  bgSel.addEventListener('change', function () {
    bgColorWrap.hidden = bgSel.value !== 'custom';
  });
  matteSel.addEventListener('change', function () {
    tolField.hidden = matteSel.value !== 'color';
  });
  tol.addEventListener('input', function () { tolVal.textContent = tol.value; });
  fmtSel.addEventListener('change', function () {
    alphaWrap.hidden = fmtSel.value !== 'image/png';
  });
  zoom.addEventListener('input', function () {
    if (!state.img) return;
    var target = state.base * (Number(zoom.value) / 100);
    var f = frameRect();
    zoomAt(f.x + f.w / 2, f.y + f.h / 2, target / state.scale);
  });
  fitBtn.addEventListener('click', fitView);
  centerBtn.addEventListener('click', centerView);
  generateBtn.addEventListener('click', generate);
  downloadBtn.addEventListener('click', function () {
    if (!state.blob) { FT.toast('No image to download yet', 'err'); return; }
    FT.saveBlob(state.blob, state.name);
  });
  paperBtn.addEventListener('click', function () {
    if (!state.paperBlob) { FT.toast('Please tick "Print layout on 5-inch photo paper" and generate again', 'err'); return; }
    FT.saveBlob(state.paperBlob, 'id-photo-sheet-5inch.jpg');
  });
  window.addEventListener('resize', function () {
    if (!state.img) { resizeCanvas(); return; }
    var f0 = frameRect();
    var relX = (f0.x - state.ox) / (state.img.naturalWidth * state.scale);
    var relY = (f0.y - state.oy) / (state.img.naturalHeight * state.scale);
    var ratio = state.base ? state.scale / state.base : 1;
    resizeCanvas();
    fitView();                       // the framing box changed size, recompute the base scale
    state.scale = state.base * ratio;
    var f1 = frameRect();
    state.ox = f1.x - relX * state.img.naturalWidth * state.scale;
    state.oy = f1.y - relY * state.img.naturalHeight * state.scale;
    clampView();
    syncZoom();
    draw();
  });

  FT.bindDropzone(drop, fileInput, loadFile);
  updateSizeInfo();
  resizeCanvas();
})();
