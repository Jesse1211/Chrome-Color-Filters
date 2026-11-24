/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 声明式注册的**同步探测**(ADR-062 + ADR-069,INV-3)—— 冷缓存零闪烁的承担者。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 这个模块修的是一个实测回归
 *
 * ADR-069 给预生成 CSS 加了 `.ccf-on` 门控(必需:它消除前向引用的
 * 不确定性)。但门控**把 JS 重新放回了页面加载的关键路径** —— 而 ADR-062
 * 的零闪烁保证恰恰建立在「那条 CSS 规则零 JS 依赖」之上。
 *
 * 真实 Chrome 逐帧录屏当场抓到:**冷缓存**下(宿主 origin 的
 * `localStorage` 无条目)`readFastPath` 返回 `unknown`,同步阶段
 * **无事可做**,`ccf-on` 要等异步 `chrome.storage` 读完才加上。
 * 实测 `coldCache 1/4`、`1/3`、`1/5`、`2/127` 帧带色(HN 橙色页头、
 * GitHub 彩色条带,完整渲染的未滤镜页面);同一套 harness 在门控之前的
 * trunk 上「连续 5 次全绿」。
 *
 * ⚠️ 这与 `filter-file-css.ts` 记载的那次 `html[data-ccf-on]` 失败
 *    **是同一个根因**:门控等异步结果。ADR-069 的论证「class 与 SVG 同处
 *    `document_start` 的同步段」只在**快路径命中**时成立 ——
 *    冷缓存下那个同步段里压根没有「该上色」这个信息。
 *
 * ## 修的方式:不撤门控,而是补上那个缺失的同步输入
 *
 * 预生成 CSS 由 `registerContentScripts` 按**用户规则算出的 `matches`**
 * 注册(`reconcile.ts` 的 `desiredRegistrations`)。**所以该文件一旦出现在
 * 文档里,浏览器就已经替我们判定过「本 host 该上色,且用这个
 * (mode,intensity)」** —— 这个判定无需再向 `chrome.storage` 问一遍。
 *
 * 每个预生成文件因此多一行**无门控**的自述:
 * `html { --ccf-registered: ccf-gray-100; }`。本模块用
 * `getComputedStyle(documentElement)` 把它同步读出来 ——
 * **零存储访问、零 await、零页面内容**。
 *
 * ## 为什么这不违反任何 ADR
 *
 * - **ADR-069 一字未改**:门控仍是 `html.ccf-on`,顺序仍是「先 SVG 后 class」。
 *   本模块只提供**输入**,两步序列仍由 `apply-filter.ts` 独家实现。
 *   ADR-069 要求 class 在同步段内加上;本模块正是让这一点在冷缓存下
 *   也成立的手段。
 * - **ADR-060 的定位不变**:`localStorage` 快路径仍是「双重保险」。
 *   本模块与它**互补**而非替代 —— 见 `readRegisteredMarker` 的注释。
 * - **INV-9 / ADR-026**:读的是本扩展自己的 CSS 写进计算样式的一个
 *   `--ccf-` 前缀属性,不是页面内容;不枚举样式表、不碰
 *   `document.styleSheets`(跨 origin 的 `cssRules` 会抛,且枚举站点样式表
 *   正是 INV-9 禁止的)。只问一个**写死的属性名**,能力上无法读到别的东西。
 * - **INV-8 / ADR-027**:主开关 OFF 时 `desiredRegistrations()` 返回空集,
 *   `reconcile()` 据此 unregister 全部 —— **CSS 文件压根不会被注入**,
 *   于是本模块读到空串、什么都不做。主开关的强制点仍在「注册与否」,
 *   不在本模块(见 `filter-file-css.ts` 的 INV-8 一节)。
 */

import {
  type FilterMode,
  type Intensity,
  FILTER_REGISTERED_VAR,
  parseRegisteredMarker,
} from '../domain/index.js';

/**
 * 读取计算样式的最小能力 —— 便于在 Node 下单测(同 `SyncKeyValueStore`
 * 与 `SvgDefsHost` 的做法)。
 *
 * 📌 真实实现是 `(el) => getComputedStyle(el)`。抽成函数而不是直接调全局,
 *    是为了让「冷缓存下同步阶段确实上了色」这件**与浏览器无关**的编排
 *    能被机械断言 —— 真实栈的零闪烁仍由 REAL_STACK_GATE 验收,
 *    本接口不冒充那部分(DESIGN.md §8 第 8 条)。
 */
export interface ComputedStyleReader {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  (element: any): { getPropertyValue(name: string): string };
}

/**
 * 同步探测「本页是否已被声明式注册,注册的是哪个 `(mode,intensity)`」。
 *
 * `null` = 没有注册(绝大多数页面,属性不存在 → 空串)或值无法解析
 * → 调用方**什么都不做**,行为与本模块不存在时完全一致(向后兼容)。
 *
 * 🔴 **全程同步,且绝不抛异常**:它跑在 `document_start` 的同步段里,
 *    抛出去就是对 INV-1 的破坏(content script 的异常会进页面的
 *    错误处理器)。宿主缺 `getComputedStyle`(纯对象替身、非浏览器宿主)
 *    时一律降级为 `null` —— 同 `liveness.ts` 对缺失 `MutationObserver`
 *    的处理。
 *
 * 📌 **与 ADR-060 快路径的分工**(两者都保留,因为各自覆盖对方的盲区):
 *
 *    | | 覆盖 | 盲区 |
 *    |-|------|------|
 *    | 本模块(注册自述) | 冷缓存、新标签页、浏览器重启后首访 —— 只要注册在 | 被**超集多匹配**带进来的页面(拿到 CSS 但其实不该上色)、以及放宽无界而**未注册**的 glob |
 *    | ADR-060 快路径 | 未注册的 glob(无界放宽那一类)的首帧推测 | 冷缓存一律 `unknown` |
 *
 *    故两者是**或**的关系:任一给出肯定答案就上色,随后由异步权威阶段
 *    统一纠正。多匹配误伤的收敛仍靠异步阶段撤除,这与 ADR-069 之前
 *    裸 `html` 时代的行为**完全一致**(那时误伤的页面同样会先上色再被撤),
 *    所以本修复没有扩大误伤窗口 —— 它只是把窗口恢复到回归之前。
 */
export function readRegisteredMarker(
  element: unknown,
  getComputed?: ComputedStyleReader | undefined,
): { readonly mode: FilterMode; readonly intensity: Intensity } | null {
  const reader = getComputed ?? defaultComputedStyleReader();
  if (reader === null) return null;

  let raw: string;
  try {
    raw = reader(element).getPropertyValue(FILTER_REGISTERED_VAR);
  } catch {
    // 非 DOM 宿主 / 实现缺失 —— 降级为「没有注册」,绝不抛到页面上。
    return null;
  }
  if (typeof raw !== 'string') return null;

  return parseRegisteredMarker(raw);
}

/**
 * 全局 `getComputedStyle` 的软取用 —— 取不到返回 `null`(降级为不探测)。
 *
 * 按本仓已有约定,平台取用统一收束在 `globalThis` 取值的软失败辅助函数里
 * (同 `preview-receiver.ts` 的 `defaultOnConnect`、`liveness.ts` 的
 * `defaultObserverFactory`)。
 */
export function defaultComputedStyleReader(): ComputedStyleReader | null {
  const fn = (
    globalThis as { getComputedStyle?: (element: unknown) => unknown }
  ).getComputedStyle;
  if (typeof fn !== 'function') return null;
  return ((element: unknown) =>
    fn.call(globalThis, element)) as ComputedStyleReader;
}
