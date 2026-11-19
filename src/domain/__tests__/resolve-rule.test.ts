/**
 * 规则解析门禁(ADR-007 / ADR-008 / INV-6 / INV-8)。
 */
import { describe, expect, it } from 'vitest';
import { createRule } from '../filter-rule.js';
import { defaultSettings, type FilterSettings } from '../filter-settings.js';
import {
  hostFromUrl,
  resolveActiveRule,
  resolveRule,
  shadowedFlags,
} from '../resolve-rule.js';

function settingsWith(
  rules: ReturnType<typeof createRule>[],
  overrides: Partial<FilterSettings> = {},
): FilterSettings {
  return { ...defaultSettings(), rules, ...overrides };
}

describe('hostFromUrl · 只匹配 URL 的 host 部分(ADR-007)', () => {
  it('https://x.com/path?q=1 的 host 为 x.com', () => {
    expect(hostFromUrl('https://x.com/path?q=1')).toBe('x.com');
  });

  it('去掉端口、hash、认证信息', () => {
    expect(hostFromUrl('https://x.com:8443/a#b')).toBe('x.com');
    expect(hostFromUrl('https://user:pw@x.com/')).toBe('x.com');
  });

  it('lowercase 规范化(DNS 大小写无关)', () => {
    expect(hostFromUrl('https://X.CoM/')).toBe('x.com');
  });

  it('非法 URL 返回 null,不抛异常', () => {
    expect(hostFromUrl('not a url')).toBeNull();
    expect(hostFromUrl('')).toBeNull();
    expect(hostFromUrl('about:blank')).toBeNull();
  });
});

describe('resolveRule · 首个命中胜(INV-6 / ADR-008)', () => {
  const rules = [
    createRule('x.com', 'Grayscale', 100),
    createRule('*', 'BlueYellow', 80),
  ];

  it('规则 [x.com→Gray, *→B/Y] 对 x.com 返回 Gray', () => {
    const hit = resolveRule(settingsWith(rules), 'https://x.com/');
    expect(hit?.rule.mode).toBe('Grayscale');
    expect(hit?.index).toBe(0);
  });

  it('规则 [x.com→Gray, *→B/Y] 对 other.com 返回 B/Y', () => {
    const hit = resolveRule(settingsWith(rules), 'https://other.com/');
    expect(hit?.rule.mode).toBe('BlueYellow');
    expect(hit?.index).toBe(1);
  });

  it('命中后立即停止 —— 后面即使也命中也不生效(只有索引最小的那条)', () => {
    const many = [
      createRule('*.example.com', 'RedGreen', 10),
      createRule('*', 'GreenRed', 20),
      createRule('a.example.com', 'Grayscale', 30),
    ];
    const hit = resolveRule(settingsWith(many), 'https://a.example.com/');
    expect(hit?.index).toBe(0);
    expect(hit?.rule.mode).toBe('RedGreen');
  });

  it('无规则命中 → null(不套滤镜)', () => {
    expect(
      resolveRule(settingsWith([createRule('x.com')]), 'https://y.com/'),
    ).toBeNull();
  });

  it('空规则列表 → null', () => {
    expect(resolveRule(defaultSettings(), 'https://x.com/')).toBeNull();
  });

  it('非法 URL → null', () => {
    expect(resolveRule(settingsWith([createRule('*')]), 'nonsense')).toBeNull();
  });
});

describe('resolveActiveRule · 主开关凌驾(INV-8 / ADR-027)', () => {
  it('masterEnabled=false 时恒返回 null,且规则原样保留', () => {
    const s = settingsWith([createRule('*', 'Grayscale', 100)], {
      masterEnabled: false,
    });
    expect(resolveActiveRule(s, 'https://x.com/')).toBeNull();
    expect(s.rules).toHaveLength(1);
    // resolveRule 本身不看主开关 —— 短路是 T4 入口的职责。
    expect(resolveRule(s, 'https://x.com/')?.rule.mode).toBe('Grayscale');
  });

  it('masterEnabled=true 时与 resolveRule 一致', () => {
    const s = settingsWith([createRule('*', 'Grayscale', 100)]);
    expect(resolveActiveRule(s, 'https://x.com/')?.index).toBe(0);
  });
});

describe('shadowedFlags · 被遮蔽判定(ADR-032)', () => {
  it('首个命中者不算被遮蔽,其后的命中者算', () => {
    const s = settingsWith([
      createRule('x.com'),
      createRule('*'),
      createRule('*.com'),
    ]);
    expect(shadowedFlags(s, 'x.com')).toEqual([false, true, true]);
  });

  it('未命中的规则不算被遮蔽', () => {
    const s = settingsWith([createRule('y.com'), createRule('x.com')]);
    expect(shadowedFlags(s, 'x.com')).toEqual([false, false]);
  });

  it('host 为 null 时全部不被遮蔽', () => {
    const s = settingsWith([createRule('*'), createRule('*')]);
    expect(shadowedFlags(s, null)).toEqual([false, false]);
  });
});
