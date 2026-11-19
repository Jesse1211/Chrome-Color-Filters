/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 同步快路径缓存 —— INV-3(零闪烁)在「异步 `chrome.storage`」面前的唯一出路。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 问题
 *
 * DESIGN.md §6 T4a 原文:「注意 `chrome.storage` 是异步的,**此处需要设计**」。
 *
 * content script 在 `document_start` 拿到控制权时,要决定本页是否套滤镜、套哪个,
 * 必须先读设置 —— 而 `chrome.storage.local.get` 返回 Promise。
 * 一旦 `await`,当前同步执行块就结束了,浏览器获得渲染时机,
 * **首帧很可能已经画出去**。那一帧是未滤镜的彩色帧,INV-3 即告破裂。
 *
 * MV3 的 content script 没有任何同步的**扩展**存储 API（`chrome.storage` 全系异步）。
 * 唯一同步可读的是页面源的 Web Storage —— content script 虽跑在隔离世界，
 * 但共享宿主页面的 `localStorage` / `sessionStorage`。本模块正是把判定结果
 * 寄存在那里，换取一个「首帧之前就能同步回答」的机会。
 *
 * ## 解法：把判定结果缓存在同步可读的 Web Storage 里
 *
 * `sessionStorage` 的 `getItem` 是**同步**的,且与页面同源、按标签页隔离。
 * 流程:
 *
 * 1. **同步阶段**(`document_start`,无 await):用 `location.host` 查缓存。
 *    命中 → 立刻 `applyFilter`,与静态 CSS 同处首帧之前 → **零闪烁**。
 * 2. **异步阶段**:`await` 真实设置,跑 `resolveActiveRule` 得到权威结果,
 *    与同步阶段的结果比对并纠正,然后回写缓存。
 *
 * 于是「同一标签页内、同一 host 的再次导航」—— 也就是真实使用中的绝大多数导航
 * (站内跳转、刷新、前进后退)—— 全部走第 1 步,零闪烁。
 * 只有「该标签页首次遇到该 host」会落到第 2 步。
 *
 * ## 冷启动那一格：本模块覆盖不到，由 `persistent-store.ts` 补上
 *
 * T4a gate 对零闪烁的要求是「**冷启动**加载录屏，逐帧检查，第一个可见帧即已滤镜」。
 * 若本模块的底层存储是 `sessionStorage`，它**按标签页隔离**，
 * 「某标签页首次访问某 host」必然未命中 —— 恰恰就是冷启动。
 *
 * 实测（生产构建 + 真实 Chrome + news.ycombinator.com）6 次冷启动试验中
 * **5 次出现未滤镜的彩色帧**（worst frame 是一条完全未滤镜的 HN 橙色头部）。
 * ADR-018 定零闪烁为**硬性不变式、非优化项**，故这一格不得留着。
 *
 * 解法不在本文件，而在 `persistent-store.ts`：同一套机制换上一个
 * **跨标签页**的同步存储（`localStorage`，按源而非按标签页作用）。
 * 本文件因此对底层存储保持不可知 —— 只依赖 `SyncKeyValueStore` 端口，
 * 由调用方（`entrypoints/content.ts`）注入具体实现。
 *
 * **实测数据（docs/T4a-gate/evidence/flicker.json，生产产物 + 真实 Chrome）：**
 * - 热路径（同标签页再次导航 —— 刷新 / 站内跳转 / 前进后退）：0 带色帧。
 * - 冷启动首访：接入持久层后同样 0 带色帧（见 gate 证据）。
 * - 对照基线（主开关关闭）带色帧显著大于 0 —— 证明探针确实抓得到彩色帧。
 *
 * ## 为什么用 Web Storage 不违反 INV-9 / ADR-026
 *
 * INV-9:「扩展绝不**读取/修改/外传宿主页面内容**」。
 * Web Storage（`localStorage` / `sessionStorage`）不是页面内容 —— 它是存储区，且：
 * - 写入的键名带 `__ccf_` 前缀,值只有扩展自己算出的 filter 字符串与一个时间戳;
 * - **从不读取**页面写进去的任何键(只 `getItem` 自己那一个前缀键);
 * - 不向任何地方外传。
 *
 * 唯一可观察的副作用:页面若枚举 Web Storage 会多看到一个键。
 * 这是本方案已知且已申报的 INV-1 代价,换取的是 INV-3 ——
 * 而 ADR-018 明确把零闪烁定为**硬性不变式,非优化项**。
 */

/** 缓存键前缀。带扩展前缀,避免与站点自身的键撞名。 */
const CACHE_PREFIX = '__ccf_fp_';

/**
 * 缓存的有效期(毫秒)。
 *
 * 缓存是**推测**,权威始终是异步读到的设置。过期只是为了避免一个
 * 长期开着的标签页无限期地用陈旧推测开场;真正的纠正发生在每次异步阶段。
 * 取 24 小时:足够长以覆盖正常的浏览会话,足够短以免陈旧值长期留存。
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** 同步存储的最小端口 —— 便于在 Node 下单测(对齐 `StorageArea` 的做法)。 */
export interface SyncKeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface CacheEntry {
  /** 该 host 应套用的 filter 值;`null` = 该 host 不匹配任何规则。 */
  readonly f: string | null;
  /** 写入时刻(epoch ms),用于 TTL。 */
  readonly t: number;
}

function keyFor(host: string): string {
  return `${CACHE_PREFIX}${host}`;
}

/**
 * 同步读取缓存的判定结果。
 *
 * 返回:
 * - `{ value: string }` —— 推测该 host 应套用此 filter
 * - `{ value: null }`   —— 推测该 host 不匹配
 * - `undefined`         —— 无缓存 / 已过期 / 数据损坏,调用方必须等异步结果
 *
 * **永不抛异常**:`sessionStorage` 在某些上下文(`data:` 文档、
 * 禁用了存储的站点、隐私模式的极端配置)会直接 throw SecurityError。
 * 滤镜是辅助功能,绝不能因为读缓存失败就让 content script 崩掉 ——
 * 那会把一个优化问题变成功能性故障。
 */
export function readFastPath(
  store: SyncKeyValueStore,
  host: string,
  now: number,
): { readonly value: string | null } | undefined {
  let raw: string | null;
  try {
    raw = store.getItem(keyFor(host));
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined; // 损坏即视为无缓存(同 ADR-041 的回退精神)
  }

  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const entry = parsed as Partial<CacheEntry>;

  if (typeof entry.t !== 'number' || !Number.isFinite(entry.t)) return undefined;
  // 未来时间戳(系统时钟被改)同样按过期处理 —— 推测值宁可不用。
  if (now - entry.t > CACHE_TTL_MS || entry.t > now) return undefined;

  if (entry.f === null) return { value: null };
  if (typeof entry.f === 'string') return { value: entry.f };
  return undefined;
}

/**
 * 回写判定结果。失败静默忽略 —— 缓存是尽力而为的加固,不是功能本身。
 */
export function writeFastPath(
  store: SyncKeyValueStore,
  host: string,
  filterValue: string | null,
  now: number,
): void {
  const entry: CacheEntry = { f: filterValue, t: now };
  try {
    store.setItem(keyFor(host), JSON.stringify(entry));
  } catch {
    // 配额满 / 存储被禁用 —— 忽略。
  }
}

/** 清掉某个 host 的缓存(主开关关闭等场景)。失败静默忽略。 */
export function clearFastPath(store: SyncKeyValueStore, host: string): void {
  try {
    store.removeItem(keyFor(host));
  } catch {
    // 忽略。
  }
}
