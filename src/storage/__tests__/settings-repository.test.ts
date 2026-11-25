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
  coerceSettings,
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
 * ADR-071 废止 `maxSeenTime` 后**不再有任何豁免字段** —— INV-11 回到
 * 「锁定期间一切不可变更」的单一语义。本 helper 保留只是为了可读性;
 * 真正最强的断言是对持久化 JSON 做**全字段**深度相等
 * (见「读路径不得写盘」一节)。
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
    const a = rule('x.com', { mode: 'Grayscale', intensity: 42 });
    const b = rule('*.baidu.*', { mode: 'Grayscale', intensity: 7 });

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
      const res = await repo.addRule(rule(p, { mode: 'Grayscale', intensity: 100 }));
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

    await repo.addRule(rule('x.com', { mode: 'Grayscale', intensity: 30 }));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.rules.map((r) => r.pattern)).toEqual(['x.com']);
    expect(seen[0]?.rules[0]?.intensity).toBe(30);
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
  it('空存储 → {version, masterEnabled, rules: [], lockUntil: null}', async () => {
    const area = new MemoryStorageArea();
    const repo = new SettingsRepository({ area, clock: () => 0 });

    const s = await repo.read();
    expect(s.rules).toEqual([]);
    expect(s.lockUntil).toBeNull();
    expect(s).not.toHaveProperty('maxSeenTime'); // ADR-071
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
  it('顶层只含 version/masterEnabled/rules/lockUntil(ADR-071)', async () => {
    const { repo, clock, area } = makeRepo();
    await repo.addRule(rule('x.com'));
    await repo.setLockUntil(clock.now() + 60_000);

    const keys = Object.keys(persisted(area)).sort();
    expect(keys).toEqual([...PERSISTED_SETTINGS_KEYS].sort());
  });

  it('rules[] 元素只含 pattern/mode/intensity', async () => {
    const { repo, area } = makeRepo();
    await repo.addRule(rule('x.com', { mode: 'Grayscale', intensity: 55 }));

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
      },
    });
    const repo = new SettingsRepository({ area, clock: () => T0 });

    expect((await repo.read()).rules).toHaveLength(MAX_RULES);
  });
});

// ════════════════════════════════════════════════════════════════════════
/**
 * 🔴 ADR-075 的存储迁移 —— **真实升级路径**,不是假想场景。
 *
 * 用户装的是旧版本,磁盘上**已经**有带 `RedGreen` / `GreenRed` / `BlueYellow`
 * 的规则。扩展更新后这些字符串在类型上已不存在。
 *
 * ## 选定的迁移策略:读时收敛,不写回,不动 version
 *
 * `coerceFilterMode` 对任何不在 `FILTER_MODES` 中的输入回退 `Grayscale`,
 * 与它原本处理垃圾数据的语义完全相同(上一个 describe 已覆盖垃圾数据)。
 * 于是迁移**零新增机制**:
 *
 *   - 不需要 schema `version` 跃迁 —— 没有「哪个版本号对应哪套字段」要维护;
 *   - 不需要一次性迁移脚本 —— 不存在「迁移没跑过」的中间态,
 *     也不存在「迁移跑一半断电」的半迁移态;
 *   - 读路径**不写盘** —— ADR-071 刚因为读路径写盘而废止了 `maxSeenTime`,
 *     并让 INV-11 回到「锁定期间一切不可变更」的单一语义。
 *     一个「读到旧模式就写回 Grayscale」的迁移会把那个坑原样挖回来:
 *     锁定期间的一次读取就会变成一次写入。本 describe 的最后一条断言
 *     就是守这件事。
 *
 * 旧值在用户下一次保存该规则时自然被覆盖。
 *
 * ## 为什么不是「丢弃带旧模式的规则」
 *
 * 那等于静默删除用户配过的规则。ADR-012:「配过的规则莫名失效会严重
 * 损害辅助工具的信任」。用户要的是「这个站点别那么刺眼」,
 * 把它降级成灰阶仍然满足该诉求;删掉它则什么都不满足。
 */
describe('🔴 T3 gate · ADR-075 存储迁移(旧 CVD 模式 → Grayscale)', () => {
  /** 一份「旧版本留在磁盘上」的真实形状设置。 */
  function legacyBlob() {
    return {
      version: 1,
      masterEnabled: true,
      lockUntil: null,
      rules: [
        { pattern: 'a.com', mode: 'RedGreen', intensity: 42 },
        { pattern: 'b.com', mode: 'GreenRed', intensity: 7 },
        { pattern: 'c.com', mode: 'BlueYellow', intensity: 100 },
        { pattern: 'd.com', mode: 'Grayscale', intensity: 55 },
      ],
    };
  }

  it('读出来每条规则的 mode 都是 Grayscale', async () => {
    const area = new MemoryStorageArea();
    area.seed({ [SETTINGS_KEY]: legacyBlob() });
    const repo = new SettingsRepository({ area, clock: () => T0 });

    const s = await repo.read();
    expect(s.rules.map((r) => r.mode)).toEqual([
      'Grayscale',
      'Grayscale',
      'Grayscale',
      'Grayscale',
    ]);
  });

  it('🔴 一条规则都不丢 —— 旧模式不是「损坏数据」(ADR-012)', async () => {
    const area = new MemoryStorageArea();
    area.seed({ [SETTINGS_KEY]: legacyBlob() });
    const repo = new SettingsRepository({ area, clock: () => T0 });

    const s = await repo.read();
    expect(s.rules).toHaveLength(4);
    expect(s.rules.map((r) => r.pattern)).toEqual([
      'a.com',
      'b.com',
      'c.com',
      'd.com',
    ]);
  });

  it('🔴 pattern / intensity / 顺序一律原样保留 —— 迁移只碰 mode', async () => {
    const area = new MemoryStorageArea();
    area.seed({ [SETTINGS_KEY]: legacyBlob() });
    const repo = new SettingsRepository({ area, clock: () => T0 });

    const s = await repo.read();
    expect(s.rules).toEqual([
      { pattern: 'a.com', mode: 'Grayscale', intensity: 42 },
      { pattern: 'b.com', mode: 'Grayscale', intensity: 7 },
      { pattern: 'c.com', mode: 'Grayscale', intensity: 100 },
      { pattern: 'd.com', mode: 'Grayscale', intensity: 55 },
    ]);
    // 顺序即优先级(INV-6/ADR-008)—— 迁移不得重排。
    expect(s.rules[0]?.pattern).toBe('a.com');
  });

  it('masterEnabled / lockUntil / version 不受迁移影响', async () => {
    const area = new MemoryStorageArea();
    area.seed({
      [SETTINGS_KEY]: { ...legacyBlob(), masterEnabled: false, lockUntil: T0 + 60_000 },
    });
    const repo = new SettingsRepository({ area, clock: () => T0 });

    const s = await repo.read();
    expect(s.masterEnabled).toBe(false);
    expect(s.lockUntil).toBe(T0 + 60_000);
    expect(s.version).toBe(1);
  });

  it('🔴 迁移**不写盘** —— 读一次后磁盘上的 JSON 逐字节未变(ADR-071)', async () => {
    const area = new MemoryStorageArea();
    const before = legacyBlob();
    area.seed({ [SETTINGS_KEY]: before });
    const beforeJson = JSON.stringify(area.snapshot());

    const repo = new SettingsRepository({ area, clock: () => T0 });
    await repo.read();
    await repo.read();
    await repo.read();

    // 磁盘上**仍然**是旧值 —— 迁移发生在内存里,不产生写入。
    expect(JSON.stringify(area.snapshot())).toBe(beforeJson);
    expect(persisted(area).rules).toEqual(before.rules);
  });

  it('🔴 锁定期间读取带旧模式的设置也不写盘(INV-11 的单一语义)', async () => {
    // 这是上一条的要害场景:若迁移在读路径写回,锁定期间的一次读取
    // 就成了一次设置变更 —— 直接违反 INV-11「锁定期间一切不可变更」。
    const area = new MemoryStorageArea();
    area.seed({ [SETTINGS_KEY]: { ...legacyBlob(), lockUntil: T0 + 3_600_000 } });
    const beforeJson = JSON.stringify(area.snapshot());

    const repo = new SettingsRepository({ area, clock: () => T0 });
    const s = await repo.read();

    expect(s.rules.every((r) => r.mode === 'Grayscale')).toBe(true);
    expect(JSON.stringify(area.snapshot())).toBe(beforeJson);
  });

  it('迁移后写入一次 → 磁盘上的旧模式才被覆盖', async () => {
    // 迁移的「落盘」时机:用户下一次保存。这条证明它确实会落盘,
    // 否则旧值会永远留在磁盘上(虽无害,但会让排障时看到矛盾的数据)。
    const area = new MemoryStorageArea();
    area.seed({ [SETTINGS_KEY]: legacyBlob() });
    const repo = new SettingsRepository({
      area,
      clock: () => T0,
      scheduler: (fn) => fn(),
    });

    const res = await repo.updateRule(0, { intensity: 80 });
    expect(res.ok).toBe(true);

    const stored = persisted(area).rules as Record<string, unknown>[];
    expect(stored.map((r) => r['mode'])).toEqual([
      'Grayscale',
      'Grayscale',
      'Grayscale',
      'Grayscale',
    ]);
    expect(stored[0]?.['intensity']).toBe(80);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('T3 gate · 写入结构稳定(ADR-047)', () => {
  it('写入后的 JSON 必含全部四个顶层字段,rules[] 必含三个字段', async () => {
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
    // ADR-071 后不再有豁免字段,故整对象深度相等也成立(见 ADR-071 一节)。
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

  it('🔴 被拒绝的写入之后全字段深度相等 —— 不再有豁免字段(INV-11 / ADR-071)', async () => {
    const { repo, clock } = await locked();
    const before = await repo.read();

    clock.advance(5_000);
    expect((await repo.setMasterEnabled(false)).ok).toBe(false);

    // ADR-071 删除了原「例外 b:maxSeenTime 单调推进」,
    // 于是这里可以对**整个聚合**做深度相等,而不只是三元组。
    expect(await repo.read()).toEqual(before);
  });
});

// ════════════════════════════════════════════════════════════════════════
/*
 * 🔴🔴 **本区段原为「启动锁定原子地置 masterEnabled: true(ADR-057)」。**
 *
 * ADR-057 已由 ADR-076 废止 —— 它补救的场景(主开关 OFF 时启动锁定)
 * 现在**在 UI 上不可达**(入口禁用),于是仓储层的那个副作用写入已删除。
 *
 * 前两条用例断言的正是那个副作用**必须发生**,故它们已失效:
 *   (1)「未锁定时启动锁定 → masterEnabled 被原子置为 true」
 *   (2)「onChanged 看到的也是已经置好 masterEnabled 的那一帧」
 *
 * 两条**不是删掉求绿**,而是被**替换**为同一片风险的反面断言:
 * 「启动锁定**不碰** masterEnabled」+「仍是恰好一次写入、一帧通知」。
 * 原用例守的「无中间态 / 一次写入」一字未丢 —— 那部分与 ADR-057 无关,
 * 原样保留在新用例里。有人把 ADR-057 那行代码加回来,新用例会当场变红。
 */
describe('🔴 T3 gate · 启动锁定只写 lockUntil,不碰 masterEnabled(ADR-076)', () => {
  it('🔴 主开关 OFF 时启动锁定 → 允许,但 masterEnabled **原样保持 false**', async () => {
    const { repo, clock, area } = makeRepo();
    /*
      前置状态仍取「主开关 OFF」—— 虽然 UI 上已不可达,但仓储层是
      **独立的强制层**(INV-14 / ADR-055):绕过 UI 的调用(service worker、
      控制台)照样能走到这里。所以这条路径的**行为**必须被钉死,
      而新行为是「不碰主开关」,不是「拒绝」。
    */
    await repo.setMasterEnabled(false);
    expect((await repo.read()).masterEnabled).toBe(false);

    const setsBefore = area.setCallCount;
    const until = clock.now() + 3_600_000;
    const res = await repo.setLockUntil(until);

    expect(res.ok).toBe(true);
    const s = await repo.read();
    expect(s.lockUntil).toBe(until);
    // 🔴 ADR-076:主开关**没有**被悄悄带开。
    expect(
      s.masterEnabled,
      'ADR-076:启动锁定不得连带开启主开关(ADR-057 已废止)',
    ).toBe(false);

    // 「一次写入完成,无中间态」—— 这条与 ADR-057 无关,原样保留。
    expect(area.setCallCount - setsBefore).toBe(1);
  });

  it('onChanged 只看到一帧,且那一帧的 masterEnabled 未被改动', async () => {
    const { repo, clock } = makeRepo();
    await repo.setMasterEnabled(false);

    const frames: FilterSettings[] = [];
    repo.subscribe((s) => frames.push(s));

    await repo.setLockUntil(clock.now() + 60_000);

    // 一帧 —— 「无中间态」的原断言,一字未动。
    expect(frames).toHaveLength(1);
    expect(frames[0]?.lockUntil).not.toBeNull();
    // 🔴 ADR-076:那一帧里 masterEnabled 仍是调用前的值。
    expect(frames[0]?.masterEnabled).toBe(false);
  });

  it('🔴 主开关 ON 时启动锁定同样不碰它(两个方向都钉住,排除「恒为 false」)', async () => {
    const { repo, clock } = makeRepo();
    expect((await repo.read()).masterEnabled).toBe(true);

    expect((await repo.setLockUntil(clock.now() + 60_000)).ok).toBe(true);
    expect((await repo.read()).masterEnabled).toBe(true);
  });

  it('锁定中延长不改动 masterEnabled —— 它本就已被 ADR-051 冻结', async () => {
    const { repo, clock } = makeRepo();
    const until = clock.now() + 60_000;
    await repo.setLockUntil(until);
    // 默认即 ON,且启动锁定没有改动它(ADR-076)。
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
/**
 * 🔴 **ADR-071 门禁 —— 读路径零写入。**
 *
 * `maxSeenTime` / `effectiveNow` / INV-15(时钟倒退防范)已**整条废止**:
 * 改系统时钟绕过锁定本就允许(§4.1 记录为无法防范的途径),既然不防作弊,
 * 这条防范就失去了存在理由。
 *
 * 废止的**核心收益**是这组测试守着的东西:原实现为维持单调下界,必须在
 * **读路径**也更新 `maxSeenTime`,采用 read-modify-write **整体回写** ——
 * 读出整个 settings、改一个字段、写回整个对象。期间若用户改了规则,
 * 那次改动就被旧快照覆盖(实测规则数应为 1 实际为 0,**用户规则被静默吃掉**)。
 *
 * 读路径零写入是 ADR-071 的核心保证,下面的断言是它的门禁:
 * 只要读路径一行写盘都没有,这条竞态在**结构上**不可能复活。
 */
describe('🔴 T3 gate · 读路径不得写盘(ADR-071)', () => {
  it('read() 不产生任何 storage.set', async () => {
    const { repo, clock, area } = makeRepo();
    await repo.addRule(rule('a.com'));
    await repo.setLockUntil(clock.now() + 3_600_000);

    const baseline = area.setCallCount;

    // 锁定期间的正常使用:只读(popup 打开、content script 读取)。
    // 时间大幅前进也不该引出任何写入 —— 已经没有下界需要落盘了。
    for (let i = 0; i < 20; i += 1) {
      clock.advance(60_000);
      await repo.read();
    }

    expect(area.setCallCount).toBe(baseline);
  });

  it('isCurrentlyLocked() 这条读路径同样不产生任何 storage.set', async () => {
    const { repo, clock, area } = makeRepo();
    await repo.setLockUntil(clock.now() + 3_600_000);

    const baseline = area.setCallCount;

    clock.advance(30 * 60_000);
    expect(await repo.isCurrentlyLocked()).toBe(true);
    clock.advance(10 * 86_400_000); // 锁定早已过期
    expect(await repo.isCurrentlyLocked()).toBe(false);

    expect(area.setCallCount).toBe(baseline);
  });

  it('空存储 / 垃圾数据上的读同样零写入 —— 读不得「顺手修复」磁盘', async () => {
    const empty = makeRepo();
    await empty.repo.read();
    await empty.repo.read();
    expect(empty.area.setCallCount).toBe(0);

    const area = new MemoryStorageArea();
    area.seed({ [SETTINGS_KEY]: 'garbage' });
    const repo = new SettingsRepository({ area, clock: () => T0 });
    await repo.read();
    expect(area.setCallCount).toBe(0);
    // 磁盘上的垃圾原样保留 —— 回退只发生在内存里(ADR-041)。
    expect(area.snapshot()[SETTINGS_KEY]).toBe('garbage');
  });

  it('🔴 跨实例:在途的读路径回写跨越用户写入时,磁盘终态仍是用户的写入', async () => {
    // 这是 ADR-071 废止掉的那个真实缺陷的回归断言,**精确复现竞态时序**:
    //   后台实例的 get 已返回(规则为空)→ 用户并发加了一条规则落盘
    //   → 后台实例此刻才发出整体回写 → 用旧快照把用户的规则覆盖掉。
    // 这里用一个「可闸住 get」的 area 把后台读卡在那个窗口里。
    const area = new MemoryStorageArea();
    let releaseGet = (): void => undefined;
    const gateOpened = new Promise<void>((resolve) => {
      releaseGet = () => {
        resolve();
      };
    });

    const realGet = area.get.bind(area);
    let gated = false;
    area.get = async (keys) => {
      const result = await realGet(keys);
      if (!gated) {
        gated = true;
        // 第一次 get 已经拿到「规则为空」的快照,但在这里挂住 ——
        // 调用方要到 gate 放开之后才会继续(可能去发出回写)。
        await gateOpened;
      }
      return result;
    };

    const background = new SettingsRepository({ area, clock: () => T0 });
    const user = new SettingsRepository({ area, clock: () => T0 });

    // 后台读启动并卡在 get 之后 —— 刻意**不 await**。
    const inflight = background.read();
    await Promise.resolve();

    // 用户在这个窗口里加了一条规则,已经落盘。
    expect((await user.addRule(rule('user-added.com'))).ok).toBe(true);

    // 放开后台读 —— 原实现会在此刻用旧快照整体回写,吃掉用户的规则。
    releaseGet();
    await inflight;

    // 🔴 磁盘终态必须是用户的写入。读路径零写入 ⇒ 结构上不可能被覆盖。
    const disk = coerceSettings(area.snapshot()[SETTINGS_KEY]);
    expect(disk.rules).toHaveLength(1);
    expect(disk.rules[0]?.pattern).toBe('user-added.com');
  });

  it('🔴 跨实例:被拒绝的写入之后的推进同样不回滚并发的用户写入', async () => {
    // 原实现在**被拒绝的写入**之后仍要推进 maxSeenTime(旧 INV-11 例外 b),
    // 同样是整体回写 —— 于是一次被拒的写入也能吃掉并发的用户规则。
    // ADR-071 删除了例外 b:拒绝路径一行都不写盘。
    const area = new MemoryStorageArea();
    let releaseGet = (): void => undefined;
    const gateOpened = new Promise<void>((resolve) => {
      releaseGet = () => {
        resolve();
      };
    });

    const realGet = area.get.bind(area);
    let gated = false;
    area.get = async (keys) => {
      const result = await realGet(keys);
      if (!gated) {
        gated = true;
        await gateOpened;
      }
      return result;
    };

    const attacker = new SettingsRepository({ area, clock: () => T0 });
    const user = new SettingsRepository({ area, clock: () => T0 });

    // 攻击者发起一次**注定被拒**的写入(过去的时间戳 → 等于一键解锁,必拒),
    // 它的 get 卡在闸门后,拿到的是「规则为空」的旧快照。
    const inflight = attacker.setLockUntil(T0 - 1_000);
    await Promise.resolve();

    // 用户在这个窗口里加了一条规则,已经落盘。
    expect((await user.addRule(rule('user-added.com'))).ok).toBe(true);

    releaseGet();
    const rejected = await inflight;
    expect(rejected.ok).toBe(false);

    // 🔴 被拒绝的写入不得回滚用户刚添加的规则(实测曾是 1 变 0)。
    const disk = coerceSettings(area.snapshot()[SETTINGS_KEY]);
    expect(disk.rules).toHaveLength(1);
    expect(disk.rules[0]?.pattern).toBe('user-added.com');
  });

  it('🔴 被拒绝的写入之后磁盘**全字段**深度相等(INV-11 单一语义)', async () => {
    // ADR-071 删除例外 b 后不再有任何豁免字段,故可以做整对象深度相等 ——
    // 这比原来「排除 maxSeenTime 的三元组相等」强得多。
    const { repo, clock, area } = makeRepo();
    await repo.addRule(rule('a.com'));
    await repo.addRule(rule('b.com'));
    await repo.setLockUntil(clock.now() + 3_600_000);

    const before = persisted(area);
    const setsBefore = area.setCallCount;

    clock.advance(5_000);
    expect((await repo.setMasterEnabled(false)).ok).toBe(false);
    expect((await repo.addRule(rule('c.com'))).ok).toBe(false);
    expect((await repo.removeRule(0)).ok).toBe(false);
    expect((await repo.updateRule(0, { intensity: 1 })).ok).toBe(false);
    expect((await repo.reorderRule(0, 1)).ok).toBe(false);
    expect((await repo.setLockUntil(null)).ok).toBe(false);

    // 全字段深度相等 —— 不再有「例外 b」可以豁免。
    expect(persisted(area)).toEqual(before);
    // 且这些拒绝一次 storage.set 都没有产生。
    expect(area.setCallCount).toBe(setsBefore);
  });

  it('持久化 JSON 里不存在 maxSeenTime(ADR-071 已废止该字段)', async () => {
    const { repo, clock, area } = makeRepo();
    await repo.addRule(rule('a.com'));
    await repo.setLockUntil(clock.now() + 60_000);

    expect(persisted(area)).not.toHaveProperty('maxSeenTime');
    expect(PERSISTED_SETTINGS_KEYS).not.toContain('maxSeenTime');
  });

  it('历史数据里的 maxSeenTime 在下一次写入时被清掉,不被带回磁盘', async () => {
    const area = new MemoryStorageArea();
    area.seed({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: true,
        rules: [],
        lockUntil: null,
        maxSeenTime: T0 + 999,
      },
    });
    const repo = new SettingsRepository({ area, clock: () => T0 });

    // 读不碰磁盘,旧字段仍在。
    await repo.read();
    expect(persisted(area)).toHaveProperty('maxSeenTime');

    // 一次正常写入之后,`toPersisted` 的逐字段拷贝把它彻底清掉(ADR-025)。
    expect((await repo.addRule(rule('a.com'))).ok).toBe(true);
    expect(persisted(area)).not.toHaveProperty('maxSeenTime');
  });

  it('时钟倒退后锁定按**绝对时间**继续有效(ADR-071 不做任何防范,但也不误判)', async () => {
    // ADR-071 已接受「时钟拨快可绕过锁定」。但拨**慢**时锁定不该失效 ——
    // `isLocked` 的语义是 `now < lockUntil`,倒退只会让锁显得更长(已接受的代价)。
    const { repo, clock } = makeRepo();
    const until = clock.now() + 3_600_000;
    await repo.setLockUntil(until);

    clock.set(T0 - 86_400_000); // 往回拨一整天

    expect(await repo.isCurrentlyLocked()).toBe(true);
    expect((await repo.setMasterEnabled(false)).ok).toBe(false);
    // 缩短仍被拒(INV-12 与时钟无关)。
    expect((await repo.setLockUntil(until - 1_000)).ok).toBe(false);
    expect((await repo.read()).lockUntil).toBe(until);
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

  it('updateRule 修改强度(ADR-021;ADR-075 后模式无可改项)', async () => {
    await h.repo.addRule(rule('x.com'));
    const res = await h.repo.updateRule(0, { mode: 'Grayscale', intensity: 33 });
    expect(res.ok).toBe(true);

    const r = (await h.repo.read()).rules[0];
    expect(r?.mode).toBe('Grayscale');
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

// ════════════════════════════════════════════════════════════════════════
describe('🔒🔴 ADR-077 · applyExpiryAutoOff —— 到期自动关闭主开关', () => {
  /** 布置一个「锁到 T0+60s」的已锁定状态,主开关 ON。 */
  function lockedAt(h: Harness, untilOffsetMs = 60_000): void {
    h.area.seed({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: true,
        rules: [rule('a.com')],
        lockUntil: T0 + untilOffsetMs,
      },
    });
  }

  // ─────────────── 正路:到期后真的关掉 ───────────────
  it('到期后 → masterEnabled 置为 false,applied 为 true', async () => {
    const h = makeRepo();
    lockedAt(h);
    h.clock.set(T0 + 60_001); // 已过期

    const result = await h.repo.applyExpiryAutoOff();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.applied).toBe(true);
    expect(result.value.settings.masterEnabled).toBe(false);
    // 真的落盘了,不只是返回值。
    expect(persisted(h.area).masterEnabled).toBe(false);
  });

  it('🔴 边界:now === lockUntil 的那一毫秒就关(与 isLocked 的开区间同口径)', async () => {
    const h = makeRepo();
    lockedAt(h);
    h.clock.set(T0 + 60_000); // 恰好等于 lockUntil

    // 同一时刻 isCurrentlyLocked 必须已是 false —— 两者口径一致。
    expect(await h.repo.isCurrentlyLocked()).toBe(false);

    const result = await h.repo.applyExpiryAutoOff();
    expect(result.ok && result.value.applied).toBe(true);
    expect(persisted(h.area).masterEnabled).toBe(false);
  });

  it('🔴 只改 masterEnabled —— rules 原样保留(INV-8:规则全部保留)', async () => {
    const h = makeRepo();
    h.area.seed({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: true,
        rules: [rule('a.com'), rule('b.com', { intensity: 33 })],
        lockUntil: T0 + 1_000,
      },
    });
    h.clock.set(T0 + 2_000);

    await h.repo.applyExpiryAutoOff();

    const after = persisted(h.area);
    expect(after.masterEnabled).toBe(false);
    expect(after.rules).toEqual([
      { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
      { pattern: 'b.com', mode: 'Grayscale', intensity: 33 },
    ]);
  });

  it('🔴 **不清除** lockUntil —— 它原值保留(ADR-052:不为自动关闭开缩短的特例)', async () => {
    const h = makeRepo();
    lockedAt(h, 1_000);
    h.clock.set(T0 + 2_000);

    await h.repo.applyExpiryAutoOff();

    // lockUntil 仍是那个过去的时间戳,一字未动。
    expect(persisted(h.area).lockUntil).toBe(T0 + 1_000);
  });

  it('持久化键集不变(ADR-025:不因本功能新增任何字段)', async () => {
    const h = makeRepo();
    lockedAt(h, 1_000);
    h.clock.set(T0 + 2_000);

    await h.repo.applyExpiryAutoOff();

    expect(Object.keys(persisted(h.area)).sort()).toEqual(
      [...PERSISTED_SETTINGS_KEYS].sort(),
    );
  });

  // ─────────────── 🔴🔴 守住锁定强制:锁定期内必须拒绝 ───────────────
  it('🔴🔴 锁定中调用 → **被拒绝**,返回 kind:locked(绝不是关主开关的后门)', async () => {
    const h = makeRepo();
    lockedAt(h);
    h.clock.set(T0 + 30_000); // 锁定中,还剩 30s

    const result = await h.repo.applyExpiryAutoOff();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('locked');
    expect(result.error.reason).toBe('locked-master-enabled');
  });

  it('🔴🔴 锁定中被拒后,**全字段**深度相等(INV-11:拒绝路径不写盘)', async () => {
    const h = makeRepo();
    lockedAt(h);
    h.clock.set(T0 + 30_000);

    const before = persisted(h.area);
    const setsBefore = h.area.setCallCount;

    const result = await h.repo.applyExpiryAutoOff();

    expect(result.ok).toBe(false);
    // 全字段深度相等 —— ADR-071 之后不再有任何豁免字段。
    expect(persisted(h.area)).toEqual(before);
    // 一次 storage.set 都没发出。
    expect(h.area.setCallCount).toBe(setsBefore);
  });

  it('🔴🔴 与 setMasterEnabled(false) 在同一时刻**行为一致** —— 没有第二套判定', async () => {
    const h = makeRepo();
    lockedAt(h);
    h.clock.set(T0 + 30_000); // 锁定中

    const viaAutoOff = await h.repo.applyExpiryAutoOff();
    const viaSetter = await h.repo.setMasterEnabled(false);

    // 两条路径都被拒,且分类一致 —— 自动关闭没有比 setMasterEnabled 更宽松。
    expect(viaAutoOff.ok).toBe(false);
    expect(viaSetter.ok).toBe(false);
    if (viaAutoOff.ok || viaSetter.ok) return;
    expect(viaAutoOff.error.kind).toBe(viaSetter.error.kind);
    expect(viaAutoOff.error.reason).toBe(viaSetter.error.reason);
  });

  it('🔴🔴 锁定期内**反复**调用都挡住(不存在「多调几次就穿了」的路径)', async () => {
    const h = makeRepo();
    lockedAt(h);
    h.clock.set(T0 + 30_000);

    for (let i = 0; i < 25; i++) {
      const r = await h.repo.applyExpiryAutoOff();
      expect(r.ok).toBe(false);
    }
    expect(persisted(h.area).masterEnabled).toBe(true);
    expect(h.area.setCallCount).toBe(0);
  });

  it('🔴🔴 全时间轴扫描:锁定期内任一时刻都拒绝,到期起才放行', async () => {
    // 这条用穷举钉住「不可能在锁定期内关闭」这个不变式 ——
    // 比挑几个时刻更难被一次疏忽的改动绕过。
    const LOCK_UNTIL = T0 + 10;
    for (let now = T0; now <= T0 + 20; now++) {
      const h = makeRepo();
      h.area.seed({
        [SETTINGS_KEY]: {
          version: 1,
          masterEnabled: true,
          rules: [],
          lockUntil: LOCK_UNTIL,
        },
      });
      h.clock.set(now);

      const result = await h.repo.applyExpiryAutoOff();
      const shouldAllow = now >= LOCK_UNTIL;

      expect(result.ok, `now=${String(now - T0)}`).toBe(shouldAllow);
      expect(persisted(h.area).masterEnabled, `now=${String(now - T0)}`).toBe(
        !shouldAllow,
      );
    }
  });

  it('🔴 不接受任何参数 —— 调用方无法伪造「已到期」(判据只来自仓储层的时钟)', () => {
    // 签名层面的保证:零参数 ⇒ 没有可被伪造的输入。
    // 这不是风格检查 —— 若将来有人加一个 `now` 参数,
    // 「从 SW 传一个未来时刻即可解锁」就成立了。
    expect(SettingsRepository.prototype.applyExpiryAutoOff.length).toBe(0);
  });

  // ─────────────── 幂等:no-op 不写盘 ───────────────
  it('lockUntil = null(从未锁过)→ no-op,applied 为 false,**不写盘**', async () => {
    const h = makeRepo();
    h.area.seed({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: true,
        rules: [rule('a.com')],
        lockUntil: null,
      },
    });

    const result = await h.repo.applyExpiryAutoOff();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.applied).toBe(false);
    // 🔴 主开关仍是 ON —— 从未锁过的用户的滤镜不得被关掉。
    expect(persisted(h.area).masterEnabled).toBe(true);
    expect(h.area.setCallCount).toBe(0);
  });

  it('已过期且 masterEnabled 已是 false → no-op,applied 为 false,**不写盘**', async () => {
    const h = makeRepo();
    h.area.seed({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: false,
        rules: [],
        lockUntil: T0 + 1_000,
      },
    });
    h.clock.set(T0 + 2_000);

    const result = await h.repo.applyExpiryAutoOff();

    expect(result.ok && result.value.applied).toBe(false);
    expect(h.area.setCallCount).toBe(0);
  });

  it('🔴 幂等:连续调用两次,第二次是 no-op 且不产生第二次 storage.set', async () => {
    const h = makeRepo();
    lockedAt(h, 1_000);
    h.clock.set(T0 + 2_000);

    const first = await h.repo.applyExpiryAutoOff();
    const setsAfterFirst = h.area.setCallCount;
    const second = await h.repo.applyExpiryAutoOff();

    expect(first.ok && first.value.applied).toBe(true);
    expect(second.ok && second.value.applied).toBe(false);
    expect(h.area.setCallCount).toBe(setsAfterFirst);
  });

  // ─────────────── 其余路径 ───────────────
  it('存储为空 → no-op(默认 lockUntil 为 null),不抛', async () => {
    const h = makeRepo();
    const result = await h.repo.applyExpiryAutoOff();
    expect(result.ok && result.value.applied).toBe(false);
  });

  it('垃圾数据 → 按 ADR-041 回退默认值后 no-op,不抛', async () => {
    const h = makeRepo();
    h.area.seed({ [SETTINGS_KEY]: 'not an object' });
    const result = await h.repo.applyExpiryAutoOff();
    expect(result.ok && result.value.applied).toBe(false);
  });

  it('写入失败 → 返回 ADR-046 结构化错误,不 throw', async () => {
    const h = makeRepo();
    lockedAt(h, 1_000);
    h.clock.set(T0 + 2_000);
    h.area.failSet = () => new Error('boom');

    const result = await h.repo.applyExpiryAutoOff();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('other');
    expect(result.error.reason).toBe('storage-failure');
    expect(result.error.cause).toContain('boom');
  });

  it('配额失败 → 归类为 quota(与其余写入路径同一分类口径)', async () => {
    const h = makeRepo();
    lockedAt(h, 1_000);
    h.clock.set(T0 + 2_000);
    h.area.failSet = () => new Error('QUOTA_BYTES exceeded');

    const result = await h.repo.applyExpiryAutoOff();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('quota');
  });

  it('读失败 → 回退默认值(lockUntil=null)后 no-op,不抛(ADR-041)', async () => {
    const h = makeRepo();
    h.area.failGet = () => new Error('read boom');
    const result = await h.repo.applyExpiryAutoOff();
    expect(result.ok && result.value.applied).toBe(false);
  });

  it('成功的自动关闭会触发 onChanged 订阅(INV-4:popup / 其他 tab 立即跟进)', async () => {
    const h = makeRepo();
    lockedAt(h, 1_000);
    h.clock.set(T0 + 2_000);

    const seen: FilterSettings[] = [];
    h.repo.subscribe((s) => seen.push(s));

    await h.repo.applyExpiryAutoOff();

    expect(seen.length).toBe(1);
    expect(seen[0]?.masterEnabled).toBe(false);
  });

  it('🔴 自动关闭之后,设置立刻可改(到期即解禁,ADR-077 的「同时」)', async () => {
    const h = makeRepo();
    lockedAt(h, 1_000);
    h.clock.set(T0 + 2_000);

    await h.repo.applyExpiryAutoOff();

    // 规则可改、主开关可开回来 —— 两者都在同一时刻放行。
    expect((await h.repo.addRule(rule('new.com'))).ok).toBe(true);
    expect((await h.repo.setMasterEnabled(true)).ok).toBe(true);
    expect(persisted(h.area).masterEnabled).toBe(true);
  });

  it('🔴 自动关闭后用户手动开回滤镜 → 不会被仓储层再次关掉(单次调用幂等)', async () => {
    const h = makeRepo();
    lockedAt(h, 1_000);
    h.clock.set(T0 + 2_000);

    await h.repo.applyExpiryAutoOff();      // 自动关闭
    await h.repo.setMasterEnabled(true);    // 用户手动开回来

    // 此刻状态是「已过期 + 开着」,纯函数会说 true —— 但真正的防线是
    // 调用时机(边沿 + SW 启动),见 useLockExpiry / LockExpiryScheduler。
    // 本条钉住的是:**用户的那次写入没有被自动关闭吃掉**。
    expect(persisted(h.area).masterEnabled).toBe(true);
  });

  it('🔴 延长锁定后到期时间推后 → 原到期时刻调用仍被拒(延长真的生效了)', async () => {
    const h = makeRepo();
    lockedAt(h, 10_000);           // 锁到 T0+10s
    h.clock.set(T0 + 5_000);
    await h.repo.setLockUntil(T0 + 60_000);  // 延长到 T0+60s

    h.clock.set(T0 + 11_000);      // 过了**原**到期时刻
    const result = await h.repo.applyExpiryAutoOff();

    expect(result.ok).toBe(false); // 仍锁着 —— 延长生效
    expect(persisted(h.area).masterEnabled).toBe(true);

    h.clock.set(T0 + 60_000);      // 过了**新**到期时刻
    expect((await h.repo.applyExpiryAutoOff()).ok).toBe(true);
    expect(persisted(h.area).masterEnabled).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('🔴🔴 红队 · 试图把 applyExpiryAutoOff 当成关闭主开关的后门(ADR-077)', () => {
  /**
   * 本组测试的立场是**攻击者**,不是使用者。
   *
   * ADR-077 在仓储层新增了一个会写 `masterEnabled: false` 的公开 API。
   * 若它少一道检查,「调用它即可解锁」—— 整个锁定功能(ADR-051/052,
   * INV-11/12/14)当场形同虚设。上面那组 describe 验的是正常语义;
   * 本组专门尝试**绕过**。
   */

  it('🔴 并发 200 次调用 + 并发延长 → 锁定期内主开关始终为 true', async () => {
    // 若实现里存在「先读后写」之间的竞态窗口,高并发最容易把它撞出来。
    const h = makeRepo();
    h.area.seed({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: true,
        rules: [],
        lockUntil: T0 + 100_000,
      },
    });

    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < 200; i++) {
      ops.push(h.repo.applyExpiryAutoOff());
      // 夹杂一些合法的延长写入,制造真实的交错。
      if (i % 10 === 0) ops.push(h.repo.setLockUntil(T0 + 100_000 + i * 1_000));
    }
    await Promise.all(ops);

    expect(persisted(h.area).masterEnabled).toBe(true);
  });

  it('🔴 TOCTOU:时钟在调用途中跳到未来,也不能让锁定期内的关闭成功', async () => {
    // 判据必须在**一次** readContext 里一次性取定(ctx.now),
    // 而不是在方法体内多次读时钟 —— 后者允许「第一次读到锁定中、
    // 第二次读到已到期」这种自相矛盾的中间判定。
    const area = new MemoryStorageArea({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: true,
        rules: [],
        lockUntil: T0 + 100_000,
      },
    });
    let calls = 0;
    const repo = new SettingsRepository({
      area,
      // 第一次返回锁定期内,之后一律返回遥远的未来。
      clock: () => (calls++ === 0 ? T0 : T0 + 9_999_999),
    });

    const result = await repo.applyExpiryAutoOff();

    expect(result.ok).toBe(false);
    expect(
      (area.snapshot()[SETTINGS_KEY] as { masterEnabled: boolean }).masterEnabled,
    ).toBe(true);
  });

  it('🔴 到期关闭 → 用户开回 → 重新上锁 → 新锁期内仍然关不掉', async () => {
    const h = makeRepo({ now: T0 + 2_000 });
    h.area.seed({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: true,
        rules: [],
        lockUntil: T0 + 1_000,
      },
    });

    // 1) 到期自动关闭(合法)
    expect((await h.repo.applyExpiryAutoOff()).ok).toBe(true);
    // 2) 用户手动开回来(合法 —— 此刻未锁定)
    expect((await h.repo.setMasterEnabled(true)).ok).toBe(true);
    // 3) 重新上一个锁
    expect((await h.repo.setLockUntil(T0 + 60_000)).ok).toBe(true);
    // 4) 🔴 试图在**新锁**期内用自动关闭把它关掉
    const attack = await h.repo.applyExpiryAutoOff();

    expect(attack.ok).toBe(false);
    expect(persisted(h.area).masterEnabled).toBe(true);
  });

  it('🔴 不能通过「先把 lockUntil 写成过去值」来解锁(canSetLockUntil 挡在前面)', async () => {
    // 这条确认两道闸是**串联**的:即使攻击者先试图把锁改短,
    // 那一步本身就会被 ADR-052 拒绝,于是自动关闭永远看不到「已过期」。
    const h = makeRepo();
    h.area.seed({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: true,
        rules: [],
        lockUntil: T0 + 100_000,
      },
    });

    const shorten = await h.repo.setLockUntil(T0 - 1);
    expect(shorten.ok).toBe(false);
    const clear = await h.repo.setLockUntil(null);
    expect(clear.ok).toBe(false);

    // 锁没动 → 自动关闭仍被拒。
    expect((await h.repo.applyExpiryAutoOff()).ok).toBe(false);
    expect(persisted(h.area).masterEnabled).toBe(true);
    expect(persisted(h.area).lockUntil).toBe(T0 + 100_000);
  });

  it('🔴 `setLockUntilImmediate` 的快照路径也不能被用来造出「已过期」的假象', async () => {
    // `setLockUntilImmediate` 用 `#cachedSettings` 同步判定(为了不丢写)。
    // 本条确认:即使那个快照是陈旧的,也不会让自动关闭在锁定期内放行 ——
    // 因为 `applyExpiryAutoOff` **不读快照**,它自己重新读盘。
    const h = makeRepo();
    h.area.seed({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: true,
        rules: [],
        lockUntil: T0 + 100_000,
      },
    });
    // 让仓储层先缓存一份快照。
    await h.repo.read();
    // 从「别处」把盘上的锁改得更长(模拟另一个窗口),快照随之陈旧。
    h.area.seed({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: true,
        rules: [],
        lockUntil: T0 + 500_000,
      },
    });

    const result = await h.repo.applyExpiryAutoOff();

    expect(result.ok).toBe(false);
    expect(persisted(h.area).masterEnabled).toBe(true);
  });
});
