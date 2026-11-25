// 🔴🔒 T6c【折叠改造】真实 Chrome · 锁定子页面端到端
//
// 验的是「锁定 UI 折叠」这次改版本身 —— 产品负责人的原话:
//
//   > 我要把「专注锁定」这里面的所有信息折叠起来,就显示「添加规则」一样,
//   > 用户需要点击一个「时间锁定」然后跳转页面,来设置时间。
//
// 以及他随后的两条补充决定:
//   - **倒计时留在列表页**(剩余时间一眼可见);
//   - **「延长」搬进子页面**,点倒计时条进去。
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ## 本门禁与 `docs/T7-gate/lock-e2e.cjs` 的分工
//
// T7 那条验的是**锁定语义**(INV-11/12/13/14 + 跨重启 + 自然到期),
// 它已随本次改版更新了导航步骤。本文件验的是**改版本身的产品形态**:
//
//   1. 列表页真的折叠成一行,且**没有**内联时长选择器;
//   2. 入口行是真 `<button>`,与「添加规则」同一视觉基类,可**键盘**触发;
//   3. 点它进子页面;子页面有可用的返回键,返回回到列表;
//   4. 从子页面启动锁定端到端成功,含 ADR-056 二次确认与 ADR-057 主开关自动 ON;
//   5. 锁定中列表页显示倒计时,点它直达延长控件,延长成功;
//   6. 🔴 **缩短 / 取消 / 解除在整个 UI(两页都算)里不存在。**
//
// ## 不伪造任何东西
//
// 真实 Chrome、真实扩展、真实 `chrome.storage.local`。锁定时长用 ADR-058
// 的最小粒度「分钟」,不触碰系统时钟(ADR-071:时钟由用户自行负责)。
// 本文件**不**等自然到期 —— 那是 T7 那条的职责,这里不重复花那 60 秒。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const fs = require('fs');
const path = require('path');
const L = require('../T7-gate/lib7.cjs');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const udd = path.join(OUT, 'udd-subpage');

/** 整个 UI 里**绝不允许**出现的词 —— ADR-052 / INV-12 的负向词表。 */
const FORBIDDEN = [
  '解除', '解锁', '取消锁定', '结束锁定', '提前结束',
  '缩短', '中止', '终止', '放弃锁定', '关闭锁定', '清除锁定',
];

/** 当前页的全量快照 —— 一次 evaluate 取齐,避免多次往返间状态漂移。 */
async function snap(popup) {
  return popup.evaluate((forbidden) => {
    const q = (id) => document.querySelector(`[data-testid="${id}"]`);
    const ids = [...document.querySelectorAll('[data-testid]')]
      .map((e) => e.getAttribute('data-testid'));
    const body = document.body.innerText;
    // 可交互元素的**无障碍名**也要扫 —— 不止看可见文本。
    const names = [...document.querySelectorAll('button, a, input, select, [role="button"]')]
      .map((el) => [
        el.textContent ?? '',
        el.getAttribute('aria-label') ?? '',
        el.getAttribute('title') ?? '',
        el.getAttribute('data-testid') ?? '',
      ].join(' '))
      .join(' | ');
    return {
      ids,
      view: q('popup')?.dataset.view ?? null,
      locked: q('popup')?.dataset.locked ?? null,
      skeleton: q('popup')?.dataset.skeleton ?? null,
      entryTag: q('lock-open')?.tagName ?? null,
      entryClass: q('lock-open')?.className ?? null,
      entryText: q('lock-open')?.textContent ?? null,
      entryAria: q('lock-open')?.getAttribute('aria-label') ?? null,
      addRuleClass: q('add-rule')?.className ?? null,
      buttons: [...document.querySelectorAll('button')]
        .map((b) => b.getAttribute('data-testid')),
      numberInputs: document.querySelectorAll('input[type="number"]').length,
      selects: document.querySelectorAll('select').length,
      ranges: document.querySelectorAll('input[type="range"]').length,
      // 负向词表:可见文本 + 无障碍名两处都扫。
      forbiddenInText: forbidden.filter((k) => body.includes(k)),
      forbiddenInNames: forbidden.filter((k) => names.includes(k)),
    };
  }, FORBIDDEN);
}

async function gotoLockView(popup) {
  await L.clickTestId(popup, 'lock-open');
  await popup.waitForFunction(
    () => document.querySelector('[data-testid="popup"]')?.dataset.view === 'lock',
    { timeout: 20000 },
  );
}

async function backToList(popup) {
  await L.clickTestId(popup, 'lock-back');
  await popup.waitForFunction(
    () => document.querySelector('[data-testid="popup"]')?.dataset.view === 'list',
    { timeout: 20000 },
  );
}

async function persisted(browser) {
  const s = await L.readPersisted(browser);
  return {
    lockUntil: s?.lockUntil ?? null,
    masterEnabled: s?.masterEnabled ?? null,
    rules: (s?.rules ?? []).length,
  };
}

(async () => {
  const results = {
    clause: 'T6c【折叠改造】锁定 UI 折叠为一行入口 + 独立子页面(真实 Chrome)',
    assertions: [], data: {}, pass: true,
  };
  const assert = L.makeAsserter(results);

  fs.rmSync(udd, { recursive: true, force: true });
  const browser = await L.launch(udd, { headless: true });
  let popup = null;

  try {
    const id = await L.extensionId(browser);

    // ═══ 阶段 0:建一条规则,并把主开关关掉(为 ADR-057 铺路)═══════════
    popup = await L.openPopup(browser, id);
    await L.createRuleViaUI(popup, 'example.com', 100);
    const masterBefore = await popup.$eval('[data-testid="master-switch"]',
      (el) => el.getAttribute('aria-checked') ?? String(el.checked));
    if (masterBefore !== 'false') await L.clickTestId(popup, 'master-switch');
    await popup.waitForFunction(() => {
      const el = document.querySelector('[data-testid="master-switch"]');
      return (el.getAttribute('aria-checked') ?? String(el.checked)) === 'false';
    }, { timeout: 20000 });

    let st = await persisted(browser);
    results.data.phase0 = st;
    assert('阶段 0:1 条规则、主开关 OFF、未锁定',
      st.rules === 1 && st.masterEnabled === false && st.lockUntil === null, st);

    // ═══ 条款 1:列表页真的折叠成一行 ═══════════════════════════════════
    let s1 = await snap(popup);
    results.data.c1_list = s1;
    fs.writeFileSync(path.join(OUT, 'sub-01-list-collapsed.png'),
      Buffer.from(await popup.screenshot()));

    assert('🔴 C1 列表页**只有一行**锁定入口,内联时长选择器/预设/启动按钮全部不在场',
      s1.view === 'list'
      && s1.ids.includes('lock-entry')
      && s1.ids.includes('lock-open')
      && !s1.ids.includes('lock-start')
      && !s1.ids.includes('lock-start-section')
      && !s1.ids.includes('lock-start-amount')
      && !s1.ids.includes('lock-start-unit')
      && !s1.ids.includes('lock-start-preset-1-hour')
      && !s1.ids.includes('lock-start-duration'), s1);

    assert('🔴 C1b 列表页上**没有任何**数字输入或下拉(时长控件一个都没留下)',
      s1.numberInputs === 0 && s1.selects === 0,
      { numberInputs: s1.numberInputs, selects: s1.selects });

    // ═══ 条款 2:入口行是真 <button>,与「添加规则」同一基类 ═════════════
    assert('🔴 C2 入口行是真 `<button>`(不是可点击的 div),有可见文案 + 无障碍名',
      s1.entryTag === 'BUTTON'
      && (s1.entryText ?? '').includes('时间锁定')
      && typeof s1.entryAria === 'string' && s1.entryAria.length > 0,
      { tag: s1.entryTag, text: s1.entryText, aria: s1.entryAria });

    assert('C2b 与「添加规则」共享 `.add-button` 基类(视觉语言一致,§5.1 token)',
      (s1.entryClass ?? '').includes('add-button')
      && (s1.addRuleClass ?? '').includes('add-button'),
      { entryClass: s1.entryClass, addRuleClass: s1.addRuleClass });

    // 🔴 键盘可达:Tab 到入口行,回车进入 —— 不靠鼠标。
    await popup.evaluate(() => {
      document.querySelector('[data-testid="lock-open"]').focus();
    });
    const focused = await popup.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? null,
    );
    await popup.keyboard.press('Enter');
    await popup.waitForFunction(
      () => document.querySelector('[data-testid="popup"]')?.dataset.view === 'lock',
      { timeout: 20000 },
    );
    assert('🔴 C2c 入口行**键盘可聚焦且回车可触发**(无障碍:不只响应鼠标)',
      focused === 'lock-open', { focusedTestId: focused });

    // ═══ 条款 3:子页面形态 + 返回键 ═════════════════════════════════════
    let s3 = await snap(popup);
    const title3 = await L.textOf(popup, 'lock-view-title');
    results.data.c3_subpage = { ...s3, title: title3 };
    fs.writeFileSync(path.join(OUT, 'sub-02-subpage-unlocked.png'),
      Buffer.from(await popup.screenshot()));

    assert('🔴 C3 子页面:标题 + 返回键 + 预设行 + 数字 + 单位 + 启动按钮俱在',
      s3.view === 'lock' && title3 === '专注锁定'
      && s3.ids.includes('lock-back')
      && s3.ids.includes('lock-start-preset-30-minute')
      && s3.ids.includes('lock-start-preset-1-hour')
      && s3.ids.includes('lock-start-amount')
      && s3.ids.includes('lock-start-unit')
      && s3.ids.includes('lock-start')
      && s3.numberInputs === 1 && s3.selects === 1, { ...s3, title: title3 });

    assert('🔴 C3b ADR-058:子页面里没有任何 datetime/date/time/自由文本输入(不接受裸时间戳)',
      await popup.evaluate(() => ['datetime-local', 'date', 'time', 'text']
        .every((t) => document.querySelectorAll(`input[type="${t}"]`).length === 0)),
      { checked: ['datetime-local', 'date', 'time', 'text'] });

    /*
     * 🔴 **未锁定**的子页面上「提前结束」四个字是**必须在场**的 ——
     *    `LOCK_SECTION_HINT`:「锁定后无法修改设置,只能延长,不能提前结束」。
     *    ADR-052 要求这条单向语义在用户点开确认框**之前**就可见。
     *
     *    它不是解除入口,恰恰相反:它是在**告知没有**解除入口。
     *    INV-12 的负向约束按「**锁定中**渲染出的 DOM」判定(见
     *    `src/ui/lock-strings.ts` 文件头),故 C6 / C6b 扫的是锁定态那两页。
     *    这里把它显式钉住,免得将来有人为了让词表变干净而删掉这句告知。
     */
    assert('🔴 C3e ADR-052:**未锁定**子页面必须在启动前就说清「只能延长,不能提前结束」',
      s3.forbiddenInText.includes('提前结束')
      && await popup.evaluate(() => document.body.innerText
        .includes('锁定后无法修改设置,只能延长,不能提前结束')),
      { hintPresent: s3.forbiddenInText });

    assert('🔴 C3f 该告知只是**文案**,不是控件:未锁定子页面的按钮集里没有解除类入口',
      s3.forbiddenInNames.length === 0
      && JSON.stringify(s3.buttons) === JSON.stringify([
        'lock-back',
        'lock-start-preset-30-minute',
        'lock-start-preset-1-hour',
        'lock-start-preset-4-hour',
        'lock-start-preset-8-hour',
        'lock-start-preset-1-day',
        'lock-start',
      ]),
      { buttons: s3.buttons, forbiddenInNames: s3.forbiddenInNames });

    assert('🔴 C3c I2:子页面里**没有**预览通道或规则编辑控件(强度滑块/网址输入/规则列表)',
      s3.ranges === 0
      && !s3.ids.includes('intensity-slider')
      && !s3.ids.includes('pattern-input')
      && !s3.ids.includes('rule-list')
      && !s3.ids.includes('save-button')
      && !s3.ids.includes('master-switch'), s3);

    // 返回键真的能回去,且**零写入**。
    const beforeBack = await persisted(browser);
    await backToList(popup);
    const afterBack = await persisted(browser);
    const s3b = await snap(popup);
    results.data.c3_back = { beforeBack, afterBack, view: s3b.view };
    assert('🔴 C3d 返回键回到列表视图,且 ADR-061:导航路径上**零写入**',
      s3b.view === 'list' && s3b.ids.includes('lock-entry')
      && JSON.stringify(beforeBack) === JSON.stringify(afterBack),
      { view: s3b.view, beforeBack, afterBack });

    // ═══ 条款 4:从子页面启动锁定(ADR-056 确认框 + ADR-057 主开关自动 ON)═══
    await gotoLockView(popup);
    await popup.evaluate(() => {
      const el = document.querySelector('[data-testid="lock-start-amount"]');
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '2');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await popup.select('[data-testid="lock-start-unit"]', 'minute');

    // 点启动 —— ADR-056:只开确认框,**一个字节都不写**。
    const beforeConfirm = await persisted(browser);
    await L.clickTestId(popup, 'lock-start');
    await L.waitTestId(popup, 'lock-confirm-backdrop');
    const dialog = await popup.evaluate(() => {
      const el = document.querySelector('[data-testid="lock-confirm"]');
      return {
        text: el?.textContent ?? '',
        consequences: [...document.querySelectorAll('[data-testid="lock-consequences"] li')]
          .map((li) => li.textContent),
        willEnableMaster: !!document.querySelector('[data-testid="lock-will-enable-master"]'),
        duration: document.querySelector('[data-testid="lock-confirm-duration"]')?.textContent ?? null,
        focusedTestId: document.activeElement?.getAttribute('data-testid') ?? null,
      };
    });
    const afterConfirmShown = await persisted(browser);
    results.data.c4_dialog = { dialog, beforeConfirm, afterConfirmShown };
    fs.writeFileSync(path.join(OUT, 'sub-03-confirm.png'),
      Buffer.from(await popup.screenshot()));

    assert('🔴 C4 ADR-056:确认框出现,且**未确认前零写入**',
      JSON.stringify(beforeConfirm) === JSON.stringify(afterConfirmShown)
      && afterConfirmShown.lockUntil === null,
      { beforeConfirm, afterConfirmShown });

    assert('🔴 C4b ADR-056:确认文案**逐条**列出三条后果',
      JSON.stringify(dialog.consequences)
        === JSON.stringify(['无法修改任何设置', '无法关闭滤镜', '无法提前结束(只能延长)']),
      dialog.consequences);

    assert('🔴 C4c ADR-057:主开关 OFF 时确认框告知「启动锁定将同时开启滤镜」',
      dialog.willEnableMaster === true
      && dialog.text.includes('滤镜当前已关闭,启动锁定将同时开启滤镜'),
      { willEnableMaster: dialog.willEnableMaster });

    assert('C4d 不可逆操作:确认框初始焦点落在「取消」而非「确认锁定」',
      dialog.focusedTestId === 'lock-confirm-cancel',
      { focusedTestId: dialog.focusedTestId });

    // 先试一次「取消」—— 必须零写入且留在子页面(可以改时长再试)。
    await L.clickTestId(popup, 'lock-confirm-cancel');
    await popup.waitForFunction(
      () => document.querySelector('[data-testid="lock-confirm"]') === null,
      { timeout: 20000 });
    const afterCancel = await persisted(browser);
    const sCancel = await snap(popup);
    results.data.c4_cancel = { afterCancel, view: sCancel.view };
    assert('🔴 C4e ADR-056:「取消」关框、**零写入**、仍留在子页面(可改时长再试)',
      afterCancel.lockUntil === null && afterCancel.masterEnabled === false
      && sCancel.view === 'lock' && sCancel.ids.includes('lock-start'),
      { afterCancel, view: sCancel.view });

    // 真确认一次。
    await L.clickTestId(popup, 'lock-start');
    await L.waitTestId(popup, 'lock-confirm-backdrop');
    await L.clickTestId(popup, 'lock-confirm-ok');
    await L.waitTestId(popup, 'lock-extend-panel');

    st = await persisted(browser);
    results.data.c4_started = st;
    assert('🔴🔴 C4f 从子页面启动锁定端到端成功:磁盘上 lockUntil 为未来时间戳(ADR-053)',
      typeof st.lockUntil === 'number'
      && st.lockUntil - Date.now() > 0 && st.lockUntil - Date.now() <= 121_000, st);
    assert('🔴🔴 C4g ADR-057:主开关 OFF 状态下启动锁定 → 主开关**自动变 ON**',
      st.masterEnabled === true, { masterEnabled: st.masterEnabled });

    // ═══ 条款 5:锁定中 —— 列表页显示倒计时,点它直达延长 ═══════════════
    let sLocked = await snap(popup);
    const lockedTitle = await L.textOf(popup, 'lock-view-title');
    results.data.c5_subpage_locked = { ...sLocked, title: lockedTitle };
    fs.writeFileSync(path.join(OUT, 'sub-04-subpage-locked.png'),
      Buffer.from(await popup.screenshot()));
    assert('🔴 C5 启动成功后子页面当场换成延长形态:标题「延长锁定」,启动区消失',
      lockedTitle === '延长锁定'
      && sLocked.ids.includes('lock-extend')
      && !sLocked.ids.includes('lock-start')
      && !sLocked.ids.includes('lock-start-section'),
      { ...sLocked, title: lockedTitle });

    await backToList(popup);
    await L.waitTestId(popup, 'lock-banner');
    const sListLocked = await snap(popup);
    const countdown = await L.textOf(popup, 'lock-countdown');
    results.data.c5_list_locked = { ...sListLocked, countdown };
    fs.writeFileSync(path.join(OUT, 'sub-05-list-locked.png'),
      Buffer.from(await popup.screenshot()));

    assert('🔴 C5b 锁定中**列表页仍显示倒计时**(产品负责人:剩余时间一眼可见)',
      sListLocked.ids.includes('lock-countdown')
      && /^🔒 锁定中 \d\d:\d\d:\d\d$/.test(countdown), { countdown });
    assert('🔴 C5c 锁定中列表页**没有**延长控件、也没有折叠入口行(两者互斥)',
      !sListLocked.ids.includes('lock-extend')
      && !sListLocked.ids.includes('lock-extend-amount')
      && !sListLocked.ids.includes('lock-entry')
      && sListLocked.numberInputs === 0 && sListLocked.selects === 0, sListLocked);
    assert('ADR-051 锁定中列表页全部设置控件禁用(含主开关)',
      await popup.evaluate(() => ({
        master: document.querySelector('[data-testid="master-switch"]')?.disabled,
        add: document.querySelector('[data-testid="add-rule"]')?.disabled,
      })).then((d) => d.master === true && d.add === true),
      await popup.evaluate(() => ({
        master: document.querySelector('[data-testid="master-switch"]')?.disabled,
        add: document.querySelector('[data-testid="add-rule"]')?.disabled,
      })));

    // 点倒计时条 → 直达延长控件。
    await gotoLockView(popup);
    const beforeExtend = (await persisted(browser)).lockUntil;
    await popup.evaluate(() => {
      const el = document.querySelector('[data-testid="lock-extend-amount"]');
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '3');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await popup.select('[data-testid="lock-extend-unit"]', 'minute');
    await L.clickTestId(popup, 'lock-extend');
    await popup.waitForFunction((prev) => {
      const el = document.querySelector('[data-testid="lock-view-countdown"]');
      return el && Number(el.getAttribute('data-lock-until')) > prev;
    }, { timeout: 20000 }, beforeExtend);
    const afterExtend = (await persisted(browser)).lockUntil;
    results.data.c5_extend = { beforeExtend, afterExtend, deltaMs: afterExtend - beforeExtend };
    assert('🔴🔴 C5d 点倒计时条进子页面 → **延长成功**,lockUntil 严格变大(加了 3 分钟)',
      afterExtend > beforeExtend && afterExtend - beforeExtend === 180_000,
      { beforeExtend, afterExtend, deltaMs: afterExtend - beforeExtend });

    // 延长后返回列表页,倒计时条同源。
    await backToList(popup);
    const listAttr = await popup.$eval('[data-testid="lock-countdown"]',
      (el) => Number(el.getAttribute('data-lock-until')));
    assert('C5e 列表页倒计时条与子页面回显同源(同一个 lockUntil)',
      listAttr === afterExtend, { listAttr, afterExtend });

    // ═══ 条款 6:🔴🔴 缩短/取消/解除在整个 UI 里不存在 ═══════════════════
    // 列表页(锁定中)。
    assert('🔴🔴 C6 锁定中**列表页**:可见文本与无障碍名里都不含任何解除/缩短类词汇',
      sListLocked.forbiddenInText.length === 0
      && sListLocked.forbiddenInNames.length === 0,
      { inText: sListLocked.forbiddenInText, inNames: sListLocked.forbiddenInNames });

    // 子页面(锁定中)—— 控件现在住在这里,这一遍最关键。
    await gotoLockView(popup);
    const sSubLocked = await snap(popup);
    results.data.c6_sub_locked = sSubLocked;
    assert('🔴🔴 C6b 锁定中**子页面**:可见文本与无障碍名里都不含任何解除/缩短类词汇',
      sSubLocked.forbiddenInText.length === 0
      && sSubLocked.forbiddenInNames.length === 0,
      { inText: sSubLocked.forbiddenInText, inNames: sSubLocked.forbiddenInNames });

    assert('🔴🔴 C6c 锁定中子页面里**只有两个按钮**:返回(只切视图)+ 延长(唯一写入)',
      JSON.stringify(sSubLocked.buttons) === JSON.stringify(['lock-back', 'lock-extend']),
      { buttons: sSubLocked.buttons });

    // 「返回」不是「解除」—— 返回列表后锁仍在。
    await backToList(popup);
    const afterBackLocked = await persisted(browser);
    const sBackLocked = await snap(popup);
    results.data.c6_back_not_release = { afterBackLocked, locked: sBackLocked.locked };
    assert('🔴🔴 C6d 「返回」**不是**「解除」:返回列表后 lockUntil 不变、data-locked 仍为 true',
      afterBackLocked.lockUntil === afterExtend
      && sBackLocked.locked === 'true'
      && sBackLocked.ids.includes('lock-banner')
      && !sBackLocked.ids.includes('lock-entry'),
      { afterBackLocked, locked: sBackLocked.locked });

    // 🔴 探针有效性:上面那组负向断言必须真的能被一个违规词证伪。
    //    做法 —— 临时往 DOM 里注入一个「解除锁定」按钮,同一个 snap() 必须抓到。
    await popup.evaluate(() => {
      const b = document.createElement('button');
      b.setAttribute('data-testid', 'ccf-probe-violation');
      b.textContent = '解除锁定';
      document.querySelector('[data-testid="popup"]').appendChild(b);
    });
    const sPoisoned = await snap(popup);
    await popup.evaluate(() => {
      document.querySelector('[data-testid="ccf-probe-violation"]')?.remove();
    });
    results.data.c6_probe = {
      inText: sPoisoned.forbiddenInText, inNames: sPoisoned.forbiddenInNames,
    };
    assert('🔴 C6e 探针有效性:注入一个「解除锁定」按钮后,同一组扫描**当场报出违规**',
      sPoisoned.forbiddenInText.includes('解除')
      && sPoisoned.forbiddenInNames.includes('解除'),
      results.data.c6_probe);

    fs.writeFileSync(path.join(OUT, 'sub-06-final.png'),
      Buffer.from(await popup.screenshot()));
    await L.closePopup(popup);
    popup = null;

  } finally {
    if (popup) await L.closePopup(popup).catch(() => {});
    try { await browser.close(); } catch {}
  }

  fs.writeFileSync(path.join(OUT, 'lock-subpage.json'),
    JSON.stringify(results, null, 2));
  console.log(`\n${results.pass ? 'PASS' : 'FAIL'} — T6c 锁定子页面(折叠改造) · ${String(results.assertions.length)} 条`);
  process.exit(results.pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
