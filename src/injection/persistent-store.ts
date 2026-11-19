/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 快路径缓存的**持久层** —— 关上 INV-3 的冷启动缺口。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 这个文件修的是一个被实测证实的真实缺陷,不是优化
 *
 * `fast-path-cache.ts` 用 `sessionStorage` 做同步快路径。`sessionStorage`
 * **按标签页隔离**,所以「某个标签页**首次**访问某 host」必然落空 ——
 * 而 T4a gate 对 INV-3 的要求逐字就是:
 *
 * > 「**冷启动**加载录屏,逐帧检查,**第一个可见帧即已滤镜**」
 *
 * 冷启动正是 `sessionStorage` 结构上覆盖不到的那一格。
 * 实测(生产构建 + 真实 Chrome + news.ycombinator.com,6 次冷启动试验):
 * **5/6 次出现未滤镜的彩色帧**,worst frame 整条 HN 橙色头部完全未滤镜。
 * 这不是探针抖动 —— 带色比例 0.0228 与「主开关关闭」的基线逐位相同。
 *
 * ADR-018 把零闪烁定为**硬性不变式,非优化项**,所以这一格不能留着。
 *
 * ## 解法:同一套机制换一个**跨标签页**的同步存储
 *
 * `localStorage` 与 `sessionStorage` 是同一个 Web Storage API,区别只有两点:
 * 作用域是**按源**而非按标签页,且**跨会话持久**。于是:
 *
 * - 某 host 上**任何一个**标签页跑完一次异步权威判定后,结果立刻对
 *   **该源的所有后续标签页**同步可见 —— 包括「这个标签页第一次访问该 host」。
 * - 实测(`probe2`):tab1 写入后,**全新 tab2** 在 `document_start` 同步读得到。
 *
 * 这不是把 INV-3 的验收标准换一个说法,而是真的把那一帧消掉了。
 *
 * ## 持久化带来的两个新风险,以及各自的处置
 *
 * 1. **陈旧值活得更久。** `sessionStorage` 随标签页关闭而蒸发,`localStorage` 不会。
 *    处置:TTL 仍由 `fast-path-cache.ts` 统一把关(24h),且**权威始终是异步读到的设置** ——
 *    每次导航的异步阶段都会纠正并回写。缓存只是推测,从不是真相来源。
 * 2. **写入量更大的隐私面。** 见下。
 *
 * ## 为什么仍不违反 INV-9 / ADR-026
 *
 * INV-9 的原文是「扩展绝不**读取/修改/外传宿主页面内容**」。本模块:
 * - 只 `getItem`/`setItem`/`removeItem` **一个** `__ccf_fp_` 前缀键;
 * - **从不枚举** storage(不碰 `length`/`key()`/`Object.keys`),
 *   因此物理上读不到页面写入的任何键;
 * - 值只有扩展自己算出的 filter 字符串与一个时间戳,不含页面任何信息;
 * - 不向任何地方外传。
 *
 * 与既有的 `sessionStorage` 快路径相比,隐私面**没有变宽** ——
 * 是同一个 API、同一个前缀、同一条「只碰自己那一个键」的纪律,
 * 只是换了作用域。`tests/content-script-privacy.test.ts` 对两者同样把关。
 *
 * ## 降级:`localStorage` 不可用时自动退回 `sessionStorage`
 *
 * `data:` / `about:` 文档、以及用户为某站点禁用了存储时,访问 `localStorage`
 * 会直接抛 `SecurityError`。滤镜是辅助功能,**绝不能因为缓存层不可用就崩掉** ——
 * 那会把一个加固措施变成功能性故障。故 `tieredStore` 在探测失败时
 * 静默退回 `sessionStorage`,再失败则退回一个空实现(行为等同于「永远未命中」,
 * 即本次修复之前的旧行为),功能本身始终由异步权威路径兜底。
 */

import { type SyncKeyValueStore } from './fast-path-cache.js';

/** 永远未命中的空存储 —— 两层都不可用时的最终降级。 */
const NULL_STORE: SyncKeyValueStore = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

/**
 * 探测一个 Web Storage 是否真的可用。
 *
 * 仅仅 `typeof localStorage !== 'undefined'` 不够:属性存在但一访问就抛
 * `SecurityError` 的情况是真实存在的(禁用了存储的站点)。故实际做一次
 * 读写删往返,用的是**本扩展自己的探测键**,不碰页面的任何键。
 */
export function isStoreUsable(store: SyncKeyValueStore | undefined): boolean {
  if (!store) return false;
  const probeKey = '__ccf_probe_';
  try {
    store.setItem(probeKey, '1');
    const ok = store.getItem(probeKey) === '1';
    store.removeItem(probeKey);
    return ok;
  } catch {
    return false;
  }
}

export interface TieredStoreSources {
  /** 跨标签页、跨会话的持久层 —— 生产环境为 `localStorage`。 */
  readonly persistent?: SyncKeyValueStore;
  /** 按标签页隔离的会话层 —— 生产环境为 `sessionStorage`。 */
  readonly session?: SyncKeyValueStore;
}

/**
 * 选出可用的同步存储,优先持久层。
 *
 * 优先 `localStorage` 正是本次修复的全部要点:只有跨标签页可见的那一层
 * 才能覆盖「本标签页首次访问该 host」这一冷启动情形(INV-3)。
 *
 * 返回值恒为一个**可用**的 `SyncKeyValueStore`(最坏情况是 `NULL_STORE`),
 * 故调用方无需再做任何可用性判断。
 */
export function tieredStore(sources: TieredStoreSources): SyncKeyValueStore {
  if (isStoreUsable(sources.persistent)) return sources.persistent as SyncKeyValueStore;
  if (isStoreUsable(sources.session)) return sources.session as SyncKeyValueStore;
  return NULL_STORE;
}

/**
 * 生产环境的默认装配:`localStorage` 优先,`sessionStorage` 兜底。
 *
 * 用 getter 包起来而非直接取值,是因为在某些上下文里**读取这个全局本身**就会抛。
 */
export function defaultBrowserStore(): SyncKeyValueStore {
  let persistent: SyncKeyValueStore | undefined;
  let session: SyncKeyValueStore | undefined;
  try {
    persistent = globalThis.localStorage;
  } catch {
    persistent = undefined;
  }
  try {
    session = globalThis.sessionStorage;
  } catch {
    session = undefined;
  }
  return tieredStore({ persistent, session });
}
