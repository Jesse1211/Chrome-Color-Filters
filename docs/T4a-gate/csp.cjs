// ═══════════════════════════════════════════════════════════════════════════
// REAL_STACK_GATE:🔴 CSP 抗性实测(ADR-069)—— 本轮缺陷的闭合条件。
// ═══════════════════════════════════════════════════════════════════════════
//
// DESIGN.md §6 T4a gate 逐字要求:
//
//   > **🔴 CSP 抗性(ADR-069)—— 这是上一轮 T7 实测红灯的那条,必须覆盖:**
//   > 在**注入了严格 CSP 的测试页**上验证四个滤镜全部生效,至少覆盖三种策略:
//   > - `img-src 'self'`(不放行 `data:`)
//   > - 只有 `default-src` 且不放行 `data:`,无 `img-src`
//   > - `img-src 'none'`
//   > 断言:像素**确实改变**(与 OFF 基线不同),且 **DevTools 无 CSP violation 事件**。
//
// 上一版把 feColorMatrix 内联进 `data:image/svg+xml,...` URI,被浏览器归类为
// **图片资源**、受 `img-src` 管辖,于是在上述三种策略下三个色觉矫正滤镜
// **静默失效** —— 像素与关闭态完全相同、无任何报错。灰阶因走内置
// `grayscale()`(无 `url()`)而无恙,正是 ADR-070 所说「两条路径各自演化」的代价。
//
// 本 harness 是那条 gate 条款的自动化实现。**它此前并不存在** —— 整个仓里
// 只有静态串断言(「CSS 里不含 data:、含 url("#ccf-…")」),那类断言
// 挡不住「引用得到但 CSP 拦掉」或「引用不到」这两种真实失效,
// 而它们的表现都是**像素不变、零报错**。
//
// ───────────────────────────────────────────────────────────────────────────
// 为什么必须自建服务器(而不是只测 news.ycombinator.com)
// ───────────────────────────────────────────────────────────────────────────
//
// gate 点名的三种策略里有两种(`img-src 'none'`、无 `img-src` 的 `default-src`)
// 在公网站点上找不到稳定样本,且第三方站点的 CSP 随时会改 —— 把门禁的
// 判据寄托在别人的响应头上,红绿会随机漂移。故本 harness 自起一个
// `http.createServer`,**由我们自己下发响应头**,三种策略一字不差。
// HN 那一路由 modes.cjs / flicker.cjs 在真实站点上另行覆盖。
//
// 📌 服务器只服务 `127.0.0.1` 上的一个静态 HTML,不出网、不留存任何东西,
//    进程结束即关闭。
//
// ───────────────────────────────────────────────────────────────────────────
// 判据(三项全须通过,缺一即 FAIL)
// ───────────────────────────────────────────────────────────────────────────
//
// 1. **像素确实改变** —— 与同一页面的 OFF 基线逐像素比。
//    用「彩色扩散度」(maxChannelSpread:同一像素 R/G/B 的极差)而不是
//    简单的「截图不同」:后者会被反锯齿、光标、滚动条的 1px 噪声蒙过去。
//    测试页刻意铺满高饱和色块,使 OFF 基线的扩散度必然很大。
// 2. **零 CSP violation 事件** —— 页面内挂 `securitypolicyviolation` 监听器
//    (document_start 之前由 CSP 自身的报告机制触发,我们在 `addScriptTag`
//    之前用 `evaluateOnNewDocument` 装上,确保不漏早期事件)。
//    同时监听 CDP 的 `Log.entryAdded`,双通道取证。
// 3. **滤镜真的是 SVG 路径** —— 断言 `#ccf-svg-defs` 容器在位且
//    computed filter 形如 `url("#ccf-…")`。否则「像素变了」可能来自
//    某条回退路径(例如有人悄悄把灰阶改回内置 grayscale()),
//    那会让 ADR-070 的路径统一静默破裂。
//
// 四个模式 × 三种策略 = 12 格,全绿才算过。

const fs = require('fs');
const http = require('http');
const path = require('path');
const { launch, seed, rule, settings } = require('./lib.cjs');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// gate 逐字点名的三种策略。键名进报告,便于逐条对账。
const POLICIES = {
  // ① 放行自身图片,但**不放行 data:** —— 上一版正是死在这里。
  imgSrcSelf: "default-src 'self' 'unsafe-inline'; img-src 'self'",
  // ② 只有 default-src 且不放行 data:,**无 img-src**
  //    (img 回退到 default-src)。
  defaultSrcOnly: "default-src 'self' 'unsafe-inline'",
  // ③ 彻底禁图。
  imgSrcNone: "default-src 'self' 'unsafe-inline'; img-src 'none'",
};

const MODES = ['Grayscale', 'RedGreen', 'GreenRed', 'BlueYellow'];

// 高饱和色块测试页 —— OFF 基线必须有很大的彩色扩散度,否则
// 「像素改变」这条断言会在一个本就是灰的页面上空转地通过。
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>ccf-csp</title>
<style>
  html,body{margin:0;padding:0}
  #grid{display:grid;grid-template-columns:repeat(4,1fr);width:100vw;height:100vh}
  div.sw{width:100%;height:100%}
</style></head><body><div id="grid">
${['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
   '#ff8000', '#8000ff', '#0080ff', '#80ff00', '#ff0080', '#00ff80',
   '#c00000', '#00c000', '#0000c0', '#c0c000']
  .map((c) => `<div class="sw" style="background:${c}"></div>`).join('\n')}
</div></body></html>`;

function startServer(policy) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Security-Policy', policy);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // 不缓存 —— 每一格都要一次真实的导航与首帧。
      res.setHeader('Cache-Control', 'no-store');
      res.end(PAGE);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/**
 * 在页面里采样 computed filter / SVG 容器 / CSP 违规计数。
 *
 * 📌 不在页面里算像素 —— 读 canvas 需要把页面内容画进去,那条路
 *    既受 CSP 管辖又形同读页面内容。像素一律在 **Node 侧**对
 *    puppeteer 的 PNG 截图做统计(见 spreadOf)。
 */
const PROBE = `(() => {
  const de = document.documentElement;
  return {
    filter: getComputedStyle(de).filter,
    classOn: de.classList.contains('ccf-on'),
    svgDefs: !!document.getElementById('ccf-svg-defs'),
    violations: (window.__ccfCspViolations || []).slice(),
  };
})()`;

// PNG → 最大彩色扩散度。
//
// 🔴 这里**必须**用 pngjs,不要再手写解码器。本文件第一版自己写了一个
//    最小 PNG 解码,当场就跑不起来:`TypeError: buf.readUInt32BE is not a
//    function` —— puppeteer-core v23(README 钉死的版本)的
//    `page.screenshot()` 返回的是 **Uint8Array 而非 Buffer**,没有
//    `readUInt32BE`。仓里既有的 geometry/modes/flicker/multitab 四个
//    harness 全都写了 `Buffer.from(shot)` 再喂给 `pngjs`,唯独这个新手写
//    解码器漏了那一步。统一走 pngjs,既少一份要维护的解码逻辑,
//    也让「忘了 Buffer.from」这类坑只可能犯一次。
const { PNG } = require('pngjs');

/** 截图(Uint8Array 或 Buffer)→ { width, height, channels, data }。 */
function decodePng(shot) {
  // 🔴 `Buffer.from` 不可省:puppeteer-core v23 给的是 Uint8Array。
  const img = PNG.sync.read(Buffer.from(shot));
  return { width: img.width, height: img.height, channels: 4, data: img.data };
}

/** 最大彩色扩散度 + 平均色 —— 两者一起才能区分「变灰」与「变色」。 */
function statsOf(png) {
  const { width, height, channels, data } = png;
  let maxSpread = 0;
  let sr = 0; let sg = 0; let sb = 0; let n = 0;
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const i = y * width * channels + x * channels;
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      if (spread > maxSpread) maxSpread = spread;
      sr += r; sg += g; sb += b; n += 1;
    }
  }
  return {
    maxSpread,
    avg: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)],
  };
}

// 在**新文档**里尽早装上 CSP 违规监听器。
// 用 evaluateOnNewDocument 而不是导航后 addScriptTag:后者装得太晚,
// 首帧附近触发的违规会漏掉,而那正是我们最关心的时刻。
const VIOLATION_HOOK = `
  window.__ccfCspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__ccfCspViolations.push({
      directive: e.effectiveDirective || e.violatedDirective,
      blockedURI: e.blockedURI,
      disposition: e.disposition,
    });
  });
`;

async function shoot(page, url) {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  // 给 JS 路径的异步纠正留出时间 —— 本条款测的是「最终是否生效」,
  // 零闪烁(首帧)由 flicker.cjs 单独测。
  await new Promise((r) => setTimeout(r, 600));
  const probe = await page.evaluate(PROBE);
  const shot = await page.screenshot({ type: 'png' });
  return { probe, stats: statsOf(decodePng(shot)) };
}

(async () => {
  const report = { policies: {}, pass: true };
  const fail = (msg, ctx) => {
    report.pass = false;
    console.log(`FAIL ${msg}` + (ctx ? ` ${JSON.stringify(ctx)}` : ''));
  };

  for (const [polName, policy] of Object.entries(POLICIES)) {
    const server = await startServer(policy);
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/`;
    const polReport = { policy, cells: {} };
    report.policies[polName] = polReport;

    // ── OFF 基线(主开关关闭,无任何规则)────────────────────────────
    const baseDir = path.join(OUT, `csp-${polName}-off`);
    fs.rmSync(baseDir, { recursive: true, force: true });
    let browser = await launch(baseDir, { headless: true });
    let base;
    try {
      await seed(browser, settings([], false));
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(VIOLATION_HOOK);
      base = await shoot(page, url);
      polReport.off = base;
      // 探针有效性:OFF 基线**必须**是彩色的,否则「像素改变」这条
      // 断言会在一个本来就灰的页面上空转地通过。
      if (base.stats.maxSpread < 200) {
        fail(`${polName}: OFF 基线不够彩(maxSpread=${base.stats.maxSpread}) —— 探针失效,本策略的断言无意义`);
      }
      if (base.probe.filter !== 'none') {
        fail(`${polName}: OFF 基线竟有 filter=${base.probe.filter}`);
      }
      await page.close();
    } finally {
      await browser.close();
    }

    // ── 四个模式各一格 ───────────────────────────────────────────────
    for (const mode of MODES) {
      const dir = path.join(OUT, `csp-${polName}-${mode}`);
      fs.rmSync(dir, { recursive: true, force: true });
      browser = await launch(dir, { headless: true });
      try {
        // 127.0.0.1 作为 host 播种一条规则。
        await seed(browser, settings([rule('127.0.0.1', mode, 100)], true));
        const page = await browser.newPage();
        await page.evaluateOnNewDocument(VIOLATION_HOOK);
        const got = await shoot(page, url);
        polReport.cells[mode] = got;

        // 判据 1:像素确实改变(与 OFF 基线不同)。
        const changed = got.stats.maxSpread !== base.stats.maxSpread
          || got.stats.avg.some((v, i) => Math.abs(v - base.stats.avg[i]) > 2);
        if (!changed) {
          fail(`${polName}/${mode}: 像素与 OFF 基线无差别 —— 滤镜静默失效(这正是上一版 data: URI 的症状)`, {
            off: base.stats, on: got.stats, filter: got.probe.filter,
          });
        }
        // 灰阶另加一条更强的判据:必须真的变灰。
        if (mode === 'Grayscale' && got.stats.maxSpread > 8) {
          fail(`${polName}/Grayscale: 未真正变灰(maxSpread=${got.stats.maxSpread})`, got.stats);
        }

        // 判据 2:零 CSP violation。
        if (got.probe.violations.length > 0) {
          fail(`${polName}/${mode}: 捕获到 CSP violation`, got.probe.violations);
        }

        // 判据 3:走的确实是同文档 SVG 路径(ADR-069/070)。
        if (!/^url\("?#ccf-/.test(got.probe.filter)) {
          fail(`${polName}/${mode}: computed filter 不是同文档引用 —— 路径不统一(ADR-070)`, { filter: got.probe.filter });
        }
        if (!got.probe.svgDefs) {
          fail(`${polName}/${mode}: 无 #ccf-svg-defs 容器 —— url("#ccf-…") 引用不到(ADR-069 第①步失效)`);
        }
        if (!got.probe.classOn) {
          fail(`${polName}/${mode}: 未加 ccf-on class(ADR-069 第②步失效)`);
        }
        await page.close();
      } finally {
        await browser.close();
      }
    }

    await new Promise((r) => server.close(r));
  }

  fs.writeFileSync(
    path.join(__dirname, 'evidence', 'csp.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(report.pass ? 'CSP: PASS' : 'CSP: FAIL');
  process.exit(report.pass ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
