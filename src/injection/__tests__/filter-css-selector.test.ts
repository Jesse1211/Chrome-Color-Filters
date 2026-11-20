/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **注入目标必须锁定在 `<html>`** —— INV-1 最脆弱的一点,直接堵上一轮变异测试
 *    暴露的盲区(DESIGN.md §6 T4a gate 逐字要求)。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 上一轮的盲区(真实发生过,不是假想)
 *
 * 把 `filter.css` 的主规则从 `html[data-ccf-on]` 改成 `body[data-ccf-on]` 后,
 * **单元测试全绿 296/296**。原因:旧断言是
 *
 * ```ts
 * expect(css).toMatch(/html\[data-ccf-on\]/)   // ❌ 子串匹配
 * ```
 *
 * 而紧随其后的 **top-layer 补偿规则**(`html[data-ccf-on] :modal` 等)里
 * 仍然含有 `html[data-ccf-on]` 这个子串 —— 于是子串断言照样通过,
 * 主规则已经换成 body 也浑然不觉。只有 10 分钟的真实 Chrome 门禁抓到了它。
 *
 * ## 为什么这个回归是致命的
 *
 * CSS Filter Effects 对**根元素**有特例:根元素的 filter 作用于视口传播的结果,
 * **不为 `position:fixed` 后代建立 containing block**(T0 spike §3.1 实测 dx=0,dy=0)。
 * 换成 `<body>` 该特例不适用 —— fixed 后代全部退化为相对 body 定位,
 * **T0 实测固定头部跑到 y=-1000**(§4.3)。那是 INV-1 的彻底破裂。
 *
 * ## 本文件的做法:把 CSS **解析成规则**,对选择器做**精确**匹配
 *
 * 不再用任何子串/正则 `toMatch`。先把样式表切成 `{selector, body}` 列表,
 * 再定位「那条把 `filter` 赋给一个元素本身的主规则」,断言它的选择器
 * **全等于** `html[data-ccf-on]`。这样:
 *
 * - 主规则改 `body[data-ccf-on]` → 立即红(选择器不等);
 * - top-layer 规则里含 `html[...]` 子串也救不了它(它们带后代部分,不是主规则);
 * - 整张表里任何位置出现 `body` 的 filter 规则 → 立即红。
 *
 * 单元层抓住它,就不必每次都掏 10 分钟跑真实栈。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../filter.css',
);

interface CssRule {
  readonly selector: string;
  readonly body: string;
}

/**
 * 极小的 CSS 规则切分器 —— 够用即可,不追求通用性。
 *
 * 先剥掉注释(注释里有大量示意性的 `html[...]` / `body{filter}` 文字,
 * 不剥掉就会把文档本身当成规则读进来,那正是子串断言失足的同一类错误),
 * 再按 `{}` 切成 `选择器 / 声明块` 对。
 *
 * 本样式表不含 `@media` / 嵌套,故无需处理它们;真要引入时这里会先崩,
 * 那是正确的提醒,不是脆弱。
 */
function parseRules(css: string): CssRule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutComments)) !== null) {
    rules.push({
      selector: m[1]!.trim().replace(/\s+/g, ' '),
      body: m[2]!.trim(),
    });
  }
  return rules;
}

/** 把逗号分隔的选择器列表拆成单个选择器。 */
function selectorList(rule: CssRule): string[] {
  return rule.selector.split(',').map((s) => s.trim().replace(/\s+/g, ' '));
}

const CSS = readFileSync(CSS_PATH, 'utf8');
const RULES = parseRules(CSS);

describe('🔴 filter.css 注入目标锁定(INV-1 / T0 §1 §4.3 / 变异测试盲区)', () => {
  it('样式表能被解析出规则 —— 解析器失效会让下面所有断言变成空转', () => {
    // 这是**判别器**:若 parseRules 某天因格式变化而返回空数组,
    // 后续的 "every/find" 断言会全部空洞地通过。先把它钉死。
    expect(RULES.length).toBeGreaterThan(0);
    expect(RULES.every((r) => r.selector.length > 0)).toBe(true);
    expect(RULES.every((r) => r.body.includes('filter'))).toBe(true);
  });

  it('🔴 主规则(给元素自身赋 filter 的那条)的选择器**精确**为 `html[data-ccf-on]`', () => {
    // 主规则 = 选择器里没有后代/伪元素部分的那条,即作用于注入目标本身。
    const mainRules = RULES.filter((r) =>
      selectorList(r).some((sel) => !sel.includes(' ') && !sel.includes('::')),
    );

    expect(mainRules, '找不到作用于元素自身的主滤镜规则').toHaveLength(1);

    const selectors = selectorList(mainRules[0]!);
    // 🔴 精确相等,不是 toMatch/toContain —— 子串匹配正是上一轮的盲区。
    expect(selectors).toEqual(['html[data-ccf-on]']);
    expect(mainRules[0]!.body).toContain('filter: var(--ccf-filter)');
  });

  it('🔴 整张表中**不存在**任何 body 作为滤镜宿主的规则（T0 实测 y=-1000）', () => {
    for (const rule of RULES) {
      for (const sel of selectorList(rule)) {
        expect(
          sel,
          `选择器 "${sel}" 把 filter 挂到了 body —— T0 §4.3 实测固定头部会跳到 y=-1000`,
        ).not.toMatch(/(^|[\s>+~])body\b/);
      }
    }
    // 另一种写法:`body{filter}` 直接出现在源码里(注释已被剥除)。
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).not.toMatch(/body\s*\[?[^{]*\{[^}]*filter/);
  });

  it('🔴 每条规则的滤镜宿主都是 `html[data-ccf-on]` 门控的（INV-8:属性不在就全不生效）', () => {
    // 门控属性由 JS 在拿到判定后才加。任何一条规则漏掉门控,
    // 就会在主开关 OFF / 无规则命中时仍然染色 —— 直接违反 INV-8。
    for (const rule of RULES) {
      for (const sel of selectorList(rule)) {
        expect(sel, `选择器 "${sel}" 缺少 html[data-ccf-on] 门控`).toMatch(
          /^html\[data-ccf-on\]( |$)/,
        );
      }
    }
  });

  it('top-layer 补偿规则齐全,且它们是**后代/伪元素**规则而非主规则(T0 §4.5)', () => {
    // modal/popover/fullscreen 在绘制树中不是根元素的后代,根 filter 到不了它们。
    const toplayer = RULES.filter((r) =>
      selectorList(r).every((sel) => sel.includes(' ') || sel.includes('::')),
    );
    expect(toplayer).toHaveLength(1);
    const sels = selectorList(toplayer[0]!);
    for (const needed of [
      'html[data-ccf-on] :modal',
      'html[data-ccf-on] [popover]:popover-open',
      'html[data-ccf-on] :fullscreen',
      'html[data-ccf-on] ::backdrop',
    ]) {
      expect(sels, `top-layer 补偿缺少 ${needed}`).toContain(needed);
    }
  });

  it('滤镜值一律取自 `var(--ccf-filter)` —— 样式表里不得写死任何具体滤镜(ADR-025)', () => {
    for (const rule of RULES) {
      expect(rule.body).toContain('var(--ccf-filter)');
      // 派生值(grayscale(...) / feColorMatrix / data: URI)绝不能固化进静态表:
      // 那会产生独立于设置的第二份真相。
      expect(rule.body).not.toMatch(/grayscale\(|feColorMatrix|data:image/);
    }
  });
});
