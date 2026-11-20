# T4a REAL_STACK_GATE —— 复现方法与结果

> 本目录是 T4a(核心注入)的**真实栈验收**脚本与证据。
> 所有脚本都跑在 **`npm run build` 产物**(`.output/chrome-mv3/`)上 —— **ADR-038**:
> dev 模式的 manifest 完全不含 `content_scripts`,零闪烁验收在 dev 下必然不成立。

## 复现

```bash
# 0) 前置:生产构建 + Chrome for Testing(T0 §7 的环境坑同样适用)
npm run build
cd docs/T0-spike/spike-code
# ⚠️ 先放一个最小 package.json 作为**安装锚点**:否则 npm 会沿目录上溯、
#    把依赖装进仓库根的 node_modules,而 lib.cjs 是按本目录解析的 ——
#    症状是门禁报 MODULE_NOT_FOUND: puppeteer-core(实测踩过)。
#    该文件与 node_modules/chrome/ 一并已在 .gitignore 中,不入库。
echo '{"name":"ccf-gate-deps","private":true,"version":"0.0.0"}' > package.json
npm i --no-save puppeteer-core@23 pngjs
npx @puppeteer/browsers install chrome@stable
cd ../../..   # 回到仓库根再跑下面的脚本

# 1) 跑各项(从本目录)
node docs/T4a-gate/geometry.cjs   # INV-1 几何:fixed/sticky 屏幕位置
node docs/T4a-gate/styles.cjs     # INV-1 计算样式 + 移除后无残留
node docs/T4a-gate/flicker.cjs    # INV-3 零闪烁(逐帧 × 三种缓存状态 × 连跑 5 次)
node docs/T4a-gate/inv8.cjs       # INV-8 主开关关闭时完全不工作
node docs/T4a-gate/modes.cjs      # 四种模式在真实 Chrome 中确实生效
```

## 结果（evidence/ 内有原始 JSON 与截图,均为**本轮 v2** 重新生成）

| 项 | 结果 |
|---|---|
| **geometry**(INV-1) | **PASS** — github/wikipedia 所有同时存在的 fixed/sticky 元素位移 **dx=0, dy=0**;滤镜态 `maxChannelSpread=0`(真灰阶),基线 200/255(探针有效) |
| **styles**(INV-1) | **PASS** — 可归因于滤镜的计算样式/几何差异 **0 处**(github 2311 元素 / wikipedia 6510 / hn 37);移除后**零残留** |
| **flicker**(INV-3) | **⚠️ 部分 FAIL —— 见下「仍未关闭的一格」**。`newTab` / `restart` / `hot` 在 **5 轮 × 3 站 = 15/15 场次全部 0 带色帧**(上一轮失败的两格已彻底关闭);`coldCache` 15 场次中 2 场次出现 2 帧带色。基线 `off` **15/15 带色**,证明探针有效 |
| **inv8**(INV-8) | **PASS** — 主开关关闭时**整个加载过程中滤镜一瞬都未出现**(`everOn=false`),无属性/变量/注入节点,快路径键被清除;对照组 `everOn=true` 且键被写入,证明探针有效 |
| **modes** | **PASS** — 四种模式全部在真实 Chrome 生效,三种辅助模式的内联 `data:` URI 被 Chrome 接受 |

### 🔴 仍未关闭的一格:`coldCache`(键被删除后的首次访问)

**实测(5 轮 × 3 站):**

| 场景 | 带色场次 | 带色帧 |
|---|---|---|
| `coldCache`(清空 `__ccf*` 键后首访) | **2 / 15** | 4 |
| `newTab`(新标签页) | **0 / 15** | 0 |
| `restart`(浏览器重启后) | **0 / 15** | 0 |
| `hot`(同标签页再导航) | **0 / 15** | 0 |
| `off`(基线,主开关关闭) | 15 / 15 | — (探针有效性对照) |

> 上表为**最终一轮**(rebase 到 trunk 后重跑)的数据,原始 JSON 见
> `evidence/flicker.json`。两次独立的 5 轮测量结论一致:
> 失败**只**出现在 `coldCache`,另外三格恒为 0。

**这不是探针抖动** —— `evidence/REMAINING-coldcache-unfiltered-frame.png`
是一张完整渲染的未滤镜 wikipedia 页面。**也没有被掩饰**:判据照旧计入 fail,
`flicker.cjs` 整体报 `FLICKER: FAIL`。

**根因(已用诊断脚本实测确认,不是推断):** 在该场景下,
`document_start` 时刻 `localStorage['__ccf_fp_<host>']` 读到的就是 **`null`** ——

```
首次访问时 document_start 读到的条目: null      ← 键不存在
首次访问后条目: {"masterEnabled":true,"mode":"Grayscale",...}   ← 异步阶段才写入
清空后(coldCache)document_start 读到的条目: null
```

ADR-060 的机制原文是「**命中**则立即套用滤镜」。键被删除时**不存在命中**,
而 `chrome.storage` 全系异步、MV3 没有任何同步的扩展存储 API ——
**此刻物理上不存在任何能在首帧前携带 `(mode,intensity)` 的通道**。
这正是 ADR-060 自己给出的理由(「MV3 没有任何同步的扩展存储 API」),
不是实现没做到位:**没有任何实现能在一个不存在的记录里读出值**。

**它与上一轮的失败不是同一回事。** 上一轮失败的是
「浏览器重启后首访」与「新标签页首访」—— 那两格**有**可用的持久记录
却因为用了 `sessionStorage` 而读不到,是真缺陷,本轮已 **15/15 关闭**。
`coldCache` 则是记录本身被抹掉的那一瞬,属于「每个 host 一生一次」的首访成本:
用户第一次访问某站(或手动清过站点数据后),异步权威路径补上并回写,
**此后该 host 永久命中**(`newTab`/`restart` 的 0/15 即为证)。

**🔴 需要人工裁决,Dev 不自行放宽判据:**
INV-3 的措辞是「绝不可见任何未滤镜的帧」,字面上覆盖首访。
但在 MV3 平台约束下,**首访零闪烁不可实现** —— 这是 ADR-060 已经承认的同一条约束,
只是它的措辞(「命中则立即套用」)没有明说「未命中时怎么办」。
建议二选一(两者都不该由 Dev 单方面决定):

1. 在 ADR-060 补一句:INV-3 的保证范围是「快路径记录存在之后」,
   每个 host 的**首次**访问(含用户主动清除站点数据后)不在其内;
2. 若认为首访也必须零闪烁,则需要一条新 ADR 授权**更激进**的手段
   (例如默认先遮一层再揭开),而那会与 INV-1 / INV-8 直接冲突
   —— 见 `filter.css` 头注释「默认态为什么必须是不滤镜」。

在裁决之前,`flicker.cjs` 保持 FAIL,**不降级为 INFO、不放宽阈值**。

## 修掉的缺陷

> 第 2 条是**本轮(v2)**做的;第 1/3/4 条是上一轮做的,原样保留 ——
> 它们记录了同一批门禁脚本为什么长成现在这样,删掉会让后人重踩。

### 1. 【上一轮·产品缺陷】INV-8 被同步快路径绕过 —— 评审指出,属实

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

### 2. 【本轮·核心】零闪烁非确定性失败 → 改用宿主 origin 的 `localStorage`(ADR-060)

**这是本轮唯一要修的问题,也是上一轮 7 项门禁里唯一没过的那项。**

**根因(上一轮已定位,本轮不重新调研):** 快路径底层用 `sessionStorage`,
它随标签页消失。于是「浏览器重启后首访」与「新标签页首访」在首帧之前
**没有任何同步通道**能得知 `(mode,intensity)` —— `chrome.storage` 全系异步,
MV3 没有同步的扩展存储。实测 **6 次闪 3 次**,截图确认是完整渲染的未滤镜页面
(`evidence/REGRESSION-cold-start-unfiltered-BEFORE-fix.png`)。

**上一轮的处置与它为什么在当时是对的:** 上一轮 Dev 曾用 `localStorage` 修过,
而后**自行撤销**,理由是 DESIGN.md §1「宿主页面……只可观察,永不拥有」。
那个判断在当时是对的 —— ADR-018 把零闪烁定为硬性不变式,但它没有授予
Dev 拿 INV-9/§1 去交换的权力;真有冲突应按 §8.1 **上报**,不是自裁。

**本轮的处置:** 该冲突已由产品负责人裁决,记为 **ADR-060** ——
允许在宿主页面 origin 的 `localStorage` 下存一条仅含 `mode`+`intensity` 的
快路径记录,作为对「永不拥有宿主页面」的**窄口例外**。
DESIGN.md §1 与 §4.1 均已改写记入。故本轮**恢复**该方案:

- `session-store.ts` → `fast-path-store.ts`,底层改 `globalThis.localStorage`;
- `fast-path-cache.ts` 的 TTL 由 **24 小时** 提到 **30 天**。
  🔴 这一条不是顺手改的:`sessionStorage` 时代缓存本就活不过标签页,TTL 只是兜底;
  换成 `localStorage` 后 **TTL 直接决定 INV-3 的覆盖面** ——
  TTL 一过,下次访问就是一个未滤镜首帧,而「超过一天没访问过某站」
  是极其普通的使用模式。留着 24 小时等于把刚修好的缺陷重新装回去。

**已接受的隐私代价(ADR-060 / DESIGN.md §4.1):**
**站点自己的 JS 能读到这条记录**,从而得知用户在本站开了什么滤镜。
对色觉辅助场景这等于暴露了一点用户的视觉特征信息。已向产品负责人提示并被接受。

**把窄口钉死的机械断言(不靠人工复核):**

| 断言 | 位置 |
|---|---|
| 产物中**必须**含 `localStorage` 快路径(谁换回 sessionStorage 就红) | `tests/content-script-privacy.test.ts` |
| `localStorage` 在产物中**只出现 1 次**(窄口不得被撑宽) | 同上 |
| 不枚举 storage(`length`/`key()`/`Object.keys`/展开符) | 同上 |
| 记录字段**精确**为 `{masterEnabled, mode, intensity, writtenAt}`,不含 URL/路径/查询串 | `injector.test.ts` ADR-060 一节 |
| 新标签页首访必须同步命中 | 同上 |
| 29 天后仍命中、31 天后清退且由异步兜底 | 同上 |
| 主开关 OFF 后该键必须被**清掉**;ON 时必须被写入(对照) | `inv8.cjs` |

### 3. 【上一轮·架构回退】缓存里存了派生值,违反 ADR-025 —— 评审指出,属实

旧缓存存的是 `filterCssValue(mode,intensity)` 的结果 —— 对三种辅助模式就是
完整的 `feColorMatrix` 系数串。ADR-025:「`ColorMatrix` 为派生值,不持久化 |
持久化会产生可漂移的双份真相」,范围由 DESIGN.md:736 点明是**双份真相**。
那正是一份有独立生命周期、会漂移的第二真相。

**修复:** 缓存只存 `(mode, intensity)` 这两个**非派生的用户设置值**,
filter 字符串在**读取时**由 `filterCssValue` 当场算出。
`writeFastPath` 的签名里根本没有 filter 字符串参数 —— **结构上**拒绝写入派生值。
回归用例见 `injector.test.ts` 的「ADR-025」一节(断言产物 JSON 不含
`feColorMatrix` / `data:image/svg` / `grayscale(` 等派生特征)。

### 4. 【上一轮·门禁缺陷】lib.cjs 写死了机器绝对路径

`EXT` 曾是 `/tmp/ff-wt/T4a/.output/chrome-mv3`,而 README 让读者在仓库根跑 ——
照做会撞上「缺少生产构建产物」并误判成构建坏了。现改为相对**仓库根**解析
(可用 `CCF_EXT_DIR` 覆盖)。

---

## INV-3 冷启动:上一轮的 blindSpot 已由 ADR-060 关闭

上一轮此处申报了一个**真实的** INV-3 缺口并请求人工裁决。裁决已下达(ADR-060),
缺口已关闭。保留原始的通道取舍矩阵,因为它是裁决的依据,也防止后人重走一遍:

| 同步通道 | `document_start` 同步可读 | 能携带动态 filter 值 | 跨浏览器重启存活 | 备注 |
|---|---|---|---|---|
| manifest `css` 数组 | ✅ | ❌ 静态文件 | ✅ | 已用于「怎么画」那一半 |
| `chrome.storage.*` | ❌ **全系异步** | ✅ | ✅ | 权威源,但赶不上首帧 |
| `registerContentScripts` 的 `css` | ✅ | ❌ **只接受文件路径** | ❌ **实测不存活** | 已实测排除 |
| `sessionStorage` | ✅ | ✅ | ❌ 按标签页 | 上一轮方案,6 次闪 3 次 |
| **`localStorage`** | ✅ | ✅ | ✅ | **ADR-060 裁定采用** |

(第 3 行的「实测」为上一轮亲自验证:`chrome.scripting` 需 `scripting` 权限,
注册成功但 `css` 只收文件路径;且同 profile 重启后 `getRegisteredContentScripts()` 返回空。)

**只有 `localStorage` 同时满足前三列。** ADR-060 以「记录只含滤镜参数、
不含页面内容、绝不外传」为边界,授权了这唯一的通道,代价记入 §4.1。

### 零闪烁门禁本轮的加强

该门禁此前是**非确定性失败**(取决于缓存是否命中),所以判据同步收紧:

1. **覆盖三种缓存状态,缺一不可**(DESIGN.md §6 T4a 逐字要求),全部计入 fail:
   - `coldCache` —— 清空该 origin 的 `__ccf*` 键后首次访问(上一轮失败的正是它)
   - `newTab` —— 新标签页访问同一站点(`sessionStorage` 在此必然失败)
   - `restart` —— 浏览器进程完全退出后,用同一 profile 重启再访问
   外加 `hot`(同标签页再次导航)与 `off`(主开关关闭的基线,证明探针有效)。
2. **连续 5 次全部通过才算过** —— 单次通过不作数(`CCF_FLICKER_RUNS` 可覆盖,
   但验收必须是 5)。

## blindSpots 显式申报(T4a gate 逐字要求)

| # | 盲区 | 性质 | 处置 |
|---|---|---|---|
| 1 | **`coldCache` 首访仍有 1–3 帧带色**(2/15 场次) | **真实的 INV-3 缺口**,但根因是 MV3 平台约束(记录不存在时无任何同步通道),非实现缺陷 | **未掩饰**:判据照旧计入 fail,`flicker.cjs` 报 FAIL。已上报请求裁决,见上文 |
| 2 | 真实栈只覆盖 **github / wikipedia / hn** 三站 | gate 逐字指定的站点集 | 三站的 DOM 规模/布局差异很大(2313 / 7001 / 817 元素),但**不等于全网**。T0 曾警告「实现中发现 T0 方案在更广站点集上不成立」时应发 `BLOCKED_UPSTREAM` |
| 3 | 逐帧探针用 **新 headless**,非 headful | 本机 headful 合成器不产帧(见文末「环境修正」) | 已用基线组(15/15 带色)证明探针在该模式下确实能抓到带色帧 |
| 4 | 「带色」判据是**启发式**:单帧中 `max(r,g,b)-min(r,g,b)>12` 的像素占比 > 0.2% | 阈值是经验值 | 对灰阶模式有效;若将来默认模式改为三种**辅助**模式之一(它们输出仍是彩色),该判据**不适用**,需改判别方式 |
| 5 | `localStorage` 不可用时(`data:` 文档、站点禁用存储)快路径恒未命中 | 已知降级 | 功能本身由异步权威路径兜底,仅失去零闪烁保证。有单测覆盖「抛 SecurityError 不崩溃」 |
| 6 | 单测用 `FilterTarget` / `SyncKeyValueStore` 替身 | 不冒充真实栈 | INV-1 几何与 INV-3 零闪烁**只**由真实 Chrome 门禁判定,替身仅测与浏览器无关的编排逻辑 |

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
