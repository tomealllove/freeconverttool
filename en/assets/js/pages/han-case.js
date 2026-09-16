/* Chinese Number & Currency Converter: amount → RMB uppercase / Arabic digits → Chinese / Chinese → Arabic digits (pure algorithm, no external dependency) */
(function () {
  'use strict';

  FT.mountShell('han-case');

  var MAX_AMOUNT = 1e12;
  var MAX_INT = 1e16;

  var D_UP = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  var D_LOW = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  var U_UP = ['', '拾', '佰', '仟'];
  var U_LOW = ['', '十', '百', '千'];
  var SEC = ['', '万', '亿', '兆'];

  // Lookup tables used by Chinese numerals → numeric value
  var CN_DIGIT = {
    '零': 0, '〇': 0, '一': 1, '壹': 1, '二': 2, '贰': 2, '两': 2, '三': 3, '叁': 3,
    '四': 4, '肆': 4, '五': 5, '伍': 5, '六': 6, '陆': 6, '七': 7, '柒': 7, '八': 8, '捌': 8, '九': 9, '玖': 9
  };
  var CN_UNIT = {
    '十': 10, '拾': 10, '百': 100, '佰': 100, '千': 1000, '仟': 1000,
    '万': 10000, '萬': 10000, '亿': 100000000, '億': 100000000, '兆': 1000000000000
  };

  var modeSel = FT.$('#mode');
  var upperSel = FT.$('#upper');
  var upperWrap = FT.$('#upperWrap');
  var srcInput = FT.$('#src');
  var examples = FT.$('#examples');
  var runBtn = FT.$('#run');
  var clearBtn = FT.$('#clear');
  var progress = FT.$('#progress');
  var tips = FT.$('#tips');
  var empty = FT.$('#empty');
  var resultBox = FT.$('#result');
  var outMain = FT.$('#outMain');
  var statsBox = FT.$('#stats');
  var summary = FT.$('#summary');
  var copyBtn = FT.$('#copy');

  var lastText = '';

  var SAMPLES = {
    money: ['1234.56', '100000000', '0.07', '1000000.05', '-98765.43'],
    num2cn: ['1234', '100000000', '1024', '987654321'],
    cn2num: ['一千二百三十四', '壹亿叁仟万', '十二', '三千零一']
  };
  var PLACEHOLDER = {
    money: 'Enter an amount, for example 1234.56 (up to two decimal places)',
    num2cn: 'Enter Arabic digits, for example 1234',
    cn2num: 'Enter Chinese numerals, for example 一千二百三十四 or 壹仟贰佰叁拾肆'
  };

  /* ---------- Core algorithm ---------- */

  // Reading of a single 4-digit group, consecutive zeros collapsed inside the group
  function group4(n, digits, units) {
    var s = String(n);
    var res = '';
    var zero = false;
    for (var i = 0; i < s.length; i++) {
      var d = s.charCodeAt(i) - 48;
      var u = units[s.length - 1 - i];
      if (d === 0) { zero = true; continue; }
      if (zero && res) res += digits[0];
      zero = false;
      res += digits[d] + u;
    }
    return res;
  }

  // Integer → Chinese (supports up to the 兆 / trillion level)
  function intToCn(n, digits, units) {
    if (n === 0) return digits[0];
    var groups = [];
    var rest = n;
    while (rest > 0) {
      groups.push(rest % 10000);
      rest = Math.floor(rest / 10000);
    }
    var out = '';
    var pendingZero = false;
    for (var i = groups.length - 1; i >= 0; i--) {
      var g = groups[i];
      if (g === 0) { if (out) pendingZero = true; continue; }
      if (out && g < 1000) pendingZero = true;      // e.g. 1,0001,0000 → 壹亿零壹万
      if (pendingZero) { out += digits[0]; pendingZero = false; }
      out += group4(g, digits, units) + SEC[i];
    }
    // In lowercase reading the leading 「一」 of 「一十」 is dropped: 一十五 → 十五
    if (digits === D_LOW && out.indexOf('一十') === 0) out = out.slice(1);
    return out;
  }

  function thousands(s) {
    var parts = String(s).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  /* ---------- 1. Amount → RMB uppercase ---------- */

  function moneyUpper(raw) {
    var s = String(raw == null ? '' : raw).trim()
      .replace(/[\s,，、￥¥$]/g, '');
    if (!s) return { error: 'Please enter the amount to convert' };
    if (s.charAt(0) === '+') s = s.slice(1);
    var neg = false;
    if (s.charAt(0) === '-') { neg = true; s = s.slice(1); }
    if (s.charAt(0) === '。') s = '.' + s.slice(1);
    if (s.charAt(s.length - 1) === '.') s = s.slice(0, -1);
    if (!/^(?:\d+|\d*\.\d{1,2})$/.test(s)) {
      if (/^-/.test(s)) return { error: 'Invalid amount format, the minus sign may only appear at the beginning' };
      if (/\.\d{3,}$/.test(s)) return { error: 'Amounts support at most two decimal places (jiao and fen)' };
      return { error: 'Invalid amount format, please enter digits such as 1234.56' };
    }

    var parts = s.split('.');
    var intStr = parts[0] || '0';
    var decStr = parts[1] || '';
    while (decStr.length < 2) decStr += '0';
    var intVal = parseInt(intStr, 10);
    if (!isFinite(intVal)) return { error: 'The amount is too large to convert' };
    if (intVal + Number(decStr) / 100 >= MAX_AMOUNT) {
      return { error: 'Amount above the limit (must be under 1 trillion yuan), please split it up' };
    }
    var jiao = decStr.charCodeAt(0) - 48;
    var fen = decStr.charCodeAt(1) - 48;

    var res = neg ? '负' : '';
    if (intVal === 0 && jiao === 0 && fen === 0) return { text: res + '零元整' };

    if (intVal === 0) {
      if (jiao > 0) res += D_UP[jiao] + '角';
      if (fen > 0) res += D_UP[fen] + '分';
      return { text: res };
    }

    res += intToCn(intVal, D_UP, U_UP) + '元';
    if (jiao === 0 && fen === 0) {
      res += '整';
    } else {
      if (jiao > 0) res += D_UP[jiao] + '角';
      else if (fen > 0) res += '零';   // jiao is 0 while fen is not, pad a 「零」
      if (fen > 0) res += D_UP[fen] + '分';
    }
    return { text: res };
  }

  /* ---------- 2. Arabic digits → Chinese numerals ---------- */

  function numToCn(raw, upper) {
    var s = String(raw == null ? '' : raw).trim().replace(/[\s,，]/g, '');
    if (!s) return { error: 'Please enter the Arabic digits to convert' };
    var neg = false;
    if (s.charAt(0) === '-') { neg = true; s = s.slice(1); }
    if (s.charAt(0) === '+') s = s.slice(1);
    if (!/^\d+$/.test(s)) return { error: 'Please enter plain Arabic digits, for example 1234' };
    if (s.length > 16) return { error: 'Number too large, this tool supports up to 16 digits' };
    var n = parseInt(s, 10);
    if (!isFinite(n) || n >= MAX_INT) return { error: 'Number too large, this tool supports up to 16 digits' };
    var digits = upper ? D_UP : D_LOW;
    var units = upper ? U_UP : U_LOW;
    var text = intToCn(n, digits, units);
    if (neg) text = '负' + text;
    return { text: text };
  }

  /* ---------- 3. Chinese numerals → Arabic digits ---------- */

  function cnToNum(raw) {
    var s = String(raw == null ? '' : raw).trim().replace(/[\s,，]/g, '');
    if (!s) return { error: 'Please enter the Chinese numerals to convert' };
    var total = 0, section = 0, num = -1;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (Object.prototype.hasOwnProperty.call(CN_DIGIT, ch)) {
        if (num >= 0 && num >= 10) return { error: '「' + ch + '」 is in the wrong position, digits cannot repeat before a unit' };
        num = CN_DIGIT[ch];
      } else if (Object.prototype.hasOwnProperty.call(CN_UNIT, ch)) {
        var u = CN_UNIT[ch];
        if (u >= 10000) {
          section = (section + (num < 0 ? 0 : num)) * u;
          total += section;
          section = 0;
        } else {
          section += (num < 0 ? 1 : num) * u;
        }
        num = -1;
      } else {
        return { error: 'Unrecognized character 「' + ch + '」, please enter Chinese numerals only, for example 一千二百三十四' };
      }
    }
    var value = total + section + (num < 0 ? 0 : num);
    if (!isFinite(value) || value >= MAX_INT) return { error: 'Value too large, this tool supports up to 16 digits' };
    return { text: String(value) };
  }

  /* ---------- Interaction ---------- */

  function renderSamples() {
    var mode = modeSel.value;
    examples.innerHTML = '<span>Examples:</span>' + SAMPLES[mode].map(function (v) {
      return '<button class="btn btn-sm" type="button" data-sample="' + FT.esc(v) + '">' + FT.esc(v) + '</button>';
    }).join('');
  }

  function showResult(text, rows) {
    outMain.textContent = text;
    lastText = text;
    statsBox.innerHTML = rows.map(function (r) {
      return '<div class="stat"><div class="k">' + FT.esc(r.k) + '</div><div class="v">' + FT.esc(r.v) + '</div></div>';
    }).join('');
    resultBox.hidden = false;
    empty.hidden = true;
    copyBtn.disabled = false;
  }

  function fail(msg) {
    FT.alert(tips, 'err', '<b>Cannot convert</b><p>' + FT.esc(msg) + '</p>');
    FT.toast(msg, 'err');
    resultBox.hidden = true;
    copyBtn.disabled = true;
    empty.hidden = false;
    summary.textContent = 'Conversion failed';
  }

  function run() {
    tips.innerHTML = '';
    var mode = modeSel.value;
    var raw = srcInput.value;
    if (!String(raw).trim()) {
      fail(mode === 'cn2num' ? 'Please enter Chinese numerals' : (mode === 'money' ? 'Please enter an amount' : 'Please enter Arabic digits'));
      srcInput.focus();
      return;
    }

    FT.busyProgress(progress, 'Calculating…');
    FT.setBusy(runBtn, true, 'Converting…');

    FT.nextFrame().then(function () {
      var res;
      var label = '';
      if (mode === 'money') {
        res = moneyUpper(raw);
        label = 'Amount → RMB uppercase';
        if (!res.error) {
          var clean = String(raw).trim().replace(/[\s,，、￥¥$]/g, '');
          var num = Number(clean);
          res.text = 'Lowercase: ' + (isNaN(num) ? clean : '¥' + thousands(num.toFixed(2))) + '\n' +
                     'Uppercase: ' + res.text;
        }
      } else if (mode === 'num2cn') {
        res = numToCn(raw, upperSel.value === 'upper');
        label = 'Arabic digits → Chinese numerals (' + (upperSel.value === 'upper' ? 'uppercase' : 'lowercase') + ')';
      } else {
        res = cnToNum(raw);
        label = 'Chinese numerals → Arabic digits';
      }
      return { res: res, label: label, mode: mode };
    }).then(function (data) {
      if (data.res.error) { fail(data.res.error); return; }
      showResult(data.res.text, [
        { k: 'Conversion mode', v: data.label },
        { k: 'Input', v: String(srcInput.value).trim().slice(0, 24) },
        { k: 'Result length', v: data.res.text.length + ' characters' }
      ]);
      summary.textContent = 'Done · ' + data.label;
      FT.setProgress(progress, 1, 'Complete');
      setTimeout(function () { FT.resetProgress(progress); }, 900);
    }).catch(function (err) {
      console.error(err);
      fail((err && err.message) || 'An error occurred while converting');
    }).then(function () {
      FT.setBusy(runBtn, false);
    });
  }

  runBtn.addEventListener('click', function () {
    run();
  });

  modeSel.addEventListener('change', function () {
    srcInput.placeholder = PLACEHOLDER[modeSel.value];
    upperWrap.hidden = modeSel.value !== 'num2cn';
    tips.innerHTML = '';
    renderSamples();
    srcInput.focus();
  });

  clearBtn.addEventListener('click', function () {
    srcInput.value = '';
    lastText = '';
    outMain.textContent = '';
    statsBox.innerHTML = '';
    resultBox.hidden = true;
    empty.hidden = false;
    summary.textContent = 'Not converted yet';
    tips.innerHTML = '';
    FT.resetProgress(progress);
  });

  copyBtn.addEventListener('click', function () {
    if (!lastText) { FT.toast('Nothing to copy yet', 'err'); return; }
    FT.copyText(lastText);
  });

  examples.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-sample]');
    if (!btn) return;
    srcInput.value = btn.getAttribute('data-sample');
    tips.innerHTML = '';
    run();
  });

  srcInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') run();
  });

  srcInput.placeholder = PLACEHOLDER.money;
  renderSamples();
})();
