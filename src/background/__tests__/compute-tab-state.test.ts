/**
 * ADR-044 · `GET_TAB_STATE` 响应结构与语义。
 *
 * §6 T5 gate 逐字:「`GET_TAB_STATE` 响应结构与 ADR-044 的 `TabState`
 * **完全一致**(字段名、类型、语义),含 `tabId`、`activeRuleIndex` 与
 * `shadowedRuleIndexes` 的正确计算」。
 *
 * 🔴 本文件同时是**契约对齐**的机械证据:它把生产端的 `computeTabState`
 * 输出喂给 T6a 侧的 `coerceTabState`,断言**原样通过**(不被降级)。
 * 若 T5 哪天少写一个字段或改了类型,`coerceTabState` 会把它降级成
 * `no-tab`,该断言当场转红 —— 这正是 ADR-044 要防的那个错配。
 */
import { describe, expect, it } from 'vitest';

import {
  type FilterRule,
  type FilterSettings,
  defaultSettings,
} from '../../domain/index.js';
import { FALLBACK_TAB_STATE, coerceTabState } from '../../ui/tab-state.js';
import { computeTabState, tabUrl } from '../compute-tab-state.js';

function rule(pattern: string, intensity = 100): FilterRule {
  return { pattern, mode: 'Grayscale', intensity };
}

function settingsWith(rules: FilterRule[], masterEnabled = true): FilterSettings {
  return { ...defaultSettings(), masterEnabled, rules };
}

describe('ADR-044 · 字段集与 T6a 侧 coerce 的双向一致', () => {
  it('输出的键集恰好是契约的六个字段(可注入且命中时)', () => {
    const state = computeTabState(settingsWith([rule('weibo.com')]), {
      id: 7,
      url: 'https://weibo.com/u/1',
    });
    expect(Object.keys(state).sort()).toEqual(
      ['activeRuleIndex', 'host', 'injectable', 'shadowedRuleIndexes', 'tabId'].sort(),
    );
  });

  it('🔴 coerceTabState(T6a 侧)原样通过,不降级', () => {
    const state = computeTabState(settingsWith([rule('weibo.com')]), {
      id: 7,
      url: 'https://weibo.com/u/1',
    });
    expect(coerceTabState(state)).toEqual(state);
    expect(coerceTabState(state)).not.toEqual(FALLBACK_TAB_STATE);
  });

  it('不可注入时的响应同样能原样通过 coerce', () => {
    const state = computeTabState(settingsWith([]), {
      id: 9,
      url: 'chrome://settings',
    });
    expect(coerceTabState(state)).toEqual(state);
  });
});

describe('tabId(ADR-049:供 popup 直连做预览)', () => {
  it('如实上报,即使不可注入', () => {
    expect(
      computeTabState(settingsWith([]), { id: 42, url: 'chrome://settings' }).tabId,
    ).toBe(42);
  });

  it('tab 为 null → 全降级为 no-tab', () => {
    expect(computeTabState(settingsWith([]), null)).toEqual({
      tabId: null,
      injectable: false,
      reason: 'no-tab',
      host: null,
      activeRuleIndex: null,
      shadowedRuleIndexes: [],
    });
  });

  it('tab 存在但无 id(如 devtools 的无 id tab)→ tabId null', () => {
    expect(computeTabState(settingsWith([]), { url: 'https://a.com/' }).tabId).toBeNull();
  });
});

describe('host(契约:不可注入时为 null)', () => {
  it('可注入时为 host,不含协议/端口/路径(ADR-007)', () => {
    expect(
      computeTabState(settingsWith([]), { id: 1, url: 'https://x.com:8443/p?q=1' }).host,
    ).toBe('x.com');
  });

  it('不可注入时恒为 null', () => {
    for (const url of ['chrome://settings', 'file:///x', '', 'https://e.com/a.pdf']) {
      expect(computeTabState(settingsWith([]), { id: 1, url }).host, url).toBeNull();
    }
  });
});

describe('activeRuleIndex / shadowedRuleIndexes(INV-6 / ADR-032)', () => {
  const rules = [
    rule('*.example.com'), // 0
    rule('example.com'), // 1 —— 不匹配 www.example.com(ADR-006:*. 需要前缀)
    rule('*'), // 2 —— 匹配一切
    rule('www.example.com'), // 3
  ];

  it('首个命中者生效,其后命中者全部列为被遮蔽,升序', () => {
    const state = computeTabState(settingsWith(rules), {
      id: 1,
      url: 'https://www.example.com/',
    });
    expect(state.activeRuleIndex).toBe(0);
    expect(state.shadowedRuleIndexes).toEqual([2, 3]);
  });

  it('无命中 → activeRuleIndex null 且 shadowed 为空', () => {
    const state = computeTabState(settingsWith([rule('weibo.com')]), {
      id: 1,
      url: 'https://zhihu.com/',
    });
    expect(state.activeRuleIndex).toBeNull();
    expect(state.shadowedRuleIndexes).toEqual([]);
  });

  it('命中者唯一 → shadowed 为空', () => {
    const state = computeTabState(settingsWith([rule('weibo.com')]), {
      id: 1,
      url: 'https://weibo.com/',
    });
    expect(state.activeRuleIndex).toBe(0);
    expect(state.shadowedRuleIndexes).toEqual([]);
  });

  it('被遮蔽索引严格升序(契约逐字要求)', () => {
    const many = ['*', '*', '*', '*'].map((p) => rule(p));
    const state = computeTabState(settingsWith(many), { id: 1, url: 'https://a.com/' });
    expect(state.shadowedRuleIndexes).toEqual([1, 2, 3]);
    const sorted = [...state.shadowedRuleIndexes].sort((a, b) => a - b);
    expect(state.shadowedRuleIndexes).toEqual(sorted);
  });

  it('强度 0 的规则仍算「命中」—— 它是规则身份,不是像素判定', () => {
    // 图标两态才看像素(见 icon-state.ts);列表要显示「这条在本页生效」,
    // 否则用户把强度调到 0 之后会以为规则消失了。
    const state = computeTabState(settingsWith([rule('a.com', 0)]), {
      id: 1,
      url: 'https://a.com/',
    });
    expect(state.activeRuleIndex).toBe(0);
  });
});

describe('🔴 INV-8 / ADR-027 · 主开关 OFF', () => {
  const rules = [rule('*'), rule('a.com')];

  it('activeRuleIndex 为 null(规则仍原样保留在 settings 里)', () => {
    const s = settingsWith(rules, false);
    const state = computeTabState(s, { id: 1, url: 'https://a.com/' });
    expect(state.activeRuleIndex).toBeNull();
    expect(s.rules).toHaveLength(2); // INV-8:规则原样保留
  });

  it('🔴 shadowedRuleIndexes 也必须为空 —— 不能谎称「输给了别的规则」', () => {
    const state = computeTabState(settingsWith(rules, false), {
      id: 1,
      url: 'https://a.com/',
    });
    expect(state.shadowedRuleIndexes).toEqual([]);
  });

  it('host 与 injectable 不受主开关影响(页面是什么与主开关无关)', () => {
    const state = computeTabState(settingsWith(rules, false), {
      id: 1,
      url: 'https://a.com/',
    });
    expect(state.injectable).toBe(true);
    expect(state.host).toBe('a.com');
  });
});

describe('tabUrl · 导航中途取 pendingUrl', () => {
  it('url 优先', () => {
    expect(tabUrl({ url: 'https://a.com/', pendingUrl: 'https://b.com/' })).toBe(
      'https://a.com/',
    );
  });

  it('url 缺失/为空时退 pendingUrl', () => {
    expect(tabUrl({ pendingUrl: 'https://b.com/' })).toBe('https://b.com/');
    expect(tabUrl({ url: '', pendingUrl: 'https://b.com/' })).toBe('https://b.com/');
  });

  it('两者皆无 → null', () => {
    expect(tabUrl({})).toBeNull();
  });

  it('导航中途的 tab 报的是**新**页面的 host,不是上一页的', () => {
    const state = computeTabState(settingsWith([rule('b.com')]), {
      id: 1,
      pendingUrl: 'https://b.com/',
    });
    expect(state.host).toBe('b.com');
    expect(state.activeRuleIndex).toBe(0);
  });
});
