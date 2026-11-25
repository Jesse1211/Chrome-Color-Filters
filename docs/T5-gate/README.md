# T5 REAL_STACK_GATE —— 自动化脚本与证据

> 本目录是 T5(后台协调与图标状态)的**真实栈验收**脚本与证据。
> 脚本跑在 **`npm run build` 产物**(`build/chrome-mv3/`)上 —— **ADR-038**:
> dev 模式的 manifest 权限集与生产不同,权限相关的判定在 dev 下不作数。

人工复核步骤与逐条通过判据见 [`../T5-real-stack-gate.md`](../T5-real-stack-gate.md)。

## 复现

前置环境与 `docs/T4a-gate/README.md` **完全一致**(同一个 `lib.cjs`、同一个
Chrome for Testing、同一套依赖锚点)。照它的步骤装好之后:

```bash
# 从仓库根
npm run build
ln -sfn ../T0-spike/spike-code/node_modules docs/T5-gate/node_modules
node docs/T5-gate/tabstate.cjs
```

退出码 0 = 全绿。结果写入 `evidence/`。

## 覆盖范围

| 脚本 | 覆盖 |
|------|------|
| `tabstate.cjs` | GATE-1(worker 终止后滤镜仍生效)、GATE-2(图标两态)、GATE-3(INV-4 多 tab 同步)、GATE-4(INV-8 主开关)、GATE-5(ADR-013/044 的 reason 取值) |

GATE-6(popup 骨架态的视觉判定)**仍是人工项**,如实标注为未执行 ——
它要判的是「用户看到的是骨架而不是错误横幅」,属主观视觉判定。

## 本轮结果

**30/30 断言通过**(`evidence/summary.json`),含探针有效性基线与对照组。

### 为什么可以相信这个绿灯

1. **探针有效性基线**:先断言匹配站 `filter != none`、不匹配站 `filter == none`。
   基线不成立则后续所有 PASS 都可能是空转。
2. **GATE-1 的前提被单独断言**:先用行为探针确认 worker 真的不再应答,
   **再**断言滤镜仍生效(详见 `../T5-real-stack-gate.md` 的那一节)。
3. **变异测试**:撤掉本轮的 `tabs` 权限修复后重跑,GATE-5 当场判红(28/30)。
   一道从未判红过的门禁没有可信度。
4. **走真实消息通道**:`GET_TAB_STATE` 由真实的 `popup.html` 发出,
   不是直接调内部函数 —— 考的就是 `runtime.onMessage` 这条路(ADR-044)。
   (发信方不能是 service worker 自己:worker 对自己 `sendMessage` 会报
   「Receiving end does not exist」,实测踩过。)
