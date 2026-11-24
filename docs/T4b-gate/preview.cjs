// T4b REAL_STACK_GATE —— 实时预览接收端(ADR-049)在**真实 Chrome** 中的验收。
//
// 🔴 为什么这一项必须上真实栈,而不满足于单测:
//
// 单测(`src/injection/__tests__/preview.test.ts`)喂的是**假端口**,
// 它证明了「收到消息后状态机正确」,但证明不了**路由本身成立** ——
// 而 DESIGN.md §6 T4b 把路由写死了且「不得自行选择」:
//
//   > popup **直连 content script**:
//   > `chrome.tabs.connect(tabState.tabId, { name: 'preview' })`
//   > **不经 service worker 中转**
//
// 「`chrome.tabs.connect` 发起的连接会在目标 tab 的 content script 里
// 表现为一次 `chrome.runtime.onConnect`」这个论断是**平台行为**,
// 只能实测。它若不成立,接收端接的是个永远不响的铃 ——
// 单测照样全绿,而 T6b 到了真实栈才会发现拖滑块没反应。
//
// 本脚本从**service worker 上下文**调 `chrome.tabs.connect`(那里有 tabs 权限),
// 以此模拟 popup 侧的发送端。这不是「改走 SW 中转」—— SW 在这里只是
// 一个**有 tabs 权限的测试夹具**,代替尚未实现的 popup(T6b);
// 消息本身仍是 tab 端口直连,不经任何 SW 侧的转发逻辑。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, getWorker, seed, rule, settings } = require('../T4a-gate/lib.cjs');

const OUT = path.join(__dirname, 'evidence');

const PROBE = `(() => {
  const el = document.documentElement;
  return {
    filter: getComputedStyle(el).filter,
    // 🔴 ADR-069:class 门控 + 同文档 SVG 定义。属性时代的 attrOn/attrOff
    //    在 ADR-069 之后恒为 false —— 留着会让探针空转地通过。
    classOn: el.classList.contains('ccf-on'),
    svgDefs: !!document.getElementById('ccf-svg-defs'),
  };
})()`;

// 在 SW 上下文里建立到指定 tab 的预览端口,并把 port 挂到 globalThis
// 以便后续多次 postMessage / disconnect。
const OPEN_PORT = (tabId) => `
  globalThis.__ccfPort = chrome.tabs.connect(${tabId}, { name: 'preview' });
  globalThis.__ccfPortDisconnected = false;
  globalThis.__ccfPort.onDisconnect.addListener(() => {
    globalThis.__ccfPortDisconnected = true;
  });
  'ok';
`;

// 同上,但带名字 —— 多端口场景需要**同时**持有两个端口。
// (`chrome.tabs.connect` 每次调用都新建一个端口,两个端口会在同一个
//  content script 里表现为两次 `chrome.runtime.onConnect`;这正是
//  「两个窗口的 popup 连同一个 tab」在平台层面的形态。)
const OPEN_NAMED_PORT = (tabId, slot) => `
  globalThis.__ccfPorts = globalThis.__ccfPorts || {};
  globalThis.__ccfPorts['${slot}'] = chrome.tabs.connect(${tabId}, { name: 'preview' });
  'ok';
`;

async function waitFilter(page, pred, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(PROBE);
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, 80));
  }
  return last;
}

async function main() {
  const results = { assertions: [], cases: [], pass: true };
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-t4b-prev-'));
  const browser = await launch(userDataDir, { headless: true });

  function assert(name, ok, detail) {
    results.assertions.push({ name, ok, detail });
    if (!ok) results.pass = false;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${JSON.stringify(detail)}` : ''}`);
  }

  try {
    // 规则:wikipedia = Grayscale 100。预览将临时改成别的值。
    await seed(browser, settings([rule('*.wikipedia.org', 'Grayscale', 100)]));
    const worker = await getWorker(browser);

    const page = await browser.newPage();
    await page.goto('https://en.wikipedia.org/wiki/Color_blindness', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    const ruleState = await waitFilter(page, (p) => p.filter !== 'none');
    assert('规则态:grayscale(1)', ruleState.filter === 'grayscale(1)', ruleState);

    // 取该 page 的 tabId(SW 侧 chrome.tabs.query)。
    const tabId = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const t = tabs.find((x) => x.url && x.url.includes('wikipedia.org'));
      return t ? t.id : null;
    });
    assert('取到目标 tabId', typeof tabId === 'number', { tabId });

    // ── 条款:收到 PREVIEW_FILTER 后页面滤镜立即变化 ──
    await worker.evaluate(OPEN_PORT(tabId));
    await worker.evaluate(() => {
      globalThis.__ccfPort.postMessage({
        type: 'PREVIEW_FILTER',
        mode: 'Grayscale',
        intensity: 30,
      });
    });

    const previewed = await waitFilter(page, (p) => p.filter !== 'grayscale(1)');
    // grayscale(0.3) —— 与规则态 grayscale(1) 明确不同。
    assert(
      '🔴 PREVIEW_FILTER 经 chrome.tabs.connect 直连生效(ADR-049 路由成立)',
      previewed.filter === 'grayscale(0.3)',
      previewed,
    );
    results.cases.push({ case: 'PREVIEW_FILTER', filter: previewed.filter });

    // 连续拖动(每条都该渲染,不受防抖影响)。
    const dragValues = [80, 60, 40, 20, 5];
    const dragSeen = [];
    for (const v of dragValues) {
      await worker.evaluate((iv) => {
        globalThis.__ccfPort.postMessage({
          type: 'PREVIEW_FILTER',
          mode: 'Grayscale',
          intensity: iv,
        });
      }, v);
      const got = await waitFilter(page, (p) => p.filter === `grayscale(${v / 100})`, 2500);
      dragSeen.push({ intensity: v, filter: got.filter });
    }
    assert(
      '🔴 连续拖动每一步都渲染(不防抖,ADR-049)',
      dragSeen.every((d) => d.filter === `grayscale(${d.intensity / 100})`),
      dragSeen,
    );

    // ── 条款:预览期间 storage 无写入 ──
    //    直接读 chrome.storage.local,断言规则仍是 100(不是预览的 5)。
    const stored = await worker.evaluate(async () => {
      const got = await chrome.storage.local.get('filterSettings');
      return got.filterSettings;
    });
    assert(
      '🔴 预览值绝不落盘:storage 中规则仍为 intensity=100',
      stored && stored.rules && stored.rules[0].intensity === 100,
      { rules: stored && stored.rules },
    );

    // ── 条款:预览活动期间收到 onChanged,页面不重绘 ──
    //    把规则改成 70(经 storage.onChanged 到达 content script),
    //    页面应**仍显示预览值** grayscale(0.05)。
    const beforeChanged = await page.evaluate(PROBE);
    await seed(browser, settings([rule('*.wikipedia.org', 'Grayscale', 70)]));
    await new Promise((r) => setTimeout(r, 1200)); // 给 onChanged 足够时间到达
    const afterChanged = await page.evaluate(PROBE);
    assert(
      '🔴 预览活动期间 onChanged 到达,页面不重绘(ADR-049 优先级)',
      afterChanged.filter === beforeChanged.filter &&
        afterChanged.filter === 'grayscale(0.05)',
      { beforeChanged: beforeChanged.filter, afterChanged: afterChanged.filter },
    );

    // ── 条款:PREVIEW_CLEAR 后按**新**值(70)渲染,而不是预览前的 100 ──
    await worker.evaluate(() => {
      globalThis.__ccfPort.postMessage({ type: 'PREVIEW_CLEAR' });
    });
    const cleared = await waitFilter(page, (p) => p.filter !== 'grayscale(0.05)');
    assert(
      '🔴 PREVIEW_CLEAR 后按 onChanged 带来的新值 0.7 渲染',
      cleared.filter === 'grayscale(0.7)',
      cleared,
    );
    results.cases.push({ case: 'PREVIEW_CLEAR', filter: cleared.filter });

    // ── 条款:端口断开(popup 关闭)自动恢复,不残留 ──
    await worker.evaluate(() => {
      globalThis.__ccfPort.postMessage({
        type: 'PREVIEW_FILTER',
        mode: 'BlueYellow',
        intensity: 100,
      });
    });
    const beforeDisconnect = await waitFilter(
      page,
      (p) => p.filter !== 'grayscale(0.7)',
    );
    assert(
      '断开前确处于预览态(探针有效)',
      beforeDisconnect.filter !== 'grayscale(0.7)' &&
        beforeDisconnect.filter !== 'none',
      beforeDisconnect,
    );

    await worker.evaluate(() => {
      globalThis.__ccfPort.disconnect();
    });
    const afterDisconnect = await waitFilter(
      page,
      (p) => p.filter === 'grayscale(0.7)',
    );
    assert(
      '🔴 端口断开(popup 关闭)→ 自动恢复规则值,无预览残留',
      afterDisconnect.filter === 'grayscale(0.7)',
      afterDisconnect,
    );
    results.cases.push({ case: 'onDisconnect', filter: afterDisconnect.filter });

    // ── 条款:预览期间导航到新页面,新页面按规则渲染而非预览值 ──
    await worker.evaluate(OPEN_PORT(tabId));
    await worker.evaluate(() => {
      globalThis.__ccfPort.postMessage({
        type: 'PREVIEW_FILTER',
        mode: 'Grayscale',
        intensity: 10,
      });
    });
    const beforeNav = await waitFilter(page, (p) => p.filter === 'grayscale(0.1)');
    assert('导航前确处于预览态(探针有效)', beforeNav.filter === 'grayscale(0.1)', beforeNav);

    await page.goto('https://en.wikipedia.org/wiki/Trichromacy', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    const afterNav = await waitFilter(page, (p) => p.filter !== 'none', 8000);
    assert(
      '🔴 预览期间导航 → 新页面按**规则**值 0.7 渲染,不是预览值 0.1',
      afterNav.filter === 'grayscale(0.7)',
      afterNav,
    );
    // 导航也该让旧端口断开(tab 端口两者都会触发)。
    const portDead = await worker.evaluate(() => globalThis.__ccfPortDisconnected);
    assert('🔴 页面导航触发端口 onDisconnect(ADR-049 生命周期)', portDead === true, {
      portDead,
    });
    results.cases.push({ case: 'navigate-during-preview', filter: afterNav.filter, portDead });

    // ── 并发条款:两个活端口并存时,陈旧端口的收尸不得打断正在进行的预览 ──
    //
    // 🔴 为什么这一格必须上真实栈:它的前提是**平台行为** ——
    //    同一个 tab 上可以同时存在多个由 `chrome.tabs.connect` 建立的
    //    预览端口,且 `onDisconnect` 的送达时刻**不受应用控制**。
    //    假端口的单测能证明仲裁逻辑正确,却证明不了「两个端口真能并存」。
    //
    //    可达路径(非臆造):两个浏览器窗口各开一个 popup 连同一个 tab;
    //    或 popup 关闭与重开重叠(旧端口尚未收尸,新端口已在拖动)。
    //
    //    修复前的实测表现:A 的收尸把 B 正在编辑的预览擦掉,
    //    页面在用户拖动中途 snap 回规则值 grayscale(0.7)。
    //
    // 当前规则值为 Grayscale 70(上面那次 seed 改成的)。
    await worker.evaluate(OPEN_NAMED_PORT(tabId, 'a'));
    await worker.evaluate(OPEN_NAMED_PORT(tabId, 'b'));

    // 窗口 A 的 popup 拖到 10。
    await worker.evaluate(() => {
      globalThis.__ccfPorts.a.postMessage({
        type: 'PREVIEW_FILTER',
        mode: 'Grayscale',
        intensity: 10,
      });
    });
    const multiA = await waitFilter(page, (p) => p.filter === 'grayscale(0.1)');
    assert('多端口:A 的预览生效(探针有效)', multiA.filter === 'grayscale(0.1)', multiA);

    // 窗口 B 的 popup 接手,正拖到 30 —— 用户此刻看着的就是这个。
    await worker.evaluate(() => {
      globalThis.__ccfPorts.b.postMessage({
        type: 'PREVIEW_FILTER',
        mode: 'Grayscale',
        intensity: 30,
      });
    });
    const multiB = await waitFilter(page, (p) => p.filter === 'grayscale(0.3)');
    assert('多端口:B 接手后页面为 B 的值', multiB.filter === 'grayscale(0.3)', multiB);

    // 🔴 旧端口 A 这才被收尸。
    await worker.evaluate(() => {
      globalThis.__ccfPorts.a.disconnect();
    });
    // 给足时间让(修复前会发生的)错误重绘有机会出现 —— 不能只测一瞬间,
    // 否则「什么都没发生」与「来不及发生」无法区分。
    await new Promise((r) => setTimeout(r, 1200));
    const afterStaleReap = await page.evaluate(PROBE);
    assert(
      '🔴 陈旧端口 A 的 onDisconnect 不得擦掉 B 正在编辑的预览(ADR-049)',
      afterStaleReap.filter === 'grayscale(0.3)',
      { expected: 'grayscale(0.3)', got: afterStaleReap.filter, ruleValue: 'grayscale(0.7)' },
    );
    results.cases.push({
      case: 'stale-port-reap-during-active-preview',
      filter: afterStaleReap.filter,
    });

    // 归属者 B 自己断开 → 「不得残留」照常成立(修复没把它削弱成「永不撤除」)。
    await worker.evaluate(() => {
      globalThis.__ccfPorts.b.disconnect();
    });
    const afterOwnerReap = await waitFilter(page, (p) => p.filter === 'grayscale(0.7)');
    assert(
      '🔴 归属端口 B 断开 → 恢复规则值 0.7,不残留预览态',
      afterOwnerReap.filter === 'grayscale(0.7)',
      afterOwnerReap,
    );
    results.cases.push({
      case: 'owner-port-reap-restores-rule',
      filter: afterOwnerReap.filter,
    });

    await page.close();
  } finally {
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'preview.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.pass ? 'PASS' : 'FAIL'} — preview`);
  process.exit(results.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
