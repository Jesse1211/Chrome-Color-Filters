# T6b REAL_STACK_GATE —— 复现方法与结果

> 本目录是 T6b(Popup 编辑视图)的**真实栈验收**脚本与证据。
> 脚本跑在 **`npm run build` 产物**(`.output/chrome-mv3/`)上 —— **ADR-038**。
> 启动参数复用 `docs/T4a-gate/lib.cjs` 的 `launch()` —— **ADR-067**(不访问操作系统密钥链)。

## 复现

```bash
# 0) 前置:生产构建 + Chrome for Testing(与 T4a/T4b 共用同一套环境)
npm run build
cd docs/T0-spike/spike-code
echo '{"name":"ccf-gate-deps","private":true,"version":"0.0.0"}' > package.json
npm i --no-save puppeteer-core@23 pngjs
npx @puppeteer/browsers install chrome@stable
cd ../../..   # 回到仓库根

# lib.cjs/本目录脚本从**自己的目录**向上解析依赖,做软链即可
# (`node_modules` 已在 .gitignore,任意深度都不入库)
ln -sfn ../T0-spike/spike-code/node_modules docs/T4a-gate/node_modules
ln -sfn ../T0-spike/spike-code/node_modules docs/T6b-gate/node_modules

# 1) 跑门禁(从仓库根)
node docs/T6b-gate/editview.cjs
```

## 结果

**GATE PASS 36/36**(证据:`evidence/editview.json`)

> 返工第 2 轮新增 2 条断言:ADR-044 的 `activeRuleIndex` / `shadowedRuleIndexes`
> **在真实栈里直接取值断言**(见下方「ADR-044 返工」)。

覆盖 §6 T6b 的 REAL_STACK_GATE 六项,逐项结果:

| # | gate 条款 | 结果 |
|---|---|---|
| 1 | 新建规则 → 拖滑块看实时预览 | **PASS** — 80/55/30 三档逐帧命中 `grayscale(0.8/0.55/0.3)`;同时断言**预览期间 `storage` 零写入**(规则列表仍为空) |
| 2 | **不保存关闭 popup** → 页面恢复原状 | **PASS** — 走 `onDisconnect` 路径,filter 回到 `none` |
| 2b | **不保存点「返回」**(popup 不关) | **PASS** — filter 回到 `none` 且 `popupStillOpen: true`,证明走的是**主动 `PREVIEW_CLEAR`** 而非 `onDisconnect`(与第 2 项**路径不同**,分别验证) |
| 2c | **预览中点「删除」** | **PASS** — 规则消失(`['*.wikipedia.org']`)+ 页面恢复 `grayscale(1)` + 回到列表视图 |
| 3 | **在 A 站编辑针对 B 站的规则** | **PASS** — 拖动滑块两次后 A 站 filter 仍为 `none`;提示行 `reason=pattern-mismatch` 且置灰;**滑块仍可改值**(§5.7) |
| 4 | **预览期间导航到新页面** | **PASS** — 预览 `grayscale(0.15)` → 导航 → 新页面按**规则**渲染 `grayscale(1)`(非预览值) |
| 5 | 遮蔽场景 → 解释框与一键修复的**渲染效果** | **PASS** — `◐` warn 状态行 + 琥珀解释框文案「第 1 条规则 \*.wikipedia.org 排在前面,已先命中。」;点一键修复后顺序落盘为 `['*.org','*.wikipedia.org']` **且当前页面渲染立即变成该规则的滤镜**(S13) |
| 6 | 非法字符 / 空 pattern → 保存禁用 | **PASS** — 空 pattern `kind=empty` + 保存禁用;`#` → `kind=illegal-character` + 指出该字符 + 输入框 `data-invalid=true` + 保存禁用 |

额外验证(不在六项内但属 gate 条款):

| 条款 | 结果 |
|---|---|
| **ADR-044 真实联调** | **PASS** — popup 发 `GET_TAB_STATE`,拿到 `{ tabId, injectable: true, host: 'en.wikipedia.org' }`;**且 §5.6 指定的两个字段已直接取值断言**:遮蔽场景下真实 SW 上报 `activeRuleIndex: 0` / `shadowedRuleIndexes: [1]`,一键修复后 `activeRuleIndex` 指向用户编辑的那条(`*.org`)且状态行变 `live`。⚠️ 上一轮只验了 `tabId`/`injectable`/`host` 三个字段,而 DESIGN.md:1016 指明的恰是另两个 —— 见下方「ADR-044 返工」 |
| **ADR-049 从 popup 上下文成立** | **PASS** — 第 1 项即其证据。T4b 的真实栈门禁是从 **service worker** 上下文发起 `chrome.tabs.connect` 的;popup 的权限面不同,这是**另一件事**,此处首次验证 |
| **F20 保存的语义** | **PASS** — 点保存后规则落盘为 `{pattern:'*.wikipedia.org', mode:'Grayscale', intensity:60}`(一次写入,ADR-061 立即落盘) |
| **⚠️ 保存触发 reconcile(ADR-062)** | **PASS** — 保存后**重新导航**,新规则对首帧生效(`grayscale(0.6)`),证明声明式注册已更新 |
| **INV-8 主开关 OFF** | **PASS** — OFF 期间页面始终 `none`,预览不可能把它点亮 |
| **ADR-013 / ADR-050** | **PASS** — `chrome://settings` 上显示琥珀说明条,且**主开关仍可用** |

---

## 🔴 本轮真实栈门禁抓到的一个**真实产品缺陷**(已修)

> 这是本门禁存在的最好证明:单测 60 个全绿、lint 零错误、`tsc` 退出码 0,
> 而真实栈第一轮就把它翻了出来。

### 现象

第 2c 项(预览中点「删除」)判红:删掉的**不是用户正在编辑的那条规则**。

```
rules after delete: ['*.org']          ← 期望 ['*.wikipedia.org']
afterDelete filter: BlueYellow 矩阵     ← 期望 grayscale(1)
```

### 根因

DESIGN.md §1 定义:**`FilterRule` 的身份 = 它在 `rules` 中的位置 + `pattern`**。

§5.6 的「一键修复」(把本条移到最上面)**改变位置**,于是它**改变了正在编辑的
那条规则的身份**。但 `editingIndex` 是调用方持有的视图状态,首版**不随之更新**:

1. 编辑一条被遮蔽的规则(`editingIndex = 1`);
2. 点「把这条移到最上面 ↑」→ 存储变成 `[本条, 原先的第 0 条]`;
3. `editingIndex` 仍是 `1` —— 现在指向的是**另一条规则**;
4. 点「删除」→ `onDelete(1)` 删掉了**用户没在编辑的那条**。

「保存」受同一缺陷影响:`updateRule(1, …)` 会**覆盖另一条规则**。
两者都是**静默的数据丢失** —— 用户看着自己那条规则按下删除,消失的是别人。

### 修法(additive / 向后兼容)

`RuleEditView` 新增**可选** prop `onReindex?: (nextIndex: number) => void`;
一键修复成功后调 `onReindex(0)`,由持有视图状态的调用方(`App.tsx`)
把 `editingIndex` 跟过去。

不在组件内部猜新索引 —— 索引归属**存储**,而本组件不读存储
(INV-14 / ADR-055:写入与真相都在仓储层)。故把事实上抛给调用方。

### 防回归

`src/ui/__tests__/edit-view-integration.test.tsx` 的
「🔴🔴 回归 · 一键修复后 editingIndex 跟随规则的新位置」三条用例。

**已验证非空转**:临时注掉 `onReindex?.(0)` 一行,三条全部判红。

---

## 🔴 探针有效性 —— 本脚本自己踩过的两个「看起来 PASS 其实空转」

真实栈门禁最大的风险不是判红,而是**以绿色的样子什么都没测到**。
本脚本在成形前踩了两个这样的坑,都已修正并写进 `openPopup` 的注释:

### 坑 1:popup 开成同窗口的 active tab

T5 的 `GET_TAB_STATE` 用 `chrome.tabs.query({ active: true, lastFocusedWindow: true })`
解析「当前 tab」。真实弹窗**不是 tab**,不参与这个查询。
但自动化里 popup 只能以**页面**形式驱动 —— 若把它开成 active tab,
它自己就成了 `active` 的那一个:

```
tabState = { injectable: false, reason: 'internal-page', host: null }
```

于是预览**永远不可用**,`PREVIEW_FILTER` 一条都不会发,
而「reason 符合预期」「提示行置灰」这类断言照样绿。
**整条预览链路一条都没测到。**

### 坑 2:popup 开成独立窗口,再把焦点还给目标页窗口

实测无效,两种模式都不行:

| 模式 | 实测 |
|---|---|
| headless | 两个窗口都报 `focused: true`;`chrome.windows.getLastFocused()` **恒为 popup 窗口** |
| headful | 本机两个窗口都报 `focused: false`(系统判遮挡,`lib.cjs` 已记载这个环境坑) |

**窗口焦点在本机自动化里不可控。**

### 可行解(当前实现)

把 popup 开成目标页**同一窗口里的 `active: false` tab**,并把目标页 tab
显式置为 active。于是 `query({ active: true, lastFocusedWindow: true })`
返回目标页 —— 与真实弹窗打开时的语义**完全一致**,且不依赖任何窗口焦点。

证据(`evidence/editview.json` 第 5 条断言):

```json
{ "tabId": 872425079, "injectable": true, "host": "en.wikipedia.org" }
```

### 附带的一个平台事实:后台 tab 收不到合成输入

popup 既然是**后台(非可见)tab**,`page.click()` 就会一直等到
`Runtime.callFunctionOn` 协议超时 —— Chrome 不向不可见的 tab 投递合成输入。
故本脚本用页面内 `el.click()` 派发。

这不是放宽:`el.click()` 走同一条 DOM 事件派发路径,React 的 `onClick` 与
`disabled` 语义**完全一致**(`disabled` 的元素上 `click()` 不触发 `onClick`,
那是平台行为而非我们另加的 `if`),所以「禁用 → 点了没反应」这类断言照样成立。
真实鼠标命中测试(元素是否被遮挡)属几何/遮挡范畴,不在本门禁范围。

---

## blindSpots(显式申报,不掩盖)

本门禁**未覆盖**的内容:

1. **真实弹窗的「失焦即销毁」时序**。第 2 项用 `page.close()` 模拟 popup 销毁 ——
   文档被拆、端口随之 `onDisconnect`,与真实弹窗销毁走**同一条平台路径**,
   但不是同一个触发源(真实弹窗由失焦触发)。ADR-061 的 300ms 窗口问题
   已在 T6a 的门禁里按「重排后立即销毁」验过,本任务不重复。
2. **锁定中编辑视图的真实栈行为**。锁定态的真实栈验收属 T6c 的门禁;
   本门禁只验「预览与锁定永不共存」的**结构性**保证(I2),
   那条在源码层面由 `tests/t6b-static-gates.test.ts` 与
   `App.tsx` 的视图判别联合把守,无需真实浏览器。
3. **像素级视觉验收**(色值、字体、圆角是否与设计稿一致)。
   本门禁断言的是 `data-*` 状态与 `getComputedStyle(html).filter`;
   §5.1 token 的逐值一致由 `src/ui/__tests__/design-tokens.test.ts` 在 jsdom 里
   按「声明引用了哪个 token + 该 token 取值」两段断言(见 `css-harness.ts` 的
   jsdom 限制说明)。真正的像素比对留给人类复核与 T7。
4. **站点多样性**。只在 `en.wikipedia.org` 上跑。SPA、跨域 iframe、视频站
   的预览表现属 T4b(已验存活性/非侵入)与 T7 的范围。
5. **多窗口并发预览**。「两个窗口的 popup 连同一个 tab」的归属令牌语义
   已由 T4b 的 `preview.cjs` 在真实栈验过(多端口场景),
   本门禁不重复该平台事实。
6. **第四种不发送条件(锁定中)的真实栈断言**。单测已穷举
   (`pattern-status.test.ts` + `rule-edit-view.test.tsx`),
   真实栈需要先启动一个锁定,那属 T6c 的夹具;此处只验其余三种。

---

## 🔴 ADR-044 返工(第 2 轮)—— §5.6 两维状态行的真相来源被倒置

### 评审指出的问题

DESIGN.md:1016(ADR-044 契约块)点名:

> `activeRuleIndex` 与 `shadowedRuleIndexes` 一起支撑 T6a 的被遮蔽淡化(ADR-032)
> 与 **T6b 的两维状态行(§5.6)**,**两个视图都不自己算匹配** —— 真相来源唯一

第 1 轮的 `src/ui/pattern-status.ts` 却**两维都在本地算**:
`matchGlob(draftPattern, host)` 判第一维,一个本地的首个命中胜扫描判第二维,
全程不读那两个字段。更糟的是模块头注写着「一律取自 `TabState`…**绝不另算**」,
与代码相反;单测还用一个带「ADR-044」字样的用例把这个偏离**锁了进去**;
本文档则据 `tabId`/`injectable`/`host` 三个字段报了「ADR-044 真实联调 PASS」——
而 ADR 指定的那两个字段**一次都没被断言过**。

即:一个绿色门禁盖在一处未上报的架构偏离之上。这正是 §8 第 1 条
(「任务与 ADR 冲突时**停下并上报**」)与第 3 条(「不得编造依据」)要防的事。
当时给出的「那条约束针对的是已持久化的规则」这一缩小解释,DESIGN.md 里并不存在。

### 根因

把问题当成了「`TabState` 回答不了草稿,所以本地算」,于是**一刀切**地全本地算。
真正的分界线是**草稿脏不脏**:

| 情形 | 真相来源 |
|---|---|
| 编辑既有规则、pattern 未改动(草稿**干净**) | **`TabState`**(ADR-044)—— SW 的 `resolveRule` 已经算过这条 |
| 新建规则 / pattern 已改动(草稿**脏**) | 本地 `matchGlob` —— `activeRuleIndex` 是**存储索引**,描述的是旧 pattern,结构上无从回答 |

第 1 轮把干净草稿也划进了「本地算」,而那恰恰是 `TabState` 能答、且 ADR 指定它答的那一格。

### 修复(全部向后兼容)

1. **`src/ui/pattern-status.ts`** —— 新增 `resolveDimensions()` 作为两维的唯一出口:
   干净草稿走 `resolveFromTabState()`(读 `activeRuleIndex` / `shadowedRuleIndexes`,
   遮蔽者由 `activeRuleIndex` 指出),脏草稿才落到 `findBlockerForDraft()`。
   头注改成与代码一致,并把分界线写成表格。顺手去掉了 `findBlocker` 里
   那个「存在只为被 `void` 掉」的 `draftPattern` 形参(评审 S4)。

2. **`src/ui/usePopupSettings.ts`** —— 新增 `refreshTabState()`:
   任何写入成功后(以及 `storage.onChanged` 回调时)**重新问一次 `GET_TAB_STATE`**。
   这是让 1 成立的前提:那两个字段是**存储索引**,一键修复 / 保存 / 删除都会让它们失效。
   正确做法是重问唯一真相来源,而**不是**在 UI 里推算新索引 —— 后者正是 ADR-044 禁止的。
   (`repository.subscribe` 走 `storage.onChanged`,本窗口自己的写入不回调自己,故须显式刷新。)

3. **测试夹具改成契约自洽**。原先多处 `TabState` 填 `activeRuleIndex: null` 却同时
   断言「匹配且生效」—— 那是**真实 SW 不可能产生**的自相矛盾响应(页面命中了规则
   却没有生效者)。修的是夹具,**断言一条没放宽**;另新增一组 5 条用例,
   故意让本地匹配结果与 `TabState` **相反**,证明赢的是 `TabState`。

4. **`edit-view-integration.test.tsx` 不再用静态 stub**:`tabStatePort` 换成
   T5 的 `computeTabState` **本体**,输入是当前存储里那份 settings。
   两个 ADR-044 字段因此被真实走过一遍,而不是被旁路。

5. **真实栈补证**:`editview.cjs` 新增 2 条断言直接取这两个字段的值(见上表)。

### ⚠️ 一处必须留在本地判定的例外(已在代码中记明)

`compute-tab-state.ts` 明文规定(并有测试锁定)**主开关 OFF 时
`activeRuleIndex` 与 `shadowedRuleIndexes` 同时归零态**,理由是「被遮蔽」
在无人生效时是谎话。那两个字段因此**只编码第二维**;主开关 OFF 时它们对
「这条 pattern 匹不匹配当前页」保持沉默。

而 §5.6 的第一维是**页面与 pattern 的关系**,与主开关无关 —— 表格第二行
(`◐` 匹配但不生效)正是「匹配 ✓ / 生效 ✗」这一格。若主开关 OFF 时照搬归零的
字段,状态行会退化成 `○`「不匹配当前网站」,而 pattern 明明匹配。
故主开关 OFF 时第一维取本地 `matchGlob`。

这**不是**绕开 ADR-044,而是 `TabState` 在该状态下按设计不携带这一维的信息。
对应用例:`pattern-status.test.ts` 的「主开关 OFF:TabState 两字段按设计归零,
第一维只能本地取」。
