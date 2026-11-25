/**
 * `chrome.alarms` 的**生产装配**(ADR-077)——
 * 唯一接触 `chrome.alarms` 的地方。
 *
 * 与 `background-ports.ts` / `scripting-port.ts` 同一手法(ADR-062 建立的模式):
 * 把平台调用收束在一个薄模块里,使 `lock-expiry.ts` 保持零 `chrome.*`、
 * 可在 Node 下完整单测。
 *
 * ## 不装 `@types/chrome`
 *
 * 与同目录的 `background-ports.ts` 理由一致:本项目没装它,
 * 此处就地声明所需形状,边界检查兜底。
 *
 * ## 平台不可用时降级为「什么都不做」,绝不抛
 *
 * SW 入口在单测/非扩展上下文里也会被求值(WXT 的入口收集)。入口抛异常
 * 会让整个 service worker 起不来,**连带 T4a 的声明式注册一起失效** ——
 * 那是 INV-3 的主路径。故平台缺失时返回降级端口。
 *
 * ⚠️ 降级端口会让到期自动关闭**失去闹钟这条触发线**,但另两条
 * (SW 启动补偿、popup 的 UI 时钟)不依赖本端口,仍然成立 ——
 * 这正是 ADR-077 要三条独立触发线的原因。
 */

import { type AlarmsPort } from './lock-expiry.js';

interface ChromeAlarmsLike {
  create(name: string, info: { when: number }): Promise<void> | void;
  clear(name: string): Promise<boolean> | void;
  onAlarm: {
    addListener(cb: (alarm: { name: string }) => void): void;
    removeListener(cb: (alarm: { name: string }) => void): void;
  };
}

function chromeAlarms(): ChromeAlarmsLike | null {
  try {
    const g = globalThis as { chrome?: { alarms?: ChromeAlarmsLike } };
    const alarms = g.chrome?.alarms;
    // 三件都要在 —— 缺任一就不是一个可用的 alarms 实现(权限漏声明时
    // `chrome.alarms` 整个为 undefined,这正是最可能的失败模式)。
    if (
      alarms === undefined ||
      typeof alarms.create !== 'function' ||
      typeof alarms.clear !== 'function' ||
      alarms.onAlarm === undefined
    ) {
      return null;
    }
    return alarms;
  } catch {
    return null;
  }
}

/** 降级端口 —— 平台没有 `chrome.alarms` 时用它,保证 SW 入口不抛。 */
const NULL_ALARMS: AlarmsPort = {
  create: () => Promise.resolve(),
  clear: () => Promise.resolve(),
  onAlarm: () => () => {
    /* 没有平台事件源,取消订阅也无事可做 */
  },
};

export function defaultAlarmsPort(): AlarmsPort {
  const alarms = chromeAlarms();
  if (alarms === null) return NULL_ALARMS;

  return {
    create: async (name, info) => {
      // 平台在 MV3 下返回 Promise(Chrome 111+),老签名返回 void ——
      // `await` 对两者都正确。
      await alarms.create(name, { when: info.when });
    },
    clear: async (name) => {
      await alarms.clear(name);
    },
    onAlarm: (listener) => {
      const cb = (alarm: { name: string }): void => {
        listener(alarm?.name ?? '');
      };
      alarms.onAlarm.addListener(cb);
      return () => alarms.onAlarm.removeListener(cb);
    },
  };
}
