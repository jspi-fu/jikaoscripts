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
const fs = require('fs');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = process.cwd();
const TABLE = process.argv[2] || 'tools/gth_mutations.json';
const rows = JSON.parse(fs.readFileSync(TABLE, 'utf8'));

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
  let out = '';
  try {
    const r = cp.spawnSync(process.execPath, ['tools/gth_logic_test.js'], { cwd: ROOT, encoding: 'utf8' });
    out = (r.stdout || '') + (r.stderr || '');
    const red = r.status !== 0;
    const kind = !red ? 'GREEN     ' : (/条判据没过/.test(out) ? 'ASSERT-RED' : 'BUILD-RED ');
    if (kind !== 'ASSERT-RED') bad++;
    const why = out.split('\n').filter((l) => l.indexOf('·') >= 0).slice(0, 2)
      .map((l) => l.trim()).join(' ｜ ') || out.split('\n').filter((l) => /Error/.test(l))[0] || '';
    console.log(kind + ' ' + row.name + '   ' + why.slice(0, 150));
  } finally {
    restore(row.file);
  }
}

for (const rel of Object.keys(cache)) restore(rel);
const gate = cp.spawnSync(process.execPath, ['tools/gth_logic_test.js'], { cwd: ROOT, encoding: 'utf8' });
const last = (gate.stdout || '').trim().split('\n').pop();
console.log('\n还原后复跑判据：' + last);
console.log(bad ? '有 ' + bad + ' 条突变不合格（见上）' : '全部 ' + rows.length + ' 条都判红，且红来自断言');
process.exit(bad ? 1 : 0);
