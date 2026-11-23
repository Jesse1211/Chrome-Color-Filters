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
 *   编辑的 pattern 不匹配当前页 / **锁定中**)。
 *
 * 把它们放在组件里意味着只能通过渲染结果间接断言,一个分支没被触发就漏掉。
 * 抽成纯函数后可逐条穷举,且「四种情况」在类型上是一个**封闭的联合**
 * (`PreviewBlockReason`)—— 漏一种会被 `tsc` 在 switch 的 never 分支抓住
 * (ADR-066)。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 🔴 这里**不**重新实现匹配,但确实自己算一次
 *
 * ADR-044 要求「UI 不自己算匹配」,真相来源是 `GET_TAB_STATE` ——
 * 那条约束针对的是**已持久化的规则**:`activeRuleIndex` /
 * `shadowedRuleIndexes` 一律取自 `TabState`,本模块原样采信,绝不另算。
 *
 * 但编辑视图里有一个 `TabState` **结构上无法回答**的问题:
 * 用户**此刻正在输入框里敲的那个 pattern**(还没保存、service worker
 * 根本不知道它存在)匹不匹配当前页?这个问题必须在本地回答,否则:
 *
 * - 「pattern 改到不再匹配的那一刻发 `PREVIEW_CLEAR`」无从判定;
 * - 「在 A 站编辑针对 B 站的规则 → 绝不能把 B 站滤镜套到 A 站」无从判定 ——
 *   而 DESIGN.md 明文说那是「可见的 bug,比没反馈更糟」。
 *
 * 故本模块对**草稿 pattern** 调用领域层的 `matchGlob`(ADR-005/006 的
 * 同一个实现,不是另写一份),对**已存在的规则**则一律采信 `TabState`。
 * 两者的分界线就是「这条规则存储里有没有」。
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

  // ── 2/3. 有没有 host 可比,比了匹不匹配 ──
  const matches = host !== null && matchGlob(draftPattern, host);
  if (!matches) {
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
  const blocker = findBlocker(draftPattern, { editingIndex, settings, host });

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

/**
 * 找出遮蔽本条的那条规则(ADR-008:**首个命中胜**,列表顺序即优先级)。
 *
 * 只看**排在本条之前**的规则 —— 后面的规则永远不可能抢先命中。
 * 新建(`editingIndex === null`)的规则会被追加到末尾,故**所有**既有
 * 规则都排在它前面。
 *
 * 返回 1 基序号(§5.6 的文案是「第 1 条规则」,给用户看的序号从 1 起)。
 */
function findBlocker(
  draftPattern: string,
  ctx: {
    readonly editingIndex: number | null;
    readonly settings: FilterSettings;
    readonly host: string | null;
  },
): { readonly ordinal: number; readonly pattern: string } | null {
  void draftPattern; // 本条是否匹配已由调用方判定,此处只找更靠前的命中者。
  const { editingIndex, settings, host } = ctx;
  if (host === null) return null;

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
 * **四种不发送 `PREVIEW_FILTER` 的情况**(§6 T6b gate 逐字,F9/F11/I2)。
 *
 * 这是一个**封闭联合** —— 新增一种阻塞原因必须同时更新本类型,
 * 而 `previewBlockHint` 的穷举 switch 会让漏掉的那一种在编译期暴露(ADR-066)。
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
