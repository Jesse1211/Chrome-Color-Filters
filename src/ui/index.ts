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

/* ── 编辑视图(T6b · §5.5 / §5.6 / §5.7)── */
export * from './edit-strings.js';
export * from './pattern-status.js';
export * from './preview-port.js';
export * from './usePreview.js';
export * from './components/FilterModeOption.js';
export * from './RuleEditView.js';

/* ── 锁定 UI(T6c · §5.4 第六种状态变体)── */
export * from './lock-duration.js';
export * from './lock-format.js';
export * from './lock-strings.js';
export * from './useLockClock.js';
export * from './useLockState.js';
export * from './components/LockDurationPicker.js';
export * from './components/LockConfirmDialog.js';
export * from './LockTimerEntry.js';
export * from './LockCountdownBanner.js';
