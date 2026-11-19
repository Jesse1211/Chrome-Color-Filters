/**
 * T3 门禁 —— 仓储层(ADR-010 `chrome.storage.local`)。
 *
 * 本文件逐条对应 DESIGN.md §6 「T3 — 持久化(本地存储)」的 **gate** 列表。
 * 每个 `describe` 标注它守的是哪一条门禁 / 哪条 INV / 哪个 ADR。
 *
 * ⚠️ 本文件**不冒充** REAL_STACK_GATE(DESIGN.md §8 第 8 条)。
 * 「加载扩展 → 完全退出并重启浏览器 → 规则与锁定仍在」(INV-13)
 * 只能在真实 Chrome 中验,见 `docs/T3-real-stack-gate.md` 的人工步骤。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FilterRule,
  type FilterSettings,
  MAX_RULES,
  GLOB_PATTERN_MAX_LENGTH,
} from '../../domain/index.js';
import {
  PERSISTED_RULE_KEYS,
  PERSISTED_SETTINGS_KEYS,
  SETTINGS_KEY,
  SettingsRepository,
  MIN_DEBOUNCE_MS,
  MAX_DEBOUNCE_WAIT_MS,
} from '../settings-repository.js';
import { MemoryStorageArea } from '../memory-storage-area.js';

/** 一个可控的假时钟 —— T3 gate(I3)要求仓储层的时钟必须可注入。 */
function fakeClock(start: number) {
  let t = start;
  return {
    now: () => t,
    set: (v: number) => {
      t = v;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const T0 = 1_700_000_000_000; // 固定基准时刻,避免测试依赖真实时间

function rule(pattern: string, overrides: Partial<FilterRule> = {}): FilterRule {
  return {
    pattern,
    mode: 'Grayscale',
    intensity: 100,
    ...overrides,
  } as FilterRule;
}

interface Harness {
  area: MemoryStorageArea;
  clock: ReturnType<typeof fakeClock>;
  repo: SettingsRepository;
}

function makeRepo(
  options: { now?: number; debounceMs?: number; immediate?: boolean } = {},
): Harness {
  const area = new MemoryStorageArea();
  const clock = fakeClock(options.now ?? T0);
  const repo = new SettingsRepository({
    area,
    clock: clock.now,
    debounceMs: options.debounceMs,
    // immediate:把调度器换成「立刻执行」,用于不关心时序的测试
    scheduler: options.immediate ? (fn) => fn() : undefined,
  });
  return { area, clock, repo };
}

/** 读出底层存下来的原始 JSON 对象(未经 coerce)。 */
function persisted(area: MemoryStorageArea): Record<string, unknown> {
  return area.snapshot()[SETTINGS_KEY] as Record<string, unknown>;
}

/**
 * 取「用户设置」三元组用于「未变」断言。
 *
 * 🔴 **INV-11 例外 b**:`maxSeenTime` 是防御性元数据而非用户设置,
 * 它**必须在锁定期间继续推进**(ADR-059)。故此处刻意**排除**该字段 ——
 * 否则这条断言会与 INV-15 的门禁撞车(DESIGN.md 对此有逐字说明)。
 */
function userSettings(s: FilterSettings) {
  return {
    masterEnabled: s.masterEnabled,
    rules: s.rules,
    lockUntil: s.lockUntil,
  };
}

// ════════════════════════════════════════════════════════════════════════
describe('T3 gate · 写入 → 读取 → 深度相等,且顺序一致', () => {
  it('写入的规则读回来深度相等', async () => {
    const { repo } = makeRepo();
    const a = rule('x.com', { mode: 'RedGreen', intensity: 42 });
    const b = rule('*.baidu.*', { mode: 'BlueYellow', intensity: 7 });

    await repo.addRule(a);
    await repo.addRule(b);

    const read = await repo.read();
    expect(read.rules).toEqual([a, b]);
  });

  it('顺序即优先级 —— 读回的顺序与写入顺序一致(INV-6/ADR-008)', async () => {
    const { repo } = makeRepo();
    const patterns = ['a.com', 'b.com', 'c.com', 'd.com', 'e.com'];
    for (const p of patterns) await repo.addRule(rule(p));

    const read = await repo.read();
    expect(read.rules.map((r) => r.pattern)).toEqual(patterns);
  });

  it('replaceRules 原样保留传入顺序,不排序不去重', async () => {
    const { repo } = makeRepo();
    const list = ['z.com', 'a.com', 'm.com', 'a.com'].map((p) => rule(p));
    const res = await repo.replaceRules(list);

    expect(res.ok).toBe(true);
    const read = await repo.read();
    expect(read.rules.map((r) => r.pattern)).toEqual([
      'z.com',
      'a.com',
      'm.com',
      'a.com',
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('T3 gate · 【S11】第 21 条被拒,且原有 20 条一字未动(INV-7/ADR-012)', () => {
  async function fill20() {
    const h = makeRepo();
    for (let i = 0; i < MAX_RULES; i++) {
      const res = await h.repo.addRule(rule(`site${String(i)}.com`));
      expect(res.ok).toBe(true);
    }
    return h;
  }

  it('第 21 条返回明确错误而非静默截断', async () => {
    const { repo } = await fill20();
    const res = await repo.addRule(rule('overflow.com'));

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.error.reason).toBe('capacity-exceeded');
    expect(res.error.message).toContain('20');
  });

  it('🔴 S11:拒绝之后原有 20 条深度相等,一字未动(ADR-012 绝不静默淘汰)', async () => {
    const { repo } = await fill20();
    const before = (await repo.read()).rules;

    const res = await repo.addRule(rule('overflow.com'));
    expect(res.ok).toBe(false);

    const after = (await repo.read()).rules;
    expect(after).toEqual(before);
    expect(after).toHaveLength(MAX_RULES);
    expect(after.map((r) => r.pattern)).not.toContain('overflow.com');
  });

  it('replaceRules 传入 21 条整批拒绝,存储不被截断写入', async () => {
    const { repo } = await fill20();
    const before = (await repo.read()).rules;

    const twentyOne = Array.from({ length: 21 }, (_, i) =>
      rule(`new${String(i)}.com`),
    );
    const res = await repo.replaceRules(twentyOne);

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.error.reason).toBe('capacity-exceeded');
    expect((await repo.read()).rules).toEqual(before);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('T3 gate · 20 条满配的序列化体积(配额 10MB,留足三个数量级余量)', () => {
  it('每条 pattern 取 253 字符上限时,实测体积远小于 10MB', async () => {
    const { repo, area } = makeRepo();

    // 253 = DNS 域名最大长度(ADR-011)
    const longPattern = `${'a'.repeat(GLOB_PATTERN_MAX_LENGTH - 6)}.x.com`;
    expect(longPattern).toHaveLength(GLOB_PATTERN_MAX_LENGTH);

    for (let i = 0; i < MAX_RULES; i++) {
      const p = `${String(i).padStart(2, '0')}${longPattern.slice(2)}`;
      const res = await repo.addRule(rule(p, { mode: 'BlueYellow', intensity: 100 }));
      expect(res.ok).toBe(true);
    }

    const bytes = new TextEncoder().encode(
      JSON.stringify(persisted(area)),
    ).byteLength;

    // 实测约 5KB(DESIGN.md 的预期)。
    expect(bytes).toBeLessThan(10 * 1024);
    // 10MB 配额,断言留足三个数量级余量。
    expect(bytes).toBeLessThan(10 * 1024 * 1024 / 1000);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('T3 gate · 列表侧连续操作的防抖(F10 澄清,与 ADR-049 对齐)', () => {
  it('防抖窗口 ≥ 300ms,且更小的请求值被抬到下限', () => {
    const { repo } = makeRepo({ debounceMs: 10 });
    expect(repo.debounceMs).toBeGreaterThanOrEqual(MIN_DEBOUNCE_MS);
    expect(MIN_DEBOUNCE_MS).toBeGreaterThanOrEqual(300);
  });

  it('100 次连续重排(间隔 10ms)→ 实际写入次数 ≤ 3', async () => {
    vi.useFakeTimers();
    try {
      const area = new MemoryStorageArea();
      const clock = fakeClock(T0);
      const repo = new SettingsRepository({ area, clock: clock.now });

      // 先布置 3 条规则(这一次写入不计入防抖统计)
      await repo.replaceRules([rule('a.com'), rule('b.com'), rule('c.com')]);
      const baseline = area.setCallCount;

      const pending: Promise<unknown>[] = [];
      for (let i = 0; i < 100; i++) {
        const order =
          i % 2 === 0
            ? [rule('a.com'), rule('b.com'), rule('c.com')]
            : [rule('c.com'), rule('b.com'), rule('a.com')];
        pending.push(repo.reorderRulesDebounced(order));
        await vi.advanceTimersByTimeAsync(10);
      }
      await vi.advanceTimersByTimeAsync(MIN_DEBOUNCE_MS * 2);
      await Promise.all(pending);

      const writes = area.setCallCount - baseline;
      expect(writes).toBeLessThanOrEqual(3);
      expect(writes).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('🔴 回归:防抖窗口在每次新调用时重置(不是「首次排一枪、此后复用」)', async () => {
    // 曾经的缺陷:首次调用排一枪、后续调用复用它 —— 一段 1000ms 的连续拖拽
    // 会每 300ms 落盘一次(实测 4 次),超出门禁上限。真正的防抖只在停手后落盘。
    vi.useFakeTimers();
    try {
      const area = new MemoryStorageArea();
      const repo = new SettingsRepository({ area, clock: fakeClock(T0).now });
      await repo.replaceRules([rule('a.com'), rule('b.com')]);
      const baseline = area.setCallCount;

      // 连续 5 次,每次间隔 200ms(< 300ms 窗口)→ 期间一次都不该落盘
      const pending: Promise<unknown>[] = [];
      for (let i = 0; i < 5; i++) {
        pending.push(
          repo.reorderRulesDebounced(
            i % 2 === 0 ? [rule('b.com'), rule('a.com')] : [rule('a.com'), rule('b.com')],
          ),
        );
        await vi.advanceTimersByTimeAsync(200);
      }
      expect(area.setCallCount - baseline).toBe(0);

      // 停手后窗口走完 → 恰好落盘一次
      await vi.advanceTimersByTimeAsync(MIN_DEBOUNCE_MS + 10);
      await Promise.all(pending);
      expect(area.setCallCount - baseline).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('封顶等待:连续操作始终不停手时,最晚 MAX_DEBOUNCE_WAIT_MS 也会落盘一次(不丢写)', async () => {
    vi.useFakeTimers();
    try {
      const area = new MemoryStorageArea();
      const clock = fakeClock(T0);
      const repo = new SettingsRepository({
        area,
        // 封顶靠真实流逝的时间判定,故此处让注入时钟跟随 fake timer 前进
        clock: () => clock.now(),
      });
      await repo.replaceRules([rule('a.com'), rule('b.com')]);
      const baseline = area.setCallCount;

      const pending: Promise<unknown>[] = [];
      for (let i = 0; i < 60; i++) {
        pending.push(
          repo.reorderRulesDebounced(
            i % 2 === 0 ? [rule('b.com'), rule('a.com')] : [rule('a.com'), rule('b.com')],
          ),
        );
        clock.advance(50);
        await vi.advanceTimersByTimeAsync(50);
      }
      // 3000ms 的不间断操作:纯防抖会一次都不落盘,封顶保证至少落过一次
      expect(area.setCallCount - baseline).toBeGreaterThanOrEqual(1);

      await vi.advanceTimersByTimeAsync(MAX_DEBOUNCE_WAIT_MS * 2);
      await Promise.all(pending);
    } finally {
      vi.useRealTimers();
    }
  });

  it('防抖后落盘的是最后一次的顺序', async () => {
    vi.useFakeTimers();
    try {
      const area = new MemoryStorageArea();
      const repo = new SettingsRepository({ area, clock: fakeClock(T0).now });
      await repo.replaceRules([rule('a.com'), rule('b.com')]);

      const p1 = repo.reorderRulesDebounced([rule('b.com'), rule('a.com')]);
      const p2 = repo.reorderRulesDebounced([rule('a.com'), rule('b.com')]);
      await vi.advanceTimersByTimeAsync(MIN_DEBOUNCE_MS * 2);
      await Promise.all([p1, p2]);

      const read = await repo.read();
      expect(read.rules.map((r) => r.pattern)).toEqual(['a.com', 'b.com']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flush() 立即落盘,不丢写', async () => {
    vi.useFakeTimers();
    try {
      const area = new MemoryStorageArea();
      const repo = new SettingsRepository({ area, clock: fakeClock(T0).now });
      await repo.replaceRules([rule('a.com'), rule('b.com')]);

      const p = repo.reorderRulesDebounced([rule('b.com'), rule('a.com')]);
      await repo.flush();
      await p;

      expect((await repo.read()).rules.map((r) => r.pattern)).toEqual([
        'b.com',
        'a.com',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('T3 gate · 拖拽重排后顺序正确持久化(ADR-008/ADR-023)', () => {
  it('reorderRule 把 from 移到 to,其余顺序保持', async () => {
    const { repo } = makeRepo();
    await repo.replaceRules(['a', 'b', 'c', 'd'].map((p) => rule(`${p}.com`)));

    const res = await repo.reorderRule(0, 2);
    expect(res.ok).toBe(true);

    expect((await repo.read()).rules.map((r) => r.pattern)).toEqual([
      'b.com',
      'c.com',
      'a.com',
      'd.com',
    ]);
  });

  it('越界下标返回结构化错误且列表不变', async () => {
    const { repo } = makeRepo();
    await repo.replaceRules([rule('a.com'), rule('b.com')]);
    const before = (await repo.read()).rules;

    const res = await repo.reorderRule(0, 9);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.error.reason).toBe('invalid-input');
    expect((await repo.read()).rules).toEqual(before);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('T3 gate · 结构化写入错误 quota / locked / other(ADR-046)', () => {
  it('配额耗尽 → kind: quota,携带原始错误文案', async () => {
    const area = new MemoryStorageArea();
    area.failSet = () =>
      new Error('QUOTA_BYTES quota exceeded in chrome.storage.local');
    const repo = new SettingsRepository({ area, clock: fakeClock(T0).now });

    const res = await repo.addRule(rule('x.com'));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.error.kind).toBe('quota');
    expect(res.error.cause).toContain('QUOTA_BYTES');
  });

  it('其他底层失败 → kind: other,携带原始错误文案', async () => {
    const area = new MemoryStorageArea();
    area.failSet = () => new Error('Something unexpected went wrong');
    const repo = new SettingsRepository({ area, clock: fakeClock(T0).now });

    const res = await repo.addRule(rule('x.com'));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.error.kind).toBe('other');
    expect(res.error.cause).toBe('Something unexpected went wrong');
  });

  it('🔴 I1:锁定拒绝必须是独立的 locked 分类,绝不落入 other', async () => {
    const { repo, clock } = makeRepo();
    await repo.setLockUntil(clock.now() + 60_000);

    const results = [
      await repo.setMasterEnabled(false),
      await repo.addRule(rule('x.com')),
      await repo.removeRule(0),
      await repo.updateRule(0, { intensity: 10 }),
      await repo.replaceRules([rule('y.com')]),
      await repo.reorderRule(0, 0),
      await repo.setLockUntil(null),
    ];

    for (const res of results) {
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('unreachable');
      // 锁定拒绝不是故障 —— 若落入 other,UI 会弹红色「保存失败」并建议
      // 「请删除几条规则后重试」,而锁定期间根本删不了。虚假警报。
      expect(res.error.kind).toBe('locked');
      expect(res.error.kind).not.toBe('other');
    }
  });

  it('未锁定时的 lockUntil 入参错误不报 locked —— 那是入参问题,与锁无关(I1)', async () => {
    const { repo, clock } = makeRepo();
    expect(await repo.isCurrentlyLocked()).toBe(false);

    for (const bad of [null, clock.now() - 1, Number.NaN]) {
      const res = await repo.setLockUntil(bad);
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('unreachable');
      // 根本没有锁在拒绝 —— 若报 locked,UI 会对着一个不存在的锁显示锁定文案。
      expect(res.error.kind).not.toBe('locked');
      expect(res.error.reason).toBe('invalid-input');
    }
  });

  it('锁定中的 lockUntil 拒绝仍报 locked —— 确实是锁在拒绝(I1)', async () => {
    const { repo, clock } = makeRepo();
    const until = clock.now() + 60_000;
    await repo.setLockUntil(until);

    for (const bad of [null, until - 1_000, until]) {
      const res = await repo.setLockUntil(bad);
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('unreachable');
      expect(res.error.kind).toBe('locked');
      expect(res.error.reason).toBe('lock-write-rejected');
    }
  });

  it('写入失败是返回值而非 throw(ADR-046:不得只 throw 或只 console.error)', async () => {
    const area = new MemoryStorageArea();
    area.failSet = () => new Error('boom');
    const repo = new SettingsRepository({ area, clock: fakeClock(T0).now });

    // 不应抛出
    const res = await repo.setMasterEnabled(false);
    expect(res.ok).toBe(false);
  });

  it('不存在 offline / rate-limit 分类(那是 sync 的失败模式,ADR-010 已排除)', async () => {
    const area = new MemoryStorageArea();
    area.failSet = () => new Error('network offline');
    const repo = new SettingsRepository({ area, clock: fakeClock(T0).now });

    const res = await repo.addRule(rule('x.com'));
    if (res.ok) throw new Error('unreachable');
    expect(['quota', 'locked', 'other']).toContain(res.error.kind);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('T3 gate · onChanged 订阅(INV-4 多 tab 即时同步的基础机制)', () => {
  it('写入后订阅回调被触发,拿到新设置', async () => {
    const { repo } = makeRepo();
    const seen: FilterSettings[] = [];
    repo.subscribe((s) => seen.push(s));

    await repo.addRule(rule('x.com', { mode: 'GreenRed', intensity: 30 }));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.rules.map((r) => r.pattern)).toEqual(['x.com']);
    expect(seen[0]?.rules[0]?.mode).toBe('GreenRed');
  });

  it('取消订阅后不再收到回调,并摘掉底层监听器', async () => {
    const { repo, area } = makeRepo();
    const seen: FilterSettings[] = [];
    const off = repo.subscribe((s) => seen.push(s));

    await repo.addRule(rule('a.com'));
    expect(seen).toHaveLength(1);

    off();
    expect(area.listenerCount).toBe(0);

    await repo.addRule(rule('b.com'));
    expect(seen).toHaveLength(1);
  });

  it('只响应 local 区(ADR-010)下 SETTINGS_KEY 的变化', async () => {
    const { repo, area } = makeRepo();
    const seen: FilterSettings[] = [];
    repo.subscribe((s) => seen.push(s));

    await area.set({ someOtherKey: 1 });
    expect(seen).toHaveLength(0);
  });

  it('损坏的 newValue 不会让订阅回调崩溃(ADR-041)', async () => {
    const { repo, area } = makeRepo();
    const seen: FilterSettings[] = [];
    repo.subscribe((s) => seen.push(s));

    await area.set({ [SETTINGS_KEY]: 'not an object at all' });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.rules).toEqual([]);
    expect(seen[0]?.lockUntil).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('T3 gate · 存储为空返回默认值,不抛异常', () => {
  it('空存储 → {version, masterEnabled, rules: [], lockUntil: null, maxSeenTime}', async () => {
    const area = new MemoryStorageArea();
    const repo = new SettingsRepository({ area, clock: () => 0 });

    const s = await repo.read();
    expect(s.rules).toEqual([]);
    expect(s.lockUntil).toBeNull();
    expect(s.maxSeenTime).toBe(0);
    expect(typeof s.version).toBe('number');
    expect(typeof s.masterEnabled).toBe('boolean');
  });

  it('底层 get 抛错时读路径仍返回默认值,不抛异常(ADR-041)', async () => {
    const area = new MemoryStorageArea();
    area.failGet = () => new Error('storage unavailable');
    const repo = new SettingsRepository({ area, clock: () => 0 });

    await expect(repo.read()).resolves.toMatchObject({
      rules: [],
      lockUntil: null,
    });
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('T3 gate · 持久化 JSON 的键集(ADR-025:派生字段一个都不许有)', () => {
  it('顶层只含 version/masterEnabled/rules/lockUntil/maxSeenTime', async () => {
    const { repo, clock, area } = makeRepo();
    await repo.addRule(rule('x.com'));
    await repo.setLockUntil(clock.now() + 60_000);

    const keys = Object.keys(persisted(area)).sort();
    expect(keys).toEqual([...PERSISTED_SETTINGS_KEYS].sort());
  });

  it('rules[] 元素只含 pattern/mode/intensity', async () => {
    const { repo, area } = makeRepo();
    await repo.addRule(rule('x.com', { mode: 'RedGreen', intensity: 55 }));

    const stored = persisted(area);
    const rules = stored.rules as Record<string, unknown>[];
    expect(Object.keys(rules[0] ?? {}).sort()).toEqual(
      [...PERSISTED_RULE_KEYS].sort(),
    );
  });

  it('🔴 出现任何 matrix / 系数 / 派生字段即失败', async () => {
    const { repo, area } = makeRepo();
    // 模拟上游不小心把派生值挂在规则对象上
    await repo.addRule({
      ...rule('x.com'),
      matrix: [1, 0, 0, 0, 0],
      colorMatrix: 'derived',
    } as unknown as FilterRule);

    const json = JSON.stringify(persisted(area));
    expect(json).not.toMatch(/matrix/i);
    expect(json).not.toMatch(/coefficient/i);

    const rules = persisted(area).rules as Record<string, unknown>[];
    for (const r of rules) {
      expect(Object.keys(r).sort()).toEqual([...PERSISTED_RULE_KEYS].sort());
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('T3 gate · 未知/损坏数据不崩溃(ADR-041)', () => {
  const garbage: unknown[] = [
    'a string',
    42,
    null,
    [],
    { rules: 'not an array' },
    { version: 99, masterEnabled: 'yes', rules: [{ nope: 1 }], lockUntil: 'soon' },
    { rules: [{ pattern: 'x.com' }] }, // 缺 mode/intensity
  ];

  for (const [i, bad] of garbage.entries()) {
    it(`垃圾数据 #${String(i)} 回退默认值且不抛异常`, async () => {
      const area = new MemoryStorageArea();
      area.seed({ [SETTINGS_KEY]: bad });
      const repo = new SettingsRepository({ area, clock: () => T0 });

      const s = await repo.read();
      expect(Array.isArray(s.rules)).toBe(true);
      expect(s.lockUntil === null || typeof s.lockUntil === 'number').toBe(true);
      expect(typeof s.masterEnabled).toBe('boolean');
    });
  }

  it('更高 version 不抛异常,规则仍被清洗为合法形状', async () => {
    const area = new MemoryStorageArea();
    area.seed({
      [SETTINGS_KEY]: {
        version: 999,
        masterEnabled: true,
        rules: [{ pattern: 'x.com', mode: 'Nonsense', intensity: 500 }],
        lockUntil: null,
        maxSeenTime: 0,
      },
    });
    const repo = new SettingsRepository({ area, clock: () => T0 });

    const s = await repo.read();
    expect(s.rules[0]?.mode).toBe('Grayscale'); // coerce 回默认
    expect(s.rules[0]?.intensity).toBeLessThanOrEqual(100);
  });

  it('存储中超过 20 条时被裁到 20,且不抛异常(INV-7)', async () => {
    const area = new MemoryStorageArea();
    area.seed({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: true,
        rules: Array.from({ length: 50 }, (_, i) => ({
          pattern: `s${String(i)}.com`,
          mode: 'Grayscale',
          intensity: 100,
        })),
        lockUntil: null,
        maxSeenTime: 0,
      },
    });
    const repo = new SettingsRepository({ area, clock: () => T0 });

    expect((await repo.read()).rules).toHaveLength(MAX_RULES);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('T3 gate · 写入结构稳定(ADR-047)', () => {
  it('写入后的 JSON 必含全部五个顶层字段,rules[] 必含三个字段', async () => {
    const { repo, area } = makeRepo();
    await repo.addRule(rule('x.com'));

    const stored = persisted(area);
    for (const k of PERSISTED_SETTINGS_KEYS) {
      expect(stored).toHaveProperty(k);
    }
    const r = (stored.rules as Record<string, unknown>[])[0];
    for (const k of PERSISTED_RULE_KEYS) {
      expect(r).toHaveProperty(k);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// 🔴 本节是 T3 的核心:INV-14 / ADR-055 的锁定强制
// 全部**绕过 UI,直接调用仓储层 API** —— 这正是 INV-14 要验证的。
// ════════════════════════════════════════════════════════════════════════
describe('🔴 T3 gate · 锁定强制(INV-14 / ADR-055)—— 直接调用仓储层 API', () => {
  async function locked(): Promise<Harness & { lockUntil: number }> {
    const h = makeRepo();
    await h.repo.addRule(rule('a.com'));
    await h.repo.addRule(rule('b.com'));
    const lockUntil = h.clock.now() + 3_600_000; // 一小时后
    const res = await h.repo.setLockUntil(lockUntil);
    expect(res.ok).toBe(true);
    return { ...h, lockUntil };
  }

  it('锁定中「设置 masterEnabled」被拒绝(ADR-051:关闭滤镜也是设置变更)', async () => {
    const { repo } = await locked();
    const before = userSettings(await repo.read());

    const res = await repo.setMasterEnabled(false);

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.error.kind).toBe('locked');
    expect(res.error.reason).toBe('locked-master-enabled');
    expect(userSettings(await repo.read())).toEqual(before);
  });

  it('锁定中「设置 masterEnabled: true」同样被拒绝 —— 冻结的是「变更」本身', async () => {
    const { repo } = await locked();
    const res = await repo.setMasterEnabled(true);
    expect(res.ok).toBe(false);
  });

  it('锁定中 rules 的增/删/改/重排 —— 四项全部被拒绝(INV-11)', async () => {
    const { repo } = await locked();
    const before = userSettings(await repo.read());

    const add = await repo.addRule(rule('c.com'));
    const del = await repo.removeRule(0);
    const upd = await repo.updateRule(0, { intensity: 1 });
    const mov = await repo.reorderRule(0, 1);
    const rep = await repo.replaceRules([rule('z.com')]);

    for (const res of [add, del, upd, mov, rep]) {
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('unreachable');
      expect(res.error.kind).toBe('locked');
      expect(res.error.reason).toBe('locked-rules');
    }

    // 🔴 INV-11 的「未变」:masterEnabled / rules / lockUntil 三者均未变。
    // maxSeenTime 刻意排除 —— 例外 b,它必须继续推进。
    expect(userSettings(await repo.read())).toEqual(before);
  });

  it('锁定中「延长 lockUntil」(next > current)被允许(INV-12 加码可以)', async () => {
    const { repo, lockUntil } = await locked();
    const longer = lockUntil + 60_000;

    const res = await repo.setLockUntil(longer);

    expect(res.ok).toBe(true);
    expect((await repo.read()).lockUntil).toBe(longer);
  });

  it('锁定中「缩短 lockUntil」(next < current)被拒绝(INV-12 反悔不行)', async () => {
    const { repo, lockUntil, clock } = await locked();
    const shorter = clock.now() + 1_000; // 仍在未来,但比当前锁定短

    const res = await repo.setLockUntil(shorter);

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.error.kind).toBe('locked');
    expect((await repo.read()).lockUntil).toBe(lockUntil);
  });

  it('锁定中「清除 lockUntil」(设为 null)被拒绝(ADR-052)', async () => {
    const { repo, lockUntil } = await locked();

    const res = await repo.setLockUntil(null);

    expect(res.ok).toBe(false);
    expect((await repo.read()).lockUntil).toBe(lockUntil);
  });

  it('锁定中「设为相同值」被拒绝(无意义写入)', async () => {
    const { repo, lockUntil } = await locked();

    const res = await repo.setLockUntil(lockUntil);

    expect(res.ok).toBe(false);
    expect((await repo.read()).lockUntil).toBe(lockUntil);
  });

  it('任何情况下「设为过去的时间戳」被拒绝 —— 否则等于一键解锁', async () => {
    // 锁定中
    const l = await locked();
    expect((await l.repo.setLockUntil(l.clock.now() - 1)).ok).toBe(false);
    expect((await l.repo.read()).lockUntil).toBe(l.lockUntil);

    // 未锁定
    const u = makeRepo();
    expect((await u.repo.setLockUntil(u.clock.now() - 1)).ok).toBe(false);
    expect((await u.repo.read()).lockUntil).toBeNull();
  });

  it('锁定期间被拒绝的写入**仍推进 maxSeenTime**(INV-11 例外 b / ADR-059)', async () => {
    const { repo, clock } = await locked();
    const before = await repo.read();

    clock.advance(5_000);
    const res = await repo.setMasterEnabled(false);
    expect(res.ok).toBe(false);

    const after = await repo.read();
    // 用户设置三元组未变……
    expect(userSettings(after)).toEqual(userSettings(before));
    // ……但防御性元数据继续前进。若它随锁定一起冻结,单调下界会停在
    // 锁定开始那一刻,时钟倒退防护立即失效。
    expect(after.maxSeenTime).toBeGreaterThan(before.maxSeenTime);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('🔴 T3 gate · 启动锁定原子地置 masterEnabled: true(ADR-057)', () => {
  it('未锁定时启动锁定 → 允许,且 masterEnabled 被原子置为 true', async () => {
    const { repo, clock, area } = makeRepo();
    // 先把主开关关掉 —— 这正是 ADR-057 要防的前置状态
    await repo.setMasterEnabled(false);
    expect((await repo.read()).masterEnabled).toBe(false);

    const setsBefore = area.setCallCount;
    const until = clock.now() + 3_600_000;
    const res = await repo.setLockUntil(until);

    expect(res.ok).toBe(true);
    const s = await repo.read();
    expect(s.lockUntil).toBe(until);
    expect(s.masterEnabled).toBe(true);

    // 「一次写入完成,无中间态」—— 恰好一次 storage.set
    expect(area.setCallCount - setsBefore).toBe(1);
  });

  it('onChanged 看到的也是已经置好 masterEnabled 的那一帧(无中间态)', async () => {
    const { repo, clock } = makeRepo();
    await repo.setMasterEnabled(false);

    const frames: FilterSettings[] = [];
    repo.subscribe((s) => frames.push(s));

    await repo.setLockUntil(clock.now() + 60_000);

    expect(frames).toHaveLength(1);
    expect(frames[0]?.masterEnabled).toBe(true);
    expect(frames[0]?.lockUntil).not.toBeNull();
  });

  it('锁定中延长不改动 masterEnabled —— 它本就已被 ADR-051 冻结', async () => {
    const { repo, clock } = makeRepo();
    const until = clock.now() + 60_000;
    await repo.setLockUntil(until);
    expect((await repo.read()).masterEnabled).toBe(true);

    const res = await repo.setLockUntil(until + 60_000);
    expect(res.ok).toBe(true);
    expect((await repo.read()).masterEnabled).toBe(true);
  });

  it('锁定已过期时启动新锁定 → 允许', async () => {
    const { repo, clock } = makeRepo();
    const first = clock.now() + 1_000;
    expect((await repo.setLockUntil(first)).ok).toBe(true);

    clock.advance(10_000); // 过期
    expect(await repo.isCurrentlyLocked()).toBe(false);

    const second = clock.now() + 60_000;
    const res = await repo.setLockUntil(second);
    expect(res.ok).toBe(true);
    expect((await repo.read()).lockUntil).toBe(second);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('🔴 T3 gate · 时钟倒退不缩短锁定(ADR-059 / INV-15)', () => {
  it('注入倒退的假时钟 → 锁定仍然有效,剩余时长不增加', async () => {
    const { repo, clock } = makeRepo();
    const until = clock.now() + 3_600_000;
    await repo.setLockUntil(until);

    const beforeMax = (await repo.read()).maxSeenTime;

    // 把系统时钟往回拨一整天
    clock.set(T0 - 86_400_000);

    expect(await repo.isCurrentlyLocked()).toBe(true);

    const s = await repo.read();
    // maxSeenTime 不被倒退值覆盖
    expect(s.maxSeenTime).toBeGreaterThanOrEqual(beforeMax);
    expect(s.maxSeenTime).not.toBe(T0 - 86_400_000);

    // 剩余时长按 effectiveNow 计算,**不增加**
    const remaining = (s.lockUntil ?? 0) - s.maxSeenTime;
    expect(remaining).toBeLessThanOrEqual(3_600_000);
  });

  it('时钟倒退后写入仍被拒绝 —— 倒退不能变成解锁手段', async () => {
    const { repo, clock } = makeRepo();
    await repo.setLockUntil(clock.now() + 3_600_000);

    clock.set(T0 - 86_400_000);

    const res = await repo.setMasterEnabled(false);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.error.kind).toBe('locked');
  });

  it('时钟倒退后「缩短锁定」仍被拒绝', async () => {
    const { repo, clock } = makeRepo();
    const until = clock.now() + 3_600_000;
    await repo.setLockUntil(until);

    clock.set(T0 - 86_400_000);

    const res = await repo.setLockUntil(until - 1_000);
    expect(res.ok).toBe(false);
    expect((await repo.read()).lockUntil).toBe(until);
  });

  it('maxSeenTime 在正常前进时跟随时钟', async () => {
    const { repo, clock } = makeRepo();
    const first = (await repo.read()).maxSeenTime;
    clock.advance(60_000);
    const second = (await repo.read()).maxSeenTime;
    expect(second).toBe(first + 60_000);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('🔴 T3 gate · 锁定到期后自动解锁,无需任何手动操作(I3 注入假时钟)', () => {
  it('lockUntil 过期后所有写入恢复正常', async () => {
    const { repo, clock } = makeRepo();
    await repo.addRule(rule('a.com'));
    await repo.setLockUntil(clock.now() + 10_000);

    // 锁定中:拒绝
    expect((await repo.addRule(rule('b.com'))).ok).toBe(false);

    // 时间推进到过期之后 —— 不做任何「解锁」操作
    clock.advance(10_001);

    expect(await repo.isCurrentlyLocked()).toBe(false);
    expect((await repo.addRule(rule('b.com'))).ok).toBe(true);
    expect((await repo.setMasterEnabled(false)).ok).toBe(true);
    expect((await repo.removeRule(0)).ok).toBe(true);
    const nullRes = await repo.setLockUntil(null);
    expect(nullRes.ok).toBe(false); // null 仍是 no-op
    if (nullRes.ok) throw new Error('unreachable');
    expect(nullRes.error.kind).not.toBe('locked'); // 锁已过期,不是锁在拒绝

    const s = await repo.read();
    expect(s.rules.map((r) => r.pattern)).toEqual(['b.com']);
  });

  it('now === lockUntil 的边界:到期即解锁(开区间)', async () => {
    const { repo, clock } = makeRepo();
    const until = clock.now() + 10_000;
    await repo.setLockUntil(until);

    clock.set(until - 1);
    expect(await repo.isCurrentlyLocked()).toBe(true);

    clock.set(until);
    expect(await repo.isCurrentlyLocked()).toBe(false);
    expect((await repo.setMasterEnabled(false)).ok).toBe(true);
  });

  it('时钟可注入 —— 全程未使用全局 fake timer 也能测时间边界', async () => {
    const { repo, clock } = makeRepo({ now: 0 });
    await repo.setLockUntil(500);
    clock.set(499);
    expect(await repo.isCurrentlyLocked()).toBe(true);
    clock.set(500);
    expect(await repo.isCurrentlyLocked()).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('T3 · 锁定跨重启的单元前提(INV-13 / ADR-053)', () => {
  it('存的是绝对到期时间戳,不是剩余时长', async () => {
    const { repo, clock, area } = makeRepo();
    const until = clock.now() + 3_600_000;
    await repo.setLockUntil(until);

    const stored = persisted(area);
    expect(stored.lockUntil).toBe(until);
    // 若存的是剩余时长,这里会是 3_600_000 —— 重启即可绕过(ADR-053)
    expect(stored.lockUntil).not.toBe(3_600_000);
  });

  it('用一份「重启后」的新仓储实例读同一份存储,锁定仍然有效', async () => {
    const area = new MemoryStorageArea();
    const c1 = fakeClock(T0);
    const repo1 = new SettingsRepository({ area, clock: c1.now });
    const until = T0 + 3_600_000;
    await repo1.setLockUntil(until);

    // 模拟「浏览器完全退出并重启」:全新实例、全新时钟,共享同一份持久化数据。
    // ⚠️ 这只是单元层的前提验证,**不构成** REAL_STACK_GATE(DESIGN.md §8 第 8 条)。
    const c2 = fakeClock(T0 + 60_000);
    const repo2 = new SettingsRepository({ area, clock: c2.now });

    expect(await repo2.isCurrentlyLocked()).toBe(true);
    expect((await repo2.read()).lockUntil).toBe(until);
    expect((await repo2.setMasterEnabled(false)).ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('T3 · 未锁定时的正常写入路径', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeRepo();
  });

  it('setMasterEnabled 正常生效', async () => {
    expect((await h.repo.setMasterEnabled(false)).ok).toBe(true);
    expect((await h.repo.read()).masterEnabled).toBe(false);
  });

  it('updateRule 修改模式与强度(ADR-021)', async () => {
    await h.repo.addRule(rule('x.com'));
    const res = await h.repo.updateRule(0, { mode: 'BlueYellow', intensity: 33 });
    expect(res.ok).toBe(true);

    const r = (await h.repo.read()).rules[0];
    expect(r?.mode).toBe('BlueYellow');
    expect(r?.intensity).toBe(33);
    expect(r?.pattern).toBe('x.com');
  });

  it('非法 pattern 被拒绝,原规则不变', async () => {
    await h.repo.addRule(rule('x.com'));
    const before = (await h.repo.read()).rules;

    const res = await h.repo.updateRule(0, { pattern: 'a'.repeat(300) });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.error.reason).toBe('invalid-input');
    expect((await h.repo.read()).rules).toEqual(before);
  });

  it('removeRule 删除后其余顺序保持', async () => {
    await h.repo.replaceRules(['a', 'b', 'c'].map((p) => rule(`${p}.com`)));
    expect((await h.repo.removeRule(1)).ok).toBe(true);
    expect((await h.repo.read()).rules.map((r) => r.pattern)).toEqual([
      'a.com',
      'c.com',
    ]);
  });

  it('成功的写入返回写入后的完整设置,供 UI 直接渲染', async () => {
    const res = await h.repo.addRule(rule('x.com'));
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.value.rules.map((r) => r.pattern)).toEqual(['x.com']);
  });
});
