/**
 * `chrome.storage.local` 的最小端口(port)抽象。
 *
 * **ADR-010:规则存于 `chrome.storage.local`,仅本机,不跨设备同步。**
 * 本文件是整个代码库里唯一直接触碰 `chrome.storage` 的地方 ——
 * 仓储层(`settings-repository.ts`)只依赖下面这个接口,
 * 因而可以在 Node 下用内存替身单测,而**不需要伪造整个 `chrome` 全局**。
 *
 * 注意:这**不是** DESIGN.md §8 第 8 条所指的「用 mock 冒充真实栈」——
 * 真实栈的验收(REAL_STACK_GATE:重启浏览器后规则与锁定仍在)只能在真实 Chrome 中跑,
 * 本抽象服务的是锁定强制、容量、顺序这类**与浏览器无关的逻辑**。
 */

/** 存储变更事件的单个键的新旧值(对齐 `chrome.storage.StorageChange`)。 */
export interface StorageChange {
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

/** `onChanged` 回调签名(对齐 `chrome.storage.onChanged`)。 */
export type StorageChangeListener = (
  changes: Record<string, StorageChange>,
  areaName: string,
) => void;

/**
 * 仓储层所需的存储能力 —— `chrome.storage.local` 的真子集。
 *
 * 只声明实际用到的三件事:读、写、订阅变更。
 */
export interface StorageArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  addChangeListener(listener: StorageChangeListener): void;
  removeChangeListener(listener: StorageChangeListener): void;
}

/** 本仓储使用的存储区名。ADR-010 明确为 `local`,**不是 `sync`**。 */
export const STORAGE_AREA_NAME = 'local';

interface ChromeLikeStorageArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface ChromeLikeOnChanged {
  addListener(listener: StorageChangeListener): void;
  removeListener(listener: StorageChangeListener): void;
}

interface ChromeLike {
  storage?: {
    local?: ChromeLikeStorageArea;
    onChanged?: ChromeLikeOnChanged;
  };
}

interface GlobalWithChrome {
  chrome?: ChromeLike;
}

/**
 * 取得真实的 `chrome.storage.local` 适配器。
 *
 * 在扩展运行时(popup / background / content script)可用;
 * 在 Node 单测下不可用 —— 测试应当注入内存替身而非调用本函数。
 *
 * @throws 当 `chrome.storage.local` 不存在时抛出。这是**环境错误**而非写入失败,
 *         故此处 throw 而非返回 `WriteError`(ADR-046 管的是写入失败)。
 */
export function chromeLocalStorageArea(): StorageArea {
  const g = globalThis as unknown as GlobalWithChrome;
  const local = g.chrome?.storage?.local;
  const onChanged = g.chrome?.storage?.onChanged;

  if (!local) {
    throw new Error(
      'chrome.storage.local 不可用 —— 本适配器只能在扩展上下文中使用(ADR-010)。',
    );
  }

  return {
    get: (keys) => Promise.resolve(local.get(keys)),
    set: (items) => Promise.resolve(local.set(items)),
    addChangeListener: (listener) => onChanged?.addListener(listener),
    removeChangeListener: (listener) => onChanged?.removeListener(listener),
  };
}
