/**
 * 注入编排器 —— 含 T4a gate 逐字要求的 **INV-8 可观察断言**。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  type FilterSettings,
  defaultSettings,
  filterCssValue,
  resolveRule,
} from '../../domain/index.js';
import {
  type SyncKeyValueStore,
  currentFilterValue,
  decide,
  isFilterApplied,
  runInjector,
  writeFastPath,
} from '../index.js';
import { makeFilterTarget } from './filter-target-double.js';

/**
 * ADR-069 之后 `FilterTarget` 同时是 SVG 挂载点,替身统一取自
 * `filter-target-double.ts`(见该文件头注释:避免各文件各自模拟得不一样)。
 */
const makeTarget = makeFilterTarget;

function makeStore(): SyncKeyValueStore & { data: Map<string, string>; reads: string[] } {
  const data = new Map<string, string>();
  const reads: string[] = [];
  return {
    data,
    reads,
    getItem: (k) => {
      reads.push(k);
      return data.get(k) ?? null;
    },
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function settingsWith(partial: Partial<FilterSettings>): FilterSettings {
  return { ...defaultSettings(), ...partial };
}

const GRAY_RULE = { pattern: '*.example.com', mode: 'Grayscale', intensity: 100 } as const;

// ─────────────────────────── INV-8 ───────────────────────────

describe('🔴 INV-8 / ADR-027 · masterEnabled === false 时完全不工作', () => {
  it('匹配函数零次调用（gate 逐字要求的 spy 断言）', () => {
    const match = vi.fn(resolveRule);
    const result = decide(
      settingsWith({ masterEnabled: false, rules: [GRAY_RULE] }),
      'https://a.example.com/',
      match,
    );
    expect(result).toBeNull();
    expect(match).toHaveBeenCalledTimes(0);
  });

  it('主开关开启时匹配函数才被调用（证明上面的零次不是因为探针失效）', () => {
    const match = vi.fn(resolveRule);
    const result = decide(
      settingsWith({ masterEnabled: true, rules: [GRAY_RULE] }),
      'https://a.example.com/',
      match,
    );
    expect(match).toHaveBeenCalledTimes(1);
    expect(result).toBe(filterCssValue('Grayscale', 100));
  });

  it('🔴 页面中不存在任何**上色**的属性/变量,且显式压制(gate 第一项)', async () => {
    const target = makeTarget();
    const store = makeStore();
    const { settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () =>
        settingsWith({ masterEnabled: false, rules: [GRAY_RULE] }),
    });
    await settled;

    // INV-8 的实质:页面**不被上色**。
    expect(isFilterApplied(target)).toBe(false);
    // 不残留任何滤镜值(CSS 变量一个都没有)。
    expect(target.props.size).toBe(0);

    // 🔴 ADR-069 下这条断言回到了最直接的形式:两张表(预生成文件与
    //    `filter.css`)的选择器**都是** `html.ccf-on`,所以「没有 class」
    //    就是「不上色」,无需任何压制属性。
    //    (ADR-062 时代预生成文件用裸 `html` 无条件生效,必须显式设
    //     `data-ccf-off` 去压;那层复杂性随 ADR-069 一起消失。)
    expect(target.classes.size, '残留了 class').toBe(0);
    // 也不残留 SVG 节点 —— 主开关 OFF 时页面上没有本扩展的任何痕迹。
    expect(target.children, '残留了 SVG 节点').toEqual([]);
  });

  it('🔴 主开关关闭时清掉快路径缓存 —— 使「关主开关可彻底止血」对后续加载成立', async () => {
    const target = makeTarget();
    const store = makeStore();
    // 预置一条「该滤镜」的陈旧缓存（写入时主开关是开的）。
    writeFastPath(store, 'a.example.com', true, { mode: 'Grayscale', intensity: 100 }, Date.now());
    expect(store.data.size).toBe(1);

    const { settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ masterEnabled: false }),
    });
    await settled;

    expect(store.data.size).toBe(0);
    expect(isFilterApplied(target)).toBe(false);
  });

  it('🔴 主开关 OFF 时写入的条目，永远不会让任何页面上色（同步阶段也不行）', () => {
    const store = makeStore();
    // 主开关关闭的那次导航回写的条目。
    writeFastPath(store, 'a.example.com', false, { mode: 'Grayscale', intensity: 100 }, Date.now());

    const target = makeTarget();
    const { fastPathHit, settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ masterEnabled: false, rules: [GRAY_RULE] }),
    });

    // 🔴 同步阶段**什么都没画** —— INV-8 要的是不注入，不是注入后纠正。
    expect(fastPathHit).toBe(false);
    expect(isFilterApplied(target)).toBe(false);
    expect(target.classes.size).toBe(0);
    expect(target.children, 'SVG 定义不该在 INV-8 短路时被建出来').toEqual([]);
    expect(target.props.size).toBe(0);
    settled.catch(() => {});
  });

  it('🔴 INV-8 回归：主开关 OFF 的冷加载，同步阶段一次 DOM 写入都没有', () => {
    // 这是上一轮被评审指出的真实缺陷：同步快路径在 masterEnabled 可知之前
    // 就上色，于是主开关 OFF 时每次冷加载都有一段可见的「已上色」区间。
    // 判别器：直接数 DOM 写入次数，而不是等异步纠正完再看终态
    // （等到那时看到的是纠正后的结果，缺陷会被完全掩盖 —— 正是旧门禁的盲点）。
    // ADR-069 之后「DOM 写入」包括 class 切换与 SVG 挂载,
    // 共享替身把三者**一并**记进 `writes` —— 漏记任何一种都会让
    // 这条判别器变钝。
    const target = makeTarget();
    const writes = target.writes;
    const store = makeStore();
    writeFastPath(store, 'a.example.com', false, { mode: 'Grayscale', intensity: 100 }, Date.now());

    const { settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ masterEnabled: false, rules: [GRAY_RULE] }),
    });

    expect(writes).toEqual([]); // 同步阶段零写入
    settled.catch(() => {});
  });

  it('除设置本身外无其他存储读取：匹配不发生，故不触碰规则', () => {
    const match = vi.fn(resolveRule);
    decide(settingsWith({ masterEnabled: false, rules: [GRAY_RULE] }), 'https://a.example.com/', match);
    expect(match).not.toHaveBeenCalled();
  });
});

describe('🔴 INV-8 · 主开关一关立刻抹掉推测（ADR-027「彻底止血」）', () => {
  it('主开关转 OFF 时清缓存并撤滤镜 —— 不留给下次导航的同步阶段去误用', async () => {
    const target = makeTarget();
    const store = makeStore();
    let fire: ((s: FilterSettings) => void) | null = null;

    const { settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
      subscribeSettings: (l) => {
        fire = l;
        return () => {};
      },
    });
    await settled;

    // 此刻:缓存已回写、滤镜已生效。
    expect(store.data.size).toBe(1);
    expect(isFilterApplied(target)).toBe(true);

    // 用户在 popup 里关掉主开关 —— 变更推送到本页。
    expect(fire).not.toBeNull();
    fire!(settingsWith({ masterEnabled: false, rules: [GRAY_RULE] }));

    // 🔴 缓存立刻消失,滤镜立刻撤掉。
    expect(store.data.size).toBe(0);
    expect(isFilterApplied(target)).toBe(false);

    // 于是下一次导航的**同步阶段**读到「无缓存」→ 什么都不画。
    const t2 = makeTarget();
    const { fastPathHit } = runInjector({
      target: t2,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ masterEnabled: false, rules: [GRAY_RULE] }),
    });
    expect(fastPathHit).toBe(false);
    expect(t2.classes.size).toBe(0);
    expect(t2.children).toEqual([]);
    expect(t2.props.size).toBe(0);
  });

  it('主开关仍为 ON 的变更不清缓存（不误伤正常的规则编辑）', async () => {
    const store = makeStore();
    let fire: ((s: FilterSettings) => void) | null = null;
    const { settled } = runInjector({
      target: makeTarget(),
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
      subscribeSettings: (l) => { fire = l; return () => {}; },
    });
    await settled;
    expect(store.data.size).toBe(1);

    fire!(settingsWith({ masterEnabled: true, rules: [GRAY_RULE] }));
    expect(store.data.size).toBe(1);
  });
});

// ──────────────── 已打开标签页的实时更新(gate 逐条) ────────────────
//
// 🔴 DESIGN.md §6 T4a 的独立 gate 条款:
//
//   > 已打开标签页的实时更新:注册变更**不影响**已打开页面(这是 Chrome 的
//   > 既定行为),故 JS content script 仍须能对已打开页面即时生效
//
// 为什么必须有这一组:上一轮 `subscribeSettings` 的监听器**只**分支
// `!settings.masterEnabled`,于是强度变、模式变、规则删除对已打开的标签页
// 全是 no-op —— 真实 Chrome 上一条都不生效,却**单元测试全绿**,因为当时
// 全文只有两处 `fire!()` 调用:一处 `masterEnabled:false`、一处
// `masterEnabled:true` 的 no-op。**这个测试洞正是那个产品缺陷能带绿上线的原因。**
//
// 判别器设计:每条都断言 target 上**实际的 filter 值**(而非只看 `fastPathHit`
// 或终态布尔),因为缺陷的表现恰恰是「值停在旧的那个」—— 只断言
// `isFilterApplied(target) === true` 会对「强度 100→30 后仍是 100」完全失明。
describe('🔴 已打开标签页的实时更新(ADR-062:注册变更不影响已打开页面)', () => {
  /** 建立「页面已打开且异步阶段已结算」的初始态,返回推送变更的把手。 */
  async function openedTab(initial: FilterSettings, url = 'https://a.example.com/') {
    const target = makeTarget();
    const store = makeStore();
    let fire: ((s: FilterSettings) => void) | null = null;
    const { settled } = runInjector({
      target,
      store,
      url,
      readSettings: async () => initial,
      subscribeSettings: (l) => { fire = l; return () => {}; },
    });
    await settled;
    return { target, store, push: (s: FilterSettings) => fire!(s) };
  }

  it('(a) 强度变化 → 已打开页面立即换成新的 filter 值', async () => {
    const { target, push } = await openedTab(settingsWith({ rules: [GRAY_RULE] }));
    expect(currentFilterValue(target)).toBe(filterCssValue('Grayscale', 100));

    // 用户把滑块从 100 拖到 30 —— 标签页保持打开,不导航。
    push(settingsWith({
      rules: [{ pattern: '*.example.com', mode: 'Grayscale', intensity: 30 }],
    }));

    expect(isFilterApplied(target)).toBe(true);
    expect(currentFilterValue(target)).toBe(filterCssValue('Grayscale', 30));
    // 实测缺陷态下这里仍是 intensity 100 的那个值。
    expect(currentFilterValue(target)).not.toBe(filterCssValue('Grayscale', 100));
  });

  it('(b) 模式变化 → 已打开页面立即换成新模式的 filter 值', async () => {
    const { target, push } = await openedTab(settingsWith({ rules: [GRAY_RULE] }));

    push(settingsWith({
      rules: [{ pattern: '*.example.com', mode: 'RedGreen', intensity: 100 }],
    }));

    expect(isFilterApplied(target)).toBe(true);
    expect(currentFilterValue(target)).toBe(filterCssValue('RedGreen', 100));
    expect(currentFilterValue(target)).not.toBe(filterCssValue('Grayscale', 100));
  });

  it('(c) 匹配规则被删除 → 已打开页面转为无滤镜,注入物全部撤除', async () => {
    const { target, push } = await openedTab(settingsWith({ rules: [GRAY_RULE] }));
    expect(isFilterApplied(target)).toBe(true);

    push(settingsWith({ rules: [] })); // 整条规则被删

    expect(isFilterApplied(target)).toBe(false);
    expect(currentFilterValue(target)).toBe('');
    // 🔴 ADR-069:摘掉 `ccf-on` class 就足够 —— 预生成 CSS 的选择器
    //    也是 `html.ccf-on`,两张表一并失效。旧实现必须显式设
    //    `data-ccf-off` 去压裸 `html` 规则,那层复杂性已消失。
    //    断言仍然**可观察**:class 与 SVG 节点都不得残留。
    expect(target.classes.size).toBe(0);
    expect(target.children).toEqual([]);
  });

  it('(c2) 规则改成不再匹配本页 → 同样转为无滤镜(删除之外的另一条等价路径)', async () => {
    const { target, push } = await openedTab(settingsWith({ rules: [GRAY_RULE] }));

    push(settingsWith({
      rules: [{ pattern: '*.other.test', mode: 'Grayscale', intensity: 100 }],
    }));

    expect(isFilterApplied(target)).toBe(false);
    expect(target.classes.size).toBe(0);
    expect(target.children).toEqual([]);
  });

  it('(d) 新增一条匹配本页的规则 → 原本未滤镜的已打开页面立即上色', async () => {
    const { target, push } = await openedTab(settingsWith({ rules: [] }));
    expect(isFilterApplied(target)).toBe(false);

    push(settingsWith({ rules: [GRAY_RULE] }));

    expect(isFilterApplied(target)).toBe(true);
    expect(currentFilterValue(target)).toBe(filterCssValue('Grayscale', 100));
  });

  it('主开关仍是最高优先级:规则匹配但主开关 OFF → 不上色(INV-8 在本路径同样成立)', async () => {
    const { target, push } = await openedTab(settingsWith({ rules: [] }));

    push(settingsWith({ masterEnabled: false, rules: [GRAY_RULE] }));

    expect(isFilterApplied(target)).toBe(false);
    // INV-8 在本路径同样是「页面上没有本扩展的任何痕迹」。
    expect(target.classes.size).toBe(0);
    expect(target.children).toEqual([]);
  });

  it('实时更新把新判定回写进快路径,使下一次导航同步命中**新**值(ADR-060)', async () => {
    const { store, push } = await openedTab(settingsWith({ rules: [GRAY_RULE] }));

    const next = settingsWith({
      rules: [{ pattern: '*.example.com', mode: 'RedGreen', intensity: 40 }],
    });
    push(next);

    // 下一次导航的同步阶段:必须直接命中**新**值,而不是先按旧值上色
    // 再被异步阶段纠正(那会是一次可见的错色闪动)。
    const t2 = makeTarget();
    const { fastPathHit, settled } = runInjector({
      target: t2,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => next,
    });
    expect(fastPathHit).toBe(true);
    expect(currentFilterValue(t2)).toBe(filterCssValue('RedGreen', 40));
    settled.catch(() => {});
  });

  it('幂等:推送一条毫无变化的设置 → 对 DOM 零写入(INV-1 不惊动站点的 observer)', async () => {
    const target = makeTarget();
    const writes = target.writes;
    let fire: ((s: FilterSettings) => void) | null = null;
    const { settled } = runInjector({
      target,
      store: makeStore(),
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
      subscribeSettings: (l) => { fire = l; return () => {}; },
    });
    await settled;

    writes.length = 0;
    fire!(settingsWith({ rules: [GRAY_RULE] })); // 值完全相同的另一个对象
    expect(writes).toEqual([]);
  });
});

// ─────────────────────────── INV-3 快路径 ───────────────────────────

describe('🔴 INV-3 · 同步快路径（chrome.storage 异步性的解法）', () => {
  it('缓存命中时，滤镜在 runInjector 返回之前就已应用（不需要 await）', () => {
    const target = makeTarget();
    const store = makeStore();
    writeFastPath(store, 'a.example.com', true, { mode: 'Grayscale', intensity: 100 }, Date.now());

    const { fastPathHit, settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });

    // 关键断言：**同步地**已经生效 —— 这正是「首帧之前」的可测代理。
    expect(fastPathHit).toBe(true);
    expect(isFilterApplied(target)).toBe(true);
    settled.catch(() => {});
  });

  it('无缓存时同步阶段不应用任何滤镜（不误染）', () => {
    const target = makeTarget();
    const { fastPathHit, settled } = runInjector({
      target,
      store: makeStore(),
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });
    expect(fastPathHit).toBe(false);
    expect(isFilterApplied(target)).toBe(false);
    settled.catch(() => {});
  });

  it('异步阶段结束后回写缓存，使下一次导航同步命中', async () => {
    const target = makeTarget();
    const store = makeStore();
    const { settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });
    await settled;
    expect(store.data.size).toBe(1);

    // 第二次导航：同步命中。
    const t2 = makeTarget();
    const { fastPathHit } = runInjector({
      target: t2,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });
    expect(fastPathHit).toBe(true);
    expect(isFilterApplied(t2)).toBe(true);
  });

  it('陈旧缓存被权威结果纠正（规则已删除）', async () => {
    const target = makeTarget();
    const store = makeStore();
    writeFastPath(store, 'a.example.com', true, { mode: 'Grayscale', intensity: 100 }, Date.now());

    const { settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [] }), // 规则已被删
    });
    const r = await settled;

    expect(r.corrected).toBe(true);
    expect(r.authoritative).toBeNull();
    expect(isFilterApplied(target)).toBe(false);
  });

  it('不匹配的 host 也会被缓存为 null，避免每次导航都白跑异步', async () => {
    const store = makeStore();
    const { settled } = runInjector({
      target: makeTarget(),
      store,
      url: 'https://other.test/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });
    await settled;

    const t2 = makeTarget();
    const { fastPathHit } = runInjector({
      target: t2,
      store,
      url: 'https://other.test/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });
    expect(fastPathHit).toBe(true);
    expect(isFilterApplied(t2)).toBe(false); // 推测「不滤镜」，不误染
  });
});

// ─────────────────────────── ADR-060 ───────────────────────────

describe('🔴 ADR-060 · 快路径必须跨「标签页 / 浏览器重启」存活（INV-3 冷启动）', () => {
  /**
   * 上一轮用 `sessionStorage`，它随标签页蒸发。于是
   * 「浏览器重启后首访」与「新标签页首访」在 document_start 同步阶段
   * **没有任何通道**能得知 (mode,intensity) —— 实测 6 次闪 3 次，
   * 截图确认是完整渲染的未滤镜页面。ADR-060 改用宿主 origin 的
   * `localStorage` 正是为了关掉这两格。
   *
   * 单测层把「存活性」建模为:**同一个 store 实例跨越两次独立的
   * runInjector 调用**（= 跨标签页/跨重启），第二次必须同步命中。
   * 这是 `sessionStorage` 做不到而 `localStorage` 做得到的那个差别。
   */
  it('🔴 新标签页首访同一 host —— 同步阶段即命中（sessionStorage 做不到）', async () => {
    // 标签页 A:冷的，异步阶段回写缓存。
    const store = makeStore();
    const tabA = makeTarget();
    const { fastPathHit: hitA, settled } = runInjector({
      target: tabA,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });
    expect(hitA, '首访本就无缓存可命中').toBe(false);
    await settled;

    // 标签页 B:全新的 target（新文档），但 origin 的 localStorage 还在。
    const tabB = makeTarget();
    const { fastPathHit: hitB } = runInjector({
      target: tabB,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });
    expect(hitB, '新标签页未同步命中 —— INV-3 在该场景下破裂').toBe(true);
    expect(isFilterApplied(tabB)).toBe(true);
  });

  it('🔴 TTL 覆盖长间隔不访问的站点 —— 29 天后仍命中', () => {
    const store = makeStore();
    const t0 = Date.UTC(2026, 0, 1);
    writeFastPath(store, 'a.example.com', true, { mode: 'Grayscale', intensity: 100 }, t0);

    // 24 小时的旧 TTL 会在这里判过期 → 冷启动闪烁重新出现。
    const { fastPathHit } = runInjector({
      target: makeTarget(),
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
      clock: () => t0 + 29 * 24 * 60 * 60 * 1000,
    });
    expect(fastPathHit, '29 天后未命中 —— TTL 太短会让 INV-3 重新变成非确定性失败').toBe(true);
  });

  it('超出 TTL（31 天）后不再命中 —— 陈旧推测终须清退，且由异步权威兜底', async () => {
    const store = makeStore();
    const t0 = Date.UTC(2026, 0, 1);
    writeFastPath(store, 'a.example.com', true, { mode: 'Grayscale', intensity: 100 }, t0);
    const later = t0 + 31 * 24 * 60 * 60 * 1000;

    const target = makeTarget();
    const { fastPathHit, settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
      clock: () => later,
    });
    expect(fastPathHit).toBe(false);
    // 但功能本身不受影响 —— 异步权威路径照样把滤镜套上。
    await settled;
    expect(isFilterApplied(target)).toBe(true);
  });

  it('🔴 异步校对发现配置已变时:更新渲染**并**刷新缓存（gate 逐字要求）', async () => {
    const store = makeStore();
    const now = Date.now();
    // 陈旧推测:Grayscale。
    writeFastPath(store, 'a.example.com', true, { mode: 'Grayscale', intensity: 100 }, now);

    const target = makeTarget();
    const { fastPathHit, settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      // 权威设置其实已改成 RedGreen 40。
      readSettings: async () =>
        settingsWith({ rules: [{ pattern: '*.example.com', mode: 'RedGreen', intensity: 40 }] }),
    });

    // 同步阶段先按陈旧推测上色（有色总比无色好 —— INV-3 优先于短暂的色相不准）。
    expect(fastPathHit).toBe(true);
    expect(currentFilterValue(target)).toBe(filterCssValue('Grayscale', 100));

    const r = await settled;

    // 1) 渲染被更新为权威值。
    expect(r.corrected).toBe(true);
    expect(currentFilterValue(target)).toBe(filterCssValue('RedGreen', 40));

    // 2) 缓存被刷新 —— 否则下一次加载还会先闪一下旧色相。
    const entry = JSON.parse(store.data.get('__ccf_fp_a.example.com')!) as {
      mode: string; intensity: number;
    };
    expect(entry.mode).toBe('RedGreen');
    expect(entry.intensity).toBe(40);
  });

  it('🔴 记录内容**只含** mode + intensity（ADR-060 授权范围，隐私代价的上限）', async () => {
    const store = makeStore();
    const { settled } = runInjector({
      target: makeTarget(),
      store,
      url: 'https://a.example.com/secret-path?q=token#frag',
      readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
    });
    await settled;

    const raw = store.data.get('__ccf_fp_a.example.com')!;
    const entry = JSON.parse(raw) as Record<string, unknown>;

    // 站点 JS 能读到这条记录（ADR-060 已接受的代价）。所以它里面
    // 能有什么必须被**精确**钉死，不能随实现漂移地多带出任何东西。
    expect(Object.keys(entry).sort()).toEqual(
      ['intensity', 'masterEnabled', 'mode', 'writtenAt'].sort(),
    );
    expect(entry.mode).toBe('Grayscale');
    expect(entry.intensity).toBe(100);

    // 绝不含 URL / 路径 / 查询串等页面信息。
    expect(raw).not.toContain('secret-path');
    expect(raw).not.toContain('token');
    expect(raw).not.toContain('frag');
  });

  it('🔴 键按 host 分隔 —— 不把别的站点的配置泄露给本站（ADR-060 窄口）', async () => {
    const store = makeStore();
    for (const url of ['https://a.example.com/', 'https://other.test/']) {
      const { settled } = runInjector({
        target: makeTarget(),
        store,
        url,
        readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
      });
      await settled;
    }
    // 两个 host 各自一条，键名互不相同。
    expect([...store.data.keys()].sort()).toEqual(
      ['__ccf_fp_a.example.com', '__ccf_fp_other.test'].sort(),
    );
    // 真实浏览器里 localStorage 本就按 origin 隔离，这条断言守的是
    // 「键名里带 host，不会在同一 origin 下互相覆盖」。
  });
});

// ─────────────────────────── ADR-025 ───────────────────────────

describe('🔴 ADR-025 · 缓存里绝不出现派生值（不制造第二份真相）', () => {
  it('回写的 JSON 只含 (mode,intensity) 等设置值，不含 filter 串/矩阵系数', async () => {
    const store = makeStore();
    const { settled } = runInjector({
      target: makeTarget(),
      store,
      // RedGreen 走 feColorMatrix 路径 —— 派生值最「胖」、最容易被顺手存下来的那种。
      url: 'https://a.example.com/',
      readSettings: async () =>
        settingsWith({ rules: [{ pattern: '*.example.com', mode: 'RedGreen', intensity: 60 }] }),
    });
    await settled;

    const raw = [...store.data.values()][0] as string;
    const derived = filterCssValue('RedGreen', 60);

    // 逐字的派生串不得出现。
    expect(raw).not.toContain(derived);
    // 派生值的特征片段同样不得出现（防止换个编码方式偷渡）。
    expect(raw).not.toContain('feColorMatrix');
    expect(raw).not.toContain('data:image/svg');
    expect(raw).not.toContain('grayscale(');

    // 存的就是那两个设置值本身。
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed['mode']).toBe('RedGreen');
    expect(parsed['intensity']).toBe(60);
  });

  it('派生值在读取时现算：改了 filterCssValue 的输入即刻反映，不会沿用旧串', () => {
    const store = makeStore();
    writeFastPath(store, 'a.example.com', true, { mode: 'RedGreen', intensity: 60 }, Date.now());

    const target = makeTarget();
    const { settled } = runInjector({
      target,
      store,
      url: 'https://a.example.com/',
      readSettings: async () => settingsWith({ rules: [] }),
    });
    // 同步阶段用的值 === 由存储里那两个设置值现算出来的值。
    expect(target.props.get('--ccf-filter')).toBe(filterCssValue('RedGreen', 60));
    settled.catch(() => {});
  });
});

// ─────────────────────────── 解析语义 ───────────────────────────

describe('decide · 首个命中胜（INV-6）与四种模式', () => {
  it('首个命中的规则生效，且只有它生效', () => {
    const s = settingsWith({
      rules: [
        { pattern: '*.example.com', mode: 'RedGreen', intensity: 60 },
        { pattern: '*', mode: 'Grayscale', intensity: 100 },
      ],
    });
    expect(decide(s, 'https://a.example.com/')).toBe(filterCssValue('RedGreen', 60));
  });

  it('无规则命中 → 不套滤镜', () => {
    expect(decide(settingsWith({ rules: [GRAY_RULE] }), 'https://nope.test/')).toBeNull();
  });

  it('非法 URL → 不套滤镜，不抛异常', () => {
    expect(decide(settingsWith({ rules: [GRAY_RULE] }), 'not a url')).toBeNull();
  });
});

describe('健壮性', () => {
  it('localStorage 抛 SecurityError 时不崩溃（data: 文档 / 站点禁用存储等上下文）', () => {
    const hostile: SyncKeyValueStore = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
      removeItem: () => { throw new Error('SecurityError'); },
    };
    const target = makeTarget();
    expect(() =>
      runInjector({
        target,
        store: hostile,
        url: 'https://a.example.com/',
        readSettings: async () => settingsWith({ rules: [GRAY_RULE] }),
      }).settled.catch(() => {}),
    ).not.toThrow();
  });
});

// ───────────────── INV-3:冷缓存下的同步上色(ADR-062 + ADR-069) ─────────────────

describe('🔴 INV-3 · 冷缓存下同步阶段必须上色(声明式注册的自述标记)', () => {
  /**
   * 🔴 **本组钉住的是一个真实回归,不是假想场景。**
   *
   * ADR-069 给预生成 CSS 加了 `.ccf-on` 门控之后,真实 Chrome 逐帧录屏
   * 抓到 `coldCache 1/4`、`1/3`、`1/5`、`2/127` 帧带色 —— 根因是:
   * 冷缓存下 `readFastPath` 返回 `unknown`,同步阶段**什么都不做**,
   * class 要等异步 `chrome.storage` 读完才加上,JS 被放回了关键路径。
   *
   * 门控之前预生成 CSS 是无条件的 `html { filter: … }`,首帧上色**零 JS
   * 依赖** —— 那正是 ADR-062 零闪烁保证的基础。
   *
   * 修法:预生成文件自带一行无门控的 `:root { --ccf-registered: … }`,
   * 同步读出它即可知道浏览器已判定本 host 该上色。
   */
  const registeredReader = (marker: string) => () => ({
    getPropertyValue: (name: string) =>
      name === '--ccf-registered' ? marker : '',
  });

  it('🔴 冷缓存 + 已注册 → `runInjector` **返回之前**滤镜已就位(不 await)', () => {
    const target = makeTarget();
    const store = makeStore(); // 空 —— 冷缓存

    const run = runInjector({
      target,
      store,
      url: 'https://sub.example.com/page',
      readSettings: () =>
        // 异步权威**永不解析** —— 以此证明同步阶段独立成立。
        new Promise(() => {
          /* never */
        }),
      getComputedStyle: registeredReader('ccf-gray-100'),
    });

    // 同步阶段的可观测结果:快路径未命中,但注册自述命中了。
    expect(run.fastPathHit).toBe(false);
    expect(run.registeredHit).toBe(true);
    // 🔴 关键:此刻(同步,未 await 任何东西)页面已是滤镜态。
    expect(isFilterApplied(target)).toBe(true);
    expect(currentFilterValue(target)).toBe(filterCssValue('Grayscale', 100));
  });

  it('🔴 ADR-069 的两步顺序在这条路径上同样成立:SVG 先于 class', () => {
    // 冷缓存路径是**新增**的写入点,顺序约束必须在这里也被断言 ——
    // 否则「先加 class 再插 SVG」会在这条路上悄悄复活,而那正是
    // ADR-069 定为硬约束的那件事。
    const target = makeTarget();
    runInjector({
      target,
      store: makeStore(),
      url: 'https://sub.example.com/',
      readSettings: () => new Promise(() => {}),
      getComputedStyle: registeredReader('ccf-redgreen-60'),
    });
    const svgAt = target.writes.indexOf('appendChild');
    const classAt = target.writes.indexOf('class.add:ccf-on');
    expect(svgAt).toBeGreaterThanOrEqual(0);
    expect(classAt).toBeGreaterThanOrEqual(0);
    expect(svgAt).toBeLessThan(classAt);
    // 被引用的 <filter> 必须真的在容器里,否则 url("#…") 引用不到。
    expect(target.svgContainer()?.idsWithin()).toContain('ccf-redgreen-60');
  });

  it('四个模式全部走同一条路径(ADR-070:灰阶不例外)', () => {
    for (const [marker, mode, intensity] of [
      ['ccf-gray-100', 'Grayscale', 100],
      ['ccf-redgreen-60', 'RedGreen', 60],
      ['ccf-greenred-30', 'GreenRed', 30],
      ['ccf-blueyellow-7', 'BlueYellow', 7],
    ] as const) {
      const target = makeTarget();
      const run = runInjector({
        target,
        store: makeStore(),
        url: 'https://sub.example.com/',
        readSettings: () => new Promise(() => {}),
        getComputedStyle: registeredReader(marker),
      });
      expect(run.registeredHit, marker).toBe(true);
      expect(currentFilterValue(target)).toBe(filterCssValue(mode, intensity));
      // 灰阶也必须有 SVG 定义 —— 不再走内置 grayscale()。
      expect(target.svgContainer()?.idsWithin(), marker).toContain(marker);
    }
  });

  it('🔴 未注册(无标记)→ 同步阶段什么都不做(与修复前行为一致,向后兼容)', () => {
    // 绝大多数页面走这条路:没有规则匹配 → 没注册 → 属性不存在。
    const target = makeTarget();
    const run = runInjector({
      target,
      store: makeStore(),
      url: 'https://unmatched.test/',
      readSettings: () => new Promise(() => {}),
      getComputedStyle: registeredReader(''),
    });
    expect(run.registeredHit).toBe(false);
    expect(isFilterApplied(target)).toBe(false);
    expect(target.writes).toEqual([]);
  });

  it('快路径已命中时不再探测注册标记(不做无谓的样式计算)', () => {
    const target = makeTarget();
    const store = makeStore();
    writeFastPath(store, 'sub.example.com', true, { mode: 'RedGreen', intensity: 60 }, Date.now());
    let asked = 0;
    const run = runInjector({
      target,
      store,
      url: 'https://sub.example.com/',
      readSettings: () => new Promise(() => {}),
      getComputedStyle: () => {
        asked += 1;
        return { getPropertyValue: () => 'ccf-gray-100' };
      },
    });
    expect(run.fastPathHit).toBe(true);
    expect(run.registeredHit).toBe(false);
    expect(asked).toBe(0);
    // 用的是快路径的值,不是标记的值。
    expect(currentFilterValue(target)).toBe(filterCssValue('RedGreen', 60));
  });

  it('🔴 缺 getComputedStyle 的宿主:退化为旧行为,绝不抛异常', () => {
    const target = makeTarget();
    expect(() =>
      runInjector({
        target,
        store: makeStore(),
        url: 'https://sub.example.com/',
        readSettings: () => new Promise(() => {}),
        // 不传 getComputedStyle,且本测试环境全局也没有它。
      }),
    ).not.toThrow();
    expect(isFilterApplied(target)).toBe(false);
  });

  it('🔴 异步权威结果仍然说话:标记上了色,但权威说不该 → 被撤', async () => {
    // 多匹配误伤(超集放宽)的收敛路径。这与 ADR-069 之前裸 `html` 时代
    // 的行为**完全一致**(那时误伤页面同样先上色再被撤),
    // 故本修复没有扩大误伤窗口 —— 只是把窗口恢复到回归之前。
    const target = makeTarget();
    const run = runInjector({
      target,
      store: makeStore(),
      url: 'https://other.test/',
      // 权威设置里没有任何匹配 other.test 的规则。
      readSettings: () => Promise.resolve(settingsWith({ rules: [GRAY_RULE] })),
      getComputedStyle: registeredReader('ccf-gray-100'),
    });
    expect(isFilterApplied(target)).toBe(true); // 同步:先上色
    const settled = await run.settled;
    expect(settled.registeredHit).toBe(true);
    expect(settled.authoritative).toBeNull();
    expect(settled.corrected).toBe(true);
    expect(isFilterApplied(target)).toBe(false); // 异步:被撤
  });

  it('🔴 INV-8 不被这条路径绕过:主开关 OFF 时权威阶段仍然彻底止血', async () => {
    // 主开关 OFF → desiredRegistrations() 返回空集 → CSS 压根不会注册,
    // 所以生产环境读不到标记。但接收端不能依赖这一点,故断言:
    // 即便标记存在(陈旧注册尚未被 reconcile 清掉),权威阶段也会撤。
    const target = makeTarget();
    const run = runInjector({
      target,
      store: makeStore(),
      url: 'https://sub.example.com/',
      readSettings: () =>
        Promise.resolve(settingsWith({ masterEnabled: false, rules: [GRAY_RULE] })),
      getComputedStyle: registeredReader('ccf-gray-100'),
    });
    await run.settled;
    expect(isFilterApplied(target)).toBe(false);
    expect(currentFilterValue(target)).toBe('');
  });
});
