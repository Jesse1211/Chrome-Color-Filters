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
| **geometry**(INV-1) | **PASS** — github/wikipedia 所有同时存在的 fixed/sticky 元素位移 **dx=0, dy=0**;滤镜态 `maxChannelSpread=0`(真灰阶),基线 255 等(探针有效) |
| **styles**(INV-1) | **PASS** — 可归因于滤镜的计算样式/几何差异 **0 处**(github 2314 元素 / wikipedia 6509 / hn 817);移除后**零残留** |
| **flicker**(INV-3) | **热路径 PASS,冷启动⚠️ 见下** — 热路径 0/165、0/93、0/2;基线 285/288、100/102、3/5(探针有效) |
| **inv8**(INV-8) | **PASS** — 主开关关闭时**整个加载过程中滤镜一瞬都未出现**(`everOn=false`),无属性/变量/注入节点,两层 Web Storage 均无残留;对照组 `everOn=true` 证明探针有效 |
| **modes** | **PASS** — 四种模式全部在真实 Chrome 生效,三种辅助模式的内联 `data:` URI 被 Chrome 接受 |

## 本轮修掉的缺陷

### 1. 【产品缺陷】INV-8 被同步快路径绕过 —— 评审指出,属实

旧实现的同步快路径**无条件**读缓存并上色,而此时 `masterEnabled` 还在异步的
`chrome.storage` 里、尚不可知。于是主开关 OFF 时仍会先上色、再由异步阶段撤掉。
INV-8 的原文是「**不注入**」,ADR-027 给的理由是「关主开关可**彻底止血**」——
「先上色再纠正」两条都不满足。

**修复分两处,缺一不可:**

1. `fast-path-cache.ts` — 缓存条目记录写入时的 `masterEnabled`,
   `readFastPath` 只在它为 `true` 时才返回命中,否则返回 `unknown`(= 什么都不画)。
2. `injector.ts` — 订阅设置变更,主开关转 OFF 的**那一刻**就抹掉本 host 的缓存。
   只做第 1 条不够:条目记录的是**写入时**的状态,用户之后关主开关它并不知道,
   于是下一次导航的同步阶段仍会命中陈旧条目。
   **实测**(news.ycombinator.com):只做第 1 条时,关主开关后第 1 次导航
   仍有约 **2ms** 的可见上色窗口(第 2 次之后才干净);接上订阅后降为 **0**。

**门禁同步修复(旧门禁看不见这个缺陷):** `inv8.cjs` 旧版只在导航后 +1000ms
采一次样 —— 那是**异步纠正之后**的状态,「先上色再撤」必然显示为 PASS。
新版在 `document_start` 装一个高频轮询探针,判据改为
「整个加载过程中滤镜**一瞬都不得出现**」,并要求对照组 `everOn=true`
以防探针失效造成假阴性。

> **判别器已验证**:把 `fast-path-cache.ts` 里的 `masterEnabled` 门禁一行注释掉
> (其余不动),新 `inv8.cjs` 在 **github / wikipedia / hn 三站全部 FAIL**
> (`off.everOn=true`);恢复后全部 PASS。旧 `inv8.cjs` 对同一个缺陷报 PASS。
> 单测侧同样有判别器:`injector.test.ts` 的「同步阶段零写入」用例在该变异下失败。

### 2. 【架构回退】localStorage 越过了 BC 所有权边界 —— 评审指出,属实

上一轮为关冷启动缺口把快路径底层换成 `localStorage`。DESIGN.md §1:
「宿主页面(host page)的 DOM、样式、脚本**不属于**本 BC —— 只可观察,**永不拥有**」。
`localStorage` 按源且跨会话,等于让扩展在页面自己的源里持有一份
跨重启、按站点、页面可读的持久记录 —— 那是「拥有」。已回退为仅 `sessionStorage`
(随标签页蒸发,不构成持久所有权),`persistent-store.ts` 整个删除。

机械回归:`tests/content-script-privacy.test.ts` 断言**产物中不得出现
`localStorage` 字样**;`inv8.cjs` 断言页面 `localStorage` 中不得出现 `__ccf` 键。

### 3. 【架构回退】缓存里存了派生值,违反 ADR-025 —— 评审指出,属实

旧缓存存的是 `filterCssValue(mode,intensity)` 的结果 —— 对三种辅助模式就是
完整的 `feColorMatrix` 系数串。ADR-025:「`ColorMatrix` 为派生值,不持久化 |
持久化会产生可漂移的双份真相」,范围由 DESIGN.md:736 点明是**双份真相**。
那正是一份有独立生命周期、会漂移的第二真相。

**修复:** 缓存只存 `(mode, intensity)` 这两个**非派生的用户设置值**,
filter 字符串在**读取时**由 `filterCssValue` 当场算出。
`writeFastPath` 的签名里根本没有 filter 字符串参数 —— **结构上**拒绝写入派生值。
回归用例见 `injector.test.ts` 的「ADR-025」一节(断言产物 JSON 不含
`feColorMatrix` / `data:image/svg` / `grayscale(` 等派生特征)。

### 4. 【门禁缺陷】lib.cjs 写死了机器绝对路径

`EXT` 曾是 `/tmp/ff-wt/T4a/.output/chrome-mv3`,而 README 让读者在仓库根跑 ——
照做会撞上「缺少生产构建产物」并误判成构建坏了。现改为相对**仓库根**解析
(可用 `CCF_EXT_DIR` 覆盖)。

---

## 🔴 已申报的 blindSpot:浏览器重启后的冷启动首帧(INV-3 未完全满足)

**实测数据(本轮,生产产物 + 真实 Chrome + news.ycombinator.com,6 次试验):
`sessionStorage` 方案下冷启动(进程完全退出后用同一 profile 重启)
3/6 次出现带色帧。** `flicker.cjs` 连跑两次,第二次 hn 报 `冷启动 2/4` 判 FAIL。

**这是一个真实的 INV-3 缺口,不是探针抖动,也不掩饰。** 根因是平台约束:

| 同步通道 | `document_start` 同步可读 | 能携带动态 filter 值 | 跨浏览器重启存活 | 在 BC 边界内 |
|---|---|---|---|---|
| manifest `css` 数组 | ✅ | ❌ 静态文件 | ✅ | ✅ |
| `chrome.storage.*` | ❌ **全系异步** | ✅ | ✅ | ✅ |
| `registerContentScripts` 的 `css` | ✅ | ❌ **只接受文件路径** | ❌ **实测不存活** | ✅ |
| `sessionStorage` | ✅ | ✅ | ❌ 按标签页 | 边缘可接受 |
| `localStorage` | ✅ | ✅ | ✅ | ❌ **违反 §1** |

(后两行的「实测」均为本轮亲自验证:`chrome.scripting` 需 `scripting` 权限,
注册成功但 `css` 只收文件路径;且同 profile 重启后 `getRegisteredContentScripts()` 返回空。)

**没有任何通道同时满足四列。** 于是:

- 要满足 INV-3 的冷启动子句,必须用 `localStorage` → 违反 DESIGN.md §1 / INV-9;
- 要守住 §1,就只能用 `sessionStorage` → 冷启动首帧可能带色,违反 INV-3 / ADR-018。

**这是两条不变式的真实冲突,不是实现缺陷。** 本轮选择**守住 §1 的边界**,
把 INV-3 的缺口如实申报,理由是 DESIGN.md §8.1:
「任务与 ADR 冲突时**停下并上报**,不得自行发明架构」——
上一轮用 `localStorage` 换 INV-3,正是在没有 ADR 授权的情况下
自行裁定了「INV-3 优先于 INV-9/§1」。ADR-018 说零闪烁是硬性不变式,
但它**没有**授予拿其他不变式去交换的权力。

**需要人工裁决的问题(建议新开一条 ADR):**
冷启动首帧的零闪烁,是否值得用「在宿主页面 origin 的 `localStorage` 里
存一条按站点、跨会话、页面可读的记录」来换?
若裁定「值得」,把 `session-store.ts` 换回分层存储即可(改动约 30 行,已验证可行);
若裁定「不值得」,则 INV-3 的冷启动子句需要放宽措辞,
明确它只覆盖「同一浏览会话内」。

**在裁决之前,现状是:热路径(刷新 / 站内跳转 / 前进后退 / 同标签页再访)
零闪烁已完全满足;仅「浏览器重启后对某 host 的首次访问」可能有 1–2 帧带色。**

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
