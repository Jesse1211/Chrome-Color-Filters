/**
 * T5 各端口的**生产装配** —— 唯一接触 `chrome.tabs` / `chrome.action` /
 * `chrome.runtime.onMessage` 的地方。
 *
 * 与 `src/injection/scripting-port.ts` 同一手法(ADR-062 建立的模式):
 * 把平台调用收束在一个薄模块里,使 `coordinator.ts` 保持零 `chrome.*`、
 * 可在 Node 下完整单测。
 *
 * ## 不装 `@types/chrome`
 *
 * 与 `scripting-port.ts` 的理由一致:本项目没装它,全局 `chrome` 的类型
 * 在三个上下文都要用。此处就地声明所需形状,边界检查兜底。
 *
 * ## 平台不可用时一律降级,绝不抛
 *
 * SW 入口在单测/非扩展上下文里也会被求值(WXT 的入口收集)。入口抛异常
 * 会让整个 service worker 起不来,**连带 T4a 的声明式注册一起失效** ——
 * 那是 INV-3 的主路径。故每个装配函数在平台缺失时返回一个「什么都不做」
 * 的降级端口。
 */

import { type TabState } from '../ui/tab-state.js';
import {
  type ActionPort,
  type BackgroundEventsPort,
  type MessagingPort,
  type TabQueryInfo,
  type TabsPort,
} from './coordinator.js';
import { type TabLike } from './compute-tab-state.js';

interface ChromeTabsLike {
  query(info: TabQueryInfo): Promise<TabLike[]>;
  get(tabId: number): Promise<TabLike>;
  onUpdated: {
    addListener(cb: (tabId: number, changeInfo: unknown, tab: TabLike) => void): void;
    removeListener(cb: (tabId: number, changeInfo: unknown, tab: TabLike) => void): void;
  };
  onActivated: {
    addListener(cb: (info: { tabId: number }) => void): void;
    removeListener(cb: (info: { tabId: number }) => void): void;
  };
}

interface ChromeActionLike {
  setIcon(details: { tabId?: number; path: Record<string, string> }): Promise<void>;
  setTitle(details: { tabId?: number; title: string }): Promise<void>;
}

interface ChromeWindowsLike {
  onFocusChanged: {
    addListener(cb: (windowId: number) => void): void;
    removeListener(cb: (windowId: number) => void): void;
  };
}

interface ChromeRuntimeMessagingLike {
  onMessage: {
    addListener(cb: ChromeMessageListener): void;
    removeListener(cb: ChromeMessageListener): void;
  };
}

type ChromeMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

function chromeNs(): {
  tabs?: ChromeTabsLike;
  action?: ChromeActionLike;
  windows?: ChromeWindowsLike;
  runtime?: ChromeRuntimeMessagingLike;
} | null {
  try {
    const g = globalThis as {
      chrome?: {
        tabs?: ChromeTabsLike;
        action?: ChromeActionLike;
        windows?: ChromeWindowsLike;
        runtime?: ChromeRuntimeMessagingLike;
      };
    };
    return g.chrome ?? null;
  } catch {
    return null;
  }
}

/** 降级 `TabsPort` —— 查不到任何 tab。 */
const NULL_TABS: TabsPort = {
  query: async () => [],
  get: async () => null,
};

/** 降级 `ActionPort` —— 不改图标(图标停在 manifest 的 inactive 默认值)。 */
const NULL_ACTION: ActionPort = {
  setIcon: async () => {},
  setTitle: async () => {},
};

const NULL_EVENTS: BackgroundEventsPort = {
  onTabUpdated: () => () => {},
  onTabActivated: () => () => {},
};

const NULL_MESSAGING: MessagingPort = {
  onMessage: () => () => {},
};

export function defaultTabsPort(): TabsPort {
  const tabs = chromeNs()?.tabs;
  if (tabs === undefined || typeof tabs.query !== 'function') return NULL_TABS;
  return {
    query: (info) => tabs.query(info),
    get: async (tabId) => {
      if (typeof tabs.get !== 'function') return null;
      try {
        return await tabs.get(tabId);
      } catch {
        // tab 已关闭 —— 正常竞态,见 coordinator 的 #applyIcon 注释。
        return null;
      }
    },
  };
}

export function defaultActionPort(): ActionPort {
  const action = chromeNs()?.action;
  if (action === undefined || typeof action.setIcon !== 'function') {
    return NULL_ACTION;
  }
  return {
    setIcon: (details) =>
      action.setIcon({
        ...(details.tabId === undefined ? {} : { tabId: details.tabId }),
        path: { ...details.path },
      }),
    setTitle: async (details) => {
      if (typeof action.setTitle !== 'function') return;
      await action.setTitle({
        ...(details.tabId === undefined ? {} : { tabId: details.tabId }),
        title: details.title,
      });
    },
  };
}

export function defaultEventsPort(): BackgroundEventsPort {
  const ns = chromeNs();
  const tabs = ns?.tabs;
  if (tabs === undefined || tabs.onUpdated === undefined) return NULL_EVENTS;

  const port: BackgroundEventsPort = {
    onTabUpdated: (listener) => {
      const cb = (tabId: number, changeInfo: unknown, tab: TabLike): void => {
        const info = (changeInfo ?? {}) as { status?: string; url?: string };
        listener(tabId, info, tab);
      };
      tabs.onUpdated.addListener(cb);
      return () => tabs.onUpdated.removeListener(cb);
    },
    onTabActivated: (listener) => {
      const cb = (info: { tabId: number }): void => listener(info.tabId);
      tabs.onActivated.addListener(cb);
      return () => tabs.onActivated.removeListener(cb);
    },
  };

  const windows = ns?.windows;
  if (windows?.onFocusChanged === undefined) return port;
  return {
    ...port,
    onWindowFocusChanged: (listener) => {
      const cb = (windowId: number): void => listener(windowId);
      windows.onFocusChanged.addListener(cb);
      return () => windows.onFocusChanged.removeListener(cb);
    },
  };
}

/**
 * 消息端口的生产装配。
 *
 * ## 🔴 `sendResponse` + `return true` 而不是返回 Promise
 *
 * Chrome 的 `onMessage` 监听器**可以**返回 Promise,但 MV3 下该用法在
 * Chrome 与 Firefox 间行为不一致,且返回非 `true` 的真值会被当作同步响应。
 * 唯一在 Chrome MV3 上确定可靠的异步回包方式是:同步 `return true`
 * 保持通道开启,随后调用 `sendResponse`。
 *
 * **不认领的消息必须返回 `undefined`**(而非 `true`):返回 `true` 会让本
 * 监听器占住通道,别的监听器(如 T6b 的 `PREVIEW_FILTER`,ADR-049 走
 * 独立通道)的响应就回不去了。
 */
export function defaultMessagingPort(): MessagingPort {
  const runtime = chromeNs()?.runtime;
  if (runtime?.onMessage === undefined) return NULL_MESSAGING;
  return {
    onMessage: (handler) => {
      const cb: ChromeMessageListener = (message, _sender, sendResponse) => {
        const result: Promise<TabState> | null = handler(message);
        if (result === null) return undefined; // 不是本监听器的消息
        void result.then(
          (state) => sendResponse(state),
          () => {
            /* handler 承诺永不 reject;此处只是类型层面的兜底。 */
          },
        );
        return true; // 保持通道开启,稍后 sendResponse
      };
      runtime.onMessage.addListener(cb);
      return () => runtime.onMessage.removeListener(cb);
    },
  };
}
