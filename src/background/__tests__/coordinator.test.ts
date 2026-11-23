/**
 * T5 · `BackgroundCoordinator` —— §6 T5 gate 的逐条机械断言。
 *
 * | gate 条款 | 本文件的 describe |
 * |-----------|-------------------|
 * | 匹配同一规则的 3 个 tab:改规则后另外两个立即反映(INV-4) | 「INV-4」 |
 * | 主开关 OFF → 图标**全灰**;ON → 全部恢复(INV-8 / ADR-019) | 「INV-8」 |
 * | `GET_TAB_STATE` 响应与 ADR-044 一致 | 「ADR-044 消息应答」 |
 * | 不可注入 URL 被正确识别且 reason 正确 | 「ADR-013」 |
 * | tab 导航时解析适用规则 | 「tab 导航」 |
 *
 * ⚠️ 这些断言用内存替身(见 `fakes.ts`),**不冒充 REAL_STACK_GATE**。
 */
import { describe, expect, it } from 'vitest';

import {
  type FilterRule,
  type FilterSettings,
  defaultSettings,
} from '../../domain/index.js';
import { FALLBACK_TAB_STATE, GET_TAB_STATE } from '../../ui/tab-state.js';
import { BackgroundCoordinator, ICON_TITLES, isGetTabStateMessage } from '../coordinator.js';
import { FakeAction, FakeEvents, FakeMessaging, FakeTabs } from './fakes.js';

function rule(pattern: string, intensity = 100): FilterRule {
  return { pattern, mode: 'Grayscale', intensity };
}

interface Harness {
  readonly coordinator: BackgroundCoordinator;
  readonly tabs: FakeTabs;
  readonly action: FakeAction;
  readonly events: FakeEvents;
  readonly messaging: FakeMessaging;
  readonly errors: { where: string; error: unknown }[];
  /** 改设置并触发订阅(模拟 popup 写入 → storage.onChanged)。 */
  setSettings(next: Partial<FilterSettings>): void;
  readonly settings: () => FilterSettings;
}

function harness(
  initial: Partial<FilterSettings>,
  tabs: { id: number; url: string; active?: boolean }[],
): Harness {
  let settings: FilterSettings = { ...defaultSettings(), ...initial };
  const listeners: (() => void)[] = [];
  const fakeTabs = new FakeTabs(tabs);
  const action = new FakeAction();
  const events = new FakeEvents();
  const messaging = new FakeMessaging();
  const errors: { where: string; error: unknown }[] = [];

  const coordinator = new BackgroundCoordinator({
    tabs: fakeTabs,
    action,
    events,
    messaging,
    readSettings: () => Promise.resolve(settings),
    subscribeSettings: (l) => {
      listeners.push(l);
      return () => {
        const i = listeners.indexOf(l);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    onError: (where, error) => errors.push({ where, error }),
  });

  return {
    coordinator,
    tabs: fakeTabs,
    action,
    events,
    messaging,
    errors,
    settings: () => settings,
    setSettings(next) {
      settings = { ...settings, ...next };
      for (const l of [...listeners]) l();
    },
  };
}

/** 让所有已排队的微任务跑完 —— 协调器的事件处理都是 void 的异步调用。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('🔴 INV-4 · 匹配同一规则的 3 个 tab,改规则后另外两个立即反映', () => {
  it('同一条 `*.example.com` 规则下的 3 个 tab,删掉规则后三者图标同时转灰', async () => {
    const h = harness({ rules: [rule('*.example.com')] }, [
      { id: 1, url: 'https://a.example.com/', active: true },
      { id: 2, url: 'https://b.example.com/' },
      { id: 3, url: 'https://c.example.com/' },
    ]);
    h.coordinator.start();
    await flush();

    // 先把三者都摆正(start 只摆当前 tab,其余靠一次 syncAllTabs)。
    await h.coordinator.syncAllTabs();
    expect([1, 2, 3].map((id) => h.action.stateOf(id))).toEqual([
      'active',
      'active',
      'active',
    ]);

    h.action.reset();
    // 用户在**第 1 个** tab 的 popup 里删掉那条规则 → 仓储层通知。
    h.setSettings({ rules: [] });
    await flush();

    // 🔴 另外两个 tab(2、3)**也**必须立即反映,而不是等用户切过去。
    expect(h.action.stateOf(1)).toBe('inactive');
    expect(h.action.stateOf(2)).toBe('inactive');
    expect(h.action.stateOf(3)).toBe('inactive');
  });

  it('改强度到 0 → 三个 tab 同时转灰(实际生效判定,§6 T5 spec)', async () => {
    const h = harness({ rules: [rule('*.example.com', 100)] }, [
      { id: 1, url: 'https://a.example.com/', active: true },
      { id: 2, url: 'https://b.example.com/' },
      { id: 3, url: 'https://c.example.com/' },
    ]);
    h.coordinator.start();
    await h.coordinator.syncAllTabs();
    h.action.reset();

    h.setSettings({ rules: [rule('*.example.com', 0)] });
    await flush();

    expect([1, 2, 3].map((id) => h.action.stateOf(id))).toEqual([
      'inactive',
      'inactive',
      'inactive',
    ]);
  });

  it('🔴 删掉 rules[0] 后,原先被遮蔽的 rules[1] 在各 tab 上转为生效', async () => {
    // 这一格解释了「为什么对全部 tab 重算,而不挑『匹配被改规则的那些』」:
    // 被删的是 rules[0],受影响的却是 rules[1] 的匹配面。
    const h = harness(
      { rules: [rule('*.example.com', 0), rule('*', 100)] },
      [
        { id: 1, url: 'https://a.example.com/', active: true },
        { id: 2, url: 'https://b.example.com/' },
      ],
    );
    h.coordinator.start();
    await h.coordinator.syncAllTabs();
    // rules[0] 强度 0 且是首个命中者 → 两个 tab 都是灰
    expect([1, 2].map((id) => h.action.stateOf(id))).toEqual(['inactive', 'inactive']);

    h.action.reset();
    h.setSettings({ rules: [rule('*', 100)] });
    await flush();

    expect([1, 2].map((id) => h.action.stateOf(id))).toEqual(['active', 'active']);
  });

  it('不匹配的 tab 不会因别人的规则变化而被点亮', async () => {
    const h = harness({ rules: [] }, [
      { id: 1, url: 'https://a.example.com/', active: true },
      { id: 2, url: 'https://zhihu.com/' },
    ]);
    h.coordinator.start();
    h.setSettings({ rules: [rule('*.example.com')] });
    await flush();

    expect(h.action.stateOf(1)).toBe('active');
    expect(h.action.stateOf(2)).toBe('inactive');
  });
});

describe('🔴 INV-8 / ADR-019 · 主开关 OFF → 图标全灰;ON → 全部恢复', () => {
  it('OFF 时全部 tab 转灰,且规则原样保留;ON 后命中的 tab 恢复亮', async () => {
    const h = harness({ rules: [rule('*')], masterEnabled: true }, [
      { id: 1, url: 'https://a.com/', active: true },
      { id: 2, url: 'https://b.com/' },
      { id: 3, url: 'https://c.com/' },
    ]);
    h.coordinator.start();
    await h.coordinator.syncAllTabs();
    expect([1, 2, 3].map((id) => h.action.stateOf(id))).toEqual([
      'active',
      'active',
      'active',
    ]);

    h.action.reset();
    h.setSettings({ masterEnabled: false });
    await flush();
    expect([1, 2, 3].map((id) => h.action.stateOf(id))).toEqual([
      'inactive',
      'inactive',
      'inactive',
    ]);
    expect(h.settings().rules).toHaveLength(1); // INV-8:规则原样保留

    h.action.reset();
    h.setSettings({ masterEnabled: true });
    await flush();
    expect([1, 2, 3].map((id) => h.action.stateOf(id))).toEqual([
      'active',
      'active',
      'active',
    ]);
  });

  it('主开关 OFF 时导航到匹配站点也不点亮', async () => {
    const h = harness({ rules: [rule('*')], masterEnabled: false }, []);
    h.coordinator.start();
    await flush();
    h.events.emitUpdated(5, { url: 'https://a.com/' }, { id: 5, url: 'https://a.com/' });
    await flush();
    expect(h.action.stateOf(5)).toBe('inactive');
  });
});

describe('tab 导航时解析适用规则(§6 T5 spec 第一条)', () => {
  it('onUpdated 带 url → 按新 URL 重算图标', async () => {
    const h = harness({ rules: [rule('weibo.com')] }, []);
    h.coordinator.start();
    await flush();

    h.events.emitUpdated(
      7,
      { url: 'https://weibo.com/' },
      { id: 7, url: 'https://weibo.com/' },
    );
    await flush();
    expect(h.action.stateOf(7)).toBe('active');

    h.events.emitUpdated(
      7,
      { url: 'https://zhihu.com/' },
      { id: 7, url: 'https://zhihu.com/' },
    );
    await flush();
    expect(h.action.stateOf(7)).toBe('inactive');
  });

  it('onUpdated 只报 status(加载进度)也重算 —— 图标应尽早正确', async () => {
    const h = harness({ rules: [rule('weibo.com')] }, []);
    h.coordinator.start();
    await flush();
    h.events.emitUpdated(7, { status: 'loading' }, { id: 7, url: 'https://weibo.com/' });
    await flush();
    expect(h.action.stateOf(7)).toBe('active');
  });

  it('🔴 与导航无关的 onUpdated(favicon/title)不触发 storage 读取', async () => {
    let reads = 0;
    const settings: FilterSettings = { ...defaultSettings(), rules: [rule('a.com')] };
    const action = new FakeAction();
    const events = new FakeEvents();
    const coordinator = new BackgroundCoordinator({
      tabs: new FakeTabs([]),
      action,
      events,
      messaging: new FakeMessaging(),
      readSettings: () => {
        reads++;
        return Promise.resolve(settings);
      },
      subscribeSettings: () => () => {},
    });
    coordinator.start();
    await flush();
    const before = reads;
    events.emitUpdated(1, {}, { id: 1, url: 'https://a.com/' });
    await flush();
    expect(reads).toBe(before);
  });

  it('onActivated → 回查 tab 的 URL 并重算(事件只给 id)', async () => {
    const h = harness({ rules: [rule('weibo.com')] }, [
      { id: 9, url: 'https://weibo.com/' },
    ]);
    h.coordinator.start();
    await flush();
    h.events.emitActivated(9);
    await flush();
    expect(h.action.stateOf(9)).toBe('active');
  });

  it('onActivated 的 tab 已不存在 → 不调 setIcon,不抛', async () => {
    const h = harness({ rules: [rule('weibo.com')] }, []);
    h.coordinator.start();
    await flush();
    h.action.reset();
    h.events.emitActivated(404);
    await flush();
    expect(h.action.calls).toEqual([]);
  });

  it('窗口焦点变化 → 重算新的当前 tab', async () => {
    const h = harness({ rules: [rule('weibo.com')] }, [
      { id: 1, url: 'https://weibo.com/', active: true },
    ]);
    h.coordinator.start();
    await flush();
    h.action.reset();
    h.events.emitFocusChanged(2);
    await flush();
    expect(h.action.stateOf(1)).toBe('active');
  });
});

describe('ADR-044 · 消息应答', () => {
  it('`{ type: "GET_TAB_STATE" }` 被认领,返回当前 tab 的完整 TabState', async () => {
    const h = harness({ rules: [rule('*.example.com'), rule('*')] }, [
      { id: 4, url: 'https://a.example.com/p', active: true },
      { id: 5, url: 'https://other.com/' },
    ]);
    h.coordinator.start();
    const result = h.messaging.send({ type: GET_TAB_STATE });
    expect(result).not.toBeNull();
    await expect(result).resolves.toEqual({
      tabId: 4,
      injectable: true,
      host: 'a.example.com',
      activeRuleIndex: 0,
      shadowedRuleIndexes: [1],
    });
  });

  it('🔴 不是本类的消息 → 返回 null(不占住通道,ADR-049 的 PREVIEW_FILTER 要能过)', () => {
    const h = harness({}, []);
    h.coordinator.start();
    expect(h.messaging.send({ type: 'PREVIEW_FILTER', mode: 'Grayscale' })).toBeNull();
    expect(h.messaging.send({ type: 'SOMETHING_ELSE' })).toBeNull();
    expect(h.messaging.send(null)).toBeNull();
    expect(h.messaging.send('GET_TAB_STATE')).toBeNull(); // 必须是对象且有 type
  });

  it('没有活动 tab → 降级为 no-tab(与 popup 侧超时降级同值)', async () => {
    const h = harness({ rules: [rule('*')] }, []);
    h.coordinator.start();
    await expect(h.messaging.send({ type: GET_TAB_STATE })).resolves.toEqual(
      FALLBACK_TAB_STATE,
    );
  });

  it('🔴 读设置失败也**永不 reject** —— 收敛为 FALLBACK_TAB_STATE', async () => {
    const action = new FakeAction();
    const messaging = new FakeMessaging();
    const errors: string[] = [];
    const coordinator = new BackgroundCoordinator({
      tabs: new FakeTabs([{ id: 1, url: 'https://a.com/', active: true }]),
      action,
      events: new FakeEvents(),
      messaging,
      readSettings: () => Promise.reject(new Error('storage exploded')),
      subscribeSettings: () => () => {},
      onError: (where) => errors.push(where),
    });
    coordinator.start();
    const result = messaging.send({ type: GET_TAB_STATE });
    await expect(result).resolves.toEqual(FALLBACK_TAB_STATE);
    expect(errors).toContain('handleMessage');
  });

  it('tabs.query 持续失败 → 降级为 no-tab,不抛', async () => {
    const h = harness({ rules: [rule('*')] }, [
      { id: 1, url: 'https://a.com/', active: true },
    ]);
    h.coordinator.start();
    // start() 自身的初始同步会先消耗一次 query —— 等它跑完再注入故障,
    // 否则被测的是初始同步而非消息路径。
    await flush();
    h.tabs.failAlways = true;
    await expect(h.messaging.send({ type: GET_TAB_STATE })).resolves.toEqual(
      FALLBACK_TAB_STATE,
    );
    expect(h.errors.some((e) => e.where === 'tabs.query')).toBe(true);
  });

  it('🔴 tabs.query 偶发失败一次 → 退到 currentWindow 查询并**自愈**', async () => {
    // 这不是「容忍失败」,而是刻意的双查询:`lastFocusedWindow` 在
    // popup 打开的瞬间于某些平台会取不到用户正在看的那个 tab
    // (见 #activeTab 的注释)。一次失败后仍必须给出正确答案,
    // 而不是谎称「此页面不支持滤镜」。
    const h = harness({ rules: [rule('a.com')] }, [
      { id: 1, url: 'https://a.com/', active: true },
    ]);
    h.coordinator.start();
    await flush();
    h.tabs.failNext = true;
    await expect(h.messaging.send({ type: GET_TAB_STATE })).resolves.toMatchObject({
      tabId: 1,
      injectable: true,
      host: 'a.com',
      activeRuleIndex: 0,
    });
  });

  it('isGetTabStateMessage 只认逐字的 type', () => {
    expect(isGetTabStateMessage({ type: 'GET_TAB_STATE' })).toBe(true);
    expect(isGetTabStateMessage({ type: 'get_tab_state' })).toBe(false);
    expect(isGetTabStateMessage({ type: 'GET_TAB_STATE ' })).toBe(false);
    expect(isGetTabStateMessage(undefined)).toBe(false);
  });
});

describe('ADR-013 · 不可注入页面向 popup 上报', () => {
  const cases: [string, string][] = [
    ['chrome://settings', 'internal-page'],
    ['https://chromewebstore.google.com/detail/x/y', 'web-store'],
    ['file:///Users/x/a.html', 'internal-page'],
    ['chrome://newtab/', 'new-tab'],
    ['https://example.com/doc.pdf', 'pdf'],
  ];

  for (const [url, reason] of cases) {
    it(`${url} → injectable:false, reason:'${reason}', host:null`, async () => {
      const h = harness({ rules: [rule('*')] }, [{ id: 2, url, active: true }]);
      h.coordinator.start();
      const state = await h.messaging.send({ type: GET_TAB_STATE });
      expect(state?.injectable).toBe(false);
      expect(state?.reason).toBe(reason);
      expect(state?.host).toBeNull();
      expect(state?.activeRuleIndex).toBeNull();
      // tabId 仍如实上报(ADR-049:popup 自己判定预览可用性)
      expect(state?.tabId).toBe(2);
    });
  }
});

describe('MV3 · service worker 不是真相来源(§6 T5 注)', () => {
  it('🔴 每次应答都重新读 settings,不复用快照', async () => {
    let value: FilterSettings = { ...defaultSettings(), rules: [] };
    const messaging = new FakeMessaging();
    const coordinator = new BackgroundCoordinator({
      tabs: new FakeTabs([{ id: 1, url: 'https://a.com/', active: true }]),
      action: new FakeAction(),
      events: new FakeEvents(),
      messaging,
      readSettings: () => Promise.resolve(value),
      subscribeSettings: () => () => {},
    });
    coordinator.start();

    await expect(messaging.send({ type: GET_TAB_STATE })).resolves.toMatchObject({
      activeRuleIndex: null,
    });

    // 模拟「worker 被终止、设置在别处被改、worker 再被唤醒」——
    // 没有任何订阅通知,协调器仍必须给出新设置下的答案。
    value = { ...value, rules: [rule('a.com')] };
    await expect(messaging.send({ type: GET_TAB_STATE })).resolves.toMatchObject({
      activeRuleIndex: 0,
    });
  });

  it('协调器无设置字段 —— 实例上不存在设置快照', () => {
    const h = harness({ rules: [rule('a.com')] }, []);
    h.coordinator.start();
    const serialized = JSON.stringify(h.coordinator);
    expect(serialized).not.toContain('masterEnabled');
    expect(serialized).not.toContain('a.com');
  });
});

describe('生命周期', () => {
  it('start() 幂等 —— 重复调用不装两套监听', async () => {
    const h = harness({ rules: [rule('a.com')] }, []);
    h.coordinator.start();
    h.coordinator.start();
    h.coordinator.start();
    expect(h.events.updated).toHaveLength(1);
    expect(h.events.activated).toHaveLength(1);
    expect(h.messaging.handlers).toHaveLength(1);
  });

  it('stop() 卸掉全部监听,之后事件不再被处理', async () => {
    const h = harness({ rules: [rule('a.com')] }, []);
    h.coordinator.start();
    await flush();
    h.coordinator.stop();
    h.action.reset();
    h.events.emitUpdated(1, { url: 'https://a.com/' }, { id: 1, url: 'https://a.com/' });
    await flush();
    expect(h.action.calls).toEqual([]);
    expect(h.messaging.send({ type: GET_TAB_STATE })).toBeNull();
  });

  it('stop() 后 start() 可重新挂载', () => {
    const h = harness({}, []);
    h.coordinator.start();
    h.coordinator.stop();
    h.coordinator.start();
    expect(h.events.updated).toHaveLength(1);
  });
});

describe('setIcon 失败的容错', () => {
  it('tab 在 await 之间被关闭 → 记诊断,不抛', async () => {
    const h = harness({ rules: [rule('a.com')] }, []);
    h.coordinator.start();
    await flush();
    h.action.failNext = true;
    h.events.emitUpdated(1, { url: 'https://a.com/' }, { id: 1, url: 'https://a.com/' });
    await flush();
    expect(h.errors.some((e) => e.where === 'setIcon')).toBe(true);
  });
});

describe('ADR-019 的文字版 · setTitle 两态', () => {
  it('两态标题不同,且与图标态一致', async () => {
    const h = harness({ rules: [rule('a.com')] }, []);
    h.coordinator.start();
    await flush();
    h.events.emitUpdated(1, { url: 'https://a.com/' }, { id: 1, url: 'https://a.com/' });
    h.events.emitUpdated(2, { url: 'https://b.com/' }, { id: 2, url: 'https://b.com/' });
    await flush();
    expect(h.action.titles.find((t) => t.tabId === 1)?.title).toBe(ICON_TITLES.active);
    expect(h.action.titles.find((t) => t.tabId === 2)?.title).toBe(ICON_TITLES.inactive);
    expect(ICON_TITLES.active).not.toBe(ICON_TITLES.inactive);
  });
});

describe('🔴 陈旧覆盖防护 —— 本轮由单测驱动发现的真实缺陷', () => {
  /**
   * 缺陷原文见 `coordinator.ts` 的 `#applyIcon` 长注释。
   *
   * 复现条件:一次「读旧设置」的慢更新与一次「读新设置」的快更新交错,
   * 旧的那次**后**完成 → 图标被旧设置的结论覆盖,并**持续**错误,
   * 直到下一个 tab 事件偶然纠正。
   *
   * 这里用可控的 `readSettings` 延迟精确制造该交错 —— 不靠时序运气。
   */
  function slowReadHarness(): {
    coordinator: BackgroundCoordinator;
    action: FakeAction;
    release: (() => void)[];
    setRules(rules: FilterRule[]): void;
    notify(): void;
  } {
    let settings: FilterSettings = { ...defaultSettings(), rules: [] };
    const listeners: (() => void)[] = [];
    const release: (() => void)[] = [];
    const action = new FakeAction();
    const coordinator = new BackgroundCoordinator({
      tabs: new FakeTabs([{ id: 1, url: 'https://a.example.com/', active: true }]),
      action,
      events: new FakeEvents(),
      messaging: new FakeMessaging(),
      // 每次读都挂住,由测试显式决定完成顺序。
      readSettings: () => {
        const snapshot = settings;
        return new Promise<FilterSettings>((resolve) => {
          release.push(() => resolve(snapshot));
        });
      },
      subscribeSettings: (l) => {
        listeners.push(l);
        return () => {};
      },
    });
    return {
      coordinator,
      action,
      release,
      setRules(rules) {
        settings = { ...settings, rules };
      },
      notify() {
        for (const l of [...listeners]) l();
      },
    };
  }

  it('读了旧设置的慢更新**不得**覆盖读了新设置的快更新', async () => {
    const h = slowReadHarness();

    h.coordinator.start(); // → syncActiveTab,读 A 开始(此刻 rules 为空)
    await flush();
    expect(h.release).toHaveLength(1);

    h.setRules([rule('*.example.com')]);
    h.notify(); // → syncAllTabs,读 B 开始(此刻已有规则)
    await flush();
    expect(h.release).toHaveLength(2);

    // 🔴 B 先完成(写入 active),A 后完成(算出 inactive)。
    h.release[1]?.();
    await flush();
    h.release[0]?.();
    await flush();

    expect(
      h.action.stateOf(1),
      '读旧设置的更新覆盖了新结果 —— ADR-019「亮 = 这页被改色了」失效',
    ).toBe('active');
  });

  it('正常顺序(旧先完成、新后完成)下新结果照常生效', async () => {
    const h = slowReadHarness();
    h.coordinator.start();
    await flush();
    h.setRules([rule('*.example.com')]);
    h.notify();
    await flush();

    h.release[0]?.(); // A(旧)先完成 → inactive
    await flush();
    h.release[1]?.(); // B(新)后完成 → active
    await flush();

    expect(h.action.stateOf(1)).toBe('active');
  });

  it('同一 tab 的连续导航:后发起的那次胜出', async () => {
    const h = slowReadHarness();
    h.coordinator.start();
    await flush();
    h.release[0]?.();
    await flush();
    h.action.reset();

    // 两次设置变更依次发起,第二次读到了「有规则」。
    h.notify();
    await flush();
    h.setRules([rule('*.example.com')]);
    h.notify();
    await flush();

    h.release[2]?.(); // 第二次(新)先完成 → active
    await flush();
    h.release[1]?.(); // 第一次(旧)后完成 → 必须被丢弃
    await flush();

    expect(h.action.stateOf(1)).toBe('active');
  });
});
