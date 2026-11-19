/**
 * `FilterRule` —— 聚合内实体(§1)。
 *
 * 身份 = 它在 `rules` 中的位置 + `pattern`。
 * **没有 per-rule 开关**(ADR-009)—— 不要就删除,`已删除` 是终态。
 *
 * 纯 TypeScript —— 零 React / 零 chrome.* / 零 wxt(ADR-036)。
 */

import {
  type FilterMode,
  DEFAULT_FILTER_MODE,
  coerceFilterMode,
} from './filter-mode.js';
import {
  type Intensity,
  DEFAULT_INTENSITY,
  coerceIntensity,
} from './intensity.js';
import { type GlobPattern, isGlobPattern } from './glob.js';

export interface FilterRule {
  readonly pattern: GlobPattern;
  readonly mode: FilterMode;
  readonly intensity: Intensity;
}

/** ADR-020:新建规则默认 Grayscale @ 100%,输入框为空。 */
export function createRule(
  pattern: GlobPattern = '',
  mode: FilterMode = DEFAULT_FILTER_MODE,
  intensity: Intensity = DEFAULT_INTENSITY,
): FilterRule {
  return { pattern, mode, intensity };
}

export function isFilterRule(value: unknown): value is FilterRule {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    isGlobPattern(r.pattern) &&
    coerceFilterMode(r.mode) === r.mode &&
    coerceIntensity(r.intensity) === r.intensity
  );
}

/**
 * 把任意输入收敛为合法 FilterRule;pattern 不合法则返回 null(该条丢弃)。
 * 读到未知/损坏/缺字段数据时回退而不抛异常(ADR-041)。
 */
export function coerceRule(value: unknown): FilterRule | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  if (!isGlobPattern(r.pattern)) return null;
  return {
    pattern: r.pattern,
    mode: coerceFilterMode(r.mode),
    intensity: coerceIntensity(r.intensity),
  };
}
