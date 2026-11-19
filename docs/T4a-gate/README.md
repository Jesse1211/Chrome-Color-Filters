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

## 结果(evidence/ 内有原始 JSON 与截图)

| 项 | 结果 |
|---|---|
| **geometry**(INV-1) | **PASS** — github/wikipedia 所有同时存在的 fixed/sticky 元素位移 **dx=0, dy=0**;滤镜态 `maxChannelSpread=0`(真灰阶),基线 202/200/255(探针有效) |
| **styles**(INV-1) | **PASS** — 可归因于滤镜的计算样式/几何差异 **0 处**(github 2324 元素 / wikipedia 6509 / hn 817);移除后**零残留** |
| **flicker**(INV-3) | **PASS** — 热路径(同标签页再次导航)**0 带色帧**(github 0/183、wikipedia 0/108、hn 0/2);基线 310/100/3 带色帧证明探针有效 |
| **inv8**(INV-8) | **PASS** — 主开关关闭时无属性、无变量、`computedFilter: none`、无注入节点、无快路径缓存;对照组滤镜正常生效 |
| **modes** | **PASS** — 四种模式全部在真实 Chrome 生效,三种辅助模式的内联 `data:` URI 被 Chrome 接受 |

## 两个方法论陷阱(后续任务请勿重蹈)

### 1. 页面自身的动画会伪装成 INV-1 违规

github 首页有常驻横向滚动动画。直接比对「滤镜态 vs 移除后」会得到 60 处差异,
看起来像滤镜破坏了布局。**判别器**:完全不动滤镜、隔同样的间隔再拍一次 ——
实测得到 **1836 处**差异,签名与前者完全相同(同一 DIV/svg 子树的 translate-X)。

故 `styles.cjs` 采用**配对对照**:`control`(滤镜全程不变)与 `treat`(唯一变量是滤镜)
各自求差,只有 `treat \ control` 才算可归因于滤镜。实测该集合为**空**。

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
