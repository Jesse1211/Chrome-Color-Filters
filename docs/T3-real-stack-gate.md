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
       maxSeenTime: Date.now(),
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
       maxSeenTime: Date.now(),
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
   // 且 masterEnabled / rules / lockUntil 三者保持不变(maxSeenTime 可推进,INV-11 例外 b)。
   ```

---

## GATE-3 · 时钟倒退不缩短锁定,且只读会话不丢单调下界(INV-15 / ADR-059)

> **背景(本轮修复的缺陷)**:`maxSeenTime` 此前只在**写**路径落盘。
> 而锁定期间所有用户写入都按设计被拒绝,于是「只看不写」的正常使用
> (打开 popup、content script 读取)会让持久化的单调下界**永远冻结在锁定开始那一刻**。
> 把系统时钟倒拨回锁定开始时间再重启浏览器,剩余时长就恢复成完整时长,且可无限次重置。
> 现在**读**路径也会回写下界(节流 60s),本门禁就是在真实 Chrome 中验这一点。

1. 启动一个 **1 小时**的锁定,记下 `lockUntil` 与此刻的 `maxSeenTime`:

   ```js
   const r = () => chrome.storage.local.get('filterSettings').then(o => o.filterSettings);
   console.log(await r());
   ```

2. **不做任何写入操作**,只打开 / 关闭 popup 若干次,并访问几个被规则命中的网页
   (触发 content script 的读)。等待 **至少 5 分钟**(> 60s 的回写节流窗口)。

3. 再次打印存储,确认 `maxSeenTime` **已经前进**到接近当前时刻:

   ```js
   const s = await r();
   console.log('maxSeenTime =', s.maxSeenTime, '  now =', Date.now());
   console.log('下界落后(秒) =', (Date.now() - s.maxSeenTime) / 1000);
   ```

4. **把系统时钟往回拨**到第 1 步锁定开始的时刻(macOS:系统设置 → 通用 → 日期与时间,
   关闭自动设置后手动改),**完全退出并重启 Chrome**,再打印存储与锁定状态。

**通过判据(全部满足):**

- 第 3 步的「下界落后(秒)」**≤ 60** —— 证明读路径确实在回写,而不是冻结在锁定开始
- 倒拨 + 重启后,**仍在锁定中**为 `true`
- 剩余时长 = `lockUntil - max(Date.now(), maxSeenTime)`,**≤ 第 1 步设定的 1 小时减去已过去的真实时长**。
  **若剩余变回完整的 1 小时,即为 INV-15 失败** —— 倒拨时钟成了一键重置锁定
- 反复「倒拨 → 重启」多次,剩余时长**单调递减**,绝不回涨

---

## 记录

执行者须在交付中附上三者的实际输出(GATE-1 的规则顺序、GATE-2 的 `lockUntil`
与剩余时长),空的或「应该没问题」式的申报等同于门禁失败(§8 第 9 条)。
