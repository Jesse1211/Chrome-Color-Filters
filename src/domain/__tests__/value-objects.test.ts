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

describe('FilterMode(ADR-002 / 🔴 ADR-075)', () => {
  it('🔴 ADR-075:恰好一个模式 Grayscale', () => {
    expect(FILTER_MODES).toEqual(['Grayscale']);
    expect(new Set(FILTER_MODES).size).toBe(1);
  });

  it('🔴 ADR-075:三个 CVD 模式已删除,不得悄悄回来', () => {
    // 这是一条**负向**断言:加回这三个模式不是改一行枚举的事 ——
    // 必须同时重建 SVG 滤镜机制、恢复 ADR-030 的「色块必带文字名称」
    // 硬性约束,并重新核验 ADR-069/072/073/074 的全部实测结论。
    // 若有人只改了 FILTER_MODES 就以为完事,本断言会先失败。
    for (const gone of ['RedGreen', 'GreenRed', 'BlueYellow']) {
      expect(FILTER_MODES as readonly string[]).not.toContain(gone);
      expect(isFilterMode(gone)).toBe(false);
    }
  });

  it('不含已被 ADR-028 砍掉的 Color Tint', () => {
    expect(FILTER_MODES as readonly string[]).not.toContain('Tint');
    expect(FILTER_MODES as readonly string[]).not.toContain('ColorTint');
  });

  it('类型守卫与收敛', () => {
    expect(isFilterMode('Grayscale')).toBe(true);
    expect(isFilterMode('Sepia')).toBe(false);
    expect(coerceFilterMode('Sepia')).toBe(DEFAULT_FILTER_MODE);
    expect(coerceFilterMode('Grayscale')).toBe('Grayscale');
  });

  /*
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 🔴 ADR-075 的存储迁移 —— 磁盘上**已经**存在带旧模式的规则。
   *
   * 迁移策略:**读时收敛,不写回**。`coerceFilterMode` 对任何不在
   * `FILTER_MODES` 中的输入一律回退 `Grayscale`,与它原本处理垃圾数据
   * 的语义完全相同。于是:
   *   - 不需要 schema 版本号跃迁(`version` 保持 1);
   *   - 不需要一次性迁移脚本(没有「迁移没跑过」的中间态);
   *   - 读路径**不写盘**(ADR-071 刚因为这个原因废止了 `maxSeenTime`,
   *     也让锁定期间回到「一切不可变更」的单一语义 —— 一个会在读时
   *     写回的迁移恰好会把那个坑重新挖开)。
   * 旧值在用户下一次保存该规则时自然被覆盖。
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  it('🔴 ADR-075 迁移:磁盘上遗留的三个旧模式一律读成 Grayscale', () => {
    expect(coerceFilterMode('RedGreen')).toBe('Grayscale');
    expect(coerceFilterMode('GreenRed')).toBe('Grayscale');
    expect(coerceFilterMode('BlueYellow')).toBe('Grayscale');
  });

  it('🔴 ADR-075 迁移:整条旧规则经 coerceRule 后 mode 变 Grayscale,其余字段原样保留', () => {
    // pattern 与 intensity **不得**被迁移顺手改掉 —— 用户配的强度是他的设置。
    const migrated = coerceRule({
      pattern: '*.weibo.*',
      mode: 'BlueYellow',
      intensity: 37,
    });
    expect(migrated).toEqual({
      pattern: '*.weibo.*',
      mode: 'Grayscale',
      intensity: 37,
    });
  });

  it('🔴 ADR-075 迁移:旧模式的规则不会被当成损坏数据丢弃', () => {
    // 若迁移写成「mode 非法就丢掉整条」,用户配过的规则会静默消失 ——
    // ADR-012 明确「配过的规则莫名失效会严重损害辅助工具的信任」。
    expect(coerceRule({ pattern: 'x.com', mode: 'RedGreen', intensity: 60 }))
      .not.toBeNull();
  });

  it('🔴 ADR-075 迁移:带旧模式的规则不再满足 isFilterRule(必须经收敛)', () => {
    // isFilterRule 是「已经规范化」的判据,不是「可被接受」的判据。
    // 旧模式值在这里为 false 正是让读路径**必须**走 coerceRule 的那道门。
    expect(
      isFilterRule({ pattern: 'x.com', mode: 'RedGreen', intensity: 60 }),
    ).toBe(false);
    expect(
      isFilterRule({ pattern: 'x.com', mode: 'Grayscale', intensity: 60 }),
    ).toBe(true);
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
