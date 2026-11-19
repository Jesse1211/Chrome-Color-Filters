/**
 * 滤镜标识(DESIGN.md §5.2 / ADR-030)—— **共享基础**。
 *
 * T6a 建立,T6b / T6c 复用(§6 T6a spec:「§5.1 的设计 token 与 §5.2 的滤镜色块定义
 * 是共享基础,由 T6a 建立」)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **ADR-030 硬性约束:色块绝不可单独承载语义。**
 *
 * > 红绿与绿红的色块对红绿色盲用户**无法分辨** —— 而他们正是这两个滤镜的目标用户。
 * > 因此色块必须始终与文字名称并列出现。任何「只有色块没有文字」的位置都是缺陷。
 *
 * 本模块把**渐变与名称绑定在同一个数据结构里**,使「取了色块却没取名字」
 * 在调用点上是一件需要刻意绕开的事,而不是顺手就会犯的疏漏。
 * 渲染侧的强制在 `FilterSwatch`(src/ui/components/FilterSwatch.tsx):
 * 该组件**同时**渲染色块与名称,不提供只出色块的用法。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 📌 §6.1 已知冲突第 5 条:设计稿的 `x.com` 行用了 `#A8ACB1→#DADDE1` 渐变 ——
 * 该值**不在 §5.2 表内**,是设计稿的笔误。四个滤镜的渐变**只能**取下表中的值。
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
 * §5.2 表格,逐值誊写。
 *
 * | 滤镜 | 渐变 | 名称 | 副标题 |
 * |---|---|---|---|
 * | Grayscale  | `#9AA0A6 → #D5D8DC` | 灰阶 | 完全去除色彩 |
 * | RedGreen   | `#C25B4E → #5B9E55` | 红绿 | 红色弱 · 红绿色觉辅助 |
 * | GreenRed   | `#5B9E55 → #C25B4E` | 绿红 | 绿色弱 · 红绿色觉辅助 |
 * | BlueYellow | `#4C6FD4 → #D9C25A` | 蓝黄 | 蓝黄色觉辅助 |
 *
 * ADR-030:渐变**方向**区分红绿 / 绿红 —— 两者的起止色恰好互换,
 * 这正是「色块不能单独承载语义」的直接证据。
 */
export const FILTER_IDENTITY: Readonly<Record<FilterMode, FilterIdentity>> = {
  Grayscale: {
    gradientFrom: '#9AA0A6',
    gradientTo: '#D5D8DC',
    name: '灰阶',
    subtitle: '完全去除色彩',
  },
  RedGreen: {
    gradientFrom: '#C25B4E',
    gradientTo: '#5B9E55',
    name: '红绿',
    subtitle: '红色弱 · 红绿色觉辅助',
  },
  GreenRed: {
    gradientFrom: '#5B9E55',
    gradientTo: '#C25B4E',
    name: '绿红',
    subtitle: '绿色弱 · 红绿色觉辅助',
  },
  BlueYellow: {
    gradientFrom: '#4C6FD4',
    gradientTo: '#D9C25A',
    name: '蓝黄',
    subtitle: '蓝黄色觉辅助',
  },
};

/** 取某个模式的标识。未知模式回退灰阶(ADR-041 的同一精神:不抛异常)。 */
export function filterIdentity(mode: FilterMode): FilterIdentity {
  return FILTER_IDENTITY[mode] ?? FILTER_IDENTITY.Grayscale;
}

/**
 * 色块的 CSS 渐变值。方向固定 `90deg`(与设计稿的 `linear-gradient(90deg,…)` 一致),
 * 使红绿 / 绿红在视觉上互为镜像(ADR-030)。
 */
export function swatchGradient(mode: FilterMode): string {
  const id = filterIdentity(mode);
  return `linear-gradient(90deg, ${id.gradientFrom}, ${id.gradientTo})`;
}

/** 滤镜名称。色块的**必备同伴**(ADR-030)。 */
export function filterName(mode: FilterMode): string {
  return filterIdentity(mode).name;
}
