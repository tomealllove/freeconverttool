/* Home page: mount the sidebar + the bottom "Useful Links" section
 * External link source: assets/data/links.xml (up to 12 entries)
 * If the XML fails to load or parse (for example under the file:// protocol),
 * the built in default links on the page are kept.
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

      // Show the name only; fall back to the domain when the name is empty
      a.textContent = it.name || hostOf(it.url);
      grid.appendChild(a);
    });
    section.hidden = items.length === 0;
  }

  function parse(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid XML format');

    var nodes = doc.getElementsByTagName('item');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var pick = function (tag) {
        var el = nodes[i].getElementsByTagName(tag)[0];
        return el ? (el.textContent || '').trim() : '';
      };
      var url = normalize(pick('url'));
      if (!url) continue;               // empty url means a reserved slot, skip it
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
      console.warn('[links] Failed to load links.xml, using the built in default links:', err && err.message);
    });
})();
