/**
 * `filterCssValue(mode, intensity)` —— 把 `(mode, intensity)` 映射为可直接写进
 * CSS `filter` 属性的字符串(T0 spike §2.1 的 `__FILTER__`)。
 *
 * 纯 TypeScript —— 零 React / 零 chrome.* / 零 wxt(ADR-036)。
 * ADR-025 的**派生值**:由 `(mode,intensity)` 纯函数算出,**绝不持久化**。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 🔴 ADR-075:滤镜值回到纯 CSS 内置函数,整套 SVG 机制已删除
 *
 * 本文件此前有两条分支:`Grayscale` 走 CSS 内置 `grayscale(amount)`,
 * 另三个 CVD 模式走 `url("data:image/svg+xml,…<feColorMatrix …>…#f")`。
 * **ADR-075 删掉了那三个模式,连带删掉了整条 `data:` URI 分支**
 * (`svgFilterDataUri`、`colorMatrixToValues`、`toColorMatrix`、全部 CVD 矩阵)。
 *
 * 那条分支是本项目绝大部分复杂度的来源,删掉它一次性消除了四个难题:
 *
 * 1. **CSP 静默失效(ADR-069/073)** —— `data:` URI 会被站点的 CSP
 *    (`img-src` / `default-src`)拦截,表现为「用户以为开着,其实没开,
 *    且无任何报错」。`grayscale()` 是 CSS 内置函数,**不产生任何资源加载**,
 *    无从被任何 CSP 指令拦截。灰阶自始至终无恙(ADR-070 原文已记载)。
 * 2. **首帧闪烁(ADR-072/074)** —— 三个 CVD 模式没有自包含的 CSS 内置等价值,
 *    实测 coldCache 首访首帧 `filter:none`。`grayscale(amount)` 同场景已在首帧,
 *    于是 **INV-3 恢复为无例外的硬性要求**(ADR-072 的例外随 ADR-075 消失)。
 * 3. **ADR-070 与 INV-3 的直接冲突** —— 「四模式统一走 SVG」要求灰阶也等 JS 建节点。
 * 4. **`styles.cjs` 两条判据互斥** —— 压制 class 是功能本体却被计为残留。
 *
 * **保真度零损失:** W3C Filter Effects Level 1 §8.5 规定 `grayscale(amount)`
 * **就是**用 BT.709 系数(0.2126 / 0.7152 / 0.0722)在恒等与满强度之间插值 ——
 * 与被删掉的 `toColorMatrix('Grayscale', n)` 数学上完全等价
 * (ADR-075 记载:实测 216 个采样点 CIE ΔE 全为 0.0)。
 * 所以删掉矩阵代码**不改变任何一个像素**。
 *
 * ## 不变的要害:返回值必须是「一个可放进静态样式表的纯字符串」
 *
 * 这是 INV-3 的前提,与模式数量无关。滤镜值必须能写进
 * `content_scripts[].css` 指向的预生成文件里(ADR-062/063),
 * 从而在**任何 JS 之前**就位。任何需要「先往文档里插一个节点、
 * 再用 `filter: url("#id")` 引用它」的方案都同时违反:
 *
 * - **INV-3** —— 插节点要么等 DOM、要么等 JS 先 `await` 异步的
 *   `chrome.storage`;静态样式表赶得上首帧,这两者都赶不上
 *   (T0 spike §4.4 的 a3 方案实拍到 wikipedia 一整屏未滤镜的彩色页面;
 *   ADR-072 又记载「引用不存在时整条 filter 被忽略、首帧原色」)。
 * - **INV-9 / ADR-026** —— 往宿主页面插节点就是修改页面 DOM:站点自身的
 *   `document.body.children`、`:last-child` 选择器、MutationObserver
 *   都会观测到它(T0 spike §4.4 第 2 点已实测确认)。
 *
 * `grayscale(amount)` 天然满足该前提:它只是一个字符串,零节点、零资源加载。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import { type FilterMode } from './filter-mode.js';
import { type Intensity, intensityFraction } from './intensity.js';

/**
 * 把 `intensity` 格式化为 CSS 可接受的数量值(0–1 的小数)。
 *
 * 固定小数位输出,避免浮点尾数污染样式表,且保证确定性 ——
 * 预生成文件是**提交进仓库**的构建产物(ADR-063),
 * 不确定的格式化会让 `git diff` 在零语义变化时抖动。
 */
export function intensityToCssAmount(intensity: Intensity): string {
  const f = intensityFraction(intensity);
  if (Number.isInteger(f)) return String(f);
  return f.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * `filterCssValue(mode, intensity)` —— 返回可直接赋给 CSS `filter` 的字符串。
 *
 * **永不返回 null** —— 这是 INV-3 的前提:首帧必须有一个自包含的值可用。
 *
 * ADR-075 后只有 `Grayscale` 一个模式,故返回值恒为 `grayscale(<amount>)`。
 * `mode` 形参**刻意保留**:ADR-075 要求数据结构为「将来加回模式」留口,
 * 签名跟着留口 —— 加回模式时只需在本函数内分支,不必改动任何调用点
 * (调用点散布在 `filter-file-css.ts`、`apply-filter.ts`、预览通道三处)。
 *
 * `intensity === 0` → `grayscale(0)`,等价于恒等变换(视觉无变化),
 * 这是 ADR-003「两端均可达」与门禁「强度 0 时页面视觉无变化」所要求的。
 */
export function filterCssValue(
  mode: FilterMode,
  intensity: Intensity,
): string {
  // ADR-075:唯一模式。`mode` 未被读取是刻意的 —— 见上方签名说明。
  void mode;
  return `grayscale(${intensityToCssAmount(intensity)})`;
}
