/**
 * Content script 入口(T4a:核心注入)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **下面这行 `import` 是 INV-3 的实现本体,不是普通依赖。**
 *
 * WXT 在生产构建时会把 content script `import` 到的 CSS 收集为
 * `content-scripts/content.css`,并写进 manifest 的 `content_scripts[].css` 数组
 * (`cssInjectionMode` 取默认值 `"manifest"`)。走 manifest `css` 数组的样式表
 * 由浏览器在 `document_start` **先于脚本**注入,不等 DOM、不经 JS,
 * 因而落在首帧之前 —— 这正是 DESIGN.md §6 T4a 线索所指的「css 数组」。
 *
 * 删掉这行 import,INV-3 立即失效(样式表不再进 manifest)。
 * 同理**绝不可**设 `cssInjectionMode: "ui"`(线索明文警告)。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
import '../src/injection/filter.css';

import { defineContentScript } from 'wxt/utils/define-content-script';
import { SettingsRepository } from '../src/storage/index.js';
import { defaultBrowserStore, runInjector } from '../src/injection/index.js';

/**
 * - `matches: ['<all_urls>']`(ADR-004)—— 规则匹配在领域层做(resolveRule),
 *   不靠 manifest 的 matches 过滤,因为规则是用户可随时编辑的运行时数据。
 * - `runAt: 'document_start'` 是 INV-3 的前提:此时 `document.body` 尚不存在,
 *   但 `document.documentElement` 已存在 —— 注入目标正是它(T0 spike §1)。
 * - `allFrames: false` 即可满足 ADR-016:根元素 filter 天然覆盖同源与跨域
 *   iframe,无需注入子框架(T0 spike §2.3 / §5 实测)。
 *
 * 📌 ADR-038:WXT **dev 模式的 manifest 完全不含 `content_scripts`**,改由
 * service worker 运行时 `registerContentScripts()` 注册,赶不上 document_start。
 * 所以 INV-3 的验收一律在 `npm run build` 产物(.output/chrome-mv3/)上做。
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: false,

  main() {
    // `runInjector` 的同步阶段在它返回之前就已跑完(快路径命中即已应用滤镜),
    // 故这里**不 await** —— await 会让出执行权,正是 INV-3 要避免的事。
    const { settled } = runInjector({
      target: document.documentElement,
      // 🔴 持久层（localStorage）优先，sessionStorage 兜底 —— 这是 INV-3
      // **冷启动**那一格的解法：sessionStorage 按标签页隔离，
      // 「本标签页首次访问该 host」必然落空，实测 5/6 次冷启动
      // 出现未滤镜的彩色帧。详见 src/injection/persistent-store.ts 头注释。
      store: defaultBrowserStore(),
      url: location.href,
      readSettings: () => new SettingsRepository().read(),
    });

    // 异步阶段的失败不得让 content script 抛到页面上(INV-1:不改变页面可观察行为,
    // 未捕获的 Promise 拒绝会触发页面的 unhandledrejection 处理器)。
    settled.catch(() => {
      /* 读设置失败时仓储层已回退默认值;此处只兜底极端情况。 */
    });
  },
});
