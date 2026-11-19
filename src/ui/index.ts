/**
 * Popup UI 层的公开入口。
 *
 * §5.1 的设计 token(`tokens.css`)与 §5.2 的滤镜标识(`filter-identity.ts`)
 * 是**共享基础**,由 T6a 建立,T6b / T6c 复用(§6 T6a spec)。
 */

export * from './filter-identity.js';
export * from './tab-state.js';
export * from './save-error.js';
export * from './strings.js';
export * from './components/FilterSwatch.js';
export * from './components/RuleRow.js';
export * from './RuleListView.js';
export * from './usePopupSettings.js';
