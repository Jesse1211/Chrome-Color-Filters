/**
 * **锁定中**的倒计时条 + 延长入口(§5.4 第六种状态变体 / ADR-051 / ADR-052)。
 *
 * ```
 * ├──────────────────────────────────┤
 * │ 🔒 锁定中 02:14:07                │  每秒刷新,按 lockUntil - now 计算
 * │ 锁定期间设置不可修改               │
 * │ 延长锁定 [ 1 ] [小时 ▾] [ 延长 ]  │  ← 唯一可用的锁定操作
 * └──────────────────────────────────┘
 * ```
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
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 倒计时不自减(gate 明文)
 *
 * 时刻由 `useLockClock` 每秒给出,剩余量由
 * `formatCountdown(lockUntil, now)` **每次重算** —— 不保留任何计数器状态。
 * popup 重开或丢帧都不会漂移(见 `lock-format.ts` 文件头)。
 *
 * ## 到期自动恢复
 *
 * 本组件不判断「是否还锁着」—— 那由 `useLockState` 按同一个时钟判定。
 * 时钟推进到 `lockUntil` 时 `locked` 自然翻成 false,
 * 整条倒计时条被卸载、控件自动恢复可编辑,**无需手动刷新 popup**(gate 要求)。
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

export interface LockCountdownBannerProps {
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

export function LockCountdownBanner({
  lockUntil,
  now,
  onExtend,
}: LockCountdownBannerProps) {
  const [duration, setDuration] = useState<LockDuration>(DEFAULT_EXTEND_DURATION);
  const valid = isValidDuration(duration);

  const handleExtend = useCallback(() => {
    if (!valid) return;
    void onExtend(duration);
  }, [duration, onExtend, valid]);

  return (
    <section className="lock-banner" data-testid="lock-banner">
      {/*
        §5.4:顶部显示倒计时条「🔒 锁定中 02:14:07」。
        `aria-live="off"` —— 每秒一次的播报会让屏幕阅读器完全无法使用;
        剩余时间是**可按需查询**的信息,不是需要打断用户的通知。
      */}
      <div className="lock-banner__row">
        <span
          className="lock-banner__countdown"
          data-testid="lock-countdown"
          data-lock-until={String(lockUntil)}
          aria-live="off"
        >
          {formatCountdown(lockUntil, now)}
        </span>
      </div>

      <p className="lock-banner__hint">{LOCK_LIST_READONLY_HINT}</p>

      {/*
        ── 延长:锁定中**唯一**可用的操作(ADR-052)──
        注意这里**没有**「解除」「取消锁定」「提前结束」「缩短」任何一个按钮。
      */}
      <div className="lock-banner__extend">
        <span className="lock-duration__label" id="lock-extend-label">
          {LOCK_EXTEND_SECTION_LABEL}
        </span>
        <div className="lock-banner__extend-row" role="group" aria-labelledby="lock-extend-label">
          <LockDurationPicker
            idPrefix="lock-extend"
            value={duration}
            onChange={setDuration}
            /* 延长区不给预设按钮 —— 空间紧张,且自定义输入已覆盖全部时长。 */
            showPresets={false}
            amountLabel={LOCK_EXTEND_AMOUNT_LABEL}
            unitLabel={LOCK_EXTEND_UNIT_LABEL}
          />
          <button
            type="button"
            className="lock-banner__extend-button"
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
