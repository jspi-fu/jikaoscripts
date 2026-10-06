// ==UserScript==
// @name         上岸村机考系统错题助手
// @namespace    http://tampermonkey.net/
// @version      1.10.3
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
  var MASTER_STREAK = 2;

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
    if (!data.exported) data.exported = {};
    if (!data.history) data.history = [];
    if (!data.resume) data.resume = {};
    if (!data.highlights) data.highlights = {};
    if (!data.mockQs) data.mockQs = {};
    if (!data.mocks) data.mocks = {};
    if (!data.practiced) data.practiced = {};
    if (!data.qModule) data.qModule = {};
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
      data.exported = { _v: 2, error: conv, favorite: {}, both: {}, mock: {} };
    }

    if (!data.exported.mock) data.exported.mock = {};
    var at = data.exportAt;
    if (!at || typeof at !== 'object') {
      data.exportAt = { error: Number(at) || 0, favorite: 0, both: 0, mock: 0 };
    } else {
      data.exportAt = { error: at.error || 0, favorite: at.favorite || 0, both: at.both || 0, mock: at.mock || 0 };
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
    } else {
      delete store.notes[id];
    }
    saveStore();
  }
  function getNote(id) { return (store.notes[id] && store.notes[id].text) || ''; }

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
    return null;
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
      (store.mockQs[id] && store.mockQs[id].module) || '';
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
    return srcList({ srcs: srcs }).some(function (s) { return s !== 'mock'; });
  }

  function fetchByFilter(f, limit) {
    var srcs = srcList(f);
    var wantErr = srcs.indexOf('error') >= 0, wantFav = srcs.indexOf('favorite') >= 0;
    var mods = f.mock_modules || [];
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

      rememberModulesFromPoints(list);
      var have = {};
      list.forEach(function (q) { if (q && q.id != null) have[String(q.id)] = 1; });

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
        examPointModule = buildExamPointIndex(list);
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
        q._mock ? '模考#' + q._mock : '练习',
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
      mockQs: store.mockQs,
      mocks: store.mocks,
      practiced: store.practiced,
      qModule: store.qModule
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

    '--gth-ctl-h:38px;--gth-ctl-r:10px;',
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
    '.gth-mini{border:1px solid #fde68a;background:#fff;color:#a16207;border-radius:6px;height:24px;padding:0 8px;',
    'font-size:11px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:4px}',
    '.gth-mini:hover{background:#fef3c7}',
    '.gth-mini.primary{background:#f59e0b;border-color:#f59e0b;color:#fff}',
    '.gth-mini.primary:hover{background:#d97706;border-color:#d97706}',

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

    '#gth-status{margin-top:10px;padding:10px 12px;border-radius:8px;background:var(--gth-subtle);',
    'color:var(--gth-muted);font-size:12px;line-height:1.6;white-space:pre-wrap;border:1px solid var(--gth-border)}',
    '#gth-status.err{background:#fef2f2;color:#b91c1c;border-color:#fecaca}',
    '#gth-status.ok{background:#f0fdf4;color:#15803d;border-color:#bbf7d0}',

    '.gth-qbar{display:flex;align-items:center;gap:8px;margin:12px 0 0;padding:0 0 8px 40px}',
    '.gth-qbar [hidden]{display:none!important}',

    '.gth-qbar-btn{display:inline-flex;align-items:center;gap:3px;height:24px;padding:0 8px;font-size:11px;',
    'border:1px solid var(--gth-border);border-radius:6px;background:var(--gth-bg);color:var(--gth-muted);cursor:pointer}',
    '.gth-qbar-btn:hover{background:var(--gth-hover);color:var(--gth-fg)}',
    '.gth-qbar-copy.copied{color:#16a34a;border-color:#bbf7d0;background:#f0fdf4}',

    '.gth-badge{font-size:11px;color:var(--gth-muted);display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:10px;',
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

    'mark.gth-hl{background:transparent;color:inherit;border-radius:2px;padding:0 1px}',
    'mark.gth-hl.yellow{background:#fde68a;box-shadow:inset 0 -2px 0 #f59e0b}',
    'mark.gth-hl.red{background:#fecaca;box-shadow:inset 0 -2px 0 #dc2626}',

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
    '        <button class="gth-btn" id="gth-mod-scan">' + icon('rotate') + '重扫模块' +
    '          <span class="gth-q" title="把错题本与收藏夹里的题按日期全部过一遍，给没登记上模块的题目补上模块名。需要联网拉几页题目，几秒钟。模考收录的题自带模块；公安专业知识的题按规则留在「模块未记录」。">?</span></button>',
    '        <button class="gth-btn" id="gth-stray-clean">' + icon('listChecks') + '清理残留' +
    '          <span class="gth-q" title="删掉三类不再被读取的记录：已停用脚本留下的整库、排查时产生的历史快照、命名规则变更前留下的旧刷题进度。笔记、划线、掌握状态与已收录的题目都不受影响，不可恢复。">?</span></button>',
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

  var SRC_KEYS = ['error', 'favorite', 'mock'];
  var SRC_NAME = { error: '错题本', favorite: '收藏夹', both: '错题+收藏', mock: '模考收录' };

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
    $('#gth-shared').hidden = pane === 'notes';
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

  function applyViewChrome(on) {
    var rc = $('.gongan2-container .right-content') || $('.right-content');
    if (rc) {

      $$('.second-menu, .inner-content', rc).forEach(function (el) { el.classList.toggle('gth-hide', on); });
      if (viewEl.parentNode !== rc) rc.appendChild(viewEl);
    }
    viewEl.hidden = !on;
    document.body.classList.toggle('gth-view-on', on);

    var entry = $('.gth-menu-item');
    if (entry) entry.classList.toggle('active', on);
  }

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
      syncFilterUI();
    }
    syncRail();
  }

  function injectMenuEntry() {
    var menu = $('.gongan2-container .left-menu') || $('.left-menu');
    var existing = $('.gth-menu-item');
    var kind = routeKind();

    if (!kind) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    if (!menu) return;

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
    error: '上岸村错题_', favorite: '上岸村收藏_', both: '上岸村错题收藏_', mock: '上岸村模考收录_'
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

  $('#gth-mod-scan').addEventListener('click', function () {
    setStatus('正在按日期载入错题本与收藏夹…');
    busy(this, fetchByFilter({ mode: 'date', dayRange: '4', srcs: ['error', 'favorite'] }, 0))
      .then(function (list) {
        var gap = noteIdsWithHl().filter(function (id) { return !moduleOf(id); }).length;
        setStatus('这一趟过了 ' + list.length + ' 题。' + (gap
          ? '笔记里仍差 ' + gap + ' 题：这些题已不在错题本与收藏夹里，接口取不到它们的考点。'
          : '笔记里的题目模块已齐。'), 'ok');
        renderNotesList();
      })
      .catch(function (e) { setStatus('重扫失败：' + e.message, 'err'); });
  });

  $('#gth-stray-clean').addEventListener('click', function () {
    var names = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k) names.push(k);
    }
    var keys = strayStorageKeys(names), old = staleResumeKeys(store.resume);
    if (!keys.length && !old.length) { setStatus('没有可清理的残留记录', 'ok'); return; }
    var kb = keys.reduce(function (a, x) { return a + (localStorage.getItem(x) || '').length; }, 0) / 1024;
    var detail = keys.map(function (x) { return '· 存储键 ' + x; })
      .concat(old.map(function (x) { return '· 旧刷题进度 ' + x; })).join('\n');
    if (!confirm('将删掉 ' + (keys.length + old.length) + ' 项不再被读取的记录' +
      (keys.length ? '（存储键约 ' + kb.toFixed(1) + ' KB）' : '') +
      '，不可恢复：\n\n' + detail + '\n\n确定继续？')) return;
    keys.forEach(function (x) { localStorage.removeItem(x); });
    old.forEach(function (x) { delete store.resume[x]; });
    saveStore();
    setStatus('已清掉 ' + (keys.length + old.length) + ' 项残留记录', 'ok');
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
        subject: item.content_type
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
  }

  function focusNote(item) {
    if (viewOn) setView(false);
    var id = String(item.id);
    var aside = $('#gth-rail-in .gth-aside[data-id="' + id + '"]');
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

  function railContent() {
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
    if (!isListRoute() || !inner) { rail.hidden = true; railFrame = null; return; }

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

      railInner.querySelectorAll('.gth-aside[data-id="' + item.id + '"]').forEach(function (a) { a.remove(); });
      node.dataset.gth = '1';

      node.setAttribute('data-gth-qid', item.id);
      itemsById[item.id] = item;
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

      bar.querySelector('.gth-qbar-copy').addEventListener('click', function (e) {
        e.stopPropagation();
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

      bar.querySelector('.gth-badge').addEventListener('click', function (e) {
        e.stopPropagation();
        toggleMastery(item.id);
      });

      bar.querySelector('.gth-qbar-note').addEventListener('click', function (e) {
        e.stopPropagation();
        focusNote(item);
      });

      var aside = document.createElement('div');
      aside.className = 'gth-aside';
      aside.dataset.id = item.id;
      renderAside(aside, item);

      node.insertBefore(bar, node.firstChild);
      railInner.appendChild(aside);
    });
    refreshBadges();
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
    if (isMocksPage()) { mocksScanTick(); return; }
    injectListUI();
    injectMenuEntry();

    if (viewOn) {
      applyViewChrome(true);
      if (storeRev !== panelRev) renderPanel();
    }
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
      startQuiz(picked, filterDesc(f), false, seq ? (r && r.answered) : null);
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
      startQuiz(picked, h.desc, true);
    }).catch(function (e) { setStatus('重练失败：' + e.message, 'err'); });
  }

  function startQuiz(list, desc, fromHistory, seedAnswered) {
    quiz = {
      list: list, desc: desc, idx: 0,
      answers: {}, submitted: false,
      answeredIds: seedAnswered || {},
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
    renderPracticeHint();
  }

  function toggleAnswer(id, label, multi) {
    var cur = quiz.answers[id] || [];
    if (!multi) { quiz.answers[id] = [label]; }
    else {
      var i = cur.indexOf(label);
      if (i >= 0) cur.splice(i, 1); else cur.push(label);
      quiz.answers[id] = cur.slice().sort();
    }
    if ((quiz.answers[id] || []).length) quiz.answeredIds[id] = true;
    renderQuiz();
  }

  function answeredCount() {
    return Object.keys(quiz.answers).filter(function (k) {
      return (quiz.answers[k] || []).length > 0;
    }).length;
  }

  function renderQuiz() {
    if (!quiz) return;

    if (quiz.resumeKey && !quiz.submitted && quiz.list[quiz.idx]) {
      saveResume(quiz.resumeKey, quiz.resumeBase + quiz.idx, quiz.list[quiz.idx].id, quiz.answeredIds);
    }
    quizEl.innerHTML = quiz.submitted ? reportHtml() : doingHtml();
    bindQuiz();
    repaintHighlights();
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

    var cb = $('#gth-report');
    if (cb) refreshQuizHl();
    $$('.gthq-r-item[data-gth-qid] [data-act="collect"]', quizEl).forEach(function (btn) {
      var item = btn.closest('.gthq-r-item');
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

  function mockExamType() {
    var m = /exam_type=(\d+)/.exec(location.search || '') || /exam_type=(\d+)/.exec(location.hash || '');
    return m ? m[1] : '1';
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

  function fetchMockSubject(id) {
    var t = mockExamType();
    return apiGet(API_V2 + 'tiku/' + t + '/' + id + '/analysis', { id: id, exam_type: t });
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
    syncKeyTargets();
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

  function syncRouteClass() {
    document.body.classList.toggle('gth-error', isListRoute());
    syncSourceDefault();
  }
  window.addEventListener('hashchange', function () {
    syncRouteClass();
    invalidateLoaded();

    if (!isListRoute() && viewOn) setView(false);
    refreshPageUI();
  });

  if (isMocksPage()) {
    initMocksUI();
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
})();
