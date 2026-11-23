// ═══════════════════════════════════════════════════════════════════════════
// T7 根因门禁:站点 CSP 对 `data:` URI 滤镜资源的拦截(确定性复现)
// ═══════════════════════════════════════════════════════════════════════════
//
// ## 这个文件为什么存在
//
// `visual-modes.cjs` 在 `news.ycombinator.com` 上判红,根因是站点的
// `Content-Security-Policy` 的 **`img-src`** 把扩展的
// `filter: url("data:image/svg+xml,…")` **滤镜资源当图片拦掉**。
// 那条红灯的证据是真实的,但它有两个作为**回归门禁**的致命弱点:
//
//   1. **不确定。** HN 偶发返回 503 / 缓存响应,**那些响应不带 CSP**,
//      于是同一条判据逐轮漂移(实测同一天不同轮次:6 红 / 2 红)。
//      上一轮的 Tester 正是因此「重跑就绿」并误判为运气问题。
//   2. **依赖第三方的策略。** HN 哪天在 `img-src` 里加上 `data:`,
//      这条缺陷就会**静默地从门禁里消失**,而产品缺陷依然存在。
//
// 故本门禁把根因搬到**本机固定响应头的 fixture 站点**上:CSP 由我们自己
// 逐字控制,结果**完全确定**,且覆盖 `visual-modes` 覆盖不到的策略维度。
// 这是 DESIGN.md §8 第 8 条(REAL_STACK_GATE 必须在真实 Chrome 中跑)的
// 正常用法 —— 页面是本地的,但**浏览器、扩展产物与渲染路径全是真的**。
//
// 📌 本机 HTTP fixture 的手法沿用 `docs/T4b-gate/noninvasive.cjs` 的
//    `startServer()`(同一仓库里已有的既定做法),不新发明约定。
//
// ## 判据
//
// 对每一种 CSP 策略,断言「像素是否被变换」与「滤镜资源是否被 CSP 拦」
// **严格同步**。这把根因从「相关」钉成「因果」:
// 唯一变量是**响应头里的那一行 CSP**,页面 HTML、滤镜设置、
// 扩展产物、浏览器、视口全部逐字相同。
//
// 🔴 本门禁**预期判红**(退出码 1):它是缺陷的确定性复现,
//    不是「待修复的测试」。修复方案一旦落地,它应当自动转绿 ——
//    那正是它作为回归门禁的价值。断言方向**不得**为了让门禁变绿而反转。
//
// 用法(从仓库根):npm run build && node docs/T7-gate/csp-matrix.cjs

const fs = require('fs');
const path = require('path');
const http = require('http');
const { PNG } = require('pngjs');
const {
  makeResults,
  tmpProfile,
  launch,
  seed,
  rule,
  settings,
  filterOf,
  waitFilter,
  sleep,
} = require('./lib7.cjs');

const OUT = path.join(__dirname, 'evidence');
const R = makeResults('csp-matrix');

/**
 * 判据色 `#66ff33` —— 与 `visual-modes.cjs` 完全同一个颜色,理由见那里:
 * 它在三个矩阵下的逐通道总变化量都 > 130,远离任何钳制不动点,
 * 故「像素没变」**不可能**是矩阵的正确行为。
 */
const SWATCH_RGB = [102, 255, 51];

/**
 * fixture 页面:一块判据色 + 一个 doctype(排除 quirks 模式这个变量)。
 *
 * 🔴 **本门禁自己踩过的坑(务必保留此注释):色块的颜色不能靠 CSS 上。**
 * 第一版用 `<style>` + `style="background:#66ff33"` 给色块上色,结果在
 * `default-src 'self'` 这类策略下 **`style-src` 把内联样式一并拦掉**,
 * 色块根本没有背景色 → 读到的像素是**白色** `[255,255,255]`,
 * 它既 `!== #66ff33` 又让「像素被变换了」**假绿**(vacuous pass)。
 * 那会把本门禁的核心判据变成空转,比判红危险得多。
 *
 * **修复:色块改用 `<svg>` 的 `fill` 属性(表现属性,不是 CSS)**,
 * 它**不受 `style-src` 管**,故在任何 CSP 策略下都确定地呈现判据色。
 * 下面的「仪器有效性」断言会独立校验这一点:OFF 基线必须**恰好**读到判据色。
 */
const FIXTURE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ccf csp fixture</title></head>
<body>
<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="200" height="200" fill="#66ff33"/>
</svg>
</body></html>`;

/**
 * CSP 策略矩阵。
 *
 * `expectBlocked` 是**按 CSP 规范推演**的预期,不是对产品的预期 ——
 * 它用来验证「本门禁的仪器读数符合规范」,从而证明读数可信。
 */
const POLICIES = [
  {
    name: '无 CSP(对照组:必须正常生效,证明仪器与 fixture 可信)',
    csp: null,
    expectBlocked: false,
  },
  {
    name: "img-src 放行 data:(wikipedia / MDN 的实际形态)",
    csp: "default-src 'self'; img-src 'self' data:",
    expectBlocked: false,
  },
  {
    name: "🔴 img-src 不放行 data:(news.ycombinator.com 的实际形态)",
    csp: "default-src 'self'; img-src 'self' https://account.example.com",
    expectBlocked: true,
  },
  {
    name: "🔴 default-src 不放行 data: 且无 img-src(回退到 default-src)",
    csp: "default-src 'self'",
    expectBlocked: true,
  },
  {
    name: "🔴 img-src 'none'(最严形态)",
    csp: "default-src 'self'; img-src 'none'",
    expectBlocked: true,
  },
  {
    name: 'Report-Only 不应拦截(只报告,不阻断)',
    csp: null,
    cspReportOnly: "default-src 'self'; img-src 'none'",
    expectBlocked: false,
  },
];

function startServer() {
  // 每个请求按查询串 `?p=<index>` 挂上对应的 CSP 响应头 ——
  // 同一个 HTML、同一个 origin,唯一变量就是那一行头。
  const server = http.createServer((req, res) => {
    const idx = Number(new URL(req.url, 'http://x').searchParams.get('p') ?? -1);
    const pol = POLICIES[idx];
    const headers = { 'Content-Type': 'text/html; charset=utf-8' };
    if (pol && pol.csp) headers['Content-Security-Policy'] = pol.csp;
    if (pol && pol.cspReportOnly) {
      headers['Content-Security-Policy-Report-Only'] = pol.cspReportOnly;
    }
    res.writeHead(200, headers);
    res.end(FIXTURE);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** 读色块中心像素。 */
function centerPixel(buf) {
  const img = PNG.sync.read(Buffer.from(buf));
  const i = (img.width * 100 + 100) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

async function main() {
  const { server, port } = await startServer();
  const browser = await launch(tmpProfile('csp'), { headless: true });
  const rows = [];
  try {
    // 🔴 仪器有效性(先做):**无规则 / 无滤镜**下,每一种 CSP 策略都必须
    //    读到**恰好**判据色。这把上一版的「白色像素假绿」坑永久钉死 ——
    //    若 fixture 的颜色在某个策略下没上成,这里立刻判红,
    //    而不会让核心判据空转成假绿。
    await seed(browser, settings([], true));
    for (let i = 0; i < POLICIES.length; i++) {
      const p = await browser.newPage();
      await p.setViewport({ width: 400, height: 400 });
      await p.goto(`http://127.0.0.1:${port}/?p=${i}`, { waitUntil: 'load', timeout: 60000 });
      await sleep(600);
      const base = centerPixel(
        await p.screenshot({ clip: { x: 0, y: 0, width: 200, height: 200 } }),
      );
      const baseFilter = await filterOf(p);
      await p.close();
      R.assert(
        `[${POLICIES[i].name}] 仪器有效:OFF 基线恰好是判据色(fixture 不受 CSP 影响)`,
        JSON.stringify(base) === JSON.stringify(SWATCH_RGB) && baseFilter === 'none',
        { base, expected: SWATCH_RGB, baseFilter },
      );
    }

    // RedGreen:三种辅助模式之一,走 data: URI 路径(Grayscale 是 CSS
    // 内建函数、不涉外部资源,故**不受本缺陷影响** —— 下面单独断言这一点)。
    await seed(browser, settings([rule('*', 'RedGreen', 100)], true));

    for (let i = 0; i < POLICIES.length; i++) {
      const pol = POLICIES[i];
      const url = `http://127.0.0.1:${port}/?p=${i}`;
      const p = await browser.newPage();
      await p.setViewport({ width: 400, height: 400 });
      // CSP 违规事件必须在导航前挂监听:滤镜资源加载极早。
      await p.evaluateOnNewDocument(() => {
        window.__v = [];
        document.addEventListener('securitypolicyviolation', (e) => {
          window.__v.push({ directive: e.effectiveDirective, disposition: e.disposition });
        });
      });
      await p.goto(url, { waitUntil: 'load', timeout: 60000 });
      const f = await waitFilter(p, (x) => /^url\("data:image\/svg/.test(x), 10000);
      await sleep(900);
      const pixel = centerPixel(await p.screenshot({ clip: { x: 0, y: 0, width: 200, height: 200 } }));
      const viol = await p.evaluate(() => window.__v || []);
      await p.close();

      const transformed = JSON.stringify(pixel) !== JSON.stringify(SWATCH_RGB);
      const blocked = viol.some((v) => v.directive === 'img-src' && v.disposition === 'enforce');
      rows.push({ policy: pol.name, csp: pol.csp, cspReportOnly: pol.cspReportOnly ?? null,
        filterApplied: /^url\("data:image\/svg/.test(String(f)), pixel, transformed, blocked, viol });

      // 仪器有效性:CSP 的拦截行为必须符合规范推演,否则读数不可信。
      R.assert(
        `[${pol.name}] 仪器有效:CSP 拦截行为符合规范推演(expectBlocked=${pol.expectBlocked})`,
        blocked === pol.expectBlocked,
        { blocked, expected: pol.expectBlocked, viol },
      );

      // 产品不变式:滤镜属性**永远**被正确设上 —— 这证明缺陷不在扩展的
      // 注册/注入路径,而在「data: URI 资源被站点策略拦掉」这一层。
      R.assert(
        `[${pol.name}] 扩展侧无误:filter 属性仍是正确的 data: URI`,
        /^url\("data:image\/svg/.test(String(f)),
        { filter: String(f).slice(0, 50) },
      );

      // 🔴 核心判据:像素必须被变换。CSP 拦截时它**失败** —— 这就是缺陷。
      R.assert(
        `[${pol.name}] 🔴 像素确实被滤镜变换了`,
        transformed,
        { pixel, original: SWATCH_RGB, blocked },
      );
    }

    // 🔴 因果锁定:在**全部**策略上,「像素未被变换」与「CSP 拦了 img-src」
    //    必须严格同真同假。唯一变量是响应头里那一行 CSP ——
    //    页面 HTML、滤镜设置、扩展产物、浏览器、视口逐字相同。
    //    这一条把根因从「相关」钉成「因果」。
    const lockstep = rows.every((r) => r.transformed === !r.blocked);
    R.assert(
      '🔴 根因锁定:「像素未变」⟺「CSP 的 img-src 拦了 data: URI」(全策略同步)',
      lockstep,
      rows.map((r) => ({ csp: r.csp ?? r.cspReportOnly ?? 'none',
        transformed: r.transformed, blocked: r.blocked })),
    );

    // Grayscale 不受影响 —— 它是 CSS 内建函数,不加载任何外部资源。
    // 这条界定了缺陷的**影响面**:受影响的恰是 ADR-002 的主业(三种辅助模式)。
    await seed(browser, settings([rule('*', 'Grayscale', 100)], true));
    {
      const worst = POLICIES.findIndex((x) => x.csp === "default-src 'self'; img-src 'none'");
      const p = await browser.newPage();
      await p.setViewport({ width: 400, height: 400 });
      await p.goto(`http://127.0.0.1:${port}/?p=${worst}`, { waitUntil: 'load', timeout: 60000 });
      const f = await waitFilter(p, (x) => /^grayscale\(/.test(x), 10000);
      await sleep(900);
      const pixel = centerPixel(
        await p.screenshot({ clip: { x: 0, y: 0, width: 200, height: 200 } }),
      );
      await p.close();
      R.assert(
        "对照:Grayscale 在 img-src 'none' 下**照常生效**(CSS 内建函数,无外部资源)",
        /^grayscale\(/.test(String(f)) &&
          JSON.stringify(pixel) !== JSON.stringify(SWATCH_RGB) &&
          pixel[0] === pixel[1] && pixel[1] === pixel[2],
        { filter: String(f), pixel },
      );
    }
  } finally {
    await browser.close();
    server.close();
  }

  R.cases.push({ policies: rows });
  return R.finish(OUT);
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
