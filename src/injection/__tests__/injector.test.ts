/**
 * 注入编排器 —— 含 T4a gate 逐字要求的 **INV-8 可观察断言**。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  type FilterSettings,
  defaultSettings,
  filterCssValue,
  resolveRule,
} from '../../domain/index.js';
import {
  type FilterTarget,
  type SyncKeyValueStore,
  decide,
  isFilterApplied,
  runInjector,
  writeFastPath,
} from '../index.js';

function makeTarget(): FilterTarget & { attrs: Map<string, string>; props: Map<string, string> } {
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

function makeStore(): SyncKeyValueStore & { data: Map<string, string>; reads: string[] } {
  const data = new Map<string, string>();
  const reads: string[] = [];
  return {
    data,
    reads,
    getItem: (k) => {
      reads.push(k);
      return data.get(k) ?? null;
    },
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function settingsWith(partial: Partial<FilterSettings>): FilterSettings {
  return { ...defaultSettings(), ...partial };
}

const GRAY_RULE = { pattern: '*.example.com', mode: 'Grayscale', intensity: 100 } as const;

// ─────────────────────────── INV-8 ───────────────────────────

describe('🔴 INV-8 / ADR-027 · masterEnabled === false 时完全不工作', () => {
  it('匹配函数零次调用（gate 逐字要求的 spy 断言）', () => {
    const match = vi.fn(resolveRule);
    const result = decide(
      settingsWith({ masterEnabled: false, rules: [GRAY_RULE] }),
      'https://a.example.com/',
      match,
    );
    expect(result).toBeNull();
    expect(match).toHaveBeenCalledTimes(0);
  });

  it('主开关开启时匹配函数才被调用（证明上面的零次不是因为探针失效）', () => {
    const match = vi.fn(resolveRule);
    const result = decide(
      settingsWith({ masterEnabled: true, rules: [GRAY_RULE] }),
      'https://a.example.com/',
      match,
    );
    expect(match).toHaveBeenCalledTimes(1);
    expect(result).toBe(filterCssValue('Grayscale', 100));
  });

  it('🔴 页面中不存在扩展注入的任何属性/变量（gate 第一项）', async () => {
    const target = makeTarget();
    const store = makeStore();
    const { settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () =>
        settingsWith({ masterEnabled: false, rules: [GRAY_RULE] }),
    });
    await settled;
    expect(isFilterApplied(target)).toBe(false);
    expect(target.attrs.size).toBe(0);
    expect(target.props.size).toBe(0);
  });

  it('🔴 主开关关闭时清掉快路径缓存 —— 否则下次导航会用陈旧推测把页面染灰', async () => {
    const target = makeTarget();
    const store = makeStore();
    // 预置一条「该滤镜」的陈旧缓存。
    writeFastPath(store, 'a.example.com', 'grayscale(1)', Date.now());
    expect(store.data.size).toBe(1);

    const { settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ masterEnabled: false }),
    });
    const r = await settled;

    expect(store.data.size).toBe(0);
    expect(isFilterApplied(target)).toBe(false);
    // 同步阶段确实曾按陈旧缓存上过色，异步阶段把它纠正了。
    expect(r.fastPathHit).toBe(true);
    expect(r.corrected).toBe(true);
  });

  it('除设置本身外无其他存储读取：匹配不发生，故不触碰规则', () => {
    const match = vi.fn(resolveRule);
    decide(settingsWith({ masterEnabled: false, rules: [GRAY_RULE] }), 'https://a.example.com/', match);
    expect(match).not.toHaveBeenCalled();
  });
});

// ─────────────────────────── INV-3 快路径 ───────────────────────────

describe('🔴 INV-3 · 同步快路径（chrome.storage 异步性的解法）', () => {
  it('缓存命中时，滤镜在 runInjector 返回之前就已应用（不需要 await）', () => {
    const target = makeTarget();
    const store = makeStore();
    writeFastPath(store, 'a.example.com', 'grayscale(1)', Date.now());

    const { fastPathHit, settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });

    // 关键断言：**同步地**已经生效 —— 这正是「首帧之前」的可测代理。
    expect(fastPathHit).toBe(true);
    expect(isFilterApplied(target)).toBe(true);
    settled.catch(() => {});
  });

  it('无缓存时同步阶段不应用任何滤镜（冷启动首访，已申报的 blindSpot）', () => {
    const target = makeTarget();
    const { fastPathHit, settled } = runInjector({
      target,
      store: makeStore(),
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });
    expect(fastPathHit).toBe(false);
    expect(isFilterApplied(target)).toBe(false);
    settled.catch(() => {});
  });

  it('异步阶段结束后回写缓存，使下一次导航同步命中', async () => {
    const target = makeTarget();
    const store = makeStore();
    const { settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });
    await settled;
    expect(store.data.size).toBe(1);

    // 第二次导航：同步命中。
    const t2 = makeTarget();
    const { fastPathHit } = runInjector({
      target: t2,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });
    expect(fastPathHit).toBe(true);
    expect(isFilterApplied(t2)).toBe(true);
  });

  it('陈旧缓存被权威结果纠正（规则已删除）', async () => {
    const target = makeTarget();
    const store = makeStore();
    writeFastPath(store, 'a.example.com', 'grayscale(1)', Date.now());

    const { settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [] }), // 规则已被删
    });
    const r = await settled;

    expect(r.corrected).toBe(true);
    expect(r.authoritative).toBeNull();
    expect(isFilterApplied(target)).toBe(false);
  });

  it('不匹配的 host 也会被缓存为 null，避免每次导航都白跑异步', async () => {
    const store = makeStore();
    const { settled } = runInjector({
      target: makeTarget(),
      store,
      url: 'https://other.test/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });
    await settled;

    const t2 = makeTarget();
    const { fastPathHit } = runInjector({
      target: t2,
      store,
      url: 'https://other.test/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });
    expect(fastPathHit).toBe(true);
    expect(isFilterApplied(t2)).toBe(false); // 推测「不滤镜」，不误染
  });
});

// ─────────────────────────── 解析语义 ───────────────────────────

describe('decide · 首个命中胜（INV-6）与四种模式', () => {
  it('首个命中的规则生效，且只有它生效', () => {
    const s = settingsWith({
      rules: [
        { pattern: '*.example.com', mode: 'RedGreen', intensity: 60 },
        { pattern: '*', mode: 'Grayscale', intensity: 100 },
      ],
    });
    expect(decide(s, 'https://a.example.com/')).toBe(filterCssValue('RedGreen', 60));
  });

  it('无规则命中 → 不套滤镜', () => {
    expect(decide(settingsWith({ rules: [GRAY_RULE] }), 'https://nope.test/')).toBeNull();
  });

  it('非法 URL → 不套滤镜，不抛异常', () => {
    expect(decide(settingsWith({ rules: [GRAY_RULE] }), 'not a url')).toBeNull();
  });
});

describe('健壮性', () => {
  it('sessionStorage 抛 SecurityError 时不崩溃（data: 文档等上下文）', () => {
    const hostile: SyncKeyValueStore = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
      removeItem: () => { throw new Error('SecurityError'); },
    };
    const target = makeTarget();
    expect(() =>
      runInjector({
        target,
        store: hostile,
        url: 'https://a.example.com/',
        readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
      }).settled.catch(() => {}),
    ).not.toThrow();
  });
});
