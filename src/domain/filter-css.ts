/**
 * `filterCssValue(mode, intensity)` —— 把 `(mode, intensity)` 映射为可直接写进
 * CSS `filter` 属性的字符串(T0 spike §2.1 的 `__FILTER__`)。
 *
 * 纯 TypeScript —— 零 React / 零 chrome.* / 零 wxt(ADR-036)。
 * 与 `toColorMatrix` 同为 ADR-025 的**派生值**:由 `(mode,intensity)` 纯函数算出,
 * **绝不持久化**。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 🔴 本模块返回的是**同文档 fragment 引用**(ADR-069)—— 不是 `data:` URI
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 四种模式统一返回 `url("#ccf-{slug}-{intensity}")`,指向**本文档内**由
 * content script 同步注入的 `<svg><filter id="ccf-{slug}-{intensity}">`
 * (见 `src/injection/svg-filter-def.ts`)。
 *
 * ### 为什么不再用 `data:image/svg+xml,...` URI(本轮修复的缺陷本体)
 *
 * 上一版把整个 SVG 内联进 `data:` URI,图的是「滤镜值只是一个字符串,
 * 无需 DOM 节点」。**T7 实测证伪了它**:
 *
 * `data:` URI 形式的 SVG 被浏览器归类为**图片资源**,因而受站点 CSP 的
 * `img-src` 指令管辖。在不放行 `data:` 的站点上,三个色觉矫正滤镜
 * **静默失效** —— 像素与关闭态完全相同、且无任何报错。确定性复现于:
 *
 * - `img-src 'self'`(不放行 `data:`)
 * - 只有 `default-src` 且不放行 `data:`,无 `img-src`
 * - `img-src 'none'`
 *
 * 真实 Chrome 在 news.ycombinator.com 上捕获到
 * `{directive:'img-src', disposition:'enforce', blockedURI:'data'}`,
 * 5 次导航后三个滤镜像素全无变化。而灰阶当时走 CSS 内置 `grayscale()`
 * (无 `url()`),故不受影响 —— 那正是 ADR-070 所说「两条路径各自演化」
 * 的代价:缺陷只打中了其中一条。
 *
 * **同文档 `url("#id")` 引用不产生资源加载,CSP 无从拦截。** 这是 ADR-069
 * 拍板的解法。相比打包 SVG 走 `chrome-extension://`:不需要
 * `web_accessible_resources`、无指纹暴露、无需任何服务器。
 *
 * ### 前向引用不是问题(ADR-069 的 class 开关)
 *
 * 「CSS 比 SVG 节点先到场」看似是前向引用,但 `html.ccf-on` 这个 class
 * 门控让该问题**根本不存在**:CSS 注入时 `html` 还没有 `ccf-on`,规则
 * 不匹配任何元素,浏览器压根不去解析那个 `url("#...")`;等 class 加上去时
 * `#ccf-…` 已在 DOM 里,filter 值是新算出来的。**即使某个引擎缓存了
 * 「找不到」也不受影响** —— 这是消除不确定性,不是赌对。
 *
 * 注入序列(两步,顺序不可颠倒)见 `src/injection/svg-filter-def.ts`。
 *
 * ### 四种模式**统一**走 SVG(ADR-070)
 *
 * 灰阶也用 `feColorMatrix`,不再用内置 `grayscale()`。灰阶本身就是一个
 * 颜色矩阵,用内置函数只是巧合可行;若灰阶走内置函数、另三个走 SVG,
 * 两条注入路径会各自演化,又多一类「只在某条路径上出现的 bug」——
 * 本次 CSP 缺陷恰好只打中 SVG 路径而灰阶无恙,正是这种分裂的代价。
 * 统一路径也让 ADR-063 的预生成文件结构一致。
 *
 * ### 关于 INV-9 / ADR-026(往页面插节点)
 *
 * 插一个 `<svg>` 确实让页面 DOM 多出一个节点,这是 ADR-069 已权衡并接受的
 * 代价:CSP 静默失效让三个**主业**滤镜(ADR-002)在大量站点上完全不工作,
 * 而多一个 `width:0;height:0` 的隐藏节点不改变布局几何(INV-1 的几何部分
 * 不受影响)。节点挂在 `documentElement` 下而非 `body`,且带
 * `position:absolute;width:0;height:0;overflow:hidden`。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import { type FilterMode } from './filter-mode.js';
import { type Intensity, intensityFraction, isIntensity } from './intensity.js';
import { colorMatrixToValues, toColorMatrix } from './color-matrix.js';

/**
 * 滤镜 id / 文件名中代表模式的短名 —— **单一真相源**。
 *
 * 为什么不直接用 `FilterMode` 的字面量(`Grayscale`/`RedGreen`/…):
 * 短名同时进入
 *
 * - SVG `<filter id>` 与 CSS `url("#...")`(ADR-069),
 * - 预生成文件名 `filters/{slug}-{intensity}.css`(ADR-063),后者还进了
 *   注册记录与扩展包清单。
 *
 * **全小写、无大小写歧义**的短名在跨平台(macOS 默认大小写不敏感、
 * Linux 敏感)时更安全 —— 一个大小写不一致的路径在 macOS 上能跑、
 * 在 Linux 上注册即失败,而注册失败的表现是「滤镜静默不生效」,
 * 排障成本极高。
 *
 * 📌 短名取 DESIGN.md §6 T4a 示例中的 `gray-100.css` 为准,其余三个
 *    按同一构词法(模式名小写、去驼峰分隔)。
 *
 * 🔴 **本常量住在领域层,是因为 ADR-069 之后它同时决定 CSS 的
 *    `url("#id")` 与 SVG 的 `<filter id>`。** 两边必须逐字相同,否则
 *    `url()` 引用不到滤镜 —— 表现又是一次「静默失效」。故只能有一份。
 *    `src/injection/filter-file-css.ts` 重新导出它以保持既有 import 可用
 *    (向后兼容)。
 */
export const FILTER_MODE_SLUGS: Readonly<Record<FilterMode, string>> = {
  Grayscale: 'gray',
  RedGreen: 'redgreen',
  GreenRed: 'greenred',
  BlueYellow: 'blueyellow',
};

/**
 * 同文档 SVG filter 节点的 `id`(ADR-069),形如 `ccf-gray-100`。
 *
 * 🔴 **CSS 的 `url("#...")` 与 SVG 的 `<filter id>` 都必须取自本函数** ——
 *    这是 ADR-069 下「引用得到」的唯一保证。写死两份字符串,任何一边的
 *    改动都会让 `url()` 引用到不存在的 id,而那个失败是**静默**的
 *    (filter 解析为无效 → 不上色、不报错),与本轮要修的 CSP 缺陷同形。
 *
 * ## id 命名空间的冲突风险(INV-1)
 *
 * `ccf-` 前缀(Chrome Color Filters)+ 模式短名 + 强度,落在页面自身的
 * id 空间里。理论上站点可能已有同名 id;实践中 `ccf-gray-100` 这种
 * 带扩展前缀的组合撞名概率可忽略。选**带前缀**的名字正是为此。
 */
export function svgFilterId(mode: FilterMode, intensity: Intensity): string {
  return `ccf-${FILTER_MODE_SLUGS[mode]}-${intensity}`;
}

/**
 * 把 `intensity` 格式化为 CSS 可接受的数量值(0–1 的小数)。
 *
 * 固定小数位输出,避免浮点尾数污染样式表,且保证确定性
 * (同 `colorMatrixToValues` 的 `formatCoefficient` 理由)。
 *
 * 📌 ADR-070 之后灰阶也走 `feColorMatrix`,本函数不再参与 `filterCssValue`
 *    的计算。保留它是因为它是一个被测试与潜在 UI 文案使用的纯工具函数,
 *    删除会是一次与本修复无关的破坏性变更(本任务是修复,不扩大范围)。
 */
export function intensityToCssAmount(intensity: Intensity): string {
  const f = intensityFraction(intensity);
  if (Number.isInteger(f)) return String(f);
  return f.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * `filterCssValue(mode, intensity)` —— 返回可直接赋给 CSS `filter` 的字符串。
 *
 * **四种模式都走同一条路**(ADR-070):`url("#ccf-{slug}-{intensity}")`,
 * 指向同文档内的 `<filter>` 节点。永不返回 null —— 这是 INV-3 对所有模式
 * 一致成立的前提。
 *
 * 矩阵系数不在这里出现:它们由 `svgFilterMarkup`(注入层)从**同一个**
 * `toColorMatrix` 取得。本函数只产出引用,两边靠 `svgFilterId` 对齐。
 *
 * `intensity === 0` 时各模式均等价于恒等变换(视觉无变化),
 * 与 `toColorMatrix` 在 `intensity = 0` 时的语义一致。
 */
export function filterCssValue(
  mode: FilterMode,
  intensity: Intensity,
): string {
  return `url("#${svgFilterId(mode, intensity)}")`;
}

/**
 * 该 `(mode,intensity)` 对应的 `feColorMatrix` `values` 字符串。
 *
 * 独立导出是为了让注入层(`svg-filter-def.ts`)拿到系数时**不必**自己
 * 拼装 `toColorMatrix` + `colorMatrixToValues` —— 少一处可漂移的接缝
 * (ADR-063 的防漂移意图)。
 */
export function filterMatrixValues(
  mode: FilterMode,
  intensity: Intensity,
): string {
  return colorMatrixToValues(toColorMatrix(mode, intensity));
}

/**
 * `filterCssValue` 的**逆函数**:从 filter 值串还原出 `(mode, intensity)`。
 * 无法还原时返回 `null`。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 🔴 为什么需要一个逆函数(ADR-069 带来的真实需求,不是便利 API)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ADR-069 之前,filter 值是**自包含**的:`grayscale(0.5)` 或内联了整个 SVG 的
 * `data:` URI,拿到串就能上色。于是注入管线(快路径 → `RenderArbiter` →
 * `syncFilter` → 存活性恢复)一路只传一个 `string | null`。
 *
 * ADR-069 之后,filter 值变成一个**引用**:`url("#ccf-gray-50")`。要让它
 * 真的生效,必须先保证被引用的 `<filter>` 在文档里 —— 而建那个节点需要
 * `(mode, intensity)` 才能算矩阵系数。
 *
 * 两条路可选:
 *
 * 1. 把 `(mode, intensity)` 沿整条管线再传一遍(改 `RenderArbiter` 的
 *    `setBase`/`setOverride`、`syncFilter`、`LivenessOptions.desired`、
 *    `FastPathRead` …… 全部签名);
 * 2. 在**唯一的 DOM 写入点**(`syncFilter`)把 id 解回来。
 *
 * 选 2,理由是**少一份真相**:方案 1 会让「filter 值」与「(mode,intensity)」
 * 在管线里并行流动,两者必须始终一致,而任何一处忘记同步就是又一次
 * 「引用到不存在的 id」的静默失效。方案 2 下 filter 值**仍然是唯一真相**,
 * 系数在要用的那一刻现算(与 ADR-025「派生值不持久化、读时现算」同一个
 * 思路,见 `fast-path-cache.ts` 的 `readFastPath`)。
 *
 * 这不是在解析不可信输入:串由 `filterCssValue` 产出,格式由
 * `svgFilterId` 定死,且本文件对两者做了往返(round-trip)断言。
 * 解不出来时返回 `null` 而非抛异常 —— 调用方据此降级为「不注入定义」,
 * 绝不让 content script 抛到页面上(INV-1)。
 */
export function parseFilterCssValue(
  value: string,
): { readonly mode: FilterMode; readonly intensity: Intensity } | null {
  const match = /^url\("#ccf-([a-z]+)-(\d{1,3})"\)$/.exec(value);
  if (match === null) return null;

  const slug = match[1]!;
  const mode = (
    Object.keys(FILTER_MODE_SLUGS) as readonly FilterMode[]
  ).find((m) => FILTER_MODE_SLUGS[m] === slug);
  if (mode === undefined) return null;

  const intensity = Number(match[2]!);
  if (!isIntensity(intensity)) return null;

  return { mode, intensity };
}
