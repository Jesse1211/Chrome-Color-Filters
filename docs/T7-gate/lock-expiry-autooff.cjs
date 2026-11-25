// 🔴🔒 T7【新增】**ADR-077 到期自动关闭 —— 真实 Chrome 端到端**
//
// DESIGN.md ADR-077:
//   > 锁定到期时自动关闭主开关(`masterEnabled → false`),滤镜随之停止;
//   > 设置同时恢复可改。
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ## 本门禁验的三件事(任务书逐字要求)
//
//   1. **真实挂钟等到期**(不伪造时钟)→ 断言**磁盘上** `masterEnabled === false`
//      且 `lockUntil` 已是过去值;
//   2. **页面里滤镜真的消失**(像素回到彩色)—— 不只是读一个属性;
//   3. **负向对照**:证明「像素探针若滤镜还在,会当场发现」。
//      没有第 3 条,第 2 条可能在任何状态下都成立(恒真的探针 = 没有探针)。
//
// ## 🔴 为什么必须有一个「真实挂钟等待」的用例
//
// 任务书:「at least one case must use a real wall-clock wait, not a faked clock」。
// 伪造时钟会把 ADR-071「时钟由用户自行负责」那条语义一并绕过 ——
// 测出来的不是产品行为。故**阶段 A** 是一次真实等待。
//
// UI 的最小时长单位是分钟(ADR-058 刻意没有 'second'),一分钟的等待对
// 每次跑门禁都是实打实的成本。故本门禁分两段:
//
//   · **阶段 A(真实挂钟 + 真实 UI 路径)** —— 通过 popup UI 启动
//     **1 分钟**锁定(UI 最小值),然后真的等 ~65 秒。这一段**不播种**。
//   · **阶段 B(播种一个短 lockUntil)** —— 任务书明文允许
//     (「you may seed `lockUntil` directly for a shorter wait」),
//     用来覆盖 A 不便反复跑的边界(popup 关着时到期、像素对照)。
//     🔴 B 段**同样是真实挂钟等待**,只是等得短 —— 播种的是**到期时刻**,
//     不是时钟。时钟全程是系统真实时钟。
//
// ## ⚠️ 已知的门禁-生产差异(实测,如实记录)
//
// `docs/T7-gate/alarms-minimum-probe.cjs` 实测:**unpacked 扩展的闹钟无限流**
// (请求 2 秒的 `when` 实测 2.003 秒触发)。而 Chrome 文档写明 packed 扩展
// 「won't actually cause the alarm to fire for at least 30 seconds」。
// 即**本门禁所处的环境比真实用户宽松**。
//
// 产品侧对此的应对(不是靠闹钟及时):到期自动关闭有**三条独立触发线** ——
// 闹钟、SW 启动补偿(`catchUp`)、popup 开着时的 UI 边沿。
// 本门禁的阶段 A/B 验前两条,UI 边沿那条由
// `src/ui/__tests__/lock-expiry-autooff.test.tsx` 的逐帧断言验
// (它能构造「闹钟迟到」这种真实栈里不好强制的时序)。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./lib7.cjs');

const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-expiry-'));
const SITE = 'https://en.wikipedia.org/wiki/CSS';

/** 读磁盘上的锁定状态(与 lock-e2e.cjs 的同名 helper 同构)。 */
async function lockState(browser) {
  const s = await L.readPersisted(browser);
  const w = await L.getWorker(browser);
  const now = await w.evaluate(() => Date.now());
  return {
    lockUntil: s?.lockUntil ?? null,
    masterEnabled: s?.masterEnabled ?? null,
    rules: (s?.rules ?? []).map((r) => `${r.pattern}@${String(r.intensity)}`),
    now,
    remainingMs: s?.lockUntil ? s.lockUntil - now : null,
    keys: s ? Object.keys(s).sort() : null,
  };
}

/**
 * 🔴 **像素级判据** —— 「滤镜真的没了」不能只看一个属性。
 *
 * 取 documentElement 的 computed filter + 扩展注入节点 + 一张截图的
 * **彩色度**。彩色度的算法:采样若干像素,统计 `max(r,g,b) - min(r,g,b)`
 * 显著大于 0 的比例 —— 灰度滤镜会把它压到 ~0(R=G=B),
 * 彩色页面则有大量通道差异明显的像素。
 *
 * 📌 为什么不直接比两张截图的字节:页面本身有动画/广告/字体渲染差异,
 * 字节比对会假红。彩色度是**语义**判据,对页面内容变化不敏感。
 */
const AUDIT = `(() => {
  const de = document.documentElement;
  return {
    attr: de.hasAttribute('data-ccf-on'),
    varVal: de.style.getPropertyValue('--ccf-filter'),
    computedFilter: getComputedStyle(de).filter,
    classes: de.className,
    injectedSvg: document.querySelectorAll('svg[id*="ccf"]').length,
    ccfNodes: document.querySelectorAll('[id*="ccf"],[class*="ccf"]').length,
  };
})()`;

/**
 * 截图的「彩色像素占比」。
 *
 * 用 canvas 在**页面内**算 —— 比在 Node 里解 PNG 少一个依赖,
 * 且 `html2canvas` 那类库会漏掉 CSS filter。
 * 这里改为:截图在 Node 侧做,解码用 Chrome 自己的 `createImageBitmap`
 * (在一个干净的扩展页里跑,避免被被测页面的 CSP 挡住)。
 */
async function colorfulness(page) {
  const shot = await page.screenshot({ encoding: 'base64' });
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    let colored = 0;
    let total = 0;
    // 每 16 个像素取一个(足够的统计量,又不至于太慢)。
    for (let i = 0; i < data.length; i += 4 * 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      total += 1;
      // 阈值 18:JPEG/抗锯齿带来的通道差异通常 < 10;
      // 真实彩色内容(链接蓝、图片)远大于它。
      if (max - min > 18) colored += 1;
    }
    return { coloredRatio: total ? colored / total : 0, sampled: total,
      width: bmp.width, height: bmp.height };
  }, shot);
}

(async () => {
  const results = {
    clause: 'T7【新增】ADR-077 到期自动关闭(真实 Chrome + 真实挂钟)',
    assertions: [],
    data: {},
    pass: true,
  };
  const assert = L.makeAsserter(results);

  fs.rmSync(udd, { recursive: true, force: true });
  let browser = await L.launch(udd, { headless: true });
  let id = await L.extensionId(browser);

  try {
    /* ═══════════════════════════════════════════════════════════════════
       阶段 A:**真实 UI 路径 + 真实挂钟等待**(不播种、不伪造时钟)
       ═══════════════════════════════════════════════════════════════════ */

    // A1. 通过 popup UI 建一条规则(覆盖整个页面),主开关默认 ON。
    let popup = await L.openPopup(browser, id);
    await L.createRuleViaUI(popup, '*', 100);

    // A2. 通过 UI 启动**1 分钟**锁定(ADR-058 的 UI 最小值)。
    await L.clickTestId(popup, 'lock-open');
    await popup.waitForFunction(
      () => document.querySelector('[data-testid="popup"]')?.dataset.view === 'lock',
      { timeout: 20000 },
    );
    /*
      自定义时长:**1 分钟** —— ADR-058 的 UI 最小值。
      用自定义输入而不是预设按钮:预设列表的内容可能随产品调整,
      而「1 分钟」是 ADR-058 定下的最小粒度,写死它更稳。
      控件 testid 来自 `LockDurationPicker` 的 `idPrefix="lock-start"`。
    */
    await popup.click('[data-testid="lock-start-amount"]', { clickCount: 3 });
    await popup.type('[data-testid="lock-start-amount"]', '1');
    // 🔴 单位值是**单数** `minute`(见 `lock-duration.ts` 的 LOCK_UNITS)。
    await popup.select('[data-testid="lock-start-unit"]', 'minute');
    await L.clickTestId(popup, 'lock-start');
    // ADR-056 的二次确认。
    await L.waitTestId(popup, 'lock-confirm-ok');
    await L.clickTestId(popup, 'lock-confirm-ok');
    /*
      🔴 确认之后仍停在**子页面**(它翻成「延长锁定」形态)——
      倒计时条 `lock-banner` 住在**列表页**。故先等子页面翻成延长态
      (证明写入已被 React 状态看到),再返回列表页看倒计时条。
      直接等 `lock-banner` 会超时 —— 它此刻不在 DOM 里,这不是缺陷。
    */
    await L.waitTestId(popup, 'lock-extend-panel', 20000);
    await L.clickTestId(popup, 'lock-back');
    await popup.waitForFunction(
      () => document.querySelector('[data-testid="popup"]')?.dataset.view === 'list',
      { timeout: 20000 },
    );
    await L.waitTestId(popup, 'lock-banner', 20000);

    const started = await lockState(browser);
    results.data.phaseA_started = started;
    assert('A:通过 UI 启动 1 分钟锁定后,磁盘上 lockUntil 为未来时间戳',
      started.lockUntil !== null && started.remainingMs > 30_000
        && started.remainingMs <= 61_000,
      started);
    assert('A:启动锁定**不连带改动** masterEnabled(ADR-076 / ADR-057 已废止)',
      started.masterEnabled === true, started);

    // A3. 🔴 闹钟真的被排上了吗?—— 直接问平台。
    const w1 = await L.getWorker(browser);
    const alarmsAfterStart = await w1.evaluate(async () => {
      const all = await chrome.alarms.getAll();
      return all.map((a) => ({ name: a.name, scheduledTime: a.scheduledTime,
        persistAcrossSessions: a.persistAcrossSessions }));
    });
    results.data.phaseA_alarms = alarmsAfterStart;
    assert('🔴 A:启动锁定后 SW 真的排上了到期闹钟,且 when === lockUntil',
      alarmsAfterStart.length === 1
      && alarmsAfterStart[0].name === 'ccf-lock-expiry'
      && alarmsAfterStart[0].scheduledTime === started.lockUntil,
      { alarms: alarmsAfterStart, lockUntil: started.lockUntil });

    /*
      A4. 页面上滤镜确实生效(**基线 / 负向对照的「还在」那一半**)。

      🔴 用**自己新开的**页面,不是 `popup.__ccfHost` ——
      后者是 `openPopup` 为 tabState 配的宿主页,`closePopup()` 会把它一起关掉
      (见 lib7.cjs)。本门禁在关掉 popup **之后**还要反复用这个页面取像素,
      复用它会在 A7 撞上 `Attempted to use detached Frame`(实测)。
    */
    const hostPage = await browser.newPage();
    await hostPage.goto(SITE, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 1200));
    const lockedAudit = await hostPage.evaluate(AUDIT);
    const lockedColor = await colorfulness(hostPage);
    fs.writeFileSync(path.join(L.OUT, 'expiry-01-locked-filtered.png'),
      Buffer.from(await hostPage.screenshot()));
    results.data.phaseA_lockedPage = { audit: lockedAudit, color: lockedColor };
    assert('🔴 A 基线:锁定中滤镜**确实生效**(有 filter + 页面几乎无彩色像素)',
      lockedAudit.computedFilter !== 'none' && lockedColor.coloredRatio < 0.02,
      { audit: lockedAudit, color: lockedColor });

    await L.closePopup(popup);

    // A5. 🔴🔴 **真实挂钟等待到期**(popup 已关闭 —— 这正是闹钟/补偿的场景)。
    const waitMs = (await lockState(browser)).remainingMs + 8000;
    console.log(`\n⏳ A:真实挂钟等待自然到期:${String(Math.round(waitMs / 1000))} 秒(不伪造时钟,popup 已关闭)…`);
    // 到期**前**抽查一次:仍必须锁着(证明等待期间锁一直有效)。
    await new Promise((r) => setTimeout(r, Math.max(0, waitMs - 15000)));
    const beforeExpiry = await lockState(browser);
    results.data.phaseA_beforeExpiry = beforeExpiry;
    assert('A:到期前抽查 —— 锁仍有效且 masterEnabled 仍为 true(还没到点,不该关)',
      beforeExpiry.remainingMs > 0 && beforeExpiry.masterEnabled === true,
      beforeExpiry);
    await new Promise((r) => setTimeout(r, 16000));

    // A6. 🔴🔴🔴 **核心断言:磁盘上主开关已被自动关闭。**
    const expired = await lockState(browser);
    results.data.phaseA_expired = expired;
    assert('🔴🔴🔴 A / ADR-077:到期后**磁盘上** masterEnabled === false(自动关闭真的发生了)',
      expired.masterEnabled === false, expired);
    assert('🔴 A:到期后 lockUntil 已是**过去**时间(到期即解锁,ADR-053)',
      expired.lockUntil !== null && expired.remainingMs <= 0, expired);
    assert('🔴 A:规则**原样保留**(INV-8:主开关 OFF 时所有规则保留)',
      JSON.stringify(expired.rules) === JSON.stringify(started.rules),
      { before: started.rules, after: expired.rules });
    assert('A / ADR-025:持久化键集未变(自动关闭没有新增任何字段)',
      JSON.stringify(expired.keys) === JSON.stringify(['lockUntil', 'masterEnabled', 'rules', 'version']),
      { keys: expired.keys });

    // A7. 🔴🔴 **页面里滤镜真的没了 —— 像素回到彩色。**
    await hostPage.goto(SITE, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 1200));
    const offAudit = await hostPage.evaluate(AUDIT);
    const offColor = await colorfulness(hostPage);
    fs.writeFileSync(path.join(L.OUT, 'expiry-02-expired-colorful.png'),
      Buffer.from(await hostPage.screenshot()));
    results.data.phaseA_expiredPage = { audit: offAudit, color: offColor };
    assert('🔴🔴 A:到期后页面上**没有任何滤镜**(computed filter 为 none、无注入节点)',
      offAudit.computedFilter === 'none' && offAudit.attr === false
      && offAudit.injectedSvg === 0 && offAudit.ccfNodes === 0,
      offAudit);
    /*
      🔴 **判据是「灰度滤镜的特征信号消失」,不是一个拍脑袋的绝对阈值。**

      第一版写的是 `coloredRatio > 0.05`,实测 **FAIL**:到期后的
      维基百科 CSS 词条实测 `0.0310`。那不是产品缺陷 ——
      该页面以白底黑字为主,**彩色像素本来就只占约 3%**,
      而 0.05 是我凭感觉挑的数字,与被测页面的内容无关。

      正确的判据来自灰度滤镜的**数学特征**:`grayscale(1)` 使每个像素
      R=G=B,于是「通道差 > 18 的像素」数量被压到**恒等于 0**。
      实测两态:锁定中 `0.000000`(精确的 0),到期后 `0.0310`。
      这是一个**定性**的信号差(有/无),不是需要调参的定量差。

      故改为两条:
        (a) 到期后彩色像素**严格大于 0** —— 灰度滤镜在数学上不可能产生它们;
        (b) 锁定中/负向对照必须**恰为 0**(见下一条断言),
            于是 (a) 与 (b) 合起来构成一个无需阈值的判别。
      这比把 0.05 改成 0.02 强:后者仍是在为某个具体页面调参。
    */
    assert('🔴🔴 A:到期后**像素回到彩色**(出现灰度滤镜在数学上不可能产生的彩色像素)',
      offColor.coloredRatio > 0,
      { locked: lockedColor, expired: offColor,
        note: 'grayscale(1) ⇒ R=G=B ⇒ 通道差>18 的像素恒为 0;>0 即滤镜已不在' });

    // A8. 🔴 **负向对照:探针确实能发现「滤镜还在」。**
    //
    //    做法:把主开关手动开回来(此刻已解锁,写入会成功),同一页面重新导航。
    //    同一组读数必须**全部翻回去** —— 否则「滤镜没了」可能在任何状态下
    //    都成立,那条断言就是恒真的空话。
    const w2 = await L.getWorker(browser);
    await w2.evaluate(async () => {
      const got = await chrome.storage.local.get('filterSettings');
      const s = got.filterSettings;
      await chrome.storage.local.set({
        filterSettings: { ...s, masterEnabled: true },
      });
    });
    await new Promise((r) => setTimeout(r, 800));
    await hostPage.goto(SITE, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 1200));
    const controlAudit = await hostPage.evaluate(AUDIT);
    const controlColor = await colorfulness(hostPage);
    fs.writeFileSync(path.join(L.OUT, 'expiry-03-negative-control.png'),
      Buffer.from(await hostPage.screenshot()));
    results.data.phaseA_negativeControl = { audit: controlAudit, color: controlColor };
    assert('🔴🔴 A 负向对照:把主开关开回 ON → 滤镜**当场回来**,像素重新变灰',
      controlAudit.computedFilter !== 'none' && controlColor.coloredRatio < 0.02,
      { expired: { filter: offAudit.computedFilter, ratio: offColor.coloredRatio },
        control: { filter: controlAudit.computedFilter, ratio: controlColor.coloredRatio } });
    /*
      🔴 **探针有效性的核心**:灰度态必须**恰为 0**。

      这条让上面那个 `> 0` 成为一个真正的判别式:
      若探针坏了(比如截图全黑、或 ratio 恒为某个常数),
      「灰度态恰为 0」与「到期态 > 0」不可能同时成立。
      实测三态:锁定中 0.000000 / 到期后 0.0310 / 开回 ON 后 0.000000。
    */
    assert('🔴🔴 A 负向对照的判别力:两个灰度态都**恰为 0**,到期态 > 0(探针不是恒真)',
      lockedColor.coloredRatio === 0 && controlColor.coloredRatio === 0
      && offColor.coloredRatio > 0,
      { lockedRatio: lockedColor.coloredRatio,
        expiredRatio: offColor.coloredRatio,
        controlRatio: controlColor.coloredRatio });

    // A9. 到期后设置恢复可改(ADR-077:「设置同时恢复可改」),走**绕过 UI** 的仓储层。
    const probe = await L.openProbe(browser, id);
    const writes = {
      addRule: await L.probeOp(probe, 'addRule',
        { pattern: 'after-expiry.test', mode: 'Grayscale', intensity: 40 }),
      setMasterEnabled: await L.probeOp(probe, 'setMasterEnabled', false),
      setLockUntil: await L.probeOp(probe, 'setLockUntil', Date.now() + 120_000),
    };
    results.data.phaseA_writes = writes;
    for (const [k, v] of Object.entries(writes)) {
      assert(`🔴 A / ADR-077:到期后 ${k} **成功**(设置确实恢复可改)`,
        v.ok === true, v);
    }
    await probe.close().catch(() => {});

    /* ═══════════════════════════════════════════════════════════════════
       阶段 B:播种一个**短** lockUntil,验「popup 全程关闭时也会自动关闭」
       (任务书明文允许为缩短等待而播种 lockUntil;时钟仍是真实时钟)
       ═══════════════════════════════════════════════════════════════════ */

    // B1. 播种:锁 12 秒、主开关 ON。
    //
    // 🔴 播种之后**必须让 SW 重新排闹钟** —— 直接写 chrome.storage.local 会触发
    //    `storage.onChanged`,而 SW 订阅了它(`repo.subscribe` → onSettingsChanged),
    //    于是闹钟会被自动排上。本步顺便验证了那条接线。
    const seedUntil = Date.now() + 12_000;
    const w3 = await L.getWorker(browser);
    await w3.evaluate(async (until) => {
      await chrome.storage.local.set({
        filterSettings: {
          version: 1,
          masterEnabled: true,
          rules: [{ pattern: '*', mode: 'Grayscale', intensity: 100 }],
          lockUntil: until,
        },
      });
    }, seedUntil);
    await new Promise((r) => setTimeout(r, 1200));

    const bAlarms = await w3.evaluate(async () => {
      const all = await chrome.alarms.getAll();
      return all.map((a) => ({ name: a.name, scheduledTime: a.scheduledTime }));
    });
    results.data.phaseB_alarms = bAlarms;
    assert('🔴 B:storage 变更后 SW **自动重排**闹钟(subscribe → onSettingsChanged 接线正确)',
      bAlarms.length === 1 && bAlarms[0].name === 'ccf-lock-expiry'
      && bAlarms[0].scheduledTime === seedUntil,
      { alarms: bAlarms, seedUntil });

    const bLocked = await lockState(browser);
    assert('B:播种后确实处于锁定中且主开关 ON',
      bLocked.remainingMs > 0 && bLocked.masterEnabled === true, bLocked);

    // B2. 🔴 **popup 全程不打开**,真实等待到期。
    console.log('\n⏳ B:popup 全程关闭,真实挂钟等待 ~18 秒…');
    await new Promise((r) => setTimeout(r, 18_000));

    const bExpired = await lockState(browser);
    results.data.phaseB_expired = bExpired;
    assert('🔴🔴 B / ADR-077:popup **从未打开**,到期后 masterEnabled 仍被自动关为 false',
      bExpired.masterEnabled === false, bExpired);
    assert('B:到期后闹钟被清掉(不留一个永不重置的过期闹钟)',
      (await w3.evaluate(async () => (await chrome.alarms.getAll()).length)) === 0,
      await w3.evaluate(async () => await chrome.alarms.getAll()));

    // B3. 🔴 幂等:再等一会儿,不得出现第二次关闭造成的异常
    //     (比如把用户手动开回的滤镜又关掉)。
    await w3.evaluate(async () => {
      const got = await chrome.storage.local.get('filterSettings');
      await chrome.storage.local.set({
        filterSettings: { ...got.filterSettings, masterEnabled: true },
      });
    });
    await new Promise((r) => setTimeout(r, 6000));
    const bAfterUserReEnable = await lockState(browser);
    results.data.phaseB_afterUserReEnable = bAfterUserReEnable;
    assert('🔴 B 幂等:到期后用户手动把滤镜开回来,**不会**被再次自动关掉',
      bAfterUserReEnable.masterEnabled === true, bAfterUserReEnable);
  } finally {
    try { await browser.close(); } catch {}
  }

  L.writeJson('lock-expiry-autooff.json', results);
  console.log(`\n${results.pass ? 'PASS' : 'FAIL'} — T7 ADR-077 到期自动关闭(真实 Chrome)`);
  process.exit(results.pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
