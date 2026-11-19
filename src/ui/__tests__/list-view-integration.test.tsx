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
    maxSeenTime: 0,
  },
});

/** 防抖落盘用的假调度器:立即执行,免得测试等 300ms。 */
const immediate = (fn: () => void) => {
  fn();
  return 0;
};

function makeRepo(area: MemoryStorageArea) {
  return new SettingsRepository({ area, scheduler: immediate });
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
        maxSeenTime: 0,
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
          maxSeenTime: 0,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('rule-count').textContent).toBe('2/20');
    });
    expect(screen.getByTestId('rule-pattern-1').textContent).toBe('b.com');
  });
});
