// ==UserScript==
// @name         上岸村机考系统错题助手
// @namespace    http://tampermonkey.net/
// @version      1.10.2
// @description  上岸村机考系统错题整理增强，支持笔记、划线标注、错题重练、一键复制、错题与笔记导出等功能。
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
// @connect      pub.xdapi.top
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  console.log('[错题助手] 脚本已注入：' + location.href);

  var CTX = location.pathname.split('/')[1] || 'mingshi';
  var API_BASE = 'https://pub.xdapi.top/' + CTX + '/api/v1/tiku/gongan/';
  var API_V2 = 'https://pub.xdapi.top/' + CTX + '/api/v2/';   // 模考补题面走 v2（与站点同一接口）
  var LS_STORE = 'gongan_tiku_helper_' + CTX;
  var LS_TOKEN = 'token_gongan_' + CTX;
  var LS_LOGIN = 'login_status_' + CTX;

  var SUBJ_ZY = 1;
  var SUBJ_XC = 0;
  var SUBJECT_NAME = {};
  SUBJECT_NAME[SUBJ_ZY] = '公安专业知识';
  SUBJECT_NAME[SUBJ_XC] = '行政职业能力测试';

  var DAY_RANGES = [['0', '当天'], ['1', '本周'], ['2', '本月'], ['3', '近三月'], ['4', '全部']];
  var MASTER_STREAK = 2;

  /* 带 click 的 div / span：键盘本来完全到不了它们。这一份是唯一出处——下面的焦点环 CSS 由它生成，
     判据 T24 也拿它回脚本里核对类名，为的是「界面类名改了、这份没跟着改」那种界面上看不出的漂移。
     名单里不放真 <button>（.gth-tabs button / .gth-mini / .gth-qbar-btn 等），它们自带键盘。 */
  var KEYACT = '.gth-menu-item,.gth-chip,.gth-badge,.gth-aside-hl-t,.gth-aside-empty,.gth-balloon,' +
    '.gth-hlp-item .t,.gth-hlp-item .n,.gth-hlp-item .rm,.gthq-cell,.gthq-opt,mark.gth-hl,#gth-mock-btn';

  var EXPORT_HEADERS = ['序号', '科目', '来源', '材料', '题干', '选项', '你的答案', '正确答案', '答错次数', '解析', '笔记', '划线摘录', '掌握状态', '题目ID'];
  var XLSX_WIDTHS = [6, 16, 12, 30, 60, 50, 10, 10, 10, 60, 40, 40, 14, 12];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 取 <img> 的 src：站点题目区图片带真实 src，个别模板会写成 data-src
  function imgSrc(tag) {
    var m = /\s(?:src|data-src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    var url = (m && (m[1] || m[2] || m[3])) || '';
    if (url && /^\/\//.test(url)) url = location.protocol + url;
    if (url && !/^[a-z]+:/i.test(url)) {
      try { url = new URL(url, location.href).href; } catch (e) {}
    }
    return url;
  }

  // HTML → 纯文本。keepImg 为真时把图片保留成 Markdown 图片语法 ![图片](地址)，
  // 这样「复制题目」粘到别处（搜题 / 问 AI）时图片地址不会跟着标签一起被丢掉
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

  function wakeImgs(html) {
    return String(html == null ? '' : html)
      .replace(/<img\b([^>]*?)data-src=/gi, '<img$1src=')
      .replace(/<img\b([^>]*?)\sloading="lazy"/gi, '<img$1');
  }

  // 复制到剪贴板：优先用 Clipboard API，失败（非安全上下文 / 未授权）时回退到 execCommand
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

  // 组装一道题的纯文本（题干 + 材料 + 选项 + 解析），便于用户复制到别处搜题问答。
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
    eye:         '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    sparkles:    '<path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 1-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"/>',
    copy:        '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    check:       '<polyline points="20 6 9 17 4 12"/>',
    highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4z"/>',
    underline:   '<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>',
    quote:       '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>',
    scissors:    '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" x2="8.12" y1="4" y2="15.5"/><line x1="14.47" x2="20" y1="14.48" y2="20"/><line x1="8.12" x2="12" y1="15.5" y2="17"/>'
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
    if (!data.exported) data.exported = {};   // 已导出过的题目 id，用于增量导出
    if (!data.history) data.history = [];     // 最近三次组卷记录
    if (!data.resume) data.resume = {};       // 顺序刷题进度：筛选键 -> 已刷到第几题
    if (!data.highlights) data.highlights = {}; // 题目 id -> [{quote,prefix,nth,block,color,at,snap,subject,lost}]
    if (!data.mockQs) data.mockQs = {};       // 全真模考收录的题目快照：题目 id -> 归一化题目
    if (!data.mocks) data.mocks = {};         // 模考场次登记：场次 id -> {at, processed:{qid:1}}
    if (!data.practiced) data.practiced = {}; // 重练交卷登记：题目 id -> {at, n}，随机组卷靠它认「尚未重练」
    if (!data.qModule) data.qModule = {};     // 题目 id -> 行测模块名
    migrateExported(data);                    // 增量导出基线：按来源分桶
    var hlLostCleared = migrateHlLost(data);  // 撤掉误判的「划线已失效」，见函数上的说明
    if (hlLostCleared) console.log('[错题助手] 已撤掉 ' + hlLostCleared + ' 条误判的「划线已失效」标记');
    return data;
  })();

  // 增量导出基线按「来源」分桶：错题本 / 收藏夹 / 两者合并各记一份。
  // 同一道题可能同时出现在错题本和收藏夹，共用一份基线会让另一边漏掉「新增」。
  // 没有 `_v: 2` 标记的那份基线是扁平的 id 字典，一律并进「错题本」桶；旧备份文件也要能迁移，所以这段要可重复执行。
  function migrateExported(data) {
    var ex = data.exported;
    if (!ex || typeof ex !== 'object' || Array.isArray(ex) || ex._v !== 2) {
      var conv = {};
      if (ex && typeof ex === 'object' && !Array.isArray(ex)) {
        Object.keys(ex).forEach(function (k) { if (k !== '_v') conv[k] = 1; });
      }
      data.exported = { _v: 2, error: conv, favorite: {}, both: {}, mock: {} };
    }
    // 已是 _v:2 的存量数据补上模考桶（模考收录是后加的来源，旧库没这个键）
    if (!data.exported.mock) data.exported.mock = {};
    var at = data.exportAt;
    if (!at || typeof at !== 'object') {
      data.exportAt = { error: Number(at) || 0, favorite: 0, both: 0, mock: 0 };
    } else {
      data.exportAt = { error: at.error || 0, favorite: at.favorite || 0, both: at.both || 0, mock: at.mock || 0 };
    }
    return data;
  }

  /* 站点收起解析时 .analysis 里没有正文，解析区的划线定位不到就被判成失效，`lost` 写进了库。
     读这个标记的有四处：划线行的删除线、「再点同色取消」跳过它、页边的「N 条已失效」，
     以及一键整理写进笔记的「原文已变更，未能重新定位」——最后那条会跟着用户导出的文件走。
     这里把解析区的失效标记一律撤掉，交给 paintRoot 在解析真的渲染着的时候重判（判得回来，所以不丢东西）。
     非解析区的 lost 不动：那批是在文本确实可见时连着两次定位失败判出来的，是真信号。 */
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

  /* 库初始化只洗一次并留标记：每次加载都洗的话，重判出来的真失效会在下一次打开时被抹掉，
     用户看到的就是「失效 → 刷新 → 又不失效 → 展开解析 → 又失效」的闪。
     恢复备份走的是另一条路（restoreJson 直接调 washHlLost）：旧备份里的 lost 多半就是误判的那批。 */
  function migrateHlLost(data) {
    if (data.hlLostMigrated) return 0;
    data.hlLostMigrated = 1;
    return washHlLost(data.highlights);
  }

  // 一个浏览器里可能同时开着多个跑这份脚本的标签（或新旧版本并存）。saveStore 是整库回写，
  // 谁的内存快照旧，谁就把别人刚写的数据擦掉——实测踩过：模考刚收完 49 题，另一个标签一保存就全没了。
  // 所以写盘前重读磁盘，只并入「只增」的几块：模考快照、场次幂等账本、答错次数、重练登记、模块映射。
  // notes / highlights 故意不并：它们带删除语义，naive 合并会把用户删掉的东西救回来。
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

    // 重练登记按次数取大（不比时间戳），模块映射先到先得——同一题的模块名不会自相矛盾
    var pr = data.practiced || (data.practiced = {}), fpr = fresh.practiced || {};
    Object.keys(fpr).forEach(function (k) {
      var a = pr[k], b = fpr[k];
      if (!a || (b && (b.n || 0) > (a.n || 0))) pr[k] = b;
    });

    var qm = data.qModule || (data.qModule = {}), fqm = fresh.qModule || {};
    Object.keys(fqm).forEach(function (k) { if (!qm[k] && fqm[k]) qm[k] = fqm[k]; });
    return data;
  }

  /* 面板内容的重绘门：store 每写盘一次就 +1。观察器只在看这个数变化时重画面板，
     不然站点每次 DOM 变更都要把组卷历史整段 innerHTML 重写一遍、监听重绑一遍——
     面板里正展开的下拉和刚聚焦的控件会一起被抹掉。声明放在 saveStore 之前，
     它只可能被更晚的顶层调用读到，但 var 的赋值不提升，位置就是契约。 */
  var storeRev = 0;

  function saveStore() {
    storeRev++;
    try { localStorage.setItem(LS_STORE, JSON.stringify(mergeConcurrent(store))); }
    catch (e) { alert('本地存储写入失败：' + e.message); }
  }

  // 别的标签写盘后先把它那批「只增」数据并进本标签内存，免得下一次保存又把它擦掉
  window.addEventListener('storage', function (e) {
    if (e.key !== LS_STORE || !e.newValue) return;
    mergeConcurrent(store);
    storeRev++;   // 内存里的数据确实变了：面板要按同一扇门认这次，不然别的标签收的题进不来
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
    } else {
      delete store.notes[id];
    }
    saveStore();
  }
  function getNote(id) { return (store.notes[id] && store.notes[id].text) || ''; }

  /* ================= 划线：存锚点，不存 DOM =================
     错题页的题目区由 AngularJS 的 ng-bind-html 渲染，翻页 / 切换 exam_type / 折叠解析
     都会整块重绘，直接往 DOM 里塞 <mark> 会被冲掉。因此每条划线只记录
     「原文 + 前置上下文 + 第几次出现」，页面每次重绘后按锚点重新落笔。 */

  var HL_LABEL = { yellow: '重点', red: '易错' };
  var HL_PREFIX_LEN = 12;

  function getHighlights(id) { return store.highlights[id] || []; }

  function countHighlights(id) { return getHighlights(id).length; }

  /* 该进笔记列表的题：写过笔记的，或一条划线都划了的（在解析页只划线不写字也得能找回来）。
     笔记 tab 与「一键整理为笔记」共用这一条口径。 */
  function noteIdsWithHl() {
    var ids = Object.keys(store.notes);
    Object.keys(store.highlights).forEach(function (id) {
      if (getHighlights(id).length && ids.indexOf(id) < 0) ids.push(id);
    });
    return ids;
  }

  /* 一条划线在列表里的那一行，三处共用：笔记面板 / 页边批注栏 / 重练题目。
     noteTitle 是批注行的悬停提示，各处的措辞历来不同，所以由调用方给。 */
  // 一行划线：dot / bd / rm 三段横排，原文与批注上下叠在 .bd 里（它带 flex:1;min-width:0，
  // 是这一行里唯一可收缩的那块）。因此 .t 与 .n 的 parentNode 是 .bd 而不是本行，
  // 取下标一律用 closest('.gth-hlp-item')——按 parentNode 拿到的 .bd 身上没有 data-hl，
  // Number(undefined) 是 NaN，点着就是没反应
  function hlRowHtml(h, i, noteTitle) {
    return '<div class="gth-hlp-item' + (h.lost ? ' lost' : '') + '" data-hl="' + i + '">' +
      '<span class="dot ' + (h.color === 'red' ? 'red' : 'yellow') + '"></span>' +
      '<div class="bd"><div class="t" title="点击写批注">' + esc(h.quote || '') + '</div>' +
      (h.note ? '<div class="n"' + (noteTitle ? ' title="' + esc(noteTitle) + '"' : '') + '>' +
        esc(h.note) + '</div>' : '') +
      '</div>' +
      '<span class="rm" title="取消划线">' + icon('x') + '</span></div>';
  }

  // 划中的文字落在题目的哪一块：靠「哪段源文本包含了这句话」判断，不依赖 DOM 结构
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

  // 题目对象来源有两个：错题页的 AngularJS scope，以及插件组卷的 quiz.list
  function questionOf(qid) {
    if (itemsById[qid]) return itemsById[qid];
    if (quiz && quiz.list) {
      for (var i = 0; i < quiz.list.length; i++) {
        if (String(quiz.list[i].id) === String(qid)) return quiz.list[i];
      }
    }
    return null;
  }

  // 求某个节点 / 偏移在 root 纯文本中的字符下标
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

  // 归一化：抹掉空白与标点，用于「站点文案微调」后的模糊匹配
  // PUNCT_RE 不带 /g：带 /g 时 RegExp.test() 会把 lastIndex 往后挪，连续标点隔一个漏一个
  var PUNCT_RE = /[\s\u3000,.!?;:'"()（）【】《》、，。！？；：""''—\-–·]/;

  // 归一化后的下标 -> 原文下标映射
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

  /* 在 root 里定位一条划线，返回 {start, end, fuzzy} 或 null。
     先精确匹配（按 nth + 前置上下文），失败再模糊匹配。 */
  function locate(root, rec) {
    var full = root.textContent || '';
    if (!full || !rec.quote) return null;
    var idxs = allIndices(full, rec.quote);
    var pick = -1;
    if (idxs.length) {
      if (idxs.length === 1) pick = idxs[0];
      else if (rec.nth >= 1 && rec.nth <= idxs.length) pick = idxs[rec.nth - 1];
      // 第几次出现对不上时，用前置上下文救一次
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

  // 把 [start,end) 字符区间内的文本节点包进 <mark>。只移动/切分文本节点，不新建内容，
  // 因此不会破坏 AngularJS 持有的 Text 节点引用（ng-bind-html 区域本身也没有插值节点）
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
      // 反查下标：点击这条划线时能知道它是 store.highlights[qid] 里的第几条
      if (idx != null) mk.dataset.gthI = String(idx);
      node.parentNode.insertBefore(mk, node);
      mk.appendChild(node);
      made++;
    });
    return made;
  }

  // 落笔前先拆掉已有 mark，保证文本是「干净原文」，重绘才幂等
  function unwrapMarks(root) {
    $$('mark.gth-hl', root).forEach(function (m) {
      var p = m.parentNode;
      if (!p) return;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
    });
  }

  /* 站点把解析做成「展开/收起」开关：收起时 item.analysis 被换成空串（正文在 analysis_shadow 里），
     解析区的划线在收起态根本不在页面上。这种定位不到不是失效，得先不下结论——
     把它记成 lost，删除线和「原文已变更，未能重新定位」会一路带进批注栏、重练界面和导出的笔记 */
  function hlHoldLost(rec, analysisShown) {
    return rec.block === 'analysis' && !analysisShown;
  }

  /* 重画一道题的所有划线。签名机制同时有两个作用：
     1) 幂等 —— 画完再被 MutationObserver 唤醒时直接跳过，避免无限重绘；
     2) 感知变化 —— 题目文本长度变了（展开解析、换页）就重画。 */
  function paintRoot(root) {
    var qid = root.getAttribute('data-gth-qid');
    if (!qid || !root.isConnected) return;
    var list = store.highlights[qid] || [];
    var len = (root.textContent || '').length;
    var sig = qid + '|' + list.length + '|' + len;
    if (root.getAttribute('data-gth-paint') === sig) return;
    // 题目内容还没渲染出来（Angular 尚未 ng-bind-html、或正整块重绘）时不要落笔，
    // 否则会把「还没渲染」误判成「划线失效」，还把这个误判写进本地存储
    if (list.length && len < 8) return;

    unwrapMarks(root);
    if (!list.length) { root.setAttribute('data-gth-paint', sig); return; }
    var painted = 0, changed = false, retry = false;
    // 收起解析时站点的 .analysis 里只剩「解析」这个标题字，正文那个 <p> 才是有没有内容的答案
    var ap = $('.analysis p', root);
    var analysisShown = !!(ap && (ap.textContent || '').trim().length);
    list.forEach(function (rec, i) {
      if (rec.edited) return;         // 手改过文本的划线只作笔记素材，不再往页面上画
      var pos = locate(root, rec);
      if (!pos) {
        if (hlHoldLost(rec, analysisShown)) return;
        // 连续两次定位失败才认定失效：单次失败多半是站点正在重绘，等下一次唤醒再试
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
    // 签名只跟「题目文本 + 划线条数」有关。用 list.length 而不是本次实画条数：
    // 只要有一条 edited / 失效的划线，实画条数就永远对不上，观察器每个周期都会
    // 拆了重画（划线闪烁、CPU 空转），这正是「划线看着失效」的来源之一
    root.setAttribute('data-gth-paint', retry ? '' : sig);
  }

  function repaintHighlights() {
    $$('[data-gth-qid]').forEach(paintRoot);
  }

  // 一道题在 DOM 里的根节点；qid 可能被塞了引号，选择器里先剥掉
  function qRoot(qid) { return $('[data-gth-qid="' + String(qid).replace(/"/g, '') + '"]'); }

  // 改完这一题的划线数据后让它重新落笔（抹掉 data-gth-paint，paintRoot 才认它是新节点）
  function repaintOne(qid) {
    var root = qRoot(qid);
    if (root) { root.removeAttribute('data-gth-paint'); paintRoot(root); }
  }

  // 把已经渲染出来的批注栏全部重画；正在编辑某条批注的那一题先不动
  function rerenderAsides() {
    $$('.gth-aside').forEach(function (a) {
      var it = itemsById[a.dataset.id];
      if (it && !a.dataset.editing) renderAside(a, it);
    });
  }

  // 新增一条划线：由「选区起点在题目纯文本中的下标」反推 nth 与前置上下文
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
      subject: it ? it.content_type : null
    };
    if (!store.highlights[qid]) store.highlights[qid] = [];
    store.highlights[qid].push(rec);
    saveStore();
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

  /* ---- 划线的批注：Word 的模型是「批注锚定在文字上」，所以每条划线自带一条批注 ---- */

  function hlNoteSet(qid, idx, text) {
    var r = (store.highlights[qid] || [])[idx];
    if (!r) return;
    if (text) { r.note = text; r.noteAt = Date.now(); }
    else { delete r.note; delete r.noteAt; }
    saveStore();
  }

  // 取消划线：连同它挂着的批注一起删（Word 里删批注=撤掉高亮，两者同生共死）
  function hlRemove(qid, idx) {
    var list = store.highlights[qid];
    if (!list || idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    if (!list.length) delete store.highlights[qid];
    saveStore();
    repaintOne(qid);
  }

  // 选区 [s,e) 覆盖了哪些划线？用于「再点一次同色 = 取消」的 Word 式切换
  function hlOverlap(root, start, end, color) {
    var qid = root.getAttribute('data-gth-qid');
    var list = store.highlights[qid] || [];
    var hit = [];
    list.forEach(function (rec, i) {
      if (rec.edited || rec.lost) return;
      if (color && (rec.color === 'red' ? 'red' : 'yellow') !== color) return;
      var pos = locate(root, rec);
      if (!pos) return;
      if (pos.start < end && pos.end > start) hit.push(i);   // 半开区间相交
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

  /* 答错次数：优先读服务端字段（站点若返回），否则用本地累计 */
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
  // 能进错题本就说明至少已经错过一次，所以真实次数 = 本地累计 + 1
  var WRONG_BASE = 1;
  var STUBBORN_MIN = 3;      // 达到这个次数标为红色「顽固错题」（含 3 次）

  function errCountOf(q) {
    var s = serverErrCount(q);
    if (s) return s;
    return ((store.wrongCount && store.wrongCount[q.id]) || 0) + WRONG_BASE;
  }

  // 答错次数标记：达到 STUBBORN_MIN 用红色醒目的「顽固错题」
  function errTag(n) {
    var hard = n >= STUBBORN_MIN;
    return {
      cls: 'gth-err' + (hard ? ' stubborn' : ''),
      html: (hard ? icon('warn') : icon('xCircle')) +
        (hard ? '顽固错题 · ' + n + ' 次' : '答错 ' + n + ' 次')
    };
  }
  // 交卷时累计本地答错次数（答错 +1）
  function bumpWrongCount(q, ok) {
    if (!store.wrongCount) store.wrongCount = {};
    if (!ok) store.wrongCount[q.id] = (store.wrongCount[q.id] || 0) + 1;
  }
  // 「这题重练过」只在交卷时登记，与掌握度分开：收藏页手动打勾不算练过。
  function markPracticed(id) {
    if (!store.practiced) store.practiced = {};
    var r = store.practiced[id];
    store.practiced[id] = { at: Date.now(), n: ((r && r.n) || 0) + 1 };
  }
  function isPracticed(id) { return !!(store.practiced && store.practiced[id]); }

  var MOCK_UNCLS = '未分类';   // 模块这一维是后加的：更早收录的模考题没有它，统一落到这个桶

  // 模块的唯一读入口：行测考点映射优先，其次模考收录里的 module
  function moduleOf(id) {
    return (store.qModule && store.qModule[id]) ||
      (store.mockQs[id] && store.mockQs[id].module) || '';
  }
  /* 每题自带的 exam_point 是考点树里某个节点的 id，而脚本的「模块」= exampoint_list 的顶层节点。
     把树走一遍记下「后代 → 所属顶层」，模块就能直接从列表响应推出来，
     不必等「按科目 + 行测」逐个考点请求（实测：树 219 个节点，顶层 8 个模块名）。 */
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

  // fetchSubcategory 拿到考点表时填；没填之前列表里的 exam_point 一律不登记（不猜）
  var examPointModule = null;

  /* 只认「这个 exam_point 在这棵考点树里」，不额外判科目：按日期那一趟是行测与公专混着返回的，
     而列表项里没有可用的科目字段（实测 38 个键里只有 exam_type_id=6、type_id=1 这类，
     不是站点的 0/1 科目）。公专的题会不会带一个落在行测考点树里的 id，本机没有公专错题、测不出来；
     真撞上也不过是给那道题挂一个站点自己的考点名——比现在「按日期筛出来全无模块」更接近站点的口径。 */
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

  // 按考点逐个请求时顺手登记；同一题被多个考点返回时保留第一个（站点考点本身可重叠）
  function rememberModule(id, name) {
    if (!name) return false;
    if (!store.qModule) store.qModule = {};
    var k = String(id);
    if (store.qModule[k]) return false;
    store.qModule[k] = name;
    return true;
  }
  // 首次注入列表 UI 时打印一次题目字段清单，便于确认服务端是否带错误次数字段
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

  // 站点把解析做成「展开/收起」开关：加载时 analysis 被清空、内容转入 analysis_shadow，
  // 点击后再换回来。所以解析始终只在这两个字段之一里，读单个字段必然拿到空串。
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

  // 行测的模块（知识点）位于 subcategory_list 的下一级 exampoint_list。
  // 站点模板本身也只渲染这一级，其上层「试卷分类」在模板中已被注释掉。
  // 同名模块可能同时挂在多个分类下，这里按名称合并为一组请求对。
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

  /* 行测按考点逐个拉题，错题与收藏共用一条流程，只差接口：
     error/view 分页返回（要带 page），favorite/view 一次性返回（站点不吃分页参数）。
     moduleNames 为空数组表示全部模块。 */
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

  /* ---------- 收藏夹：与错题本同构的第二条题目来源 ----------
     站点两个列表用的是同一个 ng-repeat 表达式（item in subjectList），字段也一致，
     接口只差路径：error/view 分页返回，favorite/view 一次性返回且没有分页参数。 */

  function listPath(kind, ci) {
    return 'content/' + ci.content_id + '/' + (kind === 'favorite' ? 'favorite/view' : 'error/view');
  }

  // 收藏与错题的筛选参数一致：view_type 0=日期型、1=科目型
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

  // 行测的收藏同样要按考点逐个请求：content_type=0 时接口只认 subcategory/exampoint，
  // 不传考点等于拿不到东西。
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

  // 来源统一成数组：多个来源取并集、同一道题只留一份；旧的单个 src 组卷历史（both = 错题本＋收藏夹）也在这里归一，不在调用方各写一遍
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

  // 勾掉的来源里还有没有站点来源：只有站点来源才谈得上日期 / 科目 / 行测模块
  function hasSiteSrc(srcs) {
    return srcList({ srcs: srcs }).some(function (s) { return s !== 'mock'; });
  }

  function fetchByFilter(f, limit) {
    var srcs = srcList(f);
    var wantErr = srcs.indexOf('error') >= 0, wantFav = srcs.indexOf('favorite') >= 0;
    var mods = f.mock_modules || [];   // 空数组 = 全部模考模块
    var site = (!wantErr && !wantFav) ? Promise.resolve([])
      : (wantErr && wantFav) ? Promise.all([fetchErrors(f, limit), fetchFavorites(f)])
          .then(function (r) {
            var seen = new Set(), out = [];
            r[0].concat(r[1]).forEach(function (q) {
              if (!q || q.id == null || seen.has(q.id)) return;
              seen.add(q.id);
              out.push(q);
            });
            return out;
          })
      : wantErr ? fetchErrors(f, limit)
      : fetchFavorites(f);
    return site.then(function (list) {
      // 按日期与收藏这两路原来一个模块都登记不上（只有逐个考点请求那条路会记）——
      // 其实每题自带 exam_point，换名就行
      rememberModulesFromPoints(list);
      var have = {};
      list.forEach(function (q) { if (q && q.id != null) have[String(q.id)] = 1; });
      // 模考成绩不进站点错题接口，错题本一向并上模考答错的题；勾了「模考收录」才把答对与未做的也带进来。
      // 模考模块的勾选对两路都生效——没勾收录时那排 chips 不显示，也就不参与条件，免得留下看不见的筛选
      var mock = srcs.indexOf('mock') >= 0 ? mockAllList(mods)
        : (wantErr ? mockWrongList(mods) : []);
      return list.concat(mock.filter(function (q) { return !have[String(q.id)]; }));
    });
  }

  function fetchSubcategory() {
    return getCommodity()
      .then(function (ci) { return apiGet('content/' + ci.content_id + '/subcategory'); })
      .then(function (d) {
        var list = d.subcategory_list || [];
        examPointModule = buildExamPointIndex(list);   // 有了这张表，列表里的 exam_point 就能换成模块名
        return list;
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

  function toRows(list) {
    return list.map(function (q, i) {
      return [
        i + 1,
        SUBJECT_NAME[q.content_type] || '',
        q._mock ? '模考#' + q._mock : '练习',   // 来源：全真模考场次 / 站点练习
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

  // 导出用的划线摘要：按「[重点] 原文（批注：…）」逐条拼接
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
      _version: 1,
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
      mockQs: store.mockQs,       // 全真模考收录题目
      mocks: store.mocks,         // 模考场次登记（含答错计数幂等键）
      practiced: store.practiced, // 重练交卷登记
      qModule: store.qModule      // 题目 id -> 行测模块名
    };
    return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  }

  function exportNotesMarkdown(ids) {
    // 笔记 tab 的列表里还有「只划线没写笔记」的题，导出笔记时按老规矩跳过它们
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
    // 备份文件可能是分桶之前的扁平格式（`exported` 不带 `_v: 2`），统一迁移成按来源分桶
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
    saveStore();
    refreshBadges();
    renderNotesList();
    renderHistory();
    renderMockChips();
    updateExportHint();
    repaintHighlights();
    return '已恢复笔记 ' + Object.keys(store.notes).length +
      ' 条，划线 ' + Object.keys(store.highlights).length + ' 题，掌握记录 ' + Object.keys(store.mastered).length +
      ' 条，组卷历史 ' + (store.history || []).length + ' 条';
  }

  GM_addStyle([
    ':root{',
    '--gth-bg:#ffffff;--gth-fg:#0f172a;--gth-muted:#64748b;--gth-subtle:#f8fafc;',
    '--gth-border:#e2e8f0;--gth-border-strong:#cbd5e1;--gth-hover:#f1f5f9;',
    '--gth-primary:#0f172a;--gth-primary-fg:#f8fafc;--gth-primary-hover:#1e293b;',
    '--gth-destructive:#dc2626;--gth-destructive-hover:#fef2f2;',
    '--gth-ring:rgba(148,163,184,0.45);--gth-success:#16a34a;',
    // 控件高度与圆角只有一个出处：按钮、输入框、下拉必须同高，否则同一行里参差不齐
    '--gth-ctl-h:38px;--gth-ctl-r:10px;',
    '}',

    '.gth-ic{display:inline-flex;align-items:center;justify-content:center;width:1em;height:1em;line-height:1;color:currentColor}',
    '.gth-ic svg{width:100%;height:100%;display:block}',

    /* 左侧菜单入口：尺寸/底色/字色完全沿用站点 .left-menu .item，只补激活态 */
    '.gth-menu-item{cursor:pointer}',
    '.gth-menu-item .text{display:inline-flex;align-items:center;gap:6px}',
    '.gth-menu-item .gth-ic{font-size:14px;opacity:.75}',
    '.gongan2-container .left-menu .item.gth-menu-item.active{background:#fff;font-weight:700}',
    // 助手视图打开时压住原生项的激活底色。原生 active 由 AngularJS 的 ng-class 掌管，
    // 直接摘它的 class 会与 ng-class 打架（表达式值未变就不会重加），因此只做视觉压制、不改状态
    'body.gth-view-on .left-menu .item.active:not(.gth-menu-item){background:#f8f8f8}',

    /* 助手视图：作为 .right-content 的原生同级节点，与站点 .inner-content 互斥显示。
       下内边距只留 8px：站点 .right-content 自己带 padding:20px 0，再叠 40px 就是一大片没人认领的空白 */
    '.gth-hide{display:none!important}',
    '.gth-view{padding:0 20px 8px;box-sizing:border-box;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;',
    'font-size:13px;color:var(--gth-fg)}',
    '.gth-view[hidden]{display:none}',
    // 带 hidden 的元素一律要真的消失：.gth-row 这类作者级 display 压过 UA 的 [hidden]{display:none}，el.hidden = true 只管属性不管渲染
    '.gth-view [hidden]{display:none !important}',

    /* 笔记批注轨道：.content 保持自身滚动（站点原生行为），轨道用 position:fixed
       镜像它的视口位置，内部再按 scrollTop 反向平移，从而把批注栏落在容器右侧的空白页边距里。
       纯 CSS 做不到——浏览器会把「一轴 clip + 另一轴 scroll」降级为 hidden，overflow-clip-margin 失效。 */
    // 用子选择器限定：题目区里也有 .content（题干那层），别给它加定位上下文
    'body.gth-error .right-content .inner-content>.content{position:relative}',
    '.gth-rail{position:fixed;overflow:hidden;pointer-events:none;z-index:50;',
    // 这里的 clamp 只是 JS 还没跑之前的兜底；真正生效的宽度由 syncRail 按可视区现算，
    // 因为可用空间取决于内容区右缘在哪，CSS 算不出来
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
    '.gth-mini{border:1px solid #fde68a;background:#fff;color:#a16207;border-radius:6px;height:24px;padding:0 8px;',
    'font-size:11px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:4px}',
    '.gth-mini:hover{background:#fef3c7}',
    '.gth-mini.primary{background:#f59e0b;border-color:#f59e0b;color:#fff}',
    '.gth-mini.primary:hover{background:#d97706;border-color:#d97706}',

    /* 子分类 / 模块 两级多选 chips */
    '.gth-chiprow{display:flex;align-items:flex-start;gap:8px;margin-bottom:8px}',
    '.gth-chiplabel{color:var(--gth-muted);font-size:12px;min-width:28px;padding-top:7px;flex:0 0 auto}',
    '.gth-chips{display:flex;flex-wrap:wrap;gap:6px;flex:1;min-width:0}',
    '.gth-chip{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 11px;',
    'border:1px solid var(--gth-border);border-radius:14px;background:var(--gth-bg);color:var(--gth-muted);',
    'font-size:12px;cursor:pointer;transition:all .15s;user-select:none}',
    '.gth-chip:hover{border-color:var(--gth-border-strong);color:var(--gth-fg)}',
    '.gth-chip.on{background:var(--gth-primary);border-color:var(--gth-primary);color:var(--gth-primary-fg)}',
    '.gth-chip .gth-ic{font-size:11px}',
    '.gth-chips-empty{font-size:12px;color:var(--gth-muted);padding:5px 0 10px}',
    '.gth-chip .n{font-weight:600;font-size:11px;opacity:.65;margin-left:2px}',

    /* 来源多选下拉：点按钮开合，菜单里是勾选框。用 absolute 挂在按钮下方 */
    '.gth-dd{position:relative;display:inline-block}',
    '.gth-dd-btn{display:inline-flex;align-items:center;gap:6px;cursor:pointer;text-align:left;',
    'min-width:132px;white-space:nowrap}',
    '.gth-dd-btn span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}',
    '.gth-dd-menu{position:absolute;left:0;top:calc(100% + 4px);z-index:100002;min-width:172px;',
    'background:var(--gth-bg);border:1px solid var(--gth-border);border-radius:10px;padding:5px;',
    'box-shadow:0 10px 28px rgba(15,23,42,.16)}',
    '.gth-dd-menu[hidden]{display:none}',
    '.gth-dd-opt{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:7px;',
    'font-size:13px;color:var(--gth-fg);cursor:pointer;user-select:none}',
    '.gth-dd-opt:hover{background:var(--gth-hover)}',
    '.gth-dd-opt input{width:15px;height:15px;margin:0;accent-color:var(--gth-primary);cursor:pointer}',

    /* 答错次数标记 */
    '.gth-err{display:inline-flex;align-items:center;gap:3px;font-size:11px;padding:2px 8px;border-radius:10px;',
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

    /* 收尾的「本地数据」块：原先是一条通栏 hairline + 三颗最小档按钮 + 一行说明，底下还空 60px；
       成组之后这块地方有主了，空白变成这一节的呼吸而不是没写完的面板 */
    '.gth-data{margin-top:24px;padding:14px 16px 13px;border:1px solid var(--gth-border);',
    'border-radius:12px;background:var(--gth-subtle)}',
    '.gth-data .gth-sub{margin:0 0 11px}',
    // 浅底上 --gth-muted 只剩 4.5:1，压到 slate-600 才回到 7:1
    '.gth-data .gth-hint{margin:11px 0 0;color:#475569}',
    '.gth-data-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
    '.gth-data-row .sp{flex:1}',
    // 增量导出的两个计数并到一行，「重置增量基线」紧跟着它解释的那两个数，不再甩到 600px 外的右边缘
    '.gth-export-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}',
    // 没载入过题目时 #gth-count 是空的：0 宽的项照样吃一份 gap，会把整行推歪
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
    '.gth-btn.danger{color:var(--gth-destructive);border-color:var(--gth-border-strong)}',
    '.gth-btn.danger:hover{background:var(--gth-destructive-hover);border-color:#fecaca;color:#b91c1c}',
    '.gth-btn.ghost{border-color:transparent}',
    '.gth-btn.ghost:hover{background:var(--gth-hover);border-color:transparent}',
    '.gth-btn.sm{height:32px;padding:0 12px;font-size:12px;gap:5px}',
    '.gth-btn .gth-ic{font-size:15px}',

    // 键盘焦点：这些是真 <button>，此前只有 .gth-btn 有环，其余落到 UA 默认（浅色底上几乎看不见）
    '.gth-tabs button:focus-visible,.gth-mini:focus-visible,.gth-qbar-btn:focus-visible,',
    '.gth-his-item button:focus-visible,.gth-dd-opt:focus-within{',
    'outline:2px solid var(--gth-ring);outline-offset:2px}',
    // 名单里那些 div / span 现在也能聚焦了，没环就等于看不见光标落在哪。环从 KEYACT 生成，
    // 不另写一份选择器——两份名单迟早漂开
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

    '#gth-status{margin-top:10px;padding:10px 12px;border-radius:8px;background:var(--gth-subtle);',
    'color:var(--gth-muted);font-size:12px;line-height:1.6;white-space:pre-wrap;border:1px solid var(--gth-border)}',
    '#gth-status.err{background:#fef2f2;color:#b91c1c;border-color:#fecaca}',
    '#gth-status.ok{background:#f0fdf4;color:#15803d;border-color:#bbf7d0}',

    // 操作条挂在题目内容之上（ng-repeat 节点的第一个子节点）。左内边距 40px = 站点
    // .sequence 的宽度，让操作条与题干左对齐
    '.gth-qbar{display:flex;align-items:center;gap:8px;margin:12px 0 0;padding:0 0 8px 40px}',
    '.gth-qbar [hidden]{display:none!important}',
    // 操作条上的按钮：挨着答错次数 / 掌握状态徽章，与 shadcn 节奏一致
    '.gth-qbar-btn{display:inline-flex;align-items:center;gap:3px;height:24px;padding:0 8px;font-size:11px;',
    'border:1px solid var(--gth-border);border-radius:6px;background:var(--gth-bg);color:var(--gth-muted);cursor:pointer}',
    '.gth-qbar-btn:hover{background:var(--gth-hover);color:var(--gth-fg)}',
    '.gth-qbar-copy.copied{color:#16a34a;border-color:#bbf7d0;background:#f0fdf4}',
    // 掌握状态徽章可点：点一下在「未掌握 / 已掌握」之间切
    '.gth-badge{font-size:11px;color:var(--gth-muted);display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:10px;',
    'background:var(--gth-subtle);cursor:pointer;user-select:none;transition:background .15s,color .15s}',
    '.gth-badge:hover{background:var(--gth-hover);color:var(--gth-fg)}',
    '.gth-badge.done{color:#15803d;background:#f0fdf4}',
    '.gth-badge.ghost{color:#94a3b8;background:transparent;box-shadow:inset 0 0 0 1px var(--gth-border)}',
    '.gth-badge.has{color:#a16207;background:#fffbeb}',

    /* 组卷历史 */
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
    '.gth-note-item{background:var(--gth-bg);border:1px solid var(--gth-border);border-radius:10px;padding:12px 14px;',
    'transition:border-color .15s,box-shadow .15s}',
    '.gth-note-item:hover{border-color:var(--gth-border-strong);box-shadow:0 2px 6px rgba(15,23,42,.04)}',
    '.gth-note-h{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--gth-muted);margin-bottom:6px;flex-wrap:wrap}',
    '.gth-note-h .gth-pill{padding:2px 8px;border-radius:10px;background:var(--gth-subtle);color:var(--gth-muted);font-size:11px;border:1px solid var(--gth-border)}',
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
    'border:1px dashed var(--gth-border);border-radius:10px;display:flex;flex-direction:column;align-items:center;gap:8px}',

    '#gth-quiz{position:fixed;inset:0;z-index:100000;background:#f8fafc;display:flex;flex-direction:column;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}',
    '#gth-quiz[hidden]{display:none}',
    '.gthq-top{display:flex;align-items:center;gap:10px;padding:14px 24px;background:var(--gth-bg);',
    'border-bottom:1px solid var(--gth-border);font-size:13px;color:var(--gth-fg);flex-wrap:wrap}',
    '.gthq-top .sp{flex:1}',
    '.gthq-top .pill{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:14px;',
    'background:var(--gth-subtle);border:1px solid var(--gth-border);color:var(--gth-muted);font-size:12px}',
    '.gthq-top .pill b{color:var(--gth-fg)}',
    '.gthq-main{flex:1;overflow:auto;padding:24px}',
    '.gthq-card{background:var(--gth-bg);border:1px solid var(--gth-border);border-radius:12px;padding:24px;',
    'max-width:880px;margin:0 auto;box-shadow:0 1px 2px rgba(15,23,42,.04)}',
    '.gthq-meta{color:var(--gth-muted);font-size:12px;margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.gthq-material{background:var(--gth-subtle);border:1px solid var(--gth-border);border-left:3px solid #cbd5e1;',
    'padding:12px 14px;margin-bottom:16px;border-radius:8px;font-size:14px;line-height:1.8;color:var(--gth-fg)}',
    '.gthq-stem{font-size:16px;line-height:1.9;margin-bottom:16px;color:var(--gth-fg)}',
    '.gthq-opt{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;margin-bottom:8px;',
    'border:1px solid var(--gth-border);border-radius:10px;cursor:pointer;font-size:15px;line-height:1.7;',
    'background:var(--gth-bg);transition:all .15s}',
    '.gthq-opt:hover{border-color:var(--gth-border-strong);background:var(--gth-subtle)}',
    '.gthq-opt.sel{border-color:var(--gth-primary);background:var(--gth-primary);color:var(--gth-primary-fg)}',
    '.gthq-opt .lb{font-weight:600;min-width:22px}',
    // 题目区图片默认行内（display:inline-block），让「如图 <img> 所示」这类图文混排中的插图
    // 落在文字之间，而不是被强制换行单独成行；大图受 max-width:100% 限制，放不下时自然回落到独立一行
    '.gthq-opt img,.gthq-stem img,.gthq-material img,.gthq-analysis img,.gth-note-text img{max-width:100%;height:auto;display:inline-block;vertical-align:middle;margin:2px 0;border-radius:6px}',
    '.gthq-tip{color:var(--gth-muted);font-size:12px;margin:10px 0;display:inline-flex;align-items:center;gap:6px;',
    'padding:4px 10px;background:var(--gth-subtle);border-radius:14px;border:1px solid var(--gth-border)}',
    '.gthq-sheet{display:flex;flex-wrap:wrap;gap:6px;max-width:880px;margin:18px auto 0}',
    '.gthq-cell{width:34px;height:34px;line-height:32px;text-align:center;border:1px solid var(--gth-border);',
    'border-radius:8px;cursor:pointer;font-size:12px;background:var(--gth-bg);color:var(--gth-muted);',
    'transition:all .15s}',
    '.gthq-cell:hover{border-color:var(--gth-border-strong);color:var(--gth-fg)}',
    '.gthq-cell.cur{border-color:var(--gth-primary);color:var(--gth-primary);font-weight:600}',
    '.gthq-cell.answered{background:var(--gth-subtle);border-color:var(--gth-border-strong);color:var(--gth-fg)}',
    '.gthq-nav{max-width:880px;margin:16px auto 40px;display:flex;gap:10px;justify-content:space-between}',
    '.gthq-r-item{background:var(--gth-bg);border:1px solid var(--gth-border);border-radius:12px;padding:16px 20px;',
    'max-width:880px;margin:0 auto 12px;border-left:3px solid var(--gth-border)}',
    '.gthq-r-item.right{border-left-color:#16a34a}',
    '.gthq-r-item.wrong{border-left-color:var(--gth-destructive)}',
    '.gthq-r-item.unanswered{border-left-color:#ca8a04}',
    '.gthq-r-h .tag.unanswered{background:#fef9c3;color:#a16207}',
    '.gthq-r-h{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:12px;color:var(--gth-muted);flex-wrap:wrap}',
    '.gthq-r-h .tag{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:500}',
    '.gthq-r-h .tag.right{background:#dcfce7;color:#166534}',
    '.gthq-r-h .tag.wrong{background:#fee2e2;color:#991b1b}',
    '.gthq-ans{margin-top:12px;font-size:14px;display:flex;flex-wrap:wrap;gap:12px}',
    '.gthq-ans .ok{color:#16a34a}.gthq-ans .bad{color:var(--gth-destructive)}',
    '.gthq-analysis{margin-top:12px;background:var(--gth-subtle);border-radius:8px;padding:10px 14px;',
    'font-size:14px;line-height:1.8;color:var(--gth-fg);border:1px solid var(--gth-border)}',
    '.gthq-notebox{margin-top:12px;display:flex;flex-direction:column;gap:6px}',
    '.gthq-nb-act{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.gthq-notebox textarea{width:100%;min-height:60px;border:1px solid var(--gth-border);border-radius:8px;',
    'padding:8px;font-size:13px;resize:vertical;box-sizing:border-box;font-family:inherit;background:var(--gth-bg)}',

    /* ---- 划线 ---- */
    'mark.gth-hl{background:transparent;color:inherit;border-radius:2px;padding:0 1px}',
    'mark.gth-hl.yellow{background:#fde68a;box-shadow:inset 0 -2px 0 #f59e0b}',
    'mark.gth-hl.red{background:#fecaca;box-shadow:inset 0 -2px 0 #dc2626}',

    /* 选中即现的浮动工具条。用 fixed + 视口坐标，避免受站点内部滚动容器影响 */
    '#gth-hlbar{position:fixed;z-index:100001;display:none;align-items:center;gap:2px;padding:4px;',
    'background:var(--gth-bg);border:1px solid var(--gth-border);border-radius:10px;',
    'box-shadow:0 6px 20px rgba(15,23,42,.16);',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}',
    '#gth-hlbar.on{display:inline-flex}',
    '#gth-hlbar button{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px;',
    'border:none;background:transparent;border-radius:7px;font-size:12px;color:var(--gth-fg);',
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

    /* 批注栏里的划线清单：内联展开，不用浮层——轨道容器 overflow:hidden 会裁掉浮层 */
    '.gth-aside-hl{margin-top:6px;border-top:1px dashed #fde68a;padding-top:6px}',
    '.gth-aside-hl-t{display:flex;align-items:center;gap:5px;font-size:11px;color:#a16207;cursor:pointer;user-select:none}',
    '.gth-aside-hl-t .gth-ic{font-size:12px;flex:0 0 auto}',
    '.gth-aside-hl-t .sp{flex:1}',
    // 类名必须带 gth- 前缀：这个页面加载了 bootstrap 3.3.7，它有一个全局 .caret
    // {width:0;height:0;border-top:4px solid;border-right/left:4px transparent}，
    // 用 border 画一个实心向下三角形。我们只覆盖了 width/height，碰不到 border-*，
    // 所以那个三角形会叠在自己的 Lucide 箭头下面——看着就是「两个图标重叠」
    '.gth-aside-hl-t .gth-caret{flex:0 0 auto;width:12px;height:12px;display:inline-flex;',
    'align-items:center;justify-content:center;opacity:.7;transition:transform .15s}',
    '.gth-aside-hl-list{margin-top:5px;display:none;flex-direction:column;gap:5px}',
    '.gth-aside-hl-list.on{display:flex}',
    // 展开态只记在清单自己身上，箭头朝向由它派生，省掉一处 JS 写文案
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

    /* 一键整理面板 */
    '#gth-collect{position:fixed;inset:0;z-index:100002;background:rgba(15,23,42,.45);',
    'display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}',
    '#gth-collect[hidden]{display:none}',
    '.gthc-box{background:var(--gth-bg);border-radius:14px;width:min(880px,100%);max-height:86vh;',
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

    /* ---- 划线的批注（Word 式） ---- */
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

    '#gth-hlmenu{position:fixed;z-index:100004;display:flex;flex-direction:column;gap:2px;padding:6px;',
    'background:var(--gth-bg);border:1px solid var(--gth-border);border-radius:10px;min-width:172px;',
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
    '.gth-hln-box{background:var(--gth-bg);border:1px solid var(--gth-border);border-radius:12px;',
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

    /* 右侧页边距的批注气球：锚定到划线所在行，Word 批注的观感 */
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

  // 助手视图：先挂在 body 上以便立即绑定事件，注入时再整体移入 .right-content
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

    // ---- 共用筛选区（导出 / 重练两个 pane 的；笔记 pane 用自己那一排）----
    '    <div id="gth-shared">',
    '      <div class="gth-row" id="gth-src-row">',
    '        <label>来源</label>',
    '        <select id="gth-src" class="gth-select">',
    '          <option value="error">错题本</option>',
    '          <option value="favorite">收藏夹</option>',
    '          <option value="both">两者合并</option>',
    '          <option value="mock">模考收录</option>',
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

    // ---- 导出 ----
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

    // ---- 重练 ----
    '    <div data-pane="practice" hidden>',
    '      <div class="gth-row">',
    '        <label>来源</label>',
    '        <div class="gth-dd" id="gth-src-dd">',
    // 复用 .gth-select 的背景箭头，别再加一个 svg，否则两只箭头叠在一起
    '          <button type="button" class="gth-select gth-dd-btn" id="gth-src-dd-btn">',
    '            <span id="gth-src-dd-label">错题本</span></button>',
    '          <div class="gth-dd-menu" id="gth-src-dd-menu" hidden>',
    '            <label class="gth-dd-opt"><input type="checkbox" data-src="error"><span>错题本</span></label>',
    '            <label class="gth-dd-opt"><input type="checkbox" data-src="favorite"><span>收藏夹</span></label>',
    '            <label class="gth-dd-opt"><input type="checkbox" data-src="mock"><span>模考收录</span></label>',
    '          </div>',
    '        </div>',
    '        <label>题量</label>',
    '        <input id="gth-num" class="gth-input" type="number" min="0" max="500" step="1" value="20" style="width:84px">',
    '        <select id="gth-order" class="gth-select">',
    '          <option value="random">随机</option>',
    '          <option value="asc">原序</option>',
    '          <option value="desc">倒序</option>',
    '        </select>',
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

    // ---- 笔记 ----
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

  // 批注轨道：脱离题目滚动容器，靠 JS 镜像其位置并跟随 scrollTop
  var railEl = document.createElement('div');
  railEl.id = 'gth-rail';
  railEl.className = 'gth-rail';
  railEl.hidden = true;
  railEl.innerHTML = '<div class="gth-rail-in" id="gth-rail-in"></div>';
  document.body.appendChild(railEl);

  var statusEl = $('#gth-status');

  function setStatus(msg, kind) {
    if (!msg) { statusEl.hidden = true; statusEl.textContent = ''; statusEl.className = ''; return; }
    statusEl.hidden = false;
    statusEl.textContent = msg;
    statusEl.className = kind || '';
  }

  /* 拉题 / 组卷是几十秒级的异步活。按钮不置灰的话，用户看着界面没动就再点一次，
     同一批题就被并发拉两遍（模考那条路有 mockCollecting 挡着，导出与组卷这两条原来没有）。
     用两段 then 而不是 finally：这份脚本通篇不依赖新式 API。 */
  function busy(btn, p) {
    if (!btn) return p;
    btn.disabled = true;
    return p.then(function (v) { btn.disabled = false; return v; },
                  function (e) { btn.disabled = false; throw e; });
  }

  // 选中的行测模块名；空数组表示「全部模块」
  var selectedModules = [];
  var moduleList = [];
  /* 行测模块表的取题门：modulesLoading 挡住同一次里的并发，modulesLoaded 挡住「站点返回空表」
     时反复重发。失败不置 loaded，所以下一次用户动作（切科目、开面板）还会重试——
     这两个门是必要的，因为观察器一度每次站点重绘都跑一遍 syncFilterUI。 */
  var modulesLoading = false;
  var modulesLoaded = false;
  // 重练面板勾选的来源（导出面板仍用 #gth-src 单选），以及模考模块勾选
  var practiceSrcs = ['error'];
  var practiceSrcTouched = false;
  var selectedMockModules = [];

  var SRC_KEYS = ['error', 'favorite', 'mock'];   // both 不在其中：它只是导出单选里的历史值，由 srcList 展开
  var SRC_NAME = { error: '错题本', favorite: '收藏夹', both: '错题+收藏', mock: '模考收录' };

  // 来源写进描述里：刷题进度 resumeKey 与组卷历史都靠这串字区分条件
  function filterDesc(f) {
    var srcs = srcList(f);
    var parts = [];
    var site = srcs.filter(function (s) { return s !== 'mock'; });
    if (site.length) {
      parts.push(srcLabel(site) + ' · ' +
        (f.mode === 'date' ? '日期：' + dayLabel(f.dayRange) : subjectDesc(f)));
    }
    // 模考题没有科目也没有日期（站点接口不提供），唯一能筛的维度是模块
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

  // 两组模块 chips（行测考点来自站点接口，模考考点来自本地收录）共用同一套渲染与交互
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
    // 先剪掉不再存在的勾选（收录被清空时也要剪），否则残留的模块名会变成看不见的筛选
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
    $('#gth-shared').hidden = pane === 'notes';
    $('#gth-src-row').hidden = pane === 'practice';
    var srcs = srcList({ srcs: pane === 'practice' ? practiceSrcs : [currentSrc()] });
    var siteOn = hasSiteSrc(pane === 'practice' ? practiceSrcs : [currentSrc()]);
    // 只勾模考收录时，日期 / 科目 / 行测模块都不参与取题，收起来——摆着能点却不生效就是「看着能筛其实无效」
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
      // 结构诊断：若模块 chips 仍非预期，可据此定位真实层级
      console.log('[错题助手] 行测模块：', moduleList.map(function (m) { return m.name; }),
        '｜原始 subcategory_list：', list.map(function (c) {
          return c.name + ' × ' + (c.exampoint_list || []).length;
        }).join(' / '));
      renderModChips();
    }).catch(function (e) {
      modulesLoading = false;   // 失败不置 modulesLoaded：下一次用户动作还会再取
      setStatus('行测模块加载失败：' + e.message, 'err');
    });
  }

  /* ---------- 重练面板的来源多选：勾选式下拉，选中态存在 practiceSrcs ---------- */

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
  // 点下拉外面就收起：菜单是绝对定位的浮层，不收会压住下面的组卷历史
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

  /* ---------- 笔记 tab 自己的筛选条：数据全在本地，套不上站点那套来源/范围 ---------- */

  var notesFilter = { subj: '', mod: '', src: '', mast: '', cont: '' };
  var notesShownIds = [];   // 上一次渲染实际列出的题目 id，「一键整理 / 导出笔记」跟着它走

  // 列表被收窄过没有——关键词框也算，否则「搜一个不匹配的词再点一键整理」会去整理全部
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

  // 一条笔记（或一组划线）在本地能查到的全部筛选维度，缺的都落到「未记录」
  function noteFacets(id) {
    var n = store.notes[id] || {};
    var hls = getHighlights(id);
    var subj = n.subject != null ? n.subject : (hls[0] && hls[0].subject);
    return {
      subj: subj == null ? 'x' : String(subj),
      mod: moduleOf(id) || MOCK_UNCLS,
      src: store.mockQs[id] ? 'mock' : 'site',
      mast: masteryKey(id),
      hasNote: !!n.text,
      hasHl: hls.length > 0
    };
  }

  function noteMatch(r, nf) {
    if (nf.subj && r.subj !== nf.subj) return false;
    if (nf.mod && r.mod !== nf.mod) return false;
    if (nf.src && r.src !== nf.src) return false;
    if (nf.mast && r.mast !== nf.mast) return false;
    if (nf.cont === 'note' && !r.hasNote) return false;
    if (nf.cont === 'hl' && !r.hasHl) return false;
    if (nf.cont === 'both' && !(r.hasNote && r.hasHl)) return false;
    return true;
  }

  // 模块下拉的候选从这批笔记题的模块里来，而不是站点的考点表：只列真筛得出东西的值
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
    // 这一维要靠「按科目 + 行测」拉过一次题才登记得上。有笔记却一条模块都没有时，
    // 下拉里只有「全部模块 / 模块未记录」两项——不说清就是「看着能筛，其实筛不出东西」
    setIf($('#gth-nf-mod-hint'), 'hidden', !ids.length || Object.keys(names).length > 0);
  }

  ['gth-nf-subj', 'gth-nf-mod', 'gth-nf-src', 'gth-nf-mast', 'gth-nf-cont'].forEach(function (id) {
    $('#' + id).addEventListener('change', function () { readNotesFilter(); renderNotesList(); });
  });

  /* ---------- 入口：注入到左侧菜单「公安专业知识」下方，并作为原生视图切换 ---------- */

  var viewOn = false;
  var panelRev = -1;   // 面板内容最后一次画的是哪个 storeRev；-1 = 还没画过

  // 助手生效的路由：错题页（#/error）与收藏页（#/shoucang）。两页模板同构，
  // 左侧菜单同样是「日期 / 行政职业能力测试 / 公安专业知识」三个二级标签。
  function routeKind() {
    var h = location.hash || '';
    if (h.indexOf('#/error') === 0) return 'error';
    if (h.indexOf('#/shoucang') === 0) return 'collect';
    return '';
  }
  function isCollectRoute() { return routeKind() === 'collect'; }
  function isListRoute() { return !!routeKind(); }

  // 切换助手视图：与站点原生右侧内容互斥显示，左菜单同步高亮。
  // 可重复调用（AngularJS 重绘后需重新压住原生内容），因此不做「状态未变就返回」的短路。
  /* 面板的「壳」：站点重绘之后必须重贴的东西——原生二级菜单与内容的隐藏类、被 AngularJS
     换掉的 right-content 里重新安家、入口高亮。这部分只跟 DOM 有关，每次观察器跑都要重做。 */
  function applyViewChrome(on) {
    var rc = $('.gongan2-container .right-content') || $('.right-content');
    if (rc) {
      // .inner-content 带 zero-flex-* 会设置 display，必须用 !important 类隐藏
      $$('.second-menu, .inner-content', rc).forEach(function (el) { el.classList.toggle('gth-hide', on); });
      if (viewEl.parentNode !== rc) rc.appendChild(viewEl);
    }
    viewEl.hidden = !on;
    document.body.classList.toggle('gth-view-on', on);

    var entry = $('.gth-menu-item');
    if (entry) entry.classList.toggle('active', on);
  }

  /* 面板的「内容」：只读 store 的那两处（组卷历史、增量导出提示）。
     打开面板必须画一次；之后只有 store 真变过才画——见 storeRev。 */
  function renderPanel() {
    panelRev = storeRev;
    renderHistory();
    updateExportHint();
  }

  function setView(on) {
    viewOn = on;
    applyViewChrome(on);
    if (on) {
      renderPanel();
      syncFilterUI();   // 面板刚打开时按当前 tab 决定筛选行显示哪几排
    }
    syncRail();
  }

  function injectMenuEntry() {
    var menu = $('.gongan2-container .left-menu') || $('.left-menu');
    var existing = $('.gth-menu-item');
    var kind = routeKind();
    // 非错题页 / 收藏页不注入入口，并清掉遗留的入口
    if (!kind) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    if (!menu) return;
    // 两页共用同一个入口，名字也统一：这里不再按路由换标题，切回来什么都不用重画
    if (existing && menu.contains(existing)) return;

    var items = $$('.item', menu);
    var anchor = null;
    for (var i = 0; i < items.length; i++) {
      if ((items[i].textContent || '').indexOf('公安专业知识') >= 0) { anchor = items[i]; break; }
    }
    if (!anchor) return;

    var btn = document.createElement('div');
    btn.className = 'item zero-flex-ver-center gth-menu-item';
    btn.innerHTML = '<div class="text">' + icon('sparkles') + '机考助手</div>';
    btn.title = '笔记 / 导出 / 重练 / 掌握状态';
    btn.addEventListener('click', function () { setView(!viewOn); });

    if (anchor.nextSibling) menu.insertBefore(btn, anchor.nextSibling);
    else menu.appendChild(btn);
    if (viewOn) btn.classList.add('active');
  }

  // 点击原生二级标签（日期 / 行政职业能力测试 / 公安专业知识）时交还原生内容。
  // 必须显式关闭：这些标签切换时不改变路由，仅靠 hashchange 感知不到；
  // 而 viewOn 若保持为 true，观察器会持续重新隐藏原生内容，导致二级标签打不开。
  document.addEventListener('click', function (e) {
    if (!viewOn) return;
    var it = e.target && e.target.closest && e.target.closest('.left-menu .item');
    if (it && !it.classList.contains('gth-menu-item')) setView(false);
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
      syncFilterUI();   // 筛选行按 pane 变
    });
  });

  // 筛选条件一变，之前缓存的题目就作废，下次导出 / 备份会按新条件重新拉
  function invalidateLoaded() { loaded.filter = null; loaded.list = []; }

  $('#gth-mode').addEventListener('change', function () { invalidateLoaded(); syncFilterUI(); });
  $('#gth-subject').addEventListener('change', function () { invalidateLoaded(); syncFilterUI(); });
  $('#gth-day').addEventListener('change', invalidateLoaded);
  $('#gth-order').addEventListener('change', renderPracticeHint);
  $('#gth-src').addEventListener('change', function () {
    $('#gth-src').dataset.touched = '1';
    invalidateLoaded();
    updateExportHint();
    syncFilterUI();   // 选到「模考收录」时要把模考模块那一排 chips 露出来
  });

  // 默认来源跟随当前页面：错题页默认错题本、收藏页默认收藏夹（用户手动改过就不再自动切）
  function syncSourceDefault() {
    var el = $('#gth-src');
    if (!el || el.dataset.touched) return;
    var want = isCollectRoute() ? 'favorite' : 'error';
    // 来源跟着页面换了就得自己把提示语换掉：观察器那一路现在只管 store 变了才重画面板
    if (el.value !== want) { el.value = want; invalidateLoaded(); updateExportHint(); }
    if (!practiceSrcTouched && practiceSrcs.join() !== want) {
      practiceSrcs = [want];
      invalidateLoaded();
      renderPracticeSrc();
    }
  }

  var loaded = { filter: null, list: [] };

  // ---- 增量导出：本地按来源记录「已导出过的题目 id」，只导出从未导出过的题 ----

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

  /* 每个来源都要有一项：少了它 runExport 会静默落到默认前缀上，用户在下载目录里
     看不出这批是不是模考那一批——只有表格里的「来源」列能区分。名字跟着导出面板上
     那个勾选项（SRC_NAME.mock）走，不另起一套叫法。 */
  var EXPORT_PREFIX = {
    error: '上岸村错题_', favorite: '上岸村收藏_', both: '上岸村错题收藏_', mock: '上岸村模考收录_'
  };

  function runExport(list, tag) {
    var fmt = $('#gth-fmt').value;
    var name = (EXPORT_PREFIX[currentSrc()] || '上岸村错题_') + tag + '_' + stamp();
    if (fmt === 'md') download(name + '.md', exportMarkdown(list));
    else if (fmt === 'csv') download(name + '.csv', exportCsv(list));
    else download(name + '.xlsx', exportXlsx(list));
  }

  // 首次导出时按当前筛选自动载入题目，省掉单独的「加载」按钮
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
    // 列表被收窄时只导出看得见的题，否则「筛完再导出」会把被筛掉的也带上
    var ids = notesNarrowed() ? notesShownIds.slice() : null;
    if (ids && !ids.length) { setStatus('当前条件下没有笔记可导出', 'err'); return; }
    if (!ids && !Object.keys(store.notes).length) { setStatus('暂无笔记可导出', 'err'); return; }
    download('上岸村错题_笔记_' + stamp() + '.md', exportNotesMarkdown(ids));
  });

  $('#gth-collect-open').addEventListener('click', function () {
    if (!notesNarrowed()) { openCollect(null); return; }   // null = 不限题，整理全部
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

  // 一键清空本脚本写入浏览器 localStorage 的全部数据
  $('#gth-wipe').addEventListener('click', function () {
    var nNote = Object.keys(store.notes).length;
    var nStat = Object.keys(store.mastered).length;
    var nExp = ['error', 'favorite', 'both', 'mock'].reduce(function (a, k) {
      return a + Object.keys(exIds(k)).length;
    }, 0);
    var nHis = (store.history || []).length;
    var nRes = Object.keys(store.resume || {}).length;
    var nMock = Object.keys(store.mockQs || {}).length;
    var nAux = Object.keys(store.practiced || {}).length + Object.keys(store.qModule || {}).length;
    if (!nNote && !nStat && !nExp && !nHis && !nRes && !nMock && !nAux) { setStatus('本地数据已为空', ''); return; }
    if (!confirm(
      '将删除本脚本存在此浏览器中的全部数据：\n' +
      '· 笔记 ' + nNote + ' 条\n' +
      '· 掌握记录 ' + nStat + ' 条\n' +
      '· 答错次数统计\n' +
      '· 增量导出记录 ' + nExp + ' 题\n' +
      '· 组卷历史 ' + nHis + ' 条\n' +
      '· 刷题进度 ' + nRes + ' 处\n' +
      '· 模考收录 ' + nMock + ' 题（连带重练登记与模块记录）\n\n' +
      '此操作不可恢复。建议先点「备份全部数据」再清空。\n\n确定继续？'
    )) return;
    store.notes = {};
    store.mastered = {};
    store.wrongCount = {};
    store.exported = { _v: 2, error: {}, favorite: {}, both: {}, mock: {} };
    store.exportAt = { error: 0, favorite: 0, both: 0, mock: 0 };
    store.history = [];
    store.resume = {};
    store.mockQs = {};
    store.mocks = {};
    store.practiced = {};
    store.qModule = {};
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

  var notesSearchKey = '';
  var gthNoteEditing = false;   // 编辑器中途打开时，任何 renderNotesList 都跳过，避免被观察器/其他保存冲掉
  var openNoteBox = null;       // 当前打开的笔记编辑器（单编辑器约束，防止多个框叠加）
  $('#gth-note-search').addEventListener('input', debounce(function (e) {
    notesSearchKey = e.target.value;
    renderNotesList();
  }, 150));

  function renderNotesList() {
    if (gthNoteEditing) return;   // 编辑中途不重绘，防止正在输入的 textarea 被冲掉
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
      // 用户不认识题目 ID，搜索只针对笔记内容、题干快照与划线原文
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

  // 单编辑器约束：任何时候只保留一个编辑框
  function closeNoteEditor(s) {
    if (!s) return;
    s.box.remove();
    if (s.textEl && s.textEl.isConnected) s.textEl.style.display = '';
    gthNoteEditing = false;
  }

  function openNoteEditor(id, itemEl) {
    // 同一道题再次点击「编辑」：聚焦已有框，不重复创建
    if (openNoteBox && openNoteBox.itemEl === itemEl) {
      var t0 = $('textarea', openNoteBox.box);
      if (t0) t0.focus();
      return;
    }
    closeNoteEditor(openNoteBox);   // 切换到别的笔记前，先关掉上一个，避免叠加
    blurEditors('panel');           // 同时收掉批注栏 / 划线的编辑器（焦点切换）
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
      gthNoteEditing = false;   // 解除重绘保护，否则 renderNotesList 会被拦截、列表不刷新
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

  // ---- 笔记批注栏：吸附在题目右侧页边距，默认只读，点击可二次编辑 ----

  var itemsById = {};   // 恢复 / 清空后据此重绘批注

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
    // 幂等：内容没变就一个字都不写。观察器每次唤醒都会走到这里，而重写 innerHTML
    // 既会喂给 MutationObserver 形成 400ms 往复循环，又会把展开的划线清单、
    // 正在编辑的批注框「一瞬间收回」。只在真的变了（或刚从编辑态退出）时才重绘
    if (el.dataset.gthHtml === html && !wasEditing) return;
    el.dataset.gthHtml = html;
    var keepOpen = el.dataset.hlOpen === '1';   // 展开状态不在 HTML 里，重绘后要还原
    el.innerHTML = html;
    if (keepOpen) {
      var hlList = $('.gth-aside-hl-list', el);
      if (hlList) hlList.classList.add('on');   // 箭头朝向由 CSS 跟着 .on 转，这里不再写文案
    }
    var ed = $('[data-act="edit"]', el), ad = $('[data-act="add"]', el);
    if (ed) ed.addEventListener('click', function () { editAside(el, item); });
    if (ad) ad.addEventListener('click', function () { editAside(el, item); });
    bindAsideHl(el, item);
  }

  // 批注栏里的划线清单：内联展开，因为轨道容器 overflow:hidden 会裁掉浮层
  function asideHlHtml(id) {
    var list = getHighlights(id);
    if (!list.length) return '';
    // 收起态只报条数。轨道压到 clamp 下限 160px 时「（黄 x · 红 y）」会把这行挤成两行，
    // 而颜色在展开后的清单里每条前面都有圆点——收起态要回答的只是「要不要点开」
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
      el.dataset.hlOpen = on ? '1' : '';   // 记住展开状态，重绘后由 renderAside 还原
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
    try { ta.setSelectionRange(p, p); } catch (err) { /* 某些输入类型不支持 */ }
    ta.focus();
  }

  function closeAsideEditor() {
    $$('.gth-aside[data-editing="1"]').forEach(function (a) {
      var it = itemsById[a.dataset.id];
      if (it) renderAside(a, it);
      else a.dataset.editing = '';
    });
  }

  /* 焦点切换：三处笔记编辑器（题目批注栏 / 划线的批注浮层 / 笔记列表里的编辑框）
     同一时刻只保留一个。否则划线的批注浮层会压住批注栏，两个 textarea 还会抢输入焦点。
     keep 传本次要留下的那一个，其余全部收起 */
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
        subject: item.content_type
      });
      renderAside(el, item);
      refreshBadges();
      renderNotesList();
    });
    $('[data-act="cancel"]', el).addEventListener('click', function () { renderAside(el, item); });
  }

  // 只在真的变了才写 DOM。徽章的文案/图标每次都是同一份，无脑重写会不停惊动
  // MutationObserver（→ refreshPageUI → 又一轮重绘）
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
      // 没做过也没标记过的题，未掌握没有信息量，弱化成幽灵样式；但它仍可点（点一下就标记已掌握）
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
        // 收藏页里从没做过的题：不谎报「答错 1 次」。错题本里的题必然错过一次，所以那边照旧从 1 起算
        setIf(errEl, 'hidden', true);
        setIf(errEl, 'className', 'gth-err');
        setIf(errEl, 'innerHTML', '');
      }
    });
    // 恢复 / 清空本地数据后同步刷新已渲染的批注
    rerenderAsides();
  }

  function errCountFor(id, serverVal, kind) {
    var s = Number(serverVal) || 0;
    if (s) return s;
    var local = (store.wrongCount && store.wrongCount[id]) || 0;
    if (kind === 'collect') return local ? local + WRONG_BASE : 0;
    return local + WRONG_BASE;
  }

  // 手动掌握开关：与自动判分共用同一份 mastered 记录，只是直接把连对次数顶到阈值。
  // 标记时留 manual 记号，日后重练交卷仍按自动规则走（答错清零、答对递增）
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
  }

  // 操作条的「笔记」按钮：滚到这道题，并把右侧批注栏切到编辑态
  function focusNote(item) {
    if (viewOn) setView(false);
    var id = String(item.id);
    var aside = $('#gth-rail-in .gth-aside[data-id="' + id + '"]');
    if (!aside) { toast('批注栏还没就绪，稍后再点一次'); return; }
    var content = railContent(), node = qNodes[id];
    if (node && node.isConnected) {
      // 以「可见切片顶部」为基准滚动，错题页的内滚动盒与收藏页的页面滚动都适用
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

  /* ---------- 批注轨道：镜像题目滚动容器的位置，跟随其 scrollTop ---------- */

  // 必须用子选择器：题目区里也有 .content（题干那一层），用后代选择器会在收藏页
  // 误命中第一道题的题干。错题页的滚动层是 .inner-content 的直接子节点
  var CONTENT_SEL = '.gongan2-container .right-content .inner-content > .content';
  var qNodes = {};   // 题目 id -> ng-repeat 节点

  // 错题页的列表包在 .content（height:600px;overflow:scroll）里，收藏页没有这层包裹，
  // 所以滚动容器要动态解析，不能写死选择器
  function railContent() {
    return $(CONTENT_SEL) ||
      $('.gongan2-container .right-content .inner-content') ||
      $('.right-content .inner-content');
  }

  // 往上找真正在滚动的那个祖先；返回 null 表示列表不自己滚、跟着页面整体滚动
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

  /* 轨道的坐标模型：不猜「谁在滚」，只算「列表当前露出哪一段视口」。
     错题页的列表在 600px 的内部滚动盒里，收藏页没有那层包裹、跟着页面滚，
     两种情况下用同一套算法都能对齐：
       可见切片 top = max(列表盒子 top, 0)，bottom = min(盒子 bottom, 视口高)
       批注框 top   = 题目矩形 top − 可见切片 top                            */
  var railFrame = null;   // {rect, top, height}
  var railRaf = 0;

  function railVisible() {
    var content = railContent();
    if (!content) return null;
    var r = content.getBoundingClientRect();
    if (!r.height) return null;                       // 切到助手视图时原生内容被隐藏
    var top = Math.max(r.top, 0);
    var bottom = Math.min(r.bottom, window.innerHeight);
    if (bottom - top < 40) return null;               // 只剩一条缝时不摆东西
    return { rect: r, top: top, height: bottom - top };
  }

  // 只读布局 + 写 top，按 rAF 节流，可以挂在 scroll 上
  function placeRailItems() {
    var inner = $('#gth-rail-in');
    if (railEl.hidden || !railFrame || !inner) return;
    $$('.gth-aside', inner).forEach(function (a) {
      var node = qNodes[a.dataset.id];
      if (node && node.isConnected) {
        a.hidden = false;
        a.style.top = Math.round(node.getBoundingClientRect().top - railFrame.top) + 'px';
      } else {
        a.hidden = true;   // 题目已从列表移除 / 节点还没就绪，别在轨道里留无主的「鬼影」框
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
        // 页面整体滚动时列表盒子的 top 会变，轨道几何要跟着走
        railEl.style.top = Math.round(f.top) + 'px';
        railEl.style.height = Math.round(f.height) + 'px';
      }
      railFrame = f;
      placeRailItems();
    });
  }

  function syncRail() {
    var rail = railEl, inner = $('#gth-rail-in');
    if (!isListRoute() || !inner) { rail.hidden = true; railFrame = null; return; }

    // 滚动可能发生在内部容器（错题页的 .content），也可能发生在页面本身（收藏页）。
    // capture 阶段的监听能同时收到两者，不必再猜哪个元素在滚
    if (!document.body.dataset.gthRailScroll) {
      document.body.dataset.gthRailScroll = '1';
      document.addEventListener('scroll', onRailScroll, { capture: true, passive: true });
    }
    var content = railContent();
    if (content && !content.dataset.gthRailLoad) {
      content.dataset.gthRailLoad = '1';
      content.addEventListener('load', syncRail, true);   // 图片加载后行高变化需重新对齐
    }

    var f = railVisible();
    if (!f) { rail.hidden = true; railFrame = null; return; }
    railFrame = f;
    /* 宽度按「可视区右缘 − 落点」现算。CSS 里那个 clamp(160px, (100vw-1000px)/2 - 24px, 280px)
       把可用空间当成「容器右缘到视口右缘」，可落点其实是内容区右缘 + 24（内容在容器里还要减去
       左菜单与内边距），窄视口下限 160px 会把整张卡推到屏幕外——实测卡片右缘 1166 越过了
       clientWidth，elementsFromPoint 在那个点上取不到任何元素。
       挤不下就不摆：宁可没有批注栏，也不要一张切在屏幕边上的。
       （注：这一条修的不是「箭头看着像两个叠在一起」——那个是类名与 bootstrap 全局 .caret
       撞车，见样式表里 .gth-caret 上面的说明。我当时把两件事当成了一件，白改了两轮。） */
    var railLeft = Math.round(f.rect.right + 24);
    var avail = (document.documentElement.clientWidth || window.innerWidth) - railLeft - 8;
    if (avail < 120) { rail.hidden = true; railFrame = null; return; }
    rail.hidden = false;
    rail.style.left = railLeft + 'px';
    rail.style.width = Math.min(280, avail) + 'px';
    rail.style.top = Math.round(f.top) + 'px';
    rail.style.height = Math.round(f.height) + 'px';
    inner.style.transform = 'none';   // 老版本用 translate 跟随滚动，现在改按可视区算绝对坐标
    placeRailItems();
  }

  function injectListUI() {
    if (!isListRoute()) return;
    var ang = getAngular();
    if (!ang) return;
    var railInner = $('#gth-rail-in');
    if (!railInner) return;
    $$('[ng-repeat="item in subjectList"]').forEach(function (node) {
      if (node.dataset.gth) return;
      var item = null;
      try { item = ang.element(node).scope().item; } catch (e) { return; }
      if (!item || !item.id) return;
      // 防同一道题在轨道里出现多个批注栏：
      // 节点被站点重渲染替换（带图题目常见，图片加载/布局变化触发 digest）时，旧的 aside 会残留在轨道里。
      // 用 item.id 作为稳定键去重。
      railInner.querySelectorAll('.gth-aside[data-id="' + item.id + '"]').forEach(function (a) { a.remove(); });
      node.dataset.gth = '1';
      // 划线的定位根：paintRoot 靠它把题目 id 和 DOM 子树对上
      node.setAttribute('data-gth-qid', item.id);
      itemsById[item.id] = item;
      qNodes[item.id] = node;
      if (!probed) { probed = true; probeFields([item]); }

      var bar = document.createElement('div');
      bar.className = 'gth-qbar';
      bar.dataset.id = item.id;
      bar.dataset.kind = routeKind();
      bar.dataset.serverErr = serverErrCount(item);
      // 节点被站点重渲染替换时，旧的 qbar 还挂在原节点上。重新挂之前先清掉同题旧 qbar，避免重复
      $$('.gth-qbar[data-id="' + item.id + '"]').forEach(function (b) { b.remove(); });
      bar.innerHTML =
        '<span class="gth-err"></span>' +
        '<span class="gth-badge"></span>' +
        '<span class="sp"></span>' +
        '<button class="gth-qbar-btn gth-qbar-note" type="button" title="写 / 改这道题的笔记">' +
        icon('pencil') + '笔记</button>' +
        '<button class="gth-qbar-btn gth-qbar-copy" type="button" data-id="' + esc(item.id) + '">' +
        icon('copy') + '复制题目</button>';

      bar.querySelector('.gth-qbar-copy').addEventListener('click', function (e) {
        e.stopPropagation();   // 防止站点原有点击展开/收起等行为被误触
        var btn = e.currentTarget;
        var it = itemsById[btn.dataset.id];
        if (!it) return;
        var ok = copyText(copyQuestion(it));
        btn.classList.add('copied');
        btn.innerHTML = (ok ? icon('check') : icon('xCircle')) + (ok ? '已复制' : '复制失败');
        setTimeout(function () {
          btn.classList.remove('copied');
          btn.innerHTML = icon('copy') + '复制题目';
        }, 1200);
      });

      // 掌握状态：手动开关。站点的掌握度只由重练交卷驱动，而收藏页根本没有交卷场景，
      // 没有手动入口的话两处徽标就只是装饰，收藏题永远停在「未掌握」
      bar.querySelector('.gth-badge').addEventListener('click', function (e) {
        e.stopPropagation();
        toggleMastery(item.id);
      });

      // 笔记入口：滚到这道题，并直接展开右侧批注栏的编辑器
      bar.querySelector('.gth-qbar-note').addEventListener('click', function (e) {
        e.stopPropagation();
        focusNote(item);
      });

      var aside = document.createElement('div');
      aside.className = 'gth-aside';
      aside.dataset.id = item.id;
      renderAside(aside, item);

      // 操作条挂在 ng-repeat 节点的第一个子节点位置，也就是 .question-box（材料 + 题干）之前。
      // 之前是 appendChild，落在解析之后，等于「整道题看完才看见控件」
      node.insertBefore(bar, node.firstChild);
      railInner.appendChild(aside);
    });
    refreshBadges();
  }

  // 只写属性不惊动观察器：body 上那个 MutationObserver 只 observe childList，属性不在它眼里
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
    e.preventDefault();   // 空格落在这些元素上不该把页面滚走
    t.click();
  });

  // 错题列表与左侧菜单均由 AngularJS 异步渲染，用观察器在重绘后补回
  var refreshPageUI = debounce(function () {
    if (isMocksPage()) { mocksScanTick(); return; }   // mocks 页只做模考收录扫描，下面是 gongan 页的活
    injectListUI();
    injectMenuEntry();
    /* 原生内容被 AngularJS 重绘后会丢掉隐藏类，壳要重贴；面板内容只读 store，所以按
       storeRev 决定要不要重画。原来这里走的是面板的完整开启流程：站点每变一次就把组卷历史
       整段 innerHTML 重写、监听重绑，展开的下拉和刚聚焦的控件一起被抹掉，还顺带每次重发一遍
       行测模块请求。批注栏对位本来就在下一行，这里不再重复。 */
    if (viewOn) {
      applyViewChrome(true);
      if (storeRev !== panelRev) renderPanel();
    }
    syncRail();
    repaintHighlights();   // 站点重绘后按锚点把划线重新落笔（自带幂等签名，不会往复触发）
    syncBalloons();        // 划线重画后，右侧页边距的批注气球要跟着重新对位
    syncKeyTargets();      // 上面这些重绘会新建出带 click 的节点，键盘可达要补回来
  }, 400);

  new MutationObserver(refreshPageUI).observe(document.body, {
    childList: true, subtree: true
  });
  window.addEventListener('resize', syncRail);
  // 首次注入不在这里跑：那时后面还有一批 `var X = {}` 没赋值（syncBalloons 读 balloonEls
  // 就是在这一步 Object.keys(undefined) 抛错，把整个脚本的后半段——含划线条——一起带走）。
  // 统一挪到 IIFE 末尾，见文件最后。

  /* ================= 划线交互：选中即划 ================= */

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

  // 这些区域不允许划线：插件自己的 UI、输入控件、答题页的导航与答题卡
  var HL_BLOCK_SEL = '#gth-hlbar,#gth-collect,#gth-toast,#gth-rail,.gth-aside,.gth-view,' +
    '#gth-quiz .gthq-top,#gth-quiz .gthq-sheet,#gth-quiz .gthq-nav,textarea,input,select';

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

  // 选区必须在这里就被抓成快照：一点工具条按钮，浏览器选区就没了
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

  // 取（必要时先建）选区对应的那条划线。已有一条完整覆盖选区的就复用，不重复建
  function ensureHl(p, color) {
    var hits = hlOverlap(p.ctx.root, p.start, p.end, null);
    if (hits.length === 1) return { qid: p.ctx.qid, idx: hits[0], reused: true };
    var rec = addHighlight(p.ctx.qid, p.quote, p.start, color || 'yellow');
    if (!rec) return null;
    var list = store.highlights[p.ctx.qid] || [];
    return { qid: p.ctx.qid, idx: list.length - 1, reused: false };
  }

  /* Word 式切换：对选区再点一次「同色」= 取消这段的划线；点别的颜色 = 改色 */
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
    if (top < 8) top = r.bottom + 8;          // 顶部放不下就翻到选区下方
    var left = Math.max(8, Math.min(r.left + r.width / 2 - bw / 2, window.innerWidth - bw - 8));
    hlBar.style.left = left + 'px';
    hlBar.style.top = top + 'px';
  }

  hlBar.addEventListener('mousedown', function (e) { e.preventDefault(); });   // 保住选区
  /* 划线动作的唯一入口：选中后点工具条、或按 Alt+1/2/3，走的都是这条。
     act = 'note'（挂批注）或颜色。 */
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
    if (btn.dataset.act === 'copy') { copyText(p.quote); toast('已复制'); hideBar(); return; }
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

  /* 点已划线的文字（无选区）→ 弹出这条划线的菜单：批注 / 改色 / 取消划线 */
  document.addEventListener('mouseup', function (e) {
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;      // 有选区时归工具条处理
    var mk = e.target && e.target.closest && e.target.closest('mark.gth-hl');
    if (!mk) { closeHlMenu(); return; }
    var root = mk.closest('[data-gth-qid]');
    if (!root || mk.dataset.gthI == null) return;
    openHlMenu(root.getAttribute('data-gth-qid'), Number(mk.dataset.gthI), mk.getBoundingClientRect());
  });

  /* ================= 划线的批注与取消（Word 式） ================= */

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
    blurEditors('hlmenu');   // 焦点切换：先收起别的编辑器
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
    blurEditors('hlnote');   // 焦点切换：批注栏的笔记框同时只留一个
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

  // 一处划线变动后，把所有「看到划线」的界面一起刷新
  function afterHlChange() {
    refreshBadges();
    renderNotesList();
    rerenderAsides();
    refreshQuizHl();
    syncBalloons();
  }

  function quizHlHtml(qid) {
    var list = getHighlights(qid);
    if (!list.length) return '';
    return '<div class="gth-hl-cap">' + icon('highlighter') + list.length + ' 条划线</div>' +
      list.map(function (h, i) { return hlRowHtml(h, i, '点击改批注'); }).join('');
  }

  function refreshQuizHl() {
    $$('#gth-quiz [data-hls]').forEach(function (box) {
      box.innerHTML = quizHlHtml(box.getAttribute('data-hls'));
    });
  }

  // 答题报告页里的划线清单：点文字写批注，点 ✕ 取消划线
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

  /* ---- 右侧页边距的批注气球：只在错题页，锚定到划线所在的那一行 ---- */

  /* 气球上一直挂着 cursor:pointer 却没有任何处理器，点它没反应。按 Word 的模型，
     页边那个框就是这条批注的化身，点它当然该改这条批注——所以接上，而不是把 pointer 摘掉。
     走的是页边清单里点一条时同一个 openHlNote。 */
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('.gth-balloon') : null;
    if (!el) return;
    var k = el.dataset.k || '', c = k.lastIndexOf(':');   // k 是 qid + ':' + 下标，qid 自己可能带冒号
    if (c <= 0) return;
    openHlNote(k.slice(0, c), Number(k.slice(c + 1)), el.getBoundingClientRect());
  });

  var balloonEls = {};

  function syncBalloons() {
    var inner = $('#gth-rail-in');
    // 助手视图打开 / 不在列表页时轨道没有可见切片，批注气球一并收起
    if (!inner || !isListRoute() || !railFrame) return;

    var want = {};
    Object.keys(store.highlights).forEach(function (qid) {
      if (!qNodes[qid]) return;   // 这道题不在当前列表里，没必要摆气球（也让滚动时的开销只跟当前列表有关）
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
      // 只在内容真的变了才写 innerHTML，否则会不停触发观察器造成往复重绘
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

    // 用 rect 相减得到「划线相对可见切片顶部」的偏移，与滚动位置无关
    rows.forEach(function (row) {
      row.top = null;
      var node = qNodes[row.qid];
      if (!node || !node.isConnected) return;
      var mk = $('mark.gth-hl[data-gth-i="' + row.idx + '"]', node);
      if (!mk) return;
      row.top = mk.getBoundingClientRect().top - railFrame.top;
      row.h = row.el.offsetHeight || 60;   // 先量高度，避免写 top 再读高度来回触发重排
    });

    rows.sort(function (a, b) {
      return (a.top == null ? 1e9 : a.top) - (b.top == null ? 1e9 : b.top);
    });
    var last = -1e9;
    rows.forEach(function (row) {
      if (row.top == null) { row.el.hidden = true; return; }   // 题目不在当前列表里
      row.el.hidden = false;
      var t = Math.max(row.top, last + 8);   // 简单纵向避让：紧跟上一条，不互相压住
      row.el.style.top = Math.round(t) + 'px';
      last = t + row.h;
    });
  }

  /* ================= 一键整理为笔记 ================= */

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

    // 按颜色归拢：把散在各题里的红色易错点收成一节，这才是划线真正的复习价值
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
      if (act === 'copy') { copyText($('#gthc-pre').textContent); toast('已复制到剪贴板'); return; }
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

  // 随机组卷先分层再抽（层内按答错次数加权，Efraimidis-Spirakis）：顽固错题 → 尚未重练 → 练过但没掌握 → 已掌握
  // 已掌握（含收藏页手动打勾的）排最后：用户说过「会了」的题不该再来占题量。
  function tierOf(q) {
    if (isMastered(q.id)) return 3;
    if (errCountOf(q) >= STUBBORN_MIN) return 0;
    if (!isPracticed(q.id)) return 1;
    return 2;
  }

  // 层内加权：key = 随机值^(1/errCountOf)，次数越大 key 越接近 1、排得越前。errCountOf 已含 WRONG_BASE，就是界面上显示的那个次数
  function weightedShuffle(arr) {
    return arr.map(function (q) {
      return { q: q, key: Math.pow(Math.random(), 1 / errCountOf(q)) };
    }).sort(function (a, b) { return b.key - a.key; })
      .map(function (x) { return x.q; });
  }

  function weightedPick(arr, k) {
    var n = (k && k < arr.length) ? k : arr.length;   // k=0 视为「全部」，仍按加权顺序打乱
    var tiers = [[], [], [], []];
    arr.forEach(function (q) { tiers[tierOf(q)].push(q); });
    return tiers.reduce(function (out, t) { return out.concat(weightedShuffle(t)); }, []).slice(0, n);
  }

  // ---- 顺序刷题进度（从上次继续）----
  // 键 = 筛选描述 + 顺序，值 = 该题在「完整有序列表」中的下标（0 起）
  function resumeKey(f, order) { return filterDesc(f) + '|' + order; }

  /* 续刷的键 = filterDesc + 顺序，而 filterDesc 里的来源标签早先写的是 SRC_NAME.both
     （「错题+收藏」），后来改成逐项拼（「错题本＋收藏夹」）。老库里那条按旧标签算出的键
     从此命不中：既接不上进度，「从头开始」也删不掉它。按旧写法再试一次，命中就搬成新键——
     用户「刷到第几题」保住，库里也不留一条永不命中的记录。
     约束：这两个名字（srcLabel 的拼法 / SRC_NAME.both）再变，这条自愈就够不着老键了。 */
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

  function saveResume(key, idx, id, answered) {
    if (!key) return;
    store.resume[key] = { idx: idx, id: id || '', at: Date.now(), answered: answered || {} };
    saveStore();
  }

  // 优先按题目 id 定位（列表变动时下标会漂移），找不到才退回记录的下标
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
    var seq = order !== 'random';                 // 只有顺序刷题记录 / 续用进度
    var key = seq ? resumeKey(f, order) : '';
    var r = seq ? readResume(key) : null;
    var desc0 = filterDesc(f);       // 按下这一刻的条件：取题期间面板上的筛选还能改，返回时要对得上
    // 续刷时要拉到「上次位置 + 题量」，否则只取到第一页会拿不到后面的题
    var want = !num ? 0 : ((r && r.idx) ? r.idx + num + 1 : num);
    setStatus('正在组卷…');
    busy(this, fetchByFilter(f, want).then(function (all) {
      if (!all.length) { setStatus('该条件下没有题目（来源：' + srcLabel(f.srcs) + '）', 'err'); return; }
      var ordered = order === 'desc' ? all.slice().reverse() : all;
      var offset = seq ? resumeOffset(key, ordered) : 0;
      var restarted = false;
      if (offset >= ordered.length) {            // 已刷到末尾，从头再来
        offset = 0;
        clearResume(key);
        restarted = true;
      }
      var picked = order === 'random'
        ? weightedPick(ordered, num)
        : (num ? ordered.slice(offset, offset + num) : ordered.slice(offset));
      if (!picked.length) { setStatus('没有可练习的题目', 'err'); return; }
      loaded.filter = f;                          // 供组卷历史复用同一筛选
      // 顺序刷题：若上次有「未作答」的题，这次先跳到第一道未作答的题接着做
      var startIdx = 0;
      if (seq && r && r.answered && picked.length) {
        for (var fu = 0; fu < picked.length; fu++) {
          if (!r.answered[String(picked[fu].id)]) { startIdx = fu; break; }
        }
      }
      var note = restarted ? '（已刷完，从头开始）'
        : ((offset + startIdx) ? '（从第 ' + (offset + startIdx + 1) + ' 题继续）' : '');
      setStatus('组卷完成，共 ' + picked.length + ' 题' + note, 'ok');
      /* 取题请求在飞的这段时间里筛选控件仍可改，而卷子是按按下那一刻的条件生成的。
         不把这一点说出来，重练界面顶上的条件就成了面板当前值的影子——看着是这次的，其实不是。 */
      if (filterDesc(readFilter('practice')) !== desc0) {
        toast('筛选在取题期间改过了：这份卷子按「' + desc0 + '」生成');
      }
      startQuiz(picked, filterDesc(f), false, seq ? (r && r.answered) : null);
      if (seq) {
        quiz.resumeKey = key;
        quiz.resumeBase = offset;
        quiz.idx = startIdx;
        // 立刻记录起始位置；沿用上次已作答记录，作为本次续刷的基准
        saveResume(key, offset + startIdx, picked[startIdx] && picked[startIdx].id, quiz.answeredIds);
      }
      renderQuiz();           // 用更新后的 idx 重新渲染，确保直接显示第一道未作答的题
      renderPracticeHint();
    }).catch(function (e) { setStatus('组卷失败：' + e.message, 'err'); }));
  });

  // ---- 组卷历史：滚动保留最近三次 ----

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

  // 重练面板的引导文案：随机说明分层规则，顺序提示续刷位置并可重置
  function renderPracticeHint() {
    var el = $('#gth-practice-hint'), btn = $('#gth-resume-reset');
    if (!el) return;
    var order = $('#gth-order').value;
    if (order === 'random') {
      el.textContent = '随机组卷按「顽固错题 → 尚未重练 → 练过未掌握 → 已掌握」分层，同层内按答错次数加权';
      if (btn) btn.hidden = true;
      return;
    }
    // r.idx 是「下次从第几题开始」的下标：中途退出=重做该题，交卷后=接着下一题
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

  // 按历史记录的筛选条件重新拉题，再与当时的题目 id 快照取交集
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
      startQuiz(picked, h.desc, true);
    }).catch(function (e) { setStatus('重练失败：' + e.message, 'err'); });
  }

  function startQuiz(list, desc, fromHistory, seedAnswered) {
    quiz = {
      list: list, desc: desc, idx: 0,
      answers: {}, submitted: false,
      answeredIds: seedAnswered || {},   // 续刷时沿用上次已作答记录，避免被首次渲染清空
      startAt: Date.now(), timer: null
    };
    if (!fromHistory) pushHistory(desc, list);
    quizEl.hidden = false;
    document.body.style.overflow = 'hidden';
    quiz.timer = setInterval(function () {
      var el = $('#gth-timer');
      if (el && quiz && !quiz.submitted) el.textContent = fmtTime(Date.now() - quiz.startAt);
    }, 1000);
    renderQuiz();
  }

  function closeQuiz() {
    if (quiz && quiz.timer) clearInterval(quiz.timer);
    quiz = null;
    quizEl.hidden = true;
    quizEl.innerHTML = '';
    document.body.style.overflow = '';
    refreshBadges();
    renderPracticeHint();   // 退出重练后刷新「上次刷到第几题」
  }

  function toggleAnswer(id, label, multi) {
    var cur = quiz.answers[id] || [];
    if (!multi) { quiz.answers[id] = [label]; }
    else {
      var i = cur.indexOf(label);
      if (i >= 0) cur.splice(i, 1); else cur.push(label);
      quiz.answers[id] = cur.slice().sort();
    }
    if ((quiz.answers[id] || []).length) quiz.answeredIds[id] = true;   // 只要作答过就记一笔
    renderQuiz();
  }

  function answeredCount() {
    return Object.keys(quiz.answers).filter(function (k) {
      return (quiz.answers[k] || []).length > 0;
    }).length;
  }

  function renderQuiz() {
    if (!quiz) return;
    // 顺序刷题：实时记录刷到第几题 + 已作答集合，中途退出后可从「第一道未作答」继续
    if (quiz.resumeKey && !quiz.submitted && quiz.list[quiz.idx]) {
      saveResume(quiz.resumeKey, quiz.resumeBase + quiz.idx, quiz.list[quiz.idx].id, quiz.answeredIds);
    }
    quizEl.innerHTML = quiz.submitted ? reportHtml() : doingHtml();
    bindQuiz();
    repaintHighlights();   // 报告页每道题都是新 DOM，渲染完立刻把划线画回去
  }

  function doingHtml() {
    var q = quiz.list[quiz.idx];
    var multi = ansKey(q.correct_answer).length > 1;
    var sel = quiz.answers[q.id] || [];

    var opts = (q.opt || []).map(function (o) {
      return '<div class="gthq-opt' + (sel.indexOf(o.label) >= 0 ? ' sel' : '') +
        '" data-label="' + esc(o.label) + '">' +
        '<span class="lb">' + esc(o.label) + '.</span>' +
        '<span class="tx">' + wakeImgs(o.content || '') + '</span></div>';
    }).join('');

    var cells = quiz.list.map(function (item, i) {
      var cls = 'gthq-cell';
      if (i === quiz.idx) cls += ' cur';
      else if ((quiz.answers[item.id] || []).length) cls += ' answered';
      return '<div class="' + cls + '" data-i="' + i + '">' + (i + 1) + '</div>';
    }).join('');

    return '' +
      '<div class="gthq-top">' +
      '<span class="pill">' + icon('listChecks') + '第 <b>' + (quiz.idx + 1) + '</b> / ' + quiz.list.length + ' 题</span>' +
      '<span class="pill">已答 <b>' + answeredCount() + '</b></span>' +
      '<span class="pill" id="gth-timer">' + icon('clock') + fmtTime(Date.now() - quiz.startAt) + '</span>' +
      '<span class="sp"></span>' +
      '<button class="gth-btn primary" id="gth-submit">' + icon('checkCircle') + '交卷</button>' +
      '<button class="gth-btn ghost" id="gth-exit">' + icon('x') + '退出</button>' +
      '</div>' +
      '<div class="gthq-main">' +
      '<div class="gthq-card" data-gth-qid="' + esc(q.id) + '">' +
      '<div class="gthq-meta">' + icon('hash') + '题目ID ' + esc(q.id) + '　' + esc(quiz.desc) + '</div>' +
      (q.material ? '<div class="gthq-material">' + wakeImgs(q.material) + '</div>' : '') +
      '<div class="gthq-stem">' + wakeImgs(q.content || '') + '</div>' +
      '<div class="gthq-opts">' + (opts || '<div class="gthq-tip">该题型无选项</div>') + '</div>' +
      (multi ? '<div class="gthq-tip">多选题，共 ' + ansKey(q.correct_answer).length + ' 个正确选项</div>' : '') +
      '</div>' +
      '<div class="gthq-sheet">' + cells + '</div>' +
      '<div class="gthq-nav">' +
      '<button class="gth-btn" id="gth-prev"' + (quiz.idx === 0 ? ' disabled' : '') + '>' + icon('arrowLeft') + '上一题</button>' +
      '<button class="gth-btn" id="gth-next"' + (quiz.idx === quiz.list.length - 1 ? ' disabled' : '') + '>下一题' + icon('arrowRight') + '</button>' +
      '</div>' +
      '</div>';
  }

  function reportHtml() {
    var right = 0;
    var items = quiz.list.map(function (q, i) {
      var ans = quiz.answers[q.id] || [];
      var answered = ans.length > 0;
      var mine = ansKey(ans);
      var ok = answered && mine === ansKey(q.correct_answer);
      if (ok) right++;
      var opts = (q.opt || []).map(function (o) {
        var isRight = ansKey(q.correct_answer).indexOf(o.label) >= 0;
        var isMine = (quiz.answers[q.id] || []).indexOf(o.label) >= 0;
        var mark = isRight ? '（正确）' : (isMine ? '（你选的）' : '');
        var style = isRight ? ' style="color:#16a34a;font-weight:600"' : (isMine ? ' style="color:var(--gth-destructive)"' : '');
        return '<div' + style + '>' + esc(o.label) + '. ' + wakeImgs(o.content || '') + mark + '</div>';
      }).join('');

      return '' +
        '<div class="gthq-r-item ' + (ok ? 'right' : (answered ? 'wrong' : 'unanswered')) + '" data-id="' + esc(q.id) + '" data-gth-qid="' + esc(q.id) + '">' +
        '<div class="gthq-r-h">' +
        '<span class="tag ' + (ok ? 'right' : (answered ? 'wrong' : 'unanswered')) + '">' +
        (ok ? icon('checkCircle') : (answered ? icon('xCircle') : icon('warn'))) +
        (ok ? '正确' : (answered ? '错误' : '未作答')) + '</span>' +
        '<span>第 ' + (i + 1) + ' 题</span>' +
        '<span>·</span><span>' + esc(SUBJECT_NAME[q.content_type] || '') + '</span>' +
        '<span>·</span><span>#' + esc(q.id) + '</span>' +
        (function () { var t = errTag(errCountOf(q));
          return '<span class="' + t.cls + '">' + t.html + '</span>'; })() +
        '</div>' +
        (q.material ? '<div class="gthq-material">' + wakeImgs(q.material) + '</div>' : '') +
        '<div class="gthq-stem">' + wakeImgs(q.content || '') + '</div>' +
        '<div class="gthq-opts">' + opts + '</div>' +
        '<div class="gthq-ans"><div>你的答案：<b class="' + (ok ? 'ok' : 'bad') + '">' + (mine || '未作答') + '</b></div>' +
        '<div>正确答案：<b class="ok">' + ansKey(q.correct_answer) + '</b></div></div>' +
        (analysisOf(q) ? '<div class="gthq-analysis"><b>解析</b><div>' + wakeImgs(analysisOf(q)) + '</div></div>' : '') +
        '<div class="gthq-notebox">' +
        '<div class="gthq-nb-act">' +
        '<button class="gth-btn sm" data-act="collect">' + icon('highlighter') + '整理本题</button>' +
        '</div>' +
        '<div class="gthq-hls" data-hls="' + esc(q.id) + '"></div>' +
        '<textarea placeholder="写下你的思路…（本题整体笔记）" data-note="' + esc(q.id) + '">' +
        esc(getNote(q.id)) + '</textarea></div>' +
        '</div>';
    }).join('');

    var pct = quiz.list.length ? Math.round(right / quiz.list.length * 100) : 0;
    // 错题数只统计「答过且答错」的，未作答不计入错题
    var wrongCount = quiz.list.filter(function (q) {
      var a = quiz.answers[q.id] || [];
      return a.length > 0 && ansKey(a) !== ansKey(q.correct_answer);
    }).length;
    return '' +
      '<div class="gthq-top">' +
      '<span class="pill">' + icon('checkCircle') + '得分 <b>' + right + '</b> / ' + quiz.list.length + '</span>' +
      '<span class="pill">正确率 <b>' + pct + '%</b></span>' +
      '<span class="pill">' + icon('clock') + '用时 ' + fmtTime(Date.now() - quiz.startAt) + '</span>' +
      '<span class="sp"></span>' +
      '<button class="gth-btn sm" id="gth-onlywrong">' + icon('xCircle') + '只看错题</button>' +
      '<button class="gth-btn sm" id="gth-all">' + icon('eye') + '全部</button>' +
      '<button class="gth-btn primary" id="gth-exit">' + icon('x') + '退出</button>' +
      '</div>' +
      '<div class="gthq-main">' +
      (wrongCount ? '<div style="max-width:880px;margin:0 auto 12px;color:var(--gth-muted);font-size:12px;display:flex;align-items:center;gap:6px">' + icon('warn') + '错题 ' + wrongCount + ' 道</div>' : '') +
      '<div id="gth-report">' + items + '</div>' +
      '</div>';
  }

  function bindQuiz() {
    var q = quiz.list[quiz.idx];

    $$('.gthq-opt', quizEl).forEach(function (el) {
      el.addEventListener('click', function () {
        toggleAnswer(q.id, el.dataset.label, ansKey(q.correct_answer).length > 1);
      });
    });
    $$('.gthq-cell', quizEl).forEach(function (el) {
      el.addEventListener('click', function () { quiz.idx = Number(el.dataset.i); renderQuiz(); });
    });

    var prev = $('#gth-prev', quizEl);
    if (prev) prev.addEventListener('click', function () {
      if (quiz.idx > 0) { quiz.idx--; renderQuiz(); }
    });
    var next = $('#gth-next', quizEl);
    if (next) next.addEventListener('click', function () {
      if (quiz.idx < quiz.list.length - 1) { quiz.idx++; renderQuiz(); }
    });

    var submit = $('#gth-submit', quizEl);
    if (submit) submit.addEventListener('click', function () {
      var un = quiz.list.length - answeredCount();
      if (un > 0 && !confirm('还有 ' + un + ' 题未作答，确定交卷吗？')) return;
      clearInterval(quiz.timer);
      quiz.timer = null;
      applyMastery();
      quiz.submitted = true;
      // 交卷：未作答的不算「做过」。全部作答 -> 整套完成（下次从头开始）；
      // 否则下次从「第一道未作答」继续，而不是径直跳到这套之后
      if (quiz.resumeKey) {
        var fu = 0;
        for (; fu < quiz.list.length; fu++) {
          if (!quiz.answeredIds[String(quiz.list[fu].id)]) break;
        }
        if (fu >= quiz.list.length) saveResume(quiz.resumeKey, quiz.resumeBase + quiz.list.length, '', {});
        else saveResume(quiz.resumeKey, quiz.resumeBase + fu, quiz.list[fu].id, quiz.answeredIds);
      }
      renderQuiz();
      quizEl.querySelector('.gthq-main').scrollTop = 0;
    });

    var ow = $('#gth-onlywrong', quizEl);
    if (ow) ow.addEventListener('click', function () {
      $$('#gth-report .gthq-r-item').forEach(function (el) {
        el.hidden = !el.classList.contains('wrong');
      });
    });
    var al = $('#gth-all', quizEl);
    if (al) al.addEventListener('click', function () {
      $$('#gth-report .gthq-r-item').forEach(function (el) { el.hidden = false; });
    });

    var exit = $('#gth-exit', quizEl);
    if (exit) exit.addEventListener('click', closeQuiz);

    $$('textarea[data-note]', quizEl).forEach(function (ta) {
      ta.addEventListener('input', debounce(function () {
        var q2 = null;
        for (var i = 0; i < quiz.list.length; i++) if (String(quiz.list[i].id) === ta.dataset.note) { q2 = quiz.list[i]; break; }
        setNote(ta.dataset.note, ta.value.trim(), {
          snapshot: q2 ? stripHtml(q2.content || '').slice(0, 240) : '',
          subject: q2 ? q2.content_type : null
        });
      }, 400));
    });

    // 报告页：划线清单（点文字写批注 / 点 ✕ 取消）由 document 上的委托统一处理
    var cb = $('#gth-report');
    if (cb) refreshQuizHl();
    $$('.gthq-r-item[data-gth-qid] [data-act="collect"]', quizEl).forEach(function (btn) {
      var item = btn.closest('.gthq-r-item');
      btn.addEventListener('click', function () {
        openCollect([String(item.getAttribute('data-gth-qid'))]);
      });
    });
  }

  // 交卷时统计对错：未作答的题目既不计入对错，也不累计答错次数、不改变掌握度
  function applyMastery() {
    quiz.list.forEach(function (q) {
      var ans = quiz.answers[q.id];
      if (!ans || !ans.length) return;   // 未作答：直接跳过，当作「没做过」处理
      var ok = ansKey(ans) === ansKey(q.correct_answer);
      var prev = (store.mastered[q.id] && store.mastered[q.id].streak) || 0;
      store.mastered[q.id] = { streak: ok ? prev + 1 : 0, updated: Date.now() };
      bumpWrongCount(q, ok);
      markPracticed(q.id);   // 「尚未重练」层只认这里的登记
    });
    saveStore();
  }

  /* ==================== 全真模考：解析页题目收录 ==================== */
  // mocks 是独立 SPA，模考成绩不进站点错题 API。这里做被动抓取：
  // 主通路从 Angular ng-repeat 节点的 scope 抠题目对象；兜底通路嗅探 XHR 响应。
  // 收录进 store.mockQs；答错的并入错题本（fetchByFilter），全部题经「模考收录」来源导出/重练。
  //
  // 实测过的解析页题目对象（场次 5158 的 [ng-repeat="item in jiexieSubjects"]）：
  //   列表态 11 键（subId/result/examPointId/userAnswers/index/id/examPointName/root_id/
  //   root_name/isPlaying/$$hashKey），题面与 correct_answer 由站点的 initJiexi(id)
  //   逐题请求 tiku_v2.subject_analysis 才补上（补完 52 键）。
  //   所以答对题的 correct_answer 是填的（实测 result=1 的 2455010：correct_answer
  //   与 userAnswers 都是 ["A"]），它不能拿来区分做没做。
  // 作答没有下划线 user_answer 这个键——只以驼峰 userAnswers 存在。
  // result 是站点的权威判分，实测三态：0=答错(48) / 1=答对(99) / 2=未做(33)。

  var MOCK_QID_KEYS = ['id', 'question_id', 'subject_id', 'qid', 'content_id'];
  var MOCK_STEM_KEYS = ['content', 'stem', 'question', 'title', 'topic'];
  var MOCK_MAT_KEYS = ['material', 'materials'];
  var MOCK_OPT_KEYS = ['opt', 'option', 'options', 'opt_list', 'option_list'];
  var MOCK_USER_KEYS = ['userAnswers', 'user_answer', 'my_answer', 'self_answer', 'user_ans', 'answer'];
  var MOCK_CORRECT_KEYS = ['correct_answer', 'right_answer', 'true_answer', 'correct', 'answer_right'];
  var MOCK_ANALYSIS_KEYS = ['analysis', 'analysis_shadow', 'explain', 'explanation'];
  // 科目只认明确的科目字段。站点题目里的 `type` 是题型（type_name 是「单选题」），
  // 不是科目，拿它兜底会把所有模考题的科目列写成行测。取不到就留 null。
  var MOCK_SUBJECT_KEYS = ['content_type', 'subject_type', 'subject'];
  var MOCK_RESULT_KEYS = ['result'];
  // 模块名：解析页列表态的 examPointName 最可靠（批量收题时列表项就在手，零额外请求），
  // 题面接口的 exam_point / check_point 兜底。root_name 是卷名不是模块，不参与。
  var MOCK_MODULE_KEYS = ['examPointName', 'exam_point', 'check_point'];

  function mockModuleOf(raw) {
    var v = pickKey(raw, MOCK_MODULE_KEYS);
    return v == null ? '' : String(v).trim();
  }

  // 站点判分归一化：返回 0（答错）/ 1（答对）/ 2（未做），取不到返回 null 交回比对通路
  function mockResultOf(raw) {
    var r = pickKey(raw, MOCK_RESULT_KEYS);
    if (typeof r === 'string' && /^-?\d+$/.test(r)) r = Number(r);
    return (r === 0 || r === 1 || r === 2) ? r : (typeof r === 'number' && isFinite(r) ? r : null);
  }

  function isMocksPage() {
    return /\/wxpage\/tiku\/mocks\/index\.html/.test(location.pathname);
  }

  // 场次 id：hash 形如 #/mocks/baogao/5158/detailv3；防御性取首个 ≥3 位数字段
  function mockExamIdOf() {
    var m = /(\d{3,})/.exec(location.hash || '');
    return m ? m[1] : '';
  }

  // 候选 key 依序取首个非空值（'' / null / undefined 视为空）
  function pickKey(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v != null && v !== '') return v;
    }
    return undefined;
  }

  // 题目形状判据：scope 提取与 XHR 嗅探共用，宁缺毋滥
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

  // 答案归一化：数组原样；JSON 串解析；裸字符串 "A"/"AC" 保留
  function mockParseAns(v) {
    if (v == null || v === '') return '';
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && /^[\[{"]/.test(v)) {
      try { return JSON.parse(v); } catch (e) {}
    }
    return v;
  }

  // 选项归一化：容忍 JSON 串 / 数组 / 对象映射 / "A. xxx" 字符串等形态
  function mockParseOpt(v) {
    if (v == null || v === '') return [];
    if (typeof v === 'string') {
      if (!/^[\[{]/.test(v)) return [];
      try { v = JSON.parse(v); } catch (e) { return []; }
    }
    if (!Array.isArray(v)) {
      if (typeof v === 'object') {   // {"A":"xxx","B":"yyy"} 形态
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

  // 把 mocks 页拿到的原始题目对象映射成与站点 API 一致的形状（复用后续导出/重练全链路）
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

  // 首个抓到的原始样本只打一次日志：字段清单 + 截断 JSON，便于按真实字段收敛候选表
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

  // 主通路：扫描 ng-repeat 节点，从 scope 抠出被迭代对象再识别题目
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

  // 兜底通路：嗅探 XHR 响应里的题目数组（AngularJS $http 走 XHR，可覆盖站点全部数据请求）。
  // 注意 @run-at document-idle 之前的请求抓不到——解析页数据是点击后才加载的，实际够用。
  var mockSniffCache = {};    // 题目 id -> 归一化题目
  var mockSniffOrder = [];    // 写入顺序，超限淘汰最旧
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
      if (j.length && hit / j.length >= 0.6) {   // 题目数组：整组收录，不再下钻
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
    } catch (e) { /* 沙箱拦截失败时静默降级：仅靠 scope 提取 */ }
  }

  // 收录合并：新题写入；已有题仅在「从未作答 → 拿到作答信息」时补 done/ok。
  // 答错计数幂等：同场次同一题只计一次（processed 登记在 store.mocks[场次].processed）。
  // 注：模考题 id 与练习题 id 是否同源未证实——若撞键且内容不同，需改用合成 id
  //（如 'm'+examId+'_'+qid，配合内容指纹比对），现阶段只 warn 不自动改写。
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
        // 未做（2）不算答错：既不进错题本也不计次，只在「模考收录」里留着
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
        // 已有记录只补两处：未作答 → 拿到作答、无模块 → 拿到模块；题面一律不动
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

  // mods = 面板上勾的模考模块名，空数组 = 全部
  function mockMatchModule(m, mods) {
    return !mods || !mods.length || mods.indexOf(m.module || MOCK_UNCLS) >= 0;
  }
  // store.mockQs -> 导出/重练用的题目形状（附 _mock = 场次 id，导出时显示来源）
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

  // 模考模块 chips 的候选：只看本地真收到的题，不去对站点的行测考点表（两套名字未必同源）
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

  // ---- 批量收题：列表态只有判分，题面得逐题问站点接口 ----
  // 站点自己也是这么补的（mocks 控制器的 initJiexi 打 api/v2/tiku/{examType}/{id}/analysis）。
  var MOCK_COLLECT_CAP = 300;
  var mockCollecting = false;

  function mockExamType() {
    var m = /exam_type=(\d+)/.exec(location.search || '') || /exam_type=(\d+)/.exec(location.hash || '');
    return m ? m[1] : '1';
  }

  function mockStatus(html) {
    var st = $('#gth-mock-status');
    if (st) st.innerHTML = html;
  }

  // 解析页列表里的题目：列表态 11 个键里就有 id / result / userAnswers，够挑出答错的
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

  function fetchMockSubject(id) {
    var t = mockExamType();
    return apiGet(API_V2 + 'tiku/' + t + '/' + id + '/analysis', { id: id, exam_type: t });
  }

  function collectMockWrong() {
    // 原来这里静默 return：再点一下像没反应，用户只会接着点。要说一句为什么不动
    if (mockCollecting) { mockStatus('这一轮还在补题面，等它跑完再点。'); return; }
    var examId = mockExamIdOf();
    var items = mockSheetItems();
    if (!items.length) { mockStatus('这一页还没有题目列表：先进「全部解析」或「错题解析」再收。'); return; }
    var wrongAll = items.filter(function (it) { return it.result === 0; });
    var need = wrongAll.filter(function (it) {
      var cur = store.mockQs[String(it.id)];
      return !(cur && cur.content);        // 已经翻到过、题面在册的就不重复抓
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
        // 判分与模块名取自列表项（题面接口不带这两样），题面取自接口
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

  // ---- mocks 页浮动 UI：右下角按钮 + 收录面板 ----
  // 「不依赖站点布局」是没得选：报告页实测没有 .question-box / .question-outer / .inner-content
  // （计数 0），错题页与收藏页那套容器选择器在这页一条都命中不到，能挂的只有 jiexieSubjects 的节点本身。
  var mockPanelBuilt = false;

  function buildMocksUI() {
    if (mockPanelBuilt) return;   // 页面生命周期内只建一次，避免站点重绘导致重复节点
    mockPanelBuilt = true;
    GM_addStyle([
      // 深色浮标的底色走 --gth-primary，别再引 --gth-fg：同值不同令牌，改一处就分叉
      '#gth-mock-btn{position:fixed;right:18px;bottom:18px;z-index:100000;display:flex;align-items:center;gap:7px;',
      'height:var(--gth-ctl-h,38px);padding:0 16px;border-radius:999px;',
      'background:var(--gth-primary,#0f172a);color:var(--gth-primary-fg,#f8fafc);font-size:13px;font-weight:600;',
      'cursor:pointer;box-shadow:0 4px 16px rgba(15,23,42,.25);user-select:none;}',
      '#gth-mock-btn:hover{background:var(--gth-primary-hover,#1e293b);}',
      '#gth-mock-btn .gth-ic svg{width:15px;height:15px;}',
      '#gth-mock-panel{position:fixed;right:18px;bottom:66px;z-index:100001;width:268px;background:var(--gth-bg,#fff);',
      'color:var(--gth-fg,#0f172a);border:1px solid var(--gth-border,#e2e8f0);border-radius:12px;',
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
      'border-radius:var(--gth-ctl-r,10px);cursor:pointer;font-size:13px;}',
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

  // 观察器回调（refreshPageUI 已 debounce 400ms）：扫描 -> 合并 -> 刷新面板
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

  function initMocksUI() {
    hookXhrSniffer();
    buildMocksUI();
    syncKeyTargets();   // 浮标是 div，mocks 页不走下面那批 gongan 页初始化
    mocksScanTick();
    console.log('[错题助手] 模考助手已注入' + (mockSniffHooked ? '（嗅探已挂）' : '') + '：' + location.href);
  }

  document.addEventListener('keydown', function (e) {
    if (quizEl.hidden) return;
    if (e.key === 'Escape') { closeQuiz(); return; }
    if (quiz && !quiz.submitted) {
      if (e.key === 'ArrowLeft' && quiz.idx > 0) { quiz.idx--; renderQuiz(); }
      if (e.key === 'ArrowRight' && quiz.idx < quiz.list.length - 1) { quiz.idx++; renderQuiz(); }
    }
  });

  // 批注栏在错题页与收藏页都生效，用 body 上的标记类限定样式作用域
  // （类名沿用 gth-error，改名会牵动一批 CSS 选择器，没必要）
  function syncRouteClass() {
    document.body.classList.toggle('gth-error', isListRoute());
    syncSourceDefault();
  }
  window.addEventListener('hashchange', function () {
    syncRouteClass();
    invalidateLoaded();   // 换了路由，缓存的题目列表跟着作废
    // 离开错题页 / 收藏页时收起助手视图，避免它跟着显示到别的界面上
    if (!isListRoute() && viewOn) setView(false);
    refreshPageUI();
  });

  if (isMocksPage()) {          // mocks 页：不进错题面板初始化，只做模考收录
    initMocksUI();
    return;
  }
  if (!getToken()) {
    setStatus('未检测到登录 token，请先登录站点后再使用。', 'err');
  }
  // 首次注入要放在所有定义与 var 之后（早跑会读到还没赋值的 balloonEls，见上面 resize 那行），
  // 但又排在尾部那几个初始化之前：它们里有 `$('#gth-mode').value` 这种不判空的读法，
  // 一旦哪天站点改了名，抛错也不该把划线的入口一起带走。
  injectListUI();
  injectMenuEntry();
  syncRail();
  syncKeyTargets();

  syncRouteClass();
  renderPracticeSrc();
  syncFilterUI();
  renderHistory();
  updateExportHint();
})();
