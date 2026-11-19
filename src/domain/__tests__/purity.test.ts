/**
 * 纯度静态检查(ADR-036)—— **这是 gate,不是建议。**
 *
 * 扫描 `src/domain/**` 的所有 import,出现 `react` / `chrome.` / `wxt` /
 * `webextension-polyfill` 任意一项即失败。
 *
 * 理由(ADR-036):领域逻辑(通配符匹配、色彩矩阵、规则解析)必须可在 Node 下
 * 单测,不依赖浏览器或框架。ADR-039 关闭 auto-imports 正是为了让本检查
 * 可实施 —— 自动全局注入会让「有没有依赖」无法从源码读出。
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOMAIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 被禁止的模块说明符(ADR-036 逐字列举的四项)。 */
const FORBIDDEN_MODULES = [
  'react',
  'react-dom',
  'wxt',
  'webextension-polyfill',
];

/** 被禁止的运行时全局/标识符。 */
const FORBIDDEN_IDENTIFIERS = [
  'chrome.',
  'browser.runtime',
  'browser.storage',
  'browser.tabs',
];

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // 测试目录本身可以用 vitest / node:fs —— 被测的是产品代码。
      if (entry === '__tests__') continue;
      out.push(...collectTsFiles(full));
      continue;
    }
    if (['.ts', '.tsx'].includes(extname(entry))) out.push(full);
  }
  return out;
}

/** 从源码中抽出所有 import / re-export / 动态 import 的模块说明符。 */
function extractModuleSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bimport\s[^;]*?\sfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s[^;]*?\sfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const spec = m[1];
      if (spec !== undefined) specs.push(spec);
    }
  }
  return specs;
}

/** 去掉注释,避免文档里提到 `chrome.storage` 就把检查判红。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const domainFiles = collectTsFiles(DOMAIN_DIR);

describe('ADR-036 · src/domain 纯度静态检查', () => {
  it('领域层至少有一个源文件被扫描到(守住检查本身不会空转)', () => {
    expect(domainFiles.length).toBeGreaterThan(0);
  });

  it.each(domainFiles.map((f) => [f] as const))(
    '%s 不 import react / wxt / webextension-polyfill',
    (file) => {
      const specs = extractModuleSpecifiers(readFileSync(file, 'utf8'));
      const violations = specs.filter((spec) =>
        FORBIDDEN_MODULES.some(
          (bad) => spec === bad || spec.startsWith(`${bad}/`),
        ),
      );
      expect(violations, `${file} 违反 ADR-036`).toEqual([]);
    },
  );

  it.each(domainFiles.map((f) => [f] as const))(
    '%s 不引用 chrome.* / browser.* 扩展 API',
    (file) => {
      const code = stripComments(readFileSync(file, 'utf8'));
      const hits = FORBIDDEN_IDENTIFIERS.filter((id) => code.includes(id));
      expect(hits, `${file} 违反 ADR-036`).toEqual([]);
    },
  );

  it('领域层模块可在纯 Node 下 import,无需任何浏览器/框架 shim', async () => {
    const mod = await import('../index.js');
    expect(typeof mod.matchGlob).toBe('function');
    expect(typeof mod.resolveRule).toBe('function');
    expect(typeof mod.toColorMatrix).toBe('function');
    expect(typeof mod.isLocked).toBe('function');
    expect(typeof mod.canSetLockUntil).toBe('function');
    expect(typeof mod.effectiveNow).toBe('function');
  });
});
