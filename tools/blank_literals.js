/* 把「不能当代码看」的片段换成等长空白，保留换行以维持行号与偏移。
   两个使用者：gth_selfcheck.js（找调用未声明的函数）、gth_logic_test.js（按花括号配对抽函数原文）。

   为什么要单独成文件：正则字面量里的引号与花括号必须识别，否则
   `replace(/"/g, '')` 会把后续全部内容误吞进字符串，`/^[\[{]/` 会让花括号配对多出一只。
   这套扫描规则只留这一份出处。 */
module.exports = function blankLiterals(src) {
  const out = src.split('');
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  // 上一个有效字符，用来判断 `/` 是除号还是正则起点
  let prevSig = '';
  const canStartRegex = () => prevSig === '' || '(,=:[!&|?{};+-*%~^<>'.indexOf(prevSig) >= 0;

  while (i < src.length) {
    const c = src[i], n = src[i + 1];

    if (c === '/' && n === '/') {                       // 行注释
      let j = i; while (j < src.length && src[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && n === '*') {                       // 块注释
      let j = i + 2; while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, src.length)); i = j + 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {          // 字符串 / 模板串
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') j += 2; else j++;
      }
      blank(i, Math.min(j + 1, src.length)); i = j + 1; prevSig = c; continue;
    }
    if (c === '/' && canStartRegex()) {                 // 正则字面量
      let j = i + 1, inClass = false, ok = false;
      while (j < src.length) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;                           // 正则不跨行，说明判断错了
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { ok = true; break; }
        j++;
      }
      if (ok) {
        let k = j + 1; while (k < src.length && /[gimsuy]/.test(src[k])) k++;
        blank(i, k); i = k; prevSig = '/'; continue;
      }
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out.join('');
};
