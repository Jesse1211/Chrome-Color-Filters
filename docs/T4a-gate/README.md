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
cd ../../..   # 回到仓库根

# ⚠️ lib.cjs 位于 docs/T4a-gate/,Node 从**它自己的目录**向上解析依赖,
#    够不着 docs/T0-spike/spike-code/node_modules —— 症状同样是
#    MODULE_NOT_FOUND: puppeteer-core(实测踩过)。做一个软链即可:
ln -sfn ../T0-spike/spike-code/node_modules docs/T4a-gate/node_modules
#    (`node_modules` 已在 .gitignore 第 10 行,任意深度都不入库。)

# 1) 跑各项(从仓库根)
node docs/T4a-gate/geometry.cjs     # INV-1 几何:fixed/sticky 屏幕位置
node docs/T4a-gate/styles.cjs       # INV-1 计算样式 + 移除后无残留
node docs/T4a-gate/flicker.cjs      # INV-3 零闪烁(逐帧 × 四种场景 × 连跑 5 次)
node docs/T4a-gate/multitab.cjs     # 🔴 INV-3 冷启动 + 会话恢复 + 10 标签页 × 5 轮
node docs/T4a-gate/declarative.cjs  # 🔴 ADR-062/064/065 声明式注册正确性
node docs/T4a-gate/inv8.cjs         # INV-8 主开关关闭时完全不工作
node docs/T4a-gate/modes.cjs        # 四种模式在真实 Chrome 中确实生效
```

## 结果(evidence/ 内有原始 JSON 与截图,均为**本轮 v3(ADR-062 声明式注册)** 重新生成)

> 🔴 **本轮是架构变更**,不是上一轮的续做。首帧滤镜改由
> `chrome.scripting.registerContentScripts()` 的**预生成 CSS 文件**承担
> (ADR-062/063/064/065),不再依赖 content script 的运行时查询。
> 上一轮唯一未关闭的 `coldCache` 一格**因此消失** —— 见下。

| 项 | 结果 |
|---|---|
| **geometry**(INV-1) | **PASS** — github/wikipedia 所有同时存在的 fixed/sticky 元素位移 **dx=0, dy=0**;滤镜态 `maxChannelSpread=0`(真灰阶),基线 200–255(探针有效) |
| **styles**(INV-1) | **PASS** — 可归因于滤镜的计算样式/几何差异 **0 处**(本轮实测 github 2314 / wikipedia 6509 / hn 817 元素);移除后**零残留** |
| **flicker**(INV-3) | 🔴 **PASS(连续 5 轮全绿)** — `coldCache` / `newTab` / `restart` / `hot` **四格全部 0 带色帧**。基线 `off` 2579/2608 帧带色,证明探针有效。**上一轮失败的 `coldCache` 已关闭** |
| **multitab**(INV-3) | 🔴 **PASS(连续 5 轮全绿)** — 冷启动 + 会话恢复 + 10 个重标签页并发加载,合计 **0 / 892 帧带色**。这是 DESIGN.md 点名「ADR-062 唯一可能被推翻」的场景 |
| **declarative**(ADR-062/064/065) | **PASS(16/16 断言)** — 分组、幂等、diff、持久化、主开关清空、跨重启存活、**扩展更新恢复** 全部在真实 Chrome 中核实 |
| **inv8**(INV-8) | **PASS** — 主开关关闭时**整个加载过程中滤镜一瞬都未出现**(`everOn=false`),无属性/变量/注入节点;且 `getRegisteredContentScripts()` 返回 `[]`。对照组 `everOn=true`,证明探针有效 |
| **modes** | **PASS** — 四种模式全部在真实 Chrome 生效,三种辅助模式的内联 `data:` URI 被 Chrome 接受 |

### 🔴 `coldCache` 为什么消失了(本轮的核心结论)

**上一轮(ADR-060,localStorage 快路径)的 5 轮实测:**

| 场景 | 带色场次 |
|---|---|
| `coldCache` | **3 / 15** ❌ |
| `newTab` / `restart` / `hot` | 0 / 15 ✅ |

失败的机理是**架构性的,不是实现缺陷**:缓存必须先被填充才能被读到,
而「冷缓存」的定义就是还没有记录。五次独立测量,失败位置从未移动。

**本轮(ADR-062,声明式注册)的 5 轮实测:**

| 场景 | 带色帧 / 总帧 |
|---|---|
| `coldCache` | **0 / 1221** ✅ |
| `newTab` | 0 / 1270 ✅ |
| `restart` | 0 / 1240 ✅ |
| `hot` | 0 / 1427 ✅ |
| `off`(基线) | 2579 / 2608(探针有效性对照) |

机理:规则是用户在 popup 里创建的,此刻 SW 必然活着,注册当场完成并写入
浏览器的磁盘 StateStore。之后首次访问该站,浏览器**从磁盘恢复注册、
不依赖 SW 先启动**,CSS 在首帧之前注入。
**不再有缓存需要填充,所以不再有「第一次」。**

原始 JSON:`evidence/flicker.json`(5 轮)、`evidence/multitab.json`(5 轮)。

### 🔴 本轮踩中并修掉的真实缺陷:两次「把 JS 放回首帧关键路径」

架构换对了,但**实现上连续两次**把 JS 重新放回了页面加载的关键路径 ——
两次都被真实 Chrome 的逐帧录屏当场抓住。记录在此,因为这是
ADR-062 下**最容易重犯**的错误。

**缺陷 A:预生成 CSS 用了属性门控 `html[data-ccf-on]`。**

理由当时听起来很充分(主开关 OFF 时不上色、超集多匹配的站点不误伤),
但门控属性由 JS 设置,于是:

```
raf1               attr=false  computed=none          ← 首帧:CSS 到场但不选中任何元素
ready:interactive  attr=false  computed=none
ready:complete     attr=true   computed=grayscale(1)  ← JS 终于设上属性,太晚了
```

`coldCache` 3/3 站点带色。**修法**:预生成 CSS 用**裸 `html`**(ADR-063 原文),
主开关 OFF 由「**根本不注册**」表达,而不是由「样式表选不选中」表达。

**缺陷 B:压制规则写成了否定式 `html:not([data-ccf-on])`。**

特异度算对了((0,1,1) > (0,0,1)),**时序想错了**:
`:not([data-ccf-on])` 在属性还没被设上时就成立 —— 也就是整个首帧期间都成立。
于是压制规则把预生成 CSS 压掉了:

```
t=281ms  f=none          attr=false   ← 首帧:压制规则命中
t=347ms  f=grayscale(1)  attr=true    ← JS 设属性后滤镜才出现
```

`coldCache` 6 次里 4 次带色(非确定性,随站点与时序漂移)。
**修法**:改用**肯定式**属性 `data-ccf-off` —— 默认不压制,
只有 JS **明确判定**不该上色时才设上它。

> **共同教训:任何依赖「JS 尚未设置的属性」的默认态,
> 都等于把 JS 放回首帧的关键路径上。** 两条断言已留在
> `src/injection/__tests__/filter-css-selector.test.ts` 与
> `tests/filter-css-files.test.ts` 中,防止它们被「优化」回来。

### 门禁自身的变异测试(证明它抓得住回归)

把**构建产物**里的 404 个预生成 CSS 的裸 `html` 改回 `html[data-ccf-on]`
(即缺陷 A),重跑 flicker → **FAIL(hn coldCache 2/4 帧带色)**。
门禁确实抓得住,不是假绿。

> 📌 顺带发现一个好性质:直接改 `public/filters/` 再 `npm run build` **抓不到** ——
> 因为 `prebuild` 钩子会重新生成、把手改覆盖掉(ADR-063 的防漂移意图)。
> 要做这个变异测试必须改**产物**。

## 修掉的缺陷

> 📌 **下面第 1–4 条是本任务**前几轮**的历史记录**(ADR-060 及更早的架构),
> 保留是为了解释决策脉络,**不代表当前状态**。本轮(ADR-062 声明式注册)
> 修掉的两个缺陷见上文「两次『把 JS 放回首帧关键路径』」。
> 其中第 2 条提到的 `coldCache` 失败**已在本轮关闭**(0/1221 帧)。

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

### 2. 【历史·ADR-060 轮】零闪烁非确定性失败 → 改用宿主 origin 的 `localStorage`

> ⚠️ **历史记录。** 该方案关闭了 `newTab`/`restart`/`hot` 三格,
> 但 `coldCache` 在其架构下无解,最终由本轮的 ADR-062 彻底解决。
> 下面提到的截图 `REGRESSION-cold-start-unfiltered-BEFORE-fix.png`
> 已随本轮证据刷新一并删除(它记录的是两轮之前的状态)。

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

## INV-3:上一轮的 blindSpot 已由 ADR-062 **彻底**关闭

上一轮在 ADR-060(`localStorage` 快路径)下关闭了 `newTab`/`restart`/`hot` 三格,
但 `coldCache` 一格**在该架构下无解** —— 缓存必须先被填充才能被读到。
本轮的 ADR-062 换掉了架构,该格随之消失。

保留原始的通道取舍矩阵,因为它解释了**为什么必须换架构**,
也防止后人重走一遍:

| 同步通道 | `document_start` 之前生效 | 能携带动态 filter 值 | 跨浏览器重启存活 | 备注 |
|---|---|---|---|---|
| manifest `css` 数组 | ✅ | ❌ 静态文件 | ✅ | 服务已打开页面的实时更新 |
| `chrome.storage.*` | ❌ **全系异步** | ✅ | ✅ | 权威源,但赶不上首帧 |
| `sessionStorage` | ✅ | ✅ | ❌ 按标签页 | 更早的方案,6 次闪 3 次 |
| `localStorage`(ADR-060) | ✅ | ✅ | ✅ | **修不了 `coldCache`**:键不存在时不存在命中 |
| **`registerContentScripts` 的 `css`(ADR-062)** | ✅ **且不受 `runAt` 约束** | ✅ 经**预生成文件**(ADR-063) | ✅ `persistAcrossSessions` | **本轮采用** |

> ⚠️ 上一轮曾把最后一行判为「不可行」,依据是「`css` 只接受文件路径」与
> 「实测不跨重启存活」。**前者属实,后者是误判** —— 它被
> **ADR-063 的预生成文件**(把动态值预先铺成 404 个静态文件)化解,
> 而持久化需要显式写 `persistAcrossSessions: true`。
> 本轮在真实 Chrome 中实测确认:注册**确实**跨浏览器重启存活
> (`declarative.cjs` 第 6 项断言),且 CSS 在首帧之前到场。

### 零闪烁门禁本轮的加强

1. **覆盖三种缓存状态,缺一不可**(DESIGN.md §6 T4a 逐字要求),全部计入 fail:
   - `coldCache` —— 清空该 origin 的 `__ccf*` 键后首次访问(上一轮失败的正是它)
   - `newTab` —— 新标签页访问同一站点
   - `restart` —— 浏览器进程完全退出后,用同一 profile 重启再访问
   外加 `hot`(同标签页再次导航)与 `off`(主开关关闭的基线,证明探针有效)。
2. **连续 5 次全部通过才算过** —— 单次通过不作数(`CCF_FLICKER_RUNS` 可覆盖,
   但验收必须是 5)。
3. 🔴 **新增 `multitab.cjs`** —— 冷启动 + 会话恢复 + 10 个重标签页**并发**加载,
   同样连跑 5 轮。这是 DESIGN.md 点名「ADR-062 唯一可能被推翻」的场景:
   理论风险是某个导航在扩展系统读完磁盘 StateStore 之前就提交。
   **实测 0 / 892 帧带色,风险未兑现。**
4. 🔴 **新增 `declarative.cjs`** —— 在真实 Chrome 中核实注册本身的正确性
   (分组/幂等/diff/持久化/主开关清空/**扩展更新恢复**),共 16 条断言。
   单测用假端口验的是我们自己的逻辑,本脚本验的是**平台真的照做了**。

## blindSpots 显式申报(T4a gate 逐字要求)

| # | 盲区 | 性质 | 处置 |
|---|---|---|---|
| 1 | **glob → match pattern 的转换是「超集」,不是等价** | 平台约束:Chrome match pattern 的 host 部分只允许整体 `*` 或前导 `*.`,表达不出 `*.baidu.*`、`news*.sina.com` 这类模式 | **有意为之且方向正确**:漏匹配会破 INV-3,多匹配只是注入一张**不选中任何元素**的样式表(预生成 CSS 虽是裸 `html`,但 JS 路径会设 `data-ccf-off` 把它压回 none)。有跨 host 全集的性质测试把「超集」钉死(`match-pattern.test.ts`) |
| 2 | **被超集多匹配进来的站点,首帧会短暂上色**,直到 JS 设上 `data-ccf-off` | 真实的、已知的窄口代价 | 只影响**无法被 match pattern 精确表达**的 glob(纯字面与 `*.suffix` 两类最常见的写法都是**精确**的,不受影响)。用属性门控去消除它会**反过来破坏全部站点的 INV-3**(本轮实测,见上文缺陷 A),是明显亏本的交易 |
| 3 | 真实栈只覆盖 **github / wikipedia / hn** 三站 | gate 逐字指定的站点集 | 三站的 DOM 规模/布局差异很大(2314 / 6509 / 817 元素),但**不等于全网** |
| 4 | 逐帧探针用 **新 headless**,非 headful | 本机 headful 合成器不产帧(见文末「环境修正」) | 已用基线组(2579/2608 帧带色)证明探针在该模式下确实能抓到带色帧 |
| 5 | 「带色」判据是**启发式**:单帧中 `max(r,g,b)-min(r,g,b)>12` 的像素占比 > 0.2% | 阈值是经验值 | 对灰阶模式有效;若将来默认模式改为三种**辅助**模式之一(它们输出仍是彩色),该判据**不适用**,需改判别方式 |
| 6 | **扩展更新清除注册**这一平台行为是**模拟**的(先手动 unregister 再派发 `onInstalled`),未做真实的扩展版本升级 | 真实升级需要打包两个版本并走 CRX 更新流程,成本远高于收益 | 模拟的是 ADR-065 所描述的**确切**状态(注册已被清除 + `onInstalled` 触发),恢复路径被完整走过。单测另有「回读陈旧内容时 diff 会误判 no-op」的对照组 |
| 7 | `localStorage` 快路径(ADR-060)保留为**过渡期双重保险**,已不是首帧保证的承担者 | 按 ADR-060 原文「可在一个版本周期后移除」 | 本轮未移除,因为移除不属于 T4a 的范围;它现在只是一层冗余,失效也不影响 INV-3(首帧由注册承担) |
| 8 | 单测用 `FilterTarget` / `SyncKeyValueStore` / `FakeScriptingPort` 替身 | 不冒充真实栈 | INV-1 几何与 INV-3 零闪烁**只**由真实 Chrome 门禁判定;替身仅测与浏览器无关的编排逻辑,且每一条都有对应的真实栈断言(`declarative.cjs`) |
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
