/**
 * **锁定中**子页面里的「延长」区 —— 锁定期间**唯一**可用的锁定操作
 * (ADR-052 / INV-12)。
 *
 * ```
 * ┌──────────────────────────────────┐
 * │ ‹ 返回        延长锁定            │  ← 顶栏由 `LockView` 提供
 * ├──────────────────────────────────┤
 * │ 🔒 锁定中 02:14:07                │  只读回显,非控件
 * │ 锁定期间设置不可修改               │
 * │ 延长锁定                          │
 * │ [ 1 ] [小时 ▾]      [   延长   ]  │  ← 唯一的写入控件
 * └──────────────────────────────────┘
 * ```
 *
 * ## 📍 这块原先内联在列表页的倒计时条里(折叠改造)
 *
 * 搬进子页面后**语义一条未改**:仍是 ADR-058 的「数字 + 单位」、
 * 仍只有一个会写入的按钮、仍只能让 `lockUntil` 变大。
 * 代价是多一次点击 —— 而延长是低频动作,列表页的垂直空间更贵。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **负向约束 —— 本组件的 DOM 里不得存在任何**
 * **解除 / 取消 / 结束 / 缩短锁定的入口**(ADR-052 / INV-12)。
 *
 * §6 T6c gate:
 * > 这是 **INV-12 最重要的一条门禁**。
 *
 * 结构上的保证:本组件**只有一个**会触发写入的控件 —— 「延长」按钮,
 * 而它调用的 `onExtend` 只能让 `lockUntil` **变大**
 * (时长恒为正数,`lockUntilFrom` 在当前到期时间之上再加;
 * 且仓储层的 `canSetLockUntil` 会二次拒绝任何不增大的写入,ADR-055)。
 * 「加码可以,反悔不行」在 UI 与数据层各钉了一道。
 *
 * ⚠️ 这里**没有**返回按钮 —— 返回由 `LockView` 的顶栏提供,
 *    而「返回列表」不是「解除锁定」:它只是换一个视图,
 *    锁仍在、控件仍禁用(ADR-051 的判定全程只看 `lockUntil`)。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 倒计时不自减(gate 明文)
 *
 * 子页面里的剩余时间同样由 `formatCountdown(lockUntil, now)` **每次重算**,
 * 不保留任何计数器状态(与 `LockCountdownBanner` 同一口径)。
 */

import { useCallback, useState } from 'react';

import { type ActionResult } from './RuleListView.js';
import { LockDurationPicker } from './components/LockDurationPicker.js';
import { type LockDuration, isValidDuration } from './lock-duration.js';
import { formatCountdown } from './lock-format.js';
import {
  LOCK_EXTEND_AMOUNT_LABEL,
  LOCK_EXTEND_LABEL,
  LOCK_EXTEND_SECTION_LABEL,
  LOCK_EXTEND_UNIT_LABEL,
  LOCK_LIST_READONLY_HINT,
} from './lock-strings.js';

/** 延长区的默认时长。 */
export const DEFAULT_EXTEND_DURATION: LockDuration = { amount: 1, unit: 'hour' };

export interface LockExtendPanelProps {
  /** 绝对到期时间戳(ADR-053)。 */
  readonly lockUntil: number;
  /** 当前时刻 —— 注入时钟的原始值(ADR-071),由 `useLockClock` 提供。 */
  readonly now: number;
  /**
   * 延长锁定 —— 传出**带单位的时长**(ADR-058),由调用方加到现有
   * `lockUntil` 之上算出新的绝对时间戳。
   *
   * **没有对应的「缩短」回调,这是刻意的**(ADR-052 / INV-12)。
   */
  readonly onExtend: (duration: LockDuration) => Promise<ActionResult> | ActionResult;
}

export function LockExtendPanel({
  lockUntil,
  now,
  onExtend,
}: LockExtendPanelProps) {
  const [duration, setDuration] = useState<LockDuration>(DEFAULT_EXTEND_DURATION);
  const valid = isValidDuration(duration);

  const handleExtend = useCallback(() => {
    if (!valid) return;
    void onExtend(duration);
  }, [duration, onExtend, valid]);

  return (
    <section className="lock-extend" data-testid="lock-extend-panel">
      {/*
        只读回显 —— 进了子页面仍看得到还剩多久,否则「延长多少」没有参照。
        它是 `<span>`,不是控件:这里不该出现第二个可点的东西。
        `aria-live="off"`:每秒播报会让屏幕阅读器不可用(同倒计时条)。
      */}
      <span
        className="lock-extend__countdown"
        data-testid="lock-view-countdown"
        data-lock-until={String(lockUntil)}
        aria-live="off"
      >
        {formatCountdown(lockUntil, now)}
      </span>

      <p className="lock-extend__hint">{LOCK_LIST_READONLY_HINT}</p>

      {/*
        ── 延长:锁定中**唯一**可用的操作(ADR-052)──
        注意这里**没有**「解除」「取消锁定」「提前结束」「缩短」任何一个按钮。
      */}
      <div className="lock-extend__group">
        <span className="lock-duration__label" id="lock-extend-label">
          {LOCK_EXTEND_SECTION_LABEL}
        </span>
        <div
          className="lock-extend__row"
          role="group"
          aria-labelledby="lock-extend-label"
        >
          <LockDurationPicker
            idPrefix="lock-extend"
            value={duration}
            onChange={setDuration}
            /* 延长区不给预设按钮 —— 自定义输入已覆盖全部时长。 */
            showPresets={false}
            amountLabel={LOCK_EXTEND_AMOUNT_LABEL}
            /*
              可见标签由上面的「延长锁定」承担 —— 数字框的标签走
              visually-hidden(屏幕阅读器仍读得到「延长时长数值」),
              否则 360px 的一行会被两个标签挤散。
            */
            hideAmountLabel
            unitLabel={LOCK_EXTEND_UNIT_LABEL}
          />
          <button
            type="button"
            className="lock-extend__button"
            data-testid="lock-extend"
            disabled={!valid}
            onClick={handleExtend}
          >
            {LOCK_EXTEND_LABEL}
          </button>
        </div>
      </div>
    </section>
  );
}
