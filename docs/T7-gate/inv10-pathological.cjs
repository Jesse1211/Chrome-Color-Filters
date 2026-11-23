// ═══════════════════════════════════════════════════════════════════════════
// T7【新增】INV-10 —— 病态模式在**真实页面加载路径上**的首帧耗时
// ═══════════════════════════════════════════════════════════════════════════
//
// §6 T7 gate 原文:
//
// > **【新增】** INV-10:**在真实页面加载路径上**用病态模式(100 个 `*`)实测
// > 首帧耗时。上游只在单元层测过匹配函数,此处首次验证它真的不拖慢页面加载
//
// 🔴 **这条为什么必须在 T7 才算验过:**
//
// T3 的门禁测的是 `matchGlob('*'.repeat(100), 'a'.repeat(1000))` 在 Node 里
// 返回得够快 —— 一个纯函数的微基准。它**没有**回答 T7 问的那个问题:
// 把 100 条这种模式塞进真实 settings 后,**真实网页的首帧**有没有被拖慢。
//
// 两者之间隔着整条真实链路:
//   (a) service worker 要为每条规则算 match pattern 并注册(ADR-062)——
//       病态模式会不会把**注册**拖垮?
//   (b) content script 在 `document_start` 要跑 `resolveRule`,它对**每条**
//       规则调一次 `matchGlob` —— 100 条病态模式 × 长 host 是否仍线性?
//   (c) 首帧(first paint)有没有因此推迟?
//
// DESIGN.md §8 第 6 条:「**INV-10 不可协商**。匹配实现必须线性时间。
// **不得**把通配符转译成可能回溯的正则」。本门禁是这条的真实栈兑现。
//
// ## 判定方法
//
// 对照组设计(单一变量):**同一个站点、同一次冷启动形状**,只换 settings。
//   - `baseline`：1 条普通规则(`*.wikipedia.org`)
//   - `pathological`：100 条规则,**每条 pattern 都是 100 个 `*`**(§6 T7 逐字)
//     外加一条命中规则,确保滤镜真的要被解析(否则匹配循环可能被短路跳过)。
//
// 首帧耗时取 `paintTiming` 的 `first-contentful-paint`(浏览器自己报的真实
// 合成时刻),并同时记 `domContentLoaded`。判据是**相对**的:病态组的 FCP
// 不得比基线组显著恶化。绝对阈值在共享 CI 机器上不稳,相对倍数才有意义;
// 另加一条绝对上限兜底(线性实现下 100×100 的匹配是微秒级,任何回溯爆炸
// 都会是秒级 —— 两档判据都能抓住它)。
//
// 用法(从仓库根):npm run build && node docs/T7-gate/inv10-pathological.cjs

const path = require('path');
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
  getWorker,
} = require('./lib7.cjs');

const OUT = path.join(__dirname, 'evidence');
const R = makeResults('inv10-pathological');

/** §6 T7 逐字:100 个 `*`。 */
const PATHO = '*'.repeat(100);
/** 规则条数上限是 20(ADR-011),故「100 条」只能靠仓储层之外播种。见下方注释。 */
const PATHO_COUNT = 100;

const SITE = 'https://en.wikipedia.org/wiki/Color_blindness';
// 🔴 轮数取 5 而非 3:paint 条目偶发缺失(见 `median` 的注释),
// 需要足够样本保证两组都各有 ≥2 个**有效** FCP 观测,否则判据会空转。
const ROUNDS = 5;

/** 读浏览器自报的首帧时刻 —— 不是我们掐表,避免仪器自身成为噪声。 */
const TIMING = `(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const paints = {};
  for (const e of performance.getEntriesByType('paint')) paints[e.name] = e.startTime;
  return {
    fcp: paints['first-contentful-paint'] ?? null,
    fp: paints['first-paint'] ?? null,
    domContentLoaded: nav.domContentLoadedEventEnd ?? null,
    responseEnd: nav.responseEnd ?? null,
  };
})()`;

/**
 * 测一轮:播种 settings → 新开 tab 导航 → 读首帧时刻 + 实际滤镜。
 * 每轮都用**新 tab**,避免复用已有的渲染进程/缓存状态影响首帧。
 */
async function measure(browser, label, ruleList) {
  await seed(browser, settings(ruleList, true));
  // 给 service worker 把声明式注册算完(ADR-062:注册发生在规则创建时)。
  const t0 = Date.now();
  const w = await getWorker(browser);
  const regs = await w.evaluate(async () => {
    const list = await chrome.scripting.getRegisteredContentScripts();
    return list.length;
  });
  const registerMs = Date.now() - t0;
  await sleep(500);

  const page = await browser.newPage();
  await page.goto(SITE, { waitUntil: 'load', timeout: 120000 });
  const filter = await waitFilter(page, (f) => f !== 'none', 8000);
  const timing = await page.evaluate(TIMING);
  await page.close();
  const row = { label, ...timing, registerMs, registrations: regs, filter };
  console.log(`  ${label}: ${JSON.stringify(row)}`);
  return row;
}

/**
 * 中位数 —— 🔴 **只接受数字,`null` 必须先被剔除并单独断言**。
 *
 * 实测踩到的仪器缺陷(本轮修复,记录在此以免后人重犯):
 * `performance.getEntriesByType('paint')` 在某些轮次里**空**,于是 `fcp` 为
 * `null`。朴素的 `median` 会把 `null` 参与排序(`null` 在数值比较里当 0),
 * 把中位数拉低 —— 于是「病态组比基线快」这种荒谬结论会让门禁**绿着空转**。
 * 更糟的情形:若病态组每轮都没观测到 paint,`pFcp` 为 `null`,
 * `null < 5000` 在 JS 里是 `true`,绝对判据也会假绿。
 *
 * 故本函数在遇到非数字时抛错,由调用方先行断言「两组都有足量有效样本」。
 */
const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) throw new Error('median: 无有效样本');
  return s[Math.floor(s.length / 2)];
};

/** 有效(非 null)样本数。 */
const validCount = (xs) => xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).length;

async function main() {
  const browser = await launch(tmpProfile('inv10'), { headless: true });
  const base = [];
  const patho = [];
  try {
    // ── 病态 settings ──────────────────────────────────────────────────
    //
    // 📌 **为什么直接播种而不经 popup UI:** ADR-011 把规则上限定死在 20 条,
    //    仓储层(T3)会拒掉第 21 条 —— 那正是 INV-7,T7 另有一条门禁验它。
    //    本门禁要的是「100 个 `*` 的病态**模式**」在加载路径上的耗时,
    //    §6 T7 的措辞是「用病态模式(100 个 `*`)」—— 病态性在**单条模式的
    //    长度**上,不在规则条数上。
    //    为了把压力加到最大,这里**同时**喂 100 条(超过 ADR-011 上限)——
    //    这是刻意构造的**超出产品可达状态**的压力场景:若连这个都线性,
    //    用户真能造出的 20 条必然更快。播种走门禁 fixture 通道
    //    (`lib.cjs` 的 `seed`,其合法性论证见该文件注释),
    //    **不代表产品允许 100 条**。
    const pathoRules = [];
    for (let i = 0; i < PATHO_COUNT; i++) pathoRules.push(rule(PATHO, 'Grayscale', 100));
    // 末尾放一条真正命中的规则:确保匹配循环必须走完全部 100 条病态模式
    // 才能命中(最坏情况),而不是提前短路。
    pathoRules.push(rule('*.wikipedia.org', 'Grayscale', 100));

    const baseRules = [rule('*.wikipedia.org', 'Grayscale', 100)];

    for (let i = 0; i < ROUNDS; i++) {
      console.log(`轮 ${i + 1}/${ROUNDS}`);
      base.push(await measure(browser, 'baseline', baseRules));
      patho.push(await measure(browser, 'pathological', pathoRules));
    }
  } finally {
    await browser.close();
  }

  // 🔴 仪器有效性先行:没有足量**有效** FCP 样本时,下面的比值与绝对判据
  // 都会假绿(`null < 5000 === true`)。故先把它断言成硬条件。
  const bValid = validCount(base.map((r) => r.fcp));
  const pValid = validCount(patho.map((r) => r.fcp));
  R.assert(
    '🔴 仪器有效性:基线组有 ≥2 个有效 FCP 观测(否则判据空转)',
    bValid >= 2,
    { validFcpSamples: bValid, rounds: ROUNDS, raw: base.map((r) => r.fcp) },
  );
  R.assert(
    '🔴 仪器有效性:病态组有 ≥2 个有效 FCP 观测(否则判据空转)',
    pValid >= 2,
    { validFcpSamples: pValid, rounds: ROUNDS, raw: patho.map((r) => r.fcp) },
  );
  if (bValid < 2 || pValid < 2) return R.finish(OUT);

  const bFcp = median(base.map((r) => r.fcp));
  const pFcp = median(patho.map((r) => r.fcp));
  const bDcl = median(base.map((r) => r.domContentLoaded));
  const pDcl = median(patho.map((r) => r.domContentLoaded));
  const pReg = median(patho.map((r) => r.registerMs));

  R.cases.push({ baseline: base, pathological: patho });
  R.cases.push({
    medians: { baselineFcp: bFcp, pathologicalFcp: pFcp, baselineDcl: bDcl, pathologicalDcl: pDcl },
  });

  // 探针有效性:两组都必须真的套上了滤镜,否则耗时对比毫无意义
  // (一个「根本没解析规则」的页面当然快)。
  R.assert(
    '探针有效:基线组真的套上了滤镜',
    base.every((r) => r.filter && r.filter !== 'none'),
    base.map((r) => r.filter),
  );
  R.assert(
    '探针有效:病态组(100 条 100 个 `*`)真的套上了滤镜',
    patho.every((r) => r.filter && r.filter !== 'none'),
    patho.map((r) => r.filter),
  );

  // 🔴 判据 1(相对):病态组 FCP 不得比基线显著恶化。
  //
  // 阈值 2.0×:真实站点的 FCP 本身抖动可达数十毫秒(网络 + 渲染),
  // 而回溯爆炸的特征是**数量级**恶化(秒级)。2× 足以区分两者,
  // 又不会被正常抖动误判。
  const ratio = bFcp > 0 ? pFcp / bFcp : Infinity;
  R.assert(
    '🔴 INV-10:病态模式下首帧耗时未显著恶化(FCP 中位数 < 2× 基线)',
    ratio < 2.0,
    { baselineFcp: bFcp, pathologicalFcp: pFcp, ratio: Math.round(ratio * 1000) / 1000 },
  );

  // 🔴 判据 2(绝对兜底):首帧绝对耗时仍在合理范围。
  //
  // 线性实现下 100 条 × 100 个 `*` 的匹配是**微秒级**;灾难性回溯会是
  // 秒级甚至挂死。5000ms 的上限对真实网络下的 wikipedia 很宽松,
  // 但对回溯爆炸来说是必然被突破的。
  R.assert(
    '🔴 INV-10:病态模式下首帧绝对耗时 < 5000ms(无灾难性回溯)',
    pFcp !== null && pFcp < 5000,
    { pathologicalFcp: pFcp },
  );

  R.assert(
    'INV-10:病态模式下 DOMContentLoaded 未显著恶化(< 2× 基线)',
    bDcl > 0 ? pDcl / bDcl < 2.0 : false,
    { baselineDcl: bDcl, pathologicalDcl: pDcl },
  );

  // 声明式注册(ADR-062)也不得被病态模式拖垮 —— 注册发生在 SW 里,
  // 虽不在页面加载路径上,但若它挂死,滤镜根本不会出现。
  R.assert(
    'ADR-062:病态模式下声明式注册仍在 2000ms 内完成',
    pReg < 2000,
    { registerMs: patho.map((r) => r.registerMs) },
  );

  // 🔴 注册**分组**在病态输入下仍正确(ADR-062/064)。
  //
  // 101 条规则(100 条病态 + 1 条命中)全是 `(Grayscale, 100)`,
  // 按 ADR-062 的「每组 `(mode, intensity)` 一条注册」应当塌缩成
  // **1 条**注册 —— 而不是 101 条。这一条值得显式断言而非默认:
  // 若实现改成「每规则一条注册」,病态输入会把注册表炸到 101 条,
  // 那是个真实的性能与配额风险,而耗时判据抓不到它(注册不在加载路径上)。
  R.assert(
    '🔴 ADR-062/064:101 条同 (mode,intensity) 规则塌缩为 1 条注册(未按规则数膨胀)',
    patho.every((r) => r.registrations === 1),
    { registrations: patho.map((r) => r.registrations) },
  );

  return R.finish(OUT);
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
