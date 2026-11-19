/**
 * 值对象门禁(ADR-002 / ADR-003 / ADR-020)。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTER_MODE,
  FILTER_MODES,
  coerceFilterMode,
  isFilterMode,
} from '../filter-mode.js';
import {
  DEFAULT_INTENSITY,
  coerceIntensity,
  intensityFraction,
  isIntensity,
} from '../intensity.js';
import { createRule, coerceRule, isFilterRule } from '../filter-rule.js';

describe('FilterMode(ADR-002)', () => {
  it('恰好四个模式,互斥单选', () => {
    expect(FILTER_MODES).toEqual([
      'Grayscale',
      'RedGreen',
      'GreenRed',
      'BlueYellow',
    ]);
    expect(new Set(FILTER_MODES).size).toBe(4);
  });

  it('不含已被 ADR-028 砍掉的 Color Tint', () => {
    expect(FILTER_MODES as readonly string[]).not.toContain('Tint');
    expect(FILTER_MODES as readonly string[]).not.toContain('ColorTint');
  });

  it('类型守卫与收敛', () => {
    expect(isFilterMode('Grayscale')).toBe(true);
    expect(isFilterMode('Sepia')).toBe(false);
    expect(coerceFilterMode('Sepia')).toBe(DEFAULT_FILTER_MODE);
    expect(coerceFilterMode('BlueYellow')).toBe('BlueYellow');
  });
});

describe('Intensity(ADR-003)', () => {
  it('合法区间为整数 0–100', () => {
    expect(isIntensity(0)).toBe(true);
    expect(isIntensity(100)).toBe(true);
    expect(isIntensity(-1)).toBe(false);
    expect(isIntensity(101)).toBe(false);
    expect(isIntensity(50.5)).toBe(false);
  });

  it('收敛:取整并夹到区间,非数字回退默认值', () => {
    expect(coerceIntensity(50.4)).toBe(50);
    expect(coerceIntensity(-20)).toBe(0);
    expect(coerceIntensity(500)).toBe(100);
    expect(coerceIntensity('x')).toBe(DEFAULT_INTENSITY);
    expect(coerceIntensity(NaN)).toBe(DEFAULT_INTENSITY);
  });

  it('归一化到 [0,1]', () => {
    expect(intensityFraction(0)).toBe(0);
    expect(intensityFraction(50)).toBe(0.5);
    expect(intensityFraction(100)).toBe(1);
  });
});

describe('FilterRule(ADR-020:新建默认 Grayscale @ 100%,输入框为空)', () => {
  it('createRule 的默认值', () => {
    const r = createRule();
    expect(r.pattern).toBe('');
    expect(r.mode).toBe('Grayscale');
    expect(r.intensity).toBe(100);
  });

  it('没有 per-rule 开关(ADR-009)', () => {
    const r = createRule('x.com');
    expect(Object.keys(r).sort()).toEqual(['intensity', 'mode', 'pattern']);
    expect('enabled' in r).toBe(false);
  });

  it('类型守卫', () => {
    expect(isFilterRule({ pattern: 'x.com', mode: 'Grayscale', intensity: 50 })).toBe(true);
    expect(isFilterRule({ pattern: '', mode: 'Grayscale', intensity: 50 })).toBe(false);
    expect(isFilterRule(null)).toBe(false);
  });

  it('coerceRule:pattern 非法则整条丢弃', () => {
    expect(coerceRule({ pattern: '(a|b)', mode: 'Grayscale', intensity: 1 })).toBeNull();
    expect(coerceRule({ pattern: 'x.com' })).toEqual({
      pattern: 'x.com',
      mode: 'Grayscale',
      intensity: 100,
    });
  });
});
