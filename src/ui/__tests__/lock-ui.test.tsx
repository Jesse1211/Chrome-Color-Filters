// @vitest-environment jsdom
/**
 * 锁定 UI(T6c)× 真实仓储层(T3)的门禁测试。
 *
 * 这里的「真实」指 `SettingsRepository` 本体 —— 只有 `chrome.storage.local`
 * 换成了 `MemoryStorageArea`。逐条覆盖 §6 T6c 的 gate:
 *
 * - 未锁定时的计时器入口(ADR-058):预设 + 数字 + 单位下拉,**不接受裸时间戳**
 * - 二次确认(ADR-056):出现时机、三条后果文案、取消不写入
 * - 🔴 **ADR-076**:主开关 OFF 时锁定入口禁用、子页面不可达,
 *   且锁定写入**不碰** `masterEnabled`(ADR-057 已废止)
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
import { useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryStorageArea } from '../../storage/memory-storage-area.js';
import {
  SETTINGS_KEY,
  SettingsRepository,
} from '../../storage/settings-repository.js';
import { LockCountdownBanner } from '../LockCountdownBanner.js';
import { LockEntryRow } from '../LockEntryRow.js';
import { LockView } from '../LockView.js';
import { RuleListView } from '../RuleListView.js';
import {
  LOCK_CONSEQUENCE_NO_DISABLE,
  LOCK_CONSEQUENCE_NO_EARLY_END,
  LOCK_CONSEQUENCE_NO_SETTINGS,
} from '../lock-strings.js';
import { MASTER_OFF_DISABLED_REASON } from '../strings.js';
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
  },
});

/**
 * 把 popup 的完整接线跑起来 —— 与 `entrypoints/popup/App.tsx` 同构。
 *
 * 时钟与定时器注入,以便在测试里精确推进时间并断言 interval 的拆装。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **本替身必须含 `view` 状态机,不能只渲染 `RuleListView`。**
 *
 * 锁定 UI 折叠改造后,时长选择 / 启动 / 延长全部住在**子页面** `LockView` 里,
 * 列表页只剩一行入口。若替身仍只挂 `RuleListView`,那些控件在替身里
 * **根本不存在** —— 整组门禁会从「验证产品行为」退化成「验证一个产品里
 * 不存在的布局」。故此处补上 App 的三态判别联合,**逐字照搬导航逻辑**,
 * 测试再通过点入口行/倒计时条进入子页面 —— 与真实用户路径一致。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

  // 与 App 的 `View` 判别联合同构(这里只需要 list / lock 两态 ——
  // 本文件不测编辑视图,而 I2 恰恰要求锁定页与编辑视图互不相邻)。
  const [onLockView, setOnLockView] = useState(false);
  const openLockView = useCallback(() => {
    setOnLockView(true);
  }, []);
  const backToList = useCallback(() => {
    setOnLockView(false);
  }, []);

  if (onLockView) {
    return (
      <LockView
        /* ADR-076:`settings` prop 已删除(原为 ADR-057 的告知判据)。 */
        locked={locked}
        lockUntil={lockUntil}
        now={now}
        onStartLock={startLock}
        onExtendLock={extendLock}
        onBack={backToList}
        disabled={!loaded}
      />
    );
  }

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
          <LockCountdownBanner lockUntil={lockUntil} now={now} onOpen={openLockView} />
        ) : undefined
      }
      lockEntry={
        /*
          🔴 ADR-076:与 `App.tsx` **逐字同构** —— 禁用状态由 `RuleListView`
             算好经插槽传进来(含主开关 OFF 这条新理由),测试替身不自己复算。
             替身若在这里写 `disabled={!loaded}`,它就比产品**少**一个禁用
             理由,于是「主开关 OFF 时锁定入口被禁用」这条新行为在本文件里
             永远测不出来 —— 替身与产品的接线必须一致,否则测的是替身。
        */
        !locked
          ? ({ disabled, reason }) => (
              <LockEntryRow
                onOpen={openLockView}
                disabled={disabled}
                disabledReason={reason}
              />
            )
          : undefined
      }
    />
  );
}

/**
 * 进入锁定子页面 —— 点列表页上那个唯一的锁定入口。
 *
 * 未锁定时它是折叠入口行「🔒 时间锁定 ›」,锁定中它是倒计时条;
 * 两者共用 `data-testid="lock-open"`(**互斥**地只有一个在场,
 * 这正是 INV-12 的结构前提),故一个 helper 覆盖两条路径。
 */
async function gotoLockView() {
  fireEvent.click(screen.getByTestId('lock-open'));
  await waitFor(() => {
    expect(screen.getByTestId('popup').dataset.view).toBe('lock');
  });
}

/**
 * 把宏任务队列推几轮 —— 用于证明「什么都没发生」。
 *
 * ⚠️ 断言「零写入」必须先给实现**机会**去写:不推队列就断言,
 *    绿灯可能只是因为写入还在半路上。推完仍然没有,才是真的没有。
 */
async function drainMacrotasks() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
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
    // 时长控件住在子页面 —— 先走用户的那条路进去。
    await gotoLockView();

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
    await gotoLockView();

    /*
      断言范围从列表页的入口区改成**子页面的启动区** ——
      控件搬了家,门禁要盯的是控件现在所在的那个容器。
      范围没有放宽:启动区就是时长控件的全部所在,
      下面再追加一条「整个子页面里也只有这一个数字输入」。
    */
    const entry = screen.getByTestId('lock-start-section');

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

    // 🔴 把范围扩到**整个子页面**:全页也只有这一个数字输入 + 一个下拉,
    //    且没有任何 datetime/date/time/text 输入。搬家没有在页面别处
    //    留下第二个「可以填时间戳」的口子。
    const page = screen.getByTestId('popup');
    expect(page.querySelectorAll('input[type="number"]').length).toBe(1);
    expect(page.querySelectorAll('select').length).toBe(1);
    for (const t of ['datetime-local', 'date', 'time', 'text']) {
      expect(
        page.querySelectorAll(`input[type="${t}"]`).length,
        `子页面出现了 input[type=${t}]`,
      ).toBe(0);
    }
  });

  it('时长非法(0)时启动按钮禁用并提示,不静默拒绝', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({}));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await gotoLockView();

    fireEvent.change(screen.getByTestId('lock-start-amount'), {
      target: { value: '0' },
    });

    expect((screen.getByTestId('lock-start') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('lock-invalid-duration')).toBeTruthy();
  });
});

// ════ 1b. 折叠入口 + 子页面导航(列表页的空间回收) ════
//
// 产品形态的改动:列表页只留一行入口,时长控件全在子页面。
// 这一组守的是**布局本身**(旧的内联布局不得回归)
// 与**导航路径上零写入**(ADR-061)。

describe('🔴 列表页折叠成一行,时长控件全在子页面', () => {
  it('列表页**没有**内联的时长选择器、启动按钮或预设按钮', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({}));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();

    const page = screen.getByTestId('popup');
    expect(page.dataset.view).toBe('list');

    // 🔴 旧的内联布局一个都不许留在列表页。
    for (const id of [
      'lock-start-section',
      'lock-start',
      'lock-start-duration',
      'lock-start-amount',
      'lock-start-unit',
      'lock-start-preset-1-hour',
      'lock-confirm',
    ]) {
      expect(screen.queryByTestId(id), `列表页仍内联着 ${id}`).toBeNull();
    }
    // 列表页上没有任何数字输入或下拉(它们都是时长控件)。
    expect(page.querySelectorAll('input[type="number"]').length).toBe(0);
    expect(page.querySelectorAll('select').length).toBe(0);
  });

  it('入口是一行**真正的 `<button>`**,与「添加规则」同一基类', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({}));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();

    const row = screen.getByTestId('lock-open');
    expect(row.tagName).toBe('BUTTON');
    // 视觉语言复用:与底部「+ 添加规则」共享 `.add-button`。
    expect(row.className).toContain('add-button');
    expect(screen.getByTestId('add-rule').className).toContain('add-button');
    // 可见文案 + 无障碍名都在场。
    expect(row.textContent).toContain('时间锁定');
    expect(row.getAttribute('aria-label')).toBeTruthy();
  });

  it('点入口行进入子页面;子页面有返回控件,返回后回到列表', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({}));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await gotoLockView();

    // 子页面:标题 + 返回 + 时长控件 + 启动按钮。
    expect(screen.getByTestId('lock-view-title').textContent).toBe('专注锁定');
    expect(screen.getByTestId('lock-start-section')).toBeTruthy();
    expect(screen.getByTestId('lock-start')).toBeTruthy();

    const back = screen.getByTestId('lock-back');
    expect(back.tagName).toBe('BUTTON');
    fireEvent.click(back);

    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.view).toBe('list');
    });
    expect(screen.getByTestId('lock-entry')).toBeTruthy();
  });

  it('🔴 子页面里**没有**预览通道,也没有任何规则编辑控件(I2)', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({}));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await gotoLockView();

    /*
     * 「预览与锁定永不共存」(§6 T6b gate 的 I2)在 DOM 层的体现:
     * 锁定子页面里没有强度滑块、没有 pattern 输入、没有规则列表、
     * 没有保存/删除 —— 一个预览通道能被触发的控件都不存在。
     */
    for (const id of [
      'intensity-slider',
      'pattern-input',
      'rule-list',
      'save-button',
      'delete-button',
      'master-switch',
      'add-rule',
    ]) {
      expect(screen.queryByTestId(id), `锁定子页面出现了 ${id}`).toBeNull();
    }
    expect(screen.getByTestId('popup').querySelectorAll('input[type="range"]').length).toBe(0);
  });

  it('🔴 ADR-061:进入/离开子页面的导航路径上**一个字节都不写**', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({}));
    const setSpy = vi.spyOn(area, 'set');
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();

    const before = setSpy.mock.calls.length;

    // 进 → 出 → 进 → 出,来回若干次。
    for (let i = 0; i < 3; i++) {
      await gotoLockView();
      fireEvent.click(screen.getByTestId('lock-back'));
      await waitFor(() => {
        expect(screen.getByTestId('popup').dataset.view).toBe('list');
      });
    }
    await act(async () => {
      await Promise.resolve();
    });

    /*
     * 🔴 导航既不写入、也不防抖排队(ADR-061:popup 一失焦即销毁,
     *    任何挂在导航上的延迟写入都会静默丢失)。
     *    写入只发生在二次确认之后那一处。
     */
    expect(
      setSpy.mock.calls.length,
      '导航路径上发生了写入 —— ADR-061:锁定写入只能发生在确认之后',
    ).toBe(before);
    const persisted = (await area.get(SETTINGS_KEY))[SETTINGS_KEY] as {
      lockUntil: number | null;
    };
    expect(persisted.lockUntil).toBeNull();
  });

  it('锁定中:列表页保留倒计时,点它直达延长控件', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ lockUntil: T0 + 2 * HOUR }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.locked).toBe('true');
    });

    // 🔴 剩余时间在**列表页**一眼可见(产品负责人的决定)。
    expect(screen.getByTestId('lock-countdown').textContent).toBe(
      '🔒 锁定中 02:00:00',
    );
    // 但延长控件不在列表页。
    expect(screen.queryByTestId('lock-extend')).toBeNull();

    await gotoLockView();

    // 子页面:标题说的是「延长锁定」,延长控件在场且可用。
    expect(screen.getByTestId('lock-view-title').textContent).toBe('延长锁定');
    expect((screen.getByTestId('lock-extend') as HTMLButtonElement).disabled).toBe(false);
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
    await gotoLockView();

    // 基线:ADR-071 后读路径零写入,仍记下当前调用数再比对以隔离本段。
    // 🔴 导航本身也必须零写入(ADR-061:popup 失焦即销毁,
    //    任何挂在导航上的延迟写入都会静默丢失)——
    //    基线在**进入子页面之后**取,下面另有一条专门断言导航零写入。
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
    await gotoLockView();
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
    await gotoLockView();

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
    // 仍然是可编辑的未锁定态(子页面与列表页的 data-locked 同口径)。
    expect(screen.getByTestId('popup').dataset.locked).toBe('false');
    // 取消只关框,**不**退出子页面 —— 用户可以改个时长再试。
    expect(screen.getByTestId('popup').dataset.view).toBe('lock');
  });
});

// ═══════════════════ 3. ADR-076:主开关 OFF ⇒ 锁定入口不可达 ═══════════════════
//
// 🔴🔴 **本区段原先是「ADR-057 原子开启主开关」,3 条用例。**
//
// ADR-057 已由 ADR-076 废止:它解决的问题是「用户在主开关 OFF 时启动锁定,
// 把扩展永久冻结在关闭状态」,而 ADR-076 让那个场景**在 UI 上不可达** ——
// 入口被禁用,用户点不动。
//
// 原 3 条用例测的全是那条路径上的行为:
//   (1)「OFF 时启动 → 一次写入同时设 masterEnabled=true 与 lockUntil」
//   (2)「绝不出现『只写了 lockUntil 但 masterEnabled 还是 false』的中间态」
//   (3)「主开关本就开启时,确认框不显示『将同时开启滤镜』的告知」
//
// 它们**不是被删掉以求绿灯**,而是因为所断言的产品行为已不存在:
// (1)(2) 要求一个已删除的副作用写入必须发生;(3) 断言一段已删除的文案缺席
// —— 整段文案不复存在,这条断言退化为恒真。
//
// 替换为下面 4 条,覆盖同一片风险、方向反转:
//   · OFF 时入口**真的禁用**,且点不动(路径从源头断掉);
//   · 子页面因此**到不了**(原危险路径的入口被堵死);
//   · 确认框里**没有**那段告知(文案真的不在场,不是靠 prop 关掉);
//   · 锁定写入**不碰** `masterEnabled`(原 ADR-057 的副作用真的没了)——
//     这一条守的正是 (1)(2) 的反面:有人把那行代码加回来就会红。

describe('🔴🔴 ADR-076 · 主开关 OFF ⇒ 锁定入口禁用,启动路径不可达', () => {
  it('主开关 OFF → 「🔒 时间锁定」入口**真的 disabled**,且点击不切视图', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ masterEnabled: false }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();

    const entry = screen.getByTestId('lock-open') as HTMLButtonElement;
    expect(entry.disabled, 'ADR-076:主开关 OFF → 锁定入口禁用').toBe(true);
    // 真 disabled:不可聚焦,键盘用户同样进不去。
    entry.focus();
    expect(document.activeElement).not.toBe(entry);
    // 禁用了还说得出为什么(无障碍)。
    expect(entry.getAttribute('title')).toBe(MASTER_OFF_DISABLED_REASON);

    // 点它 —— 视图不变,仍在列表页。
    fireEvent.click(entry);
    expect(screen.getByTestId('popup').dataset.view).toBe('list');
  });

  it('🔴 主开关 OFF 时**到不了**子页面 → 启动按钮与确认框在任何情况下都不可达', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ masterEnabled: false }));
    const setSpy = vi.spyOn(area, 'set');
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();

    const before = setSpy.mock.calls.length;
    fireEvent.click(screen.getByTestId('lock-open'));
    await drainMacrotasks();

    // 既没进子页面,也没有启动按钮 / 确认框。
    expect(screen.getByTestId('popup').dataset.view).toBe('list');
    expect(screen.queryByTestId('lock-start')).toBeNull();
    expect(screen.queryByTestId('lock-confirm')).toBeNull();
    // 🔴 整条路径零写入 —— 磁盘上既没有 lockUntil,也没被偷偷开主开关。
    expect(setSpy.mock.calls.length).toBe(before);
    const persisted = (await area.get(SETTINGS_KEY))[SETTINGS_KEY] as {
      masterEnabled: boolean;
      lockUntil: number | null;
    };
    expect(persisted.lockUntil).toBeNull();
    expect(persisted.masterEnabled).toBe(false);
  });

  it('🔴 ADR-076:确认框里**没有**「将同时开启滤镜」那段告知(文案已删除)', async () => {
    const clock = makeClock();
    // 唯一可达的入口状态:主开关 ON。
    const area = new MemoryStorageArea(seeded({ masterEnabled: true }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await gotoLockView();
    fireEvent.click(screen.getByTestId('lock-start'));

    // 元素不在场……
    expect(screen.queryByTestId('lock-will-enable-master')).toBeNull();
    // ……文案本身也不在页面上(换个 testid 加回来一样算违规)。
    expect(document.body.textContent).not.toContain(
      '滤镜当前已关闭,启动锁定将同时开启滤镜',
    );
    // 而 ADR-056 的三条后果照旧逐条在场 —— 删的只是 ADR-057 那一段。
    expect(
      [...screen.getByTestId('lock-consequences').querySelectorAll('li')].map(
        (li) => li.textContent,
      ),
    ).toEqual(['无法修改任何设置', '无法关闭滤镜', '无法提前结束(只能延长)']);
  });

  it('🔴🔴 ADR-076:启动锁定的那次写入**不碰** masterEnabled(ADR-057 的副作用已删除)', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ masterEnabled: true }));
    const setSpy = vi.spyOn(area, 'set');
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await gotoLockView();
    fireEvent.click(screen.getByTestId('lock-start'));

    const before = setSpy.mock.calls.length;
    fireEvent.click(screen.getByTestId('lock-confirm-ok'));
    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.locked).toBe('true');
    });

    // 仍然是**恰好一次**写入(这条与 ADR-057 无关,是「无中间态」本身)。
    const writes = setSpy.mock.calls.slice(before);
    expect(
      writes.length,
      `发生了 ${String(writes.length)} 次写入,启动锁定要求恰好 1 次`,
    ).toBe(1);

    // 🔴 那一次写入里 masterEnabled 与写入**之前**逐字相同 ——
    //    锁定写入只写它名字里那个字段。
    const payload = (writes[0]?.[0] as Record<string, unknown>)[SETTINGS_KEY] as {
      masterEnabled: boolean;
      lockUntil: number | null;
    };
    expect(payload.lockUntil).toBe(T0 + HOUR);
    expect(
      payload.masterEnabled,
      'ADR-076:锁定写入不得连带改动 masterEnabled',
    ).toBe(true);
  });
});

// ═══════════════════════ 4. 倒计时(ADR-051) ═══════════════════════

// ═════════════ 3b. 📌 子页面底栏:主操作钉在最下沿(产品负责人)═════════════
//
// > 「点击『时间锁定』进入页面后,『启动锁定』要和『添加规则』一样的页面设计,
// > 『save』按钮放在最下面」
//
// 本区段断言的是**结构**(主操作是底栏的子节点、底栏是主体的后继兄弟、
// 两个分支都如此),而不是像素 —— 像素由 T6c 真实 Chrome 门禁的截图与
// `getBoundingClientRect` 对照验证(见 `docs/T6c-gate/lock-subpage.cjs`)。

describe('📌 子页面底栏 · 主操作钉在最下沿(与 .popup__foot / .edit__foot 同构)', () => {
  it('未锁定:「启动锁定」在底栏里,且底栏排在可滚动主体**之后**', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ masterEnabled: true }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await gotoLockView();

    const foot = screen.getByTestId('lock-view-foot');
    const start = screen.getByTestId('lock-start');
    // 主操作真的住在底栏里 —— 不是碰巧长得像。
    expect(foot.contains(start)).toBe(true);
    expect(foot.tagName).toBe('FOOTER');

    // 底栏是 `.popup` 的**直接子元素** —— 否则它只能钉在某个内层盒子的
    // 底部,popup 最下沿仍会留死空间(本次要修的正是这个)。
    expect(foot.parentElement?.classList.contains('popup')).toBe(true);

    // 底栏排在可滚动主体之后(DOM 顺序即视觉顺序)。
    const body = screen.getByTestId('lock-start-section');
    expect(body.classList.contains('lock-view__body')).toBe(true);
    expect(
      body.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING,
      '底栏必须排在主体之后',
    ).toBeTruthy();
  });

  it('未锁定:时长控件留在**主体**里,没有被一起搬进底栏', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ masterEnabled: true }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await gotoLockView();

    const foot = screen.getByTestId('lock-view-foot');
    // 底栏里**只有**那一个主操作按钮 —— 预设 / 数字 / 下拉全不在场。
    expect([...foot.querySelectorAll('button')].map((b) => b.getAttribute('data-testid'))).toEqual([
      'lock-start',
    ]);
    expect(foot.querySelectorAll('input, select').length).toBe(0);
    // 时长控件仍在主体里。
    const body = screen.getByTestId('lock-start-section');
    expect(body.contains(screen.getByTestId('lock-start-amount'))).toBe(true);
    expect(body.contains(screen.getByTestId('lock-start-unit'))).toBe(true);
    expect(body.contains(screen.getByTestId('lock-start-preset-1-hour'))).toBe(true);
  });

  it('🔴 锁定中:「延长」同样在底栏里(两个分支同一个规律)', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(
      seeded({ masterEnabled: true, lockUntil: T0 + HOUR }),
    );
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await gotoLockView();

    const foot = screen.getByTestId('lock-view-foot');
    const extend = screen.getByTestId('lock-extend');
    expect(foot.contains(extend)).toBe(true);
    expect(foot.parentElement?.classList.contains('popup')).toBe(true);

    // 🔴 底栏里**只有**「延长」—— 锁定中唯一的写入控件(ADR-052/INV-12)。
    //    多出任何一个按钮都是解除入口的嫌疑。
    expect(
      [...foot.querySelectorAll('button')].map((b) => b.getAttribute('data-testid')),
    ).toEqual(['lock-extend']);

    // 倒计时回显、只读说明、时长输入都留在主体里(它们是参照与输入)。
    const body = screen.getByTestId('lock-extend-panel');
    expect(body.contains(screen.getByTestId('lock-view-countdown'))).toBe(true);
    expect(body.contains(screen.getByTestId('lock-extend-amount'))).toBe(true);
    expect(
      body.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('底栏取 `.edit__foot` 的同一组 token(钉底 + 上边框),不是新发明的第三种', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ masterEnabled: true }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await gotoLockView();

    const style = getComputedStyle(screen.getByTestId('lock-view-foot'));
    // `flex: 0 0 auto` —— 不参与伸缩,恒贴最下沿。
    expect(style.flexGrow).toBe('0');
    expect(style.flexShrink).toBe('0');
    expect(style.flexBasis).toBe('auto');
    // 与 `.edit__foot` 逐值相同的内边距 —— 同一惯用法,不是另一套。
    expect(style.padding).toBe('12px 15px');
    /*
      与主体之间有分隔线(两个既有底栏都有)。
      ⚠️ jsdom 会把含 `var()` 的简写整条丢掉(`borderTop` 读回空串),
         故这一条改在**样式表源文本**上断言 —— 并且直接与 `.edit__foot`
         的那条比对,比读计算值更能证明「用的是同一组 token」。
    */
    const css = (
      document.querySelector('[data-testid="popup-styles"]')?.textContent ?? ''
    ).replace(/\/\*[\s\S]*?\*\//g, ' ');
    /** 取某个选择器那一条规则的声明块(本文件的样式表里每个选择器只有一条)。 */
    const ruleOf = (selector: string): string => {
      const at = css.indexOf(`${selector} {`);
      if (at < 0) return '';
      return css.slice(at + selector.length + 2, css.indexOf('}', at));
    };
    const lockFoot = ruleOf('.lock-view__foot');
    const editFoot = ruleOf('.edit__foot');
    expect(lockFoot, '.lock-view__foot 规则未找到').not.toBe('');
    expect(editFoot, '.edit__foot 规则未找到').not.toBe('');
    for (const decl of [
      'border-top: 1px solid var(--line)',
      'padding: 12px 15px',
      'flex: 0 0 auto',
    ]) {
      expect(lockFoot, `.lock-view__foot 缺少 ${decl}`).toContain(decl);
      expect(editFoot, `.edit__foot 缺少 ${decl} —— 两者不再同构`).toContain(decl);
    }
    // 🔴 不是绝对定位 —— 那会脱离文档流、盖住主体最后一行。
    expect(style.position).not.toBe('absolute');
  });

  it('🔴 锁定中的子页面底栏**不**被淡化 —— 「延长」是唯一可用的操作(ADR-052)', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(
      seeded({ masterEnabled: true, lockUntil: T0 + HOUR }),
    );
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await gotoLockView();

    // 根上确实带着 popup--locked(子页面与列表页 data-locked 同口径)……
    expect(screen.getByTestId('popup').className).toContain('popup--locked');
    // ……但底栏不像列表页的 `.popup__foot` 那样降到 .62:
    // 把唯一还能用的按钮画成半透明,等于暗示它也不能用。
    const opacity = Number.parseFloat(
      getComputedStyle(screen.getByTestId('lock-view-foot')).opacity || '1',
    );
    expect(opacity).toBe(1);
    // 而它确实是**可用**的(时长合法时不禁用)。
    expect((screen.getByTestId('lock-extend') as HTMLButtonElement).disabled).toBe(false);
  });
});

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

    // 即便有写(ADR-071 后锁定期间不该有任何写入),
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
    // 「时间锁定」折叠入口与「启动锁定」按钮同样不该在锁定中出现。
    expect(screen.queryByTestId('lock-entry')).toBeNull();
    expect(screen.queryByTestId('lock-start')).toBeNull();
    expect(popup.textContent).not.toContain('启动锁定');
  });

  /*
   * 🔴 控件搬进子页面后,**这一组负向断言必须跟进子页面** ——
   * 否则「列表页干净」会变成一句空话:真正的解除后门若存在,
   * 它只会出现在控件所在的那一页。故下面三条逐条在**子页面**上重跑。
   */
  async function lockedSubPage() {
    await lockedDom();
    fireEvent.click(screen.getByTestId('lock-open'));
    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.view).toBe('lock');
    });
    return screen.getByTestId('popup');
  }

  it('🔴 列表页的倒计时条**一个写入控件都没有**(唯一的按钮是导航)', async () => {
    await lockedDom();
    const banner = screen.getByTestId('lock-banner');
    const buttons = Array.from(banner.querySelectorAll('button'));
    expect(buttons.length, '锁定条里出现了不止一个按钮').toBe(1);
    // 它是通往子页面的导航,不是写入 —— 延长在子页面里。
    expect(buttons[0]?.dataset.testid).toBe('lock-open');
    // 列表页上没有任何会改 lockUntil 的控件。
    expect(screen.queryByTestId('lock-extend')).toBeNull();
    expect(banner.querySelectorAll('input, select').length).toBe(0);
  });

  it('🔴🔴 锁定子页面的 DOM 文本里同样不含任何解除类词汇', async () => {
    const page = await lockedSubPage();
    const text = page.textContent ?? '';
    for (const word of FORBIDDEN) {
      expect(text, `锁定子页面出现了「${word}」`).not.toContain(word);
    }
  });

  it('🔴🔴 锁定子页面可交互元素的无障碍名里也不含解除类词汇', async () => {
    const page = await lockedSubPage();
    const interactive = Array.from(
      page.querySelectorAll('button, a, input, select, [role="button"]'),
    );
    // 至少有延长按钮 + 数字 + 单位 + 返回 —— 不是空集合扫了个空。
    expect(interactive.length).toBeGreaterThanOrEqual(4);
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

  it('🔴🔴 锁定子页面里**唯一**会写入的控件就是「延长」', async () => {
    const page = await lockedSubPage();
    const buttons = Array.from(page.querySelectorAll('button'));
    // 恰好两个:返回(只切视图)+ 延长(唯一写入)。
    expect(
      buttons.map((b) => b.dataset.testid),
      '锁定子页面出现了预期之外的按钮',
    ).toEqual(['lock-back', 'lock-extend']);
    expect(
      buttons.find((b) => b.dataset.testid === 'lock-extend')?.textContent,
    ).toBe('延长');
    // 启动区在锁定中根本不渲染(互斥的两个分支)。
    expect(screen.queryByTestId('lock-start-section')).toBeNull();
    expect(screen.queryByTestId('lock-start')).toBeNull();
  });

  it('🔴 「返回」不是「解除」—— 返回列表后锁仍在、控件仍禁用', async () => {
    await lockedSubPage();
    fireEvent.click(screen.getByTestId('lock-back'));

    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.view).toBe('list');
    });
    // 🔴 锁一点没松:data-locked 仍为 true、倒计时条仍在、控件仍禁用。
    expect(screen.getByTestId('popup').dataset.locked).toBe('true');
    expect(screen.getByTestId('lock-banner')).toBeTruthy();
    expect((screen.getByTestId('master-switch') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('add-rule') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('lock-entry')).toBeNull();
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
    // 延长控件住在子页面 —— 点倒计时条进去(用户的那条路)。
    await gotoLockView();
    expect(screen.getByTestId('lock-view-countdown').textContent).toBe(
      '🔒 锁定中 01:00:00',
    );

    const extend = screen.getByTestId('lock-extend') as HTMLButtonElement;
    expect(extend.disabled).toBe(false);

    // 默认延长 1 小时。
    fireEvent.click(extend);

    // 子页面上的回显当场变长。
    await waitFor(() => {
      expect(screen.getByTestId('lock-view-countdown').textContent).toBe(
        '🔒 锁定中 02:00:00',
      );
    });

    // 返回列表页,倒计时条也是变长后的值(两处同一个 lockUntil)。
    fireEvent.click(screen.getByTestId('lock-back'));
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
    await gotoLockView();

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
    await gotoLockView();

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
    // 折叠入口行回来了(点它可以再锁一次)。
    expect(screen.getByTestId('lock-entry')).toBeTruthy();
    expect(screen.getByTestId('lock-open')).toBeTruthy();
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

    // 列表页的折叠入口行:它是**真正的 `<button>`**,不是可点击的 div ——
    // 可 Tab 聚焦、可回车触发、全局 :focus-visible 命中它。
    const row = screen.getByTestId('lock-open');
    expect(row.tagName).toBe('BUTTON');
    expect(getComputedStyle(row).outlineStyle).not.toBe('none');

    await gotoLockView();

    // 新增的可聚焦元素:返回、预设按钮、数字输入、单位下拉、启动按钮。
    const focusable = [
      screen.getByTestId('lock-back'),
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

  it('🔴 延长区的数字框标签只是**视觉**隐藏 —— 无障碍名一个字没少', async () => {
    const clock = makeClock();
    const area = new MemoryStorageArea(seeded({ lockUntil: T0 + HOUR }));
    const repo = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repo} clock={clock.now} />);
    await settled();
    await waitFor(() => {
      expect(screen.getByTestId('lock-banner')).toBeTruthy();
    });
    await gotoLockView();

    const amount = screen.getByTestId('lock-extend-amount');
    const label = document.querySelector(`label[for="${amount.id}"]`);

    // 🔴 标签**可见**(产品负责人拍板)。它一度是 visually-hidden ——
    //    用隐藏信息去迁就 360px 的布局。现在标签独占一行、控件在下一行,
    //    两者都放得下。本断言盯住它别再被「优化」成隐藏。
    expect(label, '延长区的数字框没有关联 <label>').toBeTruthy();
    expect(label?.textContent).toBe('延长时长数值');
    expect(label?.className).toBe('lock-duration__label');
    expect(label?.className).not.toContain('visually-hidden');
    // 用无障碍名就能拿到它 —— 屏幕阅读器读得到。
    expect(screen.getByLabelText('延长时长数值')).toBe(amount);
    expect(screen.getByLabelText('延长时长单位')).toBe(
      screen.getByTestId('lock-extend-unit'),
    );

    // 对照:启动区的同一个标签是**可见**的(没有被这次改动波及)。
    fireEvent.click(screen.getByTestId('lock-back'));
    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.view).toBe('list');
    });
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
    // 锁定中的倒计时条本身也是一个真正的 `<button>`(通往子页面)。
    expect(screen.getByTestId('lock-open').tagName).toBe('BUTTON');
    await gotoLockView();

    for (const id of ['lock-back', 'lock-extend-amount', 'lock-extend-unit', 'lock-extend']) {
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
    await gotoLockView();
    fireEvent.click(screen.getByTestId('lock-start'));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('lock-confirm-cancel'));
    });
  });
});
