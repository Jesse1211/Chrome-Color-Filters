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
  /**
   * 骨架态或**主开关 OFF**(ADR-044 / ADR-076)时禁用。
   *
   * 🔴 判据**不在本组件里算** —— 它由 `RuleListView` 的 `lockEntryDisabled`
   * 经 `lockEntry` 插槽传进来,因为只有那里同时握着 `settings` 与 `tabState`。
   * 本组件若自己复算就会出现第二份实现(见 `RuleListViewProps.lockEntry`)。
   */
  readonly disabled?: boolean;
  /**
   * 🔴 **ADR-076:禁用时说得出为什么。**
   *
   * `disabled` 的按钮对屏幕阅读器只播报「不可用」,不播报原因;
   * 对视力正常的用户也只是一块变灰的区域。这句话经 `title` 给出
   * ——「已全局关闭,请先开启主开关」,同时指明出路。
   *
   * 与「+ 添加规则」用的是**同一个**字符串(`MASTER_OFF_DISABLED_REASON`),
   * 两个被同一条 ADR 一起禁用的入口,解释不该各说一套。
   */
  readonly disabledReason?: string;
}

export function LockEntryRow({
  onOpen,
  disabled = false,
  disabledReason,
}: LockEntryRowProps) {
  return (
    <div className="lock-entry-row" data-testid="lock-entry">
      <button
        type="button"
        /* 与「+ 添加规则」共享 `.add-button` 基类 —— 同一视觉语气(§5.1 token)。 */
        className="add-button lock-entry-row__button"
        data-testid="lock-open"
        aria-label={LOCK_ENTRY_ROW_ARIA}
        /*
          🔴 **真 `disabled`,不是只画成灰的**(ADR-076 + 无障碍):
          禁用的 <button> 不触发 click、不可 Tab 聚焦,键盘用户同样挡得住。

          ⚠️ 这里**不加** `aria-disabled` —— 原生 `disabled` 已经把
             「不可用」播报出去了,两者并存会让某些屏幕阅读器播报两遍。
             `aria-disabled` 是给**不能用原生 disabled 的**自定义控件
             (如 `role="button"` 的 div)准备的替代品,本组件是真按钮,
             用不上它。原因由 `title` 承担。
        */
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
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
