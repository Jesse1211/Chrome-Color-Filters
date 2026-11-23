# T7 端到端验收 —— 复现方法、结果与 blindSpots

> §6 T7:「覆盖全部不变式的端到端验证,在真实 Chrome + 真实网站上运行。
> 这是唯一能证明『系统真的能跑』的关卡 —— 各任务的单元门禁不自动组合成整体保证。」
>
> 全部脚本跑在 **`npm run build` 产物**(`.output/chrome-mv3/`)上 —— **ADR-038**。

---

## 🔴 门禁状态:**未全绿 —— 一条真实产品缺陷,需人类裁定架构**

| | |
|---|---|
| 【新增】5/6 门禁 | **PASS**(inv6-e2e 13/13、inv7-capacity 12/12、lock-e2e 42/42、persistence 13/13、inv10-pathological 9/9) |
| 【新增】`visual-modes` | 🔴 **FAIL** —— 根因**已闭合**,是**产品缺陷**,非门禁缺陷、非平台闪烁。⚠️ 红灯条数逐轮浮动(实测 34/40 与 38/40),因为 HN 偶发返回**不带 CSP** 的 503/缓存响应 |
| 🆕 `csp-matrix`(本轮新增) | 🔴 **FAIL 23/26,且完全确定**(连跑两轮逐位相同)—— 把同一根因搬到**本机固定 CSP 响应头**的 fixture 上,不再依赖第三方站点的策略。**因果锁定断言 PASS** |
| 【回归】 | 全部 PASS(`styles` 的「残留」子项是**上游 T4a 门禁脚本**自身与 INV-5 自愈赛跑,见文末) |

**缺陷一句话**:站点的 `Content-Security-Policy` 的 `img-src` 把扩展的
`filter: url("data:image/svg+xml,…")` **滤镜资源当图片拦掉**,于是在
`news.ycombinator.com` 这类未放行 `data:` 的真实站点上,
**三种色觉辅助模式(ADR-002 的主业)全部静默失效**;`Grayscale` 不受影响。

**为什么没修**:修复必须推翻 **ADR-063** 或新增权限并触碰 **ADR-026** 的隐私底线,
而 DESIGN.md 与全部 ADR **零处提及 CSP**。按 DESIGN.md §8 第 1 条停下上报。
**未改产品代码、未放宽断言、未剔除 HN。** 详见
[「六条红灯」](#-visual-modes-的六条红灯根因已闭合--站点-csp-拦掉-data-uri-滤镜资源)。

---

## 复现

```bash
# 0) 前置(与 docs/T4a-gate/README.md 完全一致)
npm ci
npm run build
cd docs/T0-spike/spike-code
echo '{"name":"ccf-gate-deps","private":true,"version":"0.0.0"}' > package.json
npm i --no-save puppeteer-core@23 pngjs
npx @puppeteer/browsers install chrome@158.0.8127.36
cd ../../..
ln -sfn ../T0-spike/spike-code/node_modules docs/T7-gate/node_modules

# 1) 仓储层探针(INV-14 需要「绕过 UI 调仓储层」,见 build-probe.mjs 的论证)
node docs/T7-gate/build-probe.mjs

# 2) 【新增】四项 —— T7 存在的核心理由
node docs/T7-gate/inv6-e2e.cjs            # INV-6 端到端:UI 建的规则 → 实际渲染
node docs/T7-gate/inv10-pathological.cjs  # INV-10 真实加载路径上的病态模式首帧耗时
node docs/T7-gate/lock-e2e.cjs            # 🔒 INV-11/12/13/14/15 端到端(含真实重启 + 真实到期)
node docs/T7-gate/persistence.cjs         # ADR-010 持久化(完全退出并重启)
node docs/T7-gate/visual-modes.cjs        # 四个滤镜在真实网页上的视觉证据(留档供人类复核)
node docs/T7-gate/inv7-capacity.cjs       # 【回归】INV-7 第 21 条被拒(此前无任何真实栈覆盖)
node docs/T7-gate/csp-matrix.cjs          # 🆕 根因:站点 CSP img-src 拦 data: URI 滤镜(确定性复现,预期判红)

# 3) 【回归】上游门禁在合并后的完整系统上重跑
node docs/T4a-gate/geometry.cjs     # INV-1 几何
node docs/T4a-gate/styles.cjs       # INV-1 计算样式
node docs/T4a-gate/flicker.cjs      # INV-3 零闪烁
node docs/T4a-gate/multitab.cjs     # INV-3 冷启动 + 会话恢复 + 多标签
node docs/T4a-gate/liveupdate.cjs   # 已打开标签页的实时更新
node docs/T4a-gate/declarative.cjs  # ADR-062/064/065 声明式注册
node docs/T4a-gate/inv8.cjs         # INV-8 主开关
node docs/T4a-gate/modes.cjs        # 四模式像素级生效
node docs/T4b-gate/liveness.cjs     # INV-5 SPA 存活性
node docs/T4b-gate/noninvasive.cjs  # INV-9 隐私三项机械判定
node docs/T5-gate/tabstate.cjs      # INV-4 / ADR-044
node docs/T6b-gate/editview.cjs     # Popup 编辑视图
```

## 结果

### 【新增】

| 门禁 | 结果 | 要点 |
|---|---|---|
| **inv6-e2e** | **PASS (13/13)** | 两条规则**全程经真实 popup UI 建立** → wikipedia 得 `grayscale(1)`、example.com 得 B/Y 矩阵;顺序即优先级(ADR-008)落盘正确;**反向确认**:删掉专属规则后 wikipedia 改由通配规则生效。同时端到端验了 INV-2(渲染出的 filter 函数**恰好一个**) |
| **inv10-pathological** | **PASS (9/9)** | 101 条规则(100 条 `*`×100 + 1 条命中)vs 1 条基线,**真实 wikipedia 加载路径**上 FCP 中位数 **312ms vs 316ms(1.114×)**;绝对 < 5000ms;声明式注册塌缩为 **1 条**(未按规则数膨胀) |
| **lock-e2e** | **PASS (42/42)** | 主开关 OFF 下启动锁定 → **ADR-057 原子开启主开关**且真实页面真的上色 → 改规则/关主开关/缩短/解锁**全被拒(`kind:'locked'`)**、延长**成功** → **真实进程退出 + 重启** → 锁定仍强制、剩余按绝对时间递减 → **真实等待到期** → 自动解锁、设置可改、UI 翻回 |
| **persistence** | **PASS (13/13)** | 5 条规则经 UI 建立 + 一次经 UI 重排 → **完全退出 Chrome** → 规则与**顺序逐字完好**;ADR-025 键集未污染;重启后规则**真的仍在生效**(数据完好 ≠ 行为完好);ADR-062 注册跨重启存活 |
| **inv7-capacity** | **PASS (12/12)** | 【回归】但**此前无任何真实栈门禁**覆盖:第 21 条被仓储层拒绝,结构化错误 `kind:'other'` + `reason:'capacity-exceeded'`(逐字核对 `errors.ts`),原 20 条**一字未动**(ADR-012);UI 容量提示文案逐字符合、「新建」入口禁用、`20/20` 计数;删一条即可再加(闭环) |
| **visual-modes** | 🔴 **FAIL**(committed 证据本轮为 **38/40**;上一轮同一 head 为 34/40)— 红灯**全部在 HN**,根因已闭合:**站点 CSP `img-src` 拦掉 data: URI 滤镜资源**,是**真实产品缺陷**,见下。⚠️ **条数不可当稳定指标**:HN 偶发返回不带 CSP 的 503/缓存响应,故红灯数逐轮浮动 —— 确定性版本见 `csp-matrix` | wikipedia 四模式**首次导航即全过**;Grayscale 真实网页 `maxSpread=0`(不受影响,CSS 内建函数);三辅助模式在 wikipedia 保有色彩且用内联 data: URI。截图 + 人类复核索引见 `evidence/visual-modes.md` |

### 🔴 `visual-modes` 的六条红灯:根因**已闭合** —— 站点 CSP 拦掉 `data:` URI 滤镜资源

> ⚠️ **本节推翻了上一轮的结论。** 上一轮在此写的是「本 headless Chrome 构建在该
> 站点上的合成/光栅化非确定性,与扩展代码路径无关」。**那个归因是错的** ——
> 它把一条真实缺陷包装成了一句无法证伪的平台猜想。本轮已定位到确切根因。

**现象**:在 `news.ycombinator.com` 上,三种色觉辅助模式的确定性色块**像素完全未变**,
而 `getComputedStyle(html).filter` **始终**是正确的 data: URI。

**根因(Chrome 自己给出的错误信息)**:

```
securitypolicyviolation:
  effectiveDirective: "img-src"
  disposition:        "enforce"
  originalPolicy:     "… img-src 'self' https://account.ycombinator.com …"

Log(security): Loading the image 'data:image/svg+xml,…#f' violates the following
  Content Security Policy directive: "img-src 'self' https://account.ycombinator.com".
  The action has been blocked.
```

HN 的文档响应**每次 GET 都带** CSP 头,其 `img-src` **不含 `data:`**。
Chrome 把 `filter: url("data:image/svg+xml,…")` 的资源加载**按 `img-src` 管**,
于是滤镜资源被拦截:属性全都设上了(产品代码没错),但滤镜**没有可用的资源**,
像素因此完全未被变换。

> 📌 **上一轮为什么漏掉它**:`curl -I`(HEAD 请求)**不返回** HN 的 CSP 头,
> 只有 GET 才返回。本轮改用页内 `securitypolicyviolation` 事件 + CDP `Log` +
> `Network.responseReceived` 三路交叉验证才抓到。

**受控实验**(同一页面、同一会话,唯一变量是**滤镜的来源形式**):

| # | 滤镜来源 | 像素 |
|---|---|---|
| 1 | 产品注入的 data: URI | **未变** |
| 2 | 手写**同一条** data: URI 到 `html` | **未变** |
| 3 | 手写 `grayscale(1)`(CSS 内建函数,无外部资源) | **变了** |
| 4 | 手写 `url(#id)` 指向**页内内联 `<svg>`**(同源,不受 img-src 管) | **变了** |
| 5 | 同一条 data: URI 挂 `body` 而非 `html` | **未变** |

→ 失效与元素、与挂载时机、与 quirks 模式、与合成时机**全都无关**,
只与「滤镜资源是不是 `data:` URI」有关。

**它也不是闪烁**:同一次 page load 内连续 6 次读像素(跨 2.4 秒)结果**恒定**;
失败是**每次加载的粘滞二元状态**。上一轮观测到的「逐轮漂移」来自 HN 偶发的
503 / 缓存响应 —— **那些响应不带 CSP**,所以那几次就成功了。
这也解释了上一轮 Tester 那次「重跑就绿」:不是运气,是刚好命中了无 CSP 的响应。

**已排除的其它解释**(每条都有受控实验,见 `visual-modes.cjs` 文件头):

1. **不是钳制不动点。** 主判据色 `#66ff33` 在三个矩阵下逐通道总变化量都 > 130。
   ⚠️ 但**HN 自己的主色确实是不动点**:`#ff6600` / `#ff8800` 在 GreenRed 下
   R 溢出钳到 255、B 负值钳到 0、G 不变 → **像等于原色**;底色 `#f6f6ef` 只变 1/255。
   这解释了「HN 整页看起来几乎没变」,是矩阵的**正确行为**,与本缺陷无关。
2. **不是 quirks 模式。** 受控 A/B(唯一变量是 doctype)证明两者**都正常生效**;
   且 wikipedia 是 standards 模式,其 `default-src` 含 `data:` 故不受影响。
3. **不是 stacking context / `position:fixed`。** 静态流内元素同样未变。
4. **不是陈旧读数。** `data-ccf-on`、`--ccf-filter` 全部在位。
5. **强制重绘无效**(filter 置 `none` 再置回)。

### 🔴 影响面:这是**真实产品缺陷**,不是门禁缺陷

任何设了限制性 `img-src`(或 `default-src`)而**未放行 `data:`** 的站点上,
本扩展的**三种色觉辅助模式全部静默失效** —— 而 daltonization 正是本扩展的
主业(ADR-002)。`Grayscale` **不受影响**(CSS 内建函数,无外部资源)。

站点侧实测对照:

| 站点 | `img-src` / `default-src` 是否含 `data:` | 辅助模式 |
|---|---|---|
| wikipedia | `default-src … data: …` ✅ | **正常** |
| MDN | `img-src 'self' data: …` ✅ | **正常** |
| example.com | 无 CSP ✅ | **正常** |
| **news.ycombinator.com** | `img-src 'self' https://account.ycombinator.com` ❌ | **静默失效** |

「静默」是最糟的失败形态:用户看不到任何报错,只看到扩展「没反应」。

### 🆕 `csp-matrix`:把根因做成**确定性**回归门禁

`visual-modes` 在 HN 上的红灯证据是真实的,但作为**回归门禁**它有两个弱点:

1. **不确定。** HN 偶发返回 503 / 缓存响应,**那些响应不带 CSP** →
   同一条判据逐轮漂移(实测同一天:6 红 / 2 红)。
   **上一轮 Tester 的「重跑就绿」正是撞上了这个** —— 不是运气,
   是刚好命中无 CSP 的响应。
2. **依赖第三方策略。** HN 哪天在 `img-src` 加上 `data:`,
   这条缺陷就**静默地从门禁里消失**,而产品缺陷依然存在。

故新增 `docs/T7-gate/csp-matrix.cjs`:页面与 CSP 响应头**全部本机逐字控制**,
浏览器 / 扩展产物 / 渲染路径仍是真的(DESIGN.md §8 第 8 条)。
本机 HTTP fixture 的手法沿用 `docs/T4b-gate/noninvasive.cjs` 的既定做法。

| CSP 策略 | `img-src` 拦截 | 像素被变换 | 对应真实站点 |
|---|---|---|---|
| 无 CSP | 否 | ✅ 是 | example.com |
| `img-src 'self' data:` | 否 | ✅ 是 | MDN |
| `img-src 'self' https://…` | **是** | 🔴 **否** | **news.ycombinator.com** |
| `default-src 'self'`(无 img-src,回退) | **是** | 🔴 **否** | — |
| `img-src 'none'` | **是** | 🔴 **否** | — |
| `…-Report-Only: img-src 'none'` | 否(只报告) | ✅ 是 | — |

**🔴 因果锁定断言 PASS**:在全部六种策略上,「像素未被变换」与
「CSP 的 `img-src` 以 `enforce` 拦了 `data:`」**严格同真同假**。
唯一变量是响应头里那一行 CSP —— 页面 HTML、滤镜设置、扩展产物、
浏览器、视口逐字相同。这把根因从「相关」钉成**因果**。

两条交叉验证把「归因错误」的可能性压到最低:

- **`Report-Only` 不拦** → 证明是 CSP 的**阻断**行为,不是 URI 解析问题;
- **`Grayscale` 在 `img-src 'none'` 下照常生效**(读到 `[208,208,208]`)
  → 证明渲染/合成路径完好,受影响的**只有**需要外部资源的 data: URI 滤镜。

> ⚠️ **本门禁自己踩过一个坑,已钉死在注释里:** 第一版用 `<style>` 和
> `style="background:…"` 给判据色块上色,结果 `default-src 'self'` 下
> **`style-src` 把内联样式一并拦掉** → 色块没有背景色 → 读到**白色**
> `[255,255,255]`,它既 `!== #66ff33`、又让「像素被变换了」**假绿**。
> 修复:色块改用 `<svg>` 的 `fill` **表现属性**(不受 `style-src` 管),
> 并新增一组「OFF 基线必须**恰好**是判据色」的仪器有效性断言 ——
> 任何策略下 fixture 上色失败都会立刻判红,而非让核心判据空转成假绿。

> 🔴 本门禁**预期判红**:它是缺陷的**确定性复现**,不是「待修复的测试」。
> 修复落地后它应当自动转绿 —— 那正是它作为回归门禁的价值。
> 断言方向**不得**为了让门禁变绿而反转。

### 🔴 为什么本任务**不自行修复** —— needs-human

修复需要一个**本仓库尚不存在的架构决策**。DESIGN.md 与**全部 ADR 零处提及 CSP**。
按 DESIGN.md §8 第 1 条(「任务与 ADR 冲突时**停下并上报**,不得自行发明架构」),
两条候选路线都越界,必须由人类裁定:

- **A. 用 `declarativeNetRequest` 改写站点的 CSP 响应头。** 需要新权限
  (`declarativeNetRequestWithHostAccess`),且「修改站点响应头」与 **ADR-026**
  的隐私底线精神相抵 —— 为了上色而削弱站点自己的安全策略,是产品层面的取舍,
  不是实现细节。
- **B. 改用非 `data:` URI 的滤镜来源(页内内联 `<svg>` 节点)。**
  **直接违反 ADR-063**,且 `filter-css.ts` 文件头记载的两条理由
  (INV-3 零闪烁、不往宿主页面插 DOM 节点 / INV-9+ADR-026)**正是**当初
  否掉该方案的原因。实验 4 证明这条路**技术上可行**(像素确实变了),
  但它要同时推翻 ADR-063 与那两条不变式的权衡。

> 本轮**未改动任何产品代码,未放宽任何断言,未剔除 HN**。
> 剔除 HN 或换站点(上一轮 Owner 列的选项 1 / 2)会**掩盖这条真实缺陷** ——
> HN 不是一个不稳定的测试环境,它是一个**本扩展真的不工作的真实网站**。
> 门禁据此**保持判红**,并新增了**根因断言**
> 「`data:` URI 滤镜资源未被站点 CSP 拦截(img-src)」,
> 使红灯直接指向缺陷本身而非一句平台猜想。

### 【回归】

| 门禁 | 结果 |
|---|---|
| geometry(INV-1) | **PASS** — fixed/sticky 位移 dx=0 dy=0 |
| styles(INV-1) | **真正的 INV-1 判据 PASS**(可归因于滤镜的差异 **0 处 / 9631 个元素**);但「移除后零残留」子项判红 —— **门禁自身与 INV-5 赛跑**,见下 |
| flicker(INV-3) | **PASS(连续 5 轮全绿)** — 四场景 0 带色帧,基线证明探针有效 |
| multitab(INV-3) | **PASS(连续 5 轮全绿)** — 冷启动 + 会话恢复 + 10/10 标签页被观测 + 基线对照成立 |
| liveupdate | **PASS** |
| declarative(ADR-062/064/065) | **PASS** |
| inv8(INV-8) | **PASS** — 关闭时全程未出现滤镜,注册表为空 |
| modes | **PASS** — 四模式像素级生效 |
| liveness(INV-5) | **PASS** — SPA 站内跳转 + 注入物被移除后自愈 |
| noninvasive(INV-9) | **PASS** — 三项机械判定(静态 a/b + Network 实测 c) |
| tabstate(INV-4/ADR-044) | **PASS** |
| editview(T6b popup) | **PASS** |

### 🔴 `styles` 的「移除后有残留」:**门禁自身与 INV-5 的竞态**,不是产品缺陷

`docs/T4a-gate/styles.cjs` 的流程是:快照 → **自己** `removeAttribute('data-ccf-on')`
+ `removeProperty('--ccf-filter')` → 再快照(同一个任务内)→ **另一个
`page.evaluate`** 里查残留。

实测分解(`scratchpad` 的 residue 实验):

| 时机 | 观测 |
|---|---|
| **同一任务内**立即读 | `attrs: []`, `styleHasVar: false` → **移除是干净的** |
| **下一个任务**读(= 残留检查所在处) | `attrs: ['data-ccf-on']`, `styleHasVar: true` |
| **真正删掉规则**后读 | `attrs: ['data-ccf-off']`, `filter: 'none'` → **清理正确** |

原因:规则**仍然命中**该站点,于是产品的 **INV-5 自愈**(「站点脚本移除注入物后
必须自动恢复」,ADR-017)在下一个任务里把属性重新装了回去 —— 那正是
`docs/T4b-gate/liveness.cjs` **硬判并通过**的行为。门禁把「自愈」误读成「残留」。

**真正的 INV-1 判据(`attributable`)在三个站点上全部为 0**
(github 2311 / wikipedia 6510 / hn 810 个元素),即「切换滤镜不引入任何
颜色之外的差异」成立。

该缺陷在 **T4a 的门禁脚本**里,属上游任务的职责面;本任务**未修改它**
(分工纪律),如实上报。修法是显然的:残留检查应在**删掉规则之后**做,
或与移除放在同一个任务内。

三道常规门禁:`npm test` **1058 passed (44 files)**、`npm run lint` **0 错误**、
`npm run compile` **退出码 0**(ADR-066)。

---

## 🔴 blindSpots(§6 T7 要求**显式申报**;空的或敷衍的申报等同于门禁失败)

### 站点类型

1. **需要登录态的站点完全未覆盖。** gmail / x.com(§6 T7 **逐字点名**了 x.com)、
   银行、企业内网一概没测 —— 无头 agent 没有账号。
   本轮 x.com 实测返回 `chrome-error://chromewebdata/`(本沙箱网络不可达),
   已如实留档且**不参与判定**,改用 wikipedia + example.com 做同构验证。
   **风险**:登录后的 SPA 往往有更复杂的 iframe / Shadow DOM / CSP,
   INV-5(存活性)与 INV-1(布局)在那类站点上**未经验证**。
2. **`<iframe>` 内的跨域内容未单独验证。** 滤镜施加在顶层 `<html>`,
   理论上 iframe 随父合成而被一同变换,但**没有**针对跨域 iframe
   (广告位、嵌入式播放器、支付框)的专门门禁。
3. **Canvas / WebGL / `<video>` 未验证。** 这三者的像素路径与普通 DOM 不同,
   SVG 滤镜对它们的效果(以及性能代价)完全未测。
4. **PDF 查看器、`chrome://` 内部页、Web Store** 按 ADR-013 本就不可注入,
   T5 验的是「正确上报原因」,**不是**「滤镜生效」。
5. **只测了桌面视口(1280×900)。** 移动端模拟视口、高 DPI(devicePixelRatio>1)、
   多显示器混合 DPI 未测。

### 场景

6. **真实到期只测了 ~1.5 分钟的锁定。** 跨天 / 跨夏令时切换 / 设备休眠唤醒后的
   锁定行为**未实测**(ADR-059 的单调下界有单元测试覆盖,
   但「真的睡一夜再看」没做)。
7. **系统时钟未真的被改动。** INV-15 用的是**注入倒退时钟**
   (`SettingsRepositoryOptions.clock`,ADR-059 为此而设)—— 它精确作用在机制上,
   但没有验证「用户在操作系统层面改时间」时 Chrome / 扩展的其它行为。
8. **20 条上限只在单元层与 INV-7 门禁验过;100 条病态规则是经门禁 fixture
   播种的超限状态**,不代表产品可达。
9. **多 Chrome profile / 多窗口并发写入未测。** ADR-010 改 local 后跨设备同步
   已出局,但「同一台机器两个窗口同时改设置」只有 `onChanged` 的单元覆盖。
10. **扩展更新(onInstalled/update)跨版本迁移未端到端测。**
    ADR-065 的注册恢复有 T4a 的 declarative 门禁,
    但「v1 的数据被 v2 读」这条迁移路径没有真实的双版本实测。
11. **网络条件单一。** 全部在正常宽带下跑;慢速 3G / 离线 / 请求被拦截时
    首帧与 SPA 存活性未测。
12. **无障碍与键盘导航未验。** popup 的焦点顺序、屏幕阅读器播报
    不在本门禁范围(§6 把 i18n 与 a11y 列为首版延后项)。

### 门禁仪器自身的已知弱点

13. 🔴 **「CSP 拦掉 data: URI 滤镜」这条缺陷的覆盖面本身很窄。**
    ⚠️ **本条上一轮写的是「`visual-modes` 在 HN 上的像素判据不可靠,是仪器/
    平台弱点,不是产品结论」—— 该申报是错的,已撤回**:它是**产品结论**
    (见上文根因分析)。
    该盲区**本轮已大部分补上**:新增 `csp-matrix.cjs` 覆盖 6 种策略
    (无 CSP / `img-src` 放行 data: / `img-src` 不放行 / `default-src` 回退 /
    `img-src 'none'` / `Report-Only`),并带因果锁定断言。
    **仍剩的盲区**:
    (a) **`<meta http-equiv>` 形式的 CSP** 未测(只测了响应头形式);
    (b) **CSP `sandbox`、`require-trusted-types-for` 等其它指令**未测;
    (c) **iframe 内的 CSP 继承**未测(子框架可有自己的策略);
    (d) 真实站点侧只抽样了 4 个(wikipedia / MDN / example.com / HN),
        **没有**对 Top-N 站点做 CSP 普查,故「受影响站点占比」**未知** ——
        这个数字对「修还是不修、怎么修」的决策很关键,建议人类裁定时补。
14. **拖拽重排用「置顶」按钮代替真实 HTML5 拖拽手势**
    (无头环境不可合成 DnD)。两者走**同一条写入路径**(`replaceRules`),
    故持久化结论成立;但**手势识别本身**未在真实栈验证(属 T6a 面)。
15. **`inv10` 的 FCP 取自 `performance.getEntriesByType('paint')`,
    偶发为空**(本轮 5 轮中有 1 轮)。已加「≥2 个有效样本」的仪器有效性
    硬断言,防止判据空转;但样本量仍小,时序结论是**量级**级而非精确值。
