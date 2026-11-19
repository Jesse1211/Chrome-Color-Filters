/**
 * 注入编排器 —— T4a 的核心流程。
 *
 * 把三件事缝在一起,且顺序本身就是不变式:
 *
 * 1. **同步快路径**(`fast-path-cache`)→ 首帧之前就位(INV-3)
 * 2. **异步权威判定**(`SettingsRepository` + `resolveRule`)→ 纠正并回写缓存
 * 3. **INV-8 短路**:`masterEnabled === false` 时**立即退出**,
 *    不读规则、不匹配、不注入(ADR-027)
 *
 * 本模块不碰 `chrome.*`,全部依赖由调用方注入 —— 故可在 Node 下完整单测
 * (INV-8 的 spy 断言正是靠这一点做到「机械可判定」而非「人工看一遍」)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **INV-8 在同步阶段同样成立 —— 本轮修正的核心**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 旧实现的同步快路径**无条件**读缓存并上色,此时 `masterEnabled` 尚不可知
 * (它在异步的 `chrome.storage` 里)。于是主开关 OFF 时,每次冷加载都会
 * 先把页面上色、等异步读完再撤 —— 而 INV-8 的原文是「**不注入**」,
 * 不是「注入了再纠正」;ADR-027 给的理由更直白:「万一某条规则有问题,
 * **关主开关可彻底止血**」。先上色再撤 = 止不住血。
 *
 * 修正:缓存条目自带写入时的 `masterEnabled` 标记,
 * `readFastPath` 只在该标记为 `true` 时才返回命中,否则返回 `unknown`
 * ——「不知道」一律按**什么都不画**处理。于是:
 *
 * - 主开关 OFF 时写入的条目 → 永远不会让任何页面上色;
 * - 主开关从 ON 翻到 OFF 后,异步阶段会 `clearFastPath` 把旧条目**删掉**,
 *   旧条目因此连一次都不会被用上(删除发生在该 host 的本次导航,
 *   而该次导航的同步阶段本就因主开关仍 ON 的旧标记而上过色 ——
 *   见下方 `runInjector` 中对这一格的处理)。
 *
 * 代价是「主开关刚被关掉的那一瞬,已经开着的标签页」仍需异步阶段来撤,
 * 这是不可避免的(那一帧早已画出,无同步手段可干预),且不属于
 * 「content script 是否运行」的范畴 —— INV-8 管的是**新的页面加载**。
 */

import {
  type FilterSettings,
  type ResolvedRule,
  filterCssValue,
  hostFromUrl,
  resolveRule,
} from '../domain/index.js';
import {
  type FilterTarget,
  removeFilter,
  syncFilter,
} from './apply-filter.js';
import {
  type SyncKeyValueStore,
  clearFastPath,
  readFastPath,
  writeFastPath,
} from './fast-path-cache.js';

export interface InjectorDeps {
  /** 注入目标 —— 生产环境恒为 `document.documentElement`(T0 spike §1)。 */
  readonly target: FilterTarget;
  /** 同步缓存存储 —— 生产环境为 `sessionStorage`(见 `session-store.ts`)。 */
  readonly store: SyncKeyValueStore;
  /** 当前页面 URL。 */
  readonly url: string;
  /** 读取权威设置(异步)。 */
  readonly readSettings: () => Promise<FilterSettings>;
  /**
   * 订阅设置变更(可选)。
   *
   * 🔴 **INV-8 的最后一格**:主开关被关掉的**那一刻**就把本 host 的快路径缓存
   * 抹掉,而不是等下一次导航的异步阶段去清。
   *
   * 不接这个订阅会留下一个实测可见的窗口:用户关掉主开关后,缓存条目仍写着
   * 写入时的 `masterEnabled: true`,于是**下一次**导航的同步阶段仍会命中它、
   * 把页面上色,直到该次导航的异步阶段才清掉(实测 news.ycombinator.com
   * 约 2ms 可见,第 2 次之后的导航才干净)。ADR-027 要的是「关主开关可彻底止血」,
   * 2ms 也是血。
   */
  readonly subscribeSettings?: (
    listener: (settings: FilterSettings) => void,
  ) => () => void;
  /** 时钟,默认 `Date.now`(便于测 TTL 边界)。 */
  readonly clock?: () => number;
}

/** 一次解析的结果:应套用的 filter 值,`null` = 不套。 */
export type Decision = string | null;

/**
 * 纯判定:给定设置与 URL,算出该页应套用的 filter 值。
 *
 * 🔴 **INV-8 / ADR-027 的强制点之一**:`masterEnabled === false` 时
 * **直接返回 null,不进入 `resolveRule`** —— 即「不读规则、不匹配」。
 * 这里用 `resolveRule` 而非 `resolveActiveRule`,正是为了让主开关的短路
 * 在本文件里**可见且可被 spy 断言**:调用方传入的匹配函数被调用了几次,
 * 是 T4a gate 要机械判定的事项,藏进 `resolveActiveRule` 的 if 里就测不到了。
 */
export function decide(
  settings: FilterSettings,
  url: string,
  match: typeof resolveRule = resolveRule,
): Decision {
  // INV-8:主开关凌驾一切。不读规则、不匹配。
  if (!settings.masterEnabled) return null;

  const resolved = match(settings, url);
  if (resolved === null) return null;

  return filterCssValue(resolved.rule.mode, resolved.rule.intensity);
}

export interface InjectorRunResult {
  /** 同步阶段是否命中缓存并立即应用(INV-3 的可观测证据)。 */
  readonly fastPathHit: boolean;
  /** 同步阶段的推测值。 */
  readonly speculative: Decision;
  /** 异步阶段的权威值。 */
  readonly authoritative: Decision;
  /** 权威值是否推翻了推测值(说明缓存曾经陈旧)。 */
  readonly corrected: boolean;
}

/**
 * 启动注入。
 *
 * **返回的 Promise 只覆盖异步阶段** —— 同步阶段在本函数返回之前就已完成,
 * 这是 INV-3 所依赖的关键性质:调用方(content script 的 `main`)不 await
 * 也能保证快路径已经生效。
 */
export function runInjector(deps: InjectorDeps): {
  readonly fastPathHit: boolean;
  readonly settled: Promise<InjectorRunResult>;
} {
  const clock = deps.clock ?? Date.now;
  const host = hostFromUrl(deps.url);

  // ── 同步阶段:首帧之前 ───────────────────────────────────────────────
  //
  // 🔴 只有在缓存**明确**告知「写入时主开关是开的」时才动页面。
  //    `unknown`(无缓存 / 过期 / 损坏 / 写入时主开关是关的)一律
  //    **什么都不做** —— INV-8 要的是不注入,不是注入后纠正。
  let speculative: Decision = null;
  let fastPathHit = false;

  if (host !== null) {
    const cached = readFastPath(deps.store, host, clock());
    if (cached.kind === 'filter') {
      fastPathHit = true;
      speculative = cached.filterValue;
      // 命中即刻应用 —— 与静态 CSS 同处首帧之前(INV-3)。
      syncFilter(deps.target, speculative);
    } else if (cached.kind === 'none') {
      // 明确「该 host 不匹配」:这也是一次有效命中,但**无需任何 DOM 写入**
      // (默认态本就是不滤镜)。记为命中是为了让 INV-3 的观测区分
      //「知道不该上色」与「不知道」。
      fastPathHit = true;
      speculative = null;
    }
    // cached.kind === 'unknown' → 不碰 target,等异步权威结果。
  }

  // ── 变更订阅:主开关一关,立刻抹掉本 host 的推测 ──────────────────────
  //
  // 🔴 INV-8 / ADR-027。缓存条目记录的是**写入时**的主开关状态,它无法
  //    预知用户之后会把主开关关掉。若只靠「下次导航的异步阶段再清」,
  //    那次导航的**同步阶段**已经先按陈旧推测上过色了(实测约 2ms 可见)。
  //    订阅让清除发生在主开关变化的那一刻,于是下次导航同步阶段读到的是
  //    「无缓存」→ unknown → 什么都不画。
  if (deps.subscribeSettings && host !== null) {
    deps.subscribeSettings((settings) => {
      if (!settings.masterEnabled) {
        clearFastPath(deps.store, host);
        removeFilter(deps.target);
      }
    });
  }

  // ── 异步阶段:权威判定 + 纠正 + 回写 ────────────────────────────────
  const settled = (async (): Promise<InjectorRunResult> => {
    const settings = await deps.readSettings();

    // 🔴 INV-8 / ADR-027:主开关关闭时 content script 立即退出 ——
    // 不读规则、不匹配、不注入。
    //
    // 连带把该 host 的缓存**删掉**,使「关主开关可彻底止血」(ADR-027 的理由)
    // 对后续的每一次加载都成立:条目不存在 → `readFastPath` 返回 unknown
    // → 同步阶段什么都不画。
    if (!settings.masterEnabled) {
      if (host !== null) clearFastPath(deps.store, host);
      removeFilter(deps.target);
      return {
        fastPathHit,
        speculative,
        authoritative: null,
        corrected: speculative !== null,
      };
    }

    const resolved: ResolvedRule | null = resolveRule(settings, deps.url);
    const authoritative: Decision =
      resolved === null
        ? null
        : filterCssValue(resolved.rule.mode, resolved.rule.intensity);
    syncFilter(deps.target, authoritative);

    if (host !== null) {
      // 🔴 ADR-025:回写的是 `(mode,intensity)` 这两个**用户设置值**,
      //    不是 `filterCssValue` 算出的派生串(签名里根本没有那个参数)。
      writeFastPath(
        deps.store,
        host,
        true,
        resolved === null
          ? null
          : { mode: resolved.rule.mode, intensity: resolved.rule.intensity },
        clock(),
      );
    }

    return {
      fastPathHit,
      speculative,
      authoritative,
      corrected: speculative !== authoritative,
    };
  })();

  return { fastPathHit, settled };
}
