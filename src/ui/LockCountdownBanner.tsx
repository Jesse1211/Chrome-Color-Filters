/**
 * **锁定中**的倒计时条(§5.4 第六种状态变体 / ADR-051 / ADR-052)。
 *
 * ```
 * ├──────────────────────────────────┤
 * │ [ 🔒 锁定中 02:14:07           › ]│  每秒刷新,按 lockUntil - now 计算
 * │ [ 锁定期间设置不可修改            ]│  整条可点 → 进子页面延长
 * └──────────────────────────────────┘
 * ```
 *
 * ## 📍 倒计时留在列表页,「延长」搬进子页面(折叠改造)
 *
 * 产品负责人的决定:**剩余时间必须在列表页一眼可见**(它是用户打开 popup
 * 最想知道的那一个数),而「延长」是低频动作 —— 搬进子页面。
 * 于是本组件现在只做两件事:**显示剩余时间**,以及**通往子页面**。
 * 延长控件见 `LockExtendPanel`(由 `LockView` 在锁定中渲染)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **负向约束 —— 本组件的 DOM 里不得存在任何**
 * **解除 / 取消 / 结束 / 缩短锁定的入口**(ADR-052 / INV-12)。
 *
 * §6 T6c gate:
 * > 这是 **INV-12 最重要的一条门禁**。
 *
 * 结构上的保证**比改造前更强**:本组件现在**一个写入控件都没有** ——
 * 唯一的按钮是 `onOpen`,一次视图切换,不碰存储。
 * 它通往的子页面里唯一的写入控件是「延长」,而延长只能让 `lockUntil`
 * **变大**(时长恒为正数,`lockUntilFrom` 在当前到期时间之上再加;
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

import { formatCountdown } from './lock-format.js';
import { LOCK_BANNER_ARIA, LOCK_LIST_READONLY_HINT } from './lock-strings.js';

export interface LockCountdownBannerProps {
  /** 绝对到期时间戳(ADR-053)。 */
  readonly lockUntil: number;
  /** 当前时刻 —— 注入时钟的原始值(ADR-071),由 `useLockClock` 提供。 */
  readonly now: number;
  /**
   * 打开锁定子页面(延长在那里)。**唯一**出口 —— 本组件不写存储。
   *
   * **没有对应的「缩短」或「提前结束」回调,这是刻意的**(ADR-052 / INV-12)。
   */
  readonly onOpen: () => void;
}

export function LockCountdownBanner({
  lockUntil,
  now,
  onOpen,
}: LockCountdownBannerProps) {
  return (
    <section className="lock-banner" data-testid="lock-banner">
      {/*
        §5.4:顶部显示倒计时条「🔒 锁定中 02:14:07」。

        整条做成一个 `<button>`:它承载一次导航,必须可 Tab 聚焦、
        可回车/空格触发、可被屏幕阅读器识别为按钮(ADR-043 的全局
        `:focus-visible` 随之生效)。可点击的 `<div>` 三条都做不到。
      */}
      <button
        type="button"
        className="lock-banner__open"
        data-testid="lock-open"
        aria-label={LOCK_BANNER_ARIA}
        onClick={onOpen}
      >
        <span className="lock-banner__row">
          {/*
            `aria-live="off"` —— 每秒一次的播报会让屏幕阅读器完全无法使用;
            剩余时间是**可按需查询**的信息,不是需要打断用户的通知。
          */}
          <span
            className="lock-banner__countdown"
            data-testid="lock-countdown"
            data-lock-until={String(lockUntil)}
            aria-live="off"
          >
            {formatCountdown(lockUntil, now)}
          </span>
          {/* 「有下一页」的通用记号,纯装饰 —— 无障碍名由 aria-label 给。 */}
          <span className="lock-banner__chevron" aria-hidden="true">
            ›
          </span>
        </span>
        <span className="lock-banner__hint">{LOCK_LIST_READONLY_HINT}</span>
      </button>
    </section>
  );
}
