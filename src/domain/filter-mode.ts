/**
 * `FilterMode` 值对象(ADR-002)。
 *
 * 四选一,互斥(INV-2)。不做多滤镜叠加(非目标),不做 Color Tint(ADR-028)。
 *
 * 纯 TypeScript —— 零 React / 零 chrome.* / 零 wxt(ADR-036)。
 */

export const FILTER_MODES = [
  'Grayscale',
  'RedGreen',
  'GreenRed',
  'BlueYellow',
] as const;

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
 * 读到未知/损坏数据时回退默认值而不抛异常(ADR-041)。
 */
export function coerceFilterMode(value: unknown): FilterMode {
  return isFilterMode(value) ? value : DEFAULT_FILTER_MODE;
}
