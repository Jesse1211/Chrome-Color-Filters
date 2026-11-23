/**
 * 存活性(**INV-5 / ADR-017**)—— DESIGN.md §6 T4b 第 1 件事。
 *
 * > **1. 存活性(INV-5/ADR-017)** — 站点脚本移除注入物后自动恢复,
 * > observer 开销可控。
 *
 * 本文件把「自动恢复」与「开销可控」两半都做成**机械断言**:
 * - 恢复:三种破坏方式(摘 `data-ccf-on`、摘 `--ccf-filter`、塞 `data-ccf-off`)
 *   各自都能恢复;
 * - 开销:observe 选项逐项断言(不观察子树/childList/characterData、属性白名单),
 *   加上「站点不动时零恢复」与速率上限的放弃行为。
 *
 * 📌 真实栈的存活性(公开 SPA 站内跳转)由 REAL_STACK_GATE 另行验收 ——
 *    本文件不冒充那部分(DESIGN.md §8 第 8 条)。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  type FilterTarget,
  type MutationObserverLike,
  type MutationObserverLikeInit,
  FILTER_ATTR,
  FILTER_VAR,
  OBSERVED_ATTRIBUTES,
  SUPPRESS_ATTR,
  applyFilter,
  currentFilterValue,
  isFilterApplied,
  isFilterSuppressed,
  startLiveness,
} from '../index.js';

function makeTarget(): FilterTarget & {
  attrs: Map<string, string>;
  props: Map<string, string>;
} {
  const attrs = new Map<string, string>();
  const props = new Map<string, string>();
  return {
    attrs,
    props,
    setAttribute: (n, v) => void attrs.set(n, v),
    removeAttribute: (n) => void attrs.delete(n),
    hasAttribute: (n) => attrs.has(n),
    style: {
      setProperty: (n, v) => void props.set(n, v),
      removeProperty: (n) => void props.delete(n),
      getPropertyValue: (n) => props.get(n) ?? '',
    },
  };
}

/**
 * 可手动触发的假 observer —— 模拟「站点脚本改了属性 → 浏览器回调我们」。
 *
 * 这不是用 mock 冒充真实栈:它替代的只是「浏览器何时叫我们」这个**触发器**,
 * 被测的恢复逻辑本体是真的。
 */
function makeObserver(): {
  factory: (cb: () => void) => MutationObserverLike;
  fire: () => void;
  observed: { target: unknown; options: MutationObserverLikeInit }[];
  disconnects: number;
} {
  let callback: (() => void) | null = null;
  const observed: { target: unknown; options: MutationObserverLikeInit }[] = [];
  const state = { disconnects: 0 };
  return {
    observed,
    get disconnects() {
      return state.disconnects;
    },
    fire: () => callback?.(),
    factory: (cb) => {
      callback = cb;
      return {
        observe: (target, options) => void observed.push({ target, options }),
        disconnect: () => void (state.disconnects += 1),
      };
    },
  };
}

const GRAY = 'grayscale(1)';

// ──────────────────── 恢复:三种破坏方式 ────────────────────

describe('🔴 INV-5 / ADR-017 · 站点脚本移除注入物后自动恢复', () => {
  it('站点摘掉 data-ccf-on → 恢复', () => {
    const target = makeTarget();
    applyFilter(target, GRAY);
    const obs = makeObserver();

    const handle = startLiveness({
      target,
      desired: () => GRAY,
      observerFactory: obs.factory,
    });
    expect(handle.started).toBe(true);

    // 站点脚本:`document.documentElement.removeAttribute('data-ccf-on')`
    target.removeAttribute(FILTER_ATTR);
    expect(isFilterApplied(target)).toBe(false); // 破坏确已发生(探针有效)

    obs.fire();

    expect(isFilterApplied(target)).toBe(true);
    expect(currentFilterValue(target)).toBe(GRAY);
    expect(handle.stats().restores).toBe(1);
  });

  it('站点摘掉 --ccf-filter 变量 → 恢复', () => {
    const target = makeTarget();
    applyFilter(target, GRAY);
    const obs = makeObserver();

    const handle = startLiveness({
      target,
      desired: () => GRAY,
      observerFactory: obs.factory,
    });

    // 站点脚本:`el.style.removeProperty('--ccf-filter')`
    target.style.removeProperty(FILTER_VAR);
    expect(currentFilterValue(target)).toBe('');

    obs.fire();

    expect(currentFilterValue(target)).toBe(GRAY);
    expect(isFilterApplied(target)).toBe(true);
    expect(handle.stats().restores).toBe(1);
  });

  it('🔴 站点塞上 data-ccf-off(压制属性)→ 被摘掉,滤镜恢复', () => {
    // 这一格是新架构(ADR-062)特有的破坏方式:压制属性在位时
    // `html[data-ccf-off]` 会把预生成 CSS 压回 none —— 站点只要塞上这个属性
    // 就能关掉滤镜,而它根本不用动 `data-ccf-on`。
    const target = makeTarget();
    applyFilter(target, GRAY);
    const obs = makeObserver();

    const handle = startLiveness({
      target,
      desired: () => GRAY,
      observerFactory: obs.factory,
    });

    target.setAttribute(SUPPRESS_ATTR, '');
    expect(isFilterSuppressed(target)).toBe(true);

    obs.fire();

    expect(isFilterSuppressed(target)).toBe(false);
    expect(isFilterApplied(target)).toBe(true);
    expect(handle.stats().restores).toBe(1);
  });

  it('站点把 --ccf-filter 改成别的值 → 恢复成期望值', () => {
    const target = makeTarget();
    applyFilter(target, GRAY);
    const obs = makeObserver();

    startLiveness({ target, desired: () => GRAY, observerFactory: obs.factory });

    target.style.setProperty(FILTER_VAR, 'invert(1)');
    obs.fire();

    expect(currentFilterValue(target)).toBe(GRAY);
  });

  it('🔴 期望为「不上色」时,站点摘掉 data-ccf-off → 压制属性被补回', () => {
    // 对偶格:不该上色的页面上,压制属性是**必需**的(预生成 CSS 用裸 html)。
    // 站点摘掉它 = 让滤镜出现在一个不该上色的页面上。
    const target = makeTarget();
    target.setAttribute(SUPPRESS_ATTR, '');
    const obs = makeObserver();

    startLiveness({ target, desired: () => null, observerFactory: obs.factory });

    target.removeAttribute(SUPPRESS_ATTR);
    obs.fire();

    expect(isFilterSuppressed(target)).toBe(true);
    expect(isFilterApplied(target)).toBe(false);
  });

  it('🔴 恢复读的是**最新**期望值,不是启动时的快照', () => {
    // 这保证了预览(ADR-049)期间的存活性恢复不会把预览色换回规则色。
    const target = makeTarget();
    applyFilter(target, GRAY);
    const obs = makeObserver();

    let want: string | null = GRAY;
    startLiveness({ target, desired: () => want, observerFactory: obs.factory });

    want = 'grayscale(0.3)'; // 例如:用户正在拖动滑块(预览覆盖)
    target.removeAttribute(FILTER_ATTR);
    obs.fire();

    expect(currentFilterValue(target)).toBe('grayscale(0.3)');
  });
});

// ──────────────────── 开销可控 ────────────────────

describe('🔴 observer 开销可控(DESIGN.md §6 T4b 逐字要求)', () => {
  it('只观察注入目标这一个节点,且 subtree/childList/characterData 全为 false', () => {
    const target = makeTarget();
    const obs = makeObserver();
    startLiveness({ target, desired: () => GRAY, observerFactory: obs.factory });

    expect(obs.observed).toHaveLength(1);
    const { target: observedTarget, options } = obs.observed[0]!;
    expect(observedTarget).toBe(target);
    expect(options.attributes).toBe(true);
    // 🔴 子树是开销的大头(SPA 每秒改上千个后代节点),且我们要守的东西
    //    根本不在子树里。
    expect(options.subtree).toBe(false);
    expect(options.childList).toBe(false);
    // 🔴 characterData 等同于观察页面**文本内容** —— INV-9 / ADR-026 的红线。
    expect(options.characterData).toBe(false);
  });

  it('🔴 属性白名单只含自家三项 —— 站点改 class/lang/dir 不触发回调', () => {
    const target = makeTarget();
    const obs = makeObserver();
    startLiveness({ target, desired: () => GRAY, observerFactory: obs.factory });

    const filter = obs.observed[0]!.options.attributeFilter;
    expect(filter).toBeDefined();
    expect([...filter!].sort()).toEqual(
      [FILTER_ATTR, SUPPRESS_ATTR, 'style'].sort(),
    );
    // 真实站点上 `<html class>` 改动极频繁(暗色模式、滚动锁、框架标记)。
    expect(filter).not.toContain('class');
    expect(filter).not.toContain('lang');
    expect(filter).not.toContain('dir');
  });

  it('OBSERVED_ATTRIBUTES 与 apply-filter 的属性名保持同一真相', () => {
    // 两边若漂移,存活性会守一个不存在的属性(静默失效)。
    expect(OBSERVED_ATTRIBUTES).toContain(FILTER_ATTR);
    expect(OBSERVED_ATTRIBUTES).toContain(SUPPRESS_ATTR);
    expect(OBSERVED_ATTRIBUTES).toHaveLength(3);
  });

  it('🔴 已处于期望状态时零恢复、零 DOM 写入(不自激)', () => {
    const target = makeTarget();
    applyFilter(target, GRAY);
    const obs = makeObserver();
    const handle = startLiveness({
      target,
      desired: () => GRAY,
      observerFactory: obs.factory,
    });

    const setAttr = vi.spyOn(target, 'setAttribute');
    const setProp = vi.spyOn(target.style, 'setProperty');

    // 我们自己写属性也会触发回调 —— 若这里仍写入,就形成
    //「我们写 → 回调 → 又写」的自激循环。
    for (let i = 0; i < 20; i += 1) obs.fire();

    expect(handle.stats().callbacks).toBe(20);
    expect(handle.stats().restores).toBe(0);
    expect(setAttr).not.toHaveBeenCalled();
    expect(setProp).not.toHaveBeenCalled();
  });

  it('🔴 速率超预算 → 停止恢复并断开 observer(页面可用性优先)', () => {
    const target = makeTarget();
    applyFilter(target, GRAY);
    const obs = makeObserver();

    // 时钟**刻意不前进** —— 10 次破坏全部落在同一个窗口内,
    // 于是 3 次预算被耗尽,后 7 次触发放弃。
    const now = 0;
    const handle = startLiveness({
      target,
      desired: () => GRAY,
      observerFactory: obs.factory,
      maxRestoresPerWindow: 3,
      windowMs: 1_000,
      clock: () => now,
    });

    // 模拟「站点脚本在自己的 observer 里反复摘掉我们的属性」。
    for (let i = 0; i < 10; i += 1) {
      target.removeAttribute(FILTER_ATTR);
      obs.fire();
    }

    expect(handle.stats().restores).toBe(3);
    expect(handle.stats().gaveUp).toBe(true);
    expect(obs.disconnects).toBe(1);
  });

  it('跨窗口预算重置 —— 偶发丢失(SPA 路由切换)不会耗尽预算', () => {
    const target = makeTarget();
    applyFilter(target, GRAY);
    const obs = makeObserver();

    let now = 0;
    const handle = startLiveness({
      target,
      desired: () => GRAY,
      observerFactory: obs.factory,
      maxRestoresPerWindow: 2,
      windowMs: 1_000,
      clock: () => now,
    });

    for (let i = 0; i < 10; i += 1) {
      now = i * 1_000; // 每次都落在新窗口
      target.removeAttribute(FILTER_ATTR);
      obs.fire();
    }

    expect(handle.stats().restores).toBe(10);
    expect(handle.stats().gaveUp).toBe(false);
    expect(obs.disconnects).toBe(0);
  });

  it('stop() 断开 observer,且重复调用安全', () => {
    const target = makeTarget();
    const obs = makeObserver();
    const handle = startLiveness({
      target,
      desired: () => GRAY,
      observerFactory: obs.factory,
    });

    handle.stop();
    handle.stop();
    expect(obs.disconnects).toBe(1);

    // 停止后回调不再恢复。
    target.removeAttribute(FILTER_ATTR);
    obs.fire();
    expect(isFilterApplied(target)).toBe(false);
  });

  it('环境无 MutationObserver 时降级为不守护,且不抛异常(INV-1)', () => {
    const target = makeTarget();
    const saved = (globalThis as { MutationObserver?: unknown })
      .MutationObserver;
    try {
      delete (globalThis as { MutationObserver?: unknown }).MutationObserver;
      const handle = startLiveness({ target, desired: () => GRAY });
      expect(handle.started).toBe(false);
      expect(() => handle.stop()).not.toThrow();
      expect(handle.stats().restores).toBe(0);
    } finally {
      if (saved !== undefined) {
        (globalThis as { MutationObserver?: unknown }).MutationObserver = saved;
      }
    }
  });
});
