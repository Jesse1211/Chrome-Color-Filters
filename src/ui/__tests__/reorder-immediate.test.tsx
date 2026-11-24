// @vitest-environment jsdom
/**
 * 🔴 **ADR-061 · 拖拽重排不走防抖,松手即写入。**
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 这组测试存在的理由
 *
 * 真机实测(真实 Chromium + 真实 `chrome.storage.local`,3/3 次复现):
 * 拖动重排后在 300ms 防抖窗口内销毁 popup(`page.close` 或导航走 ——
 * 正是 Chrome 弹窗失焦时的行为),UI 显示新顺序且**无任何报错**,
 * 但存储里仍是**旧顺序**。因为**顺序即优先级**(ADR-008),
 * 丢失一次重排会**静默改变实际生效的滤镜**(违反 INV-6)。
 *
 * ## 为什么上一轮的回归测试抓不到
 *
 * > 上一轮加的回归测试在 jsdom 里派发 `pagehide`,但**文档仍存活、
 * > 内存存储在微任务就 resolve** —— 它从未模拟「文档已销毁 + 存储异步 IPC」,
 * > 所以测试绿而真实行为红。
 *
 * 故本文件用 `AsyncStorageArea`:`get`/`set` 在**后续宏任务**才 resolve,
 * 且 `destroy()` 之后任务队列**停止推进**(挂起与新发起的调用都永不完成)。
 * 这让「拆除时再补一次异步写」在测试里与真机一样**物理上不可能**成功 ——
 * 与 ADR-061「上一轮的关闭时 flush 已被证伪」一致。
 *
 * ## 解法(ADR-061,产品负责人已拍板)
 *
 * > 防抖是为**连续高频事件**设计的,那是滑块的特征 —— 但滑块已改走 ADR-049
 * > 预览通道、根本不写存储。防抖失去了服务对象却还挂在重排上。
 * > 拖拽松手是一次性动作,不需要防抖。**消除那 300ms,而不是抢救它。**
 *
 * ⚠️ 写入仍然**全程经仓储层**(INV-14 / ADR-055)—— 锁定强制点在那里,
 * 绕过去就是假锁。消除的只是**防抖延迟**,不是任何一层检查。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveActiveRule } from '../../domain/resolve-rule.js';
import { coerceSettings } from '../../domain/filter-settings.js';
import { MemoryStorageArea } from '../../storage/memory-storage-area.js';
import {
  SETTINGS_KEY,
  SettingsRepository,
} from '../../storage/settings-repository.js';
import { RuleListView } from '../RuleListView.js';
import { stubTabStatePort } from '../tab-state.js';
import { usePopupSettings } from '../usePopupSettings.js';
import { AsyncStorageArea } from './async-storage-area.js';

afterEach(cleanup);

function PopupUnderTest({ repository }: { repository: SettingsRepository }) {
  const { settings, tabState, loaded, toggleMaster, deleteRule, reorderRules } =
    usePopupSettings({
      repository,
      tabStatePort: stubTabStatePort({
        tabId: 1,
        injectable: true,
        host: 'news.weibo.com',
      }),
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
    />
  );
}

const seeded = (patterns: string[]) => ({
  [SETTINGS_KEY]: {
    version: 1,
    masterEnabled: true,
    rules: patterns.map((pattern) => ({
      pattern,
      mode: 'Grayscale',
      intensity: 100,
    })),
    lockUntil: null,
  },
});

const persisted = (area: { snapshot(): Record<string, unknown> }) =>
  coerceSettings(area.snapshot()[SETTINGS_KEY]);

/** 让挂起的宏任务跑完(仅在未 `destroy()` 时才有效果)。 */
const drain = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * ─────────────────────────────────────────────────────────────────────────
 * 第一组:销毁场景 —— ADR-061 的核心。
 * ─────────────────────────────────────────────────────────────────────────
 */
describe('🔴 ADR-061 / INV-6 · 重排后立即销毁 popup,存储里必须已是新顺序', () => {
  it('拖拽松手 → 文档销毁(任务队列停止)→ 存储已是新顺序,优先级随之改变', async () => {
    const area = new AsyncStorageArea(seeded(['*.com', '*.weibo.*']));
    const repository = new SettingsRepository({ area });
    render(<PopupUnderTest repository={repository} />);

    await waitFor(() => {
      expect(screen.getByTestId('rule-pattern-0').textContent).toBe('*.com');
    });

    // 重排前:首个命中的是 *.com(ADR-008 顺序即优先级)
    expect(
      resolveActiveRule(persisted(area), 'https://news.weibo.com/')?.rule.pattern,
    ).toBe('*.com');

    // ── 拖拽松手 ──
    await act(async () => {
      fireEvent.dragStart(screen.getByTestId('rule-grip-1'));
      fireEvent.dragOver(screen.getByTestId('rule-row-0'));
      fireEvent.drop(screen.getByTestId('rule-row-0'));
      // 给异步 IPC(get → set)两个宏任务走完;文档此刻**仍存活**,
      // 这正是 ADR-061 下「松手即写」应当完成写入的那段时间。
      await drain();
      await drain();
      await drain();
    });

    // 🔴 关键:popup 被销毁 —— 任务队列停止推进。
    // 此后任何「拆除时才发出的异步写」都永远到不了存储(上一轮已被证伪的路线)。
    area.destroy();
    cleanup();
    await drain();
    await drain();

    // 存储中必须已是新顺序,且首个命中者随之改变(INV-6)。
    const after = persisted(area);
    expect(after.rules.map((r) => r.pattern)).toEqual(['*.weibo.*', '*.com']);
    expect(resolveActiveRule(after, 'https://news.weibo.com/')?.index).toBe(0);
    expect(resolveActiveRule(after, 'https://news.weibo.com/')?.rule.pattern).toBe(
      '*.weibo.*',
    );
  });

  it('键盘重排(ArrowUp)后立即销毁,存储同样已是新顺序', async () => {
    const area = new AsyncStorageArea(seeded(['a.com', 'b.com', 'c.com']));
    const repository = new SettingsRepository({ area });
    render(<PopupUnderTest repository={repository} />);
    await waitFor(() => screen.getByTestId('rule-grip-2'));

    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('rule-grip-2'), { key: 'ArrowUp' });
      await drain();
      await drain();
      await drain();
    });

    area.destroy();
    cleanup();
    await drain();
    await drain();

    expect(persisted(area).rules.map((r) => r.pattern)).toEqual([
      'a.com',
      'c.com',
      'b.com',
    ]);
  });

  it('🔴 对照:若写入被推迟到「拆除时再补」,本组断言必然失败(证明断言有牙)', async () => {
    // 这条用例不测产品代码,而是**验证测试替身确实有牙** ——
    // 证明「销毁后才发出的异步写」在本替身下确实到不了存储。
    // 没有它,上面两条用例「绿」也可能只是因为替身太宽松(正是上一轮的教训)。
    const area = new AsyncStorageArea(seeded(['a.com', 'b.com']));
    area.destroy();

    void area.set({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: true,
        rules: [{ pattern: 'b.com', mode: 'Grayscale', intensity: 100 }],
        lockUntil: null,
      },
    });
    await drain();
    await drain();

    // 销毁后发出的写入永远到不了存储 —— 与真机一致。
    expect(persisted(area).rules.map((r) => r.pattern)).toEqual(['a.com', 'b.com']);
    expect(area.setCallCount).toBe(0);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────
 * 第二组:松手后**不经任何延迟**即写入(gate 逐字条款)。
 * ─────────────────────────────────────────────────────────────────────────
 */
describe('🔴 ADR-061 · 松手后不经任何延迟即写入(无防抖、无定时器)', () => {
  it('重排的整条写入路径上不出现任何 setTimeout —— 300ms 窗口已被消除', async () => {
    const area = new MemoryStorageArea(seeded(['a.com', 'b.com']));
    // 🔴 注入一个**会抛错的调度器**:只要重排还走防抖(或任何延迟),
    // 这里就会炸。调度器被调用本身即是「还有延迟窗口」的铁证。
    const scheduler = vi.fn((): number => {
      throw new Error('重排不得经过任何调度延迟(ADR-061)');
    });
    const repository = new SettingsRepository({ area, scheduler });
    render(<PopupUnderTest repository={repository} />);
    await waitFor(() => screen.getByTestId('rule-grip-1'));

    const schedulerCallsBefore = scheduler.mock.calls.length;

    await act(async () => {
      fireEvent.dragStart(screen.getByTestId('rule-grip-1'));
      fireEvent.dragOver(screen.getByTestId('rule-row-0'));
      fireEvent.drop(screen.getByTestId('rule-row-0'));
    });

    await waitFor(() => {
      expect(persisted(area).rules.map((r) => r.pattern)).toEqual(['b.com', 'a.com']);
    });
    expect(scheduler.mock.calls.length).toBe(schedulerCallsBefore);
  });

  it('松手当轮即向存储发出写入请求 —— 不等任何计时器', async () => {
    const area = new AsyncStorageArea(seeded(['a.com', 'b.com']));
    const repository = new SettingsRepository({ area });
    render(<PopupUnderTest repository={repository} />);
    await waitFor(() => screen.getByTestId('rule-grip-1'));

    // 基线:加载阶段已有的写入不计入(ADR-071 后读路径本就零写入)。
    const before = area.setInvocationCount;

    await act(async () => {
      fireEvent.dragStart(screen.getByTestId('rule-grip-1'));
      fireEvent.dragOver(screen.getByTestId('rule-row-0'));
      fireEvent.drop(screen.getByTestId('rule-row-0'));
      // 仓储层必须先读后写(INV-14 / ADR-055:锁定强制点在仓储层,
      // 不可为了「同一轮发出 set」而跳过锁定检查)。
      // 因此这里允许的延迟上限 = 一次 IPC 往返(两个宏任务),
      // **不是** 300ms 防抖窗口 —— 后者需要的宏任务数远不止这些。
      await drain();
      await drain();
    });

    expect(area.setInvocationCount).toBeGreaterThan(before);
    expect(persisted(area).rules.map((r) => r.pattern)).toEqual(['b.com', 'a.com']);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────
 * 第三组:消除防抖后,原有保障不得退化。
 * ─────────────────────────────────────────────────────────────────────────
 */
describe('ADR-061 · 消除防抖后的回归保护', () => {
  it('连续多次重排 → 每一次都落盘,最终顺序正确(不丢中间写、不丢最后一次)', async () => {
    const area = new AsyncStorageArea(seeded(['a.com', 'b.com', 'c.com']));
    const repository = new SettingsRepository({ area });
    render(<PopupUnderTest repository={repository} />);
    await waitFor(() => screen.getByTestId('rule-grip-2'));

    // c 上移两次 → c, a, b
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('rule-grip-2'), { key: 'ArrowUp' });
      await drain();
      await drain();
      await drain();
    });
    await waitFor(() => {
      expect(persisted(area).rules.map((r) => r.pattern)).toEqual([
        'a.com',
        'c.com',
        'b.com',
      ]);
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('rule-grip-1'), { key: 'ArrowUp' });
      await drain();
      await drain();
      await drain();
    });

    await waitFor(() => {
      expect(persisted(area).rules.map((r) => r.pattern)).toEqual([
        'c.com',
        'a.com',
        'b.com',
      ]);
    });

    area.destroy();
    cleanup();
    await drain();
    expect(persisted(area).rules.map((r) => r.pattern)).toEqual([
      'c.com',
      'a.com',
      'b.com',
    ]);
  });

  it('🔒 锁定中的重排仍被仓储层拒绝 —— 消除防抖没有绕开锁定强制点(INV-14 / ADR-055)', async () => {
    const area = new AsyncStorageArea({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: true,
        rules: [
          { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
          { pattern: 'b.com', mode: 'Grayscale', intensity: 100 },
        ],
        lockUntil: Date.now() + 60 * 60 * 1000,
      },
    });
    const repository = new SettingsRepository({ area });
    render(<PopupUnderTest repository={repository} />);
    await waitFor(() => screen.getByTestId('rule-grip-1'));

    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('rule-grip-1'), { key: 'ArrowUp' });
      await drain();
      await drain();
      await drain();
    });

    // 顺序一字未动 —— 锁定强制点仍在仓储层生效。
    expect(persisted(area).rules.map((r) => r.pattern)).toEqual(['a.com', 'b.com']);
    // 且锁定拒绝不弹红色报错条(T3 gate I1)。
    expect(screen.queryByTestId('save-error')).toBeNull();
  });

  it('重排写入失败 → UI 回滚到存储顺序,并弹红色报错条(ADR-046)', async () => {
    const area = new MemoryStorageArea(seeded(['a.com', 'b.com']));
    const repository = new SettingsRepository({ area });
    render(<PopupUnderTest repository={repository} />);
    await waitFor(() => screen.getByTestId('rule-grip-1'));

    area.failSet = () => new Error('QUOTA_BYTES quota exceeded');

    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('rule-grip-1'), { key: 'ArrowUp' });
    });

    await waitFor(() => {
      expect(screen.getByTestId('save-error').textContent).toContain('保存失败:');
    });
    // 存储未变,UI 也必须回到存储顺序 —— 绝不显示一个没存上的顺序。
    expect(persisted(area).rules.map((r) => r.pattern)).toEqual(['a.com', 'b.com']);
    expect(screen.getByTestId('rule-pattern-0').textContent).toBe('a.com');
  });
});
