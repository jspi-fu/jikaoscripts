// 生成一个临时采集脚本：挂在真站点的补充题本那一屏，把每一枚图片的
// 上下文、**题库原始 HTML 里的写法**、以及站点自己的渲染结果导出成 JSON。
//
// 用途（2026-10-10）：用户问「站点是不是本来就在 HTML 里带了缩放信息，只是没提取」。
// 2026-10-10 已从公开资源确认：
//   · 站点样式表 gongan.min.css 对正文三容器（.content/.analysis/.material）**只给
//     line-height/color/font-size/word-break，没有一条 img 规则** → 缩放信息不在站点 CSS 里；
//   · 正文经 ng-bind-html 原样注入，不做过滤 → 缩放信息只可能在**题库存的 HTML** 里；
//   · 站点接了 photoswipe，约定是 <a href=原图><img></a> + data-author/data-med
//     （见 initPhotoSwipe1.js），但选择器 .demo-gallery 在任何模板里都不存在，像是残留。
// 所以剩下的唯一未知是「题库那串 HTML 到底长什么样」——这个脚本就是去把它取回来。
//
// 用法：
//   node tools/gth_img_raw.js            # 写出临时 .user.js 并打印安装提示
//   node tools/gth_img_raw.js --out <路径> # 指定写出位置
//
// 为什么要「原始 HTML」而���是 DOM：DOM 已经被我们的 class 改过、也被 innerHTML 规范化过，
// 只有题库里存的那串原文才可能带 width/height/style/class 等作者写死的意图。
const fs = require('fs');
const path = require('path');
const os = require('os');

const argOut = (() => {
  const i = process.argv.indexOf('--out');
  return i > 0 ? process.argv[i + 1] : null;
})();

const outDir = argOut || path.join(os.homedir(), '.gth-img-raw');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'gth-img-raw.user.js');

const src = `// ==UserScript==
// @name         GTH 图片原始标记采集（临时诊断用，量完就删）
// @namespace    http://tampermonkey.net/
// @version      0.0.1
// @description  临时诊断：导出题库里每张图的原始 HTML 写法（width/height/style/class）与上下文
// @match        https://pub.xdtech.top/*/wxpage/tiku/gongan/index.html*
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  if (window.__gthImgRaw) return;
  window.__gthImgRaw = true;

  var BTN = 'gth-img-raw-btn';
  var OUT = 'gth-img-raw-out';
  var HOSTS = '.gthq-material,.gthq-stem,.gthq-opts,.gthq-analysis,.gth-note-text,.gth-aside,.gth-apanel';

  function txt(n) {
    if (!n) return '';
    var s = n.nodeType === 3 ? n.nodeValue : (n.textContent || '');
    return String(s).replace(/\\s+/g, ' ').trim();
  }
  function sib(n) {
    if (!n) return null;
    return {
      type: n.nodeType === 3 ? 'text' : (n.nodeName || '').toLowerCase(),
      text: txt(n).slice(0, 60),
      len: txt(n).replace(/\\s/g, '').length
    };
  }
  function hostOf(el) {
    var h = el.closest(HOSTS);
    return h ? (h.className || '').split(/\\s+/).filter(Boolean)[0] : '(不在内容区)';
  }
  function blockOf(el) {
    var b = el.closest('p,div,li,td');
    return b ? txt(b).slice(0, 140) : '';
  }

  // ——— 核心：把「题库存的原文」与「DOM 现在长什么样」并排导出 ———
  function imgRecord(el, i) {
    var r = el.getBoundingClientRect();
    var lh = parseFloat(getComputedStyle(el.parentElement || el).lineHeight) || 28;
    // 作者可能写死的缩放意图，就在这几个属性里
    var attr = {
      width: el.getAttribute('width') || '',
      height: el.getAttribute('height') || '',
      style: el.getAttribute('style') || '',
      cls: el.getAttribute('class') || '',
      // 站点 photoswipe 约定：<a href=原图><img></a>
      inAnchor: !!el.closest('a'),
      anchorHref: (el.closest('a') && el.closest('a').getAttribute('href')) || '',
      dataAuthor: el.getAttribute('data-author') || '',
      dataMed: el.getAttribute('data-med') || '',
      dataSrc: el.getAttribute('data-src') || ''
    };
    // 我们自己加的（要剔掉，否则下次采集分不清是作者的还是我们写的）
    var own = { cls: el.className || '', gthFit: (el.dataset && el.dataset.gthFit) || '' };
    return {
      i: i,
      host: hostOf(el),
      nw: el.naturalWidth,
      nh: el.naturalHeight,
      rw: Math.round(r.width),
      rh: Math.round(r.height),
      lineMult: +(r.height / lh).toFixed(1),
      shrunkByUs: own.gthFit,
      attr: attr,
      prev: sib(el.previousSibling),
      next: sib(el.nextSibling),
      block: blockOf(el),
      // 题库原文里的那一小段（父容器 innerHTML 截取，含我们改过的 class，标注了 own.cls 便于剔除）
      outerHTML: el.outerHTML.slice(0, 300),
      parentHTML: (el.parentElement && el.parentElement.innerHTML || '').slice(0, 500)
    };
  }

  function collect() {
    var scope = document.querySelector('#gth-book-list') || document.body;
    var imgs = Array.prototype.slice.call(scope.querySelectorAll('img'));
    return imgs.map(imgRecord);
  }

  // 站点原生那一屏也量一遍：那边没有我们的 class，能看出「站点原样是什么样」
  function collectSite() {
    var scope = document.querySelector('.question-content') || document.querySelector('.content');
    if (!scope) return [];
    return Array.prototype.slice.call(scope.querySelectorAll('img')).map(imgRecord);
  }

  function summarize(rows) {
    var withSize = rows.filter(function (r) { return r.attr.width || r.attr.height; }).length;
    var withStyle = rows.filter(function (r) { return /width|height|max-|transform|font-size/i.test(r.attr.style); }).length;
    var inA = rows.filter(function (r) { return r.attr.inAnchor; }).length;
    var withData = rows.filter(function (r) { return r.attr.dataAuthor || r.attr.dataMed; }).length;
    return rows.length + ' 枚｜带 width/height 属性 ' + withSize +
      '｜style 里带尺寸 ' + withStyle + '｜包在 <a> 里 ' + inA + '｜带 data-author/med ' + withData;
  }

  function report(rows, siteRows) {
    var lines = rows.map(function (r) {
      return [
        String(r.i).padStart(3, ' '),
        r.host.padEnd(14, ' '),
        (r.nw + 'x' + r.nh).padEnd(10, ' '),
        ('现判=' + (r.shrunkByUs || '未判')).padEnd(10, ' '),
        ('attr w=' + (r.attr.width || '-') + ' h=' + (r.attr.height || '-')).padEnd(20, ' '),
        ('style=' + (r.attr.style || '-')).padEnd(26, ' '),
        'a=' + (r.attr.inAnchor ? '是' : '否'),
        '　前[' + (r.prev ? r.prev.type + ':' + r.prev.text.slice(0, 18) : '无') + ']'
      ].join(' ');
    });
    lines.unshift('题本侧：' + summarize(rows));
    lines.unshift('序号 宿主           intrinsic   判定       属性尺寸                行内 style                 链接  紧邻前文');
    if (siteRows.length) {
      lines.push('');
      lines.push('站点原生那一屏：' + summarize(siteRows));
      siteRows.forEach(function (r) {
        lines.push('  ' + (r.nw + 'x' + r.nh).padEnd(10, ' ') + 'attr w=' + (r.attr.width || '-') +
          ' h=' + (r.attr.height || '-') + '　style=' + (r.attr.style || '-') +
          '　段：' + r.block.slice(0, 60));
      });
    }
    return lines.join('\\n');
  }

  function show(text) {
    var pre = document.getElementById(OUT);
    if (!pre) {
      pre = document.createElement('pre');
      pre.id = OUT;
      pre.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:100999;' +
        'max-height:52vh;overflow:auto;margin:0;padding:12px 14px;background:#0f172a;color:#e2e8f0;' +
        'font:12px/1.6 ui-monospace,Consolas,monospace;white-space:pre;border-top:2px solid #f59e0b';
      document.body.appendChild(pre);
    }
    pre.textContent = text;
  }

  function install() {
    if (document.getElementById(BTN)) return;
    var b = document.createElement('button');
    b.id = BTN;
    b.textContent = '导出图片原始标记';
    b.style.cssText = 'position:fixed;right:12px;bottom:52px;z-index:100999;' +
      'padding:8px 14px;border:none;border-radius:8px;background:#38bdf8;color:#111;' +
      'font:13px/1 sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2)';
    b.addEventListener('click', function () {
      var rows = collect();
      var siteRows = collectSite();
      show(report(rows, siteRows));
      var json = JSON.stringify({ book: rows, site: siteRows }, null, 1);
      try {
        navigator.clipboard.writeText(json);
        console.log('GTH_IMGRAW_JSON ' + rows.length + ' 枚，JSON 已复制');
      } catch (e) {
        console.log('GTH_IMGRAW_JSON ' + rows.length + ' 枚（复制失败，JSON 在下方）');
      }
      console.log('GTH_IMGRAW_JSON\\n' + json);
      window.__gthImgRawRows = rows;
    });
    document.body.appendChild(b);
  }

  if (document.body) install();
  else document.addEventListener('DOMContentLoaded', install);
  console.log('GTH_IMGRAW 已就位：摊开补充题本后点右下角那颗「导出图片原始标记」');
})();
`;

fs.writeFileSync(outFile, src, 'utf8');
console.log('已写出：' + outFile);
console.log('');
console.log('接下来：');
console.log('  1. 临时装进油猴（改个名字，别和主脚本同时开——它要读「我们没改过」的原始标记）');
console.log('  2. 打开补充题本，等图片都加载完（往下滑到底，让懒加载的图都出来）');
console.log('  3. 点右下角「导出图片原始标记」——文本表第一行是统计，先看那四个数字');
console.log('  4. 把 JSON 存成 ' + path.join(outDir, 'rows.json') + ' 交给我');
console.log('');
console.log('看什么：');
console.log('  · 「带 width/height 属性」与「style 里带尺寸」两个数不为 0 → 题库作者写死了尺寸，');
console.log('    那就是真信号，判据可以改成「优先信作者写的尺寸」，不必再猜句式。');
console.log('  · 两个都是 0 → 站点确实没带缩放信息，句式判据那条路还得走，');
console.log('    但至少证明「不是提取漏了」，不用再往这个方向找。');
console.log('  · 「包在 <a> 里」不为 0 → photoswipe 那套 <a href><img></a> 约定真的在用，');
console.log('    被 <a> 包着的多半是「可点开原图」的那类图，与公式可以分开。');