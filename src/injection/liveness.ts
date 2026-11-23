/**
 * 存活性(**INV-5 / ADR-017**)—— 站点脚本移除注入物后自动恢复。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 新架构(ADR-062)下「注入物」到底是什么 —— 这决定了要守什么
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * T4a 之后首帧样式来自**声明式注册的预生成 CSS 文件**(ADR-062/063),
 * 不再是 JS 插的 `<style>` 节点。于是注入物只剩下 `documentElement` 上的
 * 三样东西(见 `apply-filter.ts`):
 *
 * - `data-ccf-on`   属性 —— 门控「上色」
 * - `data-ccf-off`  属性 —— 门控「明确不上色」(压制预生成 CSS)
 * - `--ccf-filter`  CSS 自定义属性 —— 承载 filter 值
 *
 * 站点脚本能做的破坏因此也只有这三种(外加「给 html 塞自己的 filter」,
 * 那一项由 `filter.css` 的 `!important` 对抗,见该文件头注释)。
 *
 * 🔴 **注意恢复路径仍然是 JS**,哪怕首帧由 CSS 文件负责:
 * 浏览器注入的样式表本身站点脚本碰不到(它不在页面的 `document.styleSheets`
 * 可写范围内),但**属性**是页面 DOM 的一部分,`removeAttribute` 一行就能摘掉。
 * 摘掉 `data-ccf-on` 后:
 * - 已注册 CSS 文件的站点 → 裸 `html` 规则仍在,滤镜**不会**消失;
 * - 但 `--ccf-filter` 被摘掉 → `filter: var(--ccf-filter)` 失效;
 * - 且 `data-ccf-off` 被**塞上** → 压制规则命中,滤镜被撤。
 *
 * 三种破坏都必须能恢复,而恢复只能靠 JS 重新写回属性 —— 这就是本模块。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## observer 开销可控(DESIGN.md §6 T4b 逐字要求)
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 开销由四件事一起压到最小,**每一条都是实现义务,不是优化**:
 *
 * 1. **不观察子树。** `subtree: false` + 只观察 `documentElement` 这**一个**节点。
 *    SPA 每秒可能改动上千个后代节点,`subtree: true` 会让回调变成热路径 ——
 *    而我们要守的东西根本不在子树里。
 * 2. **不观察 childList / characterData。** 只 `attributes: true`。
 *    `characterData` 等同于观察页面**文本内容**,那是 INV-9/ADR-026
 *    的红线;本模块连看的能力都不要。
 * 3. **属性过滤。** `attributeFilter` 只列我们自己的三个名字
 *    (`data-ccf-on`/`data-ccf-off`/`style`)。站点改 `class`、`lang`、
 *    `dir` 一概不触发回调 —— 真实站点上 `<html class>` 的改动极频繁
 *    (暗色模式、滚动锁、各类框架标记)。
 * 4. **幂等 + 零写入短路。** 恢复走 `syncFilter`,它在已处于期望状态时
 *    **不做任何 DOM 写入**。这关掉了「我们写 → observer 回调 → 又写」的
 *    自激循环:回调里调 `syncFilter`,若状态已对则不写,循环自然终止。
 *
 * ## 为什么还需要一道速率上限
 *
 * 上面第 4 条终止的是**我们自己**造成的循环。但存在一种站点行为它挡不住:
 * 站点脚本在自己的 MutationObserver 里**反复**摘掉我们的属性
 * (「清理未知属性」的框架确实存在)。那会形成 **站点写 ↔ 我们写** 的
 * 跨主体循环,两边都「合理」,结果是主线程被两个 observer 占满。
 *
 * 故本模块带一个**可配置的恢复预算**:同一个时间窗内恢复次数超过上限时
 * **停止恢复并断开 observer**(`disconnect`),把页面让给站点。
 * 理由是 ADR-017 的本意 ——
 *
 * > 滤镜被站点脚本清除后**自动监测并恢复**:SPA 场景下滤镜莫名消失会被当成 bug
 *
 * —— 它要解决的是「SPA 路由切换顺手清掉了属性」这类**偶发**丢失,
 * 不是「与站点抢夺同一个属性」。抢不过时,**页面可用性优先于滤镜**
 * (INV-1 的精神:扩展不得让页面变卡)。放弃是可观测的,见 `LivenessHandle.stats`。
 */

import { type FilterTarget, syncFilter } from './apply-filter.js';
import { FILTER_ATTR, SUPPRESS_ATTR } from './apply-filter.js';

/**
 * 被观察的属性白名单。
 *
 * `style` 在列是因为 `--ccf-filter` 是**内联自定义属性**,站点若
 * `el.style.removeProperty('--ccf-filter')` 或整体 `removeAttribute('style')`,
 * 反映到 MutationObserver 上就是 `attributeName === 'style'`。
 */
export const OBSERVED_ATTRIBUTES: readonly string[] = [
  FILTER_ATTR,
  SUPPRESS_ATTR,
  'style',
];

/**
 * MutationObserver 的最小可注入抽象 —— 只要本模块真正用到的那几项。
 *
 * 抽成接口的理由同 `FilterTarget`:让「恢复逻辑是否正确」这件**与浏览器
 * 无关**的事能在 Node 下机械单测。真实栈的存活性(SPA 站内跳转)
 * 由 REAL_STACK_GATE 另行验收 —— 本接口不冒充那部分(DESIGN.md §8 第 8 条)。
 */
export interface MutationObserverLike {
  observe(target: unknown, options: MutationObserverLikeInit): void;
  disconnect(): void;
}

export interface MutationObserverLikeInit {
  readonly attributes?: boolean;
  readonly attributeFilter?: readonly string[];
  readonly subtree?: boolean;
  readonly childList?: boolean;
  readonly characterData?: boolean;
}

/** 构造 observer 的工厂 —— 生产环境即 `(cb) => new MutationObserver(cb)`。 */
export type MutationObserverFactory = (
  callback: () => void,
) => MutationObserverLike;

export interface LivenessOptions {
  /** 注入目标 —— 生产环境恒为 `document.documentElement`。 */
  readonly target: FilterTarget;
  /**
   * 读取**当前应有**的 filter 值(`null` = 不应上色)。
   *
   * 🔴 用回调而不是传值:期望状态会变(`onChanged`、预览),
   * 本模块必须每次恢复时读**最新**的那个,否则会把页面恢复成陈旧值。
   * 这也是预览(ADR-049)能被存活性正确守护的原因 —— 预览活动期间
   * 这个回调返回的是**预览值**,被站点摘掉后恢复的也是预览值。
   */
  readonly desired: () => string | null;
  /** observer 工厂;缺省时用全局 `MutationObserver`,取不到则不启动。 */
  readonly observerFactory?: MutationObserverFactory;
  /** 速率上限:一个窗口内允许的恢复次数。默认 60。 */
  readonly maxRestoresPerWindow?: number;
  /** 速率窗口长度(毫秒)。默认 1000。 */
  readonly windowMs?: number;
  /** 时钟,默认 `Date.now`(便于测速率窗口边界)。 */
  readonly clock?: () => number;
}

export interface LivenessStats {
  /** 回调被触发的次数(含无需恢复的那些)。 */
  readonly callbacks: number;
  /** 真正执行过恢复(有 DOM 写入)的次数。 */
  readonly restores: number;
  /** 是否因超预算而放弃(observer 已断开)。 */
  readonly gaveUp: boolean;
}

export interface LivenessHandle {
  /** 是否真的启动了 observer(无 MutationObserver 实现时为 false)。 */
  readonly started: boolean;
  /** 停止观察。重复调用安全。 */
  readonly stop: () => void;
  /** 当前统计 —— 供 gate 做「开销可控」的机械断言。 */
  readonly stats: () => LivenessStats;
}

/**
 * 启动存活性守护。
 *
 * 返回的 handle 必须在 content script 的生命周期内一直持有 ——
 * 页面卸载时浏览器会自行回收 observer,无需手动清理。
 */
export function startLiveness(options: LivenessOptions): LivenessHandle {
  const clock = options.clock ?? Date.now;
  const maxRestores = options.maxRestoresPerWindow ?? 60;
  const windowMs = options.windowMs ?? 1_000;

  const factory = options.observerFactory ?? defaultObserverFactory();

  let callbacks = 0;
  let restores = 0;
  let gaveUp = false;
  let stopped = false;

  // 速率窗口:记录窗口起点与窗口内的恢复次数。
  let windowStart = clock();
  let inWindow = 0;

  const stats = (): LivenessStats => ({ callbacks, restores, gaveUp });

  if (factory === null) {
    // 环境里没有 MutationObserver(例如某些 `data:`/沙箱文档)。
    // 存活性降级为「不守护」,但**绝不抛异常** —— content script
    // 抛到页面上就是 INV-1 的破坏(见 content.ts 对 settled.catch 的注释)。
    return { started: false, stop: () => undefined, stats };
  }

  const observer = factory(() => {
    if (stopped || gaveUp) return;
    callbacks += 1;

    const want = options.desired();

    // 已处于期望状态 → `syncFilter` 零写入,这里也不计恢复次数。
    // 先自己判一次是为了让 `restores` 这个统计有意义(gate 要断言
    //「站点不动时恢复次数为 0」,靠 syncFilter 内部短路是看不出来的)。
    if (isInDesiredState(options.target, want)) return;

    // ── 速率上限 ───────────────────────────────────────────────────────
    const now = clock();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      inWindow = 0;
    }
    inWindow += 1;
    if (inWindow > maxRestores) {
      // 抢不过站点 → 放弃并断开。页面可用性优先(见头注释)。
      gaveUp = true;
      observer.disconnect();
      return;
    }

    restores += 1;
    syncFilter(options.target, want);
  });

  observer.observe(options.target, {
    attributes: true,
    // 🔴 只列自家属性 —— 站点改 class/lang/dir 一概不触发(头注释第 3 条)。
    attributeFilter: [...OBSERVED_ATTRIBUTES],
    // 🔴 下面三个 false 是 INV-9/ADR-026 与「开销可控」的双重要求。
    subtree: false,
    childList: false,
    characterData: false,
  });

  return {
    started: true,
    stop: () => {
      if (stopped) return;
      stopped = true;
      observer.disconnect();
    },
    stats,
  };
}

/**
 * 目标是否已处于期望状态。
 *
 * 与 `syncFilter` 的判定条件严格对偶 —— 两者若不一致,会出现
 * 「这里说已达标、syncFilter 却仍写入」(恢复次数统计失真)
 * 或反之(该恢复时不恢复)。
 */
function isInDesiredState(target: FilterTarget, want: string | null): boolean {
  if (want === null) {
    // 「不该上色」的达标条件:没有 `data-ccf-on`,且**有** `data-ccf-off`
    // (压制属性必须在位,否则预生成的裸 `html` CSS 仍在生效 ——
    //  见 apply-filter.ts 对 SUPPRESS_ATTR 的长注释)。
    return (
      !target.hasAttribute(FILTER_ATTR) && target.hasAttribute(SUPPRESS_ATTR)
    );
  }
  return (
    target.hasAttribute(FILTER_ATTR) &&
    !target.hasAttribute(SUPPRESS_ATTR) &&
    target.style.getPropertyValue('--ccf-filter') === want
  );
}

interface GlobalWithMutationObserver {
  MutationObserver?: new (callback: () => void) => MutationObserverLike;
}

/** 生产工厂:全局 `MutationObserver`。取不到时返回 `null`(降级为不守护)。 */
function defaultObserverFactory(): MutationObserverFactory | null {
  const Ctor = (globalThis as unknown as GlobalWithMutationObserver)
    .MutationObserver;
  if (typeof Ctor !== 'function') return null;
  return (callback) => new Ctor(callback);
}
