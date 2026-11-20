/**
 * `StorageArea` 的**异步** IPC 替身 —— 专为 ADR-061 的「销毁场景」回归测试而建。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **为什么必须有这个替身(上一轮的真实教训)。**
 *
 * `MemoryStorageArea` 的 `get`/`set` 返回**已 resolve 的 Promise** —— 回调在
 * **微任务**就跑完。而 `chrome.storage.local` 是**跨进程 IPC**:调用返回后
 * 要等浏览器进程回话,最快也落在**后续宏任务**。
 *
 * 这个差别正是上一轮「测试绿、真机红」的根因:上一轮的回归测试在 jsdom 里派发
 * `pagehide`,但**文档仍存活、事件循环仍在转、内存存储在微任务即 resolve**,
 * 于是「拆除时才补写」的方案在测试里总能跑完 —— 真机上 popup 销毁后那一串
 * 微任务/宏任务根本不会被执行,写入永远到不了存储。
 *
 * 本替身因此做两件 `MemoryStorageArea` 做不到的事:
 *
 * 1. **`get`/`set` 在后续宏任务才 resolve**(默认经 `setTimeout(…, 0)`),
 *    逼近真实 IPC 的时序。
 * 2. **可被「销毁」**(`destroy()`)—— 销毁后任务队列停止推进,
 *    所有**尚未发出**的调用永远不会 resolve、永远不会落盘。
 *    这就是「popup 文档被拆、JS 上下文消失」在测试里的等价物。
 *
 * 判定「是否已落盘」用 `snapshot()`:它读的是**已完成**的 set 的结果,
 * 不受挂起调用影响。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
import type {
  StorageArea,
  StorageChange,
  StorageChangeListener,
} from '../../storage/storage-area.js';
import { STORAGE_AREA_NAME } from '../../storage/storage-area.js';

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface AsyncStorageAreaOptions {
  /** IPC 往返的模拟延迟(ms)。0 = 下一个宏任务。 */
  readonly latencyMs?: number;
}

/**
 * 模拟 `chrome.storage.local` 的跨进程异步性,并可模拟 popup 文档被销毁。
 */
export class AsyncStorageArea implements StorageArea {
  #data: Record<string, unknown>;
  readonly #listeners = new Set<StorageChangeListener>();
  readonly #latencyMs: number;

  /** 文档是否已销毁。销毁后任务队列停止推进 —— 挂起的调用永不完成。 */
  #destroyed = false;

  /** 已完成的 `set` 次数(**不含**挂起中的)。 */
  setCallCount = 0;

  /** 已**发起**(未必完成)的 `set` 次数 —— 用于断言「有没有在同一轮发出写」。 */
  setInvocationCount = 0;

  /** 尚未 resolve 的调用数。 */
  #inflight = 0;

  constructor(
    initial: Record<string, unknown> = {},
    options: AsyncStorageAreaOptions = {},
  ) {
    this.#data = clone(initial);
    this.#latencyMs = options.latencyMs ?? 0;
  }

  /** 已落盘的数据(只反映**已完成**的 set)。 */
  snapshot(): Record<string, unknown> {
    return clone(this.#data);
  }

  get inflightCount(): number {
    return this.#inflight;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  /**
   * 销毁「popup 文档」—— 任务队列停止推进。
   *
   * 此后:
   * - 所有**挂起中**的 `get`/`set` 永远不会 resolve,也不会改变已落盘数据;
   * - 之后**新发起**的调用同样永远不会 resolve(JS 上下文已经没了)。
   *
   * 这是 Chrome 工具栏 popup 失焦即销毁的忠实模型:
   * 「拆除时再补一次异步写」在这里**物理上不可能**成功 —— 与 ADR-061 认定的
   * 「上一轮的关闭时 flush 已被证伪」一致。
   */
  destroy(): void {
    this.#destroyed = true;
  }

  #later<T>(produce: () => T): Promise<T> {
    this.#inflight += 1;
    return new Promise<T>((resolve) => {
      setTimeout(() => {
        this.#inflight -= 1;
        // 文档已销毁 → 这一轮宏任务在真机上根本不会被执行。
        if (this.#destroyed) return;
        resolve(produce());
      }, this.#latencyMs);
    });
  }

  get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    return this.#later(() => {
      if (keys === null) return clone(this.#data);
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) {
        if (k in this.#data) out[k] = clone(this.#data[k]);
      }
      return out;
    });
  }

  /**
   * 写入。
   *
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 🔴 **进程归属:数据由「浏览器进程」拥有,不由 popup 的渲染进程拥有。**
   *
   * `chrome.storage.local.set()` 做的事是**向浏览器进程发一条 IPC 消息**。
   * 消息一旦发出,渲染进程(popup 文档)随后被销毁**并不会把它撤回** ——
   * 浏览器进程照样落盘,丢掉的只是**回调**(它要回到一个已经不存在的
   * JS 上下文)。这正是 6d34545 的修复能在真实 Chromium 上 3/3 成功的原因:
   * 那次修复没做别的,只是把写入从「拆除时才发出」挪到了「松手当轮就发出」。
   *
   * 故本替身按**发出时刻**判定落盘,与真机一致:
   *
   * - 销毁**之前**发出的 `set` → 数据照样落盘(`snapshot()` 看得见),
   *   但 Promise 永不 resolve(回调丢失)。
   * - 销毁**之后**发出的 `set` → 什么都不会发生(JS 上下文已经没了,
   *   这行代码在真机上根本不会被执行)。
   *
   * ⚠️ 若反过来把「已发出的写」也一并丢掉,这个替身就比真机**更严格**,
   * 会把一个本来正确的修复判成失败 —— 而且会与 ADR-061 自相矛盾:
   * ADR-061 的全部结论就是「同一轮发出写入即可活过拆除」。
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  set(items: Record<string, unknown>): Promise<void> {
    // 销毁后「发出」的调用:真机上这行代码根本不会被执行到。
    if (this.#destroyed) return new Promise<void>(() => undefined);

    this.setInvocationCount += 1;

    // 🔴 数据的提交交给「浏览器进程」—— 与渲染进程的存活无关。
    // 用一个**独立于** #later 的宏任务表达 IPC 延迟:它不受 destroy() 影响,
    // 因为落盘发生在另一个进程里。
    setTimeout(() => {
      this.setCallCount += 1;

      const changes: Record<string, StorageChange> = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: clone(this.#data[k]), newValue: clone(v) };
        this.#data[k] = clone(v);
      }

      // 变更通知要回到渲染进程 —— 文档已销毁则送不到。
      if (this.#destroyed) return;
      for (const listener of [...this.#listeners]) {
        listener(changes, STORAGE_AREA_NAME);
      }
    }, this.#latencyMs);

    // 回调(Promise)回到渲染进程 —— 销毁后永不 resolve。
    return this.#later(() => undefined);
  }

  addChangeListener(listener: StorageChangeListener): void {
    this.#listeners.add(listener);
  }

  removeChangeListener(listener: StorageChangeListener): void {
    this.#listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }
}
