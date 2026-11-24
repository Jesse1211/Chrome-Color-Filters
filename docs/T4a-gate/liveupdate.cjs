// REAL_STACK_GATE #8:🔴 已打开标签页的实时更新(DESIGN.md §6 T4a 的独立条款)。
//
// > 已打开标签页的实时更新:注册变更**不影响**已打开页面(这是 Chrome 的
// > 既定行为),故 JS content script 仍须能对已打开页面即时生效
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔴 **为什么必须有这个脚本:上一轮这条条款在真实栈上是红的,却无人测**
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// 上一轮 `injector.ts` 的 `subscribeSettings` 监听器只分支
// `if (!settings.masterEnabled)`,于是**除主开关外**的任何设置变更对
// 已打开的标签页都是 no-op。真实 Chrome 实测(标签页保持打开、不导航):
//
//   初始 Grayscale@100 → grayscale(1)
//   强度 100 → 30      → 仍 grayscale(1)   ❌
//   模式 Grayscale→RedGreen → 仍 grayscale(1)   ❌
//   规则被整条删除      → 仍 grayscale(1)   ❌(不重载撤不掉)
//   masterEnabled=false → filter:none      ✅(唯一被分支到的情况)
//
// 而注册变更**证明**不影响已打开页面,故 JS 路径是本条款**唯一**的实现机制
// —— 条款当时是不满足的。本脚本把它钉死在真实栈上。
//
// 📌 本脚本**先**断言「注册确实变了」,**再**断言「已打开页面也跟着变了」。
//    两者缺一不可:只测后者的话,一个「每次变更都强制重载所有标签页」的
//    实现也能过 —— 那会破坏用户的页面状态,不是本条款要的东西。
//
// 🔴 ADR-038:在 npm run build 产物上跑。
const path = require('path');
const os = require('os');
const fs = require('fs');
const { launch, getWorker, seed, rule, settings } = require('./lib.cjs');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const SITE = 'https://en.wikipedia.org/wiki/CSS';

let fail = false;
const log = (ok, msg) => { if (!ok) fail = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); };
const results = {};

/** 读当前页面的滤镜态 —— 计算样式 + 两个门控属性。 */
async function state(page) {
  return page.evaluate(() => {
    const el = document.documentElement;
    const cs = getComputedStyle(el);
    return {
      filter: cs.filter || '',
      // 🔴 ADR-069:门控改为 class,且**压制状态已不存在** ——
      //    摘掉 class 就等于撤除(预生成 CSS 也用 html.ccf-on)。
      //    故这里不再有 `off` 这一维:它在 ADR-069 之后恒为 false,
      //    留着会让下面那些 `off === true` 的断言永远失败或空转。
      on: el.classList.contains('ccf-on'),
      svgDefs: !!document.getElementById('ccf-svg-defs'),
      varValue: cs.getPropertyValue('--ccf-filter').trim(),
    };
  });
}

/** 推一次设置变更,并等 content script 的 onChanged 监听器跑完。 */
async function push(browser, s, settleMs = 1200) {
  await seed(browser, s);
  await new Promise((r) => setTimeout(r, settleMs));
}

async function regIds(w) {
  const regs = await w.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  return regs.map((r) => r.id).sort();
}

const filtered = (st) => st.filter !== '' && st.filter !== 'none';

(async () => {
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-live-'));
  const b = await launch(udd, { headless: true });
  const w = await getWorker(b);

  // ── 初始:Grayscale@100,打开页面并确认已上色 ────────────────────────
  await push(b, settings([rule('*', 'Grayscale', 100)], true), 1500);
  const page = await b.newPage();
  await page.goto(SITE, { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 800));

  const s0 = await state(page);
  results.initial = s0;
  log(filtered(s0) && s0.on === true,
    `初始 Grayscale@100 → 已上色 filter=${JSON.stringify(s0.filter.slice(0, 40))}`);
  const grayValue = s0.filter;

  // 🔴 从这里开始,**页面绝不重新导航**。所有变更都必须由 JS 路径生效。
  const urlBefore = page.url();

  // ── (a) 强度变化 100 → 30 ───────────────────────────────────────────
  const regsBefore = await regIds(w);
  await push(b, settings([rule('*', 'Grayscale', 30)], true));
  const regsAfter = await regIds(w);
  // 前置:注册确实被 update 了(证明「注册变更不影响已打开页」的前提成立)。
  log(JSON.stringify(regsBefore) !== JSON.stringify(regsAfter),
    `前置:注册随强度变化而变 ${JSON.stringify(regsBefore)} → ${JSON.stringify(regsAfter)}`);

  const sA = await state(page);
  results.intensityChange = sA;
  log(filtered(sA) && sA.filter !== grayValue,
    `(a) 强度 100→30:已打开页面换成新值 filter=${JSON.stringify(sA.filter.slice(0, 40))}（旧值=${JSON.stringify(grayValue.slice(0, 40))}）`);
  log(page.url() === urlBefore, '(a) 页面未重新导航（实时更新不得靠重载实现）');

  // ── (b) 模式变化 Grayscale → RedGreen ───────────────────────────────
  await push(b, settings([rule('*', 'RedGreen', 100)], true));
  const sB = await state(page);
  results.modeChange = sB;
  log(filtered(sB) && sB.filter !== sA.filter && sB.filter !== grayValue,
    `(b) 模式 Grayscale→RedGreen:已打开页面换成新值 filter=${JSON.stringify(sB.filter.slice(0, 60))}`);
  // RedGreen 走 SVG feColorMatrix 的 data: URI,灰阶走 grayscale() —— 形态可区分。
  log(sB.filter.indexOf('url(') === 0,
    `(b) 新值形态确为矩阵模式的 data: URI（不是 grayscale()）`);
  log(page.url() === urlBefore, '(b) 页面未重新导航');

  // ── (c) 匹配规则被整条删除 ──────────────────────────────────────────
  await push(b, settings([], true));
  const sC = await state(page);
  results.ruleDeleted = sC;
  log(!filtered(sC),
    `(c) 规则被删除:已打开页面转为无滤镜 filter=${JSON.stringify(sC.filter)}`);
  // 🔴 ADR-069:撤除就是**摘 class**。预生成 CSS 的选择器也是 `html.ccf-on`,
  //    摘掉 class 它一并失效 —— 不再需要任何压制规则/压制属性。
  //    连带断言 SVG 定义容器也被摘掉(T4a gate:「移除滤镜后 DOM 恢复原状,
  //    无残留节点/属性/class」)。
  log(sC.on === false && sC.svgDefs === false,
    `(c) class 与 SVG 定义均已撤除 on=${sC.on} svgDefs=${sC.svgDefs}`);
  log((await regIds(w)).length === 0, '(c) 对应注册已被 unregister');
  log(page.url() === urlBefore, '(c) 页面未重新导航');

  // ── (d) 重新加一条匹配规则 → 原本未滤镜的已打开页面立即上色 ──────────
  await push(b, settings([rule('*', 'BlueYellow', 70)], true));
  const sD = await state(page);
  results.ruleAdded = sD;
  log(filtered(sD) && sD.on === true && sD.svgDefs === true,
    `(d) 新增规则:已打开页面立即上色 filter=${JSON.stringify(sD.filter.slice(0, 60))} on=${sD.on} svgDefs=${sD.svgDefs}`);
  log(page.url() === urlBefore, '(d) 页面未重新导航');

  // ── (e) 主开关 OFF(INV-8 在本路径同样成立) ─────────────────────────
  await push(b, settings([rule('*', 'BlueYellow', 70)], false));
  const sE = await state(page);
  results.masterOff = sE;
  log(!filtered(sE) && sE.on === false && sE.svgDefs === false,
    `(e) 主开关 OFF:已打开页面撤滤镜 filter=${JSON.stringify(sE.filter)} on=${sE.on} svgDefs=${sE.svgDefs}`);
  log((await regIds(w)).length === 0, '(e) 注册被清空（ADR-027 彻底止血）');

  // ── (f) 主开关开回 → 恢复上色 ───────────────────────────────────────
  await push(b, settings([rule('*', 'BlueYellow', 70)], true));
  const sF = await state(page);
  results.masterBackOn = sF;
  log(filtered(sF) && sF.on === true && sF.svgDefs === true,
    `(f) 主开关开回:已打开页面恢复上色 filter=${JSON.stringify(sF.filter.slice(0, 60))}`);

  await page.close();
  await b.close();
  fs.rmSync(udd, { recursive: true, force: true });

  fs.writeFileSync(path.join(OUT, 'liveupdate.json'), JSON.stringify(results, null, 2));
  console.log(fail ? 'LIVEUPDATE: FAIL' : 'LIVEUPDATE: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
