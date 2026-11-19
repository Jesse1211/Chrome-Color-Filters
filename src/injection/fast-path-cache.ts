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
 * MV3 的 content script 没有任何同步的**扩展**存储 API(`chrome.storage` 全系异步)。
 * 已实测排除的替代通道见 `docs/T4a-gate/README.md`「同步通道取舍」一节:
 * `chrome.scripting.registerContentScripts` 的 `css` 字段**只接受文件路径、
 * 不接受内联字符串**(装不下由 `(mode,intensity)` 算出的动态值),且实测
 * **不跨浏览器重启存活**。故同步通道只剩页面源的 Web Storage。
 *
 * ## 本模块存什么 —— 只存**非派生**的输入(ADR-025)
 *
 * 🔴 **缓存里绝不放 `filterCssValue` 的结果。**
 * ADR-025:「`ColorMatrix` 为派生值,不持久化 | 持久化会产生可漂移的双份真相」,
 * 其范围由 DESIGN.md:736 点明 ——「纯函数 ≠ 不持久化,ADR-025 要防的是**双份真相**」。
 * 把 `filterCssValue(mode,intensity)` 算出的 feColorMatrix 系数串存下来,
 * 正是制造了那第二份真相:它有独立于设置的生命周期,会漂移。
 *
 * 故本模块存的是 `(mode, intensity)` —— 与 `rules[]` 里逐字相同的那两个
 * **用户设置值**,不是它们的任何函数。filter 字符串在**读取时**由
 * `filterCssValue` 当场算出(纯函数,同一输入恒等同一输出),
 * 于是派生值永远只有一份、永远由唯一真相源现算。
 *
 * ## INV-8 的同步强制点就在本模块里(ADR-027)
 *
 * 🔴 条目带一个 `masterEnabled` 标记,记录**写入该条目时主开关是开的**。
 * `readFastPath` 只在该标记为 `true` 时才返回命中;否则一律当作**未命中**。
 * 于是主开关 OFF 时同步阶段**什么都不画** —— INV-8 要求的是「不注入」,
 * 不是「先注入再纠正」。详见 `injector.ts` 的 INV-8 一节。
 *
 * ## 作用域:`sessionStorage`(按标签页),不升级到 `localStorage`
 *
 * 曾经为了覆盖冷启动把底层换成 `localStorage`。那是**错的**,已回退:
 * DESIGN.md §1 划定本 BC 的边界 ——「宿主页面(host page)的 DOM、样式、脚本
 * **不属于**本 BC —— 只可观察,**永不拥有**」。`localStorage` 按源且跨会话,
 * 等于让扩展在宿主页面自己的源里**持有一份跨会话、按站点、页面可读**的持久记录,
 * 那是「拥有」,越过了 §1 的所有权红线。`sessionStorage` 随标签页蒸发,
 * 不构成持久所有权。
 *
 * 代价是「本标签页首次访问该 host」不命中 —— 已如实申报为 blindSpot,
 * 不再用越界的存储去粉饰(ADR-018 把零闪烁定为硬性不变式,但它
 * **没有**授予拿 INV-9/§1 去交换的权力;真有冲突应按 DESIGN.md §8.1 上报)。
 *
 * ## 为什么用 Web Storage 仍不违反 INV-9 / ADR-026
 *
 * INV-9:「扩展绝不**读取/修改/外传宿主页面内容**」。本模块:
 * - 只 `getItem`/`setItem`/`removeItem` **一个** `__ccf_fp_` 前缀键;
 * - **从不枚举** storage(不碰 `length`/`key()`/`Object.keys`),
 *   因此物理上读不到页面写入的任何键;
 * - 值只有 `(mode,intensity)` 与一个时间戳,不含页面任何信息;
 * - 不向任何地方外传。
 */

import {
  type FilterMode,
  type Intensity,
  filterCssValue,
  isFilterMode,
  isIntensity,
} from '../domain/index.js';

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

/**
 * 缓存条目 —— **只含非派生的用户设置值**(ADR-025)。
 *
 * 字段名写全,不用单字母缩写:这是一份会在存储里躺上一整个会话、
 * 可能被下一个维护者或排障者直接读到的 JSON,省那几个字节毫无价值。
 */
interface CacheEntry {
  /**
   * 写入该条目时主开关的状态。🔴 INV-8 / ADR-027 的同步强制点:
   * 只有 `true` 才允许快路径上色。
   */
  readonly masterEnabled: boolean;
  /** 命中规则的 mode;`null` = 该 host 不匹配任何规则。 */
  readonly mode: FilterMode | null;
  /** 命中规则的 intensity;`mode === null` 时为 `null`。 */
  readonly intensity: Intensity | null;
  /** 写入时刻(epoch ms),用于 TTL。 */
  readonly writtenAt: number;
}

/**
 * 快路径的读取结果 —— 三态**显式**化,不靠 `string | null | undefined` 的隐式约定。
 *
 * 之所以要一个真正的三态类型:`none`(明确不套滤镜)与 `unknown`(不知道)
 * 在 INV-8 / INV-3 下的处置**完全相反**,把二者混进同一个 `null`
 * 正是上一轮 INV-8 被绕过的根源。
 */
export type FastPathRead =
  /** 推测该 host 应套用 `filterValue`(现算,非存储读出)。 */
  | { readonly kind: 'filter'; readonly filterValue: string }
  /** 推测该 host 明确不套滤镜(无规则命中)。 */
  | { readonly kind: 'none' }
  /** 不知道:无缓存 / 已过期 / 损坏 / 写入时主开关是关的。调用方必须等异步结果。 */
  | { readonly kind: 'unknown' };

const UNKNOWN: FastPathRead = { kind: 'unknown' };
const NONE: FastPathRead = { kind: 'none' };

function keyFor(host: string): string {
  return `${CACHE_PREFIX}${host}`;
}

/**
 * 同步读取缓存的判定结果。
 *
 * 🔴 **主开关强制点(INV-8 / ADR-027)**:条目的 `masterEnabled !== true` 时
 * 返回 `unknown` —— 即**当作未命中,同步阶段不画任何东西**。
 *
 * 🔴 **ADR-025**:返回的 `filterValue` 由 `filterCssValue(mode,intensity)`
 * **当场算出**,不是从存储里读出来的 —— 存储里根本没有派生值。
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
): FastPathRead {
  let raw: string | null;
  try {
    raw = store.getItem(keyFor(host));
  } catch {
    return UNKNOWN;
  }
  if (raw === null) return UNKNOWN;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return UNKNOWN; // 损坏即视为无缓存(同 ADR-041 的回退精神)
  }

  if (typeof parsed !== 'object' || parsed === null) return UNKNOWN;
  const entry = parsed as Partial<CacheEntry>;

  // 🔴 INV-8:写入时主开关若不是开的,这条推测一律不得用于上色。
  if (entry.masterEnabled !== true) return UNKNOWN;

  if (typeof entry.writtenAt !== 'number' || !Number.isFinite(entry.writtenAt)) {
    return UNKNOWN;
  }
  // 未来时间戳(系统时钟被改)同样按过期处理 —— 推测值宁可不用。
  if (now - entry.writtenAt > CACHE_TTL_MS || entry.writtenAt > now) {
    return UNKNOWN;
  }

  // 明确「不匹配任何规则」。
  if (entry.mode === null) return NONE;

  // 🔴 派生值在此**现算**,不从存储读(ADR-025)。
  if (!isFilterMode(entry.mode)) return UNKNOWN;
  if (!isIntensity(entry.intensity)) return UNKNOWN;
  return {
    kind: 'filter',
    filterValue: filterCssValue(entry.mode, entry.intensity),
  };
}

/** `writeFastPath` 的入参:命中规则的两个设置值。`null` = 该 host 不匹配。 */
export interface FastPathWrite {
  readonly mode: FilterMode;
  readonly intensity: Intensity;
}

/**
 * 回写判定结果。失败静默忽略 —— 缓存是尽力而为的加固,不是功能本身。
 *
 * 🔴 只接受 `(mode,intensity)`,**结构上拒绝**写入派生值(ADR-025):
 * 调用方即便想存 filter 字符串,签名里也没有那个参数可传。
 *
 * 🔴 `masterEnabled` 必须由调用方显式传入并如实记录(INV-8)。
 */
export function writeFastPath(
  store: SyncKeyValueStore,
  host: string,
  masterEnabled: boolean,
  resolved: FastPathWrite | null,
  now: number,
): void {
  const entry: CacheEntry = {
    masterEnabled,
    mode: resolved === null ? null : resolved.mode,
    intensity: resolved === null ? null : resolved.intensity,
    writtenAt: now,
  };
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
