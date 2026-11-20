/**
 * 🔴 ADR-052 / INV-12 的**加码专用**回归测试:
 * 「延长」在任何输入下都不可能让 `lockUntil` 变小。
 *
 * ADR-052 原文:
 * > `lockUntil` 仅接受**严格大于当前值**的新值 —— 若允许任意写入,
 * > 「延长」就成了缩短的后门。
 *
 * 本文件对**仓储层 + UI 换算**的组合做穷举式探测,找「缩短的后门」。
 * 仓储层自己的单测已覆盖 `canSetLockUntil`;这里补的是 UI 侧
 * 「以哪个时刻为基准」这一步 —— 那是 T6c 新引入的、唯一能制造后门的地方。
 */
import { describe, expect, it } from 'vitest';

import { canSetLockUntil, effectiveNow } from '../../domain/filter-settings.js';
import { type LockDuration, durationToMs } from '../lock-duration.js';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const T0 = 1_700_000_000_000;

/**
 * 与 `useLockState.extendLock` **逐字同构**的基准选择逻辑。
 *
 * ⚠️ 这是一份刻意的复制。被测的是「这个算法对不对」,
 * 而算法本身只有三行 —— 在这里重述它,能让反例直接指出是哪一行错了。
 * 行为层面的等价另有 `lock-ui.test.tsx` 的 DOM 级断言钉住。
 */
function extendTarget(
  current: number | null,
  now: number,
  duration: LockDuration,
): number | null {
  const ms = durationToMs(duration);
  if (ms === null) return null;
  const base =
    current !== null && Number.isFinite(current) && current > now ? current : now;
  return base + ms;
}

describe('🔴 延长永远只增不减 —— 穷举找后门', () => {
  const durations: LockDuration[] = [
    { amount: 1, unit: 'minute' },
    { amount: 30, unit: 'minute' },
    { amount: 1, unit: 'hour' },
    { amount: 8, unit: 'hour' },
    { amount: 1, unit: 'day' },
    { amount: 365, unit: 'day' },
  ];

  /** 各种「现有锁」的处境:刚开始 / 过半 / 快到期 / 恰好到期 / 已过期。 */
  const scenarios: { name: string; lockUntil: number; now: number }[] = [
    { name: '刚锁上', lockUntil: T0 + 8 * HOUR, now: T0 },
    { name: '过半', lockUntil: T0 + 8 * HOUR, now: T0 + 4 * HOUR },
    { name: '只剩 1 秒', lockUntil: T0 + 8 * HOUR, now: T0 + 8 * HOUR - SEC },
    { name: '恰好到期', lockUntil: T0 + 8 * HOUR, now: T0 + 8 * HOUR },
    { name: '已过期', lockUntil: T0 + HOUR, now: T0 + 5 * HOUR },
    { name: '极长的锁', lockUntil: T0 + 365 * 24 * HOUR, now: T0 },
  ];

  for (const s of scenarios) {
    for (const d of durations) {
      it(`${s.name} · 延长 ${String(d.amount)}${d.unit} 不缩短`, () => {
        const target = extendTarget(s.lockUntil, s.now, d);
        expect(target).not.toBeNull();
        const next = target as number;

        // 1. 仍在锁定中时:新值必须**严格大于**旧值(ADR-052 的字面要求)。
        if (s.now < s.lockUntil) {
          expect(
            next,
            `出现了缩短的后门:${String(s.lockUntil)} → ${String(next)}`,
          ).toBeGreaterThan(s.lockUntil);
        }

        // 2. 任何情况下新值都在未来 —— 否则是一个「写入即失效」的假锁。
        expect(next).toBeGreaterThan(s.now);

        // 3. 🔴 仓储层的守卫必须放行 —— UI 与数据层同口径,
        //    不会出现「UI 以为延长了、写入却被拒」的裂缝。
        const verdict = canSetLockUntil(s.lockUntil, next, s.now);
        expect(verdict.ok, `仓储层拒绝了一次合法的延长: ${JSON.stringify(verdict)}`).toBe(
          true,
        );
      });
    }
  }

  it('🔴 时钟倒退时延长同样不缩短(ADR-059 / INV-15)', () => {
    const lockUntil = T0 + 8 * HOUR;
    const maxSeenTime = T0 + 4 * HOUR;
    // 用户把系统时钟往回拨了 3 小时。
    const rawNow = T0 + HOUR;
    const now = effectiveNow(rawNow, maxSeenTime);
    // 单调下界把它夹回 T0+4h。
    expect(now).toBe(maxSeenTime);

    const next = extendTarget(lockUntil, now, { amount: 1, unit: 'hour' });
    // 基准仍是现有到期时间,不是被拨回的那个时刻。
    expect(next).toBe(lockUntil + HOUR);
    expect(canSetLockUntil(lockUntil, next, now).ok).toBe(true);
  });

  it('非法时长不产生任何目标值(不会退化成「锁到现在」)', () => {
    for (const amount of [0, -1, Number.NaN]) {
      expect(extendTarget(T0 + HOUR, T0, { amount, unit: 'hour' })).toBeNull();
    }
  });
});
