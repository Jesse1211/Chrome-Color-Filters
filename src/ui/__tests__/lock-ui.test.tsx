// @vitest-environment jsdom
/**
 * 锁定 UI(T6c)× 真实仓储层(T3)的门禁测试。
 *
 * 这里的「真实」指 `SettingsRepository` 本体 —— 只有 `chrome.storage.local`
 * 换成了 `MemoryStorageArea`。逐条覆盖 §6 T6c 的 gate:
 *
 * - 未锁定时的计时器入口(ADR-058):预设 + 数字 + 单位下拉,**不接受裸时间戳**
 * - 二次确认(ADR-056):出现时机、三条后果文案、取消不写入
 * - 🔴 启动时**原子**开启主开关(ADR-057):一次写入,无中间态
 * - 倒计时(ADR-051):`HH:MM:SS`、每秒刷新、按差值算、卸载清 interval
 * - 锁定态控件禁用(ADR-051),点击不产生写入
 * - 🔴 锁定优先于 ADR-050:不可注入页 + 锁定中 → 主开关**仍然禁用**
 * - 🔴 负向断言:锁定中 DOM 无任何解除/取消/结束/缩短入口(ADR-052/INV-12)
 * - 延长可用且倒计时变长;锁定拒绝不弹红色报错条(I1)
 * - 到期自动恢复可编辑
 *
 * ⚠️ §8 第 8 条:jsdom 下的绿灯**不构成** REAL_STACK_GATE 的通过。
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryStorageArea } from '../../storage/memory-storage-area.js';
import {
  SETTINGS_KEY,
  SettingsRepository,
} from '../../storage/settings-repository.js';
import { LockCountdownBanner } from '../LockCountdownBanner.js';
import { LockTimerEntry } from '../LockTimerEntry.js';
import { RuleListView } from '../RuleListView.js';
import {
  LOCK_CONSEQUENCE_NO_DISABLE,
  LOCK_CONSEQUENCE_NO_EARLY_END,
  LOCK_CONSEQUENCE_NO_SETTINGS,
} from '../lock-strings.js';
import { stubTabStatePort } from '../tab-state.js';
import { useLockState } from '../useLockState.js';
import { usePopupSettings } from '../usePopupSettings.js';
import { installPopupStyles } from './css-harness.js';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

/** 固定的「现在」—— 所有时间断言都相对它,不依赖真实挂钟。 */
const T0 = 1_700_000_000_000;

/** 可手动推进的时钟。 */
function makeClock(start = T0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/**
 * 手动驱动的 interval 替身。
 *
 * 用它而不是真实 `setInterval`:倒计时每秒一拍,靠真实挂钟等待会让
 * 每个断言都付出 1 秒以上,且在 CI 上天然不稳。
 * 这里仍然断言「注册的间隔确实是 1000ms」—— 即 §5.4 的「每秒刷新」
 * 没有被替身掩盖掉,只是由测试决定什么时候走那一拍。
 */
function manualInterval() {
  const callbacks: (() => void)[] = [];
  const installed: unknown[] = [];
  const cleared: unknown[] = [];

  return {
    installed,
    cleared,
    props: {
      setIntervalFn: (fn: () => void, ms: number) => {
        // §5.4 / §6 T6c gate:每秒刷新。
        expect(ms, '倒计时必须每秒刷新').toBe(1000);
        callbacks.push(fn);
        const handle = { index: callbacks.length - 1 };
        installed.push(handle);
        return handle;
      },
      clearIntervalFn: (handle: unknown) => {
        cleared.push(handle);
      },
    },
    /** 走一拍。 */
    tick: () => {
      for (const fn of callbacks) fn();
    },
  };
}

const seeded = (over: {
  masterEnabled?: boolean;
  lockUntil?: number | null;
  rules?: { pattern: string }[];
  maxSeenTime?: number;
}) => ({
  [SETTINGS_KEY]: {
    version: 1,
    masterEnabled: over.masterEnabled ?? true,
    rules: (over.rules ?? [{ pattern: '*.weibo.*' }]).map((r) => ({
      pattern: r.pattern,
      mode: 'Grayscale',
      intensity: 100,
    })),
    lockUntil: over.lockUntil ?? null,
    maxSeenTime: over.maxSeenTime ?? 0,
  },
});

/**
 * 把 popup 的完整接线跑起来 —— 与 `entrypoints/popup/App.tsx` 同构。
 *
 * 时钟与定时器注入,以便在测试里精确推进时间并断言 interval 的拆装。
 */
function PopupUnderTest({
  repository,
  clock,
  injectable = true,
  setIntervalFn,
  clearIntervalFn,
}: {
  repository: SettingsRepository;
  clock: () => number;
  injectable?: boolean;
  setIntervalFn?: (fn: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
}) {
  const {
    settings,
    tabState,
    loaded,
    toggleMaster,
    deleteRule,
    reorderRules,
    syncSettings,
  } = usePopupSettings({
    repository,
    tabStatePort: stubTabStatePort({
      tabId: 1,
      injectable,
      host: injectable ? 'news.weibo.com' : null,
    }),
  });

  const { locked, now, lockUntil, startLock, extendLock } = useLockState({
    repository,
    settings,
    clock,
    setIntervalFn,
    clearIntervalFn,
    onSettings: syncSettings,
  });

  return (
    <RuleListView
      settings={settings}
      tabState={loaded ? tabState : null}
      onToggleMaster={toggleMaster}
      onDeleteRule={deleteRule}
      onReorderRules={reorderRules}
      onAddRule={() => undefined}
      onOpenRule={() => undefined}
      locked={locked}
      lockBanner={
        locked && lockUntil !== null ? (
          <LockCountdownBanner lockUntil={lockUntil} now={now} onExtend={extendLock} />
        ) : undefined
      }
      lockEntry={
        !locked ? (
          <LockTimerEntry
            masterEnabled={settings.masterEnabled}
            onStartLock={startLock}
            disabled={!loaded}
          />
        ) : undefined
      }
    />
  );
}

/** 等到骨架态结束(设置与 TabState 都已到位)。 */
async function settled() {
  await waitFor(() => {
    expect(screen.getByTestId('popup').dataset.skeleton).toBe('false');
  });
}

beforeEach(() => {
  installPopupStyles();
});

afterEach(() => {
  cleanup();
  document.head.innerHTML = '';
  vi.restoreAllMocks();
});

// ═══════════════════════ 1. 计时器入口(ADR-058) ═══════════════════════

describe('🔴 未锁定时的计时器入口(ADR-058)', () => {
  it('预设时长按钮 + 自定义输入(数字 + 单位下拉:分/时/天)俱在', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({}));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();

    // 预设按钮(ADR-058:「预设按钮」)。
    expect(screen.getByTestId('lock-start-preset-30-minute')).toBeTruthy();
    expect(screen.getByTestId('lock-start-preset-1-hour')).toBeTruthy();
    expect(screen.getByTestId('lock-start-preset-1-day')).toBeTruthy();

    // 自定义输入:数字 + 单位下拉。
    const amount = screen.getByTestId('lock-start-amount') as HTMLInputElement;
    const unit = screen.getByTestId('lock-start-unit') as HTMLSelectElement;
    expect(amount.type).toBe('number');
    expect([...unit.options].map((o) => o.value)).toEqual([
      'minute',
      'hour',
      'day',
    ]);
    expect([...unit.options].map((o) => o.textContent)).toEqual([
      '分钟',
      '小时',
      '天',
    ]);
  });

  it('🔴 断言界面不接受裸时间戳 —— 没有任何可输入时间戳的控件', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({}));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();

    const entry = screen.getByTestId('lock-entry');

    // 入口区里**只有一个**数字输入,且它必定配着一个单位下拉。
    const numberInputs = entry.querySelectorAll('input[type="number"]');
    expect(numberInputs.length).toBe(1);
    expect(entry.querySelectorAll('select').length).toBe(1);

    // 没有 datetime / date / time 类输入,也没有任何自由文本框
    // ——「直接填一个时间戳」在界面上不存在。
    for (const t of ['datetime-local', 'date', 'time', 'text']) {
      expect(
        entry.querySelectorAll(`input[type="${t}"]`).length,
        `出现了 input[type=${t}]`,
      ).toBe(0);
    }

    // 唯一的数字输入带 min=1 —— 它表达的是「几个单位」,不是 epoch 毫秒。
    expect((numberInputs[0] as HTMLInputElement).min).toBe('1');
  });

  it('时长非法(0)时启动按钮禁用并提示,不静默拒绝', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({}));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();

    fireEvent.change(screen.getByTestId('lock-start-amount'), {
      target: { value: '0' },
    });

    expect((screen.getByTestId('lock-start') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('lock-invalid-duration')).toBeTruthy();
  });
});

// ═══════════════════════ 2. 二次确认(ADR-056) ═══════════════════════

describe('🔴 二次确认(ADR-056)', () => {
  it('确认框在点启动后出现,**未确认前不写入任何数据**(spy)', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({}));
    const setSpy = vi.spyOn(area, 'set');
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();

    // 基线:读路径可能回写 maxSeenTime(ADR-059),故记下当前调用数再比对。
    const before = setSpy.mock.calls.length;

    // 点「启动锁定」之前没有确认框。
    expect(screen.queryByTestId('lock-confirm')).toBeNull();

    fireEvent.click(screen.getByTestId('lock-start'));

    // 确认框出现了……
    expect(screen.getByTestId('lock-confirm')).toBeTruthy();
    // ……但**一个字节都没写**。
    expect(setSpy.mock.calls.length).toBe(before);

    const persisted = (await area.get(SETTINGS_KEY))[SETTINGS_KEY] as {
      lockUntil: number | null;
    };
    expect(persisted.lockUntil).toBeNull();
  });

  it('🔴 文案逐条含三条后果(ADR-056)', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({}));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    fireEvent.click(screen.getByTestId('lock-start'));

    const dialog = screen.getByTestId('lock-confirm');
    const text = dialog.textContent ?? '';

    // 逐条断言 —— ADR-056 明文要求「明确列出三条后果」。
    expect(text, '缺「无法修改任何设置」').toContain(LOCK_CONSEQUENCE_NO_SETTINGS);
    expect(text, '缺「无法关闭滤镜」').toContain(LOCK_CONSEQUENCE_NO_DISABLE);
    expect(text, '缺「无法提前结束(只能延长)」').toContain(
      LOCK_CONSEQUENCE_NO_EARLY_END,
    );

    // 三条逐字就是 §6 T6c gate 列出的那三句。
    expect(LOCK_CONSEQUENCE_NO_SETTINGS).toBe('无法修改任何设置');
    expect(LOCK_CONSEQUENCE_NO_DISABLE).toBe('无法关闭滤镜');
    expect(LOCK_CONSEQUENCE_NO_EARLY_END).toBe('无法提前结束(只能延长)');

    // 三条各自是独立的列表项,不是糊在一句话里。
    const items = within(screen.getByTestId('lock-consequences')).getAllByRole(
      'listitem',
    );
    expect(items.length).toBe(3);
  });

  it('🔴「取消」关闭确认框且**不产生任何写入**(spy)', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({}));
    const setSpy = vi.spyOn(area, 'set');
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();

    fireEvent.click(screen.getByTestId('lock-start'));
    const before = setSpy.mock.calls.length;

    fireEvent.click(screen.getByTestId('lock-confirm-cancel'));

    // 框关了。
    await waitFor(() => {
      expect(screen.queryByTestId('lock-confirm')).toBeNull();
    });
    // 没有任何写入。
    expect(setSpy.mock.calls.length).toBe(before);

    const persisted = (await area.get(SETTINGS_KEY))[SETTINGS_KEY] as {
      lockUntil: number | null;
    };
    expect(persisted.lockUntil).toBeNull();
    // 仍然是可编辑的未锁定态。
    expect(screen.getByTestId('popup').dataset.locked).toBe('false');
  });
});

// ═══════════════════════ 3. ADR-057 原子开启主开关 ═══════════════════════

describe('🔴 启动时原子开启主开关(ADR-057)', () => {
  it('masterEnabled=false 时启动锁定 → **一次写入**同时设 masterEnabled=true 与 lockUntil', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ masterEnabled: false }));
    const setSpy = vi.spyOn(area, 'set');
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();

    // 前置:主开关确实是关的。
    expect(
      screen.getByTestId('master-switch').getAttribute('aria-checked'),
    ).toBe('false');

    fireEvent.click(screen.getByTestId('lock-start'));

    // ADR-057 的告知必须在**不可逆操作之前**出现。
    expect(screen.getByTestId('lock-will-enable-master')).toBeTruthy();

    const before = setSpy.mock.calls.length;
    fireEvent.click(screen.getByTestId('lock-confirm-ok'));

    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.locked).toBe('true');
    });

    // 🔴 **一次写入** —— 不是「先开主开关、再写 lockUntil」两次。
    const writes = setSpy.mock.calls.slice(before);
    expect(writes.length, `发生了 ${String(writes.length)} 次写入,ADR-057 要求恰好 1 次`).toBe(1);

    // 🔴 那一次写入里两个字段**同时**到位 —— 无中间态。
    const payload = (writes[0]?.[0] as Record<string, unknown>)[SETTINGS_KEY] as {
      masterEnabled: boolean;
      lockUntil: number | null;
    };
    expect(payload.masterEnabled).toBe(true);
    expect(payload.lockUntil).toBe(T0 + HOUR);

    // 落盘结果一致。
    const persisted = (await area.get(SETTINGS_KEY))[SETTINGS_KEY] as {
      masterEnabled: boolean;
      lockUntil: number;
    };
    expect(persisted.masterEnabled).toBe(true);
    expect(persisted.lockUntil).toBe(T0 + HOUR);
  });

  it('🔴 绝不出现「只写了 lockUntil 但 masterEnabled 还是 false」的中间态', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ masterEnabled: false }));
    const setSpy = vi.spyOn(area, 'set');
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    fireEvent.click(screen.getByTestId('lock-start'));
    fireEvent.click(screen.getByTestId('lock-confirm-ok'));

    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.locked).toBe('true');
    });

    // 检查**每一次**落盘的快照:只要 lockUntil 是未来的,masterEnabled 必须已经是 true。
    // 若实现成两次写入,中间那次会被这里抓住 —— 那正是「把扩展永久冻结在关闭状态」的瞬间。
    for (const call of setSpy.mock.calls) {
      const payload = (call[0] as Record<string, unknown>)[SETTINGS_KEY] as
        | { masterEnabled: boolean; lockUntil: number | null }
        | undefined;
      if (!payload) continue;
      if (payload.lockUntil !== null && payload.lockUntil > T0) {
        expect(
          payload.masterEnabled,
          '出现了「已锁定但主开关仍关闭」的落盘快照 —— 产品意图的完美反转(ADR-057)',
        ).toBe(true);
      }
    }
  });

  it('主开关本就开启时,确认框不显示「将同时开启滤镜」的告知', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ masterEnabled: true }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    fireEvent.click(screen.getByTestId('lock-start'));

    expect(screen.queryByTestId('lock-will-enable-master')).toBeNull();
  });
});

// ═══════════════════════ 4. 倒计时(ADR-051) ═══════════════════════

describe('🔴 倒计时(ADR-051)', () => {
  it('格式 🔒 锁定中 HH:MM:SS,且每秒刷新', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(
      seeded({ lockUntil: T0 + 2 * HOUR + 14 * MIN + 7 * SEC }),
    );
    const repo = new SettingsRepository({ area, clock: clock.now });
    const timer = manualInterval();

    render(
      <PopupUnderTest repository={repo} clock={clock.now} {...timer.props} />,
    );
    await settled();

    await waitFor(() => {
      expect(screen.getByTestId('lock-countdown').textContent).toBe(
        '🔒 锁定中 02:14:07',
      );
    });

    // 注入的 interval 恰好每 1000ms 一拍(在 manualInterval 里断言)。
    await act(async () => {
      clock.advance(SEC);
      timer.tick();
      await Promise.resolve();
    });

    expect(screen.getByTestId('lock-countdown').textContent).toBe(
      '🔒 锁定中 02:14:06',
    );
  });

  it('🔴 按 lockUntil - now 计算而非自减 —— 丢帧后不漂移', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ lockUntil: T0 + 5 * HOUR }));
    const repo = new SettingsRepository({ area, clock: clock.now });
    const timer = manualInterval();

    render(
      <PopupUnderTest repository={repo} clock={clock.now} {...timer.props} />,
    );
    await settled();

    await waitFor(() => {
      expect(screen.getByTestId('lock-countdown').textContent).toBe(
        '🔒 锁定中 05:00:00',
      );
    });

    // 🔴 时钟跳了 1000 秒,但 interval **只触发一次**(模拟后台节流/丢帧)。
    // 自减计数器在这里会显示 04:59:59 —— 少减 999 次,且误差永不自愈。
    // 按差值算则必须是精确的 04:43:20。
    await act(async () => {
      clock.advance(1000 * SEC);
      timer.tick();
      await Promise.resolve();
    });

    expect(screen.getByTestId('lock-countdown').textContent).toBe(
      '🔒 锁定中 04:43:20',
    );
  });

  it('🔴 组件卸载时清除 setInterval(无泄漏)', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ lockUntil: T0 + HOUR }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    const installed: unknown[] = [];
    const cleared: unknown[] = [];
    let handleSeq = 0;
    const setIntervalFn = (fn: () => void, ms: number) => {
      expect(ms, '倒计时必须每秒刷新').toBe(1000);
      handleSeq += 1;
      const handle = { id: handleSeq, timer: setInterval(fn, ms) };
      installed.push(handle);
      return handle;
    };
    const clearIntervalFn = (handle: unknown) => {
      cleared.push(handle);
      clearInterval((handle as { timer: ReturnType<typeof setInterval> }).timer);
    };

    const view = render(
      <PopupUnderTest
        repository={repo}
        clock={clock.now}
        setIntervalFn={setIntervalFn}
        clearIntervalFn={clearIntervalFn}
      />,
    );
    await settled();

    await waitFor(() => {
      expect(installed.length).toBeGreaterThan(0);
    });

    view.unmount();

    // 🔴 装了几个就必须拆几个 —— 一个都不许留。
    expect(cleared.length).toBe(installed.length);
    expect(cleared).toEqual(installed);
  });

  it('未锁定时**不安装任何定时器** —— 不为看不见的倒计时每秒唤醒', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ lockUntil: null }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    const installed: unknown[] = [];
    const setIntervalFn = (fn: () => void, ms: number) => {
      const handle = setInterval(fn, ms);
      installed.push(handle);
      return handle;
    };

    render(
      <PopupUnderTest
        repository={repo}
        clock={clock.now}
        setIntervalFn={setIntervalFn}
        clearIntervalFn={(h) => {
          clearInterval(h as ReturnType<typeof setInterval>);
        }}
      />,
    );
    await settled();

    expect(installed.length).toBe(0);
  });
});

// ═══════════════════ 5. 锁定态的控件禁用(ADR-051) ═══════════════════

describe('🔴 锁定态的控件禁用(ADR-051)', () => {
  it('主开关、规则行、添加、删除、拖拽**全部禁用**', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ lockUntil: T0 + HOUR }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();

    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.locked).toBe('true');
    });

    // 主开关(ADR-051:关闭滤镜也算设置变更,不可以)。
    expect((screen.getByTestId('master-switch') as HTMLButtonElement).disabled).toBe(true);
    // 添加。
    expect((screen.getByTestId('add-rule') as HTMLButtonElement).disabled).toBe(true);

    // 规则行:打开编辑、删除、拖柄 —— 逐个断言。
    const row = screen.getByTestId('rule-list').querySelector('li');
    expect(row).toBeTruthy();
    for (const button of Array.from(
      (row as HTMLElement).querySelectorAll('button'),
    )) {
      expect(button.disabled, `行内有未禁用的控件: ${button.className}`).toBe(true);
    }
    // 拖拽:禁用时 draggable 不得为 true。
    for (const el of Array.from((row as HTMLElement).querySelectorAll('[draggable]'))) {
      expect(el.getAttribute('draggable')).not.toBe('true');
    }
  });

  it('🔴 点击任一控件**不产生任何写入**(spy)', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ lockUntil: T0 + HOUR }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.locked).toBe('true');
    });

    const before = (await area.get(SETTINGS_KEY))[SETTINGS_KEY] as Record<
      string,
      unknown
    >;
    const snapshot = JSON.stringify(before);
    const setSpy = vi.spyOn(area, 'set');

    // 挨个点一遍锁定期间可见的控件。
    fireEvent.click(screen.getByTestId('master-switch'));
    fireEvent.click(screen.getByTestId('add-rule'));
    const row = screen.getByTestId('rule-list').querySelector('li') as HTMLElement;
    for (const button of Array.from(row.querySelectorAll('button'))) {
      fireEvent.click(button);
    }

    await act(async () => {
      await Promise.resolve();
    });

    // 🔴 用户设置一字未动。
    const after = (await area.get(SETTINGS_KEY))[SETTINGS_KEY] as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(after)).toBe(snapshot);

    // 即便有写(maxSeenTime 的推进是 INV-11 例外 b,允许),
    // 三个受锁字段也绝不允许变。
    for (const call of setSpy.mock.calls) {
      const payload = (call[0] as Record<string, unknown>)[SETTINGS_KEY] as {
        masterEnabled: boolean;
        lockUntil: number | null;
        rules: unknown[];
      };
      expect(payload.masterEnabled).toBe(before.masterEnabled);
      expect(payload.lockUntil).toBe(before.lockUntil);
      expect(JSON.stringify(payload.rules)).toBe(JSON.stringify(before.rules));
    }
  });

  it('§5.4 · 规则列表照常**可见可滚动**(不设 pointer-events:none)', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ lockUntil: T0 + HOUR }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.locked).toBe('true');
    });

    // 列表仍在 DOM 里且有内容。
    const list = screen.getByTestId('rule-list');
    expect(list.querySelectorAll('li').length).toBe(1);
    // 可滚动 —— `popup--dimmed` 那条的 pointer-events:none 不得施加到锁定态。
    expect(getComputedStyle(list).pointerEvents).not.toBe('none');
  });
});

// ═══════════ 6. 🔴 锁定优先于 ADR-050(D2:两条 ADR 的交集) ═══════════

describe('🔴 锁定优先于 ADR-050(D2)', () => {
  it('不可注入页 + **未**锁定 → 主开关**可用**(ADR-050 的本来规则)', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ lockUntil: null }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(
      <PopupUnderTest repository={repo} clock={clock.now} injectable={false} />,
    );
    await settled();

    // 规则编辑类控件禁用……
    expect((screen.getByTestId('add-rule') as HTMLButtonElement).disabled).toBe(true);
    // ……但全局主开关保持可用(§6.1 冲突第 7 条)。
    expect((screen.getByTestId('master-switch') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('🔴 不可注入页 + **锁定中** → 主开关**仍然禁用**(ADR-051 优先)', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ lockUntil: T0 + HOUR }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(
      <PopupUnderTest repository={repo} clock={clock.now} injectable={false} />,
    );
    await settled();
    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.locked).toBe('true');
    });

    // 这是两条 ADR 的交集,**首次打开 popup 即可达**。
    expect(screen.getByTestId('not-injectable-notice')).toBeTruthy();
    expect(
      (screen.getByTestId('master-switch') as HTMLButtonElement).disabled,
      '不可注入页 + 锁定中时主开关必须禁用 —— ADR-051 优先于 ADR-050',
    ).toBe(true);
  });

  it('🔴 该交集下点主开关同样不产生写入', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(
      seeded({ lockUntil: T0 + HOUR, masterEnabled: true }),
    );
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(
      <PopupUnderTest repository={repo} clock={clock.now} injectable={false} />,
    );
    await settled();
    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.locked).toBe('true');
    });

    fireEvent.click(screen.getByTestId('master-switch'));
    await act(async () => {
      await Promise.resolve();
    });

    const persisted = (await area.get(SETTINGS_KEY))[SETTINGS_KEY] as {
      masterEnabled: boolean;
    };
    expect(persisted.masterEnabled).toBe(true);
  });
});

// ═══ 7. 🔴🔴 负向断言:锁定中无任何解除入口(ADR-052 / INV-12)═══
//
// §6 T6c gate 原文:「**这是 INV-12 最重要的一条门禁**」。

describe('🔴🔴 锁定中 DOM 里不得存在解除/取消/结束/缩短锁定的任何入口', () => {
  /** 任何与「让锁变短或消失」沾边的词。 */
  const FORBIDDEN = [
    '解除',
    '解锁',
    '取消锁定',
    '结束锁定',
    '提前结束',
    '缩短',
    '中止',
    '终止',
    '放弃锁定',
    '关闭锁定',
    '清除锁定',
  ];

  async function lockedDom() {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ lockUntil: T0 + HOUR }));
    const repo = new SettingsRepository({ area, clock: clock.now });
    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.locked).toBe('true');
    });
    return screen.getByTestId('popup');
  }

  it('🔴 整棵锁定态 DOM 的文本里不含任何解除类词汇', async () => {
    const popup = await lockedDom();
    const text = popup.textContent ?? '';
    for (const word of FORBIDDEN) {
      expect(text, `锁定中 DOM 出现了「${word}」`).not.toContain(word);
    }
  });

  it('🔴 可交互元素的无障碍名里也不含解除类词汇(不止看可见文本)', async () => {
    const popup = await lockedDom();
    const interactive = Array.from(
      popup.querySelectorAll('button, a, input, select, [role="button"]'),
    );
    for (const el of interactive) {
      const name = [
        el.textContent ?? '',
        el.getAttribute('aria-label') ?? '',
        el.getAttribute('title') ?? '',
        el.getAttribute('data-testid') ?? '',
      ].join(' ');
      for (const word of FORBIDDEN) {
        expect(name, `控件 ${el.className} 的可及名含「${word}」`).not.toContain(word);
      }
    }
  });

  it('🔴 锁定中**没有**二次确认框(那里有个「取消」按钮,但它只属于未锁定态)', async () => {
    const popup = await lockedDom();
    expect(screen.queryByTestId('lock-confirm')).toBeNull();
    expect(screen.queryByTestId('lock-confirm-cancel')).toBeNull();
    // 「启动锁定」入口同样不该在锁定中出现。
    expect(screen.queryByTestId('lock-entry')).toBeNull();
    expect(screen.queryByTestId('lock-start')).toBeNull();
    expect(popup.textContent).not.toContain('启动锁定');
  });

  it('🔴 锁定条里**唯一**会写入的控件就是「延长」', async () => {
    await lockedDom();
    const banner = screen.getByTestId('lock-banner');
    const buttons = Array.from(banner.querySelectorAll('button'));
    expect(buttons.length, '锁定条里出现了不止一个按钮').toBe(1);
    expect(buttons[0]?.dataset.testid).toBe('lock-extend');
    expect(buttons[0]?.textContent).toBe('延长');
  });
});

// ═══════════════════ 8. 延长可用(ADR-052 / INV-12) ═══════════════════

describe('🔴 延长可用(ADR-052)', () => {
  it('延长按钮存在且可用,点击后倒计时**变长**', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ lockUntil: T0 + HOUR }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await waitFor(() => {
      expect(screen.getByTestId('lock-countdown').textContent).toBe(
        '🔒 锁定中 01:00:00',
      );
    });

    const extend = screen.getByTestId('lock-extend') as HTMLButtonElement;
    expect(extend.disabled).toBe(false);

    // 默认延长 1 小时。
    fireEvent.click(extend);

    await waitFor(() => {
      expect(screen.getByTestId('lock-countdown').textContent).toBe(
        '🔒 锁定中 02:00:00',
      );
    });

    const persisted = (await area.get(SETTINGS_KEY))[SETTINGS_KEY] as {
      lockUntil: number;
    };
    expect(persisted.lockUntil).toBe(T0 + 2 * HOUR);
  });

  it('🔴 延长以**现有到期时间**为基准,不是以 now —— 否则「延长」会变成缩短', async () => {
    const clock = makeClock();
    // 锁 8 小时,过了 1 小时(还剩 7 小时)后延长 1 小时。
    const area = new MemoryStorageArea(seeded({ lockUntil: T0 + 8 * HOUR }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await waitFor(() => {
      expect(screen.getByTestId('lock-banner')).toBeTruthy();
    });

    clock.advance(HOUR);
    fireEvent.click(screen.getByTestId('lock-extend'));

    await waitFor(async () => {
      const persisted = (await area.get(SETTINGS_KEY))[SETTINGS_KEY] as {
        lockUntil: number;
      };
      // 正确:8h + 1h = 9h。
      expect(persisted.lockUntil).toBe(T0 + 9 * HOUR);
      // 若错误地以 now 为基准,会得到 T0+1h+1h = T0+2h —— 即**缩短 6 小时**。
      expect(persisted.lockUntil).not.toBe(T0 + 2 * HOUR);
    });
  });

  it('🔴 延长用的也是「数字 + 单位」,不接受裸时间戳(ADR-058)', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ lockUntil: T0 + HOUR }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await waitFor(() => {
      expect(screen.getByTestId('lock-banner')).toBeTruthy();
    });

    const amount = screen.getByTestId('lock-extend-amount') as HTMLInputElement;
    const unit = screen.getByTestId('lock-extend-unit') as HTMLSelectElement;
    expect(amount.type).toBe('number');
    expect([...unit.options].map((o) => o.value)).toEqual([
      'minute',
      'hour',
      'day',
    ]);

    // 改成 30 分钟后延长。
    fireEvent.change(amount, { target: { value: '30' } });
    fireEvent.change(unit, { target: { value: 'minute' } });
    fireEvent.click(screen.getByTestId('lock-extend'));

    await waitFor(async () => {
      const persisted = (await area.get(SETTINGS_KEY))[SETTINGS_KEY] as {
        lockUntil: number;
      };
      expect(persisted.lockUntil).toBe(T0 + HOUR + 30 * MIN);
    });
  });
});

// ═════════ 9. 锁定拒绝不弹红色报错条(I1 / ADR-046) ═════════

describe('🔴 锁定拒绝不弹红色报错条(I1)', () => {
  it('仓储层返回 locked 分类时,UI **不显示**「保存失败」红条', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ lockUntil: T0 + HOUR }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.locked).toBe('true');
    });

    // 直接经仓储层发起一次注定被锁拒绝的写入,并把结果喂给 UI 的处理路径 ——
    // 这里用「UI 层能触发的最接近路径」:点被禁用的控件不会发起写,
    // 故显式调一次仓储层确认它确实返回 locked 分类,再断言 UI 没有红条。
    const rejected = await repo.setMasterEnabled(false);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.kind).toBe('locked');

    await act(async () => {
      await Promise.resolve();
    });

    // 🔴 没有红色报错条 —— 倒计时条已经表达了状态,
    // 对一次**预期内**的拒绝报错是虚假警报。
    expect(screen.queryByTestId('save-error')).toBeNull();
    expect(screen.getByTestId('popup').textContent).not.toContain('保存失败');
    // 倒计时条仍在,它才是这件事的正确表达。
    expect(screen.getByTestId('lock-countdown')).toBeTruthy();
  });
});

// ═════════ 10. 到期自动恢复(gate:无需手动刷新 popup) ═════════

describe('🔴 锁定到期 → UI 自动恢复可编辑', () => {
  it('时钟走到 lockUntil 后,倒计时条消失、控件恢复、计时器入口回来', async () => {
    const clock = makeClock();
    // 只锁 3 秒,方便推进。
    const area = new MemoryStorageArea(seeded({ lockUntil: T0 + 3 * SEC }));
    const repo = new SettingsRepository({ area, clock: clock.now });
    const timer = manualInterval();

    render(
      <PopupUnderTest repository={repo} clock={clock.now} {...timer.props} />,
    );
    await settled();

    // 先确认确实锁着。
    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.locked).toBe('true');
    });
    expect((screen.getByTestId('master-switch') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('lock-banner')).toBeTruthy();

    // 时间走过到期点 —— **不重新挂载组件、不重新打开 popup**。
    await act(async () => {
      clock.advance(3 * SEC);
      timer.tick();
      await Promise.resolve();
    });

    // 🔴 自动恢复,无需手动刷新 popup。
    expect(screen.getByTestId('popup').dataset.locked).toBe('false');
    expect(screen.queryByTestId('lock-banner')).toBeNull();
    expect(screen.queryByTestId('lock-countdown')).toBeNull();
    expect((screen.getByTestId('master-switch') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('add-rule') as HTMLButtonElement).disabled).toBe(false);
    // 计时器入口回来了(可以再锁一次)。
    expect(screen.getByTestId('lock-entry')).toBeTruthy();
  });

  it('到期边界取开区间:now === lockUntil 即已解锁(与领域层 isLocked 同口径)', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ lockUntil: T0 + 2 * SEC }));
    const repo = new SettingsRepository({ area, clock: clock.now });
    const timer = manualInterval();

    render(
      <PopupUnderTest repository={repo} clock={clock.now} {...timer.props} />,
    );
    await settled();
    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.locked).toBe('true');
    });

    // 推到**恰好**等于 lockUntil。
    await act(async () => {
      clock.advance(2 * SEC);
      timer.tick();
      await Promise.resolve();
    });

    expect(screen.getByTestId('popup').dataset.locked).toBe('false');
  });
});

// ═════════ 11. focus 态(ADR-043) ═════════

describe('ADR-043 · 新增可聚焦元素的 focus 态', () => {
  it('锁定 UI 的可聚焦元素由全局 focus 规则覆盖,且组件不得自行覆盖 outline', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({}));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();

    // 新增的可聚焦元素:预设按钮、数字输入、单位下拉、启动按钮。
    const focusable = [
      screen.getByTestId('lock-start-preset-1-hour'),
      screen.getByTestId('lock-start-amount'),
      screen.getByTestId('lock-start-unit'),
      screen.getByTestId('lock-start'),
    ];

    for (const el of focusable) {
      // 全局 :focus-visible 规则命中它们(button / input / select 都在 :where 列表里)。
      expect(['BUTTON', 'INPUT', 'SELECT']).toContain(el.tagName);
      // 组件自身不得写死 outline —— 那会盖掉 ADR-043 的固定值。
      expect(getComputedStyle(el).outlineStyle).not.toBe('none');
    }
  });

  it('锁定态的延长控件同样可聚焦', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ lockUntil: T0 + HOUR }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await waitFor(() => {
      expect(screen.getByTestId('lock-banner')).toBeTruthy();
    });

    for (const id of ['lock-extend-amount', 'lock-extend-unit', 'lock-extend']) {
      const el = screen.getByTestId(id);
      expect(['BUTTON', 'INPUT', 'SELECT']).toContain(el.tagName);
    }
  });

  it('确认框初始焦点落在「取消」而非「确认锁定」(不可逆操作)', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({}));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    fireEvent.click(screen.getByTestId('lock-start'));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('lock-confirm-cancel'));
    });
  });
});
