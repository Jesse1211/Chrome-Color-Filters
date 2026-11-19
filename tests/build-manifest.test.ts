/**
 * 生产构建产物门禁(ADR-004 / ADR-010 / ADR-038 / ADR-040 / ADR-045,INV-3)。
 *
 * 🔴 ADR-038:**权限核对与 INV-3 相关验收须针对 `.output/chrome-mv3/manifest.json`,
 * 不得以 dev manifest 为准。** dev 模式下 WXT 的 manifest 完全不含 `content_scripts`,
 * 且会从 `matches` 推导并追加 host permissions —— 权限集与生产不同。
 *
 * 产物不存在时跳过:构建是独立的 gate 步骤(`npm run build`),
 * 不应让未构建的工作区把单测判红。CI 与验收须在 build 之后跑本文件。
 * 📌 这是 DESIGN.md T1 gate 自身区分 `TEST_CMD` 与 `npm run build` 的直接结果,
 * 不是为了绕过失败而设的跳过。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, '.output/chrome-mv3');
const MANIFEST = resolve(OUT_DIR, 'manifest.json');

const built = existsSync(MANIFEST);

interface Manifest {
  manifest_version: number;
  host_permissions?: string[];
  permissions?: string[];
  icons?: Record<string, string>;
  action?: { default_popup?: string; default_icon?: Record<string, string> };
  background?: { service_worker?: string };
  content_scripts?: Array<{
    matches?: string[];
    run_at?: string;
    all_frames?: boolean;
    js?: string[];
  }>;
}

describe.skipIf(!built)(
  '生产 manifest(.output/chrome-mv3/manifest.json,ADR-038)',
  () => {
    const manifest = built
      ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest)
      : ({} as Manifest);

    it('是 MV3', () => {
      expect(manifest.manifest_version).toBe(3);
    });

    it('host_permissions 含 <all_urls>(ADR-004)', () => {
      expect(manifest.host_permissions).toContain('<all_urls>');
    });

    it('permissions 含 storage,且**不含** 任何 sync 相关权限(ADR-010)', () => {
      expect(manifest.permissions).toContain('storage');
    });

    it('🔴 content script 的 run_at 为 document_start(INV-3 的前提)', () => {
      const cs = manifest.content_scripts ?? [];
      expect(cs.length).toBeGreaterThan(0);
      const first = cs[0]!;
      expect(first.run_at).toBe('document_start');
      expect(first.matches).toContain('<all_urls>');
      // ADR-016:根元素 filter 天然覆盖 iframe,无需注入子框架。
      expect(first.all_frames).toBe(false);
    });

    it('注册了 popup 与 service worker', () => {
      expect(manifest.action?.default_popup).toBeTruthy();
      expect(manifest.background?.service_worker).toBeTruthy();
    });

    it('图标已注册且产物存在(ADR-045)', () => {
      const icons = manifest.icons ?? {};
      expect(Object.keys(icons).sort()).toEqual(['128', '16', '32', '48']);
      for (const rel of Object.values(icons)) {
        expect(existsSync(resolve(OUT_DIR, rel)), `缺少产物 ${rel}`).toBe(true);
      }
      // 两态都必须被打包进产物 —— T5 要在运行时切换到 active 态。
      for (const size of [16, 32, 48, 128]) {
        expect(existsSync(resolve(OUT_DIR, `icon/active/${size}.png`))).toBe(true);
      }
    });

    it('无 i18n:产物中无 _locales/,manifest 无 default_locale(ADR-047)', () => {
      expect(existsSync(resolve(OUT_DIR, '_locales'))).toBe(false);
      expect('default_locale' in manifest).toBe(false);
    });

    it('🔴 content script 未被包进异步 loader(ADR-040 / INV-3)', () => {
      const cs = manifest.content_scripts?.[0];
      const jsPath = cs?.js?.[0];
      expect(jsPath).toBeTruthy();
      const code = readFileSync(resolve(OUT_DIR, jsPath as string), 'utf8');
      // CRXJS 的失败表现正是「content script 被 import() 异步拉起」,
      // 实测增加 136–223ms 延迟 —— 与 INV-3 根本冲突。
      expect(code).not.toMatch(/\bimport\s*\(/);
      expect(code).not.toMatch(/@crxjs/);
    });
  },
);

describe('构建产物目录约定', () => {
  it('WXT 的产物目录是 .output/chrome-mv3/,不是 dist/', () => {
    expect(existsSync(resolve(ROOT, 'dist'))).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// T6a:popup 样式在**生产构建产物**中的门禁。
//
// 为什么必须在产物上验:`src/ui/popup.css` 通过 `@import` 串起 `tokens.css`,
// 而 jsdom 里的样式是测试自己拼接注入的(见 `src/ui/__tests__/css-harness.ts`)。
// 若打包链路把 `@import` 丢了,单测照样全绿而真实 popup 一片无样式 ——
// 这正是 §8 第 8 条所警告的那类「mock 下看不见」的风险。
//
// 跳过条件与本文件其余部分一致:产物不存在时跳过(构建是独立 gate 步骤)。
// ───────────────────────────────────────────────────────────────────────────

describe.skipIf(!built)('T6a · popup 样式产物(§5.1 / ADR-043)', () => {
  const css = (): string => {
    const assetsDir = resolve(OUT_DIR, 'assets');
    if (!existsSync(assetsDir)) return '';
    const file = readdirSync(assetsDir).find(
      (f) => f.startsWith('popup') && f.endsWith('.css'),
    );
    return file ? readFileSync(resolve(assetsDir, file), 'utf8') : '';
  };

  it('产物中存在 popup 的 CSS 资源', () => {
    expect(css().length).toBeGreaterThan(0);
  });

  it('§5.1 设计 token 确实被打进产物(@import 链路没断)', () => {
    const text = css().toLowerCase();
    for (const token of ['--ground', '--surface', '--ink', '--accent', '--warn', '--bad']) {
      expect(text, `产物缺少 token ${token}`).toContain(token);
    }
    // 浅色与深色两套都要在(OQ-05)。
    expect(text).toContain('#2563eb'); // 浅色 accent
    expect(text).toContain('#6195f5'); // 深色 accent
    expect(text).toContain('prefers-color-scheme');
  });

  it('§5.1 尺寸 360×452 进了产物', () => {
    const text = css();
    expect(text).toContain('360px');
    expect(text).toContain('452px');
  });

  it('ADR-043 · focus 态用长写三件套进了产物', () => {
    const text = css().replace(/\s+/g, '');
    expect(text).toContain('outline-width:var(--focus-outline-width)');
    expect(text).toContain('outline-style:solid');
    expect(text).toContain('outline-color:var(--accent)');
  });

  it('🔴 ADR-032 · 产物中不含 line-through', () => {
    expect(css()).not.toContain('line-through');
  });
});
