/**
 * 注入编排器 —— T4a 的核心流程。
 *
 * 把三件事缝在一起,且顺序本身就是不变式:
 *
 * 1. **同步快路径**(`fast-path-cache`)→ 首帧之前就位(INV-3)
 * 2. **异步权威判定**(`SettingsRepository` + `resolveActiveRule`)→ 纠正并回写缓存
 * 3. **INV-8 短路**:`masterEnabled === false` 时**立即退出**,
 *    不读规则、不匹配、不注入(ADR-027)
 *
 * 本模块不碰 `chrome.*`,全部依赖由调用方注入 —— 故可在 Node 下完整单测
 * (INV-8 的 spy 断言正是靠这一点做到「机械可判定」而非「人工看一遍」)。
 */

import {
  type FilterSettings,
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
  /** 同步缓存存储 —— 生产环境为 `sessionStorage`。 */
  readonly store: SyncKeyValueStore;
  /** 当前页面 URL。 */
  readonly url: string;
  /** 读取权威设置(异步)。 */
  readonly readSettings: () => Promise<FilterSettings>;
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
  let speculative: Decision = null;
  let fastPathHit = false;

  if (host !== null) {
    const cached = readFastPath(deps.store, host, clock());
    if (cached !== undefined) {
      fastPathHit = true;
      speculative = cached.value;
      // 命中即刻应用 —— 与静态 CSS 同处首帧之前(INV-3)。
      syncFilter(deps.target, speculative);
    }
  }

  // ── 异步阶段:权威判定 + 纠正 + 回写 ────────────────────────────────
  const settled = (async (): Promise<InjectorRunResult> => {
    const settings = await deps.readSettings();

    // INV-8 / ADR-027:主开关关闭时 content script 立即退出。
    // 连带把缓存清掉 —— 否则下次导航的同步快路径会拿陈旧的「该滤镜」推测
    // 把页面染灰,而主开关明明是关的(那将是 INV-8 的真实破绽)。
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

    const authoritative = decide(settings, deps.url);
    syncFilter(deps.target, authoritative);

    if (host !== null) {
      writeFastPath(deps.store, host, authoritative, clock());
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
