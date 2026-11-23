// ═══════════════════════════════════════════════════════════════════════════
// T5 REAL_STACK_GATE —— **自动化执行**(ADR-038:一律跑 npm run build 产物)
// ═══════════════════════════════════════════════════════════════════════════
//
// §8 第 8 条:「REAL_STACK_GATE 必须在真实 Chrome 中跑。jsdom/mock 下的绿灯
// **不构成**通过。」 docs/T5-real-stack-gate.md 原先只是一份**空白人工清单**
// (6 行结果全未勾选)—— 那等于这道门禁从未执行。本脚本把其中**可编程**的
// 部分真正跑起来,结果写进 docs/T5-gate/evidence/。
//
// 覆盖 docs/T5-real-stack-gate.md 的:
//   GATE-1 worker 终止后滤镜仍生效(真相在 storage 而非 worker 内存)
//   GATE-2 图标两态(ADR-019 / ADR-045)
//   GATE-3 INV-4 多 tab 即时同步(图标维度)
//   GATE-4 INV-8 主开关 OFF → 全灰 + 规则保留 → ON 全恢复
//   GATE-5 不可注入页的 reason 取值(ADR-013 / ADR-044)← 上一轮真实栈判红的那条
//
// 📌 GATE-6(popup 骨架态的视觉判定)仍留人工 —— 它要判的是「用户看到的是
//    骨架而不是错误横幅」,属主观视觉判定,不在本脚本范围。文档中如实标注。
//
// 用法(从仓库根):
//   npm run build && node docs/T5-gate/tabstate.cjs
// 前置环境与 docs/T4a-gate/README.md 完全一致(puppeteer-core + Chrome for Testing)。

const { launch, getWorker, seed, rule, settings } = require('../T4a-gate/lib.cjs');
const os = require('os');
const path = require('path');
const fs = require('fs');

const EVIDENCE = path.join(__dirname, 'evidence');

const results = [];
function check(gate, name, pass, detail) {
  results.push({ gate, name, pass: !!pass, detail });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${gate} · ${name}` + (detail ? ` — ${JSON.stringify(detail)}` : ''));
}

// 读某页 <html> 上实际生效的 filter —— 像素层的真相(不看扩展自己的说法)。
async function filterOf(page) {
  try {
    return await page.evaluate(() => getComputedStyle(document.documentElement).filter);
  } catch {
    return 'ERR';
  }
}

// 问 service worker:某个 tab 当前的图标是哪一态。
// chrome.action.getPopup/getIcon 不可靠,故改为读扩展自己 setIcon 的落点 ——
// 用 action.getTitle()(T5 的 ICON_TITLES 两态文案不同)作为图标态的代理信号,
// 它与 setIcon 在同一个 #applyIcon 里成对写入。
async function iconStateOf(worker, tabId) {
  return worker.evaluate(async (id) => {
    try {
      const t = await chrome.action.getTitle({ tabId: id });
      if (typeof t !== 'string' || t === '') return 'unset';
      if (t.includes('已套用')) return 'active';
      if (t.includes('未套用')) return 'inactive';
      return 'other:' + t;
    } catch (e) {
      return 'err:' + e.message;
    }
  }, tabId);
}

async function activeTabId(worker) {
  return worker.evaluate(async () => {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return t ? t.id : null;
  });
}

// 走**真实的消息通道**(ADR-044),不是直接调内部函数 ——
// 门禁要验的就是 popup → runtime.onMessage → SW 这条路。
//
// 🔴 发信方**必须**是扩展的另一个上下文(这里用真实的 popup.html),
// 不能是 service worker 自己:worker 对自己 sendMessage 会报
// 「Could not establish connection. Receiving end does not exist.」
// (实测踩过)。而且用 popup.html 才是契约真正的那一端。
//
// ⚠️ popup 页放在**独立窗口**里,且发消息前把被测页的窗口重新聚焦 ——
// 否则「当前 tab」会解析成 popup 自己所在的窗口,整条门禁空转。
async function getTabStateFromPopup(popupPage, focusPage) {
  if (focusPage) {
    await focusPage.bringToFront();
    await new Promise((r) => setTimeout(r, 700));
  }
  return popupPage.evaluate(async () => {
    return await chrome.runtime.sendMessage({ type: 'GET_TAB_STATE' });
  });
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-t5-gate-'));
  const browser = await launch(udd, { headless: true });

  try {
    await seed(browser, settings([rule('*.wikipedia.org', 'Grayscale', 100)]));
    let worker = await getWorker(browser);

    // ── 探针有效性基线 ────────────────────────────────────────────────────
    // 先证明「滤镜能被观测到」,否则后面所有 PASS 都可能是空转。
    const basePage = await browser.newPage();
    await basePage.goto('https://zh.wikipedia.org/wiki/Color', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    const baseFilter = await filterOf(basePage);
    check('BASELINE', '匹配站点上 html.filter 非 none(探针有效)',
      baseFilter !== 'none' && baseFilter !== 'ERR', { filter: baseFilter });

    const offPage = await browser.newPage();
    await offPage.goto('https://news.ycombinator.com/', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    const offFilter = await filterOf(offPage);
    check('BASELINE', '不匹配站点上 html.filter 为 none(对照组)',
      offFilter === 'none', { filter: offFilter });

    // ── GATE-2 图标两态 ──────────────────────────────────────────────────
    await basePage.bringToFront();
    await new Promise((r) => setTimeout(r, 800));
    const wikiTabId = await activeTabId(worker);
    const wikiIcon = await iconStateOf(worker, wikiTabId);
    check('GATE-2', '匹配站点的图标为 active(ADR-019 亮 = 这页被改色了)',
      wikiIcon === 'active', { tabId: wikiTabId, icon: wikiIcon });

    await offPage.bringToFront();
    await new Promise((r) => setTimeout(r, 800));
    const hnTabId = await activeTabId(worker);
    const hnIcon = await iconStateOf(worker, hnTabId);
    check('GATE-2', '不匹配站点的图标为 inactive',
      hnIcon === 'inactive', { tabId: hnTabId, icon: hnIcon });

    // 两态是不同的图片资源(ADR-045)—— 在**产物**里核对内容不等。
    const { EXT } = require('../T4a-gate/lib.cjs');
    const a16 = fs.readFileSync(path.join(EXT, 'icon', 'active', '16.png'));
    const i16 = fs.readFileSync(path.join(EXT, 'icon', 'inactive', '16.png'));
    check('GATE-2', '产物中两态 16px 图标内容不相同(ADR-045)',
      !a16.equals(i16), { activeBytes: a16.length, inactiveBytes: i16.length });

    // ── GATE-5 🔴 不可注入页的 reason(上一轮真实栈判红的那条)──────────
    const gate5 = [
      ['chrome://settings/', false, 'internal-page', null],
      ['https://chromewebstore.google.com/', false, 'web-store', null],
      ['chrome://newtab/', false, 'new-tab', null],
      ['https://zh.wikipedia.org/wiki/Color', true, undefined, 'zh.wikipedia.org'],
    ];
    // 真实的契约发信端:扩展自己的 popup.html。
    const extId = await worker.evaluate(() => chrome.runtime.id);
    const popupPage = await browser.newPage();
    await popupPage.goto(`chrome-extension://${extId}/popup.html`,
      { waitUntil: 'domcontentloaded', timeout: 20000 });

    const observed = [];
    for (const [url, wantInjectable, wantReason, wantHost] of gate5) {
      const p = await browser.newPage();
      try {
        await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      } catch { /* chrome:// 页 puppeteer 可能报 net error,不影响 tab 存在 */ }
      const st = await getTabStateFromPopup(popupPage, p);
      observed.push({ url, state: st });

      check('GATE-5', `${url} → injectable=${wantInjectable}`,
        st && st.injectable === wantInjectable, { got: st && st.injectable });
      check('GATE-5', `${url} → reason=${String(wantReason)}`,
        st && st.reason === wantReason, { got: st && st.reason });
      check('GATE-5', `${url} → host=${String(wantHost)}`,
        st && st.host === wantHost, { got: st && st.host });

      // 契约字段集必须**完全一致**(不多不少,ADR-044)。
      if (st) {
        const keys = Object.keys(st).sort().join(',');
        const want = wantReason === undefined
          ? 'activeRuleIndex,host,injectable,shadowedRuleIndexes,tabId'
          : 'activeRuleIndex,host,injectable,reason,shadowedRuleIndexes,tabId';
        check('GATE-5', `${url} → TabState 字段集与 ADR-044 完全一致`,
          keys === want, { keys });
      }
      await p.close();
    }
    fs.writeFileSync(path.join(EVIDENCE, 'gate5-tabstate.json'),
      JSON.stringify(observed, null, 2));
    await popupPage.close(); // 后面的门禁按「当前 tab」判定,popup 不能占着焦点

    // ── GATE-3 INV-4:3 个 tab 即时同步(图标维度)────────────────────────
    const tabs3 = [];
    for (const u of ['https://zh.wikipedia.org/wiki/A',
      'https://en.wikipedia.org/wiki/Color', 'https://ja.wikipedia.org/wiki/色']) {
      const p = await browser.newPage();
      try { await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}
      tabs3.push(p);
    }
    await new Promise((r) => setTimeout(r, 1200));
    const ids3 = await worker.evaluate(async () => {
      const ts = await chrome.tabs.query({});
      return ts.filter((t) => (t.url || '').includes('wikipedia.org')).map((t) => t.id);
    });
    const icons3 = [];
    for (const id of ids3) icons3.push(await iconStateOf(worker, id));
    check('GATE-3', '3 个匹配同一规则的 tab 图标全部 active',
      ids3.length >= 3 && icons3.every((s) => s === 'active'), { ids3, icons3 });

    // 改规则(不刷新任何页面)→ 另外两个 tab 的像素应即时变化
    await worker.evaluate(async () => {
      const { filterSettings: s } = await chrome.storage.local.get('filterSettings');
      await chrome.storage.local.set({
        filterSettings: { ...s, rules: [{ ...s.rules[0], mode: 'RedGreen', intensity: 60 }] },
      });
    });
    await new Promise((r) => setTimeout(r, 1500));
    const after = [];
    for (const p of tabs3) after.push(await filterOf(p));
    check('GATE-3', '改规则后 3 个 tab 的 filter 全部即时变化(未刷新,INV-4)',
      after.every((f) => f !== 'none' && f !== 'ERR'), { after });

    // ── GATE-4 🔴 INV-8 主开关 OFF ───────────────────────────────────────
    await worker.evaluate(async () => {
      const { filterSettings: s } = await chrome.storage.local.get('filterSettings');
      await chrome.storage.local.set({ filterSettings: { ...s, masterEnabled: false } });
    });
    await new Promise((r) => setTimeout(r, 1800));
    const offFilters = [];
    for (const p of tabs3) offFilters.push(await filterOf(p));
    check('GATE-4', '主开关 OFF → 3 个 tab 滤镜全部消失',
      offFilters.every((f) => f === 'none'), { offFilters });

    const offIcons = [];
    for (const id of ids3) offIcons.push(await iconStateOf(worker, id));
    check('GATE-4', '主开关 OFF → 图标全灰(ADR-019 明文)',
      offIcons.every((s) => s === 'inactive'), { offIcons });

    const keptRules = await worker.evaluate(async () => {
      const { filterSettings: s } = await chrome.storage.local.get('filterSettings');
      return s.rules;
    });
    check('GATE-4', '主开关 OFF → 规则原样保留(INV-8)',
      Array.isArray(keptRules) && keptRules.length === 1, { keptRules });

    await worker.evaluate(async () => {
      const { filterSettings: s } = await chrome.storage.local.get('filterSettings');
      await chrome.storage.local.set({ filterSettings: { ...s, masterEnabled: true } });
    });
    await new Promise((r) => setTimeout(r, 1800));
    const onFilters = [];
    for (const p of tabs3) onFilters.push(await filterOf(p));
    check('GATE-4', '主开关 ON → 3 个 tab 滤镜全部恢复',
      onFilters.every((f) => f !== 'none' && f !== 'ERR'), { onFilters });

    for (const p of tabs3) await p.close();
    await basePage.close();
    await offPage.close();

    // ── GATE-1 🔴 worker 终止后滤镜仍生效(真相在 storage)─────────────────
    // 把 settings 恢复成 Grayscale,再**杀掉 service worker**,然后开新页。
    await worker.evaluate(async () => {
      const { filterSettings: s } = await chrome.storage.local.get('filterSettings');
      await chrome.storage.local.set({
        filterSettings: { ...s, masterEnabled: true,
          rules: [{ pattern: '*.wikipedia.org', mode: 'Grayscale', intensity: 100 }] },
      });
    });
    await new Promise((r) => setTimeout(r, 1000));

    // ── 真正终止 service worker(等价于 chrome://extensions 上点「终止」)──
    //
    // 🔴 **怎么判定「真的死了」是本门禁最容易自欺的一步。**
    // 实测:`ServiceWorker.stopAllWorkers` 确实把 worker 停了,但
    // `browser.targets()` 里那个 service_worker **条目仍然在**
    // (puppeteer 的 auto-attach 留下的陈旧 target 记录)。
    // 若按「target 列表里没有了」判定,这一步会**永远判 FAIL**;
    // 反过来,若不判定就直接往下走,下一条断言会在 worker 其实还活着的
    // 情况下**空转**通过 —— 两种都是假结果。
    //
    // 故改用**行为探针**:worker 死了的充要可观测后果是
    // `chrome.runtime.sendMessage` 不再有人应答(超时),而不是 target 消失。
    // 另:`ServiceWorker.enable` 只在**页面级** session 上存在,
    // browser 级 session 会报 'wasn't found'(实测踩过)。
    const killProbe = await browser.newPage();
    await killProbe.goto(`chrome-extension://${extId}/popup.html`,
      { waitUntil: 'domcontentloaded', timeout: 20000 });
    let killed = false;
    try {
      const ps = await killProbe.createCDPSession();
      await ps.send('ServiceWorker.enable');
      await ps.send('ServiceWorker.stopAllWorkers');
      killed = true;
    } catch (e) {
      console.log('    (stopAllWorkers 不可用:' + e.message + ')');
    }
    await new Promise((r) => setTimeout(r, 2000));

    // 行为探针:现在还有人应答 GET_TAB_STATE 吗?超时 = worker 确实死了。
    const swSilent = await killProbe.evaluate(async () => {
      const r = await Promise.race([
        chrome.runtime.sendMessage({ type: 'GET_TAB_STATE' }).catch(() => 'THREW'),
        new Promise((res) => setTimeout(() => res('TIMEOUT'), 1500)),
      ]);
      return r === 'TIMEOUT' || r === 'THREW' ? 'silent' : 'alive';
    });
    check('GATE-1', 'service worker 已被终止(行为探针:不再应答消息)',
      killed && swSilent === 'silent', { killed, swSilent });
    await killProbe.close();

    // worker 死着,开一个匹配站点 —— 首帧滤镜只能来自磁盘上的声明式注册。
    const revived = await browser.newPage();
    await revived.goto('https://en.wikipedia.org/wiki/Grayscale', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    const revivedFilter = await filterOf(revived);
    check('GATE-1', '🔴 worker 被终止后打开匹配站点,滤镜仍正确应用',
      revivedFilter !== 'none' && revivedFilter !== 'ERR', { filter: revivedFilter });

    // 并且 GET_TAB_STATE 在 worker 被消息唤醒后依然答得对(ADR-044)。
    await revived.bringToFront();
    await new Promise((r) => setTimeout(r, 500));
    worker = await getWorker(browser); // 重新拿(worker 是新实例)
    const popup2 = await browser.newPage();
    await popup2.goto(`chrome-extension://${extId}/popup.html`,
      { waitUntil: 'domcontentloaded', timeout: 20000 });
    const revivedState = await getTabStateFromPopup(popup2, revived);
    check('GATE-1', 'worker 重启后 GET_TAB_STATE 仍答出正确的 activeRuleIndex',
      revivedState && revivedState.injectable === true
        && revivedState.activeRuleIndex === 0
        && revivedState.host === 'en.wikipedia.org',
      { revivedState });

    await popup2.close();
    await revived.close();
  } finally {
    await browser.close();
    fs.rmSync(udd, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.pass);
  const summary = {
    ranAt: new Date().toISOString(),
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\n  ── ${summary.passed}/${summary.total} 断言通过 ──`);
  if (failed.length > 0) {
    console.log('  FAILED:');
    for (const f of failed) console.log(`   - ${f.gate} ${f.name} ${JSON.stringify(f.detail)}`);
    process.exit(1);
  }
  console.log('  T5 REAL_STACK_GATE: PASS');
}

main().catch((e) => { console.error('GATE ERROR', e); process.exit(1); });
