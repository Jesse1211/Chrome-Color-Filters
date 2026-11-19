/**
 * 通配符匹配门禁(ADR-005 / ADR-006 / ADR-011 / INV-10)。
 */
import { describe, expect, it } from 'vitest';
import {
  GLOB_PATTERN_MAX_LENGTH,
  isGlobPattern,
  matchGlob,
  validateGlobPattern,
} from '../glob.js';

describe('matchGlob · 已定稿示例(§1 匹配语义 / T1 门禁)', () => {
  it('`*.baidu.*` 匹配 news.baidu.com', () => {
    expect(matchGlob('*.baidu.*', 'news.baidu.com')).toBe(true);
  });

  it('`*.baidu.*` 匹配 a.b.c.baidu.com', () => {
    expect(matchGlob('*.baidu.*', 'a.b.c.baidu.com')).toBe(true);
  });

  it('`*.baidu.*` 匹配 baidu.com.cn(ADR-006:域名含 baidu,不限子域层级)', () => {
    expect(matchGlob('*.baidu.*', 'baidu.com.cn')).toBe(true);
  });

  it('`*.google.com` 匹配 mail.google.com', () => {
    expect(matchGlob('*.google.com', 'mail.google.com')).toBe(true);
  });

  it('`*.google.com` 匹配 a.b.google.com(* 跨点号,ADR-006)', () => {
    expect(matchGlob('*.google.com', 'a.b.google.com')).toBe(true);
  });

  it('`*.google.com` **不匹配** google.com.evil.com(尾部须字面落在 host 末尾)', () => {
    expect(matchGlob('*.google.com', 'google.com.evil.com')).toBe(false);
  });

  it('`x.com` 仅匹配 x.com', () => {
    expect(matchGlob('x.com', 'x.com')).toBe(true);
    expect(matchGlob('x.com', 'sub.x.com')).toBe(false);
    expect(matchGlob('x.com', 'notx.com')).toBe(false);
  });

  it('`*` 匹配任意 host', () => {
    for (const host of ['x.com', 'a.b.c.d.example.org', 'localhost', '']) {
      expect(matchGlob('*', host)).toBe(true);
    }
  });
});

describe('matchGlob · 其他语义', () => {
  it('大小写不敏感(DNS 语义)', () => {
    expect(matchGlob('X.CoM', 'x.com')).toBe(true);
    expect(matchGlob('*.GOOGLE.com', 'Mail.Google.COM')).toBe(true);
  });

  it('非子串匹配 —— 模式必须覆盖整个 host', () => {
    expect(matchGlob('google.com', 'mail.google.com')).toBe(false);
    expect(matchGlob('google', 'google.com')).toBe(false);
  });

  it('`*` 可匹配空串', () => {
    expect(matchGlob('x*.com', 'x.com')).toBe(true);
  });

  it('非字符串输入安全返回 false,不抛异常', () => {
    expect(matchGlob(undefined as unknown as string, 'x.com')).toBe(false);
    expect(matchGlob('x.com', undefined as unknown as string)).toBe(false);
  });
});

describe('INV-10 · 线性时间,无灾难性回溯', () => {
  it('病态模式(100 个连续 `*` 对 1000 字符输入)在硬性耗时上限内返回', () => {
    const pattern = '*'.repeat(100) + 'x';
    const host = 'a'.repeat(1000);

    const started = performance.now();
    const result = matchGlob(pattern, host);
    const elapsed = performance.now() - started;

    expect(result).toBe(false);
    // 若实现退化成带回溯的正则,这里会是天文数字级的耗时(实质挂死)。
    // 线性实现实测在微秒量级;100ms 是极宽松但足以判别的硬性上限。
    expect(elapsed).toBeLessThan(100);
  });

  it('耗时随输入规模近似线性增长,而非指数', () => {
    const pattern = '*'.repeat(50) + 'x';
    const measure = (n: number): number => {
      const host = 'a'.repeat(n);
      const started = performance.now();
      for (let i = 0; i < 200; i++) matchGlob(pattern, host);
      return performance.now() - started;
    };
    measure(500); // 预热,避免 JIT 冷启动污染比值
    const small = measure(500);
    const large = measure(2000);
    // 规模 ×4 。指数实现会直接超时;线性实现的比值远低于 40。
    expect(large).toBeLessThan(Math.max(small, 1) * 40);
  });
});

describe('GlobPattern 校验(ADR-011)', () => {
  it('拒绝超过 253 字符的输入', () => {
    const ok = 'a'.repeat(GLOB_PATTERN_MAX_LENGTH);
    const tooLong = 'a'.repeat(GLOB_PATTERN_MAX_LENGTH + 1);
    expect(isGlobPattern(ok)).toBe(true);
    expect(isGlobPattern(tooLong)).toBe(false);
    expect(validateGlobPattern(tooLong)).toEqual({
      ok: false,
      error: 'too-long',
    });
  });

  it('拒绝空串与非字符串', () => {
    expect(validateGlobPattern('')).toEqual({ ok: false, error: 'empty' });
    expect(validateGlobPattern(42)).toEqual({
      ok: false,
      error: 'not-a-string',
    });
  });

  it('拒绝正则元字符(ADR-005:语法不是正则,写不出嵌套量词)', () => {
    for (const bad of ['(a|b).com', 'a+.com', 'a{2,3}.com', '^x.com$', 'a?.com']) {
      expect(validateGlobPattern(bad)).toEqual({
        ok: false,
        error: 'illegal-character',
      });
    }
  });

  it('接受合法的 host 字面字符与 `*`', () => {
    for (const good of ['*', 'x.com', '*.baidu.*', 'my-site_1.example.com']) {
      expect(isGlobPattern(good)).toBe(true);
    }
  });
});
