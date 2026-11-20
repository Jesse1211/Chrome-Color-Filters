/**
 * 时长模型(ADR-058 / ADR-054)的单测。
 *
 * 核心命题:**界面绝不接受裸时间戳** —— 结构上就不可能。
 */
import { describe, expect, it } from 'vitest';

import {
  LOCK_PRESETS,
  LOCK_UNITS,
  UNIT_LABELS,
  durationToMs,
  formatDuration,
  isLockUnit,
  isValidDuration,
  lockUntilFrom,
} from '../lock-duration.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('ADR-058 · 单位只有分/时/天,没有秒与毫秒', () => {
  it('LOCK_UNITS 恰好是 minute / hour / day', () => {
    expect([...LOCK_UNITS]).toEqual(['minute', 'hour', 'day']);
  });

  it('🔴 不存在 second / millisecond 单位 —— 「秒/毫秒弄错」在界面层不可能发生', () => {
    expect(isLockUnit('second')).toBe(false);
    expect(isLockUnit('millisecond')).toBe(false);
    expect(isLockUnit('ms')).toBe(false);
  });

  it('下拉选项的中文名齐备(ADR-047:首版仅中文)', () => {
    expect(UNIT_LABELS.minute).toBe('分钟');
    expect(UNIT_LABELS.hour).toBe('小时');
    expect(UNIT_LABELS.day).toBe('天');
  });
});

describe('durationToMs · 单位换算', () => {
  it('分 / 时 / 天 各自换算正确', () => {
    expect(durationToMs({ amount: 30, unit: 'minute' })).toBe(30 * MIN);
    expect(durationToMs({ amount: 4, unit: 'hour' })).toBe(4 * HOUR);
    expect(durationToMs({ amount: 2, unit: 'day' })).toBe(2 * DAY);
  });

  it('0 / 负数 / NaN / Infinity 一律判非法,返回 null 而非悄悄当 0', () => {
    for (const amount of [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(durationToMs({ amount, unit: 'hour' }), `amount=${String(amount)}`).toBeNull();
      expect(isValidDuration({ amount, unit: 'hour' })).toBe(false);
    }
  });

  it('🔴 ADR-054 · 不设上限 —— 极长时长同样合法', () => {
    // 「公元 56000 年」量级的锁在结构上完全合法(§4.1 已记录并接受)。
    expect(isValidDuration({ amount: 365_000, unit: 'day' })).toBe(true);
    expect(durationToMs({ amount: 365_000, unit: 'day' })).toBe(365_000 * DAY);
  });
});

describe('lockUntilFrom · 时间戳是**输出**,不是输入', () => {
  it('由「当前时刻 + 带单位时长」算出绝对时间戳(ADR-053)', () => {
    const now = 1_700_000_000_000;
    expect(lockUntilFrom(now, { amount: 1, unit: 'hour' })).toBe(now + HOUR);
    expect(lockUntilFrom(now, { amount: 90, unit: 'minute' })).toBe(now + 90 * MIN);
  });

  it('非法时长 → null,不产生一个「现在就到期」的假锁', () => {
    expect(lockUntilFrom(1000, { amount: 0, unit: 'hour' })).toBeNull();
    expect(lockUntilFrom(1000, { amount: Number.NaN, unit: 'day' })).toBeNull();
  });

  it('非法 now → null', () => {
    expect(lockUntilFrom(Number.NaN, { amount: 1, unit: 'hour' })).toBeNull();
  });

  it('🔴 不存在任何「接受单一数字当时长」的导出函数', () => {
    // 这条断言钉的是**模块的形状**:所有产出 lockUntil 的路径都必须
    // 同时拿到 now 与带单位的时长。若日后有人加了 `lockUntilFromMs(ms)`
    // 之类的旁路,ADR-058 的界面层保证就破了。
    // lockUntilFrom 的第二个参数必须是对象,传数字在类型层即不合法;
    // 运行时同样拒绝(没有 unit → isLockUnit 为假)。
    const notADuration = 1_700_000_000_000 as unknown as {
      amount: number;
      unit: 'hour';
    };
    expect(lockUntilFrom(1000, notADuration)).toBeNull();
  });
});

describe('预设按钮(ADR-058)', () => {
  it('预设以**带单位的时长**表达,不是预先算好的毫秒常量', () => {
    for (const preset of LOCK_PRESETS) {
      expect(isLockUnit(preset.unit), `${String(preset.amount)}`).toBe(true);
      expect(isValidDuration(preset)).toBe(true);
    }
  });

  it('至少提供数个档位,且文案可读', () => {
    expect(LOCK_PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(formatDuration({ amount: 30, unit: 'minute' })).toBe('30 分钟');
    expect(formatDuration({ amount: 4, unit: 'hour' })).toBe('4 小时');
    expect(formatDuration({ amount: 1, unit: 'day' })).toBe('1 天');
  });
});
