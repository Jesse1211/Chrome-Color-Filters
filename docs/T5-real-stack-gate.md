# T5 REAL_STACK_GATE — 人工执行步骤

DESIGN.md §8 第 8 条:

> **REAL_STACK_GATE 必须在真实 Chrome 中跑。** jsdom/mock 下的绿灯**不构成**通过。

§6 T5 的 REAL_STACK_GATE 原文:

> 真实 Chrome 中,让 service worker 被终止(或等待自然休眠)后,打开匹配站点 ——
> 滤镜仍正确应用(证明真相来源在 storage 而非 worker 内存)

该门禁依赖「**终止 service worker**」这个动作(`chrome://extensions` 卡片上的
"Service Worker" → "终止",或等约 30 秒自然休眠)。无头环境里没有这个按钮,
且 MV3 的休眠时机由浏览器决定、不可编程触发 —— 故此处给出可复核的人工步骤,
**由人类或 Tester 在真实 Chrome 中执行**。

单元层的前提已由自动化覆盖,但那**不是**本门禁的通过凭据:

| 前提 | 自动化位置 |
|------|-----------|
| 协调器不持有设置快照,每次事件都重读 storage | `src/background/__tests__/coordinator.test.ts` 的「MV3 · service worker 不是真相来源」 |
| 协调层零 `chrome.*`、不持有设置字段 | `tests/t5-static-gates.test.ts` |
| 产物 SW 里 T4a 注册与 T5 协调共存 | `tests/build-manifest.test.ts` 的 T5 五条 |

---

## 前置

```bash
npm ci
npm run build          # 产物在 .output/chrome-mv3/(ADR-038:验收一律在 build 产物上)
```

`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择 `.output/chrome-mv3/`

在 service worker 控制台(扩展卡片上点 "Service Worker")写入一条规则:

```js
await chrome.storage.local.set({
  filterSettings: {
    version: 1,
    masterEnabled: true,
    rules: [{ pattern: '*.wikipedia.org', mode: 'Grayscale', intensity: 100 }],
    lockUntil: null,
    maxSeenTime: Date.now(),
  },
});
```

---

## GATE-1 🔴 · worker 被终止后,滤镜仍正确应用

**这是 §6 T5 逐字要求的那一条。**

1. 关掉所有 wikipedia 标签页。
2. `chrome://extensions` → 本扩展卡片 → 点 **"Service Worker"** 旁的 **"终止"**
   (卡片上的状态文字应变为「service worker(非活动)」)。
3. **不要**打开 service worker 控制台 —— 打开它会把 worker 唤醒,门禁就空转了。
4. 新开标签页访问 `https://zh.wikipedia.org/wiki/色盲`。

**通过判据:** 页面**灰度显示**,且首帧即灰(无彩色闪烁)。

> **为什么这能证明真相来源在 storage:** worker 在导航开始时是死的。首帧的灰度
> 来自浏览器从磁盘 StateStore 恢复的声明式注册(ADR-062,T4a 交付),
> 整个过程不需要任何 JS 先跑起来。若滤镜依赖 worker 内存里的某份聚合状态,
> 这一步必然失败。

---

## GATE-2 · 图标两态(ADR-019 / ADR-045)

1. 停在上一步的 wikipedia 页面 → 观察工具栏图标:**亮**(高对比双色方块)。
2. 同一窗口新开标签页访问 `https://news.ycombinator.com/` → 图标:**灰**(低对比 + 半透明)。
3. 在两个标签页之间来回切换 → 图标**随当前 tab 切换**,无滞后。

**通过判据:** 两态在视觉上可区分(不是同一张图),且与「当前页是否被改色」一致。

> 两态是**不同的图片文件**(ADR-045),已由 `tests/project-gates.test.ts` 的
> hash 不等断言把守;本步验的是**运行时切换**是否真的发生。

---

## GATE-3 · INV-4 多 tab 即时同步

1. 开 **3 个** 标签页,全部访问匹配同一条规则的站点:
   `https://zh.wikipedia.org/`、`https://en.wikipedia.org/`、`https://ja.wikipedia.org/`
   —— 三者都命中 `*.wikipedia.org`。三页均应为灰度,三个图标均应为亮。
2. 停在**第 1 个**标签页,在 service worker 控制台把强度改掉:

   ```js
   const { filterSettings: s } = await chrome.storage.local.get('filterSettings');
   await chrome.storage.local.set({
     filterSettings: { ...s, rules: [{ ...s.rules[0], mode: 'RedGreen', intensity: 60 }] },
   });
   ```

3. **不刷新**,直接切到第 2、第 3 个标签页。

**通过判据:** 另外两个标签页的滤镜**已经**变成 RedGreen@60(无需刷新),
三个图标仍为亮。

> 像素的即时同步由 content script 自己的 storage 订阅完成(T4a `injector.ts`);
> 图标的即时同步由 T5 的 `syncAllTabs()` 完成。两者必须**同时**成立,
> 否则会出现「页面变了但图标还停在旧态」的用户可见不一致。

---

## GATE-4 🔴 · INV-8 主开关 OFF → 全站无滤镜 + 图标全灰 + 规则保留

1. 保持 GATE-3 的 3 个标签页打开。
2. service worker 控制台:

   ```js
   const { filterSettings: s } = await chrome.storage.local.get('filterSettings');
   await chrome.storage.local.set({ filterSettings: { ...s, masterEnabled: false } });
   ```

3. 逐个切到 3 个标签页观察。

**通过判据(三项须同时满足):**

- 三页滤镜**全部消失**(恢复原色);
- 三个图标**全灰**(ADR-019 明文:主开关 OFF 时全灰);
- `(await chrome.storage.local.get('filterSettings')).filterSettings.rules` **仍有那条规则**
  (INV-8:规则原样保留)。

4. 再把 `masterEnabled` 改回 `true` → 三页滤镜与三个亮图标**全部恢复**。

---

## GATE-5 · 不可注入页面的 reason 取值(ADR-013 / ADR-044)

逐个打开下列 URL,在 service worker 控制台执行
`await chrome.runtime.sendMessage({ type: 'GET_TAB_STATE' })`
并核对响应。

> ⚠️ 控制台发消息时「当前 tab」是**最后聚焦的那个窗口的活动 tab** ——
> 先聚焦被测标签页,再切到控制台执行(或用下方的 popup 法)。

| 打开的 URL | 期望 `injectable` | 期望 `reason` | 期望 `host` |
|------------|------------------|---------------|-------------|
| `chrome://settings` | `false` | `'internal-page'` | `null` |
| `https://chromewebstore.google.com/` | `false` | `'web-store'` | `null` |
| 任一本地 PDF 的 `file://` 路径 | `false` | `'internal-page'` | `null` |
| 任一 http(s) 上的 `.pdf` 链接 | `false` | `'pdf'` | `null` |
| 新标签页(`chrome://newtab`) | `false` | `'new-tab'` | `null` |
| `https://zh.wikipedia.org/` | `true` | 字段不存在 | `'zh.wikipedia.org'` |

> **`file://` 为什么是 `internal-page` 而不是新造一个 `file`:**
> ADR-044 的 `reason` 枚举只有五个取值,且「双方不得各自发挥」。
> `file://` 的不可注入原因与 `chrome://` 同源(扩展未获授权的特权 scheme),
> 故归入 `internal-page`。论证见 `src/background/injectable-url.ts` 的文件头。

**通过判据:** 六行全部与表格一致,**字段名与类型**也一致(不多字段、不少字段)。

---

## GATE-6 · worker 休眠后 popup 仍可用(ADR-044 的超时降级)

1. 终止 service worker(同 GATE-1 第 2 步)。
2. 在一个匹配站点上**打开 popup**。

**通过判据:** popup 先显示**骨架态**(控件禁用、不显示错误),随后在
worker 被消息唤醒后显示真实状态(规则列表 + 生效标记)。
**不得**出现白屏、报错横幅,或长期停在「此页面不支持滤镜」。

> popup 侧的 1 秒超时与降级值(`injectable:false, reason:'no-tab'`)
> 由 `src/ui/tab-state.ts` 实现、`src/ui/__tests__/tab-state.test.ts` 覆盖;
> 本步验的是**真实的冷启动延迟**是否落在那个窗口之内。

---

## 结果记录

| GATE | 结果 | 执行人 | 日期 | 备注 |
|------|------|--------|------|------|
| GATE-1 worker 终止后滤镜仍生效 | ☐ PASS ☐ FAIL | | | |
| GATE-2 图标两态 | ☐ PASS ☐ FAIL | | | |
| GATE-3 INV-4 多 tab 同步 | ☐ PASS ☐ FAIL | | | |
| GATE-4 INV-8 主开关凌驾 | ☐ PASS ☐ FAIL | | | |
| GATE-5 reason 取值 | ☐ PASS ☐ FAIL | | | |
| GATE-6 休眠后 popup 可用 | ☐ PASS ☐ FAIL | | | |
