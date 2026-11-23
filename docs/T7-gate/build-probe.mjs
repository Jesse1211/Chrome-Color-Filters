// ═══════════════════════════════════════════════════════════════════════════
// 把**真实的仓储层源码**打成一个可在扩展页面上下文里 import 的 ES 模块。
// ═══════════════════════════════════════════════════════════════════════════
//
// 🔴 **为什么需要这个,以及为什么它不是「偷懒的 mock」:**
//
// INV-14 的全文是「锁定检查必须在**仓储层**(T3)强制,而非仅靠 UI 置灰」,
// 且 §6 T3 明文要求验证时「**必须绕过 UI 直接调用仓储层 API**」。
// 于是 T7 的锁定端到端门禁需要一条「在真实 Chrome 里、对着真实
// `chrome.storage.local`、绕过 UI 调仓储层」的路径。
//
// 现实约束:
//   - 产品的 `SettingsRepository` 实例在 service worker 与 popup 的
//     **模块作用域/组件内部**,没有挂到任何全局 —— 这是**对的**,
//     产品代码不该为测试开后门(§8 第 3 条:不得编造「约定」);
//   - 打包产物是 minified ESM,没有导出仓储层;
//   - 故门禁需要自己把**同一份源码**编译一份出来。
//
// 本脚本编译的是 `src/storage/index.ts` → `src/storage/settings-repository.ts`
// **一字不改的真实源码**。它在扩展页面上下文里 `new SettingsRepository()`,
// 默认 StorageArea 就是真实的 `chrome.storage.local`(见
// `storage-area.ts` 的 `chromeLocalStorageArea`)。因此:
//
//   锁定判定、`effectiveNow`、`canSetLockUntil`、ADR-057 的原子写入 ——
//   **全部是产品代码在真实浏览器里真实执行**,不是替身。
//
// 唯一与产品路径的差别是「这个实例由门禁构造」,而这恰恰是
// INV-14 要的「绕过 UI 的写入路径」。
//
// 产物落在 `.output/chrome-mv3/` 下(必须在扩展目录内才能被扩展页面
// import —— 扩展页面不能 import 扩展包外的文件),文件名带 `t7-probe`
// 前缀以示它不属于产品。它**不被 manifest 引用**,不参与任何产品路径。
//
// 用法:node docs/T7-gate/build-probe.mjs

import { build } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');

await build({
  configFile: false,
  root,
  logLevel: 'warn',
  build: {
    emptyOutDir: false,
    outDir: path.join(root, '.output', 'chrome-mv3'),
    lib: {
      entry: path.join(root, 'docs', 'T7-gate', 'probe-entry.ts'),
      formats: ['es'],
      fileName: () => 't7-probe.js',
    },
    minify: false,
    rollupOptions: {
      // 不打进任何 polyfill;扩展页面是现代 Chrome。
      external: [],
    },
  },
});

console.log('已生成 .output/chrome-mv3/t7-probe.js(含真实仓储层源码)');
