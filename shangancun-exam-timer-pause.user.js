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

    '.remain-time{width:auto!important}',
    '.gth-timer-btn{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 10px;margin-left:8px;',
    'border:1px solid rgba(255,255,255,.55);border-radius:5px;background:rgba(255,255,255,.16);',
    'color:#fff;font-size:13px;line-height:1;cursor:pointer;vertical-align:middle;user-select:none}',
    '.gth-timer-btn:hover{background:rgba(255,255,255,.32)}',
    '.gth-timer-btn>svg{width:12px;height:12px;flex:0 0 auto}',
    '.gth-timer-btn.paused{background:#f59e0b;border-color:#f59e0b}',
    '.gth-timer-btn.paused:hover{background:#d97706}',

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
      freezeDom(true);
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
    if (sig === lastSig) return;
    lastSig = sig;
    b.className = 'gth-timer-btn' + (paused ? ' paused' : '');
    b.innerHTML = icon(paused ? 'play' : 'pause') +
      '<span>' + (paused ? '继续计时' : '暂停计时') + '</span>';

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

    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      applyPause(!paused);
    });
    host.appendChild(b);
    lastSig = '';
  }

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
    var a = document.querySelector('.remain-time a');
    var t = a ? (a.textContent || '') : '';
    var m = t.match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) return -1;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  }

  function findScope() {
    if (!window.angular) return null;
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

    var m = remainText.match(/(\d{1,2}:\d{2}:\d{2})/g);
    var domLive = false;
    if (m && m.length) {

      domLive = m.some(function (seg) { return seg !== '00:00:00'; });
    }
    return running || !!(s && s.allInterval) ||
      (typeof t === 'number' && t > 60) ||
      (parentAllTime && parentAllTime.length > 0 && !/00:00:00/.test(parentAllTime)) ||
      domLive;
  }

  function tick() {
    var s = findScope();
    if (s !== scope) {
      scope = s;
      restored = false;
      running = false;
      lastTotal = -1;
    }
    if (scope && scope.$$destroyed) { scope = null; restored = false; }
    if (!document.querySelector('.operation-dati .remain-time') &&
      !document.querySelector('.remain-time')) return;
    if (scope && scope.isAlreadySubmit) {
      var b = btn();
      if (b) b.remove();
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
    if (paused) installGuards();
    render();
  }

  var st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  tick();
  setInterval(tick, 1000);
})();
