/* 汉字大小写转换：金额→人民币大写 / 阿拉伯数字→中文 / 中文→阿拉伯数字（纯算法，无外部依赖） */
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

  // 中文数字 → 数值用表
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
    money: '请输入金额，例如 1234.56（最多两位小数）',
    num2cn: '请输入阿拉伯数字，例如 1234',
    cn2num: '请输入中文数字，例如 一千二百三十四 或 壹仟贰佰叁拾肆'
  };

  /* ---------- 核心算法 ---------- */

  // 单个四位分组的读法，内部压缩连续零
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

  // 整数 → 中文（支持到兆级）
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
      if (out && g < 1000) pendingZero = true;      // 如 1,0001,0000 → 壹亿零壹万
      if (pendingZero) { out += digits[0]; pendingZero = false; }
      out += group4(g, digits, units) + SEC[i];
    }
    // 小写读法省略高位「一十」中的「一」：一十五 → 十五
    if (digits === D_LOW && out.indexOf('一十') === 0) out = out.slice(1);
    return out;
  }

  function thousands(s) {
    var parts = String(s).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  /* ---------- 1. 金额 → 人民币大写 ---------- */

  function moneyUpper(raw) {
    var s = String(raw == null ? '' : raw).trim()
      .replace(/[\s,，、￥¥$]/g, '');
    if (!s) return { error: '请输入需要转换的金额' };
    if (s.charAt(0) === '+') s = s.slice(1);
    var neg = false;
    if (s.charAt(0) === '-') { neg = true; s = s.slice(1); }
    if (s.charAt(0) === '。') s = '.' + s.slice(1);
    if (s.charAt(s.length - 1) === '.') s = s.slice(0, -1);
    if (!/^(?:\d+|\d*\.\d{1,2})$/.test(s)) {
      if (/^-/.test(s)) return { error: '金额格式不正确，负号只能出现在开头' };
      if (/\.\d{3,}$/.test(s)) return { error: '金额最多保留两位小数（角、分）' };
      return { error: '金额格式不正确，请输入数字，例如 1234.56' };
    }

    var parts = s.split('.');
    var intStr = parts[0] || '0';
    var decStr = parts[1] || '';
    while (decStr.length < 2) decStr += '0';
    var intVal = parseInt(intStr, 10);
    if (!isFinite(intVal)) return { error: '金额过大，无法转换' };
    if (intVal + Number(decStr) / 100 >= MAX_AMOUNT) {
      return { error: '金额超出上限（需小于 1 万亿元），请拆分后再转换' };
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
      else if (fen > 0) res += '零';   // 角为 0、分不为 0 时补「零」
      if (fen > 0) res += D_UP[fen] + '分';
    }
    return { text: res };
  }

  /* ---------- 2. 阿拉伯数字 → 中文数字 ---------- */

  function numToCn(raw, upper) {
    var s = String(raw == null ? '' : raw).trim().replace(/[\s,，]/g, '');
    if (!s) return { error: '请输入需要转换的阿拉伯数字' };
    var neg = false;
    if (s.charAt(0) === '-') { neg = true; s = s.slice(1); }
    if (s.charAt(0) === '+') s = s.slice(1);
    if (!/^\d+$/.test(s)) return { error: '请输入纯阿拉伯数字，例如 1234' };
    if (s.length > 16) return { error: '数字过大，本工具支持转换到 16 位整数' };
    var n = parseInt(s, 10);
    if (!isFinite(n) || n >= MAX_INT) return { error: '数字过大，本工具支持转换到 16 位整数' };
    var digits = upper ? D_UP : D_LOW;
    var units = upper ? U_UP : U_LOW;
    var text = intToCn(n, digits, units);
    if (neg) text = '负' + text;
    return { text: text };
  }

  /* ---------- 3. 中文数字 → 阿拉伯数字 ---------- */

  function cnToNum(raw) {
    var s = String(raw == null ? '' : raw).trim().replace(/[\s,，]/g, '');
    if (!s) return { error: '请输入需要转换的中文数字' };
    var total = 0, section = 0, num = -1;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (Object.prototype.hasOwnProperty.call(CN_DIGIT, ch)) {
        if (num >= 0 && num >= 10) return { error: '「' + ch + '」位置不正确，数字字符不能连续出现在单位前' };
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
        return { error: '无法识别的字符「' + ch + '」，请只输入中文数字，例如 一千二百三十四' };
      }
    }
    var value = total + section + (num < 0 ? 0 : num);
    if (!isFinite(value) || value >= MAX_INT) return { error: '数值过大，本工具支持转换到 16 位整数' };
    return { text: String(value) };
  }

  /* ---------- 交互 ---------- */

  function renderSamples() {
    var mode = modeSel.value;
    examples.innerHTML = '<span>示例：</span>' + SAMPLES[mode].map(function (v) {
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
    FT.alert(tips, 'err', '<b>无法转换</b><p>' + FT.esc(msg) + '</p>');
    FT.toast(msg, 'err');
    resultBox.hidden = true;
    copyBtn.disabled = true;
    empty.hidden = false;
    summary.textContent = '转换失败';
  }

  function run() {
    tips.innerHTML = '';
    var mode = modeSel.value;
    var raw = srcInput.value;
    if (!String(raw).trim()) {
      fail(mode === 'cn2num' ? '请输入中文数字' : (mode === 'money' ? '请输入金额' : '请输入阿拉伯数字'));
      srcInput.focus();
      return;
    }

    FT.busyProgress(progress, '计算中…');
    FT.setBusy(runBtn, true, '转换中…');

    FT.nextFrame().then(function () {
      var res;
      var label = '';
      if (mode === 'money') {
        res = moneyUpper(raw);
        label = '金额 → 人民币大写';
        if (!res.error) {
          var clean = String(raw).trim().replace(/[\s,，、￥¥$]/g, '');
          var num = Number(clean);
          res.text = '小写：' + (isNaN(num) ? clean : '¥' + thousands(num.toFixed(2))) + '\n' +
                     '大写：' + res.text;
        }
      } else if (mode === 'num2cn') {
        res = numToCn(raw, upperSel.value === 'upper');
        label = '阿拉伯数字 → 中文数字（' + (upperSel.value === 'upper' ? '大写' : '小写') + '）';
      } else {
        res = cnToNum(raw);
        label = '中文数字 → 阿拉伯数字';
      }
      return { res: res, label: label, mode: mode };
    }).then(function (data) {
      if (data.res.error) { fail(data.res.error); return; }
      showResult(data.res.text, [
        { k: '转换模式', v: data.label },
        { k: '输入', v: String(srcInput.value).trim().slice(0, 24) },
        { k: '结果长度', v: data.res.text.length + ' 字' }
      ]);
      summary.textContent = '已完成 · ' + data.label;
      FT.setProgress(progress, 1, '完成');
      setTimeout(function () { FT.resetProgress(progress); }, 900);
    }).catch(function (err) {
      console.error(err);
      fail((err && err.message) || '转换过程出现异常');
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
    summary.textContent = '尚未开始转换';
    tips.innerHTML = '';
    FT.resetProgress(progress);
  });

  copyBtn.addEventListener('click', function () {
    if (!lastText) { FT.toast('还没有可复制的结果', 'err'); return; }
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
