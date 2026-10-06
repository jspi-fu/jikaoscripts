
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

  const vars = {};
  const varRe = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/g;
  while ((m = varRe.exec(topText))) if (!(m[1] in vars)) vars[m[1]] = lineOf(m.index);

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
