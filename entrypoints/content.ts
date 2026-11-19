import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * Content script 入口。
 *
 * - `matches: ['<all_urls>']`(ADR-004)—— 规则匹配在领域层做(resolveRule),
 *   不靠 manifest 的 matches 过滤,因为规则是用户可随时编辑的运行时数据。
 * - `runAt: 'document_start'` 是 INV-3(零闪烁)的前提:document_start 时
 *   `document.body` 尚不存在,但 `document.documentElement` 已存在,
 *   注入目标正是它(T0 spike §1)。
 * - `allFrames: false` 即可满足 ADR-016:根元素 filter 天然覆盖同源与跨域
 *   iframe,无需注入子框架(T0 spike §2.3)。
 *
 * 📌 ADR-038:WXT **dev 模式的 manifest 完全不含 `content_scripts`**,改由
 * service worker 运行时 `registerContentScripts()` 注册,赶不上 document_start。
 * 所以 INV-3 的验收一律在 `npm run build` 产物(.output/chrome-mv3/)上做。
 *
 * 实际注入逻辑由 T4 实现。
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: false,
  main() {
    // T4a 实现:读设置 → resolveRule → toColorMatrix → 注入 html{filter}。
  },
});
