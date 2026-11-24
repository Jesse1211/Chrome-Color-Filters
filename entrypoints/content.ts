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
 *
 * 📌 **ADR-069 不改变这条机制**(零闪烁架构不动):CSS 文件照旧由 Chrome
 *    在首帧前注入,只是选择器多了个 `.ccf-on` class 门控,滤镜值从
 *    `data:` URI 换成同文档 `url("#ccf-…")` 引用。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
import '../src/injection/filter.css';

import { defineContentScript } from 'wxt/utils/define-content-script';
import { SettingsRepository } from '../src/storage/index.js';
import { defaultFastPathStore, runInjector } from '../src/injection/index.js';

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
    const repo = new SettingsRepository();

    const { settled } = runInjector({
      // 🔴 ADR-069:`documentElement` 同时是**滤镜宿主**与**SVG 挂载点**。
      //    `document_start` 时它已存在(`<head>`/`<body>` 尚无),所以
      //    「插 SVG → 加 ccf-on class」两步可以直接挂 html 完成,
      //    全程同步、不等 DOM(见 src/injection/svg-filter-def.ts)。
      //    两者必须是同一个元素 —— `FilterTarget` 因此把 `SvgDefsHost`
      //    并了进来,而不是另开一个参数让它们有机会不一致。
      target: document.documentElement,
      // 🔴 ADR-060:宿主 origin 的 localStorage。这是 INV-3(零闪烁)
      // **唯一可行**的同步通道 —— MV3 没有任何同步的扩展存储 API,而
      // sessionStorage 活不过标签页(实测冷启动 6 次闪 3 次)。
      // 这是对 DESIGN.md §1「永不拥有宿主页面」的窄口例外,隐私代价
      // (站点 JS 能读到该记录)已记入 §4.1 并由产品负责人接受。
      // 详见 src/injection/fast-path-store.ts 头注释。
      store: defaultFastPathStore(),
      url: location.href,
      readSettings: () => repo.read(),
      // 🔴 INV-8 / ADR-027:主开关被关掉的那一刻就抹掉本 host 的快路径推测。
      // 不接这个订阅,下一次导航的同步阶段仍会按陈旧推测上色约 2ms
      // (实测,见 injector.ts 中 subscribeSettings 的注释)。
      subscribeSettings: (listener) => repo.subscribe(listener),

      // ──────────────────────── T4b ────────────────────────

      // 🔴 **实时预览接收端（ADR-049）**。
      //
      // 路由由 DESIGN.md §6 T4b 定死且「不得自行选择」：popup 用
      // `chrome.tabs.connect(tabState.tabId, { name: 'preview' })` **直连**
      // 本 content script，**不经 service worker 中转**（否则 T5 会被拖进
      // 预览路径，而 T5 并非 T6b 的上游）。
      //
      // 📌 在**接收端**这一侧，`chrome.tabs.connect` 发起的连接表现为一次
      //    `chrome.runtime.onConnect` —— 这不是「改走 runtime 通道」，
      //    而是同一条直连在两端的不同名字。接收端没有、也不需要
      //    `chrome.tabs.*`（content script 里压根拿不到那个 API）。
      //
      // 📌 此处不直写 `onConnect: chrome.runtime.onConnect`：`chrome` 在本项目的
      //    `tsc` 配置下没有全局类型（实测 TS2304，ADR-066 的第三道门禁会报错），
      //    且在非扩展上下文求值会抵—— 同 `background.ts` 里 `chromeRuntime()` 的理由。
      //    按本仓约定，平台取用收束在 `globalThis` 取值的软失败辅助函数里。
      preview: true,

      // 🔴 **存活性（INV-5 / ADR-017）**：站点脚本摧掉注入物后自动恢复。
      //
      // 生产入口恒为 `true`。它在 `InjectorDeps` 里是可选项，只为让既有单测
      // 与非浏览器宿主能不启动 observer —— **不是**给 ADR-017 的保证加开关
      // （那是不允许的）。`tests/t4b-static-gates.test.ts` 有一条断言把守
      // 本行必须存在。
      liveness: true,
    });

    // 异步阶段的失败不得让 content script 抛到页面上(INV-1:不改变页面可观察行为,
    // 未捕获的 Promise 拒绝会触发页面的 unhandledrejection 处理器)。
    settled.catch(() => {
      /* 读设置失败时仓储层已回退默认值;此处只兜底极端情况。 */
    });
  },
});
