// @vitest-environment jsdom
/**
 * 编辑视图 × 真实仓储层(T3)× 真实双视图状态机的接线测试(T6b)。
 *
 * 这里的「真实」指 `SettingsRepository` 本体 —— 只有 `chrome.storage.local`
 * 换成了 `MemoryStorageArea`。覆盖 §6 T6b gate 中跨层的条款:
 *
 * - **ADR-022** 列表 ⇄ 编辑**双向**导航
 * - **F20** 点保存后规则**持久化并立即生效**(用 `resolveActiveRule` 验生效)
 * - **ADR-021** 已有规则改强度后立即生效
 * - **🔴 ADR-049** 拖动滑块**不写 storage**(直接 spy `storage.set`)
 * - **🔴** 不保存直接返回 → 预览值**未落盘**,页面恢复
 * - **🔴 S13** 一键修复改变顺序 → 优先级确实改变(`resolveActiveRule` 验)
 * - **编辑视图内删除的完整行为**:规则消失 + 发 CLEAR + 回列表
 * - **⚠️ reconcile 触发**:保存后仓储层的 `subscribe` 被通知 ——
 *   那是 `entrypoints/background.ts` 里 reconcile 的第 3/4 触发点(ADR-062)
 * - **🔒 ADR-051** 锁定中列表项点击不进入编辑视图
 * - **🔴 I2** 预览与锁定永不共存
 *
 * ⚠️ §8 第 8 条:这**不是** REAL_STACK_GATE。
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallback, useState } from 'react';

import {
  type FilterRule,
  coerceSettings,
  resolveActiveRule,
} from '../../domain/index.js';
import { PREVIEW_CLEAR, PREVIEW_FILTER } from '../../injection/preview-contract.js';
import { MemoryStorageArea } from '../../storage/memory-storage-area.js';
import {
  SETTINGS_KEY,
  SettingsRepository,
} from '../../storage/settings-repository.js';
import { RuleEditView } from '../RuleEditView.js';
import { RuleListView, type ActionResult } from '../RuleListView.js';
import { stubTabStatePort } from '../tab-state.js';
import { usePopupSettings } from '../usePopupSettings.js';
import { type PreviewSenderPort, createPreviewChannel } from '../preview-port.js';
import { installPopupStyles } from './css-harness.js';

/* ───────────────────────────── 测试装置 ───────────────────────────── */

function previewSpy() {
  const messages: unknown[] = [];
  const channel = createPreviewChannel(() => {
    const port: PreviewSenderPort = {
      postMessage(message) {
        messages.push(message);
      },
      disconnect() {
        /* no-op */
      },
    };
    return port;
  });
  return {
    channel,
    messages,
    filters: () =>
      messages.filter((m) => (m as { type?: string }).type === PREVIEW_FILTER),
    clears: () =>
      messages.filter((m) => (m as { type?: string }).type === PREVIEW_CLEAR),
  };
}

type Preview = ReturnType<typeof previewSpy>;

/**
 * popup 的完整接线 —— 与 `entrypoints/popup/App.tsx` **同构**的双视图状态机。
 *
 * 刻意不直接渲染 `App.tsx`:它在模块级构造 `chromeLocalStorageArea()`
 * (非扩展环境会 throw),测它需要伪造整个 `chrome` 全局。
 * 这里复制的是**视图切换与回调分派的那段逻辑**,而数据层用的是真实仓储。
 */
function PopupUnderTest({
  repository,
  preview,
  locked = false,
}: {
  readonly repository: SettingsRepository;
  readonly preview: Preview;
  readonly locked?: boolean;
}) {
  const {
    settings,
    tabState,
    loaded,
    toggleMaster,
    deleteRule,
    reorderRules,
    saveRule,
    moveRuleToTop,
  } = usePopupSettings({
    repository,
    tabStatePort: stubTabStatePort({
      tabId: 1,
      injectable: true,
      host: 'news.weibo.com',
    }),
  });

  const [view, setView] = useState<{ kind: 'list' } | { kind: 'edit'; index: number | null }>(
    { kind: 'list' },
  );

  const editingIndex = view.kind === 'edit' ? view.index : null;

  const handleSave = useCallback(
    (rule: FilterRule): Promise<ActionResult> => saveRule(editingIndex, rule),
    [saveRule, editingIndex],
  );

  if (view.kind === 'edit') {
    return (
      <RuleEditView
        settings={settings}
        tabState={loaded ? tabState : null}
        editingIndex={view.index}
        previewChannel={preview.channel}
        onSave={handleSave}
        onDelete={deleteRule}
        onMoveToTop={moveRuleToTop}
        onBack={() => setView({ kind: 'list' })}
        /* 🔴 一键修复改变位置 → 视图状态跟过去(§1「身份 = 位置 + pattern」)。 */
        onReindex={(nextIndex) => setView({ kind: 'edit', index: nextIndex })}
        locked={locked}
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
      onAddRule={() => {
        if (locked) return;
        setView({ kind: 'edit', index: null });
      }}
      onOpenRule={(index) => {
        // 🔒 ADR-051:锁定中列表项点击不进入编辑视图。
        if (locked) return;
        setView({ kind: 'edit', index });
      }}
      locked={locked}
    />
  );
}

const seeded = (
  rules: readonly { pattern: string; mode?: string; intensity?: number }[],
  masterEnabled = true,
) => ({
  [SETTINGS_KEY]: {
    version: 1,
    masterEnabled,
    rules: rules.map((r) => ({
      pattern: r.pattern,
      mode: r.mode ?? 'Grayscale',
      intensity: r.intensity ?? 100,
    })),
    lockUntil: null,
    maxSeenTime: 0,
  },
});

/** 直接读存储 —— 「是否落盘」的唯一判据(INV-4:真相在存储)。 */
async function persisted(area: MemoryStorageArea) {
  const raw = await area.get(SETTINGS_KEY);
  return coerceSettings(raw[SETTINGS_KEY]);
}

beforeEach(() => {
  document.head.innerHTML = '';
  installPopupStyles();
});

afterEach(cleanup);

/* ═══════════════════ ADR-022 双向导航 ═══════════════════ */

describe('ADR-022 · 列表 ⇄ 编辑双向导航', () => {
  it('点规则行进编辑视图,点返回回到列表视图', async () => {
    const area = new MemoryStorageArea(seeded([{ pattern: '*.weibo.*' }]));
    const repository = new SettingsRepository({ area });
    const preview = previewSpy();
    render(<PopupUnderTest repository={repository} preview={preview} />);

    await waitFor(() => {
      expect(screen.getByTestId('rule-row-0')).toBeDefined();
    });
    expect(screen.getByTestId('popup').dataset.view).toBe('list');

    fireEvent.click(screen.getByTestId('rule-open-0'));
    expect(screen.getByTestId('popup').dataset.view).toBe('edit');
    expect((screen.getByTestId('pattern-input') as HTMLInputElement).value).toBe(
      '*.weibo.*',
    );

    fireEvent.click(screen.getByTestId('back-button'));
    expect(screen.getByTestId('popup').dataset.view).toBe('list');
  });

  it('点「+ 添加规则」进新建视图:输入框为空、Grayscale @ 100%(ADR-020)', async () => {
    const area = new MemoryStorageArea(seeded([]));
    const repository = new SettingsRepository({ area });
    const preview = previewSpy();
    render(<PopupUnderTest repository={repository} preview={preview} />);

    await waitFor(() => {
      expect(screen.getByTestId('add-rule')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('add-rule'));

    expect(screen.getByTestId('popup').dataset.view).toBe('edit');
    expect((screen.getByTestId('pattern-input') as HTMLInputElement).value).toBe('');
    expect(
      (screen.getByTestId('filter-radio-Grayscale') as HTMLInputElement).checked,
    ).toBe(true);
    expect((screen.getByTestId('intensity-slider') as HTMLInputElement).value).toBe(
      '100',
    );
  });

  it('🔴 ADR-022:两视图互斥 —— 编辑视图里不存在列表的主开关与添加按钮', async () => {
    const area = new MemoryStorageArea(seeded([{ pattern: '*.weibo.*' }]));
    const repository = new SettingsRepository({ area });
    const preview = previewSpy();
    render(<PopupUnderTest repository={repository} preview={preview} />);
    await waitFor(() => {
      expect(screen.getByTestId('rule-row-0')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('rule-open-0'));

    expect(screen.queryByTestId('master-switch')).toBeNull();
    expect(screen.queryByTestId('add-rule')).toBeNull();
    expect(screen.queryByTestId('rule-list')).toBeNull();
  });
});

/* ═══════════════════ F20 保存的语义 ═══════════════════ */

describe('🔴 F20 · 点保存后规则持久化并立即生效', () => {
  it('新建规则 → 落盘 → resolveActiveRule 在匹配的 URL 上命中它', async () => {
    const area = new MemoryStorageArea(seeded([]));
    const repository = new SettingsRepository({ area });
    const preview = previewSpy();
    render(<PopupUnderTest repository={repository} preview={preview} />);

    await waitFor(() => {
      expect(screen.getByTestId('add-rule')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('add-rule'));

    fireEvent.change(screen.getByTestId('pattern-input'), {
      target: { value: '*.weibo.*' },
    });
    fireEvent.click(screen.getByTestId('filter-radio-BlueYellow'));
    fireEvent.change(screen.getByTestId('intensity-slider'), {
      target: { value: '60' },
    });
    fireEvent.click(screen.getByTestId('save-button'));

    // 保存成功 → 回列表视图。
    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.view).toBe('list');
    });

    const stored = await persisted(area);
    expect(stored.rules).toEqual([
      { pattern: '*.weibo.*', mode: 'BlueYellow', intensity: 60 },
    ]);

    // 「立即生效」= 规则解析在匹配的 URL 上确实命中它(INV-6 的同一判据)。
    const resolved = resolveActiveRule(stored, 'https://news.weibo.com/feed');
    expect(resolved?.index).toBe(0);
    expect(resolved?.rule.mode).toBe('BlueYellow');
    expect(resolved?.rule.intensity).toBe(60);
  });

  it('ADR-021:编辑既有规则的强度 → 落盘为新强度', async () => {
    const area = new MemoryStorageArea(
      seeded([{ pattern: '*.weibo.*', intensity: 100 }]),
    );
    const repository = new SettingsRepository({ area });
    const preview = previewSpy();
    render(<PopupUnderTest repository={repository} preview={preview} />);

    await waitFor(() => {
      expect(screen.getByTestId('rule-row-0')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('rule-open-0'));
    fireEvent.change(screen.getByTestId('intensity-slider'), {
      target: { value: '35' },
    });
    fireEvent.click(screen.getByTestId('save-button'));

    await waitFor(async () => {
      const stored = await persisted(area);
      expect(stored.rules[0]?.intensity).toBe(35);
    });
  });

  it('⚠️ 保存会通知仓储层订阅者 —— reconcile 的触发点(ADR-062)', async () => {
    const area = new MemoryStorageArea(seeded([]));
    const repository = new SettingsRepository({ area });
    const preview = previewSpy();

    /*
     * `entrypoints/background.ts` 里 reconcile 的第 3/4 触发点正是
     * `repo.subscribe(() => void reconciler.request('storage-changed'))`。
     * 这里用同一个订阅口做 spy:订阅被通知 ⇒ 真实栈里 reconcile 会被请求,
     * 新规则对**下一次导航**生效(ADR-062 的声明式注册得到更新)。
     *
     * 📌 本断言刻意**不**去 mock reconcile 本体 —— 那是 T4a 的交付物,
     *    已有自己的门禁。T6b 要保证的是「保存这个动作确实推动了那条链路」。
     */
    const reconcileRequests: number[] = [];
    repository.subscribe(() => {
      reconcileRequests.push(Date.now());
    });

    render(<PopupUnderTest repository={repository} preview={preview} />);
    await waitFor(() => {
      expect(screen.getByTestId('add-rule')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('add-rule'));
    fireEvent.change(screen.getByTestId('pattern-input'), {
      target: { value: 'x.com' },
    });
    fireEvent.click(screen.getByTestId('save-button'));

    await waitFor(() => {
      expect(reconcileRequests.length).toBeGreaterThan(0);
    });
  });

  it('空 pattern 时保存禁用 → 不产生任何写入', async () => {
    const area = new MemoryStorageArea(seeded([]));
    const repository = new SettingsRepository({ area });
    const preview = previewSpy();
    const setSpy = vi.spyOn(area, 'set');
    render(<PopupUnderTest repository={repository} preview={preview} />);

    await waitFor(() => {
      expect(screen.getByTestId('add-rule')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('add-rule'));
    setSpy.mockClear();
    fireEvent.click(screen.getByTestId('save-button'));

    await Promise.resolve();
    expect(setSpy).not.toHaveBeenCalled();
    expect((await persisted(area)).rules).toHaveLength(0);
  });
});

/* ═══════════ 🔴 ADR-049 预览不写存储 / 不保存返回不落盘 ═══════════ */

describe('🔴 ADR-049 · 预览不写 storage', () => {
  it('拖动滑块期间 `storage.set` 一次都没被调用(spy 断言)', async () => {
    const area = new MemoryStorageArea(
      seeded([{ pattern: '*.weibo.*', intensity: 100 }]),
    );
    const repository = new SettingsRepository({ area });
    const preview = previewSpy();
    render(<PopupUnderTest repository={repository} preview={preview} />);

    await waitFor(() => {
      expect(screen.getByTestId('rule-row-0')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('rule-open-0'));

    // 读路径可能回写 maxSeenTime(ADR-059),故在进入编辑视图后才开始计数。
    const setSpy = vi.spyOn(area, 'set');

    const slider = screen.getByTestId('intensity-slider');
    for (const v of ['90', '80', '70', '60', '50']) {
      fireEvent.change(slider, { target: { value: v } });
    }
    fireEvent.click(screen.getByTestId('filter-radio-RedGreen'));

    await Promise.resolve();
    expect(setSpy).not.toHaveBeenCalled();
    // 预览确实发出去了 —— 否则「没写存储」是因为什么都没做。
    expect(preview.filters()).toHaveLength(6);
  });

  it('🔴 不保存直接返回 → 预览值未落盘,且发了 PREVIEW_CLEAR(页面恢复)', async () => {
    const area = new MemoryStorageArea(
      seeded([{ pattern: '*.weibo.*', intensity: 100 }]),
    );
    const repository = new SettingsRepository({ area });
    const preview = previewSpy();
    render(<PopupUnderTest repository={repository} preview={preview} />);

    await waitFor(() => {
      expect(screen.getByTestId('rule-row-0')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('rule-open-0'));
    fireEvent.change(screen.getByTestId('intensity-slider'), {
      target: { value: '20' },
    });
    fireEvent.click(screen.getByTestId('back-button'));

    expect(preview.clears()).toHaveLength(1);
    expect(screen.getByTestId('popup').dataset.view).toBe('list');
    // 存储仍是原值 —— 预览值绝不落盘。
    expect((await persisted(area)).rules[0]?.intensity).toBe(100);
  });
});

/* ═══════════════════ 🔴 S13 一键修复的下游效果 ═══════════════════ */

describe('🔴 S13 · 一键修复改变顺序 → 优先级确实改变', () => {
  it('点「把这条移到最上面 ↑」后落盘顺序改变,resolveActiveRule 命中本条', async () => {
    const area = new MemoryStorageArea(
      seeded([
        { pattern: '*.weibo.*', mode: 'Grayscale' },
        { pattern: '*.com', mode: 'BlueYellow', intensity: 60 },
      ]),
    );
    const repository = new SettingsRepository({ area });
    const preview = previewSpy();
    render(<PopupUnderTest repository={repository} preview={preview} />);

    await waitFor(() => {
      expect(screen.getByTestId('rule-row-1')).toBeDefined();
    });
    // 当前页 news.weibo.com 命中 0 号,1 号被遮蔽。
    fireEvent.click(screen.getByTestId('rule-open-1'));
    expect(screen.getByTestId('status-line').dataset.kind).toBe('shadowed');

    fireEvent.click(screen.getByTestId('move-to-top'));

    await waitFor(async () => {
      const stored = await persisted(area);
      expect(stored.rules[0]?.pattern).toBe('*.com');
      expect(stored.rules[1]?.pattern).toBe('*.weibo.*');
    });

    // 优先级确实改变:现在 `*.com` 先命中(ADR-008 首个命中胜)。
    const stored = await persisted(area);
    const resolved = resolveActiveRule(stored, 'https://news.weibo.com/');
    expect(resolved?.rule.pattern).toBe('*.com');
    expect(resolved?.rule.mode).toBe('BlueYellow');

    // 并且**当前页面渲染也立即变成该规则的滤镜** —— 这是本按钮的全部意义。
    expect(preview.filters().at(-1)).toEqual({
      type: PREVIEW_FILTER,
      mode: 'BlueYellow',
      intensity: 60,
    });
  });
});

/* ═══ 🔴 回归:一键修复后索引必须跟过去(真实栈门禁抓到的缺陷) ═══ */

describe('🔴🔴 回归 · 一键修复后 editingIndex 跟随规则的新位置', () => {
  /*
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 这条用例是 **T6b 真实栈门禁抓到的一个真实缺陷**的防回归锚点。
   *
   * §1:「`FilterRule` 的身份 = 它在 `rules` 中的位置 + `pattern`」。
   * 一键修复(`onMoveToTop`)**改变位置** → 改变身份。
   * 首版的 `editingIndex` 不跟随,于是:
   *
   *   编辑被遮蔽的 1 号 → 点一键修复(存储变成 `[本条, 原 0 号]`)
   *   → `editingIndex` 仍是 1 → 点删除 → **删掉了用户没在编辑的那条**。
   *
   * 这是静默的数据丢失:用户看着自己那条规则按下删除,消失的是别人。
   * 「保存」同样受影响(`updateRule(1, …)` 会覆盖另一条规则)。
   *
   * ⚠️ 本用例的断言**不得放宽** —— 它守的不是实现细节,
   *    而是「删除删掉的是用户正在看的那条」这件事本身。
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  async function movedToTop() {
    const area = new MemoryStorageArea(
      seeded([
        { pattern: '*.weibo.*', mode: 'Grayscale' },
        { pattern: '*.com', mode: 'BlueYellow', intensity: 60 },
      ]),
    );
    const repository = new SettingsRepository({ area });
    const preview = previewSpy();
    render(<PopupUnderTest repository={repository} preview={preview} />);

    await waitFor(() => {
      expect(screen.getByTestId('rule-row-1')).toBeDefined();
    });
    // 编辑 1 号(被 0 号遮蔽)。
    fireEvent.click(screen.getByTestId('rule-open-1'));
    expect(screen.getByTestId('status-line').dataset.kind).toBe('shadowed');

    fireEvent.click(screen.getByTestId('move-to-top'));
    await waitFor(async () => {
      expect((await persisted(area)).rules[0]?.pattern).toBe('*.com');
    });
    return { area, preview };
  }

  it('一键修复后仍在编辑**同一条**规则(pattern 输入框内容不变)', async () => {
    await movedToTop();
    // 编辑视图里显示的仍是用户那条规则,而不是跳到了另一条。
    expect((screen.getByTestId('pattern-input') as HTMLInputElement).value).toBe(
      '*.com',
    );
    // 它现在是 0 号,已不再被遮蔽 → 状态行变成「生效中」。
    await waitFor(() => {
      expect(screen.getByTestId('status-line').dataset.kind).toBe('live');
    });
    expect(screen.queryByTestId('shadow-box')).toBeNull();
  });

  it('🔴 一键修复后点「删除」,删掉的是**用户正在编辑的那条**', async () => {
    const { area } = await movedToTop();

    fireEvent.click(screen.getByTestId('delete-button'));
    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.view).toBe('list');
    });

    const stored = await persisted(area);
    // 剩下的必须是**另一条**(`*.weibo.*`),不是用户编辑的 `*.com`。
    expect(stored.rules.map((r) => r.pattern)).toEqual(['*.weibo.*']);
  });

  it('🔴 一键修复后点「保存」,改的是**用户正在编辑的那条**', async () => {
    const { area } = await movedToTop();

    fireEvent.change(screen.getByTestId('intensity-slider'), {
      target: { value: '15' },
    });
    fireEvent.click(screen.getByTestId('save-button'));

    await waitFor(async () => {
      expect((await persisted(area)).rules[0]?.intensity).toBe(15);
    });
    const stored = await persisted(area);
    // 另一条一字未动。
    expect(stored.rules[1]).toEqual({
      pattern: '*.weibo.*',
      mode: 'Grayscale',
      intensity: 100,
    });
  });
});

/* ═══════════════════ 编辑视图内删除的完整行为 ═══════════════════ */

describe('编辑视图内「删除」的完整行为', () => {
  it('删除 → 发 PREVIEW_CLEAR → 回列表 → 该规则已从列表消失且不再生效', async () => {
    const area = new MemoryStorageArea(
      seeded([{ pattern: '*.weibo.*' }, { pattern: 'x.com' }]),
    );
    const repository = new SettingsRepository({ area });
    const preview = previewSpy();
    render(<PopupUnderTest repository={repository} preview={preview} />);

    await waitFor(() => {
      expect(screen.getByTestId('rule-row-0')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('rule-open-0'));
    fireEvent.change(screen.getByTestId('intensity-slider'), {
      target: { value: '70' },
    });
    fireEvent.click(screen.getByTestId('delete-button'));

    await waitFor(() => {
      expect(screen.getByTestId('popup').dataset.view).toBe('list');
    });
    expect(preview.clears()).toHaveLength(1);

    const stored = await persisted(area);
    expect(stored.rules.map((r) => r.pattern)).toEqual(['x.com']);
    // 不再生效:当前页已无规则命中。
    expect(resolveActiveRule(stored, 'https://news.weibo.com/')).toBeNull();
    // 列表里也没有它了。
    expect(screen.queryByText('*.weibo.*')).toBeNull();
  });
});

/* ═══════════════════ 🔒 ADR-051 / I2 ═══════════════════ */

describe('🔒 ADR-051 / I2 · 锁定与预览', () => {
  it('锁定中点列表项不进入编辑视图(gate 允许的两种实现之一)', async () => {
    const area = new MemoryStorageArea(seeded([{ pattern: '*.weibo.*' }]));
    const repository = new SettingsRepository({ area });
    const preview = previewSpy();
    render(<PopupUnderTest repository={repository} preview={preview} locked />);

    await waitFor(() => {
      expect(screen.getByTestId('rule-row-0')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('rule-open-0'));
    expect(screen.getByTestId('popup').dataset.view).toBe('list');
  });

  it('🔴 I2:锁定中无论如何都不会有活动预览 —— 一条 PREVIEW_FILTER 都没发过', async () => {
    const area = new MemoryStorageArea(seeded([{ pattern: '*.weibo.*' }]));
    const repository = new SettingsRepository({ area });
    const preview = previewSpy();
    render(<PopupUnderTest repository={repository} preview={preview} locked />);

    await waitFor(() => {
      expect(screen.getByTestId('rule-row-0')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('rule-open-0'));
    fireEvent.click(screen.getByTestId('add-rule'));
    expect(preview.messages).toHaveLength(0);
  });
});
