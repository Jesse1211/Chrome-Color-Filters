/**
 * T5 的**静态**门禁 —— 「一条 grep」级别的硬性检查,放在测试里以便持续生效。
 *
 * 与 `src/background/__tests__/*` 的区别:那边断言**行为**,这边断言**源码与
 * 架构约束**。两者互为第二道防线 —— 行为测试可能因为某个分支没被触发而漏掉,
 * 源码检查则不管分支。
 *
 * 覆盖 §6 T5 中无法用行为断言表达的那几条:
 * - 协调层零 `chrome.*`(端口注入是「gate 可机械判定」的前提)
 * - 协调层**不碰** `chrome.scripting`(注册的唯一写入者是 T4a 的 `Reconciler`)
 * - service worker 入口里 T4a 的 reconcile 与 T5 的协调器**共存**
 * - 协调层不持有设置快照(§6 T5:SW 不可以是聚合的真相来源)
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
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/**
 * 去掉注释后的源码。
 *
 * ⚠️ **这不是放宽门禁,而是把它瞄准正确的目标**(与 `t6a-static-gates.test.ts`
 * 的同名函数同一论证):本项目要求在代码里引用 ADR 并写明理由(§8 第 1、3 条),
 * 于是「本层不碰 `chrome.scripting`」这条约束的**解释文字本身**必然包含
 * `chrome.scripting` 一词。若连注释一起 grep,唯一的通过方式就是删掉解释 ——
 * 那恰好惩罚了文档纪律。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 协调层的产品源码,**排除**端口装配(那里本就该碰 `chrome.*`)与测试。 */
const PURE_BACKGROUND_SOURCES = walk(resolve(ROOT, 'src/background')).filter(
  (f) =>
    !f.includes('__tests__') &&
    !f.endsWith('background-ports.ts') &&
    f.endsWith('.ts'),
);

const pureText = (): string =>
  PURE_BACKGROUND_SOURCES.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');

describe('🔴 协调层零 `chrome.*` —— gate 可机械判定的前提', () => {
  it('被检查的文件集非空(防止 glob 写错导致门禁空转)', () => {
    expect(PURE_BACKGROUND_SOURCES.length).toBeGreaterThanOrEqual(4);
  });

  it('coordinator / compute-tab-state / icon-state / injectable-url 均不调用扩展 API', () => {
    // ⚠️ 不能简单 grep `chrome.` —— `injectable-url.ts` 的商店 host 列表里有
    // **数据**字符串 `'chrome.google.com'`、`'chrome:'`(ADR-013 的判定依据),
    // 它们是字面量而非 API 调用。故逐个点名真正会碰平台的那些命名空间。
    const text = pureText();
    for (const api of [
      'chrome.tabs',
      'chrome.action',
      'chrome.runtime',
      'chrome.scripting',
      'chrome.storage',
      'chrome.windows',
      'browser.tabs',
      'browser.action',
    ]) {
      expect(text, `协调层出现了 ${api}`).not.toContain(api);
    }
  });

  it('也不含 globalThis.chrome 这类绕道写法', () => {
    const text = pureText();
    expect(text).not.toContain('globalThis as');
    expect(text).not.toMatch(/\bchrome\s*\?\./);
    expect(text).not.toMatch(/globalThis\s*\.\s*chrome/);
  });
});

describe('🔴 职责不重叠 · 协调层不是注册的写入者(ADR-064)', () => {
  it('整个 src/background(含端口装配)都不出现 scripting 调用', () => {
    // 注册的唯一写入者是 T4a 的 `Reconciler`;两处都写会制造
    // ADR-064 所防的并发重复注册(Chrome 对重复 id 会抛错,
    // 且抛错会让**整批**注册失败)。
    const all = walk(resolve(ROOT, 'src/background'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => stripComments(readFileSync(f, 'utf8')))
      .join('\n');
    expect(all).not.toContain('registerContentScripts');
    expect(all).not.toContain('unregisterContentScripts');
    expect(all).not.toContain('updateContentScripts');
  });

  it('注入层(T4a)反过来也不碰 chrome.action —— 图标的唯一写入者是 T5', () => {
    const injection = walk(resolve(ROOT, 'src/injection'))
      .filter((f) => f.endsWith('.ts') && !f.includes('__tests__'))
      .map((f) => stripComments(readFileSync(f, 'utf8')))
      .join('\n');
    expect(injection).not.toContain('setIcon');
  });
});

describe('🔴 service worker 入口:T4a 的 reconcile 与 T5 的协调器共存', () => {
  const sw = readFileSync(resolve(ROOT, 'entrypoints/background.ts'), 'utf8');
  const code = stripComments(sw);

  it('reconcile 的四个触发点仍在(T4a 未被本任务破坏,ADR-062/065)', () => {
    expect(code).toContain('onInstalled');
    expect(code).toContain('onStartup');
    expect(code).toMatch(/reconciler\.request\(/);
    expect(code).toContain("'installed'");
  });

  it('T5 的协调器被构造并 start()', () => {
    expect(code).toContain('BackgroundCoordinator');
    expect(code).toMatch(/coordinator\.start\(\)/);
  });

  it('🔴 两者共用同一个仓储实例 —— 不存在第二份真相', () => {
    // `new SettingsRepository()` 只出现一次;若出现两次,
    // 两套防抖/订阅会各自为政,§6 T5 注的「真相在 chrome.storage」
    // 就退化成「真相在两个 JS 对象里」。
    const occurrences = code.split('new SettingsRepository(').length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('🔴 §6 T5 注 · 协调层不持有设置快照(SW 不是真相来源)', () => {
  it('coordinator 的字段里没有 FilterSettings 类型的成员', () => {
    const src = stripComments(
      readFileSync(resolve(ROOT, 'src/background/coordinator.ts'), 'utf8'),
    );
    // 允许 `settings: FilterSettings` 作为**参数**;禁止作为实例字段。
    expect(src).not.toMatch(/#settings\s*[:=]/);
    expect(src).not.toMatch(/readonly\s+settings\s*:/);
  });

  it('每个图标路径都先 readSettings 再算 —— 不存在「用上次的设置」', () => {
    const src = stripComments(
      readFileSync(resolve(ROOT, 'src/background/coordinator.ts'), 'utf8'),
    );
    const reads = src.split('readSettings').length - 1;
    // 四个入口(navigation/activated/syncActiveTab/syncAllTabs)+ currentTabState
    // + 安全包装 + 类型声明;只断下界,避免把实现细节钉死。
    expect(reads).toBeGreaterThanOrEqual(5);
  });
});

describe('ADR-044 · 契约类型只有一份定义', () => {
  it('src/background 不重新声明 TabState,而是 import 契约类型', () => {
    const all = walk(resolve(ROOT, 'src/background'))
      .filter((f) => f.endsWith('.ts') && !f.includes('__tests__'))
      .map((f) => stripComments(readFileSync(f, 'utf8')))
      .join('\n');
    // 两份类型声明正是 ADR-044 要防的那个事故。
    expect(all).not.toMatch(/interface\s+TabState\b/);
    expect(all).not.toMatch(/type\s+TabState\s*=/);
    expect(all).toContain("from '../ui/tab-state.js'");
  });

  it('消息类型常量复用 ui/tab-state 的 GET_TAB_STATE,不另写字面量', () => {
    const coord = stripComments(
      readFileSync(resolve(ROOT, 'src/background/coordinator.ts'), 'utf8'),
    );
    expect(coord).toContain('GET_TAB_STATE');
    // 不得出现裸字符串字面量 'GET_TAB_STATE'(那是「各自发挥」的第一步)。
    expect(coord).not.toContain("'GET_TAB_STATE'");
  });
});

describe('ADR-019 / ADR-045 · 图标资源路径与 manifest 的静态默认值一致', () => {
  it('manifest 注册的是未生效态(保守方向:不谎称某页被改色了)', () => {
    const wxt = readFileSync(resolve(ROOT, 'wxt.config.ts'), 'utf8');
    for (const size of [16, 32, 48, 128]) {
      expect(wxt).toContain(`icon/inactive/${size}.png`);
    }
  });

  it('icon-state 的路径表两态都写齐四个尺寸', () => {
    const src = readFileSync(resolve(ROOT, 'src/background/icon-state.ts'), 'utf8');
    for (const state of ['active', 'inactive']) {
      for (const size of [16, 32, 48, 128]) {
        expect(src).toContain(`icon/${state}/${size}.png`);
      }
    }
  });
});
