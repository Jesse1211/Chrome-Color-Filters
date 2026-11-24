/**
 * 倒计时的时钟 —— **全 popup 唯一的自更新 UI**(§6 T6c)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **`setInterval` 的生命周期是本文件存在的全部理由。**
 *
 * §6 T6c gate:
 * > 组件卸载时清除 `setInterval`(**断言无泄漏**)
 *
 * popup 里别处没有任何定时器。把它收在一个 hook 里,是为了让
 * 「装了一个 interval」与「拆了那个 interval」这两件事出现在**同一个**
 * `useEffect` 的返回值里,而不是散落在组件各处 —— 后者正是泄漏的来源。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 不自减(gate 明文)
 *
 * 本 hook **只产出「现在几点」**,不产出「还剩多少」。
 * 剩余时长由 `remainingMs(lockUntil, now)` 在每次渲染时**重新**算 ——
 * 于是丢帧、后台节流、popup 重开都不会累积漂移(见 `lock-format.ts` 文件头)。
 *
 * ## 时钟(ADR-071)
 *
 * 对外给出的就是注入时钟 `clock()` 的原始时刻 —— 与仓储层的锁定判定同口径
 * (两边口径不一致会出现「UI 说还锁着、写入却已放行」的裂缝)。
 * 原 `effectiveNow` 单调下界已随 ADR-071 废止:系统时钟由用户自行负责。
 */

import { useEffect, useRef, useState } from 'react';

/** 倒计时刷新间隔 —— §5.4 要求**每秒**刷新。 */
export const LOCK_TICK_MS = 1000;

export interface UseLockClockOptions {
  /**
   * 是否需要走时。`false` 时**不安装任何定时器** ——
   * 未锁定的 popup 不该为了一个不显示的倒计时每秒唤醒一次。
   */
  readonly active: boolean;
  /** 可注入时钟,默认 `Date.now`。测试据此控制时间,不依赖真实挂钟。 */
  readonly clock?: () => number;
  /** 可注入的定时器,默认 `setInterval` / `clearInterval`。 */
  readonly setIntervalFn?: (fn: () => void, ms: number) => unknown;
  readonly clearIntervalFn?: (handle: unknown) => void;
}

/**
 * @returns 当前时刻(注入时钟的原始值,ADR-071),`active` 时每秒推进一次。
 */
export function useLockClock({
  active,
  clock,
  setIntervalFn,
  clearIntervalFn,
}: UseLockClockOptions): number {
  /**
   * 注入项存 ref,**不作为 effect 的依赖**。
   *
   * 与 `usePopupSettings` 里 `tabStatePort` 的处理同理:调用方最自然的写法是
   * 在 JSX 里内联传 `clock={() => Date.now()}`,那样每次 render 都是新引用。
   * 若它出现在依赖数组里,effect 会「拆定时器 → 装定时器」无限循环,
   * 每帧都重置相位,倒计时反而永远走不动。
   */
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const setIntervalRef = useRef(setIntervalFn);
  setIntervalRef.current = setIntervalFn;
  const clearIntervalRef = useRef(clearIntervalFn);
  clearIntervalRef.current = clearIntervalFn;

  const readClock = useRef(() => {
    const fn = clockRef.current;
    return fn ? fn() : Date.now();
  }).current;

  const [tick, setTick] = useState<number>(() => readClock());

  useEffect(() => {
    // 未锁定 → 不装定时器(见 `active` 的文档)。
    if (!active) return;

    // 装表的同一帧先读一次:`active` 从 false 翻到 true 时(比如刚启动锁定),
    // 用户不该盯着一个陈旧的时刻等满一秒才看到正确的倒计时。
    setTick(readClock());

    const install = setIntervalRef.current;
    const handle = install
      ? install(() => {
          setTick(readClock());
        }, LOCK_TICK_MS)
      : setInterval(() => {
          setTick(readClock());
        }, LOCK_TICK_MS);

    // 🔴 清理函数 —— gate 要求「组件卸载时清除 setInterval(断言无泄漏)」。
    // 它与上面的安装在同一个 effect 里,结构上不可能漏掉其一。
    // `active` 变 false 时同样会跑到这里(依赖项变化先清理再重跑)。
    return () => {
      const dispose = clearIntervalRef.current;
      if (dispose) {
        dispose(handle);
      } else {
        clearInterval(handle as ReturnType<typeof setInterval>);
      }
    };
  }, [active, readClock]);

  // ADR-071:直接给注入时钟的时刻 —— 与仓储层 `#readContext()` 逐字一致。
  return tick;
}
