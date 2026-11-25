/**
 * 编辑视图文案(DESIGN.md §5.5 / §5.6 · ADR-047:**首版仅中文,不做 i18n**)。
 *
 * 与 `strings.ts` 同一理由:集中定义是为了让门禁可以**逐字断言**
 * (§6 T6b gate:「图标/文案/颜色与 §5.6 表格一致」),而不是为了日后换语言。
 *
 * 🔴 文案的权威是 **§5.5 / §5.6 与 ADR**(ADR-042),不是设计稿。
 */
import { type PreviewBlockReason } from './pattern-status.js';


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

/**
 * §5.7 / ADR-049:**按阻塞原因分别给文案**,并由此获得编译期穷举检查。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **本表的真正职责是「编译期安全网」,不只是文案。**
 *
 * 在此之前,`PreviewBlockReason` 的五个取值**没有任何地方 switch 过** ——
 * 唯一的用法是 `data-reason={reason}`(原样塞进 HTML 属性)。而当时的注释
 * 却声称「`previewBlockHint` 的穷举 switch 会让漏掉的那一种在编译期暴露」,
 * 那个符号**全仓库只存在于注释里**。于是「加了第六种原因却忘了写文案」
 * 会**静默通过编译与测试**,只在界面上露出一行泛化文案。
 *
 * 现在这张 `Record<PreviewBlockReason, string>` 是**全集映射**:
 * 联合类型多一个成员而本表没跟上 → `tsc --noEmit` 当场报 TS2741。
 * 已用一个临时成员实测验证过该报错确实会触发(见 PR 说明)。
 *
 * 📌 §5.7 原文写的是「改文案(**如**「当前页面无法预览」)」——
 *    「如」字表明那是**示例而非唯一文案**,故分原因细化不与规格冲突。
 *    `PREVIEW_UNAVAILABLE_HINT` 保留为兜底(见 `previewBlockHint`)。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
const PREVIEW_BLOCK_HINTS: Readonly<Record<PreviewBlockReason, string>> = {
  /** INV-8 / ADR-027:滤镜整体没在生效,预览无从谈起。 */
  'master-off': '滤镜已全局关闭,无法预览',
  /** ADR-013:chrome:// / 应用商店 / PDF / 新标签页。 */
  'not-injectable': '此页面不支持滤镜,无法预览',
  /** 正在编辑的 pattern 不匹配当前页 —— 最常见的一种。 */
  'pattern-mismatch': '当前页面不匹配此规则,无法预览',
  /** ADR-051:锁定期间不得发 PREVIEW_FILTER。 */
  locked: '锁定期间无法预览',
  /** 设置尚未读出来的骨架态 —— 短暂,但仍需有文案。 */
  skeleton: '正在载入设置…',
};

/**
 * 取某个阻塞原因对应的提示文案。
 *
 * `reason` 为 `null`(调用方还没判定出原因)时回退到泛化文案 ——
 * 这是**运行期**的缺省,与上表的**编译期**穷举是两回事:
 * 表缺一项编译不过,而 `null` 是一个合法的输入值。
 */
export function previewBlockHint(reason: PreviewBlockReason | null): string {
  return reason === null ? PREVIEW_UNAVAILABLE_HINT : PREVIEW_BLOCK_HINTS[reason];
}

/** 强度百分比的无障碍名(滑块本身只有一个数字,需要可读的名字)。 */
export const INTENSITY_SLIDER_LABEL = '滤镜强度百分比';
