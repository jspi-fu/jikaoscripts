var fs = require('fs');
var http = require('http');
var path = require('path');
var os = require('os');

var args = process.argv.slice(2).filter(function (a) { return a.indexOf('--') !== 0; });
var FILE = args[0] || 'shangancun-exam-helper.user.js';
var SERVE = process.argv.indexOf('--serve') >= 0;
var root = path.resolve(__dirname, '..');
var scriptPath = path.isAbsolute(FILE) ? FILE : path.join(root, FILE);
var script = fs.readFileSync(scriptPath, 'utf8');

var STYLE = [
  'body{margin:0;font:14px/1.6 system-ui;background:#f3f6fb;color:#0f172a}',
  '.gongan2-container{display:flex;width:1000px;margin:0 auto;min-height:100vh}',
  '.left-menu{width:220px;background:#2178db;color:#fff;padding:12px 0;flex:0 0 auto}',
  '.left-menu .item{padding:10px 16px;cursor:pointer}',
  // 站点这条不抄进来，active 那颗就是白底白字，量不到「题本入口在左菜单第二颗」这件事
  '.left-menu .item .text{color:#2178db;font-weight:700;line-height:1.5;padding:0 20px}',
  '.right-content{flex:1;display:flex}',
  '.zero-flex-1{flex:1 1 0;min-width:0}',
  '.inner-content{flex:1;display:flex;min-width:0}',
  '.content{height:600px;overflow:scroll;background:#fff;margin:12px;padding:12px;flex:1}',
  '.question-outer{border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:12px}',
  '.analysis{margin-top:8px;border-top:1px dashed #cbd5e1;padding-top:8px}',
  '.question-box{position:fixed;overflow:scroll;top:60px;left:260px;right:0;bottom:0;background:#fff;padding:56px 24px 12px}',
  '.sheet-box{position:fixed;left:0;top:60px;width:260px;padding:12px;background:#eef4ff}',
  '.sheet-box label{display:block;margin-bottom:8px}',
  '.q-head{display:flex;align-items:center;gap:10px}',
  '.q-head .sp{flex:1}',
  // 错题页那一屏的题目骨架照站点抄（.sequence-box / .choice .circle / .bottom-line），
  // 不然「题本对齐错题页」这件事在夹具里只能看到题本那一半
  '.question-outer .q-row{display:flex;align-items:flex-start;gap:15px}',
  '.question-outer .sequence{width:40px;flex:0 0 auto}',
  '.question-outer .sequence-box{width:25px;height:25px;text-align:center;line-height:25px;font-size:14px;background:#b3c8e9;margin:0 auto}',
  '.question-outer .q-col{flex:1;min-width:0;line-height:2;color:#222221;font-size:14px;word-break:break-all}',
  '.question-outer .choice{display:flex;align-items:center;margin-top:10px}',
  '.question-outer .circle{width:18px;height:18px;border-radius:80%;border:1px solid #b2b2b2;box-sizing:border-box;flex:0 0 auto}',
  '.question-outer .circle.right{border:5px solid #0c0}',
  '.question-outer .circle.wrong{border:5px solid red}',
  '.question-outer .ctext{display:flex;align-items:flex-start;padding-left:10px;flex:1;min-width:0}',
  '.bottom-line{display:flex;align-items:center;user-select:none;margin-top:14px}',
  '.bottom-line .line{flex:1;height:1px;background:#ddd}',
  '.bottom-line .txt{color:#8c8c8c;position:relative;padding:0 30px 0 10px;font-size:14px;flex:0 0 auto}',
  '.bottom-line .txt:after{position:absolute;right:0;top:50%;margin-top:-5px;content:"";' +
  'border-top:10px solid #8c8c8c;border-left:10px solid transparent;border-right:10px solid transparent}'
].join('\n');

var BOOT = [
  'window.__gthMut = 0;',
  'new MutationObserver(function (ms) {',
  '  ms.forEach(function (m) { window.__gthMut += m.addedNodes.length + m.removedNodes.length; });',
  '}).observe(document.body, { childList: true, subtree: true });',
  'setTimeout(function () { console.log("GTH_CHURN t=3s N=" + window.__gthMut); }, 3000);',
  'setTimeout(function () { console.log("GTH_CHURN t=9s N=" + window.__gthMut); }, 9000);',
  'window.GM_addStyle = function (css) { var s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };',
  'window.confirm = function () { return true; };',
  // 两枚假图：一枚「高清公式」（220×70，原始尺寸比正文大好几倍），一枚「独立图表」（420×260）。
  // 用 data URI 是为了不引外部请求——夹具本来就是零站点请求的。
  'window.FIX_FORMULA = "data:image/svg+xml;utf8," + encodeURIComponent(',
  '  \'<svg xmlns="http://www.w3.org/2000/svg" width="220" height="70"><rect width="220" height="70" fill="#eee"/>\' +',
  '  \'<text x="10" y="46" font-size="40">A88</text></svg>\');',
  'window.FIX_CHART = "data:image/svg+xml;utf8," + encodeURIComponent(',
  '  \'<svg xmlns="http://www.w3.org/2000/svg" width="420" height="260"><rect width="420" height="260" fill="#e8eef8"/>\' +',
  '  \'<text x="16" y="40" font-size="22">统计表：某市主要指标</text></svg>\');',
  // 第三枚起：站点公式图的替身，比例照真页面那批造（细长条 / 饼图 / 材料里的表头各一枚）——
  // 实测尺寸与分档口径在 AGENTS 的「站点题干与解析里的公式图」那条，这里只留形状
  'window.FIX_FORMULA_BIG = "data:image/svg+xml;utf8," + encodeURIComponent(',
  '  \'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="180"><rect width="900" height="180" fill="#f4f6fb"/>\' +',
  '  \'<text x="20" y="120" font-size="120">4694/(1+1/9) = 67</text></svg>\');',
  // 解析里偶尔放的「图」（饼图/立体图，高宽比 1.5 左右）：这一类不许被公式档带走
  'window.FIX_PIE = "data:image/svg+xml;utf8," + encodeURIComponent(',
  '  \'<svg xmlns="http://www.w3.org/2000/svg" width="670" height="450"><rect width="670" height="450" fill="#eef3ff"/>\' +',
  '  \'<text x="20" y="230" font-size="120">饼图</text></svg>\');',
  // 材料里的细长条（实测 1017x153 那种统计表头）：形状像公式，但它在材料那一屏，是题目本身
  'window.FIX_MAT_STRIP = "data:image/svg+xml;utf8," + encodeURIComponent(',
  '  \'<svg xmlns="http://www.w3.org/2000/svg" width="1017" height="153"><rect width="1017" height="153" fill="#fff3e6"/>\' +',
  '  \'<text x="20" y="100" font-size="96">统计表头：某市主要指标</text></svg>\');',
  // 选项就是一张分式图（用户 10-09 第二张截图）：竖着的，高 > 宽
  'window.FIX_FRACTION = "data:image/svg+xml;utf8," + encodeURIComponent(',
  '  \'<svg xmlns="http://www.w3.org/2000/svg" width="110" height="150"><rect width="110" height="150" fill="#f7f7f7"/>\' +',
  '  \'<text x="30" y="55" font-size="46">1</text><line x1="20" y1="78" x2="90" y2="78" stroke="#000"/>\' +',
  '  \'<text x="24" y="132" font-size="46">16</text></svg>\');',
  // 选项里放的横图（统计表）：形状不像分式，也不该缩
  'window.FIX_OPT_TABLE = "data:image/svg+xml;utf8," + encodeURIComponent(',
  '  \'<svg xmlns="http://www.w3.org/2000/svg" width="650" height="200"><rect width="650" height="200" fill="#eef7ee"/>\' +',
  '  \'<text x="20" y="110" font-size="72">选项里的统计表</text></svg>\');',
  // 站点那几个接口在夹具里由假数据回答（以前一律 onerror，于是组卷、与站点核对、补齐题面
  // 三条路在假页面里根本走不到，重练那一屏与报告卡片里的笔记区就一直量不出来）
  'window.FIX_SITE_QS = [];',
  'for (var _k = 0; _k < 6; _k++) {',
  '  window.FIX_SITE_QS.push({ id: _k === 0 ? 901 : 950 + _k,',
  '    content: "<p>站点错题本第 " + (_k + 1) + " 题：这份卷子里 <img data-src=\\"" +',
  '      window.FIX_FORMULA + "\\"> 哪一项应当优先？</p>",',
  '    material: _k === 3 ? "<p><img data-src=\\"" + window.FIX_CHART + "\\"></p>" : "",',
  '    opt: [{ label: "A", content: "甲" }, { label: "B", content: "乙" }, { label: "C", content: "丙" }],',
  '    correct_answer: ["A"], user_answer: _k === 4 ? [] : ["B"],',
  '    analysis: "<p>第 " + (_k + 1) + " 题的解析正文。</p><p><img data-src=\\"" +',
  '      window.FIX_FORMULA + "\\"></p>", content_type: 0,',
  '    exam_point: 7, examPointName: "资料分析" });',
  '}',
  'window.__gthFake = function (o) {',
  '  var u = o.url, data = null;',
  '  if (/\\/commodity\\?/.test(u)) data = { commodity_info: { content_id: 5, id: 701 } };',
  '  else if (/\\/subcategory\\?/.test(u)) data = { subcategory_list: [] };',
  '  else if (/\\/error\\/view\\?/.test(u)) data = { subject_list: window.FIX_SITE_QS, total_items: window.FIX_SITE_QS.length };',
  '  else if (/\\/favorite\\/view\\?/.test(u)) data = { subject_list: [], total_items: 0 };',
  '  else if (/api\\/v2\\/tiku\\/\\d+\\/(\\d+)\\/analysis/.test(u)) {',
  '    var qid = Number(RegExp.$1);',
  '    data = { id: qid, question: "<p>补齐回来的第 " + qid + " 题题面。</p>",',
  '      option: [{ label: "A", content: "甲" }, { label: "B", content: "乙" }],',
  '      correct_answer: ["A"], user_answer: ["B"], explanation: "<p>补齐回来的解析正文。</p>" };',
  '  }',
  '  setTimeout(function () {',
  '    if (data == null) { o.onerror && o.onerror({ status: 404 }); return; }',
  '    o.onload && o.onload({ status: 200, responseText: JSON.stringify({ code: 0, msg: "ok", data: data }) });',
  '  }, 5);',
  '};',
  'window.GM_xmlhttpRequest = function (o) { window.__gthFake(o); };',
  'window.__gthRoot = null;',
  'window.angular = { element: function (node) { return {',
  '  scope: function () { return (node && node.__scope) || null; },',
  '  injector: function () { return { get: function () { return window.__gthRoot; } }; } }; } };',
  'setTimeout(function () {',
  '  var q = function (s) { return document.querySelectorAll(s).length; };',
  '  console.log("GTH_TRACE " + location.pathname + (location.search || "") +',
  '    " gth节点=" + q("[class*=gth-],[id^=gth-]") + " 计时键=" + q(".gth-timer-btn") +',
  '    " 用时带=" + q(".gth-ztop") + " 助手视图=" + q(".gth-view") +',
  '    " 题本卡=" + q("#gth-book-list .gth-book-card") + " 重练=" + q("#gth-quiz:not([hidden])") +',
  '    " 筛选框=" + q("#gth-book-view select"));',
  '}, 2200);',
  // 站点原生那一屏给 src（站点已经渲染完的样子），测的是 fitImgs 连站点的图一起管；
  // 上面 FIX_SITE_QS 给 data-src，测 wakeImgs 唤醒之后同一套分类还成立
  'var FIX_ITEM = { id: 901,',
  '  content: "<p>以下年份中，有 <img src=\\"" + FIX_FORMULA + "\\"> 种情况，最多的是？</p>",',
  '  material: "<p><img src=\\"" + FIX_CHART + "\\"></p>",',
  '  opt: [{ label: "A", content: "2015年" }, { label: "B", content: "2017年" }, { label: "C", content: "2018年" }],',
  '  correct_answer: ["C"], user_answer: ["C"],',
  '  analysis: "<p>增长量=现期量-基期量，比较时先截三位，得 2018 年增长量最大。</p>" +',
  '    "<p><img src=\\"" + FIX_FORMULA + "\\"></p>",',
  '  content_type: 0, examPointName: "资料分析", is_favorite: 0, index: 0 };',
  'localStorage.setItem("token_gongan_mingshi", "fixture-token");',
  'localStorage.setItem("gongan_tiku_helper_mingshi", JSON.stringify({',
  '  notes: { 901: { text: "增长量比较先截三位", snapshot: "以下年份中，江浙沪地区年人均消费支出年增长量最多的是", subject: 0, updated: Date.now() - 86400000 } },',
  '  highlights: { 902: [{ quote: "看表末列", color: "yellow", at: Date.now() - 3600000, block: "analysis", nth: 1, prefix: "" }] },',
  '  mastered: {}, wrongCount: { 901: 3 },',
  '  exported: { _v: 2, error: {}, favorite: {}, both: {}, mock: {} }, exportAt: {},',
  '  history: [], resume: {},',
  '  mockQs: { 903: { id: 903, content: "模考收进来的那道题", material: "", opt: [{ label: "A", content: "甲" }, { label: "B", content: "乙" }],',
  '    correct_answer: ["A"], user_answer: ["B"], analysis: "模考题的解析正文，题本里要能摊开看到。", content_type: 0,',
  '    module: "资料分析", examId: 5158, done: 1, ok: 0, at: Date.now() - 7200000 } },',
  '  mocks: {}, practiced: {}, qModule: { 901: "资料分析" }, qSrc: { 901: "error" },',
  '  qSrcAt: Date.now() - 60000, _v: 1',
  '}));',
  '// 补上 45 道只有笔记台记得的题，补充题本才够翻三页（一页 20 题那条口径要真的量得出来）',
  'var _st = JSON.parse(localStorage.getItem("gongan_tiku_helper_mingshi"));',
  // 同一枚大图按五种真实可能出现的排版各放一次，材料里再放一枚「形状像公式」的细长条；
  // ?gth_img=1 逐枚量渲染高度，并按 data-gth-shape 上的「应压 / 应不压」自己下判词
  'var FIX_SHAPES = "<p>8人参加演讲比赛，抽签决定参赛顺序，有<img data-gth-shape=\\"A 前后是文字|应压\\" src=\\"" + FIX_FORMULA_BIG + "\\">" +',
  '  "种情况，最多的是？</p>" +',
  '  "<p>平均每个月的同比增量=</p><p><img data-gth-shape=\\"B 独占一段|应压\\" src=\\"" + FIX_FORMULA_BIG + "\\"></p><p>亿元，正确；</p>" +',
  '  "<p>平均每个月的同比增量=<br><img data-gth-shape=\\"C br 隔开|应压\\" src=\\"" + FIX_FORMULA_BIG + "\\"><br>亿元，正确；</p>" +',
  '  "<p><span>平均每个月的同比增量=</span><img data-gth-shape=\\"D span 包字|应压\\" src=\\"" + FIX_FORMULA_BIG + "\\">" +',
  '  "<span>亿元，正确；</span></p>" +',
  '  "<p>如下饼图所示：</p><p><img data-gth-shape=\\"E 解析里的饼图|应不压\\" src=\\"" + FIX_PIE + "\\"></p>";',
  'for (var _i = 1; _i <= 45; _i++) {',
  '  _st.mockQs[1000 + _i] = { id: 1000 + _i, content: "<p>补充分页第 " + _i + " 题：下面哪一项说法正确？</p>",',
  '    material: _i === 1 ? "<p><img data-gth-shape=\\"F 材料里的细长条|应不压\\" src=\\"" + FIX_MAT_STRIP + "\\"></p>" : "",',
  '    opt: _i === 1 ? [{ label: "A", content: "<img data-gth-shape=\\"G 选项里的分式|应压\\" src=\\"" + FIX_FRACTION + "\\">" },',
  '      { label: "B", content: "<img data-gth-shape=\\"H 选项里的横图|应不压\\" src=\\"" + FIX_OPT_TABLE + "\\">" }]',
  '      : [{ label: "A", content: "甲说" }, { label: "B", content: "乙说" }], correct_answer: ["A"], user_answer: ["B"],',
  '    analysis: _i === 1 ? FIX_SHAPES : "<p>第 " + _i + " 题的解析正文，用来验收起与展开。</p>", content_type: 0, module: "资料分析",',
  '    examId: 5158, done: 1, ok: 0, at: Date.now() - 60000 * _i };',
  '}',
  'localStorage.setItem("gongan_tiku_helper_mingshi", JSON.stringify(_st));',
  '// ?gth_book=1 自动点开补充题本；?gth_quiz=1 自动开一轮 3 题重练，?gth_quiz=2 再顺手交卷',
  '// 脚本是同步内联进去的，但左菜单那两颗入口要等它跑完才有——所以轮询等，不在固定毫秒数上赌',
  'function __gthWait(what, fn) {',
  '  var tries = 0;',
  '  (function step() {',
  '    if (fn()) return;',
  '    if (++tries > 80) { console.log("GTH_FIXTURE 等不到 " + what); return; }',
  '    setTimeout(step, 50);',
  '  })();',
  '}',
  // ?gth_img=1：把题本第一页的解析全展开，逐枚量图片的渲染高度（布局类只能真渲染才量得到）
  'function __gthImgReport() {',
  '  function desc(n) {',
  '    if (!n) return "-";',
  '    var txt = String(n.nodeType === 3 ? n.nodeValue : (n.textContent || "")).replace(/\\s+/g, "");',
  '    return (n.nodeType === 3 ? "文字" : n.nodeName.toLowerCase()) + ":" + txt.length;',
  '  }',
  '  var rows = [];  var bad = 0;  var n = 0;',
  // 自动补齐题面会重排整页并把解析收回，量之前自己摊开一次：要量的是 CSS，不是那颗展开键
  '  var hid = document.querySelectorAll("#gth-book-list .gthq-analysis[hidden]");',
  '  for (var h = 0; h < hid.length; h++) hid[h].hidden = false;',
  '  var imgs = document.querySelectorAll("#gth-book-list img[data-gth-shape]");',
  '  for (var i = 0; i < imgs.length; i++) {',
  '    var el = imgs[i], r = el.getBoundingClientRect();',
  '    var host = el.closest(".gthq-analysis,.gthq-stem,.gthq-material") || el.parentElement;',
  '    var lh = parseFloat(getComputedStyle(host).lineHeight) || 28;',
  '    var shape = el.dataset.gthShape;',
  // 应压的那几枚上限是 4em（56px）；应不压的必须还是大图——两个方向都要红得出来',
  '    var wantSmall = shape.indexOf("应压") >= 0;',
  '    var okRow = wantSmall ? r.height <= 60 : r.height >= 100;',
  '    if (!okRow) bad++;',
  '    n++;',
  '    rows.push([okRow ? "OK  " : "BAD ", shape,',
  '      el.classList.contains("gth-img-formula") ? "认作公式" : "没认",',
  '      Math.round(r.width) + "x" + Math.round(r.height),',
  '      "原" + el.naturalWidth + "x" + el.naturalHeight,',
  '      "倍" + (r.height / lh).toFixed(1),',
  '      "前" + desc(el.previousSibling), "后" + desc(el.nextSibling)].join(" "));',
  '  }',
  '  rows.push("GTH_IMGSIZE 判定：" + (n && !bad ? "绿（" + n + " 枚各按期望）" : "红（" + bad + "/" + n + " 枚不合期望）"));',
  '  var pre = document.createElement("pre");',
  '  pre.id = "gth-imgsize";',
  '  pre.textContent = rows.join("\\n");',
  '  document.body.appendChild(pre);',
  '  console.log("GTH_IMGSIZE\\n" + rows.join("\\n"));',
  '  if (location.search.indexOf("gth_img=2") >= 0) __gthZoomProbe();',
  '}',
  // ?gth_img=2 多走一步：点一枚被压小的公式图，量「点开看原图」那一层开不开、收不收得回
  'function __gthZoomProbe() {',
  '  var f = document.querySelector("#gth-book-list img.gth-img-formula");',
  '  if (!f) return;',
  '  f.click();',
  '  setTimeout(function () {',
  '    var z = document.getElementById("gth-imgzoom");',
  '    var zi = z && z.querySelector("img");',
  '    var r = zi ? zi.getBoundingClientRect() : { width: 0, height: 0 };',
  '    var line = "GTH_ZOOM 开=" + (z && !z.hidden ? "是" : "否") +',
  '      " 原尺寸=" + Math.round(r.width) + "x" + Math.round(r.height) +',
  '      " 同一张图=" + (z && zi && zi.src === f.src ? "是" : "否");',
  '    if (z) { z.click(); line += " 点空白收=" + (z.hidden ? "是" : "否"); }',
  '    document.getElementById("gth-imgsize").textContent += "\\n" + line;',
  '    console.log(line);',
  '  }, 300);',
  '}',
  'setTimeout(function () {',
  '  var s = location.search;',
  '  if (s.indexOf("gth_book") >= 0 || s.indexOf("gth_img") >= 0) {',
  '    __gthWait("补充题本入口", function () {',
  '      var b = document.getElementById("gth-menu-book");',
  '      if (!b) return false;',
  '      b.click();',
  '      return true;',
  '    });',
  '  }',
  '  if (s.indexOf("gth_img") >= 0) {',
  '    __gthWait("题本解析展开行", function () {',
  '      var t = document.querySelectorAll("#gth-book-list .gth-btext[data-act=ana]");',
  '      if (!t.length) return false;',
  '      for (var i = 0; i < t.length; i++) t[i].click();',
  '      setTimeout(__gthImgReport, 800);',
  '      return true;',
  '    });',
  '  }',
  '  if (s.indexOf("gth_quiz") < 0) return;',
  '  __gthWait("重练面板", function () {',
  '    var go = document.getElementById("gth-start");',
  '    if (!go) return false;',
  '    var m = document.getElementById("gth-menu-helper");',
  '    if (m && m.classList.contains("active") === false) m.click();',
  '    var t = document.querySelector(".gth-tabs button[data-tab=practice]");',
  '    if (t) t.click();',
  '    var n = document.getElementById("gth-num");',
  '    if (n) n.value = "3";',
  '    var mi = document.getElementById("gth-min");',
  '    if (mi) mi.value = s.indexOf("gth_quiz=3") >= 0 ? "1" : "";',
  '    go.click();',
  '    setTimeout(function () {',
  '      __gthWait("答题态那一屏", function () {',
  '        var c = document.querySelectorAll("#gth-quiz .gth-choice")[s.indexOf("gth_quiz=2") >= 0 ? 1 : 0];',
  '        if (!c) return false;',
  '        c.click();',
  '        if (s.indexOf("gth_quiz=2") >= 0) {',
  '          // 停三秒半再交卷：每题用时不足一秒不显示，秒数太短就量不到那一格',
  '          setTimeout(function () {',
  '            var st = document.getElementById("gth-submit");',
  '            if (st) st.click();',
  '            setTimeout(function () {',
  '              var ow = document.getElementById("gth-onlywrong");',
  '              if (ow) { ow.checked = true; ow.dispatchEvent(new Event("change")); }',
  '            }, 300);',
  '          }, 3500);',
  '        }',
  '        return true;',
  '      });',
  '    }, 600);',
  '    return true;',
  '  });',
  '}, 900);'
].join('\n');

function page(title, bodyHtml, bootExtra) {
  if (!bodyHtml) throw new Error('页面主体是空的：bodyHtml 声明得排在 ROUTES 之前');
  return ['<!doctype html><html lang="zh"><head><meta charset="utf-8">',
    '<title>' + title + '</title><style>' + STYLE + '</style></head><body>',
    '<script>' + BOOT + (bootExtra || '') + '</script>',
    bodyHtml,
    '<script>' + script + '</script>',
    '</body></html>'].join('\n');
}

var INDEX_BODY = [
  '<div class="gongan2-container"><div class="right-content" style="display:flex">',
  '<div class="left-menu"><div class="item">行测</div><div class="item">公安专业知识</div><div class="item">错题本</div></div>',
  '<div class="inner-content"><div class="content" id="gth-list"></div></div>',
  '</div></div>',
  '<script>',
  'var items = [FIX_ITEM,',
  '  { id: 902, content: "<p>表2 中全国居民人均消费支出最高的年份是？</p>", material: "",',
  '    opt: [{ label: "A", content: "2018年" }, { label: "B", content: "2019年" }], correct_answer: ["B"], user_answer: ["A"],',
  '    analysis: "<p>看表末列，2019 年最高。</p>", content_type: 0, examPointName: "资料分析" },',
  '  { id: 904, content: "<p>这道题只被摊开过，没写过笔记也没划过线。</p>", material: "", opt: [{ label: "A", content: "甲" }],',
  '    correct_answer: ["A"], user_answer: [], analysis: "<p>不该被囤进快照库。</p>", content_type: 0, examPointName: "判断推理" }];',
  'var list = document.getElementById("gth-list");',
  'items.forEach(function (it, no) {',
  '  var box = document.createElement("div");',
  '  box.className = "question-outer";',
  '  box.setAttribute("ng-repeat", "item in subjectList");',
  '  box.__scope = { item: it };',
  '  var right = (it.correct_answer || []).concat();',
  '  box.innerHTML = "<div class=\\"q-row\\"><div class=\\"sequence\\"><div class=\\"sequence-box\\">" + (no + 1) + "</div></div>" +',
  '    "<div class=\\"q-col\\"><div class=\\"stem\\">" + it.content + "</div><div class=\\"options\\">" +',
  '    it.opt.map(function (o) {',
  '      var c = right.indexOf(o.label) >= 0 ? " right" :',
  '        ((it.user_answer || []).indexOf(o.label) >= 0 ? " wrong" : "");',
  '      return "<div class=\\"choice\\"><div class=\\"label\\"><div class=\\"circle" + c + "\\"></div></div>" +',
  '        "<div class=\\"ctext\\"><div>" + o.label + ".</div><div>" + o.content + "</div></div></div>";',
  '    }).join("") + "</div>" +',
  '    "<div class=\\"analysis\\">" + it.analysis + "</div></div></div>" +',
  '    "<div class=\\"bottom-line\\"><div class=\\"line\\"></div><div class=\\"txt\\">展开 查看解析</div></div>";',
  '  list.appendChild(box);',
  '});',
  '</script>'
].join('\n');

var ZY_BODY = [
  '<div class="operation-dati" style="display:flex;justify-content:flex-end;align-items:center;' +
  'min-height:60px;padding:0 16px;background:#fff;border-bottom:1px solid #e2e8f0"></div>',
  '<div class="sheet-box"><label>只看错题</label><div id="sheet"></div><div>资料分析</div></div>',
  '<div class="question-box" id="zy-box"></div>',
  '<script>',
  'var sheet = document.getElementById("sheet");',
  '[0, 1, 2].forEach(function (i) {',
  '  var cell = document.createElement("div");',
  '  cell.setAttribute("ng-repeat", "item in item.subjectList");',
  '  cell.__scope = { item: { id: 901 + i, index: i } };',
  '  cell.textContent = ' + "'选中' + (i + 1) + '或解';",
  '  sheet.appendChild(cell);',
  '});',
  'var li = document.createElement("li");',
  'li.setAttribute("ng-repeat", "subjectObj in localStorage.currentPartData.subjectList");',
  'li.__scope = { subjectObj: FIX_ITEM, isAlreadySubmit: true, isViewAnalysis: true,',
  '  localStorage: { currentIndex: 0, currentPartData: { subjectList: [FIX_ITEM,',
  '    { id: 902, index: 1 }, { id: 903, index: 2 }] } } };',
  'li.innerHTML = "<div class=\\"q-head\\"><span>1 （单选）</span><span class=\\"sp\\"></span>" +',
  '  "<span>☆ 收藏本题</span><span>纠错</span></div>" +',
  '  "<div class=\\"material\\">" + FIX_ITEM.material + "</div><div class=\\"stem\\">" + FIX_ITEM.content + "</div>" +',
  '  "<div class=\\"options\\"></div>" +',
  '  "<div class=\\"analysis\\"><b>解析</b><p>" + FIX_ITEM.analysis.replace(/<\\/?p>/g, "") + "</p>" +',
  '  "<div>正确答案：C 我的答案：C</div></div>";',
  'var opts = li.querySelector(".options");',
  'FIX_ITEM.opt.forEach(function (o) {',
  '  var row = document.createElement("div");',
  '  row.setAttribute("ng-repeat", "o in subjectObj.opt");',
  '  row.__scope = Object.create(li.__scope);',
  '  row.__scope.o = o;',
  '  row.innerHTML = "<span>" + o.label + "、</span><span>" + o.content + "</span>";',
  '  opts.appendChild(row);',
  '});',
  'document.getElementById("zy-box").appendChild(li);',
  'document.body.__scope = { isAlreadySubmit: true };',
  'localStorage.setItem("gth_qtime_mingshi", JSON.stringify({',
  '  2680: { q: { 901: 125, 902: 47, 903: 8 }, paused: 63, lost: 2, merged: 0 } }));',
  'setTimeout(function () {',
  '  if (location.search.indexOf(' + "'gth_qtime" + '\x27) < 0) return;',
  '  // 用时卡片：点开 → 记状态 → 点空白 → 再记状态（用户报的是「展开后无法收回」）',
  '  var h = document.querySelector(".gth-qtime-h");',
  '  var band = document.querySelector(".gth-qtime");',
  '  if (!h || !band) { console.log("GTH_QTIME 这一屏没挂上用时带"); return; }',
  '  h.click();',
  '  setTimeout(function () {',
  '    var line = "GTH_QTIME 点开=" + (band.classList.contains("on") ? "开" : "没开");',
  '    document.body.click();',
  '    line += " 点空白=" + (band.classList.contains("on") ? "没收回" : "已收回");',
  '    var pre = document.createElement("pre");',
  '    pre.id = "gth-qtime";',
  '    pre.textContent = line;',
  '    document.body.appendChild(pre);',
  '    console.log(line);',
  '  }, 200);',
  '}, 1400);',
  'setTimeout(function () {',
  '  if (location.search.indexOf(' + "'gth_open" + '\x27) < 0) return;',
  '  var b = document.querySelector(".gth-abar [data-act=\\\"note\\\"]");',
  '  if (b) b.click();',
  '}, 700);',
  '</script>'
].join('\n');

var MK_BODY = [
  '<div style="padding:16px;background:#1d3d6b;color:#fff">模考报告　60.8</div>',
  '<div style="padding:16px">最高分 91.2　平均分 67.5</div>',
  '<div id="mk-list"></div>',
  '<div style="position:fixed;bottom:0;left:0;right:0;display:flex;background:#2b4f7a;color:#fff">',
  '  <div style="flex:1;text-align:center">错题解析</div><div style="flex:1;text-align:center">全部解析</div></div>',
  '<script>',
  'var mk = document.getElementById("mk-list");',
  '[9001, 9002].forEach(function (id, i) {',
  '  var row = document.createElement("div");',
  '  row.className = "question-outer";',
  '  row.setAttribute("ng-repeat", "item in jiexieSubjects");',
  '  row.__scope = { item: { id: id, result: i, examPointId: 12, examPointName: "资料分析" } };',
  '  row.innerHTML = "<div>第 " + (i + 1) + " 题</div><div class=\\"analysis\\"><p>这一屏的正文由站点逐题补，列表态 scope 没有题干。</p></div>";',
  '  mk.appendChild(row);',
  '});',
  '</script>'
].join('\n');

var MK_EXTRA = [
  'var cur = JSON.parse(localStorage.getItem("gongan_tiku_helper_mingshi") || "{}");',
  'cur.mockQs = cur.mockQs || {};',
  'cur.mockQs["9001"] = { id: 9001, content: "模考里第 1 题的题面", material: "",',
  '  opt: [{ label: "A", content: "甲" }], correct_answer: ["A"], user_answer: ["B"],',
  '  analysis: "模考题的解析正文", content_type: 1, module: "资料分析", examId: 5158, done: 1, ok: 0, at: Date.now() - 60000 };',
  'localStorage.setItem("gongan_tiku_helper_mingshi", JSON.stringify(cur));'
].join('\n');

var MAT_BODY = [
  '<div class="question-box" id="mat-box"></div>',
  '<script>',
  'var MATERIAL = "表：某市经济社会发展主要指标（2022—2023年上半年）";',
  'var OPTS = [{ id: 911, index: 11 }, { id: 912, index: 12 }, { id: 913, index: 13 }];',
  'var mk = function (i, stem) { return { id: 911 + i, index: 11 + i, content: "<p>" + stem + "</p>",',
  '  material: "<p>" + MATERIAL + "</p>",',
  '  opt: [{ label: "A", content: "2022年第二季度" }, { label: "B", content: "2022年第三季度" }],',
  '  correct_answer: ["C"], user_answer: ["B"], analysis: "<p>按表比较四个季度，第四季度最高。</p>",',
  '  content_type: 0, examPointName: "资料分析", opts: OPTS }; };',
  'var LIST = [mk(0, "2022年第一季度—2023年第二季度，该市进出口总额最多的季度是？"),',
  '  mk(1, "2022年该市第三产业增加值占比最高的季度是？"), mk(2, "2023年上半年该市工业用电量同比增速约为？")];',
  'var li = document.createElement("li");',
  'li.setAttribute("ng-repeat", "subjectObj in localStorage.currentPartData.subjectList");',
  'li.__scope = { subjectObj: LIST[0], isAlreadySubmit: true, isViewAnalysis: true,',
  '  localStorage: { currentIndex: 11, currentPartData: { is_group: true, subjectList: LIST } } };',
  'li.innerHTML = "<div class=\\"q-head\\"><span>11 - 13 （材料）</span><span class=\\"sp\\"></span>" +',
  '  "<span>☆ 收藏本题</span><span>纠错</span></div>" +',
  '  "<div class=\\"material\\">" + MATERIAL + "</div><div class=\\"stem\\">" + LIST[0].content + "</div>" +',
  '  "<div class=\\"options\\"></div>" +',
  '  "<div class=\\"analysis\\"><b>解析</b><p>按表比较四个季度，第四季度最高。</p>" +',
  '  "<div>正确答案：C 我的答案：B</div></div>";',
  'document.getElementById("mat-box").appendChild(li);',
  'document.body.__scope = { isAlreadySubmit: true };',
  'localStorage.setItem("gth_qtime_mingshi", JSON.stringify({',
  '  2681: { q: { 911: 289 }, paused: 0, lost: 0, merged: 0 } }));',
  '</script>'
].join('\n');

var LIVE_BODY = [
  '<div class="operation-dati" style="display:flex;justify-content:flex-end;align-items:center;' +
  'min-height:60px;padding:0 16px;background:#2178db;color:#fff">',
  '  <span class="remain-time"><a>参考用时 20:00</a></span></div>',
  '<div class="question-box"><div class="stem"><p>答题态：这一屏只该多一颗暂停键，助手那半一个字都不许出现。</p></div></div>',
  '<script>',
  'var ls = { totalTime: 1200, elapsed_time: 305, currentIndex: 11,',
  '  partData: [{ name: "资料分析", remainTime: 600 }],',
  '  currentPartData: { is_group: true, subjectList: [{ id: 911, index: 11 }, { id: 912, index: 12 }, { id: 913, index: 13 }] } };',
  'window.__gthRoot = { localStorage: ls, allInterval: {}, partInterval: null, isAlreadySubmit: false,',
  '  $parent: { allTime: "20:00" }, $$childHead: null, $$nextSibling: null };',
  'document.body.__scope = { isAlreadySubmit: false };',
  '</script>'
].join('\n');

var PRAC_BODY = [
  '<div class="operation-dati" style="display:flex;justify-content:flex-end;align-items:center;' +
  'min-height:60px;padding:0 16px;background:#2178db;color:#fff">',
  '  <span class="remain-time"><a>用时 12:30</a></span></div>',
  '<div class="question-outer"><div>练习页：这一页助手那半不许有任何痕迹。</div></div>'
].join('\n');

var ROUTES = {
  '/mingshi/wxpage/tiku/gongan/index.html': page('夹具 · 题库首页', INDEX_BODY),
  '/mingshi/wxpage/tiku/gongan/zhuanxiang.html': page('夹具 · 专项解析页', ZY_BODY),
  '/mingshi/wxpage/tiku/mocks/index.html': page('夹具 · 模考报告解析页', MK_BODY, MK_EXTRA)
};

var EXACT = {
  '/mingshi/wxpage/tiku/gongan/zhuanxiang.html?status=finished&submit_id=fixture&content_id=5&exam_id=2681&label_id=15&agency_commodity_id=701':
    page('夹具 · 专项解析页（材料组）', MAT_BODY),
  '/mingshi/wxpage/tiku/gongan/zhuanxiang.html?status=finished&submit_id=fixture&content_id=5&exam_id=2680&label_id=15&agency_commodity_id=701&gth_qtime=1':
    page('夹具 · 专项解析页（量用时卡片）', ZY_BODY),
  '/mingshi/wxpage/tiku/gongan/zhuanxiang.html?exam_id=2699&content_id=5&label_id=15&agency_commodity_id=701':
    page('夹具 · 专项答题态', LIVE_BODY),
  '/mingshi/wxpage/tiku/gongan/practice.html': page('夹具 · 练习模式', PRAC_BODY),
  '/mingshi/wxpage/tiku/gongan/practice.html?page_type=random&content_id=5&label_id=15':
    page('夹具 · 考试模式', PRAC_BODY)
};


if (!SERVE) {
  var out = path.join(os.tmpdir(), 'gth_fixture_index.html');
  fs.writeFileSync(out, ROUTES['/mingshi/wxpage/tiku/gongan/index.html']);
  console.log(out);
  process.exit(0);
}

var PORT = Number(process.env.GTH_PORT || 8731);
http.createServer(function (req, res) {
  var p = req.url.split('?')[0];
  var body = EXACT[req.url] || ROUTES[p];
  res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body || 'no fixture for ' + p);
}).listen(PORT, '127.0.0.1', function () {
  var base = 'http://127.0.0.1:' + PORT + '/mingshi/wxpage/tiku/';
  console.log(base + 'gongan/index.html#/error　（错题页：注入那行小条与页边批注栏）');
  console.log(base + 'gongan/index.html?gth_book=1#/error　（补充题本：对齐错题页那一屏）');
  console.log(base + 'gongan/index.html?gth_img=1#/error　（题本里的图：逐枚量渲染高度，控制台与 #gth-imgsize 各一份）');
  console.log(base + 'gongan/index.html?gth_quiz=1#/error　（重练答题态：照站点专项练习页）');
  console.log(base + 'gongan/index.html?gth_quiz=2#/error　（重练交卷后：一屏一题带解析）');
  console.log(base + 'gongan/index.html?gth_quiz=3#/error　（重练限时 1 分钟：头部该有暂停键）');
  console.log(base + 'gongan/zhuanxiang.html?status=finished&submit_id=fixture&content_id=5&exam_id=2680&label_id=15&agency_commodity_id=701');
  console.log(base + 'gongan/zhuanxiang.html?status=finished&submit_id=fixture&content_id=5&exam_id=2680&label_id=15&agency_commodity_id=701&gth_qtime=1'
    + '　（用时卡片：点开与点空白收回，控制台一行 GTH_QTIME）');
  console.log(base + 'gongan/zhuanxiang.html?status=finished&submit_id=fixture&content_id=5&exam_id=2681&label_id=15&agency_commodity_id=701'
    + '　（材料组）');
  console.log(base + 'gongan/zhuanxiang.html?exam_id=2699&content_id=5&label_id=15&agency_commodity_id=701　（答题态）');
  console.log(base + 'gongan/practice.html　（练习模式：应当零痕迹）');
  console.log(base + 'gongan/practice.html?page_type=random&content_id=5&label_id=15　（考试模式：只有计时键）');
  console.log(base + 'mocks/index.html?agency_commodity_id=701&content_id=5&exam_type=1#/mocks/baogao/5158/detailv3');
});
