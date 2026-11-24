// 🔴 T7【回归】INV-9 —— DESIGN.md §6 T7 gate 原文:
//
//   > **【回归】** INV-9:按 T4 的三项机械判定法(静态断言 a/b + Network 实测 c)
//   > 复验,不接受人工通读(ADR-026)
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 本脚本只承担 **(c) 真实 DevTools Network 录制**。(a)(b) 两条静态断言由
// `tests/t4b-static-gates.test.ts` 的 `describe.skipIf(!built)` 两组承担,
// 它们读的是 `.output/chrome-mv3/content-scripts/content.js`(真实产物)。
//
// ⚠️ 那两组是 `skipIf`,**跳过与通过在默认 reporter 下长得一样** ——
//    故 T7 必须用 `--reporter=verbose` 确认它们真的跑了(见 README)。
//
// ## 与 T4b 的 noninvasive.cjs 的区别:T7 加测**真实网站**
//
// T4b 的 (c) 跑在本地 fixture 上。本脚本改跑**三个真实网站**,并用
// CDP 的 `Network.requestWillBeSent` 收 `initiator` 字段 —— 这是
// puppeteer 的 `page.on('request')` 给不出的信息,也是判定「**谁**发起了
// 这条请求」的唯一机械依据。判据:
//   没有任何请求的 `initiator.stack` 里出现 `chrome-extension://<我们的id>` 的帧。
//
// ## 负向对照(关键)
//   N1 **注入一个真的外传**:在同一 profile、同一录制通道下,用
//      `page.evaluate` 从**页面上下文**发一条 fetch 到一个本地哨兵服务器,
//      再确认录制器**抓到了它**。若抓不到,那么「零条扩展请求」只是
//      因为录制器根本没工作 —— 这是本项目四次假绿里的第一类。
//   N2 更强的一条:用 `Runtime.evaluate` 在**扩展的 content script 世界**
//      (isolated world)里发一条 fetch,确认 initiator 判据能把它
//      **归因到扩展** —— 证明归因逻辑不是恒假。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./lib7.cjs');
const { seed, rule, settings } = require('../T4a-gate/lib.cjs');

const SITES = {
  hn: 'https://news.ycombinator.com/',
  wikipedia: 'https://en.wikipedia.org/wiki/CSS',
  github: 'https://github.com/',
};

/** 哨兵服务器 —— 记录任何打到它的请求。 */
function startSentinel() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, method: req.method });
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, hits, port: server.address().port }));
  });
}

/**
 * 开 CDP 录制,返回收集器。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **归因必须靠执行上下文,不能只靠 initiator 的 URL**(实测结论)。
 *
 * 第一版只看 `initiator.url` 与 `initiator.stack.callFrames[].url` 里有没有
 * 扩展 id。实测把 N2 判成了假:从扩展的 isolated world 里发出的 fetch,
 * CDP 给的 callFrame 是
 *     { functionName: "", scriptId: "8", url: "", lineNumber: 0 }
 * —— **`url` 是空串**。于是「含扩展 id」永假,`fromExtension` 恒 false,
 * 这条判据在任何情况下都通过 = 恒真的空转探针。
 *
 * 正解:同时开 `Debugger` / `Runtime`,维护
 *   scriptId → executionContextId → context.origin
 * 两张映射。扩展的 content script world 的 `origin` 就是
 * `chrome-extension://<id>`(实测:`{id:8, origin:'chrome-extension://…',
 * name:'Chrome Color Filters', auxData:{type:'isolated'}}`),
 * 于是无论脚本有没有 URL 都归因得到。URL 判据保留为第二条通道。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
async function record(page, extId) {
  const client = await page.target().createCDPSession();
  const events = [];
  /** executionContextId → origin */
  const ctxOrigin = new Map();
  /** scriptId → executionContextId */
  const scriptCtx = new Map();

  /** 仍然存活的执行上下文 id(reload 会销毁旧的)。 */
  const liveCtx = new Set();

  await client.send('Runtime.enable');
  client.on('Runtime.executionContextCreated', (e) => {
    ctxOrigin.set(e.context.id, e.context.origin || '');
    liveCtx.add(e.context.id);
  });
  // 🔴 必须跟踪销毁:reload 之后旧的 isolated world 已经不存在,
  //    对着它 `Runtime.evaluate` 会报
  //    "Cannot find context with specified id"(实测踩过),
  //    而那次失败在第一版里只被记进 evalError、断言却去看「有没有录到请求」,
  //    于是报出的是一条**误导性**的红(看起来像产品没发请求,
  //    其实是门禁自己挑错了上下文)。
  client.on('Runtime.executionContextDestroyed', (e) => {
    liveCtx.delete(e.executionContextId);
  });
  client.on('Runtime.executionContextsCleared', () => { liveCtx.clear(); });
  await client.send('Debugger.enable').catch(() => {});
  client.on('Debugger.scriptParsed', (e) => {
    scriptCtx.set(String(e.scriptId), e.executionContextId);
  });
  await client.send('Network.enable');

  client.on('Network.requestWillBeSent', (e) => {
    const frames = [];
    let st = e.initiator?.stack;
    while (st) { for (const f of (st.callFrames || [])) frames.push(f); st = st.parent; }

    // 通道 1(主):脚本所属的执行上下文的 origin 是扩展。
    const byContext = frames.some((f) => {
      const ctx = scriptCtx.get(String(f.scriptId));
      const origin = ctx === undefined ? '' : (ctxOrigin.get(ctx) || '');
      return origin.includes(extId);
    });
    // 通道 2(辅):initiator / callFrame 的 URL 里出现扩展 id。
    const byUrl = (e.initiator?.url ?? '').includes(extId)
      || frames.some((f) => (f.url || '').includes(extId));

    events.push({
      url: e.request.url,
      type: e.type,
      initiatorType: e.initiator?.type ?? null,
      initiatorUrl: e.initiator?.url ?? null,
      frameUrls: frames.map((f) => f.url),
      frameScriptIds: frames.map((f) => String(f.scriptId)),
      fromExtension: byContext || byUrl,
      attribution: { byContext, byUrl },
    });
  });
  return { client, events, ctxOrigin, scriptCtx, liveCtx };
}

(async () => {
  const results = { clause: 'T7【回归】INV-9 (c) 真实 Network 录制(ADR-026)', assertions: [], data: {}, pass: true };
  const assert = L.makeAsserter(results);

  const udd = path.join(L.OUT, 'udd-inv9');
  fs.rmSync(udd, { recursive: true, force: true });
  const browser = await L.launch(udd, { headless: true });
  const { server, hits, port } = await startSentinel();
  const sentinel = `http://127.0.0.1:${String(port)}/beacon`;

  try {
    const extId = await L.extensionId(browser);
    results.data.extensionId = extId;
    await seed(browser, settings([rule('*', 'Grayscale', 100)], true));
    await new Promise((r) => setTimeout(r, 1500));

    const per = {};
    for (const [key, url] of Object.entries(SITES)) {
      const page = await browser.newPage();
      const rec = await record(page, extId);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
      // 等滤镜落定,再静置 —— 给任何潜在外传时间发出。
      for (let i = 0; i < 60; i++) {
        if ((await L.computedFilter(page)) !== 'none') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const filter = await L.computedFilter(page);
      await new Promise((r) => setTimeout(r, 4000));

      const extReqs = rec.events.filter((e) => e.fromExtension);
      // 扩展自身资源(chrome-extension://<id>/...)不算外传;真正违反 ADR-026 的是
      // 「由扩展发起、指向**外部网络**」的请求。两类都单独统计。
      const extOutbound = extReqs.filter((e) => !e.url.startsWith(`chrome-extension://${extId}/`));
      const anyExtensionUrl = rec.events.filter((e) => e.url.startsWith('chrome-extension://'));
      per[key] = {
        filter, total: rec.events.length,
        extensionInitiated: extReqs.length,
        extensionOutbound: extOutbound,
        extensionUrlRequests: anyExtensionUrl.map((e) => e.url),
      };
      assert(`前置 ${key}:滤镜确实生效(录制的是一个真的在工作的扩展)`,
        filter === 'grayscale(1)', { filter });
      assert(`🔴 (c) ${key}:录制到的请求中**零条**由扩展发起指向外部网络(ADR-026)`,
        extOutbound.length === 0,
        { total: rec.events.length, extensionInitiated: extReqs.length,
          outbound: extOutbound.slice(0, 5) });
      // 另一条独立判据:没有任何请求的 URL 里携带页面内容(信标形态)。
      const beaconish = rec.events.filter((e) => /innerText|innerHTML|document\.|textContent/i.test(e.url));
      assert(`(c) ${key}:无请求 URL 携带页面内容(信标形态)`,
        beaconish.length === 0, { sample: beaconish.slice(0, 3) });
      await rec.client.detach().catch(() => {});
      await page.close();
    }
    results.data.sites = per;

    // ═══ N1 负向对照:录制器必须抓得到一条真的外传 ═══════════════════════
    // 🔴 N1 必须在一个**没有 CSP** 的站点上做。
    //    第一版用的是 hn,而 hn 的 `default-src 'self'` 会在**网络层之前**
    //    就把这条 fetch 拦掉 —— 录制器因此什么都没抓到(recorded=0),
    //    于是「录制器在工作」这件事根本没被证明。
    //    换成 example.com(实测无 CSP):同一条 fetch 既被录制器抓到、
    //    也真的打到了哨兵服务器。
    const page = await browser.newPage();
    const rec = await record(page, extId);
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.evaluate(async (u) => { try { await fetch(u, { mode: 'no-cors' }); } catch (e) {} }, sentinel);
    await new Promise((r) => setTimeout(r, 2000));
    const caught = rec.events.filter((e) => e.url.startsWith(sentinel));
    results.data.n1 = { caught: caught.length, sentinelHits: hits.length, events: caught };
    assert('🔴 N1 负向对照:录制器**抓到了**人为注入的那条外传请求(证明录制通道真的在工作)',
      caught.length >= 1 && hits.length >= 1, { recorded: caught.length, serverHits: hits.length });

    // ═══ N2 负向对照:归因逻辑能把扩展世界发起的请求判为 fromExtension ═══
    //
    // 在 content script 的 isolated world 里发一条 fetch。该世界的
    // `origin` 就是 `chrome-extension://<id>`(实测 `Runtime.executionContextCreated`
    // 给出 `{origin:'chrome-extension://…', name:'Chrome Color Filters',
    // auxData:{type:'isolated'}}`),于是上面的「通道 1」必须把它认出来。
    //
    // ⚠️ 必须复用**同一个** CDP session(`rec.client`):`scriptId` 与
    //    `executionContextId` 都是 **per-session** 的标识,换 session 后
    //    两张映射对不上,归因会在一个纯粹的记账错误上报假。
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 3000));
    // 取**仍然存活**且 origin 为扩展的那个上下文里 id 最大的一个
    // (reload 后新建的那个)。
    let isoCtxId = null;
    for (const [cid, origin] of rec.ctxOrigin.entries()) {
      if (!(origin || '').includes(extId)) continue;
      if (!rec.liveCtx.has(cid)) continue;
      if (isoCtxId === null || cid > isoCtxId) isoCtxId = cid;
    }
    results.data.n2 = {
      foundIsolatedWorld: isoCtxId !== null,
      chosenContextId: isoCtxId,
      contexts: [...rec.ctxOrigin.entries()].map(([k, v]) => ({ id: k, origin: v, live: rec.liveCtx.has(k) })),
    };
    if (isoCtxId !== null) {
      const before = rec.events.length;
      await rec.client.send('Runtime.evaluate', {
        expression: `fetch(${JSON.stringify(sentinel + '?world=isolated')}, {mode:'no-cors'}).catch(()=>{})`,
        contextId: isoCtxId, awaitPromise: false,
      }).catch((e) => { results.data.n2.evalError = String(e).slice(0, 200); });
      // 🔴 evaluate 本身失败必须当场判红,而不是任由下面那条断言
      //    把「门禁挑错上下文」显示成「产品没发请求」。
      assert('N2 前置:在扩展的 isolated world 里执行注入脚本成功(无 evalError)',
        results.data.n2.evalError === undefined, { evalError: results.data.n2.evalError,
          chosenContextId: isoCtxId });
      await new Promise((r) => setTimeout(r, 3000));
      const isoReqs = rec.events.slice(before).filter((e) => e.url.includes('world=isolated'));
      results.data.n2.recorded = isoReqs;
      assert('🔴 N2 负向对照:从**扩展的 isolated world** 发出的 fetch 被归因为 fromExtension —— 归因逻辑不是恒假',
        isoReqs.length >= 1 && isoReqs.some((e) => e.fromExtension === true),
        { recorded: isoReqs.map((e) => ({ url: e.url, fromExtension: e.fromExtension,
          attribution: e.attribution, scriptIds: e.frameScriptIds })) });
    } else {
      assert('🔴 N2 负向对照:必须能定位扩展的 isolated world 以验证归因逻辑',
        false, { note: '未找到 origin 含扩展 id 的执行上下文 —— N2 无法执行,归因逻辑未被验证',
          contexts: results.data.n2.contexts });
    }
    await page.close();

  } finally {
    await browser.close();
    server.close();
  }

  L.writeJson('inv9-network.json', results);
  console.log(`\n${results.pass ? 'PASS' : 'FAIL'} — T7 INV-9 (c) Network 实测`);
  process.exit(results.pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
