/**
 * `Intensity` 值对象(ADR-003)。
 *
 * 整数 0–100。色觉辅助场景下强度可调是刚需。
 *
 * 纯 TypeScript —— 零 React / 零 chrome.* / 零 wxt(ADR-036)。
 */

export type Intensity = number;

export const INTENSITY_MIN = 0;
export const INTENSITY_MAX = 100;

/** 新建规则默认满强度(ADR-020:Grayscale @ 100%)。 */
export const DEFAULT_INTENSITY: Intensity = 100;

export function isIntensity(value: unknown): value is Intensity {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= INTENSITY_MIN &&
    value <= INTENSITY_MAX
  );
}

/**
 * 把任意输入收敛为合法 Intensity:非数字 → 默认值;数字 → 取整并夹到 [0,100]。
 * 读到未知/损坏数据时回退默认值而不抛异常(ADR-041)。
 */
export function coerceIntensity(value: unknown): Intensity {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_INTENSITY;
  }
  const rounded = Math.round(value);
  if (rounded < INTENSITY_MIN) return INTENSITY_MIN;
  if (rounded > INTENSITY_MAX) return INTENSITY_MAX;
  return rounded;
}

/** Intensity 归一化到 [0,1],供矩阵插值使用。 */
export function intensityFraction(intensity: Intensity): number {
  return coerceIntensity(intensity) / INTENSITY_MAX;
}
