/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 同文档 SVG 滤镜定义的注入(**ADR-069 / ADR-070**)—— CSP 静默失效的根治点。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 这个模块存在的理由(实测缺陷,不是设计洁癖)
 *
 * 上一版把 `feColorMatrix` 内联进 `data:image/svg+xml,...` URI,于是滤镜值
 * 只是一个字符串、无需 DOM 节点。**T7 实测把它否了**:`data:` URI 的 SVG
 * 被浏览器归类为**图片资源**,受站点 CSP 的 `img-src` 管辖。不放行 `data:`
 * 的站点上三个色觉矫正滤镜**静默失效** —— 像素与关闭态完全相同、无任何报错。
 * 真实 Chrome 捕获到 `{directive:'img-src', disposition:'enforce',
 * blockedURI:'data'}`,news.ycombinator.com 上 5 次导航全军覆没。
 *
 * **同文档 `url("#id")` 引用不产生资源加载,CSP 无从拦截。** 故把 `<filter>`
 * 放进当前文档,CSS 只留一个 fragment 引用(见 `src/domain/filter-css.ts`)。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## 🔴 两步,顺序不可颠倒(ADR-069 的核心约束)
 * ───────────────────────────────────────────────────────────────────────────
 *
 * ```js
 * // ① SVG 先就位(documentElement 此刻已存在,head/body 尚无 —— 直接挂 html)
 * ensureSvgFilterDef(documentElement, mode, intensity);
 * // ② 再开闸 —— 此刻 CSS 规则 html.ccf-on 才开始匹配
 * documentElement.classList.add('ccf-on');
 * ```
 *
 * 这两步由 `applyFilter` / `syncFilter`(`apply-filter.ts`)**在同一个同步
 * 语句序列里**完成,调用方拿不到「只做了第一步」的中间态。
 *
 * ### 为什么顺序是关键,以及为什么它不是在赌
 *
 * 预生成的 CSS 由 Chrome 在**更早**时刻注入(ADR-062 声明式注册,首帧之前)。
 * 那时 `html` 没有 `ccf-on`,规则**不匹配任何元素**,浏览器压根不去解析
 * `url("#ccf-…")` —— **前向引用问题根本不存在,而不是被绕过**。等 ② 执行完,
 * `#ccf-…` 已在 DOM 里,filter 值是新算出来的。
 * **即使某个引擎真的缓存了「找不到」,这里也不受影响** ——
 * 这是消除不确定性,不是赌对。
 *
 * 反过来(先加 class 再插 SVG)就真的在赌引擎的缓存行为:class 命中的那一刻
 * `#ccf-…` 还不存在,`filter` 解析为「引用不到的滤镜」,是否在节点出现后
 * 自动重算取决于实现。ADR-069 为此把顺序写成硬约束。
 *
 * ### 首帧安全性(INV-3)
 *
 * `document_start` 时 `documentElement` 已存在(`<head>`/`<body>` 尚无,
 * 但 SVG 直接挂 `html` 即可)。content script 在主线程**同步执行**,期间
 * 解析器与渲染都停着,所以两步必然在首帧之前完成。
 * 实测对照:同步 fragment 路径 **0 次闪烁**,异步 storage 路径 **4 次中闪 1 次**
 * —— **异步等待才是闪烁根源,JS 本身不是**。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## 四种模式统一(ADR-070)
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 灰阶也走 `feColorMatrix`,不再用 CSS 内置 `grayscale()`。灰阶本身就是一个
 * 颜色矩阵,用内置函数只是巧合可行;两条路径各自演化会一直有「只在某条路上
 * 出现的 bug」—— 本次缺陷恰好只打中 SVG 路径而灰阶无恙,正是这种分裂的代价。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## INV-1 / INV-9:这个节点对页面的影响
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 多一个节点是 ADR-069 已权衡并接受的代价(CSP 失效让三个主业滤镜在大量
 * 站点上完全不工作,量级完全不同)。把影响压到最小的几条,**每一条都是
 * 实现义务**:
 *
 * 1. **挂 `documentElement` 而非 `body`** —— `document_start` 时 `body` 还不
 *    存在;且挂 `html` 不进入站点最常枚举的 `document.body.children`。
 * 2. **`position:absolute;width:0;height:0;overflow:hidden`** —— 不占布局、
 *    不可见,`getBoundingClientRect()` 的几何断言(INV-1)不受影响。
 * 3. **`aria-hidden="true"`** —— 不进无障碍树,屏幕阅读器读不到它。
 * 4. **一个容器节点,不是每个滤镜一个** —— 容器带固定 id
 *    `CCF_SVG_CONTAINER_ID`,`<filter>` 子节点按需增删。于是无论用户怎么
 *    改模式/强度,页面上永远只多这**一个**节点。
 * 5. **`removeSvgFilterDefs` 把容器整个摘掉** —— 关闭滤镜后 DOM 回到原样,
 *    无残留节点(T4a gate:「移除滤镜后 DOM 恢复原状,无残留节点/属性/class」)。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## 🔴 为什么**不用** `innerHTML`,尽管 ADR-069 的片段那么写
 * ───────────────────────────────────────────────────────────────────────────
 *
 * ADR-069 的规范片段是 `svg.innerHTML = '<filter id=...>...'`。本模块改用
 * 逐个 `createElementNS` + `setAttribute`,**行为完全等价**(SVG 命名空间下
 * 的同一棵子树),但多出一个必需的性质:
 *
 * `tests/t4b-static-gates.test.ts` 把 `innerHTML` 列为注入层源码的**禁字**
 * (ADR-026 / INV-9:「不读取页面内容」)。那条门禁针对的是**读** ——
 * `el.innerHTML` 读出来就是页面内容的外传通道。本模块只会**写**自己刚建的
 * 节点,语义上不违反 ADR-026。
 *
 * 但门禁是**纯文本**匹配,无法区分读与写。两种选择:
 *
 * 1. 给门禁开一个「本文件允许 innerHTML」的例外;
 * 2. 压根不用 `innerHTML`。
 *
 * 选 2。理由不是迁就工具,而是**例外本身有成本**:一旦门禁上出现
 * 「某文件可以用 innerHTML」,它就从一条机械判定退化成一条需要人工
 * 审查上下文的规则,而下一次有人在这个文件里**读** `innerHTML`
 * 就不会再被挡住。ADR-026 是红线,红线上不开缺口。
 * `createElementNS` 路线多十几行,换来门禁继续是机械的。
 *
 * 📌 顺带也消掉了标记拼装本身:没有字符串拼接,就没有转义正确性要
 *    论证(id 与系数的字符集断言仍保留为结构性断言,见 `assertSafeValues`)。
 */

import {
  type FilterMode,
  type Intensity,
  filterMatrixValues,
  svgFilterId,
} from '../domain/index.js';

/** SVG 命名空间 URI —— `createElementNS` 必需。 */
export const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 承载全部 `<filter>` 定义的容器节点 id。
 *
 * 固定 id 使注入**幂等**:重复调用只会复用同一个容器,页面上永远只多
 * 一个节点(见头注释第 4 条)。带 `ccf-` 前缀以避免与站点自身的 id 撞名(INV-1)。
 */
export const CCF_SVG_CONTAINER_ID = 'ccf-svg-defs';

/**
 * 容器的内联样式 —— 逐字取自 ADR-069 的规范片段,外加 `overflow:hidden`。
 *
 * `width:0;height:0` + `position:absolute` 让它完全不参与布局:
 * INV-1 要求「注入/移除滤镜后页面所有元素的 `getBoundingClientRect()`
 * 逐一相等」,一个占位的 SVG 会当场破坏它(SVG 的默认尺寸是 300×150)。
 */
export const CCF_SVG_CONTAINER_STYLE =
  'position:absolute;width:0;height:0;overflow:hidden';

/**
 * 本模块需要的最小 DOM 能力 —— 与 `FilterTarget` 同样的可注入抽象。
 *
 * 抽成接口是为了让「注入序列是否正确」这件**与浏览器无关**的事能在
 * Node 下机械单测(jsdom 亦可)。真实栈的 CSP 抗性与零闪烁由
 * REAL_STACK_GATE 另行验收 —— 本接口不冒充那部分(DESIGN.md §8 第 8 条)。
 */
export interface SvgDefsHost {
  /**
   * 把容器挂上去。
   *
   * 📌 **签名刻意宽松**(入参 `any`、返回 `unknown`),理由是结构兼容性:
   *    真实的 `HTMLElement.appendChild` 是泛型 `<T extends Node>(node: T) => T`。
   *    若这里写成 `(node: SvgDefsNode) => void`,`documentElement` 就**不可赋值**
   *    给 `FilterTarget`(实测 TS2322:入参逆变 + `SvgDefsNode` 缺 `Node` 的
   *    46 个成员)。而 `FilterTarget` 必须能直接接受 `document.documentElement`
   *    —— 那是生产唯一的注入目标。
   *
   *    宽松只在**类型**层面:本模块唯一传进去的实参是自己刚
   *    `createElementNS` 出来的容器,没有外部输入能走到这里。
   */
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  appendChild(node: any): unknown;
  /**
   * 建带命名空间的元素 + 按 id 取节点。生产实现即 `document`
   * (`documentElement.ownerDocument` 正是它)。
   */
  readonly ownerDocument: {
    createElementNS(namespaceURI: string, qualifiedName: string): SvgDefsNode;
    getElementById(elementId: string): SvgDefsNode | null;
  } | null;
}

/**
 * 被创建/操作的节点所需的最小能力。
 *
 * 真实的 `SVGSVGElement` / `SVGElement` 结构上满足它,故
 * `createElementNS` 的返回值无需断言。
 *
 * 📌 **没有 `innerHTML`** —— 见头注释「为什么不用 innerHTML」。
 */
export interface SvgDefsNode {
  setAttribute(name: string, value: string): void;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  appendChild(node: any): unknown;
  remove(): void;
}

/**
 * 一个 `<filter>` 的**属性清单** —— 纯数据,便于逐字断言。
 *
 * 拆成「清单 + 建节点」两步,是为了让「我们到底设了哪些属性」能被单测
 * 直接比对,而不必去真实 DOM 上反查。
 *
 * - `color-interpolation-filters="sRGB"` 不是可选的:默认值是 `linearRGB`,
 *   那会让矩阵作用在线性光空间上,产出的颜色与 `toColorMatrix` 的推导
 *   (在 sRGB 分量上做线性组合,见 `color-matrix.ts`)不一致 ——
 *   表现为「颜色差一点点」,是最难察觉的那类缺陷。
 * - `type="matrix"` 显式写出,不依赖默认值。
 */
export function svgFilterSpec(
  mode: FilterMode,
  intensity: Intensity,
): {
  readonly filterAttrs: Readonly<Record<string, string>>;
  readonly matrixAttrs: Readonly<Record<string, string>>;
} {
  const id = svgFilterId(mode, intensity);
  const values = filterMatrixValues(mode, intensity);
  assertSafeValues(id, values);
  return {
    filterAttrs: { id, 'color-interpolation-filters': 'sRGB' },
    matrixAttrs: { type: 'matrix', values },
  };
}

/**
 * 🔴 **第 ① 步**:确保 `(mode, intensity)` 的 `<filter>` 定义已在文档里。
 *
 * **幂等**:容器已存在则复用;该 id 的 `<filter>` 已在里面则直接返回。
 * 于是预览(ADR-049)期间每次拖动滑块都调用它也只是 O(1) 的查找,
 * 不会让页面节点数增长。
 *
 * 返回是否真的写了 DOM —— 供 gate 断言「幂等调用零写入」。
 *
 * 🔴 **多个定义并存是有意的**:同一个页面可能同时需要不止一个滤镜定义
 *    (预览期间底层规则值与预览值不同)。故新定义是 `appendChild` 进容器,
 *    **不替换**既有的 —— 替换会让存活性恢复(INV-5)随后按
 *    `arbiter.current()` 去引用一个已不存在的 id,又是一次静默失效。
 *
 * ⚠️ **调用方必须在本函数返回之后、同一个同步段内**才给 `html` 加
 *    `ccf-on` class(第 ② 步)。顺序由 `apply-filter.ts` 的
 *    `applyFilter`/`syncFilter` 保证,不要在别处重新实现这两步。
 */
export function ensureSvgFilterDef(
  host: SvgDefsHost,
  mode: FilterMode,
  intensity: Intensity,
): boolean {
  const id = svgFilterId(mode, intensity);

  const doc = host.ownerDocument;
  if (doc === null) return false;

  const container = ensureContainer(host);
  if (container === null) return false;

  // 该滤镜已定义 → 什么都不做(幂等)。
  if (byId(host, id) !== null) return false;

  const spec = svgFilterSpec(mode, intensity);

  const filter = doc.createElementNS(SVG_NS, 'filter');
  for (const [name, value] of Object.entries(spec.filterAttrs)) {
    filter.setAttribute(name, value);
  }

  const matrix = doc.createElementNS(SVG_NS, 'feColorMatrix');
  for (const [name, value] of Object.entries(spec.matrixAttrs)) {
    matrix.setAttribute(name, value);
  }

  filter.appendChild(matrix);
  container.appendChild(filter);
  return true;
}

/**
 * 摘掉容器节点 —— 「移除滤镜后 DOM 恢复原状,无残留节点」(T4a gate)。
 *
 * 返回是否真的移除了东西(幂等:没有容器时为 `false`,零写入)。
 */
export function removeSvgFilterDefs(host: SvgDefsHost): boolean {
  const container = byId(host, CCF_SVG_CONTAINER_ID);
  if (container === null) return false;
  container.remove();
  return true;
}

/** 容器当前是否在文档里 —— 供断言与幂等判断。 */
export function hasSvgFilterDefs(host: SvgDefsHost): boolean {
  return byId(host, CCF_SVG_CONTAINER_ID) !== null;
}

/**
 * 按 id 取节点 —— 本模块唯一的「读 DOM」。
 *
 * 只用来找**自己建的** `ccf-` 节点。见 `SvgDefsHost.ownerDocument` 的注释:
 * 刻意选 `getElementById`(能力弱于 `querySelector`,无法表达选择器、
 * 无法枚举),因此 ADR-026 的门禁无需开任何例外。
 */
function byId(host: SvgDefsHost, id: string): SvgDefsNode | null {
  return host.ownerDocument?.getElementById(id) ?? null;
}

/**
 * 取得(必要时创建)容器节点。
 *
 * `ownerDocument` 缺失(纯对象替身、非 DOM 宿主)时返回 `null` ——
 * **降级为不注入,绝不抛异常**:content script 抛到页面上就是 INV-1 的
 * 破坏(同 `liveness.ts` 对缺失 `MutationObserver` 的处理)。
 */
function ensureContainer(host: SvgDefsHost): SvgDefsNode | null {
  const existing = byId(host, CCF_SVG_CONTAINER_ID);
  if (existing !== null) return existing;

  const doc = host.ownerDocument;
  if (doc === null) return null;

  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('id', CCF_SVG_CONTAINER_ID);
  svg.setAttribute('style', CCF_SVG_CONTAINER_STYLE);
  // 不进无障碍树(INV-1:不改变页面可观察行为,含辅助技术所见)。
  svg.setAttribute('aria-hidden', 'true');
  host.appendChild(svg);
  return svg;
}

/**
 * 断言两个值确实只含预期字符。
 *
 * 这**不是**防御不可信输入 —— 两个值都由本仓的纯函数产出,且走的是
 * `setAttribute` 而非字符串拼装,本就没有注入面。它是一道**结构性断言**:
 * 若哪天 `formatCoefficient` 或 `svgFilterId` 被改成产出 `NaN`、空串或
 * 带空格的 id,这里会立刻炸,而不是静默产出一个引用不到的滤镜
 * (那个失败的表现又是「滤镜不生效、无报错」—— 与本轮缺陷同形)。
 */
function assertSafeValues(id: string, values: string): void {
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error(`svgFilterId 产出了非预期字符: ${id}`);
  }
  if (!/^[-0-9. ]+$/.test(values)) {
    throw new Error(`feColorMatrix values 含非预期字符: ${values}`);
  }
}
