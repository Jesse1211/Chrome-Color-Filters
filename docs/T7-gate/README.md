# T7 REAL_STACK_GATE —— 端到端验收:复现方法、负向对照与结果

> 本目录是 **T7(端到端验收)** 的真实栈门禁。DESIGN.md §6 的 T7 gate 分
> **【新增】**(只在 T7 才首次被真正验证)与 **【回归】**(上游验过,
> 在合并后的完整系统上重跑)两类。本目录只放【新增】的脚本;
> 【回归】复用 `docs/T4a-gate/`、`docs/T4b-gate/`、`docs/T5-gate/`、
> `docs/T6b-gate/` 已有的脚本,**不重写**。
>
> 全部脚本跑在 **`npm run build` 产物**(`.output/chrome-mv3/`)上 —— **ADR-038**。

## 0. 前置与复现

```bash
# 门禁依赖(puppeteer-core / pngjs)与 Chrome for Testing 的位置
export NODE_PATH=/private/tmp/ff-wt4/gatedeps/node_modules

# 🔴 必须先清空重建 —— 陈旧 .output 曾让门禁在一个**已被删除的滤镜模式**上报 PASS
rm -rf .output && npm run build
ls .output/chrome-mv3/filters | wc -l            # 必须是 101(ADR-075 后)
ls .output/chrome-mv3/filters | grep -c redgreen # 必须是 0

# 【新增】条款(本目录)
# 先打包两个门禁专用探针(见 §2):
#   - ccf-repo-probe.{js,html} + -boot.js  → 「绕过 UI」的仓储层(INV-14)
#   - ccf-glob-probe.iife.js               → 产品自己的 matchGlob(INV-10)
# 二者都**不进产品**:不在 manifest 里、不被产品代码引用,
# `npm run build` 清空 .output 时一并消失(已实测验证)。
node docs/T7-gate/build-probe.mjs
node docs/T7-gate/inv6-e2e.cjs             # INV-6 端到端:UI 建规则 → 实际渲染
node docs/T7-gate/inv10-pathological.cjs   # INV-10 病态模式在真实页面加载路径上
node docs/T7-gate/lock-e2e.cjs             # 🔒 锁定端到端(含真实 ~2 分钟等待到期)
node docs/T7-gate/persist-concurrency.cjs  # 持久化(ADR-010)+ 并发安全(ADR-071)
node docs/T7-gate/csp-fidelity.cjs         # CSP 无关性(ADR-075)+ 灰阶强度档保真
node docs/T7-gate/inv9-network.cjs         # INV-9 (c) 真实 Network 录制

# 【回归】条款(上游脚本原样重跑)
node docs/T4a-gate/geometry.cjs    docs/T4a-gate/styles.cjs
node docs/T4a-gate/flicker.cjs     # 🔴 RUNS 默认 5,**验收必须是 5,不得下调**
node docs/T4a-gate/multitab.cjs    # 🔴 同上
node docs/T4a-gate/inv8.cjs        docs/T4a-gate/declarative.cjs
node docs/T4a-gate/liveupdate.cjs  docs/T4a-gate/modes.cjs
node docs/T4b-gate/liveness.cjs    docs/T4b-gate/preview.cjs
node docs/T4b-gate/noninvasive.cjs docs/T5-gate/tabstate.cjs
node docs/T6b-gate/editview.cjs

# INV-9 的 (a)(b) 两条静态断言 —— ⚠️ 必须用 verbose 确认它们真的**跑了**
npx vitest run tests/t4b-static-gates.test.ts --reporter=verbose
```

> **🔴 `out/` 才是本轮结果。** 各目录下的 `evidence/` 是**此前提交**的副本,
> 其中部分已过时(`T4a-gate/evidence/styles.json` 生成于存活性落地**之前**,
> 与当前输出直接矛盾)。读结论一律看 `out/`。

## 1. 结果

### 【新增】

| 条款 | 结果 | 关键证据 |
|---|---|---|
| **INV-6 端到端**(UI 建规则 → 实际渲染) | **PASS 9/9** | `[x.com@100, *@30]` 全程经 popup UI 创建 → x.com 实测 `grayscale(1)`、example.com / hn 实测 `grayscale(0.3)` |
| **INV-10** 病态模式(100 个 `*`)在真实加载路径 | **PASS 23/23** | 在**扩展的 isolated world**(content script 真正运行处)直接测**产品自己的** `matchGlob`:100 个 `*` **0.25µs/次**、对照单个 `*` 0.05µs/次;负向对照 `/^(a*)*b$/` 单次 **12 837ms** |
| **🔒 锁定端到端**(INV-11/12/13/14) | **PASS 40/40** | 主开关 OFF 启动锁定 → 自动 ON;10 条绕过 UI 的写入全被拒且全字段未变;延长 +60s 成功;**真退出重启**后 lockUntil 原值不变、剩余 115.9s;真实等待到期后恢复可写 |
| **持久化(ADR-010)** | **PASS 11/11**(与并发条款同脚本) | 3 条规则经 UI 建好 → 完全退出重启 → 磁盘与 popup 列表顺序、强度逐字段完好 |
| **并发安全(ADR-071)** | **(同上脚本)** | 两种相位各 8 轮,用户写入 8/8 保留;持久化键集恒为 `[lockUntil, masterEnabled, rules, version]` |
| **CSP 无关性(ADR-075)** | **(与保真同脚本,18/18)** | hn 带 CSP(`default-src 'self'`)下 `grayscale(1)` 生效、全图 maxSpread **0**(基线 255)、**零 violation** |
| **灰阶强度档保真** | **PASS 18/18** | 0/1/7/30/50/55/99/100 的 computed filter 与 `grayscale(n/100)` **逐位一致**;像素极差 178→89→0 单调;0 档与无滤镜态**同页截图逐字节相同** |

### 【回归】

| 脚本 | 结果 |
|---|---|
| `geometry`(INV-1) | **PASS** — fixed/sticky 位移 dx=dy=0;滤镜态 spread 0 / 基线 255 |
| `styles`(INV-1) | **PASS** — 可归因差异 0 处(github/wikipedia/hn 共约 9600 元素);`removalEffective` 探针有效(`grayscale(1)`→`none`) |
| `flicker`(INV-3) | **PASS,连续 5 轮全绿**(`runs: 5`)— coldCache/newTab/restart/hot 四态 0 带色帧;基线 352–453 带色帧 |
| `multitab`(INV-3 多标签页) | **PASS,连续 5 轮全绿** — 每轮 **10/10 标签页被观测** + 基线对照成立 |
| `inv8`(INV-8) | **PASS** — `everOn=false`,注册为空;对照 `everOn=true` |
| `declarative`(ADR-062/064/065) | **PASS** |
| `liveupdate` | **PASS** |
| `modes`(INV-2 / ADR-075) | **PASS** — CSP 站点上灰阶像素真生效、零 violation |
| `liveness`(INV-5) | **PASS** — react.dev / vuejs.org 站内跳转后滤镜仍在 |
| `preview`(ADR-049) | **PASS 17/17**(修了一处陈旧固定值,见 §3) |
| `noninvasive`(INV-1 交互 + ADR-016 iframe) | **PASS** |
| `tabstate`(T5 / INV-4 / ADR-044) | **PASS 30/30** |
| `editview`(T6b) | **PASS 36/36**(修了一处陈旧固定值,见 §3) |
| INV-9 (a)(b) 静态断言 | **PASS 19/19,verbose 确认全部执行、零 skip** |
| INV-9 (c) Network 实测 | **PASS 13/13**(归因逻辑被重写,见 §4) |
| 单测 / `tsc --noEmit` / `eslint` | **1007 passed / 0 / 0** |

## 2. 「绕过 UI 的写入」通道 —— `build-probe.mjs`

INV-14 / ADR-055 的原文是「**绕过 UI 的写入(如从 service worker 或控制台
发起)同样必须被拒绝**」。而 T3 当年是**人工**门禁,原文还留了一句
「若无法 import,等价地确认 UI 层之外的写入路径同样被拒」——
也就是说**这条路径此前从未被机械验证过**。T7 用这个探针把它钉死。

- `probe/repo-probe.src.ts` import 的是**产品自己的**
  `src/storage/settings-repository.ts`,不是替身;
- 由 `build-probe.mjs` 用仓库自带的 rolldown 打包进
  `.output/chrome-mv3/ccf-repo-probe.js`(**不新增依赖**);
- 承载页 `ccf-repo-probe.html` 走**外部**模块脚本 ——
  扩展页面的 CSP 是 `script-src 'self'`,内联 script 会被静默拦掉
  (实测踩过:页面 200、探针没装上);
- **它不可能溜进发布包**:不在 manifest 里、不被任何产品代码引用,
  且 `npm run build` 清空 `.output` 时一并消失(已实测验证)。

**为什么是扩展页面而不是 service worker**:HTML 规范**禁止**
`ServiceWorkerGlobalScope` 上的动态 `import()`(实测报错
`import() is disallowed on ServiceWorkerGlobalScope`),MV3 的 SW 又是
classic script、不能 `importScripts` 一个 ESM。换成扩展页面不削弱门禁:
同 origin、同 `chrome.storage.local`、调用产品那一份仓储层,
且**完全不经过任何 popup UI 组件**(没有 React、没有 RuleListView、
没有 useLockState)—— 「UI 置灰」在这里物理上不存在。

## 3. 本轮改动过的【回归】脚本(两处,均为**陈旧固定值**,条款数未减)

两处红灯都不是产品缺陷,而是门禁引用了 **ADR-075 已删除的滤镜模式**。

| 脚本 | 改动 | 条款数 |
|---|---|---|
| `T4b-gate/preview.cjs` | 预览态 fixture 由 `mode:'BlueYellow'` 改为 `Grayscale@20` | **17 → 17** |
| `T6b-gate/editview.cjs` | 遮蔽场景 1 号规则由 `('*.org','BlueYellow',100)` 改为 `('*.org','Grayscale',40)`,并把 5c 判据**收紧**为精确等于 `grayscale(0.4)` | **38 → 38** |

**各自的证明,而不是「我觉得测试错了」:**

- **preview**:产品的 `coercePreviewMessage` 刻意**原样校验** `mode`、
  不做默认回退(其注释写明:把拼错的 mode 静默变成 Grayscale 会让契约不符
  表现为「预览总是灰阶」,比「无反应」更难诊断)。ADR-075 之后
  `'BlueYellow'` 不再是合法 mode,于是这条预览消息被**正确地拒绝**,
  页面停在规则值 `grayscale(0.7)` —— 前置断言「断开前确处于预览态」因此失败。
  红灯的来源是门禁发了一个已不存在的模式。
- **editview**:1 号规则的 `'BlueYellow'` 经 `coerceFilterMode` 的
  **读时收敛**(ADR-075 的迁移口,对未知 mode 回退 `Grayscale`)变成
  `Grayscale@100` —— 与 0 号**逐字相同**。于是 5c
  「一键修复 → 当前页面渲染立即变成该规则的滤镜」在**结构上不可能观测到变化**,
  判据 `afterFix !== 'grayscale(1)'` 必然失败。改用强度区分后实测
  `grayscale(1)` → **`grayscale(0.4)`**,条款**比修之前更强**
  (从「不等于某值」变成「精确等于期望值」)。

> 两处都符合「行为不再存在于产品中才可改」这条红线:被改掉的是
> **第二个滤镜模式**这个已被 ADR-075 删除的东西,而**条款本身一条未减**。
> 用强度区分两条规则也正是 DESIGN.md §6 T7 gate 自己的措辞:
> 「ADR-075 后只有一个模式,用强度区分」。

## 4. INV-9 (c) 的归因逻辑被重写 —— 第一版是**恒真的空转探针**

第一版判「这条请求是不是扩展发的」只看 `initiator.url` 与
`initiator.stack.callFrames[].url` 里有没有扩展 id。**实测证明它永假**:
从扩展的 isolated world 里发出的 fetch,CDP 给的 callFrame 是

```
{ functionName: "", scriptId: "8", url: "", lineNumber: 0 }
```

—— **`url` 是空串**。于是 `fromExtension` 恒 `false`,
「零条扩展发起的外传」在**任何**情况下都通过,包括扩展真的在外传时。

正解是按**执行上下文**归因:同时开 `Runtime` / `Debugger`,维护
`scriptId → executionContextId → context.origin` 两张映射;
扩展 content script world 的 `origin` 就是 `chrome-extension://<id>`。
实测该通道把注入的外传判为 `{byContext: true, byUrl: false}` ——
**这组数字本身就是第一版空转的证据**。

另外两个被实测纠正的坑:

- **N1 不能在带 CSP 的站点上做**:第一版在 hn 上注入外传,
  被 `default-src 'self'` 在**网络层之前**拦掉,录制器什么都没抓到
  (`recorded: 0`)—— 于是「录制器在工作」根本没被证明。改到 example.com
  (实测无 CSP)后:录制到 1 条 + 哨兵服务器确实被打到 1 次。
- **必须跟踪执行上下文的销毁**:`reload` 之后旧的 isolated world 已不存在,
  对着它 `Runtime.evaluate` 报 `Cannot find context with specified id`,
  而第一版把这次失败只记进 `evalError`、断言却去看「有没有录到请求」——
  报出的是一条**误导性**的红(看起来像产品没发请求,其实是门禁挑错了上下文)。
  现在 `executionContextDestroyed` / `executionContextsCleared` 都跟,
  且 evaluate 失败**当场判红**。

## 4bis. 🔴 两条判据因**不可复现**被重做(连跑两次结论相反)

> 本轮把每个门禁至少跑了两遍。**凡是两次结论不一致的判据,一律视为不成立** ——
> 一个随机的绿和一个随机的红,证据价值都是零。

### (1) INV-10 的「判据 A」:从挂钟首帧改为**直接测匹配函数**

原判据是「病态组 `firstPaint` 中位数 − 对照组中位数 < 阈值」。
同一提交连跑两次,hn 的对照组原始样本是 **[292, 568, 468, 1184, 1112]ms**
—— 组内极差 892ms,已经吞没了被测量本身。于是 Δ 的符号完全由当次网络抖动
决定:一次 Δ=−28ms 判绿,一次 Δ=+588ms 判红。**两次都不构成证据。**

真实站点的首帧里网络与服务端耗时占绝对主导,匹配函数那点开销在它下面
根本测不出来。改为**直接测被怀疑的那段计算**:

- 在**扩展的 isolated world**(content script 真正运行的那个上下文)里
- 跑**产品自己的** `matchGlob`(由 `build-probe.mjs` 从 `src/domain/glob.ts`
  打包成 `ccf-glob-probe.iife.js`,**不是手抄** —— 产品的 `matchGlob` 在
  `matchGlobStrict` 之外还按 ADR-006 的省略规则最多再调 3 次,
  抄一份就是在测另一个算法且会静默漂移)
- 各 20 万次,取单次耗时

实测:**100 个 `*` → 0.25µs/次**,对照单个 `*` → 0.05µs/次。
负向对照(N5)在同一页面同一计时框架下跑 `/^(a*)*b$/` 对 30 个 `a`:
**单次 12 837ms** —— 与病态 glob 相差约 **5×10⁷ 倍**。
这条对照证明该计时确实能把「回溯」和「线性」分开。

挂钟首帧观察**降级为 INFO**,只保留一条很宽的兜底(判据 A-1:首帧 < 10s)
用于抓「秒到分钟量级」的灾难性回溯。

> 配套的 N3(证明挂钟计时对拖慢敏感)也改成**同一轮内配对 3 次取中位差**
> —— 原先拿注入阻塞的那次去比几分钟前的中位数,同样被抖动打败过一次
> (中位 1140ms vs 阻塞 1008ms)。改配对后 3 次复跑的中位差为
> 700/692/712ms(hn)与 780/952/648ms(wiki),稳定复现注入的 700ms。

### (2) 保真度的「0 档恒等」:从跨时刻比基线改为**同页配对**

原判据拿 0 档的像素极差去比**几分钟前**拍的无滤镜基线,容差 ±8。
第二次运行报红(202 vs 178)—— 原因是 **Wikipedia 自己的页面内容在两次加载
之间变了**(首页模块/图片轮换),不是 0 档没做恒等变换。
拿两个不同时刻的页面比像素,测的是站点的内容波动,不是滤镜。

改为**同一轮、同一页面**内的配对:在 0 档那个页面上用产品自己的关闭路径
(设 `data-ccf-off`,由 `filter.css` 压回 `none`)再拍一张,
两张截图必须**逐字节相同**。实测 `identical: true`
(`grayscale(0)` vs `none`,spread 均为 178)—— 这才是「恒等变换」的定义,
且比原判据**更强**。

### (3) CSP 负向对照读不到响应头

第二次运行时 hn 的主文档走了缓存,`resp.headers()` 里没有
`content-security-policy`,于是「该站确实带 CSP」报红。
这是**读法**问题,不是站点撤了 CSP。修法:`setCacheEnabled(false)`,
外加一条 `fetch(url, {cache:'reload'})` 的兜底。

## 5. 🔴 每条探针的负向对照(probe validity)

「一个什么都没观测到的探针,和一个什么都没发现的探针,输出一模一样。」
本项目已出过四次假绿,故**每条**判据都必须配一个能让它变红的对照。

| 判据 | 负向对照 | 实测对照值 |
|---|---|---|
| INV-6:x.com 得 100 档 | **N1 把两条规则顺序颠倒**,x.com 必须改判 30 档 | `grayscale(1)` → **`grayscale(0.3)`** ✅ 判据确实取决于「首个命中」 |
| INV-6:100 档不是页面自带 | **N2** 无规则时 x.com | `none` ✅ |
| INV-6:两档可区分 | **N3** 100 档 vs 30 档逐位比 | `grayscale(1)` ≠ `grayscale(0.3)` ✅ |
| INV-10:匹配是线性时间 | **N5 同页跑一个会回溯的正则** `/^(a*)*b$/`(§8 第 6 条点名禁止的写法) | 病态 glob **0.25µs/次** vs 回溯正则 **12 837ms/次**,相差 ~5×10⁷ 倍 ✅ 计时能区分回溯与线性 |
| INV-10:挂钟首帧计时(INFO 通道)有效 | **N3 同一轮内配对 3 次**注入 700ms 阻塞 | 中位差 700/692/712ms(hn)、780/952/648ms(wiki)✅ 稳定复现注入量 |
| INV-10:测的是**产品的**实现 | **N4** 测量必须在扩展 isolated world 里成功执行且匹配结果正确;失败**当场判红** | `matched: true`,`iterations: 200000` ✅ 不是「什么都没测到」 |
| INV-10:病态 pattern 真的在被用 | **N1** 断言 100 个 `*` 确实落盘且滤镜确实生效 | `storedLen=100`,`grayscale(1)` ✅ 非空转 |
| INV-10:测到的时间非零 | **N2** firstPaint 必须 > 0 | 控制 372ms / 病态 344ms ✅ |
| 锁定:锁定中写入被拒 | **N1 锁定之前**同样三个写入必须**成功** | addRule/setMasterEnabled/setLockUntil 全 `ok:true` ✅ 不是「这些调用本来就不工作」 |
| 锁定:不是「一律拒绝一切」 | **N2** 锁定中**延长**必须成功 | lockUntil +60000ms ✅ |
| 锁定:拒绝确实来自锁 | **N3** 到期后同样三个写入**重新成功** | 全 `ok:true` ✅ |
| 锁定:存的是绝对时间 | **N4** 重启后剩余必须**小于**重启前 | 119179ms → **115946ms**(差 3233ms = 重启耗时)✅ 不是重新变回 2 分钟 |
| 锁定:到期后 UI 可编辑 | **N5 重新锁上**,同一组读数必须**全部翻转** | `hasBanner/locked/masterDisabled/addRuleDisabled` 四项全翻 ✅ 不是恒真 |
| 并发:用户写入没被吃掉 | **N1 判别器** —— 在同一交错下显式复现「旧实现形状」的整体回写,它**必须**吃掉写入 | **8/8 轮吃掉**(产品 8/8 轮保留)✅ 这是全门禁最硬的一条:同一时序下旧形状必丢数据、产品必不丢 |
| 并发:无 `maxSeenTime` 字段 | **N2** 先人为塞一个,键集断言必须看见 | 塞入后键集含 `maxSeenTime`;经仓储层写一次后消失 ✅ |
| CSP:零 violation | **N3** 必须确认 hn 响应头**真的**带 CSP | `default-src 'self'; script-src …` ✅ 不是「因为没有策略」 |
| CSP:像素真的变灰 | 基线(无规则)必须**彩色** | hn 基线 maxSpread **255** → 滤镜态 **0** ✅ |
| 保真:0 档是恒等变换 | **N1 同页配对**:0 档截图 vs 同一页面上压制滤镜后的截图,必须**逐字节相同** | `identical: true`(`grayscale(0)` vs `none`,spread 均 178)✅ |
| 保真:强度是连续量 | 50 档必须严格介于 0 与 100 之间 | 178 → **89** → 0 ✅ 不是开/关两态 |
| INV-9:零扩展外传 | **N1** 录制器必须抓到人为注入的外传 | 录到 1 条 + 哨兵被打中 1 次 ✅ |
| INV-9:归因不是恒假 | **N2** 从扩展 isolated world 发 fetch,必须被判 `fromExtension` | `{byContext:true, byUrl:false}` ✅(见 §4) |
| INV-3 flicker | `off` 基线必须抓到带色帧 | 352–453 / 355–455 帧带色 ✅ |
| INV-3 multitab | 基线:样式通道 10/10 报未滤镜 + 像素通道抓到带色帧 | 每轮成立 ✅ |
| INV-1 styles | `removalEffective`:移除必须真把 computed filter 变成 `none` | `grayscale(1)` → `none` ✅(此前这条判据曾是 `grayscale(1)` vs `grayscale(1)` 的恒真比较) |

## 6. 🔴 blindSpots —— 未覆盖的站点类型与场景(显式申报)

DESIGN.md §8 第 10 条:空的或敷衍的申报等同于门禁失败。

### 6.0 复跑纪律(本轮的做法,供后人沿用)

每个门禁**至少跑两遍**,两次结论不一致的判据一律重做(见 §4bis,本轮因此
重做了两条)。但**两遍不等于证明了稳定** —— `inv10` / `csp-fidelity`
各复跑了 3 次与 2 次,`lock-e2e` 跑了 3 次,其余脚本各 2 次。
更低频的抖动(如站点改版、CDN 切换)**不在本轮的观测窗口内**。

### 6.1 测量仪器本身的局限

1. **真实工具栏 popup 的「失焦即销毁」语义未被复现。** 本门禁把 popup 作为
   扩展页面打开(T6a/T6b/T6c 的既有口径)—— 同一份文档、同一份 JS、
   同一套 `chrome.*` 权限,但**不是**那个一失焦就被拆掉的弹窗。
   ADR-061 记载的丢写缺陷(popup 销毁时飞在半路的异步写入回不来)
   因此**在真实栈里没有被 T7 覆盖**。现有防线:ADR-061 的静态门禁
   (锁定写入路径上不得有 `setTimeout`)+ `__tests__/lock-teardown.test.tsx`
   + 产品改用 `setLockUntilImmediate`(同一轮就发出 `storage.set`)。
   **这是本轮最值得补的缺口。**
2. **popup 的 tabState 必须靠「另开一个窗口 + 让网站窗口保持 last-focused」
   才指向真实网站。** 若该技巧在别的平台失效,`notInjectable` 会让规则编辑
   控件正确置灰、UI 路径点不动 —— `lib7.cjs` 已对此**显式抛错**,
   不会退化成「点了没反应」的静默跳过。
3. **`flicker.cjs` 在 news.ycombinator.com 上的像素覆盖很薄:每个场景只有
   2–5 帧**(5 轮一致,run1 无竞争时亦然 → 是站点属性:静态页面、
   合成器只在画面变化时推帧,不是 CPU 饥饿)。该站的 `off` 基线稳定抓到
   3 帧带色,故探针并未失明;但「0/2 帧带色」作为 INV-3 的证据强度
   明显弱于 github 的 0/171。github(171–245 帧)与 wikipedia(82–144 帧)
   承担了该条款的主要证据。`multitab.cjs` 对同一现象的处理更完备
   (三条样式通道强制 10/10 + 像素通道 quorum)。
4. **x.com 只能在 headful 下测。** 新 headless 的 Chrome for Testing 访问
   x.com 返回 **HTTP 403**(机器人识别),页面变成
   `chrome-error://chromewebdata/` —— 浏览器错误页,**任何**扩展都注入不进去。
   故 `inv6-e2e.cjs` 用 headful。headful 在本机不产合成帧
   (见 `T4a-gate/lib.cjs` 的长注释),所以**该脚本不含任何逐帧像素判据**,
   只用 computed filter。**x.com 上的零闪烁(INV-3)因此未被逐帧验证。**
5. **到期测试只覆盖「1 分钟锁」。** UI 的最小时长单位是分钟
   (ADR-058 刻意没有 `'second'`),故等待到期是一次真实的 ~2 分钟挂钟等待。
   **长时锁(数小时/数天)的到期未被端到端验证** —— 它与 1 分钟锁走的是
   同一条绝对时间戳判定,差异只在数值。

### 6.2 未覆盖的站点类型

6. **未测:需要登录态的页面**(x.com 以未登录首页测)、**单页应用的深层
   路由跳转**(只测了 react.dev / vuejs.org 的一跳)、**`<iframe>` 深层嵌套
   与 `sandbox` 属性的组合**、**Shadow DOM 密集的站点**(如 YouTube 的
   Polymer 组件树)、**`<canvas>` / WebGL 为主体的页面**、
   **PDF 查看器与 Chrome 应用商店**(ADR-013 已识别为不可注入,
   但未在 T7 做像素验证)、**`file://` 页面**、**非 HTTP(S) 协议**。
7. **未测:中文/CJK 与 RTL 站点的视觉正确性。** 灰阶是逐像素变换、
   与文字方向无关,但 popup UI 自身在 RTL 下的布局未验。
8. **未测:`prefers-color-scheme: dark` 的站点与扩展的交互。**
   灰阶叠加在暗色模式上的观感未做主观评估(ADR-075 的研究结论里
   「暗色模式」是另一类方案)。
9. **未测:超长规则列表(接近 20 条上限)下的首帧性能。**
   INV-7 的上限在单元层验过,但「20 条规则 × 20 个注册」对导航期
   match pattern 求值的开销未实测。
10. **未测:多 profile / 多 Chrome 实例同时装本扩展。**
    ADR-010 改用 `storage.local` 后跨设备同步已不在范围内
    (DESIGN.md 明文「无需第二个 Google 账号」),但同机多 profile 未试。

### 6.3 已知且已被产品负责人接受的代价(不是本轮新增的盲点)

11. **`inexpressible` 的 glob 走不到声明式首帧路径**(尾部 `.*` 如
    `*.baidu.*`、中缀 `*` 无字面后缀如 `*weibo*`)。这类规则在首次导航到
    匹配站点时有一个未滤镜的首帧 —— `match-pattern.ts` 已详尽论证
    「一个有界的缺口 vs 一个无界的违规」,并由 `flicker.cjs` 的
    `unmatchedHostRun` 守住「未匹配站点绝不被上色」这一侧。
12. **系统时钟被拨慢会让锁定意外变长**(ADR-052/ADR-071 已接受:
    改时钟绕过锁定本就允许,扩展不做防范)。
13. `flicker.cjs` 的 `unmatchedHostRun` 仍播种 `rule('*weibo*','RedGreen',60)`
    —— `'RedGreen'` 已被 ADR-075 删除。**该处不构成假绿**:
    `coerceFilterMode` 把它收敛为 `Grayscale`,两条 glob 都是
    `inexpressible` 故都不注册,断言「未匹配站点不得上色」语义不变。
    属**文字陈旧**,本轮刻意未改(改它等于改一条正在正确工作的回归断言的输入)。
