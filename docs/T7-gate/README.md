# T7 端到端验收 —— 复现方法、结果与 blindSpots

> §6 T7:「覆盖全部不变式的端到端验证,在真实 Chrome + 真实网站上运行。
> 这是唯一能证明『系统真的能跑』的关卡 —— 各任务的单元门禁不自动组合成整体保证。」
>
> 全部脚本跑在 **`npm run build` 产物**(`.output/chrome-mv3/`)上 —— **ADR-038**。

## 复现

```bash
# 0) 前置(与 docs/T4a-gate/README.md 完全一致)
npm ci
npm run build
cd docs/T0-spike/spike-code
echo '{"name":"ccf-gate-deps","private":true,"version":"0.0.0"}' > package.json
npm i --no-save puppeteer-core@23 pngjs
npx @puppeteer/browsers install chrome@158.0.8127.36
cd ../../..
ln -sfn ../T0-spike/spike-code/node_modules docs/T7-gate/node_modules

# 1) 仓储层探针(INV-14 需要「绕过 UI 调仓储层」,见 build-probe.mjs 的论证)
node docs/T7-gate/build-probe.mjs

# 2) 【新增】四项 —— T7 存在的核心理由
node docs/T7-gate/inv6-e2e.cjs            # INV-6 端到端:UI 建的规则 → 实际渲染
node docs/T7-gate/inv10-pathological.cjs  # INV-10 真实加载路径上的病态模式首帧耗时
node docs/T7-gate/lock-e2e.cjs            # 🔒 INV-11/12/13/14/15 端到端(含真实重启 + 真实到期)
node docs/T7-gate/persistence.cjs         # ADR-010 持久化(完全退出并重启)
node docs/T7-gate/visual-modes.cjs        # 四个滤镜在真实网页上的视觉证据(留档供人类复核)
node docs/T7-gate/inv7-capacity.cjs       # 【回归】INV-7 第 21 条被拒(此前无任何真实栈覆盖)

# 3) 【回归】上游门禁在合并后的完整系统上重跑
node docs/T4a-gate/geometry.cjs     # INV-1 几何
node docs/T4a-gate/styles.cjs       # INV-1 计算样式
node docs/T4a-gate/flicker.cjs      # INV-3 零闪烁
node docs/T4a-gate/multitab.cjs     # INV-3 冷启动 + 会话恢复 + 多标签
node docs/T4a-gate/liveupdate.cjs   # 已打开标签页的实时更新
node docs/T4a-gate/declarative.cjs  # ADR-062/064/065 声明式注册
node docs/T4a-gate/inv8.cjs         # INV-8 主开关
node docs/T4a-gate/modes.cjs        # 四模式像素级生效
node docs/T4b-gate/liveness.cjs     # INV-5 SPA 存活性
node docs/T4b-gate/noninvasive.cjs  # INV-9 隐私三项机械判定
node docs/T5-gate/tabstate.cjs      # INV-4 / ADR-044
node docs/T6b-gate/editview.cjs     # Popup 编辑视图
```

## 结果

### 【新增】

| 门禁 | 结果 | 要点 |
|---|---|---|
| **inv6-e2e** | **PASS (13/13)** | 两条规则**全程经真实 popup UI 建立** → wikipedia 得 `grayscale(1)`、example.com 得 B/Y 矩阵;顺序即优先级(ADR-008)落盘正确;**反向确认**:删掉专属规则后 wikipedia 改由通配规则生效。同时端到端验了 INV-2(渲染出的 filter 函数**恰好一个**) |
| **inv10-pathological** | **PASS (9/9)** | 101 条规则(100 条 `*`×100 + 1 条命中)vs 1 条基线,**真实 wikipedia 加载路径**上 FCP 中位数 **312ms vs 316ms(1.114×)**;绝对 < 5000ms;声明式注册塌缩为 **1 条**(未按规则数膨胀) |
| **lock-e2e** | **PASS (42/42)** | 主开关 OFF 下启动锁定 → **ADR-057 原子开启主开关**且真实页面真的上色 → 改规则/关主开关/缩短/解锁**全被拒(`kind:'locked'`)**、延长**成功** → **真实进程退出 + 重启** → 锁定仍强制、剩余按绝对时间递减 → **真实等待到期** → 自动解锁、设置可改、UI 翻回 |
| **persistence** | **PASS (13/13)** | 5 条规则经 UI 建立 + 一次经 UI 重排 → **完全退出 Chrome** → 规则与**顺序逐字完好**;ADR-025 键集未污染;重启后规则**真的仍在生效**(数据完好 ≠ 行为完好);ADR-062 注册跨重启存活 |
| **inv7-capacity** | **PASS (12/12)** | 【回归】但**此前无任何真实栈门禁**覆盖:第 21 条被仓储层拒绝,结构化错误 `kind:'other'` + `reason:'capacity-exceeded'`(逐字核对 `errors.ts`),原 20 条**一字未动**(ADR-012);UI 容量提示文案逐字符合、「新建」入口禁用、`20/20` 计数;删一条即可再加(闭环) |
| **visual-modes** | **FAIL (32/34)** — 两红**均在 HN**,已定位到平台层,见下 | wikipedia 四模式**首次导航即全过**;Grayscale 真实网页 `maxSpread=0`;三辅助模式保有色彩且用内联 data: URI。截图 + 人类复核索引见 `evidence/visual-modes.md` |

### 🔴 `visual-modes` 的两条红灯:已定位,**不是产品缺陷**,但**按根因纪律保留为红**

**现象**:在 `news.ycombinator.com` 上,某个辅助模式的确定性色块**像素完全未变**。

**已排除的解释**(每条都做了受控实验,见 `visual-modes.cjs` 文件头):

1. **不是钳制不动点。** 主判据色 `#66ff33` 在三个矩阵下的逐通道总变化量都 > 130
   (穷举筛出来的)。
   ⚠️ 但**HN 自己的主色确实是不动点**:`#ff6600` / `#ff8800` 在 GreenRed 下
   R 溢出钳到 255、B 负值钳到 0、G 不变 → **像等于原色**,
   底色 `#f6f6ef` 只变 1/255。这解释了「HN 整页看起来几乎没变」,
   是矩阵的**正确行为**。曾因此误判为缺陷,已用矩阵乘法独立验算澄清。
2. **不是 quirks 模式。** HN 无 doctype(`compatMode=BackCompat`),曾怀疑它使
   data: URI 的 SVG 滤镜失效。**受控 A/B**(同一页面、唯一变量是 doctype)
   证明两者**都正常生效**。
3. **不是 stacking context / `position:fixed`。** 普通文档流内的静态元素
   同样未变。
4. **不是陈旧读数。** `getComputedStyle(html).filter` **始终**是正确的 data: URI
   (长度 323),`data-ccf-on` 在位,`--ccf-filter` 在位 —— 产品该做的全做了。
5. **强制重绘无效**(filter 置 `none` 再置回)。

**结论**:这是**本 headless Chrome 构建在该站点上的合成/光栅化非确定性**。
证据:
- **站点相关**:example.com / wikipedia **0/6 失败**,HN **5/6 失败**;
  本门禁里 wikipedia 四模式**第 1 次导航即全过**,HN 需 4–5 次且仍间歇失败。
- **模式无关且漂移**:失败的模式逐轮变化(一轮 GreenRed,下一轮
  RedGreen+BlueYellow,再下一轮全过)—— 真实缺陷不会这样漂移。
- **独立佐证**:`docs/T4a-gate/modes.cjs`(像素级硬判、四模式)**PASS**,
  四个矩阵在真实 Chrome 中确实生效。

**为什么仍判红而不降级为 WARN**:根因纪律要求「不得为了让门禁变绿而放宽断言」。
断言本身是对的 —— 它确实观测到「该被变换的像素没被变换」。
**此处需要人类决定**:是接受「HN 在本 Chrome 构建下的像素判据不可靠」
并把该站点从**这一条**判据中剔除,还是换一个更稳定的第二站点。
已作为 needs-human 事项上报,**未自行改动产品代码,也未放宽断言**。

### 【回归】

| 门禁 | 结果 |
|---|---|
| geometry(INV-1) | **PASS** — fixed/sticky 位移 dx=0 dy=0 |
| styles(INV-1) | **真正的 INV-1 判据 PASS**(可归因于滤镜的差异 **0 处 / 9631 个元素**);但「移除后零残留」子项判红 —— **门禁自身与 INV-5 赛跑**,见下 |
| flicker(INV-3) | **PASS(连续 5 轮全绿)** — 四场景 0 带色帧,基线证明探针有效 |
| multitab(INV-3) | **PASS(连续 5 轮全绿)** — 冷启动 + 会话恢复 + 10/10 标签页被观测 + 基线对照成立 |
| liveupdate | **PASS** |
| declarative(ADR-062/064/065) | **PASS** |
| inv8(INV-8) | **PASS** — 关闭时全程未出现滤镜,注册表为空 |
| modes | **PASS** — 四模式像素级生效 |
| liveness(INV-5) | **PASS** — SPA 站内跳转 + 注入物被移除后自愈 |
| noninvasive(INV-9) | **PASS** — 三项机械判定(静态 a/b + Network 实测 c) |
| tabstate(INV-4/ADR-044) | **PASS** |
| editview(T6b popup) | **PASS** |

### 🔴 `styles` 的「移除后有残留」:**门禁自身与 INV-5 的竞态**,不是产品缺陷

`docs/T4a-gate/styles.cjs` 的流程是:快照 → **自己** `removeAttribute('data-ccf-on')`
+ `removeProperty('--ccf-filter')` → 再快照(同一个任务内)→ **另一个
`page.evaluate`** 里查残留。

实测分解(`scratchpad` 的 residue 实验):

| 时机 | 观测 |
|---|---|
| **同一任务内**立即读 | `attrs: []`, `styleHasVar: false` → **移除是干净的** |
| **下一个任务**读(= 残留检查所在处) | `attrs: ['data-ccf-on']`, `styleHasVar: true` |
| **真正删掉规则**后读 | `attrs: ['data-ccf-off']`, `filter: 'none'` → **清理正确** |

原因:规则**仍然命中**该站点,于是产品的 **INV-5 自愈**(「站点脚本移除注入物后
必须自动恢复」,ADR-017)在下一个任务里把属性重新装了回去 —— 那正是
`docs/T4b-gate/liveness.cjs` **硬判并通过**的行为。门禁把「自愈」误读成「残留」。

**真正的 INV-1 判据(`attributable`)在三个站点上全部为 0**
(github 2311 / wikipedia 6510 / hn 810 个元素),即「切换滤镜不引入任何
颜色之外的差异」成立。

该缺陷在 **T4a 的门禁脚本**里,属上游任务的职责面;本任务**未修改它**
(分工纪律),如实上报。修法是显然的:残留检查应在**删掉规则之后**做,
或与移除放在同一个任务内。

三道常规门禁:`npm test` **1058 passed (44 files)**、`npm run lint` **0 错误**、
`npm run compile` **退出码 0**(ADR-066)。

---

## 🔴 blindSpots(§6 T7 要求**显式申报**;空的或敷衍的申报等同于门禁失败)

### 站点类型

1. **需要登录态的站点完全未覆盖。** gmail / x.com(§6 T7 **逐字点名**了 x.com)、
   银行、企业内网一概没测 —— 无头 agent 没有账号。
   本轮 x.com 实测返回 `chrome-error://chromewebdata/`(本沙箱网络不可达),
   已如实留档且**不参与判定**,改用 wikipedia + example.com 做同构验证。
   **风险**:登录后的 SPA 往往有更复杂的 iframe / Shadow DOM / CSP,
   INV-5(存活性)与 INV-1(布局)在那类站点上**未经验证**。
2. **`<iframe>` 内的跨域内容未单独验证。** 滤镜施加在顶层 `<html>`,
   理论上 iframe 随父合成而被一同变换,但**没有**针对跨域 iframe
   (广告位、嵌入式播放器、支付框)的专门门禁。
3. **Canvas / WebGL / `<video>` 未验证。** 这三者的像素路径与普通 DOM 不同,
   SVG 滤镜对它们的效果(以及性能代价)完全未测。
4. **PDF 查看器、`chrome://` 内部页、Web Store** 按 ADR-013 本就不可注入,
   T5 验的是「正确上报原因」,**不是**「滤镜生效」。
5. **只测了桌面视口(1280×900)。** 移动端模拟视口、高 DPI(devicePixelRatio>1)、
   多显示器混合 DPI 未测。

### 场景

6. **真实到期只测了 ~1.5 分钟的锁定。** 跨天 / 跨夏令时切换 / 设备休眠唤醒后的
   锁定行为**未实测**(ADR-059 的单调下界有单元测试覆盖,
   但「真的睡一夜再看」没做)。
7. **系统时钟未真的被改动。** INV-15 用的是**注入倒退时钟**
   (`SettingsRepositoryOptions.clock`,ADR-059 为此而设)—— 它精确作用在机制上,
   但没有验证「用户在操作系统层面改时间」时 Chrome / 扩展的其它行为。
8. **20 条上限只在单元层与 INV-7 门禁验过;100 条病态规则是经门禁 fixture
   播种的超限状态**,不代表产品可达。
9. **多 Chrome profile / 多窗口并发写入未测。** ADR-010 改 local 后跨设备同步
   已出局,但「同一台机器两个窗口同时改设置」只有 `onChanged` 的单元覆盖。
10. **扩展更新(onInstalled/update)跨版本迁移未端到端测。**
    ADR-065 的注册恢复有 T4a 的 declarative 门禁,
    但「v1 的数据被 v2 读」这条迁移路径没有真实的双版本实测。
11. **网络条件单一。** 全部在正常宽带下跑;慢速 3G / 离线 / 请求被拦截时
    首帧与 SPA 存活性未测。
12. **无障碍与键盘导航未验。** popup 的焦点顺序、屏幕阅读器播报
    不在本门禁范围(§6 把 i18n 与 a11y 列为首版延后项)。

### 门禁仪器自身的已知弱点

13. **`visual-modes` 在 HN 上的像素判据不可靠**(见上文长篇分析)——
    这是**已知且已定位**的仪器/平台弱点,不是产品结论。
14. **拖拽重排用「置顶」按钮代替真实 HTML5 拖拽手势**
    (无头环境不可合成 DnD)。两者走**同一条写入路径**(`replaceRules`),
    故持久化结论成立;但**手势识别本身**未在真实栈验证(属 T6a 面)。
15. **`inv10` 的 FCP 取自 `performance.getEntriesByType('paint')`,
    偶发为空**(本轮 5 轮中有 1 轮)。已加「≥2 个有效样本」的仪器有效性
    硬断言,防止判据空转;但样本量仍小,时序结论是**量级**级而非精确值。
