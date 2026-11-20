/**
 * 快路径的底层同步存储 —— **宿主 origin 的 `localStorage`**(ADR-060)。
 *
 * ## 为什么是持久层,而不是会话层(本轮的架构裁决)
 *
 * 上一轮本模块用 `sessionStorage`,理由是守住 DESIGN.md §1 的所有权红线
 * (「宿主页面……只可观察,**永不拥有**」)。那个判断在当时是对的 ——
 * Dev 不得在无授权的情况下自行裁定「INV-3 优先于 INV-9/§1」。
 *
 * **但该冲突现已由产品负责人裁决,记为 ADR-060:**
 *
 * > 允许在宿主页面 origin 的 `localStorage` 下存一条「快路径」记录
 * > (仅 `mode`+`intensity`),供首帧之前同步读取。这是对「永不拥有宿主页面」
 * > 的**窄口例外**。
 *
 * DESIGN.md §1 已就此改写,明文记入这条唯一例外。于是本模块按裁决改回持久层。
 *
 * ## `sessionStorage` 为什么必然不够(实测,不是推测)
 *
 * `sessionStorage` 按**标签页**作用,标签页一关即蒸发。于是两个高频场景
 * 根本没有任何同步通道可用:
 *
 * - **浏览器重启后**对某 host 的首次访问;
 * - **新标签页**对某 host 的首次访问。
 *
 * 上一轮在生产产物 + 真实 Chrome 上实测 `news.ycombinator.com` 冷启动
 * **6 次有 3 次**出现完整渲染的未滤镜帧(截图在案)。这是**非确定性失败**,
 * 取决于缓存是否命中 —— 而 ADR-018 把零闪烁定为**硬性不变式**,不是优化项。
 *
 * `localStorage` 按 **origin** 作用且**跨浏览器重启存活**,是唯一同时满足
 * 「`document_start` 同步可读 + 能携带动态值 + 跨重启存活」的通道
 * (完整的通道取舍矩阵见 `docs/T4a-gate/README.md`)。
 *
 * ## 已接受的隐私代价(ADR-060 / DESIGN.md §4.1)
 *
 * 🔴 **站点自己的 JavaScript 能读到这条记录**,从而得知用户在本站开了什么滤镜 ——
 * 对色觉辅助场景,这等于暴露了一点用户的视觉特征信息。
 * 该代价已向产品负责人提示并被接受,记在 DESIGN.md §4.1。
 *
 * 本模块把代价压到最小,这些是**实现义务**而非可选项:
 * - 写入的值**只有** `(mode, intensity)` 与一个时间戳 —— 不含任何页面信息;
 * - **只碰一个** `__ccf_fp_<host>` 键,**从不枚举** storage
 *   (不读 `length`/`key()`/`Object.keys`),因此物理上读不到站点写入的任何键;
 * - 绝不外传(产物里连 `fetch`/`sendBeacon` 字样都不存在,有机械断言把守)。
 *
 * 以上三条由 `tests/content-script-privacy.test.ts` 机械断言,不靠人工复核。
 *
 * ## 降级:不可用时退回「永远未命中」
 *
 * `data:` / `about:` 文档、以及用户为某站点禁用了存储时,访问 `localStorage`
 * 会直接抛 `SecurityError`。滤镜是辅助功能,**绝不能因为缓存层不可用就崩掉** ——
 * 那会把一个加固措施变成功能性故障。故此处探测失败即退回空实现
 * (行为等同于「永远未命中」),功能本身始终由异步权威路径兜底。
 */

import { type SyncKeyValueStore } from './fast-path-cache.js';

/** 永远未命中的空存储 —— 持久层不可用时的降级。 */
const NULL_STORE: SyncKeyValueStore = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

/**
 * 取得本次注入要用的同步存储(ADR-060:宿主 origin 的 `localStorage`)。
 *
 * 用 try/catch 包住**取全局这一步本身**,因为在某些上下文里
 * 读取 `localStorage` 这个属性就会抛(不是调用方法时才抛)。
 *
 * 这里**不做**读写往返探测:那需要写一个探测键到宿主页面的存储里,
 * 而探测键一旦 `removeItem` 失败就会留下残留 —— 为了判断能不能写
 * 而先写一次,代价与收益不成比例。`readFastPath`/`writeFastPath`
 * 各自都已 try/catch,不可用时自然表现为「未命中 + 写入静默失败」,
 * 与探测得到的结论完全一致。
 */
export function defaultFastPathStore(): SyncKeyValueStore {
  try {
    const store = globalThis.localStorage;
    // 属性存在但为 undefined/null 的宿主环境(非浏览器、测试桩)同样降级。
    return store ?? NULL_STORE;
  } catch {
    return NULL_STORE;
  }
}
