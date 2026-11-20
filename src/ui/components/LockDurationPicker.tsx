/**
 * 时长选择器(ADR-058)—— **预设按钮 + 自定义输入(数字 + 单位下拉:分/时/天)**。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **界面绝不接受裸时间戳**(ADR-058)。
 *
 * 本组件对外抛出的值是 `LockDuration`(`{amount, unit}`),**不是毫秒、
 * 更不是 epoch 时间戳**。数字输入框与单位下拉是两个分离的控件,
 * 用户在界面上**无法**输入一个「1762000000000」并让它被解释成时长:
 * 那个数字必须配一个「分钟/小时/天」的单位才能变成时长,
 * 于是「秒 / 毫秒弄错」在界面层不可能发生。
 *
 * 真正的时间戳只在 `lockUntilFrom(now, duration)` 里出现一次,
 * 且那是**计算结果**,不是输入(见 `lock-duration.ts`)。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 本组件**只管取值**,不写任何存储 —— 启动前还要过 ADR-056 的二次确认。
 * 复用于两处:未锁定时的「启动锁定」与锁定中的「延长」(两者都是 ADR-058 的约束对象)。
 *
 * ADR-043:所有可聚焦元素的 focus 态由 `tokens.css` 的全局规则统一提供。
 */

import {
  type LockDuration,
  type LockUnit,
  LOCK_PRESETS,
  LOCK_UNITS,
  UNIT_LABELS,
  formatDuration,
  isLockUnit,
  isValidDuration,
} from '../lock-duration.js';

export interface LockDurationPickerProps {
  readonly value: LockDuration;
  readonly onChange: (next: LockDuration) => void;
  /** 是否渲染预设按钮行。延长区空间紧张,只给自定义输入。 */
  readonly showPresets?: boolean;
  readonly disabled?: boolean;
  /** `data-testid` 前缀 —— 启动区与延长区同时在场时需要区分。 */
  readonly idPrefix: string;
  readonly amountLabel: string;
  readonly unitLabel: string;
  readonly presetLabel?: string;
}

export function LockDurationPicker({
  value,
  onChange,
  showPresets = true,
  disabled = false,
  idPrefix,
  amountLabel,
  unitLabel,
  presetLabel,
}: LockDurationPickerProps) {
  const amountId = `${idPrefix}-amount`;
  const unitId = `${idPrefix}-unit`;

  return (
    <div className="lock-duration" data-testid={`${idPrefix}-duration`}>
      {showPresets && (
        <div className="lock-duration__presets">
          {presetLabel && (
            <span className="lock-duration__label" id={`${idPrefix}-preset-label`}>
              {presetLabel}
            </span>
          )}
          <div
            className="lock-duration__preset-row"
            role="group"
            aria-labelledby={presetLabel ? `${idPrefix}-preset-label` : undefined}
          >
            {LOCK_PRESETS.map((preset) => {
              const selected =
                preset.amount === value.amount && preset.unit === value.unit;
              return (
                <button
                  key={`${String(preset.amount)}${preset.unit}`}
                  type="button"
                  className={`lock-preset${selected ? ' lock-preset--selected' : ''}`}
                  data-testid={`${idPrefix}-preset-${String(preset.amount)}-${preset.unit}`}
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => {
                    onChange(preset);
                  }}
                >
                  {formatDuration(preset)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/*
        自定义输入:数字 + 单位下拉(ADR-058)。
        `type="number"` + `min=1` 让「0 或负数」在控件层就难以产生;
        真正的判定仍在 `isValidDuration`(用户可以粘贴任意文本)。
      */}
      <div className="lock-duration__custom">
        <label className="lock-duration__label" htmlFor={amountId}>
          {amountLabel}
        </label>
        <input
          id={amountId}
          className="lock-duration__amount"
          data-testid={`${idPrefix}-amount`}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={Number.isFinite(value.amount) ? String(value.amount) : ''}
          disabled={disabled}
          onChange={(event) => {
            const raw = event.target.value;
            // 空串不当 0 —— 那会让「正在清空重输」的一瞬变成一次非法时长。
            // 交给 NaN,由 isValidDuration 判非法并禁用提交按钮。
            const parsed = raw === '' ? Number.NaN : Number(raw);
            onChange({ ...value, amount: parsed });
          }}
        />
        <label className="visually-hidden" htmlFor={unitId}>
          {unitLabel}
        </label>
        <select
          id={unitId}
          className="lock-duration__unit"
          data-testid={`${idPrefix}-unit`}
          aria-label={unitLabel}
          value={value.unit}
          disabled={disabled}
          onChange={(event) => {
            const next: unknown = event.target.value;
            // 下拉只可能产出这三个值;守卫是为了类型收敛,不是为了容错。
            if (isLockUnit(next)) onChange({ ...value, unit: next });
          }}
        >
          {LOCK_UNITS.map((unit: LockUnit) => (
            <option key={unit} value={unit}>
              {UNIT_LABELS[unit]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** 供调用方复用的校验 —— 与提交按钮的 `disabled` 同一判据。 */
export { isValidDuration };
