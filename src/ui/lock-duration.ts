/**
 * 锁定**时长**的输入模型(ADR-058 / ADR-054)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **界面绝不接受裸时间戳。**
 *
 * > ADR-058:锁定时长**不设任何上限**;但 UI **只提供预设按钮 + 带单位的
 * > 自定义输入(数字 + 分/时/天)**,**不接受裸时间戳**。
 * > 带单位的输入让「秒/毫秒弄错」在界面层不可能发生,同时完全保留任意时长的能力。
 *
 * 本模块是这条 ADR 的**结构性**落点:对外导出的唯一入参形状是
 * `{ amount: number; unit: LockUnit }` —— 一个「数字 + 单位」的二元组。
 * 调用方**无法**把一个 epoch 毫秒数喂进来当时长:
 * 没有任何接受单一数字的转换函数,`lockUntil` 只能由
 * `lockUntilFrom(now, duration)` 算出,而它必须同时拿到 `now` 与**带单位的**时长。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 纯 TypeScript —— 零 React、零 chrome.*,可直接单测。
 * (放在 `src/ui` 而非 `src/domain`:这是**输入控件的模型**,
 * 不是领域不变式。领域侧的锁定判定是 `isLocked` / `canSetLockUntil`,ADR-036 的
 * 纯度检查覆盖 `src/domain`,本文件不属于那一层。)
 */

/** 自定义输入的单位(ADR-058:**分 / 时 / 天**,只有这三个)。 */
export type LockUnit = 'minute' | 'hour' | 'day';

/** 带单位的时长 —— **UI 层表达锁定长度的唯一形状**(ADR-058)。 */
export interface LockDuration {
  readonly amount: number;
  readonly unit: LockUnit;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** 单位 → 毫秒。**刻意没有 `'second'` / `'millisecond'`** —— 见文件头。 */
const UNIT_MS: Readonly<Record<LockUnit, number>> = {
  minute: MS_PER_MINUTE,
  hour: MS_PER_HOUR,
  day: MS_PER_DAY,
};

/** 单位的中文名(ADR-047:首版仅中文)。下拉选项逐字用它。 */
export const UNIT_LABELS: Readonly<Record<LockUnit, string>> = {
  minute: '分钟',
  hour: '小时',
  day: '天',
};

/** 下拉框的选项顺序(分 → 时 → 天,与 ADR-058 的行文一致)。 */
export const LOCK_UNITS: readonly LockUnit[] = ['minute', 'hour', 'day'];

export function isLockUnit(value: unknown): value is LockUnit {
  return value === 'minute' || value === 'hour' || value === 'day';
}

/**
 * 预设时长按钮(ADR-058:「预设按钮 + 自定义输入」)。
 *
 * 预设同样以**带单位的时长**表达,而不是预先算好的毫秒常量 ——
 * 这样「预设」与「自定义」走的是同一条转换路径,不会出现两套单位换算。
 *
 * 具体档位 DESIGN.md 未规定(ADR-054 不设上限,§5.4 只说「仅有延长按钮可用」),
 * 这里取覆盖「一节课 / 半天 / 一天」的常用跨度。
 */
export const LOCK_PRESETS: readonly LockDuration[] = [
  { amount: 30, unit: 'minute' },
  { amount: 1, unit: 'hour' },
  { amount: 4, unit: 'hour' },
  { amount: 8, unit: 'hour' },
  { amount: 1, unit: 'day' },
];

/** 「30 分钟」「4 小时」「1 天」—— 预设按钮与确认框文案共用。 */
export function formatDuration(duration: LockDuration): string {
  return `${String(duration.amount)} ${UNIT_LABELS[duration.unit]}`;
}

/**
 * 时长是否可用于启动/延长锁定。
 *
 * **正数、有限、且不超过安全整数范围**。
 * 上限**不在这里**设(ADR-054:不设任何上限)—— 这里拒绝的只是
 * 「0 / 负数 / NaN / Infinity」这类**根本不是一个时长**的输入,
 * 以及会让 `lockUntil` 溢出成非有限数的值。
 */
export function isValidDuration(duration: LockDuration): boolean {
  const { amount, unit } = duration;
  if (!isLockUnit(unit)) return false;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return false;
  if (amount <= 0) return false;
  return amount * UNIT_MS[unit] <= Number.MAX_SAFE_INTEGER;
}

/** 时长 → 毫秒。非法时长返回 `null`(而不是抛,也不是悄悄当 0)。 */
export function durationToMs(duration: LockDuration): number | null {
  if (!isValidDuration(duration)) return null;
  return duration.amount * UNIT_MS[duration.unit];
}

/**
 * 由「当前时刻 + 带单位的时长」算出 `lockUntil` 的**绝对时间戳**(ADR-053)。
 *
 * 🔴 `now` 是**注入**参数 —— 调用方须传 `effectiveNow(Date.now(), maxSeenTime)`
 * 的结果(ADR-059 / INV-15),本函数内绝不调用 `Date.now()`,否则时间边界不可测。
 *
 * 🔴 这是 UI 能产出 `lockUntil` 的**唯一**函数。界面上没有任何
 * 「直接填一个时间戳」的路径 —— ADR-058 的界面层保证正落在这里。
 *
 * @returns 非法时长或非法 `now` 时返回 `null`。
 */
export function lockUntilFrom(
  now: number,
  duration: LockDuration,
): number | null {
  if (!Number.isFinite(now)) return null;
  const ms = durationToMs(duration);
  if (ms === null) return null;
  const until = now + ms;
  return Number.isFinite(until) ? until : null;
}
