/**
 * ADR-013 · 不可注入页面识别,且 `reason` 取值正确(ADR-044 的五种之一)。
 *
 * §6 T5 gate 逐字:「不可注入 URL(`chrome://settings`、应用商店、`file://`、
 * 新标签页)被正确识别,且 `reason` 字段取值正确」。
 * 下面四个 describe 与 gate 的这四项**一一对应**。
 */
import { describe, expect, it } from 'vitest';

import { classifyUrl, isInjectableUrl } from '../injectable-url.js';

describe('ADR-013 · gate 逐字列出的四类不可注入 URL', () => {
  it('chrome://settings → internal-page', () => {
    expect(classifyUrl('chrome://settings')).toEqual({
      injectable: false,
      reason: 'internal-page',
    });
    expect(classifyUrl('chrome://settings/privacy').reason).toBe('internal-page');
    expect(classifyUrl('chrome://extensions/').reason).toBe('internal-page');
  });

  it('应用商店 → web-store(新域与旧域都认)', () => {
    expect(classifyUrl('https://chromewebstore.google.com/').reason).toBe('web-store');
    expect(
      classifyUrl('https://chromewebstore.google.com/detail/foo/abcdef').reason,
    ).toBe('web-store');
    expect(
      classifyUrl('https://chrome.google.com/webstore/category/extensions').reason,
    ).toBe('web-store');
  });

  it('🔴 chrome.google.com 的**非** /webstore 路径仍可注入(不过度拦截)', () => {
    // 过度拦截的代价是真实的:用户在该 host 上配了规则却永远不生效,
    // 而 popup 会显示「此页面不支持滤镜」—— 一个无法自行排查的假故障。
    expect(classifyUrl('https://chrome.google.com/intl/zh-CN/chrome/')).toEqual({
      injectable: true,
    });
  });

  it('file:// → internal-page(ADR-044 没有 file 这个 reason,见模块头论证)', () => {
    expect(classifyUrl('file:///Users/x/page.html').reason).toBe('internal-page');
    expect(classifyUrl('file:///Users/x/doc.pdf').reason).toBe('internal-page');
  });

  it('新标签页 → new-tab,且**不**被 chrome: 吃成 internal-page', () => {
    for (const url of [
      'chrome://newtab',
      'chrome://newtab/',
      'chrome://new-tab-page/',
      'about:newtab',
      'about:blank',
    ]) {
      expect(classifyUrl(url), url).toEqual({
        injectable: false,
        reason: 'new-tab',
      });
    }
  });
});

describe('ADR-013 · PDF', () => {
  it('http(s) 上的 .pdf → pdf', () => {
    expect(classifyUrl('https://example.com/a/b/report.pdf').reason).toBe('pdf');
    expect(classifyUrl('https://example.com/report.PDF').reason).toBe('pdf');
  });

  it('查询串不影响判定(路径仍以 .pdf 结尾)', () => {
    expect(classifyUrl('https://example.com/r.pdf?page=2#x').reason).toBe('pdf');
  });

  it('host 里含 pdf 但路径不是 PDF → 可注入', () => {
    expect(classifyUrl('https://pdf.example.com/index.html').injectable).toBe(true);
  });
});

describe('空 / 畸形 URL', () => {
  it('空字符串、undefined、null → new-tab(tab 尚未提交导航)', () => {
    for (const url of ['', undefined, null]) {
      expect(classifyUrl(url)).toEqual({ injectable: false, reason: 'new-tab' });
    }
  });

  it('非 http(s) 的自定义协议 → internal-page', () => {
    expect(classifyUrl('mailto:a@b.com').reason).toBe('internal-page');
    expect(classifyUrl('ftp://example.com/x').reason).toBe('internal-page');
  });

  it('devtools / view-source / 扩展页 → internal-page', () => {
    expect(classifyUrl('devtools://devtools/bundled/x.html').reason).toBe('internal-page');
    expect(classifyUrl('view-source:https://example.com/').reason).toBe('internal-page');
    expect(classifyUrl('chrome-extension://abc/popup.html').reason).toBe('internal-page');
  });
});

describe('可注入的普通网页', () => {
  it('http 与 https 的普通页面均可注入,且无 reason 字段', () => {
    for (const url of [
      'https://weibo.com/',
      'http://news.ycombinator.com/item?id=1',
      'https://zh.wikipedia.org/wiki/色盲',
      'https://example.com:8443/path',
    ]) {
      const c = classifyUrl(url);
      expect(c.injectable, url).toBe(true);
      expect(c.reason, url).toBeUndefined();
    }
  });

  it('isInjectableUrl 与 classifyUrl 一致', () => {
    for (const url of ['https://a.com/', 'chrome://settings', '', 'file:///x']) {
      expect(isInjectableUrl(url), url).toBe(classifyUrl(url).injectable);
    }
  });
});

describe('INV-10 · 不使用 RegExp(DESIGN.md §8 第 6 条)', () => {
  it('模块源码中不含 RegExp 字面量或构造', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../injectable-url.ts'), 'utf8');
    // 去掉块注释与行注释后再查 —— 注释里出现 `/` 是正常的。
    const code = src
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//') && !line.trimStart().startsWith('/*'))
      .join('\n');
    expect(code).not.toContain('new RegExp');
    expect(code).not.toContain('.match(');
    expect(code).not.toContain('.test(');
  });
});
