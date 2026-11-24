/**
 * `FilterMode` 值对象(ADR-002 → **ADR-075**)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **ADR-075:只剩 `Grayscale` 一个取值。**
 *
 * 原 `RedGreen` / `GreenRed` / `BlueYellow` 三个色觉辅助模式已删除
 * (产品负责人拍板)。连带删除的是**整套同文档 SVG 机制** ——
 * `toColorMatrix` 与 CVD 矩阵、`data:` URI 的 `feColorMatrix` 引用、
 * 404 个预生成文件中的 303 个。
 *
 * 为什么这不只是删三个枚举值:那三个模式是 CSP 静默失效(ADR-069/073)、
 * 首帧闪烁(ADR-072/074)、`styles.cjs` 两条判据互斥这几个难题的**唯一**成因。
 * `grayscale(amount)` 是 CSS 内置函数,不产生资源加载、无从被 `img-src` 拦截、
 * 不需要任何 DOM 节点 —— 于是 INV-3 恢复为**无例外**的硬性要求。
 *
 * ## 为什么保留 `FILTER_MODES` 数组与整套收敛函数
 *
 * 单取值的联合类型本可以写成 `type FilterMode = 'Grayscale'`,
 * 但 ADR-075 明文要求「规则的 `mode` 字段仍然保留,以便将来加回模式时
 * 数据结构不变」。保留数组形态使「加回一个模式」只需往数组里加一项,
 * 而不必把一个被摊平的字面量重新展开成联合类型。
 *
 * INV-2(模式互斥)因此退化为平凡真,但 DESIGN.md 明文保留它 ——
 * 删掉会让后人以为从未要求过互斥。
 *
 * ## 🔴 存储兼容(ADR-041 / ADR-075 的迁移口)
 *
 * 磁盘上**已存在**的规则可能带 `'RedGreen'` / `'GreenRed'` / `'BlueYellow'`。
 * 迁移策略是**读时收敛**:`coerceFilterMode` 对任何不在 `FILTER_MODES` 中的
 * 输入一律回退 `Grayscale`,与它原本处理垃圾数据的语义完全相同 ——
 * 不需要版本号跃迁、不需要一次性迁移脚本、不需要在读路径写回磁盘
 * (后者正是 ADR-071 废止 `maxSeenTime` 时清掉的那类副作用)。
 * 旧值在用户下一次保存该规则时自然被覆盖为 `Grayscale`。
 *
 * 纯 TypeScript —— 零 React / 零 chrome.* / 零 wxt(ADR-036)。
 */

/**
 * 全部滤镜模式。**ADR-075:仅 `Grayscale`。**
 *
 * 🔴 想把删掉的三项加回来不是改这一行就够了:必须同时恢复 ADR-030 的
 * 「色块绝不可在没有文字名称的情况下出现」硬性约束、重建 SVG 滤镜机制,
 * 并重新核验 ADR-069/072/073/074 的全部实测结论(它们保留在账本中以备重用)。
 */
export const FILTER_MODES = ['Grayscale'] as const;

export type FilterMode = (typeof FILTER_MODES)[number];

/** 默认模式:新建规则为 Grayscale @ 100%(ADR-020)。 */
export const DEFAULT_FILTER_MODE: FilterMode = 'Grayscale';

export function isFilterMode(value: unknown): value is FilterMode {
  return (
    typeof value === 'string' &&
    (FILTER_MODES as readonly string[]).includes(value)
  );
}

/**
 * 把任意输入收敛为合法 FilterMode。
 *
 * 读到未知/损坏数据时回退默认值而不抛异常(ADR-041)。
 * **ADR-075 后这同时承担了迁移职责**:磁盘上遗留的 `'RedGreen'` /
 * `'GreenRed'` / `'BlueYellow'` 与任意垃圾值走同一条路,一律变成 `Grayscale`。
 */
export function coerceFilterMode(value: unknown): FilterMode {
  return isFilterMode(value) ? value : DEFAULT_FILTER_MODE;
}
