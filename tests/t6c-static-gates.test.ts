/**
 * T6c 的**静态**门禁 —— 对**源码本身**的硬性检查(与 T6a 的同名文件同构)。
 *
 * 与 `src/ui/__tests__/lock-ui.test.tsx` 的区别:那边断言**渲染结果**,
 * 这边断言**源码**。两者互为第二道防线 —— 渲染测试可能因为某个分支
 * 没被触发而漏掉,源码检查则不管分支。
 *
 * 覆盖 §6 T6c gate 里的负向约束与 ADR-057 / ADR-058 / ADR-061 的反模式。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
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

const UI_SOURCES = [
  ...walk(resolve(ROOT, 'src/ui')),
  ...walk(resolve(ROOT, 'entrypoints/popup')),
].filter((f) => !f.includes('__tests__'));

/**
 * 锁定相关的产品源码(注释已剥离,见 T6a 同名函数的说明)。
 *
 * ⚠️ 按**仓库相对路径**判定,不是绝对路径。
 *
 * 绝对路径里会掺进 checkout 目录名:在一个叫 `ff-lockpage/` 的工作树里,
 * `/lock/` 命中**每一个** UI 源文件,于是 `LOCK_SOURCES` 退化成「全部 UI 源码」——
 * 本门禁随即对 `App.tsx` 这类文件施加只应施加于锁定模块的禁令
 * (实测:`setMasterEnabled` 与 `setTimeout(` 两条当场误报)。
 *
 * 反过来更危险:一个叫 `unlocked-build/` 的目录会让**所有**文件都被纳入,
 * 而一个真正违规的锁定文件若恰好落在被别的规则跳过的路径上就会漏网。
 * 改成相对路径是**收紧**,不是放宽 —— 判定范围从「路径里有 lock 字样」
 * 变成「仓库里的锁定模块」,与这些断言本来想守的东西完全一致。
 */
const LOCK_SOURCES = UI_SOURCES.filter((f) =>
  /lock|Lock/.test(relative(ROOT, f)),
);

/**
 * 去掉注释后的源码。
 *
 * 与 `t6a-static-gates.test.ts` 同一理由:本项目要求在代码里引用 ADR 编号
 * 并写明理由(§8 第 1、3 条),于是「不得有解除入口」这条约束的**解释文字
 * 本身**必然包含「解除」二字。若连注释一起 grep,唯一的通过方式就是
 * **删掉解释** —— 那恰好惩罚了文档纪律。
 *
 * 用户可见文案不会只写在注释里,所以这不留口子:真的渲染出一个「解除」
 * 按钮的实现,其 JSX 文本仍会被抓到。渲染层另有
 * `lock-ui.test.tsx` 的 DOM 级负向断言兜底。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const lockText = () =>
  LOCK_SOURCES.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');

describe('🔴🔴 ADR-052 / INV-12 · 源码里不存在解除/缩短锁定的实现', () => {
  it('锁定相关源码不含解除类的中文文案', () => {
    const text = lockText();
    for (const banned of [
      '解除锁定',
      '解锁',
      '取消锁定',
      '结束锁定',
      '提前结束锁定',
      '缩短',
    ]) {
      expect(text, `锁定源码出现了 ${banned}`).not.toContain(banned);
    }
  });

  it('锁定相关源码不含解除类的**标识符**', () => {
    const text = lockText();
    /*
     * ⚠️ 按**标识符边界**匹配,不是裸 `toContain` ——
     * `endLock` 是 `extendLock` 的子串,而 `extendLock` 正是 ADR-052
     * **允许**的那个操作。裸子串匹配会把合法的延长实现判成违规,
     * 逼着实现者给延长改一个别扭的名字,门禁就此瞄错了目标。
     *
     * 这不是放宽:`\bendLock\b` 仍然抓得住一个真的叫 `endLock` 的函数,
     * 且 DOM 级的负向断言(lock-ui.test.tsx)另有一层兜底。
     */
    for (const banned of [
      'unlock',
      'cancelLock',
      'endLock',
      'clearLock',
      'shortenLock',
      'removeLock',
      'abortLock',
    ]) {
      const pattern = new RegExp(`(^|[^A-Za-z])${banned}([^A-Za-z]|$)`, 'i');
      expect(pattern.test(text), `锁定源码出现了标识符 ${banned}`).toBe(false);
    }

    // 反向自检:合法的 `extendLock` 确实在场,证明上面的边界匹配没有误伤它。
    expect(text).toContain('extendLock');
  });

  it('🔴 没有任何地方把 lockUntil 写成 null(那等于清除锁)', () => {
    // 仓储层的 `setLockUntil(null)` 恒被 `canSetLockUntil` 拒绝(ADR-052),
    // 但 UI 连**尝试**都不该有 —— 一个注定被拒的调用说明实现者想错了方向。
    const text = lockText();
    expect(text).not.toMatch(/setLockUntil\(\s*null\s*\)/);
  });
});

describe('🔴 ADR-057 · 启动锁定是一次写入,不得拆成两次', () => {
  it('锁定源码不在启动路径上调用 setMasterEnabled', () => {
    // 「先 setMasterEnabled(true) 再 setLockUntil(ts)」是两次落盘、有中间态,
    // 恰恰是 ADR-057 要消灭的东西。原子性由仓储层的 setLockUntil 一次完成。
    const text = lockText();
    expect(
      text,
      '锁定路径调用了 setMasterEnabled —— ADR-057 要求一次写入,无中间态',
    ).not.toContain('setMasterEnabled');
  });

  it('useLockState 里对仓储层的写入调用只有一处(且是「同轮落盘」的那一个)', () => {
    const src = stripComments(
      readFileSync(resolve(ROOT, 'src/ui/useLockState.ts'), 'utf8'),
    );
    const calls = src.match(/repository\.\w+\(/g) ?? [];
    // 🔴 ADR-057:**一处**调用 —— 拆成两次就有中间态。
    // 🔴 ADR-061 同类:必须是 `setLockUntilImmediate`,不是 `setLockUntil`。
    //    后者第一行 `await #readContext()`(一次跨进程 storage.get 往返),
    //    而 popup 一失焦即销毁 —— 那次 await 就是丢写窗口,
    //    写请求根本发不出去(回归测试:src/ui/__tests__/lock-teardown.test.tsx)。
    expect(calls).toEqual(['repository.setLockUntilImmediate(']);
  });
});

describe('🔴 ADR-058 · 界面不接受裸时间戳', () => {
  it('锁定 UI 里没有 datetime/date/time 类输入控件', () => {
    const text = lockText();
    for (const banned of [
      "type=\"datetime-local\"",
      "type=\"date\"",
      "type=\"time\"",
      'datetime-local',
    ]) {
      expect(text, `出现了 ${banned}`).not.toContain(banned);
    }
  });

  it('时长模型里不存在秒/毫秒单位', () => {
    const src = stripComments(
      readFileSync(resolve(ROOT, 'src/ui/lock-duration.ts'), 'utf8'),
    );
    for (const banned of ["'second'", "'millisecond'", "'ms'", "'sec'"]) {
      expect(src, `单位里出现了 ${banned}`).not.toContain(banned);
    }
  });

  it('产出 lockUntil 的唯一函数要求同时传 now 与带单位的时长', () => {
    const src = stripComments(
      readFileSync(resolve(ROOT, 'src/ui/lock-duration.ts'), 'utf8'),
    );
    expect(src).toMatch(
      /export function lockUntilFrom\(\s*now: number,\s*duration: LockDuration,?\s*\)/,
    );
  });
});

describe('🔴 ADR-061 · 锁定写入立即落盘,不走防抖', () => {
  it('锁定源码不使用防抖写入路径', () => {
    const text = lockText();
    for (const banned of ['reorderRulesDebounced', 'Debounced', 'debounce']) {
      expect(text, `锁定路径出现了 ${banned} —— ADR-061 要求立即落盘`).not.toContain(
        banned,
      );
    }
  });

  it('锁定源码里没有 setTimeout 延迟写入', () => {
    const text = lockText();
    expect(text).not.toContain('setTimeout(');
  });
});

describe('🔴 ADR-051 · 倒计时按差值计算,不是自减计数器', () => {
  it('lock-format 是纯函数 —— 没有模块级可变状态', () => {
    const src = stripComments(
      readFileSync(resolve(ROOT, 'src/ui/lock-format.ts'), 'utf8'),
    );
    // 自减计数器的特征:`let` 的模块级变量 + `-=` / `--`。
    expect(src).not.toMatch(/^let\s/m);
    expect(src).not.toContain('-=');
    expect(src).not.toContain('--;');
  });

  it('倒计时组件不持有「剩余秒数」这类自减状态', () => {
    const src = stripComments(
      readFileSync(resolve(ROOT, 'src/ui/LockCountdownBanner.tsx'), 'utf8'),
    );
    for (const banned of ['remainingState', 'setRemaining', 'secondsLeft', 'countdownState']) {
      expect(src, `出现了自减计数器的痕迹 ${banned}`).not.toContain(banned);
    }
    // 剩余量只能由 formatCountdown(lockUntil, now) 每次重算。
    expect(src).toContain('formatCountdown(lockUntil, now)');
  });
});

describe('🔴 ADR-055 / INV-14 · 锁定写入一律经仓储层', () => {
  it('锁定源码不直接调用 chrome.storage.*', () => {
    for (const file of LOCK_SOURCES) {
      const text = stripComments(readFileSync(file, 'utf8'));
      expect(text, `${file} 直接调用了 chrome.storage`).not.toMatch(
        /chrome\.storage\.(local|sync)\.(get|set|remove|clear)\(/,
      );
    }
  });
});

/* ════════ 🔴 I2 · 锁定子页面不得有预览通道(与 T6b 的 I2 对称) ════════
 *
 * §6 T6b gate 的 I2 原文:
 * > **预览与锁定永不共存** …… **此性质须保持** —— 不得在编辑视图添加锁定快捷入口。
 *
 * 原先 I2 的两道结构保证是:(a) 编辑视图没有锁定插槽;
 * (b) 锁定入口只在列表视图。锁定 UI 折叠改造新增了第三个视图,于是
 * **I2 需要一道对称的新门禁**:锁定子页面不得有预览通道或规则编辑控件。
 *
 * 缺了它,「在锁定页顺手加个强度滑块预览一下」就只靠口头约定了 ——
 * 而那正是 I2 要排除的那个状态(预览活动时启动锁定)。
 */
describe('🔴 I2 · 锁定子页面不得有预览通道或规则编辑控件', () => {
  const lockViewSource = () =>
    readFileSync(resolve(ROOT, 'src/ui/LockView.tsx'), 'utf8');

  it('LockView 不 import 任何预览相关的东西', () => {
    /*
     * 剥注释 —— 与本文件 `stripComments` 的理由完全相同(见其文档):
     * 本项目要求在代码里写明「为什么这里没有预览通道」,那段解释文字
     * 必然包含 `previewChannel` 一词。连注释一起 grep 的唯一通过方式
     * 就是**删掉解释**,那恰好惩罚了文档纪律。
     * 真的 import 了预览通道的实现,其 import 语句仍会被抓到。
     */
    const source = stripComments(lockViewSource());
    for (const banned of [
      'usePreview',
      'preview-port',
      'previewChannel',
      'PreviewChannel',
      'PREVIEW_FILTER',
      'PREVIEW_CLEAR',
      'createPreviewChannel',
    ]) {
      expect(source, `锁定子页面出现了 ${banned}`).not.toContain(banned);
    }
  });

  it('LockView 不 import 编辑视图,也不含任何规则编辑回调', () => {
    const text = stripComments(lockViewSource());
    for (const banned of [
      'RuleEditView',
      'RuleRow',
      'FilterSwatch',
      'onSave',
      'onDelete',
      'onMoveToTop',
      'onReindex',
      'saveRule',
      'deleteRule',
      'reorderRules',
      'intensity',
      'pattern',
    ]) {
      expect(text, `锁定子页面出现了 ${banned}`).not.toContain(banned);
    }

    /*
     * `RuleListView` 的模块名允许出现 —— 但**只能**是那个
     * `import { type ActionResult }`(写入结果的共享形状,全部锁定组件都用它)。
     * 把它一并禁掉等于逼着实现者给同一个类型换个住处,门禁就此瞄错了目标。
     *
     * 真正要排除的是「把列表视图 render 进锁定页」:故按**值导入**与
     * **JSX 使用**判定,而不是按模块名。
     */
    expect(text, '锁定子页面值导入了 RuleListView').not.toMatch(
      /import\s*\{\s*RuleListView/,
    );
    expect(text, '锁定子页面渲染了 <RuleListView>').not.toContain('<RuleListView');
    expect(text, '锁定子页面渲染了 <RuleRow>').not.toContain('<RuleRow');
  });

  it('🔴 App 里 previewChannel **只**出现在编辑视图那一处', () => {
    const text = stripComments(
      readFileSync(resolve(ROOT, 'entrypoints/popup/App.tsx'), 'utf8'),
    );
    /*
     * 允许的三处:模块级构造(含常量名一次)+ 传给 RuleEditView 的那一次。
     * 多出来的任何一次都意味着第二个视图拿到了预览通道 —— I2 被破。
     */
    const hits = text.match(/previewChannel/g) ?? [];
    expect(hits.length, `previewChannel 出现了 ${String(hits.length)} 次`).toBe(3);
    // 且它**不**出现在 LockView 的 JSX 块里。
    const lockBlock = /<LockView[\s\S]*?\/>/.exec(text)?.[0] ?? '';
    expect(lockBlock.length, '找不到 <LockView .../> 块').toBeGreaterThan(0);
    expect(lockBlock).not.toContain('previewChannel');
  });

  it('🔴 ADR-022:View 判别联合里确实有且仅有三个 kind', () => {
    const text = stripComments(
      readFileSync(resolve(ROOT, 'entrypoints/popup/App.tsx'), 'utf8'),
    );
    /*
     * 从 `type View =` 读到下一个顶层声明之前。
     * ⚠️ 不能用 `/type View =([\s\S]*?);/`:`edit` 那一支里有
     *    `index: number | null };`,非贪婪匹配会在那个 `;` 上提前收尾,
     *    于是第三个 kind 永远读不到(本断言因此会**假绿**)。
     */
    const union =
      /type View =([\s\S]*?)\n\n(?:function|const|export|type|interface)/.exec(
        text,
      )?.[1] ?? '';
    const kinds = (union.match(/kind: '(\w+)'/g) ?? []).map((m) =>
      /'(\w+)'/.exec(m)?.[1],
    );
    expect(kinds.sort()).toEqual(['edit', 'list', 'lock']);
    /*
     * 🔴 并行机制的反模式:另起一个布尔开关会让「编辑中 + 锁定页」
     *    这种状态可表达,而那恰好是 I2 要排除的。
     */
    for (const banned of ['showLock', 'lockPageOpen', 'isLockPage', 'lockVisible']) {
      expect(text, `App 里出现了与 View 并行的 ${banned}`).not.toContain(banned);
    }
  });

  it('🔴 ADR-061:导航路径上没有防抖、没有 setTimeout、没有 await', () => {
    const text = stripComments(
      readFileSync(resolve(ROOT, 'entrypoints/popup/App.tsx'), 'utf8'),
    );
    // 打开锁定页的回调必须是一次**同步**的 setView,别无他物。
    const open = /const openLockView = useCallback\(\(\) => \{([\s\S]*?)\}, \[\]\);/.exec(
      text,
    )?.[1];
    expect(open, '找不到 openLockView 的同步实现').toBeTruthy();
    expect((open ?? '').trim()).toBe("setView({ kind: 'lock' });");
  });
});

describe('§5.1 token 单一来源(锁定 UI 同样适用)', () => {
  it('锁定组件不内联硬编码 §5.1 的色值', () => {
    const tokenColors = [
      '#F2F3F5', '#FAFAFB', '#16181D', '#4B5563', '#8B919C',
      '#E4E6EA', '#EFF1F4', '#2563EB', '#EFF4FF', '#15803D',
      '#B45309', '#FEF6E7', '#B42318', '#FEF3F2',
    ];
    for (const file of LOCK_SOURCES.filter((f) => f.endsWith('.tsx'))) {
      const text = stripComments(readFileSync(file, 'utf8')).toUpperCase();
      for (const color of tokenColors) {
        expect(text, `${file} 内联了 token 色值 ${color}`).not.toContain(color);
      }
    }
  });
});
