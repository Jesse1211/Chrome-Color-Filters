/**
 * `filterCssValue(mode, intensity)` —— 把 `(mode, intensity)` 映射为可直接写进
 * CSS `filter` 属性的字符串(T0 spike §2.1 的 `__FILTER__`)。
 *
 * 纯 TypeScript —— 零 React / 零 chrome.* / 零 wxt(ADR-036)。
 * 与 `toColorMatrix` 同为 ADR-025 的**派生值**:由 `(mode,intensity)` 纯函数算出,
 * **绝不持久化**。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 为什么四种模式都必须能用「纯字符串」表达(INV-3 的真正要害)
 *
 * `toColorMatrix` 产出的是 SVG `feColorMatrix` 的 20 个系数。把它作用到页面上的
 * **常规**做法是往文档里插一个 `<svg><filter id>` 节点,再用 `filter: url(#id)` 引用。
 * 这条路在 T4a 上是死的,有两个独立的致命问题:
 *
 * 1. **违反 INV-3。** `document_start` 时只有 `documentElement`;插节点这件事本身
 *    要么等 DOM,要么由 JS 同步做 —— 而 JS 想知道该用哪个矩阵,必须先 `await`
 *    异步的 `chrome.storage`。静态样式表能赶在首帧之前,「JS 先 await 再插节点」不能。
 *    T0 spike §4.4 实测的 a3 方案正是栽在这里:等 DOM 的那几毫秒就是彩色闪帧
 *    (wikipedia 实拍到一整屏未滤镜的彩色页面)。
 *
 * 2. **违反 INV-9/ADR-026 的精神。** 往宿主页面插 SVG 节点就是修改页面 DOM:
 *    站点自身的 `document.body.children`、`:last-child` 选择器、MutationObserver
 *    都会观测到它。T0 spike §4.4 第 2 点实测确认覆盖层 div 确实出现在
 *    页面自身的 fixed 元素枚举结果里 —— 这是可观察行为的改变。
 *
 * ## 解法:把 SVG 滤镜本身放进 `data:` URI,于是它也只是一个字符串
 *
 * CSS 的 `filter: url(...)` **不要求** 被引用的 SVG 存在于当前文档。
 * 引用一个 `data:image/svg+xml,...#id` 形式的 URI 同样合法 ——
 * 滤镜定义随 URI 内联,浏览器自行解析,**页面 DOM 里不增加任何节点**。
 *
 * 于是四种模式统一成「一个可放进静态样式表的字符串」:
 * - `Grayscale`  → `grayscale(<amount>)`(CSS 原生函数)
 * - 其余三种     → `url("data:image/svg+xml,<svg>…<feColorMatrix values='…'/>…#f")`
 *
 * 两条路都不需要 DOM 节点,都能写进 `content_scripts[].css`,
 * 因而**四种模式享有完全相同的零闪烁保证** —— 这很重要:
 * RedGreen/GreenRed/BlueYellow 才是本扩展的色觉辅助主业(ADR-002),
 * 若只有 Grayscale 零闪烁、辅助模式闪烁,INV-3 等于没有对真实用户成立。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import { type FilterMode } from './filter-mode.js';
import { type Intensity, intensityFraction } from './intensity.js';
import { colorMatrixToValues, toColorMatrix } from './color-matrix.js';

/**
 * 内联 SVG 滤镜里使用的 filter id。
 *
 * 只出现在 `data:` URI 内部的那个独立文档里,**不进入宿主页面的 id 空间** ——
 * 故不可能与站点自身的 id 冲突(INV-1:不改变页面可观察行为)。
 */
export const INLINE_FILTER_ID = 'f';

/**
 * 把 `intensity` 格式化为 CSS 可接受的数量值(0–1 的小数)。
 *
 * 固定小数位输出,避免浮点尾数污染样式表,且保证确定性
 * (同 `colorMatrixToValues` 的 `formatCoefficient` 理由)。
 */
export function intensityToCssAmount(intensity: Intensity): string {
  const f = intensityFraction(intensity);
  if (Number.isInteger(f)) return String(f);
  return f.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * 构造内联 SVG 滤镜的 `data:` URI。
 *
 * ## 转义
 *
 * `data:image/svg+xml,` 之后的内容必须是 URL 安全的。这里**不用** `encodeURIComponent`
 * 整体编码(可读性差且体积翻倍),而是只转义在 CSS `url()` 与 URI 语境中真正有歧义的字符:
 * `<` `>` `"` `#` `%` 与空格。其中 `#` 必须转义,否则会被当成 fragment 分隔符,
 * 把 SVG 内容在 `#` 处截断 —— 而我们**自己**要在末尾用一个真正的 `#` 指向 filter id。
 *
 * 矩阵系数由 `colorMatrixToValues` 产出,只含数字、空格、小数点与负号,
 * 空格已在下面统一转义为 `%20`。
 */
function svgFilterDataUri(matrixValues: string): string {
  // 单引号在 `data:` URI 与 CSS `url("...")` 中都无需转义,故 SVG 属性一律用单引号。
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg'>` +
    `<filter id='${INLINE_FILTER_ID}' color-interpolation-filters='sRGB'>` +
    `<feColorMatrix type='matrix' values='${matrixValues}'/>` +
    `</filter></svg>`;

  const escaped = svg
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/"/g, '%22')
    .replace(/ /g, '%20');

  return `data:image/svg+xml,${escaped}#${INLINE_FILTER_ID}`;
}

/**
 * `filterCssValue(mode, intensity)` —— 返回可直接赋给 CSS `filter` 的字符串。
 *
 * **四种模式都有返回值,永不返回 null** —— 这是 INV-3 对所有模式一致成立的前提。
 *
 * - `Grayscale` → `grayscale(<amount>)`。W3C Filter Effects Level 1 §8.5 规定
 *   `grayscale()` **就是**用 BT.709 亮度系数在恒等与满强度之间插值,与
 *   `toColorMatrix('Grayscale', n)` 数学上完全等价(见 `color-matrix.ts` 同一处引用),
 *   故直接用原生函数:更短、更快,且走浏览器的原生快路径。
 * - 其余三种 → 内联 `data:` URI 引用的 `feColorMatrix`,系数取自 `toColorMatrix`,
 *   **与 ADR-025 的唯一真相源保持一致**(不另行复制一套系数)。
 *
 * `intensity === 0` 时各模式均等价于恒等变换(视觉无变化),
 * 与 `toColorMatrix` 在 `intensity = 0` 时的语义一致。
 */
export function filterCssValue(
  mode: FilterMode,
  intensity: Intensity,
): string {
  if (mode === 'Grayscale') {
    return `grayscale(${intensityToCssAmount(intensity)})`;
  }
  const values = colorMatrixToValues(toColorMatrix(mode, intensity));
  return `url("${svgFilterDataUri(values)}")`;
}
