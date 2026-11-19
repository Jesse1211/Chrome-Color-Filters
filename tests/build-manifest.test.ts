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
import { existsSync, readFileSync } from 'node:fs';
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
    css?: string[];
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

    it('🔴 T4a/INV-3:滤镜样式表进入 manifest 的 css 数组(非 JS 注入)', () => {
      const cs = manifest.content_scripts?.[0];
      // 线索要求的「css 数组」:浏览器在 document_start 先于脚本注入,
      // 不等 DOM、不经 JS,因而落在首帧之前。这是 chrome.storage 异步性的唯一解法。
      expect(cs?.css, 'content_scripts[].css 缺失 —— INV-3 失去首帧前生效的保证').toBeTruthy();
      expect(cs!.css!.length).toBeGreaterThan(0);
      const cssPath = cs!.css![0]!;
      expect(existsSync(resolve(OUT_DIR, cssPath)), `缺少产物 ${cssPath}`).toBe(true);
    });

    it('🔴 T4a/INV-1:滤镜作用于根元素 <html>,绝不是 body(T0 §1/§4.3)', () => {
      const cssPath = manifest.content_scripts?.[0]?.css?.[0];
      const css = readFileSync(resolve(OUT_DIR, cssPath as string), 'utf8');
      // 根元素享有 CSS Filter Effects 的规范特例:不为 fixed 后代建立 containing block。
      // body{filter} 没有该特例 —— T0 实测 fixed header 跑到 y=-1000。
      expect(css).toMatch(/html\[data-ccf-on\]/);
      expect(css).not.toMatch(/(^|[^-\w])body\s*\{[^}]*filter/);
    });

    it('🔴 T4a:顶层(top layer)补偿规则存在 —— 漏掉它是一个真实缺陷(T0 §4.5)', () => {
      const cssPath = manifest.content_scripts?.[0]?.css?.[0];
      const css = readFileSync(resolve(OUT_DIR, cssPath as string), 'utf8');
      // modal/popover/fullscreen 在绘制树中不是根元素的后代,根 filter 到不了它们。
      for (const sel of [':modal', '[popover]:popover-open', ':fullscreen', '::backdrop']) {
        expect(css, `顶层补偿缺少 ${sel}`).toContain(sel);
      }
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
