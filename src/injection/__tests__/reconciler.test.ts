/**
 * `Reconciler` 门禁 —— 四个触发点与并发串行化(ADR-062/064/065)。
 *
 * 本文件的重点是 `reconcile.test.ts` **测不到**的那一层:
 * 幂等保证「顺序执行两次 = 执行一次」,但两次**交错**执行是另一回事 ——
 * Chrome 对重复 id 的 `registerContentScripts` 会抛 `Duplicate script ID`,
 * 而抛错会让**整批**注册失败,连带本来没问题的那些也装不上。
 * 于是一次并发就能让滤镜整体失效。
 *
 * 见 `reconciler.ts` 的类注释与 `reconcile.test.ts` 里那条
 * 「裸并发确实危险」的对照组。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FilterMode,
  type FilterSettings,
  type Intensity,
  defaultSettings,
} from '../../domain/index.js';
import {
  type RegisteredScriptLike,
  type Registration,
  type ScriptingPort,
} from '../reconcile.js';
import { Reconciler } from '../reconciler.js';

/** 可控延迟的假端口 —— 延迟是制造交错的手段。 */
class SlowScriptingPort implements ScriptingPort {
  registered = new Map<string, Registration>();
  readonly calls: string[] = [];
  /** 每个平台调用前插入的 microtask 轮数(制造交错窗口)。 */
  delayTicks = 2;

  async #tick(): Promise<void> {
    for (let i = 0; i < this.delayTicks; i++) await Promise.resolve();
  }

  async getRegisteredContentScripts(): Promise<readonly RegisteredScriptLike[]> {
    await this.#tick();
    this.calls.push('get');
    return [...this.registered.values()];
  }

  async registerContentScripts(scripts: readonly Registration[]): Promise<void> {
    await this.#tick();
    this.calls.push(`register:${scripts.map((s) => s.id).join(',')}`);
    for (const s of scripts) {
      // 复刻 Chrome 的真实行为 —— 不复刻就测不出并发缺陷。
      if (this.registered.has(s.id)) {
        throw new Error(`Duplicate script ID '${s.id}'`);
      }
      this.registered.set(s.id, s);
    }
  }

  async unregisterContentScripts(filter: {
    ids: readonly string[];
  }): Promise<void> {
    await this.#tick();
    this.calls.push(`unregister:${[...filter.ids].join(',')}`);
    for (const id of filter.ids) this.registered.delete(id);
  }

  async updateContentScripts(scripts: readonly Registration[]): Promise<void> {
    await this.#tick();
    this.calls.push(`update:${scripts.map((s) => s.id).join(',')}`);
    for (const s of scripts) this.registered.set(s.id, s);
  }

  get mutations(): string[] {
    return this.calls.filter((c) => c !== 'get');
  }
}

function settingsWith(
  rules: readonly { pattern: string; mode: FilterMode; intensity: Intensity }[],
  overrides: Partial<FilterSettings> = {},
): FilterSettings {
  return { ...defaultSettings(), rules, ...overrides };
}

const TWO_RULES = settingsWith([
  { pattern: 'weibo.com', mode: 'Grayscale', intensity: 100 },
  { pattern: 'zhihu.com', mode: 'RedGreen', intensity: 60 },
]);

let port: SlowScriptingPort;
beforeEach(() => {
  port = new SlowScriptingPort();
});

// ───────────────────────────────────────────────────────────────────────────
describe('🔴 并发串行化 —— 幂等不足以替代它', () => {
  it('四个触发点同时到达 → 不抛错,注册集合正确', async () => {
    const reconciler = new Reconciler({
      port,
      readSettings: async () => TWO_RULES,
    });

    await Promise.all([
      reconciler.request('installed'),
      reconciler.request('startup'),
      reconciler.request('rules-changed'),
      reconciler.request('storage-changed'),
    ]);
    await reconciler.settled();

    expect([...port.registered.keys()].sort()).toEqual([
      'ccf-gray-100',
      'ccf-redgreen-60',
    ]);
  });

  it('🔴 不会对同一个 id 调两次 register(Duplicate script ID 的根源)', async () => {
    const reconciler = new Reconciler({
      port,
      readSettings: async () => TWO_RULES,
    });

    await Promise.all(
      Array.from({ length: 8 }, () => reconciler.request('storage-changed')),
    );
    await reconciler.settled();

    const registerCalls = port.mutations.filter((m) =>
      m.startsWith('register:'),
    );
    // 每个 id 最多被 register 一次 —— 这是串行化真正买到的东西。
    const registeredIds = registerCalls
      .flatMap((c) => c.slice('register:'.length).split(','))
      .filter((s) => s.length > 0);
    expect(new Set(registeredIds).size).toBe(registeredIds.length);
  });

  it('🔴 10 次并发请求下 register 调用次数远少于 10(请求被合并)', async () => {
    const reconciler = new Reconciler({
      port,
      readSettings: async () => TWO_RULES,
    });
    await Promise.all(
      Array.from({ length: 10 }, () => reconciler.request('storage-changed')),
    );
    await reconciler.settled();

    // 排队深度为 1:攒十次也只会得到同一个结果,跑一次就够。
    expect(port.mutations.length).toBeLessThanOrEqual(2);
    expect([...port.registered.keys()].sort()).toEqual([
      'ccf-gray-100',
      'ccf-redgreen-60',
    ]);
  });

  it('串行执行:任一时刻最多一个 reconcile 在跑', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const tracking: ScriptingPort = {
      getRegisteredContentScripts: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        await Promise.resolve();
        inFlight--;
        return [...port.registered.values()];
      },
      registerContentScripts: (s) => port.registerContentScripts(s),
      unregisterContentScripts: (f) => port.unregisterContentScripts(f),
      updateContentScripts: (s) => port.updateContentScripts(s),
    };
    const reconciler = new Reconciler({
      port: tracking,
      readSettings: async () => TWO_RULES,
    });
    await Promise.all(
      Array.from({ length: 5 }, () => reconciler.request('storage-changed')),
    );
    await reconciler.settled();
    expect(maxInFlight).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('🔴 ADR-065 · installed 触发走强制重建', () => {
  it("trigger='installed' → forceRebuild(即使回读陈旧也重建)", async () => {
    // 先建立注册。
    const r1 = new Reconciler({ port, readSettings: async () => TWO_RULES });
    await r1.request('storage-changed');
    await r1.settled();
    port.calls.length = 0;

    // 扩展更新:Chrome 清除注册,但回读仍是陈旧内容。
    // 此时按 diff 走会判定「都没变」→ 什么都不做 → 滤镜静默失效。
    const r2 = new Reconciler({ port, readSettings: async () => TWO_RULES });
    await r2.request('installed');
    await r2.settled();

    // 强制重建 → 看得见 unregister + register,而不是 no-op。
    expect(port.mutations.some((m) => m.startsWith('unregister:'))).toBe(true);
    expect(port.mutations.some((m) => m.startsWith('register:'))).toBe(true);
    expect([...port.registered.keys()].sort()).toEqual([
      'ccf-gray-100',
      'ccf-redgreen-60',
    ]);
  });

  it("其余 trigger 不强制重建(走 diff,第二次是 no-op)", async () => {
    const reconciler = new Reconciler({
      port,
      readSettings: async () => TWO_RULES,
    });
    await reconciler.request('startup');
    await reconciler.settled();
    port.calls.length = 0;

    await reconciler.request('startup');
    await reconciler.settled();
    expect(port.mutations).toEqual([]);
  });

  it('🔴 forceRebuild 在合并时是**粘滞**的(不被普通触发吃掉)', async () => {
    const reconciler = new Reconciler({
      port,
      readSettings: async () => TWO_RULES,
    });
    // 先建立注册,使「陈旧回读 + diff 判定 no-op」的条件成立。
    await reconciler.request('storage-changed');
    await reconciler.settled();
    port.calls.length = 0;

    // 一个 installed 排在一串普通触发中间。
    // 若合并时把 forceRebuild 丢了,整批就会退化成 no-op ——
    // 扩展更新后的重建被一次普通 storage 变更「吃掉」。
    const all = Promise.all([
      reconciler.request('storage-changed'),
      reconciler.request('installed'),
      reconciler.request('storage-changed'),
      reconciler.request('startup'),
    ]);
    await all;
    await reconciler.settled();

    expect(
      port.mutations.some((m) => m.startsWith('unregister:')),
      '强制重建的证据(unregister)丢失 —— forceRebuild 被合并掉了',
    ).toBe(true);
    expect([...port.registered.keys()].sort()).toEqual([
      'ccf-gray-100',
      'ccf-redgreen-60',
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Reconciler · 读设置失败不抛(SW 回调里的 unhandled rejection)', () => {
  it('readSettings 抛错 → 结果 ok=false,但 request 本身 resolve', async () => {
    const results: string[] = [];
    const reconciler = new Reconciler({
      port,
      readSettings: async () => {
        throw new Error('storage unavailable');
      },
      onResult: (r) => results.push(r.errors.join('|')),
    });
    const result = await reconciler.request('startup');
    await reconciler.settled();
    expect(result).toBeDefined();
    expect(results.join()).toContain('readSettings');
  });

  it('onResult 收到 trigger,便于诊断「注册静默失败」', async () => {
    const seen: string[] = [];
    const reconciler = new Reconciler({
      port,
      readSettings: async () => TWO_RULES,
      onResult: (_r, trigger) => seen.push(trigger),
    });
    await reconciler.request('installed');
    await reconciler.settled();
    expect(seen).toContain('installed');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Reconciler · 设置变化被如实反映(规则增删改路径)', () => {
  it('request 返回后注册已反映刚写的设置(popup 立即关闭也不丢)', async () => {
    let current: FilterSettings = defaultSettings();
    const reconciler = new Reconciler({
      port,
      readSettings: async () => current,
    });

    current = settingsWith([
      { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
    ]);
    await reconciler.request('rules-changed');
    await reconciler.settled();
    expect([...port.registered.keys()]).toEqual(['ccf-gray-100']);

    current = defaultSettings(); // 规则被删
    await reconciler.request('rules-changed');
    await reconciler.settled();
    expect([...port.registered.keys()]).toEqual([]);
  });

  it('🔴 INV-8:主开关关掉 → 注册被清空(ADR-027 彻底止血)', async () => {
    let current: FilterSettings = settingsWith([
      { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
    ]);
    const reconciler = new Reconciler({
      port,
      readSettings: async () => current,
    });
    await reconciler.request('rules-changed');
    await reconciler.settled();
    expect([...port.registered.keys()]).toEqual(['ccf-gray-100']);

    current = { ...current, masterEnabled: false };
    await reconciler.request('storage-changed');
    await reconciler.settled();
    expect([...port.registered.keys()]).toEqual([]);
  });

  it('busy 在空闲时为 false(队列真的排空了,不是永远「在忙」)', async () => {
    const reconciler = new Reconciler({
      port,
      readSettings: async () => TWO_RULES,
    });
    await reconciler.request('startup');
    await reconciler.settled();
    expect(reconciler.busy).toBe(false);
  });
});

describe('vi spy 可用性自检', () => {
  it('spy 基础设施正常', () => {
    const spy = vi.fn();
    spy();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
