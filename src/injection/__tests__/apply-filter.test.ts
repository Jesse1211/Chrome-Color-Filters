/**
 * DOM 侧原语 —— 注入/移除的幂等性、「无残留」(T4a gate)与
 * **ADR-069 的两步注入序列**。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CCF_SVG_CONTAINER_ID,
  CCF_SVG_CONTAINER_STYLE,
  FILTER_CLASS,
  FILTER_VAR,
  SVG_NS,
  applyFilter,
  currentFilterValue,
  isFilterApplied,
  removeFilter,
  syncFilter,
} from '../index.js';
import { filterCssValue, filterMatrixValues } from '../../domain/index.js';
import { makeFilterTarget } from './filter-target-double.js';

const GRAY = filterCssValue('Grayscale', 100);
const GRAY_50 = filterCssValue('Grayscale', 50);
const REDGREEN = filterCssValue('RedGreen', 60);

describe('applyFilter / removeFilter(ADR-069:class 开关 + 同文档 SVG)', () => {
  it('应用后 class 与 CSS 变量同时就位', () => {
    const t = makeFilterTarget();
    applyFilter(t, GRAY);
    expect(isFilterApplied(t)).toBe(true);
    expect(currentFilterValue(t)).toBe(GRAY);
    expect(t.classes.has(FILTER_CLASS)).toBe(true);
  });

  it('🔴 ADR-069 两步序列:SVG 必须在 `classList.add` **之前**就位', () => {
    const t = makeFilterTarget();
    applyFilter(t, GRAY);

    const appendAt = t.writes.indexOf('appendChild');
    const classAt = t.writes.indexOf(`class.add:${FILTER_CLASS}`);

    expect(appendAt, 'SVG 容器未被挂上').toBeGreaterThanOrEqual(0);
    expect(classAt, '开闸 class 未被加上').toBeGreaterThanOrEqual(0);
    // 🔴 这是 ADR-069 的硬约束:顺序颠倒就等于在赌引擎对
    //    「引用不到的 filter」是否会在节点出现后自动重算。
    expect(
      appendAt,
      'SVG 必须先就位、再开闸 —— 顺序颠倒会把 ADR-069 消除掉的不确定性放回来',
    ).toBeLessThan(classAt);
  });

  it('🔴 先写变量再开闸 —— 避免 var() 解析为无效值的中间态', () => {
    const t = makeFilterTarget();
    applyFilter(t, GRAY);
    const varAt = t.writes.indexOf(`setProperty:${FILTER_VAR}`);
    const classAt = t.writes.indexOf(`class.add:${FILTER_CLASS}`);
    expect(varAt).toBeLessThan(classAt);
  });

  it('🔴 SVG 容器带不占布局的内联样式(INV-1 几何零影响)', () => {
    const t = makeFilterTarget();
    applyFilter(t, GRAY);
    const svg = t.svgContainer();
    expect(svg, '找不到 SVG 容器').toBeDefined();
    expect(svg!.attrs.get('style')).toBe(CCF_SVG_CONTAINER_STYLE);
    // 一个占位的 SVG 默认 300×150,会当场破坏
    // 「注入前后 getBoundingClientRect() 逐一相等」。
    expect(CCF_SVG_CONTAINER_STYLE).toContain('width:0');
    expect(CCF_SVG_CONTAINER_STYLE).toContain('height:0');
    expect(CCF_SVG_CONTAINER_STYLE).toContain('position:absolute');
  });

  it('🔴 容器不进无障碍树(aria-hidden)', () => {
    const t = makeFilterTarget();
    applyFilter(t, GRAY);
    expect(t.svgContainer()!.attrs.get('aria-hidden')).toBe('true');
  });

  it('节点全部用 SVG 命名空间创建 —— 否则不会被当成 SVG 解析', () => {
    const t = makeFilterTarget();
    applyFilter(t, GRAY);
    expect(t.created).toEqual([
      `${SVG_NS}|svg`,
      `${SVG_NS}|filter`,
      `${SVG_NS}|feColorMatrix`,
    ]);
  });

  it('SVG 里含该 (mode,intensity) 的 feColorMatrix,id 与 CSS 的 url(#…) 一致', () => {
    const t = makeFilterTarget();
    applyFilter(t, REDGREEN);
    const container = t.svgContainer()!;
    expect(container.idsWithin()).toContain('ccf-redgreen-60');

    const filter = container.kids[0]!;
    expect(filter.attrs.get('id')).toBe('ccf-redgreen-60');
    // 🔴 sRGB 不是可选的:默认 linearRGB 会让矩阵作用在线性光空间上,
    //    产出的颜色与 toColorMatrix 的推导不一致(「颜色差一点点」)。
    expect(filter.attrs.get('color-interpolation-filters')).toBe('sRGB');

    const matrix = filter.kids[0]!;
    expect(matrix.attrs.get('type')).toBe('matrix');
    expect(matrix.attrs.get('values')).toBe(
      filterMatrixValues('RedGreen', 60),
    );

    // CSS 侧引用的正是这个 id —— 两边必须对齐,否则静默失效。
    expect(REDGREEN).toBe('url("#ccf-redgreen-60")');
  });

  it('🔴 建节点**不走 innerHTML** —— ADR-026 的禁字,门禁上不开缺口', () => {
    // 这条守的是实现手段本身。innerHTML 一旦被引入,
    // tests/t4b-static-gates.test.ts 的机械门禁就必须开一个
    // 「本文件允许 innerHTML」的例外,而例外会让**下一次**有人在这个
    // 文件里**读** innerHTML(真正的 ADR-026 违反)不再被挡住。
    //
    // 📌 断言直接读源码,而不是看替身的形状 —— 后者证明不了实现用了什么。
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../svg-filter-def.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toContain('innerHTML');
    // 正面:用的是逐个 createElementNS。
    expect(src).toContain('createElementNS');
  });

  it('🔴 移除后**无任何残留**:无 class、无变量、无节点(T4a gate)', () => {
    const t = makeFilterTarget();
    applyFilter(t, GRAY);
    removeFilter(t);

    expect(isFilterApplied(t)).toBe(false);
    expect(currentFilterValue(t)).toBe('');
    expect(t.props.size).toBe(0);
    expect(t.classes.size, '残留了 class').toBe(0);
    // 🔴 ADR-069 之后「无残留」回到了字面意义:旧实现移除后必须留一个
    //    `data-ccf-off` 压制属性(因为预生成 CSS 用裸 `html` 无条件生效)。
    //    现在摘掉 class 两张表一并失效,所以**什么都不必留**。
    expect(t.children, '残留了 SVG 节点').toEqual([]);
  });

  it('移除顺序与应用严格相反:先关闸,再清变量,最后摘节点', () => {
    const t = makeFilterTarget();
    applyFilter(t, GRAY);
    t.writes.length = 0;
    removeFilter(t);
    expect(t.writes).toEqual([
      `class.remove:${FILTER_CLASS}`,
      `removeProperty:${FILTER_VAR}`,
      'svg.remove',
    ]);
  });
});

describe('syncFilter(幂等)', () => {
  it('已处于期望状态时不产生任何写入(INV-1:不给页面的 MutationObserver 制造回调)', () => {
    const t = makeFilterTarget();
    syncFilter(t, GRAY);
    t.writes.length = 0;
    syncFilter(t, GRAY);
    expect(t.writes).toEqual([]);
  });

  it('值变化时更新变量,不重复加 class', () => {
    const t = makeFilterTarget();
    syncFilter(t, GRAY);
    t.writes.length = 0;
    syncFilter(t, GRAY_50);
    expect(t.writes).not.toContain(`class.add:${FILTER_CLASS}`);
    expect(t.writes).toContain(`setProperty:${FILTER_VAR}`);
    expect(currentFilterValue(t)).toBe(GRAY_50);
  });

  it('🔴 换 (mode,intensity) 时新的 filter 定义被加进同一个容器,节点数不增长', () => {
    const t = makeFilterTarget();
    syncFilter(t, GRAY);
    syncFilter(t, REDGREEN);
    // 页面上永远只多**一个**节点(INV-1/INV-9:节点数可控)。
    expect(t.children).toHaveLength(1);
    const ids = t.svgContainer()!.idsWithin();
    // 🔴 两个定义并存:预览(ADR-049)期间底层值与预览值不同,
    //    覆盖式替换会把另一个摘掉,随后存活性恢复会引用到不存在的 id。
    expect(ids).toContain('ccf-gray-100');
    expect(ids).toContain('ccf-redgreen-60');
  });

  it('🔴 null = 撤除 —— 摘 class 即可,不再需要任何压制属性(ADR-069)', () => {
    const t = makeFilterTarget();

    // 本来就没上色 → 真正的 no-op(零写入)。
    // 📌 这与 ADR-062 时代相反:那时必须显式写 `data-ccf-off`,
    //    因为预生成 CSS 用裸 `html` 无条件生效、不看我们的属性。
    //    ADR-069 把那些文件也改成了 `html.ccf-on`,于是「没有 class」
    //    本身就是「不上色」,无需第二个状态。
    syncFilter(t, null);
    expect(t.writes).toEqual([]);
    expect(isFilterApplied(t)).toBe(false);

    syncFilter(t, GRAY);
    expect(isFilterApplied(t)).toBe(true);

    syncFilter(t, null);
    expect(isFilterApplied(t)).toBe(false);
    expect(t.props.size).toBe(0);
    expect(t.classes.size).toBe(0);
    expect(t.children).toEqual([]);
  });

  it('撤除后再开闸:SVG 被重建,且仍然先于 class(ADR-069 顺序不因复用而松动)', () => {
    const t = makeFilterTarget();
    syncFilter(t, GRAY);
    syncFilter(t, null);
    t.writes.length = 0;
    syncFilter(t, GRAY);
    expect(t.writes.indexOf('appendChild')).toBeLessThan(
      t.writes.indexOf(`class.add:${FILTER_CLASS}`),
    );
    expect(t.svgContainer()!.idsWithin()).toContain('ccf-gray-100');
  });
});

describe('🔴 降级:非 DOM 宿主下不抛异常(INV-1)', () => {
  it('没有 ownerDocument 时跳过 SVG 注入,但仍切 class 且不抛', () => {
    const t = makeFilterTarget({ noDocument: true });
    expect(() => applyFilter(t, GRAY)).not.toThrow();
    // content script 抛到页面上就是 INV-1 的破坏(见 content.ts 的注释)。
    expect(isFilterApplied(t)).toBe(true);
    expect(t.children).toEqual([]);
  });
});

describe('容器 id 稳定 —— 它同时被 CSS 之外的恢复路径依赖', () => {
  it('CCF_SVG_CONTAINER_ID 带扩展前缀(INV-1:不与站点 id 撞名)', () => {
    expect(CCF_SVG_CONTAINER_ID).toBe('ccf-svg-defs');
    expect(CCF_SVG_CONTAINER_ID.startsWith('ccf-')).toBe(true);
  });
});
