/**
 * **未锁定**时的计时器入口(ADR-058 + ADR-056 + ADR-057)。
 *
 * ```
 * ├──────────────────────────────────┤
 * │ 专注锁定                          │
 * │ 锁定后无法修改设置,只能延长…      │
 * │ 锁定时长                          │
 * │ [30 分钟][1 小时][4 小时][8 小时] │  预设按钮(ADR-058)
 * │ 自定义时长 [  4 ] [小时 ▾]        │  数字 + 单位下拉(ADR-058)
 * │ [        启动锁定        ]        │  → 二次确认(ADR-056)
 * └──────────────────────────────────┘
 * ```
 *
 * ## 三条硬性约束
 *
 * 1. **ADR-058** —— 只接受「预设」或「数字 + 单位」,**绝不接受裸时间戳**。
 *    时间戳由 `lockUntilFrom(now, duration)` 算出,是输出而非输入。
 * 2. **ADR-056** —— 点「启动锁定」**只打开确认框**,一个字节都不写。
 *    真正的写入在 `handleConfirm` 里,且只有那一处。
 * 3. **ADR-057** —— 启动时主开关若是关闭的,**由仓储层的 `setLockUntil`
 *    在同一次写入中置 `masterEnabled: true`**(一次 `storage.set`,无中间态)。
 *    UI 这一侧**绝不**先调 `setMasterEnabled(true)` 再调 `setLockUntil(...)` ——
 *    那是两次写入、有中间态,恰恰是 ADR-057 要消灭的东西。
 */

import { useCallback, useState } from 'react';

import { type ActionResult } from './RuleListView.js';
import { LockConfirmDialog } from './components/LockConfirmDialog.js';
import { LockDurationPicker } from './components/LockDurationPicker.js';
import {
  type LockDuration,
  formatDuration,
  isValidDuration,
} from './lock-duration.js';
import {
  LOCK_CUSTOM_LABEL,
  LOCK_INVALID_DURATION,
  LOCK_PRESET_LABEL,
  LOCK_SECTION_HINT,
  LOCK_SECTION_TITLE,
  LOCK_START_LABEL,
  LOCK_UNIT_LABEL,
} from './lock-strings.js';

/** 入口的默认选中时长 —— 与 `LOCK_PRESETS` 的中间档一致。 */
export const DEFAULT_LOCK_DURATION: LockDuration = { amount: 1, unit: 'hour' };

export interface LockTimerEntryProps {
  /**
   * 🔴 ADR-057:当前主开关状态。关闭时确认框会额外告知
   * 「启动锁定将同时开启滤镜」。
   */
  readonly masterEnabled: boolean;
  /**
   * 启动锁定 —— **只在用户确认后调用**(ADR-056)。
   *
   * 实现方须走仓储层的 `setLockUntil`,由它**原子地**一并置
   * `masterEnabled: true`(ADR-057)。本组件传出的是带单位的时长,
   * 时间戳的换算由调用方用 `lockUntilFrom(effectiveNow, duration)` 完成 ——
   * 因为只有调用方知道 `maxSeenTime`(ADR-059/INV-15)。
   */
  readonly onStartLock: (duration: LockDuration) => Promise<ActionResult> | ActionResult;
  /** 骨架态或其他原因下禁用入口(ADR-044)。 */
  readonly disabled?: boolean;
}

export function LockTimerEntry({
  masterEnabled,
  onStartLock,
  disabled = false,
}: LockTimerEntryProps) {
  const [duration, setDuration] = useState<LockDuration>(DEFAULT_LOCK_DURATION);
  const [confirming, setConfirming] = useState(false);

  const valid = isValidDuration(duration);

  /**
   * 🔴 点「启动锁定」**只开确认框**(ADR-056)。
   * 这个函数里没有、也不得有任何写入调用 —— gate 用 spy 断言这一点。
   */
  const handleStartClick = useCallback(() => {
    if (!valid) return;
    setConfirming(true);
  }, [valid]);

  /** 取消:只关框。**不产生任何写入**(gate 明文)。 */
  const handleCancel = useCallback(() => {
    setConfirming(false);
  }, []);

  /** 确认:**唯一**的写入点。 */
  const handleConfirm = useCallback(() => {
    setConfirming(false);
    void onStartLock(duration);
  }, [duration, onStartLock]);

  return (
    <section className="lock-entry" data-testid="lock-entry">
      <div className="lock-entry__head">
        <h2 className="lock-entry__title">{LOCK_SECTION_TITLE}</h2>
        {/* ADR-052 的单向语义必须在点开确认框之前就可见。 */}
        <p className="lock-entry__hint">{LOCK_SECTION_HINT}</p>
      </div>

      <LockDurationPicker
        idPrefix="lock-start"
        value={duration}
        onChange={setDuration}
        disabled={disabled}
        showPresets
        presetLabel={LOCK_PRESET_LABEL}
        /* 可见标签用「自定义时长」,单位下拉的无障碍名用更精确的「时长单位」。 */
        amountLabel={LOCK_CUSTOM_LABEL}
        unitLabel={LOCK_UNIT_LABEL}
      />

      {/* 非法时长:提示 + 禁用启动,而不是静默拒绝。 */}
      {!valid && (
        <p className="lock-entry__invalid" role="alert" data-testid="lock-invalid-duration">
          {LOCK_INVALID_DURATION}
        </p>
      )}

      <button
        type="button"
        className="lock-entry__start"
        data-testid="lock-start"
        disabled={disabled || !valid}
        onClick={handleStartClick}
      >
        {LOCK_START_LABEL}
      </button>

      {/* ADR-056:二次确认。未确认前不写入任何数据。 */}
      {confirming && (
        <LockConfirmDialog
          durationText={formatDuration(duration)}
          /* 🔴 ADR-057:主开关关闭时告知它会被一并打开。 */
          willEnableMaster={!masterEnabled}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {/*
        ⚠️ 本组件只在**未锁定**时渲染(见 `RuleListView` 的 `locked` 分支)。
        锁定中没有任何解除/取消/结束/缩短入口 —— ADR-052 / INV-12。
      */}
    </section>
  );
}
