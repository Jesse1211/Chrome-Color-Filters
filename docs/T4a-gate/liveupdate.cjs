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
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔴 **ADR-075:原 (b)「模式变化 Grayscale→RedGreen」整节已删除**
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// 删的是三条断言:①「模式切换后已打开页面换成新值」②「新值形态确为
// 矩阵模式的 data: URI」③「(b) 页面未重新导航」。
//
// 理由**不是**「它变红了」,而是:`FilterMode` 现在只有 `Grayscale` 一个
// 取值(ADR-075),「用户切换滤镜模式」**已不是一个可能发生的用户动作**。
// 测一个不存在的动作是负资产 —— 尤其 ② 断言的 `data:` URI 形态连实现机制
// 都被 ADR-075 一并删掉了,留着它只会在将来加回模式时给出虚假信心。
//
// ⚠️ **强度维度的覆盖必须保留并已加强**:拖动强度滑条仍是真实用户动作,
// 是本条款现存的主要驱动源。故 (a) 增加了「形态必须是 CSS 内置
// `grayscale()`」与「变量值精确等于 grayscale(0.3)」两条,并新增 (a2)
// 再拖一档 30→75 —— 删掉的覆盖面由此在仍然存在的那个维度上补回来。
//
// (d)/(e)/(f) 的播种值从 `BlueYellow` 改成 `Grayscale`:它们断言的是
// 「加规则→上色」「主开关 OFF/ON」,与模式无关,模式只是个载荷。
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
      on: el.hasAttribute('data-ccf-on'),
      off: el.hasAttribute('data-ccf-off'),
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
  // 🔴 值的**形态**必须是 CSS 内置 `grayscale()`(ADR-075 后唯一形态),
  //    且强度确实落在新档位上 —— 只断言「变了」挡不住「变成了垃圾值」。
  log(/^grayscale\(/.test(sA.filter),
    `(a) 新值形态确为 CSS 内置 grayscale()（ADR-075:不再有 data: URI 形态）filter=${JSON.stringify(sA.filter)}`);
  log(sA.varValue === 'grayscale(0.3)',
    `(a) 强度 30 对应的变量值精确为 grayscale(0.3),实际=${JSON.stringify(sA.varValue)}`);

  // ── (a2) 再拖一档 30 → 75：强度维度是连续的，不是只有一次性切换 ──────
  //    拖动强度滑条是 ADR-075 之后**仅存**的实时更新用户动作,故多测一档。
  await push(b, settings([rule('*', 'Grayscale', 75)], true));
  const sA2 = await state(page);
  results.intensityChange2 = sA2;
  log(filtered(sA2) && sA2.varValue === 'grayscale(0.75)',
    `(a2) 强度 30→75:已打开页面再次换值,变量值=${JSON.stringify(sA2.varValue)}`);
  log(page.url() === urlBefore, '(a2) 页面未重新导航');

  // ── (c) 匹配规则被整条删除 ──────────────────────────────────────────
  await push(b, settings([], true));
  const sC = await state(page);
  results.ruleDeleted = sC;
  log(!filtered(sC),
    `(c) 规则被删除:已打开页面转为无滤镜 filter=${JSON.stringify(sC.filter)}`);
  // 🔴 预生成 CSS(ADR-063)用裸 `html` 无条件生效,只摘 data-ccf-on 压不掉它,
  //    必须显式设上 data-ccf-off(见 apply-filter.ts / filter.css)。
  log(sC.off === true && sC.on === false,
    `(c) 显式压制属性在位 on=${sC.on} off=${sC.off}`);
  log((await regIds(w)).length === 0, '(c) 对应注册已被 unregister');
  log(page.url() === urlBefore, '(c) 页面未重新导航');

  // ── (d) 重新加一条匹配规则 → 原本未滤镜的已打开页面立即上色 ──────────
  await push(b, settings([rule('*', 'Grayscale', 70)], true));
  const sD = await state(page);
  results.ruleAdded = sD;
  log(filtered(sD) && sD.on === true && sD.off === false,
    `(d) 新增规则:已打开页面立即上色 filter=${JSON.stringify(sD.filter.slice(0, 60))} on=${sD.on} off=${sD.off}`);
  log(page.url() === urlBefore, '(d) 页面未重新导航');

  // ── (e) 主开关 OFF(INV-8 在本路径同样成立) ─────────────────────────
  await push(b, settings([rule('*', 'Grayscale', 70)], false));
  const sE = await state(page);
  results.masterOff = sE;
  log(!filtered(sE) && sE.off === true,
    `(e) 主开关 OFF:已打开页面撤滤镜 filter=${JSON.stringify(sE.filter)} off=${sE.off}`);
  log((await regIds(w)).length === 0, '(e) 注册被清空（ADR-027 彻底止血）');

  // ── (f) 主开关开回 → 恢复上色 ───────────────────────────────────────
  await push(b, settings([rule('*', 'Grayscale', 70)], true));
  const sF = await state(page);
  results.masterBackOn = sF;
  log(filtered(sF) && sF.on === true && sF.off === false,
    `(f) 主开关开回:已打开页面恢复上色 filter=${JSON.stringify(sF.filter.slice(0, 60))}`);

  await page.close();
  await b.close();
  fs.rmSync(udd, { recursive: true, force: true });

  fs.writeFileSync(path.join(OUT, 'liveupdate.json'), JSON.stringify(results, null, 2));
  console.log(fail ? 'LIVEUPDATE: FAIL' : 'LIVEUPDATE: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
