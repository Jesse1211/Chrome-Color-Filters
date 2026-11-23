// @vitest-environment jsdom
/**
 * T6b gate —— 编辑视图的行为与文案(§5.5 / §5.6 / §5.7)。
 *
 * 权威:**行为与文案以 §5.5 / §5.6 和 ADR 为准**(ADR-042),
 * 视觉层以仓内 `docs/design/popup-mockup.html` 为准,冲突时 ADR 胜(§6.1)。
 *
 * 逐条覆盖 §6 T6b 的 gate:
 * - 四个滤镜单选,选中新的取消旧的(INV-2)
 * - 负向:无 Color Tint / 无 Hue 滑块(ADR-028)、无「使用当前网站」(ADR-001)
 * - 新建默认 Grayscale @ 100%,输入框为空(ADR-020)
 * - 语法错误:描红 + 保存禁用 + 文案指出非法字符
 * - §5.6 两维状态行四种情况(图标 / 文案 / 色)
 * - 被遮蔽解释框 + 一键修复(点击后顺序确实改变)
 * - ADR-021:改强度后立即生效;滑块 0 与 100 均可达
 * - F20:空 pattern 保存禁用
 * - ADR-051:锁定中全部控件禁用
 * - 🔴 ADR-049:预览走 `PREVIEW_FILTER`,**不写 storage**(spy 断言)
 * - 🔴 四种不发送 `PREVIEW_FILTER` 的情况(F9/F11/I2)
 * - 🔴 `PREVIEW_CLEAR` 的四条发送义务(B1)
 * - ADR-043 focus 态
 *
 * ⚠️ §8 第 8 条:jsdom 下的绿灯**不构成** REAL_STACK_GATE 的通过。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type FilterMode,
  type FilterRule,
  type FilterSettings,
  defaultSettings,
} from '../../domain/index.js';
import {
  PREVIEW_CLEAR,
  PREVIEW_FILTER,
  PREVIEW_PORT_NAME,
} from '../../injection/preview-contract.js';
import { capacityError } from '../../storage/errors.js';
import { RuleEditView } from '../RuleEditView.js';
import { type ActionResult } from '../RuleListView.js';
import { type TabState } from '../tab-state.js';
import {
  type PreviewSenderPort,
  createPreviewChannel,
} from '../preview-port.js';
import {
  BACK_LABEL,
  CREATE_TITLE,
  DELETE_LABEL,
  EDIT_TITLE,
  FILTER_LABEL,
  INTENSITY_LABEL,
  MOVE_TO_TOP_LABEL,
  PATTERN_LABEL,
  PREVIEW_LIVE_HINT,
  PREVIEW_UNAVAILABLE_HINT,
  SAVE_LABEL,
  STATUS_EMPTY_TEXT,
  STATUS_ICON_ERROR,
  STATUS_ICON_LIVE,
  STATUS_ICON_NO_MATCH,
  STATUS_ICON_SHADOWED,
} from '../edit-strings.js';
import {
  computed,
  declaredValue,
  hexToRgb,
  installPopupStyles,
  token,
} from './css-harness.js';

/**
 * 断言「某个 class 的某个属性确实引用了某个 §5.1 token」。
 *
 * ⚠️ 为什么不直接断言计算后的 `rgb(...)`:jsdom **不做 `var()` 代换**
 * (见 `css-harness.ts` 的头注释)。`computed()` 只能把它读出来再手工
 * 代换一层,得到的是 token 的**原文**(`#15803D`),而不是浏览器归一化后的
 * `rgb(21, 128, 61)`。
 *
 * 故采用 `design-tokens.test.ts` 已建立的手法:
 * 「这条声明引用了 `--ok`」+「`--ok` 的值是 `#15803D`」+
 * 「该值归一化后是 `rgb(21, 128, 61)`」三段事实**分别**断言。
 * 三段都被真实读取,只是链路由测试而非 jsdom 串起来 ——
 * 像素级验收属于 REAL_STACK_GATE(§8 第 8 条)。
 */
function expectTokenRef(
  selector: string,
  property: string,
  tokenName: string,
  expectedHex: string,
): void {
  expect(declaredValue(selector, property)).toBe(`var(${tokenName})`);
  expect(token(tokenName).toUpperCase()).toBe(expectedHex);
  // 第三段:该 hex 本身是一个合法色值,归一化后即 §5.1 表里的那个颜色。
  expect(hexToRgb(token(tokenName))).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
}

/* ────────────────────────────── 测试替身 ────────────────────────────── */

const rule = (
  pattern: string,
  mode: FilterMode = 'Grayscale',
  intensity = 100,
): FilterRule => ({ pattern, mode, intensity });

const settingsWith = (overrides: Partial<FilterSettings> = {}): FilterSettings => ({
  ...defaultSettings(),
  ...overrides,
});

/**
 * 默认的「可注入 + 默认规则正在生效」tab 状态。
 *
 * 🔴 `activeRuleIndex: 0` 不是随手填的:默认 harness 编辑的是
 * `rules[0] = '*.weibo.*'`,默认 host 是 `weibo.com` —— 真实 service worker
 * 的 `computeTabState` 对这组输入必然报 `activeRuleIndex: 0`。
 * 而 ADR-044(DESIGN.md:1016「两个视图都不自己算匹配」)规定草稿未改动时
 * 两维状态**取自 TabState**,故这个字段直接决定状态行与预览资格。
 *
 * 填 `null` 会构造出真实 SW 不会产生的**自相矛盾**响应(页面命中了规则却
 * 没有生效者),测试便不再代表真实联调。覆盖 `host` 为别的站点时,
 * 请**同时**覆盖 `activeRuleIndex`。
 */
const injectableTab = (overrides: Partial<TabState> = {}): TabState => ({
  tabId: 7,
  injectable: true,
  host: 'weibo.com',
  activeRuleIndex: 0,
  shadowedRuleIndexes: [],
  ...overrides,
});

const ok: ActionResult = { ok: true };

/**
 * 预览端口的 spy 替身。
 *
 * 🔴 记录**每一条**发出的消息 —— gate 的多数预览条款都是
 * 「发了 / 没发」与「发的是什么」,必须能逐条数。
 */
interface PreviewSpy {
  readonly messages: unknown[];
  readonly connects: number[];
  readonly disconnects: number;
  readonly filters: () => unknown[];
  readonly clears: () => unknown[];
}

function previewSpy() {
  const messages: unknown[] = [];
  const connects: number[] = [];
  let disconnects = 0;

  const spy: PreviewSpy = {
    messages,
    connects,
    get disconnects() {
      return disconnects;
    },
    filters: () =>
      messages.filter(
        (m) => (m as { type?: string }).type === PREVIEW_FILTER,
      ),
    clears: () =>
      messages.filter((m) => (m as { type?: string }).type === PREVIEW_CLEAR),
  };

  const channel = createPreviewChannel((tabId) => {
    connects.push(tabId);
    const port: PreviewSenderPort = {
      postMessage(message) {
        messages.push(message);
      },
      disconnect() {
        disconnects += 1;
      },
    };
    return port;
  });

  return { spy, channel };
}

interface Harness {
  readonly settings?: FilterSettings;
  readonly tabState?: TabState | null;
  readonly editingIndex?: number | null;
  readonly onSave?: (rule: FilterRule) => ActionResult;
  readonly onDelete?: (index: number) => ActionResult;
  readonly onMoveToTop?: (index: number) => ActionResult;
  readonly onBack?: () => void;
  readonly locked?: boolean;
}

function renderEdit(h: Harness = {}) {
  const { spy, channel } = previewSpy();
  const view = render(
    <RuleEditView
      settings={h.settings ?? settingsWith({ rules: [rule('*.weibo.*')] })}
      tabState={h.tabState === undefined ? injectableTab() : h.tabState}
      editingIndex={h.editingIndex === undefined ? 0 : h.editingIndex}
      previewChannel={channel}
      onSave={h.onSave ?? (() => ok)}
      onDelete={h.onDelete ?? (() => ok)}
      onMoveToTop={h.onMoveToTop ?? (() => ok)}
      onBack={h.onBack ?? (() => undefined)}
      {...(h.locked === undefined ? {} : { locked: h.locked })}
    />,
  );
  return { ...view, spy, channel };
}

beforeEach(() => {
  document.head.innerHTML = '';
  installPopupStyles();
});

afterEach(cleanup);

/* ═══════════════════════ §5.5 编辑视图结构 ═══════════════════════ */

describe('§5.5 · 编辑视图结构', () => {
  it('ADR-022:渲染为 edit 视图,顶栏有返回 + 标题', () => {
    renderEdit();
    expect(screen.getByTestId('popup').dataset.view).toBe('edit');
    expect(screen.getByTestId('back-button').textContent).toBe(BACK_LABEL);
    expect(screen.getByTestId('edit-title').textContent).toBe(EDIT_TITLE);
  });

  it('新建时标题为「添加规则」(设计稿第三张图)', () => {
    renderEdit({ editingIndex: null });
    expect(screen.getByTestId('edit-title').textContent).toBe(CREATE_TITLE);
  });

  it('三个字段标签与 §5.5 一致', () => {
    renderEdit();
    const body = document.querySelector('.edit__body');
    expect(body).not.toBeNull();
    const text = (body as HTMLElement).textContent ?? '';
    expect(text).toContain(PATTERN_LABEL);
    expect(text).toContain(FILTER_LABEL);
    expect(text).toContain(INTENSITY_LABEL);
  });

  it('底栏有保存与删除(§5.5)', () => {
    renderEdit();
    expect(screen.getByTestId('save-button').textContent).toBe(SAVE_LABEL);
    expect(screen.getByTestId('delete-button').textContent).toBe(DELETE_LABEL);
  });

  it('ADR-033:网址模式输入框用等宽字体', () => {
    renderEdit();
    const input = screen.getByTestId('pattern-input');
    expect(computed(input, 'font-family')).toBe(token('--font-mono'));
  });
});

/* ═══════════════════════ ADR-020 / ADR-021 初值 ═══════════════════════ */

describe('ADR-020 / ADR-021 · 初值', () => {
  it('ADR-020:新建规则默认 Grayscale @ 100%,输入框为空', () => {
    renderEdit({ editingIndex: null, settings: settingsWith({ rules: [] }) });
    expect((screen.getByTestId('pattern-input') as HTMLInputElement).value).toBe('');
    expect(
      (screen.getByTestId('filter-radio-Grayscale') as HTMLInputElement).checked,
    ).toBe(true);
    expect((screen.getByTestId('intensity-slider') as HTMLInputElement).value).toBe(
      '100',
    );
    expect(screen.getByTestId('intensity-value').textContent).toBe('100%');
  });

  it('ADR-021:已有规则以现值为初值(模式 / 强度 / 网址均可编辑)', () => {
    renderEdit({
      settings: settingsWith({ rules: [rule('x.com', 'BlueYellow', 60)] }),
      editingIndex: 0,
    });
    expect((screen.getByTestId('pattern-input') as HTMLInputElement).value).toBe(
      'x.com',
    );
    expect(
      (screen.getByTestId('filter-radio-BlueYellow') as HTMLInputElement).checked,
    ).toBe(true);
    expect((screen.getByTestId('intensity-slider') as HTMLInputElement).value).toBe(
      '60',
    );
  });

  it('新建时不渲染删除按钮(没有可删的东西)', () => {
    renderEdit({ editingIndex: null, settings: settingsWith({ rules: [] }) });
    expect(screen.queryByTestId('delete-button')).toBeNull();
  });
});

/* ═══════════════════════ ADR-002 / INV-2 四滤镜单选 ═══════════════════════ */

describe('🔴 ADR-002 / INV-2 · 四滤镜互斥单选', () => {
  it('恰好四个选项,与 §5.2 表格一致', () => {
    renderEdit();
    const group = screen.getByTestId('filter-options');
    const radios = group.querySelectorAll('input[type="radio"]');
    expect(radios).toHaveLength(4);
    for (const mode of ['Grayscale', 'RedGreen', 'GreenRed', 'BlueYellow']) {
      expect(screen.getByTestId(`filter-radio-${mode}`)).toBeDefined();
    }
  });

  it('选中新的取消旧的(INV-2:任一时刻仅一个滤镜)', () => {
    renderEdit();
    fireEvent.click(screen.getByTestId('filter-radio-RedGreen'));
    expect(
      (screen.getByTestId('filter-radio-RedGreen') as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByTestId('filter-radio-Grayscale') as HTMLInputElement).checked,
    ).toBe(false);

    fireEvent.click(screen.getByTestId('filter-radio-GreenRed'));
    const checked = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).filter((r) => r.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0]?.value).toBe('GreenRed');
  });

  it('四项共享同一个 radio group name —— 互斥由平台保证', () => {
    renderEdit();
    const names = new Set(
      Array.from(
        document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
      ).map((r) => r.name),
    );
    expect(names.size).toBe(1);
    expect([...names][0]).not.toBe('');
  });

  it('🔴 ADR-030:每个色块都与文字名称并列出现,色块绝不单独承载语义', () => {
    renderEdit();
    for (const mode of ['Grayscale', 'RedGreen', 'GreenRed', 'BlueYellow']) {
      const option = screen.getByTestId(`filter-option-${mode}`);
      expect(within(option).getByTestId(`filter-swatch-${mode}`)).toBeDefined();
      const name = within(option).getByTestId(`filter-name-${mode}`);
      expect((name.textContent ?? '').length).toBeGreaterThan(0);
    }
  });

  it('§5.2:四个渐变色值与表格完全一致', () => {
    renderEdit();
    const expected: Record<string, readonly [string, string]> = {
      Grayscale: ['#9AA0A6', '#D5D8DC'],
      RedGreen: ['#C25B4E', '#5B9E55'],
      GreenRed: ['#5B9E55', '#C25B4E'],
      BlueYellow: ['#4C6FD4', '#D9C25A'],
    };
    for (const [mode, [from, to]] of Object.entries(expected)) {
      const swatch = screen.getByTestId(`filter-swatch-${mode}`);
      // jsdom 把 hex 归一化为 `rgb(...)`,故按归一化后的值比对
      // (与 `design-tokens.test.ts` 的色块断言同一手法)。
      expect(computed(swatch, 'background-image')).toBe(
        `linear-gradient(90deg, ${hexToRgb(from)}, ${hexToRgb(to)})`,
      );
    }
  });
});

/* ═══════════════════════ 负向断言 ═══════════════════════ */

describe('🔴 负向断言 · ADR-028 / ADR-001', () => {
  it('ADR-028:无 Color Tint 选项', () => {
    renderEdit();
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('色调');
    expect(text).not.toContain('Tint');
    expect(document.querySelector('[data-mode="ColorTint"]')).toBeNull();
  });

  it('ADR-028:无 Hue 滑块 —— 页面上只有一个 range 输入,就是强度', () => {
    renderEdit();
    const ranges = document.querySelectorAll('input[type="range"]');
    expect(ranges).toHaveLength(1);
    expect((ranges[0] as HTMLElement).dataset.testid).toBe('intensity-slider');
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('色相');
    expect(text).not.toContain('Hue');
  });

  it('🔴 ADR-001:无「使用当前网站」自动填充按钮', () => {
    renderEdit({ tabState: injectableTab({ host: 'weibo.com' }) });
    const text = document.body.textContent ?? '';
    for (const banned of ['使用当前网站', '填入当前', '使用本站', '当前网址']) {
      expect(text).not.toContain(banned);
    }
    // 更强的一条:新建时输入框为空,**没有**被当前 host 预填。
    cleanup();
    renderEdit({
      editingIndex: null,
      settings: settingsWith({ rules: [] }),
      tabState: injectableTab({ host: 'weibo.com' }),
    });
    expect((screen.getByTestId('pattern-input') as HTMLInputElement).value).toBe('');
  });

  it('🔴 I2:编辑视图不存在任何锁定入口(预览与锁定永不共存)', () => {
    renderEdit();
    const text = document.body.textContent ?? '';
    for (const banned of ['锁定', '延长', '倒计时']) {
      expect(text, `编辑视图出现了「${banned}」`).not.toContain(banned);
    }
  });
});

/* ═══════════════════════ §5.6 两维状态行 ═══════════════════════ */

describe('🔴 §5.6 · 两维状态行的四种情况', () => {
  it('匹配且生效 → `●` + 「匹配当前网站 {host} · 生效中」+ ok 色', () => {
    renderEdit({
      settings: settingsWith({ rules: [rule('*.weibo.*')] }),
      editingIndex: 0,
      tabState: injectableTab({ host: 'weibo.com', activeRuleIndex: 0 }),
    });
    const line = screen.getByTestId('status-line');
    expect(line.dataset.kind).toBe('live');
    expect(line.dataset.tone).toBe('ok');
    expect(screen.getByTestId('status-icon').textContent).toBe(STATUS_ICON_LIVE);
    expect(screen.getByTestId('status-text').textContent).toBe(
      '匹配当前网站 weibo.com · 生效中',
    );
    expectTokenRef('.status--ok', 'color', '--ok', '#15803D');
  });

  it('匹配但被遮蔽 → `◐` + 「匹配当前网站,但不生效」+ warn 色', () => {
    renderEdit({
      settings: settingsWith({ rules: [rule('*.weibo.*'), rule('*.com')] }),
      editingIndex: 1,
      // ADR-044:遮蔽关系由 SW 判定 —— 0 号生效、1 号(正在编辑的这条)被遮蔽。
      tabState: injectableTab({
        host: 'weibo.com',
        activeRuleIndex: 0,
        shadowedRuleIndexes: [1],
      }),
    });
    const line = screen.getByTestId('status-line');
    expect(line.dataset.kind).toBe('shadowed');
    expect(screen.getByTestId('status-icon').textContent).toBe(
      STATUS_ICON_SHADOWED,
    );
    expect(line.dataset.tone).toBe('warn');
    expect(screen.getByTestId('status-text').textContent).toBe(
      '匹配当前网站,但不生效',
    );
    expectTokenRef('.status--warn', 'color', '--warn', '#B45309');
  });

  it('不匹配 → `○` + 「不匹配当前网站 {host}」+ muted 色', () => {
    renderEdit({
      settings: settingsWith({ rules: [rule('x.com')] }),
      editingIndex: 0,
      // `x.com` 匹配不了 weibo.com → SW 报无命中(ADR-044)。
      tabState: injectableTab({ host: 'weibo.com', activeRuleIndex: null }),
    });
    const line = screen.getByTestId('status-line');
    expect(line.dataset.kind).toBe('no-match');
    expect(screen.getByTestId('status-icon').textContent).toBe(
      STATUS_ICON_NO_MATCH,
    );
    expect(line.dataset.tone).toBe('muted');
    expect(screen.getByTestId('status-text').textContent).toBe(
      '不匹配当前网站 weibo.com',
    );
    expectTokenRef('.status--muted', 'color', '--muted', '#8B919C');
  });

  it('语法错误 → `✕` + 「不能使用 `{char}` —— 只支持 `*` 和普通字符」+ bad 色', () => {
    renderEdit({ editingIndex: null, settings: settingsWith({ rules: [] }) });
    fireEvent.change(screen.getByTestId('pattern-input'), {
      target: { value: '*.weibo.#' },
    });
    const line = screen.getByTestId('status-line');
    expect(line.dataset.kind).toBe('illegal-character');
    expect(screen.getByTestId('status-icon').textContent).toBe(STATUS_ICON_ERROR);
    expect(screen.getByTestId('illegal-char').textContent).toBe('#');
    expect(line.dataset.tone).toBe('bad');
    expect(screen.getByTestId('status-text').textContent).toBe(
      '不能使用 # —— 只支持 * 和普通字符',
    );
    expectTokenRef('.status--bad', 'color', '--bad', '#B42318');
  });

  it('语法错误时输入框描红 + 保存按钮禁用(§5.5)', () => {
    renderEdit({ editingIndex: null, settings: settingsWith({ rules: [] }) });
    const input = screen.getByTestId('pattern-input');
    fireEvent.change(input, { target: { value: 'weibo.com/path' } });
    expect(input.dataset.invalid).toBe('true');
    expect(input.className).toContain('pattern-input--invalid');
    // 描红 = 边框取 bad 色(设计稿 `.inp.err`)。
    expectTokenRef('.pattern-input--invalid', 'border-color', '--bad', '#B42318');
    expect((screen.getByTestId('save-button') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('🔴 F20:空 pattern 视为无效,保存按钮禁用(不含非法字符但匹配不了任何东西)', () => {
    renderEdit({ editingIndex: null, settings: settingsWith({ rules: [] }) });
    expect((screen.getByTestId('save-button') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByTestId('status-line').dataset.kind).toBe('empty');
    expect(screen.getByTestId('status-text').textContent).toBe(STATUS_EMPTY_TEXT);
    // 空串没有「那个非法字符」可指 —— 不得套用 illegal-character 的文案。
    expect(screen.queryByTestId('illegal-char')).toBeNull();
  });

  it('主开关 OFF 时即使匹配也显示「不生效」(INV-8:没有任何规则在生效)', () => {
    renderEdit({
      settings: settingsWith({
        masterEnabled: false,
        rules: [rule('*.weibo.*')],
      }),
      editingIndex: 0,
      tabState: injectableTab({ host: 'weibo.com' }),
    });
    expect(screen.getByTestId('status-line').dataset.kind).toBe('shadowed');
  });
});

/* ═══════════════════════ §5.6 被遮蔽解释框 + 一键修复 ═══════════════════════ */

describe('🔴 §5.6 · 被遮蔽解释框与一键修复', () => {
  const shadowedHarness = (extra: Partial<Harness> = {}): Harness => ({
    settings: settingsWith({ rules: [rule('*.weibo.*'), rule('*.com')] }),
    editingIndex: 1,
    // ADR-044:遮蔽关系取自 SW —— 0 号生效,1 号(在编辑的这条)被遮蔽。
    tabState: injectableTab({
      host: 'weibo.com',
      activeRuleIndex: 0,
      shadowedRuleIndexes: [1],
    }),
    ...extra,
  });

  it('琥珀解释框含序号、遮蔽者 pattern 与可点击的一键修复', () => {
    renderEdit(shadowedHarness());
    const box = screen.getByTestId('shadow-box');
    expect(box.textContent).toContain('第 1 条规则 *.weibo.* 排在前面,已先命中。');
    // §5.6:解释框是**琥珀底**。
    expectTokenRef('.shadow-box', 'background', '--warn-soft', '#FEF6E7');
    const fix = screen.getByTestId('move-to-top');
    expect(fix.textContent).toBe(MOVE_TO_TOP_LABEL);
    expect((fix as HTMLButtonElement).disabled).toBe(false);
  });

  it('不被遮蔽时不出现解释框', () => {
    renderEdit();
    expect(screen.queryByTestId('shadow-box')).toBeNull();
  });

  it('点一键修复 → 调用 onMoveToTop(顺序确实改变)', async () => {
    const onMoveToTop = vi.fn((): ActionResult => ok);
    renderEdit(shadowedHarness({ onMoveToTop }));
    fireEvent.click(screen.getByTestId('move-to-top'));
    await waitFor(() => {
      expect(onMoveToTop).toHaveBeenCalledWith(1);
    });
  });

  it('🔴 S13:点一键修复后立即推一帧预览 —— 当前页面渲染随之改变', async () => {
    const { spy } = renderEdit(
      shadowedHarness({
        settings: settingsWith({
          rules: [rule('*.weibo.*'), rule('*.com', 'BlueYellow', 60)],
        }),
      }),
    );
    const before = spy.filters().length;
    fireEvent.click(screen.getByTestId('move-to-top'));
    await waitFor(() => {
      expect(spy.filters().length).toBeGreaterThan(before);
    });
    // 推的必须是**本条**的滤镜 —— 这个按钮的全部意义就是改变用户看到的东西。
    expect(spy.filters().at(-1)).toEqual({
      type: PREVIEW_FILTER,
      mode: 'BlueYellow',
      intensity: 60,
    });
  });
});

/* ═══════════════════════ ADR-003 强度滑块 ═══════════════════════ */

describe('ADR-003 · 强度滑块', () => {
  it('边界 0 与 100 均可达', () => {
    renderEdit();
    const slider = screen.getByTestId('intensity-slider') as HTMLInputElement;
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('100');

    fireEvent.change(slider, { target: { value: '0' } });
    expect(slider.value).toBe('0');
    expect(screen.getByTestId('intensity-value').textContent).toBe('0%');

    fireEvent.change(slider, { target: { value: '100' } });
    expect(slider.value).toBe('100');
    expect(screen.getByTestId('intensity-value').textContent).toBe('100%');
  });

  it('强度 0 时预览值为 0 —— 页面视觉无变化(由 filterCssValue 保证)', () => {
    const { spy } = renderEdit();
    fireEvent.change(screen.getByTestId('intensity-slider'), {
      target: { value: '0' },
    });
    expect(spy.filters().at(-1)).toEqual({
      type: PREVIEW_FILTER,
      mode: 'Grayscale',
      intensity: 0,
    });
  });

  it('ADR-021:改强度后点保存,写入的是新强度', async () => {
    const onSave = vi.fn((): ActionResult => ok);
    renderEdit({ onSave });
    fireEvent.change(screen.getByTestId('intensity-slider'), {
      target: { value: '42' },
    });
    fireEvent.click(screen.getByTestId('save-button'));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        pattern: '*.weibo.*',
        mode: 'Grayscale',
        intensity: 42,
      });
    });
  });
});

/* ═══════════════════════ 🔴 ADR-049 实时预览 ═══════════════════════ */

describe('🔴 ADR-049 · 实时预览经 PREVIEW_FILTER 直推', () => {
  it('拖动滑块逐帧发送 PREVIEW_FILTER', () => {
    const { spy } = renderEdit();
    const slider = screen.getByTestId('intensity-slider');
    fireEvent.change(slider, { target: { value: '80' } });
    fireEvent.change(slider, { target: { value: '60' } });
    fireEvent.change(slider, { target: { value: '40' } });
    expect(spy.filters()).toEqual([
      { type: PREVIEW_FILTER, mode: 'Grayscale', intensity: 80 },
      { type: PREVIEW_FILTER, mode: 'Grayscale', intensity: 60 },
      { type: PREVIEW_FILTER, mode: 'Grayscale', intensity: 40 },
    ]);
  });

  it('换滤镜也立即推一帧(§5.7:拖动即改当前页面,无需确认)', () => {
    const { spy } = renderEdit();
    fireEvent.click(screen.getByTestId('filter-radio-GreenRed'));
    expect(spy.filters().at(-1)).toEqual({
      type: PREVIEW_FILTER,
      mode: 'GreenRed',
      intensity: 100,
    });
  });

  it('🔴 端口连的是 GET_TAB_STATE 给出的那个 tabId —— popup 不自己查 tab', () => {
    const { spy } = renderEdit({ tabState: injectableTab({ tabId: 31 }) });
    fireEvent.change(screen.getByTestId('intensity-slider'), {
      target: { value: '50' },
    });
    expect(spy.connects).toEqual([31]);
  });

  it('🔴 拖动滑块**不写 storage**(spy 断言:组件根本没有仓储依赖)', () => {
    // 结构性断言:`RuleEditView` 的 props 里没有 repository / storage。
    // 写入只能经 `onSave` / `onDelete` / `onMoveToTop` 三个回调,
    // 而拖动滑块一个都不会调 —— 下面用 spy 把这件事钉死。
    const onSave = vi.fn((): ActionResult => ok);
    const onDelete = vi.fn((): ActionResult => ok);
    const onMoveToTop = vi.fn((): ActionResult => ok);
    renderEdit({ onSave, onDelete, onMoveToTop });

    const slider = screen.getByTestId('intensity-slider');
    for (const v of ['90', '70', '50', '30', '10']) {
      fireEvent.change(slider, { target: { value: v } });
    }
    fireEvent.click(screen.getByTestId('filter-radio-RedGreen'));

    expect(onSave).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(onMoveToTop).not.toHaveBeenCalled();
  });

  it('§5.7:可用时提示行为绿点脉冲 + 「拖动时当前页面实时预览」', () => {
    renderEdit();
    const hint = screen.getByTestId('preview-hint');
    expect(hint.dataset.available).toBe('true');
    expect(screen.getByTestId('preview-hint-text').textContent).toBe(
      PREVIEW_LIVE_HINT,
    );
    const dot = screen.getByTestId('preview-dot');
    expect(dot.className).toContain('preview-dot--pulse');
    // §5.7:绿点 —— ok 色 + 脉冲动画。
    expectTokenRef('.preview-dot--pulse', 'background', '--ok', '#15803D');
    // 脉冲动画:声明的是 `animation` 简写(jsdom 不展开它),故断言原文。
    expect(declaredValue('.preview-dot--pulse', 'animation')).toContain(
      'preview-pulse',
    );
  });
});

/* ═══════ 🔴 四种不发送 PREVIEW_FILTER 的情况(F9/F11/I2) ═══════ */

describe('🔴 四种不发送 PREVIEW_FILTER 的情况', () => {
  const dragSlider = () => {
    fireEvent.change(screen.getByTestId('intensity-slider'), {
      target: { value: '55' },
    });
    fireEvent.change(screen.getByTestId('intensity-slider'), {
      target: { value: '35' },
    });
  };

  it('1. 主开关 OFF → 一条都不发,提示行置灰并改文案', () => {
    const { spy } = renderEdit({
      settings: settingsWith({ masterEnabled: false, rules: [rule('*.weibo.*')] }),
    });
    dragSlider();
    expect(spy.filters()).toHaveLength(0);
    expect(spy.connects).toHaveLength(0);
    const hint = screen.getByTestId('preview-hint');
    expect(hint.dataset.available).toBe('false');
    expect(hint.dataset.reason).toBe('master-off');
    expect(screen.getByTestId('preview-hint-text').textContent).toBe(
      PREVIEW_UNAVAILABLE_HINT,
    );
  });

  it('2. 当前页不可注入 → 一条都不发', () => {
    const { spy } = renderEdit({
      tabState: {
        tabId: null,
        injectable: false,
        reason: 'internal-page',
        host: null,
        activeRuleIndex: null,
        shadowedRuleIndexes: [],
      },
    });
    dragSlider();
    expect(spy.filters()).toHaveLength(0);
    expect(screen.getByTestId('preview-hint').dataset.reason).toBe(
      'not-injectable',
    );
  });

  it('🔴 3. pattern 不匹配当前页 → 一条都不发(绝不能把 B 站滤镜套到 A 站)', () => {
    const { spy } = renderEdit({
      settings: settingsWith({ rules: [rule('bilibili.com')] }),
      editingIndex: 0,
      // `bilibili.com` 匹配不了 a-station.com → SW 报无命中(ADR-044)。
      tabState: injectableTab({ host: 'a-station.com', activeRuleIndex: null }),
    });
    dragSlider();
    expect(spy.filters()).toHaveLength(0);
    expect(spy.connects).toHaveLength(0);
    expect(screen.getByTestId('preview-hint').dataset.reason).toBe(
      'pattern-mismatch',
    );
  });

  it('🔒 4. 锁定中 → 一条都不发(第四种条件,ADR-051)', () => {
    const { spy } = renderEdit({ locked: true });
    // 锁定中滑块本身也是禁用的,但即使绕过 disabled 直接派发事件也不得发送。
    fireEvent.change(screen.getByTestId('intensity-slider'), {
      target: { value: '55' },
    });
    expect(spy.filters()).toHaveLength(0);
    expect(screen.getByTestId('preview-hint').dataset.reason).toBe('locked');
  });

  it('§5.7:预览不可用时**滑块仍可改值**,只是不发送', () => {
    const { spy } = renderEdit({
      settings: settingsWith({ rules: [rule('bilibili.com')] }),
      editingIndex: 0,
      // `bilibili.com` 匹配不了 a-station.com → SW 报无命中(ADR-044)。
      tabState: injectableTab({ host: 'a-station.com', activeRuleIndex: null }),
    });
    const slider = screen.getByTestId('intensity-slider') as HTMLInputElement;
    expect(slider.disabled).toBe(false);
    fireEvent.change(slider, { target: { value: '33' } });
    expect(slider.value).toBe('33');
    expect(screen.getByTestId('intensity-value').textContent).toBe('33%');
    expect(spy.filters()).toHaveLength(0);
  });

  it('骨架态(未收到 GET_TAB_STATE)→ 不发送', () => {
    const { spy } = renderEdit({ tabState: null });
    fireEvent.change(screen.getByTestId('intensity-slider'), {
      target: { value: '55' },
    });
    expect(spy.filters()).toHaveLength(0);
    expect(screen.getByTestId('preview-hint').dataset.reason).toBe('skeleton');
  });
});

/* ═══════ 🔴 PREVIEW_CLEAR 的四条发送义务(B1) ═══════ */

describe('🔴🔴 B1 · PREVIEW_CLEAR 的发送义务(四条均须确实发送)', () => {
  const startPreview = () => {
    fireEvent.change(screen.getByTestId('intensity-slider'), {
      target: { value: '70' },
    });
  };

  it('1. 点「返回」—— popup 仍开着、端口未断,必须主动发(最容易漏的一条)', () => {
    const onBack = vi.fn();
    const { spy } = renderEdit({ onBack });
    startPreview();
    expect(spy.clears()).toHaveLength(0);

    fireEvent.click(screen.getByTestId('back-button'));

    expect(spy.clears()).toHaveLength(1);
    expect(spy.clears()[0]).toEqual({ type: PREVIEW_CLEAR });
    expect(onBack).toHaveBeenCalledTimes(1);
    // 🔴 端口**没有**断开 —— 这条义务靠主动发送履行,不是靠 onDisconnect。
    expect(spy.disconnects).toBe(0);
  });

  it('2. 点「保存」', async () => {
    const { spy } = renderEdit();
    startPreview();
    fireEvent.click(screen.getByTestId('save-button'));
    await waitFor(() => {
      expect(spy.clears()).toHaveLength(1);
    });
  });

  it('3. 点「删除」', async () => {
    const { spy } = renderEdit();
    startPreview();
    fireEvent.click(screen.getByTestId('delete-button'));
    await waitFor(() => {
      expect(spy.clears()).toHaveLength(1);
    });
  });

  it('🔴 4. pattern 改到不再匹配当前页的那一刻', () => {
    const { spy } = renderEdit({
      settings: settingsWith({ rules: [rule('*.weibo.*')] }),
      editingIndex: 0,
      tabState: injectableTab({ host: 'weibo.com' }),
    });
    startPreview();
    expect(spy.filters()).toHaveLength(1);
    expect(spy.clears()).toHaveLength(0);

    // 改成不再匹配 weibo.com。
    fireEvent.change(screen.getByTestId('pattern-input'), {
      target: { value: 'x.com' },
    });

    expect(spy.clears()).toHaveLength(1);
    expect(screen.getByTestId('preview-hint').dataset.reason).toBe(
      'pattern-mismatch',
    );
  });

  it('5.(追加)预览条件从可用变不可用 —— 锁定在编辑途中启动', () => {
    const { spy, rerender, channel } = renderEdit();
    startPreview();
    expect(spy.clears()).toHaveLength(0);

    rerender(
      <RuleEditView
        settings={settingsWith({ rules: [rule('*.weibo.*')] })}
        tabState={injectableTab()}
        editingIndex={0}
        previewChannel={channel}
        onSave={() => ok}
        onDelete={() => ok}
        onMoveToTop={() => ok}
        onBack={() => undefined}
        locked
      />,
    );

    expect(spy.clears()).toHaveLength(1);
  });

  it('没套过预览时点返回不白发消息(幂等)', () => {
    const { spy } = renderEdit();
    fireEvent.click(screen.getByTestId('back-button'));
    expect(spy.clears()).toHaveLength(0);
    expect(spy.messages).toHaveLength(0);
  });

  it('pattern 改回匹配 → 预览自动恢复(无需任何拖动)', () => {
    const { spy } = renderEdit({
      settings: settingsWith({ rules: [rule('*.weibo.*')] }),
      editingIndex: 0,
      tabState: injectableTab({ host: 'weibo.com' }),
    });
    const input = screen.getByTestId('pattern-input');
    fireEvent.change(input, { target: { value: 'x.com' } });
    const before = spy.filters().length;
    fireEvent.change(input, { target: { value: 'weibo.com' } });
    expect(spy.filters().length).toBe(before + 1);
    expect(screen.getByTestId('preview-hint').dataset.available).toBe('true');
  });

  it('组件卸载(popup 被销毁)也撤除 —— 双重保险', () => {
    const { spy, unmount } = renderEdit();
    startPreview();
    unmount();
    expect(spy.clears()).toHaveLength(1);
  });
});

/* ═══════════════════════ 保存 / 删除 / 返回 的完整行为 ═══════════════════════ */

describe('F20 / ADR-022 · 保存、删除与导航', () => {
  it('保存成功 → 返回列表视图', async () => {
    const onBack = vi.fn();
    renderEdit({ onBack });
    fireEvent.click(screen.getByTestId('save-button'));
    await waitFor(() => {
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  it('保存传出的 rule 是三元组 { pattern, mode, intensity }', async () => {
    const onSave = vi.fn((): ActionResult => ok);
    renderEdit({ editingIndex: null, settings: settingsWith({ rules: [] }), onSave });
    fireEvent.change(screen.getByTestId('pattern-input'), {
      target: { value: 'x.com' },
    });
    fireEvent.click(screen.getByTestId('filter-radio-BlueYellow'));
    fireEvent.change(screen.getByTestId('intensity-slider'), {
      target: { value: '55' },
    });
    fireEvent.click(screen.getByTestId('save-button'));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        pattern: 'x.com',
        mode: 'BlueYellow',
        intensity: 55,
      });
    });
  });

  it('ADR-046:保存失败 → 红色报错条,**留在编辑视图**,预览不撤', async () => {
    const onBack = vi.fn();
    const { spy } = renderEdit({
      editingIndex: null,
      settings: settingsWith({ rules: [] }),
      onSave: () => ({ ok: false, error: capacityError() }),
      onBack,
    });
    fireEvent.change(screen.getByTestId('pattern-input'), {
      target: { value: 'x.com' },
    });
    fireEvent.click(screen.getByTestId('save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('save-error')).toBeDefined();
    });
    expect(onBack).not.toHaveBeenCalled();
    expect(spy.clears()).toHaveLength(0);
    expect(screen.getByTestId('popup').dataset.view).toBe('edit');
  });

  it('删除 → 调 onDelete(index) → 发 PREVIEW_CLEAR → 返回列表', async () => {
    const onDelete = vi.fn((): ActionResult => ok);
    const onBack = vi.fn();
    const { spy } = renderEdit({
      settings: settingsWith({ rules: [rule('a.com'), rule('*.weibo.*')] }),
      editingIndex: 1,
      // `a.com` 匹配不了 weibo.com,故真实 SW 报 1 号生效(ADR-044)——
      // 预览需可用,才能验证删除时确实发了 PREVIEW_CLEAR。
      tabState: injectableTab({ activeRuleIndex: 1 }),
      onDelete,
      onBack,
    });
    fireEvent.change(screen.getByTestId('intensity-slider'), {
      target: { value: '70' },
    });
    fireEvent.click(screen.getByTestId('delete-button'));
    await waitFor(() => {
      expect(onBack).toHaveBeenCalledTimes(1);
    });
    expect(onDelete).toHaveBeenCalledWith(1);
    expect(spy.clears()).toHaveLength(1);
  });

  it('保存按钮禁用时点击不触发写入', () => {
    const onSave = vi.fn((): ActionResult => ok);
    renderEdit({ editingIndex: null, settings: settingsWith({ rules: [] }), onSave });
    fireEvent.click(screen.getByTestId('save-button'));
    expect(onSave).not.toHaveBeenCalled();
  });
});

/* ═══════════════════════ 🔒 ADR-051 锁定中 ═══════════════════════ */

describe('🔒 ADR-051 · 锁定中编辑视图全部控件禁用', () => {
  it('pattern 输入、四个滤镜、滑块、保存、删除、一键修复全部禁用', () => {
    renderEdit({
      settings: settingsWith({ rules: [rule('*.weibo.*'), rule('*.com')] }),
      editingIndex: 1,
      // ADR-044:遮蔽关系取自 SW,解释框才会渲染(一键修复按钮在框内)。
      tabState: injectableTab({
        host: 'weibo.com',
        activeRuleIndex: 0,
        shadowedRuleIndexes: [1],
      }),
      locked: true,
    });
    expect((screen.getByTestId('pattern-input') as HTMLInputElement).disabled).toBe(
      true,
    );
    for (const mode of ['Grayscale', 'RedGreen', 'GreenRed', 'BlueYellow']) {
      expect(
        (screen.getByTestId(`filter-radio-${mode}`) as HTMLInputElement).disabled,
      ).toBe(true);
    }
    expect(
      (screen.getByTestId('intensity-slider') as HTMLInputElement).disabled,
    ).toBe(true);
    expect((screen.getByTestId('save-button') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByTestId('delete-button') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByTestId('move-to-top') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('锁定中点击任一控件不产生任何写入(spy 断言)', () => {
    const onSave = vi.fn((): ActionResult => ok);
    const onDelete = vi.fn((): ActionResult => ok);
    const onMoveToTop = vi.fn((): ActionResult => ok);
    renderEdit({
      settings: settingsWith({ rules: [rule('*.weibo.*'), rule('*.com')] }),
      editingIndex: 1,
      // ADR-044:遮蔽关系取自 SW,解释框才会渲染(一键修复按钮在框内)。
      tabState: injectableTab({
        host: 'weibo.com',
        activeRuleIndex: 0,
        shadowedRuleIndexes: [1],
      }),
      locked: true,
      onSave,
      onDelete,
      onMoveToTop,
    });
    fireEvent.click(screen.getByTestId('save-button'));
    fireEvent.click(screen.getByTestId('delete-button'));
    fireEvent.click(screen.getByTestId('move-to-top'));
    expect(onSave).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(onMoveToTop).not.toHaveBeenCalled();
  });

  it('锁定中「返回」仍可用 —— 导航不是设置变更(ADR-022)', () => {
    const onBack = vi.fn();
    renderEdit({ locked: true, onBack });
    fireEvent.click(screen.getByTestId('back-button'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

/* ═══════════════════════ ADR-043 focus 态 ═══════════════════════ */

describe('ADR-043 · focus 态', () => {
  it('所有可聚焦元素走 tokens.css 的全局 focus-visible 规则,无组件覆盖', () => {
    renderEdit({
      settings: settingsWith({ rules: [rule('*.weibo.*'), rule('*.com')] }),
      editingIndex: 1,
      tabState: injectableTab({ host: 'weibo.com', activeRuleIndex: 0 }),
    });
    // 编辑视图自己的 CSS 里不得出现 outline 声明 —— 否则会盖掉 ADR-043 的 token。
    const focusables = document.querySelectorAll<HTMLElement>(
      'button, input, [tabindex]',
    );
    expect(focusables.length).toBeGreaterThan(0);
    for (const el of focusables) {
      // 内联或组件级 outline 覆盖会在这里暴露(非 focus 态下应为初始值)。
      expect(el.style.outline).toBe('');
    }
    expect(token('--focus-outline-width')).toBe('2px');
    expect(token('--focus-outline-offset')).toBe('2px');
  });
});

/* ═══════════════════════ 契约常量 ═══════════════════════ */

describe('ADR-049 · 契约常量只有一处', () => {
  it('端口名取自 preview-contract 的常量', () => {
    expect(PREVIEW_PORT_NAME).toBe('preview');
  });
});
