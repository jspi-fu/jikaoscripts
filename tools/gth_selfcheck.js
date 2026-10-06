
const fs = require('fs');
const blankLiterals = require('./blank_literals');
const file = process.argv[2];
if (!file) { console.error('用法：node gth_selfcheck.js <脚本路径>'); process.exit(2); }

const raw = fs.readFileSync(file, 'utf8');
const code = blankLiterals(raw);

const declared = new Set();

for (const m of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) declared.add(m[1]);

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
