/**
 * ADR-044 · `GET_TAB_STATE` 消息契约。
 *
 * T6a 不依赖 T5(§6 T6a 的 depends_on 只有 T3)—— 契约已写死在 DESIGN.md 中,
 * 本文件把它钉成可执行的断言,使 T5 合并时的错配能在 REAL_STACK_GATE 之前
 * 就有一份明确的对照。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  FALLBACK_TAB_STATE,
  GET_TAB_STATE,
  NOT_INJECTABLE_MESSAGE,
  chromeTabStatePort,
  coerceTabState,
  stubTabStatePort,
} from '../tab-state.js';

describe('ADR-044 · 契约常量', () => {
  it('消息类型逐字为 GET_TAB_STATE', () => {
    expect(GET_TAB_STATE).toBe('GET_TAB_STATE');
  });

  it('超时降级值为 injectable:false, reason:"no-tab"(ADR-044 逐字)', () => {
    expect(FALLBACK_TAB_STATE.injectable).toBe(false);
    expect(FALLBACK_TAB_STATE.reason).toBe('no-tab');
    expect(FALLBACK_TAB_STATE.tabId).toBeNull();
    expect(FALLBACK_TAB_STATE.host).toBeNull();
    expect(FALLBACK_TAB_STATE.activeRuleIndex).toBeNull();
    expect(FALLBACK_TAB_STATE.shadowedRuleIndexes).toEqual([]);
  });

  it('不可注入的说明文案与 §5.4 一致(ADR-013:说明原因)', () => {
    expect(NOT_INJECTABLE_MESSAGE).toBe(
      '此页面不支持滤镜。Chrome 不允许扩展修改内部页面、应用商店和 PDF 查看器。',
    );
  });
});

describe('coerceTabState', () => {
  it('完整契约响应原样通过', () => {
    const state = coerceTabState({
      tabId: 3,
      injectable: true,
      host: 'weibo.com',
      activeRuleIndex: 0,
      shadowedRuleIndexes: [1, 2],
    });
    expect(state).toEqual({
      tabId: 3,
      injectable: true,
      host: 'weibo.com',
      activeRuleIndex: 0,
      shadowedRuleIndexes: [1, 2],
    });
  });

  it('五种 reason 取值都被接受', () => {
    for (const reason of ['internal-page', 'web-store', 'pdf', 'new-tab', 'no-tab'] as const) {
      expect(coerceTabState({ injectable: false, reason }).reason).toBe(reason);
    }
  });

  it('未知 reason 被丢弃而非原样透传', () => {
    expect(coerceTabState({ injectable: false, reason: 'wat' }).reason).toBeUndefined();
  });

  it('shadowedRuleIndexes 被强制升序(契约要求升序)', () => {
    expect(
      coerceTabState({ injectable: true, shadowedRuleIndexes: [3, 1, 2] })
        .shadowedRuleIndexes,
    ).toEqual([1, 2, 3]);
  });

  it('畸形响应回退降级值,**不抛异常**', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { injectable: 'yes' }]) {
      expect(coerceTabState(bad)).toEqual(FALLBACK_TAB_STATE);
    }
  });
});

describe('chromeTabStatePort', () => {
  it('无 chrome.runtime 时降级,不抛异常', async () => {
    expect(await chromeTabStatePort()()).toEqual(FALLBACK_TAB_STATE);
  });

  it('发出的消息体为 { type: "GET_TAB_STATE" }', async () => {
    const sendMessage = vi.fn(() =>
      Promise.resolve({
        tabId: 1,
        injectable: true,
        host: 'x.com',
        activeRuleIndex: null,
        shadowedRuleIndexes: [],
      }),
    );
    (globalThis as Record<string, unknown>).chrome = { runtime: { sendMessage } };
    try {
      const state = await chromeTabStatePort()();
      expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_TAB_STATE' });
      expect(state.host).toBe('x.com');
    } finally {
      delete (globalThis as Record<string, unknown>).chrome;
    }
  });

  it('service worker 休眠(超时)→ 降级为 no-tab', async () => {
    const sendMessage = vi.fn(() => new Promise<unknown>(() => undefined));
    (globalThis as Record<string, unknown>).chrome = { runtime: { sendMessage } };
    try {
      const state = await chromeTabStatePort(5)();
      expect(state).toEqual(FALLBACK_TAB_STATE);
    } finally {
      delete (globalThis as Record<string, unknown>).chrome;
    }
  });

  it('sendMessage 抛错(无接收方)→ 降级,不抛异常', async () => {
    const sendMessage = vi.fn(() =>
      Promise.reject(new Error('Could not establish connection')),
    );
    (globalThis as Record<string, unknown>).chrome = { runtime: { sendMessage } };
    try {
      expect(await chromeTabStatePort(50)()).toEqual(FALLBACK_TAB_STATE);
    } finally {
      delete (globalThis as Record<string, unknown>).chrome;
    }
  });
});

describe('stubTabStatePort(T6a 在 T5 合并前对着它开发)', () => {
  it('按 partial 覆盖降级值', async () => {
    const state = await stubTabStatePort({
      injectable: true,
      host: 'weibo.com',
      activeRuleIndex: 1,
    })();
    expect(state.injectable).toBe(true);
    expect(state.host).toBe('weibo.com');
    expect(state.activeRuleIndex).toBe(1);
  });
});
