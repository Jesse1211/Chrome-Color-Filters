/**
 * 注入层(T4a)公开入口。
 *
 * ## 两条路径,分工明确(ADR-062)
 *
 * **A. 声明式注册 —— 首帧的承担者,INV-3 的主路径:**
 * - `filter-file-css.ts` —— 预生成 CSS 文件的内容与命名(ADR-063)
 * - `match-pattern.ts`   —— glob(ADR-005/006)→ Chrome match pattern(超集)
 * - `reconcile.ts`       —— 幂等、基于 diff 的注册 reconcile(ADR-064)
 * - `reconciler.ts`      —— 四个触发点 + 并发串行化(ADR-065)
 * - `scripting-port.ts`  —— 唯一接触 `chrome.scripting` 的地方
 *
 * **B. JS content script —— 已打开页面的实时更新:**
 * - `filter.css`        —— 静态样式表(门控 + CSS 变量)
 * - `apply-filter.ts`   —— DOM 侧原语(属性 + CSS 变量,无节点注入)
 * - `fast-path-cache.ts`—— 同步快路径(ADR-060,**降级为过渡期双重保险**)
 * - `fast-path-store.ts` —— 快路径的底层存储装配
 * - `injector.ts`       —— 编排 + INV-8 短路 + 渲染仲裁(T4b)
 *
 * **C. T4b 新增 —— 存活性 / 预览 / 隐私:**
 * - `liveness.ts`         —— MutationObserver 恢复,开销有界(INV-5 / ADR-017)
 * - `preview-contract.ts` —— `PREVIEW_FILTER` / `PREVIEW_CLEAR` 消息契约(ADR-049)
 * - `preview-receiver.ts` —— 预览接收端 + `RenderArbiter`(唯一 DOM 写入点)
 *
 * 🔴 **`RenderArbiter` 是 T4b 的结构性约束**:三条路径(规则解析 / 预览覆盖 /
 * 存活性恢复)都只能经它写 DOM,ADR-049 的「覆盖优先、底层不重绘」
 * 因而是**结构**保证,不靠每个调用点记得判断。
 *
 * 🔴 **路径 B 不能删**:注册变更**不影响已打开的标签页**
 * (Chrome 既定行为:「取消注册不会移除已注入的样式」),
 * 所以仍需 JS 路径给已打开页面做实时更新。
 * 那条路径**时序无关紧要** —— 页面已经画完了。
 * 注册管的是**下一次导航**,那才是 INV-3 的路径。
 */
export * from './apply-filter.js';
export * from './fast-path-cache.js';
export * from './fast-path-store.js';
export * from './filter-file-css.js';
export * from './injector.js';
export * from './liveness.js';
export * from './preview-contract.js';
export * from './preview-receiver.js';
export * from './match-pattern.js';
export * from './reconcile.js';
export * from './reconciler.js';
export * from './scripting-port.js';
