/**
 * **未锁定**时列表视图里那一行折叠入口 —— 点它进锁定子页面。
 *
 * ```
 * ├──────────────────────────────────┤
 * │ [ 🔒 时间锁定                 › ] │  ← 一行,与「+ 添加规则」同一语气
 * └──────────────────────────────────┘
 * ```
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 🔴 本组件**不写任何数据,也不持有任何时长状态**
 *
 * 它只有一个出口 —— `onOpen`,一次视图切换。于是「点一下就把自己锁上」
 * 在结构上不可能:启动锁定需要先进子页面、再过 ADR-056 的二次确认,
 * 两步都在别的组件里。这比原先「列表里直接摆一个启动按钮」更难误触。
 *
 * ## 为什么是 `<button>` 而不是可点击的 `<div>`
 *
 * 它承载一次导航,必须可 Tab 聚焦、可回车/空格触发、可被屏幕阅读器
 * 识别为按钮。`.add-button` 本就是 `<button>`,沿用同一基类即可
 * 同时继承 `tokens.css` 的全局 `:focus-visible`(ADR-043)。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ⚠️ 本组件只在**未锁定**时渲染(锁定中换成 `LockCountdownBanner`)——
 * 锁定中出现「时间锁定」入口没有意义,出现任何解除/缩短入口则直接
 * 违反 ADR-052 / INV-12。互斥由调用方(`App`)的两个插槽保证。
 */

import { LOCK_ENTRY_ROW_ARIA, LOCK_ENTRY_ROW_LABEL } from './lock-strings.js';

export interface LockEntryRowProps {
  /** 打开锁定子页面。**唯一**出口 —— 本组件不写存储。 */
  readonly onOpen: () => void;
  /** 骨架态等原因下禁用(ADR-044)。 */
  readonly disabled?: boolean;
}

export function LockEntryRow({ onOpen, disabled = false }: LockEntryRowProps) {
  return (
    <div className="lock-entry-row" data-testid="lock-entry">
      <button
        type="button"
        /* 与「+ 添加规则」共享 `.add-button` 基类 —— 同一视觉语气(§5.1 token)。 */
        className="add-button lock-entry-row__button"
        data-testid="lock-open"
        aria-label={LOCK_ENTRY_ROW_ARIA}
        disabled={disabled}
        onClick={onOpen}
      >
        <span>{LOCK_ENTRY_ROW_LABEL}</span>
        {/* 「有下一页」的通用记号,纯装饰 —— 无障碍名由 aria-label 给。 */}
        <span className="lock-entry-row__chevron" aria-hidden="true">
          ›
        </span>
      </button>
    </div>
  );
}
