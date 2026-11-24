// 🔴 T7【新增】两条 —— DESIGN.md §6 T7 gate 原文:
//
//   > **【新增】** 🔴 CSP 无关性(ADR-075):`grayscale()` 是 CSS 内置函数,
//   > 不产生资源加载,**结构上无从被 CSP 拦截**。仍须在 **news.ycombinator.com**
//   > (已确认其 CSP 拦 `data:`)上实测灰阶像素确实改变 + 零 CSP violation,
//   > 以证明删除 SVG 机制后该缺陷确已消失
//
//   > **【新增】** 灰阶在真实网页上视觉正确(截图留档),且**抽查若干强度档**
//   > 与 `grayscale(intensity/100)` 逐位一致
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ## CSP violation 怎么算「零」
//
// 三条通道同时收,任何一条有记录即 FAIL:
//   (1) 页面内 `document.addEventListener('securitypolicyviolation')`;
//   (2) CDP `Log.entryAdded` / console 里的 CSP 报错文本;
//   (3) 响应头里确认该站**真的**带着 CSP(否则「零 violation」是因为没有策略 ——
//       典型的空转。这是本条的**负向对照**)。
//
// ## 强度档「逐位一致」怎么验
//
// 对每个抽查档 n:断言 `getComputedStyle(html).filter === 'grayscale(' + f + ')'`,
// 其中 f 是 n/100 的**CSS 序列化形式**(0.3 而非 0.30,1 而非 1.0)。
// 并且同时验像素:n=100 必须 maxChannelSpread == 0(完全灰),
// n=0 必须与无滤镜态的像素**逐字节相同**(恒等变换)。
//
// ## 负向对照
//   N1 n=0 档:像素必须与「无规则」时**逐字节相同** —— 若 0 档也把图变灰,
//      说明强度根本没被传下去。
//   N2 n=100 档:maxChannelSpread 必须为 0,而**无滤镜基线必须 > 0** ——
//      否则该站本身就是灰的,像素判据空转(T4b 在 example.com 上踩过这个坑)。
//   N3 CSP 通道:必须确认 hn 的响应头**真的**含 CSP(见上)。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const L = require('./lib7.cjs');
const { seed, rule, settings } = require('../T4a-gate/lib.cjs');

const HN = 'https://news.ycombinator.com/';
const WIKI = 'https://en.wikipedia.org/wiki/CSS';

// 抽查的强度档。含两个端点(0/100)与几个中间档,覆盖「整数 / 一位小数 /
// 两位小数」三种 CSS 序列化形态。
const SAMPLES = [0, 1, 7, 30, 50, 55, 99, 100];

/** n/100 的 CSS 序列化形式 —— 与 `src/domain/filter-css.ts` 同口径。 */
function expectedFilter(n) {
  const v = n / 100;
  return `grayscale(${String(v)})`;
}

function maxChannelSpread(buf) {
  const img = PNG.sync.read(Buffer.from(buf));
  let max = 0, counted = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 250) continue;
    counted++;
    const s = Math.max(img.data[i], img.data[i+1], img.data[i+2])
            - Math.min(img.data[i], img.data[i+1], img.data[i+2]);
    if (s > max) max = s;
  }
  return { max, counted };
}

/** 收 CSP violation 的三条通道。 */
async function openWithCspCapture(browser, url) {
  const page = await browser.newPage();
  const violations = [];
  const consoleErrors = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/Content Security Policy|CSP|Refused to/i.test(t)) consoleErrors.push(t);
  });
  await page.evaluateOnNewDocument(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push({
        directive: e.violatedDirective, blockedURI: e.blockedURI, source: e.sourceFile,
      });
    });
  });
  // 🔴 **必须绕开缓存读响应头**(实测踩过):第二次运行时 hn 的主文档走了
  //    缓存,`resp.headers()` 里根本没有 `content-security-policy`,
  //    于是「该站确实带 CSP」这条负向对照报红 —— 那是**读法**的问题,
  //    不是站点真的撤了 CSP(同一次运行里页面内 violation 通道照常在工作)。
  //    关掉该页的缓存即可拿到服务端的真实响应头。
  await page.setCacheEnabled(false);
  const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
  const headers = resp ? resp.headers() : {};
  let cspHeader = headers['content-security-policy']
    ?? headers['content-security-policy-report-only'] ?? null;
  // 兜底:主文档若仍来自缓存(`fromCache`),再发一次**明确不走缓存**的请求读头。
  if (cspHeader === null) {
    cspHeader = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u, { cache: 'reload' });
        return r.headers.get('content-security-policy')
          ?? r.headers.get('content-security-policy-report-only');
      } catch (e) { return null; }
    }, url);
  }
  // 等滤镜落定。
  let filter = 'none';
  for (let i = 0; i < 80; i++) {
    filter = await L.computedFilter(page);
    if (filter !== 'none') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 2000));
  const inPage = await page.evaluate(() => window.__cspViolations ?? []);
  violations.push(...inPage);
  return { page, violations, consoleErrors, cspHeader, filter };
}

(async () => {
  const results = { clause: 'T7【新增】CSP 无关性(ADR-075)+ 灰阶视觉/强度档保真', assertions: [], data: {}, pass: true };
  const assert = L.makeAsserter(results);

  const udd = path.join(L.OUT, 'udd-csp');
  fs.rmSync(udd, { recursive: true, force: true });
  const browser = await L.launch(udd, { headless: true });

  try {
    // ═══ N2 基线:无规则时 hn 与 wiki 的像素必须**彩色** ═══════════════════
    await seed(browser, settings([], true));
    const baseShots = {};
    for (const [k, url] of [['hn', HN], ['wiki', WIKI]]) {
      const p = await browser.newPage();
      await p.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
      await new Promise((r) => setTimeout(r, 1500));
      const buf = await p.screenshot();
      baseShots[k] = buf;
      fs.writeFileSync(path.join(L.OUT, `csp-baseline-${k}.png`), Buffer.from(buf));
      const f = await L.computedFilter(p);
      const sp = maxChannelSpread(buf);
      await p.close();
      assert(`N2 基线 ${k}:无规则时未滤镜(filter=none)且像素确实彩色(maxSpread=${String(sp.max)} > 0)`,
        f === 'none' && sp.max > 0, { filter: f, ...sp });
      results.data[`baseline_${k}`] = { filter: f, spread: sp };
    }

    // ═══ CSP 无关性 —— hn,100 档 ═════════════════════════════════════════
    await seed(browser, settings([rule('news.ycombinator.com', 'Grayscale', 100)], true));
    await new Promise((r) => setTimeout(r, 1500));
    const hn = await openWithCspCapture(browser, HN);
    const hnShot = await hn.page.screenshot();
    fs.writeFileSync(path.join(L.OUT, 'csp-hn-gray100.png'), Buffer.from(hnShot));
    const hnSpread = maxChannelSpread(hnShot);
    await hn.page.close();
    results.data.hn = { filter: hn.filter, cspHeader: hn.cspHeader,
      violations: hn.violations, consoleErrors: hn.consoleErrors, spread: hnSpread };

    assert('🔴 N3 负向对照:news.ycombinator.com 的响应头**确实**带 CSP(否则「零 violation」空转)',
      typeof hn.cspHeader === 'string' && hn.cspHeader.length > 0,
      { cspHeader: hn.cspHeader ? hn.cspHeader.slice(0, 200) : null });
    assert('🔴 ADR-075:hn 上灰阶确实生效(computed filter = grayscale(1))',
      hn.filter === 'grayscale(1)', { filter: hn.filter });
    assert('🔴 ADR-075:hn 上**像素确实改变** —— 全图 maxChannelSpread == 0(真灰),基线 > 0',
      hnSpread.max === 0 && results.data.baseline_hn.spread.max > 0,
      { onSpread: hnSpread, offSpread: results.data.baseline_hn.spread });
    assert('🔴 ADR-075:hn 上**零 CSP violation**(页面内事件 + console 两条通道)',
      hn.violations.length === 0 && hn.consoleErrors.length === 0,
      { violations: hn.violations, consoleErrors: hn.consoleErrors.slice(0, 5) });

    // ═══ 强度档逐位一致 ═══════════════════════════════════════════════════
    const perSample = {};
    for (const n of SAMPLES) {
      await seed(browser, settings([rule('en.wikipedia.org', 'Grayscale', n)], true));
      await new Promise((r) => setTimeout(r, 1200));
      const p = await browser.newPage();
      await p.goto(WIKI, { waitUntil: 'networkidle2', timeout: 90000 });
      // 0 档的期望值是 grayscale(0) —— **不是** none,故不能用「等到 !== none」。
      // 改为等到 computed filter 稳定(连续 3 次相同)。
      let last = null, stable = 0, f = 'none';
      for (let i = 0; i < 80; i++) {
        f = await L.computedFilter(p);
        if (f === last) { stable++; if (stable >= 3) break; } else { stable = 0; last = f; }
        await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => setTimeout(r, 600));
      f = await L.computedFilter(p);
      const buf = await p.screenshot();
      if (n === 0 || n === 50 || n === 100) {
        fs.writeFileSync(path.join(L.OUT, `fidelity-wiki-gray${String(n)}.png`), Buffer.from(buf));
      }
      const sp = maxChannelSpread(buf);

      // 0 档的恒等性:在**同一个页面、同一时刻**上做配对比较。
      if (n === 0) {
        // 产品自己的关闭路径:设上压制属性 `data-ccf-off`
        // (filter.css 的 `html[data-ccf-off]` 把 filter 压回 none)。
        const offFilter = await p.evaluate(() => {
          const de = document.documentElement;
          de.removeAttribute('data-ccf-on');
          de.style.removeProperty('--ccf-filter');
          de.setAttribute('data-ccf-off', '');
          void de.offsetHeight;
          return getComputedStyle(de).filter;
        });
        const bufOff = await p.screenshot();
        results.data.zeroIdentity = {
          filterWith: f, filterWithout: offFilter,
          identical: Buffer.compare(Buffer.from(buf), Buffer.from(bufOff)) === 0,
          spreadWithFilter: sp.max,
          spreadWithout: maxChannelSpread(bufOff).max,
        };
        fs.writeFileSync(path.join(L.OUT, 'fidelity-wiki-gray0-suppressed.png'), Buffer.from(bufOff));
      }

      await p.close();
      perSample[n] = { filter: f, expected: expectedFilter(n), spread: sp };
      assert(`强度 ${String(n)} 档:computed filter 逐位等于 ${expectedFilter(n)}`,
        f === expectedFilter(n), { got: f, expected: expectedFilter(n) });
    }
    results.data.samples = perSample;

    // ── N1:0 档必须是恒等变换 ────────────────────────────────────────────
    //
    // 🔴 第一版拿 0 档去比**几分钟前**拍的那张无滤镜基线,容差 ±8。
    //    实测在第二次运行里报红(202 vs 178)—— 原因是 **Wikipedia 自己的
    //    页面内容在两次加载之间变了**(首页模块/图片轮换),
    //    而不是 0 档没做恒等变换。拿两个不同时刻的页面比像素,
    //    测的是站点的内容波动,不是滤镜。
    //
    //    改为**同一轮、同一页面**内的配对比较:在 0 档那个页面上,
    //    用 CDP 把扩展的压制属性设上(产品自己的关闭路径),
    //    前后两张截图必须**逐字节相同** —— 这才是「恒等变换」的定义。
    const zeroIdentity = results.data.zeroIdentity;
    assert('🔴 N1:0 档是恒等变换 —— 同一页面上「0 档」与「无滤镜」的截图**逐字节相同**',
      zeroIdentity && zeroIdentity.identical === true && zeroIdentity.spreadWithFilter > 0,
      zeroIdentity);
    // 100 档必须完全灰。
    assert('100 档:全图 maxChannelSpread == 0(完全灰阶)',
      perSample[100].spread.max === 0, perSample[100].spread);
    // 中间档必须严格介于两者之间(证明强度真的是连续量,不是开/关两态)。
    const mid = perSample[50].spread.max;
    assert('50 档:像素极差严格介于 0 档与 100 档之间(强度是连续量,不是开/关两态)',
      mid > 0 && mid < perSample[0].spread.max,
      { zero: perSample[0].spread.max, mid, hundred: perSample[100].spread.max });

  } finally { await browser.close(); }

  L.writeJson('csp-fidelity.json', results);
  console.log(`\n${results.pass ? 'PASS' : 'FAIL'} — T7 CSP 无关性 + 灰阶保真`);
  process.exit(results.pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
