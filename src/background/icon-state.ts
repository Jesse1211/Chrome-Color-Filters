/**
 * 扩展图标两态(**ADR-019** / **ADR-045**)—— 纯函数 + 资源路径映射。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * > ADR-019:扩展**图标两态**:生效(亮)/ 未生效(灰)。语义简单:
 * > **亮 = 这页被改色了**。主开关 OFF 时全灰(因为确实都没生效),与 INV-8 一致。
 *
 * > ADR-045:图标**程序生成**(SVG→PNG,16/32/48/128),两态必须使用
 * > **不同图片资源**。否则 T5 会拿 WXT 占位图标「通过」门禁 ——
 * > 技术上绿、视觉上错,且无人负责发现。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 📌 图标资源已由 T1 的 `scripts/generate-icons.mjs` 程序生成并提交
 * (`public/icon/{active,inactive}/{16,32,48,128}.png`),
 * `tests/project-gates.test.ts` 已有「两态 hash 不等」的机械断言把守。
 * 本模块只负责**选择哪一态**与**路径映射**,不重新生成图标。
 *
 * ## 判定口径:「是否**实际生效**」,不是「是否有规则」
 *
 * §6 T5 spec 的措辞是「按当前 tab 是否**实际生效**更新图标两态」。
 * 三个档位,必须逐一区分:
 *
 * | 情形 | 图标 | 依据 |
 * |------|------|------|
 * | 主开关 ON + 当前页命中某条规则 + 该规则强度 > 0 | 亮 | ADR-019「亮 = 这页被改色了」 |
 * | 主开关 ON + 当前页无规则命中 | 灰 | 同上,没被改色 |
 * | 主开关 OFF | 灰(全部 tab) | ADR-019 明文 + INV-8 |
 * | 当前页不可注入 | 灰 | 页面根本没被改色(ADR-013 的页面上扩展不运行) |
 *
 * 🔴 **`intensity === 0` 判灰。** 这是「有规则命中」与「实际生效」唯一会
 * 分叉的一格:强度 0 的滤镜矩阵是恒等变换,页面**像素完全没变**。
 * ADR-019 把图标语义定为「亮 = 这页被改色了」,而强度 0 下这页没被改色,
 * 故判灰。(注册仍然存在 —— 见 `reconcile.ts` 对 `intensity === 0`
 * 仍注册的论证:那是为了避免强度档位上的时序不一致,与图标语义无关。)
 */

import { type FilterSettings, resolveActiveRule } from '../domain/index.js';
import { classifyUrl } from './injectable-url.js';

/** 两态。字符串字面量而非布尔 —— 让调用点自解释(`'active'` 比 `true` 清楚)。 */
export type IconState = 'active' | 'inactive';

/** ADR-045 的四个尺寸。 */
export const ICON_SIZES = [16, 32, 48, 128] as const;

/**
 * 两态的资源路径表(相对扩展根)。
 *
 * ⚠️ 必须与 `scripts/generate-icons.mjs` 的输出目录和 `wxt.config.ts` 的
 * 静态注册**同名**:`public/` 下的文件在产物中位于根。
 * 路径写错的后果是 `chrome.action.setIcon` 静默失败、图标永远停在默认态
 * —— 即 ADR-019 等于没实现。`tests/t5-static-gates.test.ts` 有断言
 * 把这张表与磁盘上的真实文件对齐。
 */
export const ICON_PATHS: Readonly<Record<IconState, Readonly<Record<string, string>>>> = {
  active: {
    16: 'icon/active/16.png',
    32: 'icon/active/32.png',
    48: 'icon/active/48.png',
    128: 'icon/active/128.png',
  },
  inactive: {
    16: 'icon/inactive/16.png',
    32: 'icon/inactive/32.png',
    48: 'icon/inactive/48.png',
    128: 'icon/inactive/128.png',
  },
};

/** 取某一态的 `chrome.action.setIcon` 的 `path` 参数。 */
export function iconPathsFor(state: IconState): Readonly<Record<string, string>> {
  return ICON_PATHS[state];
}

/**
 * 当前 tab 的图标态 —— `(settings, url)` 的纯函数。
 *
 * 判定链(顺序即语义,见文件头表格):
 * 1. 不可注入 → `inactive`(ADR-013)
 * 2. `resolveActiveRule` 为 null(含主开关 OFF 的 INV-8 短路)→ `inactive`
 * 3. 命中规则但 `intensity === 0` → `inactive`(像素未变,见文件头 🔴)
 * 4. 其余 → `active`
 */
export function iconStateFor(
  settings: FilterSettings,
  url: string | null | undefined,
): IconState {
  if (!classifyUrl(url).injectable) return 'inactive';
  const active = resolveActiveRule(settings, url ?? '');
  if (active === null) return 'inactive';
  if (active.rule.intensity === 0) return 'inactive';
  return 'active';
}
