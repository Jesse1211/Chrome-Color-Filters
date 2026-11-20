/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 通配符模式(ADR-005/006)→ Chrome match pattern 的转换(ADR-062/064)。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * `chrome.scripting.registerContentScripts()` 的 `matches` 只接受
 * **Chrome match pattern**,它的表达力比本项目的通配符语法(ADR-005/006)窄得多:
 *
 * | 我们的 glob(ADR-006:`*` 跨点号) | Chrome match pattern            |
 * |-----------------------------------|---------------------------------|
 * | `*` 可出现在任意位置、任意个数    | host 部分**只允许**整体 `*` 或前导 `*.` |
 * | `*.baidu.*` 合法                  | 尾部 `.*` **非法**(host 的 `*` 只能在最前) |
 * | `news*.sina.com` 合法             | 中缀 `*` **非法**               |
 *
 * 所以转换**不可能是等价的**。这是平台约束,不是实现选择。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## 转换方向必须是「**超集**」,不能是「子集」—— 这是本文件的核心不变式
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 两种偏差方向的后果都是真实的,但**不对称**:
 *
 * - **子集(漏匹配)** → 某个本该套滤镜的站点**没有注册**,于是它的首帧未滤镜
 *   → INV-3 在该站点上没有被声明式路径兑现。
 * - **超集(多匹配)** → 某个**不该**套滤镜的站点也被注册,CSS 文件被注入
 *   → 🔴 **该站点会得到一个已上色的首帧。**
 *
 * 🔴 **关于超集代价的一条重要更正(本轮修复):**
 * 本文件早先的注释声称预生成 CSS 的内容是 `html[data-ccf-on] { ... }`,
 * 因此多注册只是「注入一张不选中任何东西的样式表,无可观察影响」。
 * **这个前提是错的。** 预生成 CSS 是**裸 `html`**、**无条件生效**
 * —— 那是 ADR-063 与 DESIGN.md §6 第 9 条的明文规格,且本轮真实 Chrome
 * 实测证明门控版本会让 ADR-062 的收益归零(见 `filter-file-css.ts`
 * 「选择器是裸 `html`」一节)。于是多匹配进来的站点**确实会上色**,
 * 直到 JS 路径设上 `data-ccf-off` 才被压回 `none`。
 *
 * **所以放宽必须有界。** 转换器只在多匹配集合能被限定在**同一注册域之下**时
 * 放宽(`news*.sina.com` → `*://*.sina.com/*`);当 glob 的后缀集合无界
 * (`*.baidu.*`、`*weibo*`)时,唯一的 match pattern 超集是 `*://* / *`,
 * 即**全网上色** —— 那违反 DESIGN.md §1 匹配语义第 4 条
 * 「无规则命中 → 不套滤镜」与 INV-1,**绝不允许**。
 * 此时转换返回 `inexpressible`,该 glob **不注册**
 * (详尽论证与残留代价见 `MatchPatternConversion` 的 `inexpressible` 注释)。
 *
 * 权威的匹配判定始终是 `resolveRule`(领域层,ADR-007/INV-6);
 * 注册只负责「让 CSS 文件在首帧之前到场」。
 *
 * ⚠️ `ALL_URLS_PATTERN` 只在 glob **本身**就匹配任意 host 时使用(`*`、`*.*`)
 * —— 那种情况下给全网上色正是用户要的。它**绝不**作为转换失败的兜底。
 *
 * ## INV-10(线性时间)在本文件同样成立
 *
 * 本文件**不使用 RegExp**(DESIGN.md §8 第 6 条),只做一次线性扫描 +
 * 常数次字符串切片。
 *
 * 纯 TypeScript:零 `chrome.*`、零 React、零 wxt —— 故可在 Node 下完整单测。
 * (放在 `src/injection/` 而非 `src/domain/`:match pattern 是浏览器扩展平台的
 * 概念,不属于领域语言,放进 domain 会污染 ADR-036 的分层语义。)
 */

import { type GlobPattern, isGlobPattern } from '../domain/index.js';

/**
 * 匹配一切的 match pattern。
 *
 * 只在 glob 本身就是「匹配任意 host」时使用(如 `*`、`*.*`),
 * **不作为转换失败的兜底** —— 失败应当让该条规则不注册,而不是污染全网
 * (见 `globToMatchPatterns` 的返回约定)。
 */
export const ALL_URLS_PATTERN = '*://*/*';

/**
 * 转换结果。
 *
 * 显式三态而非 `string[] | null`:调用方对「精确」与「放宽」要做
 * 不同的记录(放宽意味着会有多余注入,值得在诊断里看得见),
 * 而「无法转换」必须与「放宽」区分开 —— 前者不注册,后者注册。
 */
export type MatchPatternConversion =
  | {
      /** glob 能被 match pattern **精确**表达。 */
      readonly kind: 'exact';
      readonly patterns: readonly string[];
    }
  | {
      /**
       * match pattern 表达力不足,已放宽为一个**有界**超集。
       *
       * 🔴 **这里的代价是真实的、可见的,不是「无可观察影响」。**
       * 预生成 CSS 是**裸 `html`**(ADR-063 / DESIGN.md §6 第 9 条的明文规格,
       * 见 `filter-file-css.ts`),它**无条件生效**。于是被超集多匹配进来的
       * 站点会得到一个**已上色的首帧**,直到 JS 路径判定本站不匹配并设上
       * `data-ccf-off` 才被压回 `none`。
       *
       * **放宽因此必须有界。** 本分支只在多匹配集合能被限定在
       * **同一个注册域之下**时使用(如 `news*.sina.com` → `*://*.sina.com/*`,
       * 多匹配的只有 `sina.com` 的其他子域)。用户为 `sina.com` 配了规则,
       * 同域其他子域短暂上色是一个可解释、可预期、范围可数的代价。
       *
       * ⚠️ 不存在有界超集时**不得**退化为 `ALL_URLS_PATTERN` —— 那会让
       * 「一条规则」变成「整个互联网的首帧都上色」。见 `inexpressible`。
       */
      readonly kind: 'widened';
      readonly patterns: readonly string[];
    }
  | {
      /**
       * glob 语法合法,但**不存在**任何有界的 match pattern 超集 ——
       * 故**不注册**(该 glob 走不到声明式首帧路径)。
       *
       * ───────────────────────────────────────────────────────────────────
       * ## 为什么不能退化成 `ALL_URLS_PATTERN`(本轮修复的真实缺陷)
       * ───────────────────────────────────────────────────────────────────
       *
       * Chrome match pattern 的 host 只能约束**后缀**(`*`、`*.<字面后缀>`、
       * `<字面>`)。而 `*.baidu.*` 的语义是「host **含** baidu」(ADR-006),
       * 其后缀集合是**无界**的(`.com` / `.cn` / `.com.cn` / …)。
       * 所以它唯一的 match pattern 超集就是 `*://* / *` —— 整个互联网。
       *
       * 把它与裸 `html` 的预生成 CSS 组合起来,后果是:
       * **用户配一条 `*.baidu.*`,全网每个站点的首帧都变灰。**
       * 这直接违反 DESIGN.md §1 匹配语义第 4 条
       * (**「无规则命中 → 不套滤镜」**,无条件)与 INV-1。
       *
       * ## 为什么「不注册」是两害中明确较轻的那个,而非对等取舍
       *
       * - INV-3 的原文把范围限定在**「在匹配到规则的页面上」** ——
       *   它对用户的 glob **匹配不到**的页面不作任何承诺。
       *   不注册只是让该 glob **没能享受到**声明式首帧保证(一个缺口),
       *   并未违反 INV-3 的字面承诺。
       * - 反之「无规则命中 → 不套滤镜」是**无条件**的规格条文,
       *   全网上色是对它的直接违反,且影响面无界。
       *
       * 一个有界的缺口 vs 一个无界的违规 —— 不对称,故可判定。
       *
       * ## 这个缺口的剩余代价(已在 README blindSpot 中申报)
       *
       * 受影响的 glob 形态:尾部 `.*`(`*.baidu.*`)、中缀 `*` 且无字面后缀
       * (`*weibo*`)。这类规则在**首次导航**到匹配站点时会有一个未滤镜的
       * 首帧;其后由 JS 路径上色,并由 ADR-060 的 `localStorage` 快路径
       * 在该 origin 的后续导航上兜住首帧。
       *
       * 🔴 **这是一个需要产品负责人裁决的残留缺口**(同 ADR-060 的性质):
       * 要彻底关闭它,需要在**产品层**收紧 ADR-006 的通配符语义
       * (例如把 `*` 限定为不跨点号,使其可被 match pattern 表达),
       * 那是 ADR 级别的变更,不在本任务的授权范围内。
       */
      readonly kind: 'inexpressible';
    }
  | {
      /** glob 非法(ADR-011 的长度/字符校验未通过)—— 不注册。 */
      readonly kind: 'invalid';
    };

/** host 部分只含字面字符(无 `*`)时为 true。 */
function hasNoWildcard(value: string): boolean {
  for (const ch of value) if (ch === '*') return false;
  return true;
}

/**
 * 把一个 glob 转成一组 Chrome match pattern。
 *
 * 逐级降级,**每一级都保证是超集**:
 *
 * 1. **匹配任意 host**(`*`、`**`、`*.*` 等只含 `*` 与 `.` 的模式)
 *    → `ALL_URLS_PATTERN`,精确。
 * 2. **纯字面**(无 `*`,如 `x.com`)→ `*://x.com/*`。
 *    ⚠️ 这里**必须同时**产出 `*://x.com/*` 一条即可:Chrome 的
 *    `*://x.com/*` 只匹配 host 恰为 `x.com`,与 `matchGlob('x.com', host)`
 *    的语义(仅 `x.com`,不含 `sub.x.com`)**完全一致** → 精确。
 * 3. **前导 `*.` + 字面尾**(如 `*.google.com`)→ `*://*.google.com/*`。
 *    Chrome 的 `*.google.com` 语义是「`google.com` **及其任意子域**」,
 *    与 `matchGlob` 对 `*.google.com` 的语义(ADR-006 的边界点号省略,
 *    见 `glob.ts`:既匹配 `mail.google.com` 也匹配 `google.com` 本身)
 *    **完全一致** → 精确。
 * 4. **其余一切**(尾部 `.*`、中缀 `*`、多个 `*`)
 *    → 取模式中**最长的字面段**。若该段含点号**且落在模式末尾**,
 *      它就是一个可用的 host 后缀 → 放宽为 「*://*.<段>/ *」,标记 `widened`
 *      (多匹配集合有界:限于该注册域的其他子域)。
 *    → 否则**不存在有界超集** → 返回 `inexpressible`,**不注册**。
 *      🔴 这里**不得**退化为 `ALL_URLS_PATTERN`:那会让一条规则把
 *      全网的首帧都上色(见文件头的更正一节)。
 *
 * 返回的 patterns 用 `*://` 而非 `<all_urls>`:`*://` 覆盖 http 与 https,
 * 这是本扩展实际要上色的范围;`<all_urls>` 还会带上 `file://`/`ftp://` 等,
 * 无谓扩大注入面。
 */
export function globToMatchPatterns(
  pattern: GlobPattern,
): MatchPatternConversion {
  if (!isGlobPattern(pattern)) return { kind: 'invalid' };

  const pat = pattern.toLowerCase();

  // ── 1. 只含 `*` 与 `.` → 匹配任意 host(与 matchGlob 一致,精确) ────
  let onlyStarsAndDots = true;
  for (const ch of pat) {
    if (ch !== '*' && ch !== '.') {
      onlyStarsAndDots = false;
      break;
    }
  }
  if (onlyStarsAndDots) {
    return { kind: 'exact', patterns: [ALL_URLS_PATTERN] };
  }

  // ── 2. 纯字面 host ────────────────────────────────────────────────────
  if (hasNoWildcard(pat)) {
    return { kind: 'exact', patterns: [`*://${pat}/*`] };
  }

  // ── 3. 前导 `*.` + 字面尾,且无其他 `*` ───────────────────────────────
  if (pat.startsWith('*.')) {
    const tail = pat.slice(2);
    if (tail.length > 0 && hasNoWildcard(tail)) {
      // Chrome 的 `*.tail` 已包含 `tail` 本身,与 glob.ts 的边界点号省略一致。
      return { kind: 'exact', patterns: [`*://*.${tail}/*`] };
    }
  }

  // ── 4. 放宽:保留最长字面段 ───────────────────────────────────────────
  //
  // 例:`*.baidu.*` → 最长字面段 `baidu`(两侧的 `.` 被剥掉)
  //     → `*://*.baidu/*` 显然匹配不到 `news.baidu.com`,因为 Chrome 的
  //       match pattern host 必须以该字面段**结尾**。
  //
  // 故这一级必须进一步分情况 —— 只有当字面段能落在 host **末尾**时,
  // 「*://*.<段>/ *」 才是**有界**超集;否则不存在任何有界超集。
  const longest = longestLiteralSegment(pat);

  // 字面段能否作为 host 后缀?只有模式以该段结尾(允许其后仅有 `*`/`.`)时才行。
  const endsWithLiteral = patternEndsWithLiteral(pat, longest);

  if (longest.length > 0 && endsWithLiteral && longest.includes('.')) {
    // 形如 `news*.sina.com`:字面后缀 `.sina.com` 在 host 末尾。
    // `*://*.sina.com/*` 是超集,且**有界** —— 多匹配进来的只有
    // `sina.com` 下的其他子域,与用户配置的站点同属一个注册域。
    // 这个代价(以及它为何可接受)见 `widened` 分支的类型注释。
    return { kind: 'widened', patterns: [`*://*.${longest}/*`] };
  }

  // 其余(尾部 `.*`、字面段不在末尾、字面段不含点号)——
  // **不存在有界超集**,故不注册。论证见 `inexpressible` 的类型注释。
  return { kind: 'inexpressible' };
}

/**
 * 取模式中最长的「字面段」—— 连续的非 `*` 字符,两端的 `.` 被剥掉。
 *
 * 线性扫描,无 RegExp(INV-10 / §8 第 6 条)。
 */
function longestLiteralSegment(pat: string): string {
  let best = '';
  let current = '';
  const flush = (): void => {
    let seg = current;
    while (seg.startsWith('.')) seg = seg.slice(1);
    while (seg.endsWith('.')) seg = seg.slice(0, -1);
    if (seg.length > best.length) best = seg;
    current = '';
  };
  for (const ch of pat) {
    if (ch === '*') flush();
    else current += ch;
  }
  flush();
  return best;
}

/**
 * 模式是否以给定字面段结尾(其后允许只有 `.`,不允许 `*`)。
 *
 * `*` 在末尾意味着 host 可以在该段之后继续延伸,此时该段**不是** host 后缀,
 * 「*://*.<段>/ *」 就不再是超集 —— 必须退回 `ALL_URLS_PATTERN`。
 */
function patternEndsWithLiteral(pat: string, literal: string): boolean {
  if (literal.length === 0) return false;
  let tail = pat;
  while (tail.endsWith('.')) tail = tail.slice(0, -1);
  return tail.endsWith(literal);
}

/**
 * 一组 glob 是否**本身就意为「匹配任意 host」** —— 即
 * `ALL_URLS_PATTERN` 是用户的**原意**,而不是转换失败的兜底。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## 这个谓词存在的唯一理由:守住 converter → reconcile 的接缝
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 本轮被发现的缺陷**不在转换器里,也不在 reconcile 里,而在两者的组合处**:
 * 转换器单测只验转换、reconcile 单测只用精确 glob,于是
 * 「一个表达不出来的 glob 被兜底成 `*://* / *`,再被 reconcile 配上一张
 * 裸 `html` 滤镜表」这个状态**从未被任何门禁驱动到**。
 *
 * 修完之后必须留下一个**机械判定**的断言把它钉死,否则下一次有人
 * 「顺手给降级加个兜底」时,同样的缺陷会以同样的方式重现。
 * 该断言就是 `assertNoUnintendedAllUrls()`,本谓词是它的判定依据。
 *
 * 判定方法与 `globToMatchPatterns` 第 1 级完全一致(只含 `*` 与 `.`),
 * 刻意不复用那个函数的返回值:这里要回答的是「用户的原意是不是全网」,
 * 与「转换结果是什么」是两个不同的问题,混在一起就失去了交叉校验的意义。
 */
export function isIntentionallyAllUrls(
  patterns: readonly GlobPattern[],
): boolean {
  for (const glob of patterns) {
    if (!isGlobPattern(glob)) continue;
    let onlyStarsAndDots = true;
    for (const ch of glob) {
      if (ch !== '*' && ch !== '.') {
        onlyStarsAndDots = false;
        break;
      }
    }
    if (onlyStarsAndDots) return true;
  }
  return false;
}

/**
 * 把一组 glob 转成**去重且排序**的 match pattern 列表。
 *
 * - **排序**:`reconcile()` 的 diff 要靠值相等判断「这条注册变了吗」
 *   (见 `reconcile.ts`)。若顺序随规则列表的顺序浮动,
 *   同一组站点会因为用户重排而被误判为「变了」,进而无谓地
 *   unregister + register 一遍。排序把顺序这个自由度消掉。
 * - **去重**:两条规则的 glob 可能转出同一个 match pattern。
 * - **`ALL_URLS_PATTERN` 吸收**:一旦出现它,其余 pattern 全是它的子集,
 *   留着只是让 Chrome 多做无用的匹配求值(ADR-064 的理由)。
 *
 * **`invalid` 与 `inexpressible` 的 glob 被跳过**(不注册),不污染结果:
 * - `invalid` —— 语法不合法,本就没有要注册的东西;
 * - `inexpressible` —— 🔴 **不存在有界超集。跳过是刻意的**,
 *   因为唯一的替代是 `*://* / *` + 裸 `html` 滤镜表 = 全网首帧上色
 *   (见 `MatchPatternConversion.inexpressible` 的论证)。
 *
 * ⚠️ 若一组 glob **全部**被跳过,本函数返回空数组,
 * `desiredRegistrations()` 据此**不产出该组的注册**(见 `reconcile.ts`)。
 */

export function globsToMatchPatterns(
  patterns: readonly GlobPattern[],
): readonly string[] {
  const set = new Set<string>();
  for (const glob of patterns) {
    const conversion = globToMatchPatterns(glob);
    // 两种「无可注册内容」的结局都跳过。注意 `inexpressible` 没有
    // `patterns` 字段 —— 这是刻意的类型设计:它在类型层面就**不可能**
    // 贡献出一个 pattern,于是「不小心把它兜底成全网」写不出来。
    if (conversion.kind === 'invalid') continue;
    if (conversion.kind === 'inexpressible') continue;
    for (const p of conversion.patterns) set.add(p);
  }
  if (set.has(ALL_URLS_PATTERN)) return [ALL_URLS_PATTERN];
  return [...set].sort();
}
