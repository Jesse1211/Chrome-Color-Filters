/**
 * 规则行(§5.3)。
 *
 * ```
 * │ ⠿ *.weibo.*       ▰ 灰阶 100%    ✕ │  拖柄·模式·色块+名称·强度·删除
 * ```
 *
 * 本组件承载三条 ADR 的硬性约束:
 *
 * 1. **ADR-023 / §6.1 冲突第 6 条** —— `⠿` 拖柄与「展开/删除」分离:
 *    **点击拖柄不得打开编辑视图**。设计稿的整行 `onclick` 覆盖了手柄,是已记录的错误。
 *    实现方式:行主体是一个独立的 `<button class="rule__open">`,
 *    手柄与 `✕` 是它的**兄弟**而非后代 —— 结构上就不可能冒泡到它。
 * 2. **ADR-032 / §6.1 冲突第 1、2 条** —— 被遮蔽行整行淡化 + 右侧小字
 *    **「此页未生效」**,**不得有删除线**(删除线会被误读为「作废」;
 *    「被遮蔽」读作规则属性,而它其实是页面局部状态)。
 * 3. **ADR-030** —— 色块必须与文字名称并列(由 `FilterSwatch` 强制)。
 *
 * ADR-009 负向约束:本行**没有** per-rule 开关 / 启用禁用控件 ——
 * 不要某条规则就删除它。
 */

import { type FilterRule } from '../../domain/filter-rule.js';
import { FilterSwatch } from './FilterSwatch.js';

/** §5.3 / §6.1 冲突第 2 条:标签文案是「此页未生效」,不是「被遮蔽」。 */
export const SHADOWED_LABEL = '此页未生效';

/** §5.3:当前页有规则生效时,该行显示绿色「生效」标记。 */
export const LIVE_LABEL = '生效';

export interface RuleRowProps {
  readonly rule: FilterRule;
  readonly index: number;
  /** 本行是否正在当前页生效(TabState.activeRuleIndex,ADR-044)。 */
  readonly isActive: boolean;
  /** 本行是否命中了当前页但被更靠前的规则遮蔽(ADR-032)。 */
  readonly isShadowed: boolean;
  /** 规则编辑类控件是否禁用(主开关 OFF / 不可注入页 / 骨架态)。 */
  readonly disabled: boolean;
  /** 正在被拖拽。 */
  readonly isDragging: boolean;
  /** 拖拽悬停的落点。 */
  readonly isDropTarget: boolean;
  readonly onOpen: (index: number) => void;
  readonly onDelete: (index: number) => void;
  readonly onDragStart: (index: number) => void;
  readonly onDragOver: (index: number) => void;
  readonly onDrop: (index: number) => void;
  readonly onDragEnd: () => void;
  /** 键盘重排 —— 拖拽对键盘用户不可达,必须另有途径(§5.7 可访问性)。 */
  readonly onMoveUp: (index: number) => void;
  readonly onMoveDown: (index: number) => void;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
}

export function RuleRow({
  rule,
  index,
  isActive,
  isShadowed,
  disabled,
  isDragging,
  isDropTarget,
  onOpen,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: RuleRowProps) {
  const className = [
    'rule',
    isShadowed ? 'rule--shadowed' : '',
    isDragging ? 'rule--dragging' : '',
    isDropTarget ? 'rule--drop-target' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li
      className={className}
      data-testid={`rule-row-${String(index)}`}
      data-index={index}
      data-shadowed={isShadowed ? 'true' : 'false'}
      data-active={isActive ? 'true' : 'false'}
      // 落点处理放在 li 上:拖到哪一行就插到哪一行(ADR-008 顺序即优先级)。
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        onDragOver(index);
      }}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        onDrop(index);
      }}
    >
      {/*
        🔴 ADR-023:拖柄是 `.rule__open` 的**兄弟节点**,不是它的后代 ——
        点击手柄在结构上就无法冒泡到「打开编辑视图」。
        它本身是 <button> 以便键盘可达,并提供 ↑/↓ 重排(拖拽对键盘不可达)。
      */}
      <button
        type="button"
        className="rule__grip"
        data-testid={`rule-grip-${String(index)}`}
        aria-label={`拖拽重排第 ${String(index + 1)} 条规则 ${rule.pattern};也可用方向键上下移动`}
        disabled={disabled}
        draggable={!disabled}
        onDragStart={() => onDragStart(index)}
        onDragEnd={onDragEnd}
        onClick={(event) => {
          // 手柄不是「打开」入口。显式吞掉点击,行为与 ADR-023 对齐。
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === 'ArrowUp' && canMoveUp) {
            event.preventDefault();
            onMoveUp(index);
          } else if (event.key === 'ArrowDown' && canMoveDown) {
            event.preventDefault();
            onMoveDown(index);
          }
        }}
      >
        ⠿
      </button>

      {/* 行主体 = 进入编辑视图(§5.3:点整行 → 进编辑视图)。 */}
      <button
        type="button"
        className="rule__open"
        data-testid={`rule-open-${String(index)}`}
        disabled={disabled}
        onClick={() => onOpen(index)}
      >
        {/* ADR-033:网址模式一律用等宽字体渲染。 */}
        <span className="rule__pattern" data-testid={`rule-pattern-${String(index)}`}>
          {rule.pattern}
        </span>

        <span className="rule__meta">
          {isActive && (
            <span className="badge badge--live" data-testid={`rule-live-${String(index)}`}>
              {LIVE_LABEL}
            </span>
          )}
          {isShadowed && (
            <span className="badge" data-testid={`rule-shadowed-${String(index)}`}>
              {SHADOWED_LABEL}
            </span>
          )}
          {/* ADR-030:色块 + 名称,不可拆。 */}
          <FilterSwatch mode={rule.mode} />
          {/* §5.1:百分比用 tabular-nums。 */}
          <span className="rule__intensity">{rule.intensity}%</span>
        </span>
      </button>

      {/* §5.3:点 ✕ → 直接删除(不二次确认,OQ-09)。 */}
      <button
        type="button"
        className="rule__delete"
        data-testid={`rule-delete-${String(index)}`}
        aria-label={`删除规则 ${rule.pattern}`}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onDelete(index);
        }}
      >
        ✕
      </button>
    </li>
  );
}
