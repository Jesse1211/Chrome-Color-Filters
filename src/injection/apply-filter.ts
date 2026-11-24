/**
 * 注入的 DOM 侧原语(T4a 核心;**ADR-069/070 重构**)。
 *
 * 本模块只做三件事:打开滤镜、关闭滤镜、读当前状态。它**从不读取页面内容**
 * (INV-9 / ADR-026):不触 `innerText` / `innerHTML` / `textContent` /
 * `document.body`,不做子树遍历,不发任何网络请求。
 *
 * 与 `filter.css` 的分工见那个文件的头注释:CSS 负责「怎么画」(首帧前就位),
 * 本模块负责「画不画、画哪个」。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 🔴 ADR-069:注入物从「两个属性 + 一个变量」变成「一个 class + 一个 SVG」
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ### 之前是什么样,以及为什么要改
 *
 * 旧实现靠 `data-ccf-on`(上色)+ `data-ccf-off`(压制)两个属性,
 * 加一个承载 filter 值的 `--ccf-filter` 变量。**第二个属性的存在
 * 完全是因为预生成 CSS 用「裸 `html`」选择器无条件生效** —— 摘掉自家属性
 * 压不掉它,只能再加一条更高特异度的规则去压。
 *
 * ADR-069 把预生成 CSS 的选择器改成 `html.ccf-on`,于是:
 *
 * - **开闸 = 加 class**,
 * - **撤除 = 摘 class** —— 规则不再匹配,**无需任何压制规则**。
 *
 * `data-ccf-off` 与整条压制规则链因此被删掉。这正是 ADR-069 列出的附带收益:
 *
 * > 开关滤镜只需切换 class,不增删样式表;INV-8(主开关 OFF)与
 * > ADR-049(实时预览)的撤销/恢复同样简化为改 class 或改矩阵值。
 *
 * 📌 顺带消掉了旧注释里记录的那个陷阱:压制属性必须是**肯定式**的
 *    (`data-ccf-off` 而非 `:not([data-ccf-on])`),否则首帧就命中、
 *    把预生成 CSS 压掉。class 方案下这个陷阱**不存在** ——
 *    「没有 class」就是「不上色」,没有第二个状态要去表达。
 *
 * ### 注入序列:两步,顺序不可颠倒(ADR-069)
 *
 * ```js
 * // ① SVG 先就位(documentElement 此刻已存在,head/body 尚无)
 * ensureSvgFilterDef(host, mode, intensity);
 * // ② 再开闸 —— 此刻 CSS 规则 html.ccf-on 才开始匹配
 * classList.add('ccf-on');
 * ```
 *
 * **本模块是这两步的唯一实现处。** `applyFilter` / `syncFilter` 内部严格
 * 按此顺序执行,且全程同步 —— 中间不得有 `await`/定时器。调用方因此
 * 拿不到「只做了第一步」的中间态。理由(前向引用为何根本不存在、
 * 为何首帧安全)见 `svg-filter-def.ts` 头注释,不在此重复。
 *
 * ### 为什么仍然保留 `--ccf-filter` 变量
 *
 * 预生成文件每个组合一个,值在构建时写死(首帧前完全不依赖 JS);
 * 而 `filter.css` 是**一张**表要服务所有组合,故仍用
 * `filter: var(--ccf-filter)`,由 JS 赋值。两张表的特异度关系见
 * `filter.css` 头注释。
 */

import { parseFilterCssValue } from '../domain/index.js';
import {
  type SvgDefsHost,
  ensureSvgFilterDef,
  hasSvgFilterDefs,
  removeSvgFilterDefs,
} from './svg-filter-def.js';

/**
 * 🔴 **开闸 class 名**(ADR-069)。与 `filter.css` 及**预生成文件**
 * (`filter-file-css.ts`)中的 `html.ccf-on` 必须逐字一致。
 *
 * `ccf` = Chrome Color Filters。选一个带扩展前缀的名字,使它不可能与站点
 * 自身的 class 撞名(INV-1)。
 *
 * ⚠️ 这是整个方案里**唯一**的开关。不存在第二个「压制」状态 ——
 *    见本文件头注释。
 */
export const FILTER_CLASS = 'ccf-on';

/** 承载 filter 值的 CSS 自定义属性名。与 `filter.css` 中的 `var(--ccf-filter)` 一致。 */
export const FILTER_VAR = '--ccf-filter';

/**
 * 可注入的 DOM 宿主 —— 只暴露本模块真正需要的那几个能力。
 *
 * 抽成接口是为了能在 Node 下单测「class 与变量被正确设置/清除」
 * 「SVG 在 class 之前就位」这类**与浏览器无关**的逻辑。
 *
 * ⚠️ 这**不是** DESIGN.md §8 第 8 条所指的「用 mock 冒充真实栈」:
 * INV-1(几何零影响)、INV-3(零闪烁)与 ADR-069 的 CSP 抗性只能在
 * 真实 Chrome 的 REAL_STACK_GATE 里验,本接口不冒充那部分验收。
 *
 * 📌 `SvgDefsHost` 被**并入**本接口(而不是另开一个参数):注入目标与
 *    SVG 的挂载点在生产环境是**同一个** `document.documentElement`
 *    (ADR-069:「直接挂 html」)。拆成两个参数会允许它们不一致,
 *    而那种不一致的后果是 `url("#id")` 引用不到 —— 又一次静默失效。
 */
export interface FilterTarget extends SvgDefsHost {
  /**
   * `classList` 的最小抽象 —— ADR-069 的开闸手段。
   *
   * 只要 `add`/`remove`/`contains` 三项:本模块**绝不**整体读写
   * `className`(那会覆盖站点自己的 class,是对 INV-1 的直接破坏;
   * 真实站点上 `<html class>` 的改动极频繁 —— 暗色模式、滚动锁、
   * 各类框架标记)。
   */
  readonly classList: {
    add(token: string): void;
    remove(token: string): void;
    contains(token: string): boolean;
  };
  readonly style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
    getPropertyValue(name: string): string;
  };
}

/**
 * 应用滤镜 —— **ADR-069 的两步序列 + 变量赋值**,全部同步完成。
 *
 * 顺序(不可颠倒):
 *
 * 1. **SVG 定义就位**(`ensureSvgFilterDef`)—— 必须在 class 之前,
 *    否则 `url("#...")` 命中的那一刻目标还不存在。
 * 2. **写变量** —— 再开闸之前把值备好,避免 `filter: var(--ccf-filter)`
 *    解析为无效值的中间态。
 * 3. **加 class** —— 开闸。此刻 `html.ccf-on` 才开始匹配,
 *    `#ccf-…` 已在 DOM 里,filter 值是新算出来的。
 *
 * `filterValue` 必须是 `filterCssValue()` 的产出(即 `url("#ccf-…")`)。
 * 解不出 `(mode,intensity)` 时**跳过第 1 步但仍然开闸** ——
 * 这样调用方传入一个非标准值时行为退化为「只切 class + 写变量」,
 * 不抛异常(INV-1:绝不抛到页面上)。
 */
export function applyFilter(target: FilterTarget, filterValue: string): void {
  // ① SVG 先就位(ADR-069 第一步)。
  const parsed = parseFilterCssValue(filterValue);
  if (parsed !== null) {
    ensureSvgFilterDef(target, parsed.mode, parsed.intensity);
  }
  // ② 备好值。
  target.style.setProperty(FILTER_VAR, filterValue);
  // ③ 开闸(ADR-069 第二步)。
  target.classList.add(FILTER_CLASS);
}

/**
 * 移除滤镜 —— 与 `applyFilter` 严格相反的顺序。
 *
 * 1. **摘 class** —— 先关闸。`html.ccf-on` 不再匹配,**预生成 CSS 与
 *    `filter.css` 一并失效**(ADR-069:不再需要任何压制规则)。
 * 2. **清变量**。
 * 3. **摘 SVG 容器** —— 关闸之后才摘,顺序同样不可颠倒:反过来会有一个
 *    极短的中间态,class 还在而被引用的 `<filter>` 已消失。
 *
 * 结束后 `documentElement` 上不留任何本扩展的痕迹 —— **无残留节点、
 * 无残留属性、无残留 class**(T4a gate 逐字要求)。
 */
export function removeFilter(target: FilterTarget): void {
  target.classList.remove(FILTER_CLASS);
  target.style.removeProperty(FILTER_VAR);
  removeSvgFilterDefs(target);
}

/** 当前是否处于滤镜态。 */
export function isFilterApplied(target: FilterTarget): boolean {
  return target.classList.contains(FILTER_CLASS);
}

/** 当前生效的 filter 值(未滤镜时为空串)。 */
export function currentFilterValue(target: FilterTarget): string {
  return target.style.getPropertyValue(FILTER_VAR);
}

/**
 * 幂等地把目标调到期望状态。
 *
 * `null` = 不应有滤镜。已处于期望状态时**不做任何写入** ——
 * 避免无谓地触碰 `documentElement`,也避免给站点的 class/attribute
 * MutationObserver 制造无意义的回调(INV-1:不改变页面可观察行为)。
 *
 * 🔴 **这是页面上唯一的 DOM 写入点**(经 `RenderArbiter`,见
 *    `preview-receiver.ts`),因此也是 ADR-069 两步序列的唯一落点。
 */
export function syncFilter(
  target: FilterTarget,
  filterValue: string | null,
): void {
  if (filterValue === null) {
    // 🔴 ADR-069:撤除就是摘 class。**不再需要压制属性** ——
    //    预生成 CSS 的选择器也是 `html.ccf-on`,摘掉 class 它一并失效。
    //    (旧实现必须显式设 `data-ccf-off`,因为那时预生成 CSS 用裸 `html`
    //     无条件生效。那条复杂性随 ADR-069 一起消失。)
    if (
      isFilterApplied(target) ||
      currentFilterValue(target) !== '' ||
      hasSvgFilterDefs(target)
    ) {
      removeFilter(target);
    }
    return;
  }

  // ① SVG 定义就位 —— 幂等,已存在则零写入。
  const parsed = parseFilterCssValue(filterValue);
  if (parsed !== null) {
    ensureSvgFilterDef(target, parsed.mode, parsed.intensity);
  }
  // ② 值。
  if (currentFilterValue(target) !== filterValue) {
    target.style.setProperty(FILTER_VAR, filterValue);
  }
  // ③ 开闸。
  if (!isFilterApplied(target)) {
    target.classList.add(FILTER_CLASS);
  }
}
