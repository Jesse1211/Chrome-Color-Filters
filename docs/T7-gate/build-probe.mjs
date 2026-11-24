// 把门禁探针(docs/T7-gate/probe/repo-probe.src.ts)打包进构建产物。
// 用仓库自带的 rolldown(vite 8 的打包器),不新增依赖。
// 🔴 产出物 `.output/chrome-mv3/ccf-repo-probe.js` **仅供门禁 import()**,
//    不在 manifest 里、不被任何产品代码引用,`npm run build` 会把它冲掉
//    (因为 WXT 清空 .output)—— 这正是我们想要的:它不可能溜进发布包。
import { rolldown } from 'rolldown';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const bundle = await rolldown({
  input: path.join(here, 'probe', 'repo-probe.src.ts'),
  platform: 'browser',
  resolve: { extensionAlias: { '.js': ['.ts', '.js'] } },
});
await bundle.write({
  file: path.join(root, '.output', 'chrome-mv3', 'ccf-repo-probe.js'),
  format: 'esm',
  inlineDynamicImports: true,
});
await bundle.close();

// 🔴 再写一个承载页。
//
// 为什么需要页面而不能直接在 service worker 里 `import()`:
// HTML 规范**禁止** `ServiceWorkerGlobalScope` 上的动态 `import()`
// (实测报错 "import() is disallowed on ServiceWorkerGlobalScope"),
// 而 MV3 的 SW 是 classic script,也不能用 `importScripts` 加载 ESM。
//
// 换成扩展**页面**不削弱这条门禁:ADR-055 要验的是「**绕过 UI** 的写入
// 路径同样被拒」,而本页面
//   - 与 popup 同一个扩展 origin、同一份 `chrome.storage.local`;
//   - 调用的是**产品自己的** `SettingsRepository`(由本脚本从
//     `src/storage/settings-repository.ts` 打包而来,不是替身);
//   - **完全不经过任何 popup UI 组件** —— 没有 React、没有 RuleListView、
//     没有 useLockState,UI 的置灰在这里物理上不存在。
// 这正是「从控制台发起的写入」的等价物(ADR-055 原文点名的那种)。
//
// ⚠️ 承载页里**不能写内联 script**:扩展页面的 CSP 是 `script-src 'self'`
//    (实测报错 "Executing inline script violates ... 'script-src 'self''"),
//    内联脚本会被静默拦掉,页面看起来加载成功但探针根本没装上。
//    故再写一个**外部**模块脚本 `ccf-repo-probe-boot.js`。
import fsp from 'node:fs/promises';
const outDir = path.join(root, '.output', 'chrome-mv3');
await fsp.writeFile(
  path.join(outDir, 'ccf-repo-probe-boot.js'),
  `import { probe } from './ccf-repo-probe.js';
window.__ccfProbe = probe;
window.__ccfProbeReady = true;
`,
);
await fsp.writeFile(
  path.join(outDir, 'ccf-repo-probe.html'),
  `<!doctype html><meta charset="utf-8"><title>ccf gate probe</title>
<script type="module" src="./ccf-repo-probe-boot.js"></script>`,
);
// 🔴 再打一个 **IIFE** 版本,挂到全局变量上。
//
// 用途:INV-10 要在**扩展的 isolated world** 里测产品自己的 `matchGlob`。
// 那里既不能 `import()` 扩展资源(需要 `web_accessible_resources`,
// 那是真实的产品变更,不为测试去改),也不能 `import()` 一个 `data:` URL
// (实测被拒:Failed to fetch dynamically imported module)。
// IIFE 形式可以直接用 `Runtime.evaluate` 的表达式求值送进去,
// 且它仍是**从 `src/domain/glob.ts` 打包而来的同一份代码**,不是手抄。
const iife = await rolldown({
  input: path.join(here, 'probe', 'glob-only.src.ts'),
  platform: 'browser',
  resolve: { extensionAlias: { '.js': ['.ts', '.js'] } },
});
await iife.write({
  file: path.join(outDir, 'ccf-glob-probe.iife.js'),
  format: 'iife',
  name: '__ccfGlobProbe',
  inlineDynamicImports: true,
});
await iife.close();

console.log('probe built → .output/chrome-mv3/ccf-repo-probe.{js,html} + -boot.js + ccf-glob-probe.iife.js');
