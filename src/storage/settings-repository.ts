/**
 * `FilterSettings` 仓储层 —— 基于 `chrome.storage.local`(**ADR-010**,非 sync)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **锁定强制点在此(INV-14 / ADR-055)—— 这是整个锁定功能的真正实现位置。**
 *
 * > ADR-055:锁定检查在**仓储层(T3)强制**,UI 置灰只是第二道防线。
 * > 仅靠 UI 置灰的锁是假锁 —— 任何绕过 UI 的写入路径都能破。真相守在数据层(INV-14)。
 *
 * 因此:**每一个写入方法**在执行前都必须过 `#assertWritable()`,
 * 锁定中则返回 `kind: 'locked'` 的结构化错误(ADR-046),而不是 throw 或静默丢弃。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 时钟(ADR-071)
 *
 * 仓储层接受一个**可注入的时钟**(默认 `Date.now`)。
 * 锁定判定**直接用 `clock()`**,不再包任何单调下界 ——
 * 原 `maxSeenTime` / `effectiveNow` 已由 **ADR-071 整条废止**:
 * 改系统时钟绕过锁定本就允许(§4.1),既然不防作弊,这条防范就没有存在理由。
 *
 * ## 🔴 读路径不写盘(ADR-071)
 *
 * `read()` / `isCurrentlyLocked()` **不产生任何 `storage.set`**。
 * 原 `maxSeenTime` 的读路径回写采用 read-modify-write 整体回写
 * (读出整个 settings、改一个字段、写回整个对象),期间若用户改了规则,
 * 那次改动会被旧快照覆盖 —— 实测用户规则被静默吃掉。
 * 废止该字段后读路径无需写盘,这条竞态**连带消失**。
 *
 * ## INV-11 回到单一语义(ADR-071)
 *
 * 锁定期间**一切不可变更**,唯一例外是 `lockUntil` 的延长(INV-12)。
 * 原「例外 b:`maxSeenTime` 单调推进」随 ADR-071 删除 —— 不再有任何豁免字段,
 * 故被拒绝的写入之后可以做**全字段深度相等**断言。
 *
 * ## 持久化形状(ADR-025 / ADR-041 / ADR-047)
 *
 * 存下来的对象**只含** `version` / `masterEnabled` / `rules[{pattern,mode,intensity}]` /
 * `lockUntil`。`ColorMatrix` 是派生值,**绝不持久化**(ADR-025)——
 * 持久化会产生可漂移的双份真相。读到未知/损坏/缺字段数据时回退默认值且不抛异常(ADR-041)。
 */
import {
  type FilterRule,
  type FilterSettings,
  MAX_RULES,
  canSetLockUntil,
  coerceRule,
  coerceSettings,
  isLocked,
  validateGlobPattern,
} from '../domain/index.js';
import {
  type WriteError,
  type WriteResult,
  capacityError,
  classifyStorageError,
  invalidInputError,
  lockedError,
  writeFail,
  writeOk,
} from './errors.js';
import {
  type StorageArea,
  type StorageChangeListener,
  STORAGE_AREA_NAME,
  chromeLocalStorageArea,
} from './storage-area.js';

/** `chrome.storage.local` 中承载整个聚合根的单一键。 */
export const SETTINGS_KEY = 'filterSettings';

/**
 * 持久化 JSON 的**完整键集**(ADR-025 gate)。
 *
 * > 存下来的对象只含 `version`、`masterEnabled`、`rules[...]`、`lockUntil`。
 * > **出现 `maxSeenTime` 即失败**(ADR-071 已废止该字段)。
 * > **出现任何 matrix / 系数 / 派生字段即失败** —— 纯函数 ≠ 不持久化。
 */
export const PERSISTED_SETTINGS_KEYS = [
  'version',
  'masterEnabled',
  'rules',
  'lockUntil',
] as const;

/** 持久化的单条规则的**完整键集**(ADR-025 / ADR-047 结构稳定性)。 */
export const PERSISTED_RULE_KEYS = ['pattern', 'mode', 'intensity'] as const;

/** 可注入的时钟。默认 `Date.now`(ADR-071:时钟必须可注入,否则时间边界不可测)。 */
export type Clock = () => number;

/**
 * 列表侧连续操作的防抖窗口下限。
 *
 * T3 gate:防抖窗口 **≥ 300ms**;模拟 100 次连续重排(间隔 10ms)→ 实际写入次数 ≤ 3。
 *
 * > **注(gate 的 F10 澄清)**:`chrome.storage.local` **无写入频率配额**
 * > (该限制只存在于 sync),防抖纯为性能与避免无谓 I/O。
 */
export const MIN_DEBOUNCE_MS = 300;

/**
 * 防抖的**封顶等待**(maxWait)。
 *
 * 真正的防抖会在每次新操作时重置窗口 —— 若用户连续拖拽始终不停手,
 * 落盘会被无限推迟。本上限保证「最晚 1 秒必落一次盘」:
 * 丢写远比多写一次糟糕。
 *
 * 1000ms 下,gate 的「100 次 × 间隔 10ms」场景(共约 1000ms)落盘 1–2 次,
 * 仍在「≤ 3 次」之内。
 */
export const MAX_DEBOUNCE_WAIT_MS = 1_000;

export interface SettingsRepositoryOptions {
  /** 存储端口。默认真实的 `chrome.storage.local`(ADR-010)。 */
  readonly area?: StorageArea;
  /** 可注入时钟,默认 `Date.now`(ADR-071 / T3 gate I3)。 */
  readonly clock?: Clock;
  /** 列表侧连续操作的防抖窗口,**不得小于 `MIN_DEBOUNCE_MS`**。 */
  readonly debounceMs?: number;
  /** 延迟调度器,便于测试注入假定时器。默认 `setTimeout`。 */
  readonly scheduler?: (fn: () => void, ms: number) => unknown;
}

/** `onChanged` 订阅回调 —— INV-4(多 tab 即时同步)的基础机制。 */
export type SettingsListener = (settings: FilterSettings) => void;

/** 取消订阅。 */
export type Unsubscribe = () => void;

/**
 * 把内存中的聚合根投影为**持久化形状**。
 *
 * 这是 ADR-025 的强制点:显式逐字段拷贝,**绝不 spread 整个对象** ——
 * spread 会把上游不小心挂上去的派生字段(如 matrix)一起写进存储。
 */
function toPersisted(settings: FilterSettings): Record<string, unknown> {
  return {
    version: settings.version,
    masterEnabled: settings.masterEnabled,
    rules: settings.rules.map((r) => ({
      pattern: r.pattern,
      mode: r.mode,
      intensity: r.intensity,
    })),
    lockUntil: settings.lockUntil,
  };
}

/** 锁定判定所需的上下文 —— 见 `readContext()`。 */
interface WriteContext {
  /** 当前已持久化的设置。 */
  readonly current: FilterSettings;
  /** 注入时钟 `clock()` 的返回值 —— 锁定判定直接用它(ADR-071)。 */
  readonly now: number;
  /** 该时刻是否处于锁定中。 */
  readonly locked: boolean;
}

export class SettingsRepository {
  readonly #area: StorageArea;
  readonly #clock: Clock;
  readonly #debounceMs: number;
  readonly #scheduler: (fn: () => void, ms: number) => unknown;
  readonly #listeners = new Set<SettingsListener>();

  #changeListener: StorageChangeListener | null = null;

  /**
   * 最近一次**已知的**持久化设置快照 —— 供 `setLockUntilImmediate` 在
   * **点击那一轮**同步算出判定、立刻发出 `storage.set`(见该方法的文件内说明)。
   *
   * `null` = 本实例还没读过存储 → 无快照可用,只能退回「先读后写」。
   *
   * 由三处保持新鲜:每次 `#readContext()`、每次成功的 `#persist()`、
   * 以及 `subscribe()` 装的 `onChanged` 监听(别的窗口改了也跟着更新)。
   *
   * ⚠️ 这是**缓存,不是真相**。它唯一的用途是消除锁定写入路径上那次
   * 被 await 的读;陈旧时的安全性由 `setLockUntilImmediate` 的
   * **单调 max 合并 + 写后对账**保证,而不是靠这个快照准确。
   */
  #cachedSettings: FilterSettings | null = null;

  /**
   * 防抖中的待写入规则列表(列表侧连续操作)。
   *
   * 只缓存 `rules` —— 落盘时 `replaceRules` 会重新读取当前设置,
   * 故 `masterEnabled` / `lockUntil` 取的始终是最新值,
   * 不会被一个陈旧的快照覆盖。
   */
  #pending: {
    rules: FilterRule[];
    resolvers: ((r: WriteResult<FilterSettings>) => void)[];
    /** 本批次第一次入队的时刻,用于 `MAX_DEBOUNCE_WAIT_MS` 封顶。 */
    firstQueuedAt: number;
    /** 调度代数 —— 每次重置窗口自增,使此前排过的那一枪作废。 */
    generation: number;
  } | null = null;

  constructor(options: SettingsRepositoryOptions = {}) {
    this.#area = options.area ?? chromeLocalStorageArea();
    this.#clock = options.clock ?? Date.now;
    this.#scheduler =
      options.scheduler ?? ((fn, ms) => setTimeout(fn, ms));

    const requested = options.debounceMs ?? MIN_DEBOUNCE_MS;
    // 防抖窗口是 gate 的硬下限,不接受更小的值(T3 gate:≥ 300ms)。
    this.#debounceMs = Math.max(requested, MIN_DEBOUNCE_MS);
  }

  /** 实际生效的防抖窗口(恒 ≥ `MIN_DEBOUNCE_MS`)。 */
  get debounceMs(): number {
    return this.#debounceMs;
  }

  // ───────────────────────────── 读 ─────────────────────────────

  /**
   * 读取设置。
   *
   * - 存储为空 → 返回默认值 `{version, masterEnabled, rules: [], lockUntil: null}`,
   *   **不抛异常**(T3 gate)
   * - 垃圾数据 / 缺字段 / 更高 version → 回退默认值且**不抛异常**(ADR-041)
   * - 🔴 **不产生任何写入**(ADR-071)—— 读就只是读。原 `maxSeenTime` 的
   *   读路径回写已废止,连带消除了整体回写吃掉用户并发写入的竞态。
   *
   * 读路径**永不 throw** —— 底层存储失败也返回默认值。读失败时让扩展彻底不可用,
   * 比回退到「无规则」要糟得多(ADR-041 的同一理由:关掉一个真实崩溃路径)。
   */
  async read(): Promise<FilterSettings> {
    const ctx = await this.#readContext();
    return ctx.current;
  }

  /** 读取当前设置并算出锁定判定上下文。**本方法不写盘**(ADR-071)。 */
  async #readContext(): Promise<WriteContext> {
    let raw: unknown;
    try {
      const got = await this.#area.get(SETTINGS_KEY);
      raw = got?.[SETTINGS_KEY];
    } catch {
      // ADR-041:读失败等同于「没有可用数据」,回退默认值,不抛异常。
      raw = undefined;
    }

    // coerceSettings 已实现 ADR-041 的全部回退语义(垃圾/缺字段/越界)。
    const stored = coerceSettings(raw);

    // ADR-071:锁定判定直接用注入的时钟,不再包单调下界。
    const now = this.#clock();
    const current: FilterSettings = stored;

    // 快照保持新鲜 —— 见 `#cachedSettings` 的说明。
    this.#cachedSettings = current;

    return { current, now, locked: isLocked(current, now) };
  }

  // ──────────────────────── 锁定强制(INV-14) ────────────────────────

  /**
   * 🔴 **锁定强制点**(INV-14 / ADR-055)。
   *
   * 每一个变更 `masterEnabled` 或 `rules` 的写入方法都必须先过这里。
   * `lockUntil` 的写入**不走这里** —— 它由 `canSetLockUntil` 单独判定
   * (ADR-052:延长允许,缩短/清除/相同值一律拒绝)。
   *
   * @returns 锁定中返回 `WriteError`;未锁定返回 `null`。
   */
  #assertWritable(
    ctx: WriteContext,
    reason: 'locked-master-enabled' | 'locked-rules',
    what: string,
  ): WriteError | null {
    if (!ctx.locked) return null;
    return lockedError(
      reason,
      `锁定中,${what}不可变更。锁定不可提前结束或缩短(ADR-051/ADR-052)。`,
    );
  }

  // ───────────────────────────── 写 ─────────────────────────────

  /**
   * 把设置落盘。**调用前必须已完成锁定检查** —— 本方法不做任何权限判定。
   *
   */
  async #persist(next: FilterSettings): Promise<WriteResult<FilterSettings>> {
    const settings: FilterSettings = next;

    try {
      await this.#area.set({ [SETTINGS_KEY]: toPersisted(settings) });
      this.#cachedSettings = settings;
    } catch (cause) {
      // ADR-046:返回结构化错误,**不得只 throw 或只 console.error**。
      return writeFail(classifyStorageError(cause));
    }
    return writeOk(settings);
  }

  /**
   * 写入被拒绝时的统一出口(ADR-071)。
   *
   * 🔴 **拒绝路径不写盘** —— 锁定期间一切不可变更,不再有任何豁免字段
   * (原 INV-11 例外 b 已随 ADR-071 删除)。故被拒绝的写入之后,
   * 磁盘上的设置**全字段**与之前深度相等。
   *
   * `ctx` 保留在签名里是为了与各写入方法的调用点保持一致的可读性。
   */
  #reject(_ctx: WriteContext, error: WriteError): WriteResult<FilterSettings> {
    return writeFail(error);
  }

  /**
   * 设置主开关(ADR-009 全局单例)。
   *
   * 🔒 **锁定中一律拒绝,包括关闭**(ADR-051)——
   * > 关闭滤镜也是一种设置变更,同样禁止。用户诉求是「防止自己忍不住把滤镜关掉」,
   * > 若主开关可关,整个功能形同虚设。
   */
  async setMasterEnabled(
    enabled: boolean,
  ): Promise<WriteResult<FilterSettings>> {
    const ctx = await this.#readContext();
    const denied = this.#assertWritable(ctx, 'locked-master-enabled', '主开关');
    if (denied) return this.#reject(ctx, denied);

    return this.#persist({ ...ctx.current, masterEnabled: enabled });
  }

  /**
   * 追加一条规则。
   *
   * - 🔒 锁定中拒绝(INV-11)
   * - 第 21 条被拒,返回明确错误而非静默截断(INV-7 / ADR-012)。
   *   **拒绝之后原有 20 条一字未动** —— ADR-012 的核心是「绝不静默淘汰」。
   */
  async addRule(rule: FilterRule): Promise<WriteResult<FilterSettings>> {
    const ctx = await this.#readContext();
    const denied = this.#assertWritable(ctx, 'locked-rules', '规则');
    if (denied) return this.#reject(ctx, denied);

    const normalized = coerceRule(rule);
    if (!normalized) {
      return this.#reject(
        ctx,
        invalidInputError('规则格式非法:网址模式不符合通配符语法或超过 253 字符。'),
      );
    }

    // INV-7:容量硬上限。先于任何修改判定 —— 绝不先加再截断。
    if (ctx.current.rules.length >= MAX_RULES) {
      return this.#reject(ctx, capacityError());
    }

    return this.#persist({
      ...ctx.current,
      rules: [...ctx.current.rules, normalized],
    });
  }

  /** 删除指定下标的规则。🔒 锁定中拒绝(INV-11)。 */
  async removeRule(index: number): Promise<WriteResult<FilterSettings>> {
    const ctx = await this.#readContext();
    const denied = this.#assertWritable(ctx, 'locked-rules', '规则');
    if (denied) return this.#reject(ctx, denied);

    if (!Number.isInteger(index) || index < 0 || index >= ctx.current.rules.length) {
      return this.#reject(ctx, invalidInputError(`规则下标越界:${String(index)}。`));
    }

    const rules = ctx.current.rules.filter((_, i) => i !== index);
    return this.#persist({ ...ctx.current, rules });
  }

  /** 修改指定下标的规则(模式 / 强度 / 网址,ADR-021)。🔒 锁定中拒绝(INV-11)。 */
  async updateRule(
    index: number,
    patch: Partial<FilterRule>,
  ): Promise<WriteResult<FilterSettings>> {
    const ctx = await this.#readContext();
    const denied = this.#assertWritable(ctx, 'locked-rules', '规则');
    if (denied) return this.#reject(ctx, denied);

    const existing = ctx.current.rules[index];
    if (!Number.isInteger(index) || !existing) {
      return this.#reject(ctx, invalidInputError(`规则下标越界:${String(index)}。`));
    }

    if (patch.pattern !== undefined) {
      const v = validateGlobPattern(patch.pattern);
      if (!v.ok) {
        return this.#reject(
          ctx,
          invalidInputError(`网址模式非法(${v.error}),未写入。`),
        );
      }
    }

    const merged = coerceRule({ ...existing, ...patch });
    if (!merged) {
      return this.#reject(ctx, invalidInputError('规则格式非法,未写入。'));
    }

    const rules = ctx.current.rules.map((r, i) => (i === index ? merged : r));
    return this.#persist({ ...ctx.current, rules });
  }

  /**
   * 整体替换规则列表(拖拽重排的落点,ADR-008)。
   *
   * **顺序即优先级**(INV-6)—— 本方法原样保留传入顺序,不排序、不去重。
   * 🔒 锁定中拒绝(INV-11:重排也是变更)。
   */
  async replaceRules(
    rules: readonly FilterRule[],
  ): Promise<WriteResult<FilterSettings>> {
    const ctx = await this.#readContext();
    const denied = this.#assertWritable(ctx, 'locked-rules', '规则');
    if (denied) return this.#reject(ctx, denied);

    const validated = this.#validateRuleList(rules);
    if (!validated.ok) return this.#reject(ctx, validated.error);

    return this.#persist({ ...ctx.current, rules: validated.value });
  }

  /**
   * 把下标 `from` 的规则移动到 `to`(拖拽重排,ADR-023)。
   * 🔒 锁定中拒绝(INV-11)。
   */
  async reorderRule(from: number, to: number): Promise<WriteResult<FilterSettings>> {
    const ctx = await this.#readContext();
    const denied = this.#assertWritable(ctx, 'locked-rules', '规则');
    if (denied) return this.#reject(ctx, denied);

    const rules = [...ctx.current.rules];
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to < 0 ||
      from >= rules.length ||
      to >= rules.length
    ) {
      return this.#reject(
        ctx,
        invalidInputError(`重排下标越界:${String(from)} → ${String(to)}。`),
      );
    }

    const [moved] = rules.splice(from, 1);
    if (moved) rules.splice(to, 0, moved);
    return this.#persist({ ...ctx.current, rules });
  }

  #validateRuleList(
    rules: readonly FilterRule[],
  ): { ok: true; value: FilterRule[] } | { ok: false; error: WriteError } {
    if (!Array.isArray(rules)) {
      return { ok: false, error: invalidInputError('规则列表必须是数组。') };
    }
    // INV-7:超过 20 条一律整体拒绝,**绝不截断**(ADR-012:绝不静默淘汰)。
    if (rules.length > MAX_RULES) {
      return { ok: false, error: capacityError() };
    }

    const out: FilterRule[] = [];
    for (const r of rules) {
      const normalized = coerceRule(r);
      if (!normalized) {
        return {
          ok: false,
          error: invalidInputError('规则列表中含非法规则,整批未写入。'),
        };
      }
      out.push(normalized);
    }
    return { ok: true, value: out };
  }

  // ───────────────────────── 锁定写入(ADR-052) ─────────────────────────

  /**
   * 写入 `lockUntil`。**本项目唯一能在锁定期内成功的用户写入。**
   *
   * 合法性由领域层纯函数 `canSetLockUntil(current, next, now)` 判定(ADR-052):
   * - 未锁定 → 任意**未来**时间戳:允许(启动锁定)
   * - 锁定中 → `next > current`(延长):允许 —— **加码可以,反悔不行**(INV-12)
   * - 锁定中 → `next < current`(缩短)/ `next === current` / `null`(清除):**拒绝**
   * - 任何情况 → 过去的时间戳:**拒绝**(否则等于一键解锁)
   *
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 🔴 **ADR-076 废止了 ADR-057:本方法不再碰 `masterEnabled`。**
   *
   * 原行为:从未锁定状态启动锁定时,原子地把 `masterEnabled` 置为 `true`,
   * 以免用户在主开关已关闭时启动锁定、把扩展永久冻结在「关闭」状态。
   *
   * ADR-076 从**源头**消除了那个场景 —— 主开关 OFF 时 UI 上的
   * 「🔒 时间锁定」入口是禁用的,用户启动不了锁定。于是:
   * - 「锁住关闭状态」这个危险状态不再可达,**不需要补救**;
   * - 本方法因此退回「只写它名字里那个字段」,职责单一。
   *
   * > ADR-076:原逻辑是「允许在关闭态启动锁定,但悄悄替用户把滤镜打开」
   * > —— 它要补救的是一个**本不该发生的操作**。
   *
   * ⚠️ 这不是把判定交给 UI(那会违反 INV-14 / ADR-055)——
   *    **锁定本身的全部强制(拒绝缩短/清除/过去值)一字未动,仍在本层。**
   *    删掉的只是一个**额外的副作用写入**,不是一道检查。
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   *
   * 判定用注入的 `clock()`(ADR-071)—— 系统时钟由用户自行负责,扩展不做防范。
   */
  async setLockUntil(next: number | null): Promise<WriteResult<FilterSettings>> {
    const ctx = await this.#readContext();
    const verdict = canSetLockUntil(ctx.current.lockUntil, next, ctx.now);

    if (!verdict.ok) {
      // 分类取决于**是不是锁在拒绝**(ADR-046 的 I1 澄清):
      // - 锁定中被拒(缩短 / 清除 / 相同值)→ `locked`,预期行为,不是故障,
      //   UI 不得弹红色「保存失败」条
      // - 未锁定时被拒(如传入 null 或过去的时间戳)→ 这是**入参问题**,
      //   与锁无关。若也报 `locked`,UI 会对着一个根本不存在的锁显示锁定文案。
      const error = ctx.locked
        ? lockedError('lock-write-rejected', lockRejectionMessage(verdict.reason))
        : invalidInputError(lockRejectionMessage(verdict.reason));
      return this.#reject(ctx, error);
    }

    // verdict.ok 蕴含 next 是有限的未来时间戳(canSetLockUntil 已拒绝 null / 过去值)。
    const lockUntil = next as number;

    /*
      🔴 ADR-076:**只写 `lockUntil`,`masterEnabled` 原样保留。**
         (原先这里有 ADR-057 的 `masterEnabled = ctx.locked ? … : true`。)
    */
    return this.#persist({ ...ctx.current, lockUntil });
  }

  /**
   * 🔴 **写入 `lockUntil`,且在调用的那一轮就发出 `storage.set`。**
   *
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * ## 为什么必须有这个方法(真实缺陷,与 ADR-061 同一类)
   *
   * `setLockUntil` 的第一行是 `await this.#readContext()` —— 一次
   * `storage.get` 往返。`chrome.storage.local` 是**跨进程 IPC**,那次 get
   * 最快也在**后续宏任务**才回话。而 Chrome 工具栏 popup **一失焦即销毁**:
   *
   *     用户点「确认锁定」/「延长」→ 发出 get → await
   *       → popup 失焦、文档被拆、JS 上下文消失
   *       → get 的回调永远回不来 → `storage.set` **从未发出**
   *       → 锁定静默丢失,而 UI 已经显示成功
   *
   * 这正是 ADR-061 记录的那一类缺陷(本仓已为其出过 6df1edf / 6d34545 两次
   * fixup),只是窗口从「300ms 客户端计时器」挪到了**仓储层内部那次被 await
   * 的读** —— 所以 ADR-061 的静态门禁(路径上不得有 `setTimeout`)看不见它。
   *
   * ⚠️ 修法**不是**「拆除前再补一次写」—— ADR-061 明文记载该路线**已被证伪**:
   * popup 销毁后,飞在半路的异步写回不到一个已经不存在的 JS 上下文。
   * 唯一可行的方向是**根本不等那次读**。
   *
   * ## 不等那次读,为什么仍然守得住 ADR-052 / INV-14
   *
   * 判定仍然在**仓储层**做(ADR-055:真相守在数据层),只是改用
   * `#cachedSettings` 这个已知快照同步地做,从而把 `set` 留在同一轮。
   * 快照可能**陈旧**,故安全性不靠它准确,而靠两道**结构性**保证:
   *
   * 1. **单调 max 合并。** 真正落盘的 `lockUntil` 恒为
   *    `max(快照里的值, 要写的值)`。ADR-052 的语义本就是单调的
   *    (「加码可以,反悔不行」),于是「快照偏小」这唯一危险方向被**构造性**
   *    地堵死:哪怕快照说「未锁定」而磁盘上其实锁着,合并后也只会得到
   *    **不小于**磁盘值的结果 —— 缩短在算术上不可能发生,不依赖任何检查顺序。
   * 2. **写后对账。** `set` 发出后(此时写已在飞,丢不了了)再读一次磁盘:
   *    若发现磁盘上的真实 `lockUntil` 比我们刚写的**更晚**,说明快照确实陈旧
   *    且我们刚刚写小了,立刻用磁盘值补写回去。这条路径只在并发写
   *    (多窗口)下才会走到,且补写方向永远是「变长」。
   *
   * 🔴 **ADR-076:本方法同样不再碰 `masterEnabled`**(ADR-057 已废止,
   * 理由见 `setLockUntil` 的说明)。上面两道结构性保证针对的是
   * `lockUntil` 的单调性,与主开关无关,**一条未动**。
   *
   * ADR-071:判定直接用注入的 `clock()`,不再包单调下界。
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  setLockUntilImmediate(next: number | null): Promise<WriteResult<FilterSettings>> {
    const cached = this.#cachedSettings;

    // 还没读过存储(popup 刚开、设置尚未到位)→ 没有快照可用。
    // 此时退回「先读后写」:正确性优先,且该状态下界面还在骨架态、
    // 用户根本点不到锁定按钮(见 LockTimerEntry 的 disabled={!loaded})。
    if (cached === null) return this.setLockUntil(next);

    const now = this.#clock();
    const current: FilterSettings = cached;
    const ctx: WriteContext = { current, now, locked: isLocked(current, now) };

    const verdict = canSetLockUntil(current.lockUntil, next, now);
    if (!verdict.ok) {
      // 分类口径与 `setLockUntil` 完全一致(ADR-046 的 I1 澄清):
      // 锁定中被拒 → `locked`(预期行为,UI 不得弹红色报错条);
      // 未锁定时被拒 → `invalid-input`(入参问题,与锁无关)。
      const error = ctx.locked
        ? lockedError('lock-write-rejected', lockRejectionMessage(verdict.reason))
        : invalidInputError(lockRejectionMessage(verdict.reason));
      // 拒绝路径**不写盘**(ADR-071),照旧走 `#reject`。
      return Promise.resolve(this.#reject(ctx, error));
    }

    const requested = next as number;

    // 🔴 保证 1:单调 max 合并 —— 缩短在算术上不可能发生(见上方说明)。
    const cachedLock = current.lockUntil;
    const lockUntil =
      cachedLock !== null && Number.isFinite(cachedLock) && cachedLock > requested
        ? cachedLock
        : requested;

    // 🔴 ADR-076:只写 `lockUntil`,主开关原样保留(ADR-057 已废止)。
    const settings: FilterSettings = { ...current, lockUntil };

    // 🔴 关键:**同步**发出 get + set —— 本方法到此为止没有出现过任何 await。
    // 即使 popup 在下一刻被拆掉,两个请求都已经交给浏览器进程了。
    //
    // ⚠️ 对账用的 get **必须在 set 之前发出**:存储按发出顺序处理请求,
    // 所以这个 get 看到的是**我们这次写入之前**的磁盘状态。
    // 若放到 set 之后再读,读回来的就是我们自己刚写进去的值 ——
    // 真实的旧值已经被覆盖掉了,对账在结构上不可能再发现「我写小了」。
    let probing: Promise<Record<string, unknown>>;
    let writing: Promise<void>;
    try {
      probing = this.#area.get(SETTINGS_KEY);
      writing = this.#area.set({ [SETTINGS_KEY]: toPersisted(settings) });
    } catch (cause) {
      // 同步抛出(如 chrome.storage 不可用)→ ADR-046 结构化错误。
      return Promise.resolve(writeFail(classifyStorageError(cause)));
    }

    this.#cachedSettings = settings;

    return this.#settleLockWrite(probing, writing, settings);
  }

  /**
   * `setLockUntilImmediate` 的收尾:等写入完成,然后**对账**(保证 2)。
   *
   * 两个请求都已经发出,到这里无论 popup 还活不活着都不影响落盘结果 ——
   * 这个 async 函数里的 await 因此是安全的(它只影响**返回值**,不影响落盘)。
   *
   * @param probing 在 `set` **之前**发出的那次读 —— 它看到的是写入前的磁盘状态。
   */
  async #settleLockWrite(
    probing: Promise<Record<string, unknown>>,
    writing: Promise<void>,
    written: FilterSettings,
  ): Promise<WriteResult<FilterSettings>> {
    try {
      await writing;
    } catch (cause) {
      return writeFail(classifyStorageError(cause));
    }

    // 🔴 保证 2:对账 —— 只在并发写(多窗口)下才会真正做事,
    // 且补写方向永远是「变长」,绝不缩短(ADR-052/INV-12)。
    try {
      const got = await probing;
      const disk = coerceSettings(got?.[SETTINGS_KEY]);
      const diskLock = disk.lockUntil;
      const mineLock = written.lockUntil;

      if (
        diskLock !== null &&
        Number.isFinite(diskLock) &&
        mineLock !== null &&
        diskLock > mineLock
      ) {
        // 写入前磁盘上的锁比我们刚写的更晚 → 快照当时确实陈旧,我们写小了。
        // 用磁盘值补回去(只变长)。其余字段用我们刚写的那一份
        // (ADR-076 之后它与 `current` 的差别只有 `lockUntil`)。
        return this.#persist({ ...written, lockUntil: diskLock });
      }
    } catch {
      /* 对账是加固,读不出来就算了 —— 主写入已经成功(ADR-041 同一理由) */
    }

    return writeOk(written);
  }

  /**
   * 当前是否处于锁定中(判定用注入的 `clock()`,ADR-071)。
   * 供 UI 置灰这第二道防线使用。
   *
   * 🔴 同 `read()`:这是一条**读路径,不产生任何写入**(ADR-071)。
   */
  async isCurrentlyLocked(): Promise<boolean> {
    const ctx = await this.#readContext();
    return ctx.locked;
  }

  // ───────────────── 列表侧连续操作的防抖(T3 gate F10) ─────────────────

  /**
   * 防抖版的整体规则列表写入 —— 供**列表侧的连续操作**使用
   * (如拖拽重排过程中连续触发的顺序变更)。
   *
   * > **⚠️ 适用范围(T3 gate 的 F10 澄清,与 ADR-049 对齐):**
   * > **编辑视图的强度滑块在拖动时不写存储** —— 它走 ADR-049 的 `PREVIEW_FILTER`
   * > 消息通道直推 content script,**不经存储、不受本防抖影响**,
   * > 仅在点「保存」时**单次写入**(走 `updateRule`,非本方法)。
   * > 防抖只适用于列表侧的连续操作。
   *
   * 合并语义:窗口内的多次调用只产生**一次** `storage.set`,写入的是**最后一次**的状态
   * (重排的中间态没有保留价值)。所有调用方都拿到同一个结果。
   *
   * 🔒 锁定检查在**真正落盘时**执行,不在排队时 —— 这样「锁定在防抖窗口内到期」
   * 这种边界也能正确放行,且锁定中的连续重排照样被拒。
   */
  reorderRulesDebounced(
    rules: readonly FilterRule[],
  ): Promise<WriteResult<FilterSettings>> {
    return new Promise((resolve) => {
      const snapshot = rules.map((r) => ({ ...r }));

      if (this.#pending) {
        // 合并:覆盖待写入列表,并**重置**防抖窗口(见下方 #arm 的说明)。
        this.#pending.rules = snapshot;
        this.#pending.resolvers.push(resolve);
        this.#arm();
        return;
      }

      this.#pending = {
        rules: snapshot,
        resolvers: [resolve],
        firstQueuedAt: this.#clock(),
        generation: 0,
      };
      this.#arm();
    });
  }

  /**
   * 排一次延迟落盘,并**作废此前排过的那一次**(靠 `generation` 计数,
   * 不依赖 `clearTimeout` —— 注入的 `scheduler` 未必返回可取消的句柄)。
   *
   * 这是**真正的防抖**:窗口在每次新调用时重置,故一串连续操作只在
   * 「停手 300ms 后」落盘一次。若改成「首次调用排一次、此后复用」,
   * 一段 1000ms 的连续拖拽会每 300ms 落盘一次(实测 4 次),超出门禁上限。
   *
   * **封顶(maxWait)**:连续操作若一直不停,`MAX_DEBOUNCE_WAIT_MS` 到点强制落盘一次,
   * 以免用户拖了很久却一直没存上 —— 丢写比多写一次糟得多。
   */
  #arm(): void {
    const pending = this.#pending;
    if (!pending) return;

    pending.generation += 1;
    const generation = pending.generation;

    const elapsed = this.#clock() - pending.firstQueuedAt;
    const wait = Math.min(
      this.#debounceMs,
      Math.max(0, MAX_DEBOUNCE_WAIT_MS - elapsed),
    );

    this.#scheduler(() => {
      // 过期的那一枪:期间又来了新的调用,窗口已重置,直接作废。
      if (this.#pending !== pending || pending.generation !== generation) return;
      void this.#flushPending();
    }, wait);
  }

  /** 立即落盘防抖队列中的待写入状态(供 popup 关闭前调用,避免丢写)。 */
  async flush(): Promise<void> {
    if (this.#pending) await this.#flushPending();
  }

  async #flushPending(): Promise<void> {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;

    const result = await this.replaceRules(pending.rules);
    for (const resolve of pending.resolvers) resolve(result);
  }

  // ──────────────────── onChanged 订阅(INV-4 的基础) ────────────────────

  /**
   * 订阅设置变更 —— **INV-4(多 tab 即时同步)的基础机制**。
   *
   * 只响应 `local` 区(ADR-010)下 `SETTINGS_KEY` 的变化;
   * 回调拿到的是已经过 `coerceSettings` 清洗的设置(ADR-041:垃圾数据不崩溃)。
   *
   * @returns 取消订阅函数。
   */
  subscribe(listener: SettingsListener): Unsubscribe {
    this.#listeners.add(listener);

    if (!this.#changeListener) {
      this.#changeListener = (changes, areaName) => {
        if (areaName !== STORAGE_AREA_NAME) return;
        const change = changes[SETTINGS_KEY];
        if (!change) return;

        const settings = coerceSettings(change.newValue);
        // 别的窗口改了存储 → 快照跟着更新(见 `#cachedSettings`)。
        this.#cachedSettings = settings;
        for (const l of this.#listeners) l(settings);
      };
      this.#area.addChangeListener(this.#changeListener);
    }

    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0 && this.#changeListener) {
        this.#area.removeChangeListener(this.#changeListener);
        this.#changeListener = null;
      }
    };
  }
}

/** 把领域层的拒绝原因翻译成中文文案(ADR-047:首版仅中文)。 */
function lockRejectionMessage(reason: string): string {
  switch (reason) {
    case 'cannot-clear-while-locked':
      return '锁定期间不可清除锁定。锁定一旦生效没有任何途径提前结束(ADR-052/INV-12)。';
    case 'cannot-shorten':
      return '锁定只能延长,不能缩短。加码可以,反悔不行(ADR-052/INV-12)。';
    case 'in-the-past':
      return '锁定到期时间必须晚于当前时间。';
    case 'no-op':
      return '锁定时间未发生变化,未写入。';
    case 'not-a-timestamp':
      return '锁定到期时间必须是一个合法的时间戳。';
    default:
      return '锁定写入被拒绝。';
  }
}

/** 便捷工厂:用真实 `chrome.storage.local`(ADR-010)与真实时钟构造仓储。 */
export function createSettingsRepository(
  options: SettingsRepositoryOptions = {},
): SettingsRepository {
  return new SettingsRepository(options);
}
