/**
 * 注入层(T4a)公开入口。
 *
 * 分工:
 * - `filter.css`        —— 静态样式表,首帧之前就位(INV-3 的落点)
 * - `apply-filter.ts`   —— DOM 侧原语(属性 + CSS 变量,无节点注入)
 * - `fast-path-cache.ts`—— 同步快路径,绕开 `chrome.storage` 的异步性
 * - `injector.ts`       —— 编排 + INV-8 短路
 */
export * from './apply-filter.js';
export * from './fast-path-cache.js';
export * from './injector.js';
