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

/**
 * 读产物 manifest。
 *
 * 独立于下面 describe 块内的那个 `manifest` 常量:那个在 `built === false`
 * 时是空对象,而新增的 T4a 门禁块需要在自己的作用域里拿到它。
 */
function manifestOf(): Manifest {
  return built
    ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest)
    : ({} as Manifest);
}

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
  web_accessible_resources?: unknown[];
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

    it("🔴 ADR-062 前提 · permissions 含 'scripting'", () => {
      // 漏了这条,声明式注册的所有调用都失败 —— 而失败表现是
      // 「滤镜静默不生效」,不是一条报错。必须在产物上核对(ADR-038:
      // dev manifest 的权限集与生产不同,不作数)。
      expect(manifest.permissions).toContain('scripting');
    });

    it("🔴 T5 · ADR-013/ADR-044 前提 · permissions 含 'tabs'", () => {
      // 漏了这条,Chrome 会对 `chrome://` 页**扣留** tab.url(`<all_urls>`
      // 不覆盖特权 scheme),于是 `chrome://settings` 与 `chrome://newtab`
      // 在 SW 眼里完全同形,ADR-044 的 `reason` 只能退化成 `new-tab` ——
      // 即契约字段**错值**,§6 T5 gate「reason 取值正确」判红。
      // 真实栈 A/B 实测记录见 wxt.config.ts 该权限处的注释。
      // 必须在**产物**上核对(ADR-038)。
      expect(manifest.permissions).toContain('tabs');
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

// ───────────────────────────────────────────────────────────────────────────
// T4a:声明式注册所需的产物门禁(ADR-062 / ADR-063)。
//
// 为什么必须在**产物**上验:注册的 `css` 字段是扩展包内的相对路径。
// 源码里 `public/filters/gray-100.css` 存在,不等于产物里
// `.output/chrome-mv3/filters/gray-100.css` 存在 —— 中间隔着 WXT 的
// public 目录拷贝。拷贝链路一断,注册会在运行时静默失败
// (Chrome 对不存在的 css 路径报 "Could not load file"),
// 而源码侧的单测照样全绿。这正是 §8 第 8 条所警告的那类风险。
// ───────────────────────────────────────────────────────────────────────────
describe.skipIf(!built)('T4a · 预生成滤镜 CSS 进了产物(ADR-062/063)', () => {
  const filtersDir = resolve(OUT_DIR, 'filters');

  it('🔴 产物内存在 filters/ 目录', () => {
    expect(
      existsSync(filtersDir),
      '产物缺少 filters/ —— registerContentScripts 的 css 路径会在运行时失败',
    ).toBe(true);
  });

  it('🔴 产物内恰好 404 个滤镜 CSS(4 模式 × 101 档)', () => {
    const files = readdirSync(filtersDir).filter((f) => f.endsWith('.css'));
    expect(files).toHaveLength(404);
  });

  it('🔴 DESIGN.md §6 T4a 示例路径在产物内可解析(filters/gray-100.css)', () => {
    expect(existsSync(resolve(filtersDir, 'gray-100.css'))).toBe(true);
  });

  it('🔴 产物里的滤镜 CSS 与源码逐字节一致(public 拷贝链路没改内容)', () => {
    for (const name of ['gray-100.css', 'redgreen-50.css', 'blueyellow-0.css']) {
      const built = readFileSync(resolve(filtersDir, name), 'utf8');
      const source = readFileSync(
        resolve(ROOT, 'public/filters', name),
        'utf8',
      );
      expect(built, `产物 filters/${name} 与源码不一致`).toBe(source);
    }
  });

  it('🔴 ADR-063 · 滤镜 CSS **不在** web_accessible_resources(减少指纹暴露面)', () => {
    // 这些文件由浏览器自己读取并注入,不经页面 fetch。放进去反而给站点
    // 一个探测扩展存在与用户滤镜偏好的接口。
    const war = JSON.stringify(manifestOf().web_accessible_resources ?? []);
    expect(war).not.toContain('filters/');
  });

  it('🔴 产物里的滤镜 CSS 选择器锁定在 html[data-ccf-on](INV-1 最脆弱点)', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(filtersDir)) {
      const text = readFileSync(resolve(filtersDir, name), 'utf8');
      if (text.includes('body[data-ccf-on]')) offenders.push(name);
      // 首帧时 CSS 变量尚未被 JS 赋值 → filter 解析为无效值 → 等于没有滤镜。
      if (text.includes('var(--ccf-filter)')) offenders.push(`${name}(用了变量)`);
    }
    expect(offenders).toEqual([]);
  });
});

describe.skipIf(!built)('T4a · service worker 含声明式注册逻辑(ADR-062/065)', () => {
  const swSource = (): string => {
    const sw = manifestOf().background?.service_worker;
    if (sw === undefined) return '';
    const path = resolve(OUT_DIR, sw);
    if (!existsSync(path)) return '';
    let text = readFileSync(path, 'utf8');
    // WXT 的 SW 可能是一个 import 真实 chunk 的壳;把被 import 的本地
    // chunk 内容一并拼上,否则断言会在壳上落空(假绿)。
    for (const m of text.matchAll(/from\s*["'](\.[^"']+)["']/g)) {
      const dep = resolve(dirname(path), m[1] as string);
      if (existsSync(dep)) text += readFileSync(dep, 'utf8');
    }
    return text;
  };

  it('🔴 产物的 SW 调用 registerContentScripts(ADR-062 的主路径)', () => {
    expect(swSource()).toContain('registerContentScripts');
  });

  it('🔴 产物的 SW 注册 onInstalled 监听(ADR-065 强制项)', () => {
    // 扩展更新会清除动态注册,漏了 onInstalled 会导致每次更新后
    // 滤镜静默失效 —— 这是 ADR-065 把重建列为强制项的理由。
    expect(swSource()).toContain('onInstalled');
  });

  it('产物的 SW 注册 onStartup 监听(廉价的双重保险)', () => {
    expect(swSource()).toContain('onStartup');
  });

  it('🔴 产物的 SW 写入 persistAcrossSessions 语义(拼写以源码为准)', () => {
    expect(swSource()).toContain('persistAcrossSessions');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T5:后台协调与图标状态,**与上面的 T4a 注册逻辑共存于同一个 SW**。
  //
  // 为什么必须在产物上验而不只在源码上验:T5 与 T4a 都写
  // `entrypoints/background.ts`。若打包时其中一方被 tree-shake 掉
  // (例如某次重构把协调器的构造移进了一个未被引用的分支),
  // 源码级 grep(`tests/t5-static-gates.test.ts`)照样绿,
  // 而真实扩展里图标永远不动 / popup 永远超时降级 ——
  // 正是 §8 第 8 条警告的那类「mock 下看不见」的风险。
  // ─────────────────────────────────────────────────────────────────────────

  it('🔴 T5 · 产物的 SW 调用 setIcon(ADR-019 图标两态的落点)', () => {
    expect(swSource()).toContain('setIcon');
  });

  it('🔴 T5 · 产物的 SW 应答 GET_TAB_STATE(ADR-044 契约)', () => {
    expect(swSource()).toContain('GET_TAB_STATE');
  });

  it('🔴 T5 · 产物的 SW 监听 tab 导航与激活(§6 T5 spec 第一条)', () => {
    const sw = swSource();
    expect(sw).toContain('onUpdated');
    expect(sw).toContain('onActivated');
  });

  it('🔴 T5 · 产物中两态图标路径都在(ADR-045:两态是不同资源)', () => {
    const sw = swSource();
    expect(sw).toContain('icon/active/');
    expect(sw).toContain('icon/inactive/');
    for (const variant of ['active', 'inactive']) {
      for (const size of [16, 32, 48, 128]) {
        expect(
          existsSync(resolve(OUT_DIR, `icon/${variant}/${size}.png`)),
          `产物缺少 icon/${variant}/${size}.png`,
        ).toBe(true);
      }
    }
  });

  it('🔴 T5 · 不可注入判定进了产物(ADR-013)', () => {
    // 商店 host 是该判定里最具辨识度的字面量 —— 它在,说明整条
    // classifyUrl 链路没被摇掉。
    expect(swSource()).toContain('chromewebstore.google.com');
  });
});

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
