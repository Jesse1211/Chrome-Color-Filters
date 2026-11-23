/**
 * 实时预览**发送端**(**ADR-049**)—— popup 侧,T6b 的交付物。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 路由(DESIGN.md §6 T4b 明文「必须按此实现,不得自行选择」)
 *
 * ```
 *   popup ──chrome.tabs.connect(tabId, { name: 'preview' })──▶ content script
 * ```
 *
 * 🔴 **`tabId` 一律来自 T5 的 `GET_TAB_STATE`(ADR-044)。**
 *    popup **不得**自己调 `chrome.tabs.query` —— tab 解析的真相来源唯一归 T5。
 *    本模块因此**不接触** `chrome.tabs.query`,`tabId` 只能由调用方传进来,
 *    而调用方只能从 `computePreviewEligibility` 的「可用」分支里拿到它
 *    (见 `pattern-status.ts`:类型上拿不到一个没有 tabId 的可用判定)。
 *
 * 🔴 **不经 service worker 中转** —— 否则 T5 进入预览路径,而 T5 并非 T6b 的上游。
 *
 * ## 不写存储(ADR-049)
 *
 * 本模块的依赖里**没有** `SettingsRepository`、没有 `chrome.storage` ——
 * 与接收端 `preview-receiver.ts` 同一手法:gate 要求的 spy 断言
 * (「拖动滑块不写 storage」)不是「我们记得没写」,而是「没有能写的东西」。
 * 滑块的值只在点**保存**时经仓储层单次写入(ADR-061:写入立即落盘,不做防抖)。
 *
 * ## 契约类型只有一处(ADR-066)
 *
 * 消息的类型与常量全部 import 自 `src/injection/preview-contract.ts` ——
 * 那是 T4b 建立的、ADR-049 的逐字 TypeScript 化。本文件**不内联任何字面量**,
 * 于是 §6.2 风险表里那行「`PREVIEW_FILTER` 接收端与 ADR-049 契约不符」
 * 在编译期就被 `tsc --noEmit` 挡住,而不是等真实栈联调才暴露。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import { type FilterMode, type Intensity } from '../domain/index.js';
import {
  type PreviewClearMessage,
  type PreviewFilterMessage,
  type PreviewMessage,
  PREVIEW_CLEAR,
  PREVIEW_FILTER,
  PREVIEW_PORT_NAME,
} from '../injection/preview-contract.js';

/** `chrome.runtime.Port` 的最小可注入抽象 —— 只要发送端真正用到的那两项。 */
export interface PreviewSenderPort {
  postMessage(message: PreviewMessage): void;
  disconnect(): void;
}

/**
 * 连到某个 tab 的 content script。注入式,便于单测不伪造整个 `chrome` 全局。
 *
 * 返回 `null` = 连不上(非扩展环境 / tab 里没有接收端)。**不抛异常** ——
 * popup 是用户唯一的控制入口,因预览连不上而白屏是不可接受的
 * (与 `tab-state.ts` 的降级精神一致)。
 */
export type PreviewConnect = (tabId: number) => PreviewSenderPort | null;

/**
 * 预览通道 —— 对调用方只暴露三个动作:套、撤、关。
 *
 * 端口是**惰性**建立的:直到第一次真的要发 `PREVIEW_FILTER` 才 connect。
 * 理由是四种不可用情形(§5.7)下根本不该有连接 ——
 * 「连上了但一条消息都不发」与「没连上」对用户等价,但前者在真实栈里
 * 会给 content script 制造一个空转的端口,也会让「是否发送」这件事
 * 在 Chrome 的端口日志里变得难以判读。
 */
export interface PreviewChannel {
  /**
   * 发送 `PREVIEW_FILTER`(套用临时值)。
   *
   * @param tabId 必须是 `GET_TAB_STATE` 给出的那个 tab(ADR-049)。
   *   与已建立的端口不是同一个 tab 时,**先断开旧端口再连新的** ——
   *   预览只应作用在当前页上(「绝不能把 B 站滤镜套到 A 站」)。
   */
  sendFilter(tabId: number, mode: FilterMode, intensity: Intensity): void;
  /**
   * 发送 `PREVIEW_CLEAR`(恢复按规则解析的结果)。
   *
   * 🔴 **端口不断开。** §6 T6b gate:
   * > 点「返回」离开编辑视图(**popup 仍开着,端口未断,必须主动发**)
   *
   * 这正是 DESIGN.md 称「最容易漏的一条」—— 靠 `onDisconnect` 兜不住,
   * 因为 popup 还开着,端口好得很。
   *
   * 没有活动端口时是 no-op(没套上过的东西无需撤)。
   */
  sendClear(): void;
  /** 主动断开端口(popup 卸载时的收尾;Chrome 关闭 popup 时也会自动触发)。 */
  close(): void;
  /** 当前是否持有活动端口 —— 供断言,不参与逻辑。 */
  isOpen(): boolean;
  /** 当前端口连的 tab —— 供断言。 */
  connectedTabId(): number | null;
}

/** 消息字面量只在这里构造一次,保证与 ADR-049 契约同形。 */
function filterMessage(mode: FilterMode, intensity: Intensity): PreviewFilterMessage {
  return { type: PREVIEW_FILTER, mode, intensity };
}

function clearMessage(): PreviewClearMessage {
  return { type: PREVIEW_CLEAR };
}

export function createPreviewChannel(connect: PreviewConnect): PreviewChannel {
  let port: PreviewSenderPort | null = null;
  let tabId: number | null = null;

  const drop = (): void => {
    if (port === null) return;
    try {
      port.disconnect();
    } catch {
      /* 端口可能已被对端断开 —— 再断一次不是错误,忽略(不抛)。 */
    }
    port = null;
    tabId = null;
  };

  return {
    sendFilter(nextTabId, mode, intensity) {
      // 换了 tab → 旧端口先撤再断:不留一层挂在别的页面上的预览。
      if (port !== null && tabId !== nextTabId) {
        try {
          port.postMessage(clearMessage());
        } catch {
          /* 对端已没了,撤除本就无意义。 */
        }
        drop();
      }

      if (port === null) {
        port = connect(nextTabId);
        tabId = port === null ? null : nextTabId;
      }
      if (port === null) return;

      try {
        port.postMessage(filterMessage(mode, intensity));
      } catch {
        // 对端消失(导航 / tab 关闭)。丢掉端口,下次拖动重连。
        // 页面侧的覆盖由接收端的 `onDisconnect` 负责撤除。
        drop();
      }
    },

    sendClear() {
      if (port === null) return;
      try {
        port.postMessage(clearMessage());
      } catch {
        drop();
      }
    },

    close: drop,
    isOpen: () => port !== null,
    connectedTabId: () => tabId,
  };
}

/* ────────────────────────── 真实的 chrome 端口 ────────────────────────── */

interface ChromeLikeTabs {
  connect(tabId: number, info: { name: string }): PreviewSenderPort | undefined;
}

interface GlobalWithChromeTabs {
  chrome?: { tabs?: ChromeLikeTabs };
}

/**
 * 真实 connect:`chrome.tabs.connect(tabId, { name: PREVIEW_PORT_NAME })`。
 *
 * 端口名取自契约常量 —— 接收端 `startPreviewReceiver` 只接受
 * `port.name === PREVIEW_PORT_NAME` 的连接,名字写错会表现为
 * 「拖动滑块页面无反应」。常量化让它不可能写错。
 *
 * 🔴 这里**只有** `chrome.tabs.connect`,**没有** `chrome.tabs.query`
 *    —— ADR-049 的那条禁令在模块的依赖面上即可验证。
 */
export function chromePreviewConnect(): PreviewConnect {
  return (tabId: number) => {
    const tabs = (globalThis as unknown as GlobalWithChromeTabs).chrome?.tabs;
    if (!tabs?.connect) return null;
    try {
      return tabs.connect(tabId, { name: PREVIEW_PORT_NAME }) ?? null;
    } catch {
      return null;
    }
  };
}

/** 单测/开发期用的空通道 —— 什么都不发,`isOpen()` 恒 false。 */
export function nullPreviewChannel(): PreviewChannel {
  return createPreviewChannel(() => null);
}
