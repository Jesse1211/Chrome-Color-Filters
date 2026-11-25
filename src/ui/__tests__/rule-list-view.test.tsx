// @vitest-environment jsdom
/**
 * T6a gate —— 列表视图的行为与文案(§5.3 / §5.4)。
 *
 * 权威:**行为与文案以 §5.3 / §5.4 和 ADR 为准**(ADR-042),
 * 已知的七处与设计稿的冲突见 §6.1,照 ADR 实现。
 *
 * ⚠️ §8 第 8 条:jsdom 下的绿灯**不构成** REAL_STACK_GATE 的通过。
 * 本文件断言的是元素存在性、文案、禁用状态与回调契约 —— 这些与浏览器无关。
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type FilterRule } from '../../domain/filter-rule.js';
import {
  type FilterSettings,
  MAX_RULES,
  defaultSettings,
} from '../../domain/filter-settings.js';
import {
  capacityError,
  classifyStorageError,
  invalidInputError,
  lockedError,
} from '../../storage/errors.js';
import { RuleListView, type ActionResult } from '../RuleListView.js';
import { type TabState } from '../tab-state.js';
import {
  CAPACITY_NOTICE,
  EMPTY_HINT,
  EMPTY_TITLE,
  LOCKED_DISABLED_REASON,
  MASTER_OFF_DISABLED_REASON,
  NOT_INJECTABLE_MESSAGE,
  PRIORITY_HINT,
} from '../strings.js';
import { LockEntryRow } from '../LockEntryRow.js';
import { LIVE_LABEL, SHADOWED_LABEL } from '../components/RuleRow.js';
import { installPopupStyles } from './css-harness.js';

const rule = (
  pattern: string,
  mode: FilterRule['mode'] = 'Grayscale',
  intensity = 100,
): FilterRule => ({ pattern, mode, intensity });

const settingsWith = (overrides: Partial<FilterSettings> = {}): FilterSettings => ({
  ...defaultSettings(),
  ...overrides,
});

const injectableTab = (overrides: Partial<TabState> = {}): TabState => ({
  tabId: 7,
  injectable: true,
  host: 'weibo.com',
  activeRuleIndex: null,
  shadowedRuleIndexes: [],
  ...overrides,
});

const ok: ActionResult = { ok: true };

interface Harness {
  readonly settings?: FilterSettings;
  readonly tabState?: TabState | null;
  readonly onToggleMaster?: (next: boolean) => ActionResult;
  readonly onDeleteRule?: (index: number) => ActionResult;
  readonly onReorderRules?: (rules: readonly FilterRule[]) => ActionResult;
  readonly onAddRule?: () => void;
  readonly onOpenRule?: (index: number) => void;
  readonly locked?: boolean;
  /**
   * 🔴 ADR-076:是否挂上真实的 `LockEntryRow` 插槽(与 `App.tsx` 同构接线)。
   *
   * 默认 `false` —— T6a 的既有断言与锁定入口无关,不该因为多了一个
   * 按钮而改变它们的 DOM 期望。需要验 ADR-076 的那几条显式打开。
   */
  readonly withLockEntry?: boolean;
  readonly onOpenLock?: () => void;
}

function renderView(h: Harness = {}) {
  const props = {
    settings: h.settings ?? settingsWith({ rules: [rule('*.weibo.*')] }),
    tabState: h.tabState === undefined ? injectableTab() : h.tabState,
    onToggleMaster: h.onToggleMaster ?? (() => ok),
    onDeleteRule: h.onDeleteRule ?? (() => ok),
    onReorderRules: h.onReorderRules ?? (() => ok),
    onAddRule: h.onAddRule ?? (() => undefined),
    onOpenRule: h.onOpenRule ?? (() => undefined),
    ...(h.locked === undefined ? {} : { locked: h.locked }),
    /*
      🔴 与 `App.tsx` **逐字同构**的插槽接线(ADR-076):
      禁用状态来自 `RuleListView` 自己算出的 `lockEntryDisabled`,
      替身不复算 —— 否则测的是替身的判据,不是产品的。
    */
    ...(h.withLockEntry
      ? {
          lockEntry: ({
            disabled,
            reason,
          }: {
            disabled: boolean;
            reason?: string;
          }) => (
            <LockEntryRow
              onOpen={h.onOpenLock ?? (() => undefined)}
              disabled={disabled}
              disabledReason={reason}
            />
          ),
        }
      : {}),
  };
  return render(<RuleListView {...props} />);
}

beforeEach(() => {
  document.head.innerHTML = '';
  installPopupStyles();
});

afterEach(cleanup);

// ─────────────────────────── §5.3 列表视图结构 ───────────────────────────

describe('§5.3 · 列表视图结构', () => {
  it('ADR-031:列表顶部常驻优先级提示条,文案与 §5.3 一致', () => {
    renderView();
    const hint = screen.getByTestId('priority-hint');
    expect(hint.textContent).toBe(PRIORITY_HINT);
    expect(hint.textContent).toBe('↓ 从上往下匹配,首个命中的规则生效');
  });

  it('提示条常驻在列表**之前**(DOM 顺序即视觉顺序)', () => {
    renderView();
    const hint = screen.getByTestId('priority-hint');
    const list = screen.getByTestId('rule-list');
    expect(
      hint.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('主开关固定在顶部 header 内(§5.3)', () => {
    renderView();
    const head = document.querySelector('.popup__head');
    expect(head).not.toBeNull();
    expect(within(head as HTMLElement).getByTestId('master-switch')).toBeDefined();
  });

  it('ADR-033:网址模式用等宽字体渲染', () => {
    renderView({ settings: settingsWith({ rules: [rule('*.weibo.*')] }) });
    const pattern = screen.getByTestId('rule-pattern-0');
    expect(pattern.textContent).toBe('*.weibo.*');
    const family = getComputedStyle(pattern).fontFamily;
    // 计算值是 var(--font-mono);token 的实际栈在 design-tokens.test.ts 中断言。
    expect(family).toContain('--font-mono');
  });

  it('底部显示 N/20 计数(§5.3)', () => {
    renderView({
      settings: settingsWith({ rules: [rule('a.com'), rule('b.com'), rule('c.com')] }),
    });
    expect(screen.getByTestId('rule-count').textContent).toBe('3/20');
  });

  it('每行都带删除入口 ✕(§5.3:点 ✕ → 直接删除)', () => {
    renderView({ settings: settingsWith({ rules: [rule('a.com'), rule('b.com')] }) });
    expect(screen.getByTestId('rule-delete-0').textContent).toBe('✕');
    expect(screen.getByTestId('rule-delete-1').textContent).toBe('✕');
  });
});

// ─────────────────────────── ADR-030 色块 + 名称 ───────────────────────────

/*
 * 🔴 **本 describe 必须继续通过。**
 *
 * ADR-030 的原硬性约束(「红绿/绿红色块对色盲用户无法分辨,故色块必须
 * 始终与文字名称并列」)随 ADR-075 失去了原始理由,DESIGN.md §5.2 把它
 * 记为「已失效但保留于此备用」,并明确「不要删除色块的文字标签」。
 *
 * 故这里**不是**删掉断言,而是把它从「四个模式各自成立」缩减为
 * 「现存的每个模式都成立 + 列表里不存在裸色块」——
 * 后半条是真正防回归的那条,且与模式数量无关。
 */
describe('🔴 ADR-030(保留部分)· 色块绝不单独出现,必须与文字名称并列', () => {
  it.each([['Grayscale', '灰阶']] as const)(
    '%s 行同时出现色块与名称「%s」',
    (mode, name) => {
      renderView({ settings: settingsWith({ rules: [rule('a.com', mode)] }) });
      const pair = screen.getByTestId('swatch-pair');
      expect(within(pair).getByTestId('swatch')).toBeDefined();
      expect(within(pair).getByTestId('swatch-name').textContent).toBe(name);
    },
  );

  it('🔴 §6.1 冲突第 3 条:整个列表中不存在「有色块却无名称」的位置', () => {
    // 多条规则用**强度**区分(ADR-075 后唯一的区分维度),
    // 以确保这条断言仍然扫过多行、而不是退化成单行。
    renderView({
      settings: settingsWith({
        rules: [
          rule('a.com', 'Grayscale', 100),
          rule('b.com', 'Grayscale', 60),
          rule('c.com', 'Grayscale', 30),
          rule('d.com', 'Grayscale', 0),
        ],
      }),
    });
    const swatches = screen.getAllByTestId('swatch');
    expect(swatches.length).toBe(4);
    for (const swatch of swatches) {
      const pair = swatch.closest('[data-testid="swatch-pair"]');
      expect(pair, '色块不在 swatch-pair 容器内 —— 可能被单独渲染了').not.toBeNull();
      const name = within(pair as HTMLElement).getByTestId('swatch-name');
      expect(name.textContent?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────── ADR-032 被遮蔽行 ───────────────────────────

describe('🔴 ADR-032 / §6.1 冲突第 1、2 条 · 被遮蔽行', () => {
  const shadowedSettings = settingsWith({
    rules: [rule('*.weibo.*'), rule('*.com', 'Grayscale', 60), rule('x.com')],
  });

  it('整行淡化(opacity < 1)', () => {
    renderView({
      settings: shadowedSettings,
      tabState: injectableTab({ activeRuleIndex: 0, shadowedRuleIndexes: [1] }),
    });
    const row = screen.getByTestId('rule-row-1');
    expect(row.getAttribute('data-shadowed')).toBe('true');
    expect(Number.parseFloat(getComputedStyle(row).opacity)).toBeLessThan(1);
  });

  it('右侧标注「此页未生效」—— 不是「被遮蔽」(§6.1 冲突第 2 条)', () => {
    renderView({
      settings: shadowedSettings,
      tabState: injectableTab({ activeRuleIndex: 0, shadowedRuleIndexes: [1] }),
    });
    expect(screen.getByTestId('rule-shadowed-1').textContent).toBe(SHADOWED_LABEL);
    expect(screen.getByTestId('rule-shadowed-1').textContent).toBe('此页未生效');
    expect(screen.queryByText('被遮蔽')).toBeNull();
  });

  it('🔴 不得出现删除线 —— 行内任何元素的 text-decoration 都不含 line-through', () => {
    renderView({
      settings: shadowedSettings,
      tabState: injectableTab({ activeRuleIndex: 0, shadowedRuleIndexes: [1] }),
    });
    const row = screen.getByTestId('rule-row-1');
    for (const el of [row, ...Array.from(row.querySelectorAll('*'))]) {
      const cs = getComputedStyle(el);
      expect(cs.textDecoration ?? '').not.toContain('line-through');
      expect(cs.textDecorationLine ?? '').not.toContain('line-through');
    }
  });

  it('未被遮蔽的行不淡化、不带标注', () => {
    renderView({
      settings: shadowedSettings,
      tabState: injectableTab({ activeRuleIndex: 0, shadowedRuleIndexes: [1] }),
    });
    expect(screen.getByTestId('rule-row-2').getAttribute('data-shadowed')).toBe('false');
    expect(screen.queryByTestId('rule-shadowed-2')).toBeNull();
  });

  it('§5.3 生效行:当前页有规则生效时显示绿色「生效」标记', () => {
    renderView({
      settings: shadowedSettings,
      tabState: injectableTab({ activeRuleIndex: 0, shadowedRuleIndexes: [1] }),
    });
    expect(screen.getByTestId('rule-live-0').textContent).toBe(LIVE_LABEL);
    expect(screen.queryByTestId('rule-live-1')).toBeNull();
  });

  it('ADR-044:遮蔽与生效一律来自 TabState —— 视图不自己算匹配', () => {
    // 故意给一个与 pattern 「不符直觉」的 TabState:视图必须照单全收。
    renderView({
      settings: shadowedSettings,
      tabState: injectableTab({ host: 'x.com', activeRuleIndex: 2, shadowedRuleIndexes: [0] }),
    });
    expect(screen.getByTestId('rule-live-2')).toBeDefined();
    expect(screen.getByTestId('rule-shadowed-0')).toBeDefined();
    expect(screen.queryByTestId('rule-live-0')).toBeNull();
  });
});

// ─────────────────────────── ADR-023 拖拽 ───────────────────────────

describe('🔴 ADR-023 / §6.1 冲突第 6 条 · 拖柄与行点击分离', () => {
  it('点击 ⠿ 拖拽手柄**不得**打开编辑视图', () => {
    const onOpenRule = vi.fn();
    renderView({
      settings: settingsWith({ rules: [rule('a.com'), rule('b.com')] }),
      onOpenRule,
    });
    fireEvent.click(screen.getByTestId('rule-grip-0'));
    expect(onOpenRule).not.toHaveBeenCalled();
  });

  it('手柄在 DOM 上不是「打开」按钮的后代 —— 结构上不可能冒泡过去', () => {
    renderView({ settings: settingsWith({ rules: [rule('a.com')] }) });
    const grip = screen.getByTestId('rule-grip-0');
    const open = screen.getByTestId('rule-open-0');
    expect(open.contains(grip)).toBe(false);
  });

  it('点击行主体 → 打开编辑视图(§5.3:点整行 → 进编辑视图)', () => {
    const onOpenRule = vi.fn();
    renderView({
      settings: settingsWith({ rules: [rule('a.com'), rule('b.com')] }),
      onOpenRule,
    });
    fireEvent.click(screen.getByTestId('rule-open-1'));
    expect(onOpenRule).toHaveBeenCalledWith(1);
  });

  it('点击 ✕ 不打开编辑视图,只删除(手柄/删除与展开三者分离)', () => {
    const onOpenRule = vi.fn();
    const onDeleteRule = vi.fn(() => ok);
    renderView({
      settings: settingsWith({ rules: [rule('a.com')] }),
      onOpenRule,
      onDeleteRule,
    });
    fireEvent.click(screen.getByTestId('rule-delete-0'));
    expect(onDeleteRule).toHaveBeenCalledWith(0);
    expect(onOpenRule).not.toHaveBeenCalled();
  });
});

describe('ADR-008 / INV-6 · 拖拽重排后顺序立即生效并持久化', () => {
  const three = settingsWith({
    rules: [rule('a.com'), rule('b.com'), rule('c.com')],
  });

  it('把第 3 条拖到第 1 位 → 以新顺序持久化', async () => {
    const onReorderRules = vi.fn<(rules: readonly FilterRule[]) => ActionResult>(
      () => ok,
    );
    renderView({ settings: three, onReorderRules });

    fireEvent.dragStart(screen.getByTestId('rule-grip-2'));
    fireEvent.dragOver(screen.getByTestId('rule-row-0'));
    await act(async () => {
      fireEvent.drop(screen.getByTestId('rule-row-0'));
    });

    expect(onReorderRules).toHaveBeenCalledTimes(1);
    const next = onReorderRules.mock.calls[0]?.[0] ?? [];
    expect(next.map((r) => r.pattern)).toEqual(['c.com', 'a.com', 'b.com']);
  });

  it('重排后列表**立即**按新顺序渲染(优先级随之改变)', async () => {
    const onReorderRules = vi.fn(() => ok);
    renderView({ settings: three, onReorderRules });

    fireEvent.dragStart(screen.getByTestId('rule-grip-0'));
    fireEvent.dragOver(screen.getByTestId('rule-row-2'));
    await act(async () => {
      fireEvent.drop(screen.getByTestId('rule-row-2'));
    });

    expect(screen.getByTestId('rule-pattern-0').textContent).toBe('b.com');
    expect(screen.getByTestId('rule-pattern-1').textContent).toBe('c.com');
    expect(screen.getByTestId('rule-pattern-2').textContent).toBe('a.com');
  });

  it('持久化失败 → 回滚到存储中的顺序(绝不显示没存上的顺序)', async () => {
    const onReorderRules = vi.fn(() => ({
      ok: false as const,
      error: classifyStorageError(new Error('QUOTA_BYTES exceeded')),
    }));
    renderView({ settings: three, onReorderRules });

    fireEvent.dragStart(screen.getByTestId('rule-grip-0'));
    fireEvent.dragOver(screen.getByTestId('rule-row-2'));
    await act(async () => {
      fireEvent.drop(screen.getByTestId('rule-row-2'));
    });

    expect(screen.getByTestId('rule-pattern-0').textContent).toBe('a.com');
  });

  it('键盘也能重排 —— 拖拽对键盘用户不可达(§5.7:所有可聚焦元素可用)', async () => {
    const onReorderRules = vi.fn<(rules: readonly FilterRule[]) => ActionResult>(
      () => ok,
    );
    renderView({ settings: three, onReorderRules });

    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('rule-grip-2'), { key: 'ArrowUp' });
    });

    const next = onReorderRules.mock.calls[0]?.[0] ?? [];
    expect(next.map((r) => r.pattern)).toEqual(['a.com', 'c.com', 'b.com']);
  });
});

// ─────────────────────────── 删除 ───────────────────────────

describe('§5.3 · 删除规则', () => {
  it('点 ✕ 直接删除,不二次确认(OQ-09)', () => {
    const onDeleteRule = vi.fn(() => ok);
    renderView({
      settings: settingsWith({ rules: [rule('a.com'), rule('b.com')] }),
      onDeleteRule,
    });
    fireEvent.click(screen.getByTestId('rule-delete-1'));
    expect(onDeleteRule).toHaveBeenCalledWith(1);
    // 没有确认对话框
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('删除后该规则从列表消失(以新的 settings 重渲染)', () => {
    const { rerender } = renderView({
      settings: settingsWith({ rules: [rule('a.com'), rule('b.com')] }),
    });
    expect(screen.getByTestId('rule-pattern-1').textContent).toBe('b.com');

    rerender(
      <RuleListView
        settings={settingsWith({ rules: [rule('a.com')] })}
        tabState={injectableTab()}
        onToggleMaster={() => ok}
        onDeleteRule={() => ok}
        onReorderRules={() => ok}
        onAddRule={() => undefined}
        onOpenRule={() => undefined}
      />,
    );

    expect(screen.queryByTestId('rule-pattern-1')).toBeNull();
    expect(screen.getByTestId('rule-count').textContent).toBe('1/20');
  });
});

// ─────────────────────────── §5.4 五种状态变体 ───────────────────────────

describe('§5.4 状态变体 ①空(0 条)', () => {
  it('列表区显示「尚未添加任何规则」+ 小字说明', () => {
    renderView({ settings: settingsWith({ rules: [] }) });
    const empty = screen.getByTestId('empty-state');
    expect(within(empty).getByText(EMPTY_TITLE)).toBeDefined();
    expect(within(empty).getByText(EMPTY_HINT)).toBeDefined();
    expect(EMPTY_TITLE).toBe('尚未添加任何规则');
    expect(EMPTY_HINT).toBe('添加一条规则,指定哪些网址需要套用滤镜');
  });

  it('空状态下 + 添加规则 仍可用,计数为 0/20', () => {
    renderView({ settings: settingsWith({ rules: [] }) });
    expect((screen.getByTestId('add-rule') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('rule-count').textContent).toBe('0/20');
  });
});

describe('§5.4 状态变体 ②满(20/20)', () => {
  const full = settingsWith({
    rules: Array.from({ length: MAX_RULES }, (_, i) => rule(`s${String(i)}.com`)),
  });

  it('提示条变琥珀色,文案为「已达 20 条上限,请先删除一条再添加」', () => {
    renderView({ settings: full });
    const notice = screen.getByTestId('capacity-notice');
    expect(notice.textContent).toBe(CAPACITY_NOTICE);
    expect(notice.className).toContain('notice--warn');
  });

  it('`+ 添加规则` 禁用(ADR-012:提示并引导删除,绝不静默淘汰)', () => {
    renderView({ settings: full });
    expect((screen.getByTestId('add-rule') as HTMLButtonElement).disabled).toBe(true);
  });

  it('计数变琥珀加粗', () => {
    renderView({ settings: full });
    const count = screen.getByTestId('rule-count');
    expect(count.textContent).toBe('20/20');
    expect(count.getAttribute('data-full')).toBe('true');
    expect(count.className).toContain('rule-count--full');
    expect(getComputedStyle(count).fontWeight).toBe('600');
  });

  it('满额时规则仍可删除 —— 这是 ADR-012 「引导删除」的落点', () => {
    const onDeleteRule = vi.fn(() => ok);
    renderView({ settings: full, onDeleteRule });
    expect((screen.getByTestId('rule-delete-0') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('rule-delete-0'));
    expect(onDeleteRule).toHaveBeenCalledWith(0);
  });
});

describe('§5.4 状态变体 ③主开关 OFF', () => {
  const off = settingsWith({
    masterEnabled: false,
    rules: [rule('a.com'), rule('b.com')],
  });

  /*
   * 🔴🔴 **ADR-076:原先这里断言的是琥珀提示条「已全局关闭,所有规则暂不
   *    生效」。那条提示条已被整条删除,故本断言被**替换**为它的反面 ——
   *    「提示条不存在」+「常驻优先级提示条照常在场」。**
   *
   *    这不是删掉一条断言:删掉会让「谁都可以把那条横幅加回来」不被察觉,
   *    而 ADR-076 的决定恰恰是「它不该在」。断言的方向反转,强度不变。
   */
  it('🔴 ADR-076:主开关 OFF 时**没有**「已全局关闭」提示条(该提示条已删除)', () => {
    renderView({ settings: off });
    expect(screen.queryByTestId('master-off-notice')).toBeNull();
    // 文案本身也必须不在页面上 —— 换个 testid 重新加回来一样算违规。
    expect(document.body.textContent).not.toContain('已全局关闭,所有规则暂不生效');
  });

  it('🔴 ADR-076:OFF 时 ADR-031 的常驻优先级提示条**照常在场**(不再被替换掉)', () => {
    renderView({ settings: off });
    const hint = screen.getByTestId('priority-hint');
    expect(hint.textContent).toBe(PRIORITY_HINT);
    expect(screen.queryByTestId('capacity-notice')).toBeNull();
  });

  it('列表与底部 opacity .42 + 降饱和', () => {
    renderView({ settings: off });
    const list = screen.getByTestId('rule-list');
    const foot = document.querySelector('.popup__foot') as HTMLElement;
    expect(Number.parseFloat(getComputedStyle(list).opacity)).toBeCloseTo(0.42, 5);
    expect(getComputedStyle(list).filter).toBe('saturate(.3)');
    expect(Number.parseFloat(getComputedStyle(foot).opacity)).toBeCloseTo(0.42, 5);
  });

  it('规则编辑类交互禁用(删除 / 打开 / 拖柄 / 添加)', () => {
    renderView({ settings: off });
    for (const id of ['rule-delete-0', 'rule-open-0', 'rule-grip-0', 'add-rule']) {
      expect((screen.getByTestId(id) as HTMLButtonElement).disabled, id).toBe(true);
    }
  });

  it('🔴 INV-8:规则**完整保留**,一条不少', () => {
    renderView({ settings: off });
    expect(screen.getByTestId('rule-pattern-0').textContent).toBe('a.com');
    expect(screen.getByTestId('rule-pattern-1').textContent).toBe('b.com');
    expect(screen.getByTestId('rule-count').textContent).toBe('2/20');
  });

  it('顶部图标变灰', () => {
    renderView({ settings: off });
    expect(screen.getByTestId('brand-dot').getAttribute('data-off')).toBe('true');
    expect(screen.getByTestId('brand-dot').className).toContain('popup__dot--off');
  });

  it('OFF 时不显示任何「生效」标记(INV-8:没有规则在生效)', () => {
    renderView({
      settings: off,
      tabState: injectableTab({ activeRuleIndex: 0 }),
    });
    expect(screen.queryByTestId('rule-live-0')).toBeNull();
  });

  /*
   * ═══════════════════════ 🔴🔴 ADR-076 ═══════════════════════
   *
   * > 主开关 OFF 时,「+ 添加规则」与「🔒 时间锁定」入口**一并禁用**;
   * > 主开关自己**保持可用**(它是唯一的回头路)。
   *
   * 下面五条分别钉住:两个入口都真的 `disabled`、原因说得出、
   * 主开关没被连带禁用、点击真的什么都不发生、以及
   * **与 ADR-050 的组合**(两个禁用理由同时成立时一条都不丢)。
   */
  it('🔴 ADR-076:两个入口的**视觉**也一致淡化(不能一个灰一个亮)', () => {
    renderView({ settings: off, withLockEntry: true });
    const foot = document.querySelector('.popup__foot') as HTMLElement;
    const entryRow = document.querySelector('.lock-entry-row') as HTMLElement;
    // 被同一条 ADR 一起禁用的两个入口,视觉信号必须一致。
    const footOpacity = Number.parseFloat(getComputedStyle(foot).opacity);
    const rowOpacity = Number.parseFloat(getComputedStyle(entryRow).opacity);
    expect(footOpacity).toBeCloseTo(0.42, 5);
    expect(
      rowOpacity,
      '锁定入口行未随「添加规则」一起淡化 —— 两个同样点不动的东西给出了矛盾的视觉信号',
    ).toBeCloseTo(0.42, 5);
  });

  it('🔴 ADR-076:主开关 OFF → 「添加规则」与「时间锁定」**两个入口都真的 disabled**', () => {
    renderView({ settings: off, withLockEntry: true });
    const add = screen.getByTestId('add-rule') as HTMLButtonElement;
    const lock = screen.getByTestId('lock-open') as HTMLButtonElement;
    // 真 `disabled` 属性 —— 不是只画成灰的(键盘用户同样挡得住)。
    expect(add.disabled, '添加规则').toBe(true);
    expect(lock.disabled, '时间锁定').toBe(true);
    // 真 disabled 的按钮不可聚焦 —— 这是「genuinely disabled」的可观察判据。
    add.focus();
    expect(document.activeElement).not.toBe(add);
    lock.focus();
    expect(document.activeElement).not.toBe(lock);
  });

  it('🔴 ADR-076:两个入口都说得出**为什么**被禁用,且用的是同一句话', () => {
    renderView({ settings: off, withLockEntry: true });
    const add = screen.getByTestId('add-rule');
    const lock = screen.getByTestId('lock-open');
    expect(add.getAttribute('title')).toBe(MASTER_OFF_DISABLED_REASON);
    expect(lock.getAttribute('title')).toBe(MASTER_OFF_DISABLED_REASON);
    // 文案须指明出路,而不只是陈述「不可用」。
    expect(MASTER_OFF_DISABLED_REASON).toContain('请先开启主开关');
  });

  it('🔴 ADR-076:点击被禁用的两个入口 → 回调一次都不触发', () => {
    const onAddRule = vi.fn();
    const onOpenLock = vi.fn();
    renderView({ settings: off, withLockEntry: true, onAddRule, onOpenLock });
    fireEvent.click(screen.getByTestId('add-rule'));
    fireEvent.click(screen.getByTestId('lock-open'));
    expect(onAddRule).not.toHaveBeenCalled();
    expect(onOpenLock).not.toHaveBeenCalled();
  });

  it('🔴 ADR-076:主开关重新 ON → 两个入口**同时**恢复可用(禁用不是单向的)', () => {
    const on = settingsWith({
      masterEnabled: true,
      rules: [rule('a.com'), rule('b.com')],
    });
    renderView({ settings: on, withLockEntry: true });
    const add = screen.getByTestId('add-rule') as HTMLButtonElement;
    const lock = screen.getByTestId('lock-open') as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    expect(lock.disabled).toBe(false);
    // 恢复可用后不该再挂着一句「为什么禁用」。
    expect(add.getAttribute('title')).toBeNull();
    expect(lock.getAttribute('title')).toBeNull();
  });

  /*
   * 🔴🔴 **两个禁用理由的组合(ADR-076 × ADR-050)。**
   *
   * ADR-050:不可注入页上**仅**禁用规则编辑类控件,全局主开关保持可用。
   * ADR-076:主开关 OFF 时「添加规则」与「时间锁定」禁用。
   *
   * 两者同时成立时必须:
   *   a) 「添加规则」仍禁用(两个理由都指向禁用,或式不可能丢);
   *   b) 不可注入的**横幅照常在场** —— 它是独立渲染的,不参与
   *      `disabledReason` 的「挑一条说」,所以这条解释不会被挤掉;
   *   c) 控件的 `title` 说的是**更根本**的那条(主开关 OFF)——
   *      开了主开关这页也还是不可注入,但关着主开关时「这页能不能注入」
   *      根本不重要;
   *   d) 🔒 时间锁定在**仅**不可注入(主开关 ON)时**仍可用** ——
   *      锁定锁的是整个扩展,不是当前标签页(与主开关同理,ADR-050)。
   */
  it('🔴🔴 ADR-076 × ADR-050:主开关 OFF + 不可注入页 → 添加仍禁用,且两条解释都没丢', () => {
    renderView({
      settings: off,
      tabState: injectableTab({ injectable: false }),
      withLockEntry: true,
    });
    const add = screen.getByTestId('add-rule') as HTMLButtonElement;
    // (a) 禁用没丢。
    expect(add.disabled).toBe(true);
    // (b) 不可注入的横幅照常在场 —— 这条解释没有被主开关那条挤掉。
    const banner = screen.getByTestId('not-injectable-notice');
    expect(banner.textContent).toContain(NOT_INJECTABLE_MESSAGE);
    // (c) 控件的 title 说更根本的那条。
    expect(add.getAttribute('title')).toBe(MASTER_OFF_DISABLED_REASON);
    // ADR-050 不变:主开关自己仍可用。
    expect((screen.getByTestId('master-switch') as HTMLButtonElement).disabled).toBe(false);
  });

  it('🔴 ADR-050 不被 ADR-076 污染:**仅**不可注入(主开关 ON)时,🔒 时间锁定仍可用', () => {
    renderView({
      settings: settingsWith({ masterEnabled: true, rules: [rule('a.com')] }),
      tabState: injectableTab({ injectable: false }),
      withLockEntry: true,
    });
    // 规则编辑类控件照 ADR-050 禁用……
    expect((screen.getByTestId('add-rule') as HTMLButtonElement).disabled).toBe(true);
    // ……但锁定入口是**全局**的,与当前页是什么无关 → 仍可用。
    const lock = screen.getByTestId('lock-open') as HTMLButtonElement;
    expect(
      lock.disabled,
      '锁定锁的是整个扩展,不是当前标签页 —— 不可注入不该是禁用它的理由',
    ).toBe(false);
    // 这一格也是**判别力**的证明:若实现把 notInjectable 也算进
    // lockEntryDisabled,上面那条 ADR-076 的断言仍会绿,本条会红。
  });

  it('🔴 ADR-051 仍优先:锁定中两个入口照旧禁用,原因说的是锁定', () => {
    renderView({
      settings: settingsWith({ masterEnabled: true, rules: [rule('a.com')] }),
      locked: true,
      withLockEntry: true,
    });
    const add = screen.getByTestId('add-rule') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.getAttribute('title')).toBe(LOCKED_DISABLED_REASON);
    // ADR-051 优先于 ADR-050:主开关一并锁死。
    expect((screen.getByTestId('master-switch') as HTMLButtonElement).disabled).toBe(true);
  });

  it('主开关本身仍可点 —— 否则关掉就再也打不开了', () => {
    const onToggleMaster = vi.fn(() => ok);
    renderView({ settings: off, onToggleMaster });
    const sw = screen.getByTestId('master-switch') as HTMLButtonElement;
    expect(sw.disabled).toBe(false);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(onToggleMaster).toHaveBeenCalledWith(true);
  });
});

describe('§5.4 状态变体 ④不可注入页(ADR-013 + ADR-050)', () => {
  const blocked = injectableTab({
    injectable: false,
    reason: 'internal-page',
    host: null,
  });

  it('琥珀条 + 说明原因,文案与 §5.4 一致', () => {
    renderView({ tabState: blocked });
    const notice = screen.getByTestId('not-injectable-notice');
    expect(notice.textContent).toContain(NOT_INJECTABLE_MESSAGE);
    expect(notice.textContent).toContain(
      '此页面不支持滤镜。Chrome 不允许扩展修改内部页面、应用商店和 PDF 查看器。',
    );
    expect(notice.className).toContain('notice--warn');
  });

  it('规则编辑类控件禁用', () => {
    renderView({
      settings: settingsWith({ rules: [rule('a.com')] }),
      tabState: blocked,
    });
    for (const id of ['rule-delete-0', 'rule-open-0', 'rule-grip-0', 'add-rule']) {
      expect((screen.getByTestId(id) as HTMLButtonElement).disabled, id).toBe(true);
    }
  });

  it('🔴 §6.1 冲突第 7 条 / ADR-050:全局主开关**仍可点击并生效**', () => {
    const onToggleMaster = vi.fn(() => ok);
    renderView({ tabState: blocked, onToggleMaster });
    const sw = screen.getByTestId('master-switch') as HTMLButtonElement;
    expect(sw.disabled).toBe(false);
    fireEvent.click(sw);
    expect(onToggleMaster).toHaveBeenCalledWith(false);
  });

  it('不可注入时不显示「生效」标记(ADR-013:这页根本没被改色)', () => {
    renderView({
      settings: settingsWith({ rules: [rule('a.com')] }),
      tabState: injectableTab({ injectable: false, reason: 'pdf', activeRuleIndex: 0 }),
    });
    expect(screen.queryByTestId('rule-live-0')).toBeNull();
  });
});

describe('§5.4 状态变体 ⑤存储失败(ADR-046)', () => {
  it('顶部红色报错条:「保存失败:{原因}」+ 可操作建议', async () => {
    const onDeleteRule = vi.fn(() => ({
      ok: false as const,
      error: classifyStorageError(new Error('QUOTA_BYTES quota exceeded')),
    }));
    renderView({ settings: settingsWith({ rules: [rule('a.com')] }), onDeleteRule });

    await act(async () => {
      fireEvent.click(screen.getByTestId('rule-delete-0'));
    });

    const banner = screen.getByTestId('save-error');
    expect(banner.className).toContain('notice--error');
    expect(banner.textContent).toContain('保存失败:');
    expect(banner.textContent).toContain('存储空间已满');
    expect(banner.textContent).toContain('请删除几条规则后重试。');
    expect(banner.getAttribute('role')).toBe('alert');
  });

  it('报错条用 --bad / --bad-soft token(红色)', async () => {
    const onDeleteRule = vi.fn(() => ({ ok: false as const, error: capacityError() }));
    renderView({ settings: settingsWith({ rules: [rule('a.com')] }), onDeleteRule });
    await act(async () => {
      fireEvent.click(screen.getByTestId('rule-delete-0'));
    });
    const banner = screen.getByTestId('save-error');
    expect(getComputedStyle(banner).color).toBe('var(--bad)');
    expect(getComputedStyle(banner).background).toBe('var(--bad-soft)');
  });

  it('🔴 报错时规则列表照常显示,用户仍可删除以腾出空间', async () => {
    const onDeleteRule = vi
      .fn<(index: number) => ActionResult>()
      .mockReturnValueOnce({ ok: false, error: capacityError() })
      .mockReturnValue(ok);
    renderView({
      settings: settingsWith({ rules: [rule('a.com'), rule('b.com')] }),
      onDeleteRule,
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('rule-delete-0'));
    });
    expect(screen.getByTestId('save-error')).toBeDefined();
    expect(screen.getByTestId('rule-list')).toBeDefined();

    const del = screen.getByTestId('rule-delete-1') as HTMLButtonElement;
    expect(del.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(del);
    });
    expect(onDeleteRule).toHaveBeenCalledTimes(2);
  });

  it('下一次写入成功后报错条消失', async () => {
    const onDeleteRule = vi
      .fn<(index: number) => ActionResult>()
      .mockReturnValueOnce({ ok: false, error: capacityError() })
      .mockReturnValue(ok);
    renderView({
      settings: settingsWith({ rules: [rule('a.com'), rule('b.com')] }),
      onDeleteRule,
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('rule-delete-0'));
    });
    expect(screen.queryByTestId('save-error')).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('rule-delete-1'));
    });
    expect(screen.queryByTestId('save-error')).toBeNull();
  });

  /**
   * 🔴 **逐字钉死报错条的完整文案 —— 不用 `toContain`。**
   *
   * 上一轮门禁抓到的真实缺陷:`save-error.ts` 把 `SAVE_FAILED_PREFIX + error.message`
   * 与 `adviceFor(error)` 直接相接,而 T3 的 `message` 本身**已经**含有「保存失败」
   * 和建议句,于是真实 Chrome 中渲染成:
   *
   * > `保存失败:存储空间已满,保存失败。请删除几条规则后重试。请删除几条规则后重试。`
   *
   * 当时的五条测试全部只用 `toContain('保存失败:')` / `toContain('请删除几条规则后重试。')`
   * —— 而**子串断言在文本重复时更容易通过**,整个套件对这一类缺陷结构性失明。
   *
   * 故此处对每一种 `WriteError` 分类断言 `banner.textContent` 的**精确值**,
   * 把「`{原因}` + 建议」的组装方式钉死,而不是抽样。
   */
  describe('🔴 报错条文案逐字精确(不得重复「保存失败」或建议句)', () => {
    const bannerTextFor = async (error: ReturnType<typeof capacityError>) => {
      const onDeleteRule = vi.fn(() => ({ ok: false as const, error }));
      renderView({ settings: settingsWith({ rules: [rule('a.com')] }), onDeleteRule });
      await act(async () => {
        fireEvent.click(screen.getByTestId('rule-delete-0'));
      });
      // 去掉 `aria-hidden` 的 ⚠ 图标,只留文案本身。
      return (screen.getByTestId('save-error').textContent ?? '').replace('⚠', '');
    };

    it('quota(storage-failure):存储空间已满', async () => {
      expect(await bannerTextFor(classifyStorageError(new Error('QUOTA_BYTES exceeded')))).toBe(
        '保存失败:存储空间已满。请删除几条规则后重试。',
      );
    });

    it('other / capacity-exceeded:已达 20 条上限', async () => {
      expect(await bannerTextFor(capacityError())).toBe(
        `保存失败:规则数量已达上限 ${String(MAX_RULES)} 条。请删除几条规则后重试。`,
      );
    });

    it('other / storage-failure:设置未被写入', async () => {
      expect(await bannerTextFor(classifyStorageError(new Error('disk on fire')))).toBe(
        '保存失败:设置未被写入。请重试;若反复失败,请删除几条规则后再试。',
      );
    });

    it('other / invalid-input:透出调用点的具体原因', async () => {
      expect(
        await bannerTextFor(invalidInputError('网址模式非法(通配符位置错误),未写入。')),
      ).toBe('保存失败:网址模式非法(通配符位置错误),未写入。请检查网址模式后重试。');
    });

    /**
     * 结构性护栏:即便日后 T3 改了 `message` 措辞、或 T6b/T6c 新增了分类,
     * 也不允许「保存失败」或任一建议句在同一条报错里出现两次。
     */
    it('🔴 任一分类都不得出现重复的短语', async () => {
      const errors = [
        classifyStorageError(new Error('QUOTA_BYTES exceeded')),
        capacityError(),
        classifyStorageError(new Error('disk on fire')),
        invalidInputError('规则下标越界:7。'),
      ];
      for (const error of errors) {
        cleanup();
        const text = await bannerTextFor(error);
        // 「保存失败」只能作为前缀出现一次。
        expect(text.split('保存失败').length - 1).toBe(1);
        for (const advice of [
          '请删除几条规则后重试。',
          '请检查网址模式后重试。',
          '请重试;若反复失败,请删除几条规则后再试。',
        ]) {
          expect(text.split(advice).length - 1).toBeLessThanOrEqual(1);
        }
        // `{原因}` 与建议之间不得粘连出两个句号。
        expect(text).not.toMatch(/。。/u);
      }
    });
  });

  it('🔴 T3 gate I1:`locked` 分类**不**弹红色报错条', async () => {
    const onDeleteRule = vi.fn(() => ({
      ok: false as const,
      error: lockedError('locked-rules', '锁定中,规则不可变更。'),
    }));
    renderView({ settings: settingsWith({ rules: [rule('a.com')] }), onDeleteRule });

    await act(async () => {
      fireEvent.click(screen.getByTestId('rule-delete-0'));
    });
    expect(screen.queryByTestId('save-error')).toBeNull();
  });
});

// ─────────────────────────── 负向断言 ───────────────────────────

describe('🔴 负向断言 —— 这些 ADR 没有正向产物,只能靠负向门禁守住', () => {
  const populated = settingsWith({
    rules: [rule('a.com'), rule('b.com', 'Grayscale', 60), rule('c.com', 'Grayscale', 30)],
  });

  it('ADR-009:无 per-rule 开关 / 启用禁用控件', () => {
    renderView({ settings: populated });
    // 全局主开关有且仅有一个 role=switch;规则行内没有任何开关。
    expect(screen.getAllByRole('switch').length).toBe(1);
    expect(screen.getByRole('switch')).toBe(screen.getByTestId('master-switch'));

    for (let i = 0; i < 3; i++) {
      const row = screen.getByTestId(`rule-row-${String(i)}`);
      expect(row.querySelectorAll('[role="switch"]').length).toBe(0);
      expect(row.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    }

    const text = screen.getByTestId('popup').textContent ?? '';
    for (const banned of ['启用', '禁用', '停用']) {
      expect(text, `出现了 per-rule 开关文案「${banned}」`).not.toContain(banned);
    }
  });

  it('ADR-015:无媒体 / 图片排除控件', () => {
    renderView({ settings: populated });
    const text = screen.getByTestId('popup').textContent ?? '';
    for (const banned of ['排除', '媒体', '图片', '视频']) {
      expect(text, `出现了媒体排除文案「${banned}」`).not.toContain(banned);
    }
    expect(screen.getByTestId('popup').querySelectorAll('input[type="checkbox"]').length).toBe(0);
  });

  it('ADR-024:无「清空全部」按钮', () => {
    renderView({ settings: populated });
    const text = screen.getByTestId('popup').textContent ?? '';
    for (const banned of ['清空', '全部删除', '删除全部', '重置']) {
      expect(text, `出现了清空全部文案「${banned}」`).not.toContain(banned);
    }
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent ?? '').not.toContain('清空');
    }
  });

  it('ADR-028:列表视图不出现 Color Tint / Hue 的任何痕迹', () => {
    renderView({ settings: populated });
    const text = (screen.getByTestId('popup').textContent ?? '').toLowerCase();
    for (const banned of ['tint', 'hue', '色调', '染色']) {
      expect(text).not.toContain(banned);
    }
  });

  it('ADR-052 / INV-12:列表视图不含任何解除 / 取消 / 缩短锁定的入口', () => {
    renderView({ settings: populated });
    const text = screen.getByTestId('popup').textContent ?? '';
    for (const banned of ['解除', '取消锁定', '结束锁定', '缩短']) {
      expect(text).not.toContain(banned);
    }
  });
});

// ─────────────────────────── 骨架态 / 锁定接缝 ───────────────────────────

describe('ADR-044 · 骨架态', () => {
  it('收到 TabState 前控件禁用、不显示错误', () => {
    renderView({ settings: settingsWith({ rules: [rule('a.com')] }), tabState: null });
    expect(screen.getByTestId('popup').getAttribute('data-skeleton')).toBe('true');
    for (const id of ['master-switch', 'add-rule', 'rule-delete-0', 'rule-open-0']) {
      expect((screen.getByTestId(id) as HTMLButtonElement).disabled, id).toBe(true);
    }
    expect(screen.queryByTestId('save-error')).toBeNull();
    expect(screen.queryByTestId('not-injectable-notice')).toBeNull();
  });

  it('骨架态下规则仍然渲染(不闪空列表)', () => {
    renderView({ settings: settingsWith({ rules: [rule('a.com')] }), tabState: null });
    expect(screen.getByTestId('rule-pattern-0').textContent).toBe('a.com');
  });
});

describe('T6c 接缝 · 锁定(T6a 不实现锁定 UI)', () => {
  it('locked=true 时全部设置控件禁用(含主开关,ADR-051 优先于 ADR-050)', () => {
    renderView({ settings: settingsWith({ rules: [rule('a.com')] }), locked: true });
    for (const id of ['master-switch', 'add-rule', 'rule-delete-0', 'rule-open-0', 'rule-grip-0']) {
      expect((screen.getByTestId(id) as HTMLButtonElement).disabled, id).toBe(true);
    }
  });

  it('不可注入页 + 锁定 → 主开关仍然禁用(D2:两条 ADR 的交集)', () => {
    renderView({
      tabState: injectableTab({ injectable: false, reason: 'internal-page' }),
      locked: true,
    });
    expect((screen.getByTestId('master-switch') as HTMLButtonElement).disabled).toBe(true);
  });

  it('T6a 自身不渲染倒计时 / 锁定条 —— 那是 T6c 的产物', () => {
    renderView({ settings: settingsWith({ rules: [rule('a.com')] }), locked: true });
    const text = screen.getByTestId('popup').textContent ?? '';
    expect(text).not.toContain('锁定中');
    expect(text).not.toContain('🔒');
  });
});

// ─────────────────────────── ADR-043 focus ───────────────────────────

describe('ADR-043 · 所有可聚焦元素都有统一 focus 态', () => {
  it('列表视图里每个可聚焦元素都匹配全局 :focus-visible 选择器', () => {
    renderView({
      settings: settingsWith({ rules: [rule('a.com'), rule('b.com')] }),
    });
    const focusables = screen
      .getByTestId('popup')
      .querySelectorAll('a, button, input, select, textarea, summary, [tabindex]');
    expect(focusables.length).toBeGreaterThan(0);
    for (const el of Array.from(focusables)) {
      expect(
        el.matches(':where(a, button, input, select, textarea, summary, [tabindex])'),
        `${el.tagName}.${el.className} 不在全局 focus 规则的覆盖范围内`,
      ).toBe(true);
      // 组件不得自行覆盖 outline —— 覆盖会绕开 ADR-043 的固定值。
      expect((el as HTMLElement).style.outline).toBe('');
      expect((el as HTMLElement).style.outlineWidth).toBe('');
    }
  });

  it('列表视图没有 tabindex="-1" 的可交互控件(键盘可达)', () => {
    renderView({ settings: settingsWith({ rules: [rule('a.com')] }) });
    const negative = screen
      .getByTestId('popup')
      .querySelectorAll('button[tabindex="-1"], a[tabindex="-1"]');
    expect(negative.length).toBe(0);
  });
});

describe('§5.7 · prefers-reduced-motion', () => {
  it('列表视图不含任何脉冲 / 无限动画 —— 脉冲是编辑视图(T6b)的元素', () => {
    renderView({ settings: settingsWith({ rules: [rule('a.com')] }) });
    const els = screen.getByTestId('popup').querySelectorAll('*');
    for (const el of Array.from(els)) {
      expect(getComputedStyle(el).animationIterationCount || 'none').not.toBe('infinite');
    }
  });
});
