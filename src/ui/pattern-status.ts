/**
 * 编辑视图的**两维状态**与**预览资格**判定(DESIGN.md §5.6 / §5.7 · ADR-049)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 为什么这是一个独立的**纯函数**模块
 *
 * §6 T6b gate 里最硬的两组条款都是**判定**而不是渲染:
 *
 * - §5.6 的「两个独立维度」四种情况(匹配 × 生效,外加语法错误);
 * - **四种不发送 `PREVIEW_FILTER` 的情况**(主开关 OFF / 当前页不可注入 /
 *   编辑的 pattern 不匹配当前页 / **锁定中**)—— 这是 gate 的四条;
 *   实现上另有一个骨架态 `'skeleton'`,故 `PreviewBlockReason` 共**五**个成员。
 *
 * 把它们放在组件里意味着只能通过渲染结果间接断言,一个分支没被触发就漏掉。
 * 抽成纯函数后可**逐条穷举地单测** —— 这是本模块独立存在的实际收益。
 *
 * ⚠️ 原文此处还写着「漏一种会被 `tsc` 在 switch 的 never 分支抓住(ADR-066)」,
 *    那是**不成立的**:仓库里没有任何地方 switch 过 `PreviewBlockReason`。
 *    详见该类型自己的文档注释。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 🔴 真相来源:`TabState` 优先,本地判定只在它无从回答时兜底
 *
 * DESIGN.md:1016(ADR-044 契约块)对本模块是**点名**的约束:
 *
 * > `activeRuleIndex` 与 `shadowedRuleIndexes` 一起支撑 T6a 的被遮蔽淡化
 * > (ADR-032)与 **T6b 的两维状态行(§5.6)**,**两个视图都不自己算匹配**
 * > —— 真相来源唯一
 *
 * 故**只要 `TabState` 能回答,就必须由它回答**:草稿 pattern 与存储里的
 * `rules[editingIndex].pattern` **相同**时(刚进编辑视图,或只改了 mode /
 * 强度而没碰 pattern),这条规则对当前页的「匹配 / 生效 / 被遮蔽」
 * service worker 的 `resolveRule` 已经算过了,答案就在 `activeRuleIndex` /
 * `shadowedRuleIndexes` 里 —— 本模块**原样采信,不另算**。
 *
 * 唯一的例外是 `TabState` **结构上无法回答**的那一问:用户此刻正在输入框里
 * 敲的、**与存储不同**的那个 pattern(还没保存,service worker 根本不知道它
 * 存在)匹不匹配当前页?`activeRuleIndex` 是**存储索引**,它描述的是旧
 * pattern,对草稿一言不发。而这一问必须有答案,否则:
 *
 * - 「pattern 改到不再匹配的那一刻发 `PREVIEW_CLEAR`」无从判定;
 * - 「在 A 站编辑针对 B 站的规则 → 绝不能把 B 站滤镜套到 A 站」无从判定 ——
 *   而 DESIGN.md 明文说那是「可见的 bug,比没反馈更糟」。
 *
 * 所以分界线是**草稿脏不脏**:
 *
 * | 情形 | 两维状态的来源 |
 * |---|---|
 * | 编辑既有规则且 pattern 未改动(草稿干净) | **`TabState`**(ADR-044) |
 * | 新建规则 / pattern 已改动(草稿脏) | 本地 `matchGlob`(TabState 无从回答) |
 *
 * 脏草稿的本地判定调用的是**领域层同一个 `matchGlob`**(ADR-005/006),
 * 不是另写一份匹配器;`findBlockerForDraft` 复用 ADR-008 的「首个命中胜」。
 *
 * 纯 TypeScript + 领域层 —— 零 React、零 `chrome.*`。
 */

import { type FilterSettings, matchGlob, validateGlobPattern } from '../domain/index.js';
import { type TabState } from './tab-state.js';

/* ────────────────────────────── §5.6 状态行 ────────────────────────────── */

/**
 * §5.6 表格的四种情况 + 两种 pattern 无效的细分。
 *
 * `empty` / `too-long` 都落在表格第四行「语法错误」那一类(图标 `✕`、bad 色、
 * 保存禁用),只是**文案**不同 —— 空串没有「那个非法字符」可指(F20),
 * 超长也不是字符非法。拆开是为了让文案可以说实话。
 */
export type PatternStatusKind =
  /** 匹配且生效 —— `●` ok 色。 */
  | 'live'
  /** 匹配但被遮蔽(匹配、不生效)—— `◐` warn 色。 */
  | 'shadowed'
  /** 不匹配当前网站 —— `○` muted 色。 */
  | 'no-match'
  /** 含非法字符 —— `✕` bad 色。 */
  | 'illegal-character'
  /** 空 pattern(F20)—— `✕` bad 色。 */
  | 'empty'
  /** 超过 253 字符(ADR-011)—— `✕` bad 色。 */
  | 'too-long';

/** §5.1 的语义色 token 名 —— 组件据此选 class,不自己决定颜色。 */
export type StatusTone = 'ok' | 'warn' | 'muted' | 'bad';

export interface PatternStatus {
  readonly kind: PatternStatusKind;
  readonly tone: StatusTone;
  /** pattern 是否可保存(§5.5:语法错误时保存按钮禁用;F20:空串同样禁用)。 */
  readonly valid: boolean;
  /** 当前页 host;不可注入 / 未知时为 null。 */
  readonly host: string | null;
  /** 草稿 pattern 是否匹配当前页 —— 预览资格的一个输入(ADR-049)。 */
  readonly matchesCurrentPage: boolean;
  /**
   * 第一个非法字符。仅 `illegal-character` 时有值 ——
   * §5.6 的文案要指出**是哪个字符**,不能只说「有非法字符」。
   */
  readonly illegalChar: string | null;
  /**
   * 遮蔽本条的那条规则(1 基序号 + pattern),供 §5.6 的琥珀解释框渲染。
   * 仅 `shadowed` 时有值。
   */
  readonly blockedBy: { readonly ordinal: number; readonly pattern: string } | null;
}

export interface PatternStatusInput {
  /** 输入框里**此刻**的值(草稿,可能还没保存)。 */
  readonly draftPattern: string;
  /**
   * 正在编辑的规则在 `settings.rules` 中的索引;**新建时为 null**。
   *
   * 它决定「谁算遮蔽者」:遮蔽只能来自**排在本条前面**的规则。
   * 新建的规则会被追加到末尾,故一切匹配当前页的既有规则都遮蔽它。
   */
  readonly editingIndex: number | null;
  readonly settings: FilterSettings;
  /** `null` = 尚未收到 `GET_TAB_STATE` 响应(骨架态,ADR-044)。 */
  readonly tabState: TabState | null;
}

/**
 * 判定 §5.6 的状态行。
 *
 * 判定顺序**不可换**:
 * 1. pattern 本身无效 → 语法错误类(表格第四行),此时谈「匹配」毫无意义;
 * 2. 当前页不可注入 / host 未知 → 按「不匹配」渲染(没有 host 可比)——
 *    §5.4 另有琥珀条说明原因,状态行不重复报警;
 * 3. 不匹配 → `no-match`;
 * 4. 匹配 → 再分「生效」与「被遮蔽」。
 */
export function computePatternStatus(input: PatternStatusInput): PatternStatus {
  const { draftPattern, editingIndex, settings, tabState } = input;
  const host = tabState?.injectable === true ? tabState.host : null;

  // ── 1. pattern 本身的合法性(§5.5:语法错误 → 描红 + 保存禁用) ──
  const validation = validateGlobPattern(draftPattern);
  if (!validation.ok) {
    const kind: PatternStatusKind =
      validation.error === 'empty'
        ? 'empty'
        : validation.error === 'too-long'
          ? 'too-long'
          : 'illegal-character';
    return {
      kind,
      tone: 'bad',
      valid: false,
      host,
      matchesCurrentPage: false,
      illegalChar: kind === 'illegal-character' ? firstIllegalChar(draftPattern) : null,
      blockedBy: null,
    };
  }

  // ── 2/3. 匹不匹配 ──
  //
  // 🔴 ADR-044:草稿干净(= 存储里就是这个 pattern)时,匹配与否由 `TabState`
  //    回答 —— 本视图不自己算。只有脏草稿才落到本地 `matchGlob`。
  const resolution = resolveDimensions({ draftPattern, editingIndex, settings, tabState, host });

  if (!resolution.matches) {
    return {
      kind: 'no-match',
      tone: 'muted',
      valid: true,
      host,
      matchesCurrentPage: false,
      illegalChar: null,
      blockedBy: null,
    };
  }

  // ── 4. 匹配了,再看生不生效 ──
  //
  // 🔴 「生效」是两维中的第二维,它不只取决于匹配:
  //    主开关 OFF 时没有任何规则在生效(INV-8),此时显示「生效中」是谎话。
  //    §5.6 的第二行(匹配但不生效)正是为这一类情形准备的。
  //
  //    遮蔽者同样走 `resolveDimensions`:草稿干净时取自 `shadowedRuleIndexes`
  //    (ADR-044),脏草稿才本地扫一遍(ADR-008 首个命中胜)。
  const blocker = resolution.blockedBy;

  if (!settings.masterEnabled || blocker !== null) {
    return {
      kind: 'shadowed',
      tone: 'warn',
      valid: true,
      host,
      matchesCurrentPage: true,
      illegalChar: null,
      blockedBy: blocker,
    };
  }

  return {
    kind: 'live',
    tone: 'ok',
    valid: true,
    host,
    matchesCurrentPage: true,
    illegalChar: null,
    blockedBy: null,
  };
}

/** 一条规则的遮蔽者 —— 1 基序号(§5.6 文案是「第 1 条规则」)+ 它的 pattern。 */
type Blocker = { readonly ordinal: number; readonly pattern: string } | null;

/**
 * §5.6 两维的**唯一出口**:先问 `TabState`,问不出来才本地算。
 *
 * 🔴 ADR-044(DESIGN.md:1016)点名要求 T6b 的两维状态行**不自己算匹配**。
 * 本函数就是那条约束的落点:
 *
 * - **草稿干净**(`editingIndex !== null` 且 `draftPattern` 与
 *   `rules[editingIndex].pattern` 全等)→ 这条规则就是存储里那条,
 *   service worker 已经为它算过 `resolveRule`,答案在 `activeRuleIndex` /
 *   `shadowedRuleIndexes` 中,**原样采信**;
 * - **草稿脏**(新建,或 pattern 被改过)→ `TabState` 的索引描述的是**旧**
 *   pattern,对草稿无从回答,只能本地判定(见模块头注的表格)。
 *
 * 「生效」的第二维里 `masterEnabled` 的否决由调用方统一加(INV-8),
 * 两条路径都不在这里重复判。
 *
 * ## 🔴 主开关 OFF 时 `TabState` 对**第一维**也无从回答
 *
 * `compute-tab-state.ts` 明文规定(并有测试锁定)主开关 OFF 时
 * `activeRuleIndex` 与 `shadowedRuleIndexes` **同时归零态** ——
 * 理由是「被遮蔽」在无人生效时是谎话。那两个字段因此**只编码第二维**;
 * 主开关 OFF 时它们对「这条 pattern 匹不匹配当前页」保持沉默。
 *
 * 而 §5.6 的第一维是**页面与 pattern 的关系**,与主开关无关 ——
 * 表格第二行(`◐` 匹配但不生效)正是「匹配 ✓ / 生效 ✗」这一格。
 * 若主开关 OFF 时照搬归零的字段,状态行会退化成 `○`「不匹配当前网站」,
 * 那是**错的**:pattern 明明匹配,不生效的原因是主开关而非不匹配。
 *
 * 故主开关 OFF 时走本地 `matchGlob` 取第一维 —— 这不是绕开 ADR-044,
 * 而是 `TabState` 在该状态下按设计不携带这一维的信息。
 */
function resolveDimensions(ctx: {
  readonly draftPattern: string;
  readonly editingIndex: number | null;
  readonly settings: FilterSettings;
  readonly tabState: TabState | null;
  readonly host: string | null;
}): { readonly matches: boolean; readonly blockedBy: Blocker } {
  const { draftPattern, editingIndex, settings, tabState, host } = ctx;
  if (host === null) return { matches: false, blockedBy: null };

  const stored = editingIndex === null ? undefined : settings.rules[editingIndex];
  const draftIsClean = stored !== undefined && stored.pattern === draftPattern;

  if (draftIsClean && tabState !== null && editingIndex !== null && settings.masterEnabled) {
    return resolveFromTabState(editingIndex, settings, tabState);
  }

  // 脏草稿 —— TabState 无从回答(见模块头注)。
  return {
    matches: matchGlob(draftPattern, host),
    blockedBy: findBlockerForDraft(editingIndex, settings, host),
  };
}

/**
 * 从 `TabState` 的两个契约字段读出两维(ADR-044 的真相来源)。
 *
 * - `activeRuleIndex === editingIndex` → 命中且**它就是生效的那条**;
 * - `editingIndex ∈ shadowedRuleIndexes` → 命中但**被遮蔽**;
 *   遮蔽者就是 `activeRuleIndex` 指的那条(ADR-008 首个命中胜 —— 生效的
 *   那条必然排在所有被遮蔽者之前),§5.6 的琥珀框照它渲染;
 * - 两者都不是 → `TabState` 说这条规则**没命中**当前页。
 */
function resolveFromTabState(
  editingIndex: number,
  settings: FilterSettings,
  tabState: TabState,
): { readonly matches: boolean; readonly blockedBy: Blocker } {
  if (tabState.activeRuleIndex === editingIndex) {
    return { matches: true, blockedBy: null };
  }

  if (tabState.shadowedRuleIndexes.includes(editingIndex)) {
    const activeIndex = tabState.activeRuleIndex;
    const blocker =
      activeIndex !== null && settings.rules[activeIndex] !== undefined
        ? { ordinal: activeIndex + 1, pattern: settings.rules[activeIndex].pattern }
        : null;
    return { matches: true, blockedBy: blocker };
  }

  return { matches: false, blockedBy: null };
}

/**
 * 脏草稿的遮蔽者(ADR-008:**首个命中胜**,列表顺序即优先级)。
 *
 * 只看**排在本条之前**的规则 —— 后面的规则永远不可能抢先命中。
 * 新建(`editingIndex === null`)的规则会被追加到末尾,故**所有**既有
 * 规则都排在它前面。
 *
 * ⚠️ 仅用于 `TabState` 无从回答的脏草稿;干净草稿走 `resolveFromTabState`。
 */
function findBlockerForDraft(
  editingIndex: number | null,
  settings: FilterSettings,
  host: string,
): Blocker {
  const limit = editingIndex === null ? settings.rules.length : editingIndex;
  for (let i = 0; i < limit; i++) {
    const rule = settings.rules[i];
    if (rule === undefined) continue;
    if (matchGlob(rule.pattern, host)) {
      return { ordinal: i + 1, pattern: rule.pattern };
    }
  }
  return null;
}

/**
 * 第一个非法字符 —— §5.6 要求文案指出**是哪个**。
 *
 * 复用领域层的 `validateGlobPattern` 做「是否合法」的判定,
 * 这里只负责**定位**:逐字符试,第一个让校验失败的就是它。
 * 这样合法字符集**只定义在领域层一处**(ADR-005),不会漂移。
 */
export function firstIllegalChar(pattern: string): string | null {
  for (const ch of pattern) {
    if (!validateGlobPattern(ch).ok) return ch;
  }
  return null;
}

/* ──────────────────────── §5.7 / ADR-049 预览资格 ──────────────────────── */

/**
 * 不发送 `PREVIEW_FILTER` 的原因。
 *
 * §6 T6b gate 逐字写的是**四种**(F9/F11/I2:锁定中 / 主开关 OFF /
 * 当前页不可注入 / pattern 不匹配当前页);本联合比它多一个
 * `'skeleton'`,共**五**个成员 —— 那是「还没收到 `GET_TAB_STATE`」的实现态,
 * `computePreviewEligibility` 有**两条**分支返回它(`tabState === null`
 * 与 `tabState.tabId === null`)。它同样面向用户(驱动 `data-reason`
 * 与置灰的提示行),不是记账值。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ⚠️ **原注释声称「`previewBlockHint` 的穷举 switch 会让漏掉的那一种在
 *    编译期暴露(ADR-066)」—— 那个安全网并不存在,已据实改写。**
 *
 * `previewBlockHint` 这个符号全仓**只出现在那条注释里**,没有实现;
 * 且**没有任何地方 switch 过本联合** —— `RuleEditView` 的两个 switch
 * 都是对 `PatternStatus['kind']` 的,本联合的值只被 `PreviewHint`
 * 原样塞进 DOM 属性(`data-reason={reason ?? ''}`)。
 *
 * 于是**新增第六种原因不会产生任何编译错误**:它会静默地成为一个
 * 没有文案、只在 `data-reason` 里露出字符串的状态。写明这一点,
 * 是为了下一个加原因的人不要以为 `tsc` 替他兜着。
 * (要真拿到那层保护,得给本联合写一个带 `never` 兜底的穷举函数并让
 *  UI 走它 —— 那是行为改动,本次只校正注释。)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
export type PreviewBlockReason =
  /** 主开关 OFF(INV-8 / ADR-027:滤镜根本没在生效)。 */
  | 'master-off'
  /** 当前页不可注入(ADR-013:`chrome://` / 应用商店 / PDF / 新标签页)。 */
  | 'not-injectable'
  /**
   * 正在编辑的 pattern 不匹配当前页。
   *
   * 🔴 DESIGN.md:「绝不能把 B 站滤镜套到 A 站,那是可见的 bug
   * 比没反馈更糟」。这条也是 OQ-08 记在案的「无跨页预览」。
   */
  | 'pattern-mismatch'
  /**
   * 🔒 锁定中(ADR-051 —— gate 称之为「第四种不发送条件」)。
   *
   * > 预览会改变页面渲染,属于设置变更的即时效果。
   */
  | 'locked'
  /** 骨架态:还没收到 `GET_TAB_STATE`,`tabId` 未知,连不上端口。 */
  | 'skeleton';

export interface PreviewEligibilityInput {
  readonly settings: FilterSettings;
  readonly tabState: TabState | null;
  readonly locked: boolean;
  /** `computePatternStatus(...).matchesCurrentPage`。 */
  readonly matchesCurrentPage: boolean;
}

export type PreviewEligibility =
  | { readonly available: true; readonly tabId: number }
  | { readonly available: false; readonly reason: PreviewBlockReason };

/**
 * 预览是否可用(ADR-049)。
 *
 * 判定顺序按「用户最该知道的原因」排:锁定 > 主开关 > 页面不可注入 > 不匹配。
 * 锁定排第一是因为它冻结一切(ADR-051),其余原因在锁定期间都是次要信息。
 *
 * 返回 `tabId` 而不是 boolean:端口必须连到**`GET_TAB_STATE` 给出的那个 tab**
 * (ADR-049 明文「popup 不得自己调 `chrome.tabs.query`」)。把 tabId 放进
 * 「可用」这一支里,调用方就**拿不到一个没有 tabId 的可用判定** ——
 * 自己去查 tab 这条路在类型上就不存在。
 */
export function computePreviewEligibility(
  input: PreviewEligibilityInput,
): PreviewEligibility {
  const { settings, tabState, locked, matchesCurrentPage } = input;

  if (locked) return { available: false, reason: 'locked' };
  if (!settings.masterEnabled) return { available: false, reason: 'master-off' };
  if (tabState === null) return { available: false, reason: 'skeleton' };
  if (!tabState.injectable) return { available: false, reason: 'not-injectable' };
  if (!matchesCurrentPage) return { available: false, reason: 'pattern-mismatch' };
  // 可注入却没有 tabId 在 ADR-044 的契约下不该发生;真发生了就当不可用,
  // 绝不退回 `chrome.tabs.query`(ADR-049)。
  if (tabState.tabId === null) return { available: false, reason: 'skeleton' };

  return { available: true, tabId: tabState.tabId };
}
