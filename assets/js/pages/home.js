/* 首页：挂载侧边栏 + 底部「常用外链」
 * 外链来源：assets/data/links.xml（最多 12 个）
 * 若 XML 加载/解析失败（如 file:// 协议限制），保留页面内置的默认外链。
 */
(function () {
  'use strict';
  FT.mountShell(null);

  var MAX = 12;
  var grid = document.getElementById('linksGrid');
  var section = document.getElementById('linksSection');
  if (!grid || !section) return;

  function hostOf(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; }
  }

  function normalize(u) {
    u = (u || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
    return u;
  }

  function render(items) {
    grid.innerHTML = '';
    items.slice(0, MAX).forEach(function (it) {
      var a = document.createElement('a');
      a.className = 'ext-link';
      a.href = it.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';

      // 只显示名称；名称为空时回退显示域名
      a.textContent = it.name || hostOf(it.url);
      grid.appendChild(a);
    });
    section.hidden = items.length === 0;
  }

  function parse(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML 格式错误');

    var nodes = doc.getElementsByTagName('item');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var pick = function (tag) {
        var el = nodes[i].getElementsByTagName(tag)[0];
        return el ? (el.textContent || '').trim() : '';
      };
      var url = normalize(pick('url'));
      if (!url) continue;               // url 为空 → 预留位，不显示
      out.push({ name: pick('name'), url: url });
      if (out.length >= MAX) break;
    }
    return out;
  }

  fetch('assets/data/links.xml', { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(function (text) { render(parse(text)); })
    .catch(function (err) {
      console.warn('[links] 未能加载 links.xml，使用内置默认外链：', err && err.message);
    });
})();
