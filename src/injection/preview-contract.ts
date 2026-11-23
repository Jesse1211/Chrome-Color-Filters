/**
 * `PREVIEW_FILTER` / `PREVIEW_CLEAR` 消息契约(**ADR-049**)——
 * popup(T6b)↔ content script(T4b)之间唯一的接口。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **本文件是 DESIGN.md §6 T4b 中那段契约的逐字 TypeScript 化,不得各自发挥。**
 *
 * > ADR-049:此契约与 ADR-044 同等重要:T4 与 T6b 是两个独立 Dev agent,
 * > 不定死就会发明两套不兼容的设计。
 *
 * 与 `src/ui/tab-state.ts`(ADR-044 的同类文件)完全同一个理由与同一个形状:
 * **接收端在 T4b,发送端在 T6b**,两边只共享本文件里的类型与常量。
 * DESIGN.md §6.2 的风险表为此列了一行:
 *
 * > | T6b / T6c | **T4b / T6a** | `PREVIEW_FILTER` 接收端与 ADR-049 契约不符 |
 *
 * 把类型放在这里(而不是各自内联字面量)正是为了让那一行风险在编译期
 * 就被 `tsc --noEmit`(ADR-066)挡住,而不是等真实栈联调才暴露。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 路由(DESIGN.md §6 T4b 明文「必须按此实现,不得自行选择」)
 *
 * ```
 *   popup ──chrome.tabs.connect(tabState.tabId, { name: 'preview' })──▶ content script
 * ```
 *
 * - `tabId` 来自 T5 的 `GET_TAB_STATE`(ADR-044)—— popup **不得**自己调
 *   `chrome.tabs.query`,tab 解析的真相来源唯一归 T5。
 * - **不经 service worker 中转** —— 否则 T5 进入预览路径,而 T5 并非 T6b 的上游。
 *
 * 接收端因此只需 `chrome.runtime.onConnect`:`chrome.tabs.connect` 发起的连接
 * 在目标 tab 的 content script 里表现为一次 `onConnect`,`port.name` 即
 * 连接方传入的 `name`。本文件把那个名字也定死为常量,见 `PREVIEW_PORT_NAME`。
 *
 * ## 生命周期(DESIGN.md §6 T4b)
 *
 * 临时覆盖在以下**任一**情况结束:
 * 1. 收到 `PREVIEW_CLEAR`;
 * 2. 端口 `onDisconnect` —— popup 关闭 **或** 页面导航(tab 端口两者都会触发)。
 *
 * ## 预览值绝不落盘
 *
 * 本文件**只定义消息**,不含任何存储 API —— 这是 ADR-049
 * 「不经存储」在模块边界上的体现。接收端(`preview-receiver.ts`)同样
 * 不接触 `SettingsRepository` 与 `fast-path-cache`,由单测 spy 断言把守
 * (DESIGN.md §6 T4b gate:「且 storage 无写入(spy 断言)」)。
 */

import {
  type FilterMode,
  type Intensity,
  coerceFilterMode,
  coerceIntensity,
} from '../domain/index.js';

/** 端口名 —— popup 侧 `chrome.tabs.connect(tabId, { name: PREVIEW_PORT_NAME })`。 */
export const PREVIEW_PORT_NAME = 'preview' as const;

export const PREVIEW_FILTER = 'PREVIEW_FILTER' as const;
export const PREVIEW_CLEAR = 'PREVIEW_CLEAR' as const;

/**
 * 套用临时值。
 *
 * 字段名与 DESIGN.md §6 T4b 的 `type PreviewFilter` 声明**逐字一致**:
 * `{ type: 'PREVIEW_FILTER'; mode: FilterMode; intensity: number }`。
 */
export interface PreviewFilterMessage {
  readonly type: typeof PREVIEW_FILTER;
  readonly mode: FilterMode;
  readonly intensity: Intensity;
}

/** 恢复按规则解析的结果。 */
export interface PreviewClearMessage {
  readonly type: typeof PREVIEW_CLEAR;
}

/** ADR-049 契约的消息联合。 */
export type PreviewMessage = PreviewFilterMessage | PreviewClearMessage;

/**
 * 把来自消息通道的任意值收敛为合法 `PreviewMessage`,不合法返回 `null`。
 *
 * 同 `coerceTabState`(ADR-041 的同一精神):**结构不符时忽略,绝不抛异常** ——
 * 接收端跑在**宿主页面**里,一个畸形消息导致未捕获异常会被站点的
 * `onerror` 观测到,那是 INV-1(不改变页面可观察行为)的破坏。
 *
 * ⚠️ 这不是「容忍 T6b 发明别的格式」:字段缺失会被丢弃,表现为
 * 「拖动滑块页面无反应」—— 可见、可判、可上报。
 *
 * `mode` / `intensity` 走领域层的 `coerce*`(ADR-041),于是
 * `intensity: 150` 被夹到 100、`intensity: 70.4` 被取整为 70 ——
 * 与存储路径用的是**同一套**收敛规则,预览与保存后的结果因此一致
 * (否则会出现「预览 70.4 看着是 70、保存后变成 70」之外的偏差)。
 */
export function coercePreviewMessage(value: unknown): PreviewMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;

  if (v.type === PREVIEW_CLEAR) return { type: PREVIEW_CLEAR };

  if (v.type === PREVIEW_FILTER) {
    // 🔴 `mode` 必须**原样合法**才接受,不走 coerce 的默认回退:
    //    把一个拼错的 mode 静默变成 Grayscale 会让 T6b 的契约不符
    //    表现为「预览总是灰阶」—— 那是比「无反应」更难诊断的 bug。
    if (typeof v.mode !== 'string') return null;
    const mode = coerceFilterMode(v.mode);
    if (mode !== v.mode) return null;

    if (typeof v.intensity !== 'number' || !Number.isFinite(v.intensity)) {
      return null;
    }
    return {
      type: PREVIEW_FILTER,
      mode,
      // 夹取 + 取整是合法输入的正常收敛(ADR-003),不是契约不符。
      intensity: coerceIntensity(v.intensity),
    };
  }

  return null;
}
