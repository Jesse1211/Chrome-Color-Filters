/**
 * 实时预览接收端(**ADR-049**)—— DESIGN.md §6 T4b gate 的**逐条**对应。
 *
 * gate 原文(§6 T4b):
 *
 * > - **`PREVIEW_FILTER` / `PREVIEW_CLEAR` 实现正确(ADR-049)**:
 * >   - 收到 `PREVIEW_FILTER` 后页面滤镜立即变化,**且 storage 无写入**(spy 断言)
 * >   - 收到 `PREVIEW_CLEAR` 后恢复按规则解析的结果
 * >   - **端口断开(popup 关闭)自动恢复**,页面不残留预览态
 * >   - 预览期间导航到新页面,新页面按规则渲染而非预览值
 * >   - **预览活动期间收到 `onChanged`,页面不重绘**(断言无闪烁),
 * >     `PREVIEW_CLEAR` 后才按新值渲染
 *
 * 下面每个 describe 块标注了它对应哪一条。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  type FilterSettings,
  defaultSettings,
  filterCssValue,
} from '../../domain/index.js';
import {
  type FilterTarget,
  type OnConnectLike,
  type PreviewPortLike,
  type SyncKeyValueStore,
  PREVIEW_CLEAR,
  PREVIEW_FILTER,
  PREVIEW_PORT_NAME,
  attachPreviewPort,
  coercePreviewMessage,
  createRenderArbiter,
  currentFilterValue,
  isFilterApplied,
  isFilterSuppressed,
  runInjector,
  startPreviewReceiver,
  writeFastPath,
} from '../index.js';

function makeTarget(): FilterTarget & {
  attrs: Map<string, string>;
  props: Map<string, string>;
} {
  const attrs = new Map<string, string>();
  const props = new Map<string, string>();
  return {
    attrs,
    props,
    setAttribute: (n, v) => void attrs.set(n, v),
    removeAttribute: (n) => void attrs.delete(n),
    hasAttribute: (n) => attrs.has(n),
    style: {
      setProperty: (n, v) => void props.set(n, v),
      removeProperty: (n) => void props.delete(n),
      getPropertyValue: (n) => props.get(n) ?? '',
    },
  };
}

/** 记录每一次读写的假同步存储 —— gate 的「storage 无写入」spy 断言靠它。 */
function makeStore(): SyncKeyValueStore & {
  data: Map<string, string>;
  writes: string[];
  removes: string[];
} {
  const data = new Map<string, string>();
  const writes: string[] = [];
  const removes: string[] = [];
  return {
    data,
    writes,
    removes,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      writes.push(k);
      data.set(k, v);
    },
    removeItem: (k) => {
      removes.push(k);
      data.delete(k);
    },
  };
}

/** 假端口 —— 模拟 popup 侧 `chrome.tabs.connect(tabId, { name: 'preview' })`。 */
function makePort(name: string = PREVIEW_PORT_NAME): PreviewPortLike & {
  send: (message: unknown) => void;
  disconnect: () => void;
} {
  const messageListeners: ((m: unknown) => void)[] = [];
  const disconnectListeners: (() => void)[] = [];
  return {
    name,
    onMessage: { addListener: (l) => void messageListeners.push(l) },
    onDisconnect: { addListener: (l) => void disconnectListeners.push(l) },
    send: (message) => {
      for (const l of messageListeners) l(message);
    },
    disconnect: () => {
      for (const l of disconnectListeners) l();
    },
  };
}

function makeOnConnect(): OnConnectLike & {
  connect: (port: PreviewPortLike) => void;
} {
  const listeners: ((p: PreviewPortLike) => void)[] = [];
  return {
    addListener: (l) => void listeners.push(l),
    connect: (port) => {
      for (const l of listeners) l(port);
    },
  };
}

function settingsWith(partial: Partial<FilterSettings>): FilterSettings {
  return { ...defaultSettings(), ...partial };
}

const RULE_GRAY_100 = {
  pattern: '*.example.com',
  mode: 'Grayscale',
  intensity: 100,
} as const;

const URL = 'https://a.example.com/page';
const HOST = 'a.example.com';
const GRAY_100 = filterCssValue('Grayscale', 100);
const GRAY_30 = filterCssValue('Grayscale', 30);
/*
 * 🔴 ADR-075:只剩一个模式,故「另一个滤镜值」一律用**强度**构造
 * (DESIGN.md §6:「ADR-075 后只有一个模式,用强度区分」)。
 * 本文件里这个常量的角色始终是「与 GRAY_100 不同的某个值」,
 * 判别器是「值变了没」,与它由哪个模式产生无关。
 */
const GRAY_70 = filterCssValue('Grayscale', 70);

// ─────────────────── 契约收敛(ADR-049 + ADR-041) ───────────────────

describe('ADR-049 · 消息契约收敛', () => {
  it('合法 PREVIEW_FILTER 被接受,字段逐字一致', () => {
    expect(
      coercePreviewMessage({
        type: 'PREVIEW_FILTER',
        mode: 'Grayscale',
        intensity: 70,
      }),
    ).toEqual({ type: PREVIEW_FILTER, mode: 'Grayscale', intensity: 70 });
  });

  it('🔴 ADR-075:带已删除模式的 PREVIEW_FILTER 被判为契约不符(返回 null)', () => {
    /*
     * 这不是「顺手补一条」—— 它守的是 `coercePreviewMessage` 里那条刻意的
     * 设计:`mode` 必须**原样合法**才接受,**不走 coerce 的默认回退**。
     *
     * 若这里改成静默回退成 Grayscale,一个版本错配的 popup
     * (旧 popup + 新 content script)发来的 `RedGreen` 预览会被当成
     * 合法的灰阶预览接受,表现为「预览总是灰阶」—— 比「无反应」更难诊断。
     *
     * 📌 注意这与**存储**路径的处置刻意相反:存储里的旧模式必须被收敛
     * (ADR-075 的迁移,见 domain/filter-mode.ts),因为那是用户已有的数据,
     * 丢弃它等于静默删规则(ADR-012)。而消息是瞬时的、可重发的,
     * 对它严格更安全。两处语义不同是有意的。
     */
    for (const gone of ['RedGreen', 'GreenRed', 'BlueYellow']) {
      expect(
        coercePreviewMessage({
          type: 'PREVIEW_FILTER',
          mode: gone,
          intensity: 70,
        }),
        `${gone} 必须被拒绝`,
      ).toBeNull();
    }
  });

  it('合法 PREVIEW_CLEAR 被接受', () => {
    expect(coercePreviewMessage({ type: 'PREVIEW_CLEAR' })).toEqual({
      type: PREVIEW_CLEAR,
    });
  });

  it('intensity 走 ADR-003 的收敛:夹取 + 取整', () => {
    expect(
      coercePreviewMessage({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 150 }),
    ).toEqual({ type: PREVIEW_FILTER, mode: 'Grayscale', intensity: 100 });
    expect(
      coercePreviewMessage({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 70.4 }),
    ).toEqual({ type: PREVIEW_FILTER, mode: 'Grayscale', intensity: 70 });
  });

  it('🔴 非法 mode 被**拒绝**而非静默回退默认值', () => {
    // 静默变成 Grayscale 会让「T6b 契约不符」表现为「预览总是灰阶」,
    // 那比「无反应」更难诊断(见 preview-contract.ts 的注释)。
    expect(
      coercePreviewMessage({ type: 'PREVIEW_FILTER', mode: 'R-G', intensity: 50 }),
    ).toBeNull();
  });

  it('畸形输入一律返回 null,绝不抛异常(INV-1)', () => {
    for (const bad of [
      null, undefined, 42, 'PREVIEW_FILTER', [], {},
      { type: 'OTHER' },
      { type: 'PREVIEW_FILTER' },
      { type: 'PREVIEW_FILTER', mode: 'Grayscale' },
      { type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 'x' },
      { type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: Number.NaN },
    ]) {
      expect(() => coercePreviewMessage(bad)).not.toThrow();
      expect(coercePreviewMessage(bad)).toBeNull();
    }
  });
});

// ─────────── gate 条款 1:立即变化 + storage 无写入 ───────────

describe('🔴 gate · 收到 PREVIEW_FILTER 后页面滤镜立即变化,且 storage 无写入', () => {
  it('滤镜立即变为预览值', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, GRAY_100);
    arbiter.setBase(GRAY_100);
    const port = makePort();
    attachPreviewPort(port, arbiter);

    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 70 });

    expect(currentFilterValue(target)).toBe(GRAY_70);
    expect(isFilterApplied(target)).toBe(true);
  });

  it('🔴 整条预览链路(runInjector + 端口)对 storage 零写入 —— spy 断言', async () => {
    const target = makeTarget();
    const store = makeStore();
    const onConnect = makeOnConnect();
    const readSettings = vi.fn(() =>
      Promise.resolve(settingsWith({ rules: [RULE_GRAY_100] })),
    );

    const run = runInjector({
      target,
      store,
      url: URL,
      readSettings,
      onConnect,
    });
    await run.settled;

    // 基线:异步阶段的回写是**规则**路径的正常行为,与预览无关。
    const writesBeforePreview = store.writes.length;
    const removesBeforePreview = store.removes.length;
    const readsBefore = readSettings.mock.calls.length;

    const port = makePort();
    onConnect.connect(port);

    // 像用户拖动滑块一样连发 50 条 —— 不受防抖影响,每条都渲染(ADR-049)。
    for (let i = 0; i <= 50; i += 1) {
      port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: i });
    }

    expect(currentFilterValue(target)).toBe(filterCssValue('Grayscale', 50));

    // 🔴 gate 逐字:「且 storage 无写入(spy 断言)」
    expect(store.writes.length).toBe(writesBeforePreview);
    expect(store.removes.length).toBe(removesBeforePreview);
    // 预览也不触发任何设置读取。
    expect(readSettings.mock.calls.length).toBe(readsBefore);
  });

  it('🔴 预览值绝不落盘:快路径缓存里仍是**规则**值,不是预览值', async () => {
    const target = makeTarget();
    const store = makeStore();
    const onConnect = makeOnConnect();

    const run = runInjector({
      target,
      store,
      url: URL,
      readSettings: () =>
        Promise.resolve(settingsWith({ rules: [RULE_GRAY_100] })),
      onConnect,
    });
    await run.settled;

    const cachedAfterRules = store.data.get(`__ccf_fp_${HOST}`);
    expect(cachedAfterRules).toBeDefined();

    const port = makePort();
    onConnect.connect(port);
    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 13 });

    // 条目逐字节未变 —— 预览没有把 (Grayscale,13) 写进去。
    expect(store.data.get(`__ccf_fp_${HOST}`)).toBe(cachedAfterRules);
    // 判别器:缓存里存的是规则值 100 档,13 这个预览强度不得出现。
    expect(cachedAfterRules).not.toContain('13');
  });

  it('连续拖动:每一条都渲染(不合并、不防抖)', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    const port = makePort();
    attachPreviewPort(port, arbiter);

    const before = arbiter.renders();
    for (let i = 0; i < 10; i += 1) {
      port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: i * 10 });
    }
    // 🔴 ADR-049:「预览却必须每次拖动都渲染」。
    expect(arbiter.renders() - before).toBe(10);
  });
});

// ─────────── gate 条款 2:PREVIEW_CLEAR 恢复规则结果 ───────────

describe('🔴 gate · 收到 PREVIEW_CLEAR 后恢复按规则解析的结果', () => {
  it('恢复为规则值', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    arbiter.setBase(GRAY_100);
    const port = makePort();
    attachPreviewPort(port, arbiter);

    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 70 });
    expect(currentFilterValue(target)).toBe(GRAY_70);

    port.send({ type: 'PREVIEW_CLEAR' });

    expect(currentFilterValue(target)).toBe(GRAY_100);
    expect(arbiter.hasOverride()).toBe(false);
  });

  it('🔴 规则结果为「不上色」时,PREVIEW_CLEAR 后压制属性回到位', () => {
    // 新架构(ADR-062)下「不上色」必须由 `data-ccf-off` 显式压制,
    // 只摘 `data-ccf-on` 压不掉预生成的裸 `html` CSS(见 apply-filter.ts)。
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    arbiter.setBase(null);
    expect(isFilterSuppressed(target)).toBe(true);

    const port = makePort();
    attachPreviewPort(port, arbiter);

    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 50 });
    expect(isFilterSuppressed(target)).toBe(false);
    expect(isFilterApplied(target)).toBe(true);

    port.send({ type: 'PREVIEW_CLEAR' });

    expect(isFilterApplied(target)).toBe(false);
    expect(isFilterSuppressed(target)).toBe(true);
  });

  it('未处于预览态时收到 PREVIEW_CLEAR 是 no-op(零重绘)', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, GRAY_100);
    const port = makePort();
    attachPreviewPort(port, arbiter);

    const before = arbiter.renders();
    port.send({ type: 'PREVIEW_CLEAR' });
    expect(arbiter.renders()).toBe(before);
  });
});

// ─────────── gate 条款 3:端口断开自动恢复,不残留 ───────────

describe('🔴 gate · 端口断开(popup 关闭)自动恢复,页面不残留预览态', () => {
  it('onDisconnect → 覆盖结束,恢复规则值', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    arbiter.setBase(GRAY_100);
    const port = makePort();
    attachPreviewPort(port, arbiter);

    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 42 });
    expect(currentFilterValue(target)).not.toBe(GRAY_100);

    // popup 关闭(Chrome 弹窗一失焦即销毁)→ tab 端口 onDisconnect。
    port.disconnect();

    expect(arbiter.hasOverride()).toBe(false);
    expect(currentFilterValue(target)).toBe(GRAY_100);
  });

  it('🔴 用户不点保存就关掉 popup → 页面完全恢复原状(DESIGN.md 逐字)', () => {
    // 「预览值绝不落盘 —— 用户不点保存就离开,页面必须恢复原状。」
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    arbiter.setBase(null); // 该页本来不匹配任何规则
    const port = makePort();
    attachPreviewPort(port, arbiter);

    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 100 });
    expect(isFilterApplied(target)).toBe(true);

    port.disconnect();

    expect(isFilterApplied(target)).toBe(false);
    expect(isFilterSuppressed(target)).toBe(true);
  });

  it('断开后迟到的 PREVIEW_FILTER 被忽略(不复活预览态)', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    arbiter.setBase(GRAY_100);
    const port = makePort();
    attachPreviewPort(port, arbiter);

    port.disconnect();
    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 10 });

    expect(arbiter.hasOverride()).toBe(false);
    expect(currentFilterValue(target)).toBe(GRAY_100);
  });

  it('重复 onDisconnect 安全(零重绘)', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, GRAY_100);
    const port = makePort();
    attachPreviewPort(port, arbiter);

    port.disconnect();
    const after = arbiter.renders();
    port.disconnect();
    expect(arbiter.renders()).toBe(after);
  });

  it('只处理名为 preview 的端口,其他端口原样放过', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, GRAY_100);
    const onConnect = makeOnConnect();
    const handle = startPreviewReceiver({ arbiter, onConnect });

    const other = makePort('something-else');
    onConnect.connect(other);
    other.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 0 });

    expect(handle.stats().ports).toBe(0);
    expect(arbiter.hasOverride()).toBe(false);
  });
});

// ─────────── gate 条款 4:预览期间导航 ───────────

describe('🔴 gate · 预览期间导航到新页面,新页面按规则渲染而非预览值', () => {
  it('新文档的新实例从规则值起渲染 —— 预览值无处可传递', async () => {
    const store = makeStore();
    const settings = settingsWith({ rules: [RULE_GRAY_100] });

    // ── 旧页面:预览中 ──
    const oldTarget = makeTarget();
    const oldOnConnect = makeOnConnect();
    const oldRun = runInjector({
      target: oldTarget,
      store,
      url: URL,
      readSettings: () => Promise.resolve(settings),
      onConnect: oldOnConnect,
    });
    await oldRun.settled;

    const port = makePort();
    oldOnConnect.connect(port);
    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 7 });
    expect(currentFilterValue(oldTarget)).toBe(filterCssValue('Grayscale', 7));

    // ── 导航:同一个 store(同 origin 的 localStorage)被新文档继承 ──
    //    这一格的要害正是**共享 store**:若预览值曾落盘,它会在这里浮现。
    const newTarget = makeTarget();
    const newRun = runInjector({
      target: newTarget,
      store,
      url: 'https://a.example.com/other',
      readSettings: () => Promise.resolve(settings),
    });

    // 同步阶段(首帧之前)就已按**规则**值上色,不是预览值。
    expect(currentFilterValue(newTarget)).toBe(GRAY_100);
    expect(currentFilterValue(newTarget)).not.toBe(
      filterCssValue('Grayscale', 7),
    );

    const result = await newRun.settled;
    expect(result.authoritative).toBe(GRAY_100);
    expect(currentFilterValue(newTarget)).toBe(GRAY_100);

    // 旧文档销毁 → 旧端口 onDisconnect(两者都会触发,见 ADR-049 生命周期)。
    port.disconnect();
  });
});

// ─────────── gate 条款 5:预览活动期间的 onChanged ───────────

describe('🔴 gate · 预览活动期间收到 onChanged,页面不重绘;PREVIEW_CLEAR 后才按新值渲染', () => {
  it('ADR-049 优先级:onChanged 只更新底层结果,不重绘', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    arbiter.setBase(GRAY_100);

    const port = makePort();
    attachPreviewPort(port, arbiter);
    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 70 });

    const rendersAfterPreview = arbiter.renders();
    const previewValue = currentFilterValue(target);
    expect(previewValue).toBe(filterCssValue('Grayscale', 70));

    // 迟到的 onChanged 带着旧值 50 —— DESIGN.md 点名的那个 bug 的源头。
    arbiter.setBase(filterCssValue('Grayscale', 50));

    // 🔴 「断言无闪烁」:零新增渲染,页面上的值**逐字节未变**。
    expect(arbiter.renders()).toBe(rendersAfterPreview);
    expect(currentFilterValue(target)).toBe(previewValue);

    // PREVIEW_CLEAR 后才按**新**值渲染(不是预览前那个 100)。
    port.send({ type: 'PREVIEW_CLEAR' });
    expect(currentFilterValue(target)).toBe(filterCssValue('Grayscale', 50));
  });

  it('🔴 整条链路:预览中 subscribeSettings 到达 → 页面不重绘', async () => {
    const target = makeTarget();
    const store = makeStore();
    const onConnect = makeOnConnect();
    let notify: ((s: FilterSettings) => void) | null = null;

    const run = runInjector({
      target,
      store,
      url: URL,
      readSettings: () =>
        Promise.resolve(settingsWith({ rules: [RULE_GRAY_100] })),
      subscribeSettings: (l) => {
        notify = l;
        return () => undefined;
      },
      onConnect,
    });
    await run.settled;
    expect(currentFilterValue(target)).toBe(GRAY_100);

    const port = makePort();
    onConnect.connect(port);
    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 70 });
    const previewValue = currentFilterValue(target);
    const rendersAfterPreview = run.arbiter.renders();

    // 另一个窗口 / T5 的同步把强度改成了 30(经 chrome.storage.onChanged 到达)。
    notify!(
      settingsWith({
        rules: [{ pattern: '*.example.com', mode: 'Grayscale', intensity: 30 }],
      }),
    );

    // 页面不重绘,仍是预览值。
    expect(run.arbiter.renders()).toBe(rendersAfterPreview);
    expect(currentFilterValue(target)).toBe(previewValue);

    // 🔴 但**缓存簿记照常**:onChanged 是权威的规则变更,该进快路径
    //    (被压住的只有重绘)。否则下一次导航会按陈旧的 100 上色。
    expect(store.data.get(`__ccf_fp_${HOST}`)).toContain('30');

    // 覆盖结束 → 按 onChanged 带来的新值 30 渲染。
    port.send({ type: 'PREVIEW_CLEAR' });
    expect(currentFilterValue(target)).toBe(GRAY_30);
  });

  it('🔴 预览中异步权威结果返回 → 不重绘(MV3 冷启动的真实时序)', async () => {
    const target = makeTarget();
    const store = makeStore();
    const onConnect = makeOnConnect();

    // 让异步读取挂住,模拟 MV3 冷启动下 chrome.storage 的百毫秒级首读。
    let resolveSettings: ((s: FilterSettings) => void) | null = null;
    const run = runInjector({
      target,
      store,
      url: URL,
      readSettings: () =>
        new Promise<FilterSettings>((r) => {
          resolveSettings = r;
        }),
      onConnect,
    });

    // 用户在权威结果返回**之前**就开始拖动滑块。
    const port = makePort();
    onConnect.connect(port);
    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 70 });
    expect(currentFilterValue(target)).toBe(GRAY_70);
    const rendersAfterPreview = run.arbiter.renders();

    resolveSettings!(settingsWith({ rules: [RULE_GRAY_100] }));
    await run.settled;

    // 刚拖出来的预览色没有被规则色盖掉,连一帧都没有。
    expect(run.arbiter.renders()).toBe(rendersAfterPreview);
    expect(currentFilterValue(target)).toBe(GRAY_70);

    port.send({ type: 'PREVIEW_CLEAR' });
    expect(currentFilterValue(target)).toBe(GRAY_100);
  });

  it('🔴 INV-8 凌驾预览:主开关 OFF 到达时覆盖被撤,页面止血', async () => {
    // ADR-049 把 masterEnabled==false 列为 popup 侧「一律不发送」,
    // 但接收端不能依赖发送端守规矩 —— ADR-027 要的是「关主开关可彻底止血」。
    const target = makeTarget();
    const store = makeStore();
    const onConnect = makeOnConnect();
    let resolveSettings: ((s: FilterSettings) => void) | null = null;

    const run = runInjector({
      target,
      store,
      url: URL,
      readSettings: () =>
        new Promise<FilterSettings>((r) => {
          resolveSettings = r;
        }),
      onConnect,
    });

    const port = makePort();
    onConnect.connect(port);
    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 100 });
    expect(isFilterApplied(target)).toBe(true);

    resolveSettings!(
      settingsWith({ masterEnabled: false, rules: [RULE_GRAY_100] }),
    );
    await run.settled;

    expect(run.arbiter.hasOverride()).toBe(false);
    expect(isFilterApplied(target)).toBe(false);
    expect(isFilterSuppressed(target)).toBe(true);
  });
});

// ─────────── 存活性 × 预览的交叉格 ───────────

describe('🔴 存活性(INV-5)守护的是**当前**真相 —— 含预览覆盖', () => {
  it('预览中站点摘掉属性 → 恢复的是预览值,不是规则值', async () => {
    const target = makeTarget();
    const store = makeStore();
    const onConnect = makeOnConnect();
    let fire: (() => void) | null = null;

    const run = runInjector({
      target,
      store,
      url: URL,
      readSettings: () =>
        Promise.resolve(settingsWith({ rules: [RULE_GRAY_100] })),
      onConnect,
      liveness: true,
      observerFactory: (cb) => {
        fire = cb;
        return { observe: () => undefined, disconnect: () => undefined };
      },
    });
    await run.settled;

    const port = makePort();
    onConnect.connect(port);
    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 70 });

    // 站点脚本把注入物摘掉。
    target.removeAttribute('data-ccf-on');
    target.style.removeProperty('--ccf-filter');
    fire!();

    // 🔴 恢复成**预览**值 —— 否则用户拖动的效果会在站点清理时丢失。
    expect(currentFilterValue(target)).toBe(GRAY_70);
    expect(run.liveness?.stats().restores).toBe(1);
  });
});

// ─────────── 多端口并发:覆盖的归属(ADR-049) ───────────
//
// 为什么这一组必须存在:gate 的五条写死的是**单端口**时序,但本接收端
// 是整个产品里**唯一**能同时看见一个以上端口的组件,多端口因此结构性地
// 归它仲裁(DESIGN.md §6 T6b 给发送端的义务只有「四个不发送」与
// 「三个主动 PREVIEW_CLEAR」,没有一条谈端口之间的仲裁)。
//
// 可达性不是臆造的:
// - 两个浏览器窗口各开一个 popup,连的是同一个 tab —— 本仓库已把
//   「另一个窗口」当成活场景(injector.ts 的 onChanged 注释、
//   本文件「整条链路」用例);
// - popup 关闭与重开**重叠**:Chrome 不保证旧端口的 onDisconnect
//   在新端口 connect 之前送达。
//
// 不修的后果是真实可见的:旧端口收尸把**正在拖动**的预览擦掉,
// 页面在拖动中途跳回规则值 —— 正是 ADR-049 存在要消灭的那一类 bug,
// 只是触发源从「迟到的 onChanged」换成了「迟到的 onDisconnect」。

describe('🔴 ADR-049 · 两个活端口并存时,陈旧端口的收尸不得打断正在进行的预览', () => {
  it('🔴 回归:A 先预览、B 接手,随后 A 的 onDisconnect 迟到 → 页面仍是 B 的值', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    arbiter.setBase(GRAY_100); // 该页按规则是灰阶 100

    const portA = makePort();
    const portB = makePort();
    attachPreviewPort(portA, arbiter);
    attachPreviewPort(portB, arbiter);

    // 窗口 A 的 popup 拖到 10。
    portA.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 10 });
    expect(currentFilterValue(target)).toBe(filterCssValue('Grayscale', 10));

    // 窗口 B 的 popup 接手,正拖到 30(用户此刻看着的就是这个)。
    portB.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 30 });
    const bValue = currentFilterValue(target);
    expect(bValue).toBe(filterCssValue('Grayscale', 30));
    const rendersBeforeReap = arbiter.renders();

    // 🔴 旧端口 A 这才被收尸(Chrome 的 onDisconnect 没有时序保证)。
    portA.disconnect();

    // 修复前:页面 snap 回 grayscale(1) —— 用户拖动中途被打断。
    // 修复后:B 的预览仍活着,且**一次重绘都没有发生**。
    expect(currentFilterValue(target)).toBe(bValue);
    expect(arbiter.hasOverride()).toBe(true);
    expect(arbiter.renders()).toBe(rendersBeforeReap);
  });

  it('🔴 归属者自己断开 → 照常恢复规则结果(「不得残留」未被削弱)', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    arbiter.setBase(GRAY_100);

    const portA = makePort();
    const portB = makePort();
    attachPreviewPort(portA, arbiter);
    attachPreviewPort(portB, arbiter);

    portA.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 10 });
    portB.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 30 });

    // 归属在 B 手上,B 关闭 → 必须恢复,不得残留在 30 上。
    portB.disconnect();

    expect(arbiter.hasOverride()).toBe(false);
    expect(currentFilterValue(target)).toBe(GRAY_100);
  });

  it('🔴 非归属端口的 PREVIEW_CLEAR 不得撤掉别人的预览', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    arbiter.setBase(GRAY_100);

    const portA = makePort();
    const portB = makePort();
    attachPreviewPort(portA, arbiter);
    attachPreviewPort(portB, arbiter);

    portA.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 10 });
    portB.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 30 });
    const bValue = currentFilterValue(target);
    const rendersBefore = arbiter.renders();

    // A 侧用户点了「返回」(T6b 的主动发送义务)—— 但页面上活着的是 B 的预览。
    portA.send({ type: 'PREVIEW_CLEAR' });

    expect(currentFilterValue(target)).toBe(bValue);
    expect(arbiter.hasOverride()).toBe(true);
    expect(arbiter.renders()).toBe(rendersBefore);
  });

  it('🔴 归属者的 PREVIEW_CLEAR 照常生效(条件撤除没有变成「永不撤除」)', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    arbiter.setBase(GRAY_100);

    const portA = makePort();
    const portB = makePort();
    attachPreviewPort(portA, arbiter);
    attachPreviewPort(portB, arbiter);

    portA.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 10 });
    portB.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 30 });
    portB.send({ type: 'PREVIEW_CLEAR' });

    expect(arbiter.hasOverride()).toBe(false);
    expect(currentFilterValue(target)).toBe(GRAY_100);
  });

  it('归属随 last-writer 转移,且令牌互不相等(不是「碰巧值一样」)', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    arbiter.setBase(null);

    const portA = makePort();
    const portB = makePort();
    attachPreviewPort(portA, arbiter);
    attachPreviewPort(portB, arbiter);

    portA.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 50 });
    const ownerA = arbiter.overrideOwner();
    expect(ownerA).not.toBeNull();

    // 两端口发**同一个**值 —— 若只看渲染出的字符串,归属转移无法被观测到。
    portB.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 50 });
    const ownerB = arbiter.overrideOwner();
    expect(ownerB).not.toBeNull();
    expect(ownerB).not.toBe(ownerA);

    // A 收尸:它已不是归属者 → no-op。
    portA.disconnect();
    expect(arbiter.overrideOwner()).toBe(ownerB);
    expect(arbiter.hasOverride()).toBe(true);
  });

  it('A → B → A:归属能转回来,A 的收尸此时该生效', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    arbiter.setBase(GRAY_100);

    const portA = makePort();
    const portB = makePort();
    attachPreviewPort(portA, arbiter);
    attachPreviewPort(portB, arbiter);

    portA.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 10 });
    portB.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 30 });
    portA.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 60 });
    expect(currentFilterValue(target)).toBe(filterCssValue('Grayscale', 60));

    portA.disconnect();
    expect(arbiter.hasOverride()).toBe(false);
    expect(currentFilterValue(target)).toBe(GRAY_100);
  });

  it('🔴 INV-8 主开关止血仍然凌驾一切(无条件撤除未被归属挡住)', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    arbiter.setBase(GRAY_100);

    const port = makePort();
    attachPreviewPort(port, arbiter);
    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 30 });
    expect(arbiter.hasOverride()).toBe(true);

    // injector.ts 的主开关路径调的就是**无参**形态(ADR-027/INV-8)。
    arbiter.clearOverride();
    arbiter.setBase(null);

    expect(arbiter.hasOverride()).toBe(false);
    expect(isFilterApplied(target)).toBe(false);
    expect(isFilterSuppressed(target)).toBe(true);
  });

  it('🔴 预览值仍绝不落盘 —— 多端口并发下亦然(storage spy)', async () => {
    const target = makeTarget();
    const store = makeStore();
    const onConnect = makeOnConnect();

    const run = runInjector({
      target,
      store,
      url: URL,
      readSettings: () =>
        Promise.resolve(settingsWith({ rules: [RULE_GRAY_100] })),
      onConnect,
    });
    await run.settled;

    const writesBefore = store.writes.length;
    const removesBefore = store.removes.length;

    const portA = makePort();
    const portB = makePort();
    onConnect.connect(portA);
    onConnect.connect(portB);
    for (let i = 0; i <= 50; i += 1) {
      portA.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: i });
      // 两个端口用**不同强度**争抢(ADR-075 后强度是唯一的区分维度)。
      portB.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 100 - i });
    }
    portA.disconnect();
    portB.disconnect();

    expect(store.writes.length).toBe(writesBefore);
    expect(store.removes.length).toBe(removesBefore);
    // 并且没有任何一条存储项里出现预览用过的强度值
    // (预览扫过 0–50 与 50–100 两段,规则值是 100 档)。
    for (const v of store.data.values()) {
      const parsed = JSON.parse(v) as { intensity?: number };
      expect(parsed.intensity).toBe(100);
    }
  });

  it('两个端口都走 onConnect 时,stats 如实计数', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, GRAY_100);
    const onConnect = makeOnConnect();
    const handle = startPreviewReceiver({ arbiter, onConnect });

    const portA = makePort();
    const portB = makePort();
    onConnect.connect(portA);
    onConnect.connect(portB);
    expect(handle.stats().ports).toBe(2);

    portA.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 10 });
    portB.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 20 });
    portA.disconnect();

    expect(handle.stats().filters).toBe(2);
    expect(handle.stats().disconnects).toBe(1);
    // 事件**发生**了(如实记录),但覆盖没被撤 —— 两者不是一回事。
    expect(arbiter.hasOverride()).toBe(true);
  });
});

// ─────────── 边界:intensity === 0 ───────────
//
// 为什么要钉这条:PREVIEW_FILTER 的 intensity 取值域是 0..100(ADR-003 收敛),
// 而 `null` 是「不上色」的哨兵值(走 data-ccf-off 压制,见 apply-filter.ts)。
// 强度 0 与「无滤镜」在视觉上一样,实现上却必须是**两种**状态:
// 前者是 identity 滤镜(覆盖活动),后者是压制。混同会让「拖到 0」
// 变成「覆盖消失」,于是底层规则色会冒出来 —— 可见 bug。

describe('🔴 边界 · intensity 0 的预览是 identity 滤镜,不是「无滤镜」', () => {
  it('预览 0 渲染为 grayscale(0) 且覆盖活动,与压制态区分', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    arbiter.setBase(GRAY_100);

    const port = makePort();
    attachPreviewPort(port, arbiter);
    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 0 });

    expect(currentFilterValue(target)).toBe(filterCssValue('Grayscale', 0));
    expect(isFilterApplied(target)).toBe(true);
    expect(isFilterSuppressed(target)).toBe(false);
    expect(arbiter.hasOverride()).toBe(true);
  });

  it('底层「不上色」时预览 0 也必须解除压制(否则拖到 0 看不出在预览)', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    arbiter.setBase(null);
    expect(isFilterSuppressed(target)).toBe(true);

    const port = makePort();
    attachPreviewPort(port, arbiter);
    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 0 });

    expect(isFilterSuppressed(target)).toBe(false);
    expect(isFilterApplied(target)).toBe(true);
    expect(currentFilterValue(target)).toBe(filterCssValue('Grayscale', 0));
  });

  it('预览 0 后 PREVIEW_CLEAR → 回到规则结果,不残留 identity', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    arbiter.setBase(GRAY_100);

    const port = makePort();
    attachPreviewPort(port, arbiter);
    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 0 });
    port.send({ type: 'PREVIEW_CLEAR' });

    expect(currentFilterValue(target)).toBe(GRAY_100);
    expect(arbiter.hasOverride()).toBe(false);
  });

  it('预览 0 期间 onChanged 到达 → 仍不重绘(优先级条款在边界上同样成立)', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    arbiter.setBase(GRAY_100);

    const port = makePort();
    attachPreviewPort(port, arbiter);
    port.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale', intensity: 0 });
    const zeroValue = currentFilterValue(target);
    const rendersBefore = arbiter.renders();

    arbiter.setBase(GRAY_30);

    expect(arbiter.renders()).toBe(rendersBefore);
    expect(currentFilterValue(target)).toBe(zeroValue);
  });
});

// ─────────── 向后兼容(additive) ───────────

describe('向后兼容:不传 T4b 的新选项时行为与 T4a 完全一致', () => {
  it('不传 onConnect/preview → 无预览接收端', async () => {
    const target = makeTarget();
    const store = makeStore();
    writeFastPath(store, HOST, true, { mode: 'Grayscale', intensity: 100 }, Date.now());

    const run = runInjector({
      target,
      store,
      url: URL,
      readSettings: () =>
        Promise.resolve(settingsWith({ rules: [RULE_GRAY_100] })),
    });

    expect(run.preview).toBeNull();
    expect(run.liveness).toBeNull();
    expect(run.fastPathHit).toBe(true);
    expect(currentFilterValue(target)).toBe(GRAY_100);
    await run.settled;
    expect(currentFilterValue(target)).toBe(GRAY_100);
  });

  it('无 chrome.runtime 时 startPreviewReceiver 降级为不接入,不抛异常', () => {
    const target = makeTarget();
    const arbiter = createRenderArbiter(target, null);
    const handle = startPreviewReceiver({ arbiter });
    expect(handle.connected).toBe(false);
    expect(handle.stats().ports).toBe(0);
  });
});
