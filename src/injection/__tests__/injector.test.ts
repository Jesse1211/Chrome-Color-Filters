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

  it('🔴 主开关关闭时清掉快路径缓存 —— 使「关主开关可彻底止血」对后续加载成立', async () => {
    const target = makeTarget();
    const store = makeStore();
    // 预置一条「该滤镜」的陈旧缓存（写入时主开关是开的）。
    writeFastPath(store, 'a.example.com', true, { mode: 'Grayscale', intensity: 100 }, Date.now());
    expect(store.data.size).toBe(1);

    const { settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ masterEnabled: false }),
    });
    await settled;

    expect(store.data.size).toBe(0);
    expect(isFilterApplied(target)).toBe(false);
  });

  it('🔴 主开关 OFF 时写入的条目，永远不会让任何页面上色（同步阶段也不行）', () => {
    const store = makeStore();
    // 主开关关闭的那次导航回写的条目。
    writeFastPath(store, 'a.example.com', false, { mode: 'Grayscale', intensity: 100 }, Date.now());

    const target = makeTarget();
    const { fastPathHit, settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ masterEnabled: false, rules: [GRAY_RULE] }),
    });

    // 🔴 同步阶段**什么都没画** —— INV-8 要的是不注入，不是注入后纠正。
    expect(fastPathHit).toBe(false);
    expect(isFilterApplied(target)).toBe(false);
    expect(target.attrs.size).toBe(0);
    expect(target.props.size).toBe(0);
    settled.catch(() => {});
  });

  it('🔴 INV-8 回归：主开关 OFF 的冷加载，同步阶段一次 DOM 写入都没有', () => {
    // 这是上一轮被评审指出的真实缺陷：同步快路径在 masterEnabled 可知之前
    // 就上色，于是主开关 OFF 时每次冷加载都有一段可见的「已上色」区间。
    // 判别器：直接数 DOM 写入次数，而不是等异步纠正完再看终态
    // （等到那时看到的是纠正后的结果，缺陷会被完全掩盖 —— 正是旧门禁的盲点）。
    const writes: string[] = [];
    const target: FilterTarget = {
      setAttribute: (n) => void writes.push(`setAttribute:${n}`),
      removeAttribute: (n) => void writes.push(`removeAttribute:${n}`),
      hasAttribute: () => false,
      style: {
        setProperty: (n) => void writes.push(`setProperty:${n}`),
        removeProperty: (n) => void writes.push(`removeProperty:${n}`),
        getPropertyValue: () => '',
      },
    };
    const store = makeStore();
    writeFastPath(store, 'a.example.com', false, { mode: 'Grayscale', intensity: 100 }, Date.now());

    const { settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ masterEnabled: false, rules: [GRAY_RULE] }),
    });

    expect(writes).toEqual([]); // 同步阶段零写入
    settled.catch(() => {});
  });

  it('除设置本身外无其他存储读取：匹配不发生，故不触碰规则', () => {
    const match = vi.fn(resolveRule);
    decide(settingsWith({ masterEnabled: false, rules: [GRAY_RULE] }), 'https://a.example.com/', match);
    expect(match).not.toHaveBeenCalled();
  });
});

describe('🔴 INV-8 · 主开关一关立刻抹掉推测（ADR-027「彻底止血」）', () => {
  it('主开关转 OFF 时清缓存并撤滤镜 —— 不留给下次导航的同步阶段去误用', async () => {
    const target = makeTarget();
    const store = makeStore();
    let fire: ((s: FilterSettings) => void) | null = null;

    const { settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
      subscribeSettings: (l) => {
        fire = l;
        return () => {};
      },
    });
    await settled;

    // 此刻:缓存已回写、滤镜已生效。
    expect(store.data.size).toBe(1);
    expect(isFilterApplied(target)).toBe(true);

    // 用户在 popup 里关掉主开关 —— 变更推送到本页。
    expect(fire).not.toBeNull();
    fire!(settingsWith({ masterEnabled: false, rules: [GRAY_RULE] }));

    // 🔴 缓存立刻消失,滤镜立刻撤掉。
    expect(store.data.size).toBe(0);
    expect(isFilterApplied(target)).toBe(false);

    // 于是下一次导航的**同步阶段**读到「无缓存」→ 什么都不画。
    const t2 = makeTarget();
    const { fastPathHit } = runInjector({
      target: t2,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ masterEnabled: false, rules: [GRAY_RULE] }),
    });
    expect(fastPathHit).toBe(false);
    expect(t2.attrs.size).toBe(0);
    expect(t2.props.size).toBe(0);
  });

  it('主开关仍为 ON 的变更不清缓存（不误伤正常的规则编辑）', async () => {
    const store = makeStore();
    let fire: ((s: FilterSettings) => void) | null = null;
    const { settled } = runInjector({
      target: makeTarget(),
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
      subscribeSettings: (l) => { fire = l; return () => {}; },
    });
    await settled;
    expect(store.data.size).toBe(1);

    fire!(settingsWith({ masterEnabled: true, rules: [GRAY_RULE] }));
    expect(store.data.size).toBe(1);
  });
});

// ─────────────────────────── INV-3 快路径 ───────────────────────────

describe('🔴 INV-3 · 同步快路径（chrome.storage 异步性的解法）', () => {
  it('缓存命中时，滤镜在 runInjector 返回之前就已应用（不需要 await）', () => {
    const target = makeTarget();
    const store = makeStore();
    writeFastPath(store, 'a.example.com', true, { mode: 'Grayscale', intensity: 100 }, Date.now());

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

  it('无缓存时同步阶段不应用任何滤镜（不误染）', () => {
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
    writeFastPath(store, 'a.example.com', true, { mode: 'Grayscale', intensity: 100 }, Date.now());

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

// ─────────────────────────── ADR-025 ───────────────────────────

describe('🔴 ADR-025 · 缓存里绝不出现派生值（不制造第二份真相）', () => {
  it('回写的 JSON 只含 (mode,intensity) 等设置值，不含 filter 串/矩阵系数', async () => {
    const store = makeStore();
    const { settled } = runInjector({
      target: makeTarget(),
      store,
      // RedGreen 走 feColorMatrix 路径 —— 派生值最「胖」、最容易被顺手存下来的那种。
      url: 'https://a.example.com/',
      readSettings: async () =>
        settingsWith({ rules: [{ pattern: '*.example.com', mode: 'RedGreen', intensity: 60 }] }),
    });
    await settled;

    const raw = [...store.data.values()][0] as string;
    const derived = filterCssValue('RedGreen', 60);

    // 逐字的派生串不得出现。
    expect(raw).not.toContain(derived);
    // 派生值的特征片段同样不得出现（防止换个编码方式偷渡）。
    expect(raw).not.toContain('feColorMatrix');
    expect(raw).not.toContain('data:image/svg');
    expect(raw).not.toContain('grayscale(');

    // 存的就是那两个设置值本身。
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed['mode']).toBe('RedGreen');
    expect(parsed['intensity']).toBe(60);
  });

  it('派生值在读取时现算：改了 filterCssValue 的输入即刻反映，不会沿用旧串', () => {
    const store = makeStore();
    writeFastPath(store, 'a.example.com', true, { mode: 'RedGreen', intensity: 60 }, Date.now());

    const target = makeTarget();
    const { settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [] }),
    });
    // 同步阶段用的值 === 由存储里那两个设置值现算出来的值。
    expect(target.props.get('--ccf-filter')).toBe(filterCssValue('RedGreen', 60));
    settled.catch(() => {});
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
