/**
 * `FilterTarget` 的测试替身 —— **ADR-069 之后被多个测试文件共用**。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 为什么要有这个共享替身
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ADR-069 之后 `FilterTarget` 同时是**滤镜宿主**(class + 内联变量)与
 * **SVG 挂载点**(`appendChild` / `createElementNS` / `getElementById`)。
 * 替身因此必须模拟一个**微型 DOM**:子节点树、按 id 查找、属性记账。
 *
 * 五个测试文件各自手搓一份会有两个后果,都已在本仓踩过类似的坑:
 *
 * 1. **各自模拟得不一样** —— 比如有的替身 `getElementById` 不查子树,
 *    于是 `ensureSvgFilterDef` 在那份替身下永远「没找到已有定义」,
 *    测试看起来在跑、实际上测的是另一种行为;
 * 2. **断言强度参差** —— 「SVG 在 class 之前就位」这条 ADR-069 的硬顺序
 *    只有在**记录写入序列**的替身上才能断言。
 *
 * 故统一在此:它**记录所有写操作**(`writes`),使「顺序正确」与
 * 「幂等零写入」都能机械判定,而不是靠读代码确认。
 *
 * ⚠️ 这不是 DESIGN.md §8 第 8 条所指的「用 mock 冒充真实栈」:
 *    INV-1(几何零影响)、INV-3(零闪烁)与 ADR-069 的 CSP 抗性一律由
 *    REAL_STACK_GATE 在真实 Chrome 上验收,本替身不冒充那部分。
 *    它替代的只是「DOM 的记账」,被测的注入逻辑本体是真的。
 */

import {
  type FilterTarget,
  type SvgDefsNode,
  CCF_SVG_CONTAINER_ID,
} from '../index.js';

/** 替身里的一个节点(SVG 容器、`<filter>` 或 `<feColorMatrix>`)。 */
export interface FakeNode extends SvgDefsNode {
  readonly id: string;
  readonly attrs: Map<string, string>;
  readonly kids: FakeNode[];
  removed: boolean;
  /** 本节点(含后代)中出现的全部 id —— 供「某个 filter 是否已定义」断言。 */
  idsWithin(): string[];
}

export interface FakeTarget extends FilterTarget {
  /** 当前 class 集合。 */
  readonly classes: Set<string>;
  /** 内联自定义属性。 */
  readonly props: Map<string, string>;
  /** 已挂上的子节点(未被移除的)。 */
  readonly children: FakeNode[];
  /** 全部写操作的有序记录 —— 顺序断言靠它。 */
  readonly writes: string[];
  /** `createElementNS` 的调用记录(命名空间 + 标签名)。 */
  readonly created: string[];
  /** 便捷读取:SVG 容器节点,不存在时为 `undefined`。 */
  svgContainer(): FakeNode | undefined;
}

/**
 * 造一个 `FilterTarget` 替身。
 *
 * `ownerDocument` 默认存在;传 `{ noDocument: true }` 可模拟**非 DOM 宿主**
 * (`ensureSvgFilterDef` 应降级为不注入且不抛异常 —— INV-1)。
 */
export function makeFilterTarget(
  options: { readonly noDocument?: boolean } = {},
): FakeTarget {
  const classes = new Set<string>();
  const props = new Map<string, string>();
  const children: FakeNode[] = [];
  const writes: string[] = [];
  const created: string[] = [];

  const makeNode = (tag: string): FakeNode => {
    const attrs = new Map<string, string>();
    const kids: FakeNode[] = [];
    const node: FakeNode = {
      removed: false,
      attrs,
      kids,
      get id() {
        return attrs.get('id') ?? '';
      },
      setAttribute(name, value) {
        writes.push(`${tag}.setAttribute:${name}`);
        attrs.set(name, value);
      },
      appendChild(child: unknown) {
        writes.push(`${tag}.appendChild`);
        kids.push(child as FakeNode);
        return child;
      },
      remove() {
        writes.push(`${tag}.remove`);
        node.removed = true;
        const i = children.indexOf(node);
        if (i >= 0) children.splice(i, 1);
      },
      idsWithin() {
        const out = node.id === '' ? [] : [node.id];
        for (const k of kids) out.push(...k.idsWithin());
        return out;
      },
    };
    return node;
  };

  const target: FakeTarget = {
    classes,
    props,
    children,
    writes,
    created,
    svgContainer: () => children.find((c) => c.id === CCF_SVG_CONTAINER_ID),

    classList: {
      add(token) {
        writes.push(`class.add:${token}`);
        classes.add(token);
      },
      remove(token) {
        writes.push(`class.remove:${token}`);
        classes.delete(token);
      },
      contains: (token) => classes.has(token),
    },

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

    appendChild(node: unknown) {
      writes.push('appendChild');
      children.push(node as FakeNode);
      return node;
    },

    ownerDocument: options.noDocument
      ? null
      : {
          createElementNS(ns, qualifiedName) {
            created.push(`${ns}|${qualifiedName}`);
            return makeNode(qualifiedName);
          },
          // 在整棵替身子树里按 id 找 —— 容器自身与容器内的 `<filter>`
          // 都能找到,与真实 `document.getElementById` 的语义一致。
          getElementById(elementId) {
            for (const child of children) {
              const found = findById(child, elementId);
              if (found !== null) return found;
            }
            return null;
          },
        },
  };

  return target;
}

/** 在一棵替身子树里按 id 查找。 */
function findById(node: FakeNode, id: string): FakeNode | null {
  if (node.id === id) return node;
  for (const kid of node.kids) {
    const found = findById(kid, id);
    if (found !== null) return found;
  }
  return null;
}
