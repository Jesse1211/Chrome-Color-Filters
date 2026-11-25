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
}

export function defaultSettings(): FilterSettings {
  return {
    version: SETTINGS_VERSION,
    masterEnabled: true,
    rules: [],
    lockUntil: null,
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

  return {
    version:
      typeof s.version === 'number' && Number.isFinite(s.version)
        ? s.version
        : base.version,
    masterEnabled:
      typeof s.masterEnabled === 'boolean' ? s.masterEnabled : base.masterEnabled,
    rules,
    lockUntil,
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

// ───────────────────────────── 锁定(ADR-051/052/053/071)─────────────────────────────

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
 * `now` 由调用方直接传入注入时钟 `clock()` 的结果(ADR-071:
 * 原 `effectiveNow` 单调下界已废止,系统时钟由用户自行负责)。
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
 * 纯函数,`now` 为注入参数(调用方直接传注入时钟 `clock()` 的结果,ADR-071)。
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

// ─────────────────────── 到期自动关闭(ADR-077)───────────────────────

/**
 * `needsExpiryAutoOff(settings, now)` —— 纯函数,判定**此刻是否该做一次
 * 到期自动关闭**(ADR-077:锁定到期时自动把 `masterEnabled` 置为 false)。
 *
 * 🔴 **`now` 是注入参数,函数内绝不调用 `Date.now()`** —— 与 `isLocked`
 * 同一理由:时间边界必须可测。
 *
 * ## 三个合取条件,缺一不可
 *
 * ```
 * needsExpiryAutoOff  ⟺  lockUntil 存在  ∧  锁已过期(!isLocked)  ∧  masterEnabled
 * ```
 *
 * 1. **`lockUntil !== null`** —— 没有锁过,就没有「到期」这件事。
 *    漏掉这条会让「从未用过锁定功能的用户」的主开关被关掉:
 *    `lockUntil: null` 时 `isLocked` 恒为 false,只看后两条就会**恒真**。
 *    这是本函数最容易写错的地方,故有专门的单测钉住。
 *
 * 2. **`!isLocked(settings, now)`** —— 🔴 **复用 `isLocked` 本身,
 *    而不是自己写 `now >= lockUntil`。** 两者口径必须逐字一致:
 *    `isLocked` 的边界是开区间(`now === lockUntil` 即**未锁定**,见其文档),
 *    若这里写成 `now > lockUntil`,边界那一毫秒就会出现
 *    「锁已解除、但自动关闭不触发」的缝 —— 而那一毫秒恰恰是
 *    仓储层会放行写入的时刻(见 `SettingsRepository.applyExpiryAutoOff`)。
 *
 * 3. **`masterEnabled === true`** —— 已经是 OFF 就无需再写。
 *    这条让整个操作**幂等**:补做一次、闹钟与 popup 同时触发一次,
 *    第二次都是 no-op,不会产生多余的 `storage.set`、
 *    也不会覆盖用户在到期之后手动开回去的滤镜(见下)。
 *
 * ## 🔴 为什么「幂等」在这里是正确性,不是优化
 *
 * ADR-077 的触发器有**三个**彼此独立的入口(闹钟、SW 启动补偿、popup 的
 * 到期回调),它们**会同时命中**。若本函数不看 `masterEnabled`,
 * 下面这个序列会把用户的操作吃掉:
 *
 * ```
 * t0   锁到期 → 自动关闭,masterEnabled = false        ✅ ADR-077
 * t1   用户手动把滤镜开回来,masterEnabled = true       ← 用户的意图
 * t2   SW 被别的事件唤醒 → 又看到「lockUntil 已过去」→ 再关一次  ❌
 * ```
 *
 * t2 那一次会**违反用户意图**,且 ADR-077 已接受的代价只是
 * 「每次锁定结束会关掉一次,下次得手动再开」——
 * 不是「到期之后永远开不起来」。看 `masterEnabled` 让 t2 成为 no-op:
 * 自动关闭对每一段锁定**最多发生一次**(到期后首次观察到时)。
 *
 * ⚠️ 代价(刻意接受):用户在到期后手动开回滤镜,`lockUntil` 仍留着那个
 * 过去的时间戳。这不造成任何行为差异 —— 过去的 `lockUntil` 对
 * `isLocked` / `canSetLockUntil` 都等同于「未锁定」(ADR-053),
 * 且下次启动锁定会把它覆盖掉。**刻意不清除它**:清除是一次额外写入,
 * 而 ADR-052 的单向语义下「写一个更小的 lockUntil」正是被禁的方向,
 * 为它开一个特例等于在 INV-12 上开洞(详见仓储层该方法的论证)。
 */
export function needsExpiryAutoOff(
  settings: FilterSettings,
  now: number,
): boolean {
  const { lockUntil } = settings;
  // 条件 1:从未锁过 → 没有「到期」可言(漏掉这条本函数会恒真)。
  if (lockUntil === null || !Number.isFinite(lockUntil)) return false;
  // 条件 2:必须**真的**已过期 —— 口径与 isLocked 逐字一致(含边界)。
  if (isLocked(settings, now)) return false;
  // 条件 3:幂等 —— 已经 OFF 就不再写(见上方「为什么幂等是正确性」)。
  return settings.masterEnabled;
}
