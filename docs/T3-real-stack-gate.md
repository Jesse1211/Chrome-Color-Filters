# T3 REAL_STACK_GATE — 人工执行步骤

DESIGN.md §8 第 8 条:

> **REAL_STACK_GATE 必须在真实 Chrome 中跑。** jsdom/mock 下的绿灯**不构成**通过。

T3 的两条 REAL_STACK_GATE 都依赖「**完全退出并重启浏览器**」这一动作,
无头环境无法执行(退出的是整个浏览器进程,不是关一个 tab)。
故此处给出可复核的人工步骤,**由人类或 Tester 在真实 Chrome 中执行**。

单元层的前提(存的是绝对时间戳、新实例读同一份数据仍判为锁定)已由
`src/storage/__tests__/settings-repository.test.ts` 的
「T3 · 锁定跨重启的单元前提(INV-13 / ADR-053)」一节覆盖 ——
但那**不是**本门禁的通过凭据。

---

## 前置

```bash
npm ci
npm run build          # 产物在 .output/chrome-mv3/(ADR-038:验收一律在 build 产物上)
```

`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择 `.output/chrome-mv3/`

> T3 尚未交付 popup UI(那是 T6a/T6b/T6c)。本阶段通过**扩展的 service worker 控制台**
> 直接调用仓储层 API —— 这恰好也是 INV-14 要验证的「绕过 UI 的写入路径」。
> 在 `chrome://extensions` 的本扩展卡片上点「Service Worker」打开控制台。

---

## GATE-1 · 规则与顺序跨重启存活(ADR-010 / ADR-053)

1. 在 service worker 控制台执行:

   ```js
   await chrome.storage.local.set({
     filterSettings: {
       version: 1,
       masterEnabled: true,
       rules: [
         { pattern: 'first.example.com', mode: 'Grayscale',  intensity: 100 },
         { pattern: '*.baidu.*',         mode: 'RedGreen',   intensity: 60  },
         { pattern: '*',                 mode: 'BlueYellow', intensity: 30  },
       ],
       lockUntil: null,
     },
   });
   ```

2. **完全退出 Chrome**(macOS:`Cmd+Q`,**不是**关窗口;确认 Dock 上无运行标记)。

3. 重新启动 Chrome,再次打开 service worker 控制台:

   ```js
   (await chrome.storage.local.get('filterSettings')).filterSettings.rules
       .map(r => r.pattern)
   ```

**通过判据:** 输出恰好为
`['first.example.com', '*.baidu.*', '*']` ——
三条规则都在,**且顺序一字不差**(顺序即优先级,乱序 = 行为错误,INV-6)。

---

## GATE-2 · 🔴 锁定跨重启存活(INV-13 / ADR-053)

1. 启动一个 **10 分钟**的锁定(用仓储层 API,走 ADR-057 的原子写入):

   ```js
   const until = Date.now() + 10 * 60 * 1000;
   console.log('lockUntil =', until, new Date(until).toLocaleString());
   await chrome.storage.local.set({
     filterSettings: {
       ...(await chrome.storage.local.get('filterSettings')).filterSettings,
       lockUntil: until,
       masterEnabled: true,          // ADR-057:启动锁定时原子置 true
     },
   });
   ```

   记下打印出来的 `until` 绝对值。

2. **完全退出 Chrome 并重启**(同 GATE-1 第 2 步)。

3. 重启后在 service worker 控制台:

   ```js
   const s = (await chrome.storage.local.get('filterSettings')).filterSettings;
   console.log('lockUntil      =', s.lockUntil);
   console.log('剩余(分钟)   =', (s.lockUntil - Date.now()) / 60000);
   console.log('仍在锁定中?   =', Date.now() < Math.max(s.lockUntil, 0));
   ```

**通过判据(全部满足):**

- `lockUntil` 与第 1 步记下的绝对值**完全相同** —— 没有因重启被重置或清零
- 「仍在锁定中」为 `true`
- 「剩余」按**绝对时间**正确推算:等于 10 分钟减去重启所耗的真实时长,
  **不是**重新变回 10 分钟(若变回 10 分钟,说明存的是剩余时长而非绝对时间戳,
  ADR-053 被违反 —— 「重启浏览器」就成了一键绕过)

4. 锁定仍在时,验证写入确实被拒(INV-14,绕过 UI 直接调仓储层):

   ```js
   // 用打包产物里的仓储层;若无法 import,等价地确认 UI 层之外的写入路径同样被拒。
   // 关键断言:锁定中任何对 masterEnabled / rules 的变更都必须被拒绝,
   // 且**全字段**深度相等 —— ADR-071 废止 maxSeenTime 后不再有任何豁免字段(INV-11)。
   ```

---

## GATE-3 · 读路径不写盘,且并发写入不被吃掉(ADR-071)

> **背景(ADR-071 废止了什么)**:原设计额外持久化 `maxSeenTime` 作为时钟倒退的
> 单调下界(旧 ADR-059 / INV-15)。为维持下界,**读**路径也必须更新它,
> 而实现采用 read-modify-write **整体回写** —— 读出整个 settings、改一个字段、
> 写回整个对象。期间若用户改了规则,那次改动就被旧快照覆盖
> (实测规则数应为 1 实际为 0,**用户规则被静默吃掉**)。
>
> 产品负责人拍板**整条废止**:改系统时钟绕过锁定本就允许(§4.1 记录为无法防范
> 的途径),既然不防作弊,这条防范就失去了存在理由。废止比修竞态更彻底 ——
> 竞态连带消失。本门禁就是在真实 Chrome 中验「读路径零写入」这条核心保证。
>
> **已接受的代价**:时钟若被拨慢(含夏令时、NTP 校时),锁定会意外变长且
> 无法提前结束(ADR-052)。场景很窄,已接受。

1. 启动一个 **1 小时**的锁定,打印存储:

   ```js
   const r = () => chrome.storage.local.get('filterSettings').then(o => o.filterSettings);
   console.log(await r());
   ```

   **断言:打印出来的对象里没有 `maxSeenTime` 键**(ADR-071 已废止该字段;
   旧版本留下的该键会在下一次写入时被 `toPersisted` 的逐字段拷贝清掉)。

2. 装一个写入探针,然后**只读不写**:打开 / 关闭 popup 若干次,
   并访问几个被规则命中的网页(触发 content script 的读)。等待至少 **5 分钟**。

   ```js
   let writes = 0;
   chrome.storage.onChanged.addListener((c, a) => {
     if (a === 'local' && c.filterSettings) { writes += 1; console.log('write #', writes); }
   });
   ```

3. **断言:`writes === 0`** —— 读路径一次 `storage.set` 都不许产生。
   任何非零都说明读路径仍在写盘,那条吃掉并发写入的竞态就还有复活的土壤。

4. 并发安全(这是废止要换来的东西):锁定**到期后**,在一个窗口里连续添加
   3 条规则,同时在另一个窗口反复打开 popup(持续触发读)。

**通过判据(全部满足):**

- 第 1 步存储里**不存在** `maxSeenTime` 键
- 第 3 步的 `writes` 为 **0**
- 第 4 步结束后,3 条规则**一条不少**地留在磁盘上 ——
  **若规则数少于 3,即为 ADR-071 的核心保证失败**(读路径又在用旧快照覆盖写入)
- 锁定期间的写入仍被拒绝,且被拒绝之后存储**全字段**与之前相同
  (不再有「例外 b」那样的豁免字段)

---

## 记录

执行者须在交付中附上三者的实际输出(GATE-1 的规则顺序、GATE-2 的 `lockUntil`
与剩余时长),空的或「应该没问题」式的申报等同于门禁失败(§8 第 9 条)。
