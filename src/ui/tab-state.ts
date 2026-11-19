/**
 * `GET_TAB_STATE` 消息契约(**ADR-044**)—— T5 ↔ popup 之间唯一的接口。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **本文件是 DESIGN.md §6 T5 中那段契约的逐字 TypeScript 化,不得各自发挥。**
 *
 * > ADR-044:两个独立 Dev agent 会发明两种消息格式,错配在 T6a 才暴露,
 * > 而彼时 T5 已通过审核并合并。
 *
 * T6a 需要的是**类型**,不是 T5 的实现(§6 T6a:depends_on 只有 T3)——
 * 故此处按契约定义类型 + stub,真实联调放在 T6a 的 REAL_STACK_GATE。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

/** 消息类型常量。popup 发 `{ type: 'GET_TAB_STATE' }`(ADR-044 逐字)。 */
export const GET_TAB_STATE = 'GET_TAB_STATE' as const;

export interface GetTabStateMessage {
  readonly type: typeof GET_TAB_STATE;
}

/** 不可注入的原因(ADR-013 / ADR-044)。 */
export type TabStateReason =
  | 'internal-page'
  | 'web-store'
  | 'pdf'
  | 'new-tab'
  | 'no-tab';

/**
 * ADR-044 契约的响应结构。**字段名、类型、语义均不得改动。**
 */
export interface TabState {
  /** 当前 tab 的 id;供 popup 用 `chrome.tabs.connect` 直连(ADR-049,T6b 用)。 */
  readonly tabId: number | null;
  /** false = `chrome://` / 应用商店 / PDF / 新标签页(ADR-013)。 */
  readonly injectable: boolean;
  readonly reason?: TabStateReason;
  /** 当前页 host;不可注入时为 null。 */
  readonly host: string | null;
  /** 当前生效规则在 `rules` 中的索引;无命中为 null。 */
  readonly activeRuleIndex: number | null;
  /** 命中了但被遮蔽的规则索引,**升序**(ADR-032)。 */
  readonly shadowedRuleIndexes: readonly number[];
}

/**
 * 超时 / service worker 休眠时的降级值(ADR-044 逐字要求)。
 *
 * > service worker 可能处于休眠,popup 必须处理消息超时
 * > (降级为 `injectable:false, reason:'no-tab'`)
 */
export const FALLBACK_TAB_STATE: TabState = {
  tabId: null,
  injectable: false,
  reason: 'no-tab',
  host: null,
  activeRuleIndex: null,
  shadowedRuleIndexes: [],
};

/** 默认超时窗口。MV3 service worker 冷启动通常在百毫秒级。 */
export const TAB_STATE_TIMEOUT_MS = 1_000;

/**
 * 把来自消息通道的任意响应收敛为合法 `TabState`。
 *
 * ADR-041 的同一精神:**结构不符时回退降级值,绝不抛异常** ——
 * popup 是用户唯一的控制入口,因一个畸形响应白屏是不可接受的。
 *
 * ⚠️ 这不是「容忍 T5 发明别的格式」:字段缺失会被降级为 `no-tab`,
 * 在 REAL_STACK_GATE 中表现为「列表全程不显示生效/未生效标记」——
 * 可见、可判、可上报(§6.2:T6a 判 FAIL 并注明,由 T7 发出 BLOCKED_UPSTREAM)。
 */
export function coerceTabState(value: unknown): TabState {
  if (typeof value !== 'object' || value === null) return FALLBACK_TAB_STATE;
  const v = value as Record<string, unknown>;

  if (typeof v.injectable !== 'boolean') return FALLBACK_TAB_STATE;

  const tabId =
    typeof v.tabId === 'number' && Number.isInteger(v.tabId) ? v.tabId : null;
  const host = typeof v.host === 'string' && v.host.length > 0 ? v.host : null;
  const activeRuleIndex =
    typeof v.activeRuleIndex === 'number' && Number.isInteger(v.activeRuleIndex)
      ? v.activeRuleIndex
      : null;

  const shadowedRuleIndexes = Array.isArray(v.shadowedRuleIndexes)
    ? v.shadowedRuleIndexes
        .filter((n): n is number => typeof n === 'number' && Number.isInteger(n))
        .sort((a, b) => a - b) // 契约要求升序;此处兜底而非信任
    : [];

  const reason = isTabStateReason(v.reason) ? v.reason : undefined;

  return {
    tabId,
    injectable: v.injectable,
    ...(reason ? { reason } : {}),
    host,
    activeRuleIndex,
    shadowedRuleIndexes,
  };
}

function isTabStateReason(value: unknown): value is TabStateReason {
  return (
    value === 'internal-page' ||
    value === 'web-store' ||
    value === 'pdf' ||
    value === 'new-tab' ||
    value === 'no-tab'
  );
}

/** 不可注入时给用户看的说明(§5.4 / ADR-013:控件置灰 + **说明原因**)。 */
export const NOT_INJECTABLE_MESSAGE =
  '此页面不支持滤镜。Chrome 不允许扩展修改内部页面、应用商店和 PDF 查看器。';

/** 取 `TabState` 的消息端口 —— 注入式,便于 popup 在无 `chrome` 的环境下渲染。 */
export type TabStatePort = () => Promise<TabState>;

interface ChromeLikeRuntime {
  sendMessage(message: unknown): Promise<unknown>;
}

interface GlobalWithChromeRuntime {
  chrome?: { runtime?: ChromeLikeRuntime };
}

/**
 * 真实端口:向 service worker 发 `GET_TAB_STATE`,带超时降级。
 *
 * 任何失败(worker 休眠、无接收方、超时、畸形响应)一律降级为
 * `FALLBACK_TAB_STATE`,**不抛异常**(ADR-044)。
 */
export function chromeTabStatePort(
  timeoutMs: number = TAB_STATE_TIMEOUT_MS,
): TabStatePort {
  return async () => {
    const runtime = (globalThis as unknown as GlobalWithChromeRuntime).chrome
      ?.runtime;
    if (!runtime?.sendMessage) return FALLBACK_TAB_STATE;

    const message: GetTabStateMessage = { type: GET_TAB_STATE };

    try {
      const response = await Promise.race([
        runtime.sendMessage(message),
        new Promise<typeof TIMED_OUT>((resolve) =>
          setTimeout(() => resolve(TIMED_OUT), timeoutMs),
        ),
      ]);
      if (response === TIMED_OUT) return FALLBACK_TAB_STATE;
      return coerceTabState(response);
    } catch {
      return FALLBACK_TAB_STATE;
    }
  };
}

const TIMED_OUT = Symbol('tab-state-timeout');

/**
 * Stub 端口 —— T6a 在 T5 合并前对着它开发(§6 T6a 的 depends_on 注记)。
 *
 * ⚠️ 它**只用于开发期与单测**,不是验收替身:§8 第 8 条明确
 * 「jsdom/mock 下的绿灯不构成通过」,真实联调在 REAL_STACK_GATE。
 */
export function stubTabStatePort(state: Partial<TabState> = {}): TabStatePort {
  const merged = coerceTabState({ ...FALLBACK_TAB_STATE, ...state });
  return () => Promise.resolve(merged);
}
