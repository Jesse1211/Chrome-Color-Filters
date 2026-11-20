/**
 * DOM 侧原语 —— 注入/移除的幂等性与「无残留」(T4a gate)。
 */
import { describe, expect, it } from 'vitest';
import {
  FILTER_ATTR,
  FILTER_VAR,
  type FilterTarget,
  SUPPRESS_ATTR,
  applyFilter,
  currentFilterValue,
  isFilterApplied,
  isFilterSuppressed,
  removeFilter,
  syncFilter,
} from '../index.js';

/**
 * 最小的 `FilterTarget` 替身，并**记录所有写操作** ——
 * 「移除后无残留」与「幂等不产生多余写入」都要靠这份记录机械判定。
 */
function makeTarget(): FilterTarget & {
  attrs: Map<string, string>;
  props: Map<string, string>;
  writes: string[];
} {
  const attrs = new Map<string, string>();
  const props = new Map<string, string>();
  const writes: string[] = [];
  return {
    attrs,
    props,
    writes,
    setAttribute(name, value) {
      writes.push(`setAttribute:${name}`);
      attrs.set(name, value);
    },
    removeAttribute(name) {
      writes.push(`removeAttribute:${name}`);
      attrs.delete(name);
    },
    hasAttribute: (name) => attrs.has(name),
    style: {
      setProperty(name, value) {
        writes.push(`setProperty:${name}`);
        props.set(name, value);
      },
      removeProperty(name) {
        writes.push(`removeProperty:${name}`);
        props.delete(name);
      },
      getPropertyValue: (name) => props.get(name) ?? '',
    },
  };
}

describe('applyFilter / removeFilter', () => {
  it('应用后门控属性与 CSS 变量同时就位', () => {
    const t = makeTarget();
    applyFilter(t, 'grayscale(1)');
    expect(isFilterApplied(t)).toBe(true);
    expect(currentFilterValue(t)).toBe('grayscale(1)');
  });

  it('🔴 先写变量再开门控属性 —— 顺序是有意的，避免 var() 解析为无效值', () => {
    const t = makeTarget();
    applyFilter(t, 'grayscale(1)');
    expect(t.writes).toEqual([
      `setProperty:${FILTER_VAR}`,
      `setAttribute:${FILTER_ATTR}`,
      // ADR-062:上色时必须摘掉压制属性,否则 `html[data-ccf-off]`
      // 会把刚设好的值压回 none。
      `removeAttribute:${SUPPRESS_ATTR}`,
    ]);
  });

  it('🔴 移除后无任何**滤镜**残留,且显式压制(T4a gate + ADR-062)', () => {
    const t = makeTarget();
    applyFilter(t, 'grayscale(1)');
    removeFilter(t);

    // 上色态与滤镜值都已清干净。
    expect(isFilterApplied(t)).toBe(false);
    expect(currentFilterValue(t)).toBe('');
    expect(t.props.size).toBe(0);

    // 🔴 ADR-062 下「无残留」的含义被**加强**了:
    //    预生成 CSS 文件(裸 `html` 选择器)不看我们的属性,只摘
    //    `data-ccf-on` 并不能让页面回到未滤镜 —— 必须显式设上压制属性。
    //    故移除后恰好剩这一个属性,且它**承担功能**,不是残留。
    expect(isFilterSuppressed(t)).toBe(true);
    expect([...t.attrs.keys()]).toEqual([SUPPRESS_ATTR]);
  });

  it('移除顺序与应用严格相反,末尾补上压制属性', () => {
    const t = makeTarget();
    applyFilter(t, 'grayscale(1)');
    t.writes.length = 0;
    removeFilter(t);
    expect(t.writes).toEqual([
      `removeAttribute:${FILTER_ATTR}`,
      `removeProperty:${FILTER_VAR}`,
      `setAttribute:${SUPPRESS_ATTR}`,
    ]);
  });
});

describe('syncFilter（幂等）', () => {
  it('已处于期望状态时不产生任何写入（INV-1：不给页面的 MutationObserver 制造回调）', () => {
    const t = makeTarget();
    syncFilter(t, 'grayscale(1)');
    t.writes.length = 0;
    syncFilter(t, 'grayscale(1)');
    expect(t.writes).toEqual([]);
  });

  it('值变化时只更新变量，不重复设置属性', () => {
    const t = makeTarget();
    syncFilter(t, 'grayscale(1)');
    t.writes.length = 0;
    syncFilter(t, 'grayscale(0.5)');
    expect(t.writes).toEqual([`setProperty:${FILTER_VAR}`]);
    expect(currentFilterValue(t)).toBe('grayscale(0.5)');
  });

  it('🔴 null 表示不套滤镜 —— 首次就必须写入压制属性(ADR-062)', () => {
    const t = makeTarget();
    // 🔴 这里与 ADR-062 之前相反:从前「本来就没上色」时什么都不做即可,
    //    现在**必须**显式压制 —— 预生成 CSS 可能正把这页染着色,
    //    而它不看 `data-ccf-on`。沿用旧的「无写入」断言会让
    //    「超集多匹配的站点被误上色」这个真实缺陷溜过去。
    syncFilter(t, null);
    expect(isFilterSuppressed(t)).toBe(true);

    // 第二次调用才是真正的幂等 no-op。
    t.writes.length = 0;
    syncFilter(t, null);
    expect(t.writes).toEqual([]);

    syncFilter(t, 'grayscale(1)');
    expect(isFilterApplied(t)).toBe(true);
    expect(isFilterSuppressed(t)).toBe(false);

    syncFilter(t, null);
    expect(isFilterApplied(t)).toBe(false);
    expect(isFilterSuppressed(t)).toBe(true);
    expect(t.props.size).toBe(0);
  });
});
