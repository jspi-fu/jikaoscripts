// 突变验证器：AGENTS 要求「每修一个 bug 都要把修复改回缺陷态，确认它真的判红」。
// 手写一次性脚本踩过一次事故——中途抛错就没还原，后面全在坏文件上跑判据。
// 所以这里把还原放进 finally，并在每次还原后比对哈希：文件没回到原样就当场停。
//
//   node tools/gth_mutate.js tools/gth_mutations.json
//
// 表里每条 {name, file, from, to}。退出码非 0 的三种情况：
//   GREEN    改回缺陷态判据还是绿的 → 这条修复没有守卫，等于没修完
//   SKIP     锚点在文件里找不到 → 表与代码已经漂移，这条测了个寂寞
//   BUILD-RED 红了，但红来自判据沙箱构建失败而不是断言 → AGENTS 明令不接受
//
// 闸门有两台：无头判据与图片判档台架。图片那一组的改动（类名、尺寸档、领起词）
// 无头判据看不见，只跑它一个的话那十几条图片突变永远报 GREEN——10-11 实测到就是这个形状。
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = process.cwd();
const TABLE = process.argv[2] || 'tools/gth_mutations.json';
const rows = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
const GATES = ['tools/gth_logic_test.js', 'tools/gth_img_dom.js'];
// 一台闸门算不算「红来自断言」：各自的通过线措辞不同
const ASSERT_LINE = {
  'tools/gth_logic_test.js': /条判据没过/,
  'tools/gth_img_dom.js': /判错 [1-9]\d* 条/
};

// 图片台架要 jsdom，它装在托管 node workspace 里（仓库没有 package.json，这是 AGENTS 那条跑法）。
// 找不到就当场停，而不是把这台闸门当不存在——少跑一台闸门而报出来的 GREEN 是假信号，
// 和「兜底显示替功能说话」是同一类错。
function gateEnv() {
  const cands = [];
  if (process.env.GTH_NODE_PATH) cands.push(process.env.GTH_NODE_PATH);
  if (process.env.NODE_PATH) cands.push.apply(cands, process.env.NODE_PATH.split(path.delimiter));
  const home = process.env.USERPROFILE || process.env.HOME || '';
  cands.push(path.join(home, '.workbuddy/binaries/node/workspace/node_modules'));
  for (const c of cands) {
    if (c && fs.existsSync(path.join(c, 'jsdom', 'package.json'))) {
      return { NODE_PATH: c };
    }
  }
  console.log('跑不了：找不到 jsdom，图片台架那台闸门起不来。');
  console.log('要么设 GTH_NODE_PATH=<含 jsdom 的 node_modules>，要么别跑这件工具（只跑无头判据会漏掉图片那一组）。');
  process.exit(2);
}
const GATE_ENV = Object.assign({}, process.env, gateEnv());

function runGates() {
  let kind = 'GREEN     ', why = [];
  for (const g of GATES) {
    const r = cp.spawnSync(process.execPath, [g], { cwd: ROOT, encoding: 'utf8', env: GATE_ENV });
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.status === 0) continue;
    kind = ASSERT_LINE[g].test(out) ? 'ASSERT-RED' : 'BUILD-RED ';
    why = why.concat(out.split('\n').filter((l) => l.indexOf('·') >= 0 || /^\[红\]/.test(l.trim()))
      .map((l) => l.trim()).slice(0, 2));
    if (kind === 'BUILD-RED') break;
    why = why.concat(out.split('\n').filter((l) => /Error/.test(l)).slice(0, 1));
  }
  return { kind, why: why.join(' ｜ ') };
}

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16); }

const cache = {};
function read(rel) {
  if (!cache[rel]) cache[rel] = { src: fs.readFileSync(ROOT + '/' + rel, 'utf8') };
  return cache[rel];
}
function restore(rel) {
  const want = cache[rel].src;
  fs.writeFileSync(ROOT + '/' + rel, want);
  if (sha(fs.readFileSync(ROOT + '/' + rel, 'utf8')) !== sha(want)) {
    console.log('\n还原失败：' + rel + ' 没回到原样，停在这里，别再跑任何判据。');
    process.exit(3);
  }
}

let bad = 0;
// from/to 可以是字符串，也可以是**等长数组**：有些缺陷态要两处一起改才合法
// （比如把一对括号同时挪回去），单改一处只会留下语法错，报出来的是 BUILD-RED 而不是断言红。
const MUT = (x) => (Array.isArray(x) ? x : [x]);
for (const row of rows) {
  const entry = read(row.file);
  const eol = entry.src.indexOf('\r\n') >= 0 ? /\n/g : null;
  const fix = (s) => (eol ? s.replace(/\n/g, '\r\n') : s);
  const from = MUT(row.from).map(fix), to = MUT(row.to).map(fix);
  if (from.length !== to.length) {
    console.log('SKIP       ' + row.name + '   from/to 条数不等（' + from.length + ' vs ' + to.length + '）');
    bad++;
    continue;
  }
  const miss = from.filter((f) => entry.src.indexOf(f) < 0);
  if (miss.length) {
    console.log('SKIP       ' + row.name + '   锚点在 ' + row.file + ' 里找不到（表与代码漂移了）');
    bad++;
    continue;
  }
  let next = entry.src;
  from.forEach((f, i) => { next = next.replace(f, to[i]); });
  fs.writeFileSync(ROOT + '/' + row.file, next);
  try {
    const r = runGates();
    if (r.kind !== 'ASSERT-RED') bad++;
    console.log(r.kind + ' ' + row.name + '   ' + r.why.slice(0, 150));
  } finally {
    restore(row.file);
  }
}

for (const rel of Object.keys(cache)) restore(rel);
const tail = GATES.map(function (g) {
  const r = cp.spawnSync(process.execPath, [g], { cwd: ROOT, encoding: 'utf8', env: GATE_ENV });
  const out = ((r.stdout || '') + (r.stderr || '')).trim().split('\n');
  return (r.status === 0 ? '[绿] ' : '[红] ') + g.replace('tools/', '') + '：' +
    (out.filter(function (l) { return l.trim(); }).pop() || '').trim();
});
console.log('\n还原后复跑闸门：\n  ' + tail.join('\n  '));
console.log(bad ? '有 ' + bad + ' 条突变不合格（见上）' : '全部 ' + rows.length + ' 条都判红，且红来自断言');
process.exit(bad ? 1 : 0);
