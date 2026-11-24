/**
 * `createPreviewChannel` —— 预览**发送端**的契约测试(ADR-049)。
 *
 * 纯逻辑,不需要 DOM —— 环境保持默认的 node。
 *
 * 🔴 本文件把发送端与 T4b 的**接收端**接在一起跑过一遍:
 * 契约不符在这里就会暴露,不必等真实栈(§6.2 风险表里
 * 「`PREVIEW_FILTER` 接收端与 ADR-049 契约不符」那一行)。
 */
import { describe, expect, it, vi } from 'vitest';

import { filterCssValue } from '../../domain/index.js';
import {
  PREVIEW_CLEAR,
  PREVIEW_FILTER,
  PREVIEW_PORT_NAME,
  coercePreviewMessage,
} from '../../injection/preview-contract.js';
import {
  type PreviewPortLike,
  attachPreviewPort,
  createRenderArbiter,
} from '../../injection/preview-receiver.js';
import { type FilterTarget } from '../../injection/apply-filter.js';
import {
  type PreviewSenderPort,
  chromePreviewConnect,
  createPreviewChannel,
  nullPreviewChannel,
} from '../preview-port.js';

function fakePort() {
  const sent: unknown[] = [];
  let disconnects = 0;
  const port: PreviewSenderPort = {
    postMessage(message) {
      sent.push(message);
    },
    disconnect() {
      disconnects += 1;
    },
  };
  return {
    port,
    sent,
    get disconnects() {
      return disconnects;
    },
  };
}

describe('ADR-049 · 发送端的端口生命周期', () => {
  it('惰性连接:在第一次 sendFilter 之前不 connect', () => {
    const connect = vi.fn(() => fakePort().port);
    const channel = createPreviewChannel(connect);
    expect(channel.isOpen()).toBe(false);
    channel.sendClear(); // 没套过预览 → no-op
    expect(connect).not.toHaveBeenCalled();
  });

  it('sendFilter 用传入的 tabId 连接,消息形状与契约一致', () => {
    const f = fakePort();
    const channel = createPreviewChannel(() => f.port);
    channel.sendFilter(42, 'Grayscale', 60);
    expect(channel.isOpen()).toBe(true);
    expect(channel.connectedTabId()).toBe(42);
    expect(f.sent).toEqual([
      { type: PREVIEW_FILTER, mode: 'Grayscale', intensity: 60 },
    ]);
  });

  it('同一个 tab 的连续发送复用同一个端口(不反复重连)', () => {
    const connect = vi.fn(() => fakePort().port);
    const channel = createPreviewChannel(connect);
    channel.sendFilter(1, 'Grayscale', 100);
    channel.sendFilter(1, 'Grayscale', 90);
    channel.sendFilter(1, 'Grayscale', 80);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('🔴 换了 tab → 先对旧端口发 PREVIEW_CLEAR 再断开,然后连新 tab', () => {
    const first = fakePort();
    const second = fakePort();
    const ports = [first.port, second.port];
    let i = 0;
    const channel = createPreviewChannel(() => ports[i++] ?? null);

    channel.sendFilter(1, 'Grayscale', 100);
    // ADR-075:换 tab 时用**不同强度**区分两次发送(只剩一个模式)。
    channel.sendFilter(2, 'Grayscale', 50);

    // 旧 tab 不得残留预览(「绝不能把 B 站滤镜套到 A 站」的同一条保证)。
    expect(first.sent).toEqual([
      { type: PREVIEW_FILTER, mode: 'Grayscale', intensity: 100 },
      { type: PREVIEW_CLEAR },
    ]);
    expect(first.disconnects).toBe(1);
    expect(second.sent).toEqual([
      { type: PREVIEW_FILTER, mode: 'Grayscale', intensity: 50 },
    ]);
    expect(channel.connectedTabId()).toBe(2);
  });

  it('sendClear **不断开端口** —— 「返回」时 popup 仍开着(B1)', () => {
    const f = fakePort();
    const channel = createPreviewChannel(() => f.port);
    channel.sendFilter(1, 'Grayscale', 100);
    channel.sendClear();
    expect(f.sent.at(-1)).toEqual({ type: PREVIEW_CLEAR });
    expect(f.disconnects).toBe(0);
    expect(channel.isOpen()).toBe(true);
  });

  it('close() 断开端口', () => {
    const f = fakePort();
    const channel = createPreviewChannel(() => f.port);
    channel.sendFilter(1, 'Grayscale', 100);
    channel.close();
    expect(f.disconnects).toBe(1);
    expect(channel.isOpen()).toBe(false);
  });

  it('连不上(返回 null)时不抛异常,也不假装连上了', () => {
    const channel = nullPreviewChannel();
    expect(() => {
      channel.sendFilter(1, 'Grayscale', 100);
      channel.sendClear();
      channel.close();
    }).not.toThrow();
    expect(channel.isOpen()).toBe(false);
  });

  it('postMessage 抛错(对端已消失)时丢掉端口而不抛出', () => {
    const port: PreviewSenderPort = {
      postMessage() {
        throw new Error('Attempting to use a disconnected port object');
      },
      disconnect() {
        /* no-op */
      },
    };
    const channel = createPreviewChannel(() => port);
    expect(() => {
      channel.sendFilter(1, 'Grayscale', 100);
    }).not.toThrow();
    expect(channel.isOpen()).toBe(false);
  });
});

describe('🔴 ADR-049 · 不碰 chrome.tabs.query(发送端的依赖面)', () => {
  it('chromePreviewConnect 只用 chrome.tabs.connect,且端口名为契约常量', () => {
    const calls: { tabId: number; name: string }[] = [];
    const query = vi.fn();
    const globalWithChrome = globalThis as unknown as {
      chrome?: unknown;
    };
    const saved = globalWithChrome.chrome;
    globalWithChrome.chrome = {
      tabs: {
        connect(tabId: number, info: { name: string }) {
          calls.push({ tabId, name: info.name });
          return fakePort().port;
        },
        query,
      },
    };
    try {
      const connect = chromePreviewConnect();
      const port = connect(9);
      expect(port).not.toBeNull();
      expect(calls).toEqual([{ tabId: 9, name: PREVIEW_PORT_NAME }]);
      // 🔴 ADR-049:tab 解析的真相来源唯一归 T5,popup 不得自己查。
      expect(query).not.toHaveBeenCalled();
    } finally {
      globalWithChrome.chrome = saved;
    }
  });

  it('非扩展环境(无 chrome.tabs)→ 返回 null,不抛异常', () => {
    const globalWithChrome = globalThis as unknown as { chrome?: unknown };
    const saved = globalWithChrome.chrome;
    globalWithChrome.chrome = undefined;
    try {
      expect(chromePreviewConnect()(1)).toBeNull();
    } finally {
      globalWithChrome.chrome = saved;
    }
  });
});

describe('🔴 发送端 ⇄ 接收端(T4b)的端到端契约', () => {
  /** 把发送端的消息直接喂给 T4b 的接收端,验证契约真的对得上。 */
  function wired() {
    // 与 `src/injection/__tests__/preview.test.ts` 的 `makeTarget` 同形 ——
    // 复用接收端自己的那套替身形状,避免两边对 `FilterTarget` 理解漂移。
    const attrs = new Map<string, string>();
    const props = new Map<string, string>();
    const target: FilterTarget = {
      setAttribute: (n, v) => void attrs.set(n, v),
      removeAttribute: (n) => void attrs.delete(n),
      hasAttribute: (n) => attrs.has(n),
      style: {
        setProperty: (n, v) => void props.set(n, v),
        removeProperty: (n) => void props.delete(n),
        getPropertyValue: (n) => props.get(n) ?? '',
      },
    };

    const arbiter = createRenderArbiter(target, null);

    let onMessage: ((message: unknown) => void) | null = null;
    const receiverPort: PreviewPortLike = {
      name: PREVIEW_PORT_NAME,
      onMessage: {
        addListener(listener) {
          onMessage = listener;
        },
      },
      onDisconnect: { addListener() { /* no-op */ } },
    };
    attachPreviewPort(receiverPort, arbiter);

    const senderPort: PreviewSenderPort = {
      postMessage(message) {
        onMessage?.(message);
      },
      disconnect() {
        /* no-op */
      },
    };
    const channel = createPreviewChannel(() => senderPort);

    return { channel, arbiter };
  }

  it('PREVIEW_FILTER 被接收端识别,覆盖值 = filterCssValue(mode, intensity)', () => {
    const { channel, arbiter } = wired();
    channel.sendFilter(1, 'Grayscale', 60);
    expect(arbiter.hasOverride()).toBe(true);
    expect(arbiter.current()).toBe(filterCssValue('Grayscale', 60));
  });

  it('PREVIEW_CLEAR 被接收端识别,覆盖撤除', () => {
    const { channel, arbiter } = wired();
    channel.sendFilter(1, 'Grayscale', 100);
    channel.sendClear();
    expect(arbiter.hasOverride()).toBe(false);
  });

  it('发送端产出的消息全部能通过 coercePreviewMessage(不被当成畸形丢弃)', () => {
    const captured: unknown[] = [];
    const channel = createPreviewChannel(() => ({
      postMessage(message) {
        captured.push(message);
      },
      disconnect() {
        /* no-op */
      },
    }));
    // 两端边界强度 —— ADR-003 要求 0 与 100 均可达,
    // 且 0 是最容易被「falsy 判断」误丢的那个值。
    channel.sendFilter(1, 'Grayscale', 0);
    channel.sendFilter(1, 'Grayscale', 100);
    channel.sendClear();

    expect(captured).toHaveLength(3);
    for (const message of captured) {
      expect(coercePreviewMessage(message)).not.toBeNull();
    }
  });
});
