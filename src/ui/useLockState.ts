/**
 * 锁定态的接线 —— 把时钟、锁定判定与**唯一**的写入路径收在一处(T6c)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **ADR-057:启动锁定时原子开启主开关 —— 一次写入,无中间态。**
 *
 * 本 hook 启动锁定时**只调用一次** `repository.setLockUntil(ts)`。
 * 仓储层在同一次 `storage.set` 里一并把 `masterEnabled` 置为 `true`
 * (见 `settings-repository.ts` 的 `setLockUntil`)。
 *
 * ⚠️ **绝不**写成「先 `setMasterEnabled(true)` 再 `setLockUntil(ts)`」——
 * 那是两次写入、两次落盘,中间存在一个「主开关已开但还没锁」的可观测窗口;
 * 且第二次失败时会留下一个用户没要求过的状态。ADR-057 要的就是消灭这个窗口。
 *
 * ⚠️ 同样**绝不**在 `masterEnabled === false` 时拒绝启动锁定 ——
 * ADR-057 的全部意义就是让这种情况**也能**启动,并把主开关带开。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## ADR-061:立即落盘,不做防抖
 *
 * 锁定相关的写入**全部直接调仓储层的写入方法**,不经任何防抖队列。
 * 启动/延长锁定都是一次性动作,防抖对它们只有风险没有收益 ——
 * popup 一失焦即销毁,排在队列里的锁定写入会静默丢失。
 *
 * 🔴 **且「立即」必须立即到连一次 `storage.get` 往返都不等。**
 * 走 `repository.setLockUntilImmediate`,它在**点击那一轮**就发出
 * `storage.set`;`setLockUntil` 则会先 `await` 一次跨进程读,
 * 那次 await 正是 popup 被拆时的丢写窗口(与 ADR-061 同一类缺陷,
 * 回归测试见 `__tests__/lock-teardown.test.tsx`)。
 *
 * ## INV-14 / ADR-055:写入一律经仓储层
 *
 * 锁定强制点在仓储层。UI 的置灰只是第二道防线,
 * 这里绝不直接碰 `chrome.storage.*`。
 */

import { useCallback, useMemo } from 'react';

import {
  type FilterSettings,
  effectiveNow,
  isLocked,
} from '../domain/filter-settings.js';
import { type SettingsRepository } from '../storage/settings-repository.js';
import { type ActionResult } from './RuleListView.js';
import { type LockDuration, durationToMs, lockUntilFrom } from './lock-duration.js';
import { useLockClock } from './useLockClock.js';

export interface UseLockStateOptions {
  readonly repository: SettingsRepository;
  readonly settings: FilterSettings;
  /** 可注入时钟/定时器,供测试控制时间(默认真实 `Date.now` / `setInterval`)。 */
  readonly clock?: () => number;
  readonly setIntervalFn?: (fn: () => void, ms: number) => unknown;
  readonly clearIntervalFn?: (handle: unknown) => void;
  /**
   * 写入成功后把新设置回灌给调用方。
   *
   * 仓储层的 `subscribe` 只在**别处**改动时触发(`storage.onChanged`),
   * 本窗口自己的写入要靠这个回调同步到 React 状态 —— 与
   * `usePopupSettings` 的 `apply` 同一套路。
   */
  readonly onSettings?: (next: FilterSettings) => void;
}

export interface LockState {
  /** 当前是否锁定(ADR-051)。按**夹过单调下界**的时刻判定。 */
  readonly locked: boolean;
  /** 当前时刻,锁定中每秒推进一次。 */
  readonly now: number;
  /** 绝对到期时间戳;未锁定为 `null`。 */
  readonly lockUntil: number | null;
  /** 启动锁定 —— 一次写入,原子开启主开关(ADR-057)。 */
  readonly startLock: (duration: LockDuration) => Promise<ActionResult>;
  /** 延长锁定 —— 在**现有到期时间**之上追加(ADR-052:只增不减)。 */
  readonly extendLock: (duration: LockDuration) => Promise<ActionResult>;
}

export function useLockState({
  repository,
  settings,
  clock,
  setIntervalFn,
  clearIntervalFn,
  onSettings,
}: UseLockStateOptions): LockState {
  /**
   * 判定「要不要走时」用的是**不走时的**那个时刻 —— 否则就循环了。
   *
   * 这里用 `settings.maxSeenTime` 之外再读一次时钟会引入不可测的副作用,
   * 故改为:只要存在一个**未来的** `lockUntil` 就让时钟跑起来。
   * 时钟跑起来之后,真正的 `locked` 由下面按 `now` 判定 ——
   * 到期的那一秒 `locked` 自然翻 false(gate:到期自动恢复,无需刷新 popup)。
   *
   * 多跑的那部分极其有限:`lockUntil` 已过期时,首帧 `now` 立刻 >= 它,
   * 组件不渲染倒计时;定时器最多空转到 popup 关闭,且只在
   * 「存在一个已过期的 lockUntil」这一种情况下发生。
   */
  const hasLockUntil =
    settings.lockUntil !== null && Number.isFinite(settings.lockUntil);

  const now = useLockClock({
    active: hasLockUntil,
    maxSeenTime: settings.maxSeenTime,
    clock,
    setIntervalFn,
    clearIntervalFn,
  });

  /**
   * 🔴 与仓储层**同口径**的锁定判定(`isLocked` + `effectiveNow`)。
   *
   * 两边口径不一致会出现「UI 说已解锁、写入仍被拒」或反过来的裂缝 ——
   * 所以这里刻意复用领域层的同一个纯函数,而不是自己写 `now < lockUntil`。
   */
  const locked = useMemo(() => isLocked(settings, now), [settings, now]);

  /**
   * 写入的统一出口。
   *
   * ⚠️ 读「当前时刻」时再夹一次 `effectiveNow(clock(), maxSeenTime)` ——
   * 不用渲染时的 `now`:那个值最多可能是一秒前的,
   * 而「从现在起锁 N 分钟」应当以**按下按钮的那一刻**为起点。
   */
  const readNow = useCallback(() => {
    const raw = clock ? clock() : Date.now();
    return effectiveNow(raw, settings.maxSeenTime);
  }, [clock, settings.maxSeenTime]);

  const apply = useCallback(
    async (target: number | null): Promise<ActionResult> => {
      if (target === null) {
        // 非法时长(0 / 负数 / NaN)—— UI 已禁用按钮,这里是兜底。
        // **不发起写入**:一次注定被拒的写没有意义。
        return {
          ok: false,
          error: {
            kind: 'other',
            reason: 'invalid-input',
            message: '锁定时长无效。',
          },
        };
      }
      // 🔴 一次写入(ADR-057 的原子性由仓储层保证);不防抖(ADR-061)。
      //
      // 用 `setLockUntilImmediate` 而非 `setLockUntil`:后者第一行是
      // `await #readContext()`(一次跨进程 storage.get 往返),而 popup
      // **一失焦即销毁** —— 那次 await 就是一个丢写窗口,写请求根本发不出去,
      // 用户以为锁上了、其实没有。前者在**点击这一轮**就发出 storage.set。
      // 判定仍在仓储层做(ADR-055/INV-14),缩短由单调 max 合并构造性堵死
      // (ADR-052)—— 详见该方法的说明。
      const result = await repository.setLockUntilImmediate(target);
      if (result.ok) {
        onSettings?.(result.value);
        return { ok: true };
      }
      return { ok: false, error: result.error };
    },
    [onSettings, repository],
  );

  /**
   * 启动锁定:`lockUntil = now + 时长`。
   *
   * 🔴 **只调 `setLockUntil` 一次** —— 主开关由仓储层在同一次写入里带开
   * (ADR-057)。这里不碰 `setMasterEnabled`,见文件头。
   */
  const startLock = useCallback(
    (duration: LockDuration) => apply(lockUntilFrom(readNow(), duration)),
    [apply, readNow],
  );

  /**
   * 延长锁定:`lockUntil = max(现有到期时间, now) + 时长`。
   *
   * 🔴 以**现有到期时间**为基准,不是以 `now` —— 否则「锁了 8 小时、
   * 还剩 7 小时时延长 1 小时」会把到期时间算成 `now + 1h`,
   * 即**缩短 6 小时**。那正是 ADR-052 所说的「延长成了缩短的后门」。
   *
   * 取 `max(..., now)` 是为了 `lockUntil` 已过期的边界:
   * 此时延长应当从现在起算,而不是从一个过去的时刻起算(那会得到过去的值,
   * 被 `canSetLockUntil` 以 `in-the-past` 拒绝)。
   */
  const extendLock = useCallback(
    (duration: LockDuration) => {
      const ms = durationToMs(duration);
      if (ms === null) return apply(null);
      const current = settings.lockUntil;
      // 只读一次时钟 —— 读两次理论上可能跨过一毫秒,让判据与取值不同口径。
      const nowTick = readNow();
      const base =
        current !== null && Number.isFinite(current) && current > nowTick
          ? current
          : nowTick;
      const next = base + ms;
      return apply(Number.isFinite(next) ? next : null);
    },
    [apply, readNow, settings.lockUntil],
  );

  return useMemo(
    () => ({
      locked,
      now,
      lockUntil: settings.lockUntil,
      startLock,
      extendLock,
    }),
    [locked, now, settings.lockUntil, startLock, extendLock],
  );
}
