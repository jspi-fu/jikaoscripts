/* 尺子：找出「脚本一加载就会读到、但赋值语句还写在后面」的顶层变量。
   var 只提升声明、不提升赋值，所以这类调用当场拿到 undefined
   （这一类缺陷守的是什么、当年那次怎么踩的、为什么无头判据看不见，权威出处都在
   `AGENTS.md` 的「验证」一节；这里只留一把尺子自己的口径。形状：顶层同步的 syncRail()
   → placeRailItems → syncBalloons 读到 Object.keys(balloonEls)，而 var balloonEls = {} 写在它后面）。

   用法：node tools/gth_init_order.js [脚本路径...]
   也被 gth_logic_test.js 的 T21 当判据调用。

   口径：把所有函数体（具名的、匿名的）都遮掉，剩下的就是「顶层顺序执行」的代码；
   那里出现的 name(...) 才算同步入口——所以写在 if / try 块里的调用也算进来。
   注册成事件监听器或观察器回调的函数不算入口：它们要等本轮同步代码跑完才触发，
   那时后面的 var 早已赋值，报出来只会把真雷埋进噪音里。 */
const fs = require('fs');
const blank = require('./blank_literals');

function report(file, quiet) {
  const raw = fs.readFileSync(file, 'utf8');
  const b = blank(raw);
  const lineOf = (idx) => raw.slice(0, idx).split('\n').length;

  function matchBrace(text, openLoc) {
    let depth = 0;
    for (let i = openLoc; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (!depth) return i; }
    }
    return text.length - 1;
  }

  // 1) 所有函数体范围（含嵌套的具名函数）
  const bodies = [];
  const anyFn = /function\s*([A-Za-z_$][\w$]*)?\s*\(/g;
  let m;
  while ((m = anyFn.exec(b))) {
    const open = b.indexOf('{', m.index + m[0].length - 1);
    if (open < 0) continue;
    bodies.push({ name: m[1] || '', open: open, close: matchBrace(b, open) });
  }
  const fns = {};
  bodies.forEach(function (x) { if (x.name && !(x.name in fns)) fns[x.name] = x; });

  // 2) 顶层同步文本 = 遮掉「顶层那一层」的函数体。
  //    注意别把最外层 IIFE 的体也遮了——那层之内才是我们要看的顶层顺序代码；
  //    遮错会得到「同步入口 0 处 / 判定：绿」这种最坏的假绿。
  //    depth = 有多少个别的函数体把它整个包住：0 就是最外层那个 IIFE。
  bodies.forEach(function (x) {
    x.depth = bodies.reduce(function (n, y) {
      return n + (y !== x && y.open <= x.open && x.close <= y.close ? 1 : 0);
    }, 0);
  });
  const hasWrapper = bodies.some(function (x) { return x.depth === 0; });
  const hideDepth = hasWrapper ? 1 : 0;
  const top = b.split('');
  bodies.forEach(function (x) {
    if (x.depth !== hideDepth) return;
    for (let i = x.open; i <= x.close && i < top.length; i++) if (top[i] !== '\n') top[i] = ' ';
  });
  const topText = top.join('');

  // 3) 同步入口：顶层文本里出现的具名调用，任意缩进都算。
  //    `function NAME(` 的定义头不是调用——不排掉的话入口会虚涨到几百，报出一堆假雷。
  const entries = [];
  Object.keys(fns).forEach(function (name) {
    const re = new RegExp('[^\\w$.]' + name.replace(/\$/g, '\\$') + '\\s*\\(', 'g');
    let mm;
    while ((mm = re.exec(topText))) {
      const at = mm.index + 1;
      const before = topText.slice(Math.max(0, at - 16), at);
      if (/function\s+$/.test(before)) continue;
      entries.push({ line: lineOf(at), name: name });
    }
  });

  // 4) 顶层赋值：var / let / const NAME =（只看同步文本，函数体里的局部变量不算）
  const vars = {};
  const varRe = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/g;
  while ((m = varRe.exec(topText))) if (!(m[1] in vars)) vars[m[1]] = lineOf(m.index);

  // 5) 每个函数「自己体内」的文字：再套一层函数体也遮掉，
  //    否则点击回调里提到的函数会被当成启动就会跑到（噪音淹没真雷）
  function ownText(name) {
    const f = fns[name];
    if (!f) return '';
    const seg = b.slice(f.open + 1, f.close).split('');
    bodies.forEach(function (x) {
      if (x.open > f.open && x.close < f.close) {
        for (let i = x.open - f.open - 1; i <= x.close - f.open - 1 && i < seg.length; i++) {
          if (seg[i] !== '\n') seg[i] = ' ';
        }
      }
    });
    return seg.join('');
  }
  const own = {};
  Object.keys(fns).forEach(function (n) { own[n] = ownText(n); });

  function walk(entry) {
    const seen = {}, hits = [], queue = [entry];
    while (queue.length) {
      const name = queue.shift();
      if (seen[name]) continue;
      seen[name] = 1;
      const body = own[name];
      if (body === undefined) continue;
      Object.keys(fns).forEach(function (other) {
        if (other !== name && new RegExp('\\b' + other + '\\s*\\(').test(body)) queue.push(other);
      });
      Object.keys(vars).forEach(function (v) {
        if (new RegExp('\\b' + v + '\\b').test(body)) hits.push({ fn: name, v: v });
      });
    }
    return hits;
  }

  const uniq = {};
  entries.forEach(function (e) {
    walk(e.name).forEach(function (h) {
      if (vars[h.v] > e.line) {
        uniq[h.v + '@' + h.fn] = { v: h.v, fn: h.fn, decl: vars[h.v], call: e.line, entry: e.name };
      }
    });
  });
  const list = Object.keys(uniq).map(function (k) { return uniq[k]; });

  if (!quiet) {
    console.log('===== ' + file + '：同步入口 ' + entries.length + ' 处，使用先于赋值 ' + list.length + ' 处 =====');
    list.forEach(function (x) {
      console.log('  [X] ' + x.v + '：赋值在第 ' + x.decl + ' 行，但第 ' + x.call + ' 行的 ' +
        x.entry + ' 会走到 ' + x.fn + '() 里读它');
    });
  }
  return list;
}

module.exports = { find: function (file) { return report(file, true); } };

if (require.main === module) {
  const files = process.argv.slice(2).length ? process.argv.slice(2)
    : ['gongan-wrong-questions-helper.user.js'];
  let total = 0;
  files.forEach(function (f) { total += report(f).length; });
  console.log(total ? '\n判定：红——有 ' + total + ' 处使用先于赋值' : '\n判定：绿');
  process.exit(total ? 1 : 0);
}
