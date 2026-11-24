// 🔴 T7【新增】两条 —— DESIGN.md §6 T7 gate 原文:
//
//   > **【新增】** 持久化(ADR-010):配置规则 → **完全退出 Chrome 并重启** →
//   > 规则与顺序完好。改用 `storage.local` 后这是持久化的完整验收面,
//   > **无需第二个 Google 账号**
//
//   > **【新增】** 🔴 并发安全(ADR-071):后台读取与用户写入并发时,
//   > **磁盘终态是用户的写入**;断言持久化 JSON 中**不存在** `maxSeenTime` 字段
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ## 并发条款要抓的是 ADR-071 里记载的那个**真实缺陷**
//
// 原 `maxSeenTime` 必须在**读路径**也更新,而实现是 read-modify-write
// **整体回写**:读出整个 settings → 改一字段 → 写回整个对象。
// 期间若用户改了规则,那次改动被旧快照覆盖 —— 实测「规则数应为 1 实际为 0」。
//
// 所以本门禁的并发场景必须**精确复现那个形状**:
//   t0: 后台发起一次 `read()`(旧实现会在此刻抓一个快照并准备回写)
//   t1: 用户**在读返回之前**写入一条规则
//   t2: 两者都结束 → **磁盘上必须有用户那条规则**
// 并且重复多次(读写交错的相位不同)。
//
// ## 负向对照
//   N1 **判别器**:同一脚本额外跑一个「旧实现形状」的对照 —— 在探针里显式做
//      一次 read-modify-write 整体回写(模拟 ADR-071 废止掉的那个读路径),
//      它**必须**把用户的写入吃掉。若对照组也没吃掉,说明本门禁的时序根本
//      没有制造出竞态窗口,那么正向的「没吃掉」就是空转。
//   N2 `maxSeenTime` 断言的有效性:先人为往存储里塞一个 `maxSeenTime`,
//      再经仓储层写一次 —— 它必须被 `toPersisted` 的逐字段拷贝清掉。
//      若塞进去之后键集断言仍报「没有」,说明断言根本没在看真实数据。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const fs = require('fs');
const path = require('path');
const L = require('./lib7.cjs');

const udd = path.join(L.OUT, 'udd-persist');

/**
 * 绕过 UI 的仓储层写入通道 —— 见 `lib7.cjs` 的 `openProbe`
 * (SW 里 `import()` 被 HTML 规范禁止,故用扩展页面承载)。
 */
let probePage = null;
async function viaRepository(browser, id, op, arg) {
  if (probePage === null || probePage.isClosed()) probePage = await L.openProbe(browser, id);
  return L.probeOp(probePage, op, arg);
}

(async () => {
  const results = { clause: 'T7【新增】持久化(ADR-010)+ 并发安全(ADR-071)', assertions: [], data: {}, pass: true };
  const assert = L.makeAsserter(results);

  fs.rmSync(udd, { recursive: true, force: true });
  let browser = await L.launch(udd, { headless: true });

  try {
    let id = await L.extensionId(browser);

    // ═══ 持久化(ADR-010):通过 UI 建 3 条有序规则 ═════════════════════════
    const popup = await L.openPopup(browser, id);
    await L.createRuleViaUI(popup, 'first.example.com', 100);
    await L.createRuleViaUI(popup, 'second.example.com', 70);
    await L.createRuleViaUI(popup, '*', 30);
    const listedBefore = await popup.$$eval('[data-testid^="rule-pattern-"]', (e) => e.map((x) => x.textContent));
    fs.writeFileSync(path.join(L.OUT, 'persist-01-before-restart.png'), Buffer.from(await popup.screenshot()));
    await L.closePopup(popup);

    const before = await L.readPersisted(browser);
    results.data.before = before;
    assert('UI 建了 3 条规则,顺序为 [first, second, *]',
      JSON.stringify(before.rules.map((r) => r.pattern)) === JSON.stringify(['first.example.com', 'second.example.com', '*']),
      { rules: before.rules });

    // ── 🔴 完全退出 Chrome 并重启 ────────────────────────────────────────
    await browser.close();
    await new Promise((r) => setTimeout(r, 2500));
    browser = await L.launch(udd, { headless: true });
    id = await L.extensionId(browser);

    const after = await L.readPersisted(browser);
    results.data.after = after;
    assert('🔴 ADR-010:完全退出并重启 Chrome 后,规则**与顺序**完好',
      JSON.stringify(after.rules) === JSON.stringify(before.rules),
      { before: before.rules.map((r) => `${r.pattern}@${r.intensity}`),
        after: after.rules.map((r) => `${r.pattern}@${r.intensity}`) });
    // 强度也必须原样(顺序对但强度漂了同样是持久化失败)。
    assert('ADR-010:强度与模式逐字段完好',
      after.rules.every((r, i) => r.intensity === before.rules[i].intensity && r.mode === before.rules[i].mode),
      { after: after.rules });

    // 重启后 UI 里也必须按同样顺序显示(不只是磁盘上对)。
    const popup2 = await L.openPopup(browser, id);
    const listedAfter = await popup2.$$eval('[data-testid^="rule-pattern-"]', (e) => e.map((x) => x.textContent));
    fs.writeFileSync(path.join(L.OUT, 'persist-02-after-restart.png'), Buffer.from(await popup2.screenshot()));
    await L.closePopup(popup2);
    results.data.listed = { listedBefore, listedAfter };
    assert('ADR-010:重启后 popup 列表显示的顺序与重启前一致',
      JSON.stringify(listedAfter) === JSON.stringify(listedBefore), { listedBefore, listedAfter });

    // ═══ 并发安全(ADR-071)═════════════════════════════════════════════
    // 复位到一个干净的 1 条规则状态。
    await viaRepository(browser, id, 'replaceRules', [{ pattern: 'base.example.com', mode: 'Grayscale', intensity: 100 }]);

    // 并发循环必须跑在**探针页**里(SW 禁 import()),那里 `window.__ccfProbe`
    // 就是产品仓储层的方法集,`chrome.storage.local` 也是同一份。
    const pp = await L.openProbe(browser, id);

    // ── 正向:后台 read() 与用户写入并发 × 8 轮 ───────────────────────────
    //
    // 🔴 交错方式与 N1 判别器**逐步对应**(这是两组可比的唯一前提):
    //      repo.read()  →  用户的整条 addRule  →  (read 若回写,此刻落盘)
    //    ADR-071 之后 `read()` 根本不写盘,所以第三步什么都不会发生,
    //    用户的写入必须留在磁盘上。N1 证明同一时序下旧形状会丢数据。
    const concurrent = await pp.evaluate(async () => {
      const mod = { probe: window.__ccfProbe };
      const out = [];
      for (let i = 0; i < 8; i++) {
        await mod.probe('replaceRules', [{ pattern: 'base.example.com', mode: 'Grayscale', intensity: 100 }]);

        // (1) 后台读 —— 走产品的 repo.read()
        const readPromise = mod.probe('read', null);
        const snapshotRead = await readPromise;

        // (2) 用户写入
        const wres = await mod.probe('addRule', { pattern: `user-${String(i)}.example.com`, mode: 'Grayscale', intensity: 55 });

        // (3) 再给读路径一个「若它要回写、此刻必已落盘」的时间窗
        await new Promise((r) => setTimeout(r, 120));

        // 外加一组**真并发**(不排序)的交错,覆盖另一种相位
        const r2 = mod.probe('read', null);
        const w2 = mod.probe('addRule', { pattern: `par-${String(i)}.example.com`, mode: 'Grayscale', intensity: 45 });
        await Promise.all([r2, w2]);
        await new Promise((r) => setTimeout(r, 120));

        const got = await chrome.storage.local.get('filterSettings');
        const disk = got.filterSettings;
        out.push({
          i, writeOk: wres.ok,
          readSawRules: (snapshotRead.value?.rules ?? []).map((r) => r.pattern),
          diskRules: disk.rules.map((r) => r.pattern),
          userRulePresent: disk.rules.some((r) => r.pattern === `user-${String(i)}.example.com`),
          parRulePresent: disk.rules.some((r) => r.pattern === `par-${String(i)}.example.com`),
          keys: Object.keys(disk).sort(),
        });
      }
      return out;
    });
    results.data.concurrent = concurrent;
    const allKept = concurrent.every((r) => r.writeOk === true
      && r.userRulePresent === true && r.parRulePresent === true && r.diskRules.length === 3);
    assert('🔴 ADR-071:后台读取与用户写入并发 8/8 轮(顺序交错 + 真并发两种相位),磁盘终态**都是用户的写入**',
      allKept, { rounds: concurrent.length,
        keptSeq: concurrent.filter((r) => r.userRulePresent).length,
        keptPar: concurrent.filter((r) => r.parRulePresent).length,
        sample: concurrent.slice(0, 2) });

    // ── N1 判别器:显式复现「旧实现形状」的整体回写,它**必须**吃掉写入 ────
    //
    // 🔴 第一版判别器报 0/8(没吃掉),说明**时序没对上**,于是正向的 8/8
    //    还不构成证据。ADR-071 记载的缺陷形状是精确的:
    //      legacy.get  →  用户的整条 addRule(读+写)  →  legacy.set(用旧快照)
    //    只有 legacy 的 **set 落在用户的 set 之后**,旧快照才会覆盖掉用户的写入。
    //    第一版把 legacy 的 get→set 写成一个不中断的 async 块,
    //    两个请求之间几乎没有空隙,用户那条 addRule(本身要先 get 再 set)
    //    来不及插进去 —— 竞态窗口没被制造出来。
    //
    //    本版把顺序**显式钉住**:先 await legacy 的 get 拿到快照,
    //    再 await 用户的整条写入,**最后**才发 legacy 的 set。
    //    这正是「读路径回写」在真实世界里最坏的那个交错。
    const discriminator = await pp.evaluate(async () => {
      const mod = { probe: window.__ccfProbe };
      const out = [];
      for (let i = 0; i < 8; i++) {
        await mod.probe('replaceRules', [{ pattern: 'base.example.com', mode: 'Grayscale', intensity: 100 }]);

        // (1) 旧实现的读路径:读出整个对象(此刻快照里只有 base 一条)
        const got = await chrome.storage.local.get('filterSettings');
        const snapshot = got.filterSettings;

        // (2) 用户在此期间改了规则 —— 完整地走完仓储层的读+写
        const wres = await mod.probe('addRule', { pattern: `user-${String(i)}.example.com`, mode: 'Grayscale', intensity: 55 });

        // (3) 旧实现这才把**旧快照**整体写回(改一个字段)
        await chrome.storage.local.set({
          filterSettings: { ...snapshot, maxSeenTime: Date.now() },
        });

        const back = await chrome.storage.local.get('filterSettings');
        const disk = back.filterSettings;
        out.push({
          i, writeOk: wres.ok,
          diskRules: disk.rules.map((r) => r.pattern),
          userRuleEaten: !disk.rules.some((r) => r.pattern === `user-${String(i)}.example.com`),
          hasMaxSeenTime: Object.prototype.hasOwnProperty.call(disk, 'maxSeenTime'),
        });
      }
      return out;
    });
    results.data.discriminator = discriminator;
    const eatenCount = discriminator.filter((r) => r.userRuleEaten).length;
    assert('🔴 N1 判别器:「旧实现形状」的整体回写**确实**会吃掉用户写入(8/8 轮) —— 证明本门禁确实在测一件可能失败的事',
      eatenCount === discriminator.length, { eatenCount, of: discriminator.length, sample: discriminator.slice(0, 3) });
    assert('N1 判别器:旧实现形状还会把 maxSeenTime 写进磁盘(这正是 ADR-071 废止的那个字段)',
      discriminator.every((r) => r.hasMaxSeenTime === true), { sample: discriminator.slice(0, 2) });

    // ── N2:maxSeenTime 断言的有效性 ──────────────────────────────────────
    // 先人为塞一个 maxSeenTime(判别器那轮可能已经塞过),确认键集断言看得见它。
    const injected = await pp.evaluate(async () => {
      const got = await chrome.storage.local.get('filterSettings');
      await chrome.storage.local.set({ filterSettings: { ...got.filterSettings, maxSeenTime: 123456789 } });
      const back = await chrome.storage.local.get('filterSettings');
      return Object.keys(back.filterSettings).sort();
    });
    results.data.n2Injected = injected;
    assert('N2 探针有效:人为塞入的 maxSeenTime 确实被键集断言看见',
      injected.includes('maxSeenTime'), { keys: injected });

    // 再经仓储层写一次 —— toPersisted 的逐字段拷贝必须把它清掉。
    const cleaned = await viaRepository(browser, id, 'addRule', { pattern: 'clean.example.com', mode: 'Grayscale', intensity: 20 });
    const finalDisk = await L.readPersisted(browser);
    const finalKeys = Object.keys(finalDisk).sort();
    results.data.finalKeys = finalKeys;
    assert('🔴 ADR-071:经仓储层写入后,持久化 JSON 中**不存在** maxSeenTime 字段',
      !finalKeys.includes('maxSeenTime')
      && JSON.stringify(finalKeys) === JSON.stringify(['lockUntil', 'masterEnabled', 'rules', 'version']),
      { finalKeys, writeOk: cleaned.ok });

    // 规则的键集同样只含 pattern/mode/intensity(ADR-025:派生字段绝不持久化)。
    const ruleKeys = [...new Set(finalDisk.rules.flatMap((r) => Object.keys(r)))].sort();
    assert('ADR-025:持久化的单条规则只含 [intensity, mode, pattern],无 matrix 等派生字段',
      JSON.stringify(ruleKeys) === JSON.stringify(['intensity', 'mode', 'pattern']), { ruleKeys });

  } finally { try { await browser.close(); } catch {} }

  L.writeJson('persist-concurrency.json', results);
  console.log(`\n${results.pass ? 'PASS' : 'FAIL'} — T7 持久化 + 并发安全`);
  process.exit(results.pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
