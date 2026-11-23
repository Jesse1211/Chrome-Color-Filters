/**
 * 四滤镜单选的一项(§5.5 / **ADR-002** / **ADR-030**)。
 *
 * ```
 * │ ◉ 灰阶   完全去除色彩      ▰  │
 * ```
 *
 * ## 本组件承载的约束
 *
 * - **ADR-002 / INV-2** 四个滤镜**互斥单选** —— 用原生 `<input type="radio">`
 *   且四项共享同一个 `name`:「选中新的取消旧的」由平台保证,
 *   不靠我们自己维护一个数组。多选在 DOM 层面就不可表达。
 * - **ADR-030** 色块**绝不单独承载语义**,必须与文字名称并列 ——
 *   名称与副标题都由 `filterIdentity` 取,与色块同一数据结构
 *   (见 `filter-identity.ts` 的说明)。
 * - **ADR-028** 负向:四项**只能**是 §5.2 表格里那四个,
 *   没有 Color Tint,也没有任何 Hue 控件。
 * - **ADR-043** focus 态由 `tokens.css` 的全局 `:focus-visible` 兜底,
 *   本组件不覆盖 `outline`。
 *
 * 📌 为什么不用设计稿的 `<label onclick>` + `<span class="radio">`:
 *    那个结构对键盘与屏幕阅读器不可达(没有 `role`、没有 `checked` 状态)。
 *    ADR-042 规定设计稿只对**视觉层**权威,交互语义以 ADR 为准 ——
 *    这里用原生 radio 并把 `.radio` 的视觉照搬到 `::before`,
 *    视觉一致而语义正确。
 */

import { type FilterMode } from '../../domain/filter-mode.js';
import { filterIdentity, swatchGradient } from '../filter-identity.js';

export interface FilterModeOptionProps {
  readonly mode: FilterMode;
  /** 四项共享的 radio group 名 —— 互斥由此保证(INV-2)。 */
  readonly name: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onSelect: (mode: FilterMode) => void;
}

export function FilterModeOption({
  mode,
  name,
  checked,
  disabled,
  onSelect,
}: FilterModeOptionProps) {
  const identity = filterIdentity(mode);
  const id = `filter-option-${mode}`;

  return (
    <label
      className={`option${checked ? ' option--on' : ''}`}
      htmlFor={id}
      data-testid={`filter-option-${mode}`}
      data-mode={mode}
      data-checked={checked ? 'true' : 'false'}
    >
      <input
        type="radio"
        className="option__radio"
        id={id}
        name={name}
        value={mode}
        checked={checked}
        disabled={disabled}
        data-testid={`filter-radio-${mode}`}
        onChange={() => onSelect(mode)}
      />
      <span className="option__text">
        {/* ADR-030:名称是色块的必备同伴,绝不可缺。 */}
        <span className="option__name" data-testid={`filter-name-${mode}`}>
          {identity.name}
        </span>
        <span className="option__desc">{identity.subtitle}</span>
      </span>
      {/*
        色块对辅助技术是装饰性的(语义由紧邻的名称承载,ADR-030),
        故 aria-hidden —— 与 `FilterSwatch` 的处理一致。
      */}
      <span
        className="option__swatch"
        data-testid={`filter-swatch-${mode}`}
        aria-hidden="true"
        style={{ background: swatchGradient(mode) }}
      />
    </label>
  );
}
