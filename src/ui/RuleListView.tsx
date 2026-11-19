/**
 * Popup **列表视图**(DESIGN.md §5.3 / §5.4 · 任务 T6a)。
 *
 * ```
 * ┌──────────────────────────────────┐
 * │ ◧ Color Filters            [●]   │  主开关,固定顶部
 * ├──────────────────────────────────┤
 * │ ↓ 从上往下匹配,首个命中的规则生效  │  常驻提示条 (ADR-031)
 * ├──────────────────────────────────┤
 * │ ⠿ *.weibo.*    ▰ 灰阶 100%   ✕   │  拖柄·色块+名称·强度·删除
 * │              ⋮ (可滚动)           │
 * ├──────────────────────────────────┤
 * │ [+ 添加规则]               3/20  │
 * └──────────────────────────────────┘
 * ```
 *
 * ## 本组件遵循的 ADR
 *
 * - **ADR-008 / INV-6** 顺序即优先级,可拖拽重排;重排后立即生效并持久化
 * - **ADR-009** 主开关是全局单例,**无 per-rule 开关**
 * - **ADR-012** 达到上限时提示并引导删除,绝不静默淘汰
 * - **ADR-013 / ADR-050** 不可注入页:规则编辑类控件置灰 + 说明原因,
 *   **但全局主开关保持可用**(§6.1 冲突第 7 条)
 * - **ADR-022** 双视图:本组件是列表视图,「打开编辑」通过 `onOpenRule` 上抛
 * - **ADR-023** 拖柄与展开/删除分离(实现见 `RuleRow`)
 * - **ADR-024** **不提供「清空全部」**
 * - **ADR-031** 列表顶部常驻优先级提示条
 * - **ADR-032** 被遮蔽行整行淡化 + 「此页未生效」,不使用删除线
 * - **ADR-043** 所有可聚焦元素的 focus 态由 `tokens.css` 统一提供
 * - **ADR-044** 当前页信息一律来自 `TabState`,**本视图不自己算匹配**
 * - **ADR-046** 存储失败 → 顶部红色报错条
 *
 * ## 不在本任务范围
 *
 * - **锁定 UI 已拆出为 T6c**(§6 T6a spec)。本组件通过 `lockBanner` /
 *   `locked` 两个**可选**接缝为 T6c 预留位置,自身不渲染任何锁定界面,
 *   也不提供任何解除/缩短入口(ADR-052/INV-12)。
 * - 编辑视图是 T6b(ADR-022)。
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { type FilterRule } from '../domain/filter-rule.js';
import { type FilterSettings, MAX_RULES } from '../domain/filter-settings.js';
import { type WriteError } from '../storage/errors.js';
import { RuleRow } from './components/RuleRow.js';
import { type SaveErrorBanner, toSaveErrorBanner } from './save-error.js';
import { type TabState } from './tab-state.js';
import {
  ADD_RULE_LABEL,
  BRAND_NAME,
  CAPACITY_NOTICE,
  EMPTY_HINT,
  EMPTY_TITLE,
  MASTER_OFF_NOTICE,
  MASTER_SWITCH_LABEL,
  NOT_INJECTABLE_MESSAGE,
  PRIORITY_HINT_PREFIX,
  PRIORITY_HINT_STRONG,
} from './strings.js';

/** 写入动作的统一结果形状 —— 与仓储层的 `WriteResult` 同构。 */
export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: WriteError };

export interface RuleListViewProps {
  readonly settings: FilterSettings;
  /**
   * 当前 tab 的状态(ADR-044)。`null` = **骨架态**:
   * > popup 在收到响应前渲染骨架态(控件禁用、不显示错误),收到后再渲染。
   */
  readonly tabState: TabState | null;
  readonly onToggleMaster: (next: boolean) => Promise<ActionResult> | ActionResult;
  readonly onDeleteRule: (index: number) => Promise<ActionResult> | ActionResult;
  readonly onReorderRules: (
    rules: readonly FilterRule[],
  ) => Promise<ActionResult> | ActionResult;
  readonly onAddRule: () => void;
  readonly onOpenRule: (index: number) => void;
  /**
   * 锁定态接缝 —— **T6c 的插槽**,T6a 不实现锁定 UI。
   * 为 true 时所有设置控件禁用(ADR-051),但本组件**不**渲染倒计时或任何解除入口。
   */
  readonly locked?: boolean;
  /** T6c 注入的锁定条(倒计时)。T6a 原样渲染在顶部,自身不构造内容。 */
  readonly lockBanner?: React.ReactNode;
}

export function RuleListView({
  settings,
  tabState,
  onToggleMaster,
  onDeleteRule,
  onReorderRules,
  onAddRule,
  onOpenRule,
  locked = false,
  lockBanner,
}: RuleListViewProps) {
  /** ADR-046:最近一次写入失败。成功写入后清空。 */
  const [saveError, setSaveError] = useState<SaveErrorBanner | null>(null);

  /**
   * 拖拽过程中的**乐观顺序**,连同它所基于的那一份已持久化列表。
   *
   * `draft === null` = 不在重排中,直接用 `settings.rules`。
   *
   * ⚠️ 这里刻意**不用 `useEffect` 去清草稿**:那会在「新 settings 到达」与
   * 「草稿被清掉」之间多出一帧,用户能看到顺序闪回一下。
   * 改为在 render 时比对 `basedOn` —— 存储换了一份新的 `rules` 引用,
   * 草稿**当场**失效(INV-4:真相在存储)。无额外渲染、无中间帧。
   */
  const [draft, setDraft] = useState<{
    rules: readonly FilterRule[];
    basedOn: readonly FilterRule[];
  } | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const draftRules = draft && draft.basedOn === settings.rules ? draft.rules : null;
  const rules = draftRules ?? settings.rules;

  // ── 状态变体的判定(§5.4) ──────────────────────────────────────────────
  const isSkeleton = tabState === null;
  const masterOff = !settings.masterEnabled;
  const notInjectable = tabState !== null && !tabState.injectable;
  const isFull = settings.rules.length >= MAX_RULES;

  /**
   * 规则编辑类控件是否禁用。
   *
   * 🔴 **ADR-050 / §6.1 冲突第 7 条**:不可注入页面上**仅禁用规则编辑类控件**,
   * 全局主开关保持可用 —— 主开关是全局的,与当前页是什么无关,
   * 它是唯一的全局止血开关(ADR-027)。设计稿把主开关也禁用了,那是已记录的错误。
   */
  const rulesDisabled = isSkeleton || masterOff || notInjectable || locked;

  /**
   * 主开关是否禁用。
   *
   * 🔒 **锁定期间 ADR-050 不适用 —— ADR-051 优先,主开关一并锁死。**
   * (该交集的 UI 由 T6c 完成;T6a 这里先把判定写对,免得 T6c 要回头改 T6a。)
   */
  const masterDisabled = isSkeleton || locked;

  // ── 写入结果的统一处理(ADR-046) ───────────────────────────────────────
  const handleResult = useCallback(async (
    result: Promise<ActionResult> | ActionResult,
  ): Promise<ActionResult> => {
    const settled = await result;
    if (settled.ok) {
      setSaveError(null);
    } else {
      // locked 分类返回 null —— 锁定拒绝不弹红色报错条(T3 gate I1)。
      setSaveError(toSaveErrorBanner(settled.error));
    }
    return settled;
  }, []);

  const handleToggleMaster = useCallback(() => {
    void handleResult(onToggleMaster(!settings.masterEnabled));
  }, [handleResult, onToggleMaster, settings.masterEnabled]);

  const handleDelete = useCallback(
    (index: number) => {
      void handleResult(onDeleteRule(index));
    },
    [handleResult, onDeleteRule],
  );

  /** 重排落盘(ADR-008:拖拽重排后顺序立即生效并持久化)。 */
  const commitOrder = useCallback(
    (next: readonly FilterRule[]) => {
      setDraft({ rules: next, basedOn: settings.rules });
      void handleResult(onReorderRules(next)).then((settled) => {
        // 写入失败则回滚到存储中的顺序 —— 绝不让 UI 显示一个没存上的顺序。
        if (!settled.ok) setDraft(null);
      });
    },
    [handleResult, onReorderRules, settings.rules],
  );

  const move = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      const next = [...rules];
      const [moved] = next.splice(from, 1);
      if (!moved) return;
      next.splice(to, 0, moved);
      commitOrder(next);
    },
    [commitOrder, rules],
  );

  // ── 拖拽(ADR-023) ────────────────────────────────────────────────────
  const dragFrom = useRef<number | null>(null);

  const handleDragStart = useCallback((index: number) => {
    dragFrom.current = index;
    setDraggingIndex(index);
  }, []);

  const handleDragOver = useCallback((index: number) => {
    setDropIndex(index);
  }, []);

  const handleDrop = useCallback(
    (index: number) => {
      const from = dragFrom.current;
      dragFrom.current = null;
      setDraggingIndex(null);
      setDropIndex(null);
      if (from === null) return;
      move(from, index);
    },
    [move],
  );

  const handleDragEnd = useCallback(() => {
    dragFrom.current = null;
    setDraggingIndex(null);
    setDropIndex(null);
  }, []);

  // ── 当前页状态(ADR-044:真相来源唯一,本视图不自己算匹配) ──────────────
  const shadowedSet = useMemo(
    () => new Set(tabState?.shadowedRuleIndexes ?? []),
    [tabState],
  );
  /**
   * 「生效」标记只在**滤镜真的生效时**显示:
   * 主开关 OFF(INV-8)或当前页不可注入(ADR-013)时,没有任何规则在生效。
   */
  const activeIndex =
    tabState !== null && tabState.injectable && settings.masterEnabled
      ? tabState.activeRuleIndex
      : null;

  const popupClass = [
    'popup',
    masterOff ? 'popup--dimmed' : '',
    isSkeleton ? 'popup--skeleton' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={popupClass}
      data-testid="popup"
      data-view="list"
      data-skeleton={isSkeleton ? 'true' : 'false'}
    >
      {/* ── 顶部:主开关,固定顶部(§5.3) ── */}
      <header className="popup__head">
        <div className="popup__brand">
          {/* §5.4 主开关 OFF:顶部图标变灰。 */}
          <span
            className={`popup__dot${masterOff ? ' popup__dot--off' : ''}`}
            data-testid="brand-dot"
            data-off={masterOff ? 'true' : 'false'}
            aria-hidden="true"
          />
          {BRAND_NAME}
        </div>
        <button
          type="button"
          className="switch"
          role="switch"
          aria-checked={settings.masterEnabled}
          aria-label={MASTER_SWITCH_LABEL}
          data-testid="master-switch"
          disabled={masterDisabled}
          onClick={handleToggleMaster}
        />
      </header>

      {/* T6c 的锁定条插槽(倒计时)。T6a 不构造其内容。 */}
      {lockBanner}

      {/*
        ── 提示条区 ──
        ADR-046 的红色报错条排在最前:它是**故障**,优先级高于一切状态说明。
        §5.4:「规则列表照常显示,用户仍可删除以腾出空间」——
        故报错条只是追加一条,不替换列表、也不禁用删除。
      */}
      {saveError && (
        <div className="notice notice--error" role="alert" data-testid="save-error">
          <span className="notice__icon" aria-hidden="true">
            ⚠
          </span>
          <span>
            {saveError.text}
            {saveError.advice}
          </span>
        </div>
      )}

      {/* §5.4 不可注入页(ADR-013):琥珀条 + 说明原因。 */}
      {notInjectable && (
        <div className="notice notice--warn" data-testid="not-injectable-notice">
          <span className="notice__icon" aria-hidden="true">
            ⚠
          </span>
          <span>{NOT_INJECTABLE_MESSAGE}</span>
        </div>
      )}

      {/*
        ── 顶部状态提示条(三选一)──
        优先级:主开关 OFF > 已满 > 常驻优先级提示条。
        理由:OFF 时「首个命中的规则生效」是误导(根本没有规则生效,INV-8);
        已满时用户需要的是「怎么才能继续加」。
        ADR-031 的「常驻」指的是**列表视图的默认状态**,在被更紧急的状态
        临时取代时不违背其意图 —— 设计稿的 OFF / 满 两张图正是这样处理的。
      */}
      {masterOff ? (
        <div className="notice notice--warn" data-testid="master-off-notice">
          <span>{MASTER_OFF_NOTICE}</span>
        </div>
      ) : isFull ? (
        <div className="notice notice--warn" data-testid="capacity-notice">
          <span>{CAPACITY_NOTICE}</span>
        </div>
      ) : (
        <div className="notice" data-testid="priority-hint">
          <span>
            {PRIORITY_HINT_PREFIX}
            <b>{PRIORITY_HINT_STRONG}</b>
          </span>
        </div>
      )}

      {/* ── 规则列表(可滚动) ── */}
      {rules.length === 0 ? (
        <div className="empty" data-testid="empty-state">
          <div className="empty__title">{EMPTY_TITLE}</div>
          <div className="empty__hint">{EMPTY_HINT}</div>
        </div>
      ) : (
        <ul className="rule-list" data-testid="rule-list">
          {rules.map((rule, index) => (
            <RuleRow
              key={`${index}:${rule.pattern}`}
              rule={rule}
              index={index}
              isActive={activeIndex === index}
              isShadowed={shadowedSet.has(index)}
              disabled={rulesDisabled}
              isDragging={draggingIndex === index}
              isDropTarget={dropIndex === index && draggingIndex !== index}
              onOpen={onOpenRule}
              onDelete={handleDelete}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              onMoveUp={(i) => move(i, i - 1)}
              onMoveDown={(i) => move(i, i + 1)}
              canMoveUp={index > 0}
              canMoveDown={index < rules.length - 1}
            />
          ))}
        </ul>
      )}

      {/*
        ── 底部:添加按钮 + 计数 ──
        ADR-024:**不提供「清空全部」** —— 危险且低频,逐条删除代价很小。
      */}
      <footer className="popup__foot">
        <button
          type="button"
          className="add-button"
          data-testid="add-rule"
          disabled={rulesDisabled || isFull}
          onClick={onAddRule}
        >
          {ADD_RULE_LABEL}
        </button>
        {/* §5.4 满:计数变琥珀加粗。§5.1:tabular-nums。 */}
        <span
          className={`rule-count${isFull ? ' rule-count--full' : ''}`}
          data-testid="rule-count"
          data-full={isFull ? 'true' : 'false'}
        >
          {settings.rules.length}/{MAX_RULES}
        </span>
      </footer>
    </div>
  );
}
