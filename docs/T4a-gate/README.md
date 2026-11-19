# T4a REAL_STACK_GATE —— 复现方法与结果

> 本目录是 T4a(核心注入)的**真实栈验收**脚本与证据。
> 所有脚本都跑在 **`npm run build` 产物**(`.output/chrome-mv3/`)上 —— **ADR-038**:
> dev 模式的 manifest 完全不含 `content_scripts`,零闪烁验收在 dev 下必然不成立。

## 复现

```bash
# 0) 前置:生产构建 + Chrome for Testing(T0 §7 的环境坑同样适用)
npm run build
cd docs/T0-spike/spike-code && npm i puppeteer-core@23 pngjs
npx @puppeteer/browsers install chrome@stable

# 1) 跑各项(从本目录)
node docs/T4a-gate/geometry.cjs   # INV-1 几何:fixed/sticky 屏幕位置
node docs/T4a-gate/styles.cjs     # INV-1 计算样式 + 移除后无残留
node docs/T4a-gate/flicker.cjs    # INV-3 零闪烁(逐帧)
node docs/T4a-gate/inv8.cjs       # INV-8 主开关关闭时完全不工作
node docs/T4a-gate/modes.cjs      # 四种模式在真实 Chrome 中确实生效
```

## 结果（evidence/ 内有原始 JSON 与截图）

| 项 | 结果 |
|---|---|
| **geometry**(INV-1) | **PASS** — github/wikipedia 所有同时存在的 fixed/sticky 元素位移 **dx=0, dy=0**;滤镜态 `maxChannelSpread=0`(真灰阶),基线 202/200/255(探针有效) |
| **styles**(INV-1) | **PASS** — 可归因于滤镜的计算样式/几何差异 **0 处**(github 2310 元素 / wikipedia 6509 / hn 817);移除后**零残留**。连跑 4 次全部 PASS(改用同步配对后不再抖动,见下) |
| **flicker**(INV-3) | **PASS** — **冷启动 0 带色帧**(github 0/198、wikipedia 0/37、hn 0/2);热路径 0/173、0/96、0/3;基线 293/295、100/101、3/4 证明探针有效 |
| **inv8**(INV-8) | **PASS** — 主开关关闭时无属性、无变量、`computedFilter: none`、无注入节点、**会话层与持久层均无快路径缓存**;对照组滤镜正常生效 |
| **modes** | **PASS** — 四种模式全部在真实 Chrome 生效,三种辅助模式的内联 `data:` URI 被 Chrome 接受 |

## 本轮修掉的两个缺陷（均由评审指出，属实）

### 1. 【产品缺陷】冷启动首帧未滤镜 —— INV-3 真的破了

上一轮 `flicker.cjs` 把冷启动结果写成一行**不参与 fail 判定**的 `INFO`，
于是脚本打印 `FLICKER: PASS` 却同时携带 `hn 冷启动 2/4 帧带色`。
那是在绕过 T4a gate 逐字写明的子句（「**冷启动**加载录屏，逐帧检查，
**第一个可见帧即已滤镜**」）。

复现确认：`news.ycombinator.com` 冷启动 **6 次试验中 5 次**出现未滤镜的彩色帧，
worst frame 是一整条**全彩的 HN 橙色头部**，带色比例 0.0228 与「主开关关闭」
的基线逐位相同 —— 不是探针抖动，是真实缺陷。

**根因**：`filter.css` 确实走 manifest `css` 数组、首帧前就位，但门控属性
`data-ccf-on` 必须等异步 `chrome.storage` 读完才能加；而旧实现的同步快路径建在
`sessionStorage` 上，它**按标签页隔离**，「本标签页首次访问该 host」必然未命中 ——
那恰恰就是冷启动。

**修复**（`src/injection/persistent-store.ts`）：同一套机制换上**跨标签页**的
同步存储 `localStorage`（按源而非按标签页作用），`sessionStorage` 降级兜底，
两者都不可用时退回「永远未命中」的空实现。于是任一标签页跑完一次权威判定后，
结果对该源的**所有后续标签页**同步可见，冷启动同步命中。

实测：三站冷启动 **0 带色帧**（github 0/198、wikipedia 0/37、hn 0/2）。
`flicker.cjs` 的冷启动子句已改为**与热路径同等判 fail**，且冷启动阶段改为
**真正的浏览器冷启动**（进程完全退出后用同一份 profile 重启）。

> 仍然成立的边界：某 host 的**有史以来第一次**访问（权威结果尚不存在于任何地方）
> 物理上无法在首帧前知道答案 —— MV3 没有同步的扩展存储 API。
> 但那一次用户尚未看到过该站的滤镜效果，不属于「冷启动加载」的验收语义；
> 此后每一次（含浏览器重启、新标签页）都已覆盖。**此项已如实申报为 blindSpot。**

### 2. 【门禁缺陷】styles.cjs 随机误报，会红绿随机化后续任务

旧实现用「control（滤镜不变）/ treat（切换滤镜）」各隔 300ms 取样后取
`treat \ control`。两个结构性缺陷使其**随机假阳性**（实测 github 4/4 次 FAIL，
6/12/38/11 处「可归因」差异，而 placebo —— 全程不动滤镜 —— 同样报出 6 处）：

1. 差异按**数组下标**计键，页面在两次取样间增删节点就整体错位；
2. control 与 treat 的 300ms 窗口落在动画的不同相位，control 覆盖不到
   treat 那一拍恰好前进的元素。

**修复**：两份快照在**同一个 `evaluate()` 内同步采集**，中间只做「移除滤镜」
一个同步操作，**不跨任何 timer/await** —— 同一任务内浏览器不会推进动画，
动画相位天然相同，元素身份直接复用同一个 NodeList 对象。
实测连跑 4 次全部 **0 处差异**，不再抖动。

## 两个方法论陷阱(后续任务请勿重蹈)

### 1. 页面自身的动画会伪装成 INV-1 违规

github 首页有常驻横向滚动动画。直接比对「滤镜态 vs 移除后」会得到 60 处差异，
看起来像滤镜破坏了布局。**判别器**：完全不动滤镜、隔同样的间隔再拍一次 ——
实测得到 **1836 处**差异，签名与前者完全相同（同一 DIV/svg 子树的 translate-X）。

> ⚠️ **本轮更正**：曾经的对策是「配对对照」(control/treat 各隔 300ms 取样后相减)。
> 那个办法**本身就是假阳性源**，已被 placebo 实验证伪并废弃 —— 详见上文
> 「本轮修掉的两个缺陷 · 2」。现行 `styles.cjs` 改用**同一个 `evaluate()` 内的
> 同步配对**：两份快照之间不跨任何 timer/await，动画物理上无法前进，
> 从根上消除了这个陷阱,而不是用统计手段去扣减它。

> ❌ 不要试图用 `animation-play-state: paused` 冻结动画来回避 ——
> 注入冻结样式本身会扰动页面(实测 wikipedia 的元素数从 6509 掉到 35)。


### 2. 单个像素可能是矩阵的不动点

`modes.cjs` 最初只采一个色块,报 `GreenRed 滤镜没有真正生效`。
实为 **GreenRed 下纯红 (255,0,0) 的像就是 (255,0,0)**:
`R'=1.436619*255` 钳到 255、`G'=0`、`B'=-0.184239*255` 钳到 0。
这是矩阵的正确行为。判据已改为「三个色块中至少一个变化」,
并在 `src/injection/__tests__/filter-css.test.ts` 中固化了该事实。

## 环境修正:零闪烁探针必须用**新** headless

T0 §7 记载「必须 headful」。本机实测该结论对**逐帧录屏**不成立:
headful 下窗口被系统判为遮挡,合成器不产帧 —— **T0 自己的 `flicker.js` 原样重跑
也只抓到 1–2 帧,且连「必然彩色」的基线都报 0 带色帧**(探针失效)。
Chrome 的新 headless 走虚拟显示,合成路径真实、MV3 扩展正常加载(实测 47 帧 + service worker 存在)。
故 `flicker.cjs` 用 `headless: true`;`geometry.cjs` 仍用 headful(不依赖逐帧合成)。
