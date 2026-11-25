# Chrome Color Filters

给用户指定的网站套用**灰阶滤镜**。点击扩展图标弹出 popup 控制。

规则按顺序匹配、首个命中生效(最多 20 条),强度 0–100 无级可调,
另有「专注锁定」:锁定时段内任何设置都不可更改,**只能延长**,到期自动关闭滤镜。

> 原计划的三个色觉辅助滤镜(红绿 / 绿红 / 蓝黄)已由 **ADR-075 删除**,现仅保留灰阶。

设计决策见 [`DESIGN.md`](./DESIGN.md)(决策账本)。

## 滤镜是怎么生效的

滤镜的生效分两条**互不重叠**的路径:一条管「新打开的页面」,一条管「已经打开的页面」。
两者的边界是理解这个扩展架构的关键。

### 一、新页面上色(首帧)

**要达到的效果** —— 打开一个已配置的网站,**第一帧渲染出来就是灰的**,全程看不到原色闪烁。

**用的机制** —— 声明式 content script 注册(`chrome.scripting.registerContentScripts`,ADR-062)。

添加规则时,后台立即把「匹配哪些网址 → 用哪个强度的 CSS 文件」这条映射写进浏览器的
磁盘注册表,并标记 `persistAcrossSessions` 跨会话存活。此后每次导航:

```
Chrome 开始加载页面
  ↓
Chrome 查自己磁盘上的注册表:这个网址要注入什么?
  ↓
Chrome 注入那张 CSS 文件              ← 此时还没有任何 DOM
  ↓
Chrome 构建 DOM、计算样式、渲染第一帧   ← 已经带着滤镜
```

全程**没有**「扩展去查、Chrome 等结果」这一步 —— 注册表是 Chrome 自己的数据,
读自己的东西不需要问任何人。不经过扩展的 JS,不读存储,service worker 也无需被唤醒
(它在 MV3 下随时会被回收,但注册记录在磁盘上)。

> **🔴 为什么非这样不可。** `chrome.storage` 没有同步版本,而渲染不会等待异步查询:
> 任何「读了存储才知道要不要上色」的方案,都必然先画出一帧原色。这不是实现不够快,
> 是架构的必然结果 —— 项目中五、六轮独立测量,失败位置从未移动。
>
> 解法不是把查询变快,而是**把查询取消**:异步工作被挪到「添加规则」的那一刻。
> 那时没有任何一帧在等它,几毫秒淹没在交互延迟里,代价为零;
> 而页面加载路径上,一次查询都不剩。

滤镜 CSS 共 **101 个预生成文件**(强度 0–100 每档一个),每个只有一行
`html { filter: grayscale(0.3) !important; }` —— 因为 `registerContentScripts` 的
`css` 参数只接受**文件路径**,不接受内联字符串(ADR-063)。

### 二、已打开页面的实时更新

**要达到的效果** —— 改任何设置,所有已打开的标签页**立刻变色,无需刷新**;
滚动位置、表单内容、页面状态全部保留。

**用的机制** —— `chrome.storage` 的变更广播(`onChanged`)。

每个页面的 content script 启动时订阅该事件。设置写入后,浏览器把变更同时推给所有页面,
各自修改自己的根元素样式。扩展**不需要**查询标签页列表、逐个发消息,也不需要处理
已关闭的标签页 —— 单一事件源,天然满足多 tab 一致(INV-4)。

覆盖全部五种触发:强度滑块、增删改规则、拖拽排序、主开关、锁定到期自动关闭(ADR-077)。

### 两条路径的分工

| | 作用对象 | 为什么必须独立存在 |
|---|---|---|
| **声明式注册** | **下次导航**的首帧 | 广播赶不上首帧 —— 存储是异步的,渲染不等它 |
| **变更广播** | **已打开**的页面 | 注册对已打开的页面无效,这是 Chrome 的既定行为 |

缺任何一条都会留下可见缺陷:没有广播,拖强度滑块当前页面不变色,得手动刷新;
没有注册,每打开一个新页面都会闪一下原色。

## 脚手架来源(ADR-034 / ADR-035)

本项目由 WXT 官方 CLI 生成,**非手写搭建**:

```
npx wxt@latest init . --template react
```

| | |
|---|---|
| WXT 版本 | **0.21.5**(`package.json` 中精确锁定,无 `^`/`~` —— ADR-037) |
| 模板 | `react`(即 react-ts,WXT 的 React 模板本就是 TypeScript) |
| 构建器 | Vite 8.3.8(由 WXT 带入) |

## 命令

| 用途 | 命令 |
|---|---|
| 测试 | `npm test` |
| Lint | `npm run lint` |
| 类型检查 | `npm run compile` |
| 开发 | `npm run dev` |
| 构建 | `npm run build` |
| 重新生成图标 | `npm run icons` |

> **⚠️ 产物目录是 `build/chrome-mv3/`,不是 `dist/`。**
>
> 加载扩展:`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → `build/chrome-mv3/`

### 📌 零闪烁(INV-3)验收只在构建产物上做(ADR-038)

WXT **dev 模式的 manifest 完全不含 `content_scripts`**,改由 service worker 在运行时
`registerContentScripts()` 注册 —— 运行时注册赶不上已开始加载页面的 `document_start`。
**所以 dev 模式下零闪烁必然不成立,这不是 bug。**
`wxt build` 的生产构建才输出静态 `content_scripts` 并原样传递 `run_at`。

同理,**核对权限须看 `build/chrome-mv3/manifest.json`**,不看 dev manifest
(dev 下 WXT 会从 `matches` 推导并追加 host permissions,权限集与生产不同)。

## 目录结构

```
entrypoints/
  popup/            React popup(T6 实现完整双视图)
  content.ts        content script,run_at: document_start
  background.ts     MV3 service worker
src/
  domain/           纯 TS 领域逻辑 —— 零 React / 零 chrome.* / 零 wxt(ADR-036)
  storage/          chrome.storage.local 仓储层(T3)
  ui/               共享 React 组件(T6)
scripts/
  generate-icons.mjs  图标程序生成(ADR-045),产物已提交至 public/icon/
wxt.config.ts       manifest 配置(不手写 manifest.json)
```

### 领域层纯度是 gate,不是建议(ADR-036)

`src/domain/**` 不得 import `react` / `wxt` / `webextension-polyfill`,
也不得引用 `chrome.*`。由 `src/domain/__tests__/purity.test.ts` 的静态检查强制,
并由 `eslint.config.js` 的 `no-restricted-imports` 作为第二道防线。
ADR-039 关闭 auto-imports(`imports: false`)正是为了让该检查可实施。

## 扩展图标(ADR-045 / ADR-019)

图标**程序生成**,两态各含 16/32/48/128px,**必须是不同的图片资源**:

- `public/icon/active/*` — 生效态:半黑半灰的圆角方块(◧),高对比
- `public/icon/inactive/*` — 未生效态:全灰 + 降透明度

`npm run icons` 可重新生成;输出是确定性的(同输入恒同字节),
`tests/project-gates.test.ts` 会断言仓库产物与脚本输出逐字节一致,
并断言两态 hash 不等。
