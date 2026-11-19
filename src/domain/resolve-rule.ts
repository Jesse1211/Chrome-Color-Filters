/**
 * `resolveRule(settings, url)` —— 取 host,按序首个命中(ADR-007 / ADR-008 / INV-6)。
 *
 * 纯 TypeScript —— 零 React / 零 chrome.* / 零 wxt(ADR-036)。
 * 用到的 `URL` 是 ECMAScript/WHATWG 标准全局,Node 与浏览器皆有,非浏览器扩展 API。
 */

import { type FilterRule } from './filter-rule.js';
import { type FilterSettings } from './filter-settings.js';
import { matchGlob } from './glob.js';

export interface ResolvedRule {
  /** 命中的规则。 */
  readonly rule: FilterRule;
  /** 它在 `settings.rules` 中的索引 —— 身份的一半(§1)。 */
  readonly index: number;
}

/**
 * 从完整 URL 取出 **host** 部分(ADR-007)。
 *
 * 只要 host:不含协议、端口、路径、查询参数。
 * `https://x.com/path?q=1` → `x.com`(门禁明确要求)。
 * `https://x.com:8443/` → `x.com`(端口不属于 host 匹配面)。
 *
 * 解析失败(非法 URL、`chrome://` 之外的怪异 scheme 等)返回 null;
 * 调用方据此判定「无规则命中」,绝不抛异常。
 */
export function hostFromUrl(url: string): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  try {
    // URL.hostname 已去掉端口;再 lowercase 以对齐 DNS 的大小写无关语义。
    const hostname = new URL(url).hostname;
    return hostname.length > 0 ? hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * 按序解析:从 `rules[0]` 开始逐条测试,**首个命中的规则生效,立即停止**
 * (INV-6:索引最小的那条生效,且只有它生效)。
 *
 * 无规则命中 → 返回 null → 不套滤镜(§1 匹配语义第 4 条)。
 *
 * 🔴 **本函数不检查 `masterEnabled`。** INV-8 要求主开关 OFF 时
 * content script **完全不运行**(不读规则、不匹配、不注入),
 * 那是 T4 在入口处的短路判断,不是这里的 if。把它塞进本函数反而会
 * 诱导调用方「先解析再丢弃」,与 ADR-027 的性能意图相悖。
 * 需要带主开关语义时用 `resolveActiveRule`。
 */
export function resolveRule(
  settings: FilterSettings,
  url: string,
): ResolvedRule | null {
  const host = hostFromUrl(url);
  if (host === null) return null;

  const { rules } = settings;
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index];
    if (rule === undefined) continue;
    if (matchGlob(rule.pattern, host)) {
      return { rule, index }; // INV-6:立即停止
    }
  }
  return null;
}

/**
 * 带主开关语义的解析(INV-8 / ADR-027):`masterEnabled === false` 时
 * 恒返回 null,规则原样保留、不做任何匹配。
 */
export function resolveActiveRule(
  settings: FilterSettings,
  url: string,
): ResolvedRule | null {
  if (!settings.masterEnabled) return null;
  return resolveRule(settings, url);
}

/**
 * 被遮蔽判定(ADR-032 / §5.3 用):给定 host,返回每条规则是否「命中但被更靠前的规则遮蔽」。
 * 索引小于首个命中者的规则均未命中;大于它的若也命中则为被遮蔽。
 */
export function shadowedFlags(
  settings: FilterSettings,
  host: string | null,
): readonly boolean[] {
  const flags = settings.rules.map(() => false);
  if (host === null) return flags;
  let winnerFound = false;
  for (let i = 0; i < settings.rules.length; i++) {
    const rule = settings.rules[i];
    if (rule === undefined) continue;
    if (!matchGlob(rule.pattern, host)) continue;
    if (winnerFound) flags[i] = true;
    else winnerFound = true;
  }
  return flags;
}
