/**
 * T7 门禁探针的入口 —— **只做一件事:把真实仓储层挂到页面全局**。
 *
 * 🔴 本文件**不属于产品**,不被 manifest 引用,不出现在任何产品代码路径上。
 * 它存在的唯一理由是 INV-14 的验收要求「绕过 UI 直接调用仓储层 API」
 * (§6 T3 原文),而产品代码刻意没有把仓储层实例挂到全局 —— 那是对的。
 *
 * 这里导入的是 `src/storage/index.ts` 的**真实导出**,一字未改:
 * 锁定强制(`#assertWritable`)、`effectiveNow` 的单调下界、
 * `canSetLockUntil` 的单向性、ADR-057 的原子写入,全部是产品实现。
 * 默认 StorageArea 即真实 `chrome.storage.local`(ADR-010)。
 */
import { SettingsRepository } from '../../src/storage/index.js';

declare global {
  // eslint-disable-next-line no-var
  var __ccfT7Repo: SettingsRepository | undefined;
  // eslint-disable-next-line no-var
  var __ccfT7RepoCtor: typeof SettingsRepository | undefined;
}

globalThis.__ccfT7Repo = new SettingsRepository();
globalThis.__ccfT7RepoCtor = SettingsRepository;

export { SettingsRepository };
