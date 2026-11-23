// ═══════════════════════════════════════════════════════════════════════════
// T7 端到端验收 —— 共用工具
// ═══════════════════════════════════════════════════════════════════════════
//
// 🔴 **启动一律复用 `docs/T4a-gate/lib.cjs` 的 `launch()`**(ADR-067:不访问
//    操作系统密钥链)。本文件只补 T7 特有的「驱动真实 popup UI」能力 ——
//    那是 T7 的【新增】门禁与上游门禁的本质差别:
//
//    上游(T3/T6a/T6b)验的是「仓储层 API / 组件在 jsdom 里行为正确」,
//    T7 验的是「**用户在真实 popup 里点出来的规则**,真的落到了真实网页的
//    渲染结果上」—— 整条 UI → storage → 声明式注册 → 页面渲染的链路。
//
// popup 的驱动手法(`openPopup`)**逐字沿用 `docs/T6b-gate/editview.cjs`**,
// 连同它记录的两个坑:popup 不得抢走 `active` 身份,窗口焦点在自动化里不可控。
// 详尽论证见那个文件的长注释,此处不重复抄录,只保留结论性的 `active: false`。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, getWorker, seed, rule, settings } = require('../T4a-gate/lib.cjs');

/** 结果收集器 —— 所有 T7 脚本统一用它,证据落 evidence/<name>.json。 */
function makeResults(gateName) {
  const results = { gate: gateName, assertions: [], cases: [], pass: true };
  results.assert = (name, ok, detail) => {
    results.assertions.push({ name, ok: !!ok, detail });
    if (!ok) results.pass = false;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${name}${
        detail !== undefined ? `  ${JSON.stringify(detail)}` : ''
      }`,
    );
    return !!ok;
  };
  results.finish = (outDir) => {
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${gateName}.json`);
    const { assert: _a, finish: _f, ...plain } = results;
    fs.writeFileSync(file, JSON.stringify(plain, null, 2));
    const n = results.assertions.length;
    const ok = results.assertions.filter((a) => a.ok).length;
    console.log(`\n${gateName.toUpperCase()}: ${results.pass ? 'PASS' : 'FAIL'} (${ok}/${n})`);
    console.log(`证据:${file}`);
    return results.pass;
  };
  return results;
}

function tmpProfile(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ccf-t7-${tag}-`));
}

/** 读某页 <html> 上实际生效的 filter —— 像素层之前的最后一道真相。 */
async function filterOf(page) {
  try {
    return await page.evaluate(() => getComputedStyle(document.documentElement).filter);
  } catch (e) {
    return `ERR:${e.message}`;
  }
}

async function waitFilter(page, pred, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await filterOf(page);
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  return last;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** popup 页的 URL。扩展 id 由 service worker 自报(不写死)。 */
async function popupUrl(browser) {
  const worker = await getWorker(browser);
  const id = await worker.evaluate(() => chrome.runtime.id);
  return `chrome-extension://${id}/popup.html`;
}

/** 目标页的 `{ id, windowId }`。 */
async function siteTabOf(browser, urlPart) {
  const worker = await getWorker(browser);
  return worker.evaluate(async (part) => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find((x) => x.url && x.url.includes(part));
    return t ? { id: t.id, windowId: t.windowId } : null;
  }, urlPart);
}

/**
 * 打开 popup 页,并保证 `GET_TAB_STATE` 解析到的「当前 tab」是**目标页**。
 * 手法与坑的论证见 `docs/T6b-gate/editview.cjs` 的 `openPopup` 长注释。
 * `siteTab` 传 `null` 时不做 active 归属调整(不需要 tabState 的场景)。
 */
async function openPopup(browser, url, siteTab) {
  const worker = await getWorker(browser);
  await worker.evaluate(
    async (u, win) => {
      await chrome.tabs.create(win === null ? { url: u } : { url: u, windowId: win, active: false });
    },
    url,
    siteTab ? siteTab.windowId : null,
  );

  let page = null;
  for (let i = 0; i < 100 && page === null; i++) {
    const pages = await browser.pages();
    page = pages.find((p) => p.url().startsWith(url)) ?? null;
    if (page === null) await sleep(100);
  }
  if (page === null) throw new Error('popup 页未出现');
  await page.waitForSelector('[data-testid="popup"]', { timeout: 15000 });

  if (siteTab) {
    await worker.evaluate(async (id) => {
      await chrome.tabs.update(id, { active: true });
    }, siteTab.id);
    await sleep(300);
    // popup 只在挂载时问一次 GET_TAB_STATE,故在正确的 active 状态下重问一次。
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('[data-testid="popup"]', { timeout: 15000 });
  }
  return page;
}

/** 等 popup 的骨架态结束(收到 GET_TAB_STATE 响应)。 */
async function waitNotSkeleton(popup, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await popup.evaluate(() => {
      const el = document.querySelector('[data-testid="popup"]');
      return el ? el.dataset.skeleton : 'missing';
    });
    if (state === 'false') return true;
    await sleep(100);
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
      checked: el.checked === true,
      dataset: { ...el.dataset },
    };
  }, testid);
}

/**
 * 点击 popup 里某个 testid 元素。
 * 用 `el.click()` 而非 `page.click()` —— Chrome 不向不可见 tab 投递合成输入,
 * 论证见 `docs/T6b-gate/editview.cjs` 的 `clickTestid`。
 */
async function clickTestid(popup, testid, waitMs = 250) {
  await popup.waitForSelector(`[data-testid="${testid}"]`, { timeout: 12000 });
  await popup.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el === null) throw new Error(`找不到 ${id}`);
    el.click();
  }, testid);
  await sleep(waitMs);
}

/** 元素是否存在。 */
async function exists(popup, testid) {
  return popup.evaluate(
    (id) => document.querySelector(`[data-testid="${id}"]`) !== null,
    testid,
  );
}

/** 设置 React 受控 input 的值(需派发原生事件,否则 React 不更新)。 */
async function setControlledValue(popup, testid, value, tag = 'input') {
  await popup.waitForSelector(`[data-testid="${testid}"]`, { timeout: 12000 });
  await popup.evaluate(
    (id, v, t) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      const proto =
        t === 'select' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    testid,
    value,
    tag,
  );
  await sleep(150);
}

/**
 * 🔴 **完全通过真实 popup UI 新建一条规则** —— T7【新增】门禁的核心动作。
 *
 * 不碰 `chrome.storage`、不碰仓储层 API:填输入框、选模式单选、拖滑块、点保存,
 * 全部是用户的真实操作路径。这正是 §6 T7 INV-6 要求的「UI 建的规则 → 实际渲染」
 * 整条链路 —— 上游只在单元层验过 `resolveRule`。
 */
async function createRuleViaUI(popup, { pattern, mode, intensity }) {
  await clickTestid(popup, 'add-rule');
  await setControlledValue(popup, 'pattern-input', pattern);
  if (mode) await clickTestid(popup, `filter-radio-${mode}`);
  if (intensity !== undefined) {
    await setControlledValue(popup, 'intensity-slider', intensity);
  }
  const save = await probe(popup, 'save-button');
  if (save === null) throw new Error('保存按钮不存在');
  if (save.disabled) {
    const status = await probe(popup, 'status-line');
    throw new Error(
      `保存按钮被禁用,无法通过 UI 建规则:${JSON.stringify(status && status.dataset)}`,
    );
  }
  await clickTestid(popup, 'save-button', 500);
}

/**
 * 🔴 **在扩展页面上下文里拿到「真实仓储层」的句柄** —— INV-14 的验收通道。
 *
 * §6 T3 原文要求验证锁定强制时「**必须绕过 UI 直接调用仓储层 API**」。
 * 产品代码刻意没有把 `SettingsRepository` 实例挂到任何全局(那是对的,
 * §8 第 3 条不允许为测试在产品里开后门),故门禁自己编译一份**同源**的
 * 仓储层:`docs/T7-gate/build-probe.mjs` 把 `src/storage/index.ts` 的真实
 * 源码打成 `.output/chrome-mv3/t7-probe.js`。
 *
 * 它在扩展页面里 `new SettingsRepository()`,默认 StorageArea 就是真实的
 * `chrome.storage.local`(ADR-010)。因此锁定判定、`effectiveNow` 的单调
 * 下界、`canSetLockUntil` 的单向性、ADR-057 的原子写入**全部是产品代码
 * 在真实浏览器里真实执行**。唯一与产品路径的差别是实例由门禁构造,
 * 而那正是本条不变式要求的「绕过 UI 的写入路径」。
 *
 * 返回一个 `run(fn)`:在页面上下文里以 `repo` 为参数执行 fn。
 */
async function probeUrlOf(browser) {
  const worker = await getWorker(browser);
  const id = await worker.evaluate(() => chrome.runtime.id);
  return `chrome-extension://${id}/t7-probe.js`;
}

async function repoProbe(browser, page) {
  const worker = await getWorker(browser);
  const id = await worker.evaluate(() => chrome.runtime.id);
  const ready = await page.evaluate(async (extId) => {
    try {
      const m = await import(`chrome-extension://${extId}/t7-probe.js`);
      globalThis.__ccfT7Ctor = m.SettingsRepository;
      return true;
    } catch (e) {
      return `ERR:${e.message}`;
    }
  }, id);
  if (ready !== true) {
    throw new Error(
      `无法加载仓储层探针(先跑 node docs/T7-gate/build-probe.mjs):${String(ready)}`,
    );
  }
  return { loaded: true };
}

/**
 * 🔴 **在扩展页面上下文里以真实仓储层执行一段逻辑** —— INV-14 的调用入口。
 *
 * ```js
 * await repoProbe(browser, page);        // 一次性:把构造器挂到页面全局
 * const r = await withRepo(page, async (repo, arg) => {
 *   const res = await repo.addRule(arg.rule);
 *   return { ok: res.ok, kind: res.ok ? null : res.error.kind };
 * }, { rule: { pattern: 'x.com', mode: 'Grayscale', intensity: 100 } });
 * ```
 *
 * 实现要点(两条都是实测踩出来的):
 *
 * 1. **不能在页面里 `eval` / `new Function`。** MV3 的默认 CSP 是
 *    `script-src 'self'`,实测抛
 *    `EvalError: Refused to evaluate a string as JavaScript`。
 *    下面那个 `new Function` 跑在 **Node 侧**(组装被求值的函数源码),
 *    不在页面里 —— 故不受扩展 CSP 约束。真正进入页面的是 puppeteer 经 CDP
 *    的 `Runtime.callFunctionOn`,它在页面**之外**编译,同样不过页面 CSP。
 * 1b. **函数不能当 `page.evaluate` 的参数传。** 参数要走结构化序列化,
 *    函数会变成 `undefined`(实测:页面里报 `userFn is not a function`)。
 *    故调用方的函数被**内联进**被求值函数的源码里。
 * 2. `fn` 在页面上下文执行,闭包里**没有** Node 作用域 ——
 *    一切外部数据经 `arg` 传入(puppeteer 负责序列化)。
 *
 * `repo` 是 `new SettingsRepository()`:产品源码的真实实例,默认 StorageArea
 * 即真实 `chrome.storage.local`(ADR-010)。锁定强制、`effectiveNow` 的单调
 * 下界、`canSetLockUntil` 的单向性全是产品实现在真实浏览器里真实执行。
 *
 * `opts.clockAt` 给定时注入固定时钟(`SettingsRepositoryOptions.clock`,
 * ADR-059 为此而设)—— INV-15 的「系统时钟倒退」用它精确复现。
 */
async function withRepo(page, fn, arg, opts) {
  // 🔴 puppeteer **不能**把函数当参数传进页面(函数不可序列化,
  //    实测页面里收到的是 `undefined` → `userFn is not a function`)。
  //    唯一的办法是把调用方的函数本身**当作被求值的那个函数**,
  //    repo 则由它从页面全局自己构造 —— 故这里包一层:
  //    外层由 CDP 注入(绕过 CSP),内层逻辑在它体内直接出现。
  return page.evaluate(
    new Function(
      'a',
      'o',
      `return (async () => {
         const Ctor = globalThis.__ccfT7Ctor;
         if (typeof Ctor !== 'function') throw new Error('探针未加载(先调 repoProbe)');
         const repo = (o && typeof o.clockAt === 'number')
           ? new Ctor({ clock: () => o.clockAt })
           : new Ctor();
         return await (${fn.toString()})(repo, a);
       })();`,
    ),
    arg ?? null,
    opts ?? null,
  );
}

/** 从 service worker 读当前持久化的 settings(断言用,不用于驱动)。 */
async function readSettings(browser) {
  const w = await getWorker(browser);
  return w.evaluate(async () => {
    const got = await chrome.storage.local.get('filterSettings');
    return got.filterSettings ?? null;
  });
}

module.exports = {
  launch,
  getWorker,
  seed,
  rule,
  settings,
  makeResults,
  tmpProfile,
  filterOf,
  waitFilter,
  sleep,
  popupUrl,
  siteTabOf,
  openPopup,
  waitNotSkeleton,
  probe,
  clickTestid,
  exists,
  setControlledValue,
  createRuleViaUI,
  readSettings,
  repoProbe,
  probeUrlOf,
  withRepo,
};
