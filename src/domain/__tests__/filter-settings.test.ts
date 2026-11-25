/**
 * 聚合与锁定门禁(ADR-011/012/041/051/052/053/059,INV-7/11/12/15)。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createRule } from '../filter-rule.js';
import {
  MAX_RULES,
  addRule,
  canSetLockUntil,
  coerceSettings,
  defaultSettings,
  isAtRuleCapacity,
  isLocked,
  needsExpiryAutoOff,
  type FilterSettings,
} from '../filter-settings.js';

const DOMAIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 读取领域源码并**剥去注释** —— 断言的是「可执行代码里不调用 Date.now」,
 * 文档注释中说明「绝不调用 Date.now()」反而是应当保留的。
 */
function executableSourceOf(file: string): string {
  return readFileSync(resolve(DOMAIN_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function withLock(lockUntil: number | null): FilterSettings {
  return { ...defaultSettings(), lockUntil };
}

describe('INV-7 · 容量硬上限 20 条(ADR-011 / ADR-012)', () => {
  it('第 21 条规则被拒绝,且绝不静默淘汰已有规则', () => {
    let settings = defaultSettings();
    for (let i = 0; i < MAX_RULES; i++) {
      const result = addRule(settings, createRule(`site${i}.com`));
      expect(result.ok).toBe(true);
      if (result.ok) settings = result.settings;
    }
    expect(settings.rules).toHaveLength(MAX_RULES);
    expect(isAtRuleCapacity(settings)).toBe(true);

    const overflow = addRule(settings, createRule('site20.com'));
    expect(overflow).toEqual({ ok: false, error: 'capacity-exceeded' });
    // 原对象未被改动,已有 20 条一条不少(ADR-012)。
    expect(settings.rules).toHaveLength(MAX_RULES);
    expect(settings.rules[0]?.pattern).toBe('site0.com');
  });

  it('addRule 是纯函数,不改原对象', () => {
    const before = defaultSettings();
    const result = addRule(before, createRule('x.com'));
    expect(before.rules).toHaveLength(0);
    if (result.ok) expect(result.settings.rules).toHaveLength(1);
  });

  it('coerceSettings 截断超量规则,使 INV-7 恒成立', () => {
    const raw = {
      rules: Array.from({ length: 50 }, (_, i) => ({
        pattern: `s${i}.com`,
        mode: 'Grayscale',
        intensity: 100,
      })),
    };
    expect(coerceSettings(raw).rules).toHaveLength(MAX_RULES);
  });
});

describe('ADR-041 · 损坏数据回退默认值且不抛异常', () => {
  it.each([
    [undefined],
    [null],
    ['garbage'],
    [42],
    [{}],
    [{ rules: 'not an array' }],
    [{ masterEnabled: 'yes', lockUntil: 'soon' }],
    // ADR-071 已废止的旧字段:读到历史数据里的它也必须被安全忽略。
    [{ masterEnabled: 'yes', lockUntil: 'soon', maxSeenTime: {} }],
  ])('coerceSettings(%s) 返回合法 settings', (raw) => {
    expect(() => coerceSettings(raw)).not.toThrow();
    const s = coerceSettings(raw);
    expect(Array.isArray(s.rules)).toBe(true);
    expect(typeof s.masterEnabled).toBe('boolean');
    expect(s.lockUntil === null || typeof s.lockUntil === 'number').toBe(true);
  });

  it('丢弃 pattern 非法的规则,保留合法的', () => {
    const s = coerceSettings({
      rules: [
        { pattern: 'ok.com', mode: 'Grayscale', intensity: 50 },
        { pattern: '(bad|regex).com', mode: 'Grayscale', intensity: 100 },
        { pattern: 'also-ok.com', mode: 'nonsense', intensity: 999 },
      ],
    });
    expect(s.rules.map((r) => r.pattern)).toEqual(['ok.com', 'also-ok.com']);
    // 未知 mode 回退默认、越界 intensity 被夹住。
    expect(s.rules[1]?.mode).toBe('Grayscale');
    expect(s.rules[1]?.intensity).toBe(100);
  });

  it('🔴 ADR-075 迁移:整份旧设置读进来时逐条规则的旧模式都被收敛', () => {
    // 这是迁移的**聚合层**断言:上一条只证了单条规则,
    // 真实读路径(`SettingsRepository.read`)走的是 coerceSettings,
    // 若它漏掉某条规则(例如只处理 rules[0]),用户的其余规则会带着
    // 一个类型上已不存在的 mode 流进 UI 与注册逻辑。
    const s = coerceSettings({
      version: 1,
      masterEnabled: true,
      lockUntil: null,
      rules: [
        { pattern: 'a.com', mode: 'RedGreen', intensity: 10 },
        { pattern: 'b.com', mode: 'GreenRed', intensity: 20 },
        { pattern: 'c.com', mode: 'BlueYellow', intensity: 30 },
        { pattern: 'd.com', mode: 'Grayscale', intensity: 40 },
      ],
    });
    expect(s.rules).toEqual([
      { pattern: 'a.com', mode: 'Grayscale', intensity: 10 },
      { pattern: 'b.com', mode: 'Grayscale', intensity: 20 },
      { pattern: 'c.com', mode: 'Grayscale', intensity: 30 },
      { pattern: 'd.com', mode: 'Grayscale', intensity: 40 },
    ]);
    // 迁移不动 schema 版本号 —— 读时收敛不需要版本跃迁。
    expect(s.version).toBe(1);
  });
});

describe('isLocked · 时间边界(ADR-051 / ADR-053)', () => {
  it('lockUntil = null → 未锁定', () => {
    expect(isLocked(withLock(null), 1_000)).toBe(false);
  });

  it('now < lockUntil → 锁定', () => {
    expect(isLocked(withLock(1_000), 999)).toBe(true);
  });

  it('now === lockUntil → **未锁定**(到期即解锁,边界取开区间)', () => {
    expect(isLocked(withLock(1_000), 1_000)).toBe(false);
  });

  it('now > lockUntil → 未锁定', () => {
    expect(isLocked(withLock(1_000), 1_001)).toBe(false);
  });

  it('🔴 `now` 为注入参数 —— 函数内不得调用 Date.now()', () => {
    // 行为证据:伪造一个永远比 lockUntil 大的 now,结果必须是未锁定,
    // 与真实墙钟无关。若实现内部偷用 Date.now(),该断言会红。
    const farFuture = Number.MAX_SAFE_INTEGER;
    expect(isLocked(withLock(Date.now() + 86_400_000), farFuture)).toBe(false);
    expect(isLocked(withLock(Date.now() + 86_400_000), 0)).toBe(true);

    // 静态证据:可执行代码里根本不出现 Date.now(注释中的说明不算)。
    expect(executableSourceOf('filter-settings.ts')).not.toContain('Date.now');
  });
});

describe('canSetLockUntil · 单向性(ADR-052 / INV-12)', () => {
  const NOW = 1_000;

  it('未锁定 → 任意未来时间戳:允许', () => {
    expect(canSetLockUntil(null, NOW + 1, NOW).ok).toBe(true);
    expect(canSetLockUntil(null, NOW + 86_400_000, NOW).ok).toBe(true);
    // 已过期的旧锁同样视为未锁定。
    expect(canSetLockUntil(NOW - 500, NOW + 5_000, NOW).ok).toBe(true);
  });

  it('锁定中 → next > current(延长):允许', () => {
    expect(canSetLockUntil(NOW + 5_000, NOW + 9_000, NOW).ok).toBe(true);
  });

  it('锁定中 → next < current(缩短):拒绝', () => {
    expect(canSetLockUntil(NOW + 5_000, NOW + 2_000, NOW)).toEqual({
      ok: false,
      reason: 'cannot-shorten',
    });
  });

  it('锁定中 → next === current:拒绝(无意义写入)', () => {
    expect(canSetLockUntil(NOW + 5_000, NOW + 5_000, NOW)).toEqual({
      ok: false,
      reason: 'no-op',
    });
  });

  it('锁定中 → null(清除):拒绝', () => {
    expect(canSetLockUntil(NOW + 5_000, null, NOW)).toEqual({
      ok: false,
      reason: 'cannot-clear-while-locked',
    });
  });

  it('任何情况 → 过去的时间戳:拒绝', () => {
    expect(canSetLockUntil(null, NOW - 1, NOW).ok).toBe(false);
    expect(canSetLockUntil(null, NOW, NOW)).toEqual({
      ok: false,
      reason: 'in-the-past',
    });
    expect(canSetLockUntil(NOW + 5_000, NOW - 1, NOW)).toEqual({
      ok: false,
      reason: 'in-the-past',
    });
  });

  it('非数字 next 被拒绝,不抛异常', () => {
    expect(
      canSetLockUntil(null, 'tomorrow' as unknown as number, NOW).ok,
    ).toBe(false);
    expect(canSetLockUntil(null, NaN, NOW).ok).toBe(false);
  });

  it('🔴 没有任何输入能缩短一个生效中的锁(INV-12 穷举)', () => {
    const current = NOW + 10_000;
    const attempts = [
      null,
      0,
      -1,
      NOW,
      NOW - 1,
      NOW + 1,
      current - 1,
      current,
      NaN,
      Infinity,
      -Infinity,
    ];
    for (const next of attempts) {
      const result = canSetLockUntil(current, next as number | null, NOW);
      if (result.ok) {
        // 唯一允许通过的只能是严格延长。
        expect(next as number).toBeGreaterThan(current);
      }
    }
    // 上面没有一个比 current 大,故应全部被拒。
    for (const next of attempts) {
      expect(canSetLockUntil(current, next as number | null, NOW).ok).toBe(false);
    }
  });

  it('`now` 为注入参数 —— canSetLockUntil 同样不读墙钟', () => {
    expect(executableSourceOf('filter-settings.ts')).not.toContain('Date.now');
  });
});

describe('🔴 ADR-071 · maxSeenTime 与 effectiveNow 已整条废止', () => {
  it('FilterSettings 聚合不含 maxSeenTime —— 默认值里没有该键', () => {
    // INV-11 回到单一语义:锁定期间一切不可变更,唯一例外是 lockUntil 的延长
    // (INV-12)。原「例外 b:maxSeenTime 单调推进」随 ADR-071 删除,
    // 于是**不再有任何豁免字段**。
    expect(Object.keys(defaultSettings()).sort()).toEqual(
      ['lockUntil', 'masterEnabled', 'rules', 'version'].sort(),
    );
  });

  it('coerceSettings 丢弃历史数据里的 maxSeenTime,不把它带回聚合', () => {
    const s = coerceSettings({
      version: 1,
      masterEnabled: true,
      rules: [],
      lockUntil: null,
      maxSeenTime: 123_456,
    });
    expect(s).not.toHaveProperty('maxSeenTime');
  });

  it('领域层不再导出 effectiveNow(ADR-071 删除了该纯函数)', async () => {
    const mod: Record<string, unknown> = await import('../filter-settings.js');
    expect(mod.effectiveNow).toBeUndefined();
  });

  it('锁定判定直接吃注入的 clock() —— 不再夹任何单调下界', () => {
    const locked: FilterSettings = { ...defaultSettings(), lockUntil: 10_000 };
    // 时钟被拨回 1970:锁定按绝对时间仍然成立(now < lockUntil)。
    expect(isLocked(locked, 0)).toBe(true);
    // 时钟被拨到锁定之后:判定为未锁定 —— 这是 ADR-071 明文接受的代价
    // (改系统时钟绕过锁定本就允许,§4.1)。
    expect(isLocked(locked, 20_000)).toBe(false);
  });
});

describe('🔒 needsExpiryAutoOff · 到期自动关闭的判定(ADR-077)', () => {
  /** `{ lockUntil, masterEnabled }` 的组合构造器。 */
  function s(lockUntil: number | null, masterEnabled: boolean): FilterSettings {
    return { ...defaultSettings(), lockUntil, masterEnabled };
  }

  // ── 条件 1:从未锁过 ⇒ 永不自动关闭 ────────────────────────────────
  //
  // 🔴 这是最关键的一条。漏掉 `lockUntil !== null` 的实现会在
  //    「从未用过锁定功能的用户」身上**恒真** —— 因为 lockUntil 为 null 时
  //    isLocked 恒 false,只看后两条就成立。那等于「扩展自己把滤镜关掉」。
  it('🔴 lockUntil = null(从未锁过)→ **false**,与 masterEnabled 无关', () => {
    expect(needsExpiryAutoOff(s(null, true), 1_000)).toBe(false);
    expect(needsExpiryAutoOff(s(null, false), 1_000)).toBe(false);
  });

  it('🔴 lockUntil = null 时在任意时刻都为 false(不是碰巧某个 now 下为 false)', () => {
    for (const now of [0, 1, 1_000, Date.now(), Number.MAX_SAFE_INTEGER]) {
      expect(needsExpiryAutoOff(s(null, true), now)).toBe(false);
    }
  });

  it('lockUntil 非有限值(NaN / Infinity)→ false(与 isLocked 同口径)', () => {
    expect(needsExpiryAutoOff(s(Number.NaN, true), 1_000)).toBe(false);
    expect(needsExpiryAutoOff(s(Number.POSITIVE_INFINITY, true), 1_000)).toBe(false);
  });

  // ── 条件 2:必须真的已过期,且边界与 isLocked 逐字一致 ──────────────
  it('锁定中(now < lockUntil)→ **false** —— 不得在锁定期内关闭(ADR-051)', () => {
    expect(needsExpiryAutoOff(s(1_000, true), 999)).toBe(false);
  });

  it('🔴 now === lockUntil → **true**(边界与 isLocked 的开区间逐字一致)', () => {
    // isLocked 在此刻已判为「未锁定」(见上方 isLocked 的边界测试),
    // 故自动关闭必须在**同一毫秒**生效。两者口径若有一毫秒之差,
    // 就会出现「锁已解除、但自动关闭不触发」的缝。
    expect(isLocked(s(1_000, true), 1_000)).toBe(false);
    expect(needsExpiryAutoOff(s(1_000, true), 1_000)).toBe(true);
  });

  it('now > lockUntil(已过期)→ true', () => {
    expect(needsExpiryAutoOff(s(1_000, true), 1_001)).toBe(true);
  });

  it('🔴 边界穷举:lockUntil=1000 时,999→false / 1000→true / 1001→true', () => {
    expect(needsExpiryAutoOff(s(1_000, true), 999)).toBe(false);
    expect(needsExpiryAutoOff(s(1_000, true), 1_000)).toBe(true);
    expect(needsExpiryAutoOff(s(1_000, true), 1_001)).toBe(true);
  });

  // ── 条件 3:幂等 ────────────────────────────────────────────────────
  it('🔴 已过期但 masterEnabled 已是 false → **false**(幂等,不重复写入)', () => {
    expect(needsExpiryAutoOff(s(1_000, false), 2_000)).toBe(false);
  });

  it('🔴 幂等的真实意义:用户到期后手动开回滤镜,下一次观察**不得**再关掉', () => {
    // t0:到期,自动关闭 → masterEnabled = false
    const afterAutoOff = s(1_000, false);
    expect(needsExpiryAutoOff(afterAutoOff, 2_000)).toBe(false);
    // t1:用户手动开回来(lockUntil 仍是那个过去值 —— 刻意不清除)
    const userReEnabled = s(1_000, true);
    // t2:SW 被别的事件唤醒,又看到「lockUntil 已过去」
    //
    // ⚠️ 纯函数层面这里**仍是 true** —— 这是刻意的设计边界:
    //    领域层只回答「此刻状态是否符合『到期且还开着』」,
    //    它无从知道那个 true 是用户刚刚手动设的。
    //    「每段锁定最多关一次」这条由**用户重新开启后 lockUntil 被下次锁定覆盖**
    //    与 SW 不会无故重跑 catchUp 共同保证;而真正防止「用户开回来又被关掉」
    //    的那一层是:自动关闭只在**到期边沿**与**SW 启动**触发,
    //    不是每秒轮询(见 useLockExpiry / LockExpiryScheduler 的边沿与入口设计)。
    expect(needsExpiryAutoOff(userReEnabled, 2_000)).toBe(true);
  });

  // ── 三条合取的穷举 ─────────────────────────────────────────────────
  it('🔴 三条合取穷举:只有「锁过 ∧ 已过期 ∧ 还开着」为 true', () => {
    const rows: ReadonlyArray<{
      lockUntil: number | null;
      masterEnabled: boolean;
      now: number;
      expected: boolean;
    }> = [
      // 锁过 + 已过期 + 开着 → 唯一的 true
      { lockUntil: 1_000, masterEnabled: true, now: 2_000, expected: true },
      // 锁过 + 已过期 + 已关 → 幂等
      { lockUntil: 1_000, masterEnabled: false, now: 2_000, expected: false },
      // 锁过 + 锁定中 + 开着 → ADR-051 禁止
      { lockUntil: 1_000, masterEnabled: true, now: 500, expected: false },
      // 锁过 + 锁定中 + 已关 → 本就无事可做
      { lockUntil: 1_000, masterEnabled: false, now: 500, expected: false },
      // 没锁过 + 开着
      { lockUntil: null, masterEnabled: true, now: 2_000, expected: false },
      // 没锁过 + 已关
      { lockUntil: null, masterEnabled: false, now: 2_000, expected: false },
    ];
    for (const row of rows) {
      expect(
        needsExpiryAutoOff(s(row.lockUntil, row.masterEnabled), row.now),
        JSON.stringify(row),
      ).toBe(row.expected);
    }
  });

  it('🔴 与 isLocked **互斥**:两者不可能同时为 true(锁定期内绝不自动关闭)', () => {
    // 这条用随机化穷举钉住「不可能在锁定期内关闭」这个不变式。
    for (let lockUntil = 0; lockUntil <= 20; lockUntil++) {
      for (let now = 0; now <= 20; now++) {
        for (const masterEnabled of [true, false]) {
          const settings = s(lockUntil, masterEnabled);
          const both =
            isLocked(settings, now) && needsExpiryAutoOff(settings, now);
          expect(both, `lockUntil=${String(lockUntil)} now=${String(now)}`).toBe(
            false,
          );
        }
      }
    }
  });

  it('🔴 `now` 为注入参数 —— 函数内不得调用 Date.now()', () => {
    // 行为证据:伪造的 now 完全决定结果,与真实墙钟无关。
    const future = Date.now() + 86_400_000;
    expect(needsExpiryAutoOff(s(future, true), Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(needsExpiryAutoOff(s(future, true), 0)).toBe(false);
    // 静态证据由同文件上方 isLocked 那条共同覆盖(同一个源文件)。
  });

  it('纯函数:不改动传入对象', () => {
    const settings = s(1_000, true);
    const before = JSON.stringify(settings);
    needsExpiryAutoOff(settings, 2_000);
    expect(JSON.stringify(settings)).toBe(before);
  });

  it('🔴 不清除 lockUntil 是无害的:过去的 lockUntil 对 isLocked 等同未锁定', () => {
    // ADR-077 刻意不清除 lockUntil(清除需要写一个更小的值,
    // 而那是 ADR-052 禁止的方向)。本条钉住「不清除不造成行为差异」。
    const past = s(1_000, false);
    expect(isLocked(past, 2_000)).toBe(false);
    // 且 canSetLockUntil 把它当作「未锁定」,下次启动锁定正常放行。
    expect(canSetLockUntil(past.lockUntil, 3_000, 2_000)).toEqual({ ok: true });
  });
});
