// @vitest-environment jsdom
/**
 * 🔒🔴 **ADR-077 · 到期自动关闭主开关 —— popup 侧的行为。**
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 本文件要钉住的那句硬要求
 *
 * > The UI must stay correct across the transition: when the lock expires with
 * > the popup open, the countdown banner disappears, the master switch reads
 * > OFF, and controls become editable — **with no stale intermediate state**.
 *
 * 「no stale intermediate state」是本文件的核心:它不满足于「最终一致」,
 * 要求的是**不存在一个用户可观察到的、三者不自洽的中间帧**。
 * 故下面有一组测试在到期那一拍**逐帧**检查 DOM,而不是只看终态。
 *
 * ## 为什么 SW 的闹钟不能承担这件事
 *
 * 平台文档:闹钟「may delay them an arbitrary amount more」—— 迟到量无上界。
 * 只靠闹钟,popup 开着时会出现「倒计时归零、横幅消失、但主开关还读 ON、
 * 页面还是灰的」这段 stale,长度不可控。
 * 故 popup 侧有一条**独立**的到期触发(`useLockExpiry`),本文件测它。
 *
 * ⚠️ 本文件**不冒充 REAL_STACK_GATE**(§8 第 8 条):
 * 真实 Chrome 上「等真实挂钟到期 → 磁盘上 masterEnabled 为 false →
 * 页面像素恢复彩色」在 `docs/T7-gate/lock-expiry-autooff.cjs` 里跑。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { type FilterSettings, defaultSettings } from '../../domain/index.js';
import { MemoryStorageArea } from '../../storage/memory-storage-area.js';
import {
  SETTINGS_KEY,
  SettingsRepository,
} from '../../storage/settings-repository.js';
import { useLockExpiry } from '../useLockExpiry.js';

afterEach(cleanup);

const T0 = 1_700_000_000_000;
const SEC = 1000;

function seeded(lockUntil: number | null, masterEnabled = true) {
  return {
    [SETTINGS_KEY]: {
      version: 1,
      masterEnabled,
      rules: [{ pattern: '*.weibo.*', mode: 'Grayscale', intensity: 100 }],
      lockUntil,
    },
  };
}

function makeClock(start = T0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

// ════════════════════════════════════════════════════════════════════════
describe('🔴 useLockExpiry · 只在「锁定 → 未锁定」的边沿上动手', () => {
  /** 记录每次调用的小夹具。 */
  function tracker(result?: {
    ok: true;
    value: { settings: FilterSettings; applied: boolean };
  }) {
    const calls: number[] = [];
    return {
      calls,
      applyAutoOff: () => {
        calls.push(1);
        return Promise.resolve(
          result ?? {
            ok: true as const,
            value: { settings: defaultSettings(), applied: false },
          },
        );
      },
    };
  }

  it('locked 从 true 翻到 false → 调一次仓储层', async () => {
    const t = tracker();
    const { rerender } = renderHook(
      ({ locked }: { locked: boolean }) =>
        useLockExpiry({ locked, applyAutoOff: t.applyAutoOff }),
      { initialProps: { locked: true } },
    );
    expect(t.calls.length).toBe(0); // 首帧不构成边沿

    await act(async () => {
      rerender({ locked: false });
      await Promise.resolve();
    });

    expect(t.calls.length).toBe(1);
  });

  it('🔴 首帧 locked=false(popup 在到期后才打开)→ **不**调用(交给 SW 的 catchUp)', async () => {
    const t = tracker();
    renderHook(() => useLockExpiry({ locked: false, applyAutoOff: t.applyAutoOff }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(t.calls.length).toBe(0);
  });

  it('🔴 首帧 locked=true(popup 在锁定中打开)→ 不调用', async () => {
    const t = tracker();
    renderHook(() => useLockExpiry({ locked: true, applyAutoOff: t.applyAutoOff }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(t.calls.length).toBe(0);
  });

  it('🔴 locked 一直为 false(未锁定的 popup 开着)→ 重渲染多次也**一次都不调**', async () => {
    // 这条守的是「别在读路径上每秒空转」(ADR-071 刚拔掉一条读路径写盘的竞态)。
    const t = tracker();
    const { rerender } = renderHook(
      ({ locked }: { locked: boolean }) =>
        useLockExpiry({ locked, applyAutoOff: t.applyAutoOff }),
      { initialProps: { locked: false } },
    );
    for (let i = 0; i < 30; i++) {
      await act(async () => {
        rerender({ locked: false });
        await Promise.resolve();
      });
    }
    expect(t.calls.length).toBe(0);
  });

  it('🔴 locked 一直为 true(锁定中的 popup 开着)→ 每秒重渲染也**一次都不调**', async () => {
    const t = tracker();
    const { rerender } = renderHook(
      ({ locked }: { locked: boolean }) =>
        useLockExpiry({ locked, applyAutoOff: t.applyAutoOff }),
      { initialProps: { locked: true } },
    );
    for (let i = 0; i < 30; i++) {
      await act(async () => {
        rerender({ locked: true });
        await Promise.resolve();
      });
    }
    expect(t.calls.length).toBe(0);
  });

  it('边沿只触发一次 —— 翻转后持续重渲染不再调用', async () => {
    const t = tracker();
    const { rerender } = renderHook(
      ({ locked }: { locked: boolean }) =>
        useLockExpiry({ locked, applyAutoOff: t.applyAutoOff }),
      { initialProps: { locked: true } },
    );
    await act(async () => {
      rerender({ locked: false });
      await Promise.resolve();
    });
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        rerender({ locked: false });
        await Promise.resolve();
      });
    }
    expect(t.calls.length).toBe(1);
  });

  it('false → true → false(到期后又锁一次再到期)→ 调两次', async () => {
    const t = tracker();
    const { rerender } = renderHook(
      ({ locked }: { locked: boolean }) =>
        useLockExpiry({ locked, applyAutoOff: t.applyAutoOff }),
      { initialProps: { locked: false } },
    );
    for (const locked of [true, false, true, false]) {
      await act(async () => {
        rerender({ locked });
        await Promise.resolve();
      });
    }
    expect(t.calls.length).toBe(2);
  });

  it('🔴 内联传入的 applyAutoOff(每帧新引用)不会让 effect 每帧重跑', async () => {
    // 这条守的是 ref 的用法:若 applyAutoOff 进了依赖数组,
    // 每帧都会重跑一次带写入副作用的 effect。
    let calls = 0;
    const { rerender } = renderHook(
      ({ locked }: { locked: boolean }) =>
        useLockExpiry({
          locked,
          // 每次 render 都是**新的函数引用**(调用方最自然的写法)。
          applyAutoOff: () => {
            calls += 1;
            return Promise.resolve({
              ok: true as const,
              value: { settings: defaultSettings(), applied: false },
            });
          },
        }),
      { initialProps: { locked: true } },
    );
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        rerender({ locked: true });
        await Promise.resolve();
      });
    }
    expect(calls).toBe(0);
  });

  it('applied 为 true → 回灌新设置;applied 为 false → 不回灌', async () => {
    const off: FilterSettings = { ...defaultSettings(), masterEnabled: false };
    const synced: FilterSettings[] = [];

    const { rerender } = renderHook(
      ({ locked, applied }: { locked: boolean; applied: boolean }) =>
        useLockExpiry({
          locked,
          applyAutoOff: () =>
            Promise.resolve({ ok: true as const, value: { settings: off, applied } }),
          onSettings: (s) => synced.push(s),
        }),
      { initialProps: { locked: true, applied: true } },
    );

    await act(async () => {
      rerender({ locked: false, applied: true });
      await Promise.resolve();
    });
    expect(synced.length).toBe(1);
    expect(synced[0]?.masterEnabled).toBe(false);

    // 再来一轮,这次 applied 为 false。
    await act(async () => {
      rerender({ locked: true, applied: false });
      await Promise.resolve();
    });
    await act(async () => {
      rerender({ locked: false, applied: false });
      await Promise.resolve();
    });
    expect(synced.length).toBe(1); // 没有新增
  });

  it('仓储层返回失败 → 不回灌、不抛(到期是系统收尾,不向用户报错)', async () => {
    const synced: FilterSettings[] = [];
    const { rerender } = renderHook(
      ({ locked }: { locked: boolean }) =>
        useLockExpiry({
          locked,
          applyAutoOff: () =>
            Promise.resolve({
              ok: false as const,
              error: { kind: 'locked', reason: 'locked-master-enabled' },
            }),
          onSettings: (s) => synced.push(s),
        }),
      { initialProps: { locked: true } },
    );

    await act(async () => {
      rerender({ locked: false });
      await Promise.resolve();
    });
    expect(synced).toEqual([]);
  });

  it('仓储层 reject → 不抛到渲染层(hook 自己兜住)', async () => {
    const { rerender } = renderHook(
      ({ locked }: { locked: boolean }) =>
        useLockExpiry({
          locked,
          applyAutoOff: () => Promise.reject(new Error('boom')),
        }),
      { initialProps: { locked: true } },
    );

    await expect(
      act(async () => {
        rerender({ locked: false });
        await Promise.resolve();
      }),
    ).resolves.toBeUndefined();
  });

  it('组件在写入飞行途中卸载 → 不回灌(不碰已卸载组件的 state)', async () => {
    const synced: FilterSettings[] = [];
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const { rerender, unmount } = renderHook(
      ({ locked }: { locked: boolean }) =>
        useLockExpiry({
          locked,
          applyAutoOff: async () => {
            await gate;
            return {
              ok: true as const,
              value: {
                settings: { ...defaultSettings(), masterEnabled: false },
                applied: true,
              },
            };
          },
          onSettings: (s) => synced.push(s),
        }),
      { initialProps: { locked: true } },
    );

    await act(async () => {
      rerender({ locked: false });
      await Promise.resolve();
    });
    unmount();
    await act(async () => {
      release?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(synced).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('🔴🔴 ADR-077 · 到期那一刻的 UI 自洽(no stale intermediate state)', () => {
  /**
   * 一个最小但**真实接线**的部件:真仓储层 + 真 `applyExpiryAutoOff`。
   *
   * 🔴 这里刻意**不**用替身的 applyAutoOff —— 本组测的正是
   * 「UI 与仓储层串起来之后到期那一帧是否自洽」,
   * 换成替身就把被测对象里最容易错的那一环(真实的异步写入)摘掉了。
   */
  function Subject({
    repository,
    clock,
  }: {
    repository: SettingsRepository;
    clock: () => number;
  }) {
    const [settings, setSettings] = useState<FilterSettings>(defaultSettings);
    const [tick, setTick] = useState(() => clock());

    // 读一次初始设置。
    const [loaded, setLoaded] = useState(false);
    if (!loaded) {
      void repository.read().then((s) => {
        setSettings(s);
        setLoaded(true);
      });
    }

    const lockUntil = settings.lockUntil;
    const locked =
      lockUntil !== null && Number.isFinite(lockUntil) && tick < lockUntil;

    useLockExpiry({
      locked,
      applyAutoOff: () => repository.applyExpiryAutoOff(),
      onSettings: setSettings,
    });

    return (
      <div
        data-testid="subject"
        data-locked={locked ? 'true' : 'false'}
        data-master={settings.masterEnabled ? 'on' : 'off'}
      >
        {locked ? <span data-testid="banner">倒计时</span> : null}
        <button
          data-testid="advance"
          onClick={() => {
            setTick(clock());
          }}
        >
          tick
        </button>
      </div>
    );
  }

  it('🔴🔴 到期后终态自洽:横幅消失 ∧ 主开关读 OFF ∧ 未锁定', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded(T0 + 3 * SEC));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<Subject repository={repo} clock={clock.now} />);
    await waitFor(() => {
      expect(screen.getByTestId('subject').dataset.locked).toBe('true');
    });
    expect(screen.getByTestId('subject').dataset.master).toBe('on');

    // 时间走过到期点。
    clock.advance(3 * SEC);
    await act(async () => {
      screen.getByTestId('advance').click();
      await Promise.resolve();
    });

    await waitFor(() => {
      const el = screen.getByTestId('subject');
      expect(el.dataset.locked).toBe('false');
      expect(el.dataset.master).toBe('off');
    });
    expect(screen.queryByTestId('banner')).toBeNull();
    // 磁盘上也真的关了(不只是 React 状态)。
    expect(
      (area.snapshot()[SETTINGS_KEY] as { masterEnabled: boolean }).masterEnabled,
    ).toBe(false);
  });

  it('🔴🔴 **逐帧**检查:不存在「未锁定 ∧ 主开关仍 ON ∧ 磁盘已关」的 stale 帧', async () => {
    /*
      这是本文件最重要的一条。它不看终态,而是在每一次 DOM 变化时取一帧快照,
      然后断言**没有任何一帧**出现「React 说主开关还 ON,而磁盘上已经是 OFF」
      —— 那正是「回灌漏了」会产生的 stale(用户看到开关还开着,
      而滤镜其实已经停了)。
    */
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded(T0 + 3 * SEC));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<Subject repository={repo} clock={clock.now} />);
    await waitFor(() => {
      expect(screen.getByTestId('subject').dataset.locked).toBe('true');
    });

    const frames: { locked: string; master: string; disk: boolean }[] = [];
    const observer = new MutationObserver(() => {
      const el = screen.getByTestId('subject');
      frames.push({
        locked: el.dataset.locked ?? '',
        master: el.dataset.master ?? '',
        disk: (area.snapshot()[SETTINGS_KEY] as { masterEnabled: boolean })
          .masterEnabled,
      });
    });
    observer.observe(screen.getByTestId('subject'), {
      attributes: true,
      childList: true,
      subtree: true,
    });

    clock.advance(3 * SEC);
    await act(async () => {
      screen.getByTestId('advance').click();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('subject').dataset.master).toBe('off');
    });
    observer.disconnect();

    // 🔴 没有任何一帧是「磁盘已关、而 UI 还说开着」。
    const stale = frames.filter((f) => f.disk === false && f.master === 'on');
    expect(stale, `stale 帧:${JSON.stringify(frames)}`).toEqual([]);

    // 探针有效性:确实采到了帧(否则上面那条是空集恒真)。
    expect(frames.length).toBeGreaterThan(0);
  });

  it('🔴 负向对照:**不挂** useLockExpiry 时 stale 确实会出现(证明上条有判别力)', async () => {
    /*
      没有这条,「没有 stale 帧」可能只是因为本测试根本抓不到 stale。
      这里把 useLockExpiry 摘掉,其余完全相同 ——
      于是到期后 `locked` 翻 false 而 `masterEnabled` 永远停在 ON,
      那正是 ADR-077 之前的行为,也正是任务书说的「滤镜继续开着」。
    */
    function WithoutHook({
      repository,
      clock,
    }: {
      repository: SettingsRepository;
      clock: () => number;
    }) {
      const [settings, setSettings] = useState<FilterSettings>(defaultSettings);
      const [tick, setTick] = useState(() => clock());
      const [loaded, setLoaded] = useState(false);
      if (!loaded) {
        void repository.read().then((s) => {
          setSettings(s);
          setLoaded(true);
        });
      }
      const lockUntil = settings.lockUntil;
      const locked =
        lockUntil !== null && Number.isFinite(lockUntil) && tick < lockUntil;
      // 🔴 刻意不挂 useLockExpiry。
      return (
        <div
          data-testid="subject"
          data-locked={locked ? 'true' : 'false'}
          data-master={settings.masterEnabled ? 'on' : 'off'}
        >
          <button
            data-testid="advance"
            onClick={() => {
              setTick(clock());
            }}
          >
            tick
          </button>
        </div>
      );
    }

    const clock = makeClock();
    const area = new MemoryStorageArea(seeded(T0 + 3 * SEC));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<WithoutHook repository={repo} clock={clock.now} />);
    await waitFor(() => {
      expect(screen.getByTestId('subject').dataset.locked).toBe('true');
    });

    clock.advance(3 * SEC);
    await act(async () => {
      screen.getByTestId('advance').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 🔴 已解锁,但主开关仍是 ON、磁盘也仍是 true —— 滤镜还开着。
    expect(screen.getByTestId('subject').dataset.locked).toBe('false');
    expect(screen.getByTestId('subject').dataset.master).toBe('on');
    expect(
      (area.snapshot()[SETTINGS_KEY] as { masterEnabled: boolean }).masterEnabled,
    ).toBe(true);
  });

  it('🔴 锁定仍有效时的重渲染不会误关(hook 不含第二套锁定判定)', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded(T0 + 60 * SEC));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<Subject repository={repo} clock={clock.now} />);
    await waitFor(() => {
      expect(screen.getByTestId('subject').dataset.locked).toBe('true');
    });

    // 推进但**不到期**,反复 tick。
    for (let i = 0; i < 10; i++) {
      clock.advance(1 * SEC);
      await act(async () => {
        screen.getByTestId('advance').click();
        await Promise.resolve();
      });
    }

    expect(screen.getByTestId('subject').dataset.locked).toBe('true');
    expect(screen.getByTestId('subject').dataset.master).toBe('on');
    expect(
      (area.snapshot()[SETTINGS_KEY] as { masterEnabled: boolean }).masterEnabled,
    ).toBe(true);
  });

  it('🔴 从未锁过的 popup 开着 → 主开关永不被自动关掉', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded(null));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<Subject repository={repo} clock={clock.now} />);
    await waitFor(() => {
      expect(screen.getByTestId('subject').dataset.master).toBe('on');
    });

    for (let i = 0; i < 10; i++) {
      clock.advance(10 * SEC);
      await act(async () => {
        screen.getByTestId('advance').click();
        await Promise.resolve();
      });
    }

    expect(screen.getByTestId('subject').dataset.master).toBe('on');
    expect(
      (area.snapshot()[SETTINGS_KEY] as { masterEnabled: boolean }).masterEnabled,
    ).toBe(true);
    expect(area.setCallCount).toBe(0); // 一次写入都没有
  });

  it('到期时主开关已是 OFF(用户锁定前就关着?不可达,但幂等仍成立)→ 不重复写', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded(T0 + 3 * SEC, false));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<Subject repository={repo} clock={clock.now} />);
    await waitFor(() => {
      expect(screen.getByTestId('subject').dataset.locked).toBe('true');
    });

    clock.advance(3 * SEC);
    await act(async () => {
      screen.getByTestId('advance').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(area.setCallCount).toBe(0);
  });
});
