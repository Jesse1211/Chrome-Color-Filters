/**
 * 🔴 门禁专用探针 —— **绕过 UI 的写入路径**(INV-14 / ADR-055 要验的那条)。
 *
 * ADR-055 原文:「绕过 UI 的写入(如从 service worker 或控制台发起)同样必须被拒绝」。
 * T3 的 REAL_STACK_GATE 当年是**人工**执行的,且原文留了一句
 * 「若无法 import,等价地确认 UI 层之外的写入路径同样被拒」—— 也就是说
 * 这条路径此前从未被机械验证过。T7 用本文件把它钉死。
 *
 * ⚠️ 本文件**不进产品**:它由 `docs/T7-gate/build-probe.mjs` 单独打包进
 * `.output/chrome-mv3/ccf-repo-probe.js`,仅供门禁运行时 `import()`。
 * `npm run build` 不产出它(WXT 只认 `entrypoints/`)。
 *
 * 🔴 关键:它 import 的是 `src/storage/settings-repository.ts` ——
 * **产品自己的那一份仓储层源码**,不是替身。锁定强制点就在那里。
 */
import { matchGlob } from '../../../src/domain/glob.js';
import { SettingsRepository } from '../../../src/storage/settings-repository.js';
import { chromeLocalStorageArea } from '../../../src/storage/storage-area.js';

/**
 * 🔴 **产品自己的** `matchGlob` 原样导出 —— 供 INV-10 在真实页面上下文里
 * 直接测它的耗时。
 *
 * 为什么必须导出而不是在门禁里抄一份:产品的 `matchGlob` 并不是单纯的
 * 双指针循环,它在 `matchGlobStrict` 之外还按 ADR-006 的省略规则
 * **最多再调 3 次**(省略首部 `*.`、省略尾部 `.*`、两端同时省略)。
 * 抄一份就是在测**另一个算法**,而且会随产品演进静默漂移。
 */
export { matchGlob };

const repo = new SettingsRepository({ area: chromeLocalStorageArea() });

export async function probe(op: string, arg: unknown): Promise<unknown> {
  switch (op) {
    case 'read':
      return { ok: true, value: await repo.read() };
    case 'isCurrentlyLocked':
      return { ok: true, value: await repo.isCurrentlyLocked() };
    case 'addRule':
      return await repo.addRule(arg as never);
    case 'removeRule':
      return await repo.removeRule(arg as number);
    case 'updateRule': {
      const a = arg as { index: number; patch: Record<string, unknown> };
      return await repo.updateRule(a.index, a.patch as never);
    }
    case 'replaceRules':
      return await repo.replaceRules(arg as never);
    case 'reorderRule': {
      const a = arg as { from: number; to: number };
      return await repo.reorderRule(a.from, a.to);
    }
    case 'setMasterEnabled':
      return await repo.setMasterEnabled(arg as boolean);
    case 'setLockUntil':
      return await repo.setLockUntil(arg as number | null);
    case 'setLockUntilImmediate':
      return await repo.setLockUntilImmediate(arg as number | null);
    default:
      throw new Error(`未知操作:${op}`);
  }
}
