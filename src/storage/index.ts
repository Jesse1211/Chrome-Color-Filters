/**
 * 仓储层(T3)—— 基于 `chrome.storage.local`(ADR-010,非 sync)。
 *
 * 🔴 **锁定强制点在 `settings-repository.ts`(INV-14 / ADR-055)。**
 * 上层(popup / background / content script)只应通过本模块读写设置;
 * 直接调用 `chrome.storage.*` 会绕开锁定强制,等于把锁变成假锁。
 */
export * from './errors.js';
export * from './storage-area.js';
export * from './settings-repository.js';
export * from './memory-storage-area.js';
