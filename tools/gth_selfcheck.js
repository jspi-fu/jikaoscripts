/* 油猴脚本静态自检（本项目专用）
   用途：`node --check` 只能查语法，查不出「调用了不存在的函数」。这个脚本补上这一点。

   用法：
     node tools/gth_selfcheck.js gongan-wrong-questions-helper.user.js

   做两件事：
     1) 找出形如 foo( 的调用，报出「被调用但没在任何地方声明、也不在内置白名单里」的名字。
        函数名拼错、改名后漏改调用点，都会在这里露头。
     2) 反向列出「声明了但全文件只出现一次」的函数，便于清理死代码。

   实现要点：扫描前先把字符串 / 模板串 / 行注释 / 块注释 / 正则字面量统统替换成等长空白，
   再用行号定位。这套扫描规则与 gth_logic_test.js 共用一份出处：./blank_literals.js。

   已知局限：函数被当值传走（addEventListener('x', foo)）识别不了，会落进「未被引用」的假阳性；
   形参名（function f(onProgress) 里的 onProgress）会误报成「调用未声明」，扫一眼即可。
*/
const fs = require('fs');
const blankLiterals = require('./blank_literals');
const file = process.argv[2];
if (!file) { console.error('用法：node gth_selfcheck.js <脚本路径>'); process.exit(2); }

const raw = fs.readFileSync(file, 'utf8');
const code = blankLiterals(raw);

const declared = new Set();
// function foo(
for (const m of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) declared.add(m[1]);
// var/let/const foo = ...  (右侧是什么都算已声明：debounce(...)、箭头函数、对象皆可)
for (const m of code.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/g)) declared.add(m[1]);

const BUILTIN = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'case',
  'String', 'Number', 'Boolean', 'Array', 'Object', 'Date', 'Math', 'JSON', 'RegExp', 'Error', 'TypeError', 'RangeError', 'Promise',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'BigInt', 'Proxy', 'Reflect', 'Intl', 'Function',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'queueMicrotask', 'structuredClone', 'atob', 'btoa',
  'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int32Array', 'Float32Array', 'Float64Array', 'DataView', 'ArrayBuffer',
  'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FormData', 'Image', 'Audio',
  'DOMParser', 'XMLHttpRequest', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'Node', 'Event', 'CustomEvent',
  'getComputedStyle', 'matchMedia', 'fetch', 'alert', 'confirm', 'prompt',
  'GM_xmlhttpRequest', 'GM_addStyle', 'GM_setClipboard', 'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_registerMenuCommand',
  'unsafeWindow', 'require', 'define', 'exports', 'super', 'await', 'yield'
]);

const calledAt = new Map();
for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
  if (!calledAt.has(m[1])) calledAt.set(m[1], code.slice(0, m.index).split('\n').length);
}

const missing = [...calledAt].filter(([n]) => !BUILTIN.has(n) && !declared.has(n));

const unused = [...declared].filter(n => {
  const re = new RegExp('(?<![.\\w$])' + n.replace(/[$]/g, '\\$') + '\\b', 'g');
  return [...code.matchAll(re)].length <= 1;
});

console.log(`文件：${file}`);
console.log(`识别到声明：${declared.size} 个`);
if (missing.length) {
  console.log(`\n[X] 调用了却没声明的名字（${missing.length} 个）——优先排查这些：`);
  missing.forEach(([n, line]) => console.log(`    ${n}   (第 ${line} 行)`));
} else {
  console.log('\n[OK] 没有「调用未声明函数」的痕迹。');
}
if (unused.length) {
  console.log(`\n[!] 只出现一次的函数（疑似死代码；被当值传走的会误报，肉眼扫一眼）：`);
  unused.forEach(n => console.log(`    ${n}`));
}
process.exit(missing.length ? 1 : 0);
