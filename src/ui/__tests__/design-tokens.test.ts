// @vitest-environment jsdom
/**
 * T6a gate:**popup 尺寸 360×452px;配色 token 与 §5.1 逐值一致
 * (断言计算后的颜色值)**;四个滤镜渐变色值与 §5.2 表格完全一致。
 *
 * 视觉层的权威是仓内 `docs/design/popup-mockup.html`(ADR-042),
 * 而 §5.1 的色值表与设计稿在本文件覆盖的范围内完全吻合 —— 两者同时满足。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { FILTER_IDENTITY, swatchGradient } from '../filter-identity.js';
import { FILTER_MODES } from '../../domain/filter-mode.js';
import {
  computed,
  declaredValue,
  hexToRgb,
  installPopupStyles,
  readUiCss,
  token,
} from './css-harness.js';

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
  installPopupStyles();
});

/** §5.1 浅色 token,逐值誊写自 DESIGN.md。 */
const LIGHT_TOKENS: ReadonlyArray<readonly [string, string]> = [
  ['--ground', '#F2F3F5'],
  ['--surface', '#FFFFFF'],
  ['--surface-2', '#FAFAFB'],
  ['--ink', '#16181D'],
  ['--ink-2', '#4B5563'],
  ['--muted', '#8B919C'],
  ['--line', '#E4E6EA'],
  ['--line-2', '#EFF1F4'],
  ['--accent', '#2563EB'],
  ['--accent-soft', '#EFF4FF'],
  ['--ok', '#15803D'],
  ['--warn', '#B45309'],
  ['--warn-soft', '#FEF6E7'],
  ['--bad', '#B42318'],
  ['--bad-soft', '#FEF3F2'],
];

/** §5.1 深色 token,逐值誊写自 DESIGN.md。 */
const DARK_TOKENS: ReadonlyArray<readonly [string, string]> = [
  ['--ground', '#101216'],
  ['--surface', '#1A1D23'],
  ['--surface-2', '#15181D'],
  ['--ink', '#E8EAEE'],
  ['--ink-2', '#AFB6C0'],
  ['--muted', '#737A86'],
  ['--line', '#2A2E36'],
  ['--line-2', '#23272E'],
  ['--accent', '#6195F5'],
  ['--accent-soft', '#1B2740'],
  ['--ok', '#4ADE80'],
  ['--warn', '#E0A33E'],
  ['--warn-soft', '#2E2412'],
  ['--bad', '#F07167'],
  ['--bad-soft', '#2E1817'],
];

describe('§5.1 设计 Token — 浅色', () => {
  it.each(LIGHT_TOKENS)('%s === %s', (name, expected) => {
    expect(token(name).toUpperCase()).toBe(expected.toUpperCase());
  });
});

describe('§5.1 设计 Token — 深色(OQ-05:按系统偏好适配,设计稿已含深色 token)', () => {
  it.each(DARK_TOKENS)('%s === %s', (name, expected) => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(token(name).toUpperCase()).toBe(expected.toUpperCase());
  });

  it('深色与浅色是两套**不同**的值 —— 不是同一套换了个选择器', () => {
    const light = new Map(LIGHT_TOKENS);
    for (const [name, dark] of DARK_TOKENS) {
      expect(dark.toUpperCase(), `${name} 深浅同值`).not.toBe(
        light.get(name)?.toUpperCase(),
      );
    }
  });

  it('`prefers-color-scheme: dark` 的媒体查询存在,且带 `[data-theme="light"]` 逃生舱', () => {
    const css = readUiCss('tokens.css');
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)/);
    expect(css).toMatch(/:root:not\(\[data-theme='light'\]\)/);
  });
});

/*
 * 🔴 tokens.css 的规矩:「色值**只在此处定义一次**。组件一律引用 var(--token),
 * 不得内联硬编码色值,否则深色模式(OQ-05)会出现**漏网的浅色残留**。」
 *
 * T6b 的编辑视图引入了 radio 灰环、滑块把手、色块发丝边、主按钮前景色 ——
 * 这些是已有 token 覆盖不到的值。它们被收进 tokens.css 并在深浅两套里
 * 各定义一次;下面这组用例守的就是「真的两套都有、且真的不同」。
 */
describe('🔴 T6b 控件 token — 深色模式不得留下浅色残留(OQ-05)', () => {
  const CONTROL_TOKENS = ['--control-ring', '--control-knob'] as const;

  it.each(CONTROL_TOKENS)('%s 深浅两套取值**不同**', (name) => {
    document.documentElement.removeAttribute('data-theme');
    const light = token(name).toUpperCase();
    document.documentElement.setAttribute('data-theme', 'dark');
    const dark = token(name).toUpperCase();

    expect(light).not.toBe('');
    expect(dark).not.toBe('');
    expect(dark, `${name} 深浅同值 —— 深色模式会留下浅色残留`).not.toBe(light);
  });

  it('滑块把手在深色下不再是纯白(那正是「漏网的浅色残留」)', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(token('--control-knob').toUpperCase()).not.toBe('#FFFFFF');
  });

  it('`--on-accent` 两套**故意同值** —— accent 上的前景色不随主题翻转', () => {
    document.documentElement.removeAttribute('data-theme');
    const light = token('--on-accent').toUpperCase();
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(token('--on-accent').toUpperCase()).toBe(light);
  });

  it('🔴 T6b 新增的编辑视图 CSS 不内联硬编码色值', () => {
    const css = readUiCss('popup.css');
    // 取 `.option__radio` 之后的区段 —— 即 T6b 新增的那一块。
    const t6bBlock = css.slice(css.indexOf('.option__radio'));
    expect(t6bBlock.length).toBeGreaterThan(0);
    for (const selector of [
      '.option__radio',
      '.option__swatch',
      '.slider::-webkit-slider-thumb',
      '.slider::-moz-range-thumb',
      '.edit__save',
    ]) {
      expect(t6bBlock, `${selector} 不在 T6b 区段内`).toContain(selector);
    }
    // 十六进制字面量(#RGB / #RRGGBB)在这一区段内应当不存在。
    const hexLiterals = t6bBlock.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexLiterals, `发现硬编码色值:${hexLiterals.join(', ')}`).toEqual([]);
  });
});

describe('§5.1 尺寸 — popup 360 × 452px(固定,OQ-06)', () => {
  it('token 值为 360px / 452px', () => {
    expect(token('--popup-width')).toBe('360px');
    expect(token('--popup-height')).toBe('452px');
  });

  it('body 与 .popup 的计算宽高取自 token', () => {
    const popup = document.createElement('div');
    popup.className = 'popup';
    document.body.appendChild(popup);

    expect(computed(document.body, 'width')).toBe('360px');
    expect(computed(document.body, 'height')).toBe('452px');
    expect(computed(popup, 'width')).toBe('360px');
    expect(computed(popup, 'height')).toBe('452px');
  });
});

describe('§5.1 圆角 — 卡片 12px · 控件 7–9px · 色块 4px', () => {
  it('token 值与设计稿一致', () => {
    expect(token('--radius-card')).toBe('12px');
    expect(token('--radius-control')).toBe('9px');
    expect(token('--radius-control-sm')).toBe('7px');
    expect(token('--radius-swatch')).toBe('4px');
  });

  it('控件圆角落在 7–9px 区间内', () => {
    for (const name of ['--radius-control', '--radius-control-sm']) {
      const px = Number.parseFloat(token(name));
      expect(px).toBeGreaterThanOrEqual(7);
      expect(px).toBeLessThanOrEqual(9);
    }
  });
});

describe('§5.1 字体', () => {
  it('UI 字体为系统 UI 栈(-apple-system / PingFang SC / Microsoft YaHei)', () => {
    const stack = token('--font-ui');
    expect(stack).toContain('-apple-system');
    expect(stack).toContain('PingFang SC');
    expect(stack).toContain('Microsoft YaHei');
  });

  it('ADR-033:等宽栈含 ui-monospace / Menlo', () => {
    const stack = token('--font-mono');
    expect(stack).toContain('ui-monospace');
    expect(stack).toContain('Menlo');
  });

  it('百分比用 tabular-nums(§5.1)', () => {
    const el = document.createElement('span');
    el.className = 'rule__intensity';
    document.body.appendChild(el);
    expect(computed(el, 'font-variant-numeric')).toBe('tabular-nums');
  });
});

describe('§5.2 滤镜渐变 — 与表格完全一致', () => {
  const EXPECTED = {
    Grayscale: ['#9AA0A6', '#D5D8DC', '灰阶', '完全去除色彩'],
    RedGreen: ['#C25B4E', '#5B9E55', '红绿', '红色弱 · 红绿色觉辅助'],
    GreenRed: ['#5B9E55', '#C25B4E', '绿红', '绿色弱 · 红绿色觉辅助'],
    BlueYellow: ['#4C6FD4', '#D9C25A', '蓝黄', '蓝黄色觉辅助'],
  } as const;

  it.each(FILTER_MODES)('%s 的渐变、名称、副标题逐值一致', (mode) => {
    const [from, to, name, subtitle] = EXPECTED[mode];
    const identity = FILTER_IDENTITY[mode];
    expect(identity.gradientFrom.toUpperCase()).toBe(from);
    expect(identity.gradientTo.toUpperCase()).toBe(to);
    expect(identity.name).toBe(name);
    expect(identity.subtitle).toBe(subtitle);
  });

  it.each(FILTER_MODES)('%s 的色块计算后的 background-image 与表格色值一致', (mode) => {
    const el = document.createElement('span');
    el.className = 'swatch';
    el.style.background = swatchGradient(mode);
    document.body.appendChild(el);

    const [from, to] = EXPECTED[mode];
    expect(computed(el, 'background-image')).toBe(
      `linear-gradient(90deg, ${hexToRgb(from)}, ${hexToRgb(to)})`,
    );
  });

  it('🔴 §6.1 冲突第 5 条:设计稿的 #A8ACB1→#DADDE1 不在 §5.2 表内,代码中不得出现', () => {
    const sources = [readUiCss('tokens.css'), readUiCss('popup.css')].join('\n');
    for (const banned of ['#A8ACB1', '#DADDE1']) {
      expect(sources.toUpperCase()).not.toContain(banned);
    }
    const identities = JSON.stringify(FILTER_IDENTITY).toUpperCase();
    for (const banned of ['#A8ACB1', '#DADDE1']) {
      expect(identities).not.toContain(banned);
    }
  });

  it('红绿与绿红的渐变**互为反向** —— 正因如此色块不能单独承载语义(ADR-030)', () => {
    expect(FILTER_IDENTITY.RedGreen.gradientFrom).toBe(
      FILTER_IDENTITY.GreenRed.gradientTo,
    );
    expect(FILTER_IDENTITY.RedGreen.gradientTo).toBe(
      FILTER_IDENTITY.GreenRed.gradientFrom,
    );
  });
});

describe('ADR-043 · focus 态固定为 outline 2px solid var(--accent) + offset 2px', () => {
  it('token 值固定', () => {
    expect(token('--focus-outline-width')).toBe('2px');
    expect(token('--focus-outline-offset')).toBe('2px');
  });

  it('全局 :focus-visible 规则的声明引用 --accent,且长写三件套齐全', () => {
    const selector =
      ':where(a, button, input, select, textarea, summary, [tabindex]):focus-visible';
    expect(declaredValue(selector, 'outline-width')).toBe(
      'var(--focus-outline-width)',
    );
    expect(declaredValue(selector, 'outline-style')).toBe('solid');
    expect(declaredValue(selector, 'outline-color')).toBe('var(--accent)');
    expect(declaredValue(selector, 'outline-offset')).toBe(
      'var(--focus-outline-offset)',
    );
  });

  it('代换 token 后即为 2px / solid / accent 的 rgb 值', () => {
    const selector =
      ':where(a, button, input, select, textarea, summary, [tabindex]):focus-visible';
    const width = declaredValue(selector, 'outline-width') ?? '';
    const color = declaredValue(selector, 'outline-color') ?? '';
    const offset = declaredValue(selector, 'outline-offset') ?? '';

    const probe = document.createElement('div');
    probe.style.setProperty('outline-width', width);
    probe.style.setProperty('outline-style', 'solid');
    probe.style.setProperty('outline-color', token('--accent'));
    probe.style.setProperty('outline-offset', offset.replace(/var\([^)]+\)/, token('--focus-outline-offset')));
    document.body.appendChild(probe);

    expect(computed(probe, 'outline-width')).toBe('2px');
    expect(computed(probe, 'outline-style')).toBe('solid');
    expect(computed(probe, 'outline-color')).toBe(hexToRgb('#2563EB'));
    expect(computed(probe, 'outline-offset')).toBe('2px');
    expect(color).toBe('var(--accent)');
  });
});
