/**
 * `FilterSettings` —— 全局单例,唯一聚合根(§1)。
 *
 * 纯 TypeScript —— 零 React / 零 chrome.* / 零 wxt(ADR-036)。
 * 本文件只定义聚合与**纯**判定函数;真正的写入强制在仓储层(T3 / INV-14 / ADR-055)。
 */

import { type FilterRule, coerceRule } from './filter-rule.js';

/** ADR-011 / INV-7:规则数量硬上限。 */
export const MAX_RULES = 20;

/** ADR-041 / ADR-047:schema 版本字段,保留作为廉价保险。 */
export const SETTINGS_VERSION = 1;

export interface FilterSettings {
  readonly version: number;
  /** 全局主开关(ADR-009 / INV-8)。OFF 时扩展完全不工作,规则全部保留。 */
  readonly masterEnabled: boolean;
  /** **有序列表**,最多 20 条。顺序即优先级(ADR-008 / INV-6 / INV-7)。 */
  readonly rules: readonly FilterRule[];
  /** 锁定到期的**绝对时间戳**(epoch ms)。null 或已过期 = 未锁定(ADR-053)。 */
  readonly lockUntil: number | null;
  /** 已观测到的最大时间戳,用于时钟倒退防范(ADR-059 / INV-15)。 */
  readonly maxSeenTime: number;
}

export function defaultSettings(): FilterSettings {
  return {
    version: SETTINGS_VERSION,
    masterEnabled: true,
    rules: [],
    lockUntil: null,
    maxSeenTime: 0,
  };
}

/**
 * 把任意输入收敛为合法 FilterSettings。
 * ADR-041:读到未知/损坏/缺字段数据时**回退默认值且不抛异常**。
 * 超过 MAX_RULES 的部分被截断,以恒成立地维持 INV-7。
 */
export function coerceSettings(value: unknown): FilterSettings {
  const base = defaultSettings();
  if (typeof value !== 'object' || value === null) return base;
  const s = value as Record<string, unknown>;

  const rules: FilterRule[] = [];
  if (Array.isArray(s.rules)) {
    for (const raw of s.rules) {
      if (rules.length >= MAX_RULES) break; // INV-7
      const rule = coerceRule(raw);
      if (rule) rules.push(rule);
    }
  }

  const lockUntil =
    typeof s.lockUntil === 'number' && Number.isFinite(s.lockUntil)
      ? s.lockUntil
      : null;

  const maxSeenTime =
    typeof s.maxSeenTime === 'number' && Number.isFinite(s.maxSeenTime)
      ? s.maxSeenTime
      : base.maxSeenTime;

  return {
    version:
      typeof s.version === 'number' && Number.isFinite(s.version)
        ? s.version
        : base.version,
    masterEnabled:
      typeof s.masterEnabled === 'boolean' ? s.masterEnabled : base.masterEnabled,
    rules,
    lockUntil,
    maxSeenTime,
  };
}

/** INV-7:容量硬上限,`rules.length <= 20` 恒成立。 */
export function isAtRuleCapacity(settings: FilterSettings): boolean {
  return settings.rules.length >= MAX_RULES;
}

export type AddRuleResult =
  | { readonly ok: true; readonly settings: FilterSettings }
  | { readonly ok: false; readonly error: 'capacity-exceeded' };

/**
 * 追加一条规则。达到上限时**拒绝并提示**,绝不静默淘汰(ADR-012 / INV-7)。
 * 纯函数:返回新对象,不改原对象。
 *
 * 注意:本函数**不做锁定检查** —— 锁定强制点在仓储层(INV-14 / ADR-055)。
 * 领域层提供 `isLocked` 判定,由 T3 在每个写入方法前调用。
 */
export function addRule(
  settings: FilterSettings,
  rule: FilterRule,
): AddRuleResult {
  if (isAtRuleCapacity(settings)) {
    return { ok: false, error: 'capacity-exceeded' };
  }
  return {
    ok: true,
    settings: { ...settings, rules: [...settings.rules, rule] },
  };
}

// ───────────────────────────── 锁定(ADR-051/052/053/059)─────────────────────────────

/**
 * `effectiveNow(rawNow, maxSeenTime)` —— 返回 `max(rawNow, maxSeenTime)`(ADR-059 / INV-15)。
 *
 * **所有锁定判定都必须用它,而非裸 `Date.now()`。**
 * 作用:系统时钟倒退时(夏令时、NTP 校时),单调下界保证锁定的
 * 有效剩余时长**不会增加**,也不会因倒退而被误判为未锁定。
 *
 * 注:时钟**调快**可绕过锁定,这是已记录的平台局限(§4.1),不在 INV-15 范围内。
 */
export function effectiveNow(rawNow: number, maxSeenTime: number): number {
  if (!Number.isFinite(rawNow)) return maxSeenTime;
  if (!Number.isFinite(maxSeenTime)) return rawNow;
  return rawNow > maxSeenTime ? rawNow : maxSeenTime;
}

/**
 * `isLocked(settings, now)` —— 纯函数,`now < lockUntil` 即锁定(ADR-051)。
 *
 * 🔴 **`now` 是注入参数,函数内绝不调用 `Date.now()`** —— 否则时间边界不可测。
 *
 * 边界语义(门禁明确要求):
 * - `lockUntil = null`      → 未锁定
 * - `now < lockUntil`       → **锁定**
 * - `now === lockUntil`     → **未锁定**(到期即解锁,边界取开区间)
 * - `now > lockUntil`       → 未锁定
 *
 * 调用方应先用 `effectiveNow(rawNow, settings.maxSeenTime)` 算出 `now`(INV-15)。
 */
export function isLocked(settings: FilterSettings, now: number): boolean {
  const { lockUntil } = settings;
  if (lockUntil === null || !Number.isFinite(lockUntil)) return false;
  return now < lockUntil;
}

export type LockWriteRejection =
  | 'not-a-timestamp'
  | 'in-the-past'
  | 'cannot-clear-while-locked'
  | 'cannot-shorten'
  | 'no-op';

export type CanSetLockUntilResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: LockWriteRejection };

/**
 * `canSetLockUntil(current, next, now)` —— 判定 `lockUntil` 的写入是否合法
 * (ADR-052 / INV-12:**加码可以,反悔不行**)。
 *
 * 纯函数,`now` 为注入参数(调用方应传 `effectiveNow(...)` 的结果)。
 *
 * 判定表(门禁逐条要求):
 * - 未锁定 → 任意**未来**时间戳:**允许**
 * - 锁定中 → `next > current`(延长):**允许**
 * - 锁定中 → `next < current`(缩短):**拒绝**
 * - 锁定中 → `next === current`:**拒绝**(无意义写入)
 * - 锁定中 → `null`(清除):**拒绝**
 * - 任何情况 → **过去**的时间戳:**拒绝**
 *
 * 「锁定中」的判据与 `isLocked` 完全一致(`now < current`),
 * 两者必须同口径,否则会出现「UI 说已解锁、写入仍被拒」的裂缝。
 */
export function canSetLockUntil(
  current: number | null,
  next: number | null,
  now: number,
): CanSetLockUntilResult {
  const locked =
    current !== null && Number.isFinite(current) && now < current;

  if (next === null) {
    // 锁定中不得清除(INV-12:没有任何途径提前结束)。
    // 未锁定时清除是无意义写入 —— 本就没有生效的锁。
    return locked
      ? { ok: false, reason: 'cannot-clear-while-locked' }
      : { ok: false, reason: 'no-op' };
  }

  if (typeof next !== 'number' || !Number.isFinite(next)) {
    return { ok: false, reason: 'not-a-timestamp' };
  }

  // 过去的时间戳一律拒绝 —— 写入即刻失效的锁没有意义,
  // 且在锁定中它等同于一次缩短(INV-12)。
  if (next <= now) {
    return { ok: false, reason: 'in-the-past' };
  }

  if (!locked) {
    // 未锁定 → 任意未来时间戳合法。
    return { ok: true };
  }

  const cur = current as number;
  if (next > cur) return { ok: true }; // 延长:允许
  if (next === cur) return { ok: false, reason: 'no-op' };
  return { ok: false, reason: 'cannot-shorten' };
}
