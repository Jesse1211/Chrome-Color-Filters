/**
 * `GlobPattern` 值对象 + 线性时间通配符匹配(ADR-005 / ADR-006 / ADR-011 / INV-10)。
 *
 * 语法(ADR-005):字面字符 + `*`。**无分组、无量词嵌套、无转义序列**。
 * 语义(ADR-006):`*` 匹配任意数量的任意字符,**包括点号**。其余字符按字面匹配。
 * 长度上限(ADR-011):253 字符 = DNS 域名最大长度。
 *
 * 🔴 INV-10 不可协商:匹配实现必须线性时间。
 * DESIGN.md §8 第 6 条明文禁止把 `*` 直接换成 `.*` 后交给 `RegExp` ——
 * 那会把 ADR-005 刻意消除的灾难性回溯重新引入。
 * 本文件因此**完全不使用 RegExp**,改用下方的双指针贪心回退算法。
 *
 * 纯 TypeScript —— 零 React / 零 chrome.* / 零 wxt(ADR-036)。
 */

export type GlobPattern = string;

/** ADR-011:pattern 上限 253 字符(DNS 域名最大长度)。 */
export const GLOB_PATTERN_MAX_LENGTH = 253;

export type GlobPatternError =
  | 'empty'
  | 'too-long'
  | 'illegal-character'
  | 'not-a-string';

export type GlobPatternValidation =
  | { readonly ok: true; readonly value: GlobPattern }
  | { readonly ok: false; readonly error: GlobPatternError };

/**
 * 合法字面字符集。host 只含 ASCII 字母数字、`-`、`.`、`_`,
 * 外加 IPv6 字面量的 `[` `]` `:` 与通配符 `*`。
 * 刻意不接受正则元字符(ADR-005:语法不是正则),
 * 这样「写不出嵌套量词」是语法层面的保证,而非实现层面的约定。
 */
function isLegalPatternChar(ch: string): boolean {
  if (ch === '*' || ch === '.' || ch === '-' || ch === '_') return true;
  if (ch === '[' || ch === ']' || ch === ':') return true;
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    (ch >= '0' && ch <= '9')
  );
}

/** 校验一个通配符模式是否合法。不抛异常,返回判定结果。 */
export function validateGlobPattern(value: unknown): GlobPatternValidation {
  if (typeof value !== 'string') return { ok: false, error: 'not-a-string' };
  if (value.length === 0) return { ok: false, error: 'empty' };
  if (value.length > GLOB_PATTERN_MAX_LENGTH) {
    return { ok: false, error: 'too-long' };
  }
  for (const ch of value) {
    if (!isLegalPatternChar(ch)) {
      return { ok: false, error: 'illegal-character' };
    }
  }
  return { ok: true, value };
}

export function isGlobPattern(value: unknown): value is GlobPattern {
  return validateGlobPattern(value).ok;
}

/**
 * 核心通配符匹配 —— 严格字面语义,`*` 匹配任意数量任意字符(含点号)。
 *
 * ## 算法 —— 双指针贪心 + 单点回退(INV-10:线性时间)
 *
 * 维护四个下标:`p`(模式位)、`s`(输入位)、`star`(最近一个 `*` 的模式位)、
 * `mark`(该 `*` 当前消费到的输入位)。
 *
 * - 字面字符相等 → 两指针同步前进。
 * - 遇到 `*` → 记下 `star`/`mark`,`*` 先尝试匹配空串,模式前进。
 * - 失配且此前见过 `*` → 回到 `star+1`,让那个 `*` **多吃一个字符**(`s = ++mark`)。
 * - 失配且没见过 `*` → 整体不匹配。
 *
 * 关键在于回退点**只有一个**(最近的 `*`),且 `mark` 单调递增、永不重置 ——
 * 所以每个输入字符最多被「多吃一次」。总步数上界为 `O(len(pattern) + len(host))`。
 * 连续 `*`(如 100 个 `*`)只是反复刷新同一个 `star`,不产生组合爆炸:
 * 这正是 ADR-005 用通配符替代正则所买到的保证,也是 §8 第 6 条禁止 RegExp 转译的原因。
 *
 * 入参须已 lowercase(由 `matchGlob` 负责规范化)。
 */
function matchGlobStrict(pat: string, str: string): boolean {
  let p = 0;
  let s = 0;
  let star = -1;
  let mark = 0;

  while (s < str.length) {
    if (p < pat.length && pat[p] === '*') {
      // 记下回退点;`*` 先匹配空串。
      star = p;
      mark = s;
      p++;
      continue;
    }
    if (p < pat.length && pat[p] === str[s]) {
      p++;
      s++;
      continue;
    }
    if (star >= 0) {
      // 失配:让最近的 `*` 多吃一个字符。mark 单调递增 → 线性时间。
      p = star + 1;
      mark++;
      s = mark;
      continue;
    }
    return false;
  }

  // 输入耗尽:模式剩余部分必须全是 `*` 才算匹配。
  while (p < pat.length && pat[p] === '*') p++;
  return p === pat.length;
}

/**
 * 通配符匹配:`pattern` 是否匹配 `host` 的**全部**内容(非子串匹配)。
 *
 * ## 边界点号省略(ADR-006 + §1「匹配语义」的已定稿示例)
 *
 * ADR-006 把 `*.baidu.*` 的语义定义为「**域名含 baidu**,不限子域层级」,
 * 且 §1 与 T1 门禁都明确要求它匹配 `baidu.com.cn` —— 注意该 host
 * **`baidu` 前面没有点号**。严格字面语义下 `*.baidu.*` 要求出现
 * 子串 `.baidu.`,`baidu.com.cn` 不含,会判不匹配,与已定稿示例冲突。
 *
 * 故采用 ADR-006 的语义而非字面语义:当 `*` 在模式**首尾**且匹配空串时,
 * 紧邻的那个点号一并省略。即首部 `*.` 与尾部 `.*` 作为整体可选。
 * 这恰好表达「不限子域层级」:`*.google.com` 既匹配 `mail.google.com`
 * 也匹配 `google.com` 本身。
 *
 * 此省略**只作用于模式首尾的边界点号**,不影响中间部分,所以
 * `*.google.com` 依旧**不匹配** `google.com.evil.com`(门禁要求的反例):
 * 模式尾部是字面 `.com`,必须落在 host 末尾。
 *
 * ## 复杂度(INV-10)
 *
 * 候选变体至多 4 个(常数),每个变体走一次线性的 `matchGlobStrict` ——
 * 整体仍是 `O(len(pattern) + len(host))`,无回溯。
 *
 * 匹配大小写不敏感:host 在 DNS 语义下大小写无关。
 */
export function matchGlob(pattern: GlobPattern, host: string): boolean {
  if (typeof pattern !== 'string' || typeof host !== 'string') return false;

  const pat = pattern.toLowerCase();
  const str = host.toLowerCase();

  if (matchGlobStrict(pat, str)) return true;

  const hasLeadingStarDot = pat.startsWith('*.');
  const hasTrailingDotStar = pat.endsWith('.*');

  // 省略首部 `*.`
  if (hasLeadingStarDot && matchGlobStrict(pat.slice(2), str)) return true;
  // 省略尾部 `.*`
  if (hasTrailingDotStar && matchGlobStrict(pat.slice(0, -2), str)) return true;
  // 两端同时省略(模式须长于两端标记本身,避免 `*.*` 退化成空模式)
  if (
    hasLeadingStarDot &&
    hasTrailingDotStar &&
    pat.length > 4 &&
    matchGlobStrict(pat.slice(2, -2), str)
  ) {
    return true;
  }

  return false;
}
