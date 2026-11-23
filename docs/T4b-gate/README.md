# T4b REAL_STACK_GATE —— 复现方法与结果

> 本目录是 T4b(存活性、预览与隐私审计)的**真实栈验收**脚本与证据。
> 所有脚本都跑在 **`npm run build` 产物**(`.output/chrome-mv3/`)上 —— **ADR-038**。

## 复现

```bash
# 0) 前置:生产构建 + Chrome for Testing(与 T4a 共用同一套环境)
npm run build
cd docs/T0-spike/spike-code
echo '{"name":"ccf-gate-deps","private":true,"version":"0.0.0"}' > package.json
npm i --no-save puppeteer-core@23 pngjs
npx @puppeteer/browsers install chrome@stable
cd ../../..   # 回到仓库根

# lib.cjs/本目录脚本从**自己的目录**向上解析依赖,做软链即可
# (`node_modules` 已在 .gitignore,任意深度都不入库)
ln -sfn ../T0-spike/spike-code/node_modules docs/T4a-gate/node_modules
ln -sfn ../T0-spike/spike-code/node_modules docs/T4b-gate/node_modules

# 1) 跑各项(从仓库根)
node docs/T4b-gate/liveness.cjs           # INV-5/ADR-017 存活性 + SPA 站内跳转
node docs/T4b-gate/liveness-baseline.cjs  # 🔴 存活性探针的**有效性基线**(对照组)
node docs/T4b-gate/preview.cjs            # 🔴 ADR-049 预览接收端(真实 chrome.tabs.connect)
node docs/T4b-gate/noninvasive.cjs        # ADR-016 iframe + INV-1 交互 + ADR-026 Network 实测
```

## 结果

| 项 | 结果 |
|---|---|
| **liveness**(INV-5/ADR-017) | **PASS(12/12)** — 四种破坏手法(摘 `data-ccf-on`、摘 `--ccf-filter`、塞 `data-ccf-off`、整体摘 `style`)全部自动恢复;**连续 20 次破坏 20 次恢复**;`react.dev` 与 `vuejs.org` 站内跳转(URL 实测变化)后滤镜持续生效 |
| **liveness-baseline** | **PASS(4/4)** — 见下文「探针有效性」,这是上面那 12 个 PASS 不空转的证据 |
| **preview**(ADR-049) | **PASS(12/12)** — 经**真实 `chrome.tabs.connect(tabId, {name:'preview'})`** 验证:滤镜立即变化、连续拖动每步都渲染、storage 零写入、预览期间 `onChanged` 不重绘、`PREVIEW_CLEAR` 后按新值渲染、端口断开自动恢复、预览期间导航后新页面按规则渲染且旧端口 `onDisconnect` 触发 |
| **noninvasive** | **PASS(10/10)** — 跨域 iframe `maxChannelSpread` 滤镜态 **0** / 未滤镜态 **255**(ADR-016);点击命中、文本选中、video 播放(`currentTime` 0→1.16s)、CSS 动画全部正常(INV-1);Network 面板**零条**页面资源之外的请求(ADR-026) |

### 🔴 探针有效性 —— 两处「看起来 PASS 其实空转」已被实测揪出并修正

本轮有两条断言**第一版是空转的**,都是靠对照组才发现的。记录在此,
因为它们正是 DESIGN.md §8 与 ADR-066 所警告的那种自欺,后人容易重犯:

**(1) 存活性:破坏后读不到中间态**

`liveness.cjs` 里「破坏后」那一拍抓到的 filter 仍是 `grayscale(1)`,
因为 MutationObserver 恢复是**微任务级**的,CDP 的下一次 evaluate 根本追不上。
于是「破坏了但瞬间恢复」与「破坏压根没生效」**现象完全相同**。

`liveness-baseline.cjs` 用两件事关掉这个漏洞:

- 在**同一个** `page.evaluate` 里先摘属性、再**同步**读 `getComputedStyle`
  —— 同步代码跑在微任务之前,于是抓到了真正的中间态:
  `{ beforeFilter: 'grayscale(1)', syncAfterFilter: 'none', syncAttrOn: false }`
- 宿主必须选「滤镜**只**来自 JS 路径」的场景。第一版用已配置的
  `*.wikipedia.org`,**当场 FAIL**:ADR-062 的预生成 CSS 用**裸 `html`**
  选择器(`html { filter: grayscale(1) !important }`),它根本不看我们的属性,
  摘属性摘不掉它 —— 那是 INV-3 的设计,不是缺陷。
  改为「先在**无规则**时打开页面、再添规则」:注册变更不影响已打开页面
  (Chrome 既定行为),此时该页滤镜完全由 JS 路径撑着,摘属性必然掉色。

**(2) iframe 继承:载体本身就是灰的**

`noninvasive.cjs` 第一版用 `https://example.com/` 做跨域 iframe,
滤镜态量得 `maxChannelSpread == 0`,看起来 PASS。但对照组(主开关 OFF)
量得的**也是 0**。用**无扩展的纯净 Chrome** 直接量 example.com:

```
maxChannelSpread = 0,480000/480000 个像素的 spread 全为 0
```

即 example.com 本身就是全无彩色的页面(白底黑字)。
**那条断言即使 ADR-016 完全损坏也会 PASS。**

改用 `https://placehold.co/400x240/ff0000/00ff00.png`(纯红底 + 纯绿字,
跨域、可嵌入),纯净 Chrome 下实测 spread = 255(理论最大)。
现在探针有最大区分度:**滤镜态 0 / 未滤镜态 255**。

### 🔴 变异测试 —— 门禁是否真的有牙

逐条破坏产品代码,确认门禁变红(全部已还原,`git status` 干净):

| 变异 | 结果 |
|---|---|
| `setBase` 无视预览覆盖(去掉提前返回) | **单测 3 红**(preview.test.ts);**真实栈不红** —— 见下 |
| `setBase` 到达即丢弃覆盖(`overrideActive = false`) | **真实栈 preview gate 红** — 页面从预览 `0.05` 跳到 `0.7`,正是 DESIGN.md 点名的那个 bug |
| `onDisconnect` 不清除覆盖 | **单测 2 红** |
| observer 开 `subtree`/`characterData` | **单测 1 红 + 静态门禁 1 红**(产物层) |
| 不执行恢复(`syncFilter` 删掉) | **单测 7 红** |
| 植入 `fetch` + 读 `document.body.innerText` | **静态门禁 6 红**(源码层 + 产物层) |
| 生产入口去掉 `liveness: true` / `preview: true` | **静态门禁 2 红** |
| 预览值经注入的 store 落盘 | **单测 3 红**(含 gate 逐字要求的 storage spy 断言) |

📌 **第一个变异值得单独说明**:只去掉 `if (overrideActive) return;` 而保留
`render()` 里的 `overrideActive ? override : base`,在真实栈上**行为不变** ——
因为渲染的值仍然是覆盖值,只是多调了一次幂等的 `syncFilter`。
那是一个**等价变异**(equivalent mutant),真实栈不红是正确的,
不是门禁失效:单测用 `arbiter.renders()` 计数才能观测到它。
真正会被用户看见的缺陷形态是第二个变异,而它**被真实栈抓到了**。

## blindSpots(显式申报)

1. **预览发送端(popup 侧)未验** —— 本任务只实现**接收端**。ADR-049 列的
   四条「一律不发送」条件(pattern 不匹配当前页 host、`masterEnabled == false`、
   当前页不可注入、锁定中)与三条**主动发送 `PREVIEW_CLEAR` 的义务**
   (离开编辑视图 / pattern 改到不匹配 / 条件由可用变不可用)全部属于
   **T6b**,此处无法验收。
   > 接收端对「发送端不守规矩」做了一处兜底:主开关 OFF 时显式撤掉覆盖
   > (INV-8/ADR-027 凌驾一切),见 `injector.ts`。其余三条无法在接收端兜底 ——
   > 接收端不知道 popup 正在编辑哪条 pattern。
2. **真实 popup 的端口未走通** —— `preview.cjs` 从 **service worker 上下文**
   调 `chrome.tabs.connect`(那里才有 `tabs` 权限),以此代替尚未实现的 popup。
   这证明了**平台路由成立**(`tabs.connect` → content script 的
   `runtime.onConnect`),但「popup 关闭时端口自动断开」这一条是用
   **显式 `port.disconnect()`** 模拟的,不是真的关闭一个 popup 窗口。
   真实 popup 的销毁时序留给 T6b 的 REAL_STACK_GATE。
3. **observer 开销只有「有界」的证据,没有性能数字** —— 本轮断言的是
   observe 选项(不观察子树/childList/characterData、属性白名单)与
   速率上限行为,这些是**结构性**保证。未做 CPU/长任务的量化测量
   (如 SPA 滚动时的 main-thread 占用)。若后续出现性能投诉,
   需要补一条带数字的门禁。
4. **速率上限的真实触发未验** —— 「站点脚本反复摘属性 → 我们放弃并
   disconnect」只有单测覆盖(假 observer + 假时钟)。真实世界里会这么干的
   站点没找到可公开复现的样本,`liveness.cjs` 的 20 次连续破坏全部在预算内。
5. **video 用的是外部 CDN 资源** —— `noninvasive.cjs` 的 video 取自
   `interactive-examples.mdn.mozilla.net`。本轮实测播放正常
   (`currentTime` 0 → 1.16s),但该 URL 若将来失效,脚本会把该项
   降级为「申报盲点」而非 FAIL(代码里已如此处理),不会假红也不会假绿。
6. **Network 实测的判定方式是 URL 允许清单,不是 initiator 归因** —— puppeteer
   的 `request.initiator()` 在 content script 的 isolated world 下归因不稳定,
   故改用「页面与其显式引用资源之外的请求数 == 0」这个更粗但**可判定**的口径。
   理论上挡不住「向本页面自身 origin 发起的外传」(例如
   `fetch('/?leak=<内容>')`)。该形态由静态断言兜住(产物里连 `fetch` 字样
   都不存在,且 `.src =` 赋值被禁),两道合起来覆盖。
