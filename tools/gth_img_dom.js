// 图片判档的真实 DOM 台架。判据从主脚本源码里原样抽出来跑，不复制实现。
//
// 为什么不用 tools/_probe_img*.js 那套手搓的 {nodeType:3} 假节点：imgSitsInText 只看紧邻兄弟的
// nodeType 与 nodeValue，假节点绕开了 innerHTML 解析、<br> 拆分、<span> 包字这些真实结构，
// 于是「题本里真实排版」那一层根本没被测到——那两个探针自然全绿（_probe_img2 的 want2got
// 在 role 为 unknown 时直接返回 want，等于把判不出来的格子一律算对，是同义反复）。
//
// 用法：node tools/gth_img_dom.js    # 跑现状判据，逐枚列出判定；判错则退出码 1
// 依赖：jsdom（装在托管 node workspace，跑法见 AGENTS.md「图片判档台架」那条）
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const raw = fs.readFileSync(path.join(ROOT, 'shangancun-exam-helper.user.js'), 'utf8');

// ——— 从源码抽函数与常量（不复制实现，改主脚本这里立刻跟着变）———
function fnSource(name) {
  const at = raw.indexOf('\n  function ' + name + '(');
  if (at < 0) throw new Error('找不到 ' + name);
  const start = at + 1;
  let depth = 0, end = raw.indexOf('{', start);
  for (; end < raw.length; end++) {
    const c = raw[end];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) break; }
  }
  return raw.slice(start, end + 1);
}
function varOf(name) {
  const m = new RegExp('\n  var ' + name + ' = ').exec(raw);
  if (!m) throw new Error('找不到 ' + name);
  const start = m.index + 1;
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if ('({['.indexOf(c) >= 0) depth++;
    else if (')}]'.indexOf(c) >= 0) depth--;
    else if (c === ';' && depth === 0) return raw.slice(start, i + 1);
  }
}
const CONSTS = ['IMG_INLINE_TEXT', 'IMG_BOTH_SIDES', 'IMG_2LINE_RATIO', 'IMG_2LINE_TALL', 'IMG_2LINE_MID',
  'IMG_2LINE_MID_RATIO', 'IMG_LEAD', 'IMG_OP_TAIL', 'IMG_CONT',
  'IMG_MATERIAL_HOST', 'IMG_TEXT_HOST', 'IMG_FORMULA_HOST', 'IMG_FRACTION_HOST', 'IMG_FORMULA_RATIO'];
const FNS = ["imgIsLead", "imgNeighborText", "imgTextRole", "imgLeadNearby", "imgSizeRole", "imgFitRole"];
const impl = new Function([
  'var location = { href: "https://x/" };',
  'function noop(){}',
  CONSTS.map(varOf).join('\n'),
  FNS.map(fnSource).join('\n'),
  'return { imgTextRole: imgTextRole, imgFitRole: imgFitRole, imgSizeRole: imgSizeRole };'
].join('\n'))();

// host 用别名而不是类名，为的是「选项那几条必须套真实层级」在数据里看得见：
// 判据认的是 .gthq-opts，真实结构是它 > .gth-choice > .gth-ctext > .gth-cval > img。
const HOSTS = {
  stem: 'gthq-stem', material: 'gthq-material', qopt: 'gthq-opts',
  analysis: 'gthq-analysis', note: 'gth-note-text', aside: 'gth-aside', apanel: 'gth-apanel',
  bare: 'gth-bare-box'   // 谁都不在的容器：形状兜底那一档不该伸手到这儿
};

// want 是三档：'1line'（行内式，定高一行）| '2line'（叠行式，定高两行）| 'keep'（原样）。
// 用户 10-09 给的口径是「题干里通常原样，选项与解析里通常与文字同大」，10-11 又把它落成
// 「图里的字与正文同大」——所以分式与竖式那一档不是「不缩」，是「缩到两行高」。
// 括号里是这条为什么。intrinsic 尺寸照真图量：10-11 那道题的 11 枚是从站点上抓下来读的。
const CASES = [
  // —— 题干：统计表/统计图/几何图是题目本身，原样 ——
  ['题干·统计图', 'stem', '<p>如下图所示：</p><p><img></p>', 800, 400, 'keep', '有「下图」领起'],
  ['题干·统计表', 'stem', '<p>如下表：</p><p><img></p>', 650, 200, 'keep', '表原样'],
  ['题干·几何图', 'stem', '<p>如图：</p><p><img></p>', 400, 380, 'keep', '几何图原样'],
  // —— 题干：公式嵌在句子中间，该与文字同大 ——
  ['题干·行内分式', 'stem', '<p>8人参加演讲比赛，抽签决定参赛顺序，有<img>种情况，最多的是？</p>', 110, 150, '2line', '公式在句中'],
  ['题干·宽公式接等号', 'stem', '<p>平均每个月的同比增量=<img></p><p>亿元，正确；</p>', 1221, 251, '2line', '等号后接式子'],
  ['题干·公式被 br 隔开', 'stem', '<p>平均每个月的同比增量=<br><img><br>亿元，正确；</p>', 1221, 251, '2line', 'br 两侧都是字'],
  ['题干·公式被 span 包字', 'stem', '<p><span>平均每个月的同比增量=</span><img><span>亿元，正确；</span></p>', 1221, 251, '2line', '编辑器爱包 span'],

  // —— 2026-10-11 用户报的那道等边三角形题（11 枚真图，尺寸是从站点抓下来读的）——
  // 段首那句「如图所示，」不锚住尾巴，同段后面每一枚行内式子都会被判成图放过去——
  // 第一枚 293x62 因此原样摆在 14px 正文中间，那就是用户说的「还是有问题」。
  ['题干·段首引述后的行内式', 'stem', '<p>如图所示，边长为50米的等边三角形ABC是学校操场上的一块闲置区域，其中<img>，<img>。</p>', 293, 62, '1line', '「如图所示」在段首，管不到段中'],
  ['题干·单行式接句号', 'stem', '<p>学校决定将<img>设置为沙坑，将四边形BEFC设置为仓库。</p>', 213, 74, '1line', '△AEF 那枚'],
  ['题干·几何图靠形状保住', 'stem', '<p>则围栏费用是警示带的多少倍？</p><p style="text-align:center"><img></p>', 300, 247, 'keep', '没领起词，但它是横方的图'],

  // —— 2026-10-09 晚两张截图：行内的「小」公式（360°、0℃）没被缩 ——
  // 这两枚不是分数也不是两行宽式，是句中一个数字/符号的小图：两边都有字，但都不到八个字。
  ['题干·行内数字图', 'stem', '<p>一个举重三星象征转<img>后，其旋转轴心不可能用到的截面是（　）。</p>', 120, 40, '1line', '截图一：360° 这枚'],
  ['选项·行内温度图', 'qopt', '<div class="gth-opt-plain">B. 气温经常在<img>上下波动，昼夜温差较大，并有一定湿度，' +
    '使岩石节理遭受反复冻融解，若在寒冷作用干破裂成大小不等的岩块及岩屑</div>', 110, 45, '1line', '截图二：0℃ 这枚'],
  // 两边字都够长的那一批仍是式子，但缩到几行由形状说：434x165 是竖式，两行高
  ['解析·两字旁的长句', 'analysis', '<p>计算如下：<img>，故答案选B。这题考的是增长率与基期量的关系。</p>', 434, 165, '2line', '两侧成句是式子，形状说它两行'],

  // —— 解析：单行式子与文字同大，叠行的分式给两行高 ——
  ['解析·单行式接分号', 'analysis', '<p>由题意可知<img>；</p>', 630, 64, '1line', '∠ABC=ACB=60° 那枚，64px 高是一行'],
  ['解析·分式接单位', 'analysis', '<p>则围栏费用是警示带费用的<img>倍。</p>', 205, 142, '2line', '15/3=5：缩到一行就糊了'],
  ['解析·两行公式', 'analysis', '<p>增长量=现期量-基期量，得 <img> 亿元。</p>', 1221, 251, '2line', '解析里的式子'],
  ['解析·竖式', 'analysis', '<p>计算如下：<img> 故答案选B。</p>', 434, 165, '2line', '竖式：横得开但也两行'],
  ['解析·横方公式', 'analysis', '<p>增长率=<img>，增长最快。</p>', 247, 144, '2line', '横方也是式子'],

  // —— 材料：统计表与统计图都是题目本身，一个像素都不许动 ——
  ['材料·表头', 'material', '<p>某市主要指标</p><p><img></p>', 1017, 153, 'keep', '材料里的图不动'],
  ['材料·统计图', 'material', '<p><img></p>', 420, 260, 'keep', '材料里的图不动'],

  // —— 选项：整张就是一张分式图（用户第二张截图）——
  ['选项·整张分式', 'qopt', '<div class="gth-choice"><div class="gth-circle"></div><div class="gth-ctext">' +
    '<div class="gth-clab">A.</div><div class="gth-cval"><img></div></div></div>', 110, 150, '2line', '选项即分式'],
  ['选项·横图', 'qopt', '<div class="gth-opt-plain">B. <p><img></p></div>', 650, 200, 'keep', '选项里的统计表原样'],
  ['选项·纯文字', 'qopt', '<div class="gth-opt-plain">C. 2015年</div>', 0, 0, 'keep', '无图'],

  // —— 反例：字数字槛（8/2）就是为这一格留的 ——
  // 「见 [统计图] 可知」把图形夹在两个字中间：放宽到各一个字，800x400 的表会被压成 78x39。
  ['解析·表夹在两字间', 'analysis', '<p>见<img>可知增长最快。</p>', 800, 400, 'keep', '两边字都不成句，这一层不表态'],

  // —— 解析：例外，图不是公式，原样 ——
  ['解析·饼图', 'analysis', '<p>如下饼图所示：</p><p><img></p>', 670, 447, 'keep', '饼图原样'],
  ['解析·纵向柱状图', 'analysis', '<p>如下图所示：</p><p><img></p>', 180, 520, 'keep', '竖柱状图，不是分式'],
  ['解析·多行表格', 'analysis', '<p>如下表：</p><p><img></p>', 650, 226, 'keep', '细长条筛子会误伤它'],
  ['解析·独立统计图', 'analysis', '<p><img></p>', 420, 260, 'keep', '独占一段的图原样']
];

// 边界与站点原生容器：判据在这些排版上不能抛错、也不能判反。
// 单独列一组是因为它们与上面那组验的不是一回事——上面验「角色分得对不对」，
// 这里验「站点自己那一屏（.analysis/.stem/.material）与畸形排版还认不认得」。
const EDGE = [
  ['站点原生 .analysis', 'aside', '<div class="analysis"><p>如下图所示：</p><p><img></p></div>', 800, 400, 'keep', '站点那一屏也认领起词'],
  ['站点原生 .stem', 'stem', '<div class="stem"><p>增长率=<img>，最快。</p></div>', 247, 144, '2line', '站点题干里的式子'],
  ['材料里也带等号', 'material', '<p>平均每个月的同比增量=<img></p>', 1221, 251, 'keep', '材料豁免压过等号'],
  ['图前是空 span', 'analysis', '<p><span>  </span><img></p>', 434, 165, '2line', '空包裹不阻断形状兜底'],
  ['领起词隔一层 div', 'analysis', '<p>如下表：</p><div><p><img></p></div>', 650, 226, 'keep', '隔一层仍认得'],
  ['连续两张图', 'analysis', '<p><img><img></p>', 1221, 251, '2line', '相邻两张裸公式都缩'],
  ['图旁只有空白', 'analysis', '<p>   <img>   </p>', 434, 165, '2line', '纯空白不算「有文字」'],
  ['正文含「如图」非领起', 'analysis', '<p>如图可知，增速很快。</p><p>如下图所示：</p><p><img></p>', 670, 447, 'keep', '以紧邻那段为准'],
  ['引述式领起词不算', 'analysis', '<p>如下图可知，增速很快。</p><p><img></p>', 293, 62, '1line', '那句收尾是「很快」不是「所示」，尾锚挡掉引述'],
  ['超大柱状图', 'analysis', '<p>如下图所示：</p><p><img></p>', 3000, 4000, 'keep', '再大也不压'],
  ['笔记浮窗里的式子', 'note', '<p>增长率=<img>，增长最快。</p>', 247, 144, '2line', 'gth-note-text 那一屏'],
  ['解析里空段落', 'analysis', '<p></p><p><img></p>', 420, 260, 'keep', '空段不干扰'],
  ['图套在 font 标签里', 'analysis', '<p><font>增长率=</font><img></p>', 247, 144, '2line', '老编辑器用 font 不用 span'],
  ['还没加载完', 'analysis', '<p>增长率=<img>，最快。</p>', 0, 0, 'keep', 'intrinsic 拿不到就这轮不动，load 再扫'],
  ['名单外的容器', 'bare', '<p><img></p>', 434, 165, 'keep', '解析与笔记之外那一屏不动它']
];

const dom = new JSDOM('<!doctype html><body></body>');
const { document } = dom.window;

function check(list) {
  let bad = 0;
  const rows = [];
  for (const [label, host, html, nw, nh, want, why] of list) {
    document.body.innerHTML = '<div class="' + HOSTS[host] + '">' + html + '</div>';
    const img = document.querySelector('img');
    let got = 'keep';
    if (img) {
      Object.defineProperty(img, 'naturalWidth', { value: nw, configurable: true });
      Object.defineProperty(img, 'naturalHeight', { value: nh, configurable: true });
      try {
        const role = impl.imgFitRole(img);
        got = role === '1line' ? '1line' : role === '2line' ? '2line' : 'keep';
      } catch (e) { got = '抛错:' + e.message; }
    }
    const ok = got === want;
    if (!ok) bad++;
    rows.push((ok ? '[绿] ' : '[红] ') + label.padEnd(16, '　') +
      (img ? nw + '×' + nh : '没有 img 节点').padEnd(9, ' ') +
      '应=' + want.padEnd(6, ' ') + '得=' + String(got).padEnd(6, ' ') + why);
  }
  console.log(rows.join('\n'));
  return bad;
}

const badMain = check(CASES);
console.log('\n判档 ' + (CASES.length - badMain) + '/' + CASES.length + '　判错 ' + badMain + ' 条');
const badEdge = check(EDGE);
console.log('\n边界 ' + (EDGE.length - badEdge) + '/' + EDGE.length + '　判错 ' + badEdge + ' 条');
process.exitCode = (badMain + badEdge) > 0 ? 1 : 0;
