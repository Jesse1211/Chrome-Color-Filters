/**
 * 把真实的 `src/ui/*.css` 装进 jsdom,并提供**计算值**断言所需的工具。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ⚠️ **jsdom 的两个已知限制(申报为 blind spot,不掩盖)**
 *
 * 1. jsdom 的 `getComputedStyle` **不展开 `outline:` 简写** ——
 *    写成简写时 `outlineWidth/Style/Color` 全是空串。
 *    故 `tokens.css` 一律用**长写**(`outline-width` / `outline-style` /
 *    `outline-color`),这既让门禁可断言,也与 ADR-043 的语义完全等价。
 * 2. jsdom **不做 `var()` 代换** —— `outline-color: var(--accent)` 的计算值
 *    就是字符串 `var(--accent)`。但它**会**解析 `:root` 上的自定义属性值。
 *    因此 `resolveVars()` 显式做一次代换:
 *    「声明引用了 `--accent`」+「`--accent` 的值是 `#2563EB`」两段事实
 *    都被真实读取并断言,只是链路由测试而非 jsdom 串起来。
 *
 * 真实渲染层面的像素级验收属于 REAL_STACK_GATE(§8 第 8 条:
 * jsdom/mock 下的绿灯不构成通过),本工具不冒充它。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 读取一个 ui CSS 文件的原文(不解析 `@import`)。 */
export function readUiCss(file: string): string {
  return readFileSync(resolve(UI_DIR, file), 'utf8');
}

/**
 * 把 `tokens.css` + `popup.css` 注入当前 jsdom 文档。
 *
 * 展开 `@import` —— jsdom 不会自己去取。顺序与真实加载一致:token 在前。
 */
export function installPopupStyles(): HTMLStyleElement {
  const tokens = readUiCss('tokens.css');
  const popup = readUiCss('popup.css').replace(/@import[^;]+;/g, '');

  const style = document.createElement('style');
  style.setAttribute('data-testid', 'popup-styles');
  style.textContent = `${tokens}\n${popup}`;
  document.head.appendChild(style);
  return style;
}

/** 取 `:root` 上某个设计 token 的值(jsdom 支持自定义属性)。 */
export function token(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/** 把一个计算值里的 `var(--x)` 代换为 `:root` 上的实际 token 值。 */
export function resolveVars(value: string): string {
  return value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_match, name: string) =>
    token(name),
  );
}

/** 取某元素某属性的计算值,并做一次 `var()` 代换。 */
export function computed(element: Element, property: string): string {
  const raw = getComputedStyle(element).getPropertyValue(property).trim();
  return resolveVars(raw);
}

/** `#RRGGBB` → `rgb(r, g, b)`,便于与 jsdom 归一化后的颜色比较。 */
export function hexToRgb(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) throw new Error(`不是 6 位十六进制色值: ${hex}`);
  const n = parseInt(m[1], 16);
  return `rgb(${String((n >> 16) & 255)}, ${String((n >> 8) & 255)}, ${String(n & 255)})`;
}

/**
 * 读取**样式表里声明的**某条规则的某个属性原文(未经 jsdom 计算)。
 *
 * 用于断言「这条声明确实写着 `var(--accent)`」这类结构性事实 ——
 * 配合 `token()` 即可把「引用」与「取值」两段都钉死。
 */
export function declaredValue(
  selectorText: string,
  property: string,
): string | null {
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      if (rule.selectorText !== selectorText) continue;
      const value = rule.style.getPropertyValue(property).trim();
      if (value) return value;
    }
  }
  return null;
}
