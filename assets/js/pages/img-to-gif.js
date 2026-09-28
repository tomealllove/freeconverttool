/* 图片转 GIF：多图上传 → 设置帧参数 → gif.js 编码 → 预览 / 下载 */
(function () {
  'use strict';

  FT.mountShell('img-to-gif');

  var MAX_SIZE = 20 * 1024 * 1024;
  var MAX_COUNT = 60;
  var WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js';
  var EXT_MAP = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif'
  };
  var ICON_X = '<path d="M6 6l12 12M18 6L6 18"/>';

  var drop = FT.$('#drop');
  var input = FT.$('#file');
  var chips = FT.$('#chips');
  var list = FT.$('#list');
  var empty = FT.$('#empty');
  var summary = FT.$('#summary');
  var tips = FT.$('#tips');
  var sizeMode = FT.$('#sizeMode');
  var wField = FT.$('#wField');
  var hField = FT.$('#hField');
  var gifW = FT.$('#gifW');
  var gifH = FT.$('#gifH');
  var delay = FT.$('#delay');
  var loop = FT.$('#loop');
  var quality = FT.$('#quality');
  var qualityVal = FT.$('#qualityVal');
  var buildBtn = FT.$('#build');
  var clearBtn = FT.$('#clear');
  var progress = FT.$('#progress');
  var outCard = FT.$('#outCard');
  var outStats = FT.$('#outStats');
  var preview = FT.$('#preview');
  var downloadBtn = FT.$('#download');

  var items = [];
  var outBlob = null;
  var outUrl = '';
  var dragFrom = -1;

  function detectType(file) {
    if (file.type && file.type.indexOf('image/') === 0) return file.type;
    return EXT_MAP[FT.extName(file.name)] || '';
  }

  function stat(k, v, cls) {
    return '<div class="stat"><div class="k">' + k + '</div>' +
      '<div class="v' + (cls ? ' ' + cls : '') + '">' + v + '</div></div>';
  }

  /* ---------------- 上传 ---------------- */

  function addFiles(files) {
    var added = 0, skipBig = 0, skipType = 0, skipMany = 0;
    files.forEach(function (file) {
      if (items.length >= MAX_COUNT) { skipMany++; return; }
      if (file.size > MAX_SIZE) { skipBig++; return; }
      if (!detectType(file)) { skipType++; return; }
      items.push({
        file: file,
        name: file.name,
        type: detectType(file),
        srcUrl: URL.createObjectURL(file),
        w: 0, h: 0,
        el: null
      });
      added++;
    });

    var msgs = [];
    if (added) msgs.push('已添加 ' + added + ' 张');
    if (skipMany) msgs.push(skipMany + ' 个超过 ' + MAX_COUNT + ' 张上限');
    if (skipBig) msgs.push(skipBig + ' 个超过 20MB');
    if (skipType) msgs.push(skipType + ' 个不是支持的图片');
    if (!added) FT.toast(msgs.join('，') || '没有可添加的图片', 'err');
    else if (msgs.length > 1) FT.toast(msgs.join('，'), 'warn');

    renderAll();
  }

  /* ---------------- 帧列表与排序 ---------------- */

  function cardHTML(item, idx) {
    var meta = item.w ? item.w + '×' + item.h + ' · ' + FT.formatBytes(item.file.size) : '读取中…';
    return '' +
      '<div class="item-head">' +
        '<span class="page-num">第 ' + (idx + 1) + ' 帧</span>' +
        '<span class="grow"></span>' +
        '<button class="icon-btn" data-act="remove" title="移除" aria-label="移除">' + FT.svg(ICON_X, 15) + '</button>' +
      '</div>' +
      '<div class="thumb checker"><img src="' + FT.esc(item.srcUrl) + '" alt="第 ' + (idx + 1) + ' 帧" data-zoom draggable="false"></div>' +
      '<div class="page-meta">' + meta + '</div>';
  }

  function renderAll() {
    empty.hidden = items.length > 0;
    list.innerHTML = '';
    chips.innerHTML = items.map(function (it, i) {
      return '<span class="file-chip"><span class="fc-name">' + FT.esc(it.name) + '</span>' +
        '<span class="fc-size">' + FT.formatBytes(it.file.size) + '</span>' +
        '<button class="icon-btn" data-chip="' + i + '" aria-label="移除">' + FT.svg(ICON_X, 15) + '</button></span>';
    }).join('');

    items.forEach(function (item, idx) {
      var el = FT.el('<article class="item page-card">' + cardHTML(item, idx) + '</article>');
      item.el = el;
      list.appendChild(el);
      bind(item, idx);
      if (!item.w) {
        FT.loadImage(item.srcUrl).then(function (img) {
          item.w = img.naturalWidth;
          item.h = img.naturalHeight;
          if (item.el) {
            var m = item.el.querySelector('.page-meta');
            if (m) m.textContent = item.w + '×' + item.h + ' · ' + FT.formatBytes(item.file.size);
          }
        }).catch(function () {});
      }
    });
    updateBar();
  }

  function bind(item, idx) {
    item.el.querySelector('[data-act="remove"]').addEventListener('click', function () { remove(item); });

    item.el.draggable = true;
    item.el.addEventListener('dragstart', function (e) {
      dragFrom = idx;
      item.el.style.opacity = '.45';
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(idx)); } catch (err) { /* 忽略 */ }
      }
    });
    item.el.addEventListener('dragend', function () {
      dragFrom = -1;
      item.el.style.opacity = '';
    });
    item.el.addEventListener('dragover', function (e) {
      if (dragFrom >= 0) e.preventDefault();
    });
    item.el.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (dragFrom >= 0 && dragFrom !== idx) move(dragFrom, idx);
      dragFrom = -1;
    });
  }

  function move(from, to) {
    if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return;
    var it = items[from];
    items.splice(from, 1);
    items.splice(to, 0, it);
    renderAll();
  }

  function remove(item) {
    URL.revokeObjectURL(item.srcUrl);
    items = items.filter(function (i) { return i !== item; });
    renderAll();
  }

  function updateBar() {
    var has = items.length > 0;
    buildBtn.disabled = !has;
    clearBtn.disabled = !has;
    summary.textContent = !has ? '还没有添加图片'
      : '共 ' + items.length + ' 帧 · 原图合计 ' +
        FT.formatBytes(items.reduce(function (s, i) { return s + i.file.size; }, 0));
  }

  /* ---------------- 合成 GIF ---------------- */

  // 跨域 Worker 会被浏览器拦截，先把脚本取回同域 blob 再用；取不到则退回 CDN 直连
  function workerUrl() {
    return fetch(WORKER)
      .then(function (r) {
        if (!r.ok) throw new Error('worker 下载失败');
        return r.text();
      })
      .then(function (code) {
        return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      })
      .catch(function () { return WORKER; });
  }

  function readSize() {
    if (sizeMode.value === 'custom') {
      var w = Math.max(16, Math.min(1600, Math.round(Number(gifW.value) || 480)));
      var h = Math.max(16, Math.min(1600, Math.round(Number(gifH.value) || 480)));
      return Promise.resolve({ w: w, h: h });
    }
    var first = items[0];
    if (first.w && first.h) return Promise.resolve({ w: first.w, h: first.h });
    return FT.loadImage(first.srcUrl).then(function (img) {
      first.w = img.naturalWidth;
      first.h = img.naturalHeight;
      if (!first.w || !first.h) throw new Error('无法读取首图尺寸');
      return { w: first.w, h: first.h };
    });
  }

  // 逐帧绘制为等尺寸 canvas（GIF 无透明通道，铺白底）
  function buildFrames(w, h, total) {
    var frames = [];
    var i = 0;
    function next() {
      if (i >= total) return Promise.resolve(frames);
      var item = items[i];
      FT.setProgress(progress, (i / total) * 0.4, '正在处理 ' + (i + 1) + '/' + total);
      return FT.nextFrame()
        .then(function () { return FT.loadImage(item.srcUrl); })
        .then(function (img) {
          if (!item.w) { item.w = img.naturalWidth; item.h = img.naturalHeight; }
          frames.push(FT.drawToCanvas(img, w, h, true));
          i++;
          return next();
        });
    }
    return next();
  }

  function encode(frames, opts) {
    return new Promise(function (resolve, reject) {
      var encoder = null;
      try {
        encoder = new GIF({
          workers: 2,
          quality: opts.quality,
          width: opts.w,
          height: opts.h,
          repeat: opts.repeat,
          workerScript: opts.worker
        });
      } catch (err) {
        reject(err);
        return;
      }
      frames.forEach(function (canvas) {
        encoder.addFrame(canvas, { delay: opts.delay, copy: true });
      });
      encoder.on('progress', function (p) {
        FT.setProgress(progress, 0.4 + p * 0.6, '编码中 ' + Math.round(p * 100) + '%');
      });
      encoder.on('finished', function (blob) { resolve(blob); });
      encoder.on('abort', function () { reject(new Error('GIF 编码已中止')); });
      try {
        encoder.render();
      } catch (err) {
        reject(err);
      }
    });
  }

  function build() {
    if (!items.length) { FT.toast('请先添加图片', 'err'); return; }
    if (typeof GIF === 'undefined') {
      FT.alert(tips, 'err', '<b>gif.js 组件未加载</b>' +
        '<p>本页依赖 gif.js 编码 GIF，请检查网络后刷新页面重试。</p>');
      return;
    }
    var d = Math.max(50, Math.min(2000, Math.round(Number(delay.value) || 500)));
    var q = Math.max(1, Math.min(30, Math.round(Number(quality.value) || 10)));
    var repeat = Math.max(0, Math.round(Number(loop.value) || 0));
    var total = items.length;
    var size = null;

    tips.innerHTML = '';
    FT.setBusy(buildBtn, true, '合成中…');
    downloadBtn.disabled = true;
    FT.setProgress(progress, 0, '准备中…');

    readSize()
      .then(function (s) { size = s; return buildFrames(s.w, s.h, total); })
      .then(function (frames) {
        return workerUrl().then(function (worker) {
          return encode(frames, {
            w: size.w, h: size.h, quality: q, delay: d, worker: worker, repeat: repeat
          });
        });
      })
      .then(function (blob) {
        if (outUrl) URL.revokeObjectURL(outUrl);
        outBlob = blob;
        outUrl = URL.createObjectURL(blob);
        preview.src = outUrl;
        outCard.hidden = false;
        downloadBtn.disabled = false;
        outStats.innerHTML =
          stat('帧数', String(total)) +
          stat('尺寸', size.w + '×' + size.h) +
          stat('文件体积', FT.formatBytes(blob.size)) +
          stat('播放时长', (total * d / 1000).toFixed(1) + ' 秒') +
          stat('循环', repeat === 0 ? '无限' : repeat + ' 次');
        FT.setProgress(progress, 1, '编码完成');
        FT.toast('GIF 合成完成，共 ' + total + ' 帧', 'ok');
        setTimeout(function () { FT.resetProgress(progress); }, 2200);
      })
      .catch(function (err) {
        FT.alert(tips, 'err', '<b>合成失败</b><p>' +
          FT.esc(err && err.message ? err.message : '未知错误') + '</p>');
        FT.toast('GIF 合成失败', 'err');
        FT.resetProgress(progress);
      })
      .then(function () { FT.setBusy(buildBtn, false); });
  }

  /* ---------------- 事件 ---------------- */

  buildBtn.addEventListener('click', build);

  downloadBtn.addEventListener('click', function () {
    if (!outBlob) {
      FT.toast('尚未生成 GIF，请先点击「开始合成」', 'warn');
      return;
    }
    FT.saveBlob(outBlob, 'animation-' + items.length + 'f.gif');
  });

  clearBtn.addEventListener('click', function () {
    items.forEach(function (it) { URL.revokeObjectURL(it.srcUrl); });
    items = [];
    outBlob = null;
    if (outUrl) { URL.revokeObjectURL(outUrl); outUrl = ''; }
    preview.removeAttribute('src');
    outCard.hidden = true;
    outStats.innerHTML = '';
    tips.innerHTML = '';
    downloadBtn.disabled = true;
    FT.resetProgress(progress);
    renderAll();
  });

  quality.addEventListener('input', function () { qualityVal.textContent = quality.value; });
  sizeMode.addEventListener('change', function () {
    var custom = sizeMode.value === 'custom';
    wField.hidden = !custom;
    hField.hidden = !custom;
  });

  chips.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-chip]');
    if (!btn) return;
    var item = items[Number(btn.getAttribute('data-chip'))];
    if (item) remove(item);
  });

  FT.bindDropzone(drop, input, addFiles, { multiple: true });

  if (typeof GIF === 'undefined') {
    FT.alert(tips, 'err', '<b>gif.js 组件未加载</b>' +
      '<p>本页依赖 gif.js 编码 GIF，请检查网络后刷新页面重试。</p>');
  }
  renderAll();
})();
