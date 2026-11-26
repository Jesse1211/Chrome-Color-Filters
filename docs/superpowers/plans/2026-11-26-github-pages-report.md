# GitHub Pages 发布研究报告 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 GitHub Actions 把 `reports/gray/` 发布到 GitHub Pages 站点根路径,推送即上线。

**Architecture:** 单个 workflow 文件,两个 job。build job 把 `reports/gray/` 连同一个
`.nojekyll` 打成 Pages 产物;deploy job 用 `actions/deploy-pages` 发布。不新增分支,
不把产物提交进仓库。

**Tech Stack:** GitHub Actions(`actions/checkout`、`actions/configure-pages`、
`actions/upload-pages-artifact`、`actions/deploy-pages`),YAML。无运行时依赖。

**Spec:** `docs/superpowers/specs/2026-11-26-github-pages-report-design.md`

## Global Constraints

- 工作流文件路径:`.github/workflows/pages.yml`(仓库此前没有 `.github/` 目录)。
- 触发条件:`push` 到 `main` 且路径命中 `reports/gray/**`,外加 `workflow_dispatch`。
- **不设代码门禁** —— 本 workflow 不跑 `compile` / `test` / `lint`。这些属于扩展,
  和第二阶段一起作为独立 workflow 引入。
- 权限:`contents: read`、`pages: write`、`id-token: write`。
- 并发:`group: pages`,`cancel-in-progress: false`(不打断进行中的部署)。
- 发布目录:`reports/gray/`,整个目录原样上传。
- 站点地址:`https://jesseliu.me/Chrome-Gray-Scaller/`(实测;账户级自定义域名。
  `https://jesse1211.github.io/Chrome-Gray-Scaller/` 会 301 重定向到它)
- `.nojekyll` 必须在产物里,用来关掉 Pages 默认的 Jekyll 处理。

## Review Focus

本阶段交付物是一个 workflow 文件,没有应用代码、因此没有单元测试可写。
以下是规格隐含、但没有任何自动化测试会覆盖的失败模式,按「最可能真的发生」排序。
每一条都在 Task 2 的验收步骤里有对应的人工检查。

1. **仓库设置没切到 "GitHub Actions"** —— 这是唯一一个代码无法完成的步骤。
   不切的话 `deploy-pages` 会直接失败报错。属于响亮失败,不是静默失败。
2. **`.nojekyll` 没进产物** —— Jekyll 会忽略下划线开头的文件/目录。当前报告没有
   这类文件,所以缺了也**暂时看不出问题**,直到将来某天加了才爆。这是本计划里
   最隐蔽的一条,必须在产物里实际确认文件存在,不能只看 workflow 写了没有。
3. **路径过滤写错导致永不触发** —— 改了报告却没有任何 workflow 跑起来。表现为
   「什么都没发生」,容易被误读成「还在排队」。靠 `workflow_dispatch` 手工触发
   可以绕过,因此必须两条触发路径都验证。
4. **内联脚本被处理环节改动** —— 报告的语言切换依赖第 1374 行内联的
   `__I18N__` 字典。Pages 不应该改动它,但这是「中文正常、英文静默消失」
   这类缺陷的来源,所以线上要实际点一次英文。
5. **Google Fonts 在 HTTPS 下被拦** —— 页面唯一的外部资源。本地用 `file://`
   打开和线上 `https://` 的行为可能不同,字体挂了页面仍可读,属于观感缺陷。

---

### Task 1: 新建 Pages 发布工作流

**Files:**
- Create: `.github/workflows/pages.yml`
- Create: `reports/gray/.nojekyll`(空文件)

**Interfaces:**
- Consumes: 无(本仓库第一个 workflow)。
- Produces: 一个名为 `github-pages` 的 Pages 部署环境;后续阶段的 workflow
  若要复用需自行声明,不依赖本文件。

- [ ] **Step 1: 建 `.nojekyll`**

```bash
touch reports/gray/.nojekyll
```

放在 `reports/gray/` 里(而不是靠 workflow 现场生成),这样它随产物目录一起上传,
在仓库里也看得见、不会被后来的人当成多余文件删掉。

- [ ] **Step 2: 写 `.github/workflows/pages.yml`**

要求:
- `name: Deploy report to Pages`
- `on:` 同时包含 `push`(`branches: [main]`,`paths: ['reports/gray/**']`)
  与 `workflow_dispatch`
- 顶层 `permissions:` 为 `contents: read` / `pages: write` / `id-token: write`
- 顶层 `concurrency:` 为 `group: pages`、`cancel-in-progress: false`
- `build` job:`actions/checkout` → `actions/configure-pages` →
  `actions/upload-pages-artifact`,其 `path` 为 `reports/gray`
- `deploy` job:`needs: build`,声明
  `environment: name: github-pages, url: ${{ steps.deployment.outputs.page_url }}`,
  运行 `actions/deploy-pages`(step id 为 `deployment`)
- 两个 job 都用 `runs-on: ubuntu-latest`
- **版本号由实现者定**(规格把这一项留给了实现者):每个 action 都钉到它
  当前的主版本标签,不要用浮动的 `@main`。写之前先确认各自的当前主版本,
  不要凭记忆填 —— 填错会在 CI 上直接失败。

- [ ] **Step 3: 本地校验 YAML 能被解析**

Run:
```bash
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/pages.yml')); print(sorted(d['jobs'])); print(d[True] if True in d else d['on'])"
```
Expected: 打印出 `['build', 'deploy']`,以及含 `push` 和 `workflow_dispatch` 的触发配置。
(注意:YAML 会把裸 `on:` 解析成布尔键 `True`,这是预期行为,不是 bug。)

- [ ] **Step 4: 确认产物目录内容符合预期**

Run:
```bash
ls -a reports/gray/
```
Expected: 至少包含 `.nojekyll`、`index.html`、`i18n.json`。

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/pages.yml reports/gray/.nojekyll docs/superpowers/specs docs/superpowers/plans
git commit -m "ci: 用 GitHub Actions 把灰阶研究报告发布到 Pages"
```

---

### Task 2: 上线并验收

**Files:** 无(本任务不改代码,只做发布与验证)

**Interfaces:**
- Consumes: Task 1 的 `.github/workflows/pages.yml`。
- Produces: 一个可访问的站点 URL,供第三阶段做链接。

- [ ] **Step 1: 把仓库 Pages 来源切成 "GitHub Actions"**

这一步**必须由用户手动完成**,代码做不到:
仓库 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。

也可以用 `gh` 代劳(已确认本机有 `gh` 2.93.0):
```bash
gh api -X POST repos/Jesse1211/Chrome-Gray-Scaller/pages -f build_type=workflow
```
已经建过则改用 `-X PUT`。此步未完成时 `deploy-pages` 会报错失败。

- [ ] **Step 2: 推送并观察 workflow**

```bash
git push origin main
gh run watch
```
Expected: `build` 与 `deploy` 两个 job 均成功。

- [ ] **Step 3: 验证 `.nojekyll` 真的在产物里(Review Focus #2)**

不要只看 workflow 文件写了没有 —— 这一条缺失时不会报错。
在 build job 的 `upload-pages-artifact` 步骤日志里确认它统计的文件数包含了
隐藏文件,或直接访问 `<站点URL>/.nojekyll` 看是否返回 200/404
(Pages 不会对外提供 `.nojekyll`,因此更可靠的办法是看 Actions 日志里
上传的文件清单)。

- [ ] **Step 4: 打开站点,逐条核对 Review Focus**

访问 `https://jesseliu.me/Chrome-Gray-Scaller/`,确认:
- 报告正常显示(非 404、非空白)
- **点一次「English」,英文内容确实出现**(Review Focus #4)
- 衬线标题字体已加载,即 Google Fonts 没被拦(Review Focus #5)
- 深色模式:切换系统外观,配色随之改变

- [ ] **Step 5: 验证手工触发这条路径也能用(Review Focus #3)**

```bash
gh workflow run "Deploy report to Pages"
gh run watch
```
Expected: 不依赖任何文件改动就能跑成功。这条路径单独验证的意义是:
万一 `paths` 过滤写错了,push 触发会「安静地什么都不发生」,而手工触发仍可发布。

- [ ] **Step 6: 验证 push 触发这条路径也能用(Review Focus #3)**

改一处报告里无关紧要的内容(或在 `reports/gray/.nojekyll` 里加一个换行),
提交并推送,确认 workflow **自动**跑起来了。
若没有自动触发,说明 `paths` 过滤有问题,回到 Task 1 Step 2。
