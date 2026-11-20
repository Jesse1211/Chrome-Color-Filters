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
 * 两种偏差方向的后果完全不对称:
 *
 * - **子集(漏匹配)** → 某个本该套滤镜的站点**没有注册**,于是它的首帧未滤镜
 *   → **直接违反 INV-3**,正是本任务要根治的缺陷。
 * - **超集(多匹配)** → 某个**不该**套滤镜的站点也被注册,CSS 文件被注入
 *   → 该文件的内容是 `html[data-ccf-on] { filter: ... }`,而 `data-ccf-on`
 *     **只有 JS 路径在确认匹配后才会设置**。于是多注册一个站点的后果是:
 *     注入了一张**不选中任何东西**的样式表。页面观察不到任何变化(INV-1 保持)。
 *
 * 📌 **这正是 `filter.css` 的属性门控设计在新架构下付的第二次红利**:
 * 预生成的 CSS 文件带同一个 `html[data-ccf-on]` 门控(见 `filter-file-css.ts`),
 * 因此「注册得比需要的多」在语义上是**安全的**,而「注册得比需要的少」不是。
 * 于是转换器可以放心地把表达不出来的部分**放宽**,把精确判定留给 JS 路径 ——
 * 权威判定始终是 `resolveRule`(领域层,ADR-007/INV-6),注册只负责
 * 「让 CSS 文件在首帧之前到场」。
 *
 * ⚠️ 放宽**不是**把一切都注册成 `<all_urls>`。那样每个页面都会被注入一张
 * 无用样式表,是无谓的开销与指纹暴露面。放宽只在 glob 真的表达不出来时发生,
 * 且**保留尽可能多的字面约束**(见 `globToMatchPatterns` 的逐级降级)。
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
       * match pattern 表达力不足,已**放宽为超集**。
       * 多出来的站点会被注入一张不选中任何元素的样式表(见文件头注释)。
       */
      readonly kind: 'widened';
      readonly patterns: readonly string[];
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
 *    → 取模式中**最长的字面段**,若该段看起来像一个可用的域名后缀/标签,
 *      放宽为 「*://*.<段>/ *」 + 「*://<段>/ *」;否则放宽为 `ALL_URLS_PATTERN`。
 *    一律标记为 `widened`。
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
  // 「*://*.<段>/ *」 才是超集;否则唯一安全的超集是 `ALL_URLS_PATTERN`。
  const longest = longestLiteralSegment(pat);

  // 字面段能否作为 host 后缀?只有模式以该段结尾(允许其后仅有 `*`/`.`)时才行。
  const endsWithLiteral = patternEndsWithLiteral(pat, longest);

  if (longest.length > 0 && endsWithLiteral && longest.includes('.')) {
    // 形如 `news*.sina.com`:字面后缀 `.sina.com` 在 host 末尾。
    // `*://*.sina.com/*` 是超集(它还会匹配 `other.sina.com`,
    // 而 JS 路径会判定其不匹配 → 不设 data-ccf-on → 无可观察影响)。
    return { kind: 'widened', patterns: [`*://*.${longest}/*`] };
  }

  // 其余(尾部 `.*`、字面段不在末尾、字面段不含点号)—— 唯一安全的超集。
  return { kind: 'widened', patterns: [ALL_URLS_PATTERN] };
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
 * `invalid` 的 glob 被**跳过**(不注册),不污染结果。
 */
export function globsToMatchPatterns(
  patterns: readonly GlobPattern[],
): readonly string[] {
  const set = new Set<string>();
  for (const glob of patterns) {
    const conversion = globToMatchPatterns(glob);
    if (conversion.kind === 'invalid') continue;
    for (const p of conversion.patterns) set.add(p);
  }
  if (set.has(ALL_URLS_PATTERN)) return [ALL_URLS_PATTERN];
  return [...set].sort();
}
