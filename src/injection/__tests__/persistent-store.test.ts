/**
 * 快路径持久层 —— INV-3 **冷启动**那一格的回归测试。
 *
 * 这些断言钉住的是一个被实测证实过的真实缺陷:`sessionStorage` 按标签页隔离,
 * 「本标签页首次访问该 host」必然未命中,冷启动首帧因此是未滤镜的彩色帧。
 * 修复的要点只有一句话:**优先选用跨标签页可见的那一层**。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  type FilterSettings,
  defaultSettings,
} from '../../domain/index.js';
import {
  type FilterTarget,
  type SyncKeyValueStore,
  isFilterApplied,
  isStoreUsable,
  runInjector,
  tieredStore,
  writeFastPath,
} from '../index.js';

function makeStore(): SyncKeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function hostileStore(): SyncKeyValueStore {
  return {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('SecurityError');
    },
    removeItem: () => {
      throw new Error('SecurityError');
    },
  };
}

function makeTarget(): FilterTarget & { attrs: Map<string, string> } {
  const attrs = new Map<string, string>();
  const props = new Map<string, string>();
  return {
    attrs,
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

function settingsWith(partial: Partial<FilterSettings>): FilterSettings {
  return { ...defaultSettings(), ...partial };
}

const GRAY_RULE = {
  pattern: '*.example.com',
  mode: 'Grayscale',
  intensity: 100,
} as const;

describe('isStoreUsable · 探测真实可用性而非仅看存在性', () => {
  it('可读写的存储 → 可用', () => {
    expect(isStoreUsable(makeStore())).toBe(true);
  });

  it('一访问就抛 SecurityError 的存储 → 不可用（禁用存储的站点 / data: 文档）', () => {
    expect(isStoreUsable(hostileStore())).toBe(false);
  });

  it('undefined → 不可用', () => {
    expect(isStoreUsable(undefined)).toBe(false);
  });

  it('写进去读不回来的存储（静默吞写入）→ 不可用', () => {
    const silent: SyncKeyValueStore = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
    expect(isStoreUsable(silent)).toBe(false);
  });

  it('探测用完即清，不留下探测键', () => {
    const s = makeStore();
    isStoreUsable(s);
    expect(s.data.size).toBe(0);
  });
});

describe('🔴 tieredStore · 持久层优先（INV-3 冷启动的全部要点）', () => {
  it('两层都可用时选持久层 —— 只有它跨标签页可见', () => {
    const persistent = makeStore();
    const session = makeStore();
    const chosen = tieredStore({ persistent, session });
    chosen.setItem('k', 'v');
    expect(persistent.data.get('k')).toBe('v');
    expect(session.data.has('k')).toBe(false);
  });

  it('持久层不可用时退回会话层（功能降级而非崩溃）', () => {
    const session = makeStore();
    const chosen = tieredStore({ persistent: hostileStore(), session });
    chosen.setItem('k', 'v');
    expect(session.data.get('k')).toBe('v');
  });

  it('两层都不可用时返回永远未命中的空存储，且不抛异常', () => {
    const chosen = tieredStore({
      persistent: hostileStore(),
      session: hostileStore(),
    });
    expect(() => chosen.setItem('k', 'v')).not.toThrow();
    expect(chosen.getItem('k')).toBeNull();
    expect(() => chosen.removeItem('k')).not.toThrow();
  });

  it('两层都缺席（undefined）时同样返回空存储', () => {
    const chosen = tieredStore({});
    expect(chosen.getItem('anything')).toBeNull();
  });
});

describe('🔴 INV-3 冷启动回归 · 跨标签页首访必须同步命中', () => {
  it('标签页 A 写入的判定结果，让「首次访问该 host 的标签页 B」同步命中', async () => {
    // 持久层 = 跨标签页共享的那一份（生产中的 localStorage）。
    const persistent = makeStore();

    // ── 标签页 A:冷启动首访，异步阶段跑完后回写缓存。
    const tabASession = makeStore();
    const { settled } = runInjector({
      target: makeTarget(),
      store: tieredStore({ persistent, session: tabASession }),
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });
    await settled;

    // ── 标签页 B:**全新标签页**，自己的 sessionStorage 是空的。
    //    若快路径只认 sessionStorage，这里必然未命中 —— 那正是冷启动彩色帧的成因。
    const tabBSession = makeStore();
    expect(tabBSession.data.size).toBe(0);

    const targetB = makeTarget();
    const { fastPathHit } = runInjector({
      target: targetB,
      store: tieredStore({ persistent, session: tabBSession }),
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });

    // 🔴 关键断言:同步地（runInjector 返回之前）已经上色 —— 即「首帧之前」。
    expect(fastPathHit).toBe(true);
    expect(isFilterApplied(targetB)).toBe(true);
  });

  it('反证：只有会话层时，新标签页首访确实未命中（证明上面的命中不是假阳性）', () => {
    const persistentOfTabA = makeStore();
    writeFastPath(persistentOfTabA, 'a.example.com', 'grayscale(1)', Date.now());

    // 新标签页只拿到自己的空会话层 —— 没有持久层可用。
    const tabBSession = makeStore();
    const targetB = makeTarget();
    const { fastPathHit, settled } = runInjector({
      target: targetB,
      store: tieredStore({ persistent: hostileStore(), session: tabBSession }),
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });
    expect(fastPathHit).toBe(false);
    expect(isFilterApplied(targetB)).toBe(false);
    settled.catch(() => {});
  });

  it('🔴 INV-8 仍然优先：主开关关闭时，持久层缓存被清掉且不上色', async () => {
    const persistent = makeStore();
    writeFastPath(persistent, 'a.example.com', 'grayscale(1)', Date.now());

    const target = makeTarget();
    const { settled } = runInjector({
      target,
      store: tieredStore({ persistent, session: makeStore() }),
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ masterEnabled: false }),
    });
    await settled;

    expect(persistent.data.size).toBe(0);
    expect(isFilterApplied(target)).toBe(false);
    expect(target.attrs.size).toBe(0);
  });

  it('持久层不枚举：整个流程只触碰本扩展的前缀键（INV-9）', async () => {
    const data = new Map<string, string>();
    const touched: string[] = [];
    const persistent: SyncKeyValueStore = {
      getItem: (k) => {
        touched.push(k);
        return data.get(k) ?? null;
      },
      setItem: (k, v) => {
        touched.push(k);
        data.set(k, v);
      },
      removeItem: (k) => {
        touched.push(k);
        data.delete(k);
      },
    };
    // 页面自己写的键 —— 扩展绝不该碰到它。
    data.set('page-secret', 'do-not-read');

    const { settled } = runInjector({
      target: makeTarget(),
      store: tieredStore({ persistent, session: makeStore() }),
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });
    await settled;

    expect(touched.length).toBeGreaterThan(0);
    for (const k of touched) {
      expect(k.startsWith('__ccf_')).toBe(true);
    }
    expect(data.get('page-secret')).toBe('do-not-read');
  });

  it('选层只在装配时做一次，不在每次读写时重复探测', () => {
    const data = new Map<string, string>();
    const getItem = vi.fn((k: string) => data.get(k) ?? null);
    const persistent: SyncKeyValueStore = {
      getItem,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
    const chosen = tieredStore({ persistent, session: makeStore() });
    const afterProbe = getItem.mock.calls.length;
    chosen.getItem('__ccf_fp_x');
    expect(getItem.mock.calls.length).toBe(afterProbe + 1);
  });
});
