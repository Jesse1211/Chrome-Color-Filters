// 🔴 T7【新增】INV-6 端到端 —— DESIGN.md §6 T7 gate 原文:
//
//   > **【新增】** INV-6:**端到端**验证优先级 —— popup 里建两条规则
//   > `[x.com→Gray@100, *→Gray@30]`,真实打开 x.com 得 100 档、其他站得 30 档。
//   > 上游只在单元层验过 `resolveRule`,此处首次验证「UI 建的规则 → 实际渲染」整条链路
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ## 这条门禁为什么不平凡(它要抓的真实风险)
//
// ADR-062 的声明式注册**按 (mode,intensity) 分组**,不按 host。
// `[x.com@100, *@30]` 于是产生**两条**注册:
//   ccf-gray-100 → matches ["*://x.com/*"]
//   ccf-gray-30  → matches ["*://*/*"]
// 在 x.com 上**两张预生成 CSS 都会注入**,而它们都是裸 `html` + `!important`
// (reconcile.ts 自己记载了这一点:「真正的『谁赢』由 JS 路径的 resolveRule 判定」)。
// 也就是说「谁赢」在 CSS 层面是层叠顺序决定的,**不是** INV-6 决定的 ——
// 本门禁要验的正是最终渲染确实回到 INV-6 的权威判定上。
//
// ## 探针有效性(负向对照)
//
// 三道,缺一不可:
//   N1 两条规则**顺序颠倒**(`[*@30, x.com@100]`)时,x.com 必须得 30 ——
//      若两种顺序都得 100,说明判据与「首个命中」无关,门禁空转。
//   N2 无规则时 x.com 必须 `none` —— 证明 100 不是页面自带的。
//   N3 两个强度档必须**可区分**(0.3 ≠ 1),且逐位等于 grayscale(intensity/100)。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const fs = require('fs');
const path = require('path');
const L = require('./lib7.cjs');

// 「其他站」取两个:一个轻量稳定(example.com),一个真实内容站(hn)。
const OTHER = {
  example: 'https://example.com/',
  hn: 'https://news.ycombinator.com/',
};
const XCOM = 'https://x.com/';

async function readRules(browser) {
  const s = await L.readPersisted(browser);
  return (s?.rules ?? []).map((r) => `${r.pattern}@${r.mode}@${String(r.intensity)}`);
}

/** 打开一个 tab,等 filter 稳定(JS 路径已落定),返回 computed filter。 */
async function filterOf(browser, url, shotName) {
  const page = await browser.newPage();
  let f = 'none';
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    // 等到 **稳定态**:连续 3 次读到同一个值,或 8 秒超时。
    let last = null, stable = 0;
    for (let i = 0; i < 80; i++) {
      const cur = await L.computedFilter(page);
      if (cur === last) { stable++; if (stable >= 3) break; } else { stable = 0; last = cur; }
      await new Promise((r) => setTimeout(r, 100));
    }
    f = await L.computedFilter(page);
    if (shotName) {
      const buf = await page.screenshot();
      fs.writeFileSync(path.join(L.OUT, shotName), Buffer.from(buf));
    }
  } finally { await page.close(); }
  return f;
}

(async () => {
  const results = { clause: 'T7【新增】INV-6 端到端(UI 建规则 → 实际渲染)', assertions: [], data: {}, pass: true };
  const assert = L.makeAsserter(results);

  const udd = path.join(L.OUT, 'udd-inv6');
  fs.rmSync(udd, { recursive: true, force: true });
  // 🔴 **必须 headful**(实测结论,不是偏好):
  //    x.com 对**新 headless** 的 Chrome for Testing 返回 **HTTP 403**
  //    (机器人识别),页面变成 `chrome-error://chromewebdata/` ——
  //    那是浏览器错误页,**任何**扩展都注入不进去,`filter` 恒为 `none`。
  //    于是整条断言会在一个「产品根本没机会运行」的环境里报红,
  //    那是环境失败,不是产品失败。headful 下同一 URL 返回 200、
  //    滤镜正确生效(实测 `grayscale(0.3)` + `data-ccf-on`)。
  //    headful 在本机不产合成帧(见 T4a/lib.cjs 的长注释),但本门禁
  //    判据是 **computed filter**,不依赖逐帧合成,故不受影响。
  let browser = await L.launch(udd, { headless: false });

  try {
    const id = await L.extensionId(browser);
    results.data.extensionId = id;

    // ── N2 负向对照:无任何规则 → x.com 必须未滤镜 ─────────────────────
    const baselineX = await filterOf(browser, XCOM, 'inv6-baseline-x.png');
    assert('N2 负向对照:无规则时 x.com 未滤镜(证明后面的 grayscale(1) 不是页面自带)',
      baselineX === 'none', { baselineX });

    // ── 通过 popup UI 建两条规则(顺序即优先级,ADR-008)────────────────
    const popup = await L.openPopup(browser, id);
    const r1 = await L.createRuleViaUI(popup, 'x.com', 100);
    const r2 = await L.createRuleViaUI(popup, '*', 30);
    results.data.sliderShown = { rule1: r1.shown, rule2: r2.shown };
    const count = await L.textOf(popup, 'rule-count');
    const listed = await popup.$$eval('[data-testid^="rule-pattern-"]',
      (els) => els.map((e) => e.textContent));
    await L.closePopup(popup);

    const persisted = await readRules(browser);
    results.data.persistedRules = persisted;
    assert('规则确实由 UI 创建并落盘,且顺序为 [x.com@100, *@30]',
      persisted.length === 2 && persisted[0] === 'x.com@Grayscale@100' && persisted[1] === '*@Grayscale@30',
      { persisted, count, listed });

    // ── 正向:x.com 得 100 档,其他站得 30 档 ──────────────────────────
    const xFilter = await filterOf(browser, XCOM, 'inv6-x-100.png');
    assert('🔴 真实打开 x.com → grayscale(1)(100 档,首个命中胜)',
      xFilter === 'grayscale(1)', { xFilter, expected: 'grayscale(1)' });

    const others = {};
    for (const [k, url] of Object.entries(OTHER)) {
      others[k] = await filterOf(browser, url, `inv6-${k}-30.png`);
      assert(`🔴 真实打开 ${k}(${url}) → grayscale(0.3)(30 档)`,
        others[k] === 'grayscale(0.3)', { got: others[k], expected: 'grayscale(0.3)' });
    }
    results.data.forward = { xFilter, others };

    // N3:两档必须可区分,且逐位等于 grayscale(intensity/100)。
    assert('N3 两个强度档可区分且逐位等于 grayscale(intensity/100)',
      xFilter !== others.example && xFilter === 'grayscale(1)' && others.example === 'grayscale(0.3)',
      { x: xFilter, other: others.example });

    // ── N1 负向对照:把顺序颠倒,x.com 必须改判为 30 档 ────────────────
    // 🔴 这是本门禁**唯一**能证明「判据真的取决于首个命中」的办法。
    //    重排走**真实 UI 路径**:聚焦第 2 行的拖柄,按 ↑ 键
    //    (ADR-023 明文:拖柄「提供 ↑/↓ 重排(拖拽对键盘不可达)」)。
    //    选它而不选 HTML5 拖拽,是因为 DnD 在 CDP 下不可靠 —— 而这条
    //    键盘路径与拖拽**共用同一个** commitOrder → onReorderRules → 仓储层,
    //    落盘路径逐字相同(RuleListView 的 `move`)。
    const popup2 = await L.openPopup(browser, id);
    await popup2.waitForSelector('[data-testid="rule-grip-1"]:not([disabled])', { timeout: 20000 });
    await popup2.focus('[data-testid="rule-grip-1"]');
    await popup2.keyboard.press('ArrowUp');
    // 等落盘(ADR-061:重排松手即写入,不防抖)。
    await popup2.waitForFunction(
      () => document.querySelector('[data-testid="rule-pattern-0"]')?.textContent === '*',
      { timeout: 20000 },
    );
    await L.closePopup(popup2);

    const reordered = await readRules(browser);
    results.data.reorderedRules = reordered;
    assert('N1 前置条件:顺序已颠倒为 [*@30, x.com@100]',
      reordered.length === 2 && reordered[0] === '*@Grayscale@30' && reordered[1] === 'x.com@Grayscale@100',
      { reordered });

    const xReordered = await filterOf(browser, XCOM, 'inv6-x-reordered-30.png');
    assert('🔴 N1 负向对照:顺序颠倒后 x.com 改判为 grayscale(0.3) —— 判据确实取决于首个命中',
      xReordered === 'grayscale(0.3)', { xReordered, expected: 'grayscale(0.3)' });
    results.data.reverse = { xReordered };

  } finally {
    await browser.close();
  }

  L.writeJson('inv6-e2e.json', results);
  console.log(`\n${results.pass ? 'PASS' : 'FAIL'} — T7 INV-6 端到端`);
  process.exit(results.pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
