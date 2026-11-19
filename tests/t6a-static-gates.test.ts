/**
 * T6a 的**静态**门禁 —— 「一条 grep」级别的硬性检查,放在测试里以便持续生效。
 *
 * 与 `src/ui/__tests__/*` 的区别:那边断言**渲染结果**,这边断言**源码本身**。
 * 两者互为第二道防线 —— 渲染测试可能因为某个分支没被触发而漏掉,
 * 源码检查则不管分支。
 *
 * 覆盖 §6.1「🔴 已知冲突清单」中与 T6a 相关的各条,以及 ADR 的负向约束。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/** UI 的产品源码(不含测试 —— 测试里会出现被禁词作为**断言对象**)。 */
const UI_SOURCES = [
  ...walk(resolve(ROOT, 'src/ui')),
  ...walk(resolve(ROOT, 'entrypoints/popup')),
].filter((f) => !f.includes('__tests__'));

/**
 * 去掉注释后的源码。
 *
 * ⚠️ **这不是放宽门禁,而是把它瞄准正确的目标。**
 * 本项目要求在代码里引用 ADR 编号并写明理由(§8 第 1、3 条),于是
 * 「不得有删除线」这条约束的**解释文字本身**必然包含 `line-through` 一词。
 * 若连注释一起 grep,唯一的通过方式就是**删掉解释** —— 那恰好惩罚了
 * 文档纪律。故这里只检查**可执行的代码**,注释里的引用不算违规。
 *
 * 用户可见文案不会写在注释里,所以这不留口子:一个真的渲染了删除线的
 * 实现,其 CSS 声明仍然会被抓到。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // 块注释(含 JSDoc 与 CSS 注释)
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // 行注释(避开 URL 里的 //)
}

const uiText = () =>
  UI_SOURCES.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');

describe('🔴 §6.1 冲突第 1 条 · 被遮蔽行不得有删除线(ADR-032)', () => {
  it('UI 源码中不出现 line-through', () => {
    expect(uiText()).not.toContain('line-through');
  });

  it('CSS 里对被遮蔽行显式写了 text-decoration: none —— 是定点否决而非巧合', () => {
    const css = stripComments(readFileSync(resolve(ROOT, 'src/ui/popup.css'), 'utf8'));
    expect(css).toMatch(/\.rule--shadowed \.rule__pattern\s*\{[^}]*text-decoration:\s*none/);
  });
});

describe('🔴 §6.1 冲突第 2 条 · 标签文案为「此页未生效」(§5.3)', () => {
  it('UI 源码中不出现「被遮蔽」作为用户可见文案', () => {
    const strings = stripComments(
      readFileSync(resolve(ROOT, 'src/ui/components/RuleRow.tsx'), 'utf8'),
    );
    expect(strings).toContain('此页未生效');
    // 「被遮蔽」只允许出现在解释性注释里,不得作为 JSX 文本或字符串常量。
    expect(strings).not.toMatch(/SHADOWED_LABEL\s*=\s*'被遮蔽'/);
    expect(strings).not.toMatch(/>\s*被遮蔽\s*</);
  });
});

describe('🔴 §6.1 冲突第 5 条 · 渐变只能取 §5.2 表格中的值', () => {
  it('源码中不出现设计稿那个不在表内的渐变 #A8ACB1 → #DADDE1', () => {
    const text = uiText().toUpperCase();
    expect(text).not.toContain('#A8ACB1');
    expect(text).not.toContain('#DADDE1');
  });
});

describe('🔴 ADR-024 · 不提供「清空全部」', () => {
  it('UI 源码中不存在清空全部类入口', () => {
    const text = uiText();
    for (const banned of ['清空全部', '清空所有', 'clearAll', 'removeAllRules']) {
      expect(text, `出现了 ${banned}`).not.toContain(banned);
    }
  });
});

describe('🔴 ADR-009 · 无 per-rule 开关', () => {
  it('UI 源码中不存在 per-rule 的 enabled 字段或开关', () => {
    const text = uiText();
    for (const banned of ['rule.enabled', 'ruleEnabled', 'toggleRule', 'perRuleEnabled']) {
      expect(text, `出现了 ${banned}`).not.toContain(banned);
    }
  });
});

describe('🔴 ADR-015 · 无媒体/图片排除控件', () => {
  it('UI 源码中不存在媒体排除相关标识符', () => {
    const text = uiText();
    for (const banned of ['excludeMedia', 'excludeImages', 'skipVideo', '排除媒体']) {
      expect(text, `出现了 ${banned}`).not.toContain(banned);
    }
  });
});

describe('🔴 ADR-055 / INV-14 · 写入一律经仓储层', () => {
  it('UI 源码不直接调用 chrome.storage.*(那会绕开锁定强制)', () => {
    for (const file of UI_SOURCES) {
      const text = stripComments(readFileSync(file, 'utf8'));
      // 允许出现在注释里的说明性引用;禁止真实调用。
      expect(text, `${file} 直接调用了 chrome.storage`).not.toMatch(
        /(?<!\/\/.*)(?<!\* .*)chrome\.storage\.(local|sync)\.(get|set|remove|clear)\(/,
      );
    }
  });
});

describe('ADR-042 · 设计稿是前置条件,不得被 build agent 修改或重新生成', () => {
  it('本任务没有在仓内生成任何 popup 设计稿替代品', () => {
    const designDir = resolve(ROOT, 'docs/design');
    let entries: string[];
    try {
      entries = readdirSync(designDir);
    } catch {
      entries = [];
    }
    // 允许为空(设计稿由人类在主干提交);禁止出现自造的替代品。
    for (const entry of entries) {
      expect(entry, '出现了自造的设计稿替代品').toBe('popup-mockup.html');
    }
  });
});

describe('ADR-047 · 首版仅中文,不做 i18n', () => {
  it('UI 源码未引入任何 i18n 运行时', () => {
    const text = uiText();
    for (const banned of ['i18next', 'react-intl', 'FormattedMessage', 'chrome.i18n']) {
      expect(text, `出现了 ${banned}`).not.toContain(banned);
    }
  });
});

describe('§5.1 token 单一来源', () => {
  it('组件源码不内联硬编码 §5.1 的色值 —— 一律走 var(--token)', () => {
    const componentFiles = UI_SOURCES.filter((f) => f.endsWith('.tsx'));
    const tokenColors = [
      '#F2F3F5', '#FAFAFB', '#16181D', '#4B5563', '#8B919C',
      '#E4E6EA', '#EFF1F4', '#2563EB', '#EFF4FF', '#15803D',
      '#B45309', '#FEF6E7', '#B42318', '#FEF3F2',
    ];
    for (const file of componentFiles) {
      const text = stripComments(readFileSync(file, 'utf8')).toUpperCase();
      for (const color of tokenColors) {
        expect(text, `${file} 内联了 token 色值 ${color}`).not.toContain(color);
      }
    }
  });
});
