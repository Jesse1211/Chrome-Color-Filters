/**
 * 倒计时格式化(§5.4 / ADR-051)的单测。
 *
 * 核心命题:**按 `lockUntil - now` 计算,不是自减计数器**。
 */
import { describe, expect, it } from 'vitest';

import {
  LOCK_COUNTDOWN_PREFIX,
  formatCountdown,
  formatRemaining,
  remainingMs,
} from '../lock-format.js';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

describe('§5.4 · 格式为 🔒 锁定中 HH:MM:SS', () => {
  it('逐字匹配 §5.4 的示例形状「🔒 锁定中 02:14:07」', () => {
    const now = 1_700_000_000_000;
    const lockUntil = now + 2 * HOUR + 14 * MIN + 7 * SEC;
    expect(formatCountdown(lockUntil, now)).toBe('🔒 锁定中 02:14:07');
  });

  it('前缀常量就是「🔒 锁定中」', () => {
    expect(LOCK_COUNTDOWN_PREFIX).toBe('🔒 锁定中');
  });

  it('各位补零', () => {
    expect(formatRemaining(SEC)).toBe('00:00:01');
    expect(formatRemaining(MIN + SEC)).toBe('00:01:01');
    expect(formatRemaining(9 * HOUR + 5 * MIN + 3 * SEC)).toBe('09:05:03');
  });
});

describe('🔴 按差值计算 —— 不自减、无状态', () => {
  it('同一对 (lockUntil, now) 永远给出同一结果,不依赖调用次数', () => {
    const lockUntil = 10 * HOUR;
    const first = formatCountdown(lockUntil, 3 * HOUR);
    for (let i = 0; i < 50; i += 1) formatCountdown(lockUntil, 3 * HOUR);
    expect(formatCountdown(lockUntil, 3 * HOUR)).toBe(first);
  });

  it('🔴 丢帧不漂移 —— 跳过 1000 秒后结果仍是精确差值', () => {
    const lockUntil = 5 * HOUR;
    // 自减计数器在这里会少减 1000 次 → 显示比真实剩余多出 1000 秒。
    const afterGap = formatCountdown(lockUntil, 1000 * SEC);
    expect(afterGap).toBe(`${LOCK_COUNTDOWN_PREFIX} ${formatRemaining(5 * HOUR - 1000 * SEC)}`);
    expect(afterGap).toBe('🔒 锁定中 04:43:20');
  });

  it('🔴 popup 重开(now 从别处来)照样正确 —— 没有需要恢复的内部计数', () => {
    const lockUntil = 1_700_003_600_000;
    expect(formatCountdown(lockUntil, 1_700_000_000_000)).toBe('🔒 锁定中 01:00:00');
    // 模拟「关掉 popup,半小时后重开」—— 直接传新的 now 即可。
    expect(formatCountdown(lockUntil, 1_700_001_800_000)).toBe('🔒 锁定中 00:30:00');
  });
});

describe('边界', () => {
  it('到期与过期一律 00:00:00,不出现负号', () => {
    expect(formatRemaining(0)).toBe('00:00:00');
    expect(formatRemaining(-1)).toBe('00:00:00');
    expect(formatRemaining(-99 * HOUR)).toBe('00:00:00');
    expect(formatCountdown(100, 500)).toBe('🔒 锁定中 00:00:00');
  });

  it('lockUntil 为 null 时剩余为 0', () => {
    expect(remainingMs(null, 123)).toBe(0);
  });

  it('🔴 小时位不对 24 取模 —— ADR-054 不设上限,3 天的锁显示 72:00:00', () => {
    expect(formatRemaining(72 * HOUR)).toBe('72:00:00');
    // 若取模,这里会变成 00:00:00 —— 恰好是「已解锁」的样子,是致命误读。
    expect(formatRemaining(72 * HOUR)).not.toBe('00:00:00');
  });

  it('🔴 向上取整到秒 —— 还剩 0.4 秒时不得显示 00:00:00', () => {
    // 00:00:00 必须恰好意味着「锁已解除」。
    expect(formatRemaining(400)).toBe('00:00:01');
    expect(formatRemaining(1)).toBe('00:00:01');
  });

  it('remainingMs 下限夹到 0', () => {
    expect(remainingMs(100, 500)).toBe(0);
    expect(remainingMs(500, 100)).toBe(400);
  });
});
