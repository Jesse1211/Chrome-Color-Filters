/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * `LockExpiryScheduler` —— ADR-077:**锁定到期时自动关闭主开关**的触发器。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 🔴 为什么本文件必须存在(ADR-077 原文)
 *
 * > 在此之前 `locked` 是**读时计算**(`now < lockUntil`),不需要任何定时器:
 * > 没人读就没人关心。自动关闭则必须在**到期那一刻**真的发生一次写入,
 * > 即使 popup 没开、SW 已休眠。
 *
 * 「读时计算」与「到期写入」是**本质不同**的两件事:前者没有触发器也成立,
 * 后者**没有触发器就不成立**。本类就是那个触发器。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 三个入口,**彼此独立且都必需**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * | 入口 | 覆盖的场景 | 漏了会怎样 |
 * |------|-----------|-----------|
 * | **闹钟**(`chrome.alarms`) | 浏览器开着、SW 可能已休眠 | 到期后滤镜一直开着,直到下次 SW 偶然被唤醒 |
 * | **SW 启动补偿**(`catchUp`) | 到期发生在浏览器**关闭期间** | 「锁定过夜 + 关机」→ 自动关闭**静默失效**(ADR-077 点名要求补偿) |
 * | **写入后重排**(`onSettingsChanged`) | 启动/延长锁定 ⇒ 要排一个新闹钟 | 锁定根本没有闹钟可响 |
 *
 * 🔴 **`setTimeout` 不在表里,这是刻意的。** MV3 的 SW 随时被回收
 * (空闲约 30 秒),一个 `setTimeout(…, 3600_000)` 会随 SW 一起消失 ——
 * 它**不是一个更简单的方案,而是一个不工作的方案**。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 🔴 闹钟会**迟到**,所以它不是 UI 正确性的承担者
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 平台文档(Chrome 官方,见 `docs/T7-gate/alarms-minimum-probe.cjs` 的引文)：
 *
 * > Chrome limits alarms to at most once every 30 seconds but **may delay them
 * > an arbitrary amount more**. … `when` can be set to less than 30 seconds
 * > after "now" without warning but **won't actually cause the alarm to fire
 * > for at least 30 seconds**.
 *
 * 即:**迟到量无上界**,且 `when` 有约 30 秒的事实下限。于是:
 *
 * - 本类**不**承诺「到期那一毫秒就写入」—— 平台做不到,承诺它就是谎。
 *   它承诺的是「到期后**终会**写入,且不需要用户做任何事」。
 * - popup 开着时的用户可见正确性**不依赖本类** —— 由
 *   `src/ui/useLockExpiry.ts` 独立承担(它用 popup 自己的每秒时钟,
 *   到期当秒就触发)。两者是**两条独立的防线**,不是一条链:
 *   popup 关着时闹钟兜底,popup 开着时 UI 时钟兜底,
 *   都失效时下次 SW 启动的 `catchUp` 兜底。
 *
 * ⚠️ **门禁比生产宽松,已知并记录:** 文档同一段写明
 * 「when you've loaded it unpacked, there's no limit to how often the alarm
 * can fire」—— 门禁加载的正是 unpacked 产物,故门禁里的闹钟**不受 30s 限流**。
 * 这意味着一个「只在门禁里绿」的设计可能在真实用户那里迟到 30 秒。
 * 本类因此**不把任何正确性押在闹钟的及时性上**(见上一段),
 * 实测数字见 `docs/T7-gate/out/alarms-minimum-probe.json`。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 为什么零 `chrome.*`
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 与 `coordinator.ts` / `reconcile.ts` 同一手法(ADR-062 建立的模式):
 * 平台能力经 `AlarmsPort` 注入,于是「到期后是否真的发出了那次写入」
 * 可在 Node 下**机械判定**,而不是只能「在真实 Chrome 里看一眼」。
 * 生产装配在 `alarms-port.ts`,真实栈断言仍在 T7 门禁里跑。
 *
 * 🔴 本类**绝不自己判断「是否该关」** —— 它只负责「在合适的时刻去问一次
 * 仓储层」。判定与写入都在 `SettingsRepository.applyExpiryAutoOff()`
 * (INV-14 / ADR-055:真相守在数据层)。本类若自己判,锁定强制就有了
 * 第二份真相,而第二份真相迟早会与第一份分歧。
 */

import { type FilterSettings } from '../domain/index.js';
import { type WriteResult } from '../storage/errors.js';

/** 到期闹钟的名字 —— 固定单例,同名 `create` 会**替换**旧闹钟(平台语义)。 */
export const LOCK_EXPIRY_ALARM = 'ccf-lock-expiry';

/** `chrome.alarms` 中本类用到的子集。 */
export interface AlarmsPort {
  /**
   * 建一个一次性闹钟。同名闹钟会被**替换**(平台语义:
   * 「If there is another alarm with the same name … it will be cancelled
   * and replaced by this alarm」)—— 延长锁定时正是靠这一点原地改期,
   * 不需要先 clear 再 create(那会留下一个两步之间没有闹钟的窗口)。
   */
  create(name: string, info: { readonly when: number }): Promise<void>;
  /** 清掉指定闹钟。不存在时不得抛。 */
  clear(name: string): Promise<void>;
  /** 订阅闹钟触发。@returns 取消订阅。 */
  onAlarm(listener: (name: string) => void): () => void;
}

export interface LockExpiryDeps {
  readonly alarms: AlarmsPort;
  /** 读取权威设置(= `chrome.storage.local`,真相来源)。 */
  readonly readSettings: () => Promise<FilterSettings>;
  /**
   * 🔴 执行到期自动关闭 —— **判定与写入都在仓储层**(ADR-077 / INV-14)。
   *
   * 生产环境是 `repo.applyExpiryAutoOff()`。本类只决定**何时调用**,
   * 绝不决定**是否该关**(见类注释最后一段)。
   */
  readonly applyAutoOff: () => Promise<
    WriteResult<{ readonly settings: FilterSettings; readonly applied: boolean }>
  >;
  /** 可注入时钟,默认 `Date.now`(与仓储层同一注入口径,ADR-071)。 */
  readonly clock?: () => number;
  /** 诊断回调(可选)—— 平台调用失败时唯一的可观测出口。 */
  readonly onError?: (where: string, error: unknown) => void;
  /** 自动关闭真的发生时的通知(可选),供诊断/测试观察。 */
  readonly onAutoOff?: (settings: FilterSettings) => void;
}

export class LockExpiryScheduler {
  readonly #deps: LockExpiryDeps;
  readonly #unsubscribes: (() => void)[] = [];
  #started = false;

  constructor(deps: LockExpiryDeps) {
    this.#deps = deps;
  }

  #now(): number {
    const clock = this.#deps.clock;
    return clock ? clock() : Date.now();
  }

  /**
   * 挂上闹钟监听。**幂等**(内部 `#started` 守卫)——
   * 与 `BackgroundCoordinator.start()` 同一理由:SW 入口在某些时序下可能被
   * 求值多次,装两套监听会让每次闹钟被处理两遍。
   *
   * 📌 本方法**只装监听,不做任何读/写** —— 排闹钟与补偿由
   * `catchUpAndReschedule()` 负责,调用点在 SW 入口(见 background.ts)。
   * 分开是为了让「装监听」这件无副作用的事可以独立测试。
   */
  start(): void {
    if (this.#started) return;
    this.#started = true;

    this.#unsubscribes.push(
      this.#deps.alarms.onAlarm((name) => {
        // 🔴 只认自己的闹钟 —— SW 里将来可能有别的闹钟,
        //    无条件响应会让本类对着一个不相干的事件去关用户的滤镜。
        if (name !== LOCK_EXPIRY_ALARM) return;
        void this.handleAlarm();
      }),
    );
  }

  /** 卸掉监听(测试与热重载用)。 */
  stop(): void {
    for (const off of this.#unsubscribes.splice(0)) {
      try {
        off();
      } catch (error) {
        this.#deps.onError?.('unsubscribe', error);
      }
    }
    this.#started = false;
  }

  /**
   * 🔴 **SW 启动时的补偿 + 重排闹钟**(ADR-077 的补偿语义)。
   *
   * > ADR-077:浏览器关闭期间闹钟不会触发。SW 下次启动时若发现 `lockUntil`
   * > 已过去且 `masterEnabled` 仍为 `true`,**必须补做这次关闭** ——
   * > 否则「关机过夜」会让自动关闭静默失效。
   *
   * 两件事的顺序是**先补偿再重排**,因为补偿可能改变状态
   * (关掉主开关),而重排要依据最新状态决定「还要不要闹钟」。
   *
   * 调用点必须覆盖 `onStartup` / `onInstalled` / SW 冷启动三处 ——
   * 闹钟**不可靠地**存活浏览器重启与扩展更新(ADR-077),
   * 而这个方法既补做漏掉的关闭、又把闹钟重新建起来。
   */
  async catchUpAndReschedule(): Promise<void> {
    await this.catchUp();
    await this.reschedule();
  }

  /**
   * 补做一次可能被错过的到期关闭。
   *
   * 🔴 **本方法不判断「该不该关」** —— 它无条件调一次
   * `applyAutoOff()`,由仓储层用自己的注入时钟现场判定并在不该关时 no-op
   * (`applied: false`)。这不是浪费:那是**一次读**,
   * 而把判定留在仓储层是 INV-14 的要求。
   */
  async catchUp(): Promise<boolean> {
    try {
      const result = await this.#deps.applyAutoOff();
      if (!result.ok) {
        /*
          锁定仍有效时仓储层会返回 `kind: 'locked'` —— 那是**预期行为**,
          不是故障(ADR-046 的 I1 澄清)。只有非 locked 的失败才值得记诊断,
          否则每次 SW 在锁定期内启动都会记一条假警报。
        */
        if (result.error.kind !== 'locked') {
          this.#deps.onError?.('catchUp', result.error);
        }
        return false;
      }
      if (result.value.applied) {
        this.#deps.onAutoOff?.(result.value.settings);
      }
      return result.value.applied;
    } catch (error) {
      this.#deps.onError?.('catchUp', error);
      return false;
    }
  }

  /**
   * 按当前设置重排闹钟。
   *
   * - `lockUntil` 在**未来** → 建/替换闹钟到那一刻;
   * - `lockUntil` 为 null 或**已过去** → 清掉闹钟(没有将来要响的事)。
   *
   * 🔴 清理那一支同样必需:不清的话,一个已经到期的锁会留下一个
   * 永远不会被重置的闹钟名,下次启动锁定时虽会被同名替换、但在那之前
   * `chrome.alarms` 里挂着一个过期闹钟 —— 它会在 SW 下次启动时立刻触发一次
   * (平台对过期闹钟的行为),而那一次触发会去调 `applyAutoOff` 并
   * no-op。无害,但那是**靠下游幂等兜住的无谓唤醒**,不如不排。
   */
  async reschedule(): Promise<void> {
    let settings: FilterSettings;
    try {
      settings = await this.#deps.readSettings();
    } catch (error) {
      this.#deps.onError?.('reschedule.read', error);
      return;
    }

    const lockUntil = settings.lockUntil;
    const future =
      lockUntil !== null && Number.isFinite(lockUntil) && lockUntil > this.#now();

    try {
      if (future) {
        /*
          同名 create 原地替换(见 `AlarmsPort.create` 的文档)——
          延长锁定时**不先 clear**:clear 与 create 之间有一个没有闹钟的窗口,
          若 SW 恰在此刻被回收,这段锁定就永久失去了它的闹钟,
          只能靠下次 SW 启动的 catchUp 兜底(迟到可能是几小时)。
        */
        await this.#deps.alarms.create(LOCK_EXPIRY_ALARM, {
          when: lockUntil as number,
        });
      } else {
        await this.#deps.alarms.clear(LOCK_EXPIRY_ALARM);
      }
    } catch (error) {
      // 平台调用失败**不抛** —— 在 SW 里会变成无人处理的 unhandled rejection
      // (与 `reconcile.ts` / `coordinator.ts` 同一论证)。
      // 代价是这段锁定可能失去闹钟,但 `catchUp` 仍会在下次 SW 启动时补做。
      this.#deps.onError?.('reschedule', error);
    }
  }

  /**
   * 闹钟响了。
   *
   * 🔴 **响了也要重排一次。** 原因有两个,都是真实情形:
   *
   * 1. **闹钟可能迟到**(平台明文,见类注释)。迟到期间用户可能**延长**了
   *    锁定 —— 此时 `applyAutoOff` 会正确地拒绝(仓储层判定锁仍有效),
   *    但那个新的、更晚的到期时刻**需要一个新闹钟**。
   *    不重排的话,延长出来的那段锁定就没有闹钟了。
   * 2. 关闭成功后 `lockUntil` 已是过去值 → `reschedule` 把闹钟清掉,
   *    不留一个永不重置的过期闹钟(见 `reschedule` 的论证)。
   */
  async handleAlarm(): Promise<void> {
    await this.catchUp();
    await this.reschedule();
  }

  /**
   * 设置变更后重排闹钟 —— 覆盖「启动锁定」与「延长锁定」。
   *
   * 🔴 **只重排,不补偿。** 这里刻意**不**调 `catchUp()`:
   * 本回调挂在仓储层的 `subscribe()` 上,而 `catchUp` 成功时会**产生一次写入**
   * → 再次触发 `subscribe` → 又一次 `catchUp`。虽然第二次因幂等
   * (`needsExpiryAutoOff` 看 `masterEnabled`)会 no-op 而终止,
   * 但那是**靠下游幂等兜住的自触发循环**,不该在这里埋下。
   *
   * 到期补偿有专门的入口(`catchUpAndReschedule`,挂在 SW 启动与闹钟上),
   * 职责不重叠。
   */
  async onSettingsChanged(): Promise<void> {
    await this.reschedule();
  }
}
