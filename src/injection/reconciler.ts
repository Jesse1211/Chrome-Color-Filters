/**
 * `Reconciler` —— `reconcile()` 的四个触发点与并发串行化(ADR-062/064/065)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 四个触发点,全部必需(DESIGN.md §6 T4a)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * | 触发点 | 为什么必需 |
 * |--------|------------|
 * | `chrome.runtime.onInstalled` | 🔴 **强制项(ADR-065)**。扩展更新会**清除**动态注册,漏了会导致每次更新后滤镜静默失效 |
 * | `chrome.runtime.onStartup` | 廉价的双重保险。持久化正常时是 no-op(diff 判定全部未变) |
 * | 规则增删改 | 注册的**主**写入时机 —— 此刻 SW 必然活着(用户正看着 popup),延迟免费(ADR-062 的核心) |
 * | `chrome.storage.onChanged` | 安全网。覆盖「别的窗口改了设置」与「规则变更的通知路径出了岔子」 |
 *
 * 📌 后两者在正常路径上**重叠**:popup 写入 → 仓储层落盘 → `storage.onChanged`
 * 触发 → reconcile。保留两条是 DESIGN.md 的明文要求,而重叠是无害的 ——
 * 因为 reconcile 幂等,第二次是 no-op(这正是幂等性的用途,不是冗余)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 🔴 为什么需要串行化,而幂等**不足以**替代它
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ADR-064 要求 `reconcile()` 幂等,「因为有四个触发点,**可能并发**」。
 * 幂等保证的是「**顺序**执行两次 = 执行一次」。但两次**交错**执行是另一回事:
 *
 * ```
 * A: getRegistered() → 读到 []        B: getRegistered() → 读到 []
 * A: register([gray-100])             B: register([gray-100])   ← 同一个 id 注册两次
 * ```
 *
 * Chrome 对重复 id 的 `registerContentScripts` 会**抛错**(`Duplicate script ID`),
 * 而抛错会让**整批**注册失败 —— 连带本来没问题的那些也装不上。
 * 于是一次并发就能让滤镜整体失效,而两个触发点同时到达
 * (如 `onInstalled` 之后紧跟一次 `storage.onChanged`)是极普通的时序。
 *
 * 故本类把所有触发点**串成一条队列**:同一时刻最多一个 reconcile 在跑。
 * 队列深度压到 1(见 `#pending`)—— 排队中再来请求只需合并,
 * 因为 reconcile 读的是**当时**的最新 settings,跑一次就够,
 * 攒十次也只会得到同一个结果。
 *
 * `forceRebuild` 在合并时是**粘滞**的:一旦有任何一个排队请求要求强制重建
 * (即 ADR-065 的更新恢复),合并后的那次执行必须保留该语义 ——
 * 把它合并掉会让扩展更新后的重建被一次普通的 storage 变更「吃掉」。
 */

import { type FilterSettings } from '../domain/index.js';
import {
  type ReconcileResult,
  type ScriptingPort,
  EMPTY_PLAN,
  reconcile,
} from './reconcile.js';

export interface ReconcilerDeps {
  readonly port: ScriptingPort;
  /** 读取权威设置。生产环境为 `SettingsRepository.read()`。 */
  readonly readSettings: () => Promise<FilterSettings>;
  /**
   * 诊断回调(可选)。注册失败时的**唯一**可观测出口 ——
   * reconcile 刻意不抛异常(见 `reconcile.ts`),若连日志都没有,
   * 「注册静默失败」就真的静默了。
   */
  readonly onResult?: (result: ReconcileResult, trigger: string) => void;
}

/** 触发来源 —— 只用于诊断,不影响行为(除 `installed` 走强制重建)。 */
export type ReconcileTrigger =
  | 'installed'
  | 'startup'
  | 'rules-changed'
  | 'storage-changed'
  | 'manual';

export class Reconciler {
  readonly #deps: ReconcilerDeps;

  /** 正在执行的那次 reconcile;null = 空闲。 */
  #running: Promise<ReconcileResult> | null = null;

  /** 排队中的请求(深度 1,见类注释)。 */
  #pending: { trigger: ReconcileTrigger; forceRebuild: boolean } | null = null;

  constructor(deps: ReconcilerDeps) {
    this.#deps = deps;
  }

  /**
   * 请求一次 reconcile。并发安全 —— 同一时刻最多一个在跑。
   *
   * 返回的 Promise 在**本次请求被满足之后**才 resolve(可能是它自己那次,
   * 也可能是它被合并进去的那次),故调用方 `await` 它就能确信
   * 「注册已反映我刚写的设置」。这对规则变更路径是必要的:
   * popup 写完设置立即关闭时,SW 仍需把注册落完
   * (与 T6a/T6c 的「拆除前 flush」同一类问题)。
   */
  request(trigger: ReconcileTrigger = 'manual'): Promise<ReconcileResult> {
    // 🔴 ADR-065:扩展更新后磁盘注册已被 Chrome 清除,必须强制重建,
    //    不能按 diff 走(diff 会误判「都没变」而什么都不做)。
    const forceRebuild = trigger === 'installed';

    if (this.#running !== null) {
      // 合并进排队请求。forceRebuild 粘滞(见类注释)。
      this.#pending = {
        trigger,
        forceRebuild: (this.#pending?.forceRebuild ?? false) || forceRebuild,
      };
      return this.#running.then(() => this.#drain());
    }

    return this.#start(trigger, forceRebuild);
  }

  /** 当前是否有 reconcile 在跑或在排队(测试与诊断用)。 */
  get busy(): boolean {
    return this.#running !== null || this.#pending !== null;
  }

  /** 等到队列彻底排空。`popup` 拆除前 / 测试收尾用。 */
  async settled(): Promise<void> {
    while (this.#running !== null) {
      await this.#running;
      // 循环而非一次 await:被 await 的那次跑完后,
      // 排队请求可能已经启动了新的一次。
    }
  }

  #start(
    trigger: ReconcileTrigger,
    forceRebuild: boolean,
  ): Promise<ReconcileResult> {
    const run = (async (): Promise<ReconcileResult> => {
      let result: ReconcileResult;
      try {
        const settings = await this.#deps.readSettings();
        result = await reconcile(this.#deps.port, settings, { forceRebuild });
      } catch (error) {
        // 读设置失败:仓储层已有 ADR-041 的默认值回退,走到这里是极端情况。
        // 不抛 —— 见 `reconcile.ts` 对「不抛异常」的论证。
        result = {
          plan: EMPTY_PLAN,
          ok: false,
          errors: [`readSettings: ${String(error)}`],
        };
      }
      this.#deps.onResult?.(result, trigger);
      return result;
    })();

    this.#running = run;
    // 跑完后清空 #running,并把排队请求接上。
    void run.then(
      () => {
        if (this.#running === run) this.#running = null;
      },
      () => {
        if (this.#running === run) this.#running = null;
      },
    );
    return run.then(() => this.#drain());
  }

  /** 把排队请求(若有)启动起来;没有则返回刚跑完那次的结果。 */
  #drain(): Promise<ReconcileResult> {
    const pending = this.#pending;
    if (pending === null) {
      // 已跑完,且无排队 —— 返回一个 no-op 结果而不是再跑一次。
      return Promise.resolve({
        plan: EMPTY_PLAN,
        ok: true,
        errors: [],
      });
    }
    this.#pending = null;
    if (this.#running !== null) {
      // 另一个调用方已经把它启动了 —— 跟着那次走。
      return this.#running;
    }
    return this.#start(pending.trigger, pending.forceRebuild);
  }
}
