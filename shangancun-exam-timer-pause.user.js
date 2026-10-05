// ==UserScript==
// @name         上岸村机考系统 · 考试计时暂停
// @namespace    http://tampermonkey.net/
// @version      1.0.6
// @description  为上岸村机考系统的专项练习 / 全真模拟加一个「暂停计时 / 继续计时」键。暂停后剩余时间、已用时间、各版块剩余时间全部冻结，不会自动交卷、不会自动跳到下一版块，可以放心离开处理别的事，回来点「继续计时」即可接着考。暂停状态按 submit_id 记住，中途关掉标签页再进来仍是暂停的。
// @author       烨笙
// @match        https://pub.xdtech.top/mingshi/wxpage/tiku/gongan/zhuanxiang.html*
// @match        https://pub.xdtech.top/*/wxpage/tiku/gongan/zhuanxiang.html*
// @match        https://pub.xdtech.top/mingshi/wxpage/tiku/gongan/practice.html*
// @match        https://pub.xdtech.top/*/wxpage/tiku/gongan/practice.html*
// @include      *://*.xdtech.top/*/wxpage/tiku/gongan/zhuanxiang.html*
// @include      *://*.xdtech.top/*/wxpage/tiku/gongan/practice.html*
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  var CSS = [
    // 站点 .remain-time 固定 200px，塞下按钮会被挤，放开由内容决定
    '.remain-time{width:auto!important}',
    '.gth-timer-btn{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 10px;margin-left:8px;',
    'border:1px solid rgba(255,255,255,.55);border-radius:5px;background:rgba(255,255,255,.16);',
    'color:#fff;font-size:13px;line-height:1;cursor:pointer;vertical-align:middle;user-select:none}',
    '.gth-timer-btn:hover{background:rgba(255,255,255,.32)}',
    '.gth-timer-btn>svg{width:12px;height:12px;flex:0 0 auto}',
    '.gth-timer-btn.paused{background:#f59e0b;border-color:#f59e0b}',
    '.gth-timer-btn.paused:hover{background:#d97706}',
    // 暂停时把时间染成琥珀色并补一句提示（用伪元素，不去改站点 ng-bind 的文本）
    '.remain-time.gth-paused a{color:#fde68a}',
    '.remain-time.gth-paused a::after{content:"（已暂停）";font-size:13px}'
  ].join('');

  var ICON = {
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    play: '<path d="M7 4.5v15a1 1 0 0 0 1.54.84l11.5-7.5a1 1 0 0 0 0-1.68L8.54 3.66A1 1 0 0 0 7 4.5z"/>'
  };
  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">' + ICON[name] + '</svg>';
  }

  // 站点计时器是纯前端的：$scope.allInterval = $interval(function(){ totalTime-- ... }, 1000)。
  // 拿不到它注册时的那个函数，所以不去 cancel 计时器，而是给「时间字段」装阀门：
  // 暂停期间写入一律忽略、读出来还是暂停那一刻的值 —— 计时器照跑，但时间不动。
  var VER = '1.0.6';

  var paused = false;
  var scope = null;
  var restored = false;

  var SID = '';
  try { SID = new URLSearchParams(location.search).get('submit_id') || ''; } catch (e) {}
  var LS_KEY = 'gth_timer_paused_' + (SID || location.pathname);

  function store(v) {
    try {
      if (v) localStorage.setItem(LS_KEY, '1');
      else localStorage.removeItem(LS_KEY);
    } catch (e) {}
  }
  function stored() {
    try { return localStorage.getItem(LS_KEY) === '1'; } catch (e) { return false; }
  }

  // 给 obj.key 装阀门（幂等；已装过的 getter 直接跳过，不重复 defineProperty）
  function guard(obj, key) {
    if (!obj || typeof obj !== 'object' || !(key in obj)) return;
    var d = Object.getOwnPropertyDescriptor(obj, key);
    if (!d || !d.configurable || d.get) return;
    var cur = obj[key];
    Object.defineProperty(obj, key, {
      configurable: true,
      enumerable: true,
      get: function () { return cur; },
      set: function (v) { if (!paused) cur = v; }
    });
  }

  // $rootScope 往下找「自有时钟字段」的控制器 scope：ng-repeat 的子 scope 是原型继承来的，
  // 只有 hasOwnProperty 命中的才是真持有者。
  function eachTimerScope(fn) {
    var root;
    try { root = window.angular.element(document.body).injector().get('$rootScope'); } catch (e) { return; }
    var seen = new WeakSet();
    (function walk(s) {
      if (!s || seen.has(s)) return; seen.add(s);
      if (Object.prototype.hasOwnProperty.call(s, 'localStorage') && s.localStorage &&
        typeof s.localStorage === 'object' && ('allInterval' in s || 'partInterval' in s)) fn(s);
      for (var c = s.$$childHead; c; c = c.$$nextSibling) walk(c);
    })(root);
  }

  // 装阀门（幂等）。暂停期间每秒都会重跑一次：
  // partData / detail_elapsed_time 里的条目可能是开考后才建出来的，只装一次会漏。
  // 同时扫描**所有** own-localStorage scope 一起装：万一脚本锁定的 scope 不是真控制器
  // （例如 ng-view 替换、ng-if 切到另一个 controller），也得让真控制器一起冻结。
  function installGuards() {
    var scopes = [];
    if (scope) scopes.push(scope);
    try {
      eachTimerScope(function (s) { scopes.push(s); });
    } catch (e) {}
    var seenS = new WeakSet();
    scopes.forEach(function (s) {
      if (!s || seenS.has(s)) return; seenS.add(s);
      var ls = s.localStorage || {};
      guard(ls, 'totalTime');
      guard(ls, 'elapsed_time');
      (ls.partData || []).forEach(function (p) {
        guard(p, 'remainTime');
        guard(p, 'elapsed_time');
      });
      Object.keys(s.detail_elapsed_time || {}).forEach(function (k) {
        guard(s.detail_elapsed_time, k);
      });
    });
  }

  function applyPause(on) {
    paused = on;
    if (on) {
      installGuards();
      freezeDom(true);     // 显示层兜底：阀门万一没装上，界面也停住
    } else {
      freezeDom(false);
    }
    store(on);
    render();
  }

  function btn() { return document.querySelector('.gth-timer-btn'); }

  var lastSig = '';
  function render() {
    var b = btn();
    if (!b) return;
    var sig = (paused ? '1' : '0') + (b.parentNode ? b.parentNode.className : '');
    if (sig === lastSig) return;   // 每秒心跳也别无谓重写 DOM
    lastSig = sig;
    b.className = 'gth-timer-btn' + (paused ? ' paused' : '');
    b.innerHTML = icon(paused ? 'play' : 'pause') +
      '<span>' + (paused ? '继续计时' : '暂停计时') + '</span>';
    // title 里带版本号：鼠标悬停就能确认装的是哪一版（本地脚本 Tampermonkey 不会自动更新）
    b.title = (paused ? '已暂停，计时不会走（点击继续）' : '暂停后计时停止，可以放心离开') +
      '  ·  v' + VER;
    if (b.parentNode) b.parentNode.classList.toggle('gth-paused', paused);
  }

  function ensureBtn() {
    var host = document.querySelector('.operation-dati .remain-time') ||
      document.querySelector('.remain-time');
    if (!host) return;
    if (host.querySelector('.gth-timer-btn')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'gth-timer-btn';
    // v1.0.5：按钮永远可点。之前「没开跑就禁用」的设计让用户连着三次以为脚本坏了。
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      applyPause(!paused);
    });
    host.appendChild(b);
    lastSig = '';
  }

  // 界面兜底冻结：万一找不到 scope / 阀门没生效，至少让显示的时间停住，
  // 用户点下去能立刻看到反馈，不会觉得「点了没反应」。
  //
  // ★ 严禁写 a.textContent —— 那个 <a> 里是 AngularJS 的 {{allTime}} 插值，
  // Angular 持有一个 Text 节点的引用、每次 digest 只改它的 nodeValue。
  // 用 textContent 覆盖会把该节点整体换掉，Angular 从此往脱离文档的节点里写，
  // 界面永久停在暂停那一刻 —— v1.0.5 的「点了继续也不走」就是这么来的。
  // 正确做法：原地改 nodeValue，节点身份保持不变。
  var frozenText = '';
  var domTimer = null;

  function timeTextNode() {
    var a = document.querySelector('.remain-time a');
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
    return null;   // 实在找不到就别硬写，宁可不冻结也不能毁掉绑定
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

  // 从界面上读当前剩余秒数。专项练习是「剩余时间：hh:mm:ss」，
  // 全真模拟是「用时：hh:mm:ss/hh:mm:ss」，取第一个 hh:mm:ss。
  function domSeconds() {
    var a = document.querySelector('.remain-time a');
    var t = a ? (a.textContent || '') : '';
    var m = t.match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) return -1;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  }

  // 从 $rootScope 往下找跑计时的那个控制器 scope。
  // 候选条件（结构）：scope 必须自有 localStorage（ng-repeat 子 scope 是原型继承来的，
  // 实测全真模拟页有一堆假目标）+ 上有 allInterval / partInterval。
  // 选谁：优先选 **totalTime 与界面秒数吻合** 的那个 —— 界面上显示多少秒，
  // 真控制器的 totalTime 就是多少，这是唯一不会骗人的锚点。
  // 界面读不到秒数时退化为「挑 totalTime 最大的」（占位 10 / 60 永远小于真实值）。
  function findScope() {
    if (!window.angular) return null;
    var want = domSeconds();
    var best = null;
    var bestScore = -1;
    eachTimerScope(function (s) {
      var t = s.localStorage.totalTime;
      var score = 0;
      if (typeof t === 'number') {
        if (want >= 0 && Math.abs(t - want) <= 2) score = 1e6;       // 与界面完全吻合
        else if (want >= 0) score = 1e5 - Math.min(Math.abs(t - want), 9999);
        else score = t;                                              // 读不到界面就取最大
      }
      if (score > bestScore) { best = s; bestScore = score; }
    });
    return best;
  }

  // v1.0.5 起：不再用「是否在跑」去禁用按钮。
  // 之前三个版本都栽在这上面——界面在走、按钮却是禁用的，用户只会认为脚本坏了。
  // 判据留着只是用于「恢复上次暂停态」的时机，不再影响能不能点。
  var running = false;
  var lastTotal = -1;
  function live() {
    var s = scope;
    var t = (s && s.localStorage) ? s.localStorage.totalTime : -1;
    if (s && lastTotal >= 0 && typeof t === 'number' && t < lastTotal) running = true;
    lastTotal = typeof t === 'number' ? t : -1;
    var parentAllTime = s && s.$parent && typeof s.$parent.allTime === 'string' ? s.$parent.allTime : '';
    var remainText = '';
    var a = document.querySelector('.remain-time a');
    if (a) remainText = a.textContent || '';
    // 全真模拟页里是「用时：xx/yy」，专项练习里是「剩余时间：xx」；都按 mm:ss 提取。
    // 出现 mm:ss 且第二个不为 00:00:00 即视为在跑。
    var m = remainText.match(/(\d{1,2}:\d{2}:\d{2})/g);
    var domLive = false;
    if (m && m.length) {
      // 第一个时间字段（专项：「剩余时间」；全真：「用时 xx/yy」前段；任一非 00:00:00 即可）
      domLive = m.some(function (seg) { return seg !== '00:00:00'; });
    }
    return running || !!(s && s.allInterval) ||
      (typeof t === 'number' && t > 60) ||
      (parentAllTime && parentAllTime.length > 0 && !/00:00:00/.test(parentAllTime)) ||
      domLive;
  }

  function tick() {
    var s = findScope();
    if (s !== scope) {   // 站点可能换控制器 / 换 localStorage
      scope = s;
      restored = false;
      running = false;
      lastTotal = -1;
    }
    if (scope && scope.$$destroyed) { scope = null; restored = false; }
    if (!document.querySelector('.operation-dati .remain-time') &&
      !document.querySelector('.remain-time')) return;
    if (scope && scope.isAlreadySubmit) { // 已交卷：撤掉按钮，免得误导
      var b = btn();
      if (b) b.remove();
      return;
    }
    ensureBtn();          // 不管找没找到 scope，按钮都挂出来且可点
    var isLive = live();
    render();
    if (!isLive) return;  // 没开跑就先不恢复暂停态，别挡住站点的初始赋值
    if (!restored) {
      restored = true;
      if (stored()) applyPause(true);
    }
    if (paused) installGuards();
    render();
  }

  var st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  tick();
  setInterval(tick, 1000);
})();
