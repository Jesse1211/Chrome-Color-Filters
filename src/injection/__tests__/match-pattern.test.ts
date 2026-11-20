/**
 * glob → Chrome match pattern 转换的门禁(ADR-062/064)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **本文件最重要的断言是「超集」那一条,不是逐个样例。**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Chrome match pattern 的表达力窄于本项目的 glob(ADR-005/006),转换
 * **不可能等价**。两个偏差方向的后果都是真实的,但不对称:
 *
 * - 漏匹配 → 该站首帧未滤镜 → INV-3 在该站未被声明式路径兑现;
 * - 多匹配 → 🔴 **该站会得到一个已上色的首帧**。预生成 CSS 是**裸 `html`**、
 *   无条件生效(ADR-063 / DESIGN.md §6 第 9 条),所以多匹配**不是**
 *   「注入一张不选中任何元素的样式表」。本文件早先的注释如此声称,
 *   **那个前提是错的,本轮已更正**(见 `match-pattern.ts` 文件头)。
 *
 * ## 于是超集不变式的**适用范围**必须被精确声明
 *
 * 超集只在**放宽有界**时成立。当 glob 的后缀集合无界(`*.baidu.*`、
 * `*weibo*`)时,唯一的 match pattern 超集是全网 —— 与裸 `html` 组合
 * 就是「一条规则给整个互联网上色」,违反 DESIGN.md §1 匹配语义第 4 条
 * (「无规则命中 → 不套滤镜」)与 INV-1。那种情况返回 `inexpressible`,
 * **不注册**。
 *
 * 故本文件钉死**两条**性质,而不是一条:
 *
 * 1. **`exact` / `widened`(即真的会注册的那些)恒为超集** ——
 *    跨 host 全集的性质测试,抓未来「优化」转换器时引入的漏匹配;
 * 2. **`inexpressible` 恒不产出任何 pattern** —— 抓「顺手加个全网兜底」
 *    这个本轮刚修掉的缺陷的回归。
 */
import { describe, expect, it } from 'vitest';
import { matchGlob } from '../../domain/index.js';
import {
  ALL_URLS_PATTERN,
  globToMatchPatterns,
  globsToMatchPatterns,
  isIntentionallyAllUrls,
} from '../match-pattern.js';

/**
 * Chrome match pattern 的 host 匹配语义(只实现 `*://<host>/*` 这一形状,
 * 本转换器只产出这一形状)。
 *
 * 规则(Chrome 官方):
 * - host 为 `*` → 匹配任意 host;
 * - host 以 `*.` 开头 → 匹配该后缀**及后缀本身**;
 * - 否则 → 必须完全相等。
 */
function matchPatternMatchesHost(pattern: string, host: string): boolean {
  const withoutScheme = pattern.slice(pattern.indexOf('://') + 3);
  const hostPart = withoutScheme.slice(0, withoutScheme.indexOf('/'));
  if (hostPart === '*') return true;
  if (hostPart.startsWith('*.')) {
    const suffix = hostPart.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return host === hostPart;
}

function anyPatternMatches(
  patterns: readonly string[],
  host: string,
): boolean {
  return patterns.some((p) => matchPatternMatchesHost(p, host));
}

// 覆盖面:既有门禁明确点名的样例,也有刻意构造的反例。
const GLOBS = [
  '*',
  '*.*',
  'x.com',
  'news.ycombinator.com',
  '*.google.com',
  '*.baidu.*',
  '*.sina.com.cn',
  'news*.sina.com',
  '*weibo*',
  'a.b.c.d.com',
  '*.co.uk',
];

const HOSTS = [
  'x.com',
  'sub.x.com',
  'notx.com',
  'google.com',
  'mail.google.com',
  'google.com.evil.com',
  'news.baidu.com',
  'a.b.c.baidu.com',
  'baidu.com.cn',
  'baidu.com',
  'news.sina.com',
  'news1.sina.com',
  'other.sina.com',
  'weibo.com',
  'www.weibo.com',
  'example.co.uk',
  'news.ycombinator.com',
  'wikipedia.org',
  'github.com',
  'a.b.c.d.com',
];

/** 组合式构造的 host 全集,供两条性质测试共用。 */
function generatedHosts(): readonly string[] {
  // {'', 'www.', 'news.', 'a.b.'} × {baidu, google, sina, weibo, x}
  //                               × {.com, .com.cn, .co.uk, .org}
  const generated: string[] = [];
  for (const prefix of ['', 'www.', 'news.', 'a.b.']) {
    for (const label of ['baidu', 'google', 'sina', 'weibo', 'x']) {
      for (const tld of ['.com', '.com.cn', '.co.uk', '.org']) {
        generated.push(`${prefix}${label}${tld}`);
      }
    }
  }
  return generated;
}

describe('globToMatchPatterns · 🔴 超集不变式(范围限定于会注册的那些)', () => {
  it.each(GLOBS)(
    'glob %s:若它会注册,则凡 matchGlob 命中的 host,match pattern 必须也命中',
    (glob) => {
      const conversion = globToMatchPatterns(glob);
      expect(conversion.kind).not.toBe('invalid');

      // 🔴 `inexpressible` 刻意**不注册**,故不适用超集不变式。
      //    它由下一个 describe 单独钉死(恒不产出 pattern)。
      if (conversion.kind === 'inexpressible') return;
      const patterns = conversion.patterns;

      const missed: string[] = [];
      for (const host of HOSTS) {
        if (!matchGlob(glob, host)) continue;
        if (!anyPatternMatches(patterns, host)) missed.push(host);
      }
      // 会注册却漏匹配 = 该站首帧未滤镜。一个都不许有。
      expect(
        missed,
        `glob "${glob}" → ${JSON.stringify(patterns)} 漏掉了这些 host`,
      ).toEqual([]);
    },
  );

  it('🔴 对一个随机生成的 host 全集同样成立(不只是手挑的样例)', () => {
    for (const glob of GLOBS) {
      const conversion = globToMatchPatterns(glob);
      if (conversion.kind === 'invalid') continue;
      if (conversion.kind === 'inexpressible') continue;
      const patterns = conversion.patterns;
      for (const host of generatedHosts()) {
        if (!matchGlob(glob, host)) continue;
        expect(
          anyPatternMatches(patterns, host),
          `glob "${glob}" → ${JSON.stringify(patterns)} 漏掉 host "${host}"`,
        ).toBe(true);
      }
    }
  });
});

describe('globToMatchPatterns · 🔴 放宽必须有界 —— 不得兜底成全网', () => {
  it.each(GLOBS)(
    'glob %s:只有「本身匹配任意 host」的 glob 才允许产出全网 pattern',
    (glob) => {
      const conversion = globToMatchPatterns(glob);
      if (conversion.kind === 'invalid') return;
      if (conversion.kind === 'inexpressible') return;
      if (!conversion.patterns.includes(ALL_URLS_PATTERN)) return;
      // 产出了全网 pattern → 必须是用户的原意(`*` / `*.*` / `**`),
      // 而**不是**转换失败的兜底。
      expect(
        isIntentionallyAllUrls([glob]),
        `glob "${glob}" 产出了全网 pattern,但它本身并不匹配任意 host —— ` +
          '这会让一条规则给全网首帧上色(INV-1 / DESIGN.md §1 第 4 条)',
      ).toBe(true);
    },
  );

  it('🔴 ADR-006 的旗舰例子 *.baidu.* 绝不产出全网 pattern', () => {
    // DESIGN.md:61-64 与 ADR-006 都用 `*.baidu.*` 当标准示例,
    // 所以这不是一个奇异输入 —— 它是最可能被真实用户写出的形态之一。
    const conversion = globToMatchPatterns('*.baidu.*');
    expect(conversion.kind).toBe('inexpressible');
    expect(conversion).not.toHaveProperty('patterns');
  });

  it('🔴 尾部 .* 与无字面后缀的中缀 * 一律 inexpressible', () => {
    for (const glob of ['*.baidu.*', '*weibo*', '*.sina.*', '*x*']) {
      expect(globToMatchPatterns(glob), glob).toEqual({
        kind: 'inexpressible',
      });
    }
  });

  it('🔴 inexpressible 在类型层面就拿不出 pattern(防兜底回归)', () => {
    // `inexpressible` 没有 `patterns` 字段 —— 这是刻意的类型设计:
    // 「不小心把它兜底成全网」在类型层面写不出来。
    const conversion = globToMatchPatterns('*weibo*');
    expect(Object.keys(conversion)).toEqual(['kind']);
  });

  it('全网 pattern 仍为「原意即全网」的 glob 保留(未过度收紧)', () => {
    for (const glob of ['*', '**', '*.*']) {
      expect(globToMatchPatterns(glob)).toEqual({
        kind: 'exact',
        patterns: [ALL_URLS_PATTERN],
      });
      expect(isIntentionallyAllUrls([glob])).toBe(true);
    }
    // 反面:这些都不是「原意即全网」。
    for (const glob of ['x.com', '*.google.com', '*.baidu.*', '*weibo*']) {
      expect(isIntentionallyAllUrls([glob]), glob).toBe(false);
    }
  });
});

describe('globToMatchPatterns · 精确可表达的那些保持精确', () => {
  it('纯字面 host → *://host/*,且标记 exact', () => {
    expect(globToMatchPatterns('x.com')).toEqual({
      kind: 'exact',
      patterns: ['*://x.com/*'],
    });
  });

  it('前导 *. + 字面尾 → *://*.tail/*,且标记 exact', () => {
    expect(globToMatchPatterns('*.google.com')).toEqual({
      kind: 'exact',
      patterns: ['*://*.google.com/*'],
    });
  });

  it('匹配任意 host 的 glob → *://*/*,且标记 exact', () => {
    for (const glob of ['*', '**', '*.*']) {
      expect(globToMatchPatterns(glob)).toEqual({
        kind: 'exact',
        patterns: [ALL_URLS_PATTERN],
      });
    }
  });

  it('🔴 *://x.com/* 不匹配 sub.x.com —— 与 matchGlob(x.com) 语义一致', () => {
    // 这一条是「精确」标记的正当性所在:若 Chrome 的语义是「含子域」,
    // 那 `x.com` 的转换就是放宽而非精确,标记会说谎。
    expect(matchPatternMatchesHost('*://x.com/*', 'sub.x.com')).toBe(false);
    expect(matchGlob('x.com', 'sub.x.com')).toBe(false);
  });

  it('🔴 *://*.google.com/* 匹配 google.com 本身 —— 与 glob.ts 的边界点号省略一致', () => {
    expect(matchPatternMatchesHost('*://*.google.com/*', 'google.com')).toBe(true);
    expect(matchGlob('*.google.com', 'google.com')).toBe(true);
  });
});

describe('globToMatchPatterns · 表达不出来的那些:有界则放宽,无界则不注册', () => {
  it('尾部 .* (如 *.baidu.*) → inexpressible(不注册,不兜底成全网)', () => {
    // 本轮修复:此前这里断言 `widened`,而 `widened` 的 patterns 是全网
    // → 一条 `*.baidu.*` 规则让全网首帧上色。断言随产品行为一同更正。
    const conversion = globToMatchPatterns('*.baidu.*');
    expect(conversion.kind).toBe('inexpressible');
  });

  it('中缀 * 但有可用的字面后缀 → 保留该后缀,不放宽到全网', () => {
    const conversion = globToMatchPatterns('news*.sina.com');
    expect(conversion).toEqual({
      kind: 'widened',
      patterns: ['*://*.sina.com/*'],
    });
    // 放宽**没有**退化成全网 —— 这是「尽可能保留字面约束」的证据。
    expect(conversion.kind === 'widened' ? conversion.patterns : []).not.toContain(
      ALL_URLS_PATTERN,
    );
  });

  it('字面段不在末尾(如 *weibo*)→ inexpressible,不注册', () => {
    // 同上:全网兜底已被移除。无界放宽的代价是无界的,不可接受。
    expect(globToMatchPatterns('*weibo*')).toEqual({
      kind: 'inexpressible',
    });
  });

  it('非法 glob → invalid,不注册(不污染为全网)', () => {
    expect(globToMatchPatterns('')).toEqual({ kind: 'invalid' });
    expect(globToMatchPatterns('a'.repeat(254))).toEqual({ kind: 'invalid' });
    expect(globToMatchPatterns('has space')).toEqual({ kind: 'invalid' });
  });
});

describe('globsToMatchPatterns · 去重 + 排序 + 全网吸收', () => {
  it('结果去重且排序 —— 使 diff 不因规则顺序浮动(ADR-064)', () => {
    const a = globsToMatchPatterns(['x.com', 'y.com', 'x.com']);
    const b = globsToMatchPatterns(['y.com', 'x.com']);
    expect(a).toEqual(['*://x.com/*', '*://y.com/*']);
    // 🔴 同一组站点、不同顺序 → 同一结果。否则用户重排规则会让
    //    reconcile 误判「变了」,无谓地 unregister + register。
    expect(a).toEqual(b);
  });

  it('出现 *://*/* 时吸收其余 pattern(ADR-064:少量 pattern 优于大量)', () => {
    expect(globsToMatchPatterns(['x.com', '*'])).toEqual([ALL_URLS_PATTERN]);
  });

  it('非法 glob 被跳过,不污染结果', () => {
    expect(globsToMatchPatterns(['x.com', ''])).toEqual(['*://x.com/*']);
  });

  it('全部非法 → 空数组(调用方据此不注册该组)', () => {
    expect(globsToMatchPatterns(['', 'has space'])).toEqual([]);
  });
});

describe('INV-10 · 线性时间(不得把通配符转译成可回溯的正则)', () => {
  it('病态模式(100 个连续 *)在毫秒级返回', () => {
    const pathological = '*'.repeat(100) + 'a';
    const started = Date.now();
    for (let i = 0; i < 1000; i++) globToMatchPatterns(pathological);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('源码中不出现 RegExp(§8 第 6 条)', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(here, '../match-pattern.ts'),
      'utf8',
    );
    // 注释里会提到 RegExp(解释为什么不用),故只查代码里的构造/字面量用法。
    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*'))
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    expect(code).not.toContain('new RegExp');
    expect(code).not.toMatch(/\.(test|exec|match|replace)\(\s*\//);
  });
});
