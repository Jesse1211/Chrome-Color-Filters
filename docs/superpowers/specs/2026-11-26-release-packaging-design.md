# 设计:打 tag 自动产出可安装的扩展包(GitHub Release)

日期:2026-11-26
状态:待批准

## 意图与动机

让别人能装上这个扩展,而**不经过 Chrome Web Store**。
用户明确决定不上 Google 商店(「就不用发布到 Google 了, 就做一个 pkg 好了」)。

做法:打一个 `v*` tag → CI 从干净检出构建 → 建 GitHub Release 并附上 zip。
别人下载 zip、解压、用「加载已解压的扩展程序」装上。

## 参考项目的核查结论(lirena00/monochromate)

用户要求模仿 monochromate。实际核查(`gh api`)发现:

- **它没有任何 CI/CD。** `.github/` 下只有 `copilot-instructions.md` 和 `hooks/`,
  零 workflow。5 个以上 release 全是作者本地跑 `wxt zip` 后手工上传的。
- **手工的代价在它的发布历史里可见:** `v1.5.3` 只有 chrome.zip,
  缺了 firefox 和 sources ——其它版本都是三个。这是一次手滑。
- **值得借的:** zip 命名约定(`<name>-<version>-chrome.zip`,WXT 默认,
  本项目实测一致)、GitHub Release 作为分发渠道。
- **不该借的:** 把 `version` 同时写进 `package.json` 和 `wxt.config.ts` 的 manifest。
  实测 WXT **自动**从 `package.json` 取 version(构建产物
  `build/chrome-mv3/manifest.json` 的 version 就是 `0.1.0`),
  手写第二份只会制造「两处不同步」的新风险。

## 目标

- 打 tag `v1.0.0` → 自动产出 GitHub Release,附 `chrome-color-filters-1.0.0-chrome.zip`。
- 发布前必须过 `compile` / `test` / `lint` 三道门禁。
- README 有一段**能照着做**的安装说明(含开发者模式警告)。
- 首个 tag 为 `v1.0.0`(用户决定,从 `0.1.0` 直接跳)。

## 非目标

- **不上 Chrome Web Store。** 不写 store 文案、不做截图、不写隐私政策、
  不准备 `<all_urls>` 权限理由、不注册 $5 开发者账号。
- **不做 Firefox。** 见下「约束」——这会推翻一条已记录的架构决定。
- **不做 `.crx`。** Chrome 自 2018 年起**禁止**安装来自商店之外的 `.crx`,
  产出一个没人装得上的文件没有意义。
- 不做自动更新(`update_url`)——那需要自建更新服务器,属于另一个项目。
- 不改扩展的 `name`(「Chrome Color Filters」)。不上商店就没有商标审核方,
  我先前提的改名顾虑随之失效。

## 反目标(技术上跑通了但仍算失败)

- **发出一个装不上或装上就崩的包。** 这是本设计唯一真正要防的事 ——
  比「没发布」更糟,因为用户已经下载了。故门禁必须在打包**之前**跑。
- README 的安装步骤漏掉开发者模式警告,让用户以为扩展坏了。
- zip 进了 git 仓库(`build/` 已 gitignore,实测确认)。

## 约束

- **本项目是刻意的 Chrome-only,这是已记录的决定。**
  `src/injection/scripting-port.ts:17-21` 明确写着「本项目只发 Chrome(MV3)…
  少一层依赖」;代码全程直调 `chrome.*`(仅 `chrome.storage.local` 就 33 处),
  且 `src/domain/__tests__/purity.test.ts` 有断言:import `webextension-polyfill`
  即失败。
  → 模仿 monochromate 的 Firefox 支持**不是仓库侧工作**,而是一次跨切面的架构改动,
    要推翻 ADR 级决定、改动每个 background 模块、并与现有门禁测试冲突。
    已排除在本设计之外;若要做,另起一个设计。
- **构建输出在 `build/`,不是 WXT 默认的 `.output/`**(`wxt.config.ts` 覆盖了
  `outDir`)。实测:`npm run zip` 产出
  `build/chrome-color-filters-0.1.0-chrome.zip`(135 KB)。
  workflow 里的 glob 必须指向 `build/`,写 `.output/` 会匹配不到任何文件。
- 版本号只存在于 `package.json` 一处,WXT 自动注入 manifest。
  因此版本升级是**一行**改动。
- `tests/project-gates.test.ts` 的 version 断言针对的是 **wxt 依赖自身**的版本号
  (要求精确钉版),与扩展版本无关,不冲突。

## 可选方案

**方案 A — 打 tag 触发的 release workflow(已选定)**
`on: push: tags: ['v*']` → `npm ci` → compile/test/lint → `wxt zip` →
`softprops/action-gh-release` 建 Release 并附 zip。

**方案 B — 完全照搬 monochromate:不要 workflow,写一份手工发布清单**
更省事,和参考项目一模一样。但它的发布历史已经证明手工会漏文件(v1.5.3)。
既然本仓库第一阶段已经有一条能跑的 workflow,边际成本很低。

**方案 C — 复用第一阶段的 Pages workflow,加一个 release job**
已排除:那条 workflow 被 `paths: ['reports/gray/**']` 过滤,且**刻意没有代码门禁**
(发布静态页面不依赖扩展能否编译)。发布扩展的要求正好相反 —— 必须有门禁。
硬塞在一起会破坏第一阶段特意建立的隔离。

**选定 A,理由:** 从干净检出构建是可复现的,本地 `wxt zip` 不是
(本地 `node_modules` 可能漂移)。而且门禁自动化,避免发出编译不过的包。

## 决定了的实现细节

- **新建** `.github/workflows/release.yml`,与 `pages.yml` 并列、互不影响。
- **触发:** `push` 且 `tags: ['v*']`,外加 `workflow_dispatch`
  (手工触发用于验证 workflow 本身,不建 Release ——见下)。
- **权限:** `contents: write`(建 Release 必需),其余不给。
  注意这比 `pages.yml` 的 `contents: read` 高,是建 Release 的最小必要权限。
- **门禁顺序:** `npm ci` → `compile` → `test` → `lint` → `zip`。
  任一失败则不建 Release。门禁在打包之前,对应反目标第一条。
- **Node 版本:** `actions/setup-node` 配 `node-version: 22` + `cache: 'npm'`。
  (本项目 `package.json` 没有 `engines` 字段;22 是当前 LTS。这是我的判断。)
- **Release 内容:** 非 draft、非 prerelease(用户可按 tag 自行标记);
  附件为 `build/*.zip`;正文由 `generate_release_notes: true` 自动生成。
- **版本升级:** `package.json` 的 `version` 改为 `1.0.0`,单处改动。
- **README 新增 Install 一节:** 五步 Load-unpacked,**明确写出**
  Chrome 每次启动会弹「停用开发者模式扩展程序」的警告,以及它不代表扩展有问题。

## 留给实现者的部分

- `softprops/action-gh-release` 的具体主版本号(**不要凭记忆填,现场核实** ——
  第一阶段的教训:计划稿里四个 action 的版本全是过时的)。
- Release 正文除自动生成外是否再加一句安装提示(可选)。

## 验收

- 本地 `npm run zip` 产出 zip(已实测通过)。
- 打 `v1.0.0` 后 workflow 全绿,Release 页面出现且 zip 可下载。
- **下载那个 zip、解压、真的在 Chrome 里装一次并确认滤镜生效** ——
  这一条不能用「workflow 绿了」替代,反目标第一条说的就是这个。
