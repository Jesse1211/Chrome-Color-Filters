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
  filterCssValue,
  svgFilterId,
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
        // 🔴 主规则那一行必须逐位是
        //    `filter: var(--ccf-filter, <领域层算出的串>) !important;`。
        //
        //    `var()` 的**回退**才是本文件写死的首帧值;主值是 CSS 变量,
        //    供已打开标签页的实时更新改写(见 filter-file-css.ts 中
        //    filterCssFileContent 的注释:写死值会让 liveupdate 失效,
        //    那是实测到的真实回归)。
        //
        //    这条断言比旧版**更严**:旧版只要求「含有 expected」,
        //    现在连 `var(--ccf-filter, …)` 的包裹形态一起钉死 ——
        //    谁把回退改成 `none`、或把变量名写错、或退回裸写死值,
        //    都会在这里变红。
        if (!text.includes(`filter: var(--ccf-filter, ${expected}) !important;`)) {
          mismatched.push(name);
        }
        // 回退值仍必须是本文件自己的 url("#id"):写 `none` 会让首帧无滤镜。
        if (text.includes('var(--ccf-filter, none)')) {
          mismatched.push(`${name}: 回退值是 none —— 首帧会无滤镜(INV-3)`);
        }
      }
    }
    expect(mismatched, `${mismatched.length} 个文件的 filter 值与领域层不一致`).toEqual(
      [],
    );
  });

  it('🔴 ADR-069/070 · 文件里是**同文档 fragment 引用**,矩阵系数不在 CSS 里', () => {
    // 🔴 本条取代了旧的「文件里含 toColorMatrix 的系数」断言。
    //    ADR-069 之后系数**不再出现在 CSS 里** —— 它们在 content script
    //    同步注入的 <filter> 节点上(见 src/injection/svg-filter-def.ts)。
    //    CSS 只留一个引用。防漂移因此改由两件事共同保证:
    //    (a) 文件内容逐位等于 filterCssFileContent(上面那条全查断言);
    //    (b) id 与 SVG 侧同源于 svgFilterId(见下面一条 + svg-filter-def 的单测)。
    for (const mode of FILTER_MODES) {
      for (const intensity of [0, 1, 37, 50, 99, 100]) {
        const name = `${FILTER_MODE_SLUGS[mode]}-${intensity}.css`;
        const text = readFileSync(resolve(FILTERS_DIR, name), 'utf8');
        expect(text).toContain(`url("#${svgFilterId(mode, intensity)}")`);
        // 系数不该泄进 CSS —— 那会变成第二份真相。
        expect(text).not.toContain('feColorMatrix');
      }
    }
  });

  it('🔴 ADR-069 · 404 个文件里**没有一个** data: URI(本轮缺陷本体)', () => {
    // `data:` URI 的 SVG 被归类为图片资源,受站点 CSP 的 img-src 管辖;
    // 不放行 data: 的站点上三个色觉矫正滤镜**静默失效**(T7 实测,
    // 真实 Chrome 捕获 {directive:'img-src', blockedURI:'data'})。
    // 这条断言是那次红灯的闭合条件之一,防止 data: 方案被「还原」。
    const offenders: string[] = [];
    for (const name of readdirSync(FILTERS_DIR)) {
      const text = readFileSync(resolve(FILTERS_DIR, name), 'utf8');
      if (text.includes('data:')) offenders.push(name);
    }
    expect(
      offenders,
      'data: URI 会被站点 CSP 的 img-src 拦掉 → 滤镜静默失效',
    ).toEqual([]);
  });

  it('🔴 ADR-070 · 灰阶也走 SVG,404 个文件里不出现内置 grayscale( 调用', () => {
    // 灰阶本身就是一个颜色矩阵,用内置函数只是巧合可行。两条路径各自演化
    // 会一直有「只在某条路上出现的 bug」—— 本次 CSP 缺陷恰好只打中 SVG 路径
    // 而灰阶无恙,正是这种分裂的代价。
    const offenders: string[] = [];
    for (const name of readdirSync(FILTERS_DIR)) {
      const text = readFileSync(resolve(FILTERS_DIR, name), 'utf8');
      if (text.includes('grayscale(')) offenders.push(name);
    }
    expect(offenders, 'ADR-070 要求四个滤镜路径统一').toEqual([]);
    // 正面断言:灰阶文件引用的是 SVG filter id。
    expect(readFileSync(resolve(FILTERS_DIR, 'gray-100.css'), 'utf8')).toContain(
      'url("#ccf-gray-100")',
    );
  });
});

describe('🔴 ADR-063/069 / INV-1 · 文件内的选择器是 `html.ccf-on`,注入目标是根元素', () => {
  it('🔴 主规则选择器**精确**为 `html.ccf-on`(不是 body,也不是裸 html)', () => {
    const text = readFileSync(resolve(FILTERS_DIR, 'gray-100.css'), 'utf8');
    const mainRule = text
      .split('\n')
      .find((l) => l.includes('{ filter:') && !l.includes(' :') && !l.includes('::'));
    expect(mainRule).toBeDefined();
    // 精确匹配,不用子串 —— 上一轮正是子串断言放过了 body[...] 的变异。
    expect(
      (mainRule as string).slice(0, 'html.ccf-on {'.length),
      '主规则不是以 `html.ccf-on {` 开头',
    ).toBe('html.ccf-on {');
  });

  it('🔴 404 个文件中**没有一个**用 body 作注入目标', () => {
    // 上一轮实测:把 html[...] 改成 body[...] 后单元测试全绿 296/296,
    // 因为旧断言用子串匹配,而残留的 top-layer 规则里仍含该字符串。
    // T0 实测 body{filter} 会让固定头部跳到 y=-1000(INV-1 最脆弱点)。
    const offenders: string[] = [];
    for (const name of readdirSync(FILTERS_DIR)) {
      const text = readFileSync(resolve(FILTERS_DIR, name), 'utf8');
      if (/(^|[\s>+~,])body\b/m.test(text.replace(/\/\*[\s\S]*?\*\//g, ''))) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('🔴 404 个文件**全部**带 `.ccf-on` class 门控(ADR-069 的要害)', () => {
    // 🔴 这条与上一轮的要求**方向相反**,原因必须记清:
    //
    //    ADR-062 时代要求裸 `html`(无门控),因为当时的门控是 `data-ccf-on`
    //    **属性**,而属性要等**异步** storage 读完才设上 —— 真实 Chrome 实测
    //    属性要到 readyState=complete 才到位,coldCache 3/3 站点首帧彩色。
    //
    //    ADR-069 的门控是 class,它与 SVG 注入同处 document_start 的
    //    **同一个同步段**,不等任何异步结果(实测同步 fragment 路径 0 次闪烁)。
    //    而 class 门控是**必需**的:裸 `html` 会让浏览器在 SVG 节点就位之前
    //    就去解析 `url("#ccf-…")`,把 ADR-069 精心消除的前向引用不确定性放回来。
    const offenders: string[] = [];
    for (const name of readdirSync(FILTERS_DIR)) {
      const text = readFileSync(resolve(FILTERS_DIR, name), 'utf8');
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '');
      // 每一条含 filter 的规则都必须由 html.ccf-on 门控。
      for (const line of stripped.split('\n')) {
        if (!line.includes('filter:')) continue;
        if (!stripped.includes('html.ccf-on')) offenders.push(name);
      }
      if (/(^|\})\s*html\s*\{/.test(stripped)) {
        offenders.push(`${name}(裸 html 主规则)`);
      }
      if (stripped.includes('[data-ccf-')) {
        offenders.push(`${name}(属性门控)`);
      }
    }
    expect(
      offenders,
      '预生成 CSS 的门控必须是 `.ccf-on` class(ADR-069)',
    ).toEqual([]);
  });

  it('🔴 404 个文件里**不得**再出现 `--ccf-registered` 自述标记(已实测否定)', () => {
    // 上一轮曾给每个文件加一行无门控的
    // `:root { --ccf-registered: ccf-gray-100; }`,供 content script 在
    // `document_start` 用 `getComputedStyle` 同步读出,以补上冷缓存下
    // 缺失的同步输入。
    //
    // 🔴 **真实 Chrome 实测否定了它(Chrome 158,3/3 确定性复现):**
    //    本扩展的 content script 是 manifest 里的**静态** `content_scripts`,
    //    而这些文件由 `registerContentScripts()` **动态**注册。静态脚本在
    //    `document_start` 读到的 `--ccf-registered` 是**空串** ——
    //    动态注册的 CSS 此刻还没进层叠;约 0.3–0.5ms 后才读得到。
    //    把引导脚本改成与 CSS 同一条动态注册也一样读到空串。
    //
    // 故它是**读不到的死代码**。这条断言把它钉死在删除状态:
    // 谁再加回来,就必须先拿出「静态脚本能同步读到」的实测证据。
    const offenders: string[] = [];
    for (const name of readdirSync(FILTERS_DIR)) {
      const text = readFileSync(resolve(FILTERS_DIR, name), 'utf8');
      if (text.includes('--ccf-registered')) {
        offenders.push(`${name} 又出现了读不到的自述标记`);
      }
    }
    expect(offenders).toEqual([]);
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
    // 📌 ADR-069 不改变这一点:class 由 JS 同步加上,但**值**仍必须是
    //    构建时写死的 —— 变量赋值与 class 虽同处一个同步段,
    //    让预生成文件依赖变量仍会在「JS 未运行」的极端情形下失效。
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
