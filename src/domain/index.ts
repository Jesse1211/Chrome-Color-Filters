/**
 * 领域层公开入口(ADR-036)。
 *
 * `src/domain` 为**纯 TypeScript**:零 React、零 `chrome.*`、零 WXT API。
 * 该约束由 `src/domain/__tests__/purity.test.ts` 的静态检查强制(gate,不是建议)。
 */

export * from './filter-mode.js';
export * from './intensity.js';
export * from './glob.js';
export * from './filter-rule.js';
export * from './filter-settings.js';
export * from './resolve-rule.js';
export * from './filter-css.js';
