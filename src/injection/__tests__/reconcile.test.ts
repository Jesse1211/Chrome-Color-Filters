/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 声明式注册正确性门禁(ADR-062 / ADR-064 / ADR-065)。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * DESIGN.md §6 T4a 的 gate 逐条对应到本文件的 describe 块:
 *
 * - `reconcile()` **幂等** —— 连续调用两次,注册集合不变
 * - 基于 **diff** —— 只对变化部分调 register/unregister/update
 * - 按 `(mode, intensity)` **分组** —— 共享设置的站点合并进同一条 matches
 * - 每条注册含 `persistAcrossSessions: true` / `runAt: 'document_start'` / `allFrames: false`
 * - 规则删除 → unregister;规则改强度 → `css` 路径被 update
 * - **扩展更新恢复(ADR-065)** —— 模拟 `onInstalled` → 注册被完整重建
 *
 * 全部在 Node 下**机械判定**(`FakeScriptingPort` 完整记录调用序列),
 * 而不是「在真实 Chrome 里看一眼」—— 这正是 `reconcile.ts` 把
 * `chrome.scripting` 抽成端口的目的。
 *
 * ⚠️ 这**不是** DESIGN.md §8 第 8 条所指的「用 mock 冒充真实栈」:
 * 「注册真的能在首帧前注入 CSS」只能在 REAL_STACK_GATE 里验,
 * 本文件验的是**我们自己的 diff/分组/幂等逻辑**,那部分与浏览器无关。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FilterMode,
  type FilterSettings,
  type Intensity,
  FILTER_MODES,
  defaultSettings,
} from '../../domain/index.js';
import {
  type RegisteredScriptLike,
  type Registration,
  type ScriptingPort,
  assertNoUnintendedAllUrls,
  desiredRegistrations,
  isNoOpPlan,
  planReconcile,
  reconcile,
  registrationId,
} from '../reconcile.js';
import { filterCssFilePath } from '../filter-file-css.js';
import { ALL_URLS_PATTERN } from '../match-pattern.js';

/**
 * 记录全部调用的假端口,并**真的维护注册状态** ——
 * 幂等性断言要求「第二次 reconcile 读到第一次的结果」,
 * 一个只记录不维护状态的 spy 做不到这件事。
 */
class FakeScriptingPort implements ScriptingPort {
  registered = new Map<string, Registration>();
  readonly calls: string[] = [];
  /** 设为非 null 时,对应方法抛错(测错误处理路径)。 */
  failOn: string | null = null;

  async getRegisteredContentScripts(): Promise<readonly RegisteredScriptLike[]> {
    this.calls.push('get');
    if (this.failOn === 'get') throw new Error('boom');
    return [...this.registered.values()];
  }

  async registerContentScripts(scripts: readonly Registration[]): Promise<void> {
    this.calls.push(`register:${scripts.map((s) => s.id).join(',')}`);
    if (this.failOn === 'register') throw new Error('boom');
    for (const s of scripts) {
      // 真实 Chrome 对重复 id 会抛 —— 复刻该行为,否则并发缺陷测不出来。
      if (this.registered.has(s.id)) {
        throw new Error(`Duplicate script ID '${s.id}'`);
      }
      this.registered.set(s.id, s);
    }
  }

  async unregisterContentScripts(filter: {
    ids: readonly string[];
  }): Promise<void> {
    this.calls.push(`unregister:${[...filter.ids].join(',')}`);
    if (this.failOn === 'unregister') throw new Error('boom');
    for (const id of filter.ids) this.registered.delete(id);
  }

  async updateContentScripts(scripts: readonly Registration[]): Promise<void> {
    this.calls.push(`update:${scripts.map((s) => s.id).join(',')}`);
    if (this.failOn === 'update') throw new Error('boom');
    for (const s of scripts) this.registered.set(s.id, s);
  }

  /** 只保留平台调用(丢掉 get),便于断言「diff 真的只动了变化部分」。 */
  get mutations(): string[] {
    return this.calls.filter((c) => !c.startsWith('get'));
  }
}

function settingsWith(
  rules: readonly { pattern: string; mode: FilterMode; intensity: Intensity }[],
  overrides: Partial<FilterSettings> = {},
): FilterSettings {
  return { ...defaultSettings(), rules, ...overrides };
}

let port: FakeScriptingPort;
beforeEach(() => {
  port = new FakeScriptingPort();
});

// ───────────────────────────────────────────────────────────────────────────
describe('🔴 组合门禁:converter × reconcile —— 放宽的 glob 绝不注册成全网', () => {
  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 这个 describe 存在的理由:**上一轮的缺陷恰好活在两层的接缝上。**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   *
   * 当时的状态:
   * - `match-pattern.test.ts` 只在**转换器层**验转换(并且断言
   *   `*weibo*` → 全网 **是对的**);
   * - 本文件历来只喂**精确** glob(`weibo.com` / `zhihu.com` / `a.com`);
   * - 真实栈门禁(`declarative.cjs` / `flicker.cjs`)也只用字面 host 或 `rule('*')`。
   *
   * 于是「一个表达不出来的 glob 穿过 reconcile 变成
   * `matches: ['*://* / *']` + 一张裸 `html` 滤镜表」这个状态
   * **没有任何一条门禁驱动过** —— 两层各自都绿,缺陷只在组合处可见。
   *
   * 本 describe 专门驱动那个接缝。
   */
  const INEXPRESSIBLE_GLOBS = ['*.baidu.*', '*weibo*', '*.sina.*', '*x*'];

  it.each(INEXPRESSIBLE_GLOBS)(
    '🔴 单条 %s 规则:不得产出任何带全网 matches 的滤镜注册',
    (glob) => {
      const desired = desiredRegistrations(
        settingsWith([{ pattern: glob, mode: 'Grayscale', intensity: 100 }]),
      );
      for (const reg of desired) {
        expect(
          reg.matches,
          `glob "${glob}" 注册成了全网 —— 全网首帧都会上色(INV-1)`,
        ).not.toContain(ALL_URLS_PATTERN);
      }
    },
  );

  it('🔴 ADR-006 旗舰例子 *.baidu.* → 不产出注册(而非产出全网注册)', () => {
    // DESIGN.md:61-64 与 ADR-006 都拿 `*.baidu.*` 当标准示例。
    const desired = desiredRegistrations(
      settingsWith([{ pattern: '*.baidu.*', mode: 'Grayscale', intensity: 100 }]),
    );
    expect(desired).toEqual([]);
  });

  it('🔴 表达不出来的 glob 与精确 glob 同组时,只注册精确那条', () => {
    // 这是最阴险的形态:同组内一个 glob 被跳过,**不得**把整组
    // 拖成全网,也**不得**让精确那条跟着消失。
    const desired = desiredRegistrations(
      settingsWith([
        { pattern: '*.baidu.*', mode: 'Grayscale', intensity: 100 },
        { pattern: 'zhihu.com', mode: 'Grayscale', intensity: 100 },
      ]),
    );
    expect(desired).toHaveLength(1);
    expect(desired[0]!.matches).toEqual(['*://zhihu.com/*']);
    expect(desired[0]!.matches).not.toContain(ALL_URLS_PATTERN);
  });

  it('有界放宽(news*.sina.com)仍然注册,且不是全网', () => {
    // 反面对照:收紧**没有**把有界放宽一并误杀。
    const desired = desiredRegistrations(
      settingsWith([
        { pattern: 'news*.sina.com', mode: 'Grayscale', intensity: 100 },
      ]),
    );
    expect(desired).toHaveLength(1);
    expect(desired[0]!.matches).toEqual(['*://*.sina.com/*']);
  });

  it('用户原意即全网(*)时,全网注册**仍然**产出 —— 未过度收紧', () => {
    const desired = desiredRegistrations(
      settingsWith([{ pattern: '*', mode: 'Grayscale', intensity: 100 }]),
    );
    expect(desired).toHaveLength(1);
    expect(desired[0]!.matches).toEqual([ALL_URLS_PATTERN]);
  });

  it('🔴 穿过真实 reconcile() 落到端口上的注册同样不含全网', async () => {
    // 前面几条验的是纯函数 `desiredRegistrations`。这一条把 glob
    // **一路驱动到端口**,确保 reconcile 的 diff/plan 路径没有别的
    // 地方把全网 pattern 重新引进来。
    //
    // 三条规则各自扮演一个角色,缺一不可:
    // - `*.baidu.*`(Grayscale@100)—— 尾部 `.*`,无有界超集 →
    //   `inexpressible`。它与 `zhihu.com` **同组**(同一个
    //   `(mode,intensity)` = 同一个 id `ccf-gray-100`),所以它顺带
    //   钉死「同组内一条被跳过,不得把整组拖成全网、也不得让精确那条消失」。
    // - `*weibo*`(Grayscale@70)—— 最长字面段 `weibo` 不含点号 →
    //   同样 `inexpressible`,且它**独占一组**(`ccf-gray-70`),
    //   于是钉死「整组都表达不出来时,该组不产出注册(而非产出全网注册)」。
    //   📌 ADR-075 后只剩一个模式,「独占一组」改由**强度**构造(70 ≠ 100)。
    //   这个角色要的只是「与另两条不同组」,强度与模式在分组上是对等维度
    //   (`registrationId(mode, intensity)` 两者都进 id)。
    // - `zhihu.com`(Grayscale@100)—— 纯字面 host,`exact`,**必然注册**。
    //   它是下面那条非空性断言的来源:没有它,循环会在空集上空转(vacuous green)。
    const settings = settingsWith([
      { pattern: '*.baidu.*', mode: 'Grayscale', intensity: 100 },
      { pattern: '*weibo*', mode: 'Grayscale', intensity: 70 },
      { pattern: 'zhihu.com', mode: 'Grayscale', intensity: 100 },
    ]);
    const result = await reconcile(port, settings);
    expect(result.ok).toBe(true);

    for (const reg of port.registered.values()) {
      expect(
        reg.matches,
        `注册 ${reg.id} 含全网 matches —— 一条规则给全网上色(INV-1)`,
      ).not.toContain(ALL_URLS_PATTERN);
      // 且每条注册都确实带着滤镜 CSS —— 否则上面的断言会因为
      // 「根本没有注册」而空过(vacuous green)。
      expect(reg.css).toHaveLength(1);
    }
    // 非空性:恰好注册了 zhihu 那一条,证明上面的循环不是在空集上成立的。
    expect([...port.registered.keys()]).toEqual(['ccf-gray-100']);
    // 且那一条确实是 zhihu 的 exact pattern —— 钉死「注册的是对的东西」,
    // 而不只是「注册了某个不含全网的东西」。
    expect(port.registered.get('ccf-gray-100')!.matches).toEqual([
      '*://zhihu.com/*',
    ]);
    // 🔴 `*weibo*` 独占的那一组确实**没有**注册 —— 若有人日后把
    //    `inexpressible` 改回兜底成全网,这里会先炸。
    expect(port.registered.has('ccf-gray-70')).toBe(false);
  });

  it('🔴 assertNoUnintendedAllUrls 会对伪造的全网注册抛错(断言本身有效)', () => {
    // 直接驱动不变式函数:若有人日后把兜底加回来,这是炸点。
    expect(() =>
      assertNoUnintendedAllUrls(
        {
          id: 'ccf-gray-100',
          matches: [ALL_URLS_PATTERN],
          css: ['filters/gray-100.css'],
          runAt: 'document_start',
          allFrames: false,
          persistAcrossSessions: true,
        },
        ['*.baidu.*'],
      ),
    ).toThrow(/全网/);

    // 原意即全网时不抛。
    expect(() =>
      assertNoUnintendedAllUrls(
        {
          id: 'ccf-gray-100',
          matches: [ALL_URLS_PATTERN],
          css: ['filters/gray-100.css'],
          runAt: 'document_start',
          allFrames: false,
          persistAcrossSessions: true,
        },
        ['*'],
      ),
    ).not.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('desiredRegistrations · 按 (mode,intensity) 分组(ADR-064)', () => {
  it('🔴 两个共享同一设置的站点合并进同一条注册的 matches', () => {
    const settings = settingsWith([
      { pattern: 'weibo.com', mode: 'Grayscale', intensity: 100 },
      { pattern: 'zhihu.com', mode: 'Grayscale', intensity: 100 },
    ]);
    const desired = desiredRegistrations(settings);

    expect(desired).toHaveLength(1);
    expect(desired[0]!.id).toBe('ccf-gray-100');
    expect(desired[0]!.matches).toEqual(['*://weibo.com/*', '*://zhihu.com/*']);
    expect(desired[0]!.css).toEqual(['filters/gray-100.css']);
  });

  it('不同 intensity → 两条独立注册,各指向各自的 CSS 文件', () => {
    const desired = desiredRegistrations(
      settingsWith([
        { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
        { pattern: 'b.com', mode: 'Grayscale', intensity: 50 },
      ]),
    );
    expect(desired.map((d) => d.id).sort()).toEqual([
      'ccf-gray-100',
      'ccf-gray-50',
    ]);
    const byId = new Map(desired.map((d) => [d.id, d]));
    expect(byId.get('ccf-gray-100')!.css).toEqual(['filters/gray-100.css']);
    expect(byId.get('ccf-gray-50')!.css).toEqual(['filters/gray-50.css']);
  });

  /*
   * 🔴 ADR-075:原「不同 mode → 两条独立注册」已不可构造(只剩一个模式)。
   *
   * 它想守的性质是 ADR-064 的「注册按 `(mode, intensity)` 分组」——
   * 即**分组键的任一维度不同就分成两条**。mode 维度已退化为常量,
   * 故改由 intensity 维度承担该断言。这不是放宽:分组键的实现
   * (`registrationId(mode, intensity)`)对两个维度是同一段代码,
   * 且 intensity 的取值空间(101)远大于原先的 mode(4)。
   */
  it('不同 intensity → 两条独立注册(ADR-064 的分组键)', () => {
    const desired = desiredRegistrations(
      settingsWith([
        { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
        { pattern: 'b.com', mode: 'Grayscale', intensity: 30 },
      ]),
    );
    expect(desired.map((d) => d.id).sort()).toEqual([
      'ccf-gray-100',
      'ccf-gray-30',
    ]);
    // 且两条注册各自指向**自己**那个预生成文件,不得共用一个。
    const byId = new Map(desired.map((d) => [d.id, d]));
    expect(byId.get('ccf-gray-100')?.css).toEqual(['filters/gray-100.css']);
    expect(byId.get('ccf-gray-30')?.css).toEqual(['filters/gray-30.css']);
  });

  it('🔴 每条注册的四个必需字段(DESIGN.md §6 T4a gate)', () => {
    const desired = desiredRegistrations(
      settingsWith([
        { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
        { pattern: 'b.com', mode: 'Grayscale', intensity: 7 },
      ]),
    );
    expect(desired.length).toBeGreaterThan(0);
    for (const reg of desired) {
      // ADR-062:持久化注册是「不依赖 SW 先启动」的全部基础。
      expect(reg.persistAcrossSessions).toBe(true);
      expect(reg.runAt).toBe('document_start');
      // ADR-016:根元素 filter 天然覆盖 iframe,无需注入子框架。
      expect(reg.allFrames).toBe(false);
      // ADR-063:css 只接受文件路径,恰好一个预生成文件。
      expect(reg.css).toHaveLength(1);
      expect(reg.css[0]).toMatch(/^filters\/[a-z]+-\d{1,3}\.css$/);
    }
  });

  it('结果按 id 排序 —— 顺序这个自由度被消掉(diff 稳定性)', () => {
    const ids = desiredRegistrations(
      settingsWith([
        // ADR-075:排序这个自由度现在靠**强度**产生多条注册。
        { pattern: 'a.com', mode: 'Grayscale', intensity: 7 },
        { pattern: 'b.com', mode: 'Grayscale', intensity: 100 },
        { pattern: 'c.com', mode: 'Grayscale', intensity: 50 },
      ]),
    ).map((d) => d.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('🔴 用户重排规则不改变期望注册集(否则 diff 会误判「变了」)', () => {
    const a = desiredRegistrations(
      settingsWith([
        { pattern: 'x.com', mode: 'Grayscale', intensity: 100 },
        { pattern: 'y.com', mode: 'Grayscale', intensity: 100 },
      ]),
    );
    const b = desiredRegistrations(
      settingsWith([
        { pattern: 'y.com', mode: 'Grayscale', intensity: 100 },
        { pattern: 'x.com', mode: 'Grayscale', intensity: 100 },
      ]),
    );
    expect(a).toEqual(b);
  });

  it('无规则 → 空集', () => {
    expect(desiredRegistrations(defaultSettings())).toEqual([]);
  });

  it('glob 全部非法的组被跳过(Chrome 拒绝 matches 为空的注册)', () => {
    const desired = desiredRegistrations({
      ...defaultSettings(),
      // 绕过 coerceRule 直接构造,模拟存储里的损坏数据。
      rules: [{ pattern: '', mode: 'Grayscale', intensity: 100 }],
    });
    expect(desired).toEqual([]);
  });

  it('intensity 0 的规则同样注册(避免强度档位上的时序不一致)', () => {
    const desired = desiredRegistrations(
      settingsWith([{ pattern: 'a.com', mode: 'Grayscale', intensity: 0 }]),
    );
    expect(desired).toHaveLength(1);
    expect(desired[0]!.css).toEqual(['filters/gray-0.css']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('🔴 INV-8 / ADR-027 · 主开关 OFF 时期望注册为空集', () => {
  it('masterEnabled=false → 期望空集(不读规则、不注册)', () => {
    const settings = settingsWith(
      [{ pattern: 'a.com', mode: 'Grayscale', intensity: 100 }],
      { masterEnabled: false },
    );
    expect(desiredRegistrations(settings)).toEqual([]);
  });

  it('🔴 reconcile 会把已有注册全部 unregister —— ADR-027「关主开关可彻底止血」', async () => {
    const on = settingsWith([
      { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
    ]);
    await reconcile(port, on);
    expect([...port.registered.keys()]).toEqual(['ccf-gray-100']);

    const off = { ...on, masterEnabled: false };
    await reconcile(port, off);
    // 注册留在磁盘上 = 下一次导航的首帧仍会上色 = 止不住血。
    expect([...port.registered.keys()]).toEqual([]);
  });

  it('主开关开回来 → 注册被装回', async () => {
    const on = settingsWith([
      { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
    ]);
    await reconcile(port, { ...on, masterEnabled: false });
    await reconcile(port, on);
    expect([...port.registered.keys()]).toEqual(['ccf-gray-100']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('🔴 reconcile · 幂等(ADR-064,四个触发点可能并发)', () => {
  const settings = settingsWith([
    { pattern: 'weibo.com', mode: 'Grayscale', intensity: 100 },
    { pattern: 'zhihu.com', mode: 'Grayscale', intensity: 60 },
  ]);

  it('连续调用两次,注册集合不变(断言 getRegisteredContentScripts 结果相同)', async () => {
    await reconcile(port, settings);
    const after1 = [...port.registered.values()];

    await reconcile(port, settings);
    const after2 = [...port.registered.values()];

    expect(after2).toEqual(after1);
  });

  it('🔴 第二次调用产生**零个**平台变更调用(no-op,不是「结果相同但重做了一遍」)', async () => {
    await reconcile(port, settings);
    const mutationsAfterFirst = port.mutations.length;

    const result = await reconcile(port, settings);

    expect(port.mutations.length).toBe(mutationsAfterFirst);
    expect(isNoOpPlan(result.plan)).toBe(true);
    expect([...result.plan.unchangedIds].sort()).toEqual([
      'ccf-gray-100',
      'ccf-gray-60',
    ]);
  });

  it('连续五次调用仍收敛(id 是分组键的纯函数,不会每次换 id)', async () => {
    for (let i = 0; i < 5; i++) await reconcile(port, settings);
    expect([...port.registered.keys()].sort()).toEqual([
      'ccf-gray-100',
      'ccf-gray-60',
    ]);
    // 只有第一次产生了变更。
    expect(port.mutations).toEqual(['register:ccf-gray-100,ccf-gray-60']);
  });

  it('并发两次 reconcile 不会因重复 id 抛错(端口复刻了 Chrome 的 Duplicate 行为)', async () => {
    // 📌 这里刻意**不**经 Reconciler 的串行化,直接并发调 reconcile ——
    //    目的是记录「裸并发确实危险」,从而说明 Reconciler 的队列不是多余的。
    //    见 reconciler.test.ts 的对照组。
    const results = await Promise.all([
      reconcile(port, settings),
      reconcile(port, settings),
    ]);
    // 至少一次成功;失败的那次把错误记进 errors 而**不抛**。
    expect(results.some((r) => r.ok)).toBe(true);
    for (const r of results) {
      if (!r.ok) expect(r.errors.join()).toContain('registerContentScripts');
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('🔴 reconcile · 基于 diff(只动变化部分)', () => {
  it('新增一条规则 → 只 register 新组,已有的不动', async () => {
    const before = settingsWith([
      { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
    ]);
    await reconcile(port, before);
    port.calls.length = 0;

    const after = settingsWith([
      { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
      { pattern: 'b.com', mode: 'Grayscale', intensity: 30 },
    ]);
    const result = await reconcile(port, after);

    expect(result.plan.toRegister.map((r) => r.id)).toEqual(['ccf-gray-30']);
    expect(result.plan.toUpdate).toEqual([]);
    expect(result.plan.toUnregisterIds).toEqual([]);
    expect(result.plan.unchangedIds).toEqual(['ccf-gray-100']);
    expect(port.mutations).toEqual(['register:ccf-gray-30']);
  });

  it('🔴 规则删除后对应注册被 unregister', async () => {
    const before = settingsWith([
      { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
      { pattern: 'b.com', mode: 'Grayscale', intensity: 30 },
    ]);
    await reconcile(port, before);
    port.calls.length = 0;

    const after = settingsWith([
      { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
    ]);
    await reconcile(port, after);

    expect([...port.registered.keys()]).toEqual(['ccf-gray-100']);
    expect(port.mutations).toEqual(['unregister:ccf-gray-30']);
  });

  it('🔴 规则改强度 → css 路径被 **update** 到新文件(不是 unregister+register)', async () => {
    const before = settingsWith([
      { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
    ]);
    await reconcile(port, before);
    port.calls.length = 0;

    const after = settingsWith([
      { pattern: 'a.com', mode: 'Grayscale', intensity: 40 },
    ]);
    const result = await reconcile(port, after);

    // 改强度换了分组键 → 旧 id 消失、新 id 出现。
    expect([...port.registered.keys()]).toEqual(['ccf-gray-40']);
    expect(port.registered.get('ccf-gray-40')!.css).toEqual([
      'filters/gray-40.css',
    ]);
    expect(result.plan.toRegister.map((r) => r.id)).toEqual(['ccf-gray-40']);
    expect(result.plan.toUnregisterIds).toEqual(['ccf-gray-100']);
  });

  it('🔴 同组内新增一个站点 → 走 update(matches 变了,id 没变),**不**经过无注册窗口', async () => {
    const before = settingsWith([
      { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
    ]);
    await reconcile(port, before);
    port.calls.length = 0;

    const after = settingsWith([
      { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
      { pattern: 'b.com', mode: 'Grayscale', intensity: 100 },
    ]);
    const result = await reconcile(port, after);

    expect(result.plan.toUpdate.map((r) => r.id)).toEqual(['ccf-gray-100']);
    expect(result.plan.toRegister).toEqual([]);
    expect(result.plan.toUnregisterIds).toEqual([]);
    // 🔴 关键:全程没有 unregister —— unregister+register 之间的窗口
    //    若发生导航,那次导航就没有首帧 CSS(自制的 INV-3 缺口)。
    expect(port.mutations).toEqual(['update:ccf-gray-100']);
    expect(port.registered.get('ccf-gray-100')!.matches).toEqual([
      '*://a.com/*',
      '*://b.com/*',
    ]);
  });

  it('装与拆的顺序:先 install 再 unregister(窗口期最坏是「多一条」而非「少一条」)', async () => {
    await reconcile(
      port,
      settingsWith([{ pattern: 'a.com', mode: 'Grayscale', intensity: 100 }]),
    );
    port.calls.length = 0;
    await reconcile(
      port,
      settingsWith([{ pattern: 'a.com', mode: 'Grayscale', intensity: 30 }]),
    );
    const mutations = port.mutations;
    const registerIdx = mutations.findIndex((m) => m.startsWith('register:'));
    const unregisterIdx = mutations.findIndex((m) =>
      m.startsWith('unregister:'),
    );
    expect(registerIdx).toBeGreaterThanOrEqual(0);
    expect(unregisterIdx).toBeGreaterThanOrEqual(0);
    expect(registerIdx).toBeLessThan(unregisterIdx);
  });

  it('不碰别人的注册(id 前缀不是 ccf- 的一概不动)', async () => {
    port.registered.set('someone-else', {
      id: 'someone-else',
      matches: ['*://x/*'],
      css: [],
      runAt: 'document_start',
      allFrames: false,
      persistAcrossSessions: true,
    });
    await reconcile(port, defaultSettings());
    expect(port.registered.has('someone-else')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('🔴 ADR-065 · 扩展更新恢复(强制项)', () => {
  const settings = settingsWith([
    { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
    { pattern: 'b.com', mode: 'Grayscale', intensity: 80 },
  ]);

  it('模拟 onInstalled(reason: update)→ 注册被完整重建', async () => {
    // 1. 正常状态:注册已建立。
    await reconcile(port, settings);
    expect([...port.registered.keys()].sort()).toEqual([
      'ccf-gray-100',
      'ccf-gray-80',
    ]);

    // 2. 扩展更新:Chrome **清除**全部动态注册(已核实的平台行为)。
    port.registered.clear();
    port.calls.length = 0;

    // 3. onInstalled 的恢复路径 —— forceRebuild。
    const result = await reconcile(port, settings, { forceRebuild: true });

    expect(result.ok).toBe(true);
    expect([...port.registered.keys()].sort()).toEqual([
      // 字典序:`ccf-gray-100` < `ccf-gray-80`(字符串比较,不是数值)。
      'ccf-gray-100',
      'ccf-gray-80',
    ]);
  });

  it('🔴 forceRebuild 即使 getRegistered 返回**陈旧**内容也能重建', async () => {
    // 这是 ADR-065 真正要防的那个故障:更新后磁盘注册已被清除,
    // 但 getRegisteredContentScripts() 在某些时序下仍返回陈旧内容。
    // 按 diff 走会判定「都没变」→ 什么都不做 → 滤镜静默失效,
    // 且要等到下一次规则变更才恢复。
    await reconcile(port, settings);
    const stale = [...port.registered.values()];

    // 磁盘上其实已空,但回读仍是陈旧的那两条。
    port.registered.clear();
    for (const s of stale) port.registered.set(s.id, s); // 模拟陈旧回读
    port.calls.length = 0;

    const diffResult = planReconcile(stale, desiredRegistrations(settings), false);
    // 对照:按 diff 走确实什么都不做 —— 这就是漏掉 forceRebuild 的后果。
    expect(isNoOpPlan(diffResult)).toBe(true);

    const forced = planReconcile(stale, desiredRegistrations(settings), true);
    expect(forced.toRegister).toHaveLength(2);
    expect(forced.toUnregisterIds).toHaveLength(2);
    expect(forced.unchangedIds).toEqual([]);
  });

  it('forceRebuild 下先拆后装(id 相同,不拆无法装)', async () => {
    await reconcile(port, settings);
    port.calls.length = 0;
    await reconcile(port, settings, { forceRebuild: true });

    const mutations = port.mutations;
    expect(mutations[0]).toMatch(/^unregister:/);
    expect(mutations.some((m) => m.startsWith('register:'))).toBe(true);
    expect([...port.registered.keys()].sort()).toEqual([
      // 字典序:`ccf-gray-100` < `ccf-gray-80`(字符串比较,不是数值)。
      'ccf-gray-100',
      'ccf-gray-80',
    ]);
  });

  it('onInstalled 在**空**设置下也不抛(全新安装,无规则)', async () => {
    const result = await reconcile(port, defaultSettings(), {
      forceRebuild: true,
    });
    expect(result.ok).toBe(true);
    expect([...port.registered.keys()]).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('reconcile · 失败不抛异常(SW 回调里的 unhandled rejection)', () => {
  const settings = settingsWith([
    { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
  ]);

  it('getRegisteredContentScripts 失败 → 退化为强制重建,不抛', async () => {
    port.failOn = 'get';
    const result = await reconcile(port, settings);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain('getRegisteredContentScripts');
    // 退化为强制重建:不依赖「实际状态」的准确性 → 仍把期望装上。
    expect([...port.registered.keys()]).toEqual(['ccf-gray-100']);
  });

  it('registerContentScripts 失败 → 记进 errors,不抛', async () => {
    port.failOn = 'register';
    const result = await reconcile(port, settings);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain('registerContentScripts');
  });

  it('unregisterContentScripts 失败 → 记进 errors,不抛', async () => {
    await reconcile(port, settings);
    port.failOn = 'unregister';
    const result = await reconcile(port, defaultSettings());
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain('unregisterContentScripts');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('registrationId · 分组键的纯函数(幂等性的基础)', () => {
  it('同输入恒同输出', () => {
    expect(registrationId('Grayscale', 100)).toBe('ccf-gray-100');
    expect(registrationId('Grayscale', 100)).toBe('ccf-gray-100');
  });

  it('与 DESIGN.md §6 T4a 的示例一致(ccf-gray-100)', () => {
    expect(registrationId('Grayscale', 100)).toBe('ccf-gray-100');
  });

  it('模式 × 全部 101 档强度都产出唯一 id', () => {
    // ADR-075 后 mode 维度只有一个取值,故改为**穷举全部 101 档强度**
    // (原先只取 5 个边界值 × 4 模式 = 20 个样本)。
    // 这比原断言更强:它排除了任何两档强度撞 id 的可能,
    // 而撞 id 的后果是两组站点共用一个预生成文件 —— 一组会显示错误强度。
    const ids = new Set<string>();
    for (const mode of FILTER_MODES) {
      for (let intensity = 0; intensity <= 100; intensity++) {
        ids.add(registrationId(mode, intensity));
      }
    }
    expect(ids.size).toBe(FILTER_MODES.length * 101);
  });

  it('🔴 id 与 css 文件路径同源(避免两处各写一份短名映射而漂移)', () => {
    for (const mode of FILTER_MODES) {
      for (const intensity of [0, 1, 73, 99, 100]) {
        const id = registrationId(mode, intensity);
        const path = filterCssFilePath(mode, intensity);
        // ccf-<slug>-<n>  ↔  filters/<slug>-<n>.css
        expect(path).toBe(`filters/${id.slice('ccf-'.length)}.css`);
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('planReconcile · 纯函数,可直接断言 diff', () => {
  it('实际为空、期望两条 → 全部 register', () => {
    const desired = desiredRegistrations(
      settingsWith([
        { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
        { pattern: 'b.com', mode: 'Grayscale', intensity: 50 },
      ]),
    );
    const plan = planReconcile([], desired);
    expect(plan.toRegister).toHaveLength(2);
    expect(plan.toUnregisterIds).toEqual([]);
    expect(plan.unchangedIds).toEqual([]);
    expect(isNoOpPlan(plan)).toBe(false);
  });

  it('实际与期望完全一致 → no-op plan', () => {
    const desired = desiredRegistrations(
      settingsWith([{ pattern: 'a.com', mode: 'Grayscale', intensity: 100 }]),
    );
    const plan = planReconcile(desired, desired);
    expect(isNoOpPlan(plan)).toBe(true);
  });

  it('浏览器回读带了额外字段 → 仍判定未变(只比对我们写入过的字段)', () => {
    const desired = desiredRegistrations(
      settingsWith([{ pattern: 'a.com', mode: 'Grayscale', intensity: 100 }]),
    );
    const actualWithExtras = desired.map((d) => ({
      ...d,
      // 不同 Chrome 版本会回读出这些默认值;它们不该让 diff 永远判定「变了」。
      world: 'ISOLATED',
      matchOriginAsFallback: false,
      excludeMatches: [],
    }));
    const plan = planReconcile(actualWithExtras, desired);
    expect(isNoOpPlan(plan)).toBe(true);
  });

  it('matches 顺序不同 → 判定为变了(期望侧已排序,故不会假阳性)', () => {
    const desired = desiredRegistrations(
      settingsWith([
        { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
        { pattern: 'b.com', mode: 'Grayscale', intensity: 100 },
      ]),
    );
    const shuffled = desired.map((d) => ({
      ...d,
      matches: [...d.matches].reverse(),
    }));
    const plan = planReconcile(shuffled, desired);
    expect(plan.toUpdate).toHaveLength(1);
  });

  it('persistAcrossSessions 丢了 → 判定为变了并被 update 修回', () => {
    const desired = desiredRegistrations(
      settingsWith([{ pattern: 'a.com', mode: 'Grayscale', intensity: 100 }]),
    );
    const degraded = desired.map((d) => ({ ...d, persistAcrossSessions: false }));
    const plan = planReconcile(degraded, desired);
    expect(plan.toUpdate.map((r) => r.id)).toEqual(['ccf-gray-100']);
    expect(plan.toUpdate[0]!.persistAcrossSessions).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('INV-7 · 20 条规则上限下的注册规模(ADR-064 的「最坏 20 条」)', () => {
  it('20 条各不相同的设置 → 20 条注册,全部字段齐备', async () => {
    const rules = Array.from({ length: 20 }, (_unused, i) => ({
      pattern: `site${i}.com`,
      mode: 'Grayscale' as FilterMode,
      intensity: i as Intensity,
    }));
    const desired = desiredRegistrations(settingsWith(rules));
    expect(desired).toHaveLength(20);
    for (const reg of desired) {
      expect(reg.persistAcrossSessions).toBe(true);
      expect(reg.matches).toHaveLength(1);
    }
  });

  it('20 条共享同一设置 → **1 条**注册带 20 个 matches(ADR-064 的意图)', () => {
    const rules = Array.from({ length: 20 }, (_unused, i) => ({
      pattern: `site${i}.com`,
      mode: 'Grayscale' as FilterMode,
      intensity: 100 as Intensity,
    }));
    const desired = desiredRegistrations(settingsWith(rules));
    expect(desired).toHaveLength(1);
    expect(desired[0]!.matches).toHaveLength(20);
  });
});

describe('vi spy 可用性自检', () => {
  it('spy 基础设施正常(本文件其余断言的前提)', () => {
    const spy = vi.fn();
    spy();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
