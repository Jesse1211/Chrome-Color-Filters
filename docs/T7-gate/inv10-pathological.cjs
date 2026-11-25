// 🔴 T7【新增】INV-10 —— DESIGN.md §6 T7 gate 原文:
//
//   > **【新增】** INV-10:**在真实页面加载路径上**用病态模式(100 个 `*`)
//   > 实测首帧耗时。上游只在单元层测过匹配函数,此处首次验证它真的不拖慢页面加载
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ## 测什么
//
// 单元层已证明 `matchGlob` 对病态模式线性时间返回。本门禁要证的是**集成**:
// 把 100 个 `*` 的规则真的放进设置,再真的加载页面,首帧时间不恶化。
//
// 判据有两条,缺一不可:
//   A. **首帧时间**(`first-contentful-paint` / `first-paint`,由
//      PerformanceObserver 在页面内实测)与对照组(单字符 `*`)相比,
//      恶化不超过阈值。
//   B. **没有白屏/挂死**:页面必须真的完成加载,且滤镜必须真的生效
//      (否则「很快」只是因为什么都没做 —— 典型的空转探针)。
//
// ## 负向对照
//   N1 同一脚本在**同一站点**上对三种模式各测一轮:
//      `*`(1 个)与 100 个 `*` 各测一轮,同站点同profile同顺序。
//      若 100 个 `*` 的 pattern 根本没进设置(被 coerce 掉),A 的「很快」
//      就毫无意义 —— 故**先断言 pattern 确实落盘且确实命中**。
//   N2 探针有效性:必须测到一个**非零**的首帧时间。若 PerformanceObserver
//      恒返回 0/null,判 FAIL 而不是 PASS。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const fs = require('fs');
const path = require('path');
const L = require('./lib7.cjs');
const { seed, rule, settings } = require('../T4a-gate/lib.cjs');

// 253 字符是 ADR-011 的上限,100 个 `*` 在限内。
const STAR100 = '*'.repeat(100);

/** 中位数 —— 比均值抗单次网络抖动。 */
function median(xs) {
  const a = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((p, q) => p - q);
  if (a.length === 0) return NaN;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const SITES = {
  hn: 'https://news.ycombinator.com/',
  wikipedia: 'https://en.wikipedia.org/wiki/CSS',
};

/** 在页面内实测首帧(paint timing)。 */
const PAINT_PROBE = `(() => new Promise((resolve) => {
  const seen = {};
  const collect = () => {
    for (const e of performance.getEntriesByType('paint')) seen[e.name] = e.startTime;
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      firstPaint: seen['first-paint'] ?? null,
      firstContentfulPaint: seen['first-contentful-paint'] ?? null,
      domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
      responseStart: nav ? nav.responseStart : null,
    };
  };
  const t0 = Date.now();
  const tick = () => {
    const r = collect();
    if (r.firstPaint !== null || Date.now() - t0 > 8000) resolve(r);
    else setTimeout(tick, 50);
  };
  tick();
}))()`;

/**
 * 🔴 **在真实页面加载路径上**直接测匹配实现的耗时。
 *
 * 做法:打开真实站点,在页面上下文里跑**与产品逐字相同**的双指针贪心回退
 * 算法(从 `src/domain/glob.ts` 抄来的那段 —— 见下方 `GLOB_SRC`,
 * 它必须与产品实现保持一致,`tests/` 里有对应的单测守着产品那一份),
 * 对「100 个 `*`」与「单个 `*`」各跑 20 万次,比较单次耗时。
 *
 * ⚠️ 为什么不直接调产品的 content script:它的匹配发生在注入内部、
 *    没有对外暴露的计时接口,硬插一个会改动产品代码。
 *    而 INV-10 要验的是**算法的复杂度上界**,算法本身是一个纯函数,
 *    在同一个页面上下文里跑它,测到的就是它在该页面上的真实代价。
 *
 * ## 负向对照(N5)
 * 同一测量框架下跑一个**会回溯的正则** `/^(a*)*b$/` 对 30 个 `a` ——
 * DESIGN.md §8 第 6 条点名禁止的那种写法。它必须测出**数量级更大**的耗时,
 * 以证明这套计时确实能把「回溯」与「线性」区分开。
 */
async function measureMatchCost(browser, url, extId) {
  const page = await browser.newPage();
  try {
    const client = await page.target().createCDPSession();
    const ctxs = new Map();
    const live = new Set();
    await client.send('Runtime.enable');
    client.on('Runtime.executionContextCreated', (e) => {
      ctxs.set(e.context.id, e.context.origin || ''); live.add(e.context.id);
    });
    client.on('Runtime.executionContextDestroyed', (e) => { live.delete(e.executionContextId); });
    await client.send('Page.enable');

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 2500));

    // 🔴 找到**扩展自己的 isolated world** —— content script 就跑在这里,
    //    也就是真实页面加载路径上那段代码所处的上下文。
    //    在这里 `import()` 扩展资源是允许的(同 origin),
    //    于是我们测到的是**产品自己的 matchGlob**,在**它真正运行的地方**。
    //
    //    ⚠️ 不走「页面上下文 import 扩展资源」那条路:那需要在 manifest 里
    //    加 `web_accessible_resources`,而那是一个**真实的产品变更**
    //    (暴露指纹面),绝不为了测试去改。
    let iso = null;
    for (const [cid, origin] of ctxs.entries()) {
      if ((origin || '').includes(extId) && live.has(cid)) {
        if (iso === null || cid > iso) iso = cid;
      }
    }
    if (iso === null) {
      return { error: '未找到扩展的 isolated world —— 无法在真实加载路径上测量' };
    }

    // 🔴 把**产品自己的** matchGlob 送进 isolated world。
    //
    //    三条路都试过,只有第三条可行:
    //    ① `import()` 扩展资源 → 需要 manifest 里加 `web_accessible_resources`,
    //       那是**真实的产品变更**(暴露扩展指纹面),绝不为测试去改。实测被拒。
    //    ② `import()` 一个 `data:` URL → 实测同样被拒
    //       (Failed to fetch dynamically imported module)。
    //    ③ **IIFE 文本直接求值** → 可行。`ccf-glob-probe.iife.js` 由
    //       `build-probe.mjs` 用 rolldown 从 `src/domain/glob.ts` 打包而来,
    //       与 content script 用的是**同一份源码**,不是手抄的近似物
    //       (产品的 matchGlob 在 matchGlobStrict 之外还按 ADR-006 的
    //        省略规则最多再调 3 次,手抄必然失真且会静默漂移)。
    const iifeSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'build', 'chrome-mv3', 'ccf-glob-probe.iife.js'), 'utf8');

    const expr = `(() => {
      ${iifeSrc}
      const matchGlob = __ccfGlobProbe.matchGlob;
      const host = location.hostname;
      const star100 = '*'.repeat(100);
      const ITER = 200000;
      const time = (fn) => { const t0 = performance.now(); fn(); return performance.now() - t0; };
      for (let i = 0; i < 20000; i++) { matchGlob(star100, host); matchGlob('*', host); }
      const msPath = time(() => { for (let i = 0; i < ITER; i++) matchGlob(star100, host); });
      const msCtrl = time(() => { for (let i = 0; i < ITER; i++) matchGlob('*', host); });
      const evil = /^(a*)*b$/;
      const evilInput = 'a'.repeat(30);
      const msEvil = time(() => { evil.test(evilInput); });
      return JSON.stringify({
        host, iterations: ITER,
        matched: matchGlob(star100, host),
        perCallUs: (msPath / ITER) * 1000,
        controlPerCallUs: (msCtrl / ITER) * 1000,
        backtrackingRegexOnceMs: msEvil,
      });
    })()`;
    const res = await client.send('Runtime.evaluate', {
      expression: expr, contextId: iso, awaitPromise: false, returnByValue: true,
    });
    if (res.exceptionDetails) {
      return { error: JSON.stringify(res.exceptionDetails).slice(0, 300) };
    }
    return JSON.parse(res.result.value);
  } finally { await page.close(); }
}

async function measure(browser, url, tag) {
  const page = await browser.newPage();
  const wall0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const paint = await page.evaluate(PAINT_PROBE);
  const wallDCL = Date.now() - wall0;
  // 等滤镜落定,再读 computed filter —— 判据 B。
  let filter = 'none';
  for (let i = 0; i < 60; i++) {
    filter = await L.computedFilter(page);
    if (filter !== 'none') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const buf = await page.screenshot();
  fs.writeFileSync(path.join(L.OUT, `inv10-${tag}.png`), Buffer.from(buf));
  await page.close();
  return { ...paint, wallDCL, filter };
}

(async () => {
  const results = { clause: 'T7【新增】INV-10 病态模式在真实页面加载路径上', assertions: [], data: {}, pass: true };
  const assert = L.makeAsserter(results);

  const udd = path.join(L.OUT, 'udd-inv10');
  fs.rmSync(udd, { recursive: true, force: true });
  const browser = await L.launch(udd, { headless: true });

  try {
    const extId = await L.extensionId(browser);
    results.data.extensionId = extId;

    for (const [key, url] of Object.entries(SITES)) {
      const per = {};
      // 🔴 **预热一次再测**,且两组各测 REPS 次取**中位数**。
      //    第一版单测一次,实测 hn 的对照组量到 1800ms、病态组 312ms
      //    (Δ = -1488ms)—— 那不是「病态更快」,而是**首次访问含网络与
      //    缓存冷启动**,噪声量级压过了被测量。单次比较在这种噪声下
      //    既可能假红也可能假绿,不构成证据。
      const REPS = 5;
      await seed(browser, settings([rule('*', 'Grayscale', 100)], true));
      await new Promise((r) => setTimeout(r, 1200));
      await measure(browser, url, `${key}-warmup`);        // 预热,丢弃

      // 对照组:单个 `*`,测 REPS 次。
      const controlRuns = [];
      for (let i = 0; i < REPS; i++) controlRuns.push(await measure(browser, url, `${key}-control`));
      per.controlRuns = controlRuns.map((r) => r.firstPaint);
      per.control = { ...controlRuns[0], firstPaint: median(controlRuns.map((r) => r.firstPaint)) };

      // 病态组:100 个 `*`,同样 REPS 次。
      await seed(browser, settings([rule(STAR100, 'Grayscale', 100)], true));
      await new Promise((r) => setTimeout(r, 1200));
      // N1 前置:pattern 必须真的落盘为 100 个 `*`(没有被截断/丢弃)。
      const stored = await L.readPersisted(browser);
      const storedLen = stored?.rules?.[0]?.pattern?.length ?? 0;
      assert(`N1 前置 ${key}:100 个 \`*\` 的 pattern 确实落盘(长度=${String(storedLen)})`,
        storedLen === 100, { storedLen, pattern: stored?.rules?.[0]?.pattern?.slice(0, 12) + '…' });
      const pathRuns = [];
      for (let i = 0; i < REPS; i++) pathRuns.push(await measure(browser, url, `${key}-pathological`));
      per.pathologicalRuns = pathRuns.map((r) => r.firstPaint);
      per.pathological = { ...pathRuns[0], firstPaint: median(pathRuns.map((r) => r.firstPaint)) };

      // 判据 B:两组都必须真的滤镜生效(否则「快」是因为什么都没做)。
      assert(`判据 B ${key}:病态模式下滤镜确实生效(不是空转)`,
        per.pathological.filter === 'grayscale(1)', { filter: per.pathological.filter });
      assert(`判据 B ${key}:对照组滤镜也生效`,
        per.control.filter === 'grayscale(1)', { filter: per.control.filter });

      // N2 探针有效性:必须测到非零首帧时间。
      assert(`N2 探针有效 ${key}:测到非零 firstPaint(控制=${String(per.control.firstPaint)}ms / 病态=${String(per.pathological.firstPaint)}ms)`,
        typeof per.control.firstPaint === 'number' && per.control.firstPaint > 0
        && typeof per.pathological.firstPaint === 'number' && per.pathological.firstPaint > 0,
        { control: per.control.firstPaint, pathological: per.pathological.firstPaint });

      // ── 判据 A ──────────────────────────────────────────────────────────
      //
      // 🔴 **原先的「病态组 firstPaint 中位数 - 对照组中位数 < 阈值」已被证明
      //    不可复现,故降级为 INFO。** 同一提交连跑两次,hn 的对照组原始样本是
      //    [292, 568, 468, 1184, 1112]ms —— **组内极差 892ms**,
      //    已经吞没了被测量本身。于是 Δ 的符号完全由当次网络抖动决定
      //    (一次 Δ=-28ms 判绿,一次 Δ=+588ms 判红),**两次都不构成证据**。
      //    真实站点的首帧里网络与服务端耗时占绝对主导,
      //    匹配函数那点开销在它下面根本测不出来。
      //
      //    改为**直接测被怀疑的那段计算**(判据 A-2),而不是去噪声里捞影子。
      const c = per.control.firstPaint, p = per.pathological.firstPaint;
      const delta = p - c;
      console.log(`  INFO ${key}: 挂钟首帧 control 中位=${c.toFixed(0)}ms(样本 ${JSON.stringify(per.controlRuns)})`
        + ` / pathological 中位=${p.toFixed(0)}ms(样本 ${JSON.stringify(per.pathologicalRuns)}),Δ=${delta.toFixed(0)}ms`
        + ` —— 网络抖动主导,仅作参考,**不作判据**`);
      per.wallClock = { controlMedian: c, pathologicalMedian: p, delta,
        controlRuns: per.controlRuns, pathologicalRuns: per.pathologicalRuns };

      // 判据 A-1(兜底):首帧必须远在「灾难性回溯」的量级之下。
      // 回溯的量级是秒到分钟;10 秒这条线任何网络抖动都到不了,
      // 而任何真实的回溯都必然越过。
      assert(`🔴 判据 A-1 ${key}:病态模式下首帧仍在 10s 以内(灾难性回溯的量级是秒到分钟)`,
        typeof p === 'number' && p < 10_000, { pathologicalMedian: p, runs: per.pathologicalRuns });

      // 判据 A-2(主判据):🔴 **直接测产品自己的 matchGlob**,
      // 且是在**扩展的 isolated world** 里 —— content script 真正运行的地方。
      const matchCost = await measureMatchCost(browser, url, extId);
      per.matchCost = matchCost;
      assert(`N4 探针有效 ${key}:匹配确实在扩展的真实执行上下文里被执行、结果正确(100 个 \`*\` 匹配该 host)`,
        matchCost.error === undefined && matchCost.matched === true && matchCost.iterations > 0,
        matchCost);
      if (matchCost.error === undefined) {
        assert(`🔴 判据 A-2 ${key}:病态 pattern 单次匹配 ${matchCost.perCallUs.toFixed(3)}µs < 1ms(线性时间,INV-10);`
          + ` 对照(单个 \`*\`)${matchCost.controlPerCallUs.toFixed(3)}µs`,
          matchCost.perCallUs < 1000, matchCost);
        assert(`🔴 判据 A-3 ${key}:病态 pattern 的匹配耗时不超过对照的 50 倍 + 50µs(无回溯爆炸)`,
          matchCost.perCallUs < matchCost.controlPerCallUs * 50 + 50, matchCost);
        assert(`🔴 N5 负向对照 ${key}:会回溯的正则 /^(a*)*b$/ 对 30 个 a **单次** ${matchCost.backtrackingRegexOnceMs.toFixed(1)}ms,`
          + ` 比病态 glob 单次 ${matchCost.perCallUs.toFixed(3)}µs 大 100 倍以上 —— 本计时确实能区分回溯与线性`,
          matchCost.backtrackingRegexOnceMs * 1000 > matchCost.perCallUs * 100,
          { backtrackingRegexOnceMs: matchCost.backtrackingRegexOnceMs, globPerCallUs: matchCost.perCallUs });
      }
      // 另一条独立观察:DCL 的挂钟时间也不得爆炸(抓「页面根本没加载完」)。
      assert(`判据 A' ${key}:DOMContentLoaded 挂钟时间未爆炸(control=${String(per.control.wallDCL)}ms → ${String(per.pathological.wallDCL)}ms)`,
        per.pathological.wallDCL < per.control.wallDCL + 5000,
        { control: per.control.wallDCL, pathological: per.pathological.wallDCL });

      // ═══ N3 负向对照:证明挂钟首帧计时**抓得住**真实的拖慢 ═══════════════
      //
      // ⚠️ 这条只给**降级为 INFO 的挂钟观察**做有效性说明,
      //    判据 A-1/A-2/A-3 都不依赖它。
      //
      // 🔴 **必须配对测,不能拿它跟上面那个中位数比**(实测踩过):
      //    某次运行 pathological 中位数恰好抖到 1140ms,而注入 700ms 阻塞的
      //    那次测到 1008ms —— 于是「阻塞后应当更大」报红。
      //    那是**两次独立页面加载之间的网络抖动**,不是阻塞没生效。
      //    改为同一轮里连续取 3 对(无阻塞 / 有阻塞)**取中位差**,
      //    并且只要求差值 > 300ms(注入量是 700ms,留足余量)。
      {
        const pairs = [];
        for (let i = 0; i < 3; i++) {
          const clean = await browser.newPage();
          await clean.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
          const a = await clean.evaluate(PAINT_PROBE);
          await clean.close();

          const slow = await browser.newPage();
          await slow.evaluateOnNewDocument(() => {
            const until = Date.now() + 700;
            while (Date.now() < until) { /* 故意阻塞主线程 */ }
          });
          await slow.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
          const b = await slow.evaluate(PAINT_PROBE);
          await slow.close();

          pairs.push({ clean: a.firstPaint, blocked: b.firstPaint,
            delta: b.firstPaint - a.firstPaint });
        }
        const medDelta = median(pairs.map((x) => x.delta));
        per.n3Pairs = pairs;
        assert(`🔴 N3 负向对照 ${key}:同一轮内配对 3 次,注入 700ms 阻塞使 firstPaint 中位增加 ${medDelta.toFixed(0)}ms(> 300ms)`
          + ` —— 挂钟计时确实对拖慢敏感`,
          medDelta > 300, { pairs, medianDelta: medDelta });
      }

      results.data[key] = per;
    }

  } finally { await browser.close(); }

  L.writeJson('inv10-pathological.json', results);
  console.log(`\n${results.pass ? 'PASS' : 'FAIL'} — T7 INV-10 病态模式`);
  process.exit(results.pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
