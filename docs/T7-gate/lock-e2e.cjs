// 🔴🔒 T7【新增】锁定端到端 —— DESIGN.md §6 T7 gate 原文:
//
//   > **【新增】** 🔒 锁定端到端(INV-11/12/13/14):**主开关关闭状态下**启动锁定 →
//   > **主开关自动变 ON**(ADR-057)→ 尝试改规则、关主开关、**缩短计时器全部失败**
//   > → **延长成功** → **完全退出并重启浏览器** → 锁定仍有效、剩余时间正确
//   > → 等待到期 → 自动解锁且设置可改
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ## 两条路径都要测,这是 INV-14 的要求
//
// 「尝试改规则/关主开关/缩短」必须**同时**从两条路径试:
//   (i) **UI 路径** —— 控件是否置灰、锁定中是否不存在任何解除入口(第二道防线);
//   (ii) **绕过 UI 的仓储层路径** —— 从 service worker 直接调仓储层 API
//        (INV-14 / ADR-055 的原文:「绕过 UI 的写入(如从 service worker
//        或控制台发起)同样必须被拒绝」)。
// 只测 (i) 等于只验了假锁。
//
// ## 到期必须**真的等**
//
// UI 的最小时长单位是「分钟」(ADR-058 刻意没有 'second'),所以「等待到期」
// 是一次真实的 ~60 秒挂钟等待,**不伪造时钟**。伪造时钟会把 ADR-071
// 「时钟由用户自行负责」那条语义一并绕过,测出来的不是产品行为。
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ## 📍 UI 路径随「锁定 UI 折叠」改版(2025-11,产品负责人决定)
//
// 列表页只剩一行入口「🔒 时间锁定 ›」(未锁定)/ 倒计时条(锁定中),
// 时长选择 / 启动 / 延长全部搬进**子页面**。两个入口共用
// `data-testid="lock-open"` 且互斥在场。
//
// 🔴 **本次只改导航步骤(多一次点击),一条断言都没删、也没放宽。**
//    条款数前后相同;新增的几条是**子页面上的** INV-12 负向断言 ——
//    控件搬了家,「DOM 里没有解除入口」必须在控件现在所在的那一页重验,
//    否则这条门禁会变成一句空话(只扫了一个已经没有锁定控件的页面)。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// ## 负向对照(每条断言的探针有效性)
//   N1 锁定**之前**:同样的三个写入(改规则/关主开关/缩短)必须**成功** ——
//      否则「锁定中失败」可能只是因为这些调用本来就不工作。
//   N2 锁定中「延长」必须**成功** —— 证明仓储层此刻并非「一律拒绝一切」。
//   N3 到期后同样的写入必须**重新成功** —— 证明拒绝确实来自锁,而非永久禁写。
//   N4 重启后的剩余时间必须**小于**重启前的剩余时间且仍为正 ——
//      若它读回一个「从重启那刻重新开始算」的值,就说明存的是时长而非绝对时间。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const fs = require('fs');
const path = require('path');
const L = require('./lib7.cjs');

const udd = path.join(L.OUT, 'udd-lock');
let id;

/**
 * 绕过 UI 执行一次仓储层写入尝试(INV-14 / ADR-055)。
 *
 * 通道见 `lib7.cjs` 的 `openProbe` —— 它加载的是**产品自己的**
 * `SettingsRepository`(从 `src/storage/settings-repository.ts` 打包),
 * 且完全不经过任何 popup UI 组件。
 *
 * ⚠️ 每次调用都**新开一个探针页**,刻意不复用:
 *    `setLockUntilImmediate` 依赖实例内的 `#cachedSettings` 快照,
 *    复用实例会让「快照陈旧」这一路径永远测不到。
 *    新实例的快照为 null → 退回「先读后写」,是最保守、最可信的那条路径。
 */
let probePage = null;
async function viaRepository(browser, op, arg) {
  if (probePage === null || probePage.isClosed()) {
    probePage = await L.openProbe(browser, id);
  }
  return L.probeOp(probePage, op, arg);
}

/**
 * 进入锁定子页面 —— 点列表页上那个唯一的锁定入口。
 *
 * 未锁定时它是折叠入口行,锁定中它是倒计时条,两者共用 `lock-open`
 * 且**互斥**在场(INV-12 的结构前提),故一个 helper 覆盖两条路径。
 */
async function gotoLockView(popup) {
  await L.clickTestId(popup, 'lock-open');
  await popup.waitForFunction(
    () => document.querySelector('[data-testid="popup"]')?.dataset.view === 'lock',
    { timeout: 20000 },
  );
}

/** 返回列表视图(子页面顶栏的返回键)。**只切视图,不碰存储**。 */
async function backToList(popup) {
  await L.clickTestId(popup, 'lock-back');
  await popup.waitForFunction(
    () => document.querySelector('[data-testid="popup"]')?.dataset.view === 'list',
    { timeout: 20000 },
  );
}

/** 读磁盘上的锁定状态。 */
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

(async () => {
  const results = { clause: 'T7【新增】锁定端到端(INV-11/12/13/14 + ADR-053/057)', assertions: [], data: {}, pass: true };
  const assert = L.makeAsserter(results);

  fs.rmSync(udd, { recursive: true, force: true });
  let browser = await L.launch(udd, { headless: true });

  try {
    id = await L.extensionId(browser);

    // ═══ 阶段 0:通过 UI 建一条规则,并把主开关关掉 ═══════════════════════
    let popup = await L.openPopup(browser, id);
    await L.createRuleViaUI(popup, 'example.com', 100);
    // 主开关:建规则后默认是 ON(ADR-009 默认开)。点一下关掉。
    const masterBefore = await popup.$eval('[data-testid="master-switch"]',
      (el) => el.getAttribute('aria-checked') ?? String(el.checked));
    if (masterBefore !== 'false') await L.clickTestId(popup, 'master-switch');
    await popup.waitForFunction(() => {
      const el = document.querySelector('[data-testid="master-switch"]');
      return (el.getAttribute('aria-checked') ?? String(el.checked)) === 'false';
    }, { timeout: 20000 });
    await L.closePopup(popup);

    let st = await lockState(browser);
    results.data.phase0 = st;
    assert('阶段 0:主开关已由 UI 关闭,且存在 1 条规则,未锁定',
      st.masterEnabled === false && st.rules.length === 1 && st.lockUntil === null, st);

    // ═══ N1 负向对照:锁定**之前**三种写入都必须成功 ═══════════════════════
    const n1a = await viaRepository(browser, 'addRule', { pattern: 'n1.test', mode: 'Grayscale', intensity: 50 });
    const n1b = await viaRepository(browser, 'setMasterEnabled', true);
    const n1c = await viaRepository(browser, 'setLockUntil', Date.now() + 3600_000);
    const n1d = await viaRepository(browser, 'setLockUntil', null);  // 未锁定时清除 → 入参非法但不是锁
    results.data.n1 = { n1a, n1b, n1c, n1d };
    assert('N1 负向对照:未锁定时 addRule 成功(证明探针能写)', n1a.ok === true, n1a);
    assert('N1 负向对照:未锁定时 setMasterEnabled 成功', n1b.ok === true, n1b);
    assert('N1 负向对照:未锁定时 setLockUntil(未来)成功', n1c.ok === true, n1c);

    // 清场:删掉 N1 加的规则,主开关重新关掉,锁定清掉(此刻仍被 n1c 锁着 →
    // 必须直接改底层存储,这是**门禁 fixture 的复位**,非产品路径,已说明)。
    const w0 = await L.getWorker(browser);
    await w0.evaluate(async () => {
      await chrome.storage.local.set({ filterSettings: {
        version: 1, masterEnabled: false,
        rules: [{ pattern: 'example.com', mode: 'Grayscale', intensity: 100 }],
        lockUntil: null } });
    });
    st = await lockState(browser);
    assert('复位:主开关 OFF、1 条规则、未锁定',
      st.masterEnabled === false && st.rules.length === 1 && st.lockUntil === null, st);

    // ═══ 阶段 1:🔴 主开关 OFF 状态下,**通过 UI** 启动 1 分钟锁定 ═════════
    popup = await L.openPopup(browser, id);
    // 列表页:只有一行折叠入口,**没有**内联的时长选择器。
    await L.waitTestId(popup, 'lock-entry');
    const listCollapsed = await popup.evaluate(() => ({
      hasEntryRow: !!document.querySelector('[data-testid="lock-entry"]'),
      entryIsButton:
        document.querySelector('[data-testid="lock-open"]')?.tagName ?? null,
      inlineStart: !!document.querySelector('[data-testid="lock-start"]'),
      inlineAmount: !!document.querySelector('[data-testid="lock-start-amount"]'),
      inlinePreset: !!document.querySelector('[data-testid="lock-start-preset-1-hour"]'),
      numberInputs: document.querySelectorAll('input[type="number"]').length,
      selects: document.querySelectorAll('select').length,
    }));
    results.data.listCollapsed = listCollapsed;
    assert('📍 折叠:列表页只有一行入口(真 <button>),**无**内联时长选择器/启动按钮',
      listCollapsed.hasEntryRow === true
      && listCollapsed.entryIsButton === 'BUTTON'
      && listCollapsed.inlineStart === false
      && listCollapsed.inlineAmount === false
      && listCollapsed.inlinePreset === false
      && listCollapsed.numberInputs === 0
      && listCollapsed.selects === 0, listCollapsed);
    fs.writeFileSync(path.join(L.OUT, 'lock-00-list-collapsed.png'),
      Buffer.from(await popup.screenshot()));

    // 🔴 点入口行进子页面,时长控件在那里(改版后的用户路径)。
    const beforeNavLock = (await lockState(browser)).lockUntil;
    await gotoLockView(popup);
    const afterNavLock = (await lockState(browser)).lockUntil;
    assert('🔴 ADR-061:导航进子页面**零写入**(lockUntil 仍为 null)',
      beforeNavLock === null && afterNavLock === null,
      { beforeNavLock, afterNavLock });
    const subPage = await popup.evaluate(() => ({
      view: document.querySelector('[data-testid="popup"]')?.dataset.view ?? null,
      title: document.querySelector('[data-testid="lock-view-title"]')?.textContent ?? null,
      hasBack: !!document.querySelector('[data-testid="lock-back"]'),
      hasStart: !!document.querySelector('[data-testid="lock-start"]'),
      hasAmount: !!document.querySelector('[data-testid="lock-start-amount"]'),
      hasPresets: !!document.querySelector('[data-testid="lock-start-preset-1-hour"]'),
      // I2:子页面里没有任何预览/规则编辑控件。
      hasSlider: !!document.querySelector('[data-testid="intensity-slider"]'),
      hasPattern: !!document.querySelector('[data-testid="pattern-input"]'),
      hasRuleList: !!document.querySelector('[data-testid="rule-list"]'),
      ranges: document.querySelectorAll('input[type="range"]').length,
    }));
    results.data.subPage = subPage;
    assert('📍 子页面:返回键 + 时长选择器 + 预设 + 启动按钮俱在',
      subPage.view === 'lock' && subPage.hasBack === true
      && subPage.hasStart === true && subPage.hasAmount === true
      && subPage.hasPresets === true, subPage);
    assert('🔴 I2:锁定子页面里**没有**预览通道或规则编辑控件(与编辑视图无锁定入口对称)',
      subPage.hasSlider === false && subPage.hasPattern === false
      && subPage.hasRuleList === false && subPage.ranges === 0, subPage);
    fs.writeFileSync(path.join(L.OUT, 'lock-00b-subpage.png'),
      Buffer.from(await popup.screenshot()));

    // 自定义时长:1 分钟(UI 的最小粒度,ADR-058 没有 'second')。
    await popup.evaluate(() => {
      const el = document.querySelector('[data-testid="lock-start-amount"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '1');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await popup.select('[data-testid="lock-start-unit"]', 'minute');
    // ADR-057:主开关关闭时确认框必须告知「会一并开启滤镜」。
    await L.clickTestId(popup, 'lock-start');
    await L.waitTestId(popup, 'lock-confirm-backdrop');
    const willEnable = await popup.$('[data-testid="lock-will-enable-master"]');
    assert('🔴 ADR-057:主开关 OFF 时确认框告知「启动锁定会一并开启滤镜」',
      willEnable !== null, { present: willEnable !== null });
    const confirmText = await L.textOf(popup, 'lock-confirm-duration');
    await L.clickTestId(popup, 'lock-confirm-ok');
    /*
      🔴 确认后**仍在子页面** —— 它当场换成延长区(ADR-052)。
         倒计时此刻读的是子页面的只读回显;列表页的倒计时条要
         返回之后才在场(下面 `backToList` 之后另有一次读 + 对账)。
    */
    await L.waitTestId(popup, 'lock-extend-panel');
    const countdown0 = await L.textOf(popup, 'lock-view-countdown');
    const lockUntilAttr = await popup.$eval('[data-testid="lock-view-countdown"]',
      (el) => el.getAttribute('data-lock-until'));
    fs.writeFileSync(path.join(L.OUT, 'lock-01-banner.png'),
      Buffer.from(await popup.screenshot()));

    st = await lockState(browser);
    results.data.phase1 = { ...st, countdown0, confirmText, lockUntilAttr };
    assert('🔴 阶段 1:UI 启动锁定后磁盘上 lockUntil 为未来时间戳(ADR-053 绝对时间)',
      typeof st.lockUntil === 'number' && st.remainingMs > 0 && st.remainingMs <= 61_000, st);
    assert('🔴🔴 ADR-057:主开关 OFF 状态下启动锁定 → 主开关**自动变 ON**',
      st.masterEnabled === true, { masterEnabled: st.masterEnabled });

    /*
      🔴 启动成功后仍在子页面,且它**当场**换成延长区(ADR-052:锁定中
         唯一可用的操作),启动区同时消失 —— 先在子页面扫一遍 INV-12,
         因为控件现在住在这里;再返回列表页扫列表页那一遍。
    */
    const lockedSubUi = await popup.evaluate(() => {
      const ids = [...document.querySelectorAll('[data-testid]')]
        .map((e) => e.getAttribute('data-testid'));
      const body = document.body.innerText;
      return {
        ids,
        view: document.querySelector('[data-testid="popup"]')?.dataset.view ?? null,
        title: document.querySelector('[data-testid="lock-view-title"]')?.textContent ?? null,
        hasStart: ids.includes('lock-start'),
        hasStartSection: ids.includes('lock-start-section'),
        hasExtend: ids.includes('lock-extend'),
        // 子页面上的按钮全集 —— 只允许「返回」与「延长」两个。
        buttons: [...document.querySelectorAll('button')]
          .map((b) => b.getAttribute('data-testid')),
        releaseWords: ['解除', '取消锁定', '提前结束', '缩短', '结束锁定', '解锁', '中止', '终止']
          .filter((k) => body.includes(k)),
      };
    });
    results.data.lockedSubUi = lockedSubUi;
    assert('🔴🔴 INV-12(子页面):锁定中子页面只有「返回 + 延长」两个按钮,无启动/解除入口',
      JSON.stringify(lockedSubUi.buttons) === JSON.stringify(['lock-back', 'lock-extend'])
      && lockedSubUi.hasStart === false && lockedSubUi.hasStartSection === false
      && lockedSubUi.hasExtend === true, lockedSubUi);
    assert('🔴🔴 INV-12(子页面):锁定中子页面文案里不出现任何解除类词汇',
      lockedSubUi.releaseWords.length === 0, lockedSubUi.releaseWords);

    await backToList(popup);
    await L.waitTestId(popup, 'lock-banner');
    // 两处读的必须是**同一个** lockUntil —— 子页面回显与列表倒计时条同源。
    const listLockUntilAttr = await popup.$eval('[data-testid="lock-countdown"]',
      (el) => el.getAttribute('data-lock-until'));
    assert('📍 列表页倒计时条与子页面回显同源(同一个 lockUntil)',
      listLockUntilAttr === lockUntilAttr,
      { listLockUntilAttr, subPageLockUntilAttr: lockUntilAttr });
    fs.writeFileSync(path.join(L.OUT, 'lock-01b-list-banner.png'),
      Buffer.from(await popup.screenshot()));

    // UI 第二道防线:锁定中 DOM 里不得有任何解除/取消/结束/缩短入口(INV-12)。
    const lockUi = await popup.evaluate(() => {
      const ids = [...document.querySelectorAll('[data-testid]')]
        .map((e) => e.getAttribute('data-testid'));
      const body = document.body.innerText;
      return {
        ids,
        hasLockEntry: ids.includes('lock-entry'),
        hasLockStart: ids.includes('lock-start'),
        // 延长搬进子页面了 —— 列表页上**不该**有它,但必须**可达**。
        hasExtend: ids.includes('lock-extend'),
        // 倒计时留在列表页(产品负责人决定:剩余时间一眼可见)。
        hasCountdown: ids.includes('lock-countdown'),
        // 通往子页面的那一个入口(锁定中它就是倒计时条本身)。
        hasLockOpen: ids.includes('lock-open'),
        // 倒计时条里的按钮全集 —— 只允许那一个导航键。
        bannerButtons: [...document.querySelectorAll('[data-testid="lock-banner"] button')]
          .map((b) => b.getAttribute('data-testid')),
        // 列表页上没有任何会改 lockUntil 的输入控件。
        bannerInputs: document.querySelectorAll('[data-testid="lock-banner"] input, [data-testid="lock-banner"] select').length,
        masterDisabled: document.querySelector('[data-testid="master-switch"]')?.disabled ?? null,
        addRuleDisabled: document.querySelector('[data-testid="add-rule"]')?.disabled ?? null,
        releaseWords: ['解除', '取消锁定', '提前结束', '缩短', '结束锁定'].filter((k) => body.includes(k)),
      };
    });
    results.data.lockUi = lockUi;
    /*
      原条款:「锁定中 DOM 无启动/解除入口,只有『延长』」。
      改版后「延长」住在子页面 —— 故列表页这一条改为**更强**的形式:
      列表页连延长都没有,倒计时条里**一个写入控件都没有**(唯一的按钮
      是导航),而延长仍然**可达**(上面 `lockedSubUi` 刚刚逐条验过)。
      启动/解除入口照旧必须不存在。
    */
    assert('🔴 INV-12(UI 第二道防线):锁定中列表页无启动/解除入口,且倒计时条里零写入控件',
      lockUi.hasLockEntry === false && lockUi.hasLockStart === false
      && lockUi.hasExtend === false && lockUi.hasCountdown === true
      && lockUi.hasLockOpen === true
      && JSON.stringify(lockUi.bannerButtons) === JSON.stringify(['lock-open'])
      && lockUi.bannerInputs === 0, lockUi);
    assert('INV-11(UI 第二道防线):锁定中主开关与「新增规则」均置灰',
      lockUi.masterDisabled === true && lockUi.addRuleDisabled === true, lockUi);
    assert('INV-12:锁定中文案里不出现「解除/取消锁定/提前结束/缩短/结束锁定」',
      lockUi.releaseWords.length === 0, lockUi.releaseWords);

    // 锁定中点规则行 → 不得进入编辑视图(ADR-051)。
    await popup.click('[data-testid="rule-open-0"]').catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    const stillList = await popup.$('[data-testid="rule-list"]');
    const inEditor = await popup.$('[data-testid="edit-title"]');
    assert('ADR-051:锁定中点击规则行不进入编辑视图',
      stillList !== null && inEditor === null, { stillList: !!stillList, inEditor: !!inEditor });
    await L.closePopup(popup);

    // ═══ 阶段 2:🔴 绕过 UI,从 service worker 直接调仓储层(INV-14)═══════
    const before = await lockState(browser);
    const tries = {
      addRule: await viaRepository(browser, 'addRule', { pattern: 'evil.test', mode: 'Grayscale', intensity: 10 }),
      removeRule: await viaRepository(browser, 'removeRule', 0),
      updateRule: await viaRepository(browser, 'updateRule', { index: 0, patch: { intensity: 5 } }),
      replaceRules: await viaRepository(browser, 'replaceRules', []),
      reorderRule: await viaRepository(browser, 'reorderRule', { from: 0, to: 0 }),
      masterOff: await viaRepository(browser, 'setMasterEnabled', false),
      shorten: await viaRepository(browser, 'setLockUntil', before.lockUntil - 30_000),
      clear: await viaRepository(browser, 'setLockUntil', null),
      same: await viaRepository(browser, 'setLockUntil', before.lockUntil),
      past: await viaRepository(browser, 'setLockUntil', Date.now() - 1000),
    };
    results.data.phase2 = { before, tries };
    for (const [k, v] of Object.entries(tries)) {
      assert(`🔴 INV-14 绕过 UI:仓储层拒绝 ${k}(kind=${String(v.error?.kind)}/${String(v.error?.reason)})`,
        v.ok === false, v);
    }
    const after = await lockState(browser);
    results.data.phase2After = after;
    // INV-11 的精确含义:被拒绝的写入后,全部字段与之前深度相等(ADR-071 后无豁免字段)。
    assert('🔴 INV-11:十次被拒写入后,masterEnabled/rules/lockUntil **全字段**未变',
      after.masterEnabled === before.masterEnabled
      && JSON.stringify(after.rules) === JSON.stringify(before.rules)
      && after.lockUntil === before.lockUntil,
      { before: { m: before.masterEnabled, r: before.rules, l: before.lockUntil },
        after: { m: after.masterEnabled, r: after.rules, l: after.lockUntil } });

    // ═══ 阶段 3:N2 —— 延长必须成功(UI 路径 + 仓储层路径各一次)═══════════
    popup = await L.openPopup(browser, id);
    await L.waitTestId(popup, 'lock-banner');
    // 🔴 延长控件住在子页面 —— 点倒计时条进去(改版后的用户路径)。
    await gotoLockView(popup);
    const extendTitle = await L.textOf(popup, 'lock-view-title');
    assert('📍 锁定中点倒计时条 → 直达子页面的延长控件(标题为「延长锁定」)',
      extendTitle === '延长锁定', { extendTitle });
    await popup.evaluate(() => {
      const el = document.querySelector('[data-testid="lock-extend-amount"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '1');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await popup.select('[data-testid="lock-extend-unit"]', 'minute');
    const beforeExtend = (await lockState(browser)).lockUntil;
    await L.clickTestId(popup, 'lock-extend');
    // 子页面的只读回显当场变长……
    await popup.waitForFunction((prev) => {
      const el = document.querySelector('[data-testid="lock-view-countdown"]');
      return el && Number(el.getAttribute('data-lock-until')) > prev;
    }, { timeout: 20000 }, beforeExtend);
    // ……返回列表页,倒计时条也是变长后的值(两处同一个 lockUntil)。
    await backToList(popup);
    await popup.waitForFunction((prev) => {
      const el = document.querySelector('[data-testid="lock-countdown"]');
      return el && Number(el.getAttribute('data-lock-until')) > prev;
    }, { timeout: 20000 }, beforeExtend);
    await L.closePopup(popup);
    const afterExtend = await lockState(browser);
    results.data.phase3 = { beforeExtend, afterExtend };
    assert('🔴 N2 / INV-12:锁定中**延长**成功(UI 路径),lockUntil 严格变大',
      afterExtend.lockUntil > beforeExtend,
      { beforeExtend, afterLockUntil: afterExtend.lockUntil, deltaMs: afterExtend.lockUntil - beforeExtend });

    // 延长后再试一次缩短 —— 必须仍然失败(单向性不因延长而松动)。
    const shorten2 = await viaRepository(browser, 'setLockUntil', beforeExtend);
    assert('INV-12:延长之后再试缩短仍被拒',
      shorten2.ok === false, shorten2);

    // 🔴 把到期时间调到「约 70 秒后」,以便本脚本能在合理时间内等到自然到期。
    //    这**不是**缩短的后门 —— 它仍然是一次 `setLockUntil`,且只有在
    //    目标值**大于**当前值时才会被接受。当前剩余约 2 分钟,
    //    所以这里必须改用「延长到 now+70s 之后」不可行 → 改为:
    //    先用一个**全新的 profile 阶段**跑到期测试(见阶段 5)。
    //    此处仅记录当前剩余,不做任何缩短尝试。

    // ═══ 阶段 4:🔴 完全退出并重启浏览器(INV-13 / ADR-053)═══════════════
    const preRestart = await lockState(browser);
    await browser.close();              // 进程真的结束
    await new Promise((r) => setTimeout(r, 2500));
    browser = await L.launch(udd, { headless: true });
    id = await L.extensionId(browser);
    probePage = null;   // 旧探针页随进程一起消失
    const postRestart = await lockState(browser);
    results.data.phase4 = { preRestart, postRestart };
    assert('🔴 INV-13:完全退出并重启浏览器后,锁定仍然有效(lockUntil 原值不变)',
      postRestart.lockUntil === preRestart.lockUntil && postRestart.remainingMs > 0,
      { preLockUntil: preRestart.lockUntil, postLockUntil: postRestart.lockUntil,
        postRemainingMs: postRestart.remainingMs });
    assert('🔴 N4 / ADR-053:重启后剩余时间**小于**重启前(存的是绝对时间,不是时长)',
      postRestart.remainingMs < preRestart.remainingMs && postRestart.remainingMs > 0,
      { pre: preRestart.remainingMs, post: postRestart.remainingMs,
        elapsedMs: preRestart.remainingMs - postRestart.remainingMs });
    // 重启后的 UI 必须仍显示倒计时条、且仍无解除入口。
    popup = await L.openPopup(browser, id);
    await L.waitTestId(popup, 'lock-banner');
    const postCountdown = await L.textOf(popup, 'lock-countdown');
    const postUi = await popup.evaluate(() => ({
      hasEntry: !!document.querySelector('[data-testid="lock-entry"]'),
      masterDisabled: document.querySelector('[data-testid="master-switch"]')?.disabled ?? null,
    }));
    fs.writeFileSync(path.join(L.OUT, 'lock-02-after-restart.png'),
      Buffer.from(await popup.screenshot()));
    await L.closePopup(popup);
    assert('INV-13:重启后 UI 仍显示倒计时条、仍无启动入口、主开关仍置灰',
      postUi.hasEntry === false && postUi.masterDisabled === true,
      { postCountdown, ...postUi });
    // 剩余时间显示正确:倒计时文案与磁盘上的 lockUntil 一致(±2 秒)。
    const parsed = postCountdown.match(/(\d+):(\d+):(\d+)/);
    const shownMs = parsed ? ((+parsed[1]) * 3600 + (+parsed[2]) * 60 + (+parsed[3])) * 1000 : null;
    assert('🔴 INV-13:重启后 UI 显示的剩余时间与磁盘 lockUntil 一致(±2s)',
      shownMs !== null && Math.abs(shownMs - postRestart.remainingMs) <= 2500,
      { postCountdown, shownMs, diskRemainingMs: postRestart.remainingMs });

    // ═══ 阶段 5:🔴 等待自然到期 → 自动解锁且设置可改 ═════════════════════
    // 真实等待。不伪造时钟(见文件头)。
    const waitMs = (await lockState(browser)).remainingMs + 3000;
    console.log(`\n⏳ 等待锁定自然到期:${String(Math.round(waitMs / 1000))} 秒(不伪造时钟)…`);
    // 到期**之前**再抽查一次:仍必须被拒(证明等待期间锁一直有效)。
    await new Promise((r) => setTimeout(r, Math.max(0, waitMs - 8000)));
    const nearExpiry = await viaRepository(browser, 'setMasterEnabled', false);
    assert('到期前最后一次抽查:写入仍被拒(锁在整个等待期间持续有效)',
      nearExpiry.ok === false, nearExpiry);
    await new Promise((r) => setTimeout(r, 9000));

    const expired = await lockState(browser);
    results.data.phase5 = { expired };
    assert('锁定已自然到期(remainingMs <= 0)', expired.remainingMs <= 0, expired);

    // N3:到期后同样的写入必须**重新成功**。
    const post = {
      addRule: await viaRepository(browser, 'addRule', { pattern: 'after.test', mode: 'Grayscale', intensity: 40 }),
      masterOff: await viaRepository(browser, 'setMasterEnabled', false),
      removeRule: await viaRepository(browser, 'removeRule', 0),
    };
    results.data.phase5Writes = post;
    for (const [k, v] of Object.entries(post)) {
      assert(`🔴 N3:到期后 ${k} **重新成功**(证明此前的拒绝确实来自锁)`,
        v.ok === true, v);
    }

    // UI 侧:到期后倒计时条消失、计时器入口回来、控件恢复可编辑。
    //
    // 🔴 **先把主开关恢复 ON** —— 上面的 N3 刚刚成功地把它关掉了,
    //    而 `rulesDisabled = isSkeleton || masterOff || notInjectable || locked`
    //    (RuleListView):主开关 OFF 时规则编辑类控件**本就应当**置灰
    //    (§5.4 的 master-off 状态 + ADR-050)。
    //    不先恢复就断言「add-rule 可用」,等于要求产品在主开关关闭时
    //    仍允许编辑规则 —— 那是**要求产品违反自己的规格**。
    //    第一版本门禁正是这样写的,它报出的那个红是**我的断言错**,不是产品错
    //    (实测:masterEnabled=false → addRuleDisabled=true,
    //     恢复 ON 后 → addRuleDisabled=false)。
    const restore = await viaRepository(browser, 'setMasterEnabled', true);
    assert('到期后主开关可以重新打开(复位,同时再证一次写入已解禁)',
      restore.ok === true, restore);

    popup = await L.openPopup(browser, id);
    await L.waitTestId(popup, 'lock-entry');
    const expiredList = await popup.evaluate(() => ({
      hasBanner: !!document.querySelector('[data-testid="lock-banner"]'),
      hasEntry: !!document.querySelector('[data-testid="lock-entry"]'),
      locked: document.querySelector('[data-testid="popup"]')?.dataset.locked ?? null,
      masterDisabled: document.querySelector('[data-testid="master-switch"]')?.disabled ?? null,
      addRuleDisabled: document.querySelector('[data-testid="add-rule"]')?.disabled ?? null,
    }));
    fs.writeFileSync(path.join(L.OUT, 'lock-03-expired.png'),
      Buffer.from(await popup.screenshot()));
    /*
      🔴 `lockStartPresent`(「可以再锁一次」)现在要进子页面才能看到 ——
         原断言一个字没少,只是去它现在所在的那一页读。
    */
    await gotoLockView(popup);
    const expiredSub = await popup.evaluate(() => ({
      lockStartPresent: !!document.querySelector('[data-testid="lock-start"]'),
      startDisabled: document.querySelector('[data-testid="lock-start"]')?.disabled ?? null,
      hasExtend: !!document.querySelector('[data-testid="lock-extend"]'),
      title: document.querySelector('[data-testid="lock-view-title"]')?.textContent ?? null,
    }));
    await L.closePopup(popup);
    const expiredUi = { ...expiredList, ...expiredSub };
    results.data.expiredUi = expiredUi;
    assert('🔴 到期后 UI 自动解锁:倒计时条消失、计时器入口回来、data-locked=false、控件可编辑',
      expiredUi.hasBanner === false && expiredUi.hasEntry === true
      && expiredUi.locked === 'false' && expiredUi.lockStartPresent === true
      && expiredUi.startDisabled === false
      && expiredUi.masterDisabled === false && expiredUi.addRuleDisabled === false, expiredUi);
    assert('📍 到期后子页面回到「启动」形态:标题为「专注锁定」、无延长控件',
      expiredUi.title === '专注锁定' && expiredUi.hasExtend === false, expiredUi);

    // 🔴 探针有效性:上面那条断言必须真的能被「还锁着」证伪。
    //    做法 —— 重新锁 1 分钟,同一组读数必须**翻过来**。
    //    否则「到期后控件可编辑」可能在任何状态下都成立(恒真)。
    const relock = await viaRepository(browser, 'setLockUntil', Date.now() + 60_000);
    assert('N5 前置:重新启动一次锁定以检验上条断言的判别力', relock.ok === true, relock);
    const popupRelocked = await L.openPopup(browser, id);
    await L.waitTestId(popupRelocked, 'lock-banner');
    const relockedList = await popupRelocked.evaluate(() => ({
      hasBanner: !!document.querySelector('[data-testid="lock-banner"]'),
      hasEntry: !!document.querySelector('[data-testid="lock-entry"]'),
      locked: document.querySelector('[data-testid="popup"]')?.dataset.locked ?? null,
      masterDisabled: document.querySelector('[data-testid="master-switch"]')?.disabled ?? null,
      addRuleDisabled: document.querySelector('[data-testid="add-rule"]')?.disabled ?? null,
    }));
    // 🔴 与到期组**同一个取数位置**:启动按钮在子页面上读。
    await gotoLockView(popupRelocked);
    const relockedSub = await popupRelocked.evaluate(() => ({
      lockStartPresent: !!document.querySelector('[data-testid="lock-start"]'),
      hasExtend: !!document.querySelector('[data-testid="lock-extend"]'),
      title: document.querySelector('[data-testid="lock-view-title"]')?.textContent ?? null,
    }));
    await L.closePopup(popupRelocked);
    const relockedUi = { ...relockedList, ...relockedSub };
    results.data.relockedUi = relockedUi;
    assert('🔴 N5 负向对照:重新锁上后同一组读数**全部翻转** —— 「到期后可编辑」不是恒真',
      relockedUi.hasBanner === true && relockedUi.hasEntry === false
      && relockedUi.locked === 'true' && relockedUi.lockStartPresent === false
      && relockedUi.masterDisabled === true && relockedUi.addRuleDisabled === true,
      { expired: expiredUi, relocked: relockedUi });
    assert('🔴 N5 负向对照(子页面):重新锁上后子页面也翻成延长形态',
      relockedUi.title === '延长锁定' && relockedUi.hasExtend === true
      && relockedUi.lockStartPresent === false,
      { expired: { title: expiredUi.title, hasExtend: expiredUi.hasExtend },
        relocked: { title: relockedUi.title, hasExtend: relockedUi.hasExtend } });

    // ADR-071:持久化 JSON 中不得出现 maxSeenTime(全程抽查)。
    const finalState = await lockState(browser);
    assert('ADR-071:持久化 JSON 的键集恒为 [lockUntil, masterEnabled, rules, version],无 maxSeenTime',
      JSON.stringify(finalState.keys) === JSON.stringify(['lockUntil', 'masterEnabled', 'rules', 'version']),
      { keys: finalState.keys });

  } finally {
    try { await browser.close(); } catch {}
  }

  L.writeJson('lock-e2e.json', results);
  console.log(`\n${results.pass ? 'PASS' : 'FAIL'} — T7 锁定端到端`);
  process.exit(results.pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
