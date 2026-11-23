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
  /** 套上/更新预览覆盖。立即重绘。 */
  setOverride(value: string | null): void;
  /** 撤掉覆盖,按底层值重绘。 */
  clearOverride(): void;
  /** 覆盖是否活动。 */
  hasOverride(): boolean;
  /** 当前**应当**渲染的值(覆盖优先)。供存活性恢复用(INV-5)。 */
  current(): string | null;
  /** 已发生的 DOM 同步次数 —— 供 gate 断言「不重绘」。 */
  renders(): number;
}

export function createRenderArbiter(
  target: FilterTarget,
  initialBase: string | null = null,
): RenderArbiter {
  let base: string | null = initialBase;
  let override: string | null = null;
  let overrideActive = false;
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
    setOverride(value) {
      override = value;
      overrideActive = true;
      render();
    },
    clearOverride() {
      if (!overrideActive) return;
      overrideActive = false;
      override = null;
      // 撤掉覆盖后按**最新**底层值渲染 —— 若预览期间来过 onChanged,
      // 这里渲染的就是那个新值(ADR-049:「直到 PREVIEW_CLEAR
      // 或端口断开才按新结果渲染」)。
      render();
    },
    hasOverride: () => overrideActive,
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
 */
export function attachPreviewPort(
  port: PreviewPortLike,
  arbiter: RenderArbiter,
  onEvent?: (kind: 'filter' | 'clear' | 'disconnect' | 'ignored') => void,
): void {
  let closed = false;

  port.onMessage.addListener((raw: unknown) => {
    if (closed) return;

    const message: PreviewMessage | null = coercePreviewMessage(raw);
    if (message === null) {
      // 畸形/未知消息一律忽略(ADR-041 的精神,见 preview-contract.ts)。
      onEvent?.('ignored');
      return;
    }

    if (message.type === PREVIEW_CLEAR) {
      arbiter.clearOverride();
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
      arbiter.setOverride(filterCssValue(message.mode, message.intensity));
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
    arbiter.clearOverride();
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
