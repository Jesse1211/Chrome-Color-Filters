# Chrome Color Filters

给用户指定的网站套用色觉滤镜。点击扩展图标弹出 popup 控制。

设计决策见 [`DESIGN.md`](./DESIGN.md)(决策账本)。

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
