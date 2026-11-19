/**
 * 聚合与锁定门禁(ADR-011/012/041/051/052/053/059,INV-7/11/12/15)。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createRule } from '../filter-rule.js';
import {
  MAX_RULES,
  addRule,
  canSetLockUntil,
  coerceSettings,
  defaultSettings,
  effectiveNow,
  isAtRuleCapacity,
  isLocked,
  type FilterSettings,
} from '../filter-settings.js';

const DOMAIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 读取领域源码并**剥去注释** —— 断言的是「可执行代码里不调用 Date.now」,
 * 文档注释中说明「绝不调用 Date.now()」反而是应当保留的。
 */
function executableSourceOf(file: string): string {
  return readFileSync(resolve(DOMAIN_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function withLock(lockUntil: number | null): FilterSettings {
  return { ...defaultSettings(), lockUntil };
}

describe('INV-7 · 容量硬上限 20 条(ADR-011 / ADR-012)', () => {
  it('第 21 条规则被拒绝,且绝不静默淘汰已有规则', () => {
    let settings = defaultSettings();
    for (let i = 0; i < MAX_RULES; i++) {
      const result = addRule(settings, createRule(`site${i}.com`));
      expect(result.ok).toBe(true);
      if (result.ok) settings = result.settings;
    }
    expect(settings.rules).toHaveLength(MAX_RULES);
    expect(isAtRuleCapacity(settings)).toBe(true);

    const overflow = addRule(settings, createRule('site20.com'));
    expect(overflow).toEqual({ ok: false, error: 'capacity-exceeded' });
    // 原对象未被改动,已有 20 条一条不少(ADR-012)。
    expect(settings.rules).toHaveLength(MAX_RULES);
    expect(settings.rules[0]?.pattern).toBe('site0.com');
  });

  it('addRule 是纯函数,不改原对象', () => {
    const before = defaultSettings();
    const result = addRule(before, createRule('x.com'));
    expect(before.rules).toHaveLength(0);
    if (result.ok) expect(result.settings.rules).toHaveLength(1);
  });

  it('coerceSettings 截断超量规则,使 INV-7 恒成立', () => {
    const raw = {
      rules: Array.from({ length: 50 }, (_, i) => ({
        pattern: `s${i}.com`,
        mode: 'Grayscale',
        intensity: 100,
      })),
    };
    expect(coerceSettings(raw).rules).toHaveLength(MAX_RULES);
  });
});

describe('ADR-041 · 损坏数据回退默认值且不抛异常', () => {
  it.each([
    [undefined],
    [null],
    ['garbage'],
    [42],
    [{}],
    [{ rules: 'not an array' }],
    [{ masterEnabled: 'yes', lockUntil: 'soon', maxSeenTime: {} }],
  ])('coerceSettings(%s) 返回合法 settings', (raw) => {
    expect(() => coerceSettings(raw)).not.toThrow();
    const s = coerceSettings(raw);
    expect(Array.isArray(s.rules)).toBe(true);
    expect(typeof s.masterEnabled).toBe('boolean');
    expect(s.lockUntil === null || typeof s.lockUntil === 'number').toBe(true);
    expect(Number.isFinite(s.maxSeenTime)).toBe(true);
  });

  it('丢弃 pattern 非法的规则,保留合法的', () => {
    const s = coerceSettings({
      rules: [
        { pattern: 'ok.com', mode: 'RedGreen', intensity: 50 },
        { pattern: '(bad|regex).com', mode: 'Grayscale', intensity: 100 },
        { pattern: 'also-ok.com', mode: 'nonsense', intensity: 999 },
      ],
    });
    expect(s.rules.map((r) => r.pattern)).toEqual(['ok.com', 'also-ok.com']);
    // 未知 mode 回退默认、越界 intensity 被夹住。
    expect(s.rules[1]?.mode).toBe('Grayscale');
    expect(s.rules[1]?.intensity).toBe(100);
  });
});

describe('isLocked · 时间边界(ADR-051 / ADR-053)', () => {
  it('lockUntil = null → 未锁定', () => {
    expect(isLocked(withLock(null), 1_000)).toBe(false);
  });

  it('now < lockUntil → 锁定', () => {
    expect(isLocked(withLock(1_000), 999)).toBe(true);
  });

  it('now === lockUntil → **未锁定**(到期即解锁,边界取开区间)', () => {
    expect(isLocked(withLock(1_000), 1_000)).toBe(false);
  });

  it('now > lockUntil → 未锁定', () => {
    expect(isLocked(withLock(1_000), 1_001)).toBe(false);
  });

  it('🔴 `now` 为注入参数 —— 函数内不得调用 Date.now()', () => {
    // 行为证据:伪造一个永远比 lockUntil 大的 now,结果必须是未锁定,
    // 与真实墙钟无关。若实现内部偷用 Date.now(),该断言会红。
    const farFuture = Number.MAX_SAFE_INTEGER;
    expect(isLocked(withLock(Date.now() + 86_400_000), farFuture)).toBe(false);
    expect(isLocked(withLock(Date.now() + 86_400_000), 0)).toBe(true);

    // 静态证据:可执行代码里根本不出现 Date.now(注释中的说明不算)。
    expect(executableSourceOf('filter-settings.ts')).not.toContain('Date.now');
  });
});

describe('effectiveNow · 单调性(ADR-059 / INV-15)', () => {
  it('rawNow > maxSeenTime → 返回 rawNow(正常前进)', () => {
    expect(effectiveNow(2_000, 1_000)).toBe(2_000);
  });

  it('rawNow < maxSeenTime → 返回 maxSeenTime(时钟倒退,不缩短锁定)', () => {
    expect(effectiveNow(500, 1_000)).toBe(1_000);
  });

  it('rawNow === maxSeenTime → 返回该值', () => {
    expect(effectiveNow(1_000, 1_000)).toBe(1_000);
  });

  it('时钟倒退不会把锁定误判为已解除(INV-15)', () => {
    const settings: FilterSettings = {
      ...defaultSettings(),
      lockUntil: 10_000,
      maxSeenTime: 9_000,
    };
    // 时钟被调回 1970:裸 rawNow 仍是锁定,这里确认单调下界也锁定。
    expect(isLocked(settings, effectiveNow(0, settings.maxSeenTime))).toBe(true);
    // 倒退后「剩余时长」不得增加:下界 9000 → 剩 1000,而非 10000。
    expect(10_000 - effectiveNow(0, settings.maxSeenTime)).toBe(1_000);
  });

  it('非有限输入被安全处理', () => {
    expect(effectiveNow(NaN, 1_000)).toBe(1_000);
    expect(effectiveNow(1_000, NaN)).toBe(1_000);
  });
});

describe('canSetLockUntil · 单向性(ADR-052 / INV-12)', () => {
  const NOW = 1_000;

  it('未锁定 → 任意未来时间戳:允许', () => {
    expect(canSetLockUntil(null, NOW + 1, NOW).ok).toBe(true);
    expect(canSetLockUntil(null, NOW + 86_400_000, NOW).ok).toBe(true);
    // 已过期的旧锁同样视为未锁定。
    expect(canSetLockUntil(NOW - 500, NOW + 5_000, NOW).ok).toBe(true);
  });

  it('锁定中 → next > current(延长):允许', () => {
    expect(canSetLockUntil(NOW + 5_000, NOW + 9_000, NOW).ok).toBe(true);
  });

  it('锁定中 → next < current(缩短):拒绝', () => {
    expect(canSetLockUntil(NOW + 5_000, NOW + 2_000, NOW)).toEqual({
      ok: false,
      reason: 'cannot-shorten',
    });
  });

  it('锁定中 → next === current:拒绝(无意义写入)', () => {
    expect(canSetLockUntil(NOW + 5_000, NOW + 5_000, NOW)).toEqual({
      ok: false,
      reason: 'no-op',
    });
  });

  it('锁定中 → null(清除):拒绝', () => {
    expect(canSetLockUntil(NOW + 5_000, null, NOW)).toEqual({
      ok: false,
      reason: 'cannot-clear-while-locked',
    });
  });

  it('任何情况 → 过去的时间戳:拒绝', () => {
    expect(canSetLockUntil(null, NOW - 1, NOW).ok).toBe(false);
    expect(canSetLockUntil(null, NOW, NOW)).toEqual({
      ok: false,
      reason: 'in-the-past',
    });
    expect(canSetLockUntil(NOW + 5_000, NOW - 1, NOW)).toEqual({
      ok: false,
      reason: 'in-the-past',
    });
  });

  it('非数字 next 被拒绝,不抛异常', () => {
    expect(
      canSetLockUntil(null, 'tomorrow' as unknown as number, NOW).ok,
    ).toBe(false);
    expect(canSetLockUntil(null, NaN, NOW).ok).toBe(false);
  });

  it('🔴 没有任何输入能缩短一个生效中的锁(INV-12 穷举)', () => {
    const current = NOW + 10_000;
    const attempts = [
      null,
      0,
      -1,
      NOW,
      NOW - 1,
      NOW + 1,
      current - 1,
      current,
      NaN,
      Infinity,
      -Infinity,
    ];
    for (const next of attempts) {
      const result = canSetLockUntil(current, next as number | null, NOW);
      if (result.ok) {
        // 唯一允许通过的只能是严格延长。
        expect(next as number).toBeGreaterThan(current);
      }
    }
    // 上面没有一个比 current 大,故应全部被拒。
    for (const next of attempts) {
      expect(canSetLockUntil(current, next as number | null, NOW).ok).toBe(false);
    }
  });

  it('`now` 为注入参数 —— canSetLockUntil 同样不读墙钟', () => {
    expect(executableSourceOf('filter-settings.ts')).not.toContain('Date.now');
  });
});

describe('INV-11 例外 b · maxSeenTime 不是用户设置', () => {
  it('锁定期间 maxSeenTime 仍可推进(ADR-059)', () => {
    // 领域层只负责提供单调推进的语义;仓储层(T3)据此在锁定期间
    // 继续更新该字段。此处断言领域函数不会因「锁定中」而拒绝推进。
    const locked: FilterSettings = {
      ...defaultSettings(),
      lockUntil: 10_000,
      maxSeenTime: 5_000,
    };
    expect(isLocked(locked, effectiveNow(6_000, locked.maxSeenTime))).toBe(true);
    expect(effectiveNow(6_000, locked.maxSeenTime)).toBe(6_000);
  });
});
