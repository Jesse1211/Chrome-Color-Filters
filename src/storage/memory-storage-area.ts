/**
 * `StorageArea` 的内存实现 —— 用于**单元测试**。
 *
 * ⚠️ **这不是真实栈。** DESIGN.md §8 第 8 条:REAL_STACK_GATE 必须在真实 Chrome 中跑,
 * jsdom/mock 下的绿灯**不构成**通过。本替身服务的是锁定强制(INV-14)、容量(INV-7)、
 * 顺序(INV-6)、结构化错误(ADR-046)这类**与浏览器无关**的逻辑;
 * 「重启浏览器后规则与锁定仍在」(INV-13)只能在真实 Chrome 中验。
 *
 * 行为对齐 `chrome.storage.local`:
 * - 值经 JSON 往返(结构化克隆的近似)—— 存进去的对象改了不影响已存的值
 * - `set` 后同步派发 `onChanged`,`areaName` 为 `'local'`(ADR-010)
 */
import type {
  StorageArea,
  StorageChange,
  StorageChangeListener,
} from './storage-area.js';
import { STORAGE_AREA_NAME } from './storage-area.js';

export interface MemoryStorageAreaOptions {
  /** 注入一个会抛错的 `set`,用于测试 `quota` / `other` 的结构化错误(ADR-046)。 */
  readonly failSet?: () => unknown;
  /** 注入一个会抛错的 `get`,用于测试 ADR-041 的读回退。 */
  readonly failGet?: () => unknown;
}

export class MemoryStorageArea implements StorageArea {
  #data: Record<string, unknown> = {};
  readonly #listeners = new Set<StorageChangeListener>();

  /** 统计实际落盘次数 —— 防抖门禁(写入次数 ≤ 3)靠它断言。 */
  setCallCount = 0;

  /** 可随时替换的失败注入开关。 */
  failSet: (() => unknown) | null;
  failGet: (() => unknown) | null;

  constructor(
    initial: Record<string, unknown> = {},
    options: MemoryStorageAreaOptions = {},
  ) {
    this.#data = clone(initial);
    this.failSet = options.failSet ?? null;
    this.failGet = options.failGet ?? null;
  }

  /** 直接读取底层数据(测试断言用),不触发任何副作用。 */
  snapshot(): Record<string, unknown> {
    return clone(this.#data);
  }

  /** 直接写入底层数据(测试布置用),不触发 `onChanged`、不计入 `setCallCount`。 */
  seed(data: Record<string, unknown>): void {
    this.#data = clone(data);
  }

  get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    if (this.failGet) return Promise.reject(this.failGet());

    if (keys === null) return Promise.resolve(clone(this.#data));
    const list = Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const k of list) {
      if (k in this.#data) out[k] = clone(this.#data[k]);
    }
    return Promise.resolve(out);
  }

  set(items: Record<string, unknown>): Promise<void> {
    if (this.failSet) return Promise.reject(this.failSet());

    this.setCallCount += 1;

    const changes: Record<string, StorageChange> = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { oldValue: clone(this.#data[k]), newValue: clone(v) };
      this.#data[k] = clone(v);
    }

    for (const listener of [...this.#listeners]) {
      listener(changes, STORAGE_AREA_NAME);
    }
    return Promise.resolve();
  }

  addChangeListener(listener: StorageChangeListener): void {
    this.#listeners.add(listener);
  }

  removeChangeListener(listener: StorageChangeListener): void {
    this.#listeners.delete(listener);
  }

  /** 当前订阅者数量(测试取消订阅用)。 */
  get listenerCount(): number {
    return this.#listeners.size;
  }
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
