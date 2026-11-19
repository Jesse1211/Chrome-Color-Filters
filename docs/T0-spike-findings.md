# T0 — 可行性验证 spike 交接文档

> **VERDICT: FEASIBLE**（INV-1 与 INV-3 均可满足）
>
> 这是给 **T4a Dev** 的可复现实现交接文档,不是可行性结论书。
> 照着 §2 的代码块实现即可,**不需要重新探索**。
> 被否决方案的实测失败表现见 §4 —— 不要重走。

---

## 0. 结论摘要

| 不变式 | 结论 | 证据 |
|---|---|---|
| **INV-1 · UI 零影响** | ✅ **可满足** | `fixed`/`sticky` 元素位移 **dx=0, dy=0**(§3.1 确定性 fixture + §3.2 三真实站点) |
| **INV-3 · 零闪烁** | ✅ **可满足** | 逐帧截屏 **1055 / 211 / 4 帧中 0 帧带色**(§3.3) |

**DESIGN.md §6 T0 对前提的判断需要修正 ——**
原文假设「给 `<html>` 加 `filter` 会使其成为 `position:fixed` 的 containing block,
若此问题无解 INV-1 不可能满足」。

**实测结论:该假设对 `<html>`(根元素)不成立。**
CSS Filter Effects 规范对**根元素**有特例:根元素的 filter 作用于视口传播的结果,
**不为 fixed 后代建立 containing block**。实测 Chrome 158 完全符合该特例。

> 对 `<body>` 或任何非根元素,containing block 问题**确实存在且严重**(实测 dy 偏移 1000–2340px,§4.3)。
> 原假设的危险在于它对 `body` 正确、对 `html` 错误 —— 若 T4a 想当然地去「补偿 fixed 元素」,
> 反而会**亲手制造**本来不存在的错位(§4.2 实测 dy=+1000px)。

---

## 1. 注入目标:`<html>`(`document.documentElement`),以及为什么是它

**选 `<html>` 而不是 `<body>` 或 wrapper,有三条独立理由:**

1. **唯一不破坏 `position:fixed` 的选择。**
   根元素享有规范特例,filter 不建立 containing block;`<body>` 没有这个特例。
   实测对比见 §4.3 —— `body{filter}` 让 fixed header 跑到 `y=-1000`。

2. **无需改动 DOM 结构,满足 INV-9(非侵入)。**
   wrapper 方案要把页面内容搬进一个新建 div,这会破坏站点自身的
   `body > *` 选择器、`parentElement` 逻辑与 MutationObserver,且与 ADR-026 的隐私底线相悖。

3. **可在 `document_start` 生效,是 INV-3 的前提。**
   `document_start` 时 `document.body` **尚不存在**,但 `document.documentElement` **已存在**。
   任何以 `body` 或新建元素为目标的方案都必须等待 DOM —— 那几毫秒就是彩色闪帧(§4.4 实测)。

---

## 2. 生效方案 —— 逐字可复制

### 2.1 完整 CSS(T4a 直接用)

把下面这段作为注入样式表的内容。`__FILTER__` 替换为由 `(mode, intensity)` 算出的 filter 值(ADR-025)。

```css
html {
  filter: __FILTER__ !important;
}

/* 顶层(top layer)元素不是根元素在绘制树中的后代,
   根 filter 到不了它们。必须单独补一条,否则模态框/popover 仍是彩色。
   实测证据:docs/T0-spike/edge-cases/toplayer-*.png */
:modal,
[popover]:popover-open,
:fullscreen,
::backdrop {
  filter: __FILTER__ !important;
}
```

**`__FILTER__` 的实测取值**(本 spike 验证的是 `grayscale(1)`;四种模式的矩阵由 T1 领域层给出):

```
grayscale(1)
```

### 2.2 完整注入 JS(content script,`run_at: document_start`)

```js
// 注入目标:document.documentElement(<html>)。
// document_start 时 document.head / document.body 都可能不存在,
// 但 documentElement 一定存在 —— 这是 INV-3 成立的关键。
const STYLE_ID = '__ccf_style';

function injectFilterStyle(filterValue) {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    // 挂到 documentElement 上,不等待 head。
    (document.head || document.documentElement).appendChild(style);
  }
  style.textContent =
    'html{filter:' + filterValue + ' !important;}' +
    ':modal,[popover]:popover-open,:fullscreen,::backdrop{' +
    'filter:' + filterValue + ' !important;}';
  return style;
}

function removeFilterStyle() {
  const style = document.getElementById(STYLE_ID);
  if (style) style.remove();
}
```

### 2.3 manifest 中的注册方式(INV-3 的另一半)

```json
{
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content-script.js"],
      "run_at": "document_start",
      "all_frames": false
    }
  ]
}
```

- `run_at: document_start` **不可省**,否则首帧必然是彩色的。
- `all_frames: false` 即可满足 ADR-016:子 iframe 跟随顶层文档渲染,
  **根 filter 天然覆盖同源与跨域 iframe**,不需要注入子框架(§5 实测)。
- 与 ADR-038 一致:零闪烁验收**必须在 `wxt build` 产物上做**,dev 模式不作数。

---

## 3. 实测证据

### 3.1 确定性 fixture(最严格的判别器)

`docs/T0-spike/spike-code/fixture/page.html` + `final.js`。
本地文件、无网络、无动态内容 —— 排除了真实站点的加载抖动。
页面含:`#hdr`(fixed top)、`#side`(fixed bottom-right)、`#stick`(sticky)。
滚动到 `scrollY=1000` 后测 `getBoundingClientRect()`,与无滤镜基线做差。

| 方案 | hdr (dx,dy) | side (dx,dy) | stick (dx,dy) | 判定 |
|---|---|---|---|---|
| `off`(基线) | (0,0) | (0,0) | (0,0) | — |
| **a1 `html{filter}`** | **(0,0)** | **(0,0)** | **(0,0)** | ✅ INV-1 OK |
| a2 `html{filter}` + JS 补偿 | (0,**1000**) | (0,**1000**) | (0,0) | ❌ BROKEN |
| a4 `body{filter}` | (0,**-1000**) | (0,**2340**) | (0,0) | ❌ BROKEN |
| **a5 `html{filter}` + 顶层补偿**(**采用**) | **(0,0)** | **(0,0)** | **(0,0)** | ✅ INV-1 OK |

原始数据:`docs/T0-spike/data/final.json`
截图:`docs/T0-spike/screenshots/fixture-*.png`

> **这张表证明判别器是有效的**:同一套测量在 a2/a4 上报出了明确的大幅偏移,
> 所以 a1/a5 的 (0,0) 不是「测不出来」,而是真的没有位移。

**交叉验证**(`fixture/probe.js`,`docs/T0-spike/data/res.json`):

| 作用于 `<html>` 的属性 | hdr.y | side.y | fixed 是否错位 |
|---|---|---|---|
| 无 | 0 | 600 | — |
| `filter: grayscale(1)` | 0 | 600 | **否** |
| `transform: translateZ(0)` | -1000 | 2940 | **是** |
| `will-change: filter` | 0 | 600 | 否 |
| `backdrop-filter` | 0 | 600 | 否 |
| `opacity: 0.999` | 0 | 600 | 否 |

`html{transform}` 会错位而 `html{filter}` 不会 —— 这是规范特例的直接体现,
也再次证明测量能抓到 containing block 问题。

### 3.2 三个真实站点(gate 要求)

github.com / en.wikipedia.org/wiki/CSS / news.ycombinator.com,
视口 1280×860,滚动到 `scrollY=1200` 后比对所有 `fixed`/`sticky` 元素的屏幕坐标。

**结果:所有在基线与滤镜态都存在的元素,位移全部为 dx=0, dy=0。**

例(wikipedia,a5 vs off):

| 元素 | 基线 (x,y) | a5 (x,y) |
|---|---|---|
| 左侧目录 sticky | (32, 24) | (32, 24) |
| 右侧 Appearance sticky | (1025, 24) | (1025, 24) |
| `div#p-dock-bottom` fixed | (1231.41, 847.2) | (1231.41, 847.2) |

原始数据:`docs/T0-spike/data/geometry-raw.json`
截图:`docs/T0-spike/screenshots/geometry-<site>-<approach>-{top,scroll1200}.png`

> **已知的比对噪声(T4a 请勿误判):** 逐 approach 重新加载页面时,
> wikipedia 的募捐横幅 `#centralNotice`、github 的进度条会出现/消失,
> 导致 `nth-child` 路径索引变化、元素集合不完全相同。
> **这是页面自身的动态内容,不是滤镜造成的** ——
> 对**同时存在于两边**的元素逐个求差,位移恒为 0。
> 这正是 §3.1 用确定性 fixture 做主判据的原因。

**滤镜确实生效的像素级证明**(`maxChannelSpread` = 单像素 RGB 极差,
灰阶输出必为 0):

| 站点 | off | a1 | a5 |
|---|---|---|---|
| github | 254 | **0** | **0** |
| wikipedia | 178 | **0** | **0** |
| hn | 255 | **0** | **0** |

### 3.3 INV-3 零闪烁

方法:CDP `Page.startScreencast`(`everyNthFrame: 1`)捕获**导航全过程的每一个合成帧**,
逐帧判定「带色像素数 > 总像素 0.2%」。

| 方案 | github | wikipedia | hn |
|---|---|---|---|
| `off`(基线,证明探针有效) | **979 / 980 帧带色** | 205 / 207 | 2 / 4 |
| **a1 `html{filter}`** | **0 / 771** | **0 / 184** | **0 / 3** |
| a3 backdrop-filter 覆盖层 | **8 / 640 带色** ❌ | 2 / 58 ❌ | 1 / 5 ❌ |
| **a5(采用)** | **0 / 1055** | **0 / 211** | **0 / 4** |

原始数据:`docs/T0-spike/data/flicker-*.json`
闪烁证据截图:`docs/T0-spike/flicker/`
其中 `wikipedia-a3-WORST-frame1.png` 是一张**完整的、未经滤镜的彩色维基页面** ——
a3 方案下用户真实可见的那一帧。

**结论:INV-3 在 a5 方案下可行**,前提是
(a) `run_at: document_start`,(b) 样式挂在 `documentElement` 而非等待 `body`,
(c) 按 ADR-038 在生产构建产物上验收。

---

## 4. 被否决的方案及各自的实测失败表现

### 4.1 a1 — 直接给 `documentElement` 加 filter(spec 要求的方案 1)

**结果:几何上完全正确(dx=0,dy=0),零闪烁(0 帧带色)。**
**未被否决,而是作为 a5 的基础。** 唯一缺陷是漏掉顶层元素(§4.5),a5 即 a1 + 顶层补一条。

### 4.2 a2 — 加 filter 同时用补偿 CSS/脚本修正 fixed 元素(spec 要求的方案 2)

**❌ 否决。实测失败表现:补偿本身制造了错位。**

实现:监听 `scroll`,对所有 `position:fixed` 元素施加
`transform: translate(scrollX, scrollY)`。

实测(fixture,scrollY=1000):

| 元素 | 期望 | 实测 | 偏差 |
|---|---|---|---|
| `#hdr` fixed top | y=0 | **y=1000** | **+1000px** |
| `#side` fixed bottom-right | y=600 | **y=1600** | **+1000px** |

**根因:** 补偿的前提是「fixed 已经被错误地钉在了文档坐标系」。
但 §4.1 已证明 `html{filter}` 下 fixed **仍然正确地锚定视口**。
于是补偿变成了**对一个正确值的二次偏移**,把 header 直接推出视口。

**写给 T4a 的结论:不要加任何 fixed 补偿逻辑。** 它解决的是一个不存在的问题。
更糟的是:`transform` 施加在 fixed 元素上会让该元素成为**其自身 fixed 后代的 containing block**,
把错位传染给子树。

> 另有一个无解的副作用:补偿需要 `querySelectorAll` + `getComputedStyle` 遍历全页元素,
> 与 ADR-026 / INV-9「绝不读取页面内容」在精神上冲突,且每次 scroll 都是 O(n) 强制重排。

### 4.3 a4 — 给 `<body>` 加 filter(自行调研的方案之一)

**❌ 否决。实测失败表现:这才是 DESIGN.md 预言的那个灾难。**

| 元素 | 基线 | `body{filter}` | 偏差 |
|---|---|---|---|
| `#hdr` fixed top | y=0 | **y=-1000** | **-1000px(整个滚出视口顶部)** |
| `#side` fixed bottom-right | y=600 | **y=2940** | **+2340px** |

`<body>` 不是根元素,**没有规范特例**,filter 如实建立 containing block,
所有 fixed 后代退化成 `absolute` 相对 body 定位。
真实站点上表现为:固定导航栏随页面滚走、回到顶部按钮消失。

截图:`docs/T0-spike/screenshots/fixture-a4_body_filter.png`

### 4.4 a3 — `position:fixed` 全视口覆盖层 + `backdrop-filter`(自行调研的方案之二)

**❌ 否决。几何无损但违反 INV-3,且有多项结构性缺陷。**

思路是不碰页面任何元素,只盖一层 `pointer-events:none` 的 fixed div,
用 `backdrop-filter` 过滤其身后的像素。几何上确实零影响(不是任何页面元素的祖先)。

**实测失败表现:**

1. **违反 INV-3(致命)。** 覆盖层必须 `appendChild` 到 `document.body`,
   而 `document_start` 时 `body` 不存在,只能等 `DOMContentLoaded`。
   这段窗口内页面已在绘制彩色内容。
   实测 **github 8 帧、wikipedia 2 帧、hn 1 帧带色**,
   `wikipedia-a3-WORST-frame1.png` 是一整屏未滤镜的彩色页面。
   ADR-018 定零闪烁为硬性不变式,此项即否决理由。

2. **向页面注入了一个可见 DOM 节点。** 站点自身的
   `document.body.children`、`:last-child` 选择器、MutationObserver 都会观测到它,
   与 INV-1「页面自身 JS 读到的计算样式一致」相悖。
   实测中该 div 确实出现在页面的 fixed 元素枚举结果里
   (`geometry-raw.json` 中 a3 条目多出 `div#__t0_spike_overlay`)。

3. **`z-index: 2147483647` 是一场必输的军备竞赛。** 站点自己的模态框只要用同等 z-index
   且 DOM 顺序靠后就会盖在上面,变成未滤镜的彩色层。

4. **稳定性问题。** wikipedia 的 a3 run 出现
   `Attempted to use detached Frame` 失败(见 `geometry-raw.json`),
   覆盖层与站点自身的框架操作存在干扰。

### 4.5 顶层元素(top layer)—— 这不是被否决的方案,是 a1 的已知缺口

`<dialog showModal()>`、`popover`、`:fullscreen` 的渲染发生在 **top layer**,
在绘制树中不是根元素的后代,**根 filter 到不了它们**。

实测(`maxChannelSpread`,0 = 完全灰阶):

| 场景 | 仅 `html{filter}` | 加上顶层补偿规则 |
|---|---|---|
| `<dialog>` + `showModal()` | **238(全彩,未生效)** | **0** ✅ |
| `[popover]` + `showPopover()` | **238(全彩,未生效)** | **0** ✅ |

截图:`docs/T0-spike/edge-cases/toplayer-*.png`

**所以 §2.1 的第二条 CSS 规则不是可选项,漏掉它就是一个真实缺陷。**

---

## 5. 其他边界场景实测(均已通过)

`maxChannelSpread`,0 = 完全灰阶。截图在 `docs/T0-spike/edge-cases/`。

| 场景 | 无滤镜 | `html{filter}` | 结论 |
|---|---|---|---|
| 普通元素背景色 | 238 | **0** | ✅ |
| **跨域 iframe**(`data:` 文档) | 238 | **0** | ✅ 顶层 filter 覆盖子框架,**无需 `all_frames: true`**,符合 ADR-016 |
| `background-attachment: fixed` | 238 | **0** | ✅ |
| 嵌套滚动容器 | — | 已包含在 fixture 中 | ✅ 无错位 |

---

## 6. 已知局限(哪类网站/场景会失败)

T4a 请把这些当作**已记录的局限**,不要花时间去「修」:

1. **不可注入页面。** `chrome://`、Chrome 应用商店、PDF 查看器、新标签页上
   content script 根本不运行 —— 平台限制,已由 ADR-013 记录。

2. **顶层元素依赖选择器支持度。** `:modal` / `[popover]:popover-open` / `::backdrop`
   在 Chrome 158 实测可用。若站点用 `<div>` 自绘模态框(绝大多数站点如此),
   它仍是普通 DOM 后代,被根 filter 正常覆盖 —— 不受影响。

3. **本 spike 只覆盖 3 个静态站点 + 1 个 fixture。**
   未覆盖:SPA 路由切换、`<video>` 播放、Canvas/WebGL、Shadow DOM、
   站点自身也在 `<html>` 上设置 filter 的情况(会被 `!important` 覆盖掉,属于我方改变了页面行为)。
   > **DESIGN.md §6.2 已为此预留 `BLOCKED_UPSTREAM`:**
   > T4a 若在更广站点集上发现本结论不成立,应指认 T0 而非自行改方向。

4. **`!important` 可被站点同等优先级规则对抗。** 若站点自己写了
   `html{filter:none!important}`,级联由 DOM 顺序决定。
   INV-5(存活性)/ADR-017 的 MutationObserver 恢复机制(T4b)覆盖此场景。

5. **性能。** 根 filter 会让整个页面进入合成层。在超长页面上滚动有额外 GPU 开销。
   本 spike 未做性能基线测量 —— **不在 T0 的 gate 范围内**,留给 T7。

---

## 7. 复现方法

> 归档的 spike 代码在 `docs/T0-spike/spike-code/`,**仅供查阅,不参与构建与 lint**
> (DESIGN.md T0 一节明确:归档件不违反 ADR-035)。

```bash
cd docs/T0-spike/spike-code
npm i puppeteer-core@23 pngjs
npx @puppeteer/browsers install chrome@stable   # 见下方环境坑

node fixture/final.js     # §3.1 确定性几何判别(主判据)
node measure.js           # §3.2 三真实站点几何 + 截图
node flicker.js           # §3.3 逐帧零闪烁探针(APPROACH=a5 node flicker.js)
node fixture/edge2.js     # §5  边界场景
node fixture/toplayer.js  # §4.5 顶层补偿验证
```

### 🔴 环境坑(T4a 一定会踩,这里写死)

**Chrome 158 稳定版已禁用 `--load-extension`**(feature
`DisableLoadExtensionCommandLineSwitch`)。实测表现:
Chrome 正常启动、不报任何错,但扩展**静默地没有加载** ——
`chrome.developerPrivate.getExtensionsInfo()` 返回 `[]`,
content script 从不运行,而截图看起来「一切正常只是没效果」。
排查成本极高,因为没有任何错误信息。

以下尝试**均无效**(已实测):
- `--disable-features=DisableLoadExtensionCommandLineSwitch`
- 在 profile 的 `Preferences` 里设 `extensions.ui.developer_mode = true`
- `chrome.developerPrivate.loadUnpacked()` —— 会拉起原生文件选择器,无头环境不可用

**唯一可行解:用 Chrome for Testing 构建**(同为 158.0.8127.36,但仍遵从 `--load-extension`):

```bash
npx @puppeteer/browsers install chrome@stable
# executablePath 指向:
# chrome/mac_arm-158.0.8127.36/chrome-mac-arm64/
#   Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
```

另外两点:
- 必须 **headful**(`headless: false`)。MV3 content script 与真实合成路径依赖有头模式。
- content script 运行在 **isolated world**,读不到 `page.evaluateOnNewDocument` 设的页面全局变量。
  本 spike 改为把配置写进扩展内的 `config.js` 再启动浏览器。

---

## 8. 给 T4a 的交接清单

- [x] 注入目标:`document.documentElement`(`<html>`),理由见 §1
- [x] 完整 CSS:§2.1(**两条规则,第二条顶层补偿不可省**)
- [x] 完整注入 JS:§2.2
- [x] manifest 注册:§2.3(`run_at: document_start` 不可省)
- [x] **不要**实现任何 fixed 元素补偿逻辑 —— 理由与实测见 §4.2
- [x] **不要**用覆盖层 / `backdrop-filter` 方案 —— 违反 INV-3,见 §4.4
- [x] **不要**把 filter 加在 `<body>` 或 wrapper 上 —— 见 §4.3
- [x] `all_frames: false` 即可满足 ADR-016 —— 见 §5
- [x] 零闪烁验收在 `wxt build` 产物上做(ADR-038)
