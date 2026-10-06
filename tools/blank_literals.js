
module.exports = function blankLiterals(src) {
  const out = src.split('');
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;

  let prevSig = '';
  const canStartRegex = () => prevSig === '' || '(,=:[!&|?{};+-*%~^<>'.indexOf(prevSig) >= 0;

  while (i < src.length) {
    const c = src[i], n = src[i + 1];

    if (c === '/' && n === '/') {
      let j = i; while (j < src.length && src[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && n === '*') {
      let j = i + 2; while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, src.length)); i = j + 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') j += 2; else j++;
      }
      blank(i, Math.min(j + 1, src.length)); i = j + 1; prevSig = c; continue;
    }
    if (c === '/' && canStartRegex()) {
      let j = i + 1, inClass = false, ok = false;
      while (j < src.length) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;
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
