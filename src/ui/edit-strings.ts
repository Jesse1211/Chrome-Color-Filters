/**
 * 编辑视图文案(DESIGN.md §5.5 / §5.6 · ADR-047:**首版仅中文,不做 i18n**)。
 *
 * 与 `strings.ts` 同一理由:集中定义是为了让门禁可以**逐字断言**
 * (§6 T6b gate:「图标/文案/颜色与 §5.6 表格一致」),而不是为了日后换语言。
 *
 * 🔴 文案的权威是 **§5.5 / §5.6 与 ADR**(ADR-042),不是设计稿。
 */

/** §5.5 顶栏。 */
export const BACK_LABEL = '‹ 返回';
export const EDIT_TITLE = '编辑规则';
/** 新建时的标题 —— 设计稿第三张图用的就是「添加规则」。 */
export const CREATE_TITLE = '添加规则';

/**
 * §5.5 字段标签。
 *
 * 📌 原 `FILTER_LABEL = '滤镜'` 已随 ADR-075 删除 ——
 * 它是模式单选组的标签,而该控件已不存在(只剩一个模式时单选组无意义)。
 * 留一个没有控件的标签会在产物里留下一段无主文案。
 */
export const PATTERN_LABEL = '网址模式';
export const INTENSITY_LABEL = '强度';

/** §5.5 底栏。 */
export const SAVE_LABEL = '保存';
export const DELETE_LABEL = '删除';

/* ─────────────────────── §5.6 状态行(两个独立维度) ─────────────────────── */

/**
 * §5.6 表格的四行,**逐字誊写**。
 *
 * | 是否匹配 | 是否生效 | 图标 | 文案 | 色 |
 * |---|---|---|---|---|
 * | 是 | 是 | `●` | 匹配当前网站 **{host}** · 生效中 | ok |
 * | 是 | 否 | `◐` | 匹配当前网站,但**不生效** | warn |
 * | 否 | — | `○` | 不匹配当前网站 **{host}** | muted |
 * | 语法错误 | — | `✕` | 不能使用 `{char}` —— 只支持 `*` 和普通字符 | bad |
 */
export const STATUS_ICON_LIVE = '●';
export const STATUS_ICON_SHADOWED = '◐';
export const STATUS_ICON_NO_MATCH = '○';
export const STATUS_ICON_ERROR = '✕';

/** 「匹配当前网站 **{host}** · 生效中」—— host 单独加粗,故分三段。 */
export const STATUS_LIVE_PREFIX = '匹配当前网站 ';
export const STATUS_LIVE_SUFFIX = ' · 生效中';

/** 「匹配当前网站,但**不生效**」。 */
export const STATUS_SHADOWED_PREFIX = '匹配当前网站,但';
export const STATUS_SHADOWED_STRONG = '不生效';

/** 「不匹配当前网站 **{host}**」。 */
export const STATUS_NO_MATCH_PREFIX = '不匹配当前网站 ';

/** 「不能使用 `{char}` —— 只支持 `*` 和普通字符」。 */
export const STATUS_ERROR_PREFIX = '不能使用 ';
export const STATUS_ERROR_SUFFIX = ' —— 只支持 ';
export const STATUS_ERROR_TAIL = ' 和普通字符';

/**
 * 空 pattern 的状态文案(**F20**)。
 *
 * > §6 T6b gate:**空 pattern 视为无效,保存按钮禁用**
 * > (空串不含非法字符,但匹配不了任何东西,会产生一条静默失效的规则)。
 *
 * 刻意**不**复用「不能使用 `{char}`」—— 空串没有那个 `{char}`,
 * 硬塞一个空的反引号会渲染成「不能使用 `` ——」,既读不通又无从修正。
 */
export const STATUS_EMPTY_TEXT = '请输入网址模式,例如 *.weibo.*';

/** 超长 pattern(ADR-011:253 字符 = DNS 域名最大长度)。 */
export const STATUS_TOO_LONG_TEXT = '网址模式过长,最多 253 个字符';

/* ───────────────────── §5.6 被遮蔽时追加的解释框 ───────────────────── */

/**
 * 「第 1 条规则 *.weibo.* 排在前面,已先命中。」
 *
 * 序号与 pattern 要分别加粗 / 等宽(ADR-033),故分段。
 */
export const SHADOW_BOX_PREFIX = '第 ';
export const SHADOW_BOX_MIDDLE = ' 条规则 ';
export const SHADOW_BOX_SUFFIX = ' 排在前面,已先命中。';

/**
 * 一键修复(§5.6:**可点击,一键修复**)。
 *
 * 🔴 §6 T6b gate 的 **S13**:点它之后「不仅列表顺序改变,**当前页面渲染也
 * 立即变成该规则的滤镜**」—— 这个按钮的全部意义就是改变用户看到的东西。
 */
export const MOVE_TO_TOP_LABEL = '把这条移到最上面 ↑';

/* ──────────────────────── §5.7 实时预览提示行 ──────────────────────── */

/** §5.7:绿点脉冲 + 「拖动时当前页面实时预览」。 */
export const PREVIEW_LIVE_HINT = '拖动时当前页面实时预览';

/**
 * §5.7:**预览不可用时**提示行**置灰并改文案**(如「当前页面无法预览」),
 * **滑块仍可改值**,但不发送 `PREVIEW_FILTER`(ADR-049)。
 */
export const PREVIEW_UNAVAILABLE_HINT = '当前页面无法预览';

/** 强度百分比的无障碍名(滑块本身只有一个数字,需要可读的名字)。 */
export const INTENSITY_SLIDER_LABEL = '滤镜强度百分比';
