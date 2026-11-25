// @vitest-environment jsdom
/**
 * 🔴 **锁定写入必须活过 popup 拆除**(T6c gate「启动锁定端到端落盘」
 * 与「延长按钮…点击后倒计时变长」在**真实时序**下的回归测试)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 这组测试存在的理由(上一轮的盲点)
 *
 * T6c 原有的五个测试文件**全部**只用 `MemoryStorageArea` —— 它的 `get`/`set`
 * 返回**已 resolve 的 Promise**,回调在**微任务**就跑完、文档全程存活。
 * 于是「启动锁定 / 延长锁定」只在**真实栈永不占据的那个状态**下被验证过。
 *
 * 真实栈的时序完全不同(ADR-061 已记录、且本仓已为同一类缺陷出过两次 fixup:
 * 6df1edf / 6d34545):`chrome.storage.local` 是**跨进程 IPC**,
 * 每次调用最快也在**后续宏任务**才回话。而 Chrome 工具栏 popup **一失焦即销毁**。
 * 所以只要写入路径上存在一次 `await`,那次 await 就是一个丢写窗口:
 *
 *     用户点「确认锁定」→ 发出 storage.get → await
 *       → popup 失焦、文档被拆、JS 上下文消失
 *       → get 的回调永远回不来 → storage.set **从未发出**
 *       → 锁定静默丢失,而 UI 已经显示成功
 *
 * ⚠️ ADR-061 的**静态**门禁(「写入路径上不出现任何 setTimeout」)**结构上看不见
 * 这个窗口** —— T6a 的窗口是一个 300ms 的客户端计时器,而这里的窗口是
 * **仓储层内部那次被 await 的读**。静态检查因此会一直是绿的。
 * 只有本文件这种「宏任务 + 可销毁」的替身能把它照出来。
 *
 * 故本文件用 `AsyncStorageArea`(6d34545 为此建的替身):
 * `get`/`set` 在后续宏任务才 resolve,`destroy()` 后任务队列停止推进。
 *
 * ⚠️ **不得**用「拆除前再补一次写」来修 —— ADR-061 明文记载该路线**已被证伪**。
 * 唯一可行的方向是让写入在**点击那一轮**就发出。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { coerceSettings, isLocked } from '../../domain/filter-settings.js';
import {
  SETTINGS_KEY,
  SettingsRepository,
} from '../../storage/settings-repository.js';
import { LockCountdownBanner } from '../LockCountdownBanner.js';
import { LockEntryRow } from '../LockEntryRow.js';
import { LockView } from '../LockView.js';
import { RuleListView } from '../RuleListView.js';
import { stubTabStatePort } from '../tab-state.js';
import { useLockState } from '../useLockState.js';
import { usePopupSettings } from '../usePopupSettings.js';
import { AsyncStorageArea } from './async-storage-area.js';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

/** 固定的「现在」。 */
const T0 = 1_700_000_000_000;

afterEach(cleanup);

function makeClock(start = T0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const seeded = (over: {
  masterEnabled?: boolean;
  lockUntil?: number | null;
}) => ({
  [SETTINGS_KEY]: {
    version: 1,
    masterEnabled: over.masterEnabled ?? true,
    rules: [{ pattern: '*.weibo.*', mode: 'Grayscale', intensity: 100 }],
    lockUntil: over.lockUntil ?? null,
  },
});

/** 已**落盘**的设置(只反映已完成的 set)。 */
const persisted = (area: AsyncStorageArea) =>
  coerceSettings(area.snapshot()[SETTINGS_KEY]);

/** 让挂起的宏任务跑完(仅在未 `destroy()` 时才有效果)。 */
const drain = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 手动驱动的 interval 替身 —— 倒计时不靠真实挂钟。 */
function manualInterval() {
  const callbacks: (() => void)[] = [];
  return {
    props: {
      setIntervalFn: (fn: () => void, ms: number) => {
        expect(ms, '倒计时必须每秒刷新').toBe(1000);
        callbacks.push(fn);
        return { index: callbacks.length - 1 };
      },
      clearIntervalFn: () => undefined,
    },
    tick: () => {
      for (const fn of callbacks) fn();
    },
  };
}

/**
 * 与 `entrypoints/popup/App.tsx` 同构的完整接线。
 *
 * 🔴 **含 `view` 状态机** —— 锁定 UI 折叠改造后,启动与延长控件都住在
 * 子页面 `LockView` 里。替身必须跟着走那条导航,否则本文件验的就不是产品
 * 真实的写入时序(见 `lock-ui.test.tsx` 同名替身的长注释)。
 *
 * ⚠️ 导航本身**不得**引入任何 await/防抖(ADR-061)—— 本替身因此逐字照搬
 * App 的 `setView`:一次同步的 `useState`,不碰存储。
 */
function PopupUnderTest({
  repository,
  clock,
  setIntervalFn,
  clearIntervalFn,
}: {
  repository: SettingsRepository;
  clock: () => number;
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
      injectable: true,
      host: 'news.weibo.com',
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
 * 走进锁定子页面 —— 点列表页上那个唯一的锁定入口。
 *
 * 未锁定时它是折叠入口行,锁定中它是倒计时条;两者共用
 * `data-testid="lock-open"` 且**互斥**在场,故一个 helper 覆盖两条路径。
 *
 * ⚠️ 这一步刻意**不** `drain()` —— 它是纯 `useState`,不该需要宏任务。
 *    若将来有人在导航路径上塞了一次 await,本文件的断言会当场变红。
 */
async function gotoLockView() {
  fireEvent.click(screen.getByTestId('lock-open'));
  await waitFor(() => {
    expect(screen.getByTestId('popup').dataset.view).toBe('lock');
  });
}

/** 等到骨架态结束。 */
async function settled() {
  await waitFor(() => {
    expect(screen.getByTestId('popup').dataset.skeleton).toBe('false');
  });
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * 第一组:启动锁定 —— 点击后立刻销毁,锁定仍必须落盘(ADR-061)。
 * ─────────────────────────────────────────────────────────────────────────
 */
describe('🔴 启动锁定后立即销毁 popup,lockUntil 必须已落盘(ADR-061)', () => {
  /*
    🔴 **ADR-076:fixture 由 `masterEnabled: false` 改为 `true`。**

    原 fixture 刻意取「主开关 OFF」—— 那是 ADR-057 最危险的入口状态。
    ADR-076 之后主开关 OFF 时「🔒 时间锁定」入口**是禁用的**,
    这一组根本走不到启动按钮,fixture 描述的是一个**不可达状态**。

    改成 ON 不是放宽:本组真正要守的是 **ADR-061「写入活过 popup 拆除」**,
    与主开关的初始值无关 —— 那个丢写窗口在主开关 ON 时一模一样存在
    (`setLockUntil` 的 `await #readContext()` 不看主开关)。
    下方关于 `masterEnabled` 的那一条断言(ADR-057 专属)已删除并
    **替换**为「主开关**未被连带改动**」—— 见该处说明。
  */
  it('确认锁定 → 文档销毁(任务队列停止)→ 存储里已有 lockUntil', async () => {
    const clock = makeClock();
    const area = new AsyncStorageArea(seeded({ masterEnabled: true }));
    const repository = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repository} clock={clock.now} />);
    await settled();

    // 进子页面 → 选 30 分钟预设 → 点启动 → 二次确认(ADR-056)。
    await gotoLockView();
    fireEvent.click(screen.getByTestId('lock-start-preset-30-minute'));
    fireEvent.click(screen.getByTestId('lock-start'));
    expect(screen.getByTestId('lock-confirm')).toBeTruthy();

    // ── 点「确认锁定」,然后**在那一轮之内**销毁文档 ──
    // 真机对应:点击 → popup 失焦 → Chrome 拆掉 document。
    // 中间**不给**任何宏任务,因为真机也不会给。
    fireEvent.click(screen.getByTestId('lock-confirm-ok'));
    area.destroy();
    cleanup();

    // 之后再怎么推进任务队列也不会有新的写入到达(destroy 已停推进)。
    await drain();
    await drain();
    await drain();

    const after = persisted(area);
    expect(
      after.lockUntil,
      '🔴 锁定写入在 popup 拆除时静默丢失 —— 用户以为锁上了,其实没有',
    ).toBe(T0 + 30 * MIN);
    /*
      🔴 **ADR-076:原断言是 ADR-057 的「主开关必须随锁定一并开启」,
         已删除并替换为下面这条:主开关**未被连带改动**。**

      方向反转、强度不减:ADR-057 要求锁定写入**顺手改**主开关,
      ADR-076 要求它**别碰**主开关(该场景不可达,无需补救)。
      一条「不该发生的写入没有发生」同样需要被钉住 —— 否则有人把
      ADR-057 的那行代码加回来也不会有任何测试变红。
    */
    expect(
      after.masterEnabled,
      'ADR-076:锁定写入不得连带改动 masterEnabled',
    ).toBe(true);
    expect(isLocked(after, T0)).toBe(true);
  });

  it('自定义时长(数字 + 单位下拉)启动后立即销毁,同样必须落盘', async () => {
    const clock = makeClock();
    // ADR-076:主开关 OFF 时锁定入口禁用 → fixture 必须是可达的 ON 态。
    const area = new AsyncStorageArea(seeded({ masterEnabled: true }));
    const repository = new SettingsRepository({ area, clock: clock.now });

    render(<PopupUnderTest repository={repository} clock={clock.now} />);
    await settled();

    await gotoLockView();
    fireEvent.change(screen.getByTestId('lock-start-amount'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByTestId('lock-start-unit'), {
      target: { value: 'hour' },
    });
    fireEvent.click(screen.getByTestId('lock-start'));
    fireEvent.click(screen.getByTestId('lock-confirm-ok'));

    area.destroy();
    cleanup();
    await drain();
    await drain();

    const after = persisted(area);
    expect(after.lockUntil).toBe(T0 + 3 * HOUR);
    // ADR-076:主开关原样保留,锁定写入不碰它。
    expect(after.masterEnabled).toBe(true);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────
 * 第二组:延长锁定 —— 点击后立刻销毁,延长仍必须落盘(ADR-052)。
 * ─────────────────────────────────────────────────────────────────────────
 */
describe('🔴 延长锁定后立即销毁 popup,新的 lockUntil 必须已落盘(ADR-052/ADR-061)', () => {
  it('点延长 → 文档销毁 → 存储里的 lockUntil 已变长(不是原值)', async () => {
    const clock = makeClock();
    const area = new AsyncStorageArea(seeded({ lockUntil: T0 + 2 * HOUR }));
    const repository = new SettingsRepository({ area, clock: clock.now });
    const timer = manualInterval();

    render(
      <PopupUnderTest repository={repository} clock={clock.now} {...timer.props} />,
    );
    await settled();
    await waitFor(() => {
      expect(screen.getByTestId('lock-countdown')).toBeTruthy();
    });

    // 延长控件住在子页面 —— 点倒计时条进去(用户的那条路)。
    await gotoLockView();

    // 延长 1 小时(延长区只有自定义输入,无预设 —— 见 LockExtendPanel)。
    fireEvent.change(screen.getByTestId('lock-extend-amount'), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByTestId('lock-extend-unit'), {
      target: { value: 'hour' },
    });

    fireEvent.click(screen.getByTestId('lock-extend'));
    area.destroy();
    cleanup();
    await drain();
    await drain();

    const after = persisted(area);
    // 🔴 以**现有到期时间**为基准(ADR-052:延长不得变成缩短的后门)。
    expect(after.lockUntil, '延长写入在 popup 拆除时静默丢失').toBe(
      T0 + 3 * HOUR,
    );
    expect(after.lockUntil).not.toBe(T0 + 2 * HOUR);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────
 * 第三组:对照用例 —— 证明上面的替身**确实有牙**。
 *
 * 没有这一组,上面的绿灯也可能只是因为替身太宽松(正是 6d34545 记录的教训)。
 * ─────────────────────────────────────────────────────────────────────────
 */
describe('🔴 对照:销毁后才发出的写入确实到不了存储(替身有牙)', () => {
  it('destroy() 之后发出的 set 永远不落盘', async () => {
    const area = new AsyncStorageArea(seeded({ lockUntil: null }));
    area.destroy();

    void area.set({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: true,
        rules: [],
        lockUntil: T0 + HOUR,
      },
    });
    await drain();
    await drain();

    expect(persisted(area).lockUntil).toBeNull();
    expect(area.setCallCount).toBe(0);
  });

  it('🔴 若锁定写入被推迟到「下一个宏任务」才发出,本组断言必然失败', async () => {
    // 这条用例不测产品代码,而是证明「晚一个宏任务就来不及」——
    // 即第一、二组的绿灯不可能是时序宽松换来的。
    const area = new AsyncStorageArea(seeded({ lockUntil: null }));

    // 模拟「先 await 一次 IPC 读,再发写」这一结构:
    const deferredWrite = (async () => {
      await area.get(SETTINGS_KEY); // ← 真实栈上这一步要等后续宏任务
      await area.set({
        [SETTINGS_KEY]: {
          version: 1,
          masterEnabled: true,
          rules: [],
          lockUntil: T0 + HOUR,
        },
      });
    })();
    void deferredWrite;

    // 文档在 get 回话之前就被拆掉 —— 与真机的 popup 失焦同时序。
    area.destroy();
    await drain();
    await drain();
    await drain();

    // set 根本没被**发出**过,存储里什么都没有。
    expect(area.setInvocationCount).toBe(0);
    expect(persisted(area).lockUntil).toBeNull();
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────
 * 第四组:修复不得削弱任何既有保障。
 * ─────────────────────────────────────────────────────────────────────────
 */
describe('锁定写入活过拆除后,既有保障不得退化', () => {
  it('锁定中缩短仍被拒绝(ADR-052/INV-12)—— 存储里的到期时间不变', async () => {
    const area = new AsyncStorageArea(seeded({ lockUntil: T0 + 8 * HOUR }));
    const clock = makeClock();
    const repository = new SettingsRepository({ area, clock: clock.now });

    // 直接走仓储层:UI 根本没有缩短入口(那是 lock-ui.test.tsx 的负向断言),
    // 这里要确认的是**数据层**的守卫没有被本次修复绕过。
    const result = await repository.setLockUntil(T0 + 1 * HOUR);
    await drain();
    await drain();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('locked');
    expect(persisted(area).lockUntil).toBe(T0 + 8 * HOUR);
  });

  it('锁定中清除(null)仍被拒绝,存储不变', async () => {
    const area = new AsyncStorageArea(seeded({ lockUntil: T0 + 8 * HOUR }));
    const clock = makeClock();
    const repository = new SettingsRepository({ area, clock: clock.now });

    const result = await repository.setLockUntil(null);
    await drain();
    await drain();

    expect(result.ok).toBe(false);
    expect(persisted(area).lockUntil).toBe(T0 + 8 * HOUR);
  });

  it('🔴 快照陈旧(磁盘上的锁更晚)时,立即写入**绝不缩短**锁定(ADR-052/INV-12)', async () => {
    // 这是「不等那次读」所必须付出的代价所在:快照可能陈旧。
    // 安全性不靠快照准确,而靠**单调 max 合并**构造性堵死缩短方向。
    const clock = makeClock();
    const area = new AsyncStorageArea(seeded({ lockUntil: null }));
    const repository = new SettingsRepository({ area, clock: clock.now });

    // 先读一次,让快照记下「未锁定」。
    await repository.read();
    await drain();
    await drain();

    // 🔴 背着本仓储把磁盘改成「锁到 T0+10h」(模拟另一个窗口写入,
    // 且**不**派发 onChanged —— 即快照拿不到更新,陈旧到了最坏情况)。
    await area.set({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: true,
        rules: [],
        lockUntil: T0 + 10 * HOUR,
      },
    });
    await drain();
    await drain();

    // 此刻快照说「未锁定」,于是 canSetLockUntil 会放行一个 T0+1h 的写入 ——
    // 若直接落盘,就把一个 10 小时的锁缩成了 1 小时(INV-12 被绕过)。
    const result = await repository.setLockUntilImmediate(T0 + 1 * HOUR);
    await drain();
    await drain();
    await drain();

    // 🔴 对账后磁盘上的锁必须仍然是 T0+10h,绝不能变短。
    expect(
      persisted(area).lockUntil,
      '🔴 陈旧快照把锁缩短了 —— ADR-052/INV-12 被绕过',
    ).toBe(T0 + 10 * HOUR);
    if (result.ok) expect(result.value.lockUntil).toBe(T0 + 10 * HOUR);
  });

  it('快照陈旧但请求的是**更长**的锁时,照常写入成功', async () => {
    const clock = makeClock();
    const area = new AsyncStorageArea(seeded({ lockUntil: null }));
    const repository = new SettingsRepository({ area, clock: clock.now });

    await repository.read();
    await drain();
    await drain();

    await area.set({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: true,
        rules: [],
        lockUntil: T0 + 2 * HOUR,
      },
    });
    await drain();
    await drain();

    const result = await repository.setLockUntilImmediate(T0 + 9 * HOUR);
    await drain();
    await drain();

    expect(result.ok).toBe(true);
    expect(persisted(area).lockUntil).toBe(T0 + 9 * HOUR);
  });

  it('文档存活时,启动锁定照常返回成功结果并回灌 UI(倒计时出现)', async () => {
    const clock = makeClock();
    // ADR-076:主开关 OFF 时锁定入口禁用 → fixture 必须是可达的 ON 态。
    const area = new AsyncStorageArea(seeded({ masterEnabled: true }));
    const repository = new SettingsRepository({ area, clock: clock.now });
    const timer = manualInterval();

    render(
      <PopupUnderTest repository={repository} clock={clock.now} {...timer.props} />,
    );
    await settled();

    await gotoLockView();
    fireEvent.click(screen.getByTestId('lock-start-preset-1-hour'));
    fireEvent.click(screen.getByTestId('lock-start'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('lock-confirm-ok'));
      await drain();
      await drain();
      await drain();
    });

    /*
      文档存活 → 正常路径不变:启动成功后子页面当场换成延长区(倒计时回显),
      启动区与确认框一并消失。
      ⚠️ 此刻仍在子页面,故这里读的是子页面的回显 `lock-view-countdown`;
         列表页的 `lock-countdown` 要返回后才在场,下面补一步返回并断言。
    */
    await waitFor(() => {
      expect(screen.getByTestId('lock-view-countdown').textContent).toBe(
        '🔒 锁定中 01:00:00',
      );
    });
    expect(screen.queryByTestId('lock-start-section')).toBeNull();
    expect(screen.queryByTestId('lock-start')).toBeNull();
    expect(screen.queryByTestId('lock-confirm')).toBeNull();

    // 返回列表页:倒计时条在场、折叠入口行消失(ADR-051 / INV-12 的互斥)。
    fireEvent.click(screen.getByTestId('lock-back'));
    await waitFor(() => {
      expect(screen.getByTestId('lock-countdown').textContent).toBe(
        '🔒 锁定中 01:00:00',
      );
    });
    expect(screen.queryByTestId('lock-entry')).toBeNull();
    expect(persisted(area).lockUntil).toBe(T0 + HOUR);
    expect(persisted(area).masterEnabled).toBe(true);
  });
});
