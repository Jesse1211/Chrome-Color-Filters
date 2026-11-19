# T0 spike — 证据与归档代码

本目录是 T0 可行性 spike 的**证据存档**。结论与实现交接见 `../T0-spike-findings.md`。

> **这些文件不参与构建、不参与 lint、不被任何产品代码 import。**
> 按 DESIGN.md §6 T0 一节:归档 spike 代码不违反 ADR-035(该 ADR 禁止的是手搓项目脚手架)。

| 目录 | 内容 |
|---|---|
| `screenshots/` | 几何比对截图。`fixture-*` 为确定性 fixture(主判据),`geometry-<site>-<approach>-{top,scroll1200}` 为三个真实站点 |
| `flicker/` | INV-3 逐帧探针证据。`*-WORST-frame*.png` 是实际捕获到的彩色帧(a3 方案的失败证据) |
| `edge-cases/` | 顶层元素、跨域 iframe、`background-attachment:fixed` 等边界场景 |
| `data/` | 原始测量数据 JSON |
| `spike-code/` | 一次性探针代码(归档参考件) |

## 方案代号

| 代号 | 方案 | 结论 |
|---|---|---|
| `off` | 无滤镜基线 | — |
| `a1` | `html{filter}` | 几何 OK、零闪烁 OK,缺顶层元素 |
| `a2` | `html{filter}` + JS 补偿 fixed | ❌ 补偿制造 +1000px 错位 |
| `a3` | fixed 覆盖层 + `backdrop-filter` | ❌ 违反 INV-3 |
| `a4` | `body{filter}` | ❌ fixed 错位 -1000 / +2340px |
| **`a5`** | **`html{filter}` + 顶层补偿** | ✅ **采用** |
