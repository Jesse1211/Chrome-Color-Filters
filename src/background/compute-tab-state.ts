/**
 * `GET_TAB_STATE` 的**响应计算**(**ADR-044**)—— 纯函数,零 `chrome.*`。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **契约的另一端。** 类型与降级值由 T6a 在 `src/ui/tab-state.ts` 中
 * 按 DESIGN.md §6 T5 的那段契约钉死;本文件是**生产端**的计算,
 * 刻意 `import` 那同一个类型 —— 两份类型声明就是 ADR-044 要防的那个事故。
 *
 * > ADR-044:两个独立 Dev agent 会发明两种消息格式,错配在 T6a 才暴露,
 * > 而彼时 T5 已通过审核并合并。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 为什么 T5 是匹配判定的**唯一**真相来源
 *
 * §5.6 与 §6 T6b 的注记都明文要求:`activeRuleIndex` 与
 * `shadowedRuleIndexes` 由本处计算,**两个视图都不自己算匹配**。
 * 于是列表视图的「生效/被遮蔽」淡化(ADR-032)与编辑视图的两维状态行
 * 共用同一份判定 —— 不存在「popup 认为命中了而页面没变色」。
 *
 * 实现上这意味着本模块**必须**复用领域层的 `resolveActiveRule` /
 * `shadowedFlags`(ADR-007/ADR-008/ADR-032/INV-6),而不是重写一遍匹配。
 * 重写即制造第二份真相。
 *
 * ## MV3:真相在 `chrome.storage`,不在 worker 内存
 *
 * DESIGN.md §6 T5 注:「MV3 service worker 非持久化,随时可能被终止 ——
 * **它不可以是聚合的真相来源**,真相在 `chrome.storage`。」
 * 本模块因此**不缓存任何东西**:`settings` 由调用方每次从仓储层读入。
 * 纯函数这件事本身就是该约束的机械保证 —— 没有可被终止的状态。
 */

import {
  type FilterSettings,
  hostFromUrl,
  resolveActiveRule,
  shadowedFlags,
} from '../domain/index.js';
import { type TabState } from '../ui/tab-state.js';
import { classifyUrl } from './injectable-url.js';

/** 计算所需的 tab 信息 —— `chrome.tabs.Tab` 中本模块用到的那个子集。 */
export interface TabLike {
  readonly id?: number;
  readonly url?: string;
  /**
   * `pendingUrl` —— 导航已发起但尚未提交时 `url` 仍是旧页面。
   * popup 在导航中途被打开时若只看 `url`,会把**上一个**页面的 host
   * 报给 popup,用户看到的是错的规则命中。优先取 `url`,缺失时退 `pendingUrl`。
   */
  readonly pendingUrl?: string;
}

/**
 * 计算 `TabState`。
 *
 * ## 字段语义(逐条对应 ADR-044 的注释)
 *
 * - `tabId`:当前 tab 的 id。**即使不可注入也照实填** —— 契约注释说它
 *   「供 popup 用 `chrome.tabs.connect` 直连(ADR-049)」,而 T6b 的预览
 *   在不可注入页上本就不可用(§5.5 四种情况之一),那是 popup 的判定依据;
 *   T5 的职责是**如实上报**,不是替 popup 做决定。tab 不存在时为 null。
 * - `injectable` / `reason`:见 `injectable-url.ts`(ADR-013)。
 * - `host`:契约逐字要求「**不可注入时为 null**」。
 * - `activeRuleIndex`:`resolveActiveRule` 的索引 —— 它内含 INV-8 短路
 *   (主开关 OFF → 恒 null),故主开关一关,popup 的全部「生效」标记随之消失,
 *   与图标全灰、页面无滤镜三者同步(ADR-019/INV-8)。
 * - `shadowedRuleIndexes`:命中但被更靠前规则遮蔽者,**升序**。
 *   `shadowedFlags` 按索引顺序遍历,故自然升序;此处不再排序,
 *   但 `src/ui/tab-state.ts` 的 `coerceTabState` 仍会兜底排序(防御,不是信任)。
 *
 * ## 🔴 主开关 OFF 时 `shadowedRuleIndexes` 必须为空
 *
 * 「被遮蔽」的含义是「命中了,但输给了更靠前的那条」。主开关 OFF 时
 * **没有任何规则生效**,此时报一串「被遮蔽」的索引会让 popup 把若干行
 * 淡化显示(ADR-032),用户读到的是「这些规则输给了别的规则」——
 * 而真相是「主开关关着,全都没生效」。INV-8 的原文是「所有规则原样保留」,
 * 两维状态必须一致地回到「未生效」。故主开关 OFF 时两个字段同时归零态。
 */
export function computeTabState(
  settings: FilterSettings,
  tab: TabLike | null | undefined,
): TabState {
  if (tab === null || tab === undefined) {
    return {
      tabId: null,
      injectable: false,
      reason: 'no-tab',
      host: null,
      activeRuleIndex: null,
      shadowedRuleIndexes: [],
    };
  }

  const tabId = typeof tab.id === 'number' && Number.isInteger(tab.id) ? tab.id : null;
  const url = tabUrl(tab);
  const { injectable, reason } = classifyUrl(url);

  if (!injectable) {
    return {
      tabId,
      injectable: false,
      ...(reason ? { reason } : {}),
      host: null, // 契约逐字:不可注入时为 null
      activeRuleIndex: null,
      shadowedRuleIndexes: [],
    };
  }

  const host = hostFromUrl(url ?? '');
  const active = resolveActiveRule(settings, url ?? '');

  // INV-8:主开关 OFF → resolveActiveRule 返回 null,两维状态同时归零(见上注)。
  const shadowed = settings.masterEnabled
    ? shadowedFlags(settings, host)
        .map((flag, index) => (flag ? index : -1))
        .filter((index) => index >= 0)
    : [];

  return {
    tabId,
    injectable: true,
    host,
    activeRuleIndex: active?.index ?? null,
    shadowedRuleIndexes: shadowed,
  };
}

/** 取 tab 的有效 URL:已提交的 `url` 优先,导航中途退 `pendingUrl`。 */
export function tabUrl(tab: TabLike): string | null {
  if (typeof tab.url === 'string' && tab.url.length > 0) return tab.url;
  if (typeof tab.pendingUrl === 'string' && tab.pendingUrl.length > 0) {
    return tab.pendingUrl;
  }
  return null;
}
