// ==UserScript==
// @name         上岸村机考助手
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  上岸村机考系统增强：错题整理（笔记、划线批注、导出、组卷重练、补充题本、模考收录）与考试计时（倒计时暂停、逐题用时复盘）。
// @author       烨笙
// @license      MIT
// @match        https://pub.xdtech.top/mingshi/wxpage/tiku/gongan/index.html
// @match        https://pub.xdtech.top/*/wxpage/tiku/gongan/index.html
// @match        https://pub.xdtech.top/*/wxpage/tiku/gongan/index.html*
// @include      *://*.xdtech.top/*/wxpage/tiku/gongan/index.html*
// @match        https://pub.xdtech.top/mingshi/wxpage/tiku/mocks/index.html
// @match        https://pub.xdtech.top/*/wxpage/tiku/mocks/index.html
// @match        https://pub.xdtech.top/*/wxpage/tiku/mocks/index.html*
// @include      *://*.xdtech.top/*/wxpage/tiku/mocks/index.html*
// @match        https://pub.xdtech.top/mingshi/wxpage/tiku/gongan/zhuanxiang.html
// @match        https://pub.xdtech.top/*/wxpage/tiku/gongan/zhuanxiang.html*
// @include      *://*.xdtech.top/*/wxpage/tiku/gongan/zhuanxiang.html*
// @match        https://pub.xdtech.top/mingshi/wxpage/tiku/gongan/practice.html
// @match        https://pub.xdtech.top/*/wxpage/tiku/gongan/practice.html*
// @include      *://*.xdtech.top/*/wxpage/tiku/gongan/practice.html*
// @connect      pub.xdapi.top
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

// ===== 计时暂停：闸门与阀门 =====
(function () {
  'use strict';
  try {
  var CSS = [
    '.remain-time{width:auto!important}',
    '.gth-timer-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;',
    'height:30px;line-height:30px;padding:0 30px;margin-left:8px;border:0;border-radius:5px;',
    'background:#fff;color:#2178db;font-size:16px;cursor:pointer;vertical-align:middle;user-select:none}',
    '.gth-timer-btn .gth-timer-ic{width:18px;height:18px;flex:0 0 auto}',
    '.gth-timer-btn .gth-timer-ic svg{width:100%;height:100%;display:block}',
    '.gth-timer-btn:hover{background:#d8e9fa}',
    '.gth-timer-btn.paused{background:#f59e0b;color:#fff}',
    '.gth-timer-btn.paused:hover{background:#d97706}',
    '.remain-time.gth-paused a{color:#fde68a}',
    '.remain-time.gth-paused a::after{content:"（已暂停）";font-size:13px}',
    '.remain-time.gth-timer-no a{text-decoration:underline dotted #dc2626 2px;text-underline-offset:4px}'
  ].join('');

  var TIMER_ICONS = {
    pause: '<rect x="5" y="3" width="5" height="18" rx="1"/><rect x="14" y="3" width="5" height="18" rx="1"/>',
    play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>'
  };

  function timerIcon(name) {
    var d = TIMER_ICONS[name];
    if (!d) return '';
    return '<span class="gth-timer-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg></span>';
  }

  var paused = false;
  var noFreeze = '';
  var givenUp = false;
  var scope = null;
  var restored = false;
  var ngSrc = '';
  var ngErr = '';
  var scopeCount = 0;
  var valveOn = 0;
  var valveWanted = 0;
  var holdSeen = null;
  var warned = '';
  var storeErr = '';
  var lastSig = '';
  var frozenText = '';
  var domTimer = null;
  var running = false;
  var lastTotal = -1;

  var SID = '';
  try { SID = new URLSearchParams(location.search).get('submit_id') || ''; } catch (e) { SID = ''; }
  var LS_KEY = 'gth_timer_paused_' + (SID || location.pathname);
  var CTX = location.pathname.split('/')[1] || 'mingshi';
  var QTIME_KEY = 'gth_qtime_' + CTX;
  var EXAM = '';
  var rec = null;
  var recTick = 0;
  var recErr = '';

  function errName(e) { return e && e.name ? e.name : String(e); }

  function hashQuery() {
    var h = String(location.hash || '');
    var i = h.indexOf('?');
    return i < 0 ? '' : h.slice(i + 1);
  }

  function siteParam(name) {
    var out = '';
    try {
      out = new URLSearchParams(location.search).get(name) || '';
      var fromHash = new URLSearchParams(hashQuery()).get(name);
      if (fromHash) out = fromHash;
    } catch (e) { out = ''; }
    return out || '';
  }

  function freezablePage() {
    var path = String(location.pathname || '');
    if (/\/zhuanxiang\.html$/.test(path)) return true;
    if (/\/practice\.html$/.test(path)) return siteParam('page_type') === 'random';
    return false;
  }

  function timerStore(v) {
    try {
      if (v) localStorage.setItem(LS_KEY, '1');
      else localStorage.removeItem(LS_KEY);
      storeErr = '';
    } catch (e) { storeErr = '本地存储写不进（暂停状态刷新后不保留）：' + errName(e); }
  }
  function stored() {
    try { return localStorage.getItem(LS_KEY) === '1'; }
    catch (e) { storeErr = '本地存储读不出（当作未暂停）：' + errName(e); return false; }
  }

  function timerPad2(x) { return (x < 10 ? '0' : '') + x; }
  function hms(n) {
    if (typeof n !== 'number' || !(n >= 0)) return '--:--:--';
    return timerPad2(Math.floor(n / 3600)) + ':' + timerPad2(Math.floor(n % 3600 / 60)) + ':' + timerPad2(n % 60);
  }

  function pickNg(w) {
    return (w && w.angular && typeof w.angular.element === 'function') ? w.angular : null;
  }

  function pageNg() {
    var wins = [
      ['window', typeof window === 'undefined' ? null : window],
      ['unsafeWindow', typeof unsafeWindow === 'undefined' ? null : unsafeWindow]
    ];
    var i, ng = null;
    for (i = 0; i < wins.length; i++) {
      ng = pickNg(wins[i][1]);
      if (ng) { ngSrc = wins[i][0]; ngErr = ''; return ng; }
    }
    if (typeof angular !== 'undefined' && angular && typeof angular.element === 'function') {
      ngSrc = 'angular';
      ngErr = '';
      return angular;
    }
    ngSrc = '';
    return null;
  }

  function eachTimerScope(fn) {
    var ng = pageNg();
    scopeCount = 0;
    if (!ng) { ngErr = 'window / unsafeWindow / 裸 angular 三条路上都没有 angular'; return false; }
    var root;
    try { root = ng.element(document.body).injector().get('$rootScope'); }
    catch (e) { ngErr = '拿不到 $rootScope：' + (e && e.message ? e.message : String(e)); return false; }
    if (!root) { ngErr = '$rootScope 是空的'; return false; }
    var seen = new WeakSet();
    (function walk(s) {
      if (!s || seen.has(s)) return;
      seen.add(s);
      if (Object.prototype.hasOwnProperty.call(s, 'localStorage') && s.localStorage &&
        typeof s.localStorage === 'object' && ('allInterval' in s || 'partInterval' in s)) {
        fn(s);
        scopeCount++;
      }
      for (var c = s.$$childHead; c; c = c.$$nextSibling) walk(c);
    })(root);
    if (!scopeCount) ngErr = '页面上没有 localStorage + allInterval 形状的计时器 scope';
    return scopeCount > 0;
  }

  function guard(obj, key) {
    if (!obj || typeof obj !== 'object' || !(key in obj)) return '';
    var d = Object.getOwnPropertyDescriptor(obj, key);
    if (!d) return '';
    if (d.get) return 'on';
    if (!d.configurable) return '';
    var cur = obj[key];
    Object.defineProperty(obj, key, {
      configurable: true,
      enumerable: true,
      get: function () { return cur; },
      set: function (v) { if (!paused) cur = v; }
    });
    return 'new';
  }

  function mainValve() {
    var ls = scope && scope.localStorage;
    if (!ls) return false;
    var d = Object.getOwnPropertyDescriptor(ls, 'totalTime');
    return !!(d && d.get);
  }

  function installGuards() {
    var scopes = [];
    if (scope) scopes.push(scope);
    eachTimerScope(function (s) { scopes.push(s); });
    var seenS = new WeakSet();
    valveOn = 0;
    valveWanted = 0;
    scopes.forEach(function (s) {
      if (!s || seenS.has(s)) return;
      seenS.add(s);
      var ls = s.localStorage || {};
      var pairs = [[ls, 'totalTime']];
      (ls.partData || []).forEach(function (p) {
        pairs.push([p, 'remainTime']);
      });
      pairs.forEach(function (pair) {
        valveWanted++;
        if (guard(pair[0], pair[1])) valveOn++;
      });
    });
    return valveOn;
  }

  function holdReason() {
    var ls = scope && scope.localStorage;
    if (!ls) return '页面计时器 scope 不在了';
    if (!mainValve()) return '阀门没挂在 totalTime 上';
    var v = ls.totalTime;
    if (typeof v !== 'number') return 'totalTime 不是数字';
    if (holdSeen !== null && v !== holdSeen) return '暂停期间 totalTime 仍在变，还有第二条时钟';
    holdSeen = v;
    return '';
  }

  function markHost(why) {
    var old = btn();
    if (old) old.remove();
    var host = timerHost();
    if (!host) return;
    host.classList.remove('gth-paused');
    host.classList.add('gth-timer-no');
    host.title = '这一页停不住：' + why + '　·　' + diag();
  }

  function clearHost() {
    var host = timerHost();
    if (!host) return;
    host.classList.remove('gth-timer-no');
    host.classList.remove('gth-paused');
    if (String(host.title || '').indexOf('这一页停不住') === 0) host.title = '';
  }

  function failHold(why) {
    var foundTimer = scopeCount > 0;
    release();
    if (warned !== why) {
      warned = why;
      console.warn('[计时暂停] ' + why + (foundTimer ? '（按钮已摘掉，这一页不再尝试）' : ''));
    }
    if (!foundTimer) {
      lastSig = '';
      render();
      return;
    }
    givenUp = true;
    noFreeze = why;
    markHost(noFreeze);
  }

  function release() {
    paused = false;
    holdSeen = null;
    freezeDom(false);
    timerStore(false);
  }

  function applyPause(on) {
    if (!on) {
      release();
      render();
      return;
    }
    paused = true;
    holdSeen = null;
    if (!scope) scope = findScope();
    installGuards();
    noFreeze = holdReason();
    if (noFreeze) {
      failHold(noFreeze);
      return;
    }
    freezeDom(true);
    timerStore(true);
    flushRec();
    render();
  }

  function btn() { return document.querySelector('.gth-timer-btn'); }

  function timerHost() {
    return document.querySelector('.operation-dati .remain-time') ||
      document.querySelector('.remain-time');
  }

  function usedText() {
    var ls = scope && scope.localStorage;
    var e = ls ? ls.elapsed_time : -1;
    return hms(typeof e === 'number' ? e : -1);
  }

  function recText() {
    if (!timerIsZyPage()) return '';
    if (!EXAM) return '分场:URL 上没有 exam_id（本场不记用时）';
    return '本场已记 ' + hms(recSum(rec)) +
      (rec && rec.paused ? '（其中暂停 ' + hms(rec.paused) + '，已算在各题头上）' : '') +
      (rec && rec.lost ? ' · 未归属 ' + rec.lost + ' 秒' : '') +
      (rec && rec.merged ? ' · 已并入别的标签 ' + rec.merged + ' 秒' : '') +
      (recErr ? ' · ' + recErr : '');
  }

  function diag() {
    var s = '取页:' + (ngSrc || '没拿到');
    if (ngErr) s += '（' + ngErr + '）';
    s += ' · 计时器' + scopeCount + '台 · 阀门' + valveOn + '/' + valveWanted;
    s += ' · 已用 ' + usedText();
    if (paused) s += ' · 冻在 ' + hms(holdSeen);
    if (storeErr) s += ' · ' + storeErr;
    var r = recText();
    if (r) s += ' · ' + r;
    return s;
  }

  function label() {
    return paused ? timerIcon('play') : timerIcon('pause');
  }

  function tip() {
    return (paused ? '已冻结，可以放心离开' : '点这里冻结计时') + '　·　' + diag();
  }

  function pausedClass() { return !!(paused && !noFreeze); }

  function render() {
    var b = btn();
    if (!b) return;
    var host = timerHost();
    var sig = [paused ? '1' : '0', noFreeze, host ? 'h' : '-', pausedClass() ? 'p' : '-', diag()].join('|');
    if (sig === lastSig) return;
    lastSig = sig;
    b.className = 'gth-timer-btn' + (paused ? ' paused' : '');
    b.innerHTML = label();
    b.title = tip();
    if (host) host.classList.toggle('gth-paused', pausedClass());
  }

  function ensureBtn() {
    var host = timerHost();
    if (!host) return;
    var b = btn();
    if (b) {
      if (b.parentNode !== host) host.appendChild(b);
      return;
    }
    b = document.createElement('button');
    b.type = 'button';
    b.className = 'gth-timer-btn';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      applyPause(!paused);
    });
    host.appendChild(b);
    lastSig = '';
  }

  function remainAnchor() { return document.querySelector('.remain-time a'); }

  function remainText() {
    var a = remainAnchor();
    return a ? (a.textContent || '') : '';
  }

  function timeTextNode() {
    var a = remainAnchor();
    if (!a) return null;
    var i, c;
    for (i = 0; i < a.childNodes.length; i++) {
      c = a.childNodes[i];
      if (c.nodeType === 3 && /\d{1,2}:\d{2}:\d{2}/.test(c.nodeValue)) return c;
    }
    for (i = 0; i < a.childNodes.length; i++) {
      c = a.childNodes[i];
      if (c.nodeType === 3) return c;
    }
    return null;
  }

  function freezeDom(on) {
    if (domTimer) { clearInterval(domTimer); domTimer = null; }
    frozenText = '';
    if (!on) return;
    var n = timeTextNode();
    if (!n) return;
    frozenText = n.nodeValue;
    domTimer = setInterval(function () {
      var nn = timeTextNode();
      if (nn && frozenText && nn.nodeValue !== frozenText) nn.nodeValue = frozenText;
    }, 150);
  }

  function domSeconds() {
    var m = remainText().match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) return -1;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  }

  function findScope() {
    var want = domSeconds();
    var best = null;
    var bestScore = -1;
    eachTimerScope(function (s) {
      var t = s.localStorage.totalTime;
      var score = 0;
      if (typeof t === 'number') {
        if (want >= 0 && Math.abs(t - want) <= 2) score = 1e6;
        else if (want >= 0) score = 1e5 - Math.min(Math.abs(t - want), 9999);
        else score = t;
      }
      if (score > bestScore) { best = s; bestScore = score; }
    });
    return best;
  }

  function live() {
    var s = scope;
    var t = (s && s.localStorage) ? s.localStorage.totalTime : -1;
    if (s && lastTotal >= 0 && typeof t === 'number' && t < lastTotal) running = true;
    lastTotal = typeof t === 'number' ? t : -1;
    var parentAllTime = s && s.$parent && typeof s.$parent.allTime === 'string' ? s.$parent.allTime : '';
    var segs = remainText().match(/(\d{1,2}:\d{2}:\d{2})/g) || [];
    var domLive = segs.some(function (seg) { return seg !== '00:00:00'; });
    return running || !!(s && s.allInterval) ||
      (typeof t === 'number' && t > 60) ||
      (parentAllTime.length > 0 && !/00:00:00/.test(parentAllTime)) ||
      domLive;
  }

  function timerIsZyPage() { return /\/zhuanxiang\.html$/.test(String(location.pathname || '')); }

  function newRec() { return { q: {}, paused: 0, lost: 0, merged: 0 }; }

  function recSum(r) {
    if (!r) return 0;
    // 暂停的秒数已经记在各题头上了（那是墙上时间），paused 只作展示——再加一次就是双计
    var n = r.lost || 0;
    Object.keys(r.q || {}).forEach(function (k) { n += r.q[k] || 0; });
    return n;
  }

  function readRec() {
    var all = {};
    try { all = JSON.parse(localStorage.getItem(QTIME_KEY) || '{}') || {}; }
    catch (e) { recErr = '用时记录读不出（这一场从头记）：' + errName(e); }
    var r = all[EXAM];
    if (!r || typeof r !== 'object') return newRec();
    if (!r.q || typeof r.q !== 'object') r.q = {};
    if (typeof r.paused !== 'number') r.paused = 0;
    if (typeof r.lost !== 'number') r.lost = 0;
    if (typeof r.merged !== 'number') r.merged = 0;
    return r;
  }

  function mergeUp(target, key, val) {
    if (!(typeof val === 'number' && val > (target[key] || 0))) return 0;
    var d = val - (target[key] || 0);
    target[key] = val;
    return d;
  }

  function flushRec() {
    if (!EXAM || !rec) return;
    var all = {}, raised = 0;
    try { all = JSON.parse(localStorage.getItem(QTIME_KEY) || '{}') || {}; }
    catch (e) { all = {}; }
    var disk = all[EXAM];
    if (disk && typeof disk === 'object') {
      if (!rec.q || typeof rec.q !== 'object') rec.q = {};
      Object.keys(disk.q || {}).forEach(function (k) { raised += mergeUp(rec.q, k, disk.q[k]); });
      raised += mergeUp(rec, 'paused', disk.paused);
      raised += mergeUp(rec, 'lost', disk.lost);
    }
    if (raised) rec.merged = (rec.merged || 0) + raised;
    all[EXAM] = rec;
    try { localStorage.setItem(QTIME_KEY, JSON.stringify(all)); recErr = ''; }
    catch (e) { recErr = '用时记不进本地存储（复盘会有缺口）：' + errName(e); }
  }

  function currentQid() {
    var ls = scope && scope.localStorage;
    if (!ls || !ls.currentPartData) return '';
    var list = ls.currentPartData.subjectList || [];
    var i, it;
    for (i = 0; i < list.length; i++) {
      it = list[i];
      if (it && it.index === ls.currentIndex && (it.id || it.id === 0)) return String(it.id);
    }
    return '';
  }

  // 一秒落到哪一个记账单位上：认得出当前题就记在它头上，认不出就落 lost（不许猜给上一题）
  function tallySecond(r, id) {
    if (id) r.q[id] = (r.q[id] || 0) + 1;
    else r.lost = (r.lost || 0) + 1;
  }

  function recordSecond() {
    if (!EXAM || !timerIsZyPage() || !scope || !scope.allInterval || scope.isAlreadySubmit) return;
    if (!rec) rec = readRec();
    // 暂停期间的那一秒照样属于「这一屏这道题」：用户要的是真实用时，离开两分钟就是两分钟。
    // paused 那只表仍然走，但只用于展示「其中暂停了多久」，不再从各题头上扣出去（ADR 0007 决策 2）
    if (paused && !noFreeze) rec.paused++;
    tallySecond(rec, currentQid());
    recTick++;
    if (recTick % 5 === 0) flushRec();
  }

  function tick() {
    var s = findScope();
    if (s !== scope) {
      scope = s;
      restored = false;
      running = false;
      lastTotal = -1;
      holdSeen = null;
    }
    if (scope && scope.$$destroyed) { scope = null; restored = false; }
    if (scope && scope.isAlreadySubmit) {
      if (paused || stored()) release();
      noFreeze = '';
      clearHost();
      flushRec();
      var old = btn();
      if (old) old.remove();
      return;
    }
    recordSecond();
    if (!timerHost()) return;
    if (givenUp) {
      markHost(noFreeze);
      return;
    }
    ensureBtn();
    var isLive = live();
    render();
    if (!isLive) return;
    if (!restored) {
      restored = true;
      if (stored()) applyPause(true);
    }
    if (paused) {
      installGuards();
      noFreeze = holdReason();
      if (noFreeze) failHold(noFreeze);
    }
    render();
  }

  if (!freezablePage()) return;

  EXAM = siteParam('exam_id');

  var st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  tick();
  setInterval(tick, 1000);
  } catch (e) {
    console.warn('[计时暂停] 初始化失败：' + (e && e.message ? e.message : String(e)));
  }
})();

// ===== 机考助手：错题 · 笔记 · 补充题本 · 模考 =====
(function () {
  'use strict';
  try {

  // 助手这半只在自己这几条路上动手：站点两个列表（含模考 SPA）与专项页。
  // 其余被 @match 到的页面（今天是 practice.html）归计时那半，助手一个节点都不建——
  // body 上那只 400ms 观察器就挂在下面，漏到答题页上等于考试中多跑几千行（ADR 0008 决策 7）。
  function helperOwnPage() {
    var p = String(location.pathname || '');
    if (/\/index\.html$/.test(p)) return true;
    if (/\/zhuanxiang\.html$/.test(p)) return true;
    return false;
  }
  if (!helperOwnPage()) return;

  console.log('[错题助手] 脚本已注入：' + location.href);

  var CTX = location.pathname.split('/')[1] || 'mingshi';
  var API_BASE = 'https://pub.xdapi.top/' + CTX + '/api/v1/tiku/gongan/';
  var API_V2 = 'https://pub.xdapi.top/' + CTX + '/api/v2/';
  var LS_STORE = 'gongan_tiku_helper_' + CTX;
  var LS_TOKEN = 'token_gongan_' + CTX;
  var LS_LOGIN = 'login_status_' + CTX;

  var SUBJ_ZY = 1;
  var SUBJ_XC = 0;
  var SUBJECT_NAME = {};
  SUBJECT_NAME[SUBJ_ZY] = '公安专业知识';
  SUBJECT_NAME[SUBJ_XC] = '行政职业能力测试';

  var DAY_RANGES = [['0', '当天'], ['1', '本周'], ['2', '本月'], ['3', '近三月'], ['4', '全部']];
  var SITE_LIST_CAP = 4800;
  var MASTER_STREAK = 2;

  var KEYACT = '.gth-menu-item,.gth-chip,.gth-badge,.gth-aside-hl-t,.gth-aside-empty,.gth-balloon,' +
    '.gth-hlp-item .t,.gth-hlp-item .n,.gth-hlp-item .rm,.gthq-cell,.gth-choice,.gth-btext,.gthq-btn,' +
    'mark.gth-hl,#gth-mock-btn';

  var EXPORT_HEADERS = ['序号', '科目', '来源', '材料', '题干', '选项', '你的答案', '正确答案', '答错次数', '解析', '笔记', '划线摘录', '掌握状态', '题目ID'];
  var XLSX_WIDTHS = [6, 16, 12, 30, 60, 50, 10, 10, 10, 60, 40, 40, 14, 12];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function imgSrc(tag) {
    var m = /\s(?:src|data-src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    var url = (m && (m[1] || m[2] || m[3])) || '';
    if (url && /^\/\//.test(url)) url = location.protocol + url;
    if (url && !/^[a-z]+:/i.test(url)) {
      try { url = new URL(url, location.href).href; } catch (e) {}
    }
    return url;
  }

  function htmlToText(s, keepImg) {
    var t = String(s == null ? '' : s)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n');
    if (keepImg) {
      t = t.replace(/<img\b[^>]*>/gi, function (tag) {
        var url = imgSrc(tag);
        if (!url) return '';
        var alt = (/\salt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag) || [])[1] || '图片';
        return ' ![' + alt + '](' + url + ') ';
      });
    }
    return t
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function stripHtml(s) { return htmlToText(s, false); }

  // 一张图该不该缩到和文字一样大，问的是「它在句子里扮演什么角色」，不是「它什么形状」。
  // 公式是句子的一部分（等号后面、单位前面），图是句子指向的东西（如下图所示）。
  // 形状只是公式的副产物——所以**身份那一问**不许拿宽高比当主判据，判竖着的柱状图与
  // 横着的多行表格都会判错。**尺寸那一问**（要缩的这枚占几行）反过来只能靠形状：
  // 读不到图里的内容，而行数就是式子的框高除以字号。两问不共用一条依据，别当成矛盾。
  // 文字语义定不下来的那两格（材料里的图、独占一段的图）才轮到形状兜底身份，且一律 keep。
  //
  // 「前后文字」按 DOM 顺序取，跳过 <br> 与内联包裹（<span>/<font>/<b>）：
  // 编辑器爱把字包起来，只认 nodeType 3 的紧邻兄弟会漏掉一半排版（br 隔开与 span 包字那两条）。
  // 不跨块取——祖先的 textContent 会把隔了几层的正文算进来，独占一行的统计表就被误压成一行高。
  var IMG_INLINE_TEXT = 8;
  // 两边都有字就认它是句中的图，不必每边都攒够八个字：「气温经常在[0℃]上下波动」这种
  // 前文只有五个字（用户 10-09 晚第二张截图），按八个字判就掉到形状兜底里去了。
  var IMG_BOTH_SIDES = 2;
  // 这两道字数字槛不能撤：「见 [统计图] 可知」那种把图形夹在两个字中间的写法，
  // 撤到各一个字就把 800x400 的统计表压成 78x39（用户 10-11 那道题上实测对照过）。
  // 认出「这是式子」之后，缩到几行高才轮到形状：一枚式子的框高 = 行数 × 渲染字号，
  // 而行数读不到，只能拿宽高比与绝对高度凑三道门。本题 11 枚真图实测：
  // 单行式子 62–76 高（ratio 2.9–10）、分式 142 高（ratio 0.67–1.44）、两行宽式 251 高、
  // 竖式 434x165（ratio 2.6，前两道门都放行，靠第三道门收回来）。
  // 已知代价：120–200 高而 ratio<3 的单行式子会被给到两行高——比一行大 19px，仍远小于旧口径。
  var IMG_2LINE_RATIO = 2;
  var IMG_2LINE_TALL = 200;
  var IMG_2LINE_MID = 120;
  var IMG_2LINE_MID_RATIO = 3;

  // 领起词：这句在介绍一张图，那图就保持原尺寸。**必须贴在图前面**（整条尾锚）：
  // 「如图所示，边长为50米的等边三角形…」里那句是段首引述，不锚住尾巴就会把同段
  // 后面每一枚行内式子都当成图放过去（用户 10-11 那道题的第一枚就是这样原样 293x62）。
  // 尾锚顺带管住「如下图可知」那类引述——那句结尾是「可知」，不命中，不必再拆成函数判。
  var IMG_LEAD = /(?:如[下上]?[图表](?:所示)?|[图表]所示|饼图|柱状图|条形图|折线图|示意图|统计图|统计表)[，,、：:]*$/;

  function imgIsLead(before) {
    return IMG_LEAD.test(before);
  }
  // 运算符结尾：等号/冒号/「为」收尾，后面接的是式子
  var IMG_OP_TAIL = /[=＝:：是为约×÷+\-]\s*$/;
  // 续写开头：单位与标点开头，图后面那半句是接着这张式子说的
  var IMG_CONT = /^[\s]*(?:亿元|万元|元|倍|个|人|次|天|月|年|日|％|%|，|。|、|；|则|故|所以|因此|可见)/;

  function imgNeighborText(el, dir) {
    var n = dir < 0 ? el.previousSibling : el.nextSibling;
    while (n) {
      if (n.nodeType === 3) {
        var s = String(n.nodeValue || '');
        if (s.replace(/\s+/g, '')) return s;
      } else if (n.nodeType === 1 && !/^(BR|IMG)$/.test(n.nodeName)) {
        var t = String(n.textContent || '');
        if (t.replace(/\s+/g, '')) return t;
      }
      n = dir < 0 ? n.previousSibling : n.nextSibling;
    }
    return '';
  }

  // 文字语义这一层只答「式子还是图」——缩到几行是下一层按形状问的，两件事不混在这里。
  // 返回 'math'（句子里的式子，要缩）| 'figure'（句子指向的图，原样）| null（文字说不清，交给形状）
  function imgTextRole(el) {
    var before = imgNeighborText(el, -1).replace(/\s+/g, '');
    var after = imgNeighborText(el, 1).replace(/\s+/g, '');
    if (!before && !after) return null;
    if (imgIsLead(before)) return 'figure';
    if (IMG_OP_TAIL.test(before)) return 'math';
    if (IMG_CONT.test(after)) return 'math';
    // 两边都顶着字，它在句子中间。够长的按式子算（分式两侧各有一截字）；
    // 两边都不长的多是句中一个数字或符号（图里就写着 360°、0℃ 那类）。
    if (before.length >= IMG_INLINE_TEXT && after.length >= IMG_INLINE_TEXT) return 'math';
    if (before.length >= IMG_BOTH_SIDES && after.length >= IMG_BOTH_SIDES) return 'math';
    return null;
  }

  // 图自己独占一块时，领起词常在**上一段**里（「…</p><p>如下图所示：</p><p><img></p>」），
  // 中间有时还隔一层 <div>。所以逐层往上找，每层都扫紧邻的前兄弟。
  // 只看紧邻块、不读祖先的 textContent——那会把隔了几层的正文算进来，统计表就被误压成一行高。
  // 停手条件是「再往上一层就出了这一屏内容区」，而不是「当前节点在内容区里」：
  // 图自己那个 <p> 也在内容区里，差一层就停会永远看不到上一段（隔一层 <div> 时必漏）。
  function imgLeadNearby(el) {
    var box = el.parentElement;
    var host = el.closest ? el.closest(IMG_TEXT_HOST) : null;
    for (var up = 0; box && box !== host && up < 4; up++) {
      var n = box.previousSibling;
      while (n) {
        if (n.nodeType === 3) {
          if (imgIsLead(String(n.nodeValue || '').replace(/\s+/g, ''))) return true;
        } else if (n.nodeType === 1 && !/^BR$/.test(n.nodeName)) {
          if (imgIsLead(String(n.textContent || '').replace(/\s+/g, ''))) return true;
        }
        n = n.previousSibling;
      }
      box = box.parentElement;
    }
    return false;
  }

  // 站点自己不给内容区的 img 定尺寸（样式表里 .content img / .analysis img 一条都没有），
  // 所以公式图在站点原生那一屏上同样过大——这里连站点渲染的图一起管。
  // 带 dataset 比对：它在 400ms 观察器的射程里，无脑重写 class 就是每轮喂一次属性变更。
  function fitImgs(root) {
    $$('img', root || document).forEach(function (el) {
      var role = imgFitRole(el);
      if (el.dataset && el.dataset.gthFit === role) return;
      if (el.dataset) el.dataset.gthFit = role;
      el.classList.toggle('gth-img-1line', role === '1line');
      el.classList.toggle('gth-img-2line', role === '2line');
    });
  }

  // 材料里的图是题目本身（统计表、统计图），一个像素都不许动，先于一切判据豁免。
  var IMG_MATERIAL_HOST = '.gthq-material,.material';
  // 往上找领起词时到此为止，别跨出这一屏内容区
  var IMG_TEXT_HOST = '.gthq-material,.material,.gthq-stem,.stem,.gthq-opts,.options,' +
    '.gthq-analysis,.analysis,.gth-note-text,.gth-aside,.gth-apanel';
  var IMG_FORMULA_HOST = '.gthq-analysis,.analysis,.gth-note-text,.gth-aside,.gth-apanel';
  var IMG_FRACTION_HOST = '.gthq-stem,.stem,.gthq-opts,.options';
  var IMG_FORMULA_RATIO = 2.2;

  // '1line'（与文字同大）| '2line'（分式与竖式那种两行高的式子）| ''（原样）
  function imgFitRole(el) {
    if (!el.closest) return '';
    if (el.closest(IMG_MATERIAL_HOST)) return '';
    var role = imgTextRole(el);
    if (role === 'figure') return '';
    if (role) return imgSizeRole(el);
    // 文字说不清：先看上一段有没有领起词（「如下图所示：」「如下表：」）——有就是一张图
    if (imgLeadNearby(el)) return '';
    // 还没有文字也没有领起词：这枚图自己独占一块。
    // 选项与题干里，竖着的才是式子（整张选项就是一张分式，用户 10-09 第二张截图），
    // 横着的多半是统计表——那里放一张表是常事，原样留着。
    // 解析与笔记那一屏两种都有：竖式与两行宽公式都收，统计图与表格原样。
    if (!el.naturalHeight) return '';
    var tall = el.naturalHeight > el.naturalWidth;
    if (el.closest(IMG_FRACTION_HOST)) return tall ? imgSizeRole(el) : '';
    if (!el.closest(IMG_FORMULA_HOST)) return '';
    return (tall || el.naturalWidth >= el.naturalHeight * IMG_FORMULA_RATIO) ? imgSizeRole(el) : '';
  }

  // 该缩的图按「它占几行」定高：定高而不是封顶——封顶对本来就没到顶的图是空操作，
  // 110x60 那枚判成两行也照样不动，那正是旧口径里「判对了还是大」的一半来源。
  // 拿不到 intrinsic 尺寸（还没加载完）时返回空串，这一轮不动它，load 事件会再扫一遍。
  function imgSizeRole(el) {
    var w = el.naturalWidth || 0, h = el.naturalHeight || 0;
    if (!h) return '';
    if (w < h * IMG_2LINE_RATIO || h > IMG_2LINE_TALL ||
      (h > IMG_2LINE_MID && w < h * IMG_2LINE_MID_RATIO)) return '2line';
    return '1line';
  }

  var fitImgsSoon = debounce(function () { fitImgs(document.body); }, 150);

  // 图片加载不产生 childList 变化，400ms 观察器叫不动它；不补这一句，晚加载的公式图永远判不到
  document.addEventListener('load', function (e) {
    if (e.target && e.target.tagName === 'IMG') fitImgsSoon();
  }, true);

  var imgZoomEl = null;

  function closeImgZoom() { if (imgZoomEl) imgZoomEl.hidden = true; }

  function openImgZoom(src) {
    if (!src) return;
    if (!imgZoomEl) {
      imgZoomEl = document.createElement('div');
      imgZoomEl.id = 'gth-imgzoom';
      imgZoomEl.innerHTML = '<img alt="原图">';
      imgZoomEl.addEventListener('click', closeImgZoom);
      document.body.appendChild(imgZoomEl);
    }
    $('img', imgZoomEl).src = src;
    imgZoomEl.hidden = false;
  }

  // 被压小的式子点一下看原尺寸：这是「认错了也不把人堵死」的那一步退路
  // 两档都算缩过：gth-img-1line（行内式）与 gth-img-2line（分式与竖式）
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' &&
      (t.classList.contains('gth-img-2line') || t.classList.contains('gth-img-1line'))) {
      openImgZoom(t.getAttribute('src') || t.getAttribute('data-src') || '');
    }
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeImgZoom();
  });

  function wakeImgs(html) {
    return String(html == null ? '' : html)
      .replace(/<img\b([^>]*?)data-src=/gi, '<img$1src=')
      .replace(/<img\b([^>]*?)\sloading="lazy"/gi, '<img$1');
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  // 复制的反馈只有一种说法：四颗复制键都走这里，成了在页面底部说一句，没成说没成。
  // （各键原先各写各的：「已复制」「已复制到剪贴板」，还有两颗什么也不说）
  function copyWithToast(text) {
    var ok = copyText(text);
    toast(ok ? '复制成功' : '复制失败：浏览器没让脚本写剪贴板');
    return ok;
  }

  function copyQuestion(q) {
    var lines = [];
    lines.push(htmlToText(q.content || '', true));
    if (q.material) lines.push('', '【材料】', htmlToText(q.material, true));
    lines.push('', '【选项】');
    (q.opt || []).forEach(function (o) {
      lines.push(o.label + '. ' + htmlToText(o.content || '', true));
    });
    var an = analysisOf(q);
    if (an) lines.push('', '【解析】', htmlToText(an, true));
    return lines.join('\n');
  }

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtTime(ms) {
    var s = Math.floor(ms / 1000);
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }
  function fmtAgo(ts) {
    if (!ts) return '';
    var d = (Date.now() - ts) / 1000;
    if (d < 60) return Math.floor(d) + ' 秒前';
    if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
    if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
    return Math.floor(d / 86400) + ' 天前';
  }
  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      '_' + pad2(d.getHours()) + pad2(d.getMinutes());
  }
  function download(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  var LUCIDE = {
    x:           '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    pencil:      '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    trash:       '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    save:        '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
    download:    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    upload:      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    fileText:    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    fileSheet:   '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>',
    fileJson:    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M8 17l2-2-2-2"/><path d="M12 17h2"/>',
    play:        '<polygon points="6 3 20 12 6 21 6 3"/>',
    rotate:      '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    listChecks:  '<path d="m3 17 2 2 4-4"/><path d="m3 5 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    clock:       '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    hash:        '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
    database:    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/>',
    bookOpen:    '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    search:      '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/>',
    warn:        '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>',
    checkCircle: '<circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 16 9"/>',
    xCircle:     '<circle cx="12" cy="12" r="10"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/>',
    arrowLeft:   '<line x1="19" x2="5" y1="12" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    arrowRight:  '<line x1="5" x2="19" y1="12" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    chevronDown: '<polyline points="6 9 12 15 18 9"/>',
    chevronUp:   '<polyline points="18 15 12 9 6 15"/>',
    eye:         '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    sparkles:    '<path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 1-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"/>',
    copy:        '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    check:       '<polyline points="20 6 9 17 4 12"/>',
    highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4z"/>',
    underline:   '<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>',
    quote:       '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>',
    scissors:    '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" x2="8.12" y1="4" y2="15.5"/><line x1="14.47" x2="20" y1="14.48" y2="20"/><line x1="8.12" x2="12" y1="15.5" y2="17"/>',
    // 重练那颗暂停键与站点那颗同源；star 是空心，正好是站点「标记」那颗 ☆ 的样子
    pause:       '<path d="M9 4v16"/><path d="M15 4v16"/>',
    star:        '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>'
  };

  function icon(name) {
    var d = LUCIDE[name];
    if (!d) return '';
    return '<span class="gth-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg></span>';
  }

  var store = (function () {
    var data;
    try { data = JSON.parse(localStorage.getItem(LS_STORE)) || {}; } catch (e) { data = {}; }
    if (!data.notes) data.notes = {};
    if (!data.mastered) data.mastered = {};
    if (!data.wrongCount) data.wrongCount = {};
    if (!data.exported) data.exported = {};
    if (!data.history) data.history = [];
    if (!data.resume) data.resume = {};
    if (!data.highlights) data.highlights = {};
    if (!data.mockQs) data.mockQs = {};
    if (!data.mocks) data.mocks = {};
    if (!data.practiced) data.practiced = {};
    if (!data.qModule) data.qModule = {};
    if (!data.qSrc) data.qSrc = {};
    if (!data.snaps) data.snaps = {};
    if (!data._v) data._v = 1;
    migrateExported(data);
    var hlLostCleared = migrateHlLost(data);
    if (hlLostCleared) console.log('[错题助手] 已撤掉 ' + hlLostCleared + ' 条误判的「划线已失效」标记');
    return data;
  })();

  function migrateExported(data) {
    var ex = data.exported;
    if (!ex || typeof ex !== 'object' || Array.isArray(ex) || ex._v !== 2) {
      var conv = {};
      if (ex && typeof ex === 'object' && !Array.isArray(ex)) {
        Object.keys(ex).forEach(function (k) { if (k !== '_v') conv[k] = 1; });
      }
      data.exported = { _v: 2, error: conv, favorite: {}, both: {}, mock: {}, book: {} };
    }

    if (!data.exported.mock) data.exported.mock = {};
    if (!data.exported.book) data.exported.book = {};
    var at = data.exportAt;
    if (!at || typeof at !== 'object') {
      data.exportAt = { error: Number(at) || 0, favorite: 0, both: 0, mock: 0, book: 0 };
    } else {
      data.exportAt = {
        error: at.error || 0, favorite: at.favorite || 0, both: at.both || 0,
        mock: at.mock || 0, book: at.book || 0
      };
    }
    return data;
  }

  function washHlLost(highlights) {
    var n = 0;
    Object.keys(highlights || {}).forEach(function (qid) {
      var list = highlights[qid];
      if (!Array.isArray(list)) return;
      list.forEach(function (rec) {
        if (rec && rec.lost && rec.block === 'analysis') { delete rec.lost; delete rec.miss; n++; }
      });
    });
    return n;
  }

  function migrateHlLost(data) {
    if (data.hlLostMigrated) return 0;
    data.hlLostMigrated = 1;
    return washHlLost(data.highlights);
  }

  function mergeConcurrent(data) {
    var fresh;
    try { fresh = JSON.parse(localStorage.getItem(LS_STORE) || ''); } catch (e) { return data; }
    if (!fresh || typeof fresh !== 'object' || Array.isArray(fresh)) return data;

    var mine = data.mockQs || (data.mockQs = {}), theirs = fresh.mockQs || {};
    Object.keys(theirs).forEach(function (k) {
      var a = mine[k], b = theirs[k];
      if (!a || (b && (b.at || 0) > (a.at || 0))) mine[k] = b;
    });

    var myMocks = data.mocks || (data.mocks = {}), theirMocks = fresh.mocks || {};
    Object.keys(theirMocks).forEach(function (eid) {
      var a = myMocks[eid], b = theirMocks[eid];
      if (!a) { myMocks[eid] = b; return; }
      if (!a.processed) a.processed = {};
      Object.keys(b.processed || {}).forEach(function (qid) { a.processed[qid] = 1; });
      if ((b.at || 0) > (a.at || 0)) a.at = b.at;
    });

    var wc = data.wrongCount || (data.wrongCount = {}), fwc = fresh.wrongCount || {};
    Object.keys(fwc).forEach(function (k) { if ((wc[k] || 0) < (fwc[k] || 0)) wc[k] = fwc[k]; });

    var pr = data.practiced || (data.practiced = {}), fpr = fresh.practiced || {};
    Object.keys(fpr).forEach(function (k) {
      var a = pr[k], b = fpr[k];
      if (!a || (b && (b.n || 0) > (a.n || 0))) pr[k] = b;
    });

    var qm = data.qModule || (data.qModule = {}), fqm = fresh.qModule || {};
    Object.keys(fqm).forEach(function (k) { if (!qm[k] && fqm[k]) qm[k] = fqm[k]; });

    var qs = data.qSrc || (data.qSrc = {}), fqs = fresh.qSrc || {};
    var myAt = data.qSrcAt || 0, theirAt = fresh.qSrcAt || 0;
    if (theirAt > myAt) {
      data.qSrc = fqs;
      data.qSrcAt = theirAt;
    } else if (theirAt === myAt) {
      Object.keys(fqs).forEach(function (k) {
        if (!qs[k]) qs[k] = fqs[k];
        else if (qs[k] !== fqs[k]) qs[k] = 'both';
      });
    }

    var sn = data.snaps || (data.snaps = {}), fsn = fresh.snaps || {};
    Object.keys(fsn).forEach(function (k) {
      var a = sn[k], b = fsn[k];
      if (!a) { sn[k] = b; return; }
      if (!a.analysis && b && b.analysis) { a.analysis = b.analysis; a.at = b.at || a.at; }
    });
    return data;
  }

  var storeRev = 0;

  function saveStore() {
    storeRev++;
    try { localStorage.setItem(LS_STORE, JSON.stringify(mergeConcurrent(store))); }
    catch (e) { alert('本地存储写入失败：' + e.message); }
  }

  window.addEventListener('storage', function (e) {
    if (e.key !== LS_STORE || !e.newValue) return;
    mergeConcurrent(store);
    storeRev++;
  });

  function setNote(id, text, opts) {
    opts = opts || {};
    if (text) {
      store.notes[id] = {
        text: text,
        snapshot: opts.snapshot || (store.notes[id] && store.notes[id].snapshot) || '',
        subject: opts.subject != null ? opts.subject : (store.notes[id] && store.notes[id].subject),
        updated: Date.now()
      };
      harvestPageSnap(id);
    } else {
      delete store.notes[id];
    }
    saveStore();
  }
  function getNote(id) { return (store.notes[id] && store.notes[id].text) || ''; }

  function pageFrom() {
    if (isZyAnalysis()) return 'zy';
    var k = routeKind();
    return k === 'collect' ? 'favorite' : (k === 'error' ? 'error' : '');
  }

  function harvestPageSnap(id) {
    var raw = itemsById[id];
    if (!raw && quiz && quiz.list) {
      for (var i = 0; i < quiz.list.length; i++) {
        if (String(quiz.list[i].id) === String(id)) { raw = quiz.list[i]; break; }
      }
    }
    if (!raw) return null;
    return harvestSnapshot(raw, pageFrom());
  }

  function snapOf(id) {
    var k = String(id);
    return store.snaps[k] || store.mockQs[k] || null;
  }

  function snapState(id) {
    var q = snapOf(id);
    if (!q) return 'none';
    return String(analysisOf(q) || '').trim() ? 'full' : 'part';
  }

  function snapCopy(q) {
    return normalize({
      id: q.id, content: q.content, material: q.material, opt: q.opt,
      correct_answer: q.correct_answer, user_answer: q.user_answer,
      analysis: q.analysis, analysis_shadow: q.analysis_shadow,
      content_type: q.content_type, module: q.module
    });
  }

  function harvestSnapshot(raw, from) {
    if (!raw || typeof raw !== 'object') return null;
    var q = (raw.id != null && raw.content != null) ? snapCopy(raw) : mockFieldMap(raw);
    if (!q || q.id == null || !String(q.content || '').trim()) {
      console.warn('[错题助手] 没认出这道题的题面，只记笔记不建快照（来源页：' + from + '）');
      return null;
    }
    var k = String(q.id), ana = String(analysisOf(q) || '');
    var cur = store.snaps[k];
    if (cur) {
      var touched = false;
      if (!cur.analysis && ana) { cur.analysis = ana; cur.at = Date.now(); touched = true; }
      if (!cur.module && q.module) { cur.module = q.module; touched = true; }
      if (touched) saveStore();
      return cur;
    }
    var m = store.mockQs[k];
    if (m && stripHtml(m.content) !== stripHtml(q.content)) {
      console.warn('[错题助手] 题面快照与模考收录的内容不一致，补充题本里会标出来请核对：' + k);
    }
    store.snaps[k] = {
      id: q.id, content: String(q.content || ''), material: String(q.material || ''),
      opt: Array.isArray(q.opt) ? q.opt : [],
      correct_answer: q.correct_answer == null ? '' : q.correct_answer,
      user_answer: q.user_answer == null ? '' : q.user_answer,
      analysis: ana,
      content_type: (typeof q.content_type === 'number' || /^\d+$/.test(String(q.content_type)))
        ? Number(q.content_type) : null,
      module: q.module || '', from: from || '', at: Date.now()
    };
    saveStore();
    return store.snaps[k];
  }

  function inSiteLists(id) { return !!(store.qSrc && store.qSrc[id]); }

  function reconciled() { return !!store.qSrcAt; }

  function bookIds() {
    if (!reconciled()) return [];
    var ids = [];
    noteIdsWithHl().forEach(function (id) { if (!inSiteLists(id)) ids.push(id); });
    Object.keys(store.mockQs).forEach(function (k) {
      if (ids.indexOf(k) < 0 && !inSiteLists(k)) ids.push(k);
    });
    return ids;
  }

  function bookQuestion(id) {
    var k = String(id), s = store.snaps[k], m = store.mockQs[k], q = s || m;
    if (!q) {
      var n = store.notes[k] || {};
      return {
        id: k, content: '', material: '', opt: [], analysis: '',
        correct_answer: '', user_answer: '', content_type: n.subject,
        module: '', _src: 'book', _noSnap: 1, _ex: n.snapshot || ''
      };
    }
    var out = {
      id: q.id == null ? k : q.id, content: q.content || '', material: q.material || '',
      opt: q.opt || [], correct_answer: q.correct_answer, user_answer: q.user_answer,
      analysis: q.analysis || '', content_type: q.content_type, module: q.module || '',
      _src: 'book', _conflict: !!(s && m && stripHtml(s.content) !== stripHtml(m.content)),
      _part: String(analysisOf(q) || '').trim() ? 0 : 1
    };
    if (!s && m) out._mock = m.examId;
    return out;
  }

  function bookList() { return bookIds().map(bookQuestion); }

  function orphanSnapIds() {
    return Object.keys(store.snaps).filter(function (k) {
      return !store.notes[k] && !(store.highlights[k] && store.highlights[k].length) && !store.mockQs[k];
    });
  }

  function backfillSnaps(list) {
    var n = 0;
    (list || []).forEach(function (q) {
      if (!q || q.id == null) return;
      var k = String(q.id);
      if (!store.notes[k] && !(store.highlights[k] && store.highlights[k].length)) return;
      if (store.snaps[k]) return;
      if (harvestSnapshot(q, 'list')) n++;
    });
    return n;
  }

  var FACE_CAP = 300;
  var faceFilling = false;
  // 要不回来的题（已下架、认不出科目）不重试：整轮跑完还会重排一次队列，没这张表就是死循环
  var faceTried = {};

  function faceGapIds(pageIds) {
    var gaps = bookIds().filter(function (id) {
      return snapState(id) !== 'full' && !faceTried[String(id)];
    });
    var taken = {}, head = [];
    (pageIds || []).forEach(function (id) {
      var k = String(id);
      if (!taken[k] && gaps.indexOf(k) >= 0) { taken[k] = 1; head.push(k); }
    });
    return head.concat(gaps.filter(function (k) { return !taken[k]; })).slice(0, FACE_CAP);
  }

  function faceTypesOf(id) {
    var s = store.notes[id] && store.notes[id].subject;
    if (s === SUBJ_XC || s === SUBJ_ZY) return [String(s)];
    var m = store.mockQs[id];
    if (m && (m.content_type === SUBJ_XC || m.content_type === SUBJ_ZY)) return [String(m.content_type)];
    return [String(SUBJ_XC), String(SUBJ_ZY)];
  }

  function fillOneFace(id) {
    var types = faceTypesOf(id);
    function tryOne(i) {
      if (i >= types.length) return Promise.resolve(null);
      return apiSubjectFace(id, types[i]).then(function (data) {
        var q = mockFieldMap(data || {});
        if (!q || !String(q.content || '').trim()) return tryOne(i + 1);
        if (q.id == null) q.id = id;
        return harvestSnapshot(q, 'book') || tryOne(i + 1);
      })['catch'](function () { return tryOne(i + 1); });
    }
    return tryOne(0);
  }

  // 补齐题面没有按钮：摊开题本就自动要，用户不该为了看题面先点一下。
  // 当前这一页排在队首，其余往后排；每跑完一批重排一次，直到 faceTried 把队列清空。
  function autoFillFaces(pageIds) {
    if (faceFilling || !bookViewOn) return Promise.resolve();
    var ids = faceGapIds(pageIds);
    if (!ids.length) return Promise.resolve();
    faceFilling = true;
    var n = 0, gotN = 0, partN = 0, missN = 0;
    return new Promise(function (resolve) {
      function step() {
        if (n >= ids.length) {
          faceFilling = false;
          setStatus('题面补回 ' + gotN + ' 题' + (partN ? '（其中 ' + partN + ' 题站点没给解析正文）' : '') +
            (missN ? '，' + missN + ' 题没要回来——可能已下架，或认不出是行测还是公专。' : '。'),
            missN ? '' : 'ok');
          renderBookList();
          resolve();
          return;
        }
        var id = ids[n++];
        setStatus('正在补齐题面 ' + n + ' / ' + ids.length + '…');
        fillOneFace(id).then(function (snap) {
          faceTried[String(id)] = 1;
          if (snap) { gotN++; if (snapState(id) === 'part') partN++; } else missN++;
        }).then(function () { setTimeout(step, 180); });
      }
      step();
    });
  }

  var HL_LABEL = { yellow: '重点', red: '易错' };
  var HL_PREFIX_LEN = 12;

  function getHighlights(id) { return store.highlights[id] || []; }

  function countHighlights(id) { return getHighlights(id).length; }

  function noteIdsWithHl() {
    var ids = Object.keys(store.notes);
    Object.keys(store.highlights).forEach(function (id) {
      if (getHighlights(id).length && ids.indexOf(id) < 0) ids.push(id);
    });
    return ids;
  }

  function hlRowHtml(h, i, noteTitle) {
    return '<div class="gth-hlp-item' + (h.lost ? ' lost' : '') + '" data-hl="' + i + '">' +
      '<span class="dot ' + (h.color === 'red' ? 'red' : 'yellow') + '"></span>' +
      '<div class="bd"><div class="t" title="点击写批注">' + esc(h.quote || '') + '</div>' +
      (h.note ? '<div class="n"' + (noteTitle ? ' title="' + esc(noteTitle) + '"' : '') + '>' +
        esc(h.note) + '</div>' : '') +
      '</div>' +
      '<span class="rm" title="取消划线">' + icon('x') + '</span></div>';
  }

  function classifyBlock(item, quote) {
    if (!item || !quote) return 'other';
    var opt = item.opt;
    if (typeof opt === 'string') { try { opt = JSON.parse(opt); } catch (e) { opt = []; } }
    if (stripHtml(analysisOf(item)).indexOf(quote) >= 0) return 'analysis';
    if (stripHtml(item.material).indexOf(quote) >= 0) return 'material';
    if (stripHtml(item.content).indexOf(quote) >= 0) return 'stem';
    for (var i = 0; i < (opt || []).length; i++) {
      if (stripHtml(opt[i] && opt[i].content).indexOf(quote) >= 0) return 'opt';
    }
    return 'other';
  }

  function questionOf(qid) {
    if (itemsById[qid]) return itemsById[qid];
    if (quiz && quiz.list) {
      for (var i = 0; i < quiz.list.length; i++) {
        if (String(quiz.list[i].id) === String(qid)) return quiz.list[i];
      }
    }
    return snapOf(qid);
  }

  function offsetInRoot(root, node, offset) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var acc = 0, n;
    while ((n = walker.nextNode())) {
      if (n === node) return acc + offset;
      acc += n.nodeValue.length;
    }
    return -1;
  }

  function allIndices(hay, needle) {
    var out = [], i = hay.indexOf(needle);
    while (i >= 0) { out.push(i); i = hay.indexOf(needle, i + 1); }
    return out;
  }

  var PUNCT_RE = /[\s\u3000,.!?;:'"()（）【】《》、，。！？；：""''—\-–·]/;

  function normMap(s) {
    var map = [], out = '';
    s = String(s == null ? '' : s);
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (PUNCT_RE.test(c)) continue;
      map.push(i); out += c;
    }
    return { text: out, map: map };
  }
  function norm(s) { return normMap(s).text; }

  function locate(root, rec) {
    var full = root.textContent || '';
    if (!full || !rec.quote) return null;
    var idxs = allIndices(full, rec.quote);
    var pick = -1;
    if (idxs.length) {
      if (idxs.length === 1) pick = idxs[0];
      else if (rec.nth >= 1 && rec.nth <= idxs.length) pick = idxs[rec.nth - 1];

      if (pick >= 0 && rec.prefix) {
        var ctx = full.slice(Math.max(0, pick - rec.prefix.length), pick);
        if (ctx !== rec.prefix) {
          for (var k = 0; k < idxs.length; k++) {
            if (full.slice(Math.max(0, idxs[k] - rec.prefix.length), idxs[k]) === rec.prefix) { pick = idxs[k]; break; }
          }
        }
      }
      if (pick >= 0) return { start: pick, end: pick + rec.quote.length, fuzzy: false };
    }
    var nm = normMap(full), nq = norm(rec.quote);
    if (!nq) return null;
    var fi = nm.text.indexOf(nq);
    if (fi < 0) return null;
    var s = nm.map[fi], e = nm.map[fi + nq.length - 1] + 1;
    return { start: s, end: e, fuzzy: true };
  }

  function markRange(root, start, end, cls, idx) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var acc = 0, todo = [], n;
    while ((n = walker.nextNode())) {
      var len = n.nodeValue.length;
      var ns = acc, ne = acc + len;
      acc = ne;
      if (ne <= start || ns >= end) continue;
      var a = Math.max(0, start - ns), b = Math.min(len, end - ns);
      if (b <= a) continue;
      todo.push({ node: n, a: a, b: b });
    }
    var made = 0;
    todo.forEach(function (t) {
      var node = t.node;
      if (t.b < node.nodeValue.length) node.splitText(t.b);
      if (t.a > 0) node = node.splitText(t.a);
      var mk = document.createElement('mark');
      mk.className = 'gth-hl ' + cls;
      mk.dataset.gthHl = '1';

      if (idx != null) mk.dataset.gthI = String(idx);
      node.parentNode.insertBefore(mk, node);
      mk.appendChild(node);
      made++;
    });
    return made;
  }

  function unwrapMarks(root) {
    $$('mark.gth-hl', root).forEach(function (m) {
      var p = m.parentNode;
      if (!p) return;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
    });
  }

  function hlHoldLost(rec, analysisShown) {
    return rec.block === 'analysis' && !analysisShown;
  }

  function paintRoot(root) {
    var qid = root.getAttribute('data-gth-qid');
    if (!qid || !root.isConnected) return;
    var list = store.highlights[qid] || [];
    var len = (root.textContent || '').length;
    var sig = qid + '|' + list.length + '|' + len;
    if (root.getAttribute('data-gth-paint') === sig) return;

    if (list.length && len < 8) return;

    unwrapMarks(root);
    if (!list.length) { root.setAttribute('data-gth-paint', sig); return; }
    var painted = 0, changed = false, retry = false;

    var ap = $('.analysis p', root);
    var analysisShown = !!(ap && (ap.textContent || '').trim().length);
    list.forEach(function (rec, i) {
      if (rec.edited) return;
      var pos = locate(root, rec);
      if (!pos) {
        if (hlHoldLost(rec, analysisShown)) return;

        rec.miss = (rec.miss || 0) + 1;
        if (rec.miss >= 2) {
          if (!rec.lost) { rec.lost = true; changed = true; console.warn('[错题助手] 划线已失效：', qid, rec.quote); }
        } else {
          retry = true;
        }
        return;
      }
      if (rec.miss) { delete rec.miss; changed = true; }
      if (rec.lost) { delete rec.lost; changed = true; }
      if (markRange(root, pos.start, pos.end, rec.color === 'red' ? 'red' : 'yellow', i)) painted++;
    });
    if (changed) saveStore();

    root.setAttribute('data-gth-paint', retry ? '' : sig);
  }

  function repaintHighlights() {
    $$('[data-gth-qid]').forEach(paintRoot);
  }

  function qRoot(qid) { return $('[data-gth-qid="' + String(qid).replace(/"/g, '') + '"]'); }

  function repaintOne(qid) {
    var root = qRoot(qid);
    if (root) { root.removeAttribute('data-gth-paint'); paintRoot(root); }
  }

  function rerenderAsides() {
    $$('.gth-aside').forEach(function (a) {
      var it = itemsById[a.dataset.id];
      if (it && !a.dataset.editing) renderAside(a, it);
    });
  }

  function addHighlight(qid, quote, start, color) {
    var root = qRoot(qid);
    var full = root ? (root.textContent || '') : '';
    var idxs = allIndices(full, quote);
    var best = -1, nth = 1;
    for (var i = 0; i < idxs.length; i++) {
      if (best < 0 || Math.abs(idxs[i] - start) < Math.abs(best - start)) { best = idxs[i]; nth = i + 1; }
    }
    if (best < 0) return null;
    var it = questionOf(qid);
    var rec = {
      quote: quote,
      prefix: full.slice(Math.max(0, best - HL_PREFIX_LEN), best),
      nth: nth,
      block: classifyBlock(it, quote),
      color: color === 'red' ? 'red' : 'yellow',
      at: Date.now(),
      snap: it ? stripHtml(it.content || '').slice(0, 240) : '',
      subject: subjectOf(it)
    };
    if (!store.highlights[qid]) store.highlights[qid] = [];
    store.highlights[qid].push(rec);
    saveStore();
    if (it && it.id != null) harvestSnapshot(it, pageFrom());
    if (root) { root.removeAttribute('data-gth-paint'); paintRoot(root); }
    return rec;
  }

  function setHighlightColor(qid, idx, color) {
    var list = store.highlights[qid];
    if (!list || !list[idx]) return;
    list[idx].color = color === 'red' ? 'red' : 'yellow';
    saveStore();
    repaintOne(qid);
  }

  function hlNoteSet(qid, idx, text) {
    var r = (store.highlights[qid] || [])[idx];
    if (!r) return;
    if (text) { r.note = text; r.noteAt = Date.now(); }
    else { delete r.note; delete r.noteAt; }
    saveStore();
  }

  function hlRemove(qid, idx) {
    var list = store.highlights[qid];
    if (!list || idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    if (!list.length) delete store.highlights[qid];
    saveStore();
    repaintOne(qid);
  }

  function hlOverlap(root, start, end, color) {
    var qid = root.getAttribute('data-gth-qid');
    var list = store.highlights[qid] || [];
    var hit = [];
    list.forEach(function (rec, i) {
      if (rec.edited || rec.lost) return;
      if (color && (rec.color === 'red' ? 'red' : 'yellow') !== color) return;
      var pos = locate(root, rec);
      if (!pos) return;
      if (pos.start < end && pos.end > start) hit.push(i);
    });
    return hit;
  }

  function masteredLabel(id) {
    var m = store.mastered[id];
    if (!m || !m.streak) return '未掌握';
    if (m.streak >= MASTER_STREAK) return '已掌握';
    return '待巩固 ' + m.streak + '/' + MASTER_STREAK;
  }
  function isMastered(id) { var m = store.mastered[id]; return !!m && m.streak >= MASTER_STREAK; }

  var ERR_COUNT_KEYS = ['error_count', 'wrong_count', 'error_num', 'wrong_num',
    'error_times', 'wrong_times', 'err_count', 'wrong_cnt', 'error_cnt', 'errorcnt', 'count'];

  function serverErrCount(q) {
    for (var i = 0; i < ERR_COUNT_KEYS.length; i++) {
      var v = q[ERR_COUNT_KEYS[i]];
      if (typeof v === 'number' && v > 0) return v;
      if (typeof v === 'string' && /^\d+$/.test(v.trim()) && Number(v) > 0) return Number(v);
    }
    return 0;
  }

  var WRONG_BASE = 1;
  var STUBBORN_MIN = 3;

  function errCountOf(q) {
    var s = serverErrCount(q);
    if (s) return s;
    return ((store.wrongCount && store.wrongCount[q.id]) || 0) + WRONG_BASE;
  }

  function errTag(n) {
    var hard = n >= STUBBORN_MIN;
    return {
      cls: 'gth-err' + (hard ? ' stubborn' : ''),
      html: (hard ? icon('warn') : icon('xCircle')) +
        (hard ? '顽固错题 · ' + n + ' 次' : '答错 ' + n + ' 次')
    };
  }

  function bumpWrongCount(q, ok) {
    if (!store.wrongCount) store.wrongCount = {};
    if (!ok) store.wrongCount[q.id] = (store.wrongCount[q.id] || 0) + 1;
  }

  function markPracticed(id) {
    if (!store.practiced) store.practiced = {};
    var r = store.practiced[id];
    store.practiced[id] = { at: Date.now(), n: ((r && r.n) || 0) + 1 };
  }
  function isPracticed(id) { return !!(store.practiced && store.practiced[id]); }

  var MOCK_UNCLS = '未分类';

  function moduleOf(id) {
    return (store.qModule && store.qModule[id]) ||
      (store.mockQs[id] && store.mockQs[id].module) ||
      (store.snaps[id] && store.snaps[id].module) || '';
  }

  function buildExamPointIndex(list) {
    var byPoint = {};
    (list || []).forEach(function (c) {
      (c.exampoint_list || []).forEach(function (top) {
        (function mark(node) {
          if (byPoint[String(node.id)] == null) byPoint[String(node.id)] = top.name;
          (node.children || []).forEach(mark);
        })(top);
      });
    });
    return byPoint;
  }

  var examPointModule = null;

  function rememberModulesFromPoints(list) {
    if (!examPointModule) return 0;
    var n = 0;
    (list || []).forEach(function (q) {
      if (!q || q.id == null || q.exam_point == null) return;
      var m = examPointModule[String(q.exam_point)];
      if (m && rememberModule(q.id, m)) n++;
    });
    if (n) saveStore();
    return n;
  }

  function sweepFacets(siteList, zyList, index) {
    var zy = {}, subjects = {}, srcs = {};
    (zyList || []).forEach(function (q) { if (q && q.id != null) zy[String(q.id)] = 1; });
    (siteList || []).concat(zyList || []).forEach(function (q) {
      if (!q || q.id == null) return;
      var id = String(q.id);
      if (q._src) srcs[id] = !srcs[id] || srcs[id] === q._src ? q._src : 'both';
      if (zy[id]) { subjects[id] = SUBJ_ZY; return; }
      if (index && index[String(q.exam_point)]) subjects[id] = SUBJ_XC;
    });
    return { subjects: subjects, srcs: srcs };
  }

  function reconcileSources(srcs, complete) {
    if (!store.qSrc) store.qSrc = {};
    var next = srcs || {};
    if (!complete) {
      Object.keys(store.qSrc).forEach(function (id) {
        if (next[id] === undefined) next[id] = store.qSrc[id];
      });
    }
    var gone = 0;
    Object.keys(store.qSrc).forEach(function (id) { if (next[id] === undefined) gone++; });
    store.qSrc = next;
    store.qSrcAt = Date.now();
    saveStore();
    return gone;
  }

  function backfillSubject(subjects) {
    var n = 0;
    Object.keys(subjects || {}).forEach(function (id) {
      var s = subjects[id], note = store.notes[id];
      if (note && note.subject == null) { note.subject = s; n++; }
      var hls = store.highlights[id];
      if (hls && hls.length && hls[0].subject == null) { hls[0].subject = s; n++; }
    });
    if (n) saveStore();
    return n;
  }

  function rememberModule(id, name) {
    if (!name) return false;
    if (!store.qModule) store.qModule = {};
    var k = String(id);
    if (store.qModule[k]) return false;
    store.qModule[k] = name;
    return true;
  }

  var probed = false;
  function probeFields(list) {
    if (!list || !list.length) return;
    var keys = Object.keys(list[0]);
    var hit = keys.filter(function (k) { return ERR_COUNT_KEYS.indexOf(k) >= 0; });
    console.log('[错题助手] 题目字段：' + keys.join(', '));
    console.log('[错题助手] 错误次数字段：' + (hit.length ? hit.join(', ') : '未发现，当前使用本地累计（站点模板与控制器均无该字段）'));
    console.log('[错题助手] 解析字段：analysis=' + (list[0].analysis ? '有内容' : '空') +
      ' / analysis_shadow=' + (list[0].analysis_shadow ? '有内容' : '空'));
  }

  function getToken() {
    var raw = localStorage.getItem(LS_TOKEN) || localStorage.getItem('token_' + CTX) || '';
    try { var v = JSON.parse(raw); if (typeof v === 'string') raw = v; } catch (e) {}
    return raw;
  }

  function apiGet(path, params) {
    return new Promise(function (resolve, reject) {
      var p = {
        token: getToken(),
        clienttype: 4,
        login_status: localStorage.getItem(LS_LOGIN) || ''
      };
      Object.keys(params || {}).forEach(function (k) {
        if (params[k] !== '' && params[k] != null) p[k] = params[k];
      });
      var qs = Object.keys(p).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]);
      }).join('&');

      GM_xmlhttpRequest({
        method: 'GET',
        url: (/^https?:/.test(path) ? path : API_BASE + path) + '?' + qs,
        timeout: 30000,
        onload: function (r) {
          var j;
          try { j = JSON.parse(r.responseText); }
          catch (e) { reject(new Error('响应解析失败：' + String(r.responseText).slice(0, 120))); return; }
          if (j && j.code === 0) resolve(j.data || {});
          else reject(new Error('接口 code=' + (j && j.code) + ' ' + ((j && j.msg) || '')));
        },
        onerror: function () { reject(new Error('网络请求失败')); },
        ontimeout: function () { reject(new Error('请求超时')); }
      });
    });
  }

  var commodityPromise = null;
  function getCommodity() {
    if (!commodityPromise) {
      commodityPromise = apiGet('commodity').then(function (d) {
        var ci = d.commodity_info || {};
        if (!ci.content_id) throw new Error('未获取到 content_id，请确认已登录且已开通题库');
        return ci;
      }).catch(function (e) { commodityPromise = null; throw e; });
    }
    return commodityPromise;
  }

  function normalize(q) {
    ['opt', 'correct_answer', 'user_answer'].forEach(function (k) {
      if (typeof q[k] === 'string') {
        try { q[k] = JSON.parse(q[k]); } catch (e) { q[k] = k === 'opt' ? [] : ''; }
      }
    });
    if (!Array.isArray(q.opt)) q.opt = [];
    if (q.analysis == null) q.analysis = '';
    if (q.material == null) q.material = '';
    return q;
  }

  function analysisOf(q) { return q.analysis || q.analysis_shadow || ''; }

  function ansKey(a) {
    var arr = Array.isArray(a) ? a.slice() : String(a == null ? '' : a).split('');
    arr.sort();
    return arr.join('');
  }

  function pagedFetch(ci, base, limit) {
    var url = 'content/' + ci.content_id + '/error/view';
    var size = 100, out = [];
    function nextPage(page) {
      return apiGet(url, Object.assign({}, base, { page: page, page_size: size }))
        .then(function (d) {
          var list = (d.subject_list || []).map(normalize);
          out = out.concat(list);
          var total = d.total_items || 0;
          if (list.length < size) return out;
          if (limit && out.length >= limit) return out;
          if (total && out.length >= total) return out;
          if (page >= 49) return out;
          return nextPage(page + 1);
        });
    }
    return nextPage(0);
  }

  function buildModuleOptions(list) {
    var byName = {}, out = [];
    function add(name, pair) {
      var k = String(name);
      if (!byName[k]) { byName[k] = { name: k, pairs: [] }; out.push(byName[k]); }
      byName[k].pairs.push(pair);
    }
    (list || []).forEach(function (c) {
      var eps = c.exampoint_list || [];
      if (!eps.length) add(c.name, { subcategory_id: c.id, exampoint_id: '' });
      else eps.forEach(function (p) { add(p.name, { subcategory_id: c.id, exampoint_id: p.id }); });
    });
    return out;
  }

  function fetchXingceBy(kind, moduleNames, onProgress) {
    return fetchSubcategory().then(function (list) {
      var pairs = [];
      buildModuleOptions(list).forEach(function (m) {
        if (moduleNames && moduleNames.length && moduleNames.indexOf(m.name) < 0) return;
        m.pairs.forEach(function (p) {
          pairs.push({ subcategory_id: p.subcategory_id, exampoint_id: p.exampoint_id, name: m.name });
        });
      });
      if (!pairs.length) return [];
      return getCommodity().then(function (ci) {
        var seen = new Set(), out = [], i = 0, modTouched = false;
        function next() {
          if (i >= pairs.length) { if (modTouched) saveStore(); return out; }
          var pair = pairs[i++];
          if (onProgress) onProgress(i, pairs.length, pair.name);
          var params = listParams(ci, { mode: 'subject', subject: SUBJ_XC });
          params.subcategory_id = pair.subcategory_id;
          params.exampoint_id = pair.exampoint_id;
          if (kind === 'error') { params.page = 0; params.page_size = 100; }
          return apiGet(listPath(kind, ci), params).then(function (d) {
            (d.subject_list || []).forEach(function (q) {
              normalize(q);
              if (!seen.has(q.id)) {
                seen.add(q.id); out.push(q);
                if (rememberModule(q.id, pair.name)) modTouched = true;
              }
            });
            return next();
          });
        }
        return next();
      });
    });
  }

  function fetchXingce(moduleNames, onProgress) { return fetchXingceBy('error', moduleNames, onProgress); }

  function fetchErrors(f, limit) {
    if (f.mode === 'date') {
      return getCommodity().then(function (ci) {
        return pagedFetch(ci, {
          view_type: 0, agency_commodity_id: ci.id, is_cal_totalitems: 1,
          day_range_type: f.dayRange
        }, limit);
      });
    }
    if (f.subject === SUBJ_XC) {
      return fetchXingce(f.module_names || [], function (i, n, name) {
        setStatus('行测收集中 ' + i + '/' + n + ' · ' + name);
      });
    }
    return getCommodity().then(function (ci) {
      var base = {
        view_type: 1, agency_commodity_id: ci.id, is_cal_totalitems: 1,
        content_type: f.subject
      };
      return pagedFetch(ci, base, limit);
    });
  }

  function listPath(kind, ci) {
    return 'content/' + ci.content_id + '/' + (kind === 'favorite' ? 'favorite/view' : 'error/view');
  }

  function listParams(ci, f) {
    var base = { agency_commodity_id: ci.id, is_cal_totalitems: 1 };
    if (f.mode === 'date') {
      base.view_type = 0;
      base.day_range_type = f.dayRange;
    } else {
      base.view_type = 1;
      base.content_type = f.subject;
    }
    return base;
  }

  function fetchFavoriteFlat(f) {
    return getCommodity().then(function (ci) {
      return apiGet(listPath('favorite', ci), listParams(ci, f))
        .then(function (d) { return (d.subject_list || []).map(normalize); });
    });
  }

  function fetchFavoriteXingce(moduleNames, onProgress) {
    return fetchXingceBy('favorite', moduleNames, onProgress);
  }

  function fetchFavorites(f) {
    if (f.mode !== 'date' && f.subject === SUBJ_XC) {
      return fetchFavoriteXingce(f.module_names || [], function (i, n, name) {
        setStatus('收藏 · 行测收集中 ' + i + '/' + n + ' · ' + name);
      });
    }
    return fetchFavoriteFlat(f);
  }

  function srcList(f) {
    var raw = (Array.isArray(f.srcs) && f.srcs.length) ? f.srcs : [f.src || 'error'];
    var out = [];
    function push(s) { if (out.indexOf(s) < 0) out.push(s); }
    raw.forEach(function (s) {
      if (s === 'both') { push('error'); push('favorite'); }
      else if (SRC_KEYS.indexOf(s) >= 0) push(s);
    });
    return out;
  }

  function srcLabel(srcs) {
    return srcList({ srcs: srcs }).map(function (s) { return SRC_NAME[s]; }).join('＋');
  }

  function hasSiteSrc(srcs) {
    return srcList({ srcs: srcs }).some(function (s) { return s === 'error' || s === 'favorite'; });
  }

  function fetchByFilter(f, limit) {
    var srcs = srcList(f);
    var wantErr = srcs.indexOf('error') >= 0, wantFav = srcs.indexOf('favorite') >= 0;
    var mods = f.mock_modules || [];
    function tag(list, src) {
      (list || []).forEach(function (q) { if (q) q._src = src; });
      return list;
    }
    var site = (!wantErr && !wantFav) ? Promise.resolve([])
      : (wantErr && wantFav) ? Promise.all([fetchErrors(f, limit), fetchFavorites(f)])
          .then(function (r) {
            var by = {}, out = [];
            function take(arr, src) {
              (arr || []).forEach(function (q) {
                if (!q || q.id == null) return;
                var k = String(q.id), p = by[k];
                if (p) { if (p._src !== src) p._src = 'both'; return; }
                q._src = src; by[k] = q; out.push(q);
              });
            }
            take(r[0], 'error'); take(r[1], 'favorite');
            return out;
          })
      : wantErr ? fetchErrors(f, limit).then(function (l) { return tag(l, 'error'); })
      : fetchFavorites(f).then(function (l) { return tag(l, 'favorite'); });
    return site.then(function (list) {

      rememberModulesFromPoints(list);
      backfillSnaps(list);
      var have = {};
      list.forEach(function (q) { if (q && q.id != null) have[String(q.id)] = 1; });

      var mock = srcs.indexOf('mock') >= 0 ? mockAllList(mods)
        : (wantErr ? mockWrongList(mods) : []);
      if (srcs.indexOf('book') >= 0) mock = mock.concat(bookList());
      return list.concat(mock.filter(function (q) { return !have[String(q.id)]; }));
    });
  }

  function fetchSubcategory() {
    return getCommodity()
      .then(function (ci) { return apiGet('content/' + ci.content_id + '/subcategory'); })
      .then(function (d) {
        var list = d.subcategory_list || [];
        examPointModule = buildExamPointIndex(list);
        return list;
      });
  }

  function ensureExamPointIndex() {
    return examPointModule ? Promise.resolve(examPointModule) : fetchSubcategory().then(function () {
      return examPointModule;
    });
  }

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function zipStore(entries) {
    var enc = new TextEncoder();
    var local = [], central = [];
    var offset = 0, cdSize = 0;
    entries.forEach(function (e) {
      var name = enc.encode(e.name), data = e.data, crc = crc32(data);
      var lh = new Uint8Array(30 + name.length);
      var lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(12, 0x21, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lh.set(name, 30);
      local.push(lh, data);

      var ch = new Uint8Array(46 + name.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      ch.set(name, 46);
      central.push(ch);

      offset += lh.length + data.length;
      cdSize += ch.length;
    });
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    var all = local.concat(central, [eocd]);
    var total = 0; all.forEach(function (b) { total += b.length; });
    var out = new Uint8Array(total), p = 0;
    all.forEach(function (b) { out.set(b, p); p += b.length; });
    return out;
  }

  function xesc(s) {
    return String(s == null ? '' : s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function colName(n) {
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  function buildXlsx(header, rows) {
    var enc = new TextEncoder();
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>';
    header.forEach(function (h, i) {
      var w = XLSX_WIDTHS[i] || 20;
      xml += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
    });
    xml += '</cols><sheetData>';
    var rowsAll = [header].concat(rows);
    for (var ri = 0; ri < rowsAll.length; ri++) {
      var row = rowsAll[ri];
      xml += '<row r="' + (ri + 1) + '">';
      for (var ci = 0; ci < row.length; ci++) {
        xml += '<c r="' + colName(ci + 1) + (ri + 1) + '" t="inlineStr">' +
          '<is><t xml:space="preserve">' + xesc(row[ci]) + '</t></is></c>';
      }
      xml += '</row>';
    }
    xml += '</sheetData></worksheet>';
    var files = [
      { name: '[Content_Types].xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '</Types>' },
      { name: '_rels/.rels',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>' },
      { name: 'xl/workbook.xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="错题" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '</Relationships>' },
      { name: 'xl/worksheets/sheet1.xml', data: xml }
    ];
    var encodedFiles = files.map(function (f) { return { name: f.name, data: enc.encode(f.data) }; });
    return zipStore(encodedFiles);
  }

  function subjectForExport(q) {
    if (q && q.content_type != null) return q.content_type;
    var f = noteFacets(q && q.id);
    return f.subj === 'x' ? null : Number(f.subj);
  }

  function toRows(list) {
    return list.map(function (q, i) {
      return [
        i + 1,
        SUBJECT_NAME[subjectForExport(q)] || '',
        q._mock ? '模考#' + q._mock : (SRC_LIST_LABEL[q._src] || '练习'),
        stripHtml(q.material),
        stripHtml(q.content),
        (q.opt || []).map(function (o) { return o.label + '. ' + stripHtml(o.content); }).join('\n'),
        ansKey(q.user_answer),
        ansKey(q.correct_answer),
        errCountOf(q),
        stripHtml(analysisOf(q)),
        getNote(q.id),
        hlSummary(q.id),
        masteredLabel(q.id),
        String(q.id)
      ];
    });
  }

  function hlSummary(id) {
    return getHighlights(id).map(function (h) {
      return '[' + (HL_LABEL[h.color] || '重点') + '] ' + (h.quote || '') +
        (h.note ? '（批注：' + h.note.replace(/\s*\n\s*/g, ' ') + '）' : '');
    }).join('\n');
  }

  function exportMarkdown(list) {
    var lines = ['# 上岸村错题本', '',
      '> 导出时间：' + new Date().toLocaleString() + '　共 ' + list.length + ' 题', ''];
    list.forEach(function (q, i) {
      lines.push('## ' + (i + 1) + '. ' + (stripHtml(q.content) || '(无题干)'));
      lines.push('');
      if (q._mock) {
        lines.push('> 来源：全真模考 #' + q._mock);
        lines.push('');
      }
      if (stripHtml(q.material)) {
        lines.push('**材料**'); lines.push(''); lines.push(stripHtml(q.material)); lines.push('');
      }
      (q.opt || []).forEach(function (o) {
        lines.push('- ' + o.label + '. ' + stripHtml(o.content));
      });
      if (q.opt && q.opt.length) lines.push('');
      lines.push('**你的答案**：' + (ansKey(q.user_answer) || '—') +
        '　|　**正确答案**：' + ansKey(q.correct_answer) +
        '　|　**状态**：' + masteredLabel(q.id));
      lines.push('');
      if (stripHtml(analysisOf(q))) {
        lines.push('**解析**'); lines.push(''); lines.push(stripHtml(analysisOf(q))); lines.push('');
      }
      if (getNote(q.id)) {
        lines.push('**笔记**'); lines.push(''); lines.push(getNote(q.id)); lines.push('');
      }
      if (hlSummary(q.id)) {
        lines.push('**划线摘录**'); lines.push('');
        getHighlights(q.id).forEach(function (h) {
          lines.push('- [' + (HL_LABEL[h.color] || '重点') + '] ' + (h.quote || ''));
        });
        lines.push('');
      }
      lines.push('---'); lines.push('');
    });
    return new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  }

  function exportCsv(list) {
    var cell = function (v) {
      return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    };
    var body = toRows(list).map(function (r) { return r.map(cell).join(','); });
    var csv = '\uFEFF' + [EXPORT_HEADERS.map(cell).join(',')].concat(body).join('\r\n');
    return new Blob([csv], { type: 'text/csv;charset=utf-8' });
  }

  function exportXlsx(list) {
    return new Blob([buildXlsx(EXPORT_HEADERS, toRows(list))], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  function exportJson(list) {
    var payload = {
      _format: 'gongan-tiku-helper-backup',
      _version: 2,
      _exportedAt: new Date().toISOString(),
      questions: list.map(function (q) {
        return {
          id: q.id, content_type: q.content_type, material: q.material,
          content: q.content, opt: q.opt, correct_answer: q.correct_answer,
          user_answer: q.user_answer, analysis: analysisOf(q)
        };
      }),
      notes: store.notes,
      highlights: store.highlights,
      mastered: store.mastered,
      wrongCount: store.wrongCount,
      exported: store.exported,
      exportAt: store.exportAt || 0,
      history: store.history || [],
      mockQs: store.mockQs,
      mocks: store.mocks,
      practiced: store.practiced,
      qModule: store.qModule,
      qSrc: store.qSrc,
      qSrcAt: store.qSrcAt || 0,
      snaps: store.snaps
    };
    return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  }

  function exportNotesMarkdown(ids) {

    ids = (ids || Object.keys(store.notes)).filter(function (id) {
      return store.notes[id] && store.notes[id].text;
    });
    var lines = ['# 我的笔记', '',
      '> 导出时间：' + new Date().toLocaleString() + '　共 ' + ids.length + ' 条', ''];
    ids.forEach(function (id) {
      var n = store.notes[id];
      lines.push('## ' + (SUBJECT_NAME[n.subject] || '题目'));
      lines.push('');
      if (n.snapshot) lines.push('> ' + n.snapshot);
      lines.push('');
      lines.push(n.text);
      lines.push('');
      lines.push('---'); lines.push('');
    });
    return new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  }

  function restoreJson(text) {
    var j = JSON.parse(text);
    if (!j || (j._format !== 'gongan-tiku-helper-backup' && j._format !== 'gongan-tiku-helper-notes')) {
      throw new Error('文件格式不匹配');
    }
    if (j.notes) store.notes = j.notes;
    if (j.highlights) { store.highlights = j.highlights; washHlLost(store.highlights); }
    if (j.mastered) store.mastered = j.mastered;
    if (j.wrongCount) store.wrongCount = j.wrongCount;

    if (j.exported) {
      var bak = migrateExported({ exported: j.exported, exportAt: j.exportAt });
      store.exported = bak.exported;
      store.exportAt = bak.exportAt;
    }
    if (j.history) store.history = j.history;
    if (j.mockQs) store.mockQs = j.mockQs;
    if (j.mocks) store.mocks = j.mocks;
    if (j.practiced) store.practiced = j.practiced;
    if (j.qModule) store.qModule = j.qModule;
    if (j.qSrc) store.qSrc = j.qSrc;
    store.qSrcAt = j.qSrcAt || 0;
    var snapHint = '';
    if (!j.qSrcAt) snapHint += '；这份备份没有核对时间，补充题本要先与站点核对一次';
    if (j.snaps) store.snaps = j.snaps;
    else snapHint += '；这份备份没有题面快照，补充题本按降级显示';
    saveStore();
    refreshBadges();
    renderNotesList();
    renderHistory();
    renderMockChips();
    updateExportHint();
    repaintHighlights();
    return '已恢复笔记 ' + Object.keys(store.notes).length +
      ' 条，划线 ' + Object.keys(store.highlights).length + ' 题，掌握记录 ' + Object.keys(store.mastered).length +
      ' 条，组卷历史 ' + (store.history || []).length + ' 条' + snapHint;
  }

  GM_addStyle([
    ':root{',
    '--gth-bg:#ffffff;--gth-fg:#0f172a;--gth-muted:#64748b;--gth-subtle:#f8fafc;',
    '--gth-border:#e2e8f0;--gth-border-strong:#cbd5e1;--gth-hover:#f1f5f9;',
    '--gth-primary:#0f172a;--gth-primary-fg:#f8fafc;--gth-primary-hover:#1e293b;',
    '--gth-destructive:#dc2626;--gth-destructive-hover:#fef2f2;',
    '--gth-ring:rgba(148,163,184,0.45);--gth-success:#16a34a;',

    '--gth-ctl-h:38px;--gth-ctl-r:8px;',
    '}',

    '.gth-ic{display:inline-flex;align-items:center;justify-content:center;width:1em;height:1em;line-height:1;color:currentColor}',
    '.gth-ic svg{width:100%;height:100%;display:block}',

    '.gth-menu-item{cursor:pointer}',
    '.gth-menu-item .text{display:inline-flex;align-items:center;gap:6px}',
    '.gth-menu-item .gth-ic{font-size:14px;opacity:.75}',
    '.gongan2-container .left-menu .item.gth-menu-item.active{background:#fff;font-weight:700}',

    'body.gth-view-on .left-menu .item.active:not(.gth-menu-item){background:#f8f8f8}',

    '.gth-hide{display:none!important}',
    '.gth-view{padding:0 20px 8px;box-sizing:border-box;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;',
    'font-size:13px;color:var(--gth-fg)}',
    '.gth-view[hidden]{display:none}',

    '.gth-view [hidden]{display:none !important}',

    'body.gth-error .right-content .inner-content>.content{position:relative}',
    '.gth-rail{position:fixed;overflow:hidden;pointer-events:none;z-index:50;',

    'width:clamp(160px,calc((100vw - 1000px) / 2 - 24px),280px);',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}',
    '.gth-rail[hidden]{display:none}',
    '.gth-rail-in{position:relative;width:100%}',
    '.gth-aside{position:absolute;left:0;width:100%;box-sizing:border-box;pointer-events:auto;',
    'border:1px solid #fde68a;border-left:3px solid #fcd34d;border-radius:8px;background:#fffbeb;',
    'padding:9px 11px;font-size:12px;line-height:1.7;color:#713f12}',
    '.gth-aside-h{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#a16207;margin-bottom:5px}',
    '.gth-aside-h .gth-ic{font-size:12px}',
    '.gth-aside-h .sp{flex:1}',
    '.gth-aside-body{white-space:pre-wrap;word-break:break-word}',
    '.gth-aside-empty{color:#a16207;opacity:.7;cursor:pointer}',
    '.gth-aside-empty:hover{opacity:1}',
    '.gth-aside textarea{width:100%;min-height:72px;box-sizing:border-box;border:1px solid #fde68a;border-radius:6px;',
    'padding:6px 8px;font-size:12px;line-height:1.7;font-family:inherit;resize:vertical;',
    'background:#fff;color:var(--gth-fg);outline:none}',
    '.gth-aside-act{margin-top:6px;display:flex;gap:6px}',
    '.gth-mini{border:1px solid var(--gth-border);background:var(--gth-bg);color:var(--gth-muted);border-radius:6px;height:24px;padding:0 8px;',
    'font-size:11px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:4px}',
    '.gth-mini:hover{background:var(--gth-hover);color:var(--gth-fg)}',
    '.gth-mini.primary{background:#f59e0b;border-color:#f59e0b;color:#fff}',
    '.gth-mini.primary:hover{background:#d97706;border-color:#d97706}',

    '.gth-chiprow{display:flex;align-items:flex-start;gap:8px;margin-bottom:8px}',
    '.gth-chiplabel{color:var(--gth-muted);font-size:12px;min-width:28px;padding-top:7px;flex:0 0 auto}',
    '.gth-chips{display:flex;flex-wrap:wrap;gap:6px;flex:1;min-width:0}',
    '.gth-chip{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 11px;',
    'border:1px solid var(--gth-border);border-radius:999px;background:var(--gth-bg);color:var(--gth-muted);',
    'font-size:12px;cursor:pointer;transition:all .15s;user-select:none}',
    '.gth-chip:hover{border-color:var(--gth-border-strong);color:var(--gth-fg)}',
    '.gth-chip.on{background:var(--gth-primary);border-color:var(--gth-primary);color:var(--gth-primary-fg)}',
    '.gth-chip .gth-ic{font-size:11px}',
    '.gth-chips-empty{font-size:12px;color:var(--gth-muted);padding:5px 0 10px}',
    '.gth-chip .n{font-weight:600;font-size:11px;opacity:.65;margin-left:2px}',

    '.gth-dd{position:relative;display:inline-block}',
    '.gth-dd-btn{display:inline-flex;align-items:center;gap:6px;cursor:pointer;text-align:left;',
    'min-width:132px;white-space:nowrap}',
    '.gth-dd-btn span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}',
    '.gth-dd-menu{position:absolute;left:0;top:calc(100% + 4px);z-index:100002;min-width:172px;',
    'background:var(--gth-bg);border:1px solid var(--gth-border);border-radius:8px;padding:5px;',
    'box-shadow:0 10px 28px rgba(15,23,42,.16)}',
    '.gth-dd-menu[hidden]{display:none}',
    '.gth-dd-opt{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:6px;',
    'font-size:13px;color:var(--gth-fg);cursor:pointer;user-select:none}',
    '.gth-dd-opt:hover{background:var(--gth-hover)}',
    '.gth-dd-opt input{width:15px;height:15px;margin:0;accent-color:var(--gth-primary);cursor:pointer}',

    '.gth-err{display:inline-flex;align-items:center;gap:3px;font-size:11px;padding:2px 8px;border-radius:999px;',
    'background:var(--gth-subtle);color:var(--gth-muted)}',
    '.gth-err.stubborn{background:#dc2626;color:#fff;font-weight:600}',
    '.gth-err .gth-ic{font-size:11px}',

    '.gth-head{padding:10px 0;border-bottom:1px solid var(--gth-border);margin-bottom:16px}',

    '.gth-tabs{display:flex;gap:2px}',
    '.gth-tabs button{border:none;background:transparent;color:var(--gth-muted);padding:8px 12px;',
    'font-size:13px;cursor:pointer;border-bottom:2px solid transparent;display:inline-flex;align-items:center;gap:6px;',
    'transition:color .15s,border-color .15s}',
    '.gth-tabs button:hover{color:var(--gth-fg)}',
    '.gth-tabs button.on{color:#2178db;border-bottom-color:#2178db;font-weight:600}',
    '.gth-tabs .gth-ic{font-size:14px}',

    '.gth-body{padding:0}',

    '.gth-row{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}',
    '.gth-row label{color:var(--gth-muted);min-width:44px;font-size:12px}',
    '.gth-row .sp{flex:1}',
    '.gth-hint{color:var(--gth-muted);font-size:12px;line-height:1.6;margin:2px 0 12px}',
    '.gth-sep{height:1px;background:var(--gth-border);margin:14px 0}',

    '.gth-data{margin-top:24px;padding:14px 16px 13px;border:1px solid var(--gth-border);',
    'border-radius:12px;background:var(--gth-subtle)}',
    '.gth-data .gth-sub{margin:0 0 11px}',

    '.gth-data .gth-hint{margin:11px 0 0;color:#475569}',
    '.gth-data-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
    '.gth-data-row .sp{flex:1}',

    '.gth-q{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;',
    '  width:14px;height:14px;margin-left:5px;border:1px solid var(--gth-border-strong);border-radius:50%;',
    '  font-size:9px;font-weight:700;color:var(--gth-muted);vertical-align:2px;cursor:help}',
    '.gth-btn:hover .gth-q{color:var(--gth-primary)}',

    '.gth-export-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}',

    '.gth-export-meta .gth-notes-meta:empty{display:none}',

    '.gth-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;',
    'height:var(--gth-ctl-h);padding:0 16px;border-radius:var(--gth-ctl-r);',
    'border:1px solid var(--gth-border);background:var(--gth-bg);color:var(--gth-fg);',
    'font-size:13px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap;',
    'transition:background-color .15s,border-color .15s,color .15s,box-shadow .15s}',
    '.gth-btn:hover{background:var(--gth-hover);border-color:var(--gth-border-strong)}',
    '.gth-btn:focus-visible{outline:2px solid var(--gth-ring);outline-offset:2px}',
    '.gth-btn:disabled{opacity:.5;cursor:not-allowed}',
    '.gth-btn.primary{background:var(--gth-primary);color:var(--gth-primary-fg);',
    'border-color:var(--gth-primary);font-weight:600}',
    '.gth-btn.primary:hover{background:var(--gth-primary-hover);border-color:var(--gth-primary-hover)}',
    // 「升级后点我」那一颗：绿底白字，是这一屏上唯一一颗"点它一定有好处"的键
    '.gth-btn.go{background:#16a34a;border-color:#16a34a;color:#fff;font-weight:600}',
    '.gth-btn.go:hover{background:#15803d;border-color:#15803d}',
    '.gth-btn.danger{color:var(--gth-destructive);border-color:var(--gth-border-strong)}',
    '.gth-btn.danger:hover{background:var(--gth-destructive-hover);border-color:#fecaca;color:#b91c1c}',
    '.gth-btn.ghost{border-color:transparent}',
    '.gth-btn.ghost:hover{background:var(--gth-hover);border-color:transparent}',
    '.gth-btn.sm{height:32px;padding:0 12px;font-size:12px;gap:5px}',
    '.gth-btn .gth-ic{font-size:15px}',

    '.gth-tabs button:focus-visible,.gth-mini:focus-visible,.gth-qbar-btn:focus-visible,',
    '.gth-his-item button:focus-visible,.gth-dd-opt:focus-within{',
    'outline:2px solid var(--gth-ring);outline-offset:2px}',

    KEYACT.split(',').map(function (s) { return s.trim() + ':focus-visible'; }).join(',') + '{',
    'outline:2px solid var(--gth-ring);outline-offset:2px}',

    '.gth-input,.gth-select{display:inline-flex;align-items:center;height:var(--gth-ctl-h);',
    'padding:0 12px;border-radius:var(--gth-ctl-r);border:1px solid var(--gth-border);',
    'background:var(--gth-bg);color:var(--gth-fg);',
    'font-size:13px;outline:none;font-family:inherit;',
    'transition:border-color .15s,box-shadow .15s}',
    '.gth-input:focus,.gth-select:focus{border-color:var(--gth-border-strong);box-shadow:0 0 0 3px var(--gth-ring)}',
    '.gth-select{appearance:none;-webkit-appearance:none;background-repeat:no-repeat;background-position:right 12px center;padding-right:32px;',
    "background-image:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")}",
    '.gth-select::-ms-expand{display:none}',

    '#gth-status,#gth-book-status{margin-top:10px;padding:10px 12px;border-radius:8px;background:var(--gth-subtle);',
    'color:var(--gth-muted);font-size:12px;line-height:1.6;white-space:pre-wrap;border:1px solid var(--gth-border)}',
    '#gth-status.err,#gth-book-status.err{background:#fef2f2;color:#b91c1c;border-color:#fecaca}',
    '#gth-status.ok,#gth-book-status.ok{background:#f0fdf4;color:#15803d;border-color:#bbf7d0}',

    '.gth-qbar{display:flex;align-items:center;gap:8px;margin:12px 0 0;padding:0 0 8px 40px}',
    '.gth-qbar [hidden]{display:none!important}',

    '.gth-qbar-btn{display:inline-flex;align-items:center;gap:3px;height:24px;padding:0 8px;font-size:11px;',
    'border:1px solid var(--gth-border);border-radius:6px;background:var(--gth-bg);color:var(--gth-muted);cursor:pointer}',
    '.gth-qbar-btn:hover{background:var(--gth-hover);color:var(--gth-fg)}',
    '.gth-qbar-copy.copied{color:#16a34a;border-color:#bbf7d0;background:#f0fdf4}',

    '.gth-badge{font-size:11px;color:var(--gth-muted);display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;',
    'background:var(--gth-subtle);cursor:pointer;user-select:none;transition:background .15s,color .15s}',
    '.gth-badge:hover{background:var(--gth-hover);color:var(--gth-fg)}',
    '.gth-badge.done{color:#15803d;background:#f0fdf4}',
    '.gth-badge.ghost{color:#94a3b8;background:transparent;box-shadow:inset 0 0 0 1px var(--gth-border)}',
    '.gth-badge.has{color:#a16207;background:#fffbeb}',

    '.gth-sub{font-size:12px;font-weight:600;color:var(--gth-fg);margin:0 0 8px}',
    '.gth-his{display:flex;flex-direction:column;gap:8px}',
    '.gth-his-item{display:flex;align-items:center;gap:10px;border:1px solid var(--gth-border);border-radius:8px;',
    'padding:9px 12px;background:var(--gth-bg)}',
    '.gth-his-item .desc{flex:1;min-width:0;font-size:12px;color:var(--gth-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.gth-his-item .meta{font-size:11px;color:var(--gth-muted);white-space:nowrap}',
    '.gth-notes-search{position:relative;margin-bottom:10px}',
    '.gth-notes-search .gth-input{width:100%;padding-left:32px}',
    '.gth-notes-search .ic-l{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--gth-muted);display:inline-flex}',
    '.gth-notes-meta{color:var(--gth-muted);font-size:12px;display:inline-flex;align-items:center;gap:6px}',
    '.gth-notes-list{display:flex;flex-direction:column;gap:10px;max-height:48vh;overflow:auto;padding-right:2px}',
    '.gth-note-item{background:var(--gth-bg);border:1px solid var(--gth-border);border-radius:8px;padding:12px 14px;',
    'transition:border-color .15s,box-shadow .15s}',
    '.gth-note-item:hover{border-color:var(--gth-border-strong);box-shadow:0 2px 6px rgba(15,23,42,.04)}',
    '.gth-note-h{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--gth-muted);margin-bottom:6px;flex-wrap:wrap}',
    '.gth-note-h .gth-pill{padding:2px 8px;border-radius:999px;background:var(--gth-subtle);color:var(--gth-muted);font-size:11px;border:1px solid var(--gth-border)}',
    '.gth-note-h .gth-pill.dyn{color:#a16207;background:#fffbeb;border-color:#fde68a}',
    '.gth-note-h .gth-pill.hl{color:#a16207;background:#fffbeb;border-color:#fde68a;display:inline-flex;align-items:center;gap:3px}',
    '.gth-note-h .gth-pill.hl .gth-ic{font-size:11px}',
    '.gth-note-h .gth-pill.mock{color:#1d4ed8;background:#eff6ff;border-color:#bfdbfe;',
    'display:inline-flex;align-items:center;gap:3px}',
    '.gth-note-h .gth-pill.mock .gth-ic{font-size:11px}',
    '.gth-note-hl{margin-top:8px;display:flex;flex-direction:column;gap:5px}',
    '.gth-note-h .sp{flex:1}',
    '.gth-note-snap{font-size:12px;color:var(--gth-muted);line-height:1.6;margin-bottom:6px;',
    'background:var(--gth-subtle);border-radius:6px;padding:6px 10px;border-left:2px solid var(--gth-border)}',
    '.gth-note-text{font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word;color:var(--gth-fg)}',
    '.gth-note-text.is-empty{color:var(--gth-muted);font-style:italic}',
    '.gth-note-edit{display:flex;flex-direction:column;gap:6px}',
    '.gth-note-edit textarea{width:100%;min-height:80px;border:1px solid var(--gth-border);border-radius:6px;',
    'padding:8px;font-size:13px;resize:vertical;box-sizing:border-box;font-family:inherit;margin-bottom:8px}',
    '.gth-empty{padding:24px;text-align:center;color:var(--gth-muted);font-size:13px;background:var(--gth-subtle);',
    'border:1px dashed var(--gth-border);border-radius:8px;display:flex;flex-direction:column;align-items:center;gap:8px}',

    // 重练那一屏照站点专项练习页：蓝色头部 + 左 230px 答题卡栏 + 右内容列 + 底部操作条。
    // 尺寸与色值抄 gongan.min.ebe4763b.css（.gongan2-header 高 60 / .sheet-box 230 / .operation-btn li span
    // 27px 格 / .jiaojuan a 30px·padding 0 30px·radius 5·#f97217），不自己定一套。
    '#gth-quiz{position:fixed;inset:0;z-index:100000;background:#fff;display:flex;flex-direction:column;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;',
    'font-size:14px;color:#222221}',
    '#gth-quiz[hidden]{display:none}',
    '.gthq-header{background:#2178db;color:#fff;flex:0 0 auto}',
    '.gthq-hc{width:1000px;max-width:100%;height:60px;margin:0 auto;padding:0 20px;box-sizing:border-box;',
    'display:flex;align-items:center;gap:12px}',
    '.gthq-hc .sp{flex:1}',
    '.gthq-name{font-size:16px;font-weight:700}',
    '.gthq-sub{font-size:12px;opacity:.85}',
    '.gthq-remain{font-size:16px;min-width:200px;text-align:right}',
    '.gthq-btn{height:30px;line-height:30px;padding:0 30px;border-radius:5px;border:none;cursor:pointer;',
    'font-size:14px;font-family:inherit;user-select:none;background:#f97217;color:#fff}',
    '.gthq-btn:hover{background:#ffa466}',
    '.gthq-btn:active{background:#ef6102}',
    '.gthq-btn.ghost{background:#fff;color:#2178db}',
    '.gthq-btn.ghost:hover{background:#e8f1fb;color:#2178db}',
    '.gthq-btn.pause{background:#f59e0b;padding:0 16px;display:inline-flex;align-items:center}',
    '.gthq-btn.pause:hover{background:#fbbf24}',
    '.gthq-btn.blue{background:#2178db}',
    '.gthq-btn.blue:hover{background:#4a90e6}',
    '.gthq-btn.warn{background:#fff;color:#f97217;border:1px solid #f97217;line-height:28px}',
    '.gthq-btn.warn:hover{background:#fff7ef;color:#ef6102}',
    '.gthq-body{flex:1;display:flex;min-height:0;overflow:hidden}',
    '.gthq-sheet-col{width:230px;flex:0 0 auto;border-right:1px solid #e4e4e4;padding:10px;',
    'box-sizing:border-box;overflow-y:auto;user-select:none}',
    '.gthq-title{margin-top:20px;padding:8px;color:#0fa0ff;font-size:15px}',
    '.gthq-title.done{color:#a0a0a0}',
    '.gthq-cells{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap}',
    '.gthq-cell{padding:4px;box-sizing:border-box;cursor:pointer;position:relative}',
    '.gthq-cell i{display:block;width:27px;height:27px;line-height:27px;font-size:12px;font-style:normal;',
    'text-align:center;border:1px solid #2178db;background:#fff;color:#2178db;transition:background .2s}',
    '.gthq-cell.done i,.gthq-cell.right i{background:#2178db;border-color:#2178db;color:#fff}',
    '.gthq-cell.bad i{background:#d77e46;border-color:#d77e46;color:#fff}',
    '.gthq-cell.miss i{background:#f2f2f2;border-color:#cfcfcf;color:#9a9a9a}',
    // 当前题那一格要压过对错色，所以排在它们后面
    '.gthq-cell:hover i,.gthq-cell.cur i{background:#f97217;border-color:#f97217;color:#fff}',
    '.gthq-cell.stressed:after{content:"";position:absolute;top:3px;right:3px;border-top:15px solid red;',
    'border-left:15px solid transparent}',
    '.gthq-only{display:flex;align-items:center;gap:6px;padding:8px;font-size:13px;color:#2178db;cursor:pointer}',
    '.gthq-content{flex:1;min-width:0;padding:0 24px 0 20px;box-sizing:border-box;overflow-y:auto}',
    '.gthq-box{padding:30px 0 10px}',
    '.gthq-tips{font-size:14px;line-height:2;color:#222221}',
    '.gthq-kind{font-size:14px;line-height:25px;color:#222221;position:relative}',
    '.gthq-qtime{position:absolute;right:0;top:0;font-size:12px;color:#8c8c8c;display:inline-flex;align-items:center;gap:4px}',
    '.gthq-foot{flex:0 0 auto;border-top:1px solid #e4e4e4}',

    '.gth-qcard{background:#fff;border:none;border-radius:0;padding:0;margin:0;max-width:none;',
    'box-shadow:none}',
    '.gth-qcard .gthq-stem{font-size:14px;line-height:2;color:#222221;margin:0;word-break:break-all}',
    '.gth-qcard .gthq-material{font-size:14px;line-height:2;color:#222221;margin:0 0 10px;word-break:break-all;',
    'background:transparent;border:none;padding:0}',
    '.gth-qcard .gthq-analysis{font-size:14px;line-height:2;color:#222221;margin:6px 0 0;word-break:break-all;',
    'background:transparent;border:none;padding:0}',

    '.gthq-material img,.gthq-stem img,.gthq-opts img,.gthq-analysis img,.gth-note-text img,.gth-apanel img,.gth-aside img{max-width:100%;height:auto;display:inline-block;vertical-align:middle;margin:2px 0;border-radius:6px}',
    // 两档都**定高**，不用 max-height：封顶对本来就没到顶的图是空操作
    //   （110x60 那枚判成两行，max-height 压不动它，照样 60px 高）。
    //   gth-img-1line —— 行内式：句子里当一个字用。取 1.4em 而不是 1.15em，因为 MathJax
    //     出的图自带内边距，16px 的框里墨迹只有 11–12px，比 14px 正文明显小一圈。
    //   gth-img-2line —— 叠行式（分式与竖式）：图里的字仍与正文同大，整枚占两行高。
    // 两条同为 0,1,1 特异性，排在上面那条之后，后写的才盖得住「max-width:100% + height:auto」。
    'img.gth-img-1line{height:1.4em;width:auto;max-width:100%;cursor:zoom-in}',
    'img.gth-img-2line{height:2.8em;width:auto;max-width:100%;cursor:zoom-in}',
    '#gth-imgzoom{position:fixed;top:0;left:0;right:0;bottom:0;z-index:100002;display:flex;',
    'align-items:center;justify-content:center;padding:32px;box-sizing:border-box;background:rgba(15,23,42,.72)}',
    '#gth-imgzoom[hidden]{display:none}',
    '#gth-imgzoom img{max-width:100%;max-height:100%;background:#fff;border-radius:8px;cursor:zoom-out}',
    '.gthq-tip{color:var(--gth-muted);font-size:12px;margin:10px 0;display:inline-flex;align-items:center;gap:6px;',
    'padding:4px 10px;background:var(--gth-subtle);border-radius:999px;border:1px solid var(--gth-border)}',
    '.gthq-ans{margin-top:12px;font-size:14px;display:flex;flex-wrap:wrap;gap:12px}',
    '.gthq-ans .ok{color:#0c0}.gthq-ans .bad{color:red}',
    '.gthq-notebox{margin-top:12px;display:flex;flex-direction:column;gap:6px}',
    '.gthq-nb-act{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.gthq-notebox textarea{width:100%;min-height:60px;border:1px solid var(--gth-border);border-radius:8px;',
    'padding:8px;font-size:13px;resize:vertical;box-sizing:border-box;font-family:inherit;background:var(--gth-bg)}',

    'mark.gth-hl{background:transparent;color:inherit;border-radius:2px;padding:0 1px}',
    'mark.gth-hl.yellow{background:#fde68a;box-shadow:inset 0 -2px 0 #f59e0b}',
    'mark.gth-hl.red{background:#fecaca;box-shadow:inset 0 -2px 0 #dc2626}',

    '#gth-hlbar{position:fixed;z-index:100001;display:none;align-items:center;gap:2px;padding:4px;',
    'background:var(--gth-bg);border:1px solid var(--gth-border);border-radius:8px;',
    'box-shadow:0 6px 20px rgba(15,23,42,.16);',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}',
    '#gth-hlbar.on{display:inline-flex}',
    '#gth-hlbar button{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px;',
    'border:none;background:transparent;border-radius:6px;font-size:12px;color:var(--gth-fg);',
    'cursor:pointer;font-family:inherit;white-space:nowrap}',
    '#gth-hlbar button:hover{background:var(--gth-hover)}',
    '#gth-hlbar .dot{width:9px;height:9px;border-radius:50%;display:inline-block;flex:0 0 auto}',
    '#gth-hlbar .dot.yellow{background:#f59e0b}',
    '#gth-hlbar .dot.red{background:#dc2626}',
    '#gth-hlbar .sep{width:1px;height:16px;background:var(--gth-border);margin:0 2px}',

    '#gth-toast{position:fixed;left:50%;bottom:44px;transform:translateX(-50%) translateY(8px);z-index:100003;',
    'background:#0f172a;color:#f8fafc;font-size:12px;padding:8px 14px;border-radius:8px;',
    'opacity:0;pointer-events:none;transition:opacity .18s,transform .18s;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}',
    '#gth-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}',

    '.gth-aside-hl{margin-top:6px;border-top:1px dashed #fde68a;padding-top:6px}',
    '.gth-aside-hl-t{display:flex;align-items:center;gap:5px;font-size:11px;color:#a16207;cursor:pointer;user-select:none}',
    '.gth-aside-hl-t .gth-ic{font-size:12px;flex:0 0 auto}',
    '.gth-aside-hl-t .sp{flex:1}',

    '.gth-aside-hl-t .gth-caret{flex:0 0 auto;width:12px;height:12px;display:inline-flex;',
    'align-items:center;justify-content:center;opacity:.7;transition:transform .15s}',
    '.gth-aside-hl-list{margin-top:5px;display:none;flex-direction:column;gap:5px}',
    '.gth-aside-hl-list.on{display:flex}',

    '.gth-aside-hl:has(.gth-aside-hl-list.on) .gth-caret{transform:rotate(180deg)}',
    '.gth-hlp-item{display:flex;align-items:flex-start;gap:6px;font-size:11px;line-height:1.6;',
    'background:#fff;border:1px solid #fde68a;border-radius:6px;padding:5px 7px}',
    '.gth-hlp-item .dot{width:8px;height:8px;border-radius:50%;margin-top:4px;flex:0 0 auto}',
    '.gth-hlp-item .dot.yellow{background:#f59e0b}',
    '.gth-hlp-item .dot.red{background:#dc2626}',
    '.gth-hlp-item .t{flex:1;min-width:0;word-break:break-word;cursor:pointer}',
    '.gth-hlp-item .rm{flex:0 0 auto;color:#a16207;opacity:.55;cursor:pointer;font-size:11px;padding:0 2px}',
    '.gth-hlp-item .rm:hover{opacity:1}',
    '.gth-hlp-item.lost .t{color:#b45309;text-decoration:line-through;opacity:.7}',
    '.gth-hlp-empty{font-size:11px;color:#a16207;opacity:.7}',
    '.gth-aside-hl-act{margin-top:6px;display:flex;gap:6px}',

    '#gth-collect{position:fixed;inset:0;z-index:100002;background:rgba(15,23,42,.45);',
    'display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}',
    '#gth-collect[hidden]{display:none}',
    '.gthc-box{background:var(--gth-bg);border-radius:8px;width:min(880px,100%);max-height:86vh;',
    'display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(15,23,42,.28);',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;',
    'font-size:13px;color:var(--gth-fg)}',
    '.gthc-h{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid var(--gth-border);font-size:14px}',
    '.gthc-h .sp{flex:1}',
    '.gthc-b{padding:14px 18px;overflow:auto;flex:1}',
    '.gthc-opts{display:flex;align-items:flex-start;gap:8px;margin-bottom:8px}',
    '.gthc-opts .lb{color:var(--gth-muted);font-size:12px;min-width:28px;padding-top:7px;flex:0 0 auto}',
    '.gthc-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--gth-fg);cursor:pointer;padding-top:7px}',
    '.gthc-pre{margin-top:10px;background:var(--gth-subtle);border:1px solid var(--gth-border);border-radius:8px;',
    'padding:12px 14px;font-size:12px;line-height:1.75;white-space:pre-wrap;word-break:break-word;',
    'max-height:42vh;overflow:auto;font-family:inherit}',
    '.gthc-f{display:flex;gap:8px;align-items:center;padding:12px 18px;border-top:1px solid var(--gth-border)}',
    '.gthc-f .sp{flex:1}',

    '#gth-hlbar .dot,#gth-hlmenu .dot,#gth-hlnote .dot,.gth-balloon-h .dot{width:9px;height:9px;',
    'border-radius:50%;display:inline-block;flex:0 0 auto}',
    '#gth-hlmenu .dot.yellow,#gth-hlnote .dot.yellow,.gth-balloon-h .dot.yellow{background:#f59e0b}',
    '#gth-hlmenu .dot.red,#gth-hlnote .dot.red,.gth-balloon-h .dot.red{background:#dc2626}',

    'mark.gth-hl{cursor:pointer}',
    'mark.gth-hl.gth-hl-flash{outline:2px solid #0f172a;outline-offset:1px}',

    '.gth-hlp-item .bd{flex:1;min-width:0}',
    '.gth-hlp-item .t,.gth-hlp-item .n{cursor:pointer}',
    '.gth-hlp-item .n{margin-top:3px;padding-left:7px;border-left:2px solid #fcd34d;color:#92400e;white-space:pre-wrap}',
    '.gth-hlp-item .n:empty{display:none}',
    '.gth-hl-cap{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--gth-muted);margin-bottom:4px}',
    '.gth-hl-cap .gth-ic{font-size:12px}',
    '.gthq-hls:empty{display:none}',
    // 题号列、圆圈选项、右下角那条线：数值抄 gongan.min.ebe4763b.css 的
    // .sequence-box / .choice .label .circle / .bottom-line，题本与重练报告共用这一份。
    '.gth-qmain{display:flex;align-items:flex-start;gap:15px}',
    '.gth-seq{width:40px;flex:0 0 auto}',
    '.gth-seq-box{width:25px;height:25px;text-align:center;line-height:25px;font-size:14px;background:#b3c8e9;margin:0 auto}',
    '.gth-qbody{flex:1;min-width:0;line-height:2;color:#222221;font-size:14px;word-break:break-all}',
    '.gth-choice{display:flex;align-items:center;margin-top:10px}',
    '.gth-opt-plain{margin-top:10px;line-height:2}',
    '.gth-circle{width:18px;height:18px;border-radius:80%;border:1px solid #b2b2b2;box-sizing:border-box;flex:0 0 auto}',
    '.gth-circle.right{border:5px solid #0c0}',
    '.gth-circle.wrong{border:5px solid red}',
    '.gth-circle.checked{border:5px solid #5188f5}',
    '.gth-ctext{display:flex;align-items:flex-start;padding-left:10px;flex:1;min-width:0}',
    '.gth-clab{flex:0 0 auto}',
    '.gth-cval{flex:1;min-width:0}',
    '.gth-bline{display:flex;align-items:center;user-select:none;margin-top:14px}',
    '.gth-bline .ln{flex:1;height:1px;background:#ddd}',
    '.gth-btext{color:#8c8c8c;position:relative;padding:0 30px 0 10px;font-size:14px;cursor:pointer;flex:0 0 auto}',
    '.gth-btext:after{position:absolute;right:0;top:50%;margin-top:-5px;content:"";' +
      'border-top:10px solid #8c8c8c;border-left:10px solid transparent;border-right:10px solid transparent}',
    '.gth-btext.on:after{border-top:none;border-bottom:10px solid #8c8c8c}',
    '.gth-btext .t-close{display:none}',
    '.gth-btext.on .t-open{display:none}',
    '.gth-btext.on .t-close{display:inline}',
    '.gth-book-head{display:flex;align-items:baseline;gap:10px;margin-bottom:10px;flex-wrap:wrap}',
    '.gth-book-head b{font-size:15px}',
    '.gth-book-head .sub{color:var(--gth-muted);font-size:12px}',
    '.gth-book-scroll{height:min(600px,calc(100vh - 300px));min-height:320px;overflow-y:auto;overflow-x:hidden;',
    'box-sizing:border-box;padding-right:4px}',
    '.gth-book-list{display:flex;flex-direction:column;gap:22px}',
    '.gth-book-filter{margin-bottom:8px}',
    '.gth-book-search{position:relative;display:inline-flex;align-items:center;flex:1;min-width:180px;max-width:340px}',
    '.gth-book-search .ic-l{position:absolute;left:9px;color:var(--gth-muted);display:inline-flex;pointer-events:none}',
    '.gth-book-search input{width:100%;padding-left:30px}',
    '.gth-book-pager{display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;padding:14px 0 4px}',
    '.gth-book-pager button{min-width:32px;height:32px;padding:0 8px;border:1px solid var(--gth-border);',
    'border-radius:6px;background:var(--gth-bg);color:var(--gth-muted);font-size:12px;cursor:pointer;font-family:inherit}',
    '.gth-book-pager button:hover{background:var(--gth-hover);color:var(--gth-fg)}',
    '.gth-book-pager button.on{background:var(--gth-primary);border-color:var(--gth-primary);color:var(--gth-primary-fg);font-weight:600}',
    '.gth-book-pager button:disabled{opacity:.45;cursor:not-allowed}',
    '.gth-book-pager .gap{color:var(--gth-muted);padding:0 2px}',
    '.gth-flash{animation:gth-flash 1.6s ease-out}',
    '.gth-abar{position:relative;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0 8px;font-size:12px;color:var(--gth-muted)}',
    '.gth-abar-tag{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--gth-muted);padding:0 2px}',
    '.gth-abar-tag.off{color:#b45309}',
    '.gth-abar .sp{flex:1}',
    '.gth-qtime{position:relative;display:inline-flex}',
    '.gth-ztop{position:absolute;top:12px;right:24px;z-index:6;display:flex;align-items:center;gap:8px;' +
    'max-width:calc(100% - 48px)}',
    '.gth-ztop .gth-btn{height:28px;padding:0 9px;font-size:12px;gap:5px;border-radius:6px;' +
    'border-color:rgba(15,23,42,.06);background:rgba(255,255,255,.82);color:#475569}',
    '.gth-ztop .gth-btn:hover{background:#fff;border-color:var(--gth-border);color:var(--gth-fg)}',
    '.gth-ztop .gth-btn .gth-ic{font-size:13px}',
    '.gth-ztop .gth-abar{padding:0;flex-wrap:nowrap}',
    '.gth-qtime-h{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}',
    '.gth-qtime-caret{display:inline-flex;align-items:center;opacity:.6}',
    '.gth-qtime-panel{display:none;position:absolute;top:calc(100% + 2px);left:0;z-index:60;box-sizing:border-box;' +
    'width:min(340px,72vw);max-height:340px;overflow:auto;pointer-events:auto;' +
    'border:1px solid var(--gth-border);border-left:3px solid #94a3b8;border-radius:8px;background:#fff;' +
    'padding:6px 0;font-size:12px;line-height:1.7;color:#1f2937;box-shadow:0 8px 22px rgba(15,23,42,.16)}',
    '.gth-qtime:hover .gth-qtime-panel,.gth-qtime:focus-within .gth-qtime-panel,.gth-qtime.on .gth-qtime-panel{display:block}',
    '.gth-qtime-row{display:flex;align-items:baseline;gap:8px;padding:2px 12px}',
    '.gth-qtime-row .n{flex:0 0 auto;min-width:52px;white-space:nowrap;color:var(--gth-muted);font-variant-numeric:tabular-nums}',
    '.gth-qtime-row .s{flex:1 1 auto;text-align:right;font-variant-numeric:tabular-nums;color:#713f12}',
    '.gth-apanel{position:absolute;top:calc(100% + 2px);left:0;z-index:60;box-sizing:border-box;',
    'width:min(340px,72vw);max-height:340px;overflow:auto;pointer-events:auto;',
    'border:1px solid #fde68a;border-left:3px solid #fcd34d;border-radius:8px;background:#fffbeb;',
    'padding:9px 11px;font-size:12px;line-height:1.7;color:#713f12;box-shadow:0 8px 22px rgba(15,23,42,.16)}',
    '.gth-apanel-h{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#a16207;margin-bottom:5px}',
    '.gth-apanel-h .sp{flex:1}',
    '.gth-note-area{display:flex;flex-direction:column;gap:6px}',
    '.gth-note-text{white-space:pre-wrap;word-break:break-word}',
    '.gth-note-empty{color:var(--gth-muted);cursor:pointer}',
    '.gth-note-empty:hover{color:var(--gth-fg)}',
    '.gth-apanel .gth-note-empty{color:#a16207;opacity:.75}',
    '.gth-apanel .gth-note-empty:hover{opacity:1}',
    '.gth-note-act{display:flex;gap:6px}',
    '.gth-apanel textarea{width:100%;min-height:96px;box-sizing:border-box;border:1px solid #fde68a;',
    'border-radius:6px;padding:6px 8px;font:inherit;line-height:1.7;color:inherit;background:#fff}',
    '@keyframes gth-flash{0%{box-shadow:0 0 0 3px rgba(245,158,11,.55)}70%{box-shadow:0 0 0 3px rgba(245,158,11,.25)}100%{box-shadow:none}}',

    '#gth-hlmenu{position:fixed;z-index:100004;display:flex;flex-direction:column;gap:2px;padding:6px;',
    'background:var(--gth-bg);border:1px solid var(--gth-border);border-radius:8px;min-width:172px;',
    'box-shadow:0 8px 24px rgba(15,23,42,.18);',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}',
    '#gth-hlmenu[hidden]{display:none}',
    '#gth-hlmenu button{display:flex;align-items:center;gap:6px;height:28px;padding:0 9px;border:none;',
    'background:transparent;border-radius:6px;font-size:12px;color:var(--gth-fg);cursor:pointer;',
    'font-family:inherit;text-align:left;width:100%}',
    '#gth-hlmenu button:hover{background:var(--gth-hover)}',
    '#gth-hlmenu button.danger{color:var(--gth-destructive)}',
    '#gth-hlmenu .gth-hlm-q{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--gth-muted);',
    'padding:2px 9px 6px;border-bottom:1px solid var(--gth-border);margin-bottom:4px;word-break:break-all}',
    '#gth-hlmenu .gth-hlm-c{display:flex;gap:2px}',
    '#gth-hlmenu .gth-hlm-c button{width:auto;flex:1}',
    '#gth-hlmenu .gth-hlm-c button.on{background:var(--gth-subtle);font-weight:600}',

    '#gth-hlnote{position:fixed;z-index:100005;width:min(420px,calc(100vw - 32px));',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}',
    '#gth-hlnote[hidden]{display:none}',
    '.gth-hln-box{background:var(--gth-bg);border:1px solid var(--gth-border);border-radius:8px;',
    'box-shadow:0 12px 36px rgba(15,23,42,.22);overflow:hidden}',
    '.gth-hln-h{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--gth-border);font-size:13px}',
    '.gth-hln-h .sp{flex:1}',
    '.gth-hln-q{display:flex;align-items:flex-start;gap:6px;padding:9px 12px;font-size:12px;',
    'line-height:1.7;color:var(--gth-muted);background:var(--gth-subtle);word-break:break-word}',
    '.gth-hln-q .dot{margin-top:5px}',
    '.gth-hln-box textarea{display:block;width:100%;min-height:84px;box-sizing:border-box;border:none;',
    'border-bottom:1px solid var(--gth-border);padding:10px 12px;font-size:13px;line-height:1.7;',
    'resize:vertical;font-family:inherit;background:var(--gth-bg);color:var(--gth-fg);outline:none}',
    '.gth-hln-f{display:flex;align-items:center;gap:6px;padding:9px 12px}',
    '.gth-hln-f .sp{flex:1}',

    '.gth-balloon{position:absolute;left:0;width:100%;box-sizing:border-box;pointer-events:auto;',
    'border:1px solid var(--gth-border);border-left:3px solid #fcd34d;border-radius:8px;background:#fffbeb;',
    'padding:7px 9px;font-size:11px;line-height:1.65;color:#713f12;cursor:pointer}',
    '.gth-balloon:hover{border-color:var(--gth-border-strong);box-shadow:0 2px 8px rgba(15,23,42,.08)}',
    '.gth-balloon[hidden]{display:none}',
    '.gth-balloon-h{display:flex;align-items:flex-start;gap:5px;font-size:10px;color:#a16207;',
    'opacity:.85;margin-bottom:3px;word-break:break-word}',
    '.gth-balloon-h .dot{margin-top:3px}',
    '.gth-balloon-h .q{flex:1;min-width:0}',
    '.gth-balloon-b{white-space:pre-wrap;word-break:break-word;color:var(--gth-fg);font-size:12px}'
  ].join(''));

  var viewEl = document.createElement('div');
  viewEl.className = 'gth-view zero-flex-1';
  viewEl.hidden = true;
  viewEl.innerHTML = [
    '  <div class="gth-head">',
    '    <div class="gth-tabs">',
    '      <button data-tab="export" class="on">' + icon('download') + '导出</button>',
    '      <button data-tab="practice">' + icon('play') + '重练</button>',
    '      <button data-tab="notes">' + icon('bookOpen') + '笔记</button>',
    '    </div>',
    '  </div>',
    '  <div class="gth-body">',

    '    <div id="gth-shared">',
    '      <div class="gth-row" id="gth-src-row">',
    '        <label>来源</label>',
    '        <select id="gth-src" class="gth-select">',
    '          <option value="error">错题本</option>',
    '          <option value="favorite">收藏夹</option>',
    '          <option value="both">两者合并</option>',
    '          <option value="mock">模考收录</option>',
    '          <option value="book">补充题本</option>',
    '        </select>',
    '      </div>',
    '      <div class="gth-row" id="gth-scope-row">',
    '        <label>范围</label>',
    '        <select id="gth-mode" class="gth-select">',
    '          <option value="date">按日期</option>',
    '          <option value="subject">按科目</option>',
    '        </select>',
    '        <span class="gth-date-only">',
    '          <select id="gth-day" class="gth-select">',
    DAY_RANGES.map(function (d) { return '<option value="' + d[0] + '">' + d[1] + '</option>'; }).join(''),
    '          </select>',
    '        </span>',
    '        <span class="gth-subject-only" hidden>',
    '          <select id="gth-subject" class="gth-select">',
    '            <option value="1">公安专业知识</option>',
    '            <option value="0">行政职业能力测试</option>',
    '          </select>',
    '        </span>',
    '      </div>',
    '      <div class="gth-xc-only" hidden>',
    '        <div class="gth-chiprow">',
    '          <span class="gth-chiplabel">模块</span>',
    '          <div class="gth-chips" id="gth-mod-chips"></div>',
    '        </div>',
    '      </div>',
    '      <div id="gth-mock-chiprow" hidden>',
    '        <div class="gth-chiprow">',
    '          <span class="gth-chiplabel">模考模块</span>',
    '          <div class="gth-chips" id="gth-mock-chips"></div>',
    '        </div>',
    '      </div>',
    '    </div>',

    '    <div data-pane="export">',
    '      <div class="gth-row">',
    '        <select id="gth-fmt" class="gth-select">',
    '          <option value="md">Markdown（.md）</option>',
    '          <option value="xlsx">Excel（.xlsx）</option>',
    '          <option value="csv">CSV（.csv）</option>',
    '        </select>',
    '        <button class="gth-btn primary" id="gth-export-new">' + icon('download') + '导出新增</button>',
    '        <button class="gth-btn" id="gth-export-all">导出全部题目</button>',
    '      </div>',
    '      <div class="gth-export-meta">',
    '        <span id="gth-count" class="gth-notes-meta"></span>',
    '        <span id="gth-export-hint" class="gth-notes-meta"></span>',
    '        <button class="gth-btn ghost sm" id="gth-reset-base">重置增量基线</button>',
    '      </div>',
    '      <div class="gth-hint">首次导出会自动按当前来源与筛选载入题目</div>',
    '    </div>',

    '    <div data-pane="practice" hidden>',
    '      <div class="gth-row">',
    '        <label>来源</label>',
    '        <div class="gth-dd" id="gth-src-dd">',

    '          <button type="button" class="gth-select gth-dd-btn" id="gth-src-dd-btn">',
    '            <span id="gth-src-dd-label">错题本</span></button>',
    '          <div class="gth-dd-menu" id="gth-src-dd-menu" hidden>',
    '            <label class="gth-dd-opt"><input type="checkbox" data-src="error"><span>错题本</span></label>',
    '            <label class="gth-dd-opt"><input type="checkbox" data-src="favorite"><span>收藏夹</span></label>',
    '            <label class="gth-dd-opt"><input type="checkbox" data-src="mock"><span>模考收录</span></label>',
    '            <label class="gth-dd-opt"><input type="checkbox" data-src="book"><span>补充题本（本地收录的全部题）</span></label>',
    '          </div>',
    '        </div>',
    '        <label>题量</label>',
    '        <input id="gth-num" class="gth-input" type="number" min="0" max="500" step="1" value="20" style="width:84px">',
    '        <select id="gth-order" class="gth-select">',
    '          <option value="random">随机</option>',
    '          <option value="asc">原序</option>',
    '          <option value="desc">倒序</option>',
    '        </select>',
    '        <label>限时</label>',
    '        <input id="gth-min" class="gth-input" type="number" min="0" max="600" step="1" placeholder="不限" style="width:64px">',
    '        <button class="gth-btn primary" id="gth-start">' + icon('play') + '开始重练</button>',
    '      </div>',
    '      <div class="gth-row" style="margin-top:6px">',
    '        <span id="gth-practice-hint" class="gth-notes-meta"></span>',
    '        <span class="sp"></span>',
    '        <button class="gth-btn ghost sm" id="gth-resume-reset" hidden>从头开始</button>',
    '      </div>',
    '      <div class="gth-sep"></div>',
    '      <div class="gth-sub">最近组卷</div>',
    '      <div id="gth-history" class="gth-his"></div>',
    '    </div>',

    '    <div data-pane="notes" hidden>',
    '      <div class="gth-notes-search">',
    '        <span class="ic-l">' + icon('search') + '</span>',
    '        <input id="gth-note-search" class="gth-input" placeholder="搜索笔记内容或题干">',
    '      </div>',
    '      <div class="gth-row">',
    '        <select id="gth-nf-subj" class="gth-select">',
    '          <option value="">全部科目</option>',
    '          <option value="1">公安专业知识</option>',
    '          <option value="0">行政职业能力测试</option>',
    '          <option value="x">科目未记录</option>',
    '        </select>',
    '        <select id="gth-nf-mod" class="gth-select"></select>',
    '        <select id="gth-nf-src" class="gth-select">',
    '          <option value="">全部来源</option>',
    '          <option value="site">练习题</option>',
    '          <option value="error">练习题 · 错题本</option>',
    '          <option value="favorite">练习题 · 收藏夹</option>',
    '          <option value="both">练习题 · 两处都有</option>',
    '          <option value="mock">模考收录</option>',
    '        </select>',
    '        <select id="gth-nf-mast" class="gth-select">',
    '          <option value="">全部状态</option>',
    '          <option value="un">未掌握</option>',
    '          <option value="dyn">待巩固</option>',
    '          <option value="done">已掌握</option>',
    '        </select>',
    '        <select id="gth-nf-cont" class="gth-select">',
    '          <option value="">笔记＋划线</option>',
    '          <option value="note">仅笔记</option>',
    '          <option value="hl">仅划线</option>',
    '          <option value="both">两者都有</option>',
    '        </select>',
    '      </div>',
    '      <div class="gth-hint" id="gth-nf-mod-hint" hidden>模块取自每题自带的考点编号，脚本在载入题目时顺手登记。这批笔记题还没登记上——在「导出」或「重练」里按当前条件载入一次题目就会补上。</div>',
    '      <div class="gth-row" style="margin-bottom:8px">',
    '        <span id="gth-note-count" class="gth-notes-meta"></span>',
    '        <span class="sp"></span>',
    '        <button class="gth-btn sm" id="gth-collect-open">' + icon('highlighter') + '一键整理</button>',
    '        <button class="gth-btn sm" id="gth-export-notes-md">' + icon('fileText') + '导出笔记(MD)</button>',
    '      </div>',
    '      <div id="gth-notes-list" class="gth-notes-list"></div>',
    '    </div>',

    '    <div class="gth-data">',
    '      <div class="gth-sub">本地数据</div>',
    '      <div class="gth-data-row">',
    '        <button class="gth-btn" id="gth-backup" title="导出一份含全部题目、笔记、划线与各项记录的 JSON 文件">' + icon('database') + '备份全部数据</button>',
    '        <button class="gth-btn" id="gth-restore" title="从之前备份的 JSON 文件恢复">' + icon('upload') + '恢复备份</button>',
    '        <button class="gth-btn go" id="gth-upgrade">' + icon('rotate') + '升级后点我' +
    '          <span class="gth-q" title="换了新版脚本之后点一下就行。它会先清掉本机已经用不上的旧记录（删之前会列出来问你要不要删），再连一次站点，把笔记与划线对应的题补上模块、科目和来源，并认出哪些题站点自己已经收了——补充题本靠这一条决定谁该留下。需要联网，几秒钟。你的笔记、划线、掌握状态和已收录的题都不动。">?</span></button>',
    '        <span class="sp"></span>',
    '        <button class="gth-btn danger" id="gth-wipe" title="删掉本机全部笔记、划线、掌握状态与收录记录">' + icon('trash') + '清空本地数据</button>',
    '        <input type="file" id="gth-file" accept="application/json,.json" hidden>',
    '      </div>',
    '      <div class="gth-hint">这些数据只存在本机浏览器（localStorage）里，不上传站点。清理浏览器数据、换设备或重装系统之前，先点「备份全部数据」存一份 JSON；要还回来就用「恢复备份」选回那个文件。</div>',
    '    </div>',
    '    <div id="gth-status" hidden></div>',
    '  </div>'
  ].join('');
  document.body.appendChild(viewEl);

  var bookViewEl = document.createElement('div');
  bookViewEl.className = 'gth-view zero-flex-1';
  bookViewEl.id = 'gth-book-view';
  bookViewEl.hidden = true;
  bookViewEl.innerHTML = [
    '  <div class="gth-book-head">',
    '    <b>' + icon('listChecks') + '补充题本</b>',
    '    <span class="sub">站点错题本与收藏夹里没有的题：写过笔记、划过线，或模考收进来的。</span>',
    '  </div>',
    '  <div class="gth-row gth-book-filter">',
    '    <select id="gth-bf-subj" class="gth-select">',
    '      <option value="">全部科目</option>',
    '      <option value="1">公安专业知识</option>',
    '      <option value="0">行政职业能力测试</option>',
    '      <option value="x">科目未记录</option>',
    '    </select>',
    '    <select id="gth-bf-mod" class="gth-select"></select>',
    '    <span class="gth-book-search">',
    '      <span class="ic-l">' + icon('search') + '</span>',
    '      <input id="gth-bf-q" class="gth-input" placeholder="搜题干、解析或笔记">',
    '    </span>',
    '    <span class="sp"></span>',
    '    <button class="gth-btn sm ghost" id="gth-bf-reset" hidden>清空筛选</button>',
    '  </div>',
    '  <div class="gth-row" style="margin-bottom:8px">',
    '    <span id="gth-book-count" class="gth-notes-meta"></span>',
    '  </div>',
    '  <div class="gth-book-scroll" id="gth-book-scroll">',
    '    <div id="gth-book-list" class="gth-book-list"></div>',
    '  </div>',
    '  <div class="gth-book-pager" id="gth-book-pager"></div>',
    '  <div id="gth-book-status" hidden></div>'
  ].join('');
  document.body.appendChild(bookViewEl);

  var railEl = document.createElement('div');
  railEl.id = 'gth-rail';
  railEl.className = 'gth-rail';
  railEl.hidden = true;
  railEl.innerHTML = '<div class="gth-rail-in" id="gth-rail-in"></div>';
  document.body.appendChild(railEl);

  var statusEl = $('#gth-status');
  var bookViewOn = false;

  function activeStatus() { return bookViewOn ? ($('#gth-book-status') || statusEl) : statusEl; }

  function setStatus(msg, kind) {
    var el = activeStatus();
    if (!msg) { el.hidden = true; el.textContent = ''; el.className = ''; return; }
    el.hidden = false;
    el.textContent = msg;
    el.className = kind || '';
  }

  function busy(btn, p) {
    if (!btn) return p;
    btn.disabled = true;
    return p.then(function (v) { btn.disabled = false; return v; },
                  function (e) { btn.disabled = false; throw e; });
  }

  var selectedModules = [];
  var moduleList = [];

  var modulesLoading = false;
  var modulesLoaded = false;

  var practiceSrcs = ['error'];
  var practiceSrcTouched = false;
  var selectedMockModules = [];

  var SRC_KEYS = ['error', 'favorite', 'mock', 'book'];
  var SRC_NAME = { error: '错题本', favorite: '收藏夹', both: '错题+收藏', mock: '模考收录', book: '补充题本' };
  var SRC_LIST_LABEL = { error: '错题本', favorite: '收藏夹', both: '错题本＋收藏夹', book: '补充题本' };

  function filterDesc(f) {
    var srcs = srcList(f);
    var parts = [];
    var site = srcs.filter(function (s) { return s !== 'mock'; });
    if (site.length) {
      parts.push(srcLabel(site) + ' · ' +
        (f.mode === 'date' ? '日期：' + dayLabel(f.dayRange) : subjectDesc(f)));
    }

    if (srcs.indexOf('mock') >= 0) {
      var mods = f.mock_modules || [];
      parts.push(SRC_NAME.mock + (mods.length ? '（' + mods.join('、') + '）' : '（全部模考题）'));
    }
    return parts.join(' ＋ ');
  }
  function dayLabel(v) {
    var d = DAY_RANGES.filter(function (x) { return x[0] === String(v); })[0];
    return d ? d[1] : v;
  }
  function subjectDesc(f) {
    var s = SUBJECT_NAME[f.subject] || f.subject;
    if (f.subject === SUBJ_XC) {
      var names = f.module_names || [];
      s += names.length ? '（' + names.join('、') + '）' : '（全部模块）';
    }
    return s;
  }

  function readFilter(pane) {
    var mode = $('#gth-mode').value;
    var srcs = pane === 'practice' ? practiceSrcs.slice() : [currentSrc()];
    var f = { mode: mode, srcs: srcs };
    if (mode === 'date') {
      f.dayRange = $('#gth-day').value;
    } else {
      f.subject = Number($('#gth-subject').value);
      if (f.subject === SUBJ_XC) f.module_names = selectedModules.slice();
    }
    if (srcs.indexOf('mock') >= 0) f.mock_modules = selectedMockModules.slice();
    return f;
  }

  function chipsHtml(items, sel) {
    var allOn = sel.length === 0;
    var html = '<div class="gth-chip' + (allOn ? ' on' : '') + '" data-idx="-1">' +
      (allOn ? icon('checkCircle') : '') + '全部</div>';
    return html + items.map(function (m, i) {
      var on = sel.indexOf(m.name) >= 0;
      return '<div class="gth-chip' + (on ? ' on' : '') + '" data-idx="' + i + '">' +
        (on ? icon('checkCircle') : '') + esc(m.name) +
        (m.n == null ? '' : '<b class="n">' + m.n + '</b>') + '</div>';
    }).join('');
  }

  function bindChips(box, getItems, sel, redraw) {
    $$('.gth-chip', box).forEach(function (chip) {
      chip.addEventListener('click', function () {
        var items = getItems();
        var idx = Number(chip.dataset.idx);
        if (idx < 0) sel.length = 0;
        else {
          var name = items[idx] && items[idx].name;
          var i = sel.indexOf(name);
          if (i >= 0) sel.splice(i, 1);
          else if (name) sel.push(name);
        }
        invalidateLoaded();
        redraw();
      });
    });
  }

  function renderModChips() {
    var box = $('#gth-mod-chips');
    if (!box) return;
    if (!moduleList.length) {
      box.innerHTML = '<div class="gth-chips-empty">未获取到行测模块，可直接开始（将按全部错题处理）</div>';
      return;
    }
    box.innerHTML = chipsHtml(moduleList, selectedModules);
    bindChips(box, function () { return moduleList; }, selectedModules, renderModChips);
  }

  function renderMockChips() {
    var box = $('#gth-mock-chips');
    if (!box) return;
    var items = mockModuleOptions();

    var names = items.map(function (m) { return m.name; });
    for (var i = selectedMockModules.length - 1; i >= 0; i--) {
      if (names.indexOf(selectedMockModules[i]) < 0) selectedMockModules.splice(i, 1);
    }
    if (!items.length) {
      box.innerHTML = '<div class="gth-chips-empty">还没有收录过模考题：先去模考报告解析页用「收齐全场答错题」收集。</div>';
      return;
    }
    box.innerHTML = chipsHtml(items, selectedMockModules);
    bindChips(box, function () { return mockModuleOptions(); }, selectedMockModules, renderMockChips);
  }

  function activePane() {
    var on = $('.gth-tabs button.on');
    return on ? on.dataset.tab : 'export';
  }

  function syncFilterUI() {
    var mode = $('#gth-mode').value;
    var pane = activePane();
    $('#gth-shared').hidden = pane === 'notes' || pane === 'book';
    $('#gth-src-row').hidden = pane === 'practice';
    var srcs = srcList({ srcs: pane === 'practice' ? practiceSrcs : [currentSrc()] });
    var siteOn = hasSiteSrc(pane === 'practice' ? practiceSrcs : [currentSrc()]);

    $('#gth-scope-row').hidden = !siteOn;
    $('.gth-date-only').hidden = !(siteOn && mode === 'date');
    $('.gth-subject-only').hidden = !(siteOn && mode === 'subject');
    var xc = siteOn && mode === 'subject' && Number($('#gth-subject').value) === SUBJ_XC;
    $('.gth-xc-only').hidden = !xc;
    if (xc && !moduleList.length && !modulesLoading && !modulesLoaded) loadModules();
    $('#gth-mock-chiprow').hidden = srcs.indexOf('mock') < 0;
    if (srcs.indexOf('mock') >= 0) renderMockChips();
    renderPracticeHint();
  }

  function loadModules() {
    modulesLoading = true;
    return fetchSubcategory().then(function (list) {
      modulesLoading = false;
      modulesLoaded = true;
      moduleList = buildModuleOptions(list);

      console.log('[错题助手] 行测模块：', moduleList.map(function (m) { return m.name; }),
        '｜原始 subcategory_list：', list.map(function (c) {
          return c.name + ' × ' + (c.exampoint_list || []).length;
        }).join(' / '));
      renderModChips();
    }).catch(function (e) {
      modulesLoading = false;
      setStatus('行测模块加载失败：' + e.message, 'err');
    });
  }

  function renderPracticeSrc() {
    var label = $('#gth-src-dd-label');
    if (!label) return;
    label.textContent = practiceSrcs.length
      ? practiceSrcs.map(function (s) { return SRC_NAME[s]; }).join('＋')
      : '选择来源';
    $$('#gth-src-dd-menu input').forEach(function (cb) {
      cb.checked = practiceSrcs.indexOf(cb.dataset.src) >= 0;
    });
  }

  function checkedPracticeSrcs() {
    return $$('#gth-src-dd-menu input').filter(function (cb) { return cb.checked; })
      .map(function (cb) { return cb.dataset.src; });
  }

  $('#gth-src-dd-btn').addEventListener('click', function (e) {
    e.stopPropagation();
    var menu = $('#gth-src-dd-menu');
    menu.hidden = !menu.hidden;
  });

  document.addEventListener('click', function (e) {
    var dd = $('#gth-src-dd'), menu = $('#gth-src-dd-menu');
    if (dd && menu && !menu.hidden && !dd.contains(e.target)) menu.hidden = true;
  });
  document.addEventListener('keydown', function (e) {
    var menu = $('#gth-src-dd-menu');
    if (e.key === 'Escape' && menu && !menu.hidden) menu.hidden = true;
  });
  $$('#gth-src-dd-menu input').forEach(function (cb) {
    cb.addEventListener('change', function () {
      practiceSrcTouched = true;
      practiceSrcs = checkedPracticeSrcs();
      invalidateLoaded();
      renderPracticeSrc();
      syncFilterUI();
    });
  });

  var notesFilter = { subj: '', mod: '', src: '', mast: '', cont: '' };
  var notesShownIds = [];

  function notesNarrowed() {
    return !!(notesFilter.subj || notesFilter.mod || notesFilter.src ||
      notesFilter.mast || notesFilter.cont || notesSearchKey.trim());
  }

  function readNotesFilter() {
    notesFilter.subj = $('#gth-nf-subj').value;
    notesFilter.mod = $('#gth-nf-mod').value;
    notesFilter.src = $('#gth-nf-src').value;
    notesFilter.mast = $('#gth-nf-mast').value;
    notesFilter.cont = $('#gth-nf-cont').value;
  }

  function masteryKey(id) {
    var l = masteredLabel(id);
    return l === '已掌握' ? 'done' : (l.indexOf('待巩固') === 0 ? 'dyn' : 'un');
  }

  function noteFacets(id) {
    var n = store.notes[id] || {};
    var hls = getHighlights(id);
    var subj = n.subject != null ? n.subject : (hls[0] && hls[0].subject);
    return {
      subj: subj == null ? 'x' : String(subj),
      mod: moduleOf(id) || MOCK_UNCLS,
      src: store.mockQs[id] ? 'mock' : ((store.qSrc && store.qSrc[id]) || 'site'),
      mast: masteryKey(id),
      hasNote: !!n.text,
      hasHl: hls.length > 0
    };
  }

  function noteMatch(r, nf) {
    if (nf.subj && r.subj !== nf.subj) return false;
    if (nf.mod && r.mod !== nf.mod) return false;
    if (nf.src && !(nf.src === 'site' ? r.src !== 'mock' : r.src === nf.src)) return false;
    if (nf.mast && r.mast !== nf.mast) return false;
    if (nf.cont === 'note' && !r.hasNote) return false;
    if (nf.cont === 'hl' && !r.hasHl) return false;
    if (nf.cont === 'both' && !(r.hasNote && r.hasHl)) return false;
    return true;
  }

  function renderNoteFilterMods(ids) {
    var sel = $('#gth-nf-mod');
    if (!sel) return;
    var names = {}, hasUnknown = false;
    ids.forEach(function (id) {
      var m = moduleOf(id);
      if (m) names[m] = 1; else hasUnknown = true;
    });
    sel.innerHTML = '<option value="">全部模块</option>' +
      Object.keys(names).sort().map(function (n) {
        return '<option value="' + esc(n) + '">' + esc(n) + '</option>';
      }).join('') +
      (hasUnknown ? '<option value="' + esc(MOCK_UNCLS) + '">模块未记录</option>' : '');
    sel.value = notesFilter.mod;
    notesFilter.mod = sel.value;

    setIf($('#gth-nf-mod-hint'), 'hidden', !ids.length || Object.keys(names).length > 0);
  }

  ['gth-nf-subj', 'gth-nf-mod', 'gth-nf-src', 'gth-nf-mast', 'gth-nf-cont'].forEach(function (id) {
    $('#' + id).addEventListener('change', function () { readNotesFilter(); renderNotesList(); });
  });

  var viewOn = false;
  var panelRev = -1;

  function routeKind() {
    var h = location.hash || '';
    if (h.indexOf('#/error') === 0) return 'error';
    if (h.indexOf('#/shoucang') === 0) return 'collect';
    return '';
  }
  function isCollectRoute() { return routeKind() === 'collect'; }
  function isListRoute() { return !!routeKind(); }

  function applyChrome() {
    var any = viewOn || bookViewOn;
    var rc = $('.gongan2-container .right-content') || $('.right-content');
    if (rc) {

      $$('.second-menu, .inner-content', rc).forEach(function (el) { el.classList.toggle('gth-hide', any); });
      if (viewEl.parentNode !== rc) rc.appendChild(viewEl);
      if (bookViewEl.parentNode !== rc) rc.appendChild(bookViewEl);
    }
    viewEl.hidden = !viewOn;
    bookViewEl.hidden = !bookViewOn;
    document.body.classList.toggle('gth-view-on', any);

    var h = document.getElementById('gth-menu-helper'), b = document.getElementById('gth-menu-book');
    if (h) h.classList.toggle('active', viewOn);
    if (b) b.classList.toggle('active', bookViewOn);
  }

  function renderPanel() {
    panelRev = storeRev;
    renderHistory();
    updateExportHint();
  }

  function setView(on) {
    if (on) bookViewOn = false;
    viewOn = on;
    applyChrome();
    if (on) {
      renderPanel();
      syncFilterUI();
    }
    syncRail();
  }

  function setBookView(on) {
    if (on) viewOn = false;
    bookViewOn = on;
    applyChrome();
    if (on) {
      bookPage = 1;
      renderBookList();
    } else {
      $$('.gth-aside[data-book="1"]').forEach(function (a) { a.remove(); });
      injectListUI();
    }
    syncRail();
  }

  function addMenuEntry(menu, id, html, tip, onClick, active) {
    var btn = document.getElementById(id);
    if (!btn) {
      btn = document.createElement('div');
      btn.className = 'item zero-flex-ver-center gth-menu-item';
      btn.id = id;
      btn.innerHTML = html;
      btn.title = tip;
      btn.addEventListener('click', onClick);
      var items = $$('.item', menu), anchor = null;
      for (var i = 0; i < items.length; i++) {
        if ((items[i].textContent || '').indexOf('公安专业知识') >= 0) { anchor = items[i]; break; }
      }
      if (!anchor) return null;
      var mine = document.getElementById('gth-menu-helper');
      if (id === 'gth-menu-book' && mine && mine.nextSibling) menu.insertBefore(btn, mine.nextSibling);
      else if (anchor.nextSibling) menu.insertBefore(btn, anchor.nextSibling);
      else menu.appendChild(btn);
    }
    btn.classList.toggle('active', !!active);
    return btn;
  }

  function injectMenuEntry() {
    var menu = $('.gongan2-container .left-menu') || $('.left-menu');
    var kind = routeKind();

    if (!kind) {
      $$('.gth-menu-item').forEach(function (el) {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      return;
    }
    if (!menu) return;

    addMenuEntry(menu, 'gth-menu-helper', '<div class="text">' + icon('sparkles') + '机考助手</div>',
      '笔记 / 导出 / 重练 / 掌握状态', function () { setView(!viewOn); }, viewOn);
    addMenuEntry(menu, 'gth-menu-book', '<div class="text">' + icon('listChecks') + '补充题本</div>',
      '站点没收进来的题：写过笔记、划过线，或模考收进来的', function () { setBookView(!bookViewOn); }, bookViewOn);
  }

  document.addEventListener('click', function (e) {
    if (!viewOn && !bookViewOn) return;
    var it = e.target && e.target.closest && e.target.closest('.left-menu .item');
    if (it && !it.classList.contains('gth-menu-item')) { setView(false); setBookView(false); }
  });

  $$('.gth-tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('.gth-tabs button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      $$('[data-pane]').forEach(function (p) {
        p.hidden = p.getAttribute('data-pane') !== b.dataset.tab;
      });
      if (b.dataset.tab === 'notes') renderNotesList();
      if (b.dataset.tab === 'practice') renderHistory();
      syncFilterUI();
    });
  });

  function invalidateLoaded() { loaded.filter = null; loaded.list = []; }

  $('#gth-mode').addEventListener('change', function () { invalidateLoaded(); syncFilterUI(); });
  $('#gth-subject').addEventListener('change', function () { invalidateLoaded(); syncFilterUI(); });
  $('#gth-day').addEventListener('change', invalidateLoaded);
  $('#gth-order').addEventListener('change', renderPracticeHint);
  $('#gth-src').addEventListener('change', function () {
    $('#gth-src').dataset.touched = '1';
    invalidateLoaded();
    updateExportHint();
    syncFilterUI();
  });

  function syncSourceDefault() {
    var el = $('#gth-src');
    if (!el || el.dataset.touched) return;
    var want = isCollectRoute() ? 'favorite' : 'error';

    if (el.value !== want) { el.value = want; invalidateLoaded(); updateExportHint(); }
    if (!practiceSrcTouched && practiceSrcs.join() !== want) {
      practiceSrcs = [want];
      invalidateLoaded();
      renderPracticeSrc();
    }
  }

  var loaded = { filter: null, list: [] };

  function currentSrc() { var el = $('#gth-src'); return (el && el.value) || 'error'; }
  function exIds(src) { return (store.exported && store.exported[src]) || {}; }
  function exAt(src) { return (store.exportAt && store.exportAt[src]) || 0; }

  function newOnes(list) {
    var ex = exIds(currentSrc());
    return list.filter(function (q) { return !ex[q.id]; });
  }
  function markExported(list) {
    var src = currentSrc();
    if (!store.exported[src]) store.exported[src] = {};
    list.forEach(function (q) { store.exported[src][q.id] = 1; });
    store.exportAt[src] = Date.now();
    saveStore();
    updateExportHint();
  }
  function updateExportHint() {
    var el = $('#gth-export-hint');
    if (!el) return;
    var src = currentSrc();
    var n = Object.keys(exIds(src)).length;
    el.textContent = n
      ? SRC_NAME[src] + ' 已导出 ' + n + ' 题 · 上次 ' + fmtAgo(exAt(src))
      : SRC_NAME[src] + ' 尚未导出过任何题目';
  }

  var EXPORT_PREFIX = {
    error: '上岸村错题_', favorite: '上岸村收藏_', both: '上岸村错题收藏_',
    mock: '上岸村模考收录_', book: '上岸村补充题本_'
  };

  function runExport(list, tag) {
    var fmt = $('#gth-fmt').value;
    var name = (EXPORT_PREFIX[currentSrc()] || '上岸村错题_') + tag + '_' + stamp();
    if (fmt === 'md') download(name + '.md', exportMarkdown(list));
    else if (fmt === 'csv') download(name + '.csv', exportCsv(list));
    else download(name + '.xlsx', exportXlsx(list));
  }

  function ensureLoaded() {
    if (loaded.list.length) return Promise.resolve(loaded.list);
    var f = readFilter('export');
    setStatus('正在载入 ' + (srcLabel(f.srcs) || '题目') + '…');
    return fetchByFilter(f).then(function (list) {
      loaded.filter = f;
      loaded.list = list;
      $('#gth-count').textContent = srcLabel(f.srcs) + ' · 共 ' + list.length +
        ' 题 · 新增 ' + newOnes(list).length + ' 题';
      updateExportHint();
      return list;
    });
  }

  $('#gth-export-new').addEventListener('click', function () {
    var btn = this;
    busy(btn, ensureLoaded().then(function () {
      var list = newOnes(loaded.list);
      if (!list.length) { setStatus('没有新增题目（' + loaded.list.length + ' 题此前均已导出过）', ''); return; }
      try {
        runExport(list, '新增');
        var src = currentSrc(), tag = SRC_NAME[src];
        markExported(list);
        setStatus('已导出新增 ' + list.length + ' 题（' + tag + ' 累计已导出 ' +
          Object.keys(exIds(src)).length + ' 题）', 'ok');
      } catch (e) { setStatus('导出失败：' + e.message, 'err'); }
    }).catch(function (e) { setStatus('载入失败：' + e.message, 'err'); }));
  });

  $('#gth-export-all').addEventListener('click', function () {
    var btn = this;
    busy(btn, ensureLoaded().then(function () {
      try {
        runExport(loaded.list, '全量');
        markExported(loaded.list);
        setStatus('已导出全部 ' + loaded.list.length + ' 题', 'ok');
      } catch (e) { setStatus('导出失败：' + e.message, 'err'); }
    }).catch(function (e) { setStatus('载入失败：' + e.message, 'err'); }));
  });

  $('#gth-reset-base').addEventListener('click', function () {
    var src = currentSrc();
    if (!Object.keys(exIds(src)).length) { setStatus(SRC_NAME[src] + ' 的增量基线本就是空的', ''); return; }
    if (!confirm('重置后，下次「导出新增」会把' + SRC_NAME[src] + '当前全部题目视为新增。确定继续？')) return;
    store.exported[src] = {};
    store.exportAt[src] = 0;
    saveStore();
    updateExportHint();
    setStatus(SRC_NAME[src] + ' 增量基线已重置', 'ok');
  });

  $('#gth-backup').addEventListener('click', function () {
    download('上岸村错题_备份全部数据_' + stamp() + '.json', exportJson(loaded.list));
    setStatus('已备份全部数据（' + (loaded.list.length || '0') + ' 题 + 本地笔记与掌握记录）', 'ok');
  });

  $('#gth-export-notes-md').addEventListener('click', function () {

    var ids = notesNarrowed() ? notesShownIds.slice() : null;
    if (ids && !ids.length) { setStatus('当前条件下没有笔记可导出', 'err'); return; }
    if (!ids && !Object.keys(store.notes).length) { setStatus('暂无笔记可导出', 'err'); return; }
    download('上岸村错题_笔记_' + stamp() + '.md', exportNotesMarkdown(ids));
  });

  $('#gth-collect-open').addEventListener('click', function () {
    if (!notesNarrowed()) { openCollect(null); return; }
    if (!notesShownIds.length) { setStatus('当前条件下没有可整理的内容', 'err'); return; }
    openCollect(notesShownIds.slice());
  });

  $('#gth-restore').addEventListener('click', function () { $('#gth-file').click(); });
  $('#gth-file').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () {
      try { setStatus(restoreJson(String(fr.result)), 'ok'); }
      catch (err) { setStatus('恢复失败：' + err.message, 'err'); }
    };
    fr.readAsText(file);
    e.target.value = '';
  });

  $('#gth-wipe').addEventListener('click', function () {
    var nNote = Object.keys(store.notes).length;
    var nStat = Object.keys(store.mastered).length;
    var nExp = ['error', 'favorite', 'both', 'mock'].reduce(function (a, k) {
      return a + Object.keys(exIds(k)).length;
    }, 0);
    var nHis = (store.history || []).length;
    var nRes = Object.keys(store.resume || {}).length;
    var nMock = Object.keys(store.mockQs || {}).length;
    var nSnap = Object.keys(store.snaps || {}).length;
    var nAux = Object.keys(store.practiced || {}).length + Object.keys(store.qModule || {}).length +
      Object.keys(store.qSrc || {}).length;
    if (!nNote && !nStat && !nExp && !nHis && !nRes && !nMock && !nSnap && !nAux) { setStatus('本地数据已为空', ''); return; }
    if (!confirm(
      '将删除本脚本存在此浏览器中的全部数据：\n' +
      '· 笔记 ' + nNote + ' 条\n' +
      '· 掌握记录 ' + nStat + ' 条\n' +
      '· 答错次数统计\n' +
      '· 增量导出记录 ' + nExp + ' 题\n' +
      '· 组卷历史 ' + nHis + ' 条\n' +
      '· 刷题进度 ' + nRes + ' 处\n' +
      '· 模考收录 ' + nMock + ' 题（连带重练登记与模块记录）\n' +
      '· 补充题本快照 ' + nSnap + ' 题\n\n' +
      '此操作不可恢复。建议先点「备份全部数据」再清空。\n\n确定继续？'
    )) return;
    store.notes = {};
    store.mastered = {};
    store.wrongCount = {};
    store.exported = { _v: 2, error: {}, favorite: {}, both: {}, mock: {}, book: {} };
    store.exportAt = { error: 0, favorite: 0, both: 0, mock: 0, book: 0 };
    store.history = [];
    store.resume = {};
    store.mockQs = {};
    store.mocks = {};
    store.practiced = {};
    store.qModule = {};
    store.qSrc = {};
    store.qSrcAt = 0;
    store.snaps = {};
    selectedMockModules.length = 0;
    renderMockChips();
    saveStore();
    refreshBadges();
    renderPracticeHint();
    renderNotesList();
    renderHistory();
    updateExportHint();
    setStatus('已清空本地数据', 'ok');
  });

  var reconciling = false;
  var reconcileTried = false;

  // 题本成员要先知道站点此刻收着哪些题，所以这一趟不等人点：摊开错题页或收藏页时自动跑一次。
  // 只试一次——失败了还在观察器里重试，就成了每 400ms 打一遍站点接口。
  // 「升级后点我」那颗键里也带这一趟，失败时用户还能再点它。
  function autoReconcile() {
    if (reconciling || reconcileTried || reconciled()) return;
    reconcileTried = true;
    reconcileWithSite(null);
  }

  function reconcileWithSite(btn) {
    var beforeMod = Object.keys(store.qModule || {}).length;
    var siteList = [];
    reconciling = true;
    setStatus('正在取行测考点表…');
    busy(btn, ensureExamPointIndex().then(function () {
      setStatus('正在按日期载入错题本与收藏夹…');
      return fetchByFilter({ mode: 'date', dayRange: '4', srcs: ['error', 'favorite'] }, 0);
    }).then(function (list) {
      siteList = list;
      setStatus('正在按科目载入公专题目…');
      return fetchByFilter({ mode: 'subject', subject: SUBJ_ZY, srcs: ['error', 'favorite'] }, 0);
    }).then(function (zyList) {
      var f = sweepFacets(siteList, zyList, examPointModule);
      var gone = reconcileSources(f.srcs, siteList.length > 0 && siteList.length < SITE_LIST_CAP);
      var nSubj = backfillSubject(f.subjects);
      var all = noteIdsWithHl();
      var gap = all.filter(function (id) { return !moduleOf(id); }).length;
      var noSubj = all.filter(function (id) { return noteFacets(id).subj === 'x'; }).length;
      setStatus('按日期过了 ' + siteList.length + ' 题，按科目过了 ' + zyList.length + ' 题；站点在列 ' +
        Object.keys(store.qSrc).length + ' 题' +
        (siteList.length < SITE_LIST_CAP ? '，' + gone + ' 题已不在站点那两个列表里。' : '（这一趟没跑全，在列名单只并不清）。') +
        '新登记 ' + (Object.keys(store.qModule || {}).length - beforeMod) + ' 条模块、' + nSubj + ' 条科目。' +
        (gap || noSubj
          ? '笔记与划线里还缺 模块 ' + gap + ' 题、科目 ' + noSubj + ' 题。'
          : '笔记与划线的模块与科目已齐。'), 'ok');
      reconciling = false;
      renderNotesList();
      renderBookList();
    })).catch(function (e) {
      reconciling = false;
      setStatus('与站点核对失败：' + e.message, 'err');
    });
  }

  // 三颗键合成一颗：原来那三名（与站点核对 / 清理残留 / 清孤儿快照）没有一张脸能让人看懂，
  // 于是没人敢点。合成一次点击，但删除仍然先列清单问一句——静默删数据不是替用户省认知负担，
  // 是替他做决定。
  function upgradeScan() {
    var names = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k) names.push(k);
    }
    return { keys: strayStorageKeys(names), old: staleResumeKeys(store.resume), snaps: orphanSnapIds() };
  }

  $('#gth-upgrade').addEventListener('click', function () {
    var f = upgradeScan(), n = f.keys.length + f.old.length + f.snaps.length;
    if (n) {
      var kb = f.keys.reduce(function (a, x) { return a + (localStorage.getItem(x) || '').length; }, 0) / 1024;
      var detail = f.keys.map(function (x) { return '· 存储键 ' + x; })
        .concat(f.old.map(function (x) { return '· 旧刷题进度 ' + x; }))
        .concat(f.snaps.length ? ['· 没笔记也没划线的题面快照 ' + f.snaps.length + ' 题'] : []).join('\n');
      if (!confirm('将删掉 ' + n + ' 项本机不再需要的记录' +
        (f.keys.length ? '（存储键约 ' + kb.toFixed(1) + ' KB）' : '') + '，不可恢复：\n\n' + detail +
        '\n\n笔记、划线、掌握状态与已收录的题都不受影响。删完接着与站点核对一遍。\n\n确定继续？')) return;
      f.keys.forEach(function (x) { localStorage.removeItem(x); });
      f.old.forEach(function (x) { delete store.resume[x]; });
      f.snaps.forEach(function (x) { delete store.snaps[x]; });
      saveStore();
      renderBookList();
      setStatus('已清掉 ' + n + ' 项本机旧记录，正在与站点核对…');
    }
    reconcileWithSite(this);
  });

  var notesSearchKey = '';
  var gthNoteEditing = false;
  var openNoteBox = null;
  $('#gth-note-search').addEventListener('input', debounce(function (e) {
    notesSearchKey = e.target.value;
    renderNotesList();
  }, 150));

  function renderNotesList() {
    if (gthNoteEditing) return;
    var listEl = $('#gth-notes-list');
    var countEl = $('#gth-note-count');
    if (!listEl) return;
    var ids = noteIdsWithHl();
    var lastAct = function (id) {
      var t = (store.notes[id] && store.notes[id].updated) || 0;
      getHighlights(id).forEach(function (h) { if ((h.at || 0) > t) t = h.at; });
      return t;
    };
    renderNoteFilterMods(ids);
    var q = notesSearchKey.trim().toLowerCase();
    var filtered = ids.filter(function (id) {
      if (!noteMatch(noteFacets(id), notesFilter)) return false;
      if (!q) return true;
      var n = store.notes[id] || {};

      if (((n.text || '') + ' ' + (n.snapshot || '')).toLowerCase().indexOf(q) >= 0) return true;
      return getHighlights(id).some(function (h) {
        return ((h.quote || '') + ' ' + (h.snap || '')).toLowerCase().indexOf(q) >= 0;
      });
    });
    notesShownIds = filtered.slice();

    var lim = notesNarrowed() ? filtered.length + ' / ' : '';
    countEl.textContent = lim + ids.length + ' 题';

    if (!ids.length) {
      listEl.innerHTML = '<div class="gth-empty">' + icon('bookOpen') +
        '<div>暂无笔记与划线。在错题页或答题报告里选中解析文字即可划线。</div></div>';
      return;
    }
    if (!filtered.length) {
      listEl.innerHTML = '<div class="gth-empty">' + icon('search') +
        '<div>' + (q ? '没有匹配的内容' : '当前筛选条件下没有笔记题') + '</div></div>';
      return;
    }

    listEl.innerHTML = filtered.sort(function (a, b) {
      return lastAct(b) - lastAct(a);
    }).map(function (id) {
      var n = store.notes[id] || {};
      var hls = getHighlights(id);
      var f = noteFacets(id);
      var subj = SUBJECT_NAME[n.subject != null ? n.subject : (hls[0] && hls[0].subject)] || '未知科目';
      var dyn = masteredLabel(id);
      var dynCls = dyn === '已掌握' ? 'done' : (dyn.indexOf('待巩固') === 0 ? 'dyn' : '');
      return '' +
        '<div class="gth-note-item" data-id="' + esc(id) + '">' +
        '<div class="gth-note-h">' +
        '<span class="gth-pill">' + esc(subj) + '</span>' +
        (f.src === 'mock' ? '<span class="gth-pill mock">' + icon('bookOpen') + '模考收录</span>' : '') +
        (f.mod && f.mod !== MOCK_UNCLS ? '<span class="gth-pill">' + esc(f.mod) + '</span>' : '') +
        '<span class="gth-pill ' + dynCls + '">' + esc(dyn) + '</span>' +
        (hls.length ? '<span class="gth-pill hl">' + icon('highlighter') + esc(String(hls.length)) + ' 划</span>' : '') +
        '<span>' + fmtAgo(lastAct(id)) + '</span>' +
        '<span class="sp"></span>' +
        '<button class="gth-btn ghost sm" data-act="book">' + icon('listChecks') + '摊开题目</button>' +
        '<button class="gth-btn ghost sm" data-act="edit">' + icon('pencil') + '编辑</button>' +
        '<button class="gth-btn ghost sm danger" data-act="del">' + icon('trash') + '</button>' +
        '</div>' +
        ((n.snapshot || (hls[0] && hls[0].snap)) ? '<div class="gth-note-snap">' + esc(n.snapshot || hls[0].snap) + '</div>' : '') +
        '<div class="gth-note-text' + (n.text ? '' : ' is-empty') + '">' +
        esc(n.text || (hls.length ? '' : '（无笔记内容）')) + '</div>' +
        (hls.length ? '<div class="gth-note-hl">' + hls.map(function (h, i) {
          return hlRowHtml(h, i, '');
        }).join('') + '</div>' : '') +
        '</div>';
    }).join('');

    $$('.gth-note-item', listEl).forEach(function (item) {
      var id = item.dataset.id;
      $('[data-act="book"]', item).addEventListener('click', function () { jumpToBook(id); });
      $('[data-act="edit"]', item).addEventListener('click', function () { openNoteEditor(id, item); });
      $('[data-act="del"]', item).addEventListener('click', function () {
        var hasNote = !!store.notes[id], hasHl = countHighlights(id) > 0;
        var what = hasNote ? (hasHl ? '笔记和划线' : '笔记') : '划线';
        if (!confirm('确定删除这道题的' + what + '？此操作不可恢复。')) return;
        delete store.notes[id];
        delete store.highlights[id];
        saveStore();
        repaintHighlights();
        refreshBadges();
        renderNotesList();
      });
      $$('.gth-hlp-item .rm', item).forEach(function (rm) {
        rm.addEventListener('click', function () {
          hlRemove(id, Number(rm.closest('.gth-hlp-item').dataset.hl));
          toast('已取消划线');
          afterHlChange();
        });
      });
      $$('.gth-hlp-item .t, .gth-hlp-item .n', item).forEach(function (node) {
        node.addEventListener('click', function () {
          openHlNote(id, Number(node.closest('.gth-hlp-item').dataset.hl), node.getBoundingClientRect());
        });
      });
    });
  }

  var BOOK_PER_PAGE = 20;
  var bookShownIds = [];
  var bookPage = 1;

  function ansList(v) {
    if (Array.isArray(v)) {
      return v.map(function (x) { return String(x).trim().toUpperCase(); }).filter(function (x) { return !!x; });
    }
    var s = String(v == null ? '' : v).replace(/[^A-Za-z]/g, '').toUpperCase();
    return s ? s.split('') : [];
  }

  function bookLastAct(id) {
    var t = (store.notes[id] && store.notes[id].updated) || 0;
    getHighlights(id).forEach(function (h) { if ((h.at || 0) > t) t = h.at; });
    var s = store.snaps[id];
    if (s && (s.at || 0) > t) t = s.at;
    var m = store.mockQs[id];
    if (m && (m.at || 0) > t) t = m.at;
    return t;
  }

  // 头部直接复用错题页那行小条的类名：答错次数与掌握状态由 refreshBadges() 一处刷，
  // 题本再拼一遍标签文案迟早和错题页分叉。data-serverErr 给 0 是因为列表接口没返回过答错次数。
  function bookCardHeadHtml(id) {
    return '<div class="gth-qbar" data-id="' + esc(id) + '" data-kind="book" data-serverErr="0">' +
      '<span class="gth-err"></span><span class="gth-badge"></span><span class="sp"></span>' +
      '<button class="gth-qbar-btn gth-qbar-note" type="button" title="写 / 改这道题的笔记">' +
      icon('pencil') + '笔记</button>' +
      '<button class="gth-qbar-btn gth-qbar-copy" type="button" data-id="' + esc(id) + '">' +
      icon('copy') + '复制题目</button></div>';
  }

  function bookCardHtml(id, no) {
    var q = bookQuestion(id);
    return questionCardHtml(q, {
      cls: 'gth-qcard gth-book-card',
      head: bookCardHeadHtml(id),
      no: no,
      circle: 1,
      picked: ansList(q.user_answer),
      noSnap: q._noSnap ? 1 : 0,
      partSnap: q._part ? 1 : 0,
      conflict: q._conflict ? 1 : 0,
      note: false,
      anaToggle: 1,
      excerpt: q._ex || ''
    });
  }


  // 笔记写在内框外那一栏（和站点错题页同一套 .gth-aside）：这一页摊几道题，那一栏就摆几张批注卡，
  // 位置由 placeRailItems() 按卡片此刻在视口里的位置算。卡片整段重渲染，所以按 data-book 认自己人。
  function renderBookSides() {
    var inner = $('#gth-rail-in');
    if (!inner) return;
    var ids = bookViewOn ? bookPageIds() : [];
    $$('.gth-aside[data-book="1"]', inner).forEach(function (a) {
      if (ids.indexOf(a.dataset.id) < 0) a.remove();
    });
    ids.forEach(function (id) {
      var el = $('.gth-aside[data-book="1"][data-id="' + id.replace(/"/g, '') + '"]', inner);
      if (!el) {
        el = document.createElement('div');
        el.className = 'gth-aside';
        el.dataset.book = '1';
        el.dataset.id = id;
        inner.appendChild(el);
      }
      if (el.contains(document.activeElement)) return;
      renderAside(el, bookQuestion(id));
    });
  }

  function bookCardNode(id) {
    return $('.gth-book-card[data-id="' + String(id).replace(/"/g, '') + '"]');
  }

  // 右下角那一行只切 class 与 hidden：重写整张卡片会把展开的划线与正在编辑的笔记一起抹掉
  function bindAnaToggle(root) {
    $$('[data-act="ana"]', root).forEach(function (ab) {
      ab.addEventListener('click', function () {
        var card = ab.closest('.gth-qcard');
        var box = card && $('.gthq-analysis', card);
        var on = ab.classList.toggle('on');
        if (box) box.hidden = !on;
        syncRail();
      });
    });
  }

  function bindBookList(listEl) {
    $$('.gth-book-card', listEl).forEach(function (el) {
      bindQbar($('.gth-qbar', el), function () { return bookQuestion(el.dataset.id); });
    });
    bindAnaToggle(listEl);
    $$('[data-gth-qid]', listEl).forEach(function (el) {
      el.removeAttribute('data-gth-paint');
      paintRoot(el);
    });
  }

  function bindBookPager() {
    var pagerEl = $('#gth-book-pager');
    if (!pagerEl) return;
    $$('button[data-page]', pagerEl).forEach(function (b) {
      b.addEventListener('click', function () {
        var n = Number(b.dataset.page);
        if (!(n >= 1) || n === bookPage) return;
        bookPage = n;
        renderBookList();
        var box = $('#gth-book-scroll');
        if (box) box.scrollTop = 0;
      });
    });
  }

  // 题本顶部只摆三样：科目、模块、关键词。来源、掌握状态、快照齐不齐都不摆——
  // 前两个在笔记那一屏已有入口，最后一个是内部概念，摆出来只会让人猜它是什么意思。
  var bookFilter = { subj: '', mod: '', q: '' };

  function readBookFilter() {
    var g = function (id) { var el = $('#' + id); return el ? el.value : ''; };
    bookFilter.subj = g('gth-bf-subj');
    bookFilter.mod = g('gth-bf-mod');
    bookFilter.q = g('gth-bf-q');
  }

  function bookNarrowed() {
    return !!(bookFilter.subj || bookFilter.mod || bookFilter.q.trim());
  }

  function bookFacets(id) {
    var f = noteFacets(id);
    var s = store.snaps[id];
    return { subj: f.subj === 'x' && s && s.content_type != null ? String(s.content_type) : f.subj,
      mod: f.mod };
  }

  function bookMatch(nf) {
    if (bookFilter.subj && nf.subj !== bookFilter.subj) return false;
    if (bookFilter.mod && nf.mod !== bookFilter.mod) return false;
    return true;
  }

  // 关键词要读题面，比科目与模块贵一档，所以单独一步、只在真输了字的时候跑；
  // 匹配前先剥标签——题面是 HTML，不剥的话搜「p」能命中每一题
  function bookSearchHit(id, q) {
    var n = store.notes[id];
    if (String((n && n.text) || '').toLowerCase().indexOf(q) >= 0) return true;
    var s = store.snaps[id] || store.mockQs[id];
    if (!s) return String((n && n.snapshot) || '').toLowerCase().indexOf(q) >= 0;
    return (stripHtml(s.content) + stripHtml(s.analysis) + stripHtml(s.material))
      .toLowerCase().indexOf(q) >= 0;
  }

  function renderBookFilterMods(ids) {
    var sel = $('#gth-bf-mod');
    if (!sel) return;
    var names = {}, hasUnknown = false;
    ids.forEach(function (id) { var m = moduleOf(id); if (m) names[m] = 1; else hasUnknown = true; });
    sel.innerHTML = '<option value="">全部模块</option>' +
      Object.keys(names).sort().map(function (n) {
        return '<option value="' + esc(n) + '">' + esc(n) + '</option>';
      }).join('') +
      (hasUnknown ? '<option value="' + esc(MOCK_UNCLS) + '">模块未记录</option>' : '');
    sel.value = bookFilter.mod;
    bookFilter.mod = sel.value;
  }

  function bookFilteredIds() {
    var ids = bookIds();
    readBookFilter();
    renderBookFilterMods(ids);
    var q = bookFilter.q.trim().toLowerCase();
    return ids.filter(function (id) {
      return bookMatch(bookFacets(id)) && (!q || bookSearchHit(id, q));
    }).sort(function (a, b) { return bookLastAct(b) - bookLastAct(a); });
  }

  function bookPageIds() {
    return bookShownIds.slice((bookPage - 1) * BOOK_PER_PAGE, bookPage * BOOK_PER_PAGE).map(String);
  }

  function bookPageTotal() {
    return Math.max(1, Math.ceil(bookShownIds.length / BOOK_PER_PAGE));
  }

  // 分页器照站点错题页那个形状：« ‹ 1 2 3 … N › »
  function bookPagerHtml(cur, total) {
    var nums = [], i;
    for (i = 1; i <= total; i++) {
      if (i === 1 || i === total || Math.abs(i - cur) <= 2) nums.push(i);
      else if (nums[nums.length - 1] !== 0) nums.push(0);
    }
    function pb(page, label, off, on) {
      return '<button data-page="' + page + '"' + (off ? ' disabled' : '') +
        (on ? ' class="on"' : '') + '>' + label + '</button>';
    }
    var out = [pb(1, '«', cur <= 1), pb(cur - 1, '‹', cur <= 1)];
    nums.forEach(function (n) {
      out.push(n === 0 ? '<span class="gap">…</span>' : pb(n, String(n), false, n === cur));
    });
    out.push(pb(cur + 1, '›', cur >= total), pb(total, '»', cur >= total));
    return out.join('');
  }

  function renderBookList() {
    var listEl = $('#gth-book-list');
    if (!listEl) return;
    if (gthNoteEditing) return;
    var pagerEl = $('#gth-book-pager');
    var countEl = $('#gth-book-count');
    function empty(html) {
      listEl.innerHTML = html;
      if (pagerEl) pagerEl.innerHTML = '';
      bookShownIds = [];
      bookPage = 1;
      renderBookSides();
    }
    if (!reconciled()) {
      if (countEl) countEl.textContent = '正在与站点核对';
      empty('<div class="gth-empty">' + icon('rotate') +
        '<div>补充题本只收站点错题本与收藏夹里<b>没有</b>的题——正在与站点核对这一批，跑完自己摊开。</div></div>');
      autoReconcile();
      return;
    }
    var ids = bookIds();
    bookShownIds = bookFilteredIds();
    if (!ids.length) {
      if (countEl) countEl.textContent = '';
      empty('<div class="gth-empty">' + icon('listChecks') +
        '<div>补充题本还是空的。写过笔记或划过线的题，只要站点错题本与收藏夹里还没有它，就会自己进来。</div></div>');
      return;
    }
    if (!bookShownIds.length) {
      if (countEl) countEl.textContent = '0 / ' + ids.length + ' 题';
      empty('<div class="gth-empty">' + icon('search') +
        '<div>没有题符合这些条件。</div>' +
        '<button class="gth-btn sm" data-act="unfilter">清空筛选</button></div>');
      var uf = $('[data-act="unfilter"]', listEl);
      if (uf) uf.addEventListener('click', clearBookFilter);
      return;
    }
    var total = bookPageTotal();
    if (!(bookPage >= 1)) bookPage = 1;
    if (bookPage > total) bookPage = total;
    var pageIds = bookPageIds();
    if (countEl) {
      countEl.textContent = (bookNarrowed() ? bookShownIds.length + ' / ' : '') + ids.length +
        ' 题 · 第 ' + bookPage + ' / ' + total + ' 页';
    }
    if (pagerEl) pagerEl.innerHTML = bookPagerHtml(bookPage, total);
    listEl.innerHTML = pageIds.map(function (id, i) {
      return bookCardHtml(id, (bookPage - 1) * BOOK_PER_PAGE + i + 1);
    }).join('');
    pageIds.forEach(function (id) { qNodes[id] = bookCardNode(id); });
    bindBookList(listEl);
    bindBookPager();
    refreshBadges();
    renderBookSides();
    syncRail();
    var rb = $('#gth-bf-reset');
    if (rb) rb.hidden = !bookNarrowed();
    autoFillFaces(pageIds);
  }

  function clearBookFilter() {
    ['gth-bf-subj', 'gth-bf-mod', 'gth-bf-q'].forEach(function (id) {
      var el = $('#' + id);
      if (el) el.value = '';
    });
    bookPage = 1;
    renderBookList();
  }

  ['gth-bf-subj', 'gth-bf-mod'].forEach(function (fid) {
    var el = $('#' + fid);
    if (el) el.addEventListener('change', function () { bookPage = 1; renderBookList(); });
  });

  var bookSearchEl = $('#gth-bf-q');
  if (bookSearchEl) bookSearchEl.addEventListener('input', debounce(function () {
    bookPage = 1;
    renderBookList();
  }, 200));
  var bookResetEl = $('#gth-bf-reset');
  if (bookResetEl) bookResetEl.addEventListener('click', clearBookFilter);

  function jumpToBook(id) {
    if (!bookViewOn) setBookView(true);
    var idx = -1;
    bookShownIds.forEach(function (x, i) { if (String(x) === String(id)) idx = i; });
    if (idx < 0) {
      setStatus('这题不在补充题本里——站点已经把它收进错题本或收藏夹了。');
      return;
    }
    bookPage = Math.floor(idx / BOOK_PER_PAGE) + 1;
    renderBookList();
    var el = bookCardNode(id);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('gth-flash');
    setTimeout(function () { el.classList.remove('gth-flash'); }, 1600);
  }

  function closeNoteEditor(s) {
    if (!s) return;
    s.box.remove();
    if (s.textEl && s.textEl.isConnected) s.textEl.style.display = '';
    gthNoteEditing = false;
  }

  function openNoteEditor(id, itemEl) {

    if (openNoteBox && openNoteBox.itemEl === itemEl) {
      var t0 = $('textarea', openNoteBox.box);
      if (t0) t0.focus();
      return;
    }
    closeNoteEditor(openNoteBox);
    blurEditors('panel');
    gthNoteEditing = true;
    var n = store.notes[id] || { text: '' };
    var box = document.createElement('div');
    box.className = 'gth-note-edit';
    box.innerHTML = '<textarea></textarea><div style="display:flex;gap:6px">' +
      '<button class="gth-btn primary sm" data-act="save">' + icon('save') + '保存</button>' +
      '<button class="gth-btn sm" data-act="cancel">取消</button></div>';
    var ta = $('textarea', box);
    ta.value = n.text || '';
    var textEl = $('.gth-note-text', itemEl);
    textEl.style.display = 'none';
    itemEl.insertBefore(box, textEl.nextSibling);
    ta.focus();
    openNoteBox = { box: box, itemEl: itemEl, textEl: textEl };

    $('[data-act="cancel"]', box).addEventListener('click', function () {
      closeNoteEditor(openNoteBox);
      openNoteBox = null;
    });
    $('[data-act="save"]', box).addEventListener('click', function () {
      openNoteBox = null;
      gthNoteEditing = false;
      var newText = ta.value.trim();
      if (newText) {
        setNote(id, newText);
      } else {
        delete store.notes[id];
        saveStore();
      }
      refreshBadges();
      renderNotesList();
    });
  }

  function getAngular() {
    try { return window.angular || (typeof unsafeWindow !== 'undefined' && unsafeWindow.angular); }
    catch (e) { return null; }
  }

  var itemsById = {};

  function renderAside(el, item) {
    var text = getNote(item.id);
    var wasEditing = el.dataset.editing;
    el.dataset.editing = '';
    var head, body;
    if (text) {
      head = '<div class="gth-aside-h">' + icon('pencil') + '笔记' +
        '<span class="sp"></span><button class="gth-mini" data-act="edit">编辑</button></div>';
      body = '<div class="gth-aside-body">' + esc(text) + '</div>';
    } else {
      head = '<div class="gth-aside-h">' + icon('pencil') + '笔记</div>';
      body = '<div class="gth-aside-empty" data-act="add">＋ 添加笔记</div>';
    }
    var html = head + body + asideHlHtml(item.id);

    if (el.dataset.gthHtml === html && !wasEditing) return;
    el.dataset.gthHtml = html;
    var keepOpen = el.dataset.hlOpen === '1';
    el.innerHTML = html;
    if (keepOpen) {
      var hlList = $('.gth-aside-hl-list', el);
      if (hlList) hlList.classList.add('on');
    }
    var ed = $('[data-act="edit"]', el), ad = $('[data-act="add"]', el);
    if (ed) ed.addEventListener('click', function () { editAside(el, item); });
    if (ad) ad.addEventListener('click', function () { editAside(el, item); });
    bindAsideHl(el, item);
  }

  function asideHlHtml(id) {
    var list = getHighlights(id);
    if (!list.length) return '';

    var desc = list.length + ' 条划线';
    var rows = list.map(function (h, i) { return hlRowHtml(h, i, '点击改批注'); }).join('');
    var lost = list.filter(function (h) { return h.lost; }).length;
    return '<div class="gth-aside-hl">' +
      '<div class="gth-aside-hl-t" data-act="toggle" title="展开 / 收起划线清单">' + icon('highlighter') + esc(desc) +
      (lost ? ' · ' + lost + ' 条已失效' : '') +
      '<span class="sp"></span><span class="gth-caret">' + icon('chevronDown') + '</span></div>' +
      '<div class="gth-aside-hl-list">' + rows +
      '<div class="gth-aside-hl-act">' +
      '<button class="gth-mini" data-act="collect">' + icon('fileText') + '整理本题</button></div>' +
      '</div></div>';
  }

  function bindAsideHl(el, item) {
    var t = $('.gth-aside-hl-t', el), list = $('.gth-aside-hl-list', el);
    if (!t || !list) return;
    t.addEventListener('click', function () {
      var on = list.classList.toggle('on');
      el.dataset.hlOpen = on ? '1' : '';
      syncRail();
    });
    $$('.gth-hlp-item .t, .gth-hlp-item .n', list).forEach(function (node) {
      node.addEventListener('click', function () {
        openHlNote(item.id, Number(node.closest('.gth-hlp-item').dataset.hl), node.getBoundingClientRect());
      });
    });
    $$('.gth-hlp-item .rm', list).forEach(function (rm) {
      rm.addEventListener('click', function (e) {
        e.stopPropagation();
        hlRemove(item.id, Number(rm.closest('.gth-hlp-item').dataset.hl));
        toast('已取消划线');
        afterHlChange();
      });
    });
    var cb = $('[data-act="collect"]', list);
    if (cb) cb.addEventListener('click', function () { openCollect([String(item.id)]); });
  }

  function insertAtCursor(ta, text) {
    var s = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    var e = ta.selectionEnd == null ? ta.value.length : ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    var p = s + text.length;
    try { ta.setSelectionRange(p, p); } catch (err) {  }
    ta.focus();
  }

  function closeAsideEditor() {
    $$('.gth-aside[data-editing="1"]').forEach(function (a) {
      var it = itemsById[a.dataset.id];
      if (it) renderAside(a, it);
      else a.dataset.editing = '';
    });
  }

  function blurEditors(keep) {
    if (keep !== 'aside') closeAsideEditor();
    if (keep !== 'hlnote') closeHlNote();
    if (keep !== 'hlmenu') closeHlMenu();
    if (keep !== 'panel') { closeNoteEditor(openNoteBox); openNoteBox = null; }
  }

  function editAside(el, item) {
    blurEditors('aside');
    el.dataset.editing = '1';
    el.innerHTML = '<div class="gth-aside-h">' + icon('pencil') + '编辑笔记</div>' +
      '<textarea placeholder="写下你的思路、易错点、口诀…"></textarea>' +
      '<div class="gth-aside-act">' +
      '<button class="gth-mini primary" data-act="save">保存</button>' +
      '<button class="gth-mini" data-act="cancel">取消</button>' +
      '<button class="gth-mini" data-act="ins">' + icon('quote') + '插入划线</button></div>' +
      '<div class="gth-aside-hl-list" data-ins="1"></div>';
    var ta = $('textarea', el);
    ta.value = getNote(item.id);
    ta.focus();

    var picker = $('[data-ins="1"]', el);
    $('[data-act="ins"]', el).addEventListener('click', function () {
      var list = getHighlights(item.id);
      picker.classList.toggle('on');
      if (!picker.classList.contains('on')) { picker.innerHTML = ''; return; }
      if (!list.length) { picker.innerHTML = '<div class="gth-hlp-empty">本题还没有划线</div>'; return; }
      picker.innerHTML = list.map(function (h, i) {
        return '<div class="gth-hlp-item" data-hl="' + i + '">' +
          '<span class="dot ' + (h.color === 'red' ? 'red' : 'yellow') + '"></span>' +
          '<span class="t">' + esc(h.quote || '') + '</span></div>';
      }).join('');
      $$('.gth-hlp-item .t', picker).forEach(function (node) {
        node.addEventListener('click', function () {
          var h = getHighlights(item.id)[Number(node.closest('.gth-hlp-item').dataset.hl)];
          if (!h) return;
          var pre = ta.value && !/\n$/.test(ta.value) ? '\n' : '';
          insertAtCursor(ta, pre + '> ' + h.quote + '\n');
        });
      });
    });

    $('[data-act="save"]', el).addEventListener('click', function () {
      setNote(item.id, ta.value.trim(), {
        snapshot: stripHtml(item.content).slice(0, 240),
        subject: subjectOf(item)
      });
      renderAside(el, item);
      refreshBadges();
      renderNotesList();
    });
    $('[data-act="cancel"]', el).addEventListener('click', function () { renderAside(el, item); });
  }

  function setIf(el, prop, val) {
    if (!el) return;
    if (prop === 'hidden') { if (el.hidden !== !!val) el.hidden = !!val; return; }
    if (el[prop] !== val) el[prop] = val;
  }

  function refreshBadges() {
    $$('.gth-qbar').forEach(function (bar) {
      var id = bar.dataset.id;
      if (!id) return;
      var badge = $('.gth-badge', bar);
      var errEl = $('.gth-err', bar);
      var rec = store.mastered[id];
      var done = isMastered(id);

      setIf(badge, 'className', 'gth-badge' + (done ? ' done' : (!rec ? ' ghost' : (getNote(id) ? ' has' : ''))));
      setIf(badge, 'textContent', done && rec.manual ? '已掌握 · 手动' : masteredLabel(id));
      setIf(badge, 'title', done ? '点一下取消掌握标记' : '点一下标记为已掌握');
      var n = errCountFor(id, bar.dataset.serverErr, bar.dataset.kind);
      if (n) {
        setIf(errEl, 'hidden', false);
        var t = errTag(n);
        setIf(errEl, 'className', t.cls);
        setIf(errEl, 'innerHTML', t.html);
      } else {

        setIf(errEl, 'hidden', true);
        setIf(errEl, 'className', 'gth-err');
        setIf(errEl, 'innerHTML', '');
      }
    });

    rerenderAsides();
  }

  function errCountFor(id, serverVal, kind) {
    var s = Number(serverVal) || 0;
    if (s) return s;
    var local = (store.wrongCount && store.wrongCount[id]) || 0;
    if (kind === 'collect') return local ? local + WRONG_BASE : 0;
    return local + WRONG_BASE;
  }

  function toggleMastery(id) {
    var rec = store.mastered[id];
    if (rec && rec.streak >= MASTER_STREAK) {
      delete store.mastered[id];
      toast('已取消掌握标记');
    } else {
      store.mastered[id] = { streak: MASTER_STREAK, updated: Date.now(), manual: 1 };
      toast('已标记为已掌握');
    }
    saveStore();
    refreshBadges();
    renderNotesList();
    if (bookViewOn) renderBookList();
  }

  function focusNote(item) {
    if (viewOn) setView(false);
    var id = String(item.id);
    // 题本开着时那一栏里同时挂着错题页的批注卡（站点内容只是藏起来没拆），按 data-book 认自己那张
    var aside = $$('#gth-rail-in .gth-aside[data-id="' + id + '"]').filter(function (a) {
      return !bookViewOn || a.dataset.book === '1';
    })[0];
    if (!aside) { toast('批注栏还没就绪，稍后再点一次'); return; }
    var content = railContent(), node = qNodes[id];
    if (node && node.isConnected) {

      var base = railFrame ? railFrame.top : (content ? content.getBoundingClientRect().top : 0);
      var delta = node.getBoundingClientRect().top - base - 8;
      var sc = railScroller(content);
      if (sc) sc.scrollTop += delta;
      else window.scrollBy(0, delta);
    }
    aside.hidden = false;
    editAside(aside, item);
    var ta = aside.querySelector('textarea');
    if (ta) { try { ta.focus(); } catch (e) {} }
    syncRail();
    toast('笔记栏在题目右侧');
  }

  var CONTENT_SEL = '.gongan2-container .right-content .inner-content > .content';
  var qNodes = {};

  function prunePageRefs() {
    Object.keys(qNodes).forEach(function (k) {
      var n = qNodes[k];
      if (n && n.isConnected) return;
      delete qNodes[k];
      delete itemsById[k];
    });
  }

  function railContent() {
    if (bookViewOn) return $('#gth-book-scroll');
    return $(CONTENT_SEL) ||
      $('.gongan2-container .right-content .inner-content') ||
      $('.right-content .inner-content');
  }

  function railScroller(content) {
    var el = content;
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.scrollHeight - el.clientHeight > 4) {
        var ov = '';
        try { ov = getComputedStyle(el).overflowY; } catch (e) {}
        if (ov === 'auto' || ov === 'scroll' || ov === 'overlay') return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  var railFrame = null;
  var railRaf = 0;

  function railVisible() {
    var content = railContent();
    if (!content) return null;
    var r = content.getBoundingClientRect();
    if (!r.height) return null;
    var top = Math.max(r.top, 0);
    var bottom = Math.min(r.bottom, window.innerHeight);
    if (bottom - top < 40) return null;
    return { rect: r, top: top, height: bottom - top };
  }

  function placeRailItems() {
    var inner = $('#gth-rail-in');
    if (railEl.hidden || !railFrame || !inner) return;
    $$('.gth-aside', inner).forEach(function (a) {
      var node = qNodes[a.dataset.id];
      if (node && node.isConnected) {
        a.hidden = false;
        a.style.top = Math.round(node.getBoundingClientRect().top - railFrame.top) + 'px';
      } else {
        a.hidden = true;
      }
    });
    syncBalloons();
  }

  function onRailScroll() {
    if (railEl.hidden || railRaf) return;
    railRaf = requestAnimationFrame(function () {
      railRaf = 0;
      var f = railVisible();
      if (!f) { railEl.hidden = true; railFrame = null; return; }
      if (!railFrame || f.top !== railFrame.top || f.height !== railFrame.height) {

        railEl.style.top = Math.round(f.top) + 'px';
        railEl.style.height = Math.round(f.height) + 'px';
      }
      railFrame = f;
      placeRailItems();
    });
  }

  function syncRail() {
    var rail = railEl, inner = $('#gth-rail-in');
    if (!(isListRoute() || bookViewOn) || !inner) { rail.hidden = true; railFrame = null; return; }

    if (!document.body.dataset.gthRailScroll) {
      document.body.dataset.gthRailScroll = '1';
      document.addEventListener('scroll', onRailScroll, { capture: true, passive: true });
    }
    var content = railContent();
    if (content && !content.dataset.gthRailLoad) {
      content.dataset.gthRailLoad = '1';
      content.addEventListener('load', syncRail, true);
    }

    var f = railVisible();
    if (!f) { rail.hidden = true; railFrame = null; return; }
    railFrame = f;

    var railLeft = Math.round(f.rect.right + 24);
    var avail = (document.documentElement.clientWidth || window.innerWidth) - railLeft - 8;
    if (avail < 120) { rail.hidden = true; railFrame = null; return; }
    rail.hidden = false;
    rail.style.left = railLeft + 'px';
    rail.style.width = Math.min(280, avail) + 'px';
    rail.style.top = Math.round(f.top) + 'px';
    rail.style.height = Math.round(f.height) + 'px';
    inner.style.transform = 'none';
    placeRailItems();
  }

  // 错题页与题本那行小条同形状，绑定也只留一份：取题面的函数由调用方给，两边数据源不搅在一起
  function bindQbar(bar, itemOf) {
    if (!bar || bar.dataset.gthBind) return;
    bar.dataset.gthBind = '1';
    var copy = $('.gth-qbar-copy', bar);
    if (copy) copy.addEventListener('click', function (e) {
      e.stopPropagation();
      var it = itemOf();
      if (!it) return;
      var ok = copyWithToast(copyQuestion(it));
      copy.classList.add('copied');
      copy.innerHTML = (ok ? icon('check') : icon('xCircle')) + (ok ? '已复制' : '复制失败');
      setTimeout(function () {
        copy.classList.remove('copied');
        copy.innerHTML = icon('copy') + '复制题目';
      }, 1200);
    });
    var badge = $('.gth-badge', bar);
    if (badge) badge.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMastery(bar.dataset.id);
    });
    var note = $('.gth-qbar-note', bar);
    if (note) note.addEventListener('click', function (e) {
      e.stopPropagation();
      var it = itemOf();
      if (it) focusNote(it);
    });
  }

  function injectListUI() {
    if (!isListRoute()) return;
    if (bookViewOn) return;
    var ang = getAngular();
    if (!ang) return;
    var railInner = $('#gth-rail-in');
    if (!railInner) return;
    $$('[ng-repeat="item in subjectList"]').forEach(function (node) {
      if (node.dataset.gth) return;
      var item = null;
      try { item = ang.element(node).scope().item; } catch (e) { return; }
      if (!item || !item.id) return;

      railInner.querySelectorAll('.gth-aside[data-id="' + item.id + '"]').forEach(function (a) { a.remove(); });
      node.dataset.gth = '1';

      node.setAttribute('data-gth-qid', item.id);
      itemsById[item.id] = snapCopy(item);
      qNodes[item.id] = node;
      if (!probed) { probed = true; probeFields([item]); }

      var bar = document.createElement('div');
      bar.className = 'gth-qbar';
      bar.dataset.id = item.id;
      bar.dataset.kind = routeKind();
      bar.dataset.serverErr = serverErrCount(item);

      $$('.gth-qbar[data-id="' + item.id + '"]').forEach(function (b) { b.remove(); });
      bar.innerHTML =
        '<span class="gth-err"></span>' +
        '<span class="gth-badge"></span>' +
        '<span class="sp"></span>' +
        '<button class="gth-qbar-btn gth-qbar-note" type="button" title="写 / 改这道题的笔记">' +
        icon('pencil') + '笔记</button>' +
        '<button class="gth-qbar-btn gth-qbar-copy" type="button" data-id="' + esc(item.id) + '">' +
        icon('copy') + '复制题目</button>';

      bindQbar(bar, function () { return itemsById[item.id]; });

      var aside = document.createElement('div');
      aside.className = 'gth-aside';
      aside.dataset.id = item.id;
      renderAside(aside, item);

      node.insertBefore(bar, node.firstChild);
      railInner.appendChild(aside);
    });
    refreshBadges();
    autoReconcile();
  }

  function syncKeyTargets() {
    $$(KEYACT).forEach(function (el) {
      if (el.getAttribute('tabindex') === null) el.setAttribute('tabindex', '0');
      if (!el.getAttribute('role')) el.setAttribute('role', 'button');
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = e.target && e.target.closest ? e.target.closest(KEYACT) : null;
    if (!t) return;
    e.preventDefault();
    t.click();
  });

  var refreshPageUI = debounce(function () {
    // 重练那一屏是盖住整页的模态：底下的注入、轨道与划线重画跑一遍谁也看不见，
    // 而时钟每秒写一次头部就会白排一轮，那正是上一轮「严重内存泄露」报上来的形状
    if (!quizEl.hidden) return;
    prunePageRefs();
    if (isMocksPage()) { mocksScanTick(); return; }
    if (isZyPage()) { injectAnalysisUI(); return; }
    injectListUI();
    injectMenuEntry();
    fitImgs(document.body);

    if (viewOn || bookViewOn) applyChrome();
    if (viewOn && storeRev !== panelRev) renderPanel();
    syncRail();
    repaintHighlights();
    syncBalloons();
    syncKeyTargets();
  }, 400);

  new MutationObserver(refreshPageUI).observe(document.body, {
    childList: true, subtree: true
  });
  window.addEventListener('resize', syncRail);

  var hlBar = document.createElement('div');
  hlBar.id = 'gth-hlbar';
  hlBar.innerHTML =
    '<button data-c="yellow" title="划为重点（Alt+1）"><span class="dot yellow"></span>重点</button>' +
    '<button data-c="red" title="标为易错（Alt+2）"><span class="dot red"></span>易错</button>' +
    '<span class="sep"></span>' +
    '<button data-act="note" title="给这段文字加批注（Alt+3）">' + icon('quote') + '批注</button>' +
    '<button data-act="copy" title="复制选中的文字">' + icon('copy') + '</button>';
  document.body.appendChild(hlBar);

  var pendingSel = null;
  var toastTimer = null;

  function toast(msg) {
    var t = $('#gth-toast');
    if (!t) { t = document.createElement('div'); t.id = 'gth-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 1600);
  }

  var HL_BLOCK_SEL = '#gth-hlbar,#gth-collect,#gth-toast,#gth-rail,.gth-aside,.gth-view,' +
    '.gth-abar,.gth-apanel,' +
    '#gth-quiz .gthq-header,#gth-quiz .gthq-sheet-col,#gth-quiz .gthq-foot,#gth-quiz .gthq-notebox,textarea,input,select';

  function contextOfRange(range) {
    var node = range.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentNode;
    var el = node && node.nodeType === 1 ? node : null;
    if (el && el.closest && el.closest(HL_BLOCK_SEL)) return null;
    while (el) {
      if (el.getAttribute && el.getAttribute('data-gth-qid')) {
        return { root: el, qid: el.getAttribute('data-gth-qid') };
      }
      el = el.parentElement;
    }
    return null;
  }

  function captureSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    var quote = String(sel.toString());
    if (!quote.trim()) return null;
    var ctx = contextOfRange(range);
    if (!ctx) return null;
    var start = offsetInRoot(ctx.root, range.startContainer, range.startOffset);
    if (start < 0) return null;
    var end = offsetInRoot(ctx.root, range.endContainer, range.endOffset);
    if (end < 0 || end <= start) return null;
    return { quote: quote, start: start, end: end, ctx: ctx, rect: range.getBoundingClientRect() };
  }

  function ensureHl(p, color) {
    var hits = hlOverlap(p.ctx.root, p.start, p.end, null);
    if (hits.length === 1) return { qid: p.ctx.qid, idx: hits[0], reused: true };
    var rec = addHighlight(p.ctx.qid, p.quote, p.start, color || 'yellow');
    if (!rec) return null;
    var list = store.highlights[p.ctx.qid] || [];
    return { qid: p.ctx.qid, idx: list.length - 1, reused: false };
  }

  function toggleHl(p, color) {
    var same = hlOverlap(p.ctx.root, p.start, p.end, color);
    if (same.length) {
      same.sort(function (a, b) { return b - a; }).forEach(function (i) { hlRemove(p.ctx.qid, i); });
      return { removed: same.length };
    }
    var other = hlOverlap(p.ctx.root, p.start, p.end, null);
    if (other.length === 1) { setHighlightColor(p.ctx.qid, other[0], color); return { recolored: 1 }; }
    var rec = addHighlight(p.ctx.qid, p.quote, p.start, color);
    return rec ? { added: 1 } : null;
  }

  function hideBar() { hlBar.classList.remove('on'); pendingSel = null; }

  function showBar() {
    var p = captureSelection();
    pendingSel = p;
    if (!p) { hlBar.classList.remove('on'); return; }
    hlBar.classList.add('on');
    var r = p.rect, bw = hlBar.offsetWidth, bh = hlBar.offsetHeight;
    var top = r.top - bh - 8;
    if (top < 8) top = r.bottom + 8;
    var left = Math.max(8, Math.min(r.left + r.width / 2 - bw / 2, window.innerWidth - bw - 8));
    hlBar.style.left = left + 'px';
    hlBar.style.top = top + 'px';
  }

  hlBar.addEventListener('mousedown', function (e) { e.preventDefault(); });

  function applyHl(act, p) {
    if (act === 'note') {
      var h = ensureHl(p, 'yellow');
      hideBar();
      if (!h) { toast('批注失败：没能在题目里定位到这段文字'); return; }
      openHlNote(h.qid, h.idx, p.rect);
      return;
    }
    var r = toggleHl(p, act);
    hideBar();
    if (!r) { toast('划线失败：没能在题目里定位到这段文字'); return; }
    if (r.removed) toast('已取消 ' + r.removed + ' 条划线');
    else if (r.recolored) toast('已改为' + HL_LABEL[act]);
    else toast('已标为' + HL_LABEL[act]);
    afterHlChange();
  }

  hlBar.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('button');
    if (!btn || !pendingSel) { hideBar(); return; }
    var p = pendingSel;
    if (btn.dataset.act === 'copy') { copyWithToast(p.quote); hideBar(); return; }
    applyHl(btn.dataset.act === 'note' ? 'note' : (btn.dataset.c === 'red' ? 'red' : 'yellow'), p);
  });

  document.addEventListener('mouseup', function (e) {
    if (e.target && e.target.closest && e.target.closest('#gth-hlbar')) return;
    setTimeout(showBar, 10);
  });
  document.addEventListener('mousedown', function (e) {
    if (e.target && e.target.closest && e.target.closest('#gth-hlbar')) return;
    hideBar();
  });
  window.addEventListener('scroll', hideBar, true);
  window.addEventListener('resize', hideBar);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { hideBar(); closeHlMenu(); closeHlNote(); closeCollect(); return; }
    if (!e.altKey || !/^[123]$/.test(e.key)) return;
    var p = captureSelection();
    if (!p) return;
    e.preventDefault();
    applyHl(e.key === '3' ? 'note' : (e.key === '2' ? 'red' : 'yellow'), p);
  });

  document.addEventListener('mouseup', function (e) {
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    var mk = e.target && e.target.closest && e.target.closest('mark.gth-hl');
    if (!mk) { closeHlMenu(); return; }
    var root = mk.closest('[data-gth-qid]');
    if (!root || mk.dataset.gthI == null) return;
    openHlMenu(root.getAttribute('data-gth-qid'), Number(mk.dataset.gthI), mk.getBoundingClientRect());
  });

  var hlMenuEl = null, hlMenuAnchor = null;
  var hlNoteEl = null, hlNoteCtx = null;

  function placeFloating(el, rect) {
    el.hidden = false;
    var bw = el.offsetWidth, bh = el.offsetHeight;
    var top = rect.bottom + 8;
    if (top + bh > window.innerHeight - 8) top = Math.max(8, rect.top - bh - 8);
    var left = Math.max(8, Math.min(rect.left || 0, window.innerWidth - bw - 8));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function flashMark(qid, idx) {
    var root = qRoot(qid);
    if (!root) return;
    $$('mark.gth-hl[data-gth-i="' + idx + '"]', root).forEach(function (m) {
      m.classList.add('gth-hl-flash');
      setTimeout(function () { m.classList.remove('gth-hl-flash'); }, 900);
    });
  }

  function buildHlMenu() {
    hlMenuEl = document.createElement('div');
    hlMenuEl.id = 'gth-hlmenu';
    hlMenuEl.hidden = true;
    document.body.appendChild(hlMenuEl);
    hlMenuEl.addEventListener('mousedown', function (e) { e.preventDefault(); });
    hlMenuEl.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('button');
      if (!btn || !hlMenuEl.dataset.q) return;
      var qid = hlMenuEl.dataset.q, idx = Number(hlMenuEl.dataset.i);
      var rect = hlMenuAnchor || { left: 0, top: 0, bottom: 0 };
      if (btn.dataset.act === 'note') { closeHlMenu(); openHlNote(qid, idx, rect); return; }
      if (btn.dataset.act === 'del') {
        closeHlMenu();
        hlRemove(qid, idx);
        toast('已取消划线');
        afterHlChange();
        return;
      }
      if (btn.dataset.c) {
        setHighlightColor(qid, idx, btn.dataset.c);
        closeHlMenu();
        toast('已改为' + HL_LABEL[btn.dataset.c]);
        afterHlChange();
      }
    });
  }

  function openHlMenu(qid, idx, rect) {
    var rec = (store.highlights[qid] || [])[idx];
    if (!rec) return;
    blurEditors('hlmenu');
    if (!hlMenuEl) buildHlMenu();
    hlMenuAnchor = rect;
    hlMenuEl.dataset.q = qid;
    hlMenuEl.dataset.i = String(idx);
    var txt = rec.quote || '';
    if (txt.length > 26) txt = txt.slice(0, 26) + '…';
    hlMenuEl.innerHTML =
      '<div class="gth-hlm-q"><span class="dot ' + (rec.color === 'red' ? 'red' : 'yellow') + '"></span>' +
      esc(txt) + '</div>' +
      '<button data-act="note">' + icon('quote') + (rec.note ? '编辑批注' : '添加批注') + '</button>' +
      '<div class="gth-hlm-c">' +
      '<button data-c="yellow" class="' + (rec.color !== 'red' ? 'on' : '') + '"><span class="dot yellow"></span>重点</button>' +
      '<button data-c="red" class="' + (rec.color === 'red' ? 'on' : '') + '"><span class="dot red"></span>易错</button>' +
      '</div>' +
      '<button data-act="del" class="danger">' + icon('x') + '取消划线</button>';
    placeFloating(hlMenuEl, rect);
    flashMark(qid, idx);
  }
  function closeHlMenu() { if (hlMenuEl) hlMenuEl.hidden = true; }

  function buildHlNote() {
    hlNoteEl = document.createElement('div');
    hlNoteEl.id = 'gth-hlnote';
    hlNoteEl.hidden = true;
    hlNoteEl.innerHTML = [
      '<div class="gth-hln-box">',
      '<div class="gth-hln-h">' + icon('quote') + '批注<span class="sp"></span>',
      '<button class="gth-btn ghost sm" data-act="close">' + icon('x') + '</button></div>',
      '<div class="gth-hln-q"></div>',
      '<textarea placeholder="写下你对这句话的理解、易错点、口诀…"></textarea>',
      '<div class="gth-hln-f">',
      '<button class="gth-btn sm danger" data-act="del-note">' + icon('trash') + '删除批注</button>',
      '<span class="sp"></span>',
      '<button class="gth-btn sm" data-act="cancel">取消</button>',
      '<button class="gth-btn primary sm" data-act="save">' + icon('check') + '保存</button>',
      '</div></div>'
    ].join('');
    document.body.appendChild(hlNoteEl);
    hlNoteEl.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('button[data-act]');
      if (!btn || !hlNoteCtx) return;
      var act = btn.dataset.act;
      if (act === 'close' || act === 'cancel') { closeHlNote(); return; }
      var ta = $('textarea', hlNoteEl);
      if (act === 'save') {
        hlNoteSet(hlNoteCtx.qid, hlNoteCtx.idx, ta ? ta.value.trim() : '');
        closeHlNote();
        toast('批注已保存');
        afterHlChange();
        return;
      }
      if (act === 'del-note') {
        hlNoteSet(hlNoteCtx.qid, hlNoteCtx.idx, '');
        closeHlNote();
        toast('批注已删除');
        afterHlChange();
      }
    });
  }

  function openHlNote(qid, idx, rect) {
    var rec = (store.highlights[qid] || [])[idx];
    if (!rec) return;
    blurEditors('hlnote');
    if (!hlNoteEl) buildHlNote();
    hlNoteCtx = { qid: qid, idx: idx };
    $('.gth-hln-q', hlNoteEl).innerHTML =
      '<span class="dot ' + (rec.color === 'red' ? 'red' : 'yellow') + '"></span>' + esc(rec.quote || '');
    var ta = $('textarea', hlNoteEl);
    ta.value = rec.note || '';
    placeFloating(hlNoteEl, rect || { left: 0, top: 0, bottom: 0 });
    ta.focus();
    flashMark(qid, idx);
  }
  function closeHlNote() { if (hlNoteEl) { hlNoteEl.hidden = true; hlNoteCtx = null; } }

  function afterHlChange() {
    refreshBadges();
    renderNotesList();
    rerenderAsides();
    refreshQuizHl();
    syncBalloons();
    if (bookViewOn && !gthNoteEditing) renderBookList();
  }

  function quizHlHtml(qid) {
    var list = getHighlights(qid);
    if (!list.length) return '';
    return '<div class="gth-hl-cap">' + icon('highlighter') + list.length + ' 条划线</div>' +
      list.map(function (h, i) { return hlRowHtml(h, i, '点击改批注'); }).join('');
  }

  function refreshQuizHl() {
    $$('[data-hls]').forEach(function (box) {
      box.innerHTML = quizHlHtml(box.getAttribute('data-hls'));
    });
  }

  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    var box = e.target.closest('#gth-quiz [data-hls]');
    if (!box) return;
    var item = e.target.closest('.gth-hlp-item');
    if (!item) return;
    var qid = box.getAttribute('data-hls'), idx = Number(item.dataset.hl);
    if (e.target.closest('.rm')) { hlRemove(qid, idx); toast('已取消划线'); afterHlChange(); return; }
    if (e.target.closest('.t') || e.target.closest('.n')) {
      openHlNote(qid, idx, item.getBoundingClientRect());
    }
  });

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('.gth-balloon') : null;
    if (!el) return;
    var k = el.dataset.k || '', c = k.lastIndexOf(':');
    if (c <= 0) return;
    openHlNote(k.slice(0, c), Number(k.slice(c + 1)), el.getBoundingClientRect());
  });

  var balloonEls = {};

  function syncBalloons() {
    var inner = $('#gth-rail-in');

    if (!inner || !isListRoute() || !railFrame) return;

    var want = {};
    Object.keys(store.highlights).forEach(function (qid) {
      if (!qNodes[qid]) return;
      (store.highlights[qid] || []).forEach(function (rec, i) {
        if (rec.note) want[qid + ':' + i] = { qid: qid, idx: i, rec: rec };
      });
    });

    Object.keys(balloonEls).forEach(function (k) {
      if (!want[k]) { balloonEls[k].remove(); delete balloonEls[k]; }
    });

    var rows = [];
    Object.keys(want).forEach(function (k) {
      var w = want[k], el = balloonEls[k];
      if (!el) {
        el = document.createElement('div');
        el.className = 'gth-balloon';
        el.dataset.k = k;
        el.title = '点击改这条批注';
        inner.appendChild(el);
        balloonEls[k] = el;
      }

      var q = w.rec.quote || '';
      if (q.length > 40) q = q.slice(0, 40) + '…';
      var sig = (w.rec.color || 'yellow') + '|' + q + '|' + (w.rec.note || '');
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        el.innerHTML =
          '<div class="gth-balloon-h"><span class="dot ' + (w.rec.color === 'red' ? 'red' : 'yellow') + '"></span>' +
          '<span class="q">' + esc(q) + '</span></div>' +
          '<div class="gth-balloon-b">' + esc(w.rec.note || '') + '</div>';
      }
      rows.push({ el: el, qid: w.qid, idx: w.idx });
    });
    if (!rows.length) return;

    rows.forEach(function (row) {
      row.top = null;
      var node = qNodes[row.qid];
      if (!node || !node.isConnected) return;
      var mk = $('mark.gth-hl[data-gth-i="' + row.idx + '"]', node);
      if (!mk) return;
      row.top = mk.getBoundingClientRect().top - railFrame.top;
      row.h = row.el.offsetHeight || 60;
    });

    rows.sort(function (a, b) {
      return (a.top == null ? 1e9 : a.top) - (b.top == null ? 1e9 : b.top);
    });
    var last = -1e9;
    rows.forEach(function (row) {
      if (row.top == null) { row.el.hidden = true; return; }
      row.el.hidden = false;
      var t = Math.max(row.top, last + 8);
      row.el.style.top = Math.round(t) + 'px';
      last = t + row.h;
    });
  }

  var collectEl = null;
  var collectState = { qids: null, src: 'both', onlyAnalysis: true, group: 'q' };

  function collectIds() {
    var ids = noteIdsWithHl();
    if (collectState.qids) {
      var want = collectState.qids.map(String);
      ids = ids.filter(function (id) { return want.indexOf(String(id)) >= 0; });
    }
    return ids;
  }

  function collectItems() {
    var out = [];
    collectIds().forEach(function (id) {
      var note = store.notes[id];
      var hls = [];
      if (collectState.src !== 'note') {
        hls = getHighlights(id).filter(function (h) {
          return !collectState.onlyAnalysis || h.block === 'analysis';
        });
      }
      var noteText = (collectState.src === 'hl' || !note) ? '' : (note.text || '');
      if (!noteText && !hls.length) return;
      var at = (note && note.updated) || 0;
      hls.forEach(function (h) { if ((h.at || 0) > at) at = h.at; });
      out.push({
        id: id,
        subject: (note && note.subject != null) ? note.subject : (hls[0] ? hls[0].subject : null),
        snap: (note && note.snapshot) || (hls[0] && hls[0].snap) || '',
        note: noteText, hls: hls, at: at
      });
    });
    out.sort(function (a, b) { return b.at - a.at; });
    return out;
  }

  function tagOf(it) { return '［' + (SUBJECT_NAME[it.subject] || '题目') + ' #' + it.id + '］'; }

  function collectMarkdown() {
    var items = collectItems();
    var nHl = items.reduce(function (s, it) { return s + it.hls.length; }, 0);
    var L = ['# 上岸村划线笔记', '',
      '> 生成时间：' + new Date().toLocaleString() + '　共 ' + items.length + ' 题　' + nHl + ' 条划线', ''];
    if (!items.length) { L.push('（没有可整理的内容）'); return L.join('\n'); }

    if (collectState.group === 'color') {
      var red = [], yel = [], notes = [];
      items.forEach(function (it) {
        it.hls.forEach(function (h) {
          (h.color === 'red' ? red : yel).push(tagOf(it) + ' ' + (h.quote || '') +
            (h.note ? '　（批注：' + h.note.replace(/\s*\n\s*/g, ' ') + '）' : ''));
        });
        if (it.note) notes.push(tagOf(it) + ' ' + it.note.replace(/\s*\n\s*/g, ' '));
      });
      if (red.length) { L.push('## 易错（' + red.length + ' 条）'); L.push(''); red.forEach(function (s) { L.push('- ' + s); }); L.push(''); }
      if (yel.length) { L.push('## 重点（' + yel.length + ' 条）'); L.push(''); yel.forEach(function (s) { L.push('- ' + s); }); L.push(''); }
      if (notes.length) { L.push('## 我的笔记（' + notes.length + ' 条）'); L.push(''); notes.forEach(function (s) { L.push('- ' + s); }); L.push(''); }
      return L.join('\n');
    }

    items.forEach(function (it, i) {
      L.push('## ' + (i + 1) + '. ' + tagOf(it));
      L.push('');
      if (it.snap) { L.push('> ' + it.snap); L.push(''); }
      if (it.note) { L.push('**我的笔记**'); L.push(''); L.push(it.note); L.push(''); }
      if (it.hls.length) {
        L.push('**划线摘录**'); L.push('');
        it.hls.forEach(function (h) {
          L.push('- [' + (HL_LABEL[h.color] || '重点') + '] ' + (h.quote || '') +
            (h.lost ? '　（原文已变更，未能重新定位）' : ''));
          if (h.note) L.push('    - 批注：' + h.note.replace(/\s*\n\s*/g, ' '));
        });
        L.push('');
      }
      L.push('---'); L.push('');
    });
    return L.join('\n');
  }

  function collectPlain() {
    return collectMarkdown()
      .replace(/^> /gm, '')
      .replace(/^#{1,6} /gm, '')
      .replace(/\*\*/g, '')
      .replace(/^- \[(重点|易错)\] /gm, '$1：');
  }

  function buildCollectEl() {
    collectEl = document.createElement('div');
    collectEl.id = 'gth-collect';
    collectEl.hidden = true;
    collectEl.innerHTML = [
      '<div class="gthc-box">',
      '<div class="gthc-h">' + icon('highlighter') + '整理为笔记<span class="sp"></span>',
      '<button class="gth-btn ghost sm" data-act="close">' + icon('x') + '</button></div>',
      '<div class="gthc-b">',
      '<div class="gthc-opts"><span class="lb">内容</span><div class="gth-chips" data-g="src">',
      '<div class="gth-chip" data-v="hl">仅划线</div>',
      '<div class="gth-chip" data-v="note">仅笔记</div>',
      '<div class="gth-chip" data-v="both">划线 + 笔记</div>',
      '</div></div>',
      '<div class="gthc-opts"><span class="lb">分组</span><div class="gth-chips" data-g="group">',
      '<div class="gth-chip" data-v="q">按题目</div>',
      '<div class="gth-chip" data-v="color">按颜色归拢</div>',
      '</div></div>',
      '<div class="gthc-opts"><span class="lb"></span>',
      '<label class="gthc-check"><input type="checkbox" id="gthc-only-analysis"> 只收解析区的划线（题干 / 选项的划线只作标记，不进笔记）</label>',
      '</div>',
      '<div class="gthc-pre" id="gthc-pre"></div>',
      '</div>',
      '<div class="gthc-f"><span id="gthc-meta" class="gth-notes-meta"></span><span class="sp"></span>',
      '<button class="gth-btn sm" data-act="copy">' + icon('copy') + '复制</button>',
      '<button class="gth-btn sm" data-act="txt">' + icon('fileText') + 'TXT</button>',
      '<button class="gth-btn primary sm" data-act="md">' + icon('download') + '下载 Markdown</button>',
      '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(collectEl);

    collectEl.addEventListener('click', function (e) {
      if (e.target === collectEl) { closeCollect(); return; }
      var chip = e.target.closest && e.target.closest('.gth-chip');
      if (chip) {
        collectState[chip.parentNode.dataset.g] = chip.dataset.v;
        renderCollect();
        return;
      }
      var btn = e.target.closest && e.target.closest('button[data-act]');
      if (!btn) return;
      var act = btn.dataset.act;
      if (act === 'close') { closeCollect(); return; }
      if (act === 'copy') { copyWithToast($('#gthc-pre').textContent); return; }
      if (act === 'txt') {
        download('上岸村划线笔记_' + stamp() + '.txt', new Blob([collectPlain()], { type: 'text/plain;charset=utf-8' }));
        return;
      }
      if (act === 'md') {
        download('上岸村划线笔记_' + stamp() + '.md',
          new Blob([collectMarkdown()], { type: 'text/markdown;charset=utf-8' }));
      }
    });
    $('#gthc-only-analysis').addEventListener('change', function (e) {
      collectState.onlyAnalysis = e.target.checked;
      renderCollect();
    });
  }

  function renderCollect() {
    if (!collectEl) return;
    $$('.gth-chip', collectEl).forEach(function (c) {
      c.classList.toggle('on', c.dataset.v === collectState[c.parentNode.dataset.g]);
    });
    var cb = $('#gthc-only-analysis');
    if (cb) {
      cb.checked = collectState.onlyAnalysis;
      cb.disabled = collectState.src === 'note';
    }
    $('#gthc-pre').textContent = collectMarkdown();
    var items = collectItems();
    var nh = items.reduce(function (s, it) { return s + it.hls.length; }, 0);
    var nn = items.filter(function (it) { return it.note; }).length;
    $('#gthc-meta').textContent = items.length + ' 题 · 划线 ' + nh + ' 条' +
      (nn ? ' · 笔记 ' + nn + ' 条' : '');
  }

  function openCollect(qids) {
    collectState.qids = (qids && qids.length) ? qids : null;
    if (!collectEl) buildCollectEl();
    renderCollect();
    collectEl.hidden = false;
  }
  function closeCollect() { if (collectEl) collectEl.hidden = true; }

  var quizEl = document.createElement('div');
  quizEl.id = 'gth-quiz';
  quizEl.hidden = true;
  document.body.appendChild(quizEl);

  var quiz = null;

  function tierOf(q) {
    if (isMastered(q.id)) return 3;
    if (errCountOf(q) >= STUBBORN_MIN) return 0;
    if (!isPracticed(q.id)) return 1;
    return 2;
  }

  function weightedShuffle(arr) {
    return arr.map(function (q) {
      return { q: q, key: Math.pow(Math.random(), 1 / errCountOf(q)) };
    }).sort(function (a, b) { return b.key - a.key; })
      .map(function (x) { return x.q; });
  }

  function weightedPick(arr, k) {
    var n = (k && k < arr.length) ? k : arr.length;
    var tiers = [[], [], [], []];
    arr.forEach(function (q) { tiers[tierOf(q)].push(q); });
    return tiers.reduce(function (out, t) { return out.concat(weightedShuffle(t)); }, []).slice(0, n);
  }

  function resumeKey(f, order) { return filterDesc(f) + '|' + order; }

  function resumeKeyOld(key) {
    return key.replace(srcLabel(['error', 'favorite']), SRC_NAME.both);
  }

  function readResume(key) {
    if (!key) return null;
    var r = store.resume[key];
    if (r) return r;
    var old = resumeKeyOld(key);
    if (old === key || !store.resume[old]) return null;
    store.resume[key] = store.resume[old];
    delete store.resume[old];
    saveStore();
    return store.resume[key];
  }

  function clearResume(key) {
    if (!key) return;
    var old = resumeKeyOld(key);
    if (!store.resume[key] && !store.resume[old]) return;
    delete store.resume[key];
    delete store.resume[old];
    saveStore();
  }

  function staleResumeKeys(resume) {
    return Object.keys(resume || {}).filter(function (k) {
      return k && k.indexOf(' · ') < 0 && k.indexOf(SRC_NAME.mock) !== 0;
    });
  }

  function strayStorageKeys(names) {
    return (names || []).filter(function (k) {
      return /^gongan_exam_helper_/.test(k) || /^gongan_tiku_helper_[\w-]+__bak_/.test(k);
    });
  }

  function saveResume(key, idx, id, answered) {
    if (!key) return;
    store.resume[key] = { idx: idx, id: id || '', at: Date.now(), answered: answered || {} };
    saveStore();
  }

  function resumeOffset(key, list) {
    var r = readResume(key);
    if (!r) return 0;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(r.id)) return i;
    }
    return Math.min(Math.max(r.idx || 0, 0), list.length);
  }

  $('#gth-start').addEventListener('click', function () {
    var f = readFilter('practice');
    if (!f.srcs.length) { setStatus('至少勾一个来源（错题本 / 收藏夹 / 模考收录）', 'err'); return; }
    var num = Math.max(0, parseInt($('#gth-num').value, 10) || 0);
    var order = $('#gth-order').value;
    var seq = order !== 'random';
    var key = seq ? resumeKey(f, order) : '';
    var r = seq ? readResume(key) : null;
    var desc0 = filterDesc(f);

    var want = !num ? 0 : ((r && r.idx) ? r.idx + num + 1 : num);
    setStatus('正在组卷…');
    busy(this, fetchByFilter(f, want).then(function (all) {
      if (!all.length) { setStatus('该条件下没有题目（来源：' + srcLabel(f.srcs) + '）', 'err'); return; }
      var ordered = order === 'desc' ? all.slice().reverse() : all;
      var offset = seq ? resumeOffset(key, ordered) : 0;
      var restarted = false;
      if (offset >= ordered.length) {
        offset = 0;
        clearResume(key);
        restarted = true;
      }
      var picked = order === 'random'
        ? weightedPick(ordered, num)
        : (num ? ordered.slice(offset, offset + num) : ordered.slice(offset));
      if (!picked.length) { setStatus('没有可练习的题目', 'err'); return; }
      loaded.filter = f;

      var startIdx = 0;
      if (seq && r && r.answered && picked.length) {
        for (var fu = 0; fu < picked.length; fu++) {
          if (!r.answered[String(picked[fu].id)]) { startIdx = fu; break; }
        }
      }
      var note = restarted ? '（已刷完，从头开始）'
        : ((offset + startIdx) ? '（从第 ' + (offset + startIdx + 1) + ' 题继续）' : '');
      setStatus('组卷完成，共 ' + picked.length + ' 题' + note, 'ok');

      if (filterDesc(readFilter('practice')) !== desc0) {
        toast('筛选在取题期间改过了：这份卷子按「' + desc0 + '」生成');
      }
      startQuiz(picked, filterDesc(f), false, seq ? (r && r.answered) : null, minLimit());
      if (seq) {
        quiz.resumeKey = key;
        quiz.resumeBase = offset;
        quiz.idx = startIdx;

        saveResume(key, offset + startIdx, picked[startIdx] && picked[startIdx].id, quiz.answeredIds);
      }
      renderQuiz();
      renderPracticeHint();
    }).catch(function (e) { setStatus('组卷失败：' + e.message, 'err'); }));
  });

  function pushHistory(desc, list) {
    store.history.unshift({
      at: Date.now(),
      desc: desc,
      n: list.length,
      filter: loaded.filter,
      ids: list.map(function (q) { return q.id; })
    });
    store.history = store.history.slice(0, 3);
    saveStore();
    renderHistory();
  }

  function renderHistory() {
    var box = $('#gth-history');
    if (!box) return;
    var h = store.history || [];
    if (!h.length) {
      box.innerHTML = '<div class="gth-empty">' + icon('play') +
        '<div>还没有组卷记录。设置题量后点「开始重练」即可。</div></div>';
      return;
    }
    box.innerHTML = h.map(function (it, i) {
      return '<div class="gth-his-item">' +
        '<span class="desc" title="' + esc(it.desc) + '">' + esc(it.desc) + '</span>' +
        '<span class="meta">' + it.n + ' 题 · ' + fmtAgo(it.at) + '</span>' +
        '<button class="gth-btn sm" data-his="' + i + '">' + icon('play') + '重练这套</button>' +
        '</div>';
    }).join('');
    $$('[data-his]', box).forEach(function (b) {
      b.addEventListener('click', function () { replayHistory(store.history[Number(b.dataset.his)]); });
    });
  }

  function renderPracticeHint() {
    var el = $('#gth-practice-hint'), btn = $('#gth-resume-reset');
    if (!el) return;
    var order = $('#gth-order').value;
    if (order === 'random') {
      el.textContent = '随机组卷按「顽固错题 → 尚未重练 → 练过未掌握 → 已掌握」分层，同层内按答错次数加权';
      if (btn) btn.hidden = true;
      return;
    }

    var r = readResume(resumeKey(readFilter('practice'), order));
    el.textContent = r
      ? '下次从第 ' + (r.idx + 1) + ' 题继续'
      : '顺序刷题会自动记录进度，下次可从上次继续';
    if (btn) btn.hidden = !r;
  }

  $('#gth-resume-reset').addEventListener('click', function () {
    clearResume(resumeKey(readFilter('practice'), $('#gth-order').value));
    renderPracticeHint();
    setStatus('已清除该条件下的刷题进度，下次从头开始', 'ok');
  });

  function replayHistory(h) {
    if (!h || !h.filter) return;
    setStatus('正在按历史条件重新拉取题目…');
    fetchByFilter(h.filter).then(function (list) {
      var want = {};
      (h.ids || []).forEach(function (id) { want[id] = 1; });
      var picked = list.filter(function (q) { return want[q.id]; });
      if (!picked.length) { setStatus('这套卷的题目已不在当前来源中，无法重练', 'err'); return; }
      var miss = h.ids.length - picked.length;
      if (miss) setStatus('已找回 ' + picked.length + '/' + h.ids.length + ' 题，其余已移出列表', 'err');
      else setStatus('');
      startQuiz(picked, h.desc, true, null, minLimit());
    }).catch(function (e) { setStatus('重练失败：' + e.message, 'err'); });
  }

  // 限时留空 = 不限时：头部改说「已用时间」，也就没有到点交卷这一说（暂停键无条件在，见 quizHeadHtml）
  function minLimit() {
    var el = $('#gth-min');
    var v = el ? parseInt(el.value, 10) : 0;
    return v > 0 ? v * 60 : 0;
  }

  function startQuiz(list, desc, fromHistory, seedAnswered, limitSec) {
    quiz = {
      list: list, desc: desc, idx: 0,
      answers: {}, submitted: false,
      answeredIds: seedAnswered || {},
      marked: {}, onlyWrong: false, spent: {},
      limitSec: limitSec || 0, paused: false, runMs: 0, lastAt: Date.now(),
      timer: null
    };
    if (!fromHistory) pushHistory(desc, list);
    quizEl.hidden = false;
    document.body.style.overflow = 'hidden';
    quiz.timer = setInterval(tickQuiz, 1000);
    renderQuiz();
  }

  // 时钟只在未暂停时累加：暂停那一段根本不进 runMs，所以「剩余时间」停得住，
  // 而「已用时间」也不会像站点那样被冻出一个少了一截的数
  function tickQuiz() {
    if (!quiz || quiz.submitted) return;
    var now = Date.now(), dt = now - quiz.lastAt;
    quiz.lastAt = now;
    if (quiz.paused) return;
    quiz.runMs += dt;
    // 每秒把这一段记在当前那一题头上：重练是一屏一题，归属没有歧义，
    // 所以不必像专项页那样另设「认不出就落 lost」
    var cur = quiz.list[quiz.idx];
    if (cur) quiz.spent[cur.id] = (quiz.spent[cur.id] || 0) + dt;
    var el = $('#gth-remain');
    if (el) setClockText(el, quizClockHtml());
    if (quiz.limitSec && quiz.runMs >= quiz.limitSec * 1000) submitQuiz(true);
  }

  // 只改文本节点的 nodeValue：观察器盯的是 childList，用 innerHTML 每秒重写一次
  // 就等于每秒给页面排一轮无意义的刷新
  function setClockText(el, txt) {
    if (!el.firstChild) el.appendChild(document.createTextNode(''));
    if (el.firstChild.nodeValue !== txt) el.firstChild.nodeValue = txt;
  }

  function quizClockHtml() {
    if (!quiz.limitSec) return '已用时间：' + fmtTime(quiz.runMs);
    return '剩余时间：' + fmtTime(Math.max(0, quiz.limitSec * 1000 - quiz.runMs)) +
      (quiz.paused ? '（已暂停）' : '');
  }

  function closeQuiz() {
    if (quiz && quiz.timer) clearInterval(quiz.timer);
    quiz = null;
    quizEl.hidden = true;
    quizEl.innerHTML = '';
    document.body.style.overflow = '';
    refreshBadges();
    renderPracticeHint();
  }

  function answeredCount() {
    return Object.keys(quiz.answers).filter(function (k) {
      return (quiz.answers[k] || []).length > 0;
    }).length;
  }

  function isRight(q) {
    var a = quiz.answers[q.id] || [];
    return !!a.length && ansKey(a) === ansKey(q.correct_answer);
  }

  function rightCount() { return quiz.list.filter(isRight).length; }

  function toggleAnswer(id, label, multi) {
    var cur = quiz.answers[id] || [];
    if (!multi) { quiz.answers[id] = [label]; }
    else {
      var i = cur.indexOf(label);
      if (i >= 0) cur.splice(i, 1); else cur.push(label);
      quiz.answers[id] = cur.slice().sort();
    }
    if ((quiz.answers[id] || []).length) quiz.answeredIds[id] = true;
    // 选一个选项只改这一题的圈与答题卡那一格：整屏重写会把滚动位置与展开态一起抹掉
    paintChoices();
    paintCells();
  }

  function toggleMark(id) {
    if (quiz.marked[id]) delete quiz.marked[id]; else quiz.marked[id] = 1;
    paintCells();
  }

  function cellState(i) {
    var q = quiz.list[i], a = quiz.answers[q.id] || [];
    if (quiz.submitted) {
      if (!a.length) return 'miss';
      return ansKey(a) === ansKey(q.correct_answer) ? 'right' : 'bad';
    }
    return a.length ? 'done' : '';
  }

  function cellCls(i) {
    return 'gthq-cell ' + cellState(i) +
      (quiz.marked[quiz.list[i].id] ? ' stressed' : '') +
      (i === quiz.idx ? ' cur' : '');
  }

  function paintChoices() {
    var q = quiz.list[quiz.idx];
    var sel = quiz.answers[q.id] || [];
    $$('.gth-choice', quizEl).forEach(function (el) {
      var c = $('.gth-circle', el);
      if (c) c.className = 'gth-circle' + (sel.indexOf(el.dataset.label) >= 0 ? ' checked' : '');
    });
  }

  function paintCells() {
    $$('.gthq-cell', quizEl).forEach(function (el) {
      el.className = cellCls(Number(el.dataset.i));
    });
  }

  // 勾上「只看错题」之后，答题卡、上一题与下一题都只在错题那一列里走——
  // 只把别的题藏起来是假「只看」，F5 一按就跳回做对的题
  function navIdxs() {
    if (!quiz.submitted || !quiz.onlyWrong) return quiz.list.map(function (q, i) { return i; });
    var out = [];
    quiz.list.forEach(function (q, i) {
      var a = quiz.answers[q.id] || [];
      if (a.length && ansKey(a) !== ansKey(q.correct_answer)) out.push(i);
    });
    return out;
  }

  function goIdx(i) {
    var seq = navIdxs();
    if (!seq.length) {
      // 一道错题都没有却还挂着「只看错题」，界面就停在第一题（做对的那道）上，
      // 看着像那颗复选框坏了——收回勾选并说一句
      quiz.onlyWrong = false;
      quiz.idx = 0;
      toast('这一卷没有答错的题');
      renderQuiz();
      return;
    }
    quiz.idx = seq.indexOf(i) >= 0 ? i : seq[0];
    renderQuiz();
  }

  function stepIdx(d) {
    var seq = navIdxs(), at = seq.indexOf(quiz.idx);
    if (at < 0) { goIdx(seq.length ? seq[0] : 0); return; }
    if (seq[at + d] == null) return;
    quiz.idx = seq[at + d];
    renderQuiz();
  }

  function submitQuiz(auto) {
    if (!quiz || quiz.submitted) return;
    var un = quiz.list.length - answeredCount();
    if (!auto && un > 0 && !confirm('还有 ' + un + ' 题未作答，确定交卷吗？')) return;
    clearInterval(quiz.timer);
    quiz.timer = null;
    applyMastery();
    quiz.submitted = true;
    quiz.paused = false;
    quiz.onlyWrong = false;

    if (quiz.resumeKey) {
      var fu = 0;
      for (; fu < quiz.list.length; fu++) {
        if (!quiz.answeredIds[String(quiz.list[fu].id)]) break;
      }
      if (fu >= quiz.list.length) saveResume(quiz.resumeKey, quiz.resumeBase + quiz.list.length, '', {});
      else saveResume(quiz.resumeKey, quiz.resumeBase + fu, quiz.list[fu].id, quiz.answeredIds);
    }
    if (auto) toast('时间到，已自动交卷');
    renderQuiz();
  }

  function renderQuiz() {
    if (!quiz) return;

    if (quiz.resumeKey && !quiz.submitted && quiz.list[quiz.idx]) {
      saveResume(quiz.resumeKey, quiz.resumeBase + quiz.idx, quiz.list[quiz.idx].id, quiz.answeredIds);
    }
    quizEl.innerHTML = quiz.submitted ? reportHtml() : doingHtml();
    bindQuiz();
    repaintHighlights();
    // 这一屏开着时观察器整轮早退，公式图的尺寸就得在这里自己管一次
    fitImgs(quizEl);
  }

  function noteboxHtml(q) {
    var subj = subjectOf(q);
    return '<div class="gthq-notebox">' +
      '<div class="gthq-nb-act">' +
      '<button class="gth-btn sm" data-act="collect">' + icon('highlighter') + '整理本题</button>' +
      '</div>' +
      '<div class="gthq-hls" data-hls="' + esc(q.id) + '"></div>' +
      '<div class="gth-note-area" data-note-area="' + esc(q.id) + '"' +
        (subj == null ? '' : ' data-subj="' + esc(subj) + '"') + ' data-mode="view">' +
      noteAreaHtml(q.id, 'view') + '</div></div>';
  }

  function questionCardHtml(q, o) {
    o = o || {};
    var picked = o.picked || [];
    var right = ansKey(q.correct_answer);
    var ana = analysisOf(q);
    var opts = (q.opt || []).map(function (x) {
      var isRight = right.indexOf(x.label) >= 0;
      var isMine = picked.indexOf(x.label) >= 0;
      if (o.circle) {
        // 上色只靠圆圈，照站点错题页：正确绿、错选红，不再往文字后面追加「（正确）」
        return '<div class="gth-choice"><div class="gth-circle' +
          (isRight ? ' right' : (isMine ? ' wrong' : '')) + '"></div>' +
          '<div class="gth-ctext"><div class="gth-clab">' + esc(x.label) + '.</div>' +
          '<div class="gth-cval">' + wakeImgs(x.content || '') + '</div></div></div>';
      }
      // 复盘那一屏照站点解析页：选项就是纯文字，谁对谁错由下面那行「正确答案／我的答案」说，
      // 不再给整行上色、也不在文字后面追「（正确）」
      return '<div class="gth-opt-plain">' + esc(x.label) + '. ' + wakeImgs(x.content || '') + '</div>';
    }).join('');
    var body = q.content ? wakeImgs(q.content) : (o.excerpt ? esc(o.excerpt) : '');
    return '' +
      '<div class="' + (o.cls || 'gth-qcard') + '" data-id="' + esc(q.id) + '" data-gth-qid="' + esc(q.id) + '">' +
      (o.head || '') +
      '<div class="gth-qmain">' +
      (o.no ? '<div class="gth-seq"><div class="gth-seq-box">' + o.no + '</div></div>' : '') +
      '<div class="gth-qbody">' +
      (o.kind || o.time ? '<div class="gthq-kind">' +
        (o.kind ? '（' + esc(o.kind) + '）' : '') +
        (o.time ? '<span class="gthq-qtime">' + o.time + '</span>' : '') + '</div>' : '') +
      (q.material ? '<div class="gthq-material">' + wakeImgs(q.material) + '</div>' : '') +
      (body ? '<div class="gthq-stem">' + body + '</div>' : '') +
      (opts ? '<div class="gthq-opts">' + opts + '</div>' : '') +
      (o.mine == null ? '' :
        '<div class="gthq-ans"><div>正确答案：<b class="ok">' + right + '</b></div>' +
        '<div>我的答案：<b class="' + (o.mineOk ? 'ok' : 'bad') + '">' +
        (o.mine || '未作答') + '</b></div></div>') +
      (ana ? '<div class="gthq-analysis"' + (o.anaToggle ? ' hidden' : '') + '><b>解析</b><div>' +
        wakeImgs(ana) + '</div></div>' : '') +
      (ana && o.anaToggle ?
        '<div class="gth-bline"><div class="ln"></div><div class="gth-btext" data-act="ana">' +
        '<span class="t-open">展开</span><span class="t-close">收起</span>查看解析</div></div>' : '') +
      (o.conflict ? '<div class="gthq-tip">' + icon('warn') + '题面快照与模考收录的内容不一致，请核对是哪一份</div>' : '') +
      (o.noSnap ? '<div class="gthq-tip">' + icon('rotate') + '这题还没有题面，正在自动向站点要</div>' : '') +
      (o.partSnap ? '<div class="gthq-tip">' + icon('rotate') + '这份快照缺解析正文（抓的那一刻这一页没展开解析），正在自动再要一次</div>' : '') +
      (o.note === false ? '' : noteboxHtml(q)) +
      (o.foot || '') +
      '</div></div></div>';
  }

  function quizStatsHtml() {
    var right = rightCount(), miss = 0;
    quiz.list.forEach(function (q) { if (!(quiz.answers[q.id] || []).length) miss++; });
    var wrong = quiz.list.length - right - miss;
    return '得分 ' + right + ' / ' + quiz.list.length +
      '　正确率 ' + Math.round(right / quiz.list.length * 100) + '%' +
      '　错题 ' + wrong + '　未做 ' + miss + '　用时 ' + fmtTime(quiz.runMs);
  }

  function quizHeadHtml() {
    var right = quiz.submitted
      ? '<span class="gthq-remain">' + quizStatsHtml() + '</span>'
      : '<span class="gthq-remain" id="gth-remain">' + quizClockHtml() + '</span>' +
        '<button class="gthq-btn pause" id="gth-pause" type="button" title="' +
        (quiz.paused ? '点这里恢复计时'
          : (quiz.limitSec ? '冻结倒计时，可以放心离开' : '暂停计时：离开这一会儿不算进用时')) + '">' +
        icon(quiz.paused ? 'play' : 'pause') + '</button>' +
        '<button class="gthq-btn" id="gth-submit" type="button">交卷</button>';
    return '<div class="gthq-header"><div class="gthq-hc">' +
      '<span class="gthq-name">重练</span>' +
      '<span class="gthq-sub">' + esc(quiz.desc) + '</span><span class="sp"></span>' + right +
      '</div></div>';
  }

  function quizSheetHtml() {
    var seq = navIdxs();
    return '<div class="gthq-sheet-col">' +
      (quiz.submitted ? '<label class="gthq-only"><input type="checkbox" id="gth-onlywrong"' +
        (quiz.onlyWrong ? ' checked' : '') + '>只看错题</label>' : '') +
      '<div class="gthq-title' + (quiz.submitted ? ' done' : '') + '">答题卡</div>' +
      // 格子跟着那份序列收窄：勾了「只看错题」还画整张答题卡，就等于只筛了内容没筛答题卡
      '<ul class="gthq-cells">' + seq.map(function (i) {
        return '<li class="' + cellCls(i) + '" data-i="' + i + '"><i>' + (i + 1) + '</i></li>';
      }).join('') + '</ul></div>';
  }

  function quizTips() {
    return '<div class="gthq-tips">共 ' + quiz.list.length + ' 题　请按每道题的答题要求作答</div>';
  }

  function quizFootHtml() {
    return '<div class="gthq-foot"><div class="gthq-hc"><span class="sp"></span>' +
      (quiz.submitted ? '' : '<button class="gthq-btn warn" id="gth-mark" type="button" ' +
        'title="标记这道题待复查，答题卡那一格画个红角">' + icon('star') + '标记</button>') +
      '<button class="gthq-btn ghost" id="gth-prev" type="button">上一题（F4）</button>' +
      '<button class="gthq-btn blue" id="gth-next" type="button">下一题（F5）</button>' +
      '<button class="gthq-btn ghost" id="gth-exit" type="button">退出</button>' +
      '</div></div>';
  }

  function quizBodyHtml(inner) {
    return quizHeadHtml() + '<div class="gthq-body">' + quizSheetHtml() +
      '<div class="gthq-content" id="gth-quiz-scroll"><div class="gthq-box">' +
      quizTips() + inner + '</div></div></div>' + quizFootHtml();
  }

  function doingHtml() {
    var q = quiz.list[quiz.idx];
    var sel = quiz.answers[q.id] || [];
    var multi = ansKey(q.correct_answer).length > 1;
    var opts = (q.opt || []).map(function (x) {
      return '<div class="gth-choice" data-label="' + esc(x.label) + '">' +
        '<div class="gth-circle' + (sel.indexOf(x.label) >= 0 ? ' checked' : '') + '"></div>' +
        '<div class="gth-ctext"><div class="gth-clab">' + esc(x.label) + '.</div>' +
        '<div class="gth-cval">' + wakeImgs(x.content || '') + '</div></div></div>';
    }).join('');
    return quizBodyHtml(
      '<div class="gth-qcard" data-gth-qid="' + esc(q.id) + '"><div class="gth-qmain">' +
      '<div class="gth-seq"><div class="gth-seq-box">' + (quiz.idx + 1) + '</div></div>' +
      '<div class="gth-qbody">' +
      '<div class="gthq-kind">（' + (multi ? '多选' : '单选') + '）</div>' +
      (q.material ? '<div class="gthq-material">' + wakeImgs(q.material) + '</div>' : '') +
      '<div class="gthq-stem">' + wakeImgs(q.content || '') + '</div>' +
      '<div class="gthq-opts">' + (opts || '<div class="gthq-tip">该题型无选项</div>') + '</div>' +
      '</div></div></div>');
  }

  function reportHtml() {
    var q = quiz.list[quiz.idx];
    var ans = quiz.answers[q.id] || [];
    var mine = ansKey(ans);
    var spent = quiz.spent[q.id];
    return quizBodyHtml(
      questionCardHtml(q, {
        cls: 'gth-qcard', no: quiz.idx + 1,
        kind: ansKey(q.correct_answer).length > 1 ? '多选' : '单选',
        time: spent >= 1000 ? icon('clock') + fmtTime(spent) : '',
        mine: mine, mineOk: isRight(q), picked: ans
      }) +
      '<div class="gthq-hls" data-hls="' + esc(q.id) + '"></div>');
  }

  function bindQuiz() {
    var q = quiz.list[quiz.idx];

    bindAnaToggle(quizEl);
    $$('.gthq-cell', quizEl).forEach(function (el) {
      el.addEventListener('click', function () { goIdx(Number(el.dataset.i)); });
    });

    if (!quiz.submitted) {
      $$('.gth-choice', quizEl).forEach(function (el) {
        el.addEventListener('click', function () {
          toggleAnswer(q.id, el.dataset.label, ansKey(q.correct_answer).length > 1);
        });
      });
      var mk = $('#gth-mark', quizEl);
      if (mk) mk.addEventListener('click', function () { toggleMark(q.id); });
      var pb = $('#gth-pause', quizEl);
      if (pb) pb.addEventListener('click', function () {
        quiz.paused = !quiz.paused;
        if (!quiz.paused) quiz.lastAt = Date.now();
        renderQuiz();
      });
    }

    var prev = $('#gth-prev', quizEl);
    if (prev) prev.addEventListener('click', function () { stepIdx(-1); });
    var next = $('#gth-next', quizEl);
    if (next) next.addEventListener('click', function () { stepIdx(1); });
    var submit = $('#gth-submit', quizEl);
    if (submit) submit.addEventListener('click', function () { submitQuiz(false); });
    var exit = $('#gth-exit', quizEl);
    if (exit) exit.addEventListener('click', closeQuiz);
    var ow = $('#gth-onlywrong', quizEl);
    if (ow) ow.addEventListener('change', function () {
      quiz.onlyWrong = ow.checked;
      goIdx(quiz.idx);
    });

    bindNoteAreas(quizEl);

    var cb = $('[data-hls]', quizEl);
    if (cb) refreshQuizHl();
    $$('.gth-qcard[data-gth-qid] [data-act="collect"]', quizEl).forEach(function (btn) {
      var item = btn.closest('.gth-qcard');
      btn.addEventListener('click', function () {
        openCollect([String(item.getAttribute('data-gth-qid'))]);
      });
    });
  }

  function applyMastery() {
    quiz.list.forEach(function (q) {
      var ans = quiz.answers[q.id];
      if (!ans || !ans.length) return;
      var ok = ansKey(ans) === ansKey(q.correct_answer);
      var prev = (store.mastered[q.id] && store.mastered[q.id].streak) || 0;
      store.mastered[q.id] = { streak: ok ? prev + 1 : 0, updated: Date.now() };
      bumpWrongCount(q, ok);
      markPracticed(q.id);
    });
    saveStore();
  }

  var MOCK_QID_KEYS = ['id', 'question_id', 'subject_id', 'qid', 'content_id'];
  var MOCK_STEM_KEYS = ['content', 'stem', 'question', 'title', 'topic'];
  var MOCK_MAT_KEYS = ['material', 'materials'];
  var MOCK_OPT_KEYS = ['opt', 'option', 'options', 'opt_list', 'option_list'];
  var MOCK_USER_KEYS = ['userAnswers', 'user_answer', 'my_answer', 'self_answer', 'user_ans', 'answer'];
  var MOCK_CORRECT_KEYS = ['correct_answer', 'right_answer', 'true_answer', 'correct', 'answer_right'];
  var MOCK_ANALYSIS_KEYS = ['analysis', 'analysis_shadow', 'explain', 'explanation'];

  var MOCK_SUBJECT_KEYS = ['content_type', 'subject_type', 'subject'];
  var MOCK_RESULT_KEYS = ['result'];

  var MOCK_MODULE_KEYS = ['examPointName', 'exam_point', 'check_point'];

  function mockModuleOf(raw) {
    var v = pickKey(raw, MOCK_MODULE_KEYS);
    return v == null ? '' : String(v).trim();
  }

  function mockResultOf(raw) {
    var r = pickKey(raw, MOCK_RESULT_KEYS);
    if (typeof r === 'string' && /^-?\d+$/.test(r)) r = Number(r);
    return (r === 0 || r === 1 || r === 2) ? r : (typeof r === 'number' && isFinite(r) ? r : null);
  }

  function isMocksPage() {
    return /\/wxpage\/tiku\/mocks\/index\.html/.test(location.pathname);
  }

  function mockExamIdOf() {
    var m = /(\d{3,})/.exec(location.hash || '');
    return m ? m[1] : '';
  }

  function pickKey(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v != null && v !== '') return v;
    }
    return undefined;
  }

  function looksLikeQuestion(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    var id = pickKey(o, MOCK_QID_KEYS);
    if (id === undefined || !/^\d+$/.test(String(id))) return false;
    var stem = pickKey(o, MOCK_STEM_KEYS);
    if (!stem || !String(stem).trim()) return false;
    var ans = pickKey(o, MOCK_CORRECT_KEYS);
    var ana = pickKey(o, MOCK_ANALYSIS_KEYS);
    return (ans !== undefined && ans !== '') || (ana !== undefined && ana !== '');
  }

  function mockParseAns(v) {
    if (v == null || v === '') return '';
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && /^[\[{"]/.test(v)) {
      try { return JSON.parse(v); } catch (e) {}
    }
    return v;
  }

  function mockParseOpt(v) {
    if (v == null || v === '') return [];
    if (typeof v === 'string') {
      if (!/^[\[{]/.test(v)) return [];
      try { v = JSON.parse(v); } catch (e) { return []; }
    }
    if (!Array.isArray(v)) {
      if (typeof v === 'object') {
        return Object.keys(v).map(function (k) {
          return { label: String(k).toUpperCase(), content: v[k] == null ? '' : String(v[k]) };
        });
      }
      return [];
    }
    return v.map(function (o) {
      if (typeof o === 'string') {
        var m = /^([A-Za-z])[.、．:：\s]\s*(.*)$/.exec(o.trim());
        return m ? { label: m[1].toUpperCase(), content: m[2] } : { label: '', content: o };
      }
      if (o && typeof o === 'object') {
        var label = pickKey(o, ['label', 'name', 'key', 'option', 'id']);
        var content = pickKey(o, ['content', 'value', 'text', 'title', 'desc']);
        return {
          label: label == null ? '' : String(label).toUpperCase(),
          content: content == null ? '' : String(content)
        };
      }
      return { label: '', content: String(o) };
    });
  }

  function mockFieldMap(raw) {
    if (!looksLikeQuestion(raw)) return null;
    var q = {
      id: pickKey(raw, MOCK_QID_KEYS),
      content: String(pickKey(raw, MOCK_STEM_KEYS) || ''),
      material: String(pickKey(raw, MOCK_MAT_KEYS) || ''),
      opt: mockParseOpt(pickKey(raw, MOCK_OPT_KEYS)),
      correct_answer: mockParseAns(pickKey(raw, MOCK_CORRECT_KEYS)),
      user_answer: mockParseAns(pickKey(raw, MOCK_USER_KEYS)),
      analysis: String(pickKey(raw, MOCK_ANALYSIS_KEYS) || ''),
      content_type: null,
      module: mockModuleOf(raw),
      result: mockResultOf(raw)
    };
    var ct = pickKey(raw, MOCK_SUBJECT_KEYS);
    if (typeof ct === 'number' || (typeof ct === 'string' && /^\d+$/.test(ct))) q.content_type = Number(ct);
    return q;
  }

  var mockSampleLogged = false;
  function logMockSample(raw) {
    if (mockSampleLogged) return;
    mockSampleLogged = true;
    try {
      console.log('[错题助手] mocks 题目字段：' + Object.keys(raw).join(', '));
      console.log('[错题助手] mocks 样本：' + JSON.stringify(raw).slice(0, 1500));
    } catch (e) {}
  }

  function dedupeById(list) {
    var seen = {}, out = [];
    list.forEach(function (q) {
      if (!q || q.id == null) return;
      var k = String(q.id);
      if (seen[k]) return;
      seen[k] = 1;
      out.push(q);
    });
    return out;
  }

  function harvestFromScope(root) {
    var ng = getAngular();
    if (!ng) return [];
    var out = [];
    $$('[ng-repeat],[data-ng-repeat]', root).forEach(function (node) {
      var attr = node.getAttribute('ng-repeat') || node.getAttribute('data-ng-repeat') || '';
      var m = /([A-Za-z_$][\w$]*)\s+in\s+/.exec(attr);
      var it = null;
      try {
        var sc = ng.element(node).scope();
        if (!sc) return;
        if (m && sc[m[1]]) it = sc[m[1]];
        if (!it) it = sc.item || sc.q || sc.question || null;
      } catch (e) { return; }
      if (!it || typeof it !== 'object') return;
      var q = mockFieldMap(it);
      if (q) { out.push(q); logMockSample(it); }
    });
    return dedupeById(out);
  }

  var mockSniffCache = {};
  var mockSniffOrder = [];
  var mockSniffHooked = false;

  function mockSniffRemember(q) {
    var k = String(q.id);
    if (!mockSniffCache[k]) {
      mockSniffOrder.push(k);
      if (mockSniffOrder.length > 3000) delete mockSniffCache[mockSniffOrder.shift()];
    }
    mockSniffCache[k] = q;
  }

  function mockSniffed() {
    return mockSniffOrder.map(function (k) { return mockSniffCache[k]; });
  }

  function sniffJson(j, depth) {
    if (!j || typeof j !== 'object' || depth > 6) return;
    if (Array.isArray(j)) {
      var hit = 0;
      for (var i = 0; i < j.length; i++) {
        if (j[i] && typeof j[i] === 'object' && looksLikeQuestion(j[i])) hit++;
      }
      if (j.length && hit / j.length >= 0.6) {
        j.forEach(function (o) {
          var q = mockFieldMap(o);
          if (q) { mockSniffRemember(q); logMockSample(o); }
        });
      } else {
        j.forEach(function (o) { sniffJson(o, depth + 1); });
      }
      return;
    }
    if (looksLikeQuestion(j)) {
      var q = mockFieldMap(j);
      if (q) { mockSniffRemember(q); logMockSample(j); }
      return;
    }
    Object.keys(j).forEach(function (k) { sniffJson(j[k], depth + 1); });
  }

  function hookXhrSniffer() {
    try {
      var w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
      var proto = w.XMLHttpRequest && w.XMLHttpRequest.prototype;
      if (!proto || proto.__gthSniffed) return;
      proto.__gthSniffed = true;
      var origOpen = proto.open;
      proto.open = function (method, url) {
        this.__gthUrl = url;
        return origOpen.apply(this, arguments);
      };
      var origSend = proto.send;
      proto.send = function () {
        var self = this;
        this.addEventListener('load', function () {
          try {
            var t = self.responseText || '';
            if (t.length > 200 && t.length < 3000000 &&
                /analysis|subject|question|correct_answer|opt/i.test(t)) {
              sniffJson(JSON.parse(t), 0);
            }
          } catch (e) {}
        });
        return origSend.apply(this, arguments);
      };
      mockSniffHooked = true;
    } catch (e) {  }
  }

  function mergeMockQs(list, examId) {
    if (!examId) examId = 'unknown';
    if (!store.mocks[examId]) store.mocks[examId] = { at: Date.now(), processed: {} };
    if (!store.mocks[examId].processed) store.mocks[examId].processed = {};
    var reg = store.mocks[examId];
    var added = 0, wrongNew = 0, changed = false;
    list.forEach(function (q) {
      var k = String(q.id);
      var done, ok;
      if (q.result !== null) {

        done = q.result === 2 ? 0 : 1;
        ok = (q.result === 0 || q.result === 2) ? 0 : 1;
      } else {
        done = (ansKey(q.correct_answer) && ansKey(q.user_answer)) ? 1 : 0;
        ok = (done && ansKey(q.user_answer) === ansKey(q.correct_answer)) ? 1 : 0;
      }
      var cur = store.mockQs[k];
      if (!cur) {
        if (store.notes[k] || store.mastered[k]) {
          console.warn('[错题助手] 模考题 id 与已有练习题记录撞键：' + k + '（请核对内容是否同一题）');
        }
        store.mockQs[k] = {
          id: q.id, content: q.content, material: q.material, opt: q.opt,
          correct_answer: q.correct_answer, user_answer: done ? q.user_answer : '',
          analysis: q.analysis, content_type: q.content_type, module: q.module || '',
          examId: examId, done: done, ok: ok, at: Date.now()
        };
        cur = store.mockQs[k];
        added++; changed = true;
      } else {

        var touched = false;
        if (!cur.done && done) {
          cur.user_answer = q.user_answer;
          cur.done = done; cur.ok = ok;
          touched = true;
        }
        if (!cur.module && q.module) { cur.module = q.module; touched = true; }
        if (touched) { cur.at = Date.now(); changed = true; }
      }
      if (done && !ok && !reg.processed[k]) {
        reg.processed[k] = 1;
        bumpWrongCount({ id: q.id }, false);
        wrongNew++; changed = true;
      }
    });
    reg.at = Date.now();
    if (changed) saveStore();
    return { added: added, wrongNew: wrongNew };
  }

  function mockMatchModule(m, mods) {
    return !mods || !mods.length || mods.indexOf(m.module || MOCK_UNCLS) >= 0;
  }

  function mockToList(onlyWrong, mods) {
    var out = [];
    Object.keys(store.mockQs).forEach(function (k) {
      var m = store.mockQs[k];
      if (onlyWrong && !(m.done && !m.ok)) return;
      if (!mockMatchModule(m, mods)) return;
      out.push({
        id: m.id, content: m.content, material: m.material, opt: m.opt,
        correct_answer: m.correct_answer, user_answer: m.user_answer,
        analysis: m.analysis, content_type: m.content_type, module: m.module || '',
        _mock: m.examId
      });
    });
    return out;
  }
  function mockAllList(mods) { return mockToList(false, mods); }
  function mockWrongList(mods) { return mockToList(true, mods); }

  function mockModuleOptions() {
    var by = {}, out = [];
    Object.keys(store.mockQs).forEach(function (k) {
      var name = store.mockQs[k].module || MOCK_UNCLS;
      if (!by[name]) { by[name] = { name: name, n: 0 }; out.push(by[name]); }
      by[name].n++;
    });
    out.sort(function (a, b) { return b.n - a.n || (a.name < b.name ? -1 : 1); });
    return out;
  }

  var MOCK_COLLECT_CAP = 300;
  var mockCollecting = false;

  function examTypeFrom(search, hash) {
    var m = /exam_type=(\d+)/.exec(search || '') || /exam_type=(\d+)/.exec(hash || '');
    return m ? Number(m[1]) : null;
  }

  function subjectFromUrl(search, hash) {
    var t = examTypeFrom(search, hash);
    return (t === SUBJ_XC || t === SUBJ_ZY) ? t : null;
  }

  function routeExamType() {
    return isListRoute() ? subjectFromUrl(location.search, location.hash) : null;
  }

  function subjectOf(it) {
    var t = it ? it.content_type : null;
    return t != null ? t : routeExamType();
  }

  function mockExamType() {
    var t = examTypeFrom(location.search, location.hash);
    return t == null ? '1' : String(t);
  }

  function mockStatus(html) {
    var st = $('#gth-mock-status');
    if (st) st.innerHTML = html;
  }

  function mockSheetItems() {
    var ng = getAngular();
    if (!ng) return [];
    var out = [], seen = {};
    $$('[ng-repeat="item in jiexieSubjects"]').forEach(function (node) {
      var it;
      try { it = ng.element(node).scope().item; } catch (e) { return; }
      if (!it || typeof it !== 'object' || !/^\d+$/.test(String(it.id || ''))) return;
      if (seen[String(it.id)]) return;
      seen[String(it.id)] = 1;
      out.push(it);
    });
    return out;
  }

  function apiSubjectFace(id, t) {
    return apiGet(API_V2 + 'tiku/' + t + '/' + id + '/analysis', { id: id, exam_type: t });
  }

  function fetchMockSubject(id) {
    return apiSubjectFace(id, mockExamType());
  }

  function collectMockWrong() {

    if (mockCollecting) { mockStatus('这一轮还在补题面，等它跑完再点。'); return; }
    var examId = mockExamIdOf();
    var items = mockSheetItems();
    if (!items.length) { mockStatus('这一页还没有题目列表：先进「全部解析」或「错题解析」再收。'); return; }
    var wrongAll = items.filter(function (it) { return it.result === 0; });
    var need = wrongAll.filter(function (it) {
      var cur = store.mockQs[String(it.id)];
      return !(cur && cur.content);
    }).slice(0, MOCK_COLLECT_CAP);
    if (!need.length) {
      mockStatus('本场答错 <b>' + wrongAll.length + '</b> 题，题面都已收录，不用补。');
      return;
    }
    mockCollecting = true;
    var allBtn = $('#gth-mock-all');
    if (allBtn) allBtn.disabled = true;
    var doneN = 0, okN = 0, failN = 0, i = 0, batch = [], firstErr = '';
    function flush() { if (batch.length) { mergeMockQs(batch, examId); batch = []; } }
    function step() {
      if (i >= need.length) {
        flush();
        mockCollecting = false;
        if (allBtn) allBtn.disabled = false;
        mocksScanTick();
        mockStatus('补题面结束：成功 <b>' + okN + '</b> 题，失败 <b>' + failN + '</b> 题。' +
          (firstErr ? '<br>首个失败原因：' + esc(firstErr) : '答错的已并入错题本，回错题页即可导出 / 重练。'));
        return;
      }
      var it = need[i++];
      fetchMockSubject(it.id).then(function (data) {

        var raw = Object.assign({}, data || {}, {
          result: it.result, userAnswers: it.userAnswers, examPointName: it.examPointName
        });
        var q = mockFieldMap(raw);
        if (q) { batch.push(q); okN++; } else { failN++; if (!firstErr) firstErr = '题目形状不符（缺题干或答案）'; }
      })['catch'](function (e) {
        failN++;
        if (!firstErr) firstErr = (e && e.message) || String(e);
      }).then(function () {
        doneN++;
        if (batch.length >= 10) flush();
        mockStatus('正在补题面 ' + doneN + ' / ' + need.length + '（失败 ' + failN + '）…');
        setTimeout(step, 180);
      });
    }
    step();
  }

  var mockPanelBuilt = false;

  function buildMocksUI() {
    if (mockPanelBuilt) return;
    mockPanelBuilt = true;
    GM_addStyle([

      '#gth-mock-btn{position:fixed;right:18px;bottom:18px;z-index:100000;display:flex;align-items:center;gap:7px;',
      'height:var(--gth-ctl-h,38px);padding:0 16px;border-radius:999px;',
      'background:var(--gth-primary,#0f172a);color:var(--gth-primary-fg,#f8fafc);font-size:13px;font-weight:600;',
      'cursor:pointer;box-shadow:0 4px 16px rgba(15,23,42,.25);user-select:none;}',
      '#gth-mock-btn:hover{background:var(--gth-primary-hover,#1e293b);}',
      '#gth-mock-btn .gth-ic svg{width:15px;height:15px;}',
      '#gth-mock-panel{position:fixed;right:18px;bottom:66px;z-index:100001;width:268px;background:var(--gth-bg,#fff);',
      'color:var(--gth-fg,#0f172a);border:1px solid var(--gth-border,#e2e8f0);border-radius:8px;',
      'box-shadow:0 12px 40px rgba(15,23,42,.18);padding:14px;font-size:13px;line-height:1.6;}',
      '#gth-mock-panel .gthm-head{display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:8px;}',
      '#gth-mock-panel .gthm-head .gth-ic svg{width:16px;height:16px;}',
      '#gth-mock-panel #gth-mock-close{margin-left:auto;border:0;background:none;cursor:pointer;',
      'color:var(--gth-muted,#64748b);display:flex;padding:2px;border-radius:6px;}',
      '#gth-mock-panel #gth-mock-close:hover{background:var(--gth-hover,#f1f5f9);}',
      '#gth-mock-panel #gth-mock-close .gth-ic svg{width:14px;height:14px;}',
      '#gth-mock-panel .gthm-status{background:var(--gth-subtle,#f8fafc);border:1px solid var(--gth-border,#e2e8f0);',
      'border-radius:8px;padding:8px 10px;margin-bottom:10px;}',
      '#gth-mock-panel .gthm-status b{font-weight:600;}',
      '#gth-mock-panel .gthm-btn{width:100%;height:var(--gth-ctl-h,38px);display:flex;align-items:center;justify-content:center;',
      'gap:6px;border:1px solid var(--gth-border-strong,#cbd5e1);background:var(--gth-bg,#fff);color:var(--gth-fg,#0f172a);',
      'border-radius:var(--gth-ctl-r,8px);cursor:pointer;font-size:13px;}',
      '#gth-mock-panel .gthm-btn:hover{background:var(--gth-hover,#f1f5f9);}',
      '#gth-mock-panel .gthm-btn:disabled{opacity:.5;cursor:not-allowed;background:var(--gth-bg,#fff);}',
      '#gth-mock-panel .gthm-btn .gth-ic svg{width:14px;height:14px;}',
      '#gth-mock-panel .gthm-hint{margin-top:10px;font-size:12px;color:var(--gth-muted,#64748b);}'
    ].join('\n'));

    var btn = document.createElement('div');
    btn.id = 'gth-mock-btn';
    btn.innerHTML = icon('bookOpen') + '<span>模考收录</span>';
    var panel = document.createElement('div');
    panel.id = 'gth-mock-panel';
    panel.hidden = true;
    panel.innerHTML = [
      '<div class="gthm-head">' + icon('bookOpen') + '<b>全真模考收录</b>',
      '<button id="gth-mock-close" title="收起">' + icon('x') + '</button></div>',
      '<div id="gth-mock-status" class="gthm-status">正在检测页面…</div>',
      '<button id="gth-mock-all" class="gthm-btn">' + icon('download') + '收齐全场答错题</button>',
      '<button id="gth-mock-scan" class="gthm-btn" style="margin-top:6px">重新扫描本页</button>',
      '<div class="gthm-hint">站点的解析页只把「当前这一题」的题面加载出来，答错的题要靠上面那个按钮逐题补齐（走站点自己的题目解析接口）。不点的话，翻到哪题收哪题。收录后回错题页即可导出 / 重练。</div>'
    ].join('');
    document.body.appendChild(btn);
    document.body.appendChild(panel);
    btn.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) mocksScanTick();
    });
    $('#gth-mock-close', panel).addEventListener('click', function () { panel.hidden = true; });
    $('#gth-mock-scan', panel).addEventListener('click', mocksScanTick);
    $('#gth-mock-all', panel).addEventListener('click', collectMockWrong);
  }

  function mocksScanTick() {
    if (!isMocksPage()) return;
    buildMocksUI();
    var examId = mockExamIdOf();
    var list = harvestFromScope(document);
    if (!list.length) list = mockSniffed();
    var r = list.length ? mergeMockQs(list, examId) : null;
    var total = 0, wrong = 0;
    Object.keys(store.mockQs).forEach(function (k) {
      total++;
      if (store.mockQs[k].done && !store.mockQs[k].ok) wrong++;
    });
    var st = $('#gth-mock-status');
    if (st) {
      st.innerHTML = (examId ? '场次 #' + esc(examId) : '未识别场次（仍可收录）') +
        '<br>已收录 <b>' + total + '</b> 题 · 错题 <b>' + wrong + '</b> 题' +
        (r && r.added ? '<br>本次新增 ' + r.added + ' 题（错题 ' + r.wrongNew + '）' : '') +
        (list.length ? '' : '<br>本页暂未检测到题目，进入解析页后再试');
    }
  }

  function isZyPage() { return /\/wxpage\/tiku\/gongan\/zhuanxiang\.html$/.test(location.pathname); }

  function zyUrlSubmitted() {
    var s = new URLSearchParams(location.search);
    return s.get('status') === 'finished' && !!s.get('submit_id');
  }

  function zyScopeSubmitted() {
    var ng = getAngular();
    if (!ng) return false;
    var root;
    try { root = ng.element(document.querySelector('[ng-view]') || document.body).scope(); } catch (e) { return false; }
    if (!root) return false;
    while (root.$parent) root = root.$parent;
    var hit = false, seen = 0;
    (function walk(sc, d) {
      if (!sc || d > 14 || hit || seen++ > 400) return;
      if (sc.isAlreadySubmit === true) { hit = true; return; }
      var kid = sc.$$childHead;
      while (kid) { walk(kid, d + 1); if (hit) return; kid = kid.$$nextSibling; }
    })(root, 0);
    return hit;
  }

  function analysisReady() {
    return isZyPage() && zyUrlSubmitted() && zyScopeSubmitted();
  }

  function isZyAnalysis() { return isZyPage() && analysisReady(); }

  var zyGateWarned = false;
  function zyGateWarn() {
    if (zyGateWarned || !isZyPage() || !zyUrlSubmitted()) return;
    zyGateWarned = true;
    console.warn('[错题助手] 专项页 URL 说是交卷态，但 scope 上没等到 isAlreadySubmit，本页先不挂笔记入口');
  }

  function analysisNodeVar(node) {
    var attr = node.getAttribute('ng-repeat') || node.getAttribute('data-ng-repeat') || '';
    var m = /^\s*([A-Za-z_$][\w$]*)\s+in\s+(.+?)\s*$/.exec(attr);
    if (!m) return null;
    var name = m[1], src = m[2].replace(/\s+/g, '');
    if (name === 'subjectObj' && /currentPartData\.subjectList$/.test(src)) return name;
    return null;
  }

  function analysisScopeItem(sc, name) {
    if (!sc || !name) return null;
    var it = sc[name];
    if (!it || typeof it !== 'object' || !looksLikeQuestion(it)) return null;
    return it;
  }

  function analysisNodes() {
    var ng = getAngular(), out = [];
    if (!ng) return out;
    $$('[ng-repeat],[data-ng-repeat]').forEach(function (node) {
      var name = analysisNodeVar(node);
      if (!name) return;
      var sc = null;
      try { sc = ng.element(node).scope(); } catch (e) { return; }
      var it = analysisScopeItem(sc, name);
      if (!it) return;
      out.push({ node: node, item: it });
    });
    return out;
  }

  function bindHlRows(scopeEl, id) {
    $$('.gth-hlp-item .rm', scopeEl).forEach(function (rm) {
      rm.addEventListener('click', function () {
        hlRemove(id, Number(rm.closest('.gth-hlp-item').dataset.hl));
        toast('已取消划线');
        afterHlChange();
      });
    });
    $$('.gth-hlp-item .t, .gth-hlp-item .n', scopeEl).forEach(function (node) {
      node.addEventListener('click', function () {
        openHlNote(id, Number(node.closest('.gth-hlp-item').dataset.hl), node.getBoundingClientRect());
      });
    });
  }

  // 笔记编辑区：预览态（正文 + 「编辑」）与编辑态（文本框 + 「保存 / 取消」）两段 HTML；
  // 两态的切换自己重画自己那一小块，不牵连外面的卡片与浮窗。解析页那扇浮窗与重练报告的卡片笔记
  // 共用这一份（2026-10-08 用户口径：编辑模式要有保存、取消；写了才知道存没存的那套不收）。
  function noteAreaHtml(id, mode) {
    if (mode === 'edit') {
      return '<textarea placeholder="写下你的思路…（本题整体笔记）" data-note="' + esc(id) + '">' +
        esc(getNote(id)) + '</textarea>' +
        '<div class="gth-note-act">' +
        '<button class="gth-mini primary" data-act="save">' + icon('check') + '保存</button>' +
        '<button class="gth-mini" data-act="cancel">取消</button></div>';
    }
    var text = getNote(id);
    if (!text) return '<div class="gth-note-empty" data-act="edit">＋ 添加笔记</div>';
    return '<div class="gth-note-text">' + esc(text) + '</div>' +
      '<div class="gth-note-act"><button class="gth-mini" data-act="edit">' +
      icon('pencil') + '编辑</button></div>';
  }

  function noteExcerpt(id) {
    var s = snapOf(id), raw = itemsById[id];
    return stripHtml((s && s.content) || (raw && raw.content) || '').slice(0, 240);
  }

  function bindNoteArea(el) {
    var id = String(el.getAttribute('data-note-area'));
    var subj = el.getAttribute('data-subj');
    function paint(mode) {
      el.setAttribute('data-mode', mode);
      el.innerHTML = noteAreaHtml(id, mode);
      bindNoteArea(el);
      var ta = $('[data-note]', el);
      if (ta) ta.focus();
    }
    var ed = $('[data-act="edit"]', el);
    if (ed) ed.addEventListener('click', function () { paint('edit'); });
    var ta = $('[data-note]', el);
    if (!ta) return;
    $('[data-act="save"]', el).addEventListener('click', function () {
      setNote(id, ta.value.trim(), {
        snapshot: noteExcerpt(id),
        subject: subj == null || subj === '' ? undefined : Number(subj)
      });
      refreshBadges();
      paint('view');
    });
    $('[data-act="cancel"]', el).addEventListener('click', function () { paint('view'); });
  }

  function bindNoteAreas(root) { $$('[data-note-area]', root).forEach(bindNoteArea); }

  // 笔记面板只有一扇门：小条上那颗「笔记」键。开着的再点一次是收起，点空白处也收起；
  // 编辑态下这两条都等于「取消」，草稿不写库（2026-10-08 用户口径）。
  function closeAbarPanel(box) {
    if (box && box.parentNode) box.parentNode.removeChild(box);
  }

  function toggleAbarNote(bar, id) {
    var box = $('.gth-apanel', bar);
    if (box) { closeAbarPanel(box); return; }
    openAbarPanel(bar, String(id), getNote(id) ? 'view' : 'edit');
  }

  document.addEventListener('mousedown', function (e) {
    var box = $('.gth-apanel');
    if (!box) return;
    var t = e.target;
    if (t && t.closest && (t.closest(HL_BLOCK_SEL) || t.closest('#gth-hlnote,#gth-hlmenu'))) return;
    closeAbarPanel(box);
  }, true);

  function abarHtml(id, unit) {
    var hls = countHighlights(id);
    var got = !!(store.snaps[id] || store.mockQs[id]);
    var isMat = !!unit;
    var sec = qtimeSec(unit || id);
    return '<button class="gth-btn sm" data-act="note" title="写 / 改这道题的笔记">' +
        icon('pencil') + '笔记</button>' +
      '<button class="gth-btn sm" data-act="copy">' + icon('copy') + '复制题目</button>' +
      '<button class="gth-btn sm" data-act="collect">' + icon('highlighter') + '整理本题</button>' +
      '<span class="gth-abar-tag' + (got ? '' : ' off') + '" title="这道题的题面快照在不在本机补充题本里">' +
        (got ? icon('check') + '已收录' : icon('warn') + '未收录') + '</span>' +
      (hls ? '<span class="gth-abar-tag">' + icon('highlighter') + hls + ' 划</span>' : '') +
      (sec ? '<span class="gth-abar-tag" title="' +
        (isMat ? '这一段材料的用时，材料内各小题共用这一份账' : '这一题的做题用时，本机记的') + '">' +
        icon('clock') + (isMat ? '本材料 ' : '') + qtimeText(sec) + '</span>' : '');
  }

  function abarPanelHtml(id, mode) {
    return '<div class="gth-apanel-h">' + icon('pencil') + '笔记' +
        '<span class="sp"></span>' +
        '<button class="gth-btn ghost sm" data-act="close" title="收起（点空白处也会收起）">' +
        icon('x') + '收起</button></div>' +
      '<div class="gthq-hls" data-hls="' + esc(id) + '"></div>' +
      '<div class="gth-note-area" data-note-area="' + esc(id) + '"' +
        ' data-mode="' + (mode === 'edit' ? 'edit' : 'view') + '">' +
      noteAreaHtml(id, mode) + '</div>';
  }

  function abarSig(id, unit) {
    var isMat = !!unit;
    return String(id) + '|' + (store.notes[id] ? 1 : 0) + '|' + countHighlights(id) +
      '|' + ((store.snaps[id] || store.mockQs[id]) ? 1 : 0) + '|' +
      (isMat ? 'M' + qtimeSec(unit) : qtimeSec(id));
  }

  function bindAbar(bar, node, id, unit) {
    bar.setAttribute('data-sig', abarSig(id, unit));
    bar.innerHTML = abarHtml(id, unit);
    $('[data-act="note"]', bar).addEventListener('click', function () { toggleAbarNote(bar, id); });
    $('[data-act="collect"]', bar).addEventListener('click', function () { openCollect([String(id)]); });
    $('[data-act="copy"]', bar).addEventListener('click', function () {
      var q = snapOf(id) || (itemsById[id] ? snapCopy(itemsById[id]) : null);
      if (q) copyWithToast(copyQuestion(q));
      else toast('复制失败：这道题的题面还没补回来');
    });
  }

  function openAbarPanel(bar, id, mode) {
    if (!bar) return;
    id = String(id);
    if (mode !== 'edit' && mode !== 'view') mode = getNote(id) ? 'view' : 'edit';
    var box = $('.gth-apanel', bar);
    if (!box) {
      box = document.createElement('div');
      box.className = 'gth-apanel';
      bar.appendChild(box);
    }
    box.innerHTML = abarPanelHtml(id, mode);
    refreshQuizHl();
    bindHlRows(box, id);
    bindNoteAreas(box);
    var cl = $('[data-act="close"]', box);
    if (cl) cl.addEventListener('click', function () { closeAbarPanel(box); });
    var ta = $('[data-note]', box);
    if (ta) ta.focus();
  }

  var analysisLogTag = '';

  var QTIME_KEY = 'gth_qtime_' + CTX;
  var qtimeErr = '';

  function qtimeExamId() {
    var out = '';
    try {
      out = new URLSearchParams(location.search).get('exam_id') || '';
      var h = String(location.hash || '');
      var i = h.indexOf('?');
      var fromHash = i < 0 ? '' : new URLSearchParams(h.slice(i + 1)).get('exam_id');
      if (fromHash) out = fromHash;
    } catch (e) { qtimeErr = '读不出场次号：' + (e && e.name ? e.name : String(e)); }
    return out || '';
  }

  function qtimeAll() {
    var raw = '';
    try { raw = localStorage.getItem(QTIME_KEY) || ''; }
    catch (e) { qtimeErr = '用时记录读不出（当作没有）：' + (e && e.name ? e.name : String(e)); return {}; }
    if (!raw) return {};
    try { return JSON.parse(raw) || {}; }
    catch (e) { qtimeErr = '用时记录不是合法 JSON（当作没有）'; return {}; }
  }

  function qtimeSession() {
    var id = qtimeExamId();
    if (!id) return null;
    var all = qtimeAll();
    var r = all[id];
    return r && typeof r === 'object' ? r : null;
  }

  function qtimeSec(qid) {
    var r = qtimeSession();
    if (!r || !r.q) return 0;
    var v = r.q[String(qid)];
    return typeof v === 'number' && v > 0 ? v : 0;
  }

  function qtimeText(s) {
    if (!(s > 0)) return '--:--';
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    return (h ? pad2(h) + ':' : '') + pad2(m) + ':' + pad2(sec);
  }

  function qtimeOrder() {
    var ng = getAngular(), out = [];
    if (!ng) return out;
    var nodes = analysisNodes();
    if (!nodes.length) return out;
    var sc;
    try { sc = ng.element(nodes[0].node).scope(); }
    catch (e) { qtimeErr = '题目节点上取不到 scope，用题号顺序兜底'; return out; }
    var ls = sc && sc.localStorage;
    var list = ls && ls.currentPartData && ls.currentPartData.subjectList;
    if (!list || !list.length) { qtimeErr = '这一页没给出题目顺序，用题号顺序兜底'; return out; }
    list.forEach(function (it) {
      if (!it || !(it.id || it.id === 0)) return;
      var mat = it.opts && it.opts.length > 1 ? it.opts : null;
      out.push({
        id: String(it.id), no: it.index,
        from: mat ? mat[0].index : null,
        to: mat ? mat[mat.length - 1].index : null,
        size: mat ? mat.length : 1
      });
    });
    return out;
  }

  function qtimeRows(r) {
    var order = qtimeOrder(), out = [], seen = {};
    order.forEach(function (o) {
      var s = r.q && r.q[o.id] || 0;
      if (!s) return;
      seen[o.id] = 1;
      out.push({ id: o.id, no: o.no, from: o.from, to: o.to, size: o.size, sec: s });
    });
    Object.keys(r.q || {}).forEach(function (k) {
      if (seen[k] || !(r.q[k] > 0)) return;
      out.push({ id: k, no: null, from: null, to: null, size: 1, sec: r.q[k] });
    });
    if (!order.length) out.sort(function (a, b) { return Number(a.id) - Number(b.id); });
    return out;
  }

  function recapSig(r) {
    var parts = [];
    Object.keys(r.q || {}).forEach(function (k) { parts.push(k + ':' + r.q[k]); });
    return parts.join(',') + '|' + (r.paused || 0) + '|' + (r.lost || 0) + '|' + (r.merged || 0);
  }

  function qtimeBandHtml(r) {
    var rows = qtimeRows(r);
    var done = 0, cover = 0, mats = 0;
    rows.forEach(function (x) {
      done += x.sec;
      cover += x.size;
      if (x.from != null) mats++;
    });
    var count = mats ? cover + ' 题 · ' + mats + ' 段材料' : cover + ' 题';
    var html = '<button class="gth-btn ghost sm gth-qtime-h" data-act="qtime-toggle">' +
      icon('clock') + '本场做题用时 ' + qtimeText(done) + '（' + count + '）' +
      '<span class="gth-qtime-caret">' + icon('chevronDown') + '</span></button><div class="gth-qtime-panel">';
    rows.forEach(function (x) {
      var no = x.from != null ? '第 ' + esc(x.from) + '–' + esc(x.to) + ' 题'
        : (x.no == null ? '题 ' + esc(x.id) : '第 ' + esc(x.no) + ' 题');
      html += '<div class="gth-qtime-row" data-qid="' + esc(x.id) + '">' +
        '<span class="n">' + no + '</span>' +
        '<span class="s">' + qtimeText(x.sec) + '</span></div>';
    });
    return html + '</div>';
  }

  var qtimeLogTag = '';
  function qtimeSay(what) {
    if (qtimeLogTag === what) return;
    qtimeLogTag = what;
    console.log('[错题助手] 用时：' + what);
  }

  function zyTopHost(node) {
    var box = node && node.closest ? node.closest('.question-box') : null;
    if (box) return box;
    if (node && node.parentNode) {
      qtimeSay('这一屏没有 .question-box，用时入口退到题目节点的父容器');
      return node.parentNode;
    }
    qtimeSay('这一屏没找到题目节点，不挂用时入口');
    return null;
  }

  function zyTopBar(host) {
    var top = $('[data-gth-ztop]', host);
    if (!top) {
      top = document.createElement('div');
      top.className = 'gth-ztop';
      top.setAttribute('data-gth-ztop', '1');
      host.insertBefore(top, host.firstChild);
    }
    return top;
  }

  function mountQtimeBand(host) {
    if (!host) return;
    var top = zyTopBar(host);
    var r = qtimeSession();
    var band = $('[data-gth-qtime]', top);
    if (!r) {
      if (band) band.remove();
      qtimeSay('场次 ' + (qtimeExamId() || '未识别') + ' 本机没有计时记录，这一页不挂用时入口');
      return;
    }
    var sig = qtimeExamId() + '|' + recapSig(r);
    if (band && band.getAttribute('data-sig') === sig) return;
    if (!band) {
      band = document.createElement('div');
      band.className = 'gth-qtime';
      band.setAttribute('data-gth-qtime', '1');
      top.insertBefore(band, top.firstChild);
    }
    band.setAttribute('data-sig', sig);
    band.innerHTML = qtimeBandHtml(r);
    qtimeSay('已挂上，场次 ' + qtimeExamId() + ' 记到 ' + qtimeRows(r).length + ' 题');
    var btn = $('[data-act="qtime-toggle"]', band);
    if (btn) btn.addEventListener('click', function () {
      band.classList.toggle('on');
    });
  }

  // 点空白收起：与解析页那扇笔记浮窗同一口径。只由那颗键收回的话，展开的卡片就赖在屏幕右上角，
  // 用户点到哪儿都收不掉（2026-10-09 报的「卡片展开后无法收回」）
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.closest && t.closest('.gth-qtime')) return;
    $$('.gth-qtime.on').forEach(function (b) { b.classList.remove('on'); });
  }, true);

  // 材料组卷面（资料分析）：答题态一屏摊的是整段材料，导航只在材料首题号之间跳，
  // 所以账按材料记、键落在材料首题 id 上；展示端认出 opts 有多个小题就写区间，
  // 不拆分也不均摊（ADR 0007 决策 8）。非材料组卷面下每题自己就是一个单位。
  function unitIdOf(it) {
    var opts = it && it.opts;
    if (!opts || opts.length < 2) return '';
    var head = opts[0];
    if (!head || !(head.id || head.id === 0)) return '';
    return String(head.id);
  }

  function injectAnalysisUI() {
    if (!analysisReady()) { zyGateWarn(); return 0; }
    var n = 0, first = null, curId = '', curUnit = '';
    analysisNodes().forEach(function (e) {
      var node = e.node, it = e.item;
      var id = String(pickKey(it, MOCK_QID_KEYS));
      itemsById[id] = snapCopy(it);
      qNodes[id] = node;
      n++;
      if (!first) { first = node; curId = id; curUnit = unitIdOf(it); }
      if (node.getAttribute('data-gth-qid') !== id) node.setAttribute('data-gth-qid', id);
    });
    var host = zyTopHost(first);
    if (host) {
      var top = zyTopBar(host);
      var bar = $('.gth-abar', top);
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'gth-abar';
        top.appendChild(bar);
      }
      if ($('.gth-apanel', bar)) {
        /* 笔记浮窗开着：不重画小条，重写会把正在编辑的框抹掉 */
      } else if (bar.getAttribute('data-sig') !== abarSig(curId, curUnit)) {
        bindAbar(bar, first, curId, curUnit);
      }
      mountQtimeBand(host);
    }
    if (analysisLogTag !== String(n)) {
      analysisLogTag = String(n);
      console.log('[错题助手] 专项解析页绑上题目 ' + n + ' 个');
    }
    repaintHighlights();
    return n;
  }

  function initMocksUI() {
    hookXhrSniffer();
    buildMocksUI();
    syncKeyTargets();
    mocksScanTick();
    console.log('[错题助手] 模考助手已注入' + (mockSniffHooked ? '（嗅探已挂）' : '') + '：' + location.href);
  }

  document.addEventListener('keydown', function (e) {
    if (quizEl.hidden) return;
    if (e.key === 'Escape') { closeQuiz(); return; }
    if (e.key === 'F4' || e.key === 'F5') { e.preventDefault(); stepIdx(e.key === 'F4' ? -1 : 1); return; }
    if (e.key === 'ArrowLeft') stepIdx(-1);
    if (e.key === 'ArrowRight') stepIdx(1);
  });

  function syncRouteClass() {
    document.body.classList.toggle('gth-error', isListRoute());
    syncSourceDefault();
  }
  window.addEventListener('hashchange', function () {
    syncRouteClass();
    invalidateLoaded();

    if (!isListRoute() && (viewOn || bookViewOn)) { setView(false); setBookView(false); }
    refreshPageUI();
  });

  if (isMocksPage()) {
    initMocksUI();
    return;
  }
  if (isZyPage()) {
    syncKeyTargets();
    injectAnalysisUI();
    return;
  }
  if (!getToken()) {
    setStatus('未检测到登录 token，请先登录站点后再使用。', 'err');
  }

  injectListUI();
  injectMenuEntry();
  syncRail();
  syncKeyTargets();

  syncRouteClass();
  renderPracticeSrc();
  syncFilterUI();
  renderHistory();
  updateExportHint();
  } catch (e) {
    console.warn('[机考助手] 初始化失败：' + (e && e.message ? e.message : String(e)));
  }
})();
