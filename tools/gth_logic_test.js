
const fs = require('fs');
const blankLiterals = require('./blank_literals');

const FILE = process.argv[2] || 'gongan-wrong-questions-helper.user.js';
const raw = fs.readFileSync(FILE, 'utf8');
const blank = blankLiterals(raw);

function sliceToStatementEnd(from) {
  let depth = 0;
  for (let i = from; i < blank.length; i++) {
    const c = blank[i];
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

const CONSTS = ['SUBJ_ZY', 'SUBJ_XC', 'SUBJECT_NAME', 'DAY_RANGES', 'MASTER_STREAK',
  'WRONG_BASE', 'STUBBORN_MIN', 'ERR_COUNT_KEYS', 'SRC_KEYS', 'SRC_NAME', 'MOCK_UNCLS',
  'PUNCT_RE', 'KEYACT', 'EXPORT_PREFIX',
  'MOCK_QID_KEYS', 'MOCK_STEM_KEYS', 'MOCK_MAT_KEYS', 'MOCK_OPT_KEYS', 'MOCK_USER_KEYS',
  'MOCK_CORRECT_KEYS', 'MOCK_ANALYSIS_KEYS', 'MOCK_SUBJECT_KEYS', 'MOCK_RESULT_KEYS',
  'MOCK_MODULE_KEYS', 'selectedModules', 'selectedMockModules', 'practiceSrcs',
  'notesFilter', 'notesSearchKey', 'examPointModule', 'SRC_LIST_LABEL'];

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
  'examTypeFrom', 'subjectFromUrl', 'routeExamType', 'sweepFacets', 'rememberSources', 'backfillSubject',
  'subjectForExport',
  'fetchXingce', 'buildModuleOptions', 'fetchXingceBy', 'fetchFavoriteXingce',
  'listPath', 'listParams', 'esc', 'hlRowHtml', 'noteIdsWithHl'];

const PRELUDE = [
  'var console = { log: noop, warn: function (m) { ctx.warns.push(String(m)); }, error: noop };',
  'function noop() {}',
  "var LS_STORE = 'gth_test_store';",
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
  'var icon = function (n) { return "<svg>" + n + "</svg>"; };'
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
  'SRC_NAME', 'SRC_KEYS', 'SRC_LIST_LABEL', 'SUBJ_XC', 'SUBJ_ZY', 'EXPORT_PREFIX', 'resumeKeyOld', 'readResume', 'clearResume',
  'staleResumeKeys', 'strayStorageKeys', 'ensureExamPointIndex', 'SRC_LIST_LABEL',
  'examTypeFrom', 'subjectFromUrl', 'routeExamType', 'sweepFacets', 'rememberSources', 'backfillSubject',
  'subjectForExport'
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
    mockQs: {}, mocks: {}, resume: {}, history: [], practiced: {}, qModule: {}, qSrc: {}
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
    ['= noteIdsWithHl();', 3, '笔记 tab、一键整理与重扫三处共用同一口径（重扫报的「还缺几题」不能另起一套算法）'],
    ['rerenderAsides();', 2, '恢复数据后与划线变动后两处共用'],
    ["$$('.gth-aside').forEach", 1, '批注栏重画的遍历只有一份'],
    ['if (it && !a.dataset.editing) renderAside(a, it);', 1, '正在编辑的那一题不重画，这条判据还在'],
    ['fetchXingceBy(', 3, '行测流程一份 + 错题/收藏两个转发'],
    ['apiGet(listPath(kind, ci), params)', 1, '行测的接口路径由 kind 决定，不再各写一遍'],
    ["'<div class=\"gth-hlp-item\" data-hl=\"'", 1, '整理为笔记那处的简版行（无批注栏/无 ✕）是有意另写的，没被并进去'],
    ['repaintOne(qid);', 2, '改色与取消划线两处共用重落笔'],
    ['qRoot(qid)', 4, 'qid 选择器一处定义三处调用'],

    ["'<div class=\"text\">' + icon('sparkles') + '机考助手</div>'", 1, '左菜单入口名只有一份字符串，两页共用'],
    ['height:var(--gth-ctl-h', 4, '按钮 / 输入下拉 / 模考浮标 / 浮标内按钮共用同一个高度令牌，谁退回写死高度就红'],
    ['if (hlHoldLost(rec, analysisShown)) return;', 1, 'paintRoot 真的在问这个判据，不是写了个没人调的函数'],
    ['= migrateHlLost(data);', 1, '库初始化真的走这次清洗，不只是有个函数'],
    ['washHlLost(store.highlights)', 1, '恢复备份也洗一次：旧备份里那批假失效不能带回来'],
    ["<span class=\"gth-caret\">' + icon('chevronDown')", 1, '划线清单的展开标识是一个箭头，不是两个字'],

    ['.caret{', 0, 'CSS 里不许出现不带 gth- 前缀的 .caret 选择器（与 bootstrap 全局类撞车）'],
    ['class="caret"', 0, '标记里不许出现不带 gth- 前缀的 class="caret"（同上）'],
    ['caret.textContent', 0, '朝向由 CSS 跟着 .on 派生，JS 不再往 caret 里写「展开 / 收起」'],
    ['syncKeyTargets();', 3, '键盘可达在观察器刷新与两处初始化里都补了，漏一处就有节点永远点不到'],
    ['busy(btn, ensureLoaded(', 2, '导出两颗按钮真的被 busy 包住，不是只写了个 helper'],
    ['busy(this, fetchByFilter(', 1, '组卷按钮走同一条置灰通路'],
    ['busy(this, ensureExamPointIndex(', 1, '重扫整条链（先取考点表、再拉题）都包在置灰里'],
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

    ["$('#gth-mod-scan').addEventListener('click'", 1, '重扫模块真的绑上了处理器'],
    ["$('#gth-stray-clean').addEventListener('click'", 1, '清理残留真的绑上了处理器'],
    ["dayRange: '4', srcs: ['error', 'favorite']", 1, '重扫走「按日期=全部」那一趟，不是逐考点配对的几十次'],
    ['= strayStorageKeys(names)', 1, '清理真的问这份判据，不是写了两个没人调的函数（数的是调用形，不是定义头）'],
    ['staleResumeKeys(store.resume)', 1, '旧刷题进度也走同一份判据'],
    ['class="gth-q"', 2, '两颗按钮各挂一个小问号，说明文字在 title 里'],
    ['.gth-q{display:inline-flex', 1, '小问号有自己的样式，不是个裸字符'],
    ['title="先取行测考点表', 1, '重扫的说明挂在问号上，不在按钮文字里'],
    ['先取行测考点表，再按日期过一遍错题本与收藏夹、按科目过一遍公专题目', 1,
      '问号里说清两趟各补什么：只写「补模块」就成了上一版那种白跑一趟的错觉'],
    // 科目与来源这两条新数据通路：只测纯函数不够，得证明写入点与读出口真的改成调它了
    ['q._src = src;', 2, '两条取题路都把来源打在题上（单源那条与两路合并那条各一处）'],
    ["p._src !== src) p._src = 'both'", 1, '同一题在两路都出现过，合并当场升 both，不等下次'],
    ["subject: subjectOf(", 3, '划线、批注栏保存、模考收录三处写入点都改走 subjectOf'],
    ['subjectFromUrl(location.search, location.hash)', 1, 'routeExamType 经过那道「只认 0 与 1」的守卫，不拿分类 id 当科目'],
    ['(store.qSrc && store.qSrc[id]) || ', 1, 'noteFacets 真读新表，缺表退回 site（旧库的降级路径）'],
    ["nf.src === 'site' ? r.src !== 'mock'", 1, '「练习题」按集合匹配，不是与三档互斥的第四个值'],
    ['(SRC_LIST_LABEL[q._src]', 1, '导出的「来源」列走这张表，不是写死「练习」'],
    ['SUBJECT_NAME[subjectForExport(q)]', 1, '导出的「科目」列会退回库里那条，重扫回填的科目才在表格里看得见'],
    ['sweepFacets(siteList, zyList, examPointModule)', 1, '重扫把两趟结果交给判定，不是拉回来就扔'],
    ['rememberSources(f.srcs)', 1, '来源判定结果真的落库'],
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
  ok(body.indexOf('applyViewChrome(true)') >= 0, 'T27 观察器每次重贴壳：隐藏类与安家都要跟上 AngularJS 的重绘');
  ok(body.indexOf('if (storeRev !== panelRev) renderPanel();') >= 0, 'T27 内容只在 store 真变过时画');
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
  const scan = slice("$('#gth-mod-scan').addEventListener('click'", "$('#gth-stray-clean').addEventListener('click'");
  ok(!!scan, 'T30 重扫模块的处理器还是这一段');
  [
    ['ensureExamPointIndex()', 'T30 重扫先确保考点表在手——按日期那条路自己不会拉 subcategory，没表就一条都登记不上'],
    ['busy(this, ensureExamPointIndex(', 'T30 整条重扫链包在置灰里：先取表、后拉题，中途不给连点'],
    ['return fetchByFilter(', 'T30 索引到手之后才按日期拉题'],
    ["dayRange: '4'", 'T30 重扫按「日期=全部」，不是当天那一档'],
    ["srcs: ['error', 'favorite']", 'T30 两路都扫：只扫错题本会漏掉收藏里的题'],
    ['noteIdsWithHl()', 'T30 扫完要按「笔记 ∪ 划线」那份口径数还剩几题，而不是报个「完成」了事'],
    ['!moduleOf(id)', 'T30 缺模块那一档真的在查模块，不是只数题'],
    ['noteFacets(id).subj', 'T30 缺科目那一档也数得出（科目与模块两栏各报一个数）'],
    ['新登记 ', 'T30 状态栏要报「新登记 N 条」：N=0 就说明问题出在换不出模块名，不在题目不在列表里'],
    ['renderNotesList();', 'T30 重画笔记面板：模块下拉与那条提示都得跟着新登记变'],
    ["setStatus('重扫失败：'", 'T30 请求失败有话说，按钮不会卡在置灰态']
  ].forEach(function (p) { ok(scan && scan.indexOf(p[0]) >= 0, 'T30 ' + p[1]); });

  const clean = slice("$('#gth-stray-clean').addEventListener('click'", 'var notesSearchKey');
  ok(!!clean, 'T30 清理残留的处理器还是这一段');
  [
    ['staleResumeKeys(store.resume)', 'T30 旧进度走那份判据，不是随手删 resume 整桶'],
    ['= strayStorageKeys(names)', 'T30 存储键走那份判据'],
    ['没有可清理的残留记录', 'T30 无可清理时直说，不空跑一次确认框'],
    ['if (!confirm(', 'T30 删之前必须过一道确认（写成了无条件 confirm 也算没守）'],
    ['localStorage.removeItem(', 'T30 确认后真删存储键'],
    ['delete store.resume[x];', 'T30 确认后真删旧进度记录'],
    ['saveStore();', 'T30 删过 resume 就落盘，不然下一次写盘又把旧记录带回来']
  ].forEach(function (p) { ok(clean && clean.indexOf(p[0]) >= 0, 'T30 ' + p[1]); });
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
    const st = mkStore({ qSrc: {} });
    const t = build({ store: st });
    eq(t.rememberSources({ 1: 'error', 2: 'favorite' }), 2, 'T32 两条新来源都登记');
    eq([st.qSrc['1'], st.qSrc['2']], ['error', 'favorite'], 'T32 写进了库');
    const saved = t.getSaved();
    eq(t.rememberSources({ 1: 'error' }), 0, 'T32 同值重复登记不算改动');
    eq(t.rememberSources({ 1: 'favorite' }), 1, 'T32 两处都出现过就升 both');
    eq(st.qSrc['1'], 'both', 'T32 both 真的写进去了');
    eq(t.rememberSources({ 1: 'error' }), 0, 'T32 已是 both 不再降回单一来源');
    ok(t.getSaved() > saved, 'T32 有过改动才落盘');
    eq(t.rememberSources(undefined), 0, 'T32 空输入不抛错');
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

(async function main() {
  await t45();
  await t13();
  await t16();
  await t31();
  if (fails.length) {
    console.log('[X] ' + fails.length + ' 条判据没过（' + pass + ' 条过）：');
    fails.forEach(function (f) { console.log('    · ' + f); });
    process.exit(1);
  }
  console.log('[OK] ' + pass + ' 条判据全过（覆盖来源组合、筛选描述、模考模块过滤、收录合并、组卷分层、笔记筛选、多标签只增合并）');
})();
