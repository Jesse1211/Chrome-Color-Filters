/**
 * `computePatternStatus` / `computePreviewEligibility` 的穷举测试
 * (§5.6 两维状态 · §5.7 + ADR-049 的四种不发送情形)。
 *
 * 这些是**纯函数**,故不需要 DOM —— 环境保持默认的 node。
 * 组件层的断言在 `rule-edit-view.test.tsx`,两者互为第二道防线:
 * 那边可能因某个分支没被触发而漏掉,这边把分支**穷举**掉。
 */
import { describe, expect, it } from 'vitest';

import {
  type FilterRule,
  type FilterSettings,
  defaultSettings,
} from '../../domain/index.js';
import { type TabState } from '../tab-state.js';
import {
  type PreviewBlockReason,
  computePatternStatus,
  computePreviewEligibility,
  firstIllegalChar,
} from '../pattern-status.js';

const rule = (pattern: string): FilterRule => ({
  pattern,
  mode: 'Grayscale',
  intensity: 100,
});

const settingsWith = (overrides: Partial<FilterSettings> = {}): FilterSettings => ({
  ...defaultSettings(),
  ...overrides,
});

const tab = (overrides: Partial<TabState> = {}): TabState => ({
  tabId: 7,
  injectable: true,
  host: 'weibo.com',
  activeRuleIndex: null,
  shadowedRuleIndexes: [],
  ...overrides,
});

describe('§5.6 · computePatternStatus 的四种情况', () => {
  it('匹配且生效 → live / ok', () => {
    const status = computePatternStatus({
      draftPattern: '*.weibo.*',
      editingIndex: 0,
      settings: settingsWith({ rules: [rule('*.weibo.*')] }),
      // ADR-044:草稿与存储一致 → 两维取自 `TabState`,故这里必须由
      // `TabState` 说「0 号在生效」。原先的 `activeRuleIndex: null` 是真实
      // service worker 不会产生的自相矛盾响应(命中却无生效者)。
      tabState: tab({ activeRuleIndex: 0 }),
    });
    expect(status.kind).toBe('live');
    expect(status.tone).toBe('ok');
    expect(status.valid).toBe(true);
    expect(status.matchesCurrentPage).toBe(true);
    expect(status.host).toBe('weibo.com');
    expect(status.blockedBy).toBeNull();
  });

  it('匹配但被更靠前的规则遮蔽 → shadowed / warn,带遮蔽者信息', () => {
    const status = computePatternStatus({
      draftPattern: '*.com',
      editingIndex: 1,
      settings: settingsWith({ rules: [rule('*.weibo.*'), rule('*.com')] }),
      // ADR-044:遮蔽关系由 service worker 判定 —— 0 号生效、1 号被遮蔽。
      tabState: tab({ activeRuleIndex: 0, shadowedRuleIndexes: [1] }),
    });
    expect(status.kind).toBe('shadowed');
    expect(status.tone).toBe('warn');
    expect(status.blockedBy).toEqual({ ordinal: 1, pattern: '*.weibo.*' });
  });

  it('ADR-008:只有**排在前面**的规则能遮蔽 —— 后面的不算(草稿干净,信 TabState)', () => {
    const status = computePatternStatus({
      draftPattern: '*.weibo.*',
      editingIndex: 0,
      settings: settingsWith({ rules: [rule('*.weibo.*'), rule('*.com')] }),
      // 两条都匹配 weibo.com,但 0 号靠前 → SW 判 0 号生效、1 号被遮蔽。
      tabState: tab({ activeRuleIndex: 0, shadowedRuleIndexes: [1] }),
    });
    expect(status.kind).toBe('live');
  });

  it('ADR-008:只有**排在前面**的规则能遮蔽 —— 后面的不算(草稿脏,本地判定)', () => {
    // 草稿脏 → TabState 无从回答,走本地的 ADR-008 首个命中胜。
    // TabState 故意说「1 号生效」以证明本地路径没有误读它。
    const status = computePatternStatus({
      draftPattern: 'x.weibo.com',
      editingIndex: 0,
      settings: settingsWith({ rules: [rule('*.weibo.*'), rule('*.com')] }),
      tabState: tab({ host: 'x.weibo.com', activeRuleIndex: 1 }),
    });
    expect(status.kind).toBe('live');
    expect(status.blockedBy).toBeNull();
  });

  it('新建的规则会被追加到末尾 → 任何匹配当前页的既有规则都遮蔽它', () => {
    const status = computePatternStatus({
      draftPattern: 'weibo.com',
      editingIndex: null,
      settings: settingsWith({ rules: [rule('*.weibo.*')] }),
      tabState: tab(),
    });
    expect(status.kind).toBe('shadowed');
    expect(status.blockedBy).toEqual({ ordinal: 1, pattern: '*.weibo.*' });
  });

  it('不匹配 → no-match / muted', () => {
    const status = computePatternStatus({
      draftPattern: 'x.com',
      editingIndex: 0,
      settings: settingsWith({ rules: [rule('x.com')] }),
      tabState: tab({ host: 'weibo.com' }),
    });
    expect(status.kind).toBe('no-match');
    expect(status.tone).toBe('muted');
    expect(status.matchesCurrentPage).toBe(false);
  });

  it('非法字符 → illegal-character / bad,指出第一个非法字符', () => {
    const status = computePatternStatus({
      draftPattern: '*.weibo.#com',
      editingIndex: null,
      settings: settingsWith(),
      tabState: tab(),
    });
    expect(status.kind).toBe('illegal-character');
    expect(status.tone).toBe('bad');
    expect(status.valid).toBe(false);
    expect(status.illegalChar).toBe('#');
  });

  it('🔴 F20:空 pattern → empty / bad,**不可保存**,且没有 illegalChar 可指', () => {
    const status = computePatternStatus({
      draftPattern: '',
      editingIndex: null,
      settings: settingsWith(),
      tabState: tab(),
    });
    expect(status.kind).toBe('empty');
    expect(status.tone).toBe('bad');
    expect(status.valid).toBe(false);
    expect(status.illegalChar).toBeNull();
  });

  it('ADR-011:超过 253 字符 → too-long / bad', () => {
    const status = computePatternStatus({
      draftPattern: 'a'.repeat(254),
      editingIndex: null,
      settings: settingsWith(),
      tabState: tab(),
    });
    expect(status.kind).toBe('too-long');
    expect(status.valid).toBe(false);
  });

  it('INV-8:主开关 OFF 时即使匹配也不「生效」(显示 shadowed)', () => {
    const status = computePatternStatus({
      draftPattern: '*.weibo.*',
      editingIndex: 0,
      settings: settingsWith({
        masterEnabled: false,
        rules: [rule('*.weibo.*')],
      }),
      tabState: tab(),
    });
    expect(status.kind).toBe('shadowed');
    // 主开关 OFF 不是「被某条规则抢先」,故没有遮蔽者 —— 不渲染解释框。
    expect(status.blockedBy).toBeNull();
  });

  it('不可注入页 / 骨架态:host 为 null,按不匹配渲染', () => {
    for (const tabState of [
      null,
      tab({ injectable: false, host: null, tabId: null, reason: 'internal-page' }),
    ]) {
      const status = computePatternStatus({
        draftPattern: '*.weibo.*',
        editingIndex: 0,
        settings: settingsWith({ rules: [rule('*.weibo.*')] }),
        tabState,
      });
      expect(status.kind).toBe('no-match');
      expect(status.host).toBeNull();
      expect(status.matchesCurrentPage).toBe(false);
    }
  });

  it('草稿**脏**时 `activeRuleIndex` 描述的是旧 pattern,不能照搬', () => {
    // TabState 说 0 号在生效,但用户已经把 0 号的 pattern 改成不匹配的了。
    // `activeRuleIndex` 是**存储索引**,它说的是改动前那个 pattern ——
    // 照搬会错报「生效中」。这是 TabState 结构上无从回答的那一问。
    const status = computePatternStatus({
      draftPattern: 'x.com',
      editingIndex: 0,
      settings: settingsWith({ rules: [rule('*.weibo.*')] }),
      tabState: tab({ activeRuleIndex: 0 }),
    });
    expect(status.kind).toBe('no-match');
  });
});

/**
 * 🔴 DESIGN.md:1016(ADR-044 契约块)点名 T6b 的两维状态行
 * 「**两个视图都不自己算匹配** —— 真相来源唯一」。
 *
 * 下面这组断言就是那条约束的证据:草稿干净时,**只有 `TabState` 的
 * `activeRuleIndex` / `shadowedRuleIndexes` 能决定两维** —— 为此故意让
 * `settings.rules` 的本地匹配结果与 `TabState` **相反**,看谁赢。
 * 本地判定若复活,这些断言全部变红。
 */
describe('🔴 ADR-044 · 草稿干净时两维取自 TabState,本模块不自己算匹配', () => {
  it('本地 matchGlob 会说「不匹配」,但 TabState 说生效 → 信 TabState', () => {
    // host 与 pattern 在本地看毫无关系(SW 可能用了更宽的 URL 判定)。
    const status = computePatternStatus({
      draftPattern: 'example.com',
      editingIndex: 0,
      settings: settingsWith({ rules: [rule('example.com')] }),
      tabState: tab({ host: 'totally-other.test', activeRuleIndex: 0 }),
    });
    expect(status.kind).toBe('live');
    expect(status.matchesCurrentPage).toBe(true);
  });

  it('本地看「该生效」,但 TabState 说被遮蔽 → 信 TabState,遮蔽者取自 activeRuleIndex', () => {
    // 本地扫描看不到任何更靠前的命中者(0 号就是本条),若自己算必判 live。
    const status = computePatternStatus({
      draftPattern: 'weibo.com',
      editingIndex: 0,
      settings: settingsWith({
        rules: [rule('weibo.com'), rule('*.weibo.*')],
      }),
      tabState: tab({ activeRuleIndex: 1, shadowedRuleIndexes: [0] }),
    });
    expect(status.kind).toBe('shadowed');
    expect(status.blockedBy).toEqual({ ordinal: 2, pattern: '*.weibo.*' });
  });

  it('本地看「匹配」,但 TabState 两个字段都不含本条 → 信 TabState 判不匹配', () => {
    const status = computePatternStatus({
      draftPattern: '*.weibo.*',
      editingIndex: 0,
      settings: settingsWith({ rules: [rule('*.weibo.*')] }),
      tabState: tab({ activeRuleIndex: null, shadowedRuleIndexes: [] }),
    });
    expect(status.kind).toBe('no-match');
  });

  it('只改了 mode/强度(pattern 未动)仍算干净 → 继续信 TabState', () => {
    // 编辑视图改强度不碰 pattern,此时 TabState 依然权威。
    const status = computePatternStatus({
      draftPattern: '*.weibo.*',
      editingIndex: 1,
      settings: settingsWith({
        rules: [rule('other.test'), rule('*.weibo.*')],
      }),
      tabState: tab({ activeRuleIndex: 1 }),
    });
    expect(status.kind).toBe('live');
  });

  it('🔴 主开关 OFF:TabState 两字段按设计归零,第一维只能本地取 → 仍判「匹配但不生效」', () => {
    // compute-tab-state.ts 明文:主开关 OFF 时两字段同时归零态。
    // 若照搬就会退化成 `○`「不匹配当前网站」—— 而 pattern 明明匹配。
    const status = computePatternStatus({
      draftPattern: '*.weibo.*',
      editingIndex: 0,
      settings: settingsWith({
        masterEnabled: false,
        rules: [rule('*.weibo.*')],
      }),
      tabState: tab({ activeRuleIndex: null, shadowedRuleIndexes: [] }),
    });
    expect(status.kind).toBe('shadowed');
    expect(status.matchesCurrentPage).toBe(true);
    expect(status.blockedBy).toBeNull();
  });
});

describe('firstIllegalChar', () => {
  it('合法 pattern 没有非法字符', () => {
    expect(firstIllegalChar('*.weibo.*')).toBeNull();
    expect(firstIllegalChar('x-1_2.com')).toBeNull();
  });

  it('返回**第一个**非法字符', () => {
    expect(firstIllegalChar('ab/cd?ef')).toBe('/');
    expect(firstIllegalChar('中文')).toBe('中');
  });
});

describe('🔴 §5.7 / ADR-049 · computePreviewEligibility 的四种不发送情形', () => {
  const base = {
    settings: settingsWith({ rules: [rule('*.weibo.*')] }),
    tabState: tab(),
    locked: false,
    matchesCurrentPage: true,
  };

  it('四项齐备 → 可用,并带上 GET_TAB_STATE 给出的 tabId', () => {
    const r = computePreviewEligibility(base);
    expect(r).toEqual({ available: true, tabId: 7 });
  });

  it('1. 主开关 OFF → master-off', () => {
    const r = computePreviewEligibility({
      ...base,
      settings: settingsWith({ masterEnabled: false }),
    });
    expect(r).toEqual({ available: false, reason: 'master-off' });
  });

  it('2. 当前页不可注入 → not-injectable', () => {
    const r = computePreviewEligibility({
      ...base,
      tabState: tab({ injectable: false, host: null, reason: 'pdf' }),
    });
    expect(r).toEqual({ available: false, reason: 'not-injectable' });
  });

  it('3. pattern 不匹配当前页 → pattern-mismatch', () => {
    const r = computePreviewEligibility({ ...base, matchesCurrentPage: false });
    expect(r).toEqual({ available: false, reason: 'pattern-mismatch' });
  });

  it('🔒 4. 锁定中 → locked(ADR-051 的第四种条件)', () => {
    const r = computePreviewEligibility({ ...base, locked: true });
    expect(r).toEqual({ available: false, reason: 'locked' });
  });

  it('🔒 锁定优先于其他原因 —— 它冻结一切(ADR-051)', () => {
    const r = computePreviewEligibility({
      ...base,
      locked: true,
      matchesCurrentPage: false,
      settings: settingsWith({ masterEnabled: false }),
    });
    expect(r).toEqual({ available: false, reason: 'locked' });
  });

  it('骨架态 → skeleton(tabId 未知,连不上端口)', () => {
    expect(computePreviewEligibility({ ...base, tabState: null })).toEqual({
      available: false,
      reason: 'skeleton',
    });
  });

  it('🔴 可注入但 tabId 为 null → 判不可用,**绝不**退回 chrome.tabs.query', () => {
    const r = computePreviewEligibility({
      ...base,
      tabState: tab({ tabId: null }),
    });
    expect(r.available).toBe(false);
  });

  it('封闭联合:所有 reason 取值都在 PreviewBlockReason 内', () => {
    const all: PreviewBlockReason[] = [
      'master-off',
      'not-injectable',
      'pattern-mismatch',
      'locked',
      'skeleton',
    ];
    // 这条断言的价值在于**类型**:上面的字面量数组若写了联合外的值,
    // `tsc --noEmit`(ADR-066)会报错。运行时只需确认没有重复。
    expect(new Set(all).size).toBe(all.length);
  });
});
