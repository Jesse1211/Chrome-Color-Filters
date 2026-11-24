// T7 共用工具 —— 在 T4a/lib.cjs 之上补三件 T7 才需要的能力:
//   1. 打开真实的 popup 页面(chrome-extension://<id>/popup.html)并驱动它;
//   2. 「完全退出并重启浏览器」(同一 userDataDir,进程真的结束);
//   3. 直接读取磁盘上的 storage.local JSON(验证持久化形状与并发终态)。
//
// 🔴 本文件**不**播种设置(seed)。T7 的【新增】条款要求规则「由 popup UI 创建」,
//    绕过 UI 的播种只能用于【回归】条款与负向对照组。
const fs = require('fs');
const path = require('path');
const { launch, getWorker, EXT, CHROME } = require('../T4a-gate/lib.cjs');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

/** 取扩展 id —— 从 service worker 的 URL 里解析。 */
async function extensionId(browser) {
  for (let i = 0; i < 80; i++) {
    const t = browser.targets().find((x) => x.type() === 'service_worker');
    if (t && t.url().startsWith('chrome-extension://')) {
      return new URL(t.url()).host;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('取不到扩展 id —— 扩展很可能没加载');
}

/**
 * 打开 popup 作为一个扩展页面,并保证 **tabState 指向一个真实网站**。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 为什么必须这么绕(实测踩到的真实约束,不是洁癖):
 *
 * popup 直接用 `browser.newPage()` 打开会成为**同一个窗口里的活动标签页**,
 * 于是 `GET_TAB_STATE` 的 `tabs.query({active:true, lastFocusedWindow:true})`
 * 查到的就是 popup 自己 —— 一个 `chrome-extension://` 页面,
 * 分类为 `internal-page` → `injectable:false` → `rulesDisabled` 为真
 * (RuleListView:`rulesDisabled = isSkeleton || masterOff || notInjectable || locked`)。
 * 结果「新增规则」「规则行」全部置灰,**UI 路径根本点不动**。
 *
 * 这是**正确的产品行为**(ADR-050:不可注入页上仅禁用规则编辑类控件),
 * 真实 popup 不会撞上它 —— 真实 popup 是一个独立的 popup 窗口,
 * 它不是 tab、也不改变 `active` tab。
 *
 * 复现办法:先在**主窗口**打开一个真实网站,再把 popup 开到**另一个窗口**里,
 * 并让主窗口保持 last-focused。这样 `lastFocusedWindow` 指向真实网站窗口,
 * 与真实 popup 的语义一致。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 真实 popup 独有的「失焦即销毁」语义在此仍不可复现 —— **已申报为 blindSpot**,
 * 该风险另有防线(ADR-061 的静态门禁 + lock-teardown 单测)。
 *
 * @param hostUrl 作为 tabState 来源的真实网站。
 */
async function openPopup(browser, id, hostUrl = 'https://example.com/') {
  // 1) 主窗口:一个真实网站,并把它带到前台(成为 last-focused)。
  const host = await browser.newPage();
  await host.goto(hostUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await host.bringToFront();

  // 2) 另一个窗口里开 popup。`window.open` 带 popup 特征 → Chrome 新建窗口。
  const w = await getWorker(browser);
  await w.evaluate(async (url) => {
    await chrome.windows.create({ url, type: 'popup', width: 420, height: 640, focused: false });
  }, `chrome-extension://${id}/popup.html`).catch(async () => {
    // `windows` 权限不在 manifest 里时退回 tabs.create(此时 tabState 会退化,
    // 下面的断言会当场发现并报错,不会静默通过)。
    await w.evaluate(async (url) => { await chrome.tabs.create({ url, active: false }); },
      `chrome-extension://${id}/popup.html`);
  });

  // 3) 找到那个 popup 页面。
  let page = null;
  for (let i = 0; i < 80 && page === null; i++) {
    const pages = await browser.pages();
    page = pages.find((p) => p.url().startsWith(`chrome-extension://${id}/popup.html`)) ?? null;
    if (page === null) await new Promise((r) => setTimeout(r, 250));
  }
  if (page === null) throw new Error('popup 页面没出现');

  // 4) 让主窗口重新成为 last-focused(第 2 步的 focused:false 已经尽力,
  //    但有些平台仍会把新窗口置前)。
  await host.bringToFront();

  await page.waitForSelector('[data-testid="popup"]', { timeout: 30000 });
  // 等设置读出 + tabState 到位(ADR-044 骨架态结束)。
  await page.waitForFunction(
    () => document.querySelector('[data-testid="popup"]')?.dataset.skeleton === 'false',
    { timeout: 30000 },
  );
  // 🔴 断言 tabState 真的指向那个真实网站 —— 否则控件置灰、UI 路径测不动,
  //    而那种情况必须**当场报错**,不能变成「点了没反应」的静默跳过。
  const notInjectable = await page.$('[data-testid="not-injectable-notice"]');
  if (notInjectable !== null) {
    throw new Error('popup 的 tabState 指向不可注入页 —— 规则编辑控件会被正确地置灰,'
      + 'UI 路径无法驱动。需要让真实网站窗口保持 last-focused。');
  }
  page.__ccfHost = host;
  return page;
}

/** 关闭 popup 及其配套的宿主网站标签页。 */
async function closePopup(page) {
  const host = page.__ccfHost;
  await page.close().catch(() => {});
  if (host) await host.close().catch(() => {});
}

/** 等到 DOM 上某个 testid 出现。 */
async function waitTestId(page, testid, timeout = 20000) {
  await page.waitForSelector(`[data-testid="${testid}"]`, { timeout });
}

async function clickTestId(page, testid) {
  await page.waitForSelector(`[data-testid="${testid}"]:not([disabled])`, { timeout: 20000 });
  await page.click(`[data-testid="${testid}"]`);
}

async function textOf(page, testid) {
  return page.$eval(`[data-testid="${testid}"]`, (el) => el.textContent);
}

/**
 * 🔴 通过 popup UI **真正地**新建一条规则(T7【新增】INV-6 的要求)。
 *
 * 路径逐步与用户一致:点「新增规则」→ 填 pattern → 拖强度滑块 → 点「保存」。
 * 不触碰 chrome.storage,不调用仓储层 API。
 */
async function createRuleViaUI(page, pattern, intensity) {
  await clickTestId(page, 'add-rule');
  await waitTestId(page, 'pattern-input');
  await page.click('[data-testid="pattern-input"]', { clickCount: 3 });
  await page.type('[data-testid="pattern-input"]', pattern);
  // 滑块:用原生 setter + input 事件(React 受控组件的标准驱动方式)。
  await page.evaluate((v) => {
    const el = document.querySelector('[data-testid="intensity-slider"]');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, intensity);
  const shown = await textOf(page, 'intensity-value');
  await clickTestId(page, 'save-button');
  await waitTestId(page, 'rule-list');
  return { shown };
}

/** 磁盘上的 storage.local 文件路径(Chrome 的 LevelDB 目录)。 */
function storageDir(userDataDir, id) {
  return path.join(userDataDir, 'Default', 'Local Extension Settings', id);
}

/**
 * 从**扩展上下文**读取持久化 JSON。
 *
 * 为什么不直接解析 LevelDB:那需要额外依赖,且 Chrome 在运行时持有写锁。
 * 关键在于**何时**读 —— 浏览器重启后再读,读到的必然是落过盘的那份
 * (内存状态随上一个进程一起消失了)。这正是 ADR-010 持久化要验的东西。
 */
async function readPersisted(browser) {
  const w = await getWorker(browser);
  return w.evaluate(async () => {
    const got = await chrome.storage.local.get('filterSettings');
    return got.filterSettings ?? null;
  });
}

/**
 * 🔴 **绕过 UI 的写入通道**(INV-14 / ADR-055 点名要验的那条)。
 *
 * 打开 `ccf-repo-probe.html`(由 `build-probe.mjs` 从**产品自己的**
 * `src/storage/settings-repository.ts` 打包而来),在其中直接调用
 * `SettingsRepository` 的写入方法。
 *
 * ## 为什么是扩展页面,而不是 service worker
 *
 * HTML 规范**禁止** `ServiceWorkerGlobalScope` 上的动态 `import()`
 * (实测:`import() is disallowed on ServiceWorkerGlobalScope`),
 * MV3 的 SW 又是 classic script、不能 `importScripts` 一个 ESM。
 *
 * 换成扩展页面**不削弱**本门禁:ADR-055 要验的是「绕过 UI 的写入同样被拒」,
 * 而这个页面与 popup 同 origin、同 `chrome.storage.local`、调用的是
 * 产品那一份仓储层,**且完全不经过任何 popup UI 组件** ——
 * 没有 React、没有 RuleListView、没有 useLockState,
 * 「UI 置灰」在这里物理上不存在。这正是 ADR-055 原文点名的
 * 「从控制台发起的写入」的等价物。
 */
async function openProbe(browser, id) {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/ccf-repo-probe.html`,
    { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__ccfProbeReady === true, { timeout: 30000 });
  return page;
}

/** 在探针页里执行一次仓储层操作。 */
async function probeOp(probePage, op, arg) {
  return probePage.evaluate((op, arg) => window.__ccfProbe(op, arg), op, arg);
}

/** 读某个 tab 的根元素 computed filter —— 「实际渲染」的判据。 */
async function computedFilter(page) {
  return page.evaluate(() => getComputedStyle(document.documentElement).filter);
}

function writeJson(name, data) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2));
}

/** 断言收集器 —— 每条都带 detail,便于报告逐条引用。 */
function makeAsserter(results) {
  return function assert(name, ok, detail) {
    results.assertions.push({ name, ok, detail });
    if (!ok) results.pass = false;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
  };
}

module.exports = {
  launch, getWorker, EXT, CHROME, OUT,
  extensionId, openPopup, waitTestId, clickTestId, textOf,
  createRuleViaUI, storageDir, readPersisted, computedFilter, closePopup,
  openProbe, probeOp,
  writeJson, makeAsserter,
};
