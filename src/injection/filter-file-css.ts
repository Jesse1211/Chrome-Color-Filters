/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 预生成滤镜 CSS 文件的**内容与命名**(ADR-063)—— 单一真相源。
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
 * 若本模块另写一份矩阵公式,两条路径就会产出**不同的颜色**:同一个站点,
 * 首帧是 A 色、JS 跑完变成 B 色 —— 一次用户可见的跳变,且因为两边各自
 * 「自测通过」,这种漂移极难被发现。ADR-063 为此明文禁止另写公式。
 *
 * 故本模块**只做字符串拼装**,滤镜值一律取自
 * `filterCssValue(mode, intensity)`(它内部复用 `toColorMatrix`,
 * 见 `src/domain/filter-css.ts`)。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## 🔴 选择器是**裸 `html`**,**绝不可**加属性门控 —— 实测血的教训
 * ───────────────────────────────────────────────────────────────────────────
 *
 * ADR-063 的原文就是 `html { filter: ... !important; }`,无条件生效。
 * **这不是示意,是规格。**
 *
 * 本轮曾一度把选择器写成 `html[data-ccf-on]`(门控属性由 JS 路径设置),
 * 理由听起来很有道理:主开关 OFF 时不上色、被超集多匹配进来的站点不误伤。
 * **真实 Chrome 实测当场推翻了它** —— 逐帧录屏显示 coldCache 场景
 * 3/3 站点仍有未滤镜的彩色帧。探针进一步定位到属性设上的时刻:
 *
 * ```
 * raf1               attr=false  computed=none          ← 首帧:CSS 到场但不选中任何元素
 * ready:interactive  attr=false  computed=none
 * ready:complete     attr=true   computed=grayscale(1)  ← JS 终于设上属性,太晚了
 * ```
 *
 * **门控属性把 JS 重新放回了页面加载的关键路径上** —— 而 ADR-062 的全部
 * 收益恰恰是「页面加载路径上**不再有任何查询**」。加了门控,预生成 CSS
 * 就退化成一张「等 JS 发话」的样式表,与旧架构的缺陷**一模一样**:
 * 闪烁的位置、原因都没变。
 *
 * ## 那两个「理由」各自的正确解法(都不需要门控)
 *
 * 1. **INV-8 / ADR-027(主开关 OFF 不上色)** —— 解法是**根本不注册**。
 *    `desiredRegistrations()` 在 `masterEnabled === false` 时返回空集,
 *    `reconcile()` 据此 unregister 全部。磁盘上没有注册 → 浏览器无从注入 →
 *    首帧自然不上色。真实 Chrome 已实测确认(主开关 OFF 时
 *    `getRegisteredContentScripts()` 返回 `[]`)。
 *    **用「注册与否」表达开关,而不是用「样式表选不选中」表达。**
 *
 * 2. **超集多匹配的误伤** —— 解法是**把放宽限定为有界**,而不是加门控。
 *
 *    🔴 **本轮更正了这里原先的论证。** 原注释说多匹配只是
 *    「INV-1 的一个极窄切面」,因此拿 INV-3 换它是亏本交易。
 *    **对有界放宽而言这是对的,对无界兜底而言是错的** ——
 *    `match-pattern.ts` 当时会把表达不出来的 glob(如 ADR-006 的旗舰例子
 *    `*.baidu.*`)兜底成 `*://* / *`,与本文件的裸 `html` 组合起来,
 *    一条规则就会给**整个互联网**的首帧上色。那不是「极窄切面」,
 *    而是对 DESIGN.md §1 匹配语义第 4 条(「无规则命中 → 不套滤镜」)
 *    的无界违反。
 *
 *    正确解法已在 `match-pattern.ts` 落地:放宽**必须有界**
 *    (多匹配集合限于同一注册域的其他子域);无界时返回 `inexpressible`
 *    → **不注册**,该 glob 由 JS 路径 + ADR-060 快路径承接首帧。
 *    `reconcile.ts` 的 `assertNoUnintendedAllUrls()` 把这条钉死。
 *
 *    门控仍然不是解法:它会牺牲**全部**站点的首帧保证(实测证明
 *    ADR-062 收益当场归零),而有界放宽的代价只是同域子域的短暂上色。
 *    且 ADR-018 把零闪烁定为**硬性不变式**,不可被这样折价。
 *    有界多匹配的兜底在 JS 路径:见下。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## 为什么文件里写死 filter 值,而不是 `var(--ccf-filter)`
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `src/injection/filter.css`(JS 路径用的静态样式表)用的是
 * `filter: var(--ccf-filter)`,变量由 JS 赋值。那是因为那张表是**一张**表,
 * 要服务所有 `(mode,intensity)` 组合。
 *
 * 预生成文件正相反:它**每个组合一个**,值在构建时就确定了。写死才能
 * 做到「首帧前完全不依赖 JS」—— 若写 `var(--ccf-filter)`,首帧时变量
 * 尚未被 JS 赋值,`filter` 解析为无效值,**等于没有滤镜**。
 * 这与上面的属性门控是同一个错误的两种写法。
 *
 * ## 两条路径如何共存(谁在什么时候赢)
 *
 * 两张表的主规则特异度不同:预生成文件是 `html`(0,0,1),
 * `filter.css` 是 `html[data-ccf-on]`(0,1,1)—— **后者更高**。于是:
 *
 * - **首帧**:只有预生成文件生效(JS 尚未设属性)→ 滤镜已就位(INV-3);
 * - **JS 跑完后**:`html[data-ccf-on]` 特异度更高而胜出,承接实时更新
 *   (改强度、关主开关、规则变更)。两者的值由同一个 `filterCssValue`
 *   算出,所以交接时**像素不跳变**。
 * - **JS 判定本站不该上色**(超集多匹配 / 主开关刚被关):预生成文件仍在
 *   生效,故必须有一条**更高特异度**的规则把它压回去 ——
 *   见 `filter.css` 的 `html:not([data-ccf-on])` 规则(ADR-062 下新增)。
 *
 *
 * 纯 TypeScript:零 `chrome.*`、零 React、零 wxt、零 `node:fs` ——
 * 本模块只产出字符串,**写文件是构建脚本的事**(`scripts/generate-filter-css.mjs`)。
 * 这样同一份逻辑既能被构建脚本调用,也能被单测逐位比对(ADR-063 的 gate)。
 */

import {
  type FilterMode,
  type Intensity,
  FILTER_MODES,
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
 */
export const FILTER_CSS_DIR = 'filters';

/**
 * 滤镜文件名中代表模式的短名。
 *
 * 为什么不直接用 `FilterMode` 的字面量(`Grayscale`/`RedGreen`/…):
 * 文件名进了注册记录、也进了扩展包清单,**全小写、无大小写歧义**的短名
 * 在跨平台(macOS 默认大小写不敏感、Linux 敏感)时更安全 ——
 * 一个大小写不一致的路径在 macOS 上能跑、在 Linux 上注册即失败,
 * 而注册失败的表现是「滤镜静默不生效」,排障成本极高。
 *
 * 📌 短名取 DESIGN.md §6 T4a 示例中的 `gray-100.css` 为准,其余三个
 * 按同一构词法(模式名小写、去驼峰分隔)。
 */
export const FILTER_MODE_SLUGS: Readonly<Record<FilterMode, string>> = {
  Grayscale: 'gray',
  RedGreen: 'redgreen',
  GreenRed: 'greenred',
  BlueYellow: 'blueyellow',
};

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
 * - **主规则**作用在根元素 `<html>`。🔴 **不得改成 `body`** ——
 *   根元素的 filter 有 CSS Filter Effects 的特例,**不为 `position:fixed`
 *   后代建立 containing block**(T0 实测 dx=0/dy=0);换成 `body` 则
 *   fixed header 跑到 y=-1000(T0 §4.3)。这是 INV-1 最脆弱的点。
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
  // 🔴 裸 `html`,**无任何属性门控** —— 见文件头「选择器是裸 html」一节。
  //    加门控会把 JS 重新放回页面加载的关键路径,ADR-062 的收益当场归零
  //    (真实 Chrome 逐帧实测确认:attr 要到 readyState=complete 才设上)。
  return (
    `/* 预生成滤镜 ${mode} @ ${intensity}%(ADR-062/063)。由 scripts/generate-filter-css.mjs 生成,勿手改。 */\n` +
    `html { filter: ${value} !important; }\n` +
    `html :modal,\n` +
    `html [popover]:popover-open,\n` +
    `html :fullscreen,\n` +
    `html ::backdrop { filter: ${value} !important; }\n`
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
