// @vitest-environment jsdom
/**
 * 列表视图 × 真实仓储层(T3)的接线测试。
 *
 * 这里的「真实」指 `SettingsRepository` 本体 —— 只有 `chrome.storage.local`
 * 换成了 `MemoryStorageArea`。覆盖 T6a gate 中与持久化有关的条款:
 *
 * - **拖拽重排后顺序立即生效并持久化,优先级随之改变**(ADR-023 / INV-6)
 * - 删除规则后该规则从列表消失**且不再生效**
 * - 主开关 OFF → 规则完整保留(INV-8)
 * - 写入被仓储层拒绝 → 红色报错条(ADR-046);`locked` 分类则不弹(T3 gate I1)
 *
 * ⚠️ §8 第 8 条:这**不是** REAL_STACK_GATE。「重启浏览器配置还在」只能在真实
 * Chrome 中验;本文件验的是「UI 的写入确实走到了仓储层并改变了持久化状态」。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
import { installPopupStyles } from './css-harness.js';

/**
 * 把 popup 的接线整体跑起来 —— 与 `entrypoints/popup/App.tsx` 同构。
 *
 * 端口**刻意内联构造**(每次 render 都是新引用):这是调用方最自然的写法,
 * `usePopupSettings` 必须扛得住。该不变量另有专门的回归测试
 * (`use-popup-settings.test.tsx`)。
 */
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

const seeded = (rules: { pattern: string; mode?: string; intensity?: number }[]) => ({
  [SETTINGS_KEY]: {
    version: 1,
    masterEnabled: true,
    rules: rules.map((r) => ({
      pattern: r.pattern,
      mode: r.mode ?? 'Grayscale',
      intensity: r.intensity ?? 100,
    })),
    lockUntil: null,
  },
});

/**
 * 本文件统一用**真实默认调度器**的仓储。
 *
 * 🔴 上一轮这里注入过一个 `immediate` 调度器「免得测试等 300ms」——
 * 那恰恰把 ADR-061 的缺陷替身化掉了:重排在替身下立即落盘,
 * 于是 gate 条款「拖拽重排后顺序立即生效并持久化」被**替身证明为真**,
 * 而真实时序下它是假的。ADR-061 消除防抖后,重排**本就不经调度器**,
 * 这个替身既无必要、又只会继续掩盖问题,故删除。
 */
function makeRepo(area: MemoryStorageArea) {
  return new SettingsRepository({ area });
}

const persisted = (area: MemoryStorageArea) =>
  coerceSettings(area.snapshot()[SETTINGS_KEY]);

beforeEach(() => {
  document.head.innerHTML = '';
  installPopupStyles();
});

afterEach(cleanup);

describe('ADR-008 / INV-6 · 拖拽重排 → 持久化 → 优先级随之改变', () => {
  it('把 *.weibo.* 拖到 *.com 之前,首个命中者从 *.com 变为 *.weibo.*', async () => {
    const area = new MemoryStorageArea(
      seeded([{ pattern: '*.com', mode: 'BlueYellow', intensity: 60 }, { pattern: '*.weibo.*' }]),
    );
    const repository = makeRepo(area);
    render(<PopupUnderTest repository={repository} />);

    await waitFor(() => {
      expect(screen.getByTestId('rule-pattern-0').textContent).toBe('*.com');
    });

    // 重排前:首个命中的是 *.com(索引 0)
    const before = persisted(area);
    expect(resolveActiveRule(before, 'https://news.weibo.com/')?.index).toBe(0);
    expect(resolveActiveRule(before, 'https://news.weibo.com/')?.rule.pattern).toBe('*.com');

    await act(async () => {
      fireEvent.dragStart(screen.getByTestId('rule-grip-1'));
      fireEvent.dragOver(screen.getByTestId('rule-row-0'));
      fireEvent.drop(screen.getByTestId('rule-row-0'));
    });

    // 列表立即按新顺序渲染
    expect(screen.getByTestId('rule-pattern-0').textContent).toBe('*.weibo.*');

    // 且已落盘 —— 顺序即优先级,首个命中者随之改变(INV-6)
    await waitFor(() => {
      expect(persisted(area).rules.map((r) => r.pattern)).toEqual([
        '*.weibo.*',
        '*.com',
      ]);
    });
    const after = persisted(area);
    expect(resolveActiveRule(after, 'https://news.weibo.com/')?.index).toBe(0);
    expect(resolveActiveRule(after, 'https://news.weibo.com/')?.rule.pattern).toBe(
      '*.weibo.*',
    );
  });

  it('键盘重排同样落盘', async () => {
    const area = new MemoryStorageArea(
      seeded([{ pattern: 'a.com' }, { pattern: 'b.com' }, { pattern: 'c.com' }]),
    );
    render(<PopupUnderTest repository={makeRepo(area)} />);
    await waitFor(() => screen.getByTestId('rule-grip-2'));

    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('rule-grip-2'), { key: 'ArrowUp' });
    });

    await waitFor(() => {
      expect(persisted(area).rules.map((r) => r.pattern)).toEqual([
        'a.com',
        'c.com',
        'b.com',
      ]);
    });
  });
});

/**
 * 🔴 **重排后立刻关闭 popup —— 顺序不得丢失**(ADR-008 / ADR-061 / INV-6)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 本组的历史与现状
 *
 * **上一轮**这组用例的前提是「重排走 300ms 防抖」,于是它先断言
 * 「刚松手时存储里还是旧顺序、且有一个挂起的计时器」,再验证拆除路径
 * (`pagehide` / `visibilitychange`)主动 `flush()` 能把它救回来。
 *
 * **那个方案已被 ADR-061 证伪** —— 真机上 popup 销毁时异步存储调用来不及完成,
 * 「拆除时再补写」在原理上救不回来。产品负责人拍板的解法是
 * **消除那 300ms,而不是抢救它**:重排松手即写入。
 *
 * 因此本组的**前提**随之反转(断言的**保障**一字未弱,只增不减):
 * - 旧前提「松手时存储仍是旧顺序 + 有挂起计时器」→ 新前提
 *   **「松手后存储已是新顺序 + 没有任何挂起计时器」**(更强)。
 * - 旧目标「拆除事件后新顺序已落盘」→ **原样保留**,且不再依赖任何拆除事件。
 *
 * ⚠️ 注意:本组用的 `MemoryStorageArea` 在**微任务**就 resolve,
 * 它**抓不到** ADR-061 那个真实缺陷(这正是上一轮的教训)。
 * 真正有牙的销毁场景回归测试在 `reorder-immediate.test.tsx` ——
 * 那里的存储在**后续宏任务**才 resolve,且文档可被真正「销毁」。
 * 本组只负责守住「拆除事件不会反过来破坏已落盘的顺序」。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
describe('ADR-061 / INV-6 · 重排后立刻关闭 popup,新顺序必须已落盘', () => {
  /** 真·延迟调度器:登记回调但**永不执行**。ADR-061 下它应当一次都不被调用。 */
  function deferredScheduler() {
    const queued: (() => void)[] = [];
    return {
      scheduler: (fn: () => void) => {
        queued.push(fn);
        return 0;
      },
      get pendingCount() {
        return queued.length;
      },
    };
  }

  it('拖拽松手即落盘 —— 随后 pagehide 关闭 popup,存储仍是新顺序', async () => {
    const area = new MemoryStorageArea(
      seeded([
        { pattern: '*.com', mode: 'BlueYellow', intensity: 60 },
        { pattern: '*.weibo.*' },
      ]),
    );
    const timers = deferredScheduler();
    const repository = new SettingsRepository({ area, scheduler: timers.scheduler });
    render(<PopupUnderTest repository={repository} />);

    await waitFor(() => {
      expect(screen.getByTestId('rule-pattern-0').textContent).toBe('*.com');
    });

    await act(async () => {
      fireEvent.dragStart(screen.getByTestId('rule-grip-1'));
      fireEvent.dragOver(screen.getByTestId('rule-row-0'));
      fireEvent.drop(screen.getByTestId('rule-row-0'));
    });

    // 乐观草稿已经画出新顺序……
    expect(screen.getByTestId('rule-pattern-0').textContent).toBe('*.weibo.*');
    // 🔴 ……而且**存储里已经是新顺序了**(ADR-061:松手即写入),
    //    并且**没有任何挂起的计时器** —— 那 300ms 的危险窗口已被消除。
    await waitFor(() => {
      expect(persisted(area).rules.map((r) => r.pattern)).toEqual([
        '*.weibo.*',
        '*.com',
      ]);
    });
    expect(timers.pendingCount).toBe(0);

    // popup 被关掉:焦点离开 → 文档拆除。不应改变任何已落盘的事实。
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
      await Promise.resolve();
    });

    // 顺序即优先级,首个命中者随之改变(INV-6)。
    const after = persisted(area);
    expect(after.rules.map((r) => r.pattern)).toEqual(['*.weibo.*', '*.com']);
    expect(resolveActiveRule(after, 'https://news.weibo.com/')?.rule.pattern).toBe(
      '*.weibo.*',
    );
  });

  it('键盘重排同样立即落盘 —— 随后 visibilitychange→hidden 不改变结果', async () => {
    const area = new MemoryStorageArea(
      seeded([{ pattern: 'a.com' }, { pattern: 'b.com' }, { pattern: 'c.com' }]),
    );
    const timers = deferredScheduler();
    const repository = new SettingsRepository({ area, scheduler: timers.scheduler });
    render(<PopupUnderTest repository={repository} />);
    await waitFor(() => screen.getByTestId('rule-grip-2'));

    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('rule-grip-2'), { key: 'ArrowUp' });
    });

    // 🔴 ADR-061:无需任何拆除事件,键盘重排松手即已落盘。
    await waitFor(() => {
      expect(persisted(area).rules.map((r) => r.pattern)).toEqual([
        'a.com',
        'c.com',
        'b.com',
      ]);
    });
    expect(timers.pendingCount).toBe(0);

    const descriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'visibilityState',
    );
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    try {
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
      });

      // 拆除事件不得破坏已落盘的顺序。
      expect(persisted(area).rules.map((r) => r.pattern)).toEqual([
        'a.com',
        'c.com',
        'b.com',
      ]);
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState;
      if (descriptor) Object.defineProperty(Document.prototype, 'visibilityState', descriptor);
    }
  });
});

describe('删除 · 规则从列表消失且不再生效', () => {
  it('删除首个命中者后,该 pattern 不再出现在列表中,也不再被解析为生效规则', async () => {
    const area = new MemoryStorageArea(
      seeded([{ pattern: '*.weibo.*' }, { pattern: 'x.com' }]),
    );
    const repository = makeRepo(area);
    render(<PopupUnderTest repository={repository} />);
    await waitFor(() => screen.getByTestId('rule-delete-0'));

    expect(
      resolveActiveRule(persisted(area), 'https://news.weibo.com/')?.rule.pattern,
    ).toBe('*.weibo.*');

    await act(async () => {
      fireEvent.click(screen.getByTestId('rule-delete-0'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('rule-count').textContent).toBe('1/20');
    });
    expect(screen.queryByText('*.weibo.*')).toBeNull();
    expect(persisted(area).rules.map((r) => r.pattern)).toEqual(['x.com']);
    expect(resolveActiveRule(persisted(area), 'https://news.weibo.com/')).toBeNull();
  });
});

describe('INV-8 · 主开关 OFF 时规则完整保留', () => {
  it('关闭主开关 → 持久化中 masterEnabled=false 且 rules 一条不少', async () => {
    const area = new MemoryStorageArea(
      seeded([{ pattern: 'a.com' }, { pattern: 'b.com' }]),
    );
    render(<PopupUnderTest repository={makeRepo(area)} />);
    await waitFor(() => screen.getByTestId('master-switch'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('master-switch'));
    });

    await waitFor(() => {
      expect(persisted(area).masterEnabled).toBe(false);
    });
    expect(persisted(area).rules.map((r) => r.pattern)).toEqual(['a.com', 'b.com']);
    expect(screen.getByTestId('master-off-notice')).toBeDefined();
    expect(screen.getByTestId('rule-count').textContent).toBe('2/20');
  });
});

describe('ADR-046 · 仓储层写入失败 → 红色报错条', () => {
  it('配额错误 → 报错条含原因与可操作建议', async () => {
    const area = new MemoryStorageArea(seeded([{ pattern: 'a.com' }]));
    render(<PopupUnderTest repository={makeRepo(area)} />);
    await waitFor(() => screen.getByTestId('rule-delete-0'));

    area.failSet = () => new Error('QUOTA_BYTES quota exceeded');

    await act(async () => {
      fireEvent.click(screen.getByTestId('rule-delete-0'));
    });

    await waitFor(() => {
      const banner = screen.getByTestId('save-error');
      expect(banner.textContent).toContain('保存失败:');
      expect(banner.textContent).toContain('请删除几条规则后重试。');
    });
  });

  it('🔴 锁定拒绝(kind=locked)**不**弹红色报错条(T3 gate I1)', async () => {
    const area = new MemoryStorageArea({
      [SETTINGS_KEY]: {
        version: 1,
        masterEnabled: true,
        rules: [{ pattern: 'a.com', mode: 'Grayscale', intensity: 100 }],
        // 锁到很久以后 —— 仓储层会以 kind:'locked' 拒绝一切规则写入(INV-14)
        lockUntil: Date.now() + 60 * 60 * 1000,
      },
    });
    render(<PopupUnderTest repository={makeRepo(area)} />);
    await waitFor(() => screen.getByTestId('rule-delete-0'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('rule-delete-0'));
    });

    // 仓储层确实拒绝了(规则还在),但 UI 不弹红色报错条。
    expect(persisted(area).rules.length).toBe(1);
    expect(screen.queryByTestId('save-error')).toBeNull();
  });
});

describe('INV-4 · 另一处写入 → 本视图立即跟进(onChanged 订阅)', () => {
  it('外部直接改存储,列表随之更新', async () => {
    const area = new MemoryStorageArea(seeded([{ pattern: 'a.com' }]));
    const repository = makeRepo(area);
    render(<PopupUnderTest repository={repository} />);
    await waitFor(() => {
      expect(screen.getByTestId('rule-count').textContent).toBe('1/20');
    });

    await act(async () => {
      await area.set({
        [SETTINGS_KEY]: {
          version: 1,
          masterEnabled: true,
          rules: [
            { pattern: 'a.com', mode: 'Grayscale', intensity: 100 },
            { pattern: 'b.com', mode: 'RedGreen', intensity: 50 },
          ],
          lockUntil: null,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('rule-count').textContent).toBe('2/20');
    });
    expect(screen.getByTestId('rule-pattern-1').textContent).toBe('b.com');
  });
});
