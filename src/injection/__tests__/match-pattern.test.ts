/**
 * glob → Chrome match pattern 转换的门禁(ADR-062/064)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **本文件最重要的断言是「超集」那一条,不是逐个样例。**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Chrome match pattern 的表达力窄于本项目的 glob(ADR-005/006),转换
 * **不可能等价**。两种偏差方向的后果完全不对称:
 *
 * - 漏匹配 → 该站首帧未滤镜 → **直接违反 INV-3**(本任务要根治的那个缺陷);
 * - 多匹配 → 注入一张不选中任何元素的样式表 → 零可观察影响(INV-1 保持)。
 *
 * 故转换必须恒为超集。下面用一个**跨 host 全集**的性质测试把它钉死:
 * 对每个 glob × 每个 host,只要 `matchGlob` 判定命中,
 * 转换出的 match pattern 就**必须**也命中。
 * 这比逐个举例更强 —— 它能抓住未来有人「优化」转换器时引入的漏匹配。
 */
import { describe, expect, it } from 'vitest';
import { matchGlob } from '../../domain/index.js';
import {
  ALL_URLS_PATTERN,
  globToMatchPatterns,
  globsToMatchPatterns,
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

describe('globToMatchPatterns · 🔴 超集不变式(INV-3 的前提)', () => {
  it.each(GLOBS)(
    'glob %s:凡 matchGlob 命中的 host,match pattern 必须也命中',
    (glob) => {
      const conversion = globToMatchPatterns(glob);
      expect(conversion.kind).not.toBe('invalid');
      const patterns =
        conversion.kind === 'invalid' ? [] : conversion.patterns;

      const missed: string[] = [];
      for (const host of HOSTS) {
        if (!matchGlob(glob, host)) continue;
        if (!anyPatternMatches(patterns, host)) missed.push(host);
      }
      // 漏匹配 = 该站首帧未滤镜 = 违反 INV-3。一个都不许有。
      expect(
        missed,
        `glob "${glob}" → ${JSON.stringify(patterns)} 漏掉了这些 host`,
      ).toEqual([]);
    },
  );

  it('🔴 对一个随机生成的 host 全集同样成立(不只是手挑的样例)', () => {
    // 组合式构造:{'', 'www.', 'news.', 'a.b.'} × {baidu, google, sina, weibo, x}
    //            × {.com, .com.cn, .co.uk, .org}
    const generated: string[] = [];
    for (const prefix of ['', 'www.', 'news.', 'a.b.']) {
      for (const label of ['baidu', 'google', 'sina', 'weibo', 'x']) {
        for (const tld of ['.com', '.com.cn', '.co.uk', '.org']) {
          generated.push(`${prefix}${label}${tld}`);
        }
      }
    }
    for (const glob of GLOBS) {
      const conversion = globToMatchPatterns(glob);
      const patterns =
        conversion.kind === 'invalid' ? [] : conversion.patterns;
      for (const host of generated) {
        if (!matchGlob(glob, host)) continue;
        expect(
          anyPatternMatches(patterns, host),
          `glob "${glob}" → ${JSON.stringify(patterns)} 漏掉 host "${host}"`,
        ).toBe(true);
      }
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

describe('globToMatchPatterns · 表达不出来的那些被放宽,且标记 widened', () => {
  it('尾部 .* (如 *.baidu.*) 被放宽', () => {
    const conversion = globToMatchPatterns('*.baidu.*');
    expect(conversion.kind).toBe('widened');
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

  it('字面段不在末尾(如 *weibo*)→ 只能放宽到全网', () => {
    expect(globToMatchPatterns('*weibo*')).toEqual({
      kind: 'widened',
      patterns: [ALL_URLS_PATTERN],
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
