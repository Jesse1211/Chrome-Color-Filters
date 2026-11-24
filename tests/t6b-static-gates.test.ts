/**
 * T6b 的**静态**门禁 —— 对**源码本身**的硬性检查(与 t6a/t6c 同名文件同构)。
 *
 * 与 `src/ui/__tests__/rule-edit-view.test.tsx` 的区别:那边断言**渲染结果**,
 * 这边断言**源码**。两者互为第二道防线 —— 渲染测试可能因为某个分支没被触发
 * 而漏掉,源码检查则不管分支。
 *
 * 覆盖 §6 T6b gate 的负向约束与 ADR-049 / ADR-001 / ADR-028 的反模式。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

/** 编辑视图相关的产品源码。 */
const EDIT_SOURCES = UI_SOURCES.filter((f) =>
  /RuleEditView|FilterModeOption|pattern-status|preview-port|usePreview|edit-strings/.test(
    f,
  ),
);

/**
 * 去掉注释后的源码。
 *
 * ⚠️ **这不是放宽门禁,而是把它瞄准正确的目标**(与 t6a/t6c 同名函数同一理由)。
 * 本项目要求在代码里引用 ADR 编号并写明理由(§8 第 1、3 条),于是
 * 「不得有 Color Tint」这条约束的**解释文字本身**必然包含那个词。
 * 若连注释一起 grep,唯一的通过方式就是**删掉解释** —— 那恰好惩罚了文档纪律。
 *
 * 用户可见文案不会只写在注释里,所以这不留口子:真的渲染出一个 Hue 滑块的
 * 实现,其 JSX 仍会被抓到。渲染层另有 `rule-edit-view.test.tsx` 的 DOM 级断言兜底。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const uiText = () =>
  UI_SOURCES.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');

const editText = () =>
  EDIT_SOURCES.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');

/* ════════════════ 🔴 ADR-049 · popup 不得自己解析 tab ════════════════ */

describe('🔴 ADR-049 · tabId 一律来自 GET_TAB_STATE,popup 不得自己查 tab', () => {
  it('UI 产品源码中不出现 chrome.tabs.query', () => {
    expect(uiText()).not.toContain('tabs.query');
  });

  it('UI 产品源码中不出现 chrome.tabs.getCurrent / getSelected 之类的替代路径', () => {
    const text = uiText();
    for (const banned of [
      'tabs.getCurrent',
      'tabs.getSelected',
      'tabs.get(',
      'tabs.queryAsync',
    ]) {
      expect(text, `UI 源码出现了 ${banned}`).not.toContain(banned);
    }
  });

  it('预览发送端只用 chrome.tabs.connect(ADR-049 明文路由)', () => {
    const source = readFileSync(resolve(ROOT, 'src/ui/preview-port.ts'), 'utf8');
    expect(stripComments(source)).toContain('tabs.connect');
  });

  it('🔴 不经 service worker 中转 —— 预览源码不出现 runtime.sendMessage', () => {
    /*
     * ADR-049 / §6 T4b:「**不经 service worker 中转** —— 否则 T5 进入预览路径,
     * 而 T5 并非 T6b 的上游」。`runtime.sendMessage` 会把消息送给 SW,
     * 那正是被禁止的那条路。
     */
    expect(stripComments(readFileSync(resolve(ROOT, 'src/ui/preview-port.ts'), 'utf8')))
      .not.toContain('runtime.sendMessage');
  });
});

/* ════════════════ 🔴 ADR-049 · 预览不写存储 ════════════════ */

describe('🔴 ADR-049 · 预览路径物理上无处落盘', () => {
  it('预览发送端的源码里没有任何存储 API', () => {
    const source = stripComments(
      readFileSync(resolve(ROOT, 'src/ui/preview-port.ts'), 'utf8'),
    );
    for (const banned of [
      'chrome.storage',
      'localStorage',
      'sessionStorage',
      'SettingsRepository',
      'repository',
    ]) {
      expect(source, `preview-port 出现了 ${banned}`).not.toContain(banned);
    }
  });

  it('usePreview 的源码里没有任何存储 API', () => {
    const source = stripComments(
      readFileSync(resolve(ROOT, 'src/ui/usePreview.ts'), 'utf8'),
    );
    for (const banned of [
      'chrome.storage',
      'localStorage',
      'sessionStorage',
      'SettingsRepository',
      'repository',
    ]) {
      expect(source, `usePreview 出现了 ${banned}`).not.toContain(banned);
    }
  });

  it('编辑视图不直接 import 仓储层 —— 写入一律经 props 回调(INV-14 / ADR-055)', () => {
    const source = readFileSync(resolve(ROOT, 'src/ui/RuleEditView.tsx'), 'utf8');
    expect(source).not.toContain("from '../storage/settings-repository.js'");
    expect(stripComments(source)).not.toContain('chrome.storage');
  });
});

/* ════════════════ 🔴 ADR-028 · 无 Color Tint / 无 Hue ════════════════ */

describe('🔴 ADR-028 · 无 Color Tint 选项,无 Hue 滑块', () => {
  it('编辑视图源码不出现 ColorTint / Tint / Hue / 色调 / 色相', () => {
    const text = editText();
    for (const banned of ['ColorTint', 'Tint', 'Hue', '色调', '色相']) {
      expect(text, `编辑视图源码出现了 ${banned}`).not.toContain(banned);
    }
  });

  // 🔴 ADR-075:编辑视图不再有模式选项(只剩一个模式)。本条原本防的是
  //    「有人手写第五项把 Color Tint 加回来」—— 该风险转移到**领域层**:
  //    现在只要 FILTER_MODES 本身不含 Tint,UI 就无从渲染它。
  it('领域层的 FILTER_MODES 只含 Grayscale —— 不存在被手写加回的第五项', () => {
    const source = stripComments(
      readFileSync(resolve(ROOT, 'src/domain/filter-mode.ts'), 'utf8'),
    );
    for (const banned of ['ColorTint', 'Tint', 'Hue', 'RedGreen', 'GreenRed', 'BlueYellow']) {
      expect(source, `领域层出现了已删除的模式 ${banned}`).not.toContain(banned);
    }
    expect(source).toContain('Grayscale');
  });

  it('编辑视图只有一个 range 输入(强度),源码里不存在第二个', () => {
    const source = stripComments(
      readFileSync(resolve(ROOT, 'src/ui/RuleEditView.tsx'), 'utf8'),
    );
    const matches = source.match(/type="range"/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

/* ════════════════ 🔴 ADR-001 · 无「使用当前网站」自动填充 ════════════════ */

describe('🔴 ADR-001 · 规则由用户手动输入,不绑定当前 tab', () => {
  it('编辑视图源码不出现任何「用当前网站填充」类文案或标识符', () => {
    const text = editText();
    for (const banned of [
      '使用当前网站',
      '使用本站',
      '填入当前',
      '当前网址',
      'useCurrentHost',
      'fillCurrentHost',
      'autofillHost',
      'prefillHost',
    ]) {
      expect(text, `编辑视图源码出现了 ${banned}`).not.toContain(banned);
    }
  });

  it('新建时的 pattern 初值是空串,不是 tabState.host', () => {
    const source = stripComments(
      readFileSync(resolve(ROOT, 'src/ui/RuleEditView.tsx'), 'utf8'),
    );
    // ADR-020:输入框为空。初值表达式里不得掺入 host。
    expect(source).toContain("useState<string>(existing?.pattern ?? '')");
  });
});

/* ════════════════ 🔴 I2 · 预览与锁定永不共存 ════════════════ */

describe('🔴 I2 · 编辑视图不得有锁定入口(预览与锁定永不共存)', () => {
  it('编辑视图不 import 任何锁定 UI 组件', () => {
    const source = readFileSync(resolve(ROOT, 'src/ui/RuleEditView.tsx'), 'utf8');
    for (const banned of [
      'LockTimerEntry',
      'LockCountdownBanner',
      'LockDurationPicker',
      'LockConfirmDialog',
      'useLockState',
      'useLockClock',
    ]) {
      expect(source, `编辑视图 import 了 ${banned}`).not.toContain(banned);
    }
  });

  it('编辑视图不含启动/延长锁定的标识符', () => {
    const text = stripComments(
      readFileSync(resolve(ROOT, 'src/ui/RuleEditView.tsx'), 'utf8'),
    );
    for (const banned of ['startLock', 'extendLock', 'lockUntil', 'lockBanner', 'lockEntry']) {
      expect(text, `编辑视图出现了 ${banned}`).not.toContain(banned);
    }
  });

  it('🔴 ADR-052 / INV-12:编辑视图源码里不存在任何解除锁定的实现', () => {
    const text = editText();
    for (const banned of ['解除锁定', '解锁', '取消锁定', '结束锁定', '缩短']) {
      expect(text, `编辑视图出现了 ${banned}`).not.toContain(banned);
    }
  });
});

/* ════════════════ §6.1 冲突清单与共享基础 ════════════════ */

describe('§6.1 / §5.2 · 共享基础的复用', () => {
  it('🔴 §6.1 冲突第 5 条:编辑视图不得出现表外的 #A8ACB1→#DADDE1 渐变', () => {
    const text = editText().toUpperCase();
    for (const banned of ['#A8ACB1', '#DADDE1']) {
      expect(text).not.toContain(banned);
    }
  });

  // 🔴 ADR-075:模式单选组(`FilterModeOption`)已随三个色觉滤镜一并删除 ——
  //    只剩一个模式时单选组是无意义的控件。ADR-030 的两条约束**不随之作废**,
  //    它们转由列表视图的 `FilterSwatch` 承载(账本 §5.2 的注记要求将来加回
  //    色觉滤镜时必须同时恢复)。故下面两条门禁改为盯住 `FilterSwatch`,
  //    **而不是删掉** —— 删掉等于让「色块不得无名出现」这条约束静默失守。
  it('🔴 ADR-030:色块渐变取自 swatchGradient,不内联色值', () => {
    const source = stripComments(
      readFileSync(resolve(ROOT, 'src/ui/components/FilterSwatch.tsx'), 'utf8'),
    );
    expect(source).toContain('swatchGradient(mode)');
    // 内联 hex 色值会绕开 §5.2 的单一来源。
    expect(source).not.toMatch(/#[0-9A-Fa-f]{6}/);
  });

  it('🔴 ADR-030:色块必须与名称同时渲染 —— 色块绝不单独出现', () => {
    const source = stripComments(
      readFileSync(resolve(ROOT, 'src/ui/components/FilterSwatch.tsx'), 'utf8'),
    );
    expect(source).toContain('identity.name');
  });

  it('🔴 ADR-075:模式单选组已删除,编辑视图不得再出现模式选择控件', () => {
    expect(
      existsSync(resolve(ROOT, 'src/ui/components/FilterModeOption.tsx')),
    ).toBe(false);
    const text = editText();
    // 单选控件的痕迹:radio role / name 分组 / 模式数组遍历。
    expect(text).not.toContain('role="radio"');
    expect(text).not.toContain('FilterModeOption');
  });

  it('ADR-033:网址模式的等宽字体取自 --font-mono token,不内联字体栈', () => {
    const css = readFileSync(resolve(ROOT, 'src/ui/popup.css'), 'utf8');
    const block = /\.pattern-input\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(block).toContain('var(--font-mono)');
  });

  it('ADR-043:编辑视图的 CSS 不覆盖 outline —— focus 态由 tokens.css 统一提供', () => {
    const css = readFileSync(resolve(ROOT, 'src/ui/popup.css'), 'utf8');
    // 取编辑视图那一段(从编辑视图小节标记起到文件末尾)。
    const marker = css.indexOf('编辑视图(T6b');
    expect(marker).toBeGreaterThan(-1);
    const section = stripComments(css.slice(marker));
    expect(section).not.toContain('outline');
  });
});

/* ════════════════ ADR-047 · 首版仅中文 ════════════════ */

describe('ADR-047 · 首版仅中文,不做 i18n', () => {
  it('编辑视图不引入任何 i18n 运行时', () => {
    const text = editText();
    for (const banned of ['i18n', 'intl.', 'useTranslation', 'formatMessage']) {
      expect(text.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });
});

/* ════════════════ ADR-066 · 契约类型单一来源 ════════════════ */

describe('ADR-066 · ADR-049 契约的类型与常量只有一处', () => {
  it('发送端 import 契约模块,不内联消息字面量', () => {
    const source = readFileSync(resolve(ROOT, 'src/ui/preview-port.ts'), 'utf8');
    expect(source).toContain("from '../injection/preview-contract.js'");
    const stripped = stripComments(source);
    // 不得手写 'PREVIEW_FILTER' / 'PREVIEW_CLEAR' / 'preview' 字符串字面量。
    expect(stripped).not.toContain("'PREVIEW_FILTER'");
    expect(stripped).not.toContain("'PREVIEW_CLEAR'");
    expect(stripped).not.toContain("name: 'preview'");
  });
});
