/**
 * 快路径的底层同步存储 —— `sessionStorage`,**且仅限 `sessionStorage`**。
 *
 * ## 为什么是会话层,而不是持久层(本轮的架构修正)
 *
 * 上一轮为了覆盖「冷启动首访」把底层换成了 `localStorage`。那越过了
 * DESIGN.md §1 给本 BC 划的所有权红线:
 *
 * > 「宿主页面(host page)的 DOM、样式、脚本**不属于**本 BC —— 只可观察,**永不拥有**」
 *
 * `localStorage` 按**源**作用且**跨会话持久**。用它意味着扩展在宿主页面自己的源里
 * 留下一份**按站点、跨浏览器重启、页面自身可读**的持久记录 ——
 * 那正是「拥有」,而 §1 说永不拥有。`sessionStorage` 随标签页关闭即蒸发,
 * 是一块不构成持久所有权的临时暂存。
 *
 * ADR-018 把零闪烁定为硬性不变式,但它**没有**授予「拿 INV-9/§1 去换 INV-3」的权力;
 * 若 INV-3 与 §1 真的不可兼得,按 DESIGN.md §8.1 那是**上报**事项,不是 Dev 自裁。
 * 本实现因此选择:守住边界,把覆盖不到的那一格如实申报为 blindSpot
 * (见 `docs/T4a-gate/README.md`)。
 *
 * ## 降级:不可用时退回「永远未命中」
 *
 * `data:` / `about:` 文档、以及用户为某站点禁用了存储时,访问 `sessionStorage`
 * 会直接抛 `SecurityError`。滤镜是辅助功能,**绝不能因为缓存层不可用就崩掉** ——
 * 那会把一个加固措施变成功能性故障。故此处探测失败即退回空实现
 * (行为等同于「永远未命中」),功能本身始终由异步权威路径兜底。
 */

import { type SyncKeyValueStore } from './fast-path-cache.js';

/** 永远未命中的空存储 —— 会话层不可用时的降级。 */
const NULL_STORE: SyncKeyValueStore = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

/**
 * 取得本次注入要用的同步存储。
 *
 * 用 try/catch 包住**取全局这一步本身**,因为在某些上下文里
 * 读取 `sessionStorage` 这个属性就会抛(不是调用方法时才抛)。
 *
 * 这里**不做**读写往返探测:那需要写一个探测键到宿主页面的存储里,
 * 而探测键一旦 `removeItem` 失败就会留下残留 —— 为了判断能不能写
 * 而先写一次,代价与收益不成比例。`readFastPath`/`writeFastPath`
 * 各自都已 try/catch,不可用时自然表现为「未命中 + 写入静默失败」,
 * 与探测得到的结论完全一致。
 */
export function defaultSessionStore(): SyncKeyValueStore {
  try {
    const store = globalThis.sessionStorage;
    // 属性存在但为 undefined/null 的宿主环境(非浏览器、测试桩)同样降级。
    return store ?? NULL_STORE;
  } catch {
    return NULL_STORE;
  }
}
