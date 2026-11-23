/**
 * 实时预览**接收端**(**ADR-049**)—— T4b 必须实现,否则 T6b 无法交付。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 本模块的全部职责:一个「覆盖层」
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 页面上「该显示什么滤镜」由两个来源叠成:
 *
 * ```
 *   预览覆盖(本模块,临时)   ← 优先
 *   ─────────────────────────
 *   规则解析结果(injector)   ← 底层
 * ```
 *
 * 本模块**只**管上面那一层,而且只做三件事:套上、撤掉、在套着的时候
 * 拦住底层的重绘。它**不碰**:
 * - `chrome.storage` / `SettingsRepository` —— 预览不写存储(ADR-049);
 * - `fast-path-cache` / `localStorage` —— **预览值绝不落盘**
 *   (DESIGN.md §6 T4b:「用户不点保存就离开,页面必须恢复原状」);
 * - 规则数据 —— 预览不改规则。
 *
 * 这三条「不碰」由构造签名**物理保证**:下面 `PreviewReceiverDeps` 里
 * 根本没有存储端口可用。gate 要求的 spy 断言(「storage 无写入」)
 * 因此不是「我们记得没写」,而是「没有能写的东西」。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## 与 `onChanged` 的优先级(ADR-049,逐字)
 * ───────────────────────────────────────────────────────────────────────────
 *
 * > 预览覆盖**优先于**存储解析结果。`onChanged` 到达时,若预览覆盖处于
 * > 活动状态,**只更新底层解析结果,不重绘** —— 直到 `PREVIEW_CLEAR`
 * > 或端口断开才按新结果渲染。
 * > 否则会出现「拖到 70 → 旧的 50 迟到 → 页面闪回 50 再跳到 70」。
 *
 * 实现落点是 `RenderArbiter`(见下):它是**唯一**向 DOM 写入的地方,
 * 底层与覆盖层都只向它报告自己的值。于是「不重绘」不是在调用点
 * 靠 `if` 记得去判断,而是仲裁器的结构性质 —— 底层更新时若有覆盖,
 * 它压根不往下走到 `syncFilter`。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## 覆盖的**归属**(多端口并发;ADR-049 的同一条保证)
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 覆盖只有一层,但**可能有不止一个端口**连到同一个 tab 上:
 * - 两个浏览器窗口各自开着 popup,连的是同一个 tab
 *   (本仓库已把「另一个窗口」当成活场景建模,见 `injector.ts` 的 onChanged
 *   注释与 `__tests__/preview.test.ts` 的整条链路用例);
 * - popup 关闭与重开**重叠**:Chrome 的 `onDisconnect` 不保证在新 `connect`
 *   之前送达,于是「旧端口尚未收尸、新端口已在拖动」这一格是真实可达的。
 *
 * 此时若 `onDisconnect` 无条件 `clearOverride()`,**旧端口的收尸会擦掉
 * 新端口正在编辑的预览** —— 页面在用户拖动中途跳回规则值。那正是
 * ADR-049 要消灭的那一类可见 bug(「预览死在拖动中途」),只是触发源
 * 从「迟到的 onChanged」换成了「迟到的 onDisconnect」。
 *
 * 故覆盖带**归属令牌**:
 * - `setOverride(value, owner)` —— 最后一次设置者取得归属(last-writer-wins:
 *   正在被拖动的那个滑块就是用户此刻看着的那个);
 * - `clearOverride(owner)` —— **只有当前归属者**能撤掉;非归属者(陈旧端口)
 *   的 `PREVIEW_CLEAR` 与 `onDisconnect` 都是 no-op,零重绘。
 *
 * 📌 `owner` 在两处都是**可选**参数:省略即「无条件撤掉」,与 T4b 首版
 *    行为逐字一致(向后兼容)。INV-8/ADR-027 的主开关止血路径
 *    (`injector.ts`)正是靠这个无条件形态凌驾一切 —— 主开关必须赢,
 *    它不是端口之间的归属之争。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## 生命周期(DESIGN.md §6 T4b)
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 覆盖在以下**任一**情况结束,两条都必须实现:
 * 1. 收到 `PREVIEW_CLEAR` —— popup 仍开着但离开了编辑视图
 *    (T6b 的主动发送义务;DESIGN.md 称这是「最容易漏的一条」);
 * 2. 端口 `onDisconnect` —— popup 关闭**或**页面导航。
 *
 * 📌 「预览期间导航到新页面,新页面按规则渲染而非预览值」(gate 条款)
 *    在本架构下是**自动**成立的,无需额外代码:导航换的是文档,
 *    新文档里是一个全新的 content script 实例,其预览覆盖为空,
 *    而覆盖**从不落盘**(上面那条「不碰」),所以没有任何东西能把
 *    预览值带过去。旧端口在旧文档销毁时触发 `onDisconnect`。
 *    这条 gate 条款的单测因此断言的是「新实例的初始渲染 = 规则结果」。
 */

import { type FilterTarget, syncFilter } from './apply-filter.js';
import { filterCssValue } from '../domain/index.js';
import {
  type PreviewMessage,
  PREVIEW_CLEAR,
  PREVIEW_FILTER,
  PREVIEW_PORT_NAME,
  coercePreviewMessage,
} from './preview-contract.js';

/**
 * 渲染仲裁器 —— **页面上唯一的 DOM 写入点**。
 *
 * 职责:持有「底层值」与「覆盖值」,算出该渲染哪个,并在**只有底层变化
 * 而覆盖活动**时拒绝重绘(ADR-049 的优先级条款)。
 */
export interface RenderArbiter {
  /** 更新底层(规则解析)结果。覆盖活动时**不重绘**。 */
  setBase(value: string | null): void;
  /**
   * 套上/更新预览覆盖。立即重绘。
   *
   * @param owner 归属令牌(可选)。传了就**取得归属**,此后只有同一个令牌
   *   能条件式 `clearOverride`。省略 → 归属为空(匿名),与 T4b 首版
   *   语义逐字一致。
   */
  setOverride(value: string | null, owner?: OverrideOwner): void;
  /**
   * 撤掉覆盖,按底层值重绘。
   *
   * @param owner 传了就是**条件撤除**:仅当该令牌是当前归属者时才撤。
   *   非归属者调用是 no-op(零重绘)—— 这正是「陈旧端口的 onDisconnect
   *   不得擦掉别人正在编辑的预览」那条保证。
   *   省略 → **无条件**撤除(INV-8 主开关止血用)。
   */
  clearOverride(owner?: OverrideOwner): void;
  /** 覆盖是否活动。 */
  hasOverride(): boolean;
  /**
   * 当前覆盖的归属令牌;无覆盖或匿名覆盖时为 `null`。
   *
   * 暴露出来是为了让断言能检查**归属本身**,否则「归属已转移」与
   * 「碰巧两者的值一样」在测试里无法区分。
   */
  overrideOwner(): OverrideOwner | null;
  /** 当前**应当**渲染的值(覆盖优先)。供存活性恢复用(INV-5)。 */
  current(): string | null;
  /** 已发生的 DOM 同步次数 —— 供 gate 断言「不重绘」。 */
  renders(): number;
}

/**
 * 覆盖的归属令牌 —— 一个**不透明**的身份对象。
 *
 * 故意不用 `string`/`number`:令牌只需要「引用相等」这一个能力。
 * 用不透明对象可杜绝两个端口意外撞上同一个 id(并发下那等于把本次
 * 修复的 bug 原样放回去),也杜绝任何人试图从令牌里读出意义。
 */
export type OverrideOwner = { readonly __overrideOwner?: undefined };

/** 造一个新的归属令牌。每次调用都返回一个**互不相等**的令牌。 */
export function createOverrideOwner(): OverrideOwner {
  return {};
}

export function createRenderArbiter(
  target: FilterTarget,
  initialBase: string | null = null,
): RenderArbiter {
  let base: string | null = initialBase;
  let override: string | null = null;
  let overrideActive = false;
  let owner: OverrideOwner | null = null;
  let renders = 0;

  const render = (): void => {
    renders += 1;
    syncFilter(target, overrideActive ? override : base);
  };

  return {
    setBase(value) {
      base = value;
      // 🔴 ADR-049 的核心一行:覆盖活动时**只更新底层,不重绘**。
      //    这正是「拖到 70 → 旧的 50 迟到 → 闪回 50 再跳 70」的解药。
      if (overrideActive) return;
      render();
    },
    setOverride(value, nextOwner) {
      override = value;
      overrideActive = true;
      // last-writer-wins:最后设置的那个端口取得归属。用户此刻看着的
      // 就是最后一次拖动的结果,归属理应跟着它走。
      owner = nextOwner ?? null;
      render();
    },
    clearOverride(requester) {
      if (!overrideActive) return;
      // 🔴 条件撤除:带令牌的调用者只能撤掉**自己的**覆盖。
      //    陈旧端口的 onDisconnect / 迟到的 PREVIEW_CLEAR 在此被挡住,
      //    不会擦掉另一个端口正在编辑的预览(零重绘,见头注释)。
      if (requester !== undefined && requester !== owner) return;
      overrideActive = false;
      override = null;
      owner = null;
      // 撤掉覆盖后按**最新**底层值渲染 —— 若预览期间来过 onChanged,
      // 这里渲染的就是那个新值(ADR-049:「直到 PREVIEW_CLEAR
      // 或端口断开才按新结果渲染」)。
      render();
    },
    hasOverride: () => overrideActive,
    overrideOwner: () => (overrideActive ? owner : null),
    current: () => (overrideActive ? override : base),
    renders: () => renders,
  };
}

// ────────────────────────── 端口接入 ──────────────────────────

/** `chrome.runtime.Port` 的最小可注入抽象 —— 只要本模块真正用到的那几项。 */
export interface PreviewPortLike {
  readonly name?: string;
  readonly onMessage: {
    addListener(listener: (message: unknown) => void): void;
  };
  readonly onDisconnect: {
    addListener(listener: () => void): void;
  };
}

/** `chrome.runtime.onConnect` 的最小抽象。 */
export interface OnConnectLike {
  addListener(listener: (port: PreviewPortLike) => void): void;
}

export interface PreviewReceiverDeps {
  /**
   * 渲染仲裁器 —— 本模块唯一能影响页面的途径。
   *
   * 🔴 注意这里**没有**任何存储端口:预览值物理上无处可落盘(见头注释)。
   */
  readonly arbiter: RenderArbiter;
  /** `chrome.runtime.onConnect`;缺省时从全局 `chrome` 取,取不到则不接入。 */
  readonly onConnect?: OnConnectLike;
}

export interface PreviewReceiverHandle {
  /** 是否真的接上了 `onConnect`。 */
  readonly connected: boolean;
  /** 已处理的预览消息计数(调试/断言用)。 */
  readonly stats: () => PreviewReceiverStats;
}

export interface PreviewReceiverStats {
  readonly ports: number;
  readonly filters: number;
  readonly clears: number;
  readonly disconnects: number;
  readonly ignored: number;
}

/**
 * 把一个端口接进仲裁器 —— 消息语义的本体。
 *
 * 单独导出是为了让单测能直接喂一个假端口,不必经过 `onConnect`。
 *
 * 🔴 每个端口拿**自己**的归属令牌(见头注释「覆盖的归属」):它对覆盖的
 *    撤除一律是条件式的,只能撤掉自己套上去的那层。于是「两个窗口的 popup
 *    连同一个 tab」「关闭与重开重叠」这两种真实并发下,陈旧端口收尸
 *    不会打断另一个端口正在进行的拖动。
 */
export function attachPreviewPort(
  port: PreviewPortLike,
  arbiter: RenderArbiter,
  onEvent?: (kind: 'filter' | 'clear' | 'disconnect' | 'ignored') => void,
): void {
  let closed = false;
  const owner = createOverrideOwner();

  port.onMessage.addListener((raw: unknown) => {
    if (closed) return;

    const message: PreviewMessage | null = coercePreviewMessage(raw);
    if (message === null) {
      // 畸形/未知消息一律忽略(ADR-041 的精神,见 preview-contract.ts)。
      onEvent?.('ignored');
      return;
    }

    if (message.type === PREVIEW_CLEAR) {
      // 条件撤除:若此刻的覆盖已被**另一个**端口接手(用户在另一个窗口
      // 继续拖动),本端口的 PREVIEW_CLEAR 不得把它撤掉。
      arbiter.clearOverride(owner);
      onEvent?.('clear');
      return;
    }

    if (message.type === PREVIEW_FILTER) {
      // 套用临时值。
      //
      // 🔴 `filterCssValue` 是 ADR-025 的**派生值**:由 (mode,intensity)
      //    纯函数算出,绝不持久化。预览路径与规则路径用的是**同一个**函数,
      //    于是「预览看到的」与「保存后看到的」逐字节一致 ——
      //    否则保存那一刻页面会跳一下(可见的 bug)。
      // 带令牌设置 → 本端口取得归属(last-writer-wins)。
      arbiter.setOverride(
        filterCssValue(message.mode, message.intensity),
        owner,
      );
      onEvent?.('filter');
      return;
    }

    // 📌 显式穷举而非「else 即 PREVIEW_FILTER」:今后 ADR-049 若扩出第三种
    //    消息,`tsc` 会在这里把 `message` 收窄成它而**不是** never,
    //    于是漏处理会在编译期暴露(ADR-066),而不是静默走进上面那个分支。
    const exhaustive: never = message;
    void exhaustive;
  });

  port.onDisconnect.addListener(() => {
    if (closed) return;
    closed = true;
    // 🔴 popup 关闭或页面导航 → 覆盖**必须**结束,不得残留
    //    (DESIGN.md §6 T4b:「popup 关闭必须自动恢复,不得残留」)。
    //
    //    但只撤**自己的**那层:若归属已转给另一个活端口,本端口的收尸
    //    不得让页面在用户拖动中途跳回规则值。这不是削弱「不得残留」——
    //    残留的前提是「没有别的活动预览」,而归属不在自己手上恰恰说明
    //    页面显示的是**另一个**端口此刻正当的预览,它的收尸会负责撤除。
    arbiter.clearOverride(owner);
    onEvent?.('disconnect');
  });
}

/**
 * 启动预览接收端。
 *
 * 只接受 `name === PREVIEW_PORT_NAME` 的连接 —— 其他端口(未来可能有别的
 * 用途)原样放过,不被本模块处理。
 */
export function startPreviewReceiver(
  deps: PreviewReceiverDeps,
): PreviewReceiverHandle {
  const onConnect = deps.onConnect ?? defaultOnConnect();

  let ports = 0;
  let filters = 0;
  let clears = 0;
  let disconnects = 0;
  let ignored = 0;

  const stats = (): PreviewReceiverStats => ({
    ports,
    filters,
    clears,
    disconnects,
    ignored,
  });

  if (!onConnect) {
    // 无 `chrome.runtime`(单测/沙箱文档)→ 不接入,但不抛异常(INV-1)。
    return { connected: false, stats };
  }

  onConnect.addListener((port) => {
    if (port.name !== PREVIEW_PORT_NAME) return;
    ports += 1;
    attachPreviewPort(port, deps.arbiter, (kind) => {
      if (kind === 'filter') filters += 1;
      else if (kind === 'clear') clears += 1;
      else if (kind === 'disconnect') disconnects += 1;
      else ignored += 1;
    });
  });

  return { connected: true, stats };
}

interface GlobalWithChromeOnConnect {
  chrome?: { runtime?: { onConnect?: OnConnectLike } };
}

function defaultOnConnect(): OnConnectLike | null {
  const onConnect = (globalThis as unknown as GlobalWithChromeOnConnect).chrome
    ?.runtime?.onConnect;
  return onConnect?.addListener ? onConnect : null;
}
