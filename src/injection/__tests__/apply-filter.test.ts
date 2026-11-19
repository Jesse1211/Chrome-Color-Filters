/**
 * DOM 侧原语 —— 注入/移除的幂等性与「无残留」(T4a gate)。
 */
import { describe, expect, it } from 'vitest';
import {
  FILTER_ATTR,
  FILTER_VAR,
  type FilterTarget,
  applyFilter,
  currentFilterValue,
  isFilterApplied,
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
    ]);
  });

  it('🔴 移除后 DOM 恢复原状，无残留属性/变量（T4a gate 逐字要求）', () => {
    const t = makeTarget();
    applyFilter(t, 'grayscale(1)');
    removeFilter(t);
    expect(t.attrs.size).toBe(0);
    expect(t.props.size).toBe(0);
    expect(isFilterApplied(t)).toBe(false);
    expect(currentFilterValue(t)).toBe('');
  });

  it('移除顺序与应用严格相反', () => {
    const t = makeTarget();
    applyFilter(t, 'grayscale(1)');
    t.writes.length = 0;
    removeFilter(t);
    expect(t.writes).toEqual([
      `removeAttribute:${FILTER_ATTR}`,
      `removeProperty:${FILTER_VAR}`,
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

  it('null 表示不套滤镜，且已是该状态时不写入', () => {
    const t = makeTarget();
    syncFilter(t, null);
    expect(t.writes).toEqual([]);
    syncFilter(t, 'grayscale(1)');
    syncFilter(t, null);
    expect(isFilterApplied(t)).toBe(false);
    expect(t.attrs.size).toBe(0);
    expect(t.props.size).toBe(0);
  });
});
