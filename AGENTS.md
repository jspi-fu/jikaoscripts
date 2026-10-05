# AGENTS.md

上岸村机考系统（`pub.xdtech.top/<ctx>/wxpage/tiku/gongan/`，AngularJS SPA）的油猴脚本仓库。
交付平台是**脚本猫（ScriptCat）**，不是篡改猴；脚本以「整份文件粘进扩展」的方式发布，
所以每个 `.user.js` 必须是自包含的单文件（不打包、不拆模块）。

在用的脚本有两份：

- `gongan-wrong-questions-helper.user.js` —— 错题助手，作用于 `index.html`（错题本 `#/error`、
  收藏 `#/shoucang`）与 `mocks/index.html`（全真模考收录）。发布在商店页 8111。
- `shangancun-exam-timer-pause.user.js` —— 考试计时暂停，只作用于 `zhuanxiang.html` / `practice.html`
  的计时显示，不碰笔记与划线；它靠给 scope 的时间字段装 getter/setter 阀门来冻结时间。

曾经还有第三份「机考助手」（全站形态），已于 2026-10-03 删除，相关决策见 `docs/adr/0001`、`0002`。

动手改某个模块前，先按名字读它的术语归属（`CONTEXT.md`）与相关决策（`docs/adr/`）；
时序状态（谁在测什么、卡在哪、线上是哪份）**不进仓库文档**——要查就读脚本头 `@version`、抓商店页、
读 `localStorage`，仓库里没有进度文件。`CONTEXT.md` 与本文件都不带版本状态标签。
还没修的存量缺陷单独列在 `docs/存量缺陷.md`，那是待办清单，不是决策。

## 验证：改完必须跑的四条命令

没有 package.json、没有 CI，验证就是这几条 node 命令，全部秒级、离线、不碰浏览器。

```
node --check gongan-wrong-questions-helper.user.js          # 语法
node tools/gth_logic_test.js                     # 逻辑判据，绿=「N 条判据全过」
node tools/gth_init_order.js                     # 启动顺序，绿=「判定：绿」
node tools/gth_selfcheck.js gongan-wrong-questions-helper.user.js   # 待肉眼确认的清单
```

前三条是过/不过；`gth_selfcheck.js` 没有通过线，它输出的是候选清单
（「调用了却没声明」那几条历来是形参名的误报），要看的是**新多出来的**名字——
尤其「只出现一次的函数」，那基本就是死代码。

判据的写法决定了它能不能当守卫，改脚本前先读懂：`gth_logic_test.js` **从脚本原文里抽取**函数体来跑，
不复制实现。于是它有两条硬约束：

1. 出现在它 `FNS` / `CONSTS` 名单里的名字，必须继续声明为两空格缩进的 `  function NAME(` /
   `  var NAME = `，且能只靠文件里的 `PRELUDE` 桩跑通。改名、挪进嵌套作用层、换缩进、
   给它新增一个没被桩过的全局依赖，都会让抽取当场抛错（是响亮失败，不会假绿）。
   抽出来还要**第三份名单 `EXPOSED`** 把它暴露给测试才用得上；漏加不会假绿，`build()` 返回的
   Proxy 会在测试问到它时当场抛「EXPOSED 里没有 X」。
2. 每修一个 bug，先想「把这行改回去，哪条判据会红」，答不出来就是还没修完。改完做一次**突变**：
   把修复改回缺陷态，确认它真的判红。红要来自断言，不能来自沙箱构建失败。
   去重/合并类改动尤其要补**接线判据**——只测抽出来的新函数、不测原来那几处真的改成调它了，
   等于没守（`gth_logic_test.js` 的 T20 就是这个用途）。

`gth_init_order.js` 守的是一类无头判据看不见、真页面整段报废的缺陷：`var` 只提升声明不提升赋值，
顶层同步代码读到还没赋值的名字会当场抛错，把 IIFE 后半段一起带走。踩过一次，症状是
「操作条、批注栏都在，就是划不了线」——崩点之后的工具条节点、选区 mouseup 监听、一键整理、
批注气球、重练面板全都没执行，看着像站点改版，其实是我们自己的启动顺序。
写「读一遍磁盘库再初始化 store」之外的启动调用时，注意它在文件里的位置必须晚于它间接读到的每个 `var`。

DOM 与站点请求不在判据里，只能在脚本猫里验（本仓库把这两档叫 **L1 只读探测 / L2 端到端**）。
**浏览器环境默认只读**：探测、读 console、跑只读探针脚本由代理自己做；
装脚本、改扩展库、写站点数据（收题、导出、改 localStorage）由用户手动做或先取得授权。

四条从实测来的约束，动工具或跑端到端之前先读：

- **站点模板文本 ≠ 运行时对象**。模板里 `{{ }}` 绑的字段名只是候选名之一，站点会把别的键加工进 scope。
  现例（curl `https://pub.xdtech.top/<ctx>/wxpage/tiku/gongan/analysis/analysis.template.html` 可复算，
  11893 字节）：作答在模板里绑的是下划线 `{{item.user_answer.join(',')}}`，而模考解析页运行时 scope 里
  作答**只有驼峰 `userAnswers`**，模板那个名字在 scope 里根本不存在。`result` 的字样在这个模板里出现 6 次，
  全落在 3 个表达式内——两处 `ng-show` 的可见性判断与一处 `ng-class` 的着色
  `{'undone':item.result== 2,'wrong':item.result == 0}`，判的值只有 `0` 与 `2`，**只证明** `0`=错、`2`=未做；
  `1`=答对要靠真实场次数出来，`correct_answer` 更是列表态压根没有、要逐题额外请求才补得上。
  所以只读模板得到的字段清单当线索，不当证据。
- **扫脚本的尺子有两种假绿**：把最外层 IIFE 的体也遮掉 → 报「同步入口 0 处 / 判定：绿」；
  没把 `function NAME(` 的定义头排掉 → 报「入口 270 处 / 假雷 22 条」。新写一把尺子，
  先问它在这两种切法下各报什么，而不是先问它报得准不准。
- **L2 可以绕开扩展跑**：把本机源码经 `127.0.0.1` serve 出去，在用户已登录的页面里 `eval`，
  只补两个垫片——`GM_addStyle` 插 `<style>`、`GM_xmlhttpRequest` 走 `fetch`，源码一字不改。
  这一环证不了 ScriptCat 自身的加载与 `@match`，那一环只能等用户真贴一次。
  `edge://extensions` 对自动化导航直接返回 Blocked URL，页面里也枚举不到扩展 ID，
  所以「替用户装脚本」这条路结构上不存在，别去试第二次。
- **站点结构可复现，探查产物不入库**：路由模板是公开静态资源、**不需要登录态**，就挂在本文件开头
  那个 base（`…/wxpage/tiku/gongan/`）下面：`index/<page>.template.html`（`error` / `shoucang` 等）与
  `analysis/analysis.template.html`，直接 curl 就得到（现例：`error.template.html` 7020 字节、
  `analysis.template.html` 11893 字节，都是 200）。抓下来的 HTML、min.js、商店版原文都当一次性产物，
  结论写进使用它的那行注释。

## 代码风格

按现有文件的写法走：`var` + `function`，全文零箭头函数、零 `.find`/`.map` 之外的新式语法依赖。
注释只写**为什么**（隐藏的约束、实测来的字段形状、某个 workaround 对付的具体 bug）；
复述下一行代码的注释直接删。同一份说明只留一个权威出处，别在多个文件里各写一遍。

**注入用的类名一律带 `gth-` 前缀，一个不留。** 宿主页面加载了 bootstrap 3.3.7、normalize、
font-awesome 4.7 三套全局样式，它们占着 `.caret` `.label` `.table` `.text` `.close` 这类短名字。
撞上一个，人家的规则就往你的节点上画东西，而你在自己的样式里**只看得见自己那部分**——
现例：`class="caret"` 被 bootstrap 的 `.caret{border-top:4px solid;…}` 画了个实心三角形，
和自家的 Lucide 箭头叠成「两个图标重叠」，为此白改了两轮尺寸才想到查类名。
判据守住了 `.caret` 这一个，其余靠这条规矩。

界面上一共四处「卡片左侧一条粗描边」，都是**有意保留**，设计检查工具每轮都会报它、不用改：
页边批注栏与批注气球是琥珀色 3px，承的是 Word 批注「这条内容属于那段文字」的模型，颜色跟着划线色走；
笔记快照与重练结果项是 2–3px，其中重练那条还按答对 / 答错 / 未做换色，那是状态编码不是装饰。

## 数据与发布

存储顶层键与各字段语义是冻结的契约：`gongan_tiku_helper_<ctx>`，允许**只增字段、只增映射**，
判据是「旧数据缺这个字段时降级成什么」当场说得清（现例：`mockQs[].module`→未分类、
`practiced`→视为未重练）。细节与选型见 `docs/adr/0004`、`docs/adr/0001`。

**版本号（脚本头 `@version`）只在「交付给别人的那一份」变化时递增**，一轮交付只动一次，
不在开发过程中逐 commit 往上追：

- 修复缺陷：第三位 +1（`x.y.Z`）
- 新增能力：第二位 +1（`x.Y.0`）
- 第一位：留给破坏既有数据或读写口径的大改；只增字段不算破坏，因此不动第一位
- 行为等价的改动——简化、去重、注释、判据与工具改动——**不递增**，只写进提交信息

仓库版本领先商店版本是常态：8111 停在哪个版本、什么时候上架，是独立的发布决定。

## git

在当前分支上按路径逐个 `git add`（`git add -A` / `git add .` 会连带别人未完成的改动）。
开提交前先 `git status` 看清索引与磁盘是否一致。
推送、开 PR、force 操作一律单独取得授权。

**本仓库的工作树一律 CRLF，别"顺手改回 LF"。** 本机是 Windows 版 git 的默认配置
（`core.autocrlf=true`，写在 `C:/Program Files/Git/etc/gitconfig`）：`git add` 把 CRLF 归一成 LF
存进对象库，`git checkout` 再还原成 CRLF 写回磁盘——所以磁盘上是 CRLF 时两边始终一致，
`git status` 不报变化（现例：对象库里的脚本 4543 行 CR=0，工作树则是每行一个 `\r`）。
工作树若留 LF，下一次 `git checkout` / `git restore` / `git stash pop` 会把整份文件逐行重写，
而 git 一声不响，等你做逐行比对时满屏都是假差异——10-03 那轮机械 diff 就是这么白跑一次的
（当时的原话：「报的差异全是 CRLF/LF 假信号」）。另一个理由：商店 8111 那份本身就是 CRLF，
拿仓库与商店版比对时同端换行符才比得动。新增文件也按 CRLF 存。
（三件判据工具实测扛得住 CRLF：同一份脚本转成 CRLF 后判据仍全过、启动顺序仍判定绿。）
一条会吓到你的现象：把整批文件一次性转成 CRLF 后，`git status` 会把它们**全报成已修改**，
但 `git add` 之后索引与 HEAD 一字不差、状态归零——那只是 stat 缓存，不是内容差异。
