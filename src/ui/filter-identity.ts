/**
 * 滤镜标识(DESIGN.md §5.2 / ADR-030)—— **共享基础**。
 *
 * T6a 建立,T6b / T6c 复用(§6 T6a spec:「§5.1 的设计 token 与 §5.2 的滤镜色块定义
 * 是共享基础,由 T6a 建立」)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **文字名称必须与色块并列出现 —— 该做法保留(ADR-075 下的处置)。**
 *
 * ADR-030 的**原硬性约束**是:
 *
 * > 红绿与绿红的色块对红绿色盲用户**无法分辨** —— 而他们正是这两个滤镜的目标用户。
 * > 因此色块必须始终与文字名称并列出现。任何「只有色块没有文字」的位置都是缺陷。
 *
 * ADR-075 删掉红绿/绿红/蓝黄后,**该约束的原始理由不再适用**
 * (只剩灰阶一个模式,不存在「两个色块分不开」的冲突)。
 * DESIGN.md §5.2 把它记为「已失效但保留于此备用」。
 *
 * 📌 **但文字名称本身不删。** 理由有两层:
 *   1. 一个孤立的灰色渐变方块无论如何都不自解释 ——「灰阶」二字是它的全部语义;
 *   2. 将来加回色觉滤镜时,ADR-030 的硬性约束必须同时恢复。
 *      若现在把名称拆掉,恢复时要重新发现「为什么需要它」,
 *      而那个理由是从色盲用户的真实不可分辨性推出来的,不容易被重新想到。
 *
 * 本模块因此仍把**渐变与名称绑定在同一个数据结构里**,使「取了色块却没取名字」
 * 在调用点上是一件需要刻意绕开的事,而不是顺手就会犯的疏漏。
 * 渲染侧的强制在 `FilterSwatch`(src/ui/components/FilterSwatch.tsx):
 * 该组件**同时**渲染色块与名称,不提供只出色块的用法。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 📌 §6.1 已知冲突第 5 条:设计稿的 `x.com` 行用了 `#A8ACB1→#DADDE1` 渐变 ——
 * 该值**不在 §5.2 表内**,是设计稿的笔误。滤镜的渐变**只能**取下表中的值。
 */

import { type FilterMode } from '../domain/filter-mode.js';

export interface FilterIdentity {
  /** 渐变的起止色(§5.2 表格「渐变」列),按 `from → to` 的方向。 */
  readonly gradientFrom: string;
  readonly gradientTo: string;
  /** 中文名称(ADR-047:首版仅中文)。**必须与色块并列出现**(ADR-030)。 */
  readonly name: string;
  /** 副标题(§5.2 表格「副标题」列)。 */
  readonly subtitle: string;
}

/**
 * §5.2 表格,逐值誊写。**ADR-075 后只剩一行。**
 *
 * | 滤镜 | 渐变 | 名称 | 副标题 |
 * |---|---|---|---|
 * | Grayscale  | `#9AA0A6 → #D5D8DC` | 灰阶 | 完全去除色彩 |
 *
 * 原 RedGreen / GreenRed / BlueYellow 三行已随 ADR-075 删除。
 * 那三行里藏着 ADR-030 原约束的直接证据 —— 红绿与绿红的起止色**恰好互换**,
 * 即两个不同滤镜的色块互为镜像;删除时一并记在这里,
 * 以免将来加回模式的人以为「渐变方向随便定」。
 */
export const FILTER_IDENTITY: Readonly<Record<FilterMode, FilterIdentity>> = {
  Grayscale: {
    gradientFrom: '#9AA0A6',
    gradientTo: '#D5D8DC',
    name: '灰阶',
    subtitle: '完全去除色彩',
  },
};

/** 取某个模式的标识。未知模式回退灰阶(ADR-041 的同一精神:不抛异常)。 */
export function filterIdentity(mode: FilterMode): FilterIdentity {
  return FILTER_IDENTITY[mode] ?? FILTER_IDENTITY.Grayscale;
}

/**
 * 色块的 CSS 渐变值。方向固定 `90deg`(与设计稿的 `linear-gradient(90deg,…)` 一致)。
 *
 * 📌 原先固定 `90deg` 的理由之一是「使红绿 / 绿红在视觉上互为镜像」(ADR-030)。
 * 那两个模式已随 ADR-075 删除,但方向仍固定 `90deg` —— 它同时是设计稿的取值,
 * 且加回模式时镜像关系要能原样恢复。
 */
export function swatchGradient(mode: FilterMode): string {
  const id = filterIdentity(mode);
  return `linear-gradient(90deg, ${id.gradientFrom}, ${id.gradientTo})`;
}

/** 滤镜名称。色块的**必备同伴** —— 见文件头为什么 ADR-075 后仍然如此。 */
export function filterName(mode: FilterMode): string {
  return filterIdentity(mode).name;
}
