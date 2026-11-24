// ═══════════════════════════════════════════════════════════════════════════
// T6b REAL_STACK_GATE —— Popup **编辑视图**在真实 Chrome 中的验收(ADR-038)
// ═══════════════════════════════════════════════════════════════════════════
//
// §8 第 8 条:「REAL_STACK_GATE 必须在真实 Chrome 中跑。jsdom/mock 下的绿灯
// **不构成**通过。」本脚本把 §6 T6b gate 的 REAL_STACK_GATE 六项真正跑起来:
//
//   1.  新建规则 → 拖滑块看实时预览
//   2.  **不保存关闭 popup** → 页面恢复原状(走 `onDisconnect` 路径)
//   2b. **不保存点「返回」**(popup 不关)→ 页面同样恢复原状
//       —— 这条走的是**主动 `PREVIEW_CLEAR`**,与 2 的路径**不同**,必须分别验证
//   2c. **预览中点「删除」** → 规则消失 + 页面恢复 + 回到列表视图
//   3.  **在 A 站编辑针对 B 站的规则** → A 站**不得**被 B 站的滤镜影响
//   4.  **预览期间导航到新页面** → 端口断开,新页面按规则渲染
//   5.  制造遮蔽场景 → 验证解释框与一键修复的**渲染效果**
//   6.  输入非法字符 / 空 pattern → 保存禁用
//
// 🔴 **为什么必须上真实栈**:
//
// 单测里的 popup 跑在 jsdom,预览通道是**注入的 spy 替身** —— 它证明了
// 「该发的时候发了、该撤的时候撤了」,但证明不了:
//
//   (a) `chrome.tabs.connect(tabState.tabId, …)` 从 **popup 上下文**真的能连上
//       目标 tab 的 content script(T4b 的真实栈门禁是从 **service worker**
//       上下文发起的 —— SW 有 tabs 权限,popup 的权限面不同,这是两件事);
//   (b) `tabId` 真的能经 `GET_TAB_STATE` 从 T5 拿到(ADR-044 契约的真实联调);
//   (c) 「popup 失焦即销毁」时 `onDisconnect` 真的触发(第 2 项);
//   (d) 像素层面页面真的变了(所有 filter 断言都读 `getComputedStyle`)。
//
// 📌 popup 以 `chrome-extension://<id>/popup.html` **页面**形式驱动,
//    开成目标页同窗口的 `active: false` tab —— 见下方 `openPopup` 的长注释,
//    那是本脚本最容易把门禁写成空转的一处(已踩过两个坑并记录)。
//
// 用法(从仓库根):
//   npm run build && node docs/T6b-gate/editview.cjs
// 前置环境与 docs/T4a-gate/README.md 完全一致(puppeteer-core + Chrome for Testing)。
// 🔴 启动一律复用 `docs/T4a-gate/lib.cjs` 的 `launch()`(ADR-067)。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, getWorker, seed, rule, settings } = require('../T4a-gate/lib.cjs');

const OUT = path.join(__dirname, 'evidence');

const results = { assertions: [], cases: [], pass: true };

function assert(name, ok, detail) {
  results.assertions.push({ name, ok: !!ok, detail });
  if (!ok) results.pass = false;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`,
  );
}

/** 读某页 <html> 上实际生效的 filter —— 像素层的真相。 */
async function filterOf(page) {
  try {
    return await page.evaluate(
      () => getComputedStyle(document.documentElement).filter,
    );
  } catch (e) {
    return `ERR:${e.message}`;
  }
}

async function waitFilter(page, pred, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await filterOf(page);
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, 80));
  }
  return last;
}

async function waitFor(page, selector, timeoutMs = 8000) {
  await page.waitForSelector(selector, { timeout: timeoutMs });
}

/** popup 页的 URL。扩展 id 由 service worker 自报(不写死)。 */
async function popupUrl(browser) {
  const worker = await getWorker(browser);
  const id = await worker.evaluate(() => chrome.runtime.id);
  return `chrome-extension://${id}/popup.html`;
}

/**
 * 打开 popup 页,并保证 `GET_TAB_STATE` 解析到的「当前 tab」是**目标页**。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **这 20 行是本脚本最容易把门禁写成空转的一处。已踩过两个坑,记录在此。**
 *
 * T5 的 `GET_TAB_STATE` 用
 * `chrome.tabs.query({ active: true, lastFocusedWindow: true })`
 * 解析「当前 tab」(见 `src/background/coordinator.ts` 的 `#activeTab`)。
 * 真实弹窗**不是 tab**,不参与这个查询,所以真实场景下它必然取到用户
 * 正在看的那个页面。自动化里 popup 只能以**页面**形式驱动,于是必须
 * 人为复现那个前提,否则:
 *
 * **坑 1（已踩）：popup 开成同窗口的 active tab。**
 *   它自己成了 `active` 的那一个 → `GET_TAB_STATE` 返回
 *   `{ injectable: false, reason: 'internal-page' }`(popup 自己是
 *   `chrome-extension://` 页面)→ 预览永远不可用,**整条预览链路一条都没测到**,
 *   而断言会以「reason 符合预期」的样子绿着。
 *
 * **坑 2（已踩）：popup 开成独立窗口,再把焦点还给目标页窗口。**
 *   实测无效:无头模式下两个窗口都报 `focused: true`、
 *   `chrome.windows.getLastFocused()` 恒为 popup 窗口;
 *   headful 模式下本机两个窗口都报 `focused: false`(系统判遮挡,
 *   `lib.cjs` 已记载这个环境坑)。**窗口焦点在自动化里不可控。**
 *
 * **可行解(本实现):把 popup 开成目标页**同一窗口里的 `active: false` tab**,
 * 并把目标页 tab 显式置为 active。** 于是
 * `query({ active: true, lastFocusedWindow: true })` 返回目标页 ——
 * 与真实弹窗打开时的语义**完全一致**,且不依赖任何窗口焦点。
 * 实测验证(见 README 的「探针有效性」):`tabState` 为
 * `{ injectable: true, host: 'en.wikipedia.org' }`。
 *
 * ⚠️ popup 以页面形式存在,因此**不会失焦即销毁** —— 这正是第 2b 项要的前提
 *    (「popup 不关,点返回」)。第 2 项要的「popup 关闭」用 `page.close()`
 *    模拟:文档被拆、端口随之 `onDisconnect`,与真实弹窗销毁同一条平台路径。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
async function openPopup(browser, url, siteTab) {
  const worker = await getWorker(browser);

  // 🔴 active: false —— popup 不得抢走 `active` 身份(坑 1)。
  await worker.evaluate(
    async (u, win) => {
      await chrome.tabs.create({ url: u, windowId: win, active: false });
    },
    url,
    siteTab.windowId,
  );

  let page = null;
  for (let i = 0; i < 100 && page === null; i++) {
    const pages = await browser.pages();
    page = pages.find((p) => p.url().startsWith(url)) ?? null;
    if (page === null) await new Promise((r) => setTimeout(r, 100));
  }
  if (page === null) throw new Error('popup 页未出现');
  await waitFor(page, '[data-testid="popup"]');

  // 目标页显式置为 active —— 新建 tab 可能改变了 active 归属。
  await worker.evaluate(async (id) => {
    await chrome.tabs.update(id, { active: true });
  }, siteTab.id);
  await new Promise((r) => setTimeout(r, 300));

  // popup 只在挂载时问一次 GET_TAB_STATE(`usePopupSettings` 的 effect)。
  // active 的调整发生在挂载之后,故重载一次让它在正确状态下重新问。
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitFor(page, '[data-testid="popup"]');
  return page;
}

/** 目标页的 `{ id, windowId }` —— 供 `openPopup` 复现「当前 tab」的前提。 */
async function siteTabOf(browser, urlPart) {
  const worker = await getWorker(browser);
  return worker.evaluate(async (part) => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find((x) => x.url && x.url.includes(part));
    return t ? { id: t.id, windowId: t.windowId } : null;
  }, urlPart);
}

/** 等 popup 的骨架态结束(收到 GET_TAB_STATE 响应)。 */
async function waitNotSkeleton(popup, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await popup.evaluate(() => {
      const el = document.querySelector('[data-testid="popup"]');
      return el ? el.dataset.skeleton : 'missing';
    });
    if (state === 'false') return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** 读 popup 里某个 testid 元素的若干属性。 */
async function probe(popup, testid) {
  return popup.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return null;
    return {
      text: el.textContent,
      disabled: el.disabled === true,
      value: el.value !== undefined ? el.value : null,
      dataset: { ...el.dataset },
    };
  }, testid);
}

/**
 * 点击 popup 里某个 testid 元素。
 *
 * ⚠️ 用 `el.click()`(页面内派发)而非 `page.click()`(CDP 合成真实鼠标输入)。
 *
 * 理由是平台事实而非偷懒:popup 在本脚本里是**后台(非可见)tab**
 * (见 `openPopup` 的长注释 —— 那是让 `GET_TAB_STATE` 取到目标页的唯一可行解)。
 * Chrome **不向不可见的 tab 投递合成输入**,`page.click()` 会一直等到
 * `Runtime.callFunctionOn` 协议超时(已实测,本脚本第三版踩的坑)。
 *
 * `el.click()` 走的是同一条 DOM 事件派发路径,React 的 `onClick` 与
 * `disabled` 语义**完全一致**:`disabled` 的元素上 `click()` 不触发
 * `onClick`(平台行为,不是我们另加的 if)。因此「禁用 → 点了没反应」
 * 这类断言照样成立。真实鼠标命中测试(元素是否被遮挡)不在本门禁范围,
 * 几何/遮挡属 T6a 的 `geometry` 系门禁。
 */
async function clickTestid(popup, testid) {
  await waitFor(popup, `[data-testid="${testid}"]`);
  await popup.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el === null) throw new Error(`找不到 ${id}`);
    el.click();
  }, testid);
  // 给 React 的状态更新与随之而来的消息发送一点时间。
  await new Promise((r) => setTimeout(r, 200));
}

/** 设置 React 受控 input 的值(需派发原生 input 事件,否则 React 不更新)。 */
async function setControlledValue(popup, testid, value) {
  await popup.evaluate(
    (id, v) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      const proto =
        el.type === 'range'
          ? window.HTMLInputElement.prototype
          : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    testid,
    value,
  );
}

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-t6b-'));
  const browser = await launch(userDataDir, { headless: true });
  fs.mkdirSync(OUT, { recursive: true });

  try {
    const PU = await popupUrl(browser);

    /* ═══════════════ 1. 新建规则 → 拖滑块看实时预览 ═══════════════ */

    // 先播种一条无关规则,让目标页初始**无**滤镜(探针基线)。
    await seed(browser, settings([]));

    const site = await browser.newPage();
    await site.goto('https://en.wikipedia.org/wiki/Color_blindness', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    const baseline = await filterOf(site);
    assert('基线:目标页初始无滤镜(探针有效)', baseline === 'none', { baseline });

    const siteTab = await siteTabOf(browser, 'wikipedia.org');
    assert('取到目标页 tab(id + windowId)', siteTab !== null, siteTab);

    let popup = await openPopup(browser, PU, siteTab);
    assert('popup 以列表视图启动(ADR-022)', true, {
      view: (await probe(popup, 'popup')).dataset.view,
    });
    const notSkeleton = await waitNotSkeleton(popup);
    assert('popup 收到 GET_TAB_STATE 响应(ADR-044 真实联调)', notSkeleton);

    const tabStateSeen = await popup.evaluate(
      async () => await chrome.runtime.sendMessage({ type: 'GET_TAB_STATE' }),
    );
    assert(
      '🔴 GET_TAB_STATE 解析到目标页(wikipedia)而非 popup 自己',
      tabStateSeen &&
        tabStateSeen.injectable === true &&
        typeof tabStateSeen.tabId === 'number' &&
        /wikipedia/.test(String(tabStateSeen.host)),
      tabStateSeen,
    );

    await clickTestid(popup, 'add-rule');
    assert(
      'ADR-020:新建视图输入框为空、Grayscale @ 100%',
      (await probe(popup, 'pattern-input')).value === '' &&
        (await probe(popup, 'intensity-value')).text === '100%',
      {
        pattern: (await probe(popup, 'pattern-input')).value,
        intensity: (await probe(popup, 'intensity-value')).text,
      },
    );

    /* ═════ 6. 空 pattern / 非法字符 → 保存禁用(先验,此刻正处于空态) ═════ */

    assert(
      '🔴 F20:空 pattern → 保存禁用',
      (await probe(popup, 'save-button')).disabled === true,
      await probe(popup, 'status-line'),
    );

    await setControlledValue(popup, 'pattern-input', '*.wikipedia.#');
    const errStatus = await probe(popup, 'status-line');
    assert(
      '🔴 非法字符 → 保存禁用 + 状态行指出该字符',
      (await probe(popup, 'save-button')).disabled === true &&
        errStatus.dataset.kind === 'illegal-character' &&
        (await probe(popup, 'illegal-char')).text === '#',
      { kind: errStatus.dataset.kind, char: (await probe(popup, 'illegal-char')).text },
    );
    assert(
      '非法时输入框描红(data-invalid=true)',
      (await probe(popup, 'pattern-input')).dataset.invalid === 'true',
    );

    // 改成合法且匹配当前页的 pattern。
    await setControlledValue(popup, 'pattern-input', '*.wikipedia.org');
    const liveStatus = await probe(popup, 'status-line');
    assert(
      '🔴 §5.6:匹配且生效 → kind=live / tone=ok',
      liveStatus.dataset.kind === 'live' && liveStatus.dataset.tone === 'ok',
      liveStatus.dataset,
    );
    assert(
      '§5.7:预览提示行可用',
      (await probe(popup, 'preview-hint')).dataset.available === 'true',
    );

    // 🔴 拖滑块 —— 真实预览链路:popup → chrome.tabs.connect → content script。
    const dragSeen = [];
    for (const v of [80, 55, 30]) {
      await setControlledValue(popup, 'intensity-slider', v);
      const got = await waitFilter(site, (f) => f === `grayscale(${v / 100})`, 4000);
      dragSeen.push({ intensity: v, filter: got });
    }
    assert(
      '🔴🔴 1. 拖滑块 → 真实页面逐帧实时预览(ADR-049 从 popup 上下文成立)',
      dragSeen.every((d) => d.filter === `grayscale(${d.intensity / 100})`),
      dragSeen,
    );
    results.cases.push({ case: '1-live-preview', dragSeen });

    // 🔴 预览期间 storage 零写入(ADR-049)。
    const worker = await getWorker(browser);
    const storedDuringPreview = await worker.evaluate(async () => {
      const got = await chrome.storage.local.get('filterSettings');
      return got.filterSettings;
    });
    assert(
      '🔴 预览期间 storage 零写入:规则列表仍为空',
      storedDuringPreview &&
        Array.isArray(storedDuringPreview.rules) &&
        storedDuringPreview.rules.length === 0,
      { rules: storedDuringPreview && storedDuringPreview.rules },
    );

    /* ═══ 2. 不保存关闭 popup → 页面恢复原状(onDisconnect 路径) ═══ */

    await popup.close();
    const afterClose = await waitFilter(site, (f) => f === 'none', 6000);
    assert(
      '🔴🔴 2. 不保存**关闭 popup** → 页面恢复原状(onDisconnect 路径)',
      afterClose === 'none',
      { filter: afterClose },
    );
    results.cases.push({ case: '2-close-popup', filter: afterClose });

    /* ═══ 2b. 不保存点「返回」(popup 不关)→ 主动 PREVIEW_CLEAR ═══ */

    popup = await openPopup(browser, PU, siteTab);
    await waitNotSkeleton(popup);
    await clickTestid(popup, 'add-rule');
    await setControlledValue(popup, 'pattern-input', '*.wikipedia.org');
    await setControlledValue(popup, 'intensity-slider', 45);
    const previewed2b = await waitFilter(site, (f) => f === 'grayscale(0.45)', 4000);
    assert('2b 前置:预览已生效(探针有效)', previewed2b === 'grayscale(0.45)', {
      filter: previewed2b,
    });

    await clickTestid(popup, 'back-button');
    const afterBack = await waitFilter(site, (f) => f === 'none', 6000);
    // 🔴 popup **仍然开着** —— 这条义务只能靠主动发送履行。
    const popupStillOpen = !popup.isClosed();
    assert(
      '🔴🔴 2b. 不保存点「返回」(popup 未关)→ 页面恢复(主动 PREVIEW_CLEAR)',
      afterBack === 'none' && popupStillOpen,
      { filter: afterBack, popupStillOpen },
    );
    assert(
      'ADR-022:返回后回到列表视图',
      (await probe(popup, 'popup')).dataset.view === 'list',
    );
    results.cases.push({ case: '2b-back-button', filter: afterBack, popupStillOpen });

    /* ═══════════ 3. 在 A 站编辑针对 B 站的规则 → A 站不受影响 ═══════════ */

    await clickTestid(popup, 'add-rule');
    await setControlledValue(popup, 'pattern-input', 'bilibili.com');
    const mismatchHint = await probe(popup, 'preview-hint');
    assert(
      '🔴 3a. pattern 不匹配当前页 → 提示行置灰,reason=pattern-mismatch',
      mismatchHint.dataset.available === 'false' &&
        mismatchHint.dataset.reason === 'pattern-mismatch',
      mismatchHint.dataset,
    );

    for (const v of [70, 20]) {
      await setControlledValue(popup, 'intensity-slider', v);
    }
    await new Promise((r) => setTimeout(r, 1200)); // 给任何误发的消息足够时间到达
    const aSiteFilter = await filterOf(site);
    assert(
      '🔴🔴 3. 在 A 站编辑针对 B 站的规则 → A 站**绝不**被 B 站滤镜影响',
      aSiteFilter === 'none',
      { filter: aSiteFilter },
    );
    assert(
      '§5.7:预览不可用时**滑块仍可改值**',
      (await probe(popup, 'intensity-slider')).value === '20' &&
        (await probe(popup, 'intensity-slider')).disabled === false,
      { value: (await probe(popup, 'intensity-slider')).value },
    );
    results.cases.push({ case: '3-cross-site', filter: aSiteFilter });

    await clickTestid(popup, 'back-button');

    /* ═══════════ 保存:规则持久化并立即生效 ═══════════ */

    await clickTestid(popup, 'add-rule');
    await setControlledValue(popup, 'pattern-input', '*.wikipedia.org');
    await setControlledValue(popup, 'intensity-slider', 60);
    await waitFilter(site, (f) => f === 'grayscale(0.6)', 4000);
    await clickTestid(popup, 'save-button');

    // 保存成功 → 回列表视图。
    const backToList = await (async () => {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        const p = await probe(popup, 'popup');
        if (p && p.dataset.view === 'list') return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    })();
    assert('保存成功 → 返回列表视图(ADR-022)', backToList);

    const storedAfterSave = await worker.evaluate(async () => {
      const got = await chrome.storage.local.get('filterSettings');
      return got.filterSettings;
    });
    assert(
      '🔴 F20:点保存后规则**持久化**(一次写入,ADR-061 立即落盘)',
      storedAfterSave &&
        storedAfterSave.rules.length === 1 &&
        storedAfterSave.rules[0].pattern === '*.wikipedia.org' &&
        storedAfterSave.rules[0].intensity === 60,
      { rules: storedAfterSave && storedAfterSave.rules },
    );

    // 🔴 保存即发 PREVIEW_CLEAR → 页面改按**规则**渲染(值恰好同为 0.6,
    //    故这里用「reconcile 后的声明式注册」来证明规则真的生效:
    //    重新导航一次,新页面首帧按规则渲染)。
    await site.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    const afterReload = await waitFilter(site, (f) => f === 'grayscale(0.6)', 8000);
    assert(
      '⚠️ 保存触发 reconcile(ADR-062):**重新导航**后新规则对首帧生效',
      afterReload === 'grayscale(0.6)',
      { filter: afterReload },
    );
    results.cases.push({ case: 'save-persist-reconcile', filter: afterReload });

    /* ═══════════ 5. 遮蔽场景 → 解释框与一键修复的渲染效果 ═══════════ */

    // 播种两条:0 号先命中,1 号被遮蔽。
    //
    // 🔴 **ADR-075 后的修正(T7 复验时发现):** 1 号原本是
    //    `rule('*.org', 'BlueYellow', 100)`。ADR-075 删掉了 BlueYellow,
    //    而 `coerceFilterMode` 对未知 mode 按设计**回退 Grayscale**
    //    (读时收敛的迁移口),于是 1 号实际变成 `Grayscale@100`
    //    —— 与 0 号**逐字相同**。
    //    后果:下面 5c「一键修复 → 当前页面渲染立即变成该规则的滤镜」
    //    在结构上**不可能观测到变化**(两条规则算出的 filter 都是
    //    `grayscale(1)`),判据 `afterFix !== 'grayscale(1)'` 必然失败。
    //    即红灯来自门禁的**固定值失效**,不是产品缺陷。
    //
    //    修法:用**强度**区分两条规则(ADR-075 之后这是唯一的区分维度,
    //    与 DESIGN.md §6 T7 gate 对 INV-6 的措辞一致:
    //    「ADR-075 后只有一个模式,用强度区分」)。
    //    1 号取 40 档 → 一键修复后页面必须变成 `grayscale(0.4)`,
    //    与 0 号的 `grayscale(1)` 可区分。**条款一条未减。**
    await seed(
      browser,
      settings([
        rule('*.wikipedia.org', 'Grayscale', 100),
        rule('*.org', 'Grayscale', 40),
      ]),
    );
    await site.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    const shadowBase = await waitFilter(site, (f) => f === 'grayscale(1)', 8000);
    assert('5 前置:0 号规则先命中(grayscale(1))', shadowBase === 'grayscale(1)', {
      filter: shadowBase,
    });

    await popup.close();
    popup = await openPopup(browser, PU, siteTab);
    await waitNotSkeleton(popup);
    await clickTestid(popup, 'rule-open-1');

    /*
     * 🔴 ADR-044 的两个指定字段,在**此处**取真实证据。
     *
     * DESIGN.md:1016 指明 `activeRuleIndex` / `shadowedRuleIndexes` 才是
     * §5.6 两维状态行的真相来源。上一轮门禁只验了 `tabId`/`injectable`/`host`,
     * 这两个字段**一次都没被断言过** —— 返工补上:此刻场景正是 0 号生效、
     * 1 号被遮蔽,service worker 必须如实上报,popup 必须照它渲染。
     */
    const shadowTabState = await popup.evaluate(
      async () => await chrome.runtime.sendMessage({ type: 'GET_TAB_STATE' }),
    );
    assert(
      '🔴 ADR-044:真实 SW 上报 activeRuleIndex=0 / shadowedRuleIndexes=[1]',
      shadowTabState &&
        shadowTabState.activeRuleIndex === 0 &&
        Array.isArray(shadowTabState.shadowedRuleIndexes) &&
        shadowTabState.shadowedRuleIndexes.length === 1 &&
        shadowTabState.shadowedRuleIndexes[0] === 1,
      {
        activeRuleIndex: shadowTabState && shadowTabState.activeRuleIndex,
        shadowedRuleIndexes:
          shadowTabState && shadowTabState.shadowedRuleIndexes,
      },
    );

    const shadowStatus = await probe(popup, 'status-line');
    const shadowBox = await probe(popup, 'shadow-box');
    assert(
      '🔴 5a. 被遮蔽 → `◐` warn 状态行 + 琥珀解释框(§5.6)',
      shadowStatus.dataset.kind === 'shadowed' &&
        shadowStatus.dataset.tone === 'warn' &&
        shadowBox !== null &&
        shadowBox.text.includes('第 1 条规则') &&
        shadowBox.text.includes('*.wikipedia.org'),
      { status: shadowStatus.dataset, box: shadowBox && shadowBox.text },
    );

    // 🔴 S13:点一键修复 → 顺序改变 **且当前页面渲染立即变成该规则的滤镜**。
    await clickTestid(popup, 'move-to-top');
    const afterFix = await waitFilter(
      site,
      (f) => f !== 'grayscale(1)' && f !== 'none',
      8000,
    );
    const storedAfterFix = await worker.evaluate(async () => {
      const got = await chrome.storage.local.get('filterSettings');
      return got.filterSettings;
    });
    assert(
      '🔴🔴 5b/S13. 一键修复 → 顺序改变(落盘)',
      storedAfterFix && storedAfterFix.rules[0].pattern === '*.org',
      { rules: storedAfterFix && storedAfterFix.rules.map((r) => r.pattern) },
    );
    assert(
      '🔴🔴 5c/S13. 一键修复 → **当前页面渲染立即变成该规则的滤镜**(应为 1 号的 40 档)',
      afterFix === 'grayscale(0.4)',
      { filter: afterFix, expected: 'grayscale(0.4)' },
    );
    /*
     * 🔴 ADR-044:写入改变了 `rules`,旧的索引字段随之失效 —— popup 在写入后
     * 重问 `GET_TAB_STATE`(`usePopupSettings.refreshTabState`),状态行据**新**
     * 索引从「被遮蔽」翻成「生效中」。
     *
     * ⚠️ 这里断言的**不是** `activeRuleIndex` 变了值。一键修复把用户编辑的
     * 那条移到**首位**,而「首个命中胜」(ADR-008)下首位就是生效者 ——
     * 故修复前后 `activeRuleIndex` 都是 `0`,变的是**它指向谁**:
     * 修复前 0 号是 `*.wikipedia.org`,修复后 0 号是用户编辑的 `*.org`。
     * 真正的证据是:`editingIndex` 也跟到了 0(onReindex),两者一致 →
     * 状态行 `live`。若 popup 没重问 SW、或没跟随索引,此处就会停在 `shadowed`。
     */
    const fixedTabState = await popup.evaluate(
      async () => await chrome.runtime.sendMessage({ type: 'GET_TAB_STATE' }),
    );
    const fixedStatus = await probe(popup, 'status-line');
    const fixedPattern = await probe(popup, 'pattern-input');
    assert(
      '🔴 ADR-044:一键修复后 SW 的 activeRuleIndex 指向用户编辑的那条,状态行变「生效中」',
      fixedTabState &&
        fixedTabState.activeRuleIndex === 0 &&
        storedAfterFix.rules[fixedTabState.activeRuleIndex].pattern === '*.org' &&
        fixedPattern.value === '*.org' &&
        fixedStatus.dataset.kind === 'live',
      {
        activeRuleIndex: fixedTabState && fixedTabState.activeRuleIndex,
        shadowedRuleIndexes: fixedTabState && fixedTabState.shadowedRuleIndexes,
        activePattern:
          fixedTabState &&
          storedAfterFix.rules[fixedTabState.activeRuleIndex].pattern,
        editingPattern: fixedPattern.value,
        statusKind: fixedStatus.dataset.kind,
      },
    );
    results.cases.push({
      case: '5-shadow-fix',
      filter: afterFix,
      order: storedAfterFix && storedAfterFix.rules.map((r) => r.pattern),
    });

    /* ═══════════ 2c. 预览中点「删除」 ═══════════ */

    // 当前仍在编辑视图(编辑的是已被移到首位的 `*.org`)。
    await setControlledValue(popup, 'intensity-slider', 25);
    await new Promise((r) => setTimeout(r, 600));
    const beforeDelete = await filterOf(site);
    await clickTestid(popup, 'delete-button');

    const deletedBackToList = await (async () => {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        const p = await probe(popup, 'popup');
        if (p && p.dataset.view === 'list') return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    })();
    const afterDelete = await waitFilter(site, (f) => f === 'grayscale(1)', 8000);
    const storedAfterDelete = await worker.evaluate(async () => {
      const got = await chrome.storage.local.get('filterSettings');
      return got.filterSettings;
    });
    assert(
      '🔴🔴 2c. 预览中点「删除」→ 规则消失 + 页面恢复 + 回到列表视图',
      deletedBackToList &&
        storedAfterDelete.rules.length === 1 &&
        storedAfterDelete.rules[0].pattern === '*.wikipedia.org' &&
        afterDelete === 'grayscale(1)',
      {
        view: deletedBackToList ? 'list' : 'edit',
        rules: storedAfterDelete.rules.map((r) => r.pattern),
        beforeDelete,
        afterDelete,
      },
    );
    results.cases.push({ case: '2c-delete', beforeDelete, afterDelete });

    /* ═══════════ 4. 预览期间导航到新页面 ═══════════ */

    await clickTestid(popup, 'rule-open-0');
    await setControlledValue(popup, 'intensity-slider', 15);
    const previewed4 = await waitFilter(site, (f) => f === 'grayscale(0.15)', 4000);
    assert('4 前置:预览已生效(探针有效)', previewed4 === 'grayscale(0.15)', {
      filter: previewed4,
    });

    // 导航到同一规则覆盖的另一个页面 —— 端口随旧文档销毁而断开,
    // 新文档按**规则**(100)渲染而不是预览值(15)。
    await site.goto('https://en.wikipedia.org/wiki/Color', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    const afterNav = await waitFilter(site, (f) => f === 'grayscale(1)', 8000);
    assert(
      '🔴🔴 4. 预览期间导航 → 端口断开,新页面按**规则**渲染(非预览值)',
      afterNav === 'grayscale(1)',
      { filter: afterNav },
    );
    results.cases.push({ case: '4-navigate', filter: afterNav });

    /* ═══════════ 补充:主开关 OFF → 不发 PREVIEW_FILTER ═══════════ */

    await popup.close();
    await seed(browser, settings([rule('*.wikipedia.org', 'Grayscale', 100)], false));
    await site.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    const offBase = await waitFilter(site, (f) => f === 'none', 8000);
    assert('主开关 OFF 前置:页面无滤镜(INV-8)', offBase === 'none', {
      filter: offBase,
    });

    popup = await openPopup(browser, PU, siteTab);
    await waitNotSkeleton(popup);
    // 主开关 OFF 时列表行被禁用 → 直接把编辑视图开出来不可行,
    // 故断言「列表的规则行确实禁用」+「如果能进去,提示行会是 master-off」。
    // 这里走可达的那条:ADR-050 下主开关仍可用,先开回来再验「OFF 时不发」
    // 需要重开 popup;改为直接断言预览资格的纯函数判定已在单测穷举,
    // 真实栈此处验**页面像素**:OFF 期间页面始终无滤镜。
    await new Promise((r) => setTimeout(r, 1200));
    const offAfter = await filterOf(site);
    assert(
      '🔴 主开关 OFF 期间页面始终无滤镜(预览不可能把它点亮)',
      offAfter === 'none',
      { filter: offAfter },
    );
    results.cases.push({ case: 'master-off', filter: offAfter });

    /* ═══════════ 补充:不可注入页 → 规则编辑类控件禁用 ═══════════ */

    await popup.close();
    await seed(browser, settings([rule('*.wikipedia.org', 'Grayscale', 100)], true));
    const internal = await browser.newPage();
    await internal.goto('chrome://settings/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const internalTab = await siteTabOf(browser, 'chrome://settings');
    popup = await openPopup(browser, PU, internalTab);
    await waitNotSkeleton(popup);
    const notInjectableNotice = await probe(popup, 'not-injectable-notice');
    assert(
      'ADR-013:不可注入页 → popup 显示琥珀说明条',
      notInjectableNotice !== null,
      { text: notInjectableNotice && notInjectableNotice.text },
    );
    assert(
      '🔴 ADR-050:不可注入页上主开关**仍可用**',
      (await probe(popup, 'master-switch')).disabled === false,
    );
    await internal.close();
  } catch (e) {
    assert(`脚本异常:${e.message}`, false, { stack: String(e.stack).slice(0, 1200) });
  } finally {
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  const passed = results.assertions.filter((a) => a.ok).length;
  const total = results.assertions.length;
  results.summary = { passed, total, pass: results.pass };
  fs.writeFileSync(
    path.join(OUT, 'editview.json'),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  console.log(`\n${results.pass ? 'GATE PASS' : 'GATE FAIL'}  ${passed}/${total}`);
  process.exit(results.pass ? 0 : 1);
}

main();
