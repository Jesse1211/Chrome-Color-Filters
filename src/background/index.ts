/**
 * 后台协调层(T5)公开入口。
 *
 * | 模块 | 职责 | ADR |
 * |------|------|-----|
 * | `injectable-url.ts`     | 不可注入页面识别 + `reason` 取值 | ADR-013 / ADR-044 |
 * | `compute-tab-state.ts`  | `GET_TAB_STATE` 响应计算(纯函数) | ADR-044 |
 * | `icon-state.ts`         | 图标两态判定 + 资源路径 | ADR-019 / ADR-045 |
 * | `coordinator.ts`        | tab 协调、图标更新、消息应答(零 `chrome.*`) | ADR-013/014/019/027/044 |
 * | `background-ports.ts`   | 唯一接触 `chrome.tabs` / `chrome.action` 的装配 | — |
 * | `lock-expiry.ts`        | 🔒 锁定到期自动关闭的**触发器**(零 `chrome.*`) | ADR-077 |
 * | `alarms-port.ts`        | 唯一接触 `chrome.alarms` 的装配 | ADR-077 |
 *
 * 🔴 声明式注册的 `reconcile()`(ADR-062/064/065)**不在本层** ——
 * 它由 T4a 实现于 `src/injection/`,两者在 `entrypoints/background.ts` 中共存:
 * reconcile 管首帧注册,本层管运行时的 tab 协调与图标。
 */
export * from './injectable-url.js';
export * from './compute-tab-state.js';
export * from './icon-state.js';
export * from './coordinator.js';
export * from './background-ports.js';
export * from './lock-expiry.js';
export * from './alarms-port.js';
