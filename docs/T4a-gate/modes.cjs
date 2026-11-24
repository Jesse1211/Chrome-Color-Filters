// REAL_STACK_GATE:滤镜必须在真实 Chrome 中真正改变像素。
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔴 **ADR-075:本文件原为「四种模式都必须生效」,现缩减为「灰阶强度阶梯」**
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// 删掉的是 RedGreen / GreenRed / BlueYellow 三个模式的三组断言
// (每组:①打了门控属性 ②值形态为 `url("data:image/svg+xml...")`
//  ③computed filter 不为 none ④三个色块至少一个像素变化)。
//
// 理由**不是**它们变红了,而是这三个模式与承载它们的整套同文档 SVG /
// `data:` URI 机制都已被 ADR-075 从产品中删除 —— 断言一个不存在的模式
// 没有意义,而 ② 那条更是直接钉住了一个已被删除的实现机制。
//
// ⚠️ **保留并加强了仍然存在的那个维度**:灰阶本身。原文件对灰阶只有
// 一条「maxSpread === 0」(满强度下完全无彩),测不到任何中间档位 ——
// 而强度是 ADR-075 之后**唯一**的用户可调维度。故改为:
//   · OFF 基线必须有彩色(探针有效性);
//   · 0 / 25 / 50 / 75 / 100 五档强度,逐档断言像素落在
//     W3C Filter Effects §8.5 的 BT.709 插值理论值上(容差 ±3/255);
//   · 强度单调递增 → 彩度(maxSpread)单调不增,且首尾严格不同;
//   · 滤镜值形态必须是 CSS 内置 `grayscale()`,**不得**再出现 `url(`。
//
// 🔴 另附 **CSP 无关性**(ADR-075 判据):在 news.ycombinator.com
// (其 CSP 不放行 `data:`)上像素必须真的变灰且**零 CSP 违规** ——
// 这把「旧 CSP 缺陷已随机制删除而消失」从「未测」变成「实测」。
//
// 🔴 ADR-038:在 npm run build 产物上跑。
const fs = require('fs'), path = require('path');
const { PNG } = require('pngjs');
const { launch, seed, rule, settings } = require('./lib.cjs');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });

let fail = false;
const log = (ok, msg) => { if (!ok) fail = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); };

// 三个饱和色块。注入在视口左上角并绝对定位,确保恰好落在采样 clip 内
// (实测曾因站点自身背景把采样点打成 [34,34,34])。
const SWATCHES = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];

function stats(buf) {
  const p = PNG.sync.read(Buffer.from(buf));
  let maxSpread = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    const s = Math.max(p.data[i], p.data[i + 1], p.data[i + 2])
      - Math.min(p.data[i], p.data[i + 1], p.data[i + 2]);
    if (s > maxSpread) maxSpread = s;
  }
  const px = [];
  for (const y of [50, 150, 250]) {
    const idx = (p.width * y + 100) * 4;
    px.push([p.data[idx], p.data[idx + 1], p.data[idx + 2]]);
  }
  return { maxSpread, px };
}

/**
 * `grayscale(amount)` 的理论值 —— W3C Filter Effects Level 1 §8.5:
 * 在恒等矩阵与 BT.709 全灰矩阵之间按 amount 线性插值。
 * ADR-075 正是以此论证「与 toColorMatrix('Grayscale', n) 数学等价」,
 * 故本门禁直接拿这个闭式解当预言机,而不是比对另一份实现。
 */
function expectGrayscale([r, g, b], amount) {
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [r, g, b].map((c) => Math.round(c + (L - c) * amount));
}

function inject(page) {
  return page.evaluate(() => {
    document.documentElement.style.margin = '0';
    document.body.style.margin = '0';
    const host = document.createElement('div');
    host.id = '__mode_fixture';
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;margin:0;padding:0';
    host.innerHTML = '<div style="width:200px;height:100px;background:#ff0000"></div>'
      + '<div style="width:200px;height:100px;background:#00ff00"></div>'
      + '<div style="width:200px;height:100px;background:#0000ff"></div>';
    document.body.appendChild(host);
  });
}

const INTENSITIES = [0, 25, 50, 75, 100];

(async () => {
  const report = {};
  const udd = path.join(OUT, 'modes'); fs.rmSync(udd, { recursive: true, force: true });
  const b = await launch(udd, { headless: true });
  try {
    const page = await b.newPage();

    // ── 1. OFF 基线 + 灰阶强度阶梯 ────────────────────────────────────
    for (const step of ['OFF', ...INTENSITIES]) {
      if (step === 'OFF') await seed(b, settings([], true));
      else await seed(b, settings([rule('*', 'Grayscale', step)], true));
      // data: URL 上 content script 不运行,故用一个真实 http 源。
      await page.goto('https://example.com/', { waitUntil: 'networkidle2', timeout: 90000 });
      await inject(page);
      await new Promise((r) => setTimeout(r, 500));
      const st = await page.evaluate(() => ({
        attr: document.documentElement.hasAttribute('data-ccf-on'),
        v: document.documentElement.style.getPropertyValue('--ccf-filter'),
        computed: getComputedStyle(document.documentElement).filter,
      }));
      const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 200, height: 300 } });
      fs.writeFileSync(path.join(OUT, `gray-${step}.png`), Buffer.from(shot));
      report[step] = { ...st, ...stats(shot) };
      console.log(step, JSON.stringify(report[step]));
    }

    const off = report.OFF;
    log(!off.attr && off.maxSpread > 0,
      `OFF 基线:无门控属性且画面有彩色 attr=${off.attr} maxSpread=${off.maxSpread}`);

    for (const n of INTENSITIES) {
      const r = report[n];
      log(r.attr, `@${n} 门控属性在位`);
      // 🔴 形态判据:ADR-075 后只能是 CSS 内置函数,绝不能再出现 url(...)。
      log(/^grayscale\(/.test(r.v) && !r.v.includes('url('),
        `@${n} 值形态为 CSS 内置 grayscale()、不含 url( —— 实际=${JSON.stringify(r.v)}`);
      // 像素必须落在 BT.709 插值理论值上。
      const amount = n / 100;
      const bad = r.px.map((got, i) => {
        const want = expectGrayscale(SWATCHES[i], amount);
        const dev = Math.max(...got.slice(0, 3).map((c, k) => Math.abs(c - want[k])));
        return dev <= 3 ? null : `块${i} 实测=${JSON.stringify(got)} 理论=${JSON.stringify(want)} 偏差=${dev}`;
      }).filter(Boolean);
      log(bad.length === 0,
        `@${n} 三个色块像素均落在 BT.709 插值理论值上(±3)${bad.length ? ' —— ' + bad.join('; ') : ''}`);
    }

    // 彩度随强度单调不增,且 0 与 100 严格不同(强度维度真的有效)。
    const spreads = INTENSITIES.map((n) => report[n].maxSpread);
    log(spreads.every((s, i) => i === 0 || s <= spreads[i - 1]),
      `彩度随强度单调不增 ${JSON.stringify(spreads)}`);
    log(spreads[0] > spreads[spreads.length - 1],
      `强度两端严格不同 @0=${spreads[0]} > @100=${spreads[spreads.length - 1]}`);
    log(report[100].maxSpread === 0, `@100 完全无彩 maxSpread=${report[100].maxSpread}`);

    // ── 2. 🔴 CSP 无关性(ADR-075)──────────────────────────────────────
    // news.ycombinator.com 的 CSP 不放行 `data:`。旧机制在此**静默全死**
    // (像素与关闭态完全相同、无任何报错)。`grayscale()` 是 CSS 内置函数,
    // 不产生资源加载,CSP 无从拦截 —— 实测而非推断。
    const violations = [];
    page.on('console', (m) => {
      const t = m.text();
      if (/Content Security Policy|Refused to load/i.test(t)) violations.push(t);
    });

    await seed(b, settings([], true));
    await page.goto('https://news.ycombinator.com/', { waitUntil: 'networkidle2', timeout: 90000 });
    await inject(page);
    await new Promise((r) => setTimeout(r, 500));
    const hnOff = stats(await page.screenshot({ clip: { x: 0, y: 0, width: 200, height: 300 } }));

    await seed(b, settings([rule('*', 'Grayscale', 100)], true));
    await page.goto('https://news.ycombinator.com/', { waitUntil: 'networkidle2', timeout: 90000 });
    await inject(page);
    await new Promise((r) => setTimeout(r, 500));
    const hnShot = await page.screenshot({ clip: { x: 0, y: 0, width: 200, height: 300 } });
    fs.writeFileSync(path.join(OUT, 'gray-hn-csp.png'), Buffer.from(hnShot));
    const hnOn = stats(hnShot);
    const hnState = await page.evaluate(() => ({
      attr: document.documentElement.hasAttribute('data-ccf-on'),
      v: document.documentElement.style.getPropertyValue('--ccf-filter'),
      computed: getComputedStyle(document.documentElement).filter,
    }));
    report.hnCSP = { off: hnOff, on: hnOn, ...hnState, violations };
    console.log('hn-csp', JSON.stringify(report.hnCSP));

    log(hnOff.maxSpread > 0, `CSP 站点 OFF 基线有彩色 maxSpread=${hnOff.maxSpread}`);
    log(hnOn.maxSpread === 0,
      `🔴 CSP 站点(不放行 data:)上灰阶像素真的生效 maxSpread=${hnOn.maxSpread}(OFF 时=${hnOff.maxSpread})`);
    log(hnState.computed !== 'none',
      `CSP 站点 computed filter=${hnState.computed}(不为 none)`);
    log(violations.length === 0,
      `🔴 零 CSP 违规,实测 ${violations.length} 条${violations.length ? ': ' + JSON.stringify(violations.slice(0, 3)) : ''}`);
  } finally { await b.close(); }

  fs.writeFileSync(path.join(OUT, 'modes.json'), JSON.stringify(report, null, 2));
  console.log(fail ? 'MODES: FAIL' : 'MODES: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
