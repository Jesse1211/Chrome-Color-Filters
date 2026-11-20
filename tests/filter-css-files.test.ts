/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 预生成滤镜 CSS 文件门禁(ADR-063)。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * DESIGN.md §6 第 9 条 / T1 gate 的原文:
 *
 * > **`public/filters/` 下存在 404 个 CSS 文件**(4 模式 × 101 档),且抽查
 * > 若干个的 `filter` 值与 `toColorMatrix(mode, intensity)` 的输出**逐位一致**
 * > (ADR-063,防止两条路径漂移)
 *
 * 🔴 本文件**不抽查,而是全查** —— 404 个文件逐一与
 * `filterCssValue`(内部复用 `toColorMatrix`)比对。抽查会漏:
 * 漂移最可能发生在某几个特定强度档(如浮点格式化的边界),
 * 而抽查恰好跳过它们的概率不低。全查的成本是几十毫秒。
 *
 * ## 为什么这条门禁如此重要
 *
 * 新架构有**两条**让滤镜生效的路径(见 `src/injection/filter-file-css.ts`
 * 的头注释):预生成 CSS 文件管**下一次导航的首帧**,JS content script
 * 管**已打开的页面**。两条路径若用不同的公式,同一个站点会出现
 * 「首帧一个颜色、JS 跑完变另一个颜色」的可见跳变 ——
 * 而因为两边各自「自测通过」,这种漂移极难被发现。
 *
 * 📌 产物已提交进仓库(同 ADR-045 的图标做法),故本文件**不跳过**:
 * 它不依赖「先跑过 npm run build」。文件缺失即硬失败 ——
 * 那正是我们希望它失败的情形(漏跑生成脚本)。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FILTER_MODES,
  type FilterMode,
  filterCssValue,
  toColorMatrix,
} from '../src/domain/index.js';
import {
  ALL_INTENSITIES,
  FILTER_CSS_FILE_COUNT,
  FILTER_MODE_SLUGS,
  allFilterCssFiles,
  filterCssFileContent,
  filterCssFilePath,
} from '../src/injection/filter-file-css.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILTERS_DIR = resolve(ROOT, 'public/filters');

describe('ADR-063 · public/filters/ 的 404 个文件', () => {
  it('🔴 目录存在(漏跑 npm run filters 时硬失败)', () => {
    expect(
      existsSync(FILTERS_DIR),
      '缺少 public/filters/ —— 跑 `npm run filters` 生成',
    ).toBe(true);
  });

  it('🔴 恰好 404 个 .css 文件(4 模式 × 101 档)', () => {
    const files = readdirSync(FILTERS_DIR).filter((f) => f.endsWith('.css'));
    expect(FILTER_CSS_FILE_COUNT).toBe(404);
    expect(files).toHaveLength(404);
  });

  it('目录内**只有** .css,无孤儿文件', () => {
    const files = readdirSync(FILTERS_DIR);
    expect(files.filter((f) => !f.endsWith('.css'))).toEqual([]);
  });

  it('101 档覆盖 0–100 全部整数(ADR-003:强度无级可调)', () => {
    expect(ALL_INTENSITIES).toHaveLength(101);
    expect(ALL_INTENSITIES[0]).toBe(0);
    expect(ALL_INTENSITIES[100]).toBe(100);
  });

  it('四种模式的短名各不相同(文件名不可碰撞)', () => {
    const slugs = FILTER_MODES.map((m) => FILTER_MODE_SLUGS[m]);
    expect(new Set(slugs).size).toBe(4);
  });

  it('短名全小写(跨平台大小写安全 —— macOS 不敏感、Linux 敏感)', () => {
    for (const mode of FILTER_MODES) {
      const slug = FILTER_MODE_SLUGS[mode];
      expect(slug).toBe(slug.toLowerCase());
    }
  });

  it('DESIGN.md §6 T4a 的示例文件名存在(filters/gray-100.css)', () => {
    expect(filterCssFilePath('Grayscale', 100)).toBe('filters/gray-100.css');
    expect(existsSync(resolve(FILTERS_DIR, 'gray-100.css'))).toBe(true);
  });
});

describe('🔴 ADR-063 · 404 个文件全部与 toColorMatrix 逐位一致(防漂移)', () => {
  it('每个文件的磁盘内容 === filterCssFileContent(mode, intensity)', () => {
    const mismatched: string[] = [];
    for (const file of allFilterCssFiles()) {
      const name = file.path.slice(file.path.indexOf('/') + 1);
      const onDisk = resolve(FILTERS_DIR, name);
      if (!existsSync(onDisk)) {
        mismatched.push(`${name}: 文件不存在`);
        continue;
      }
      const actual = readFileSync(onDisk, 'utf8');
      if (actual !== file.content) mismatched.push(`${name}: 内容不一致`);
    }
    expect(mismatched, `共 ${mismatched.length} 个文件漂移`).toEqual([]);
  });

  it('🔴 每个文件的 filter 值 === filterCssValue(mode, intensity)', () => {
    const mismatched: string[] = [];
    for (const mode of FILTER_MODES) {
      for (const intensity of ALL_INTENSITIES) {
        const name = `${FILTER_MODE_SLUGS[mode]}-${intensity}.css`;
        const text = readFileSync(resolve(FILTERS_DIR, name), 'utf8');
        const expected = filterCssValue(mode, intensity);
        // 主规则那一行必须逐位含有领域层算出的那个串。
        if (!text.includes(`filter: ${expected} !important;`)) {
          mismatched.push(name);
        }
      }
    }
    expect(mismatched, `${mismatched.length} 个文件的 filter 值与领域层不一致`).toEqual(
      [],
    );
  });

  it('🔴 非 Grayscale 模式的矩阵系数来自 toColorMatrix(不是另写的公式)', () => {
    // Grayscale 走 CSS 原生 grayscale(),无矩阵;其余三种内联 feColorMatrix。
    for (const mode of ['RedGreen', 'GreenRed', 'BlueYellow'] as FilterMode[]) {
      for (const intensity of [0, 1, 37, 50, 99, 100]) {
        const name = `${FILTER_MODE_SLUGS[mode]}-${intensity}.css`;
        const text = readFileSync(resolve(FILTERS_DIR, name), 'utf8');
        const matrix = toColorMatrix(mode, intensity);
        // 取矩阵的第一个非平凡系数,确认它确实出现在文件里。
        // 这是「公式同源」的独立证据 —— 不经 filterCssValue 这一层。
        const coefficients = Object.values(matrix).filter(
          (v): v is number => typeof v === 'number',
        );
        expect(coefficients.length).toBeGreaterThan(0);
        // 文件里的系数是 URL 转义过的,空格 → %20;取一个确定存在的数字串。
        const sample = coefficients
          .map((c) => formatLikeDomain(c))
          .find((s) => s !== '0' && s !== '1');
        if (sample !== undefined) {
          expect(
            text,
            `${name} 不含 toColorMatrix 的系数 ${sample}`,
          ).toContain(sample);
        }
      }
    }
  });

  it('Grayscale 用 CSS 原生 grayscale()(W3C 定义即 BT.709 插值,与矩阵等价)', () => {
    expect(readFileSync(resolve(FILTERS_DIR, 'gray-100.css'), 'utf8')).toContain(
      'grayscale(1)',
    );
    expect(readFileSync(resolve(FILTERS_DIR, 'gray-0.css'), 'utf8')).toContain(
      'grayscale(0)',
    );
  });
});

/** 复刻 `colorMatrixToValues` 的格式化,仅用于上面那条独立证据。 */
function formatLikeDomain(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

describe('🔴 ADR-062/063 / INV-1 · 文件内的选择器是裸 html,注入目标是根元素', () => {
  it('🔴 主规则选择器**精确**为裸 `html`(不是 body,也**不带属性门控**)', () => {
    const text = readFileSync(resolve(FILTERS_DIR, 'gray-100.css'), 'utf8');
    const mainRule = text
      .split('\n')
      .find((l) => l.includes('{ filter:') && !l.includes(' :') && !l.includes('::'));
    expect(mainRule).toBeDefined();
    // 精确匹配,不用子串 —— 上一轮正是子串断言放过了 body[...] 的变异。
    expect(
      (mainRule as string).slice(0, 'html {'.length),
      '主规则不是以裸 `html {` 开头',
    ).toBe('html {');
  });

  it('🔴 404 个文件中**没有一个**用 body 作注入目标', () => {
    // 上一轮实测:把 html[...] 改成 body[...] 后单元测试全绿 296/296,
    // 因为旧断言用子串匹配,而残留的 top-layer 规则里仍含该字符串。
    // T0 实测 body{filter} 会让固定头部跳到 y=-1000(INV-1 最脆弱点)。
    const offenders: string[] = [];
    for (const name of readdirSync(FILTERS_DIR)) {
      const text = readFileSync(resolve(FILTERS_DIR, name), 'utf8');
      if (text.includes('body[data-ccf-on]')) offenders.push(name);
      if (text.includes('body {')) offenders.push(`${name}(body 主规则)`);
    }
    expect(offenders).toEqual([]);
  });

  it('🔴 404 个文件中**没有一个**带 [data-ccf-on] 门控(ADR-062 的要害)', () => {
    // 门控会把 JS 重新放回页面加载的关键路径 —— 真实 Chrome 实测:
    // 属性要到 readyState=complete 才设上,首帧 computed filter 为 none,
    // coldCache 3/3 站点出现未滤镜彩色帧。这是本轮亲手踩过并修掉的缺陷,
    // 断言留在这里防止它被「优化」回来。
    const offenders: string[] = [];
    for (const name of readdirSync(FILTERS_DIR)) {
      const text = readFileSync(resolve(FILTERS_DIR, name), 'utf8');
      if (text.includes('[data-ccf-on]')) offenders.push(name);
    }
    expect(
      offenders,
      '预生成 CSS 带了属性门控 —— 首帧将依赖 JS,INV-3 必然破裂',
    ).toEqual([]);
  });

  it('🔴 每个文件都带 top layer 补偿(T0 §4.5:漏掉就是真实缺陷)', () => {
    // :modal / [popover] / :fullscreen / ::backdrop 在绘制树中不是根元素的
    // 后代,根 filter 到不了它们。T0 实测缺此规则时 modal 全彩
    // (maxChannelSpread=238)。首帧上就可能存在 <dialog open>,故预生成
    // 文件同样必需这条规则。
    const missing: string[] = [];
    for (const name of readdirSync(FILTERS_DIR)) {
      const text = readFileSync(resolve(FILTERS_DIR, name), 'utf8');
      for (const sel of [
        ':modal',
        '[popover]:popover-open',
        ':fullscreen',
        '::backdrop',
      ]) {
        if (!text.includes(sel)) missing.push(`${name} 缺 ${sel}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('🔴 每条规则都带 !important(对抗站点自身的 html{filter})', () => {
    for (const name of ['gray-100.css', 'redgreen-50.css', 'blueyellow-7.css']) {
      const text = readFileSync(resolve(FILTERS_DIR, name), 'utf8');
      const filterLines = text
        .split('\n')
        .filter((l) => l.includes('filter:'));
      expect(filterLines.length).toBeGreaterThan(0);
      for (const line of filterLines) {
        expect(line, `${name}: ${line}`).toContain('!important');
      }
    }
  });

  it('🔴 文件里写死 filter 值,**不用** var(--ccf-filter)', () => {
    // 首帧时 CSS 变量尚未被 JS 赋值,filter 会解析为无效值 ——
    // 等于没有滤镜,ADR-062 的全部收益当场归零。
    for (const name of readdirSync(FILTERS_DIR)) {
      const text = readFileSync(resolve(FILTERS_DIR, name), 'utf8');
      expect(text, `${name} 用了 CSS 变量,首帧必然无效`).not.toContain(
        'var(--ccf-filter)',
      );
    }
  });
});

describe('filterCssFileContent · 纯函数(同输入恒同输出)', () => {
  it('两次调用结果逐位相同', () => {
    for (const mode of FILTER_MODES) {
      expect(filterCssFileContent(mode, 42)).toBe(
        filterCssFileContent(mode, 42),
      );
    }
  });

  it('路径与内容一一对应,无碰撞', () => {
    const paths = new Set(allFilterCssFiles().map((f) => f.path));
    expect(paths.size).toBe(404);
  });
});
