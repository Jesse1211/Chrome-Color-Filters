# 打 tag 自动产出扩展包 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打一个 `v*` tag 就从干净检出构建、过门禁、产出 GitHub Release 并附上可安装的 zip。

**Architecture:** 新增一条独立 workflow(`release.yml`),与第一阶段的 `pages.yml` 并列互不影响。
单 job 顺序执行:检出 → 装依赖 → compile/test/lint 三道门禁 → `wxt zip` → 建 Release 附 zip。
门禁在打包之前,失败则不产出任何包。

**Tech Stack:** GitHub Actions(`actions/checkout`、`actions/setup-node`、
`softprops/action-gh-release`)、WXT 的 `wxt zip`、npm。无新增运行时依赖。

**Spec:** `docs/superpowers/specs/2026-11-26-release-packaging-design.md`

## Global Constraints

- 工作流文件路径:`.github/workflows/release.yml`(新建,不改 `pages.yml`)。
- 触发条件:`push` 且 `tags: ['v*']`,外加 `workflow_dispatch`。
- 权限:`contents: write`(建 Release 的最小必要权限,高于 `pages.yml` 的 `contents: read`)。
- 门禁顺序,且必须在打包**之前**:`npm ci` → `compile` → `test` → `lint` → `zip`。
- **构建输出目录是 `build/`,不是 WXT 默认的 `.output/`**(`wxt.config.ts` 覆盖了 `outDir`)。
  附件 glob 必须是 `build/*.zip`。
- 版本号**只改 `package.json` 一处**(WXT 自动注入 manifest);改为 `1.0.0`。
- Release:非 draft、非 prerelease,`generate_release_notes: true`。
- 首个 tag:`v1.0.0`。
- 已核实可用的 action 版本(2026-11-26 `gh api`):
  `actions/checkout@v7`(v7.0.1)、`actions/setup-node@v7`(v7.1.0)、
  `softprops/action-gh-release@v3`(v3.0.4)。**不要凭记忆改这些版本。**
- Node:`node-version: 22` + `cache: 'npm'`(`package.json` 无 `engines` 字段;
  22 是当前 LTS。这是设计里记录的 controller 判断)。

## Review Focus

本阶段交付物是一条 workflow + 一行版本号 + 一段 README,没有应用代码、
因此没有新单元测试可写。以下是规格隐含、但没有自动化测试覆盖的失败模式,
按「最可能真的发生」排序。每条都在 Task 2 的验收步骤里有对应检查。

1. **附件 glob 写成 `.output/*.zip` 导致 Release 建出来但没有附件。**
   最可能的错。本项目 `outDir` 被改成了 `build/`,而 WXT 文档和绝大多数示例
   都写 `.output/`。表现是 Release 页面正常、只是空的 —— 不报错。
2. **`workflow_dispatch` 手工触发时没有 tag,`action-gh-release` 行为未定义。**
   手工触发的目的是验证 workflow 本身能跑通,但建 Release 需要 tag。
   必须明确:手工触发时**跳过**建 Release 这一步,否则会报错或建出一个垃圾 Release。
3. **门禁被放在打包之后,或 `continue-on-error` 让失败也能发包。**
   这正是规格第一条反目标:发出一个装不上/装上就崩的包比没发布更糟。
4. **zip 里装进 Chrome 后滤镜不生效。** zip 内容正确但缺 `scripting` 权限之类
   —— 这类缺陷的表现是「滤镜静默不生效」,workflow 全绿也测不出来。
   必须人工装一次。
5. **README 的安装步骤漏掉开发者模式警告。** Chrome 每次启动都会弹
   「停用开发者模式扩展程序」,用户会以为扩展坏了。

---

### Task 1: 版本升级 + README 安装说明 + release workflow

**Files:**
- Modify: `package.json`(`version`: `0.1.0` → `1.0.0`,单处)
- Modify: `README.md`(新增 `## Install` 一节)
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: 现有 npm scripts `compile` / `test` / `lint` / `zip`(均已存在且本地通过)。
- Produces: 一条名为 `Release` 的 workflow;产物命名
  `chrome-color-filters-<version>-chrome.zip`(WXT 由 package.json 的 name+version 生成,
  实测 `0.1.0` 时为 `build/chrome-color-filters-0.1.0-chrome.zip`)。

- [ ] **Step 1: 把 `package.json` 的 version 改成 `1.0.0`**

只改这一个字段。不要在 `wxt.config.ts` 里加 `version` —— WXT 会自动从
`package.json` 取,手写第二份会制造不同步风险(设计文档已记录这一判断)。

- [ ] **Step 2: 验证版本已传到构建产物**

Run:
```bash
npm run build >/dev/null 2>&1 && python3 -c "import json;print(json.load(open('build/chrome-mv3/manifest.json'))['version'])"
```
Expected: 打印 `1.0.0`

- [ ] **Step 3: 验证 zip 的文件名跟着变**

Run:
```bash
npm run zip >/dev/null 2>&1 && ls build/*.zip
```
Expected: `build/chrome-color-filters-1.0.0-chrome.zip`

- [ ] **Step 4: 写 `.github/workflows/release.yml`**

要求:
- `name: Release`
- `on:` 含 `push:` 的 `tags: ['v*']`,以及 `workflow_dispatch:`
- 顶层 `permissions: contents: write`
- 单 job `release`,`runs-on: ubuntu-latest`,步骤依次为:
  1. `actions/checkout@v7`
  2. `actions/setup-node@v7`,`with: node-version: 22`、`cache: 'npm'`
  3. `run: npm ci`
  4. `run: npm run compile`
  5. `run: npm test`
  6. `run: npm run lint`
  7. `run: npm run zip`
  8. `softprops/action-gh-release@v3`,**带 `if: startsWith(github.ref, 'refs/tags/')`**
     (Review Focus #2:手工触发无 tag,必须跳过建 Release),
     `with:` 为 `files: build/*.zip`(Review Focus #1:**不是** `.output/`)、
     `generate_release_notes: true`。
     **不要**设 `draft:` 或 `prerelease:` —— 规格要求非 draft、非 prerelease,
     而这正是该 action 的默认值;显式写 `false` 也可以,但别写成 `true`。
- 不要给任何步骤加 `continue-on-error`(Review Focus #3)

- [ ] **Step 5: 本地校验 YAML 可解析且门禁顺序正确**

Run:
```bash
python3 -c "
import yaml
d=yaml.safe_load(open('.github/workflows/release.yml'))
steps=d['jobs']['release']['steps']
print('perms:',d['permissions'])
print('triggers:',list(d.get(True) or d.get('on')))
for i,s in enumerate(steps): print(i,s.get('run') or s.get('uses'),'| if:',s.get('if','-'))
"
```
Expected:`perms` 为 `{'contents': 'write'}`;触发含 `push` 与 `workflow_dispatch`;
`npm run zip` 的序号**大于** compile/test/lint 三者;最后一步是
`softprops/action-gh-release@v3` 且带 `if: startsWith(...)`。

- [ ] **Step 6: 在 README 加 `## Install` 一节**

放在开头的功能描述之后、`## How the filter actually applies` 之前。
内容须覆盖(英文,与 README 其余部分一致):
1. 从 Releases 页面下载 `chrome-color-filters-<version>-chrome.zip`
2. 解压
3. 打开 `chrome://extensions`
4. 打开右上角 Developer mode
5. 点 "Load unpacked",选解压出来的文件夹

并**必须**写明:Chrome 每次启动会弹一个
"Disable developer mode extensions" 的警告,这是以开发者模式加载扩展的正常现象,
不代表扩展有问题(Review Focus #5)。

- [ ] **Step 7: 确认门禁全绿后提交**

Run: `npm run compile && npm test && npm run lint`
Expected: 三者均通过(基线为 45 files / 1146 tests)

```bash
git add package.json README.md .github/workflows/release.yml docs/superpowers
git commit -m "feat(release): 打 tag 自动构建并发布扩展 zip"
```

---

### Task 2: 打 tag 上线并真机验收

**Files:** 无(不改代码,只发布与验证)

**Interfaces:**
- Consumes: Task 1 的 `.github/workflows/release.yml` 与 `package.json` 的 `1.0.0`。

- [ ] **Step 1: 推送 commit**

```bash
git push origin main
```
确认**没有**触发 Release workflow(它只认 tag),也没有触发 Pages workflow
(README/package.json 都不在 `reports/gray/**` 下)。

- [ ] **Step 2: 打 tag 并推送**

```bash
git tag v1.0.0
git push origin v1.0.0
gh run watch
```
Expected: 单个 `release` job 全绿。

- [ ] **Step 3: 验证 Release 有附件(Review Focus #1)**

Run:
```bash
gh release view v1.0.0 --json assets --jq '.assets[].name'
```
Expected: `chrome-color-filters-1.0.0-chrome.zip`。
**空输出即为 Review Focus #1 命中** —— Release 建出来了但 glob 没匹配到文件。

- [ ] **Step 4: 下载 zip 并检查内容(Review Focus #4 的前半)**

Run:
```bash
cd "$(mktemp -d)" && gh release download v1.0.0 -R Jesse1211/Chrome-Gray-Scaller && unzip -o *.zip >/dev/null && python3 -c "
import json;d=json.load(open('manifest.json'))
print('version:',d['version']);print('permissions:',d.get('permissions'));print('host:',d.get('host_permissions'))
" && ls
```
Expected:`version` 为 `1.0.0`;`permissions` 含 `scripting`
(缺了会导致「滤镜静默不生效」);能看到 `popup.html`、`background.js`、`filters/` 等。

- [ ] **Step 5: 真机安装验收(Review Focus #4 的后半 —— 不可省)**

把上一步解压出的目录在 Chrome 里 Load unpacked,然后:
- 加一条规则(例如 `wikipedia.org`),打开该站点,确认**首帧就是灰的**
- 拖强度滑块,确认已打开的页面**立刻**变色、不需要刷新

规格的验收明确写了这条不能用「workflow 绿了」替代 ——
zip 内容正确但装进去不工作,是本阶段唯一真正要防的失败。
**此步需要人工操作,由用户完成或在用户在场时完成。**

- [ ] **Step 6: 验证手工触发不会建出垃圾 Release(Review Focus #2)**

```bash
gh workflow run "Release"
gh run watch
gh release list --limit 3
```
Expected: workflow 全绿(门禁与打包都跑了),但
**Release 列表里没有新增条目** —— 因为 `if: startsWith(github.ref, 'refs/tags/')`
在无 tag 时跳过了建 Release 那一步。
