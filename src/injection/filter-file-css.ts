/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 预生成滤镜 CSS 文件的**内容与命名**(ADR-063 / **ADR-069/070**)—— 单一真相源。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * `chrome.scripting.registerContentScripts()` 的 `css` 字段**只接受文件路径,
 * 不接受内联字符串**(w3c/webextensions#615 已立项但未实现)。而首帧滤镜
 * 必须由 CSS 文件承担(ADR-062:CSS 文件在页面任何 DOM 被构建**或显示**之前
 * 注入,且**不受 `runAt` 约束**)。两者相乘,结论唯一:
 * **每一个 `(mode, intensity)` 组合都必须有一个预生成的文件。**
 *
 * 4 模式 × 101 档强度 = **404 个文件**。取 101 档而非 5 的倍数,是为了
 * 保留 ADR-003 的「强度无级可调」—— 每文件仅一行,总计几 KB。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## 🔴 ADR-069:选择器是 `html.ccf-on`,值是**同文档 fragment 引用**
 * ───────────────────────────────────────────────────────────────────────────
 *
 * ```css
 * html.ccf-on { filter: url("#ccf-{slug}-{intensity}") !important; }
 * ```
 *
 * 两处都是 ADR-069 拍板的规格,**不是示意**:
 *
 * ### 1. `url("#...")` 指向同文档,不是 `data:` URI
 *
 * 上一版把整个 SVG 内联进 `data:image/svg+xml,...`。**T7 实测否了它**:
 * `data:` URI 的 SVG 被浏览器归类为**图片资源**,受站点 CSP 的 `img-src`
 * 管辖。在不放行 `data:` 的站点上三个色觉矫正滤镜**静默失效** ——
 * 像素与关闭态完全相同、无任何报错。确定性复现于 `img-src 'self'` /
 * 无 `img-src` 的 `default-src` / `img-src 'none'` 三种策略;真实 Chrome 在
 * news.ycombinator.com 捕获到 `{directive:'img-src', blockedURI:'data'}`。
 *
 * **同文档 `url("#id")` 引用不产生资源加载,CSP 无从拦截。**
 * 被引用的 `<filter>` 由 content script 在 `document_start` 的同步段内注入
 * (见 `svg-filter-def.ts`)。
 *
 * ### 2. 选择器**带 `.ccf-on` class** —— 这是前向引用问题的消除手段
 *
 * 本文件由 Chrome 在首帧之前注入,**早于** content script 建出 SVG 节点。
 * 看似前向引用,但 class 门控让该问题**根本不存在**:注入时 `html` 还没有
 * `ccf-on`,规则不匹配任何元素,浏览器压根不去解析那个 `url("#...")`;
 * 等 class 加上去时 `#ccf-…` 已在 DOM 里,filter 值是新算出来的。
 * **即使某个引擎缓存了「找不到」也不受影响** —— 消除不确定性,不是赌对。
 *
 * ### ⚠️ 这与上一轮那次失败的「属性门控」**不是**同一件事
 *
 * 本文件的选择器曾一度被写成 `html[data-ccf-on]`,真实 Chrome 逐帧录屏
 * 当场推翻:coldCache 3/3 站点首帧仍有未滤镜的彩色帧,探针显示属性要到
 * `readyState=complete` 才设上。**那次的根因是属性要等异步 storage 读完**,
 * 门控把 JS 重新放回了页面加载的关键路径。
 *
 * ADR-069 的 class 不等任何异步结果:它与 SVG 注入同处 `document_start` 的
 * **同一个同步段**,期间解析器与渲染都停着。实测对照 ——
 * 同步 fragment 路径 **0 次闪烁**,异步 storage 路径 **4 次中闪 1 次**。
 * **异步等待才是闪烁根源,JS 本身不是。**
 *
 * ### 附带收益:不再需要压制规则
 *
 * 裸 `html` 时代,「JS 判定本页不该上色」必须靠一条更高特异度的
 * `html[data-ccf-off] { filter: none }` 去压(因为裸 `html` 无条件生效)。
 * 现在**摘掉 class 就等于撤除**,`filter.css` 里那整组压制规则已删除。
 * ADR-069 原文:「开关滤镜只需切换 class,不增删样式表」。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## 🔴 ADR-070:四个滤镜统一走 SVG,灰阶不例外
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 灰阶也用 `feColorMatrix`,不再用 CSS 内置 `grayscale()`。灰阶本身就是一个
 * 颜色矩阵,用内置函数只是巧合可行;若灰阶走内置函数、另三个走 SVG,
 * **两条注入路径会各自演化**,又多一类「只在某条路径上出现的 bug」——
 * 本次 CSP 缺陷恰好只打中 SVG 路径而灰阶无恙,正是这种分裂的代价。
 * 统一后本文件 404 个产物的结构完全一致。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## 🔴 为什么本模块必须复用 `filterCssValue`(ADR-063 的强制项)
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 新架构有**两条**让滤镜生效的路径,它们在不同时机、对不同页面生效:
 *
 * | 路径 | 生效对象 | 滤镜值来自 |
 * |------|----------|------------|
 * | 预生成 CSS 文件(声明式注册) | **下一次导航**的首帧 | 本模块 |
 * | JS content script(`apply-filter.ts`) | **已打开**的页面(实时更新) | `filterCssValue` |
 *
 * 若本模块另写一份 id 构词法或矩阵公式,两条路径就会产出**不同的引用**:
 * 同一个站点,首帧引用 `#ccf-gray-50`、JS 却建了个 `#ccf-grayscale-50`
 * 的节点 —— 结果是首帧**无滤镜**(引用不到),且因为两边各自「自测通过」,
 * 这种漂移极难被发现。ADR-063 为此明文禁止另写公式。
 *
 * 故本模块**只做字符串拼装**,滤镜值一律取自 `filterCssValue(mode, intensity)`
 * (它内部经 `svgFilterId` 构造 id),文件名短名取自同一个
 * `FILTER_MODE_SLUGS`(ADR-069 后它住在领域层,因为它同时决定
 * CSS 的 `url("#id")` 与 SVG 的 `<filter id>`)。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## INV-8 / ADR-027(主开关 OFF 不上色)仍由「注册与否」表达
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 不是靠选择器。`desiredRegistrations()` 在 `masterEnabled === false` 时
 * 返回空集,`reconcile()` 据此 unregister 全部。磁盘上没有注册 →
 * 浏览器无从注入 → 首帧自然不上色。真实 Chrome 已实测确认
 * (主开关 OFF 时 `getRegisteredContentScripts()` 返回 `[]`)。
 *
 * **超集多匹配的误伤**同样不靠选择器:放宽**必须有界**(多匹配集合限于
 * 同一注册域的其他子域),无界时返回 `inexpressible` → **不注册**,
 * 该 glob 由 JS 路径 + ADR-060 快路径承接首帧。见 `match-pattern.ts` 与
 * `reconcile.ts` 的 `assertNoUnintendedAllUrls()`。
 *
 * 📌 ADR-069 之后还多了一层天然保护:即便某页被多匹配进来拿到了 CSS 文件,
 *    JS 不加 `ccf-on` class,规则就不匹配 —— **误伤的窗口关闭了**。
 *    (但这不改变「放宽必须有界」的要求:那条约束防的是无界注册本身。)
 *
 * 纯 TypeScript:零 `chrome.*`、零 React、零 wxt、零 `node:fs` ——
 * 本模块只产出字符串,**写文件是构建脚本的事**(`scripts/generate-filter-css.mjs`)。
 * 这样同一份逻辑既能被构建脚本调用,也能被单测逐位比对(ADR-063 的 gate)。
 */

import {
  type FilterMode,
  type Intensity,
  FILTER_MODES,
  FILTER_MODE_SLUGS,
  INTENSITY_MAX,
  INTENSITY_MIN,
  filterCssValue,
} from '../domain/index.js';

/**
 * 预生成 CSS 文件在扩展包内的目录(ADR-063)。
 *
 * 放在 `public/` 下,WXT 会原样拷进产物根目录,于是
 * `registerContentScripts({ css: ['filters/gray-100.css'] })` 的路径
 * 就是产物内的相对路径。
 *
 * 🔴 **不进 `web_accessible_resources`**(ADR-063 明文):
 * 这些文件由浏览器自己读取并注入,不经页面 `fetch`。
 * 放进去反而给站点一个探测扩展存在与用户滤镜偏好的接口 —— 增加指纹暴露面。
 *
 * 📌 ADR-069 选择同文档 SVG 而非 `chrome-extension://` + `web_accessible_resources`
 *    的理由与此同源:后者同样会带来指纹暴露。
 */
export const FILTER_CSS_DIR = 'filters';

/**
 * 滤镜文件名中代表模式的短名。
 *
 * 🔴 **ADR-069 之后本常量的真相源在领域层**(`src/domain/filter-css.ts`):
 *    它同时决定 SVG 的 `<filter id>` 与 CSS 的 `url("#id")`,两边必须逐字
 *    相同,故不能有第二份。这里**重新导出**,使既有 import 路径继续可用
 *    (向后兼容),但**不是**独立定义。
 */
export { FILTER_MODE_SLUGS };

/** 短名 → 模式的反查(诊断与测试用,避免手写第二份映射)。 */
export const FILTER_SLUG_TO_MODE: Readonly<Record<string, FilterMode>> =
  Object.fromEntries(
    FILTER_MODES.map((mode) => [FILTER_MODE_SLUGS[mode], mode]),
  ) as Readonly<Record<string, FilterMode>>;

/**
 * 预生成文件在扩展包内的相对路径,如 `filters/gray-100.css`。
 *
 * 这正是 `registerContentScripts({ css: [...] })` 要的那个字符串
 * (ADR-062 的示例)。
 */
export function filterCssFilePath(
  mode: FilterMode,
  intensity: Intensity,
): string {
  return `${FILTER_CSS_DIR}/${FILTER_MODE_SLUGS[mode]}-${intensity}.css`;
}

/**
 * 一个预生成文件的**完整内容**。
 *
 * 结构与 `src/injection/filter.css` 的两条规则一一对应,原因相同:
 *
 * - **主规则**作用在根元素 `<html>`,门控为 `.ccf-on`(ADR-069)。
 *   🔴 **不得改成 `body`** —— 根元素的 filter 有 CSS Filter Effects 的特例,
 *   **不为 `position:fixed` 后代建立 containing block**(T0 实测 dx=0/dy=0);
 *   换成 `body` 则 fixed header 跑到 y=-1000(T0 §4.3)。这是 INV-1 最脆弱的点。
 *   🔴 **也不得去掉 `.ccf-on`** —— 裸 `html` 会让 CSS 在 SVG 节点就位之前
 *   就去解析 `url("#ccf-…")`,把 ADR-069 精心消除的前向引用不确定性放回来。
 * - **top layer 补偿**不是可选项(T0 §4.5):`<dialog showModal()>`、
 *   `[popover]`、`:fullscreen`、`::backdrop` 在绘制树中**不是根元素的后代**,
 *   根 filter 到不了它们。T0 实测缺此规则时 modal 全彩(maxChannelSpread=238)。
 *   预生成文件走的是**首帧**路径,而首帧上就可能存在一个
 *   `popover`/`dialog`(如站点在 HTML 里直接写了 `<dialog open>`),
 *   所以这条规则在这里同样必需。
 *
 * 末尾带换行:文本文件的常规,也让 `git diff` 不产生 "No newline" 噪音。
 */
export function filterCssFileContent(
  mode: FilterMode,
  intensity: Intensity,
): string {
  const value = filterCssValue(mode, intensity);
  // 🔴 `html.ccf-on` —— class 门控是 ADR-069 的规格,不是样式糖。
  //    去掉它会让浏览器在 SVG 就位前解析 url("#..."),
  //    恢复那个本已被消除的不确定性。
  return (
    `/* 预生成滤镜 ${mode} @ ${intensity}%(ADR-062/063/069/070)。由 scripts/generate-filter-css.mjs 生成,勿手改。 */\n` +
    `html.ccf-on { filter: ${value} !important; }\n` +
    `html.ccf-on :modal,\n` +
    `html.ccf-on [popover]:popover-open,\n` +
    `html.ccf-on :fullscreen,\n` +
    `html.ccf-on ::backdrop { filter: ${value} !important; }\n`
  );
}

/** 全部 101 档强度(0–100,含两端)。ADR-003:强度无级可调。 */
export const ALL_INTENSITIES: readonly Intensity[] = Array.from(
  { length: INTENSITY_MAX - INTENSITY_MIN + 1 },
  (_unused, i) => INTENSITY_MIN + i,
);

/** 需要生成的文件总数(ADR-063 gate:404)。 */
export const FILTER_CSS_FILE_COUNT =
  FILTER_MODES.length * ALL_INTENSITIES.length;

/**
 * 枚举全部要生成的文件(路径 + 内容)。
 *
 * 构建脚本与单测**共用**本函数,于是「产物里有什么」与
 * 「断言期望什么」在结构上不可能分叉(ADR-063 的防漂移意图)。
 */
export function allFilterCssFiles(): readonly {
  readonly mode: FilterMode;
  readonly intensity: Intensity;
  readonly path: string;
  readonly content: string;
}[] {
  const files: {
    mode: FilterMode;
    intensity: Intensity;
    path: string;
    content: string;
  }[] = [];
  for (const mode of FILTER_MODES) {
    for (const intensity of ALL_INTENSITIES) {
      files.push({
        mode,
        intensity,
        path: filterCssFilePath(mode, intensity),
        content: filterCssFileContent(mode, intensity),
      });
    }
  }
  return files;
}
