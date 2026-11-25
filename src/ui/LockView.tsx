/**
 * Popup **锁定子页面**(ADR-022 判别联合的第三个变体 `{kind:'lock'}`)。
 *
 * ```
 * ┌──────────────────────────────────┐
 * │ ‹ 返回        专注锁定            │  顶栏(本组件)
 * ├──────────────────────────────────┤
 * │  未锁定 → LockTimerEntry          │  可滚动主体
 * │  锁定中 → LockExtendPanel         │  (两者互斥)
 * ├──────────────────────────────────┤
 * │ [  启动锁定  ] / [    延长    ]   │  📌 钉底的底栏
 * └──────────────────────────────────┘
 * ```
 *
 * 📌 **底栏钉底**(产品负责人:「『save』按钮放在最下面」)——
 * 两个分支都把主操作放进 `.lock-view__foot`,与列表页的
 * `.popup__foot`(「+ 添加规则」)、编辑页的 `.edit__foot`(「保存」)
 * 同一惯用法。本组件的根 `.popup` 是那个 flex 容器。
 *
 * 由列表视图的两个入口之一到达:
 * - 未锁定 → `LockEntryRow`(「🔒 时间锁定 ›」)
 * - 锁定中 → `LockCountdownBanner`(点倒计时条)
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 🔴 I2「预览与锁定永不共存」—— 本视图如何保持该性质
 *
 * §6 T6b gate 的 I2 原文:
 * > **预览与锁定永不共存**:锁定入口**仅存在于列表视图**,预览仅存在于
 * > 编辑视图,而 ADR-022 规定两视图互斥 …… 故「锁定启动时预览仍活动」不可达。
 * > **此性质须保持** —— 不得在编辑视图添加锁定快捷入口。
 *
 * 新增第三个视图后,该性质由**三条结构事实**共同保持,全部可被静态检查:
 *
 * 1. **本组件的 props 里没有 `previewChannel`,也没有任何规则编辑回调**
 *    (没有 `onSave` / `onDelete` / `onMoveToTop` / `onReindex`)。
 *    于是「在锁定页顺手改个强度并预览一下」需要**先改本组件的接口** ——
 *    与 `RuleEditView` 那边没有锁定插槽是完全对称的做法。
 * 2. **本组件不 import 任何预览或规则编辑的东西** ——
 *    没有 `usePreview` / `preview-port` / `RuleEditView` / `PREVIEW_*`。
 *    这条由 `tests/t6c-static-gates.test.ts` 的静态门禁逐项断言。
 * 3. **三个视图仍然互斥** —— `App` 的 `View` 是判别联合,
 *    `kind` 只能取一个值,结构上不可能同时渲染锁定页与编辑页。
 *    且进入锁定页的两个入口**只在列表视图**上;编辑视图的 props 里
 *    依旧没有任何锁定插槽。
 *
 * 换句话说:锁定入口原先「只在列表视图」,现在是「只从列表视图可达」——
 * 新增的这一页是列表视图的**下游**,不是编辑视图的旁路。
 * 从编辑视图到锁定页**必须**先返回列表(途中必发 `PREVIEW_CLEAR`,B1),
 * 所以「预览还活着就启动了锁定」依旧不可达。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 🔴 锁定中与未锁定在本页也是互斥的(ADR-051 / ADR-052 / INV-12)
 *
 * - 未锁定 → `LockTimerEntry`(时长选择 + 启动 + 二次确认),**不挂**延长区
 * - 锁定中 → `LockExtendPanel`(**仅**延长),**不挂**启动区
 *
 * 于是锁定中的 DOM 里结构上不可能出现「启动/解除/取消/结束/缩短」任何入口 ——
 * 那是 §6 T6c gate 里「INV-12 最重要的一条门禁」。
 *
 * ## 「返回」不是「解除」
 *
 * 顶栏的返回只切视图。锁的判定全程只看存储里的 `lockUntil`
 * (`useLockState` + 仓储层,INV-14),与当前在哪个视图无关 ——
 * 返回列表后锁仍在、控件仍禁用。本页因此**没有任何** ADR-052 的后门。
 */

import { LockExtendPanel } from './LockExtendPanel.js';
import { LockTimerEntry } from './LockTimerEntry.js';
import { type ActionResult } from './RuleListView.js';
import { type LockDuration } from './lock-duration.js';
import { LOCK_VIEW_TITLE, LOCK_VIEW_TITLE_LOCKED } from './lock-strings.js';
import { BACK_LABEL } from './edit-strings.js';

export interface LockViewProps {
  /*
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    🔴 **ADR-076:原先这里有 `settings: FilterSettings`,已整条删除。**

    它存在的唯一理由是 ADR-057 —— 确认框要据 `settings.masterEnabled`
    决定是否追加「将同时开启滤镜」的告知。ADR-057 已废止,那是本视图
    读过 `settings` 的**唯一**一个字段,于是整个 prop 没有了读者。

    删掉它是**收紧**,不是顺手清理:本视图现在连规则数据都拿不到,
    「在锁定页顺手改个强度并预览一下」连数据源都没有了 ——
    文件头 I2 的第 1 条(props 里没有任何规则编辑能力)因此更硬。
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  */
  /** 锁定中?决定渲染「启动」还是「延长」—— 两者互斥。 */
  readonly locked: boolean;
  /** 锁定中的绝对到期时间戳;未锁定时为 `null`(ADR-053)。 */
  readonly lockUntil: number | null;
  /** 当前时刻(ADR-071 的注入时钟),供倒计时每次重算。 */
  readonly now: number;
  /** 启动锁定 —— **只在二次确认之后**被调用(ADR-056)。 */
  readonly onStartLock: (duration: LockDuration) => Promise<ActionResult> | ActionResult;
  /** 延长锁定 —— 锁定中唯一的写入(ADR-052)。 */
  readonly onExtendLock: (duration: LockDuration) => Promise<ActionResult> | ActionResult;
  /** 返回列表视图。**只切视图,不碰存储**。 */
  readonly onBack: () => void;
  /** 骨架态(ADR-044):设置未读出前禁用启动。 */
  readonly disabled?: boolean;
}

export function LockView({
  locked,
  lockUntil,
  now,
  onStartLock,
  onExtendLock,
  onBack,
  disabled = false,
}: LockViewProps) {
  return (
    <div
      className={`popup${locked ? ' popup--locked' : ''}`}
      data-testid="popup"
      data-view="lock"
      data-locked={locked ? 'true' : 'false'}
      /*
        骨架态标记与另两个视图同口径 —— 门禁与测试都按
        `data-skeleton === 'false'` 判定「设置已读出」。
      */
      data-skeleton={disabled ? 'true' : 'false'}
    >
      {/* ── 顶栏:返回 + 标题(与编辑视图同一 `.edit__head` 语气,§5.5) ── */}
      <header className="edit__head">
        <button
          type="button"
          className="edit__back"
          data-testid="lock-back"
          onClick={onBack}
        >
          {BACK_LABEL}
        </button>
        <span className="edit__title" data-testid="lock-view-title">
          {locked ? LOCK_VIEW_TITLE_LOCKED : LOCK_VIEW_TITLE}
        </span>
      </header>

      {/*
        ── 📌 主体 + 底栏(产品负责人决定的底栏钉底)──

        两个分支**各自**返回「可滚动的 `.lock-view__body` + 钉底的
        `.lock-view__foot`」两个兄弟节点,它们是本根 `.popup`
        (`display:flex; flex-direction:column`)的直接子元素 ——
        与列表页的 `.rule-list` + `.popup__foot`、
        编辑页的 `.edit__body` + `.edit__foot` 完全同构。

        ⚠️ 这里**刻意不再包一层** `<div className="lock-view__body">`:
           包了的话底栏就成了那个 div 的子节点,只能钉在 div 的底部而不是
           popup 的底部,中间仍会留下死空间 —— 那正是本次要修的问题。

        🔴 互斥的两个分支 —— 锁定中绝不渲染启动区,未锁定绝不渲染延长区。
        三元表达式而非两个独立的 `&&`:后者允许「两个都渲染」这种状态存在,
        前者在类型层面就只能二选一(与 App 的 View 判别联合同一思路)。
      */}
      {locked && lockUntil !== null ? (
        <LockExtendPanel lockUntil={lockUntil} now={now} onExtend={onExtendLock} />
      ) : (
        <LockTimerEntry onStartLock={onStartLock} disabled={disabled} />
      )}

      {/*
        📌 这里**没有** previewChannel、没有规则列表、没有任何规则编辑控件 ——
           I2 的「预览与锁定永不共存」正是靠本视图不存在预览通道来保持
           (与编辑视图不存在锁定入口完全对称)。见文件头。
      */}
    </div>
  );
}
