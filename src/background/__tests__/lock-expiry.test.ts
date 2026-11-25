/**
 * 🔒 ADR-077 · `LockExpiryScheduler` —— 到期自动关闭的**触发器**。
 *
 * 本文件测的是「**何时**去问仓储层」,不是「该不该关」——
 * 后者在 `src/domain/__tests__/filter-settings.test.ts`(纯函数)与
 * `src/storage/__tests__/settings-repository.test.ts`(强制点)里。
 * 职责分开是刻意的:若本文件也去断言锁定强制,
 * 那条强制就有了两份测试,而其中一份盯的是一个**没有强制权**的类。
 *
 * ⚠️ 本文件**不冒充 REAL_STACK_GATE**(§8 第 8 条):
 * 「真实 Chrome 上等到真实到期、磁盘上 masterEnabled 变 false」
 * 在 `docs/T7-gate/lock-expiry-autooff.cjs` 与 `lock-expiry-catchup.cjs` 里跑。
 * 这里验的是触发逻辑的**分支穷尽**,那是真实栈难以逐条覆盖的部分。
 */
import { describe, expect, it, vi } from 'vitest';

import { type FilterSettings, defaultSettings } from '../../domain/index.js';
import { type WriteResult } from '../../storage/errors.js';
import { LOCK_EXPIRY_ALARM, LockExpiryScheduler } from '../lock-expiry.js';
import { FakeAlarms } from './fakes.js';

const T0 = 1_700_000_000_000;

type AutoOffResult = WriteResult<{
  readonly settings: FilterSettings;
  readonly applied: boolean;
}>;

function settingsWith(lockUntil: number | null, masterEnabled = true): FilterSettings {
  return { ...defaultSettings(), lockUntil, masterEnabled };
}

interface Harness {
  alarms: FakeAlarms;
  scheduler: LockExpiryScheduler;
  /** 当前「磁盘上」的设置 —— 测试可直接改。 */
  state: { settings: FilterSettings };
  now: { value: number };
  applyCalls: number;
  errors: { where: string; error: unknown }[];
  autoOffs: FilterSettings[];
  /** 覆盖 applyAutoOff 的返回(默认模拟真实仓储层语义)。 */
  applyOverride: { fn: (() => Promise<AutoOffResult>) | null };
}

/**
 * 装一套替身。
 *
 * 🔴 默认的 `applyAutoOff` **模拟真实仓储层的语义**(含锁定拒绝与幂等),
 * 而不是无条件成功 —— 否则「闹钟迟到期间用户延长了锁定」这类分支
 * 会在一个永远成功的替身上假绿。
 */
function makeHarness(initial: FilterSettings, now = T0): Harness {
  const alarms = new FakeAlarms();
  const state = { settings: initial };
  const nowRef = { value: now };
  const errors: { where: string; error: unknown }[] = [];
  const autoOffs: FilterSettings[] = [];
  const applyOverride: { fn: (() => Promise<AutoOffResult>) | null } = { fn: null };
  const h = {
    alarms,
    state,
    now: nowRef,
    applyCalls: 0,
    errors,
    autoOffs,
    applyOverride,
  } as Harness;

  h.scheduler = new LockExpiryScheduler({
    alarms,
    readSettings: () => Promise.resolve(state.settings),
    applyAutoOff: () => {
      h.applyCalls += 1;
      if (applyOverride.fn) return applyOverride.fn();
      // ── 真实仓储层语义的最小复刻 ──
      const s = state.settings;
      const lockUntil = s.lockUntil;
      const locked =
        lockUntil !== null && Number.isFinite(lockUntil) && nowRef.value < lockUntil;
      if (locked) {
        return Promise.resolve({
          ok: false as const,
          error: {
            kind: 'locked' as const,
            reason: 'locked-master-enabled' as const,
            message: '锁定中',
          },
        });
      }
      const needs =
        lockUntil !== null && Number.isFinite(lockUntil) && s.masterEnabled;
      if (!needs) {
        return Promise.resolve({ ok: true as const, value: { settings: s, applied: false } });
      }
      state.settings = { ...s, masterEnabled: false };
      return Promise.resolve({
        ok: true as const,
        value: { settings: state.settings, applied: true },
      });
    },
    clock: () => nowRef.value,
    onError: (where, error) => errors.push({ where, error }),
    onAutoOff: (s) => autoOffs.push(s),
  });
  return h;
}

describe('ADR-077 · 闹钟的排期', () => {
  it('lockUntil 在未来 → 排一个 when = lockUntil 的闹钟', async () => {
    const h = makeHarness(settingsWith(T0 + 60_000));
    await h.scheduler.reschedule();

    expect(h.alarms.createCalls).toEqual([
      { name: LOCK_EXPIRY_ALARM, when: T0 + 60_000 },
    ]);
    expect(h.alarms.alarms.get(LOCK_EXPIRY_ALARM)).toBe(T0 + 60_000);
  });

  it('🔴 闹钟的 when 就是 lockUntil 本身,不加任何余量', async () => {
    // 加余量会让自动关闭比到期晚;而「晚」已经由平台的迟到贡献了,
    // 我们不该再主动加。
    const h = makeHarness(settingsWith(T0 + 12_345));
    await h.scheduler.reschedule();
    expect(h.alarms.createCalls[0]?.when).toBe(T0 + 12_345);
  });

  it('lockUntil 为 null → **清掉**闹钟,不排新的', async () => {
    const h = makeHarness(settingsWith(null));
    await h.scheduler.reschedule();

    expect(h.alarms.createCalls).toEqual([]);
    expect(h.alarms.clearCalls).toEqual([LOCK_EXPIRY_ALARM]);
  });

  it('lockUntil 已过去 → 清掉闹钟(不留一个永不重置的过期闹钟)', async () => {
    const h = makeHarness(settingsWith(T0 - 1_000));
    await h.scheduler.reschedule();

    expect(h.alarms.createCalls).toEqual([]);
    expect(h.alarms.clearCalls).toEqual([LOCK_EXPIRY_ALARM]);
  });

  it('lockUntil 恰好等于 now → 清掉(此刻已不锁定,与 isLocked 同口径)', async () => {
    const h = makeHarness(settingsWith(T0));
    await h.scheduler.reschedule();
    expect(h.alarms.clearCalls).toEqual([LOCK_EXPIRY_ALARM]);
  });

  it('lockUntil 为 NaN / Infinity → 清掉(不排一个非法 when 的闹钟)', async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const h = makeHarness(settingsWith(bad));
      await h.scheduler.reschedule();
      expect(h.alarms.createCalls).toEqual([]);
      expect(h.alarms.clearCalls).toEqual([LOCK_EXPIRY_ALARM]);
    }
  });

  it('🔴 延长锁定 → 同名 create **原地替换**,不先 clear(无「没有闹钟」的窗口)', async () => {
    const h = makeHarness(settingsWith(T0 + 60_000));
    await h.scheduler.onSettingsChanged();
    // 用户延长到 T0+600s
    h.state.settings = settingsWith(T0 + 600_000);
    await h.scheduler.onSettingsChanged();

    expect(h.alarms.createCalls).toEqual([
      { name: LOCK_EXPIRY_ALARM, when: T0 + 60_000 },
      { name: LOCK_EXPIRY_ALARM, when: T0 + 600_000 },
    ]);
    // 🔴 一次 clear 都没有 —— clear 与 create 之间的窗口若遇上 SW 回收,
    //    这段锁定就永久失去了闹钟。
    expect(h.alarms.clearCalls).toEqual([]);
    // 替身复刻了平台的同名替换:只剩一个闹钟,时间是新的。
    expect(h.alarms.alarms.size).toBe(1);
    expect(h.alarms.alarms.get(LOCK_EXPIRY_ALARM)).toBe(T0 + 600_000);
  });

  it('读设置失败 → 记诊断,**不抛**(SW 里的 unhandled rejection 会很难查)', async () => {
    const alarms = new FakeAlarms();
    const errors: { where: string; error: unknown }[] = [];
    const scheduler = new LockExpiryScheduler({
      alarms,
      readSettings: () => Promise.reject(new Error('read boom')),
      applyAutoOff: () =>
        Promise.resolve({ ok: true, value: { settings: defaultSettings(), applied: false } }),
      onError: (where, error) => errors.push({ where, error }),
    });

    await expect(scheduler.reschedule()).resolves.toBeUndefined();
    expect(errors.map((e) => e.where)).toContain('reschedule.read');
    expect(alarms.createCalls).toEqual([]);
  });

  it('闹钟 create 失败 → 记诊断,不抛(catchUp 仍会在下次 SW 启动时补做)', async () => {
    const h = makeHarness(settingsWith(T0 + 60_000));
    h.alarms.failNextCreate = true;

    await expect(h.scheduler.reschedule()).resolves.toBeUndefined();
    expect(h.errors.map((e) => e.where)).toContain('reschedule');
  });

  it('默认时钟为 Date.now(不注入 clock 时也能正确判断未来/过去)', async () => {
    const alarms = new FakeAlarms();
    const scheduler = new LockExpiryScheduler({
      alarms,
      readSettings: () => Promise.resolve(settingsWith(Date.now() + 3_600_000)),
      applyAutoOff: () =>
        Promise.resolve({ ok: true, value: { settings: defaultSettings(), applied: false } }),
    });
    await scheduler.reschedule();
    expect(alarms.createCalls.length).toBe(1);
  });
});

describe('🔴 ADR-077 · 补偿(catchUp)—— 「关机过夜」唯一的防线', () => {
  it('lockUntil 已过去且 masterEnabled 为 true → 补做关闭', async () => {
    const h = makeHarness(settingsWith(T0 - 1_000, true));

    const applied = await h.scheduler.catchUp();

    expect(applied).toBe(true);
    expect(h.state.settings.masterEnabled).toBe(false);
    expect(h.autoOffs.length).toBe(1);
  });

  it('🔴 catchUpAndReschedule:先补偿、**再**重排(顺序决定结果)', async () => {
    // 补偿会改状态;若先重排,重排看到的是补偿前的状态。
    // 本例里补偿后 lockUntil 已过去 → 重排应当 clear。
    const h = makeHarness(settingsWith(T0 - 1_000, true));

    await h.scheduler.catchUpAndReschedule();

    expect(h.state.settings.masterEnabled).toBe(false);
    expect(h.alarms.clearCalls).toEqual([LOCK_EXPIRY_ALARM]);
    expect(h.alarms.createCalls).toEqual([]);
  });

  it('锁定仍有效 → catchUp 不做事,且**不记诊断**(locked 是预期行为,不是故障)', async () => {
    const h = makeHarness(settingsWith(T0 + 60_000, true));

    const applied = await h.scheduler.catchUp();

    expect(applied).toBe(false);
    expect(h.state.settings.masterEnabled).toBe(true);
    // 🔴 每次 SW 在锁定期内启动都记一条「失败」会把诊断淹掉(ADR-046 的 I1)。
    expect(h.errors).toEqual([]);
  });

  it('锁定仍有效 → catchUpAndReschedule 仍会重排闹钟(锁没丢)', async () => {
    const h = makeHarness(settingsWith(T0 + 60_000, true));
    await h.scheduler.catchUpAndReschedule();
    expect(h.alarms.createCalls).toEqual([
      { name: LOCK_EXPIRY_ALARM, when: T0 + 60_000 },
    ]);
  });

  it('从未锁过(lockUntil=null)→ no-op,主开关不动', async () => {
    const h = makeHarness(settingsWith(null, true));
    const applied = await h.scheduler.catchUp();
    expect(applied).toBe(false);
    expect(h.state.settings.masterEnabled).toBe(true);
  });

  it('已过期但已经是 OFF → no-op(幂等)', async () => {
    const h = makeHarness(settingsWith(T0 - 1_000, false));
    const applied = await h.scheduler.catchUp();
    expect(applied).toBe(false);
  });

  it('非 locked 的失败 → 记一条诊断', async () => {
    const h = makeHarness(settingsWith(T0 - 1_000, true));
    h.applyOverride.fn = () =>
      Promise.resolve({
        ok: false,
        error: { kind: 'other', reason: 'storage-failure', message: 'boom' },
      });

    const applied = await h.scheduler.catchUp();

    expect(applied).toBe(false);
    expect(h.errors.map((e) => e.where)).toContain('catchUp');
  });

  it('applyAutoOff 抛异常 → 记诊断且**不向上抛**', async () => {
    const h = makeHarness(settingsWith(T0 - 1_000, true));
    h.applyOverride.fn = () => Promise.reject(new Error('kaboom'));

    await expect(h.scheduler.catchUp()).resolves.toBe(false);
    expect(h.errors.map((e) => e.where)).toContain('catchUp');
  });

  it('🔴 catchUp 不自己判断该不该关 —— 无条件调一次仓储层(判定在数据层)', async () => {
    // 哪怕状态明显「不该关」,也必须把判定交给仓储层(INV-14 / ADR-055)。
    const h = makeHarness(settingsWith(null, true));
    await h.scheduler.catchUp();
    expect(h.applyCalls).toBe(1);
  });

  it('onAutoOff 只在**真的关了**的时候回调(no-op 不通知)', async () => {
    const h = makeHarness(settingsWith(null, true));
    await h.scheduler.catchUp();
    expect(h.autoOffs).toEqual([]);
  });
});

describe('ADR-077 · 闹钟响了之后', () => {
  it('start() 装上监听;闹钟触发 → 调一次仓储层', async () => {
    const h = makeHarness(settingsWith(T0 - 1_000, true));
    h.scheduler.start();

    expect(h.alarms.listenerCount).toBe(1);
    h.alarms.fire(LOCK_EXPIRY_ALARM);
    // fire 是同步的,handleAlarm 是异步的 —— 等微任务队列排空。
    await vi.waitFor(() => {
      expect(h.state.settings.masterEnabled).toBe(false);
    });
  });

  it('🔴 只认自己的闹钟名 —— 别的闹钟触发时一个字节都不碰', async () => {
    const h = makeHarness(settingsWith(T0 - 1_000, true));
    h.scheduler.start();

    h.alarms.fire('some-other-feature-alarm');
    await Promise.resolve();
    await Promise.resolve();

    expect(h.applyCalls).toBe(0);
    expect(h.state.settings.masterEnabled).toBe(true);
  });

  it('🔴 闹钟响了也要重排 —— 迟到期间用户延长了锁定时,新到期时刻要有闹钟', async () => {
    // 场景:闹钟排在 T0+60s,但平台迟到到了 T0+90s;
    // 期间用户把锁延长到 T0+600s。
    const h = makeHarness(settingsWith(T0 + 60_000, true));
    h.state.settings = settingsWith(T0 + 600_000, true);
    h.now.value = T0 + 90_000;

    await h.scheduler.handleAlarm();

    // 关闭被正确拒绝(锁仍有效),但**新的到期时刻排上了闹钟**。
    expect(h.state.settings.masterEnabled).toBe(true);
    expect(h.alarms.createCalls).toEqual([
      { name: LOCK_EXPIRY_ALARM, when: T0 + 600_000 },
    ]);
  });

  it('闹钟响且确实到期 → 关闭后把闹钟清掉(不留过期闹钟)', async () => {
    const h = makeHarness(settingsWith(T0 - 1_000, true));
    await h.scheduler.handleAlarm();

    expect(h.state.settings.masterEnabled).toBe(false);
    expect(h.alarms.clearCalls).toEqual([LOCK_EXPIRY_ALARM]);
  });

  it('start() **幂等** —— 重复调用只装一次监听(否则每次闹钟处理两遍)', () => {
    const h = makeHarness(settingsWith(T0 + 60_000));
    h.scheduler.start();
    h.scheduler.start();
    h.scheduler.start();
    expect(h.alarms.listenerCount).toBe(1);
  });

  it('start() 本身不做任何读/写(只装监听)', () => {
    const h = makeHarness(settingsWith(T0 - 1_000, true));
    h.scheduler.start();
    expect(h.applyCalls).toBe(0);
    expect(h.alarms.createCalls).toEqual([]);
    expect(h.alarms.clearCalls).toEqual([]);
  });

  it('stop() 卸掉监听,之后闹钟不再被处理', async () => {
    const h = makeHarness(settingsWith(T0 - 1_000, true));
    h.scheduler.start();
    h.scheduler.stop();

    expect(h.alarms.listenerCount).toBe(0);
    h.alarms.fire(LOCK_EXPIRY_ALARM);
    await Promise.resolve();
    expect(h.applyCalls).toBe(0);
  });

  it('stop() 后可以重新 start()(热重载场景)', () => {
    const h = makeHarness(settingsWith(T0 + 60_000));
    h.scheduler.start();
    h.scheduler.stop();
    h.scheduler.start();
    expect(h.alarms.listenerCount).toBe(1);
  });

  it('取消订阅抛错时 stop() 不抛,只记诊断', () => {
    const alarms = new FakeAlarms();
    const errors: string[] = [];
    const scheduler = new LockExpiryScheduler({
      alarms: {
        create: () => Promise.resolve(),
        clear: () => Promise.resolve(),
        onAlarm: () => () => {
          throw new Error('unsub boom');
        },
      },
      readSettings: () => Promise.resolve(defaultSettings()),
      applyAutoOff: () =>
        Promise.resolve({ ok: true, value: { settings: defaultSettings(), applied: false } }),
      onError: (where) => errors.push(where),
    });
    scheduler.start();
    expect(() => scheduler.stop()).not.toThrow();
    expect(errors).toContain('unsubscribe');
    expect(alarms.listenerCount).toBe(0);
  });
});

describe('🔴 ADR-077 · onSettingsChanged 不得自触发', () => {
  it('🔴 只重排,**不**补偿 —— 否则挂在 subscribe 上会形成自触发循环', async () => {
    // 状态「已过期 + 还开着」:若 onSettingsChanged 调了 catchUp,
    // 这里就会产生一次写入(而生产中那次写入会再次触发 subscribe)。
    const h = makeHarness(settingsWith(T0 - 1_000, true));

    await h.scheduler.onSettingsChanged();

    // 一次都没调仓储层的写入路径。
    expect(h.applyCalls).toBe(0);
    expect(h.state.settings.masterEnabled).toBe(true);
  });

  it('启动锁定(lockUntil 从 null 变为未来)→ 排上闹钟', async () => {
    const h = makeHarness(settingsWith(null));
    await h.scheduler.onSettingsChanged();
    expect(h.alarms.clearCalls).toEqual([LOCK_EXPIRY_ALARM]);

    h.state.settings = settingsWith(T0 + 60_000);
    await h.scheduler.onSettingsChanged();
    expect(h.alarms.createCalls).toEqual([
      { name: LOCK_EXPIRY_ALARM, when: T0 + 60_000 },
    ]);
  });
});

describe('ADR-077 · 闹钟名是固定单例', () => {
  it('LOCK_EXPIRY_ALARM 是一个稳定的具名常量', () => {
    expect(LOCK_EXPIRY_ALARM).toBe('ccf-lock-expiry');
  });

  it('🔴 所有排期都用同一个名字(靠同名替换实现改期,见延长那条)', async () => {
    const h = makeHarness(settingsWith(T0 + 60_000));
    await h.scheduler.reschedule();
    h.state.settings = settingsWith(T0 + 120_000);
    await h.scheduler.reschedule();
    h.state.settings = settingsWith(T0 + 180_000);
    await h.scheduler.reschedule();

    expect(new Set(h.alarms.createCalls.map((c) => c.name))).toEqual(
      new Set([LOCK_EXPIRY_ALARM]),
    );
    expect(h.alarms.alarms.size).toBe(1);
  });
});

describe('🔴 ADR-077 · LockExpiryScheduler 零 chrome.*(可在 Node 下机械判定)', () => {
  it('源码的可执行部分不出现 chrome.*', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const code = readFileSync(resolve(here, '..', 'lock-expiry.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(code).not.toContain('chrome.');
  });

  it('🔴 不使用 setTimeout —— MV3 的 SW 随时被回收,它不是更简单的方案而是不工作的方案', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const code = readFileSync(resolve(here, '..', 'lock-expiry.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(code).not.toContain('setTimeout');
    expect(code).not.toContain('setInterval');
  });
});
