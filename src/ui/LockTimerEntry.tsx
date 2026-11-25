/**
 * **未锁定**时的计时器入口(ADR-058 + ADR-056)。
 *
 * ```
 * ┌──────────────────────────────────┐
 * │ ‹ 返回        专注锁定            │  ← 子页面顶栏,由 `LockView` 提供
 * ├──────────────────────────────────┤
 * │ 锁定后无法修改设置,只能延长…      │  ↓ 以下由本组件渲染
 * │ 锁定时长                          │
 * │ [30 分钟][1 小时][4 小时][8 小时] │  预设按钮(ADR-058)
 * │ 自定义时长 [  4 ] [小时 ▾]        │  数字 + 单位下拉(ADR-058)
 * │              ⋮ (可滚动)           │
 * ├──────────────────────────────────┤
 * │ [        启动锁定        ]        │  ← **钉在底部的底栏**(产品负责人)
 * └──────────────────────────────────┘
 * ```
 *
 * ## 📌 「启动锁定」钉在底栏(产品负责人决定)
 *
 * > 「点击『时间锁定』进入页面后,『启动锁定』要和『添加规则』一样的页面设计,
 * > 『save』按钮放在最下面」
 *
 * 原先它紧跟在时长选择器下面,于是在 452px 高的 popup 里**浮在中间**,
 * 下方一大片死空间。改为与列表页的 `.popup__foot`(「+ 添加规则」)、
 * 编辑页的 `.edit__foot`(「保存 / 删除」)**同一个底栏惯用法**:
 * 主操作恒在最下沿,三个页面的肌肉记忆一致。
 *
 * 🔴 **仓内已有两种底栏,不再发明第三种** —— 本组件的底栏复用
 * `.popup__foot` 的结构语义(`flex: 0 0 auto` + 上边框 + 同一内边距),
 * 见 `popup.css` 的 `.lock-view__foot`。
 *
 * ## 实现形状:本组件返回 `<>body + footer</>`
 *
 * 底栏要钉在 **popup 的**最下沿,而不是「启动区这个盒子的」最下沿 ——
 * 所以 body 与 footer 必须是**同一个 flex 容器的两个兄弟**,
 * 那个容器是 `LockView` 的根 `.popup`。于是本组件返回一个 Fragment:
 * 可滚动的 `.lock-view__body` + `flex:0 0 auto` 的 `.lock-view__foot`。
 *
 * ⚠️ 若把 footer 套在 body 里面再 `position:absolute`,它会脱离
 *    文档流、盖住可滚动内容的最后一行 —— 两个既有底栏都不是那么做的。
 *
 * ## 📍 本组件现在住在**子页面**里,不在列表视图(折叠改造)
 *
 * 列表视图只留一行 `LockEntryRow`(「🔒 时间锁定 ›」),点它才进
 * `LockView`,本组件是 `LockView` 的**未锁定**分支。
 *
 * 搬家只改**位置**:下面三条硬性约束与原先逐字相同,
 * 区段标题(原来的 `<h2>专注锁定`)改由 `LockView` 的顶栏承担 ——
 * 同一页上出现两个「专注锁定」是重复,不是更清楚。
 *
 * ## 三条硬性约束
 *
 * 1. **ADR-058** —— 只接受「预设」或「数字 + 单位」,**绝不接受裸时间戳**。
 *    时间戳由 `lockUntilFrom(now, duration)` 算出,是输出而非输入。
 * 2. **ADR-056** —— 点「启动锁定」**只打开确认框**,一个字节都不写。
 *    真正的写入在 `handleConfirm` 里,且只有那一处。
 * 3. **ADR-061** —— 确认后**立即落盘**,不防抖、不等任何读往返。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **第三条原先是 ADR-057(启动时原子开启主开关),已由 ADR-076 废止。**
 *
 * 本组件因此不再需要知道主开关的状态:主开关 OFF 时,列表页上的
 * 「🔒 时间锁定」入口**本身就是禁用的**(`RuleListView` 的
 * `lockEntryDisabled`),用户到不了本组件所在的这一页。
 *
 * 于是「在关闭态启动锁定」这个场景**在 UI 上不可达**,它所需要的
 * 补救(悄悄把主开关带开)与告知(「将同时开启滤镜」)一并删除。
 * 原 `masterEnabled` prop 已移除 —— 留一个没人读的 prop 只会让
 * 下一个人以为那条分支还活着。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
  LOCK_START_LABEL,
  LOCK_UNIT_LABEL,
} from './lock-strings.js';

/**
 * 入口的默认选中时长 —— `LOCK_PRESETS` 里的「1 小时」(第 2 档)。
 *
 * ⚠️ 原注释写的是「与 `LOCK_PRESETS` 的中间档一致」,那是**错的**:
 *    预设共 5 档(30 分 / 1 时 / 4 时 / 8 时 / 1 天),中间档是「4 小时」,
 *    而本默认值是「1 小时」。改成按档位名陈述,不再依赖「中间」这种
 *    会随档位增删而失真的说法。
 */
export const DEFAULT_LOCK_DURATION: LockDuration = { amount: 1, unit: 'hour' };

export interface LockTimerEntryProps {
  /*
    🔴 ADR-076:原先这里有 `masterEnabled: boolean`(ADR-057 的告知判据),
       已删除 —— 主开关 OFF 时本页不可达,本组件不需要知道它。
  */
  /**
   * 启动锁定 —— **只在用户确认后调用**(ADR-056)。
   *
   * 本组件传出的是带单位的时长,时间戳的换算由调用方用
   * `lockUntilFrom(clock(), duration)` 完成 —— 因为只有调用方
   * 持有注入的时钟(ADR-071)。
   */
  readonly onStartLock: (duration: LockDuration) => Promise<ActionResult> | ActionResult;
  /** 骨架态或其他原因下禁用入口(ADR-044)。 */
  readonly disabled?: boolean;
}

export function LockTimerEntry({
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
    <>
      {/*
        ── 可滚动的主体(与列表页的 `.rule-list`、编辑页的 `.edit__body` 同位)──
        `data-testid="lock-start-section"` 留在**主体**上:门禁用它界定
        「时长控件的全部所在」(只有一个数字输入 + 一个下拉),
        而启动按钮已搬进底栏 —— 它本来就不是时长控件。
      */}
      <div className="lock-view__body" data-testid="lock-start-section">
        <section className="lock-entry">
          {/*
            ADR-052 的单向语义必须在点开确认框之前就可见 ——
            搬进子页面后它仍是用户在**点启动之前**读到的第一句话。
            区段标题由 `LockView` 的顶栏给(`LOCK_VIEW_TITLE`),此处不重复。
          */}
          <p className="lock-entry__hint">{LOCK_SECTION_HINT}</p>

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

          {/*
            非法时长:提示 + 禁用启动,而不是静默拒绝。
            ⚠️ 提示留在**主体**里、紧跟输入框 —— 它解释的是上面那个输入,
               放进底栏会离它要解释的东西很远。
          */}
          {!valid && (
            <p
              className="lock-entry__invalid"
              role="alert"
              data-testid="lock-invalid-duration"
            >
              {LOCK_INVALID_DURATION}
            </p>
          )}
        </section>
      </div>

      {/*
        ── 📌 底栏:主操作钉在最下沿(产品负责人决定)──
        与 `.popup__foot`(+ 添加规则)、`.edit__foot`(保存)同一惯用法。
      */}
      <footer className="lock-view__foot" data-testid="lock-view-foot">
        <button
          type="button"
          /*
            `.lock-view__foot-action` 给布局(撑满一行),
            `.lock-entry__start` 给外观(主操作的实心强调色)——
            与 `.edit__save` 在 `.edit__foot` 里的分工一致。
          */
          className="lock-view__foot-action lock-entry__start"
          data-testid="lock-start"
          disabled={disabled || !valid}
          onClick={handleStartClick}
        >
          {LOCK_START_LABEL}
        </button>
      </footer>

      {/*
        ADR-056:二次确认。未确认前不写入任何数据。
        ⚠️ 它是铺满 popup 的模态(`.lock-modal` 用 `position:absolute; inset:0`,
           包含块是 `.popup`),故挂在 body/footer **之外**、作为根的兄弟 ——
           挂在底栏里会被底栏的 `overflow` 与 `flex` 约束裁掉。
      */}
      {confirming && (
        <LockConfirmDialog
          durationText={formatDuration(duration)}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {/*
        ⚠️ 本组件只在**未锁定**时渲染(见 `LockView` 的 `locked` 分支:
        锁定中它渲染的是 `LockExtendPanel`,根本不挂本组件)。
        锁定中没有任何解除/取消/结束/缩短入口 —— ADR-052 / INV-12。
      */}
    </>
  );
}
