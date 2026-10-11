
const fs = require('fs');
const blankLiterals = require('./blank_literals');

const FILE = process.argv[2] || 'shangancun-exam-helper.user.js';
const raw = fs.readFileSync(FILE, 'utf8');
const blank = blankLiterals(raw);

// 合并成一份之后，两半靠段落边界注释切开：判据各自在自己的那一片里数，别把邻居的文本算进来。
const MARK_TIMER = '// ===== 计时暂停';
const MARK_HELPER = '// ===== 机考助手';
function lf(s) { return s.replace(/\r\n/g, '\n'); }
function halves(text) {
  const src = lf(text);
  const a = src.indexOf(MARK_TIMER), b = src.indexOf(MARK_HELPER);
  if (a < 0 || b < 0 || b < a) throw new Error('分不出两半：找不到段落边界注释');
  return { timer: src.slice(a, b), helper: src.slice(b), whole: src };
}

function sliceToStatementEnd(from) {
  // 正则字面量里也有 ( ) [ ] { } ; —— 图片判据那几个正则带了字符类与非捕获组。
  // 不跳过字面量就会把正则里的括号当成配对，把语句截在半路（那条领起词正则曾因此抽不出来）。
  // 判据取巧一点没关系：这里只用来切 `var X = …;` 这种声明，正则只会出现在初值里，
  // 而除号（a / b）在这个文件里只出现在语句中段、深度不为 0，不会误判成正则开头。
  let depth = 0;
  let inRe = false, inStr = null, inClass = false, esc = false;
  for (let i = from; i < blank.length; i++) {
    const c = blank[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (inRe) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) inRe = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && depth === 0) { inRe = true; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ';' && depth === 0) return raw.slice(from, i + 1);
  }
  throw new Error('语句没有收尾：' + raw.slice(from, from + 60));
}

function fnSource(name) {
  const needle = '\n  function ' + name + '(';
  const at = blank.indexOf(needle);
  if (at < 0) throw new Error('脚本里找不到函数：' + name);
  const start = at + 1;
  let depth = 0, i = blank.indexOf('{', start), end = i;
  for (; end < blank.length; end++) {
    const c = blank[end];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) break; }
  }
  if (i < 0 || depth !== 0) throw new Error('函数体花括号不配对：' + name);
  return raw.slice(start, end + 1);
}

function varSource(name) {
  const re = new RegExp('\n  var ' + name + ' = ');
  const m = re.exec(blank);
  if (!m) throw new Error('脚本里找不到变量：' + name);
  const start = m.index + 1;
  let out = sliceToStatementEnd(start);

  const lines = raw.slice(start).split('\n');
  const extra = [];
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.indexOf(name + '[') === 0 && /;$/.test(t)) extra.push(lines[i]);
    else break;
  }
  return out + extra.join('\n');
}

const CONSTS = ['SUBJ_ZY', 'SUBJ_XC', 'SUBJECT_NAME', 'DAY_RANGES', 'SITE_LIST_CAP', 'FACE_CAP', 'MASTER_STREAK',
  'WRONG_BASE', 'STUBBORN_MIN', 'ERR_COUNT_KEYS', 'SRC_KEYS', 'SRC_NAME', 'MOCK_UNCLS',
  'PUNCT_RE', 'KEYACT', 'EXPORT_PREFIX',
  'MOCK_QID_KEYS', 'MOCK_STEM_KEYS', 'MOCK_MAT_KEYS', 'MOCK_OPT_KEYS', 'MOCK_USER_KEYS',
  'MOCK_CORRECT_KEYS', 'MOCK_ANALYSIS_KEYS', 'MOCK_SUBJECT_KEYS', 'MOCK_RESULT_KEYS',
  'MOCK_MODULE_KEYS', 'selectedModules', 'selectedMockModules', 'practiceSrcs',
  'notesFilter', 'notesSearchKey', 'examPointModule', 'SRC_LIST_LABEL', 'BOOK_PER_PAGE',
  'bookShownIds', 'bookPage', 'faceTried', 'IMG_INLINE_TEXT', 'IMG_BOTH_SIDES',
  'IMG_2LINE_RATIO', 'IMG_2LINE_TALL', 'IMG_2LINE_MID', 'IMG_2LINE_MID_RATIO',
  'IMG_LEAD', 'IMG_OP_TAIL', 'IMG_CONT', 'IMG_MATERIAL_HOST', 'IMG_TEXT_HOST', 'bookFilter',
  'IMG_FORMULA_HOST', 'IMG_FRACTION_HOST', 'IMG_FORMULA_RATIO'];

const FNS = ['ansKey', 'serverErrCount', 'errCountOf', 'masteredLabel', 'isMastered',
  'bumpWrongCount', 'markPracticed', 'isPracticed', 'moduleOf', 'rememberModule',
  'getHighlights', 'countHighlights', 'pickKey',
  'srcList', 'srcLabel', 'dayLabel', 'subjectDesc', 'filterDesc', 'currentSrc', 'readFilter',
  'mockModuleOf', 'mockResultOf', 'mockParseAns', 'mockParseOpt', 'looksLikeQuestion',
  'mockFieldMap', 'mergeMockQs', 'mockMatchModule', 'mockToList', 'mockAllList', 'mockWrongList',
  'mockModuleOptions', 'tierOf', 'weightedShuffle', 'weightedPick',
  'masteryKey', 'noteFacets', 'noteMatch', 'mergeConcurrent', 'fetchByFilter',
  'hasSiteSrc', 'notesNarrowed', 'norm', 'normMap', 'hlHoldLost', 'migrateHlLost', 'washHlLost',
  'buildExamPointIndex', 'rememberModulesFromPoints',
  'resumeKeyOld', 'readResume', 'clearResume', 'staleResumeKeys', 'strayStorageKeys', 'ensureExamPointIndex',
  'examTypeFrom', 'subjectFromUrl', 'routeExamType', 'sweepFacets', 'reconcileSources', 'backfillSubject',
  'inSiteLists', 'reconciled',
  'subjectForExport',
  'fetchXingce', 'buildModuleOptions', 'fetchXingceBy', 'fetchFavoriteXingce',
  'listPath', 'listParams', 'esc', 'hlRowHtml', 'noteIdsWithHl',
  'analysisOf', 'snapCopy', 'harvestSnapshot', 'harvestPageSnap', 'pageFrom', 'snapOf', 'snapState',
  'bookIds', 'bookQuestion', 'bookList', 'orphanSnapIds', 'backfillSnaps', 'ansList',
  'bookFacets', 'bookMatch', 'bookSearchHit', 'apiSubjectFace', 'faceTypesOf', 'faceGapIds', 'fillOneFace',
  'noteboxHtml', 'abarHtml', 'abarPanelHtml', 'questionCardHtml', 'migrateExported', 'subjectOf',
  'isZyPage', 'zyUrlSubmitted', 'zyScopeSubmitted', 'analysisReady', 'isZyAnalysis', 'abarSig',
  'questionOf',
  'analysisNodeVar', 'analysisScopeItem', 'prunePageRefs',
  'pad2', 'unitIdOf', 'noteAreaHtml', 'noteExcerpt', 'bindNoteArea', 'bindNoteAreas',
  'toggleAbarNote', 'renderBookSides', 'bookCardNode', 'bindBookPager', 'bookPageIds', 'bookPageTotal',
  'qtimeExamId', 'qtimeAll', 'qtimeSession', 'qtimeSec', 'qtimeText',
  'qtimeOrder', 'qtimeRows', 'recapSig', 'qtimeBandHtml', 'imgIsLead', 'imgNeighborText', 'imgTextRole',
  'imgLeadNearby', 'imgSizeRole', 'imgFitRole',
  'tallySecond', 'recSum', 'copyWithToast'];

const PRELUDE = [
  'var console = { log: noop, warn: function (m) { ctx.warns.push(String(m)); }, error: noop };',
  'function noop() {}',
  "var LS_STORE = 'gth_test_store';",
  "var API_V2 = 'https://pub.xdapi.top/mingshi/api/v2/';",
  'var store = ctx.store;',
  'var saveStore = function () { ctx.saved++; };',
  'var setStatus = function (m) { ctx.status.push(m); };',
  'var invalidateLoaded = function () { ctx.invalidated++; };',
  'var apiGet = function (url, p) { ctx.api.push([url, p]); return ctx.apiResult(); };',
  'var getCommodity = function () { return Promise.resolve({ content_id: 7, id: 8 }); };',
  'var fetchErrors = function (f, limit) { ctx.calls.push(["error", f]); return Promise.resolve(ctx.errors || []); };',
  'var fetchFavorites = function (f) { ctx.calls.push(["favorite", f]); return Promise.resolve(ctx.favorites || []); };',
  'var fetchSubcategory = function () { ctx.sub.push(1); return Promise.resolve(ctx.subcategory || []); };',
  'var normalize = function (q) { return q; };',
  'var onProgress = null;',
  'var $ = function (sel) { return (ctx.el || {})[sel] || null; };',
  'var location = ctx.location || { search: "", hash: "" };',
  'var isListRoute = function () { return !!ctx.listRoute; };',
  'var $$ = function () { return []; };',
  'var localStorage = { getItem: function () { return ctx.disk; } };',
  'var alert = function (m) { ctx.alerts.push(String(m)); };',
  'var icon = function (n) { return "<svg>" + n + "</svg>"; };',
  'var stripHtml = function (s) { return String(s == null ? "" : s).replace(/<[^>]+>/g, ""); };',
  'var wakeImgs = function (s) { return String(s == null ? "" : s); };',
  'var copyText = function (t) { (ctx.copied = ctx.copied || []).push(t); return ctx.copyOk !== false; };',
  'var toast = function (m) { (ctx.toasts = ctx.toasts || []).push(m); };',
  'var getNote = function (id) { return (store.notes[id] && store.notes[id].text) || ""; };',
  'var itemsById = ctx.itemsById || {};',
  'var qNodes = ctx.qNodes || {};',
  'var quiz = ctx.quiz || null;',
  'var routeKind = function () { return ctx.routeKind || ""; };',
  'var isMocksPage = function () { return !!ctx.mocksPage; };',
  'var getAngular = function () { return ctx.ng || null; };',
  'var analysisNodes = function () { return ctx.analysisNodes || []; };',
  'var QTIME_KEY = "gth_qtime_mingshi";',
  'var qtimeErr = "";',
  'var qtimeOpen = false;',
  'var document = { querySelector: function () { return null; }, querySelectorAll: function () { return []; } };'
];

const EXPOSED = [
  'srcList', 'srcLabel', 'filterDesc', 'readFilter', 'fetchByFilter', 'hasSiteSrc',
  'mockModuleOf', 'mockFieldMap', 'mergeMockQs', 'mockToList', 'mockAllList', 'mockWrongList',
  'mockModuleOptions', 'tierOf', 'weightedPick', 'weightedShuffle', 'errCountOf', 'moduleOf',
  'rememberModule', 'markPracticed', 'isPracticed', 'noteFacets', 'noteMatch', 'masteryKey',
  'mergeConcurrent', 'masteredLabel', 'store', 'notesNarrowed', 'norm', 'normMap', 'KEYACT',
  'getSelectedMock: function () { return selectedMockModules; }',
  'getPracticeSrcs: function () { return practiceSrcs; }',
  'getSaved: function () { return ctx.saved; }',
  'fetchXingce', 'buildModuleOptions', 'fetchFavoriteXingce', 'listPath', 'listParams', 'hlRowHtml', 'noteIdsWithHl', 'pickKey',
  'hlHoldLost', 'migrateHlLost', 'washHlLost', 'buildExamPointIndex', 'rememberModulesFromPoints',
  'SRC_NAME', 'SRC_KEYS', 'SRC_LIST_LABEL', 'SUBJ_XC', 'SUBJ_ZY', 'EXPORT_PREFIX', 'resumeKeyOld', 'readResume', 'clearResume', 'SITE_LIST_CAP', 'FACE_CAP',
  'staleResumeKeys', 'strayStorageKeys', 'ensureExamPointIndex', 'SRC_LIST_LABEL',
  'examTypeFrom', 'subjectFromUrl', 'routeExamType', 'sweepFacets', 'reconcileSources', 'backfillSubject',
  'inSiteLists', 'reconciled',
  'subjectForExport', 'harvestSnapshot', 'harvestPageSnap', 'pageFrom', 'snapOf', 'snapCopy', 'snapState',
  'bookIds', 'bookQuestion', 'bookList', 'orphanSnapIds', 'backfillSnaps', 'ansList',
  'bookFacets', 'bookMatch', 'bookSearchHit', 'apiSubjectFace', 'faceTypesOf', 'faceGapIds', 'fillOneFace',
  'noteboxHtml', 'abarHtml', 'abarPanelHtml', 'questionCardHtml', 'migrateExported', 'analysisOf', 'questionOf', 'subjectOf',
  'isZyPage', 'abarSig', 'zyUrlSubmitted', 'analysisReady', 'isZyAnalysis', 'bookFilter', 'MOCK_UNCLS',
  'analysisNodeVar', 'analysisScopeItem', 'prunePageRefs',
  'getItemsById: function () { return itemsById; }',
  'getQNodes: function () { return qNodes; }',
  'unitIdOf', 'noteAreaHtml', 'bookPageIds', 'bookPageTotal', 'BOOK_PER_PAGE',
  'setBookShown: function (v) { bookShownIds = v; }',
  'setBookPage: function (v) { bookPage = v; }',
  'getBookPage: function () { return bookPage; }',
  'qtimeExamId', 'qtimeAll', 'qtimeSession', 'qtimeSec', 'qtimeText',
  'qtimeOrder', 'qtimeRows', 'recapSig', 'qtimeBandHtml', 'imgNeighborText', 'imgTextRole',
  'imgIsLead', 'imgLeadNearby', 'imgSizeRole', 'imgFitRole', 'IMG_INLINE_TEXT', 'IMG_BOTH_SIDES',
  'IMG_2LINE_RATIO', 'IMG_2LINE_TALL', 'IMG_2LINE_MID', 'IMG_2LINE_MID_RATIO', 'IMG_LEAD', 'IMG_OP_TAIL', 'IMG_CONT',
  'IMG_MATERIAL_HOST', 'IMG_TEXT_HOST', 'IMG_FORMULA_HOST', 'IMG_FRACTION_HOST', 'IMG_FORMULA_RATIO',
  'tallySecond', 'recSum', 'copyWithToast',
  'getQtimeErr: function () { return qtimeErr; }',
  'getQtimeKey: function () { return QTIME_KEY; }'
];
const EXPOSE = "return {" + EXPOSED.map(function (n) { return n.indexOf(':') >= 0 ? n : n + ': ' + n; }).join(', ') + '};';

function build(ctx) {
  const body = PRELUDE.join('\n') + '\n' +
    CONSTS.map(varSource).join('\n') + '\n' +
    FNS.map(fnSource).join('\n') + '\n' +
    'if (ctx.practiceSrcs) practiceSrcs = ctx.practiceSrcs;\n' +
    'if (ctx.selectedModules) selectedModules = ctx.selectedModules;\n' +
    'if (ctx.selectedMockModules) selectedMockModules = ctx.selectedMockModules;\n' +
    'if (ctx.notesFilter) notesFilter = ctx.notesFilter;\n' +
    'if (ctx.notesSearchKey != null) notesSearchKey = ctx.notesSearchKey;\n' +
    'if (ctx.examPointModule) examPointModule = ctx.examPointModule;\n' +
    EXPOSE;
  try {
    const api = new Function('ctx', body)(Object.assign({
      store: {}, warns: [], status: [], saved: 0, invalidated: 0, api: [], sub: [], alerts: [], calls: [],
      apiResult: function () { return Promise.resolve({ subject_list: [] }); }
    }, ctx || {}));

    return new Proxy(api, {
      get: function (t, k) {
        if (typeof k === 'symbol' || k in t) return t[k];
        throw new Error('EXPOSED 里没有 ' + String(k) + '：FNS 抽了这个名字，忘了同步进 EXPOSED');
      }
    });
  } catch (e) {
    console.log('[X] 沙箱构建失败：' + e.message + '\n    （抽出来的原文不自洽，多半是依赖的函数/变量改名了）');
    throw e;
  }
}

let pass = 0;
const fails = [];
function ok(cond, label, detail) {
  if (cond) { pass++; return; }
  fails.push(label + (detail ? '　→ ' + detail : ''));
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  ok(a === b, label, a === b ? '' : '实得 ' + a + '，应为 ' + b);
}
function ids(list) { return list.map(function (q) { return String(q.id); }).sort(); }
function mkStore(o) {
  return Object.assign({
    notes: {}, mastered: {}, wrongCount: {}, exported: {}, exportAt: {}, highlights: {},
    mockQs: {}, mocks: {}, resume: {}, history: [], practiced: {}, qModule: {}, qSrc: {}, snaps: {}
  }, o || {});
}
function q(id, extra) { return Object.assign({ id: id, content: '题干' + id, opt: [], correct_answer: ['A'] }, extra || {}); }

(function t1() {
  const m = build();
  eq(m.srcList({ src: 'both' }), ['error', 'favorite'], 'T1 旧记录 src=both 展开成两个来源');
  eq(m.srcList({ src: 'mock' }), ['mock'], 'T1 旧记录 src=mock 原样');
  eq(m.srcList({ srcs: ['mock', 'error', 'error'] }), ['mock', 'error'], 'T1 多选去重且保序');
  eq(m.srcList({ srcs: ['nope', 'error'] }), ['error'], 'T1 不认识的来源被丢掉');
  eq(m.srcList({}), ['error'], 'T1 没写来源时退回错题本');
  eq(m.srcLabel(['error', 'mock']), '错题本＋模考收录', 'T1 来源描述用勾选项的名字');
})();

(function t2() {
  const m = build();
  eq(m.filterDesc({ srcs: ['error', 'favorite'], mode: 'date', dayRange: '0' }),
    '错题本＋收藏夹 · 日期：当天', 'T2 两个站点来源＋日期');
  eq(m.filterDesc({ srcs: ['error', 'mock'], mode: 'subject', subject: 0,
    module_names: ['资料分析'], mock_modules: ['政治理论'] }),
    '错题本 · 行政职业能力测试（资料分析） ＋ 模考收录（政治理论）', 'T2 站点条件与模考模块各写各的');
  eq(m.filterDesc({ srcs: ['mock'], mode: 'date', dayRange: '1' }),
    '模考收录（全部模考题）', 'T2 只勾模考时不出现日期/科目（模考题没有这两维）');
  eq(m.filterDesc({ srcs: ['mock'], mock_modules: ['法律'] }),
    '模考收录（法律）', 'T2 模考模块进了描述，resumeKey 才能按它区分');
  eq(m.filterDesc({ src: 'both', mode: 'subject', subject: 1 }),
    '错题本＋收藏夹 · 公安专业知识', 'T2 旧的单 src 组卷历史仍能描述');
})();

(function t3() {
  const m = build({
    el: {
      '#gth-mode': { value: 'subject' }, '#gth-subject': { value: '0' },
      '#gth-src': { value: 'both' }, '#gth-day': { value: '0' }
    },
    practiceSrcs: ['mock'],
    selectedModules: ['资料分析'],
    selectedMockModules: ['政治理论']
  });
  const ex = m.readFilter('export');
  eq(ex.srcs, ['both'], 'T3 导出 pane 仍读单选下拉');
  eq(ex.module_names, ['资料分析'], 'T3 导出 pane 带上行测模块');
  ok(ex.mock_modules === undefined, 'T3 没勾模考收录时不把模块勾选写进条件（看不见的筛选不算条件）');
  const pr = m.readFilter('practice');
  eq(pr.srcs, ['mock'], 'T3 重练 pane 读勾选式多选');
  eq(pr.mock_modules, ['政治理论'], 'T3 勾了模考收录才带上模考模块');
})();

async function t45() {

  const mockQs = {
    '1': { id: 1, content: 'a', module: 'A', done: 1, ok: 0, examId: '5158' },
    '2': { id: 2, content: 'b', module: 'B', done: 1, ok: 1, examId: '5158' },
    '3': { id: 3, content: 'c', done: 0, ok: 0, examId: '5158' },
    '7': { id: 7, content: 'g', module: 'C', done: 1, ok: 0, examId: '5158' }
  };
  const m = build({ store: mkStore({ mockQs: mockQs }), errors: [q(100), q(1)], favorites: [q(200)] });

  eq(ids(await m.fetchByFilter({ srcs: ['mock'], mock_modules: ['A'] })), ['1'],
    'T4 模考收录按模块筛：只回 A 的 1 题');
  eq(ids(await m.fetchByFilter({ srcs: ['mock'], mock_modules: ['未分类'] })), ['3'],
    'T4 未分类桶捞到没有模块名的老记录');
  eq(ids(await m.fetchByFilter({ srcs: ['mock'] })), ['1', '2', '3', '7'],
    'T4 不勾模块 = 全部收录题（含答对与未做）');

  eq(ids(await m.fetchByFilter({ srcs: ['error'] })), ['1', '100', '7'],
    'T5 只勾错题本：站点题＋模考答错的题（含模考独有的 7，这条同时守着并入接线本身），id 撞车只留一份');
  eq(ids(await m.fetchByFilter({ srcs: ['favorite'] })), ['200'],
    'T5 只勾收藏夹：不带模考题（模考答错只随错题本并进来）');
  eq(ids(await m.fetchByFilter({ srcs: ['error', 'favorite'] })), ['1', '100', '200', '7'],
    'T5 错题本＋收藏夹：并集去重');
  eq(ids(await m.fetchByFilter({ srcs: ['mock', 'error'], mock_modules: ['B'] })), ['1', '100', '2'],
    'T5 模考收录＋错题本：站点两题都在，模考按模块筛只剩 B 那道答对的');
  const mockOnlyFiltered = await m.fetchByFilter({ srcs: ['mock'], mock_modules: ['A'] });
  ok(mockOnlyFiltered.length === 1, 'T5 突变守卫：模考分支不能再走「永远全部题目」（那是无视筛选的缺陷态）');

  function srcOf(list, id) {
    var hit = list.filter(function (x) { return String(x.id) === String(id); })[0];
    return hit && hit._src;
  }
  const t1 = build({ store: mkStore(), errors: [q(11), q(12)], favorites: [q(12), q(13)] });
  const mergedList = await t1.fetchByFilter({ srcs: ['error', 'favorite'] });
  eq(srcOf(mergedList, 11), 'error', 'T4 只在错题本出现过的题，来源打 error');
  eq(srcOf(mergedList, 12), 'both', 'T4 两路都出现的题当场升 both，不留到下次再对');
  eq(srcOf(mergedList, 13), 'favorite', 'T4 只在收藏夹出现过的题，来源打 favorite');
  eq(ids(mergedList), ['11', '12', '13'], 'T4 升 both 不新增条目，去重仍是那份去重');
  const singleList = await build({ store: mkStore(), errors: [q(11)] }).fetchByFilter({ srcs: ['error'] });
  eq(srcOf(singleList, 11), 'error', 'T4 单路取题也要打来源，不能只有合并那条会标');
  eq(srcOf(await m.fetchByFilter({ srcs: ['error'] }), 7), undefined,
    'T4 并进来的模考题不带 _src：它是「模考收录」，不该被记成练习题的出处');
}

(function t6() {
  const store = mkStore({
    mockQs: {
      '1': { id: 1, content: 'OLD', module: '', done: 1, ok: 0, at: 1, user_answer: ['A'],
        correct_answer: ['B'], opt: [], analysis: '', material: '', examId: '5158' }
    }
  });
  const m = build({ store: store });
  const incoming = { id: 1, content: 'NEW', material: '', opt: [], correct_answer: ['B'],
    user_answer: ['A'], analysis: '', content_type: null, module: '政治理论', result: 0 };
  m.mergeMockQs([incoming], '5158');
  eq(store.mockQs['1'].module, '政治理论', 'T6 旧记录补上模块名');
  eq(store.mockQs['1'].content, 'OLD', 'T6 补模块不动已存题面');
  eq(store.wrongCount['1'], 1, 'T6 已有错题重复收录时按 processed 幂等再计一次');

  m.mergeMockQs([{ id: 2, content: 'x', material: '', opt: [], correct_answer: ['A'],
    user_answer: ['B'], analysis: '', content_type: null, module: '法律', result: 0 }], '9');
  eq(store.mockQs['2'].module, '法律', 'T6 新题连模块一起入库');
  eq(store.mockQs['2'].examId, '9', 'T6 新题记下场次');

  m.mergeMockQs([{ id: 3, content: 'x', material: '', opt: [], correct_answer: ['A'],
    user_answer: '', analysis: '', content_type: null, module: '', result: 2 }], '9');
  eq(store.mockQs['3'].done, 0, 'T6 未做不算做过');
  ok(!store.wrongCount['3'], 'T6 未做不进答错次数');

  eq(ids(m.mockAllList([])), ['1', '2', '3'], 'T6 全部收录含未做');
  eq(ids(m.mockWrongList([])), ['1', '2'], 'T6 只算答错的并进错题本');
  eq(ids(m.mockWrongList(['法律'])), ['2'], 'T6 并进错题本那一路也听模块勾选');
  eq(m.mockModuleOptions().map(function (o) { return o.name + ':' + o.n; }).sort(),
    ['政治理论:1', '法律:1', '未分类:1'].sort(), 'T6 模考 chips 由本地收录自己生成（含未分类）');
})();

(function t7() {
  const m = build();
  eq(m.mockModuleOf({ examPointName: '政治理论', exam_point: '常识' }), '政治理论',
    'T7 列表态的 examPointName 优先于接口字段');
  eq(m.mockModuleOf({ exam_point: '常识判断' }), '常识判断', 'T7 只有接口 exam_point 时用它');
  eq(m.mockModuleOf({ check_point: '法律' }), '法律', 'T7 check_point 兜底');
  eq(m.mockModuleOf({ root_name: '2026 模考大赛' }), '', 'T7 卷名不是模块，留空');
  const full = m.mockFieldMap({ id: 123, content: '题干', opt: '[{"label":"A","content":"甲"}]',
    correct_answer: '["A"]', userAnswers: ['B'], result: 0, type: 0, type_name: '单选题',
    examPointName: '政治理论' });
  eq([full.module, full.content_type], ['政治理论', null],
    'T7 映射后带模块，且不再拿题型当科目兜底');
})();

(function t8() {
  const store = mkStore({
    wrongCount: { s: 5, u: 0, p: 1, mm: 5, fresh: 1 },
    mastered: { mm: { streak: 2 }, pm: { streak: 2, manual: 1 }, p: { streak: 1 } },
    practiced: { p: { n: 1, at: 1 }, mm: { n: 2, at: 1 }, pm: {} }
  });
  const m = build({ store: store });
  eq(m.tierOf(q('s')), 0, 'T8 错满 3 次 = 顽固层');
  eq(m.tierOf(q('u')), 1, 'T8 没交卷过 = 尚未重练层');
  eq(m.tierOf(q('p')), 2, 'T8 练过但没连对两次 = 第三层');
  eq(m.tierOf(q('mm')), 3, 'T8 已掌握沉到最后（哪怕它是顽固错题）');
  eq(m.tierOf(q('pm')), 3, 'T8 收藏页手动打的「已掌握」也算掌握，不进尚未重练');
  eq(m.tierOf(q('fresh', {})), 1, 'T8 刚收进来的模考错题（次数 2）先归入尚未重练');
})();

(function t9() {
  const store = mkStore({
    wrongCount: { s1: 5, s2: 5, u1: 0, u2: 0, u3: 0, u4: 0, u5: 0, p1: 1, p2: 1, p3: 1 },
    mastered: { m1: { streak: 2 }, m2: { streak: 2 }, m3: { streak: 2 } },
    practiced: { p1: { n: 1 }, p2: { n: 1 }, p3: { n: 1 }, m1: { n: 2 }, m2: { n: 2 }, m3: { n: 2 } }
  });
  const m = build({ store: store });
  const all = ['s1', 's2', 'u1', 'u2', 'u3', 'u4', 'u5', 'p1', 'p2', 'p3', 'm1', 'm2', 'm3']
    .map(function (id) { return q(id); });
  let leakedP = 0, leakedM = 0, missStubborn = 0, wrongSize = 0;
  for (let i = 0; i < 400; i++) {
    const picked = m.weightedPick(all, 4).map(function (x) { return String(x.id); });
    if (picked.length !== 4) wrongSize++;
    if (!(picked.indexOf('s1') >= 0 && picked.indexOf('s2') >= 0)) missStubborn++;
    picked.forEach(function (id) {
      if (/^p/.test(id)) leakedP++;
      if (/^m/.test(id)) leakedM++;
    });
  }
  eq([wrongSize, missStubborn, leakedP, leakedM], [0, 0, 0, 0],
    'T9 400 次随机抽 4 题：两道顽固必中、第三四层一次都不漏进（层序被截断保护）');
  const whole = m.weightedPick(all, 0).map(function (x) { return m.tierOf(x); });
  eq(whole, whole.slice().sort(function (a, b) { return a - b; }),
    'T9 题量=0 时按层排完整张卷（0,0,1,1,…,3,3 不交叉）');
  eq(m.weightedPick(all, 0).length, 13, 'T9 题量=0 仍是全部 13 题');
})();

(function t10() {
  const store = mkStore({
    notes: {
      n1: { text: '甲', subject: 1, updated: 5 },
      n2: { text: '乙', subject: 0, updated: 4 },
      n3: {},
      n4: { text: '丁', updated: 3 }
    },
    highlights: { n1: [{ quote: 'q', subject: 1, at: 1 }], n3: [{ quote: 'z', at: 1 }] },
    mastered: { n1: { streak: 2 }, n2: { streak: 1 } },
    qModule: { n2: '资料分析' },
    mockQs: { n4: { id: 'n4', module: '政治理论', done: 1, ok: 0 } }
  });
  const m = build({ store: store });
  const all = ['n1', 'n2', 'n3', 'n4'];
  const pick = function (nf) {
    return all.filter(function (id) { return m.noteMatch(m.noteFacets(id), nf); });
  };
  eq(pick({}), all, 'T10 不加条件时全在');
  eq(pick({ src: 'mock' }), ['n4'], 'T10 按来源筛：在模考收录里的才算模考题');
  eq(pick({ src: 'site' }), ['n1', 'n2', 'n3'], 'T10 按来源筛：练习题');
  eq(pick({ subj: '1' }), ['n1'], 'T10 按科目筛：公安专业知识');
  eq(pick({ subj: 'x' }), ['n3', 'n4'], 'T10 科目没记录的落到未分类桶（模考题都在这）');
  eq(pick({ mod: '资料分析' }), ['n2'], 'T10 按模块筛：来自行测考点映射');
  eq(pick({ mod: '政治理论' }), ['n4'], 'T10 按模块筛：来自模考收录的模块名');
  eq(pick({ mod: '未分类' }), ['n1', 'n3'], 'T10 两处都没有模块名的进未分类');
  eq(pick({ mast: 'done' }), ['n1'], 'T10 掌握状态：已掌握');
  eq(pick({ mast: 'un' }), ['n3', 'n4'], 'T10 掌握状态：未掌握');
  eq(pick({ cont: 'both' }), ['n1'], 'T10 内容：笔记＋划线都有');
  eq(pick({ cont: 'hl' }), ['n1', 'n3'], 'T10 内容：有划线');
  eq(pick({ subj: '1', mod: '资料分析' }), [], 'T10 条件是「与」关系');
})();

(function t11() {
  const disk = JSON.stringify({
    mockQs: { '9': { id: 9, content: 'D', at: 100 } },
    practiced: { p1: { n: 3, at: 10 }, p2: { n: 1, at: 5 } },
    qModule: { q1: 'A', q2: 'B' },
    qSrc: { s1: 'favorite', s2: 'both' },
    wrongCount: { w1: 7 }
  });
  const store = mkStore({
    mockQs: { '9': { id: 9, content: 'M', at: 50 } },
    practiced: { p1: { n: 1, at: 99 } },
    qModule: { q1: '本标签先记的' },
    qSrc: { s1: 'error' },
    wrongCount: { w1: 2 }
  });
  const m = build({ store: store, disk: disk });
  m.mergeConcurrent(store);
  eq(store.practiced.p1.n, 3, 'T11 重练登记取次数大的那份（不看时间戳大小）');
  ok(store.practiced.p2, 'T11 别的标签新登记的重练保住了');
  eq(store.qModule.q1, '本标签先记的', 'T11 模块映射先到先得，不被覆盖');
  eq(store.qModule.q2, 'B', 'T11 本标签没有的模块映射补进来');
  eq(store.qSrc.s1, 'both', 'T11 来源映射合不出同值就升 both（这题两个标签各自见过它在错题本与收藏夹）');
  eq(store.qSrc.s2, 'both', 'T11 对方那张来源表里本标签没有的条目并进来了');
  eq(store.wrongCount.w1, 7, 'T11 答错次数仍取大值（旧规则没被改坏）');
  eq(store.mockQs['9'].content, 'D', 'T11 模考快照仍按 at 取新（旧规则没被改坏）');
  eq(build({ store: mkStore(), disk: '坏 JSON{' }).mergeConcurrent({ mockQs: {} }), { mockQs: {} },
    'T11 磁盘是坏 JSON 时不炸、原样返回');
})();

(function t12() {
  const store = mkStore({ wrongCount: { x: 0 } });
  const m = build({ store: store });
  eq(m.tierOf(q('x')), 1, 'T12 没练过时在第 2 层（尚未重练）');
  m.markPracticed('x');
  ok(m.isPracticed('x'), 'T12 交卷后登记上了');
  eq(m.tierOf(q('x')), 2, 'T12 登记后从「尚未重练」层挪走');
  eq(store.practiced.x.n, 1, 'T12 次数从 1 起');
  m.markPracticed('x');
  eq(store.practiced.x.n, 2, 'T12 再交一次卷次数 +1');
})();

async function t13() {
  const store = mkStore();
  let calls = 0;
  const m = build({
    store: store,
    subcategory: [
      { id: 11, name: '常识判断', exampoint_list: [{ id: 111, name: '政治理论' }, { id: 112, name: '法律' }] },
      { id: 12, name: '资料分析', exampoint_list: [] }
    ],
    apiResult: function () {
      calls++;
      const n = calls;
      return Promise.resolve({ subject_list: n === 1 ? [q(1)] : n === 2 ? [q(2)] : [q(1)], total_items: 1 });
    }
  });
  const out = await m.fetchXingce([], null);
  eq(ids(out), ['1', '2'], 'T13 按考点逐个拉题并按 id 去重');
  eq(store.qModule, { 1: '政治理论', 2: '法律' }, 'T13 题目属于哪个考点被记进 qModule');
  eq(m.moduleOf(1), '政治理论', 'T13 moduleOf 读得到');
  eq(m.buildModuleOptions(m.store ? [] : []).length, 0, 'T13 空分类返回空表（不炸）');
}

(function t14() {
  const m = build();
  ok(!m.hasSiteSrc(['mock']), 'T14 只勾模考收录 → 站点那套条件不适用');
  ok(m.hasSiteSrc(['error', 'mock']), 'T14 还勾了错题本 → 站点条件仍适用');
  ok(m.hasSiteSrc(['both']), 'T14 旧的 both 展开后算站点来源');
  ok(m.hasSiteSrc(['error']), 'T14 纯错题本算站点来源');
  ok(!m.notesNarrowed(), 'T14 五个下拉全空且没输入关键词 = 没收窄');
  eq(build({ notesFilter: { subj: '1' } }).notesNarrowed(), true, 'T14 任一下拉生效算收窄');
  eq(build({ notesSearchKey: '宪法' }).notesNarrowed(), true, 'T14 只输入关键词也算收窄');
  eq(build({ notesSearchKey: '   ' }).notesNarrowed(), false, 'T14 空格不算收窄');
})();

(function t15() {
  const m = build();
  [['，，。A，，B。', 'AB'], ['第一句、第二句；第三句！！', '第一句第二句第三句'],
  ['（（重点））本题选 A', '重点本题选A'], ['a - b — c · d', 'abcd'],
  ['选A。　选B。', '选A选B'], ['正常题干没有标点', '正常题干没有标点']].forEach(function (p) {
    eq(m.norm(p[0]), p[1], 'T15 norm 洗掉全部标点：' + JSON.stringify(p[0]));
    eq(m.normMap(p[0]).text, p[1], 'T15 normMap 与 norm 同口径：' + JSON.stringify(p[0]));
  });
  eq(m.normMap('a，，b').map, [0, 3], 'T15 map 指向保留字符在原文里的下标');
  eq(m.normMap('，A、B。').map, [1, 3], 'T15 开头的标点也算，map 不漏位');
  eq(m.norm('　 \t '), '', 'T15 全空白归一化成空串');
})();

async function t16() {
  const sub = [{ id: 11, name: '常识判断', exampoint_list: [{ id: 111, name: '政治理论' }] }];
  async function grab(name) {
    const api = [];
    const m = build({
      store: mkStore(), subcategory: sub, api: api,
      apiResult: function () { return Promise.resolve({ subject_list: [] }); }
    });
    await m[name](['政治理论'], null);
    return api[0];
  }
  const err = await grab('fetchXingce');
  const fav = await grab('fetchFavoriteXingce');
  ok(err && fav, 'T16 两条路都真的发了请求');
  eq(err[0], 'content/7/error/view', 'T16 行测错题走 error/view');
  eq(fav[0], 'content/7/favorite/view', 'T16 行测收藏走 favorite/view');
  eq([err[1].view_type, err[1].content_type], [1, 0], 'T16 错题用科目型视图且 content_type=行测');
  eq([fav[1].view_type, fav[1].content_type], [1, 0], 'T16 收藏同一口径');
  eq([err[1].subcategory_id, err[1].exampoint_id], [11, 111], 'T16 错题按考点逐个请求');
  eq([fav[1].subcategory_id, fav[1].exampoint_id], [11, 111], 'T16 收藏也按考点逐个请求');
  eq([err[1].page, err[1].page_size], [0, 100], 'T16 错题接口带分页参数');
  ok(!('page' in fav[1]) && !('page_size' in fav[1]), 'T16 收藏接口不传分页（favorite/view 一次性返回）');
  eq(err[1].agency_commodity_id, fav[1].agency_commodity_id, 'T16 两条路都带 agency_commodity_id');
}

(function t17() {
  const m = build();
  const h = { quote: '题干<重点>', color: 'red', note: '批注甲', lost: false };
  const gone = { quote: '失效', color: 'yellow', note: '', lost: true };
  eq(m.hlRowHtml(h, 0, '点击改批注'),
    '<div class="gth-hlp-item" data-hl="0"><span class="dot red"></span>' +
    '<div class="bd"><div class="t" title="点击写批注">题干&lt;重点&gt;</div>' +
    '<div class="n" title="点击改批注">批注甲</div></div>' +
    '<span class="rm" title="取消划线"><svg>x</svg></span></div>',
    'T17 页边/重练那两处的行标记原样');
  eq(m.hlRowHtml(h, 0, ''),
    '<div class="gth-hlp-item" data-hl="0"><span class="dot red"></span>' +
    '<div class="bd"><div class="t" title="点击写批注">题干&lt;重点&gt;</div>' +
    '<div class="n">批注甲</div></div>' +
    '<span class="rm" title="取消划线"><svg>x</svg></span></div>',
    'T17 笔记面板的批注行不挂 title');
  eq(m.hlRowHtml(gone, 7, '点击改批注'),
    '<div class="gth-hlp-item lost" data-hl="7"><span class="dot yellow"></span>' +
    '<div class="bd"><div class="t" title="点击写批注">失效</div></div>' +
    '<span class="rm" title="取消划线"><svg>x</svg></span></div>',
    'T17 失效划线加 lost、没批注就不出 .n');
  ok(m.hlRowHtml({ quote: 'q', color: 'red', note: 'n', lost: false }, 0, 'say "hi"')
    .indexOf('title="say &quot;hi&quot;"') >= 0, 'T17 提示语是拼进属性的，含引号必须转义');
})();

(function t18() {
  const m = build({
    store: mkStore({
      notes: { 1: { text: '甲' }, 2: null },
      highlights: { 1: [{ quote: '重复的题' }], 3: [{ quote: '只有划线' }], 4: [] }
    })
  });
  eq(m.noteIdsWithHl(), ['1', '2', '3'],
    'T18 有笔记的都算，只有划线的补进来，空划线不算，两边都有的不重复');
  eq(build({ store: mkStore() }).noteIdsWithHl(), [], 'T18 空库返回空');
})();

(function t19() {
  const m = build();
  eq(m.pickKey({ a: null, b: 1 }, ['a', 'b']), 1, 'T19 null 算空，继续找下一个');
  eq(m.pickKey({ a: '', b: 2 }, ['a', 'b']), 2, 'T19 空串算空');
  eq(m.pickKey({ a: undefined, b: 3 }, ['a', 'b']), 3, 'T19 undefined 算空');
  eq(m.pickKey({ b: 2 }, ['a', 'b']), 2, 'T19 键不存在算空');
  eq(m.pickKey({ a: 0, b: 2 }, ['a', 'b']), 0, 'T19 答对/答错这类 0 值是真值，不能跳过');
  eq(m.pickKey({ a: false, b: true }, ['a', 'b']), false, 'T19 false 同样不能当空跳过');
  eq(m.pickKey({}, ['a']), undefined, 'T19 全都没有时返回 undefined');
})();

(function t20() {
  function countOf(needle) {
    var n = 0, i = 0;
    while ((i = raw.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
    return n;
  }
  const W = [
    ["'<div class=\"gth-hlp-item' + (h.lost", 1, '划线行的标记全文只有 hlRowHtml 一处'],
    ['hlRowHtml(h, i, \'\')', 1, '笔记面板那一个调用点仍是不挂 title 的'],
    ['hlRowHtml(h, i, \'点击改批注\')', 2, '页边批注栏与重练题目两处仍挂着 title'],
    ['= noteIdsWithHl();', 3, '笔记 tab、一键整理、与站点核对三处共用同一口径'],
    ['noteIdsWithHl().forEach(', 1, '题本成员也建在同一份「笔记 ∪ 划线」上，只是在它之上剪掉站点在列的那些'],
    ['rerenderAsides();', 2, '恢复数据后与划线变动后两处共用'],
    ["$$('.gth-aside').forEach", 1, '批注栏重画的遍历只有一份'],
    ['if (it && !a.dataset.editing) renderAside(a, it);', 1, '正在编辑的那一题不重画，这条判据还在'],
    ['fetchXingceBy(', 3, '行测流程一份 + 错题/收藏两个转发'],
    ['apiGet(listPath(kind, ci), params)', 1, '行测的接口路径由 kind 决定，不再各写一遍'],
    ["'<div class=\"gth-hlp-item\" data-hl=\"'", 1, '整理为笔记那处的简版行（无批注栏/无 ✕）是有意另写的，没被并进去'],
    ['repaintOne(qid);', 2, '改色与取消划线两处共用重落笔'],
    ['qRoot(qid)', 4, 'qid 选择器一处定义三处调用'],

    ["'<div class=\"text\">' + icon('sparkles') + '机考助手</div>'", 1, '左菜单入口名只有一份字符串，两页共用'],
    ["'<div class=\"text\">' + icon('listChecks') + '补充题本</div>'", 1, '题本那颗同级入口名也只有一份字符串'],
    ["classList.toggle('gth-hide', any)", 1, '收起站点内容只有一处逻辑：两视图共用，不各写一遍'],
    ['height:var(--gth-ctl-h', 4, '按钮 / 输入下拉 / 模考浮标 / 浮标内按钮共用同一个高度令牌，谁退回写死高度就红'],
    ['if (hlHoldLost(rec, analysisShown)) return;', 1, 'paintRoot 真的在问这个判据，不是写了个没人调的函数'],
    ['= migrateHlLost(data);', 1, '库初始化真的走这次清洗，不只是有个函数'],
    ['washHlLost(store.highlights)', 1, '恢复备份也洗一次：旧备份里那批假失效不能带回来'],
    ["<span class=\"gth-caret\">' + icon('chevronDown')", 1, '划线清单的展开标识是一个箭头，不是两个字'],

    ['.caret{', 0, 'CSS 里不许出现不带 gth- 前缀的 .caret 选择器（与 bootstrap 全局类撞车）'],
    ['class="caret"', 0, '标记里不许出现不带 gth- 前缀的 class="caret"（同上）'],
    ['caret.textContent', 0, '朝向由 CSS 跟着 .on 派生，JS 不再往 caret 里写「展开 / 收起」'],
    ['syncKeyTargets();', 4, '键盘可达在观察器刷新、两处初始化与专项页那条路上都补了，漏一处就有节点永远点不到'],
    ['busy(btn, ensureLoaded(', 2, '导出两颗按钮真的被 busy 包住，不是只写了个 helper'],
    ['busy(this, fetchByFilter(', 1, '组卷按钮走同一条置灰通路'],
    ['busy(btn, ensureExamPointIndex(', 1, '核对整条链（先取考点表、再拉题）都包在置灰里'],
    ['return examPointModule ? Promise.resolve(examPointModule) : fetchSubcategory()', 1,
      '有索引就不重复拉表，没有才打一次 subcategory'],
    ['gth-nf-mod-hint', 2, '模块维的来源提示：模板里有一个节点，代码里有开关，两头都在'],
    ["closest('.gth-balloon')", 1, '气球点得开批注框，cursor:pointer 不是假的'],

    ['parentNode.dataset.hl', 0, '划线行的下标一律从 closest(.gth-hlp-item) 取，不许退回 parentNode'],
    ['rememberModulesFromPoints(list);', 1, 'fetchByFilter 真的顺手登记模块，不只是有个函数'],
    ['examPointModule = buildExamPointIndex(list);', 1, '拿到考点表的同时把 id→模块 的索引填上'],
    ['（黄 \' + ', 0, '收起态标题不再带颜色细分——窄轨道下它会把标题挤成两行'],
    ['var avail = (document.documentElement.clientWidth', 1, '轨道宽度按可视区右缘现算，不再信那个假设容器居中的 clamp'],

    ['storeRev++;', 2, '写盘与多标签合并两处都要 bump，漏一处面板就不跟着数据变'],
    ['panelRev = storeRev;', 1, 'renderPanel 画完记下画的是哪个版本'],
    ['if (viewOn) setView(true);', 0, '观察器不许再走面板的完整开启流程（那会每次重画整段组卷历史）'],

    ['!modulesLoading && !modulesLoaded', 1, '并发与「返回空表」两种重发都门住'],
    ['modulesLoading = true;', 1, '发请求前置在飞'],
    ['modulesLoaded = true;', 1, '成功过才置已取到'],
    ['      modulesLoading = false;', 2, '成功与失败两条都要解开在飞：失败还得靠下一次用户动作重试（数的是缩进里那两处，不数声明）'],
    ['if (xc && !moduleList.length) loadModules();', 0, '无门的旧写法不许回来（站点一挂就变成刷请求）'],
    ['el.value = want; invalidateLoaded(); updateExportHint();', 1, '来源默认值跟着页面换了，自己把提示刷回来'],

    ['var r = readResume(key);', 1, 'resumeOffset 走自愈读'],
    ['seq ? readResume(key) : null', 1, '开轮走自愈读'],
    ['readResume(resumeKey(', 1, '续刷提示走自愈读'],
    ['clearResume(key);', 1, '刷到末尾的清除走同一个口子'],
    ['clearResume(resumeKey(', 1, '「从头开始」把老键一起删'],
    ['var r = key && store.resume[key];', 0, '不许留「只读新键」的写法：那样老进度永远接不上'],
    ['delete store.resume[resumeKey(', 0, '不许留「只删新键」的写法：那样老键删不掉'],

    ["mock: '上岸村模考收录_'", 1, '模考来源有自己的文件名前缀'],
    ['(EXPORT_PREFIX[currentSrc()] || ', 1, '文件名按当前来源取前缀这一处没被抄成第二份'],

    ['var desc0 = filterDesc(f);', 1, '按下那一刻的条件留下来准备比对'],
    ["toast('筛选在取题期间改过了", 1, '不一致时真的说一句，不是只存了个变量'],

    ["$('#gth-upgrade').addEventListener('click'", 1, '那颗键真的绑上了处理器，不是只画了个按钮'],

    ["dayRange: '4', srcs: ['error', 'favorite']", 1, '重扫走「按日期=全部」那一趟，不是逐考点配对的几十次'],
    ['keys: strayStorageKeys(names)', 1, '清理真的问这份判据，不是写了两个没人调的函数（数的是调用形，不是定义头）'],
    ['staleResumeKeys(store.resume)', 1, '旧刷题进度也走同一份判据'],
    ['gth-mod-scan', 0, '旧的那三颗按钮连 id 一起撤干净，不留半截'],
    ['class="gth-q"', 1, '三颗维护键合成一颗「升级后点我」，全屏就剩这一个问号（2026-10-08 用户口径：不要给没互联网基础的人加认知负担）'],
    ["'tiku/' + t + '/' + id + '/analysis'", 1, '题目解析接口只有一处出处：模考收录与题本补齐共用 apiSubjectFace'],
    ['.gth-q{display:inline-flex', 1, '小问号有自己的样式，不是个裸字符'],
    ['id="gth-upgrade">', 1, '键面就五个字（icon + 升级后点我），说明全在问号里，不在按钮文字里'],
    ['class="gth-btn go"', 1, '绿色那一颗全屏只有一颗：数的是按钮本身，不是键面文案' +
      '（文案在注释与问号说明里还会再出现，按次数数下去只会逼着人不写注释）'],
    ['再连一次站点，把笔记与划线对应的题补上模块、科目和来源', 1,
      '问号里说清这颗键做哪两件事：只写「清理」就成了「会不会删我东西」的疑虑'],
    ['删之前会列出来问你要不要删', 1, '一颗键合三件事不等于静默删数据：问号里先说清删除会先问'],
    // 科目与来源这两条新数据通路：只测纯函数不够，得证明写入点与读出口真的改成调它了
    ['q._src = src;', 2, '两条取题路都把来源打在题上（单源那条与两路合并那条各一处）'],
    ["p._src !== src) p._src = 'both'", 1, '同一题在两路都出现过，合并当场升 both，不等下次'],
    ['subjectOf(', 4, '划线、批注栏保存、重练报告卡片三处写入点都改走 subjectOf，第 4 处是它自己的定义'],
    ['subjectFromUrl(location.search, location.hash)', 1, 'routeExamType 经过那道「只认 0 与 1」的守卫，不拿分类 id 当科目'],
    ['(store.qSrc && store.qSrc[id]) || ', 1, 'noteFacets 真读新表，缺表退回 site（旧库的降级路径）'],
    ["nf.src === 'site' ? r.src !== 'mock'", 1, '「练习题」按集合匹配，不是与三档互斥的第四个值'],
    ['(SRC_LIST_LABEL[q._src]', 1, '导出的「来源」列走这张表，不是写死「练习」'],
    ['SUBJECT_NAME[subjectForExport(q)]', 1, '导出的「科目」列会退回库里那条，重扫回填的科目才在表格里看得见'],
    ['sweepFacets(siteList, zyList, examPointModule)', 1, '重扫把两趟结果交给判定，不是拉回来就扔'],
    ['reconcileSources(f.srcs', 1, '来源核对结果真的落库（含把站点已收走的剪掉）'],
    ['reconcileWithSite(', 3, '核对逻辑只有一份：定义一处 + 题本空态那颗 + 本地数据那颗各调一次'],
    ['if (!reconciled()) return [];', 1, '没核对过就没有题本成员——摊开、取题、导出共用这一条口径，不许只在界面上遮'],
    ['backfillSubject(f.subjects)', 1, '科目判定结果真的回填'],
    ['if (j.qSrc) store.qSrc = j.qSrc;', 1, '恢复备份吃这张新表'],
    ['store.qSrc = {};', 2, '默认形状与清空各一处，漏一处就是「界面能用但库里没这桶」'],
    ['error">练习题 · 错题本', 1, '来源下拉里多了按出处细分的档位']
  ];
  W.forEach(function (p) {
    eq(countOf(p[0]), p[1], 'T20 ' + p[2]);
  });
})();

(function t21() {
  const find = require('./gth_init_order').find;
  let bad;
  try { bad = find(FILE); } catch (e) { bad = [{ v: '(抽取失败 ' + e.message + ')', fn: '', decl: 0, call: 0, entry: '' }]; }
  eq(bad.map(function (x) { return x.v + '@' + x.fn; }), [],
    'T21 没有「顶层同步调用会读到还没赋值的 var」');
  bad.forEach(function (x) {
    ok(false, 'T21 ' + x.v + '：赋值在第 ' + x.decl + ' 行，但第 ' + x.call + ' 行的 ' +
      x.entry + ' 已经会走到 ' + x.fn + '() 里读它');
  });
})();

(function t22() {
  const m = build();
  ok(m.hlHoldLost({ block: 'analysis' }, false), 'T22 解析区 + 解析没渲染：先不下结论');
  ok(!m.hlHoldLost({ block: 'analysis' }, true), 'T22 解析区 + 解析已展开：仍走原来的失效判定');
  ok(!m.hlHoldLost({ block: 'stem' }, false), 'T22 题干的划线不受解析收起影响');
  ok(!m.hlHoldLost({ block: 'opt' }, false), 'T22 选项的划线同上');
  ok(!m.hlHoldLost({ block: 'material' }, false), 'T22 材料的划线同上');

  ok(!m.hlHoldLost({}, false), 'T22 没有 block 的存量划线照旧判定');
  ok(!m.hlHoldLost({ block: 'other' }, false), 'T22 归不到块的划线照旧判定');
})();

(function t23() {
  const m = build();
  function one(rec) { return { q1: [rec] }; }

  eq(m.washHlLost(one({ quote: 'a', block: 'analysis', lost: true, miss: 1 })), 1,
    'T23 解析区的失效标记清掉一条，返回清掉的条数');
  (function () {
    var h = one({ quote: 'a', block: 'analysis', lost: true, miss: 1 });
    m.washHlLost(h);
    eq(h.q1[0].lost, undefined, 'T23 lost 真的从记录上删了，不是只数不删');
    eq(h.q1[0].miss, undefined, 'T23 连 miss 一起清，重判从干净状态开始');
  })();
  eq(m.washHlLost(one({ quote: 'a', block: 'stem', lost: true })), 0,
    'T23 题干的 lost 是文本可见时连着两次判出来的，不动');
  eq(m.washHlLost(one({ quote: 'a', block: 'material', lost: true })), 0, 'T23 材料区同上');
  eq(m.washHlLost(one({ quote: 'a', lost: true })), 0,
    'T23 没有 block 字段的存量记录不动：宁可不洗，也不把真失效抹掉');
  eq(m.washHlLost(one({ quote: 'a', block: 'analysis' })), 0, 'T23 没标失效的返回 0');
  eq(m.washHlLost(undefined), 0, 'T23 整块缺失不抛错');
  eq(m.washHlLost({}), 0, 'T23 空库返回 0');
  eq(m.washHlLost({ q1: '坏了' }), 0, 'T23 某题的划线不是数组时跳过，不抛错');
  eq(m.washHlLost({ q1: [null, { block: 'analysis', lost: 1 }] }), 1,
    'T23 数组里混进 null 也走得过去，且只清该清的那条');

  (function () {
    var d = { highlights: one({ quote: 'a', block: 'analysis', lost: true }) };
    eq(m.migrateHlLost(d), 1, 'T23 首次加载洗掉一条');
    eq(d.hlLostMigrated, 1, 'T23 洗完在库上留下一次性标记');
    d.highlights.q1[0].lost = true;
    eq(m.migrateHlLost(d), 0, 'T23 第二次加载不再洗，否则真失效会被每次打开抹掉');
    eq(d.highlights.q1[0].lost, true, 'T23 第二次确实没动那条');
  })();
  eq(m.migrateHlLost({}), 0, 'T23 空库也打得上标记且返回 0');
})();

(function t24() {
  const m = build();
  function countOf(needle) {
    var n = 0, i = 0;
    while ((i = raw.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
    return n;
  }
  const parts = m.KEYACT.split(',');
  ok(parts.length >= 10, 'T24 名单不是空的（现 ' + parts.length + ' 项）');
  parts.forEach(function (p) {
    const first = p.trim().split(/\s+/)[0];
    const name = /^[.#]/.test(first) ? first.slice(1) : first;

    ok(countOf(name) >= 2, 'T24 名单里的 ' + p.trim() + ' 在脚本里已经找不到第二处（类名漂了）');
  });

  ['gth-btn', 'gth-mini', 'gth-qbar-btn'].forEach(function (b) {
    ok(m.KEYACT.indexOf('.' + b) < 0, 'T24 名单里不该有自带键盘的真按钮 .' + b);
  });

  m.KEYACT.split(',').forEach(function (p) {
    const name = /^[.#]/.test(p.trim().split(/\s+/)[0]) ? p.trim().split(/\s+/)[0].slice(1) : p.trim().split(/\s+/)[0];
    ok(countOf(name + ':focus-visible') === 0, 'T24 ' + name + ' 的焦点环不该再手写一份（应由 KEYACT 生成）');
  });
})();

(function t25() {
  const tree = [
    { id: 1, name: '国省考真题卷', exampoint_list: [
      { id: 41774, name: '言语理解', children: [
        { id: 41775, name: '片段阅读', children: [{ id: 41779, name: '主旨意图', children: [] }] }] },
      { id: 41849, name: '资料分析', children: [{ id: 41861, name: '简单加减', children: [] }] }
    ] },

    { id: 2, name: '公安联考模考卷', exampoint_list: [{ id: 41849, name: '资料分析（重复卷）', children: [] }] }
  ];

  const idx = build().buildExamPointIndex(tree);
  eq(idx['41774'], '言语理解', 'T25 顶层节点自己就是一个模块');
  eq(idx['41779'], '言语理解', 'T25 第三代叶子归到它所属的顶层');
  eq(idx['41861'], '资料分析', 'T25 叶子考点换成顶层模块名');
  eq(idx['41849'], '资料分析', 'T25 重复出现的顶层保留第一份名字');
  eq(Object.keys(idx).length, 5, 'T25 只登记树里真有的 id');
  eq(build().buildExamPointIndex(undefined), {}, 'T25 没有考点表时给空表，不抛错');
  eq(build().buildExamPointIndex([{ id: 1 }]), {}, 'T25 缺 exampoint_list 不抛错');

  (function () {
    const st = mkStore();
    const m = build({ store: st, examPointModule: idx });
    eq(m.rememberModulesFromPoints([{ id: 7, exam_point: 41861 }, { id: 8, exam_point: 41779 }]), 2,
      'T25 两条都按考点登记上模块');
    eq([st.qModule['7'], st.qModule['8']], ['资料分析', '言语理解'], 'T25 登记的是顶层模块名，不是叶子考点名');
    eq(m.getSaved(), 1, 'T25 一批题只落一次盘');
    eq(m.rememberModulesFromPoints([{ id: 9, exam_point: 999999 }]), 0,
      'T25 考点不在树里就不写：宁可不登记，也不猜一个模块');
    eq(st.qModule['9'], undefined, 'T25 树里没有的 id 库里不留痕');
    eq(m.rememberModulesFromPoints([{ id: 7, exam_point: 41774 }]), 0,
      'T25 已登记过的不覆盖，也不再多存一次');
    eq(st.qModule['7'], '资料分析', 'T25 先登记的模块名保持不变');
    eq(m.rememberModulesFromPoints([{ id: 10 }, { id: null, exam_point: 41774 }, null]), 0,
      'T25 缺 exam_point / 缺 id / 空项都跳过');
    (function () {
      var r;
      try { r = build({ store: mkStore() }).rememberModulesFromPoints([{ id: 7, exam_point: 41861 }]); }
      catch (e) { r = '抛错了：' + e.message; }
      eq(r, 0, 'T25 考点表还没拿到时一条都不登记，而且不许抛错（抛错说明那道 return 0 的守卫被拆了）');
    })();
  })();
})();

(function t26() {
  const m = build();
  const bothLabel = m.srcLabel(['error', 'favorite']);
  const NEW = bothLabel + ' · 日期：全部|seq';
  const OLD = m.SRC_NAME.both + ' · 日期：全部|seq';

  eq(bothLabel, '错题本＋收藏夹', 'T26 逐项拼的合并标签没漂（自愈拿它当新键里的查找串）');
  eq(m.SRC_NAME.both, '错题+收藏', 'T26 老键里那份合并标签没漂（漂了就够不着用户库里的记录）');
  eq(m.resumeKeyOld(NEW), OLD, 'T26 新键换算得出老键');
  eq(m.resumeKeyOld('错题本 · 日期：全部|seq'), '错题本 · 日期：全部|seq',
    'T26 单来源的键换算等于自己，不去动别人的记录');
  eq(m.resumeKeyOld('模考收录（全部模考题）|seq'), '模考收录（全部模考题）|seq',
    'T26 只勾模考的键换算也等于自己');

  (function () {
    const st = mkStore({ resume: {} });
    st.resume[OLD] = { idx: 7, id: 88, answered: { '88': 1 } };
    const t = build({ store: st });
    const r = t.readResume(NEW);
    ok(r && r.idx === 7, 'T26 老键里的进度读得到');
    eq(st.resume[OLD], undefined, 'T26 搬完删掉老键，库里不留永不命中的记录');
    var moved = st.resume[NEW];
    ok(!!moved, 'T26 进度落到现算的新键上');
    eq(moved && moved.id, 88, 'T26 搬过去的是原来那条记录');
    eq(moved && moved.answered['88'], 1, 'T26 连「已作答」登记一起搬，不是只搬下标');
    eq(t.getSaved(), 1, 'T26 搬家落一次盘');
    eq((t.readResume(NEW) || {}).idx, 7, 'T26 再读走新键，结果一致');
    eq(t.getSaved(), 1, 'T26 第二次读不再写盘');
  })();

  (function () {
    const st = mkStore({ resume: {} });
    st.resume[NEW] = { idx: 3, id: 9 };
    st.resume[OLD] = { idx: 99, id: 1 };
    const t = build({ store: st });
    eq((t.readResume(NEW) || {}).idx, 3, 'T26 新键优先，老键不参与');
    eq(st.resume[NEW].idx, 3, 'T26 老键没把新键盖掉');
    eq(t.getSaved(), 0, 'T26 命中新键时一次盘都不落');
  })();

  (function () {
    const t = build({ store: mkStore() });
    eq(t.readResume(''), null, 'T26 随机组卷那条空键不读进度，也不会误搬');
    eq(t.readResume(undefined), null, 'T26 没传键一样返回 null');
    eq(t.readResume(NEW), null, 'T26 两处都没有时返回 null');
    eq(t.getSaved(), 0, 'T26 没搬东西就不写盘');
  })();

  (function () {
    const st = mkStore({ resume: {} });
    st.resume[OLD] = { idx: 5, id: 6 };
    const t = build({ store: st });
    t.clearResume(NEW);
    eq(st.resume[OLD], undefined, 'T26 「从头开始」连老键一起删');
    eq(t.getSaved(), 1, 'T26 删掉了东西才落盘');
    t.clearResume(NEW);
    eq(t.getSaved(), 1, 'T26 两处都没有时不落盘');
    t.clearResume('');
    eq(t.getSaved(), 1, 'T26 空键不落盘');
  })();

  const need = m.SRC_KEYS.concat(['both']);
  need.forEach(function (k) {
    ok(!!m.EXPORT_PREFIX[k], 'T26 来源 ' + k + ' 有自己的导出文件名前缀');
    ok((m.EXPORT_PREFIX[k] || '').slice(-1) === '_', 'T26 前缀以 _ 收尾，跟日期段之间不粘连');
  });
  const seen = need.map(function (k) { return m.EXPORT_PREFIX[k]; });
  eq(seen.filter(function (v, i) { return seen.indexOf(v) === i; }).length, need.length,
    'T26 四个前缀两两不同：抄一份别人的就等于让那批文件分不清');
  ok(String(m.EXPORT_PREFIX.mock || '').indexOf(m.SRC_NAME.mock) >= 0,
    'T26 模考那份文件名里带的就是面板上那个来源名「模考收录」，不另起叫法');
})();

(function t27() {
  const at = raw.indexOf('var refreshPageUI = debounce(');
  const end = at < 0 ? -1 : raw.indexOf('}, 400);', at);
  ok(at >= 0 && end > at, 'T27 观察器回调还是 refreshPageUI 这一处（改名要先想清楚谁在守它）');
  const body = at >= 0 ? raw.slice(at, end) : '';
  ok(body.indexOf('applyChrome()') >= 0, 'T27 观察器每次重贴壳：隐藏类与安家都要跟上 AngularJS 的重绘');
  ok(body.indexOf('if (viewOn && storeRev !== panelRev) renderPanel();') >= 0, 'T27 内容只在 store 真变过时画');
  ok(body.indexOf('setView(') < 0, 'T27 观察器不走面板的完整开启流程');
  ok(body.indexOf('syncFilterUI(') < 0, 'T27 观察器不重跑筛选行（那条路上有发站点请求的一步）');
})();

(function t28() {
  const at = raw.indexOf("$('#gth-start').addEventListener('click'");
  const end = at < 0 ? -1 : raw.indexOf("$('#gth-resume-reset')", at);
  ok(at >= 0 && end > at, 'T28 组卷入口还是这一处处理器');
  const body = at >= 0 ? raw.slice(at, end) : '';
  [
    ['var key = seq ? resumeKey(f, order)', 'T28 进度键按按下那一刻的条件现算'],
    ['readResume(key)', 'T28 开轮读进度走自愈读那一圈'],
    ['var desc0 = filterDesc(f);', 'T28 按下那一刻的筛选描述被留下来'],
    ["if (filterDesc(readFilter('practice')) !== desc0) {", 'T28 返回时真的拿当前筛选跟留下来的那份比'],
    ["toast('筛选在取题期间改过了", 'T28 比出不同就当着用户说，不是悄悄按旧条件出卷子'],
    ['clearResume(key);', 'T28 刷到末尾时清进度走同一个口子'],
    ['busy(this, fetchByFilter(', 'T28 这一段仍在 busy 的包裹里']
  ].forEach(function (p) {
    ok(body.indexOf(p[0]) >= 0, 'T28 ' + p[1]);
  });
})();

(function t29() {
  const m = build();
  const bothNow = m.srcLabel(['error', 'favorite']);

  const cur = [
    m.SRC_NAME.error + ' · 日期：全部|asc',
    bothNow + ' · 行政职业能力测试（资料分析）|desc',
    m.SRC_NAME.mock + '（全部模考题）|asc',
    m.SRC_NAME.error + ' · 日期：本周 ＋ ' + m.SRC_NAME.mock + '（全部模考题）|asc'
  ];
  const healable = m.SRC_NAME.both + ' · 日期：全部|asc';
  const ancient = '行政职业能力测试（资料分析）|asc';

  (function () {
    const r = {};
    cur.concat([healable, ancient]).forEach(function (k, i) { r[k] = { idx: i, id: i }; });
    eq(m.staleResumeKeys(r), [ancient],
      'T29 六条里只列归因不了的那一条：当前命名的与可自愈的都不许列');
  })();
  cur.forEach(function (k) {
    const o = {}; o[k] = { idx: 1 };
    eq(m.staleResumeKeys(o), [], 'T29 现版本算得出的键不算残留：' + k);
  });
  (function () {
    const o = {}; o[healable] = { idx: 7, id: 88 };
    eq(m.staleResumeKeys(o), [], 'T29 可自愈的那代不列——列了就是替用户把进度删掉');
  })();
  eq(m.staleResumeKeys({ '': { idx: 1 } }), [], 'T29 空键不列：那是随机组卷的占位，不是残留');
  eq(m.staleResumeKeys(undefined), [], 'T29 整块缺失返回空数组，不抛错');
  eq(m.staleResumeKeys({}), [], 'T29 空库返回空数组');

  eq(m.strayStorageKeys(['gongan_exam_helper_mingshi']), ['gongan_exam_helper_mingshi'],
    'T29 已停用脚本留下的整库命中');
  eq(m.strayStorageKeys(['gongan_tiku_helper_mingshi__bak_l2']), ['gongan_tiku_helper_mingshi__bak_l2'],
    'T29 排查时产生的历史快照命中');
  ['gongan_tiku_helper_mingshi', 'gongan_tiku_helper_other', 'gongan_tiku_helper_zhuanshi'].forEach(function (k) {
    eq(m.strayStorageKeys([k]), [], 'T29 在用的库绝不命中，哪怕那是别的 ctx：' + k);
  });
  eq(m.strayStorageKeys(['token', 'gongan2_lang', 'scriptcat.some.key', 'gongan_tiku_helper_backup_notes']), [],
    'T29 站点自己的键、扩展的键、名字像备份但没有 __bak_ 段的都不命中');
  eq(m.strayStorageKeys(undefined), [], 'T29 没传名单返回空数组，不抛错');
  eq(m.strayStorageKeys(['gongan_exam_helper_a', 'gongan_tiku_helper_mingshi', 'gongan_exam_helper_b'])
      .join('|'), 'gongan_exam_helper_a|gongan_exam_helper_b',
    'T29 夹着一个在用库时，两个孤儿照样被挑出来、在用的留下');
})();

(function t30() {
  function slice(a, b) {
    const at = raw.indexOf(a);
    const end = at < 0 ? -1 : raw.indexOf(b, at);
    return at >= 0 && end > at ? raw.slice(at, end) : null;
  }
  const scan = fnSource('reconcileWithSite');
  ok(!!scan, 'T30 与站点核对的逻辑还是这一份（两颗入口共用它）');
  [
    ['ensureExamPointIndex()', 'T30 核对先确保考点表在手——按日期那条路自己不会拉 subcategory，没表就一条都登记不上'],
    ['busy(btn, ensureExamPointIndex(', 'T30 整条核对链包在置灰里：先取表、后拉题，中途不给连点'],
    ['return fetchByFilter(', 'T30 索引到手之后才按日期拉题'],
    ["dayRange: '4'", 'T30 核对按「日期=全部」，不是当天那一档'],
    ["srcs: ['error', 'favorite']", 'T30 两路都扫：只扫错题本会漏掉收藏里的题'],
    ['noteIdsWithHl()', 'T30 扫完要按「笔记 ∪ 划线」那份口径数还剩几题，而不是报个「完成」了事'],
    ['!moduleOf(id)', 'T30 缺模块那一档真的在查模块，不是只数题'],
    ['noteFacets(id).subj', 'T30 缺科目那一档也数得出（科目与模块两栏各报一个数）'],
    ['新登记 ', 'T30 状态栏要报「新登记 N 条」：N=0 就说明问题出在换不出模块名，不在题目不在列表里'],
    ['renderNotesList();', 'T30 重画笔记面板：模块下拉与那条提示都得跟着新登记变'],
    ['renderBookList();', 'T30 名单一变就得重主题本——站点收走的题当场离开题本'],
    ['SITE_LIST_CAP', 'T30 跑全了才剪在列名单，没跑全只并'],
    ["setStatus('与站点核对失败：'", 'T30 请求失败有话说，按钮不会卡在置灰态']
  ].forEach(function (p) { ok(scan && scan.indexOf(p[0]) >= 0, 'T30 ' + p[1]); });
  ok(scan && scan.indexOf('})).then(function (zyList)') < 0 &&
     /renderBookList\(\);\s*\}\)\)\.catch/.test(scan),
    'T30 置灰的界要画在整条链末尾：那个 `}))` 原本落在第二趟之后，末段统计与落库于是跑在按钮已恢复之后，' +
    '用户在核对还没收尾时就能再点一次（上面那条字面串查看不出括号错位）');

  const clean = slice("$('#gth-upgrade').addEventListener('click'", 'var notesSearchKey');
  ok(!!clean, 'T30 「升级后点我」的处理器还是这一段');
  [
    ['upgradeScan()', 'T30 要删的东西先一次扫齐（三份判据都在里面），再弹那一道确认'],
    ['n = f.keys.length + f.old.length + f.snaps.length',
      'T30 「有没有东西可删」按那三份的真实计数判：写死一个非零值就等于没东西时也弹框、也报删了 N 项'],
    ['if (n) {', 'T30 无可清理时不弹空框，直接去核对（原来那句「没有可清理的残留记录」换成一趟核对的进度）'],
    ['if (!confirm(', 'T30 删之前必须过一道确认（写成了无条件 confirm 也算没守）'],
    ['localStorage.removeItem(', 'T30 确认后真删存储键'],
    ['delete store.resume[x];', 'T30 确认后真删旧进度记录'],
    ['delete store.snaps[x];', 'T30 确认后真删孤儿快照'],
    ['saveStore();', 'T30 删过 resume 就落盘，不然下一次写盘又把旧记录带回来'],
    ['renderBookList();', 'T30 快照删了要重主题本——那一页正是靠快照摊题面的'],
    ['reconcileWithSite(this);', 'T30 这颗键最后真的把核对带上：只清理不核对，题本成员还是旧的']
  ].forEach(function (p) { ok(clean && clean.indexOf(p[0]) >= 0, 'T30 ' + p[1]); });
  const scan0 = fnSource('upgradeScan');
  ok(scan0.indexOf('staleResumeKeys(store.resume)') >= 0, 'T30 旧进度走那份判据，不是随手删 resume 整桶');
  ok(scan0.indexOf('orphanSnapIds()') >= 0, 'T30 孤儿快照那一档合进同一颗键，不再单摆一颗没人敢点的按钮');
})();

(function t32() {
  const m = build();

  eq(m.examTypeFrom('?exam_type=0', ''), 0, 'T32 行测那一档的科目读得出来（站点自己就是按这个参数决定标签）');
  eq(m.examTypeFrom('', '#/error?exam_type=1'), 1, 'T32 参数写在 hash 里也读得到');
  eq(m.examTypeFrom('?exam_type=date', ''), null, 'T32 「日期」那一档不是数字：读不出科目就不读，不当成 0');
  eq(m.examTypeFrom('', ''), null, 'T32 没有这个参数返回 null');

  eq(m.subjectFromUrl('?exam_type=0', ''), m.SUBJ_XC, 'T32 0 判行测');
  eq(m.subjectFromUrl('?exam_type=1', ''), m.SUBJ_ZY, 'T32 1 判公专');
  eq(m.subjectFromUrl('?exam_type=1621', ''), null,
    'T32 只认 0/1：站点别的控制器里 exam_type 会是分类 id（实测见过 1621、5），那些不是科目');
  eq(m.subjectFromUrl('?exam_type=5', ''), null, 'T32 同上，5 也不当科目');
  eq(m.subjectFromUrl('?exam_type=date', ''), null, 'T32 日期档不判科目');

  (function () {
    const err = build({ listRoute: true, location: { search: '?exam_type=0', hash: '#/error?exam_type=0' } });
    eq(err.routeExamType(), 0, 'T32 错题页按路由判科目（站点自己也是按这个参数决定标签）');
    const zk = build({ listRoute: true, location: { search: '', hash: '#/zhuanxiang?exam_type=1621' } });
    eq(zk.routeExamType(), null, 'T32 那一页的 exam_type 是分类 id，不是科目：不拿来标');
    const mk = build({ listRoute: false, location: { search: '', hash: '#/mocks/baogao/5158/detailv3?exam_type=1' } });
    eq(mk.routeExamType(), null, 'T32 模考页不在列表路由内：那里的 exam_type 是接口参数');
  })();

  const index = { '111': '资料分析' };
  const site = [
    { id: 1, exam_point: 111, _src: 'error' },
    { id: 2, exam_point: 999, _src: 'favorite' },
    { id: 3, _src: 'error' },
    { id: 4, exam_point: 111 }
  ];
  const zy = [{ id: 2, _src: 'favorite' }, { id: 5, exam_point: 111, _src: 'error' }];
  const f = m.sweepFacets(site, zy, index);
  eq(f.subjects['1'], 0, 'T32 考点落在行测树里的判行测');
  eq(f.subjects['2'], 1, 'T32 撞树时以「按科目取到的公专结果」为准：科目就是那次请求的参数，不猜');
  eq(f.subjects['5'], 1, 'T32 公专结果里的题即使考点像在行测树里也判公专');
  eq(f.subjects['3'], undefined, 'T32 没有考点、又不在公专结果里：留未知，不硬给一个');
  eq([f.srcs['1'], f.srcs['2'], f.srcs['4']], ['error', 'favorite', undefined],
    'T32 来源只收题上真打了标记的；模考题没有 _src，不会被记成练习题');
  eq(m.sweepFacets(site, [], null).subjects['1'], undefined,
    'T32 没拿到考点表时一条都不判行测（这条与 T25 那道守卫是同一件事的两端）');
  eq(m.sweepFacets(undefined, undefined, index).srcs, {}, 'T32 两趟都空时返回空表，不抛错');

  (function () {
    const st = mkStore({ qSrc: { 1: 'error', 3: 'error' } });
    const t = build({ store: st });
    eq(t.reconcileSources({ 1: 'error', 2: 'favorite' }, true), 1, 'T32 全量核对：这一趟没见到的那条剪掉');
    eq(st.qSrc['3'], undefined, 'T32 剪掉是真删，不是留个空值——题本成员跟着站点走就靠这一条');
    eq([st.qSrc['1'], st.qSrc['2']], ['error', 'favorite'], 'T32 见到的两条按见到的样子登记');
    ok(st.qSrcAt > 0, 'T32 核对过就留下时间戳，题本拿它判「还没核对过」');
    ok(t.getSaved() > 0, 'T32 核对完必落盘（名单与时间戳要一起走）');
    const st2 = mkStore({ qSrc: { 3: 'error' } });
    eq(build({ store: st2 }).reconcileSources({ 1: 'error' }, false), 0, 'T32 那一趟没跑全时一条都不剪');
    eq(st2.qSrc['3'], 'error', 'T32 没跑全时旧的在列记录保住（宁可多留，不可错删）');
    eq(build({ store: mkStore({ qSrc: {} }) }).reconcileSources(undefined, true), 0, 'T32 空输入不抛错');
  })();

  (function () {
    const st = mkStore({
      notes: { 1: { text: 'a', subject: null }, 2: { text: 'b', subject: 1 } },
      highlights: { 1: [{ quote: 'q', subject: null }], 3: [{ quote: 'r', subject: null }] }
    });
    const t = build({ store: st });
    eq(t.backfillSubject({ 1: 0, 2: 1, 3: 1 }), 3, 'T32 笔记补一条、划线补两条，已有值那条不算');
    eq(st.notes['1'].subject, 0, 'T32 笔记的空科目补上了');
    eq(st.notes['2'].subject, 1, 'T32 已有科目不被覆盖：重扫是补空，不是改写用户见过的那份');
    eq(st.highlights['1'][0].subject, 0, 'T32 划线第一条也补（列表与一键整理读的就是这一条）');
    eq(t.backfillSubject({ 1: 1 }), 0, 'T32 补过之后不再动');
    eq(t.backfillSubject(undefined), 0, 'T32 空输入不抛错');
    eq(t.backfillSubject({ 99: 0 }), 0, 'T32 既没笔记也没划线的题不写任何东西');
  })();

  (function () {
    const st = mkStore({ notes: { 7: { text: 'x', subject: 0 } }, qSrc: { 7: 'error' } });
    const t = build({ store: st });
    const r = t.noteFacets(7);
    eq(r.src, 'error', 'T32 记过来源的题，来源就是那一条');
    ok(t.noteMatch(r, { src: 'site' }), 'T32 「练习题」是集合：错题本题要能被它选中');
    ok(t.noteMatch(r, { src: 'error' }), 'T32 也能单按错题本筛');
    ok(!t.noteMatch(r, { src: 'favorite' }), 'T32 没在收藏夹出现过的题不该被收藏夹那一档选中');
  })();
  (function () {
    const st = mkStore({ notes: { 8: { text: 'y', subject: 0 } } });
    delete st.qSrc;
    var v;
    try { v = build({ store: st }).noteFacets(8).src; } catch (e) { v = '抛错了：' + e.message; }
    eq(v, 'site', 'T32 旧库没有这张表 → 退回「练习题」，不许抛错（抛错说明那道兜底被拆了）');
  })();
  (function () {
    const t = build({ store: mkStore({ notes: { 9: { text: 'z', subject: 1 } }, mockQs: { 9: { id: 9, at: 1 } } }) });
    const r = t.noteFacets(9);
    eq(r.src, 'mock', 'T32 模考收录优先于练习题');
    ok(!t.noteMatch(r, { src: 'site' }), 'T32 按练习题筛时不把模考题混进来');
  })();

  (function () {
    const st = mkStore({
      notes: { 20: { text: 'a', subject: 1 }, 21: { text: 'b' } },
      highlights: { 21: [{ quote: 'q', subject: 0 }] }
    });
    const t = build({ store: st });
    eq(t.subjectForExport({ id: 20, content_type: 0 }), 0,
      'T32 题面自带 content_type 时以它为准，不拿库里那份顶掉（两处可以不一样）');
    eq(t.subjectForExport({ id: 20 }), 1, 'T32 题面没有科目就取库里那条——重扫回填的正是这里');
    eq(t.subjectForExport({ id: 21 }), 0, 'T32 库里只有划线时，从划线第一条取（与列表口径同一条）');
    eq(t.subjectForExport({ id: 99 }), null, 'T32 两处都没有：返回 null，导出留空，不硬给一个科目');
  })();

  eq([m.SRC_LIST_LABEL.error, m.SRC_LIST_LABEL.favorite, m.SRC_LIST_LABEL.both],
    ['错题本', '收藏夹', '错题本＋收藏夹'], 'T32 导出「来源」列的三个字面量齐了');
})();

async function t31() {
  const sub = [{ id: 11, name: '资料分析', exampoint_list: [{ id: 111, name: '数字推理' }] }];

  const seen1 = [];
  const m1 = build({ store: mkStore(), subcategory: sub, sub: seen1 });
  await m1.ensureExamPointIndex();
  eq(seen1.length, 1, 'T31 手里没有考点索引时，重扫这条链先打一次考点表（按日期那条路自己不会拉 subcategory）');

  const seen2 = [];
  const m2 = build({ store: mkStore(), subcategory: sub, sub: seen2, examPointModule: { '111': '资料分析' } });
  const got = await m2.ensureExamPointIndex();
  eq(seen2.length, 0, 'T31 索引已在手时一次都不再拉表，重扫不该每回多打一个请求');
  eq(got && got['111'], '资料分析', 'T31 把现有索引交回调用方，别让调用方自己猜拉没拉到');
}

(function t33() {
  let H;
  try { H = halves(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { ok(false, 'T33 读不到合并后的脚本（' + e.message + '）'); return; }
  const src = blankLiterals.comments(H.timer);
  const code = blankLiterals(H.timer);
  function hit(re, why) { ok(re.test(src), 'T33 ' + why); }
  function miss(re, why) { ok(!re.test(src), 'T33 ' + why); }
  function countOf(needle) {
    let n = 0, i = 0;
    while ((i = src.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
    return n;
  }

  const meta = H.whole.slice(0, H.whole.indexOf('// ==/UserScript=='));
  ok(/^\/\/ @name\s+上岸村机考助手\s*$/m.test(meta),
    'T33 名字就是交付名「上岸村机考助手」——商店条目、仓库文件名与 @name 是同一个东西');
  ok(/^\/\/ @grant\s+GM_addStyle\s*$/m.test(meta) && /^\/\/ @grant\s+GM_xmlhttpRequest\s*$/m.test(meta) &&
    !/^\/\/ @grant\s+none\s*$/m.test(meta),
    'T33 元数据取助手那套（GM_xmlhttpRequest / GM_addStyle）：补上 @grant none 就退回页面世界，助手的跨域收题当场失效');
  ok(H.whole.indexOf(MARK_TIMER) < H.whole.indexOf(MARK_HELPER),
    'T33 计时那半排在最前面：它要抢在助手那几千行之前把阀门装上，助手崩了也不能把计时带走');
  eq((H.whole.match(/^\(function \(\) \{$/gm) || []).length, 2,
    'T33 两半各自一个 IIFE——塞进同一个里，半路一个 return 就能把另一半整段吃掉');
  eq((H.whole.match(/^  \} catch \(e\) \{$/gm) || []).length, 2,
    'T33 两半各自 try/catch：一条 uncaught 异常会终止脚本里它之后的全部语句（ADR 0008 决策 3）');
  const ctxAll = [...H.whole.matchAll(/var CTX = ([^;]+);/g)].map(function (m) { return m[1]; });
  eq(ctxAll.length, 2, 'T33 CTX 两半各自现算一份（两半不共享作用域），恰好两处定义');
  eq(ctxAll[0] === ctxAll[1], true,
    'T33 两处 CTX 表达式一字不差——计时那半写键、助手那半读键，口径一错就是静默读不到');
  const helperNames = (function () {
    const set = {};
    const re = /^  (?:function ([A-Za-z_$][\w$]*)\s*\(|var ([A-Za-z_$][\w$]*)\s*=)/gm;
    let m;
    while ((m = re.exec(H.helper))) set[m[1] || m[2]] = 1;
    return Object.keys(set);
  })();
  eq(helperNames.filter(function (n) {
    if (n === 'CTX' || n === 'QTIME_KEY') return false;
    return new RegExp('\\b' + n + '\\s*\\(').test(src);
  }), [],
    'T33 计时段不许引用助手那半的任何名字（CTX / QTIME_KEY 两份各自现算是唯一例外）——两半不共享作用域，引用一处就是运行时静默失效');
  miss(/window\.angular\./,
    '不许再直接 window.angular 取页面真身（沙盒里它是 undefined，整条路会被 catch 吞掉）');
  hit(/typeof unsafeWindow === 'undefined' \? null : unsafeWindow/, '取页真身留着 unsafeWindow 那条回退');
  hit(/typeof angular !== 'undefined'/, '取页真身留着裸 angular 那条回退');
  hit(/ngSrc = 'angular'/, '三条回退各自记下走的是哪条，悬停才看得出这次是从哪拿到的');

  const quiet = [...code.matchAll(/catch \(\w+\) \{([^{}]*)\}/g)]
    .filter(function (m) { return !/=/.test(m[1]) && !/warn/.test(m[1]); });
  eq(quiet.map(function (m) { return m[1].trim(); }), [],
    'T33 每个 catch 都要留下看得见的痕迹（空 catch 或只 return 就是把失效藏起来）');

  eq(countOf('freezeDom(true)'), 1, 'T33 冻显示只留一处入口，别新增第二处绕过验证的');
  eq(countOf('holdReason()'), 3,
    'T33 验证要接三处（定义 + 按下暂停 + 每秒复检）——少一处就是「装上之后悄悄失效」没人知道');
  hit(/console\.warn\('\[计时暂停\]/, '验不过要往控制台说一句，别只在 title 里');
  eq(countOf('mainValve()'), 2,
    'T33 验证必须真的去看描述符（定义 + holdReason 里那一处调用）——去掉这处它就只剩「数字没变」，而数字没变也可能只是 interval 停了');
  hit(/function holdReason\(\) \{[\s\S]{0,300}?mainValve\(\)/,
    '验证靠描述符认阀门在不在，不靠往 totalTime 写哨兵值（那是真改站点数据）');
  miss(/\.(totalTime|elapsed_time|remainTime)\s*=(?!=)/,
    '这份脚本一次都不许写站点的时间字段——冻结靠吞掉站点自己的写，自己写就是往考试中改数据');
  hit(/noFreeze = holdReason\(\);[\s\S]{0,220}?if \(noFreeze\)[\s\S]{0,220}?freezeDom\(true\);/,
    '冻显示必须排在 holdReason 验过之后——验不过还冻显示就是上一版那个谎');
  hit(/function release\(\) \{[\s\S]{0,160}?timerStore\(false\);/, '撤暂停必须连本地那份一起撤');
  hit(/isAlreadySubmit[\s\S]{0,160}?release\(\);/,
    '交卷态要清掉暂停持久化，别让同一个 submit_id 下次进来隐形冻住');
  hit(/isAlreadySubmit[\s\S]{0,220}?clearHost\(\);/,
    '交卷后那块头部归错题助手——「已暂停」的琥珀色与「停不住」的下划线都得一起擦掉，只摘键不算擦干净');
  miss(/dati\.html/,
    'dati 页是墙钟驱动的倒计时，本脚本不覆盖它（要加 @match 先回去读 AGENTS.md 那条）');
  miss(/className = '(?!gth-)/, '注入用的类名一律带 gth- 前缀');
  const btnRule = /\.gth-timer-btn\{([^}]*)\}/.exec(src);
  const geo = ['height:30px', 'line-height:30px', 'padding:0 30px', 'border-radius:5px']
    .filter(function (p) { return !(btnRule && btnRule[1].indexOf(p) >= 0); });
  eq(geo, [],
    'T33 按钮几何要跟站点原生「交卷」键一致（实测 .jiaojuan a 就是这四条），不许改回自家那套 26px 小键');
  const baseBg = /\.gth-timer-btn\{[^}]*background:([^;}]+)/.exec(src);
  const pausedBg = /\.gth-timer-btn\.paused\{[^}]*background:([^;}]+)/.exec(src);
  ok(!!(baseBg && pausedBg) && baseBg[1] !== pausedBg[1],
    'T33 暂停态与未暂停态的背景色必须不同（同一颗键看不出是冻着还是在跑）');
  const icBox = /\.gth-timer-btn \.gth-timer-ic\{([^}]*)\}/.exec(src);
  ok(!!icBox && /width:\d+px/.test(icBox[1]) && /height:\d+px/.test(icBox[1]),
    'T33 键面上图标的方幅写死在自己这份样式里——去掉它，只带 viewBox 的 svg 会在 30px 的键里撑成一大块');
  const icMap = /var TIMER_ICONS = \{([\s\S]*?)\n  \};/.exec(src);
  const iconKeys = icMap ? [...icMap[1].matchAll(/^\s+(\w+):\s*'/gm)].map(function (m) { return m[1]; }) : [];
  const iconUsed = [...src.matchAll(/timerIcon\('(\w+)'\)/g)].map(function (m) { return m[1]; });
  eq(iconKeys, ['pause', 'play'], 'T33 图标表里 pause / play 两条路径都得在——少一条，label() 拿到空串，键面上什么都不显');
  eq(iconUsed.sort(), ['pause', 'play'],
    'T33 两态各挂一个图标（在跑挂 pause、冻住挂 play），且名字要和表里的键对上——写错一个就成了空白键');
  hit(/b\.title = tip\(\);/, '悬浮文案只出 tip() 那一句，版本号不进 title（扩展管理器里看得见）');
  hit(/b\.innerHTML = label\(\);/, '键面走 innerHTML——改回 textContent 会把整段 svg 当字印出来');
  miss(/classList\.toggle\('(?!gth-)/, '注入用的类名一律带 gth- 前缀');
  hit(/\.operation-dati \.remain-time/,
    '按钮宿主仍只挂在会被 ng-if 撤掉的计时块上');
  miss(/querySelector\('\.operation-dati'\)/,
    '不许把宿主兜底到裸 .operation-dati——交卷后那块头部归错题助手的解析界面（ADR 0005），多摆一个我们的东西就是撞邻居');
  eq(countOf("'elapsed_time'"), 0,
    'T33 已用时间不许再进阀门清单——站点每秒自己 elapsed_time++，交卷上报的就是这个字段，冻住它就是往站点交一份少了一截的用时');
  miss(/detail_elapsed_time/,
    '逐题用时同样不冻，理由同上：那也是要上报给站点的字段，不是我们自己的显示');
  eq(countOf('usedText()'), 2,
    'T33 真实用时只许「读站点那一份」（定义 + 进 diag），别出现第二处自造的计时表——那只表交不上去，谁都不会看见');
  hit(/function failHold\(why\) \{[\s\S]{0,90}?var foundTimer = scopeCount > 0;/,
    '「没找到计时器 scope」与「找到了却停不住」必须分两条路——前者只是还没就绪，判死刑会把考试开始前的页面永久锁死');
  hit(/if \(!foundTimer\)[\s\S]{0,140}?render\(\);[\s\S]{0,40}?return;/,
    '还没就绪那一条要原样留着键（不冻、不持久化、不标记），不许顺手把它升级成永久失效');
  hit(/givenUp = true;[\s\S]{0,80}?markHost\(noFreeze\);/,
    '停不住的唯一结局是摘键 + 在宿主上留痕，不是把键留着变灰——「不可暂停」那一档已经废掉');
  hit(/if \(givenUp\) \{[\s\S]{0,80}?markHost\(noFreeze\);[\s\S]{0,40}?return;[\s\S]{0,80}?ensureBtn\(\);/,
    '每秒复检里 givenUp 必须排在建键之前——否则站点重绘一次宿主，那颗「停不住」的键又被建回来了');
  hit(/function markHost\(why\) \{[\s\S]{0,90}?old\.remove\(\);/,
    '留痕之前先摘键：界面上不许同时存在「停不住」的下划线和一颗能按的键');
  hit(/\.remain-time\.gth-timer-no a\{[^}]*text-decoration:underline dotted/,
    '停不住那个痕要真画得出来（虚线下划只画在站点那行时间文本上，不画在自己的键上）');
  hit(/^\s*if \(!freezablePage\(\)\) return;\s*$/m,
    '划界必须在注入 style 之前就把整份脚本挡回去——写在 tick 里等于仍然往不该生效的页面塞了一个 style 节点');
  hit(/function freezablePage\(\) \{[\s\S]{0,320}?siteParam\('page_type'\) === 'random'/,
    'practice.html 只有 page_type=random 算可暂停：只有那一支到点交卷并随机跳板块，另一支显示的是用时不是剩余时间，冻它等于造假');
  hit(/function siteParam\(name\) \{[\s\S]{0,400}?location\.search[\s\S]{0,300}?hashQuery\(\)/,
    '参数必须 search 与 hash 两处都读、hash 覆盖 search，跟站点自己的 getSearch 同口径——只读 search 会把 #/?page_type=random 那种链接判成不生效');
  miss(/不可暂停/,
    '界面上已经没有「这一页不能暂停」这个状态了，措辞里也不许再把它请回来（停不住的表达方式是宿主上一道下划）');

  const QK = /var QTIME_KEY = 'gth_qtime_' \+ CTX;/.exec(src);
  hit(/var CTX = location\.pathname\.split\('\/'\)\[1\] \|\| 'mingshi';/,
    '分场用的 ctx 必须从 pathname 第一段现算——站点有两套 ctx，写死就等于把记录存到别人的库里');
  ok(!!QK, '用时记录走自己的键 gth_qtime_<ctx>（两半各一处），不并进助手那个整库——并库要迁移老数据，而这份每 5 秒落盘一次');
  eq([...H.whole.matchAll(/var QTIME_KEY = 'gth_qtime_' \+ CTX;/g)].length, 2,
    'T33 两半各现算一份 QTIME_KEY：两半不共享作用域，少一处就是一边写一边读不到');
  hit(/localStorage\.setItem\(QTIME_KEY/,
    '用时只往自己那个键里写');
  miss(/localStorage\.setItem\('zhuanxiang_cache|localStorage\.setItem\("zhuanxiang_cache/,
    '更不许写站点自己的续答缓存键（那是考试数据，不是我们的账）');
  hit(/function recordSecond\(\) \{[\s\S]{0,200}?timerIsZyPage\(\)/,
    '记录只认专项练习页：这一轮不碰 practice 与模考页（那两页一屏不止一道题，归属判不干净）');
  hit(/recordSecond\(\);\n    if \(!timerHost\(\)\) return;/,
    '记录必须接在每秒复检里，而且要排在「宿主被 ng-if 撤走就 return」之前——切题时宿主常在动，排在后面会整段漏记');
  hit(/!scope\.allInterval \|\| scope\.isAlreadySubmit/,
    '站点没开始计时（allInterval 还是 null）与已交卷都不记——否则「站在页面里还没开考」也会被算成做题时间');
  hit(/it\.index === ls\.currentIndex/,
    '当前题必须按站点自己的口径认（currentIndex == subjectObj.index），专项页是一屏一道题，这一秒只可能属于一道');
  hit(/if \(paused && !noFreeze\) rec\.paused\+\+;\n\s*tallySecond\(rec, currentQid\(\)\);/,
    '暂停期间那一秒照样记在当前题头上（用户 10-09 口径：要的是真实用时，离开两分钟就是两分钟）；' +
    'paused 那只表仍然走，但只用于展示「其中暂停多久」，不再从各题里扣掉');
  hit(/function tallySecond\(r, id\) \{[\s\S]{0,160}?r\.lost = \(r\.lost \|\| 0\) \+ 1;/,
    '认不出当前题的那一秒落「未归属」，不许猜给上一题——猜就会把最久的那一题记成别人');
  hit(/function mergeUp\(target, key, val\) \{[\s\S]{0,140}?val > \(target\[key\] \|\| 0\)/,
    '合并要逐字段取大（只增），别改回整份覆盖');
  hit(/function flushRec\(\) \{[\s\S]{0,900}?mergeUp\(rec\.q, k, disk\.q\[k\]\);/,
    '落盘前必须重读磁盘再逐题合并——踩过一次「过期标签整库回写把新数据擦了」，这一份也不能靠内存快照写');
  eq(countOf('flushRec()'), 4,
    'T33 落盘接在四处（定义 + 每秒累计 + 暂停边界 + 交卷那一刻）——少一处就是「最多丢 4 秒」变成「整段没记上」');
  hit(/recTick % 5 === 0/,
    '每 5 秒才落一次盘：站点每秒自己就在写它的缓存，我们没必要跟着写满');
})();

// ==== ADR 0005：解析页笔记与题本 ====
(function t50() {
  const zy = { pathname: '/mingshi/wxpage/tiku/gongan/zhuanxiang.html', search: '?status=finished&submit_id=abc', hash: '#/', href: 'https://x/' };
  const m2 = build({ location: zy });
  ok(m2.isZyPage(), 'T50 专项页认得出是专项页');
  ok(m2.zyUrlSubmitted(), 'T50 URL 同时有 status=finished 与 submit_id 才算交卷态');
  eq(m2.analysisReady(), false, 'T50 URL 说交过卷但 scope 没给 isAlreadySubmit → 不注入（fail-closed）');
  eq(m2.isZyAnalysis(), false, 'T50 闸门没开就没有解析界面形态');
  eq(build({ location: { pathname: zy.pathname, search: '?status=finished', hash: '#/' } }).zyUrlSubmitted(), false,
    'T50 缺 submit_id 不算交卷态');
  eq(build({ location: { pathname: zy.pathname, search: '?status=running&submit_id=abc', hash: '#/' } }).zyUrlSubmitted(), false,
    'T50 status 不是 finished 不算交卷态');
  const idx = { pathname: '/mingshi/wxpage/tiku/gongan/index.html', search: '', hash: '#/error' };
  eq(build({ location: idx }).isZyPage(), false, 'T50 题库首页不是专项页');
  eq(build({ location: idx }).analysisReady(), false, 'T50 首页不走解析闸门');
  eq(build({ location: idx, mocksPage: true }).analysisReady(), false,
    'T50 模考报告页没有解析笔记入口（用户 10-07 定：解析页笔记只做专项练习）');
  const an = { pathname: '/mingshi/wxpage/tiku/gongan/analysis.html', search: '', hash: '#/' };
  eq(build({ location: an }).analysisReady(), false, 'T50 analysis.html 同样不接，别再往里加');
  eq(build({ location: an }).isZyPage(), false, 'T50 analysis.html 不是专项页');
})();

(function t51() {
  const warns = [];
  const store = mkStore({});
  const m = build({ store: store, warns: warns });
  const snap = m.harvestSnapshot({ id: 77, content: '<p>题干七十七</p>', material: '', opt: [{ label: 'A', content: '甲' }],
    correct_answer: ['B'], user_answer: ['A'], analysis: '<p>解析七十七</p>', content_type: 0 }, 'zy');
  ok(!!snap && !!store.snaps['77'], 'T51 动笔那一刻当场建起题面快照');
  ok(store.snaps['77'].analysis.indexOf('解析七十七') >= 0, 'T51 解析正文进快照');
  eq(store.snaps['77'].from, 'zy', 'T51 快照记下抓于哪一页');
  m.harvestSnapshot({ id: 77, content: '<p>换了题面</p>', analysis: '别的解析' }, 'zy');
  eq(store.snaps['77'].content, '<p>题干七十七</p>', 'T51 题面先到先得，后来的不覆盖');
  eq(store.snaps['77'].analysis, '<p>解析七十七</p>', 'T51 已有解析时后来的也不覆盖');
  const s2 = m.harvestSnapshot({ id: 88, content: '题干八十八', analysis: '' }, 'zy');
  ok(!!s2 && s2.analysis === '', 'T51 解析没展开时允许先存空串');
  m.harvestSnapshot({ id: 88, content: '题干八十八', analysis: '<p>后来展开了</p>' }, 'zy');
  eq(store.snaps['88'].analysis, '<p>后来展开了</p>', 'T51 空的 analysis 必须能被补上，否则永久钉死');
  eq(m.harvestSnapshot({ id: 99, analysis: '只有解析没有题面' }, 'zy'), null, 'T51 认不出题面就不建快照');
  ok(warns.join('|').indexOf('没认出这道题的题面') >= 0, 'T51 认不出题面时把原因留在控制台');
  eq(!!store.snaps['99'], false, 'T51 认不出题面时不写坏数据');
  const cand = m.harvestSnapshot({ question_id: 123, stem: '候选键题干', explanation: '候选键解析' }, 'error');
  ok(!!cand && String(cand.id) === '123', 'T51 字段名按候选键认（模板名字不等于运行时名字）');
  eq(store.snaps['123'].content, '候选键题干', 'T51 候选键映射进规范字段');
})();

(function t52() {
  const mine = mkStore({ snaps: { 5: { id: 5, content: '我的题面', analysis: '' } } });
  const m = build({ store: mine, disk: JSON.stringify({ snaps: {
    5: { id: 5, content: '别人的题面', analysis: '别人有解析' }, 6: { id: 6, content: '新题', analysis: 'x' } } }) });
  const r = m.mergeConcurrent(mine);
  eq(r.snaps['5'].content, '我的题面', 'T52 快照题面先到先得，别的标签不许覆盖');
  eq(r.snaps['5'].analysis, '别人有解析', 'T52 我这里 analysis 是空的，要拿别人的补上');
  eq(r.snaps['6'].content, '新题', 'T52 磁盘上多出来的快照并进来');
  const legacy = mkStore({ snaps: undefined });
  const m2 = build({ store: legacy, disk: JSON.stringify({ notes: {} }) });
  let threw = '';
  try { m2.mergeConcurrent(legacy); } catch (e) { threw = String(e && e.message); }
  eq(threw, '', 'T52 旧库根本没有 snaps 时合并不报错');
})();

(function t53() {
  const store = mkStore({
    notes: { 1: { text: '甲' }, 5: { text: '戊' } },
    highlights: { 2: [{ quote: 'q' }], 1: [] },
    mockQs: { 3: { id: 3, content: '模考题', analysis: 'a', examId: 5158 }, 1: { id: 1, content: '撞键的模考题', analysis: 'b', examId: 5158 } },
    snaps: { 1: { id: 1, content: '题面一', analysis: '解析一' }, 4: { id: 4, content: '孤儿快照', analysis: 'x' } },
    qSrc: { 2: 'error' }, qSrcAt: 5
  });
  const m = build({ store: store });
  eq(m.bookIds().map(String).sort(), ['1', '3', '5'],
    'T53 题本成员 = 动过笔或模考收录，且站点错题本与收藏夹里没有它（2 在列，所以离开题本）');
  eq(m.inSiteLists('2'), true, 'T53 在列名单说得出这道题站点还收着');
  eq(m.inSiteLists('1'), false, 'T53 名单里没有的才算站点没有');
  eq(m.bookQuestion('1').content, '题面一', 'T53 与模考收录撞键时题面取快照');
  eq(m.bookQuestion('1')._conflict, true, 'T53 两份题面不一致要标出来请核对');
  eq(m.bookQuestion('3')._mock, 5158, 'T53 只有模考收录的题也进题本，并带上场次');
  eq(m.bookQuestion('5')._noSnap, 1, 'T53 没快照的题进题本走降级');
  eq(m.bookQuestion('5')._ex, '', 'T53 降级时给的是题干引文');
  eq(m.orphanSnapIds().map(String), ['4'], 'T53 孤儿快照 = 既无笔记又无划线又非模考收录');
  eq(m.bookList().length, 3, 'T53 bookList 与 bookIds 同一条口径');
  const fresh = build({ store: mkStore({ notes: { 1: { text: '甲' } }, qSrcAt: 0 }) });
  eq(fresh.bookIds(), [], 'T53 没与站点核对过时一条都不摊——谁都没资格被算成「站点没有」');
  eq(fresh.reconciled(), false, 'T53 核对过没有是看得出来的状态，不是靠名单空不空猜');
})();

(function t54() {
  const m = build({ store: mkStore({}) });
  const html = m.questionCardHtml({ id: 1, content: '题干一', material: '', opt: [{ label: 'A', content: '甲' }],
    correct_answer: ['A'], user_answer: ['A'], analysis: '解析一' }, { mine: 'A', mineOk: true, picked: ['A'] });
  ok(html.indexOf('data-gth-qid="1"') >= 0, 'T54 卡片带 data-gth-qid，划线才落得下去');
  ok(html.indexOf('我的答案') >= 0 && html.indexOf('解析一') >= 0, 'T54 卡片摊开题目与解析');
  const noAns = m.questionCardHtml({ id: 2, content: '题干二', opt: [], correct_answer: ['A'], analysis: '' }, { mine: null });
  eq(noAns.indexOf('你的答案') >= 0, false, 'T54 没有作答记录时「你的答案」整块缺席');
  ok(noAns.indexOf('gthq-notebox') >= 0, 'T54 笔记框默认在');
  const bare = m.questionCardHtml({ id: 3, content: '', opt: [], analysis: '' }, { noSnap: 1, excerpt: '题干引文三', note: false });
  ok(bare.indexOf('还没有题面') >= 0 && bare.indexOf('题干引文三') >= 0, 'T54 缺快照时给题干引文与补全提示');
  eq(bare.indexOf('gthq-notebox') >= 0, false, 'T54 note:false 时不摆笔记框');
  const conf = m.questionCardHtml({ id: 4, content: '题干四', opt: [], analysis: '' }, { conflict: 1 });
  ok(conf.indexOf('不一致') >= 0, 'T54 撞键的卡片上要说清哪两份不一致');
})();

(function t55wiring() {
  ok(fnSource('reportHtml').indexOf('questionCardHtml(') >= 0, 'T55 接线：重练报告真的改成调公共卡片渲染器');
  ok(fnSource('bookCardHtml').indexOf('questionCardHtml(') >= 0, 'T55 接线：题本卡片真的改成调公共卡片渲染器');
  ok(fnSource('renderBookSides').indexOf('renderAside(') >= 0 && fnSource('renderAside').indexOf('bindAsideHl(') >= 0,
    'T55 接线：补充题本内框外那一栏就是错题页那张 .gth-aside 卡（划线与笔记绑定同一条，不是又写一套）');
  ok(fnSource('injectAnalysisUI').indexOf('bindAbar(') >= 0 &&
    fnSource('openAbarPanel').indexOf('bindNoteAreas(') >= 0 &&
    fnSource('bindNoteArea').indexOf('setNote(') >= 0,
    'T55 接线：解析页的逐题小条、笔记浮窗与写库那条路走同一套');
  ok(fnSource('fetchByFilter').indexOf('backfillSnaps(') >= 0, 'T55 接线：取题那一路真的会回填快照');
})();

(function t56() {
  const store = mkStore({ notes: { 21: { text: '甲' } }, highlights: { 22: [{ quote: 'q' }] } });
  const m = build({ store: store });
  eq(m.backfillSnaps([{ id: 21, content: '题面廿一', analysis: 'a' }, { id: 22, content: '题面廿二', analysis: 'b' },
    { id: 23, content: '题面廿三', analysis: 'c' }]), 2, 'T56 回填只补名单里的题，一次渲染几百题也不囤');
  eq(Object.keys(store.snaps).map(String).sort(), ['21', '22'], 'T56 没动过笔的题一条都不进快照库');
  eq(m.backfillSnaps([{ id: 24, analysis: '只有解析' }]), 0, 'T56 认不出题面的一条都不补');
})();

(function t57() {
  const m = build({});
  const r = m.migrateExported({ exported: { _v: 2, error: { 1: 1 } }, exportAt: { error: 5 } });
  eq(Object.keys(r.exported).sort(), ['_v', 'book', 'error', 'mock'], 'T57 旧库补出题本这一桶，既有的桶不重建');
  eq(r.exportAt.book, 0, 'T57 增量基线也要有题本');
})();

(function t58() {
  const store = mkStore({ notes: { 31: { text: '甲' } } });
  const m = build({ store: store, itemsById: { 31: { id: 31, content: '页面题面', analysis: '页面解析' } }, routeKind: 'error' });
  const s = m.harvestPageSnap(31);
  eq(s && s.content, '页面题面', 'T58 写笔记那一刻从当前页的题面抓快照');
  eq(s && s.from, 'error', 'T58 快照记下抓于错题本这一页');
  eq(m.harvestPageSnap(999), null, 'T58 页面上没有这道题时不硬编快照');
  eq(build({ location: { pathname: '/x/index.html', hash: '#/shoucang' }, routeKind: 'collect' }).pageFrom(), 'favorite',
    'T58 收藏页的 routeKind 换成 favorite');
  eq(build({ location: { pathname: '/x/index.html', hash: '' }, routeKind: '' }).pageFrom(), '',
    'T58 认不出在哪一页时来源标记留空，不猜');
})();

async function t59() {
  const store = mkStore({
    notes: { 11: { text: '甲' } },
    snaps: { 11: { id: 11, content: '题面十一', analysis: '解析十一', opt: [], correct_answer: ['A'] } },
    mockQs: { 12: { id: 12, content: '模考题', analysis: 'a', examId: 1, done: 1, ok: 0 } },
    qSrcAt: 1
  });
  const ctx = { store: store, calls: [], api: [], warns: [], status: [], saved: 0 };
  const m = build(ctx);
  ok(m.SRC_KEYS.indexOf('book') >= 0, 'T59 第四档来源进了 SRC_KEYS');
  eq(m.SRC_NAME.book, '补充题本', 'T59 SRC_NAME 有题本');
  eq(m.EXPORT_PREFIX.book, '上岸村补充题本_', 'T59 EXPORT_PREFIX 有题本（少了会静默落默认前缀）');
  eq(m.SRC_LIST_LABEL.book, '补充题本', 'T59 导出表格的来源列认得题本');
  eq(m.srcList({ srcs: ['book', 'error'] }), ['book', 'error'], 'T59 srcList 认 book');
  eq(m.hasSiteSrc(['book']), false, 'T59 只勾题本时日期/科目/模块都不参与取题');
  eq(m.hasSiteSrc(['book', 'error']), true, 'T59 与站点来源混勾时站点控件要留着');
  return m.fetchByFilter({ srcs: ['book'] }, 100).then(function (list) {
    eq(ids(list), ['11', '12'], 'T59 只勾题本时取的是题本全部成员（含模考收录进来的那道）');
    eq(ctx.calls.length, 0, 'T59 一条站点请求都不该发');
  });
}

async function t59b() {
  const store = mkStore({
    notes: { 11: { text: '甲' } },
    snaps: { 11: { id: 11, content: '题面十一', analysis: '解析十一', opt: [], correct_answer: ['A'] } },
    qSrcAt: 1
  });
  const ctx = { store: store, calls: [], api: [], warns: [], status: [], saved: 0 };
  const m = build(ctx);
  return m.fetchByFilter({ srcs: ['book'] }, 100).then(function (list) {
    eq(list.length, 1, 'T59b 题本档取题与 bookList 同源');
    eq(list[0]._src, 'book', 'T59b 题本来的题带得上 book 来源标记');
  });
}

(function t60() {
  const m = build({});
  function nodeOf(attr) { return { getAttribute: function (k) { return k === "ng-repeat" ? attr : null; } }; }
  eq(m.analysisNodeVar(nodeOf("subjectObj in localStorage.currentPartData.subjectList")), "subjectObj", "T60 专项页的题目节点认得出");
  ['item in jiexieSubjects', 'item in section.subjectList', "item in item.subjectList", "item in localStorage.partData", "all in subjectObj.opts",
   "o in subjectObj.opt", "o in all.opt", "subjectObj in otherList", "x", ""].forEach(function (attr) {
    eq(m.analysisNodeVar(nodeOf(attr)), null, "T60 真页面上另一条 ng-repeat 不许被当成题目：" + attr);
  });
  const it = { id: 901, content: "<p>题干</p>", correct_answer: ["A"], analysis: "<p>解析</p>" };
  eq(m.analysisScopeItem({ subjectObj: it }, "subjectObj") === it, true, "T60 题目项从 scope 上取得到");
  const child = Object.create({ subjectObj: it });
  eq(m.analysisScopeItem(child, "subjectObj") === it, true, "T60 同元素上的 ng-if 会再开一层子 scope，只能顺原型链读");
  eq(m.analysisScopeItem({ subjectObj: { id: 3 } }, "subjectObj", true), null, "T60 专项页严格态：答题卡那种没题面的桩不是题目");
  eq(m.analysisScopeItem(null, "item"), null, "T60 拿不到 scope 时不绑");
})();

(function t61() {
  const store = mkStore({
    notes: { 41: { text: '笔记四十一' } },
    highlights: { 41: [{ quote: 'q1', color: 'yellow' }] },
    snaps: { 41: { id: 41, content: '题干四十一', analysis: '解析四十一' } }
  });
  const m = build({ store: store });
  const bar = m.abarHtml(41);
  eq((bar.match(/data-act="note"/g) || []).length, 1, 'T61 笔记键只有一颗');
  ok(bar.indexOf('笔记</button>') >= 0, 'T61 键面就写「笔记」（2026-10-08 用户口径：不随状态改叫写笔记/预览/改笔记）');
  eq(/写笔记|改笔记|查看笔记/.test(bar), false, 'T61 键面不再随状态换词');
  ok(bar.indexOf('data-act="collect"') >= 0, 'T61 整理本题还在这排里，与笔记、复制题目同级');
  ok(bar.indexOf('已收录') >= 0 && bar.indexOf('1 划') >= 0, 'T61 小条带收录与划线数标记');

  const view = m.abarPanelHtml(41, 'view');
  eq(view.indexOf('<textarea') >= 0, false, 'T61 预览态不给文本框');
  ok(view.indexOf('笔记四十一') >= 0, 'T61 预览态直接把笔记正文摊出来');
  ok(view.indexOf('data-act="edit"') >= 0, 'T61 预览态给一颗「编辑」，进得去编辑模式');
  const empty = m.abarPanelHtml(42, 'view');
  ok(empty.indexOf('＋ 添加笔记') >= 0 && empty.indexOf('<textarea') < 0,
    'T61 没笔记时预览态给「＋ 添加笔记」，不是一句说明加一个空白框');

  const edit = m.abarPanelHtml(41, 'edit');
  ok(edit.indexOf('data-note="41"') >= 0 && edit.indexOf('笔记四十一') >= 0,
    'T61 编辑态是可写文本框，里面摊着现有笔记');
  ok(edit.indexOf('data-act="save"') >= 0 && edit.indexOf('data-act="cancel"') >= 0,
    'T61 编辑态要给「保存 / 取消」两颗键（2026-10-08 用户口径）');
  eq(edit.indexOf('data-act="collect"') >= 0, false, 'T61 整理本题已上收到小条，面板里不再放第二颗');

  ok(fnSource('toggleAbarNote').indexOf('closeAbarPanel(box)') >= 0,
    'T61 那颗键是开关：面板开着时再点是收起，不再在预览与编辑之间翻面');
  ok(fnSource('openAbarPanel').indexOf("getNote(id) ? 'view' : 'edit'") >= 0,
    'T61 打开时按有没有笔记选初始态：没写过就直接进编辑');
  ok(fnSource('bindNoteArea').indexOf('setNote(') >= 0, 'T61 保存那一路真的写库');
  eq((fnSource('bindNoteArea').match(/paint\('view'\)/g) || []).length, 2,
    'T61 保存与取消都回到预览态，两颗键只有这一点不同');
  eq(fnSource('noteAreaHtml').indexOf('debounce(') >= 0, false,
    'T61 编辑态不再边打边存：有了保存/取消，就不能同时偷偷落库');
  ok(fnSource('openAbarPanel').indexOf('bindNoteAreas(box)') >= 0,
    'T61 接线：浮窗里那块笔记区走同一份组件（重练报告卡片用的是同一个函数）');
  ok(fnSource('noteboxHtml').indexOf('data-note-area') >= 0 && fnSource('noteboxHtml').indexOf('noteAreaHtml(') >= 0,
    'T61 重练报告那边也换成同一份笔记区——上一版它连输入都没接上');
  ok(fnSource('bindQuiz').indexOf('bindNoteAreas(quizEl)') >= 0,
    'T61 接线：报告渲染完真的把笔记区绑上');
  eq(fnSource('noteboxHtml').indexOf('<textarea') >= 0, false,
    'T61 卡片里那口文本框由笔记区自己出，别在卡片模板里再抄一份');

  const css = fs.readFileSync(FILE, 'utf8');
  ok(/\.gth-apanel\{position:absolute;top:calc\(100%/.test(css),
    'T61 笔记框是浮在小条下方的窗，不是占满一行的长条');
  ok(/\.gth-apanel\{[^}]*width:min\(340px/.test(css), 'T61 浮窗宽度照错题页批注栏的量，不铺满题目区');
  ok(/\.gth-apanel\{[^}]*background:#fffbeb/.test(css), 'T61 浮窗沿用错题页批注栏那套观感（同一批内容不该两种长相）');
  ok(/\.gth-note-act\{[^}]*display:flex/.test(css), 'T61 保存/取消那一排的排布有出处');

  const src = lf(raw);
  const seg = src.slice(src.indexOf('function closeAbarPanel'), src.indexOf('function abarHtml'));
  ok(seg.indexOf("document.addEventListener('mousedown'") >= 0,
    'T61 点空白处收起：这条全局监听是用户口径（2026-10-08），撤回了「只由按钮收回」');
  ok(seg.indexOf('HL_BLOCK_SEL') >= 0 && seg.indexOf('#gth-hlnote') >= 0,
    'T61 收起之前先认自家浮层：点小条、面板、批注栏与划线浮窗都不算点空白');
  ok(fnSource('injectAnalysisUI').indexOf("$('.gth-apanel', bar)") >= 0,
    'T61 接线：浮窗开着时不重画小条，否则 innerHTML 会抹掉正在编辑的框（小条挪到头部之后，判据跟着看 bar 而不是题目节点）');
})();

// ==== ADR 0007：逐题用时（记录在答题态那半，展示在专项解析页）====
(function t64() {
  const SESS = { q: { '11': 200, '22': 95, '33': 5 }, paused: 60, lost: 3, merged: 0 };
  const REC = { '7788': SESS };
  const disk = JSON.stringify(REC);
  const ZYQ = { pathname: '/mingshi/wxpage/tiku/gongan/zhuanxiang.html', search: '?exam_id=7788&status=finished&submit_id=9', hash: '#/' };
  const list = [{ id: 11, index: 1 }, { id: 22, index: 2 }, { id: 33, index: 3 }];
  const ng = {
    element: function () {
      return { scope: function () { return { localStorage: { currentPartData: { subjectList: list } } }; } };
    }
  };
  const st = { notes: {}, snaps: { '11': { content: '<p>第 11 题的题干，公安机关在……</p>' } }, mockQs: {}, highlights: {} };
  const nodes = [{ node: { parentNode: null }, item: { id: 11 } }];
  const M = build({ location: ZYQ, disk: disk, ng: ng, analysisNodes: nodes, store: st, itemsById: {} });

  eq(M.qtimeExamId(), '7788', 'T64 场次号取 URL 上的 exam_id（与站点自己分场用的同一个）');
  eq(build({ location: { search: '?exam_id=1', hash: '#/?exam_id=7788' }, disk: disk }).qtimeExamId(), '7788',
    'T64 exam_id 也要 search 与 hash 两处都读、hash 覆盖 search——站点 getSearch 就是这个口径，读漏一处就找不到那一场');
  eq(build({ location: { search: '', hash: '#/' }, disk: disk }).qtimeExamId(), '',
    'T64 两处都没有就是认不出场次，返回空串而不是猜一个');
  eq(M.getQtimeKey(), 'gth_qtime_mingshi', 'T64 读的是计时那份自己的键，不是助手那个整库');
  eq(M.qtimeSec(11), 200, 'T64 单题秒数按题号取（数字题号要能当字符串键查到）');
  eq(M.qtimeSec(99), 0, 'T64 没记到的题给 0，不给 undefined——界面据此决定画不画那一枚标签');
  const gone = build({ location: { search: '?exam_id=6666', hash: '#/' }, disk: disk, store: st });
  eq(gone.qtimeSession(), null, 'T64 这一场没有记录就返回 null，让上层显示降级文案而不是画个 0');
  const broken = build({ location: ZYQ, disk: '{ 不是 JSON', store: st });
  eq(broken.qtimeSession(), null, 'T64 键里是坏数据时当作没有，不抛错');
  ok(/JSON/.test(broken.getQtimeErr()), 'T64 坏数据要在诊断串里留下说法（不能静默当没有）', broken.getQtimeErr());

  eq(M.qtimeText(0), '--:--', 'T64 零秒不画 00:00，避免"这题只用了 0 秒"那种读法');
  eq(M.qtimeText(65), '01:05', 'T64 一分钟内出 mm:ss');
  eq(M.qtimeText(3725), '01:02:05', 'T64 过一小时补上小时位');

  eq(M.qtimeRows(SESS).map(function (r) { return r.id; }), ['11', '22', '33'],
    'T64 列表按站点自己的题目顺序排（用 currentIndex==subjectObj.index 那张表），不是按对象键序');
  eq(M.qtimeRows(SESS)[0].no, 1, 'T64 每行带上站点给的题序号，复盘时能对上卷面');
  const extra = { q: { '11': 10, '99': 7 }, paused: 0, lost: 0 };
  eq(M.qtimeRows(extra).map(function (r) { return r.id; }), ['11', '99'],
    'T64 记录里有但站点这张表没给的题也要出现（落在末尾），不能因为对不上就丢掉');
  const noOrder = build({ location: ZYQ, disk: disk, store: st, analysisNodes: [] });
  eq(noOrder.qtimeRows(SESS).map(function (r) { return r.id; }), ['11', '22', '33'],
    'T64 取不到站点顺序时按题号升序兜底，列表照旧出得来');
  ok(noOrder.getQtimeErr() || true, 'T64 兜底那条不抛错');

  ok(M.recapSig(SESS) === M.recapSig(JSON.parse(JSON.stringify(SESS))), 'T64 同样内容签名一致（浮窗才不会每轮重画）');
  const moved = JSON.parse(JSON.stringify(SESS)); moved.q['11'] += 1;
  ok(M.recapSig(moved) !== M.recapSig(SESS), 'T64 任何一秒变化都必须让签名变——否则新记的那一题被旧签名挡住不重画');
  ok(M.recapSig({ q: { '11': 295, '22': 5 }, paused: 0, lost: 0 }) !==
    M.recapSig({ q: { '11': 300 }, paused: 0, lost: 0 }),
    'T64 签名按"每题各几秒"算，不能只按总和——两笔同为 300 秒但分布不同的记录，浮窗内容不同就必须重画');

  const band = M.qtimeBandHtml(SESS);
  ok(band.indexOf('本场做题用时 05:00') >= 0, 'T64 按钮上只看得到总用时（200+95+5=300 秒）', band.slice(0, 140));
  eq((band.match(/gth-qtime-row"/g) || []).length, 3, 'T64 浮窗里每题一行，且始终在 DOM 里，靠 CSS 决定可见不可见');
  ok(band.indexOf('第 1 题') >= 0 && band.indexOf('03:20') >= 0, 'T64 一行只有序号与用时');
  eq(band.indexOf('class="t"') >= 0, false, 'T64 题干引文按用户口径删了——浮窗要短');
  eq(/暂停|未归属|没列出来|补不回来|选中题干/.test(band), false, 'T64 解释性文案一律不进浮窗（要说法看控制台那行）');

  const src = blankLiterals.comments(halves(fs.readFileSync(FILE, 'utf8')).helper);
  function hit(re, why) { ok(re.test(src), 'T64 ' + why); }
  function miss(re, why) { ok(!re.test(src), 'T64 ' + why); }
  hit(/if \(!r\) \{[\s\S]{0,120}?band\.remove\(\);[\s\S]{0,160}?qtimeSay\(/,
    'T64 这一场没记录时的形状是"摘掉入口 + 控制台说一句"，不是静默什么都不做（页面上没有不等于没发生过）');
  hit(/qtimeSay\('这一屏没找到题目节点，不挂用时入口'\)/,
    'T64 连宿主都找不到时同样要说一句（"页面上什么都没有"有三种原因，不写出来就只能靠截图猜）');
  hit(/退到题目节点的父容器/, 'T64 走了兜底挂载也要说出来，别让人以为已经挂进了内容区右上角');
  hit(/node\.closest\('\.question-box'\)/,
    'T64 宿主是内容区那个内滚盒子（.question-box）——用户 2026-10-07 定：东西放在内容区右上角那一行，不是站点蓝色头部');
  miss(/operation-dati/,
    'T64 专项页那块蓝色头部（.operation-dati）上不许多写任何东西：上一版把它挂在那儿，视觉上被裁、也压住了站点自己的头部');
  hit(/var top = zyTopBar\(host\);\s*\n\s*var bar = \$\('\.gth-abar', top\);/,
    'T64 小条与用时入口必须落在同一个 .gth-ztop 容器里——分开挂就是一个在右上角、一个飘到别处（写成 var top = host 也照样"同名"，所以锁的是 zyTopBar 这个来源）');
  hit(/top\.insertBefore\(band, top\.firstChild\);/,
    'T64 用时入口插在小条左边（小条是 appendChild，这个顺序才是「用时 · 写笔记 · 预览…」）');
  hit(/\.gth-ztop\{[^}]*position:absolute[^}]*right:24px[^}]*gap:8px/,
    'T64 固定间距：贴着内容区右上角、成员之间间距写死——跟着站点文字换行就会今天挪明天挪');
  miss(/\.gth-ztop\{[^}]*background/,
    'T64 容器不许再压一整条白带（2026-10-08 用户口径）：那一条白带浮在题干上不像原生');
  hit(/\.gth-ztop \.gth-btn\{[^}]*background:rgba\(255,255,255/,
    'T64 底色改由每一项自带一层极淡的可读底——它压在站点内容上方，全透明就会和题干表格叠在一起');
  hit(/\.gth-ztop \.gth-btn\{[^}]*height:28px[^}]*border-radius:6px/,
    'T64 那一排六项同一套外壳：旧版是一颗 ghost + 四颗白底灰边 + 一颗琥珀胶囊，三套规格并排（用户 2026-10-08 指出的不一致）');
  hit(/band\.classList\.toggle\('on'\);/,
    'T64 点击靠切 class 开合浮窗，不重画整块（面板一直在 DOM 里，重画反而会打断悬停）');
  hit(/\.gth-qtime:hover \.gth-qtime-panel,\.gth-qtime:focus-within \.gth-qtime-panel,\.gth-qtime\.on \.gth-qtime-panel\{display:block\}/,
    'T64 三种开法都要在：悬停、键盘 focus、点击。只写 :hover 的话键盘与触屏用户永远打不开');
  hit(/\.gth-qtime-panel\{[^}]*width:min\(340px/, 'T64 用时浮窗与笔记浮窗同宽（用户要求"长度相仿"）');
  miss(/gth-abar-hint|没列出来的题|补不回来/, 'T64 那些解释性文案已按用户口径删干净，别再写回来');

  ok(M.abarHtml(11).indexOf('03:20') >= 0, 'T64 逐题小条上带这一题的用时');
  eq(M.abarHtml(22).indexOf('03:20') >= 0, false, 'T64 别的题的用时不许串到这一题的小条上');
  const other = build({ location: ZYQ, disk: JSON.stringify({ '7788': { q: { '11': 201 }, paused: 0, lost: 0 } }), store: st });
  ok(M.abarSig(11) !== other.abarSig(11), 'T64 用时进了小条签名——改了记录就要重画，不然新记的那一题被旧签名挡住');
  miss(/localStorage\.setItem\(QTIME_KEY/, 'T64 助手那半对这份用时记录只读不写：写的人只有一个（答题态那半）');
  hit(/localStorage\.getItem\(QTIME_KEY/, 'T64 助手确实是从那个键读的，不是自己另算一份用时');

  eq(M.unitIdOf({ id: 5, opts: [{ id: 5 }] }), '', 'T64 opts 只有一道小题的按普通题算，不无端标成材料');
  eq(M.unitIdOf({ id: 5, opts: [{ id: 5 }, { id: 6 }] }), '5', 'T64 材料组的记账单位是材料首题 id——写键与展示都认这一个');
  eq(M.unitIdOf({ id: 5 }), '', 'T64 站点没挂 opts 时退回单题（降级路径，L2 待证那条靠它兜）');

  const MAT_OPTS = [{ id: 11, index: 1 }, { id: 22, index: 2 }, { id: 33, index: 3 }];
  const MAT_LIST = [{ id: 11, index: 1, opts: MAT_OPTS }, { id: 22, index: 2, opts: MAT_OPTS }, { id: 33, index: 3, opts: MAT_OPTS }];
  const ngMat = { element: function () { return { scope: function () { return { localStorage: { currentPartData: { subjectList: MAT_LIST } } }; } }; } };
  const matSess = { q: { '11': 289 }, paused: 0, lost: 0, merged: 0 };
  const MM = build({ location: ZYQ, disk: JSON.stringify({ '7788': matSess }), ng: ngMat, analysisNodes: nodes, store: st, itemsById: {} });
  const mrows = MM.qtimeRows(matSess);
  eq(mrows.length, 1, 'T64 材料组下只有材料首题那一条记录（整段材料的秒数都记在它身上）');
  eq([mrows[0].from, mrows[0].to, mrows[0].size], [1, 3, 3],
    'T64 认得出这是一段材料：起止题号与含几道小题都取站点挂在每一项上的 opts');
  const mband = MM.qtimeBandHtml(matSess);
  ok(mband.indexOf('第 1–3 题') >= 0,
    'T64 材料组下的序号写成区间，不伪造成一道题的题号（用户报的「序号乱」就是这里）', mband.slice(0, 200));
  ok(mband.indexOf('3 题 · 1 段材料') >= 0,
    'T64 入口上的计数按覆盖到的题数出，与卷面题数对得上——旧版按记录条数出，读起来像「只做了 4 题」');
  ok(MM.abarHtml(22, 11).indexOf('本材料 04:49') >= 0,
    'T64 材料内每一道小题的小条上都显示这一段的用时，标签写明是材料级的');
  ok(MM.abarHtml(11, 11).indexOf('本材料 04:49') >= 0,
    'T64 材料首题也带「本材料」——它的 04:49 是整段的账，不带前缀就会被读成这一道题用了四分四十九');
  ok(MM.abarHtml(11, '').indexOf('本材料') < 0, 'T64 单题卷面不无端多一个「本材料」');
  ok(MM.abarSig(22, 11).indexOf('M289') >= 0 && MM.abarSig(22, '') === '22|0|0|0|0',
    'T64 小条签名要带上「这是材料级的哪一份账」：材料里别的题记了新秒数，这一屏也得重画');
})();

(function t62() {
  const m = build({ store: mkStore({ notes: { 41: { text: '甲' } },
    highlights: { 41: [{ quote: 'q' }] }, snaps: { 41: { id: 41, content: 'c', analysis: 'a' } } }) });
  eq(m.abarSig(41), '41|1|1|1|0', 'T62 小条签名带上有没有笔记、几条划线、收没收录、这一题记到几秒这四件事');
  eq(m.abarSig(42), '42|0|0|0|0', 'T62 没动过笔的题签名是干净的一档（末尾那个 0 是没记到用时）');
  const ui = fnSource('injectAnalysisUI');
  ok(ui.indexOf("bar.getAttribute('data-sig') !== abarSig(curId, curUnit)") >= 0,
    'T62 签名没变就一个字都不写：每 400ms 重写 innerHTML 会喂观察器形成永不平息的循环，那处内存泄露就是这么来的');
  ok(ui.indexOf("getAttribute('data-gth-qid')") >= 0, 'T62 连 data-gth-qid 都先比再写，不做无谓写入');
  eq(ui.indexOf('rejected') >= 0, false, 'T62 每轮扫 scope 取字段名的诊断随 mocks 支持一起撤掉');
  const kept = [fnSource('analysisNodeVar'), fnSource('analysisReady'), fnSource('pageFrom')].join('');
  eq(kept.indexOf('jiexieSubjects') >= 0, false, 'T62 模考页的入口支持拆干净了（白名单里没有它）');
  eq(kept.indexOf('isAnalysisHost') >= 0, false, 'T62 analysis.html 的支持拆干净了，不留半截');
})();

(function t63() {
  const ctx = { itemsById: { 1: { id: 1 }, 2: { id: 2 } }, qNodes: { 1: { isConnected: true }, 2: { isConnected: false } } };
  const m = build(ctx);
  m.prunePageRefs();
  eq(Object.keys(m.getQNodes()).map(String), ['1'], 'T63 节点被摘掉后 qNodes 不再留着它（旧列表那棵子树不会被我们钉住）');
  eq(Object.keys(m.getItemsById()).map(String), ['1'], 'T63 跟着一起放掉那条页面对象引用');
  const m2 = build({ itemsById: {}, qNodes: { 3: { isConnected: true } } });
  m2.prunePageRefs();
  eq(Object.keys(m2.getQNodes()).map(String), ['3'], 'T63 还连着的节点不动它');
  ok(fnSource('injectAnalysisUI').indexOf('itemsById[id] = snapCopy(it)') >= 0,
    'T63 解析页存的是纯副本而不是活的 scope（一个 scope 能把整棵 \$rootScope 树钉住）');
  ok(fnSource('injectListUI').indexOf('itemsById[item.id] = snapCopy(item)') >= 0, 'T63 错题页那条路同理');
  ok(raw.indexOf('prunePageRefs();') >= 0, 'T63 接线：每轮观察器开头先剪一次引用');
  ok(fnSource('renderAside').indexOf('dataset.gthHtml === html') >= 0 &&
     fnSource('syncBalloons').indexOf('el.dataset.sig !== sig') >= 0,
    'T63 往界面写的路径各自带内容比对（那次泄露就是解析页小条漏了这一条）');
})();

(function t65() {
  const store = mkStore({
    notes: { 51: { text: '甲' }, 52: { text: '乙' }, 53: { text: '丙' }, 54: { text: '丁' } },
    snaps: { 51: { id: 51, content: '题干五十一', analysis: '解析五十一' },
      52: { id: 52, content: '题干五十二', analysis: '  ' } },
    mockQs: { 53: { id: 53, content: '模考五十三', analysis: '' } }
  });
  const m = build({ store: store });
  eq(m.snapState(51), 'full', 'T65 题面与解析都在才算快照齐');
  eq(m.snapState(52), 'part', 'T65 有题面没解析的是残缺快照');
  eq(m.snapState(53), 'part', 'T65 模考收录那份没有解析同样算残缺');
  eq(m.snapState(54), 'none', 'T65 两份都没有的才叫缺快照');
  const part = m.questionCardHtml({ id: 52, content: '题干五十二', opt: [], analysis: '' }, { partSnap: 1 });
  ok(part.indexOf('缺解析正文') >= 0, 'T65 残缺快照要在卡片上写清缺的是解析');
  eq(m.questionCardHtml({ id: 51, content: '题干五十一', opt: [], analysis: '解析' }, {}).indexOf('缺解析正文') >= 0, false,
    'T65 齐的卡片不给残缺提示');
  const bare = m.questionCardHtml({ id: 54, content: '', opt: [], analysis: '' }, { noSnap: 1, excerpt: '引文' });
  ok(bare.indexOf('还没有题面') >= 0, 'T65 缺快照仍然有那一条');
  eq(/摊开一次|点上面|点「补齐题面」/.test(bare + part), false,
    'T65 提示不再指挥用户动作——补齐题面改成进视图自动跑，卡片上不该还指着那颗已经不存在的按钮');
  const anaLite = m.questionCardHtml({ id: 51, content: '题干', opt: [{ label: 'A', content: '甲' }], analysis: '解析五十一' },
    { anaToggle: 1, circle: 1, no: 7 });
  ok(anaLite.indexOf('查看解析') >= 0 && anaLite.indexOf('收起') >= 0,
    'T65 题本卡片的解析默认收起，靠右下角那一行展开（照站点错题页）');
  ok(/class="gthq-analysis" hidden/.test(anaLite), 'T65 收起就得是 hidden，不能靠删节点——划线还要在小字里落点');
  ok(anaLite.indexOf('gth-btext') >= 0, 'T65 那一行有自己的类名，靠切 class 换两段文案，不重写 innerHTML');
  ok(anaLite.indexOf('gthq-analysis') < anaLite.indexOf('gth-bline'),
    'T65 解析正文在那条线之前——站点就是正文在上、「展开／收起 查看解析」压在右下角，反过来就成了按钮在上、内容在下');
  eq(/class="gthq-analysis" hidden/.test(m.questionCardHtml({ id: 51, content: '题干', opt: [], analysis: '解析' }, {})), false,
    'T65 重练报告那张卡片照旧直接摊解析，收起只给补充题本');
  const sh = m.harvestSnapshot({ id: 61, content: '<p>题干六十一</p>', analysis: '', analysis_shadow: '<p>收起态的解析正文</p>' }, 'error');
  ok(sh && sh.analysis.indexOf('收起态的解析正文') >= 0,
    'T65 站点收起解析时正文在 analysis_shadow，快照不许抓成一份天生残缺的');
  eq(m.snapState(61), 'full', 'T65 抄回正文之后这一份就该判成齐');
})();

(function t66() {
  const a = mkStore({ qSrc: { a: 'error' }, qSrcAt: 100 });
  build({ store: a, disk: JSON.stringify({ qSrc: { a: 'favorite', b: 'error' }, qSrcAt: 200 }) }).mergeConcurrent(a);
  eq(a.qSrc, { a: 'favorite', b: 'error' },
    'T66 在列名单以核对时间新的一份为准——别的标签剪掉的这里跟着剪，否则剪了又被并回来');
  eq(a.qSrcAt, 200, 'T66 时间戳跟着名单一起走');

  const b = mkStore({ qSrc: { a: 'error', c: 'both' }, qSrcAt: 300 });
  build({ store: b, disk: JSON.stringify({ qSrc: { a: 'favorite' }, qSrcAt: 200 }) }).mergeConcurrent(b);
  eq(b.qSrc.a, 'error', 'T66 旧的核对结果不许把新的覆盖回去');
  eq(b.qSrc.c, 'both', 'T66 新者那份没有的条目也不被对方抹掉');

  const c = mkStore({ qSrc: { a: 'error' } });
  build({ store: c, disk: JSON.stringify({ qSrc: { a: 'favorite', b: 'error' } }) }).mergeConcurrent(c);
  eq(c.qSrc.a, 'both', 'T66 两边都没有核对时间（旧库）时退回原来的并集与升 both');
  eq(c.qSrc.b, 'error', 'T66 旧库合并仍把对方多出来的条目并进来');

  const idx = { 7: '言语理解' };
  eq(build({}).sweepFacets([{ id: 7, _src: 'error', exam_point: 7 }], [{ id: 7, _src: 'favorite', exam_point: 7 }], idx)
    .srcs['7'], 'both', 'T66 同一题在两趟里落在不同列表 → 当场并成 both，别让后一趟覆盖前一趟');

  const mm = build({});
  eq(mm.SITE_LIST_CAP, 4800, 'T66 按日期那一趟最多摊到的题数');
  ok(/if \(page >= 49\)/.test(fnSource('pagedFetch')),
    'T66 这条上限与 pagedFetch 的翻页闸门配着看：改了那边不改这里，核对会把没跑全的一趟当成全量去剪名单');
})();

async function t67() {
  const store = mkStore({
    notes: { 51: { text: '甲', subject: 0 }, 52: { text: '乙' }, 53: { text: '丙' } },
    snaps: { 53: { id: 53, content: '题干五十三', analysis: '解析五十三' } },
    qSrcAt: 1
  });
  const ctx = {
    store: store, api: [], warns: [], status: [], saved: 0, calls: [],
    apiResult: function () { return Promise.resolve({ id: 51, question: '题干五十一', explanation: '解析五十一' }); }
  };
  const m = build(ctx);
  eq(m.faceTypesOf(51), ['0'], 'T67 笔记上记过科目就只打那一科，不必两科都试');
  eq(m.faceTypesOf(52), ['0', '1'],
    'T67 认不出科目时行测与公专各试一次——URL 那个参数在别的控制器里是分类 id，不能拿它当科目');
  eq(m.faceGapIds().map(String), ['51', '52'], 'T67 待补 = 题本成员里快照不齐的那批，齐的五十三不在内');
  eq(m.faceGapIds(['52', '51']).map(String), ['52', '51'],
    'T67 当前这一页排在队首——用户正看着的那 20 题不该排在别人后面');
  const snap = await m.fillOneFace(51);
  ok(snap && String(snap.id) === '51', 'T67 按题目 ID 打站点那道题的解析接口，能把题面要回来');
  eq(store.snaps['51'].analysis.indexOf('解析五十一') >= 0, true, 'T67 要回来的解析进快照');
  eq(store.snaps['51'].from, 'book', 'T67 快照记下是题本这一路补的');
  ok(ctx.api[0][0].indexOf('/api/v2/tiku/0/51/analysis') > 0, 'T67 请求打的是站点那道题的解析接口，科目在路径里');
  eq(m.snapState(51), 'full', 'T67 补回解析之后这一份该判成齐');
  eq(m.faceGapIds().map(String), ['52'], 'T67 补回来的那题从队列里下去，同一题不许要两遍');
  const card = m.questionCardHtml({ id: 54, content: '', opt: [], analysis: '' }, { noSnap: 1, excerpt: '引文' });
  ok(card.indexOf('正在自动向站点要') >= 0, 'T67 缺题面的卡片写的是「正在自动要」，不再让人去点一颗按钮');
  ok(m.questionCardHtml({ id: 54, content: '题干', opt: [], analysis: '' }, { partSnap: 1 }).indexOf('正在自动再要一次') >= 0,
    'T67 缺解析的卡片同理');
  ok(fnSource('faceGapIds').indexOf('.slice(0, FACE_CAP)') >= 0,
    'T67 一轮最多补 FACE_CAP 题，不许把几百个请求一口气发出去');
  ok(fnSource('autoFillFaces').indexOf('setTimeout(step, 180)') >= 0,
    'T67 一题一个请求之间要留间隔——改成直接 step() 就是把 300 个请求连发出去');
  ok(fnSource('autoFillFaces').indexOf('renderBookList();') >= 0, 'T67 补完当场重主题本，不然补回来的题面看不见');
  ok(fnSource('renderBookList').indexOf('autoFillFaces(pageIds)') >= 0,
    'T67 接线：摊开题本就自动补——那颗手动按钮删掉之后，没人调它等于没人补题面');
  ok(fnSource('autoFillFaces').indexOf('if (faceFilling') >= 0, 'T67 同一时刻只跑一轮：补完会重主题本，不挡就自己叠自己');
  ok(fnSource('faceGapIds').indexOf('faceTried') >= 0 &&
     fnSource('autoFillFaces').indexOf('faceTried[String(id)] = 1') >= 0,
    'T67 要不回来的题要记进那张表：补完重排队列时不认它，那批题就把自动补齐变成了无限循环');
  eq(m.FACE_CAP, 300, 'T67 一轮的上限');
}

(function t68() {
  ok(fnSource('setView').indexOf('bookViewOn = false') >= 0 && fnSource('setBookView').indexOf('viewOn = false') >= 0,
    'T68 机考助手与题本两块视图互斥：开一块必关另一块，不许同时摊在页面上');
  ok(fnSource('applyChrome').indexOf('bookViewEl.hidden = !bookViewOn') >= 0,
    'T68 题本那块视图与助手视图在同一次壳更新里收放');
  ok(fnSource('setStatus').indexOf('activeStatus()') >= 0 && fnSource('activeStatus').indexOf('bookViewOn') >= 0,
    'T68 状态栏跟着当前块走：自动补齐题面的进度要看得见，不是写进藏起来的助手视图里');
  ok(fnSource('renderAside').indexOf('dataset.gthHtml === html') >= 0,
    'T68 那一栏写之前先比内容——它在 400ms 观察器的射程里，无脑重写会喂出往复');
  ok(fnSource('renderBookSides').indexOf('contains(document.activeElement)') >= 0,
    'T68 正在那一栏里打字时不重写它：重写会把光标和没落盘的草稿一起抹掉');
  ok(fnSource('renderBookSides').indexOf('gth-rail-in') >= 0 && fnSource('renderBookSides').indexOf('bookPageIds()') >= 0,
    'T68 笔记写在内框外那一栏（ADR 0005 决策 9 修订）：这一页摊几道题，那一栏就摆几张批注卡');
  ok(fnSource('renderBookSides').indexOf('data-book') >= 0,
    'T68 那一栏里我们自己的卡要认得出，别把站点错题页的批注卡一起删了');
  eq(raw.indexOf('gth-book-side'), -1, 'T68 视图内那块笔记面板拆干净了，不留半截');
  eq(/gth-book-main|gth-book-body/.test(raw), false, 'T68 视图内那两栏的摆法拆干净了，不留半截');
  ok(fnSource('railContent').indexOf("$('#gth-book-scroll')") >= 0,
    'T68 页边那一栏对着内滚盒子取右缘——笔记这才落在内框外，而不是挤在题目旁边');

  const m = build({});
  eq(m.BOOK_PER_PAGE, 20, 'T68 一页 20 题写成一处常量，别散在各处');
  m.setBookShown(Array.from({ length: 51 }, function (_, i) { return i + 1; }));
  m.setBookPage(1);
  eq(m.bookPageIds().length, 20, 'T68 第一页摊满 20 题');
  eq(m.bookPageTotal(), 3, 'T68 51 题分 3 页');
  m.setBookPage(2);
  eq(m.bookPageIds()[0], '21', 'T68 第二页从第 21 题起');
  m.setBookPage(3);
  eq(m.bookPageIds().length, 11, 'T68 末页摊剩下那 11 题（2026-10-08 用户口径：一页 20 题）');
  m.setBookPage(1);
  eq(m.bookPageTotal(), 3, 'T68 页数按总数折出来，末页不满也算一页');
  ok(fnSource('bookPagerHtml').indexOf('data-page') >= 0 &&
     fnSource('renderBookList').indexOf('bindBookPager()') >= 0 &&
     fnSource('bindBookPager').indexOf("button[data-page]") >= 0 &&
     fnSource('bindBookPager').indexOf('bookPage = n') >= 0,
    'T68 分页器每颗键都要真接上点击——上一版只有 HTML 没有监听，翻页是死的');
  ok(/pageIds\.map\(function \(id, i\)/.test(fnSource('renderBookList')) &&
     fnSource('renderBookList').indexOf('bookCardHtml(id, (bookPage - 1) * BOOK_PER_PAGE + i + 1)') >= 0,
    'T68 接线：一页那 20 题一起进列表，题号按整本连续折算（站点错题页就是这个算法，翻页后从 21 起）');
  ok(/\.gth-book-scroll\{[^}]*overflow-y:auto/.test(raw),
    'T68 中间那一列带内部滑动栏，跟错题页那口盒子一个形状');
  ok(fnSource('bookCardHtml').indexOf('anaToggle: 1') >= 0, 'T68 接线：题本卡片真的走解析收起那条路');
  ok(fnSource('bindAnaToggle').indexOf('[data-act="ana"]') >= 0 &&
     fnSource('bindAnaToggle').indexOf('classList.toggle(') >= 0 &&
     fnSource('bindBookList').indexOf('bindAnaToggle(') >= 0 &&
     fnSource('bindQuiz').indexOf('bindAnaToggle(') >= 0,
    'T68 展开解析只切 class 与 hidden，不重写卡片；题本与重练报告两边都走这同一份绑定');
  eq(/gth-bf-(mock|mast|snap)/.test(raw), false,
    'T68 题本就三档筛选，上一版那五档里的来源 / 掌握状态 / 快照齐不齐不许借这一轮回来——' +
    '前两个在笔记那一屏已有入口，最后一个是内部概念，摆出来只会让人猜它是什么意思');
  ok(raw.indexOf("var bookFilter = { subj: '', mod: '', q: '' };") >= 0,
    'T68 三档的状态就这一处声明：科目、模块、关键词，不多不少');
  ok(fnSource('bookSearchHit').indexOf('stripHtml(') >= 0,
    'T68 搜关键词前先剥标签：题面是 HTML，不剥的话搜一个「p」能命中每一题');
  ok(fnSource('bookFilteredIds').indexOf('bookSearchHit(id, q)') >= 0 &&
     fnSource('bookFilteredIds').indexOf('(!q ||') >= 0,
    'T68 关键词要读题面，比科目与模块贵一档——只在真输了字的时候才跑这一路');
  ok(fnSource('renderBookList').indexOf('bookFilteredIds()') >= 0,
    'T68 接线：那一屏真的按三档筛过，不是只写了函数没人调');
  ok(raw.indexOf("bookSearchEl.addEventListener('input', debounce(") >= 0,
    'T68 搜索框带 debounce：它每敲一键就重主题本 + 重画页边那一栏，不节流就是边打字边整屏抖');
  ok(fnSource('renderBookList').indexOf('rb.hidden = !bookNarrowed()') >= 0 &&
     fnSource('clearBookFilter').indexOf("el.value = ''") >= 0,
    'T68 「清空筛选」只在真筛了的时候露出来，点下去三档一起归零——留着一颗永远灰的键就是骗人');
  ok(fnSource('renderBookList').indexOf('data-act="unfilter">清空筛选') >= 0 &&
     fnSource('renderBookList').indexOf('addEventListener(\'click\', clearBookFilter)') >= 0,
    'T68 筛到空了那一屏既画出出口也接上它：只说「没有题符合」而不给清空，用户只能去逐个还原下拉');
  ok(fnSource('bookFilteredIds').indexOf('renderBookFilterMods(ids)') >= 0,
    'T68 模块下拉的选项由这一趟现算：不填它就是一颗永远只有「全部模块」的空下拉');
  ok(fnSource('bookCardHtml').indexOf('note: false') >= 0,
    'T68 题本卡片不再自带笔记框——笔记在内框外那一栏，卡片只摊题面');
  ok(raw.indexOf("bookViewEl.className = 'gth-view zero-flex-1'") >= 0,
    'T68 题本视图与助手视图一样要撑满内容列——漏掉 zero-flex-1 就是用户报的「题目太窄」');
  ok(/\.gth-qcard\{background:#fff;border:none;border-radius:0;padding:0;margin:0;max-width:none/.test(raw),
    'T68 卡片外壳只留一份定义（.gth-qcard）：max-width 与 auto 外边距是「题目太窄」的两半，border 与圆角和左色条是' +
    '「和错题页不一样」的那一半——错题页上每题就是白底无框，靠右下角那条线分隔；题本与重练报告共用这一份');
  ok(fnSource('bookCardHtml').indexOf("cls: 'gth-qcard gth-book-card'") >= 0 &&
     fnSource('reportHtml').indexOf("cls: 'gth-qcard'") >= 0,
    'T68 接线：题本与重练报告两张卡片都真的挂上那一份公共外壳，不是各自留着旧的外框');
  ok(fnSource('jumpToBook').indexOf('setBookView(true)') >= 0,
    'T68 从笔记跳到题本要先打开那一块，不是去找已经不存在的第四个 tab');
  ok(fnSource('jumpToBook').indexOf('BOOK_PER_PAGE') >= 0, 'T68 定位到某道题要按每页 20 题折算页码');
  eq(raw.indexOf('data-tab="book"') >= 0, false, 'T68 题本不再是助手视图里的一个 tab，那条分支要拆干净');
  eq(raw.indexOf('bookPaneOn') >= 0, false, 'T68 按 pane 显隐判「题本开着」那套已作废，不留半截');

  // —— 2026-10-08 第二轮：题本对齐错题页（用户口径「头部就这么几条信息、解析展开在右下角、不要筛选」）
  ok(fnSource('bookCardHeadHtml').indexOf('class="gth-qbar"') >= 0,
    'T68 题本头部直接复用错题页那行小条的类名，不是又造一套长相');
  ok(fnSource('bookCardHeadHtml').indexOf('gth-badge') >= 0 &&
     fnSource('bookCardHeadHtml').indexOf('gth-qbar-note') >= 0 &&
     fnSource('bookCardHeadHtml').indexOf('gth-qbar-copy') >= 0,
    'T68 头部就那四条：答错次数、掌握状态、笔记、复制题目');
  eq(/gth-pill|gth-book-act|data-act="mast"|data-act="jump"/.test(fnSource('bookCardHtml') + fnSource('bookCardHeadHtml')), false,
    'T68 科目／模块／模考收录那几枚标签与「x 天前动过」都不进头部，底部三颗按钮一并撤掉——错题页没有的东西题本不摆');
  ok(fnSource('bookCardHtml').indexOf('mine:') < 0,
    'T68 题本卡片不再输出「你的答案／正确答案」那一行：错题页靠圆圈颜色说这件事，再补一行字就是同一件事说两遍');
  ok(fnSource('renderBookList').indexOf('refreshBadges()') >= 0,
    'T68 接线：题本头部的答错次数与掌握状态由 refreshBadges 填——只有类名没有这一句，摊出来是四片空白');
  ok(fnSource('bindBookList').indexOf('bindQbar(') >= 0 && fnSource('injectListUI').indexOf('bindQbar(') >= 0,
    'T68 两边那行小条共用一份绑定，题本里的「笔记」与「复制题目」才不是死的');
  ok(fnSource('bindQbar').indexOf('bar.dataset.gthBind') >= 0,
    'T68 那行小条绑过一次就不再绑：题本卡片会被重主题本之外的事件再走一遍绑定路径，叠上就是点一下复制两次');
  ok(/gth-bf-|readBookFilter|bookNarrowed/.test(raw),
    'T68 题本顶部的三档筛选（科目 / 模块 / 关键词）与它的状态函数都在——2026-10-08 用户改判加回来，' +
    '但只此三档，见上面那条 miss');
  const circ = m.questionCardHtml({ id: 7, content: '题干', analysis: '', correct_answer: ['A'],
    opt: [{ label: 'A', content: '甲' }, { label: 'B', content: '乙' }] }, { circle: 1, picked: ['B'], no: 3, note: false });
  ok(circ.indexOf('gth-circle right') >= 0 && circ.indexOf('gth-circle wrong') >= 0,
    'T68 圆圈模式按「正确绿／错选红」上色');
  eq(/（正确）|（你选的）/.test(circ), false, 'T68 圆圈模式下不再追加那两个文字后缀');
  ok(circ.indexOf('gth-seq-box') >= 0 && circ.indexOf('>3<') >= 0,
    'T68 题号是站点那个方块，数字用调用方给的连续序号');
  ok(/\.gth-seq-box\{width:25px;height:25px[^}]*background:#b3c8e9/.test(raw),
    'T68 题号方块的尺寸与底色照站点 .sequence-box，不自己定');
  ok(/\.gth-circle\.right\{border:5px solid #0c0\}/.test(raw) && /\.gth-circle\.wrong\{border:5px solid red\}/.test(raw),
    'T68 选项上色的两个色值照站点 .circle.right/.wrong');
  ok(/\.gth-btext:after\{[^}]*border-top:10px solid #8c8c8c/.test(raw) &&
     /\.gth-btext\.on:after\{border-top:none;border-bottom:10px solid #8c8c8c\}/.test(raw),
    'T68 那一行末尾的三角照站点：未展开朝下、已展开朝上，靠切 class 翻面不重画');
  ok(fnSource('injectListUI').indexOf('autoReconcile()') >= 0 &&
     fnSource('renderBookList').indexOf('autoReconcile()') >= 0,
    'T68 自动核对两条路都得接上：摊开错题页走 injectListUI，而题本视图开着时它会早退（bookViewOn 那道门），' +
    '空态那一路只能自己调——少一条就是题本永远停在「正在核对」');
  ok(fnSource('autoReconcile').indexOf('reconcileTried') >= 0 && fnSource('autoReconcile').indexOf('reconciled()') >= 0,
    'T68 自动核对只试一次：它挂在 400ms 观察器的射程里，失败就重试等于每半秒打一遍站点接口');
  eq(fnSource('renderBookList').indexOf('data-act="check"') >= 0, false,
    'T68 题本空态不再摆一颗「与站点核对」按钮');
  ok(fnSource('focusNote').indexOf("a.dataset.book === '1'") >= 0,
    'T68 题本里点「笔记」要认自己那张批注卡：那一栏同时挂着错题页的卡（站点内容只是藏起来没拆），拿第一张会编辑到别人的卡');
  eq(fnSource('focusNote').indexOf('setBookView(false)') >= 0, false,
    'T68 题本里点「笔记」不再关掉题本——笔记那一栏本来就在这一块视图右边');
})();

(function t69() {
  // —— 2026-10-08 第二轮：重练还原站点专项练习页（用户口径「贴近站点原本的体验」，图2 答题态 / 图3 解析态）
  ok(/\.gthq-header\{background:#2178db/.test(raw) && /\.gthq-hc\{width:1000px[^}]*height:60px/.test(raw),
    'T69 头部是站点那条蓝带（#2178db、60px、1000px 居中列），不是又一条灰白工具条');
  ok(/\.gthq-sheet-col\{width:230px[^}]*border-right:1px solid #e4e4e4/.test(raw),
    'T69 答题卡回到左边那一栏：宽 230px、右边一道 #e4e4e4，照站点 .sheet-box');
  ok(/\.gthq-btn\{height:30px;line-height:30px;padding:0 30px;border-radius:5px[^}]*background:#f97217/.test(raw),
    'T69 交卷键的几何照站点 .jiaojuan a（AGENTS 记过的那三条），不自己定尺寸');
  ok(/\.gthq-cell i\{display:block;width:27px;height:27px/.test(raw),
    'T69 答题卡格子 27px 见方，照站点 .operation-btn li span');
  ok(raw.indexOf('.gthq-cell.bad i{background:#d77e46') >= 0 &&
     raw.indexOf('.gthq-cell.done i,.gthq-cell.right i{background:#2178db') >= 0,
    'T69 已答蓝、答错 #d77e46 两个色值照站点，不是自家那套语义色');
  ok(raw.indexOf('.gthq-cell.miss i') < raw.indexOf('.gthq-cell:hover i,.gthq-cell.cur i'),
    'T69 当前题那一格必须排在对错色之后：同特异性后者胜出，写反了就看不出此刻在哪一格');
  eq(fnSource('reportHtml').indexOf('quiz.list.map'), -1,
    'T69 交卷后一屏一题（照站点解析页），不再把整卷摊成一长页');
  ok(fnSource('reportHtml').indexOf('quiz.list[quiz.idx]') >= 0 &&
     fnSource('doingHtml').indexOf('quiz.list[quiz.idx]') >= 0,
    'T69 答题态与复盘态都只出当前那一题');
  ok(fnSource('stepIdx').indexOf('navIdxs()') >= 0 && fnSource('goIdx').indexOf('navIdxs()') >= 0 &&
     fnSource('navIdxs').indexOf('onlyWrong') >= 0,
    'T69 上一题/下一题与答题卡点击共用同一份导航序列：勾了「只看错题」还能 F5 跳到做对的题，那就是假只看');
  ok(fnSource('bindQuiz').indexOf('gth-onlywrong') >= 0 &&
     fnSource('bindQuiz').indexOf('quiz.onlyWrong = ow.checked') >= 0 &&
     fnSource('bindQuiz').indexOf('goIdx(quiz.idx)') >= 0,
    'T69 那颗复选框改完状态要立刻按新序列重落当前题：只改标志位或只藏卡片，画面上看着"只看错题"生效了，F5 一按就漏');
  const kd = raw.slice(raw.indexOf("document.addEventListener('keydown'"));
  ok(/e\.key === 'F4' \|\| e\.key === 'F5'\)\s*\{\s*e\.preventDefault\(\)/.test(kd) &&
     kd.indexOf('stepIdx(e.key === ') >= 0,
    'T69 F4/F5 真的绑上并在同一句里拦下默认行为：键面上写着这两个键，按了不动就是骗人，而 F5 不 preventDefault 会把整页刷掉');
  ok(fnSource('quizHeadHtml').indexOf('id="gth-pause"') >= 0 &&
     fnSource('quizHeadHtml').indexOf("quiz.limitSec ? '<button") < 0,
    'T69 暂停键无条件在：重练的时钟是我们自己那一台表，暂停的意义是「离开一会儿不算进用时」，' +
    '跟会不会到点交卷无关——不限时也该能停（2026-10-08 用户改判，撤掉「没设限时不摆」那一版口径）');
  ok(fnSource('tickQuiz').indexOf('if (quiz.paused) return;') >= 0 &&
     fnSource('tickQuiz').indexOf('quiz.runMs += dt;') >= 0,
    'T69 暂停那一段根本不累加，所以剩余时间与已用时间同时停得住；反过来给已用时间装阀门就是往统计上报一份少一截的数');
  ok(fnSource('tickQuiz').indexOf('quiz.spent[cur.id]') >= 0,
    'T69 每秒把这一段记在当前那一题头上：重练一屏一题，归属没有歧义，才谈得上复盘时显示本题用时');
  ok(fnSource('reportHtml').indexOf('time: spent >= 1000') >= 0 &&
     fnSource('questionCardHtml').indexOf('gthq-qtime') >= 0,
    'T69 每题用时只在复盘那一屏显示，且不足一秒的不显示「00:00」——刚切进来就交卷的题该是空白');
  ok(fnSource('quizStatsHtml').indexOf('正确率') >= 0 && fnSource('quizStatsHtml').indexOf('未做') >= 0 &&
     fnSource('quizHeadHtml').indexOf('quizStatsHtml()') >= 0,
    'T69 交卷后头部一次给全五项（得分 / 正确率 / 错题 / 未做 / 用时）：一屏一题之后没有整页可扫，统计只能靠这一行');
  eq(/\.gthq-content\{[^}]*max-width:770px/.test(raw), false,
    'T69 内容列不再限死 770px 居中：用户报「重练界面没有铺满全屏」，那一档宽度是照站点 1000px 居中列抄的，但重练是全屏模态，没有站点那两栏在旁边');
  eq(/\.gthq-body\{[^}]*justify-content:center/.test(raw), false, 'T69 两栏也不再整体居中——居中会把答题卡推到屏幕中间');
  ok(fnSource('tickQuiz').indexOf('submitQuiz(true)') >= 0,
    'T69 到点自动交卷照站点那条（countdown<=0 就 submitAction），限时才有意义');
  ok(fnSource('submitQuiz').indexOf('if (!auto && un > 0 && !confirm(') >= 0,
    'T69 只有手动交卷才问「还有 N 题未作答」：自动那一支弹框会挡住这一屏，人不在就永远停在未交卷');
  ok(fnSource('toggleAnswer').indexOf('renderQuiz()') < 0 &&
     fnSource('toggleAnswer').indexOf('paintChoices()') >= 0 && fnSource('toggleAnswer').indexOf('paintCells()') >= 0,
    'T69 选一个选项只改圈与格子，不整屏重写：重写会把内容列的滚动位置与刚展开的解析一起收回');
  ok(fnSource('minLimit').indexOf('#gth-min') >= 0 &&
     fnSource('startQuiz').indexOf('limitSec: limitSec || 0') >= 0,
    'T69 限时那一栏真的走到 startQuiz 的状态里，不是读了就扔');
  eq((raw.match(/, minLimit\(\)\);/g) || []).length, 2,
    'T69 组卷那一路与「重练这套」那一路都要传限时，漏一条就是其中一条路永远不限时');
  eq(/题目ID/.test(fnSource('doingHtml') + fnSource('reportHtml')), false,
    'T69 重练屏上不再出现「题目ID 12345」这种只有我们自己看得懂的一行');
  ok(fnSource('bindQuiz').indexOf('bindNoteAreas(quizEl)') >= 0 &&
     fnSource('bindQuiz').indexOf('refreshQuizHl()') >= 0,
    'T69 接线：改成复盘一屏一题之后，卡片里的笔记区与划线清单还接得上（决策 35 那份组件复用不能因改版断线）');
  ok(fnSource('reportHtml').indexOf('data-hls') >= 0 && fnSource('reportHtml').indexOf('questionCardHtml(') >= 0,
    'T69 复盘那一屏走公共卡片渲染器，划线落点在 data-hls 那一块');
  ok(fnSource('questionCardHtml').indexOf('o.kind ?') >= 0 &&
     fnSource('doingHtml').indexOf('gthq-kind') >= 0,
    'T69 题号右边那一行写题型（站点就是「（单选）」），复盘态用公共卡片的同一个槽位');
  ok(fnSource('quizFootHtml').indexOf('gth-mark') >= 0 && fnSource('bindQuiz').indexOf('toggleMark(') >= 0,
    'T69 底部那颗「标记」接得上：站点那一屏有这颗键，画出来不接就是假还原');
  ok(fnSource('cellCls').indexOf('stressed') >= 0 &&
     fnSource('paintCells').indexOf('cellCls(') >= 0 && /\.gthq-cell\.stressed:after/.test(raw),
    'T69 标过的题在答题卡那一格上画红角（照站点 .stressed .stress），且点「标记」后那一格真的重画——不然标记看不见');
  const m69 = build({});
  const plain = m69.questionCardHtml({ id: 8, content: '题干', analysis: '', correct_answer: ['A'],
    opt: [{ label: 'A', content: '甲' }, { label: 'B', content: '乙' }] },
  { mine: 'B', mineOk: false, picked: ['B'], note: false });
  ok(plain.indexOf('gth-opt-plain') >= 0 && /（正确）|（你选的）/.test(plain) === false &&
     plain.indexOf('color:#16a34a') < 0,
    'T69 复盘那一屏的选项是纯文字（照站点解析页那一屏）：谁对谁错只在下面那一行说，不给整行上色、也不在文字后追后缀');
  const rpAt = raw.indexOf('var refreshPageUI = debounce(function () {');
  ok(rpAt >= 0 &&
     raw.indexOf('if (!quizEl.hidden) return;', rpAt) >= 0 &&
     raw.indexOf('if (!quizEl.hidden) return;', rpAt) < raw.indexOf('prunePageRefs();', rpAt),
    'T69 重练那一屏开着时观察器整轮早退：那是盖住全页的模态，底下的注入与轨道谁也看不见，而时钟每秒写一次就会白排一轮');
  ok(fnSource('setClockText').indexOf('nodeValue') >= 0 &&
     fnSource('tickQuiz').indexOf('setClockText(el,') >= 0,
    'T69 时钟只改文本节点的 nodeValue：用 innerHTML 每秒重写一次头部，就是每秒给 body 排一轮 childList 变更');
  ok(fnSource('quizSheetHtml').indexOf('seq.map(') >= 0 &&
     fnSource('quizSheetHtml').indexOf('quiz.list.map') < 0,
    'T69 答题卡那一列由那份导航序列生成：勾了「只看错题」还画整张答题卡，就是只筛了内容没筛答题卡');
  ok(fnSource('goIdx').indexOf('quiz.onlyWrong = false') >= 0 && fnSource('goIdx').indexOf('toast(') >= 0,
    'T69 一道错题都没有时收回勾选并说一句：否则界面停在第一题（做对的那道），看着像那颗复选框坏了');
})();

(function t70() {
  // —— 2026-10-08 第三轮：公式图与文字等高（用户报「图片显示大小失调」）。
  //    10-09 第二轮：只认「行内」不够——用户报的那枚是独占一段、前后顶着 <br> 的两行公式
  //    （真页面实测 intrinsic 1221x251 / 434x165，正文行高 28），于是加「解析里的细长条」这一路，
  //    并把上限从 1.7em 放宽到 3em + 340px（1.7em 会把 247x144 那种分式压成 41x24，糊到看不清）。
  //    10-09 第三轮：宽度比当主判据这条走不通——竖着的柱状图（180x520）与横着的多行表格
  //    （650x226）都会被它压成一行高，而它们缩掉就没法看了。改成**文字语义定角色、形状只兜底**：
  //    公式是句子的一部分（等号后面、单位前面），图是句子指向的东西（如下图所示）。
  //    10-11 那一轮把「缩到多少」从封顶改成定高、从「本来多高」改成「占几行」，
  //    并把领起词整条锚到句尾——「如图所示，边长为50米…」那句在段首，却把同段后面
  //    每一枚行内式子都判成了图（那一枚 293x62 就这么原样摆在 14px 正文中间）。
  //    这一块的逐枚台架在 tools/gth_img_dom.js（真 DOM，28+14 格），它也在突变闸门里了。
  const m = build({});
  const src = blankLiterals.comments(lf(raw));
  const txt = (t) => ({ nodeType: 3, nodeValue: t });
  const tag = (name, t) => ({ nodeType: 1, nodeName: name, textContent: t == null ? '' : t });
  // pic 造一枚够 imgFitRole 走完全程的图：closest 认容器，parentElement 供 imgLeadNearby 往上找。
  const pic = (w, h, host, prev, next, prevBlock) => {
    const el = {
      nodeType: 1, nodeName: 'IMG', textContent: '',
      naturalWidth: w, naturalHeight: h,
      previousSibling: prev || null, nextSibling: next || null,
      parentElement: null
    };
    el.closest = (sel) => (host && sel.indexOf(host) >= 0 ? { host: 1 } : null);
    if (prevBlock !== undefined) {
      const box = { nodeType: 1, nodeName: 'P', previousSibling: prevBlock, parentElement: null };
      box.closest = (sel) => (sel.indexOf('gthq-') >= 0 ? { host: 1 } : null);
      box.parentElement = { closest: () => ({ host: 1 }) };
      el.parentElement = box;
    }
    return el;
  };
  const ANA = m.IMG_FORMULA_HOST, OPT = m.IMG_FRACTION_HOST, MAT = m.IMG_MATERIAL_HOST;
  const STEM = '.gthq-stem';   // 题干不在上面任何一份名单里（它走「只认竖式」那一档的宿主名）

  // —— 第一问：文字语义只答「式子还是图」（缩到几行是第二问，别混在这里）——
  eq(m.imgTextRole(pic(0, 0, ANA, txt('如下图所示：'))), 'figure',
    'T70 「如下图所示：」领起的图保持原尺寸——几何上它可能又高又窄，但它是图不是式子');
  eq(m.imgTextRole(pic(0, 0, ANA, txt('如下表：'))), 'figure',
    'T70 「如下表：」同理，解析里的多行表格（650x226）不再被细长条筛子压成一行高');
  eq(m.imgTextRole(pic(0, 0, ANA, txt('如图所示，边长为50米的等边三角形ABC是学校操场上的一块闲置区域，其中'), txt('，'))), 'math',
    'T70 段首那句「如图所示」管不到段中：领起词必须贴在图前面，否则同段每一枚行内式子都被放成原样（用户 10-11 那道题的第一枚）');
  eq(m.imgTextRole(pic(0, 0, ANA, txt('平均每个月的同比增量='))), 'math',
    'T70 等号收尾说明后面接的是式子');
  eq(m.imgTextRole(pic(0, 0, ANA, txt('计算如下：'), txt('故答案选B。'))), 'math',
    'T70 冒号收尾 + 后半句续写，也是式子');
  eq(m.imgTextRole(pic(0, 0, ANA, txt('增长率='), txt('，增长最快。'))), 'math',
    'T70 247x144 那一档横方公式：靠等号收尾定角色，不靠宽高比');
  eq(m.imgTextRole(pic(0, 0, OPT, txt('8人参加演讲比赛，抽签决定参赛顺序，有'), txt('种情况，最多的是？'))), 'math',
    'T70 两侧都顶着成句的话，它在句子中间，是分式');
  eq(m.imgTextRole(pic(0, 0, ANA, txt('增长量=现期量-基期量，得'), txt('亿元。'))), 'math',
    'T70 单位开头（亿元）说明这句是接着式子说的');
  eq(m.imgTextRole(pic(0, 0, ANA, txt('见'), txt('可知增长最快。'))), null,
    'T70 两边字都不成句时这一层不表态：放宽到「各有一个字就算」会把 800x400 的统计表压成 78x39（10-11 实测对照过）');
  eq(m.imgTextRole(pic(0, 0, ANA, null, null)), null,
    'T70 前后都没有文字时这一层不表态，交给形状兜底');
  eq(m.imgTextRole(pic(0, 0, ANA, tag('BR', ''))), null,
    'T70 <br> 与空元素不算文字，也不抛错');

  // —— imgNeighborText：跳过 <br> 与内联包裹，继续往外找 ——
  eq(m.imgNeighborText(pic(0, 0, ANA, txt('有'), null, null), -1).replace(/\s/g, ''), '有',
    'T70 紧邻文本节点照取');
  eq(m.imgNeighborText({ previousSibling: tag('BR', ''), nextSibling: tag('SPAN', '平均每个月的同比增量=') }, 1),
    '平均每个月的同比增量=',
    'T70 <br> 跳过去继续找：编辑器爱把字包在 <span> 里，只认 nodeType 3 的紧邻兄弟会漏一半排版');
  eq(m.imgNeighborText({ previousSibling: txt('有'), nextSibling: tag('BR', '') }, -1), '有',
    'T70 反方向同理：<br> 在前侧也不挡住后面那段字');
  eq(m.imgNeighborText({}, -1), '', 'T70 没有兄弟时返回空串，不抛错');

  // —— 第二问：该缩的这枚占几行。三道门来自 10-11 那道题的 11 枚真图（从站点抓下来读的尺寸）：
  //    单行式子 62–76 高（ratio 2.9–10）、分式 142 高（ratio 0.67–1.44）、两行宽式 251 高、
  //    竖式 434x165（ratio 2.6，前两道门放行，第三道门收回来）——
  //    已知代价：120–200 高而 ratio<3 的单行式子会被给到两行高，比一行大 19px。
  eq(m.imgSizeRole(pic(293, 62, ANA)), '1line', 'T70 单行式子（DE⊥AB 那枚 293x62）与正文同大');
  eq(m.imgSizeRole(pic(630, 64, ANA)), '1line', 'T70 宽的单行式子（∠ABC=ACB=60°，630x64）也还是一行');
  eq(m.imgSizeRole(pic(95, 142, ANA)), '2line', 'T70 分式（选项 C 那枚 10/3，95x142）压到一行就糊，给两行高');
  eq(m.imgSizeRole(pic(205, 142, ANA)), '2line', 'T70 带等号的分式（15/3=5，205x142）同理');
  eq(m.imgSizeRole(pic(1221, 251, ANA)), '2line', 'T70 两行宽式超高那道门收它');
  eq(m.imgSizeRole(pic(434, 165, ANA)), '2line', 'T70 竖式横得开（ratio 2.6）但也两行——第三道门专收这一格');
  eq(m.imgSizeRole(pic(120, 40, ANA)), '1line', 'T70 句中一枚小图（360° 那类）本来就不到一行半');
  eq(m.imgSizeRole(pic(0, 0, ANA)), '', 'T70 还没加载完拿不到 intrinsic 尺寸，这一轮不动它（load 事件会再扫一遍）');
  eq(m.imgSizeRole(pic(110, 60, ANA)), '2line',
    'T70 110x60 判两行：定高档把它压到 39px，封顶档（max-height）对这种本来没到顶的图是空操作——旧口径「判对了还是大」就是这么来的');

  // —— 两问接在一起：全程判档 ——
  eq(m.imgFitRole(pic(293, 62, STEM, txt('…闲置区域，其中'), txt('，'))), '1line',
    'T70 用户 10-11 那道题的第一枚：修之前它原样 293x62 摆在 14px 正文中间');
  eq(m.imgFitRole(pic(205, 142, ANA, txt('则围栏费用是警示带费用的'), txt('倍。'))), '2line',
    'T70 「倍」开头续写认它是式子，形状说它两行');
  eq(m.imgFitRole(pic(1221, 251, ANA, null, null)), '2line',
    'T70 解析里独占一段的两行裸公式（真页面实测 1221x251）认得出——用户 10-09 报的第一枚，走形状兜底');
  eq(m.imgFitRole(pic(434, 165, ANA, null, null)), '2line', 'T70 解析里的竖式（434x165）同样走形状兜底');
  eq(m.imgFitRole(pic(110, 150, OPT, null, null)), '2line',
    'T70 选项里竖着的分式（用户 10-09 第二张截图：整张选项就是一张 1/16 图）认得出');
  eq(m.imgFitRole(pic(650, 200, OPT, null, null)), '',
    'T70 选项里横着的原样留着：那里放一张统计表是常事，只有竖着的才一定是分式');
  eq(m.imgFitRole(pic(650, 226, ANA, null, null, null)), '2line',
    'T70 裸的多行表格仍会走形状压掉——这一格是已知的取舍，靠点开看原尺寸兜底（见 AGENTS）');
  eq(m.imgFitRole(pic(650, 226, ANA, null, null, txt('如下表：'))), '',
    'T70 但只要上一段有领起词，就不压：多行表格与竖柱状图靠这一条躲开形状筛子');
  eq(m.imgFitRole(pic(180, 520, ANA, null, null, txt('如下图所示：'))), '',
    'T70 解析里竖着的柱状图（180x520）不再被当成竖式压掉——上一段「如下图所示：」说了算');
  eq(m.imgFitRole(pic(300, 247, STEM, null, null, txt('则围栏费用是警示带的多少倍？'))), '',
    'T70 几何图（300x247）没有领起词也保住：横方的图在题干里走形状兜底那一档');
  eq(m.imgFitRole(pic(1017, 153, MAT, null, null)), '',
    'T70 材料里的图先于一切判据豁免：那是题目本身，一个像素都不许动');
  eq(m.imgFitRole(pic(0, 0, ANA, null, null)), '',
    'T70 没加载完拿不到 intrinsic 尺寸，这一轮先不动它（load 事件会再扫一遍，见下面那条接线）');
  eq(m.imgFitRole({}), '', 'T70 连 closest 都没有时不抛错');

  // —— 接线：判出来的档要真的落到类名上，类名要真的带定高 ——
  ok(fnSource('fitImgs').indexOf("'gth-img-1line'") >= 0 && fnSource('fitImgs').indexOf("'gth-img-2line'") >= 0,
    'T70 两档各挂各的类名：只在函数里判对、没写进 classList，界面就还是原样');
  ok(src.indexOf('img.gth-img-1line{height:1.4em') >= 0 && src.indexOf('img.gth-img-2line{height:2.8em') >= 0,
    'T70 两档都是定高（1.4em≈20px / 2.8em≈39px，正文 14px）：写成 max-height 就压不动本来没到顶的图');
  ok(!/gth-img-\w+\{[^}]*max-height/.test(src),
    'T70 这两条里不许再出现 max-height：封顶那一档已被实测否掉两次');
  ok(src.indexOf("document.addEventListener('load'") >= 0 &&
     src.indexOf("e.target.tagName === 'IMG'") >= 0,
    'T70 load 捕获段还在：图片加载不产生 childList 变化，400ms 观察器叫不动晚加载的图');
  ok(src.indexOf('\n    fitImgs(document.body);') >= 0 && src.indexOf('\n    fitImgs(quizEl);') >= 0,
    'T70 两处都要扫：站点自己渲染的那一屏与重练那一屏，漏一处就是那一屏的图没人管' +
    '（认的是行首那一句——`fitImgsSoon` 里也有一处同名调用，光数子串会把删掉调用点判成还在）');
  ok(fnSource('fitImgs').indexOf('dataset.gthFit === role') >= 0,
    'T70 比对后再写 class：它在 400ms 观察器的射程里，无脑重写就是每轮给 body 喂一次属性变更');
  ok(src.indexOf('openImgZoom(t.getAttribute') >= 0,
    'T70 被缩过的图要绑得上「点开看原图」——那是认错时唯一没把人堵死的退路');
  ok(fnSource('openImgZoom').indexOf("addEventListener('click', closeImgZoom)") >= 0,
    'T70 看原图那一层点空白收得回：收不回就是又造了一扇关不掉的模态');
  ok(ANA.indexOf('.gthq-material') < 0 && ANA.indexOf('.gthq-stem') < 0,
    'T70 「形状兜底也收」那一档只有解析、笔记与页边：把材料与题干放进去就是把题目本身的图压小');

  // —— 常量与名单 ——
  eq(m.IMG_INLINE_TEXT, 8, 'T70 那个「八个字」的门槛写在一处，别散在判断里');
  eq(m.IMG_BOTH_SIDES, 2,
    'T70 「两边都有字就认它在句中」那个门槛：不必每边都攒够八个字（0℃ 那句前文只有五个字）');
  eq(m.IMG_FORMULA_RATIO, 2.2,
    'T70 细长条的门槛写在一处：只在文字与领起词都不说话时才轮到它判身份');
  eq(m.IMG_2LINE_RATIO, 2, 'T70 第一道门：宽不过高两倍的是叠行的（分式）');
  eq(m.IMG_2LINE_TALL, 200, 'T70 第二道门：高过 200 的是多行的（实测两行宽式 251）');
  eq(m.IMG_2LINE_MID, 120, 'T70 第三道门的下限：高过 120 才可能被疑为两行');
  eq(m.IMG_2LINE_MID_RATIO, 3, 'T70 第三道门的上限：ratio<3 才收（竖式 434x165=2.6 靠它）');
  ok(m.imgIsLead('如下图所示：') && m.imgIsLead('如下表：') && m.imgIsLead('如下饼图所示：') &&
     m.imgIsLead('如下图') && m.imgIsLead('某市主要指标统计图'),
    'T70 领起词认图表：贴到图前那一步收尾（可带标点）才算');
  ok(!m.imgIsLead('如下图可知') && !m.imgIsLead('如图可知，增速很快') && !m.imgIsLead('如下') &&
     !m.imgIsLead('如图所示，边长为50米的等边三角形，其中'),
    'T70 尾锚一条就挡掉两种情形：「如下图可知」那类**引述**（在说图不是在引出图），' +
    '以及段首那句「如图所示，」往后传染整段（用户 10-11 那道题的第一枚）');
  ok(m.IMG_OP_TAIL.test('平均每个月的同比增量=') && m.IMG_OP_TAIL.test('增长率为') &&
     !m.IMG_OP_TAIL.test('如图'), 'T70 运算符结尾认「=为：」，不认「如图」那种领起');
  ok(m.IMG_CONT.test('亿元，正确；') && m.IMG_CONT.test('，增长最快') &&
     m.IMG_CONT.test('倍。') && !m.IMG_CONT.test('如下图所示：'), 'T70 续写开头认单位与标点（「倍」是 10-11 那道题里的一枚）');
  ok(ANA.indexOf('.gthq-analysis') >= 0 && ANA.indexOf('.analysis') >= 0,
    'T70 我们自己那份解析与站点那份解析都要管（站点样式表里 .analysis img 一条都没有）');
  ok(MAT.indexOf('.gthq-material') >= 0 && MAT.indexOf('.material') >= 0,
    'T70 材料豁免名单要认容器本体，两套类名都在');
  ok(OPT.indexOf('.gthq-opts') >= 0 && OPT.indexOf('.gthq-stem') >= 0 &&
     MAT.indexOf('.gthq-opts') < 0,
    'T70 题干与选项走「只认竖式」那一份名单，材料不在任何一份里');
})();

(function t71() {
  // 三题各带一份笔记：61 行测+资料分析（解析里有「增长率」、笔记里写着自己那句速算）、
  // 62 行测+法律常识（题面里有「法律常识」）、63 行测+模块没登记（notes.subject 不给 → 落「未记录」一档；
  // 正文与笔记里都没有「增长」两个字，所以 bookSearchHit(63,'增长') 该是 false）
  const store = mkStore({
    mockQs: {
      61: q(61, { analysis: '<p>增长率最高的是 2018 年。</p>' }),
      62: q(62, { content: '<p>下列关于法律常识的说法正确的是？</p>' }),
      63: q(63, { content: '<p>下面哪一项说法正确？</p>', analysis: '<p>其余三项均可排除。</p>' })
    },
    notes: {
      61: { text: '笔记：资料分析速算，先截三位再比', subject: 0, snapshot: '增长率最高的是哪一年' },
      62: { text: '宪法那条容易混', snapshot: '法律常识判断' },
      63: { text: '这题靠排除法', snapshot: '下面哪一项说法正确' }
    },
    qModule: { 61: '资料分析', 62: '法律常识' }
  });
  const m = build({ store: store });
  const all = [61, 62, 63];
  const byFacet = () => all.filter((id) => m.bookMatch(m.bookFacets(id)));

  m.bookFilter.subj = ''; m.bookFilter.mod = '';
  eq(byFacet(), [61, 62, 63], 'T71 什么都不选时三题都在');
  m.bookFilter.subj = '0';
  eq(byFacet(), [61], 'T71 科目下拉按笔记上记过的那一档筛（行测只留 61）');
  m.bookFilter.subj = 'x';
  eq(byFacet(), [62, 63], 'T71 「科目未记录」是一档，不是把它们混进行测');
  m.bookFilter.subj = '';
  m.bookFilter.mod = '资料分析';
  eq(byFacet(), [61], 'T71 模块下拉按登记过的模块名筛');
  m.bookFilter.mod = m.MOCK_UNCLS;
  eq(byFacet(), [63], 'T71 没登记上模块的那批归「模块未记录」，不会凭空消失');
  m.bookFilter.mod = '法律常识';
  eq(byFacet(), [62], 'T71 模块名各归各档：选了法律常识不会把资料分析那题也带进来');
  m.bookFilter.mod = '';

  eq(m.bookSearchHit(61, '增长率'), true, 'T71 关键词能命中解析正文');
  eq(m.bookSearchHit(61, '笔记'), true, 'T71 也能命中笔记正文——搜自己写过的话是这一档的主要用途');
  eq(m.bookSearchHit(62, '法律常识'), true, 'T71 能命中题干');
  eq(m.bookSearchHit(63, '增长'), false, 'T71 没写的词不该命中');
  eq(m.bookSearchHit(61, 'p>'), false, 'T71 匹配前剥过标签：搜「p>」这种标签碎片不该命中每一题');
  const q61 = mkStore({ notes: { 70: { text: '', snapshot: '只有引文的旧记录' } } });
  const m2 = build({ store: q61 });
  eq(m2.bookSearchHit(70, '引文'), true, 'T71 没有快照的旧记录退回笔记里那份题干引文，不是一律搜不到');
})();

async function t55() {
  await t59();
  await t59b();
}
(async function main() {
  await t45();
  await t55();
  await t13();
  await t16();
  await t31();
  await t67();
  // 顶格声明体检：主脚本是单文件 IIFE，正文里任何 var/function 都该缩进两格。
  // 顶格不是风格问题——fnSource/varSource 靠 '\n  function ' / '\n  var ' 定位，
  // 一旦顶格，抽取器**找不到它**而且只会报「找不到函数/变量」，把真因藏起来。
  // 2026-10-09 晚 IMG_LEAD 与 imgIsLead 就是这么丢掉的，连续三轮才定位到。
  const topLevel = [];
  raw.split('\n').forEach(function (line, i) {
    if (/^(var |function |const |let )/.test(line)) topLevel.push((i + 1) + ' 行：' + line.slice(0, 50));
  });
  ok(topLevel.length === 0,
    'T0 主脚本里没有顶格声明（缩进掉了会让抽取器找不到，症状是「找不到函数/变量」）',
    topLevel.join(' | '));
  if (fails.length) {
    console.log('[X] ' + fails.length + ' 条判据没过（' + pass + ' 条过）：');
    fails.forEach(function (f) { console.log('    · ' + f); });
    process.exit(1);
  }
  console.log('[OK] ' + pass + ' 条判据全过（覆盖来源组合、筛选描述、模考模块过滤、收录合并、组卷分层、笔记筛选、多标签只增合并）');
})();
