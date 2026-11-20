/**
 * 注入的 DOM 侧原语(T4a 核心)。
 *
 * 本模块只做三件事,且**只碰 `documentElement` 上的两个自有属性**:
 * 打开滤镜、关闭滤镜、读当前状态。它**从不读取页面内容**(INV-9 / ADR-026):
 * 不触 `innerText` / `innerHTML` / `textContent` / `document.body`,
 * 不做 `querySelectorAll` 遍历,不发任何网络请求。
 *
 * 与 `filter.css` 的分工见那个文件的头注释:CSS 负责「怎么画」(首帧前就位),
 * 本模块负责「画不画、画哪个」(把判定结果写成一个属性 + 一个变量)。
 *
 * ## 为什么注入物是「属性 + CSS 变量」而不是 `<style>` 节点
 *
 * T0 spike §2.2 给的参考实现是 JS 建一个 `<style>` 挂到 `documentElement`。
 * 那在「JS 已经知道滤镜值」的前提下是对的,但本实现把样式表前移成了
 * manifest 的静态 CSS(INV-3 的要求,见 `filter.css`),于是 JS 侧只剩下赋值。
 *
 * 用属性 + 变量而非插节点,额外买到两件事:
 * - **INV-9 更强的保证**:页面 DOM 的**节点数不变**。站点的
 *   `document.body.children` / `:last-child` / childList MutationObserver 全都观测不到变化
 *   (T0 §4.4 第 2 点记录过插节点确实会被页面枚举到)。
 * - **移除即彻底**:关闭时把属性与变量一并删掉,`documentElement` 回到原样,
 *   无残留节点 / 属性 / class(T4a gate 明确要求)。
 */

/**
 * 门控属性名。与 `filter.css` 中的 `html[data-ccf-on]` 必须一致。
 *
 * `data-` 前缀是 HTML 标准的自定义属性命名空间,`ccf` = Chrome Color Filters。
 * 选一个带扩展前缀的名字,使它不可能与站点自身的属性撞名(INV-1)。
 */
export const FILTER_ATTR = 'data-ccf-on';

/** 承载 filter 值的 CSS 自定义属性名。与 `filter.css` 中的 `var(--ccf-filter)` 一致。 */
export const FILTER_VAR = '--ccf-filter';

/**
 * 可注入的 DOM 宿主 —— 只暴露本模块真正需要的那几个能力。
 *
 * 抽成接口是为了能在 Node 下单测「属性与变量被正确设置/清除」这类
 * **与浏览器无关**的逻辑。
 *
 * ⚠️ 这**不是** DESIGN.md §8 第 8 条所指的「用 mock 冒充真实栈」:
 * INV-1(几何零影响)与 INV-3(零闪烁)只能在真实 Chrome 的
 * REAL_STACK_GATE 里验,本接口不冒充那部分验收。
 */
export interface FilterTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  readonly style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
    getPropertyValue(name: string): string;
  };
}

/**
 * 应用滤镜:写入 CSS 变量,再打开门控属性。
 *
 * **顺序是有意的**:先把变量写好,再加属性。反过来会存在一个极短的中间态,
 * 此时 `html[data-ccf-on]` 已匹配但 `--ccf-filter` 尚未赋值,
 * `filter: var(--ccf-filter)` 会解析为无效值 —— 虽然在同一个同步块内
 * 浏览器不会插入渲染时机,但保持「先备好值再开闸」的顺序是无成本的正确性。
 */
export function applyFilter(target: FilterTarget, filterValue: string): void {
  target.style.setProperty(FILTER_VAR, filterValue);
  target.setAttribute(FILTER_ATTR, '');
}

/**
 * 移除滤镜:关门控属性,再清变量 —— 与 `applyFilter` 严格相反的顺序。
 *
 * 结束后 `documentElement` 上不留任何本扩展的痕迹(T4a gate:
 * 「移除滤镜后 DOM 恢复原状,无残留节点/属性/class」)。
 */
export function removeFilter(target: FilterTarget): void {
  target.removeAttribute(FILTER_ATTR);
  target.style.removeProperty(FILTER_VAR);
}

/** 当前是否处于滤镜态。 */
export function isFilterApplied(target: FilterTarget): boolean {
  return target.hasAttribute(FILTER_ATTR);
}

/** 当前生效的 filter 值(未滤镜时为空串)。 */
export function currentFilterValue(target: FilterTarget): string {
  return target.style.getPropertyValue(FILTER_VAR);
}

/**
 * 幂等地把目标调到期望状态。
 *
 * `null` = 不应有滤镜。已处于期望状态时**不做任何写入** ——
 * 避免无谓地触碰 `documentElement`,也避免给站点的 attribute
 * MutationObserver 制造无意义的回调(INV-1:不改变页面可观察行为)。
 */
export function syncFilter(
  target: FilterTarget,
  filterValue: string | null,
): void {
  if (filterValue === null) {
    if (isFilterApplied(target)) removeFilter(target);
    return;
  }
  if (currentFilterValue(target) !== filterValue) {
    target.style.setProperty(FILTER_VAR, filterValue);
  }
  if (!isFilterApplied(target)) {
    target.setAttribute(FILTER_ATTR, '');
  }
}
