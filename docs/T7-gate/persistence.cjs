// ═══════════════════════════════════════════════════════════════════════════
// T7【新增】持久化(ADR-010)—— 配置规则 → 完全退出 Chrome 并重启 → 规则与顺序完好
// ═══════════════════════════════════════════════════════════════════════════
//
// §6 T7 gate 原文:
//
// > **【新增】** 持久化(ADR-010):配置规则 → **完全退出 Chrome 并重启** →
// > 规则与顺序完好。改用 `storage.local` 后这是持久化的完整验收面,
// > **无需第二个 Google 账号**
//
// 🔴 **这条为什么必须在 T7 才算验过:**
//
// 上游的持久化测试跑在 `MemoryStorageArea`(`src/storage/memory-storage-area.ts`)
// 或 jsdom 里 —— 那里**没有「进程」这个概念**,「重启」无从复现。
// ADR-010 的全部收益就是「验收从『需两个 Google 账号』变成『重启浏览器配置还在』」,
// 而那句话只有真实退出并重启浏览器进程才能兑现。
//
// ## 关键点:规则**顺序**必须完好,不只是集合完好
//
// 顺序即优先级(ADR-008/INV-6)。一个「规则都在但顺序乱了」的持久化
// 等于**静默改变了实际生效的滤镜**(ADR-061 的实测教训正是这个)。
// 故本门禁断言的是 `JSON.stringify(rules)` 的**逐字相等**,不是集合相等。
//
// ## 规则全部经真实 popup UI 建立
//
// 包括一次**拖拽重排**(ADR-061:松手即写入,不走防抖)——
// 重排后立刻关闭浏览器,验证那 300ms 的丢失窗口真的不存在。
//
// 用法(从仓库根):npm run build && node docs/T7-gate/persistence.cjs

const path = require('path');
const {
  makeResults,
  tmpProfile,
  launch,
  seed,
  settings,
  popupUrl,
  openPopup,
  siteTabOf,
  waitNotSkeleton,
  createRuleViaUI,
  readSettings,
  probe,
  clickTestid,
  exists,
  filterOf,
  waitFilter,
  sleep,
  getWorker,
} = require('./lib7.cjs');

const OUT = path.join(__dirname, 'evidence');
const R = makeResults('persistence');

/**
 * 经 UI 建这几条,顺序与内容都要在重启后完好。
 *
 * 📌 **`*` 刻意放在第一条**,这样最后那条 `*.wikipedia.org` 在 wikipedia
 *    标签页上就处于「命中但**被遮蔽**」状态 —— 而「置顶」一键修复
 *    (`move-to-top`)**只在被遮蔽时才渲染**(见 `RuleEditView.tsx`:
 *    `status.kind === 'shadowed'` 才出 `shadow-box`)。
 *    本脚本第一版把 `*` 放在最后,于是没有任何规则被遮蔽、
 *    `move-to-top` 永不出现,重排那两条断言直接判红 ——
 *    那是**门禁自身**的构造错误,不是产品缺陷(实测踩过)。
 */
const PLAN = [
  { pattern: '*', mode: 'Grayscale', intensity: 25 },
  { pattern: 'news.ycombinator.com', mode: 'RedGreen', intensity: 75 },
  { pattern: 'example.com', mode: 'BlueYellow', intensity: 60 },
  { pattern: '*.github.com', mode: 'GreenRed', intensity: 40 },
  { pattern: '*.wikipedia.org', mode: 'Grayscale', intensity: 100 },
];
/** PLAN 中被遮蔽的那条的索引(在 wikipedia 标签页上)。 */
const SHADOWED_INDEX = 4;

async function main() {
  const profile = tmpProfile('persist');
  let browser = await launch(profile, { headless: true });
  let before = null;
  try {
    await seed(browser, settings([]));
    const site = await browser.newPage();
    await site.goto('https://en.wikipedia.org/wiki/Color_blindness', {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    });
    const siteTab = await siteTabOf(browser, 'wikipedia.org');
    const popup = await openPopup(browser, await popupUrl(browser), siteTab);
    await waitNotSkeleton(popup);

    /* ═══════════ 1. 经真实 popup UI 建 5 条规则 ═══════════ */
    for (const p of PLAN) await createRuleViaUI(popup, p);

    const built = await readSettings(browser);
    R.assert(
      '经 UI 建出 5 条规则',
      built.rules.length === PLAN.length,
      { count: built.rules.length },
    );
    R.assert(
      'UI 写出的 pattern/mode/intensity 与所填一致',
      PLAN.every(
        (p, i) =>
          built.rules[i].pattern === p.pattern &&
          built.rules[i].mode === p.mode &&
          built.rules[i].intensity === p.intensity,
      ),
      built.rules,
    );

    /* ═══════════ 2. 经 UI 做一次重排(ADR-061:松手即写入)═══════════ */
    //
    // 用「置顶」按钮(`move-to-top`)作为重排动作 —— 它走的是与拖拽松手
    // **同一条**写入路径(`replaceRules`),且在自动化里可靠可点
    // (拖拽的 HTML5 DnD 在无头环境里不可合成)。
    // 📌 本门禁验的是「重排结果是否持久化」,不是拖拽手势本身的识别
    //    —— 手势层属 T6a 的门禁。
    let reordered = false;
    await clickTestid(popup, `rule-open-${SHADOWED_INDEX}`, 500);
    const statusLine = await probe(popup, 'status-line');
    R.assert(
      '前提:末条规则在 wikipedia 页上确为「被遮蔽」(§5.6)',
      statusLine !== null && statusLine.dataset.kind === 'shadowed',
      statusLine && statusLine.dataset,
    );
    if (await exists(popup, 'move-to-top')) {
      await clickTestid(popup, 'move-to-top', 800);
      reordered = true;
    }
    R.assert(
      '经 UI 触发一次重排(走 replaceRules,与拖拽松手同一写入路径)',
      reordered,
      { reordered },
    );

    // 🔴 ADR-061:重排后**立即**关浏览器,不留任何等待窗口。
    //    若实现对写入做了防抖(ADR-061 明确禁止),这里必然丢顺序。
    before = await readSettings(browser);
    R.cases.push({ step: '重排后、关闭前的持久化内容', rules: before.rules });
    R.assert(
      '重排确实改变了顺序(探针有效)',
      JSON.stringify(before.rules) !== JSON.stringify(built.rules),
      { beforeReorder: built.rules.map((r) => r.pattern), afterReorder: before.rules.map((r) => r.pattern) },
    );

    /* ═══════════ 3. 完全退出 Chrome ═══════════ */
    await browser.close();
    await sleep(2000);

    /* ═══════════ 4. 重启 → 规则与顺序完好 ═══════════ */
    browser = await launch(profile, { headless: true });
    const after = await readSettings(browser);

    R.assert(
      '🔴 ADR-010:完全退出并重启 Chrome 后,规则仍在(storage.local 持久化)',
      after !== null && Array.isArray(after.rules) && after.rules.length === PLAN.length,
      { count: after && after.rules && after.rules.length },
    );
    R.assert(
      '🔴 ADR-010/ADR-008:重启后规则**顺序**逐字完好(顺序即优先级)',
      JSON.stringify(after.rules) === JSON.stringify(before.rules),
      { before: before.rules, after: after.rules },
    );
    R.assert(
      '🔴 ADR-061:重排后立即关闭浏览器,顺序**未**丢失(写入无防抖窗口)',
      JSON.stringify(after.rules.map((r) => r.pattern)) ===
        JSON.stringify(before.rules.map((r) => r.pattern)),
      { afterPatterns: after.rules.map((r) => r.pattern) },
    );
    R.assert(
      '重启后 masterEnabled / version / maxSeenTime 等字段完好',
      after.masterEnabled === before.masterEnabled &&
        after.version === before.version &&
        typeof after.maxSeenTime === 'number',
      {
        masterEnabled: after.masterEnabled,
        version: after.version,
        maxSeenTime: after.maxSeenTime,
      },
    );

    // ADR-025:持久化 JSON 不得出现派生值(ColorMatrix)。
    const keys = Object.keys(after).sort();
    R.assert(
      'ADR-025:重启后持久化键集仍只有规格内的 5 个(无派生值被写进去)',
      JSON.stringify(keys) ===
        JSON.stringify(['lockUntil', 'masterEnabled', 'maxSeenTime', 'rules', 'version']),
      { keys },
    );
    const ruleKeys = [...new Set(after.rules.flatMap((r) => Object.keys(r)))].sort();
    R.assert(
      'ADR-025:规则对象的键集仍只有 pattern/mode/intensity',
      JSON.stringify(ruleKeys) === JSON.stringify(['intensity', 'mode', 'pattern']),
      { ruleKeys },
    );

    /* ═══════════ 5. 重启后规则**真的还在起作用**(不只是数据在)═══════════ */
    //
    // 这一步是本门禁与「读一下 storage」的区别:数据完好不等于行为完好。
    // 重启后首个命中的规则必须真的渲染出来(声明式注册跨重启存活,ADR-062)。
    const firstWiki = after.rules.findIndex((r) => r.pattern === '*.wikipedia.org');
    const site2 = await browser.newPage();
    await site2.goto('https://en.wikipedia.org/wiki/Color_blindness', {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    });
    const f = await waitFilter(site2, (x) => x !== 'none');
    // 期望值由**重启后实际的规则顺序**推出(首个命中胜,INV-6),
    // 而不是写死 —— 否则重排之后这条断言会与事实脱节。
    const winner = after.rules.find(
      (r) => r.pattern === '*' || r.pattern === '*.wikipedia.org',
    );
    const expectGray = winner.mode === 'Grayscale';
    R.assert(
      '🔴 重启后规则**真的仍在生效**(数据完好 ≠ 行为完好)',
      f !== 'none' && (expectGray ? /^grayscale\(/.test(f) : /^url\("data:image/.test(f)),
      { filter: String(f).slice(0, 60), winner, firstWikiIndex: firstWiki },
    );

    const regs = await (await getWorker(browser)).evaluate(async () => {
      const list = await chrome.scripting.getRegisteredContentScripts();
      return list.length;
    });
    R.assert(
      'ADR-062:重启后声明式注册仍在(persistAcrossSessions 生效)',
      regs > 0,
      { registrations: regs },
    );
  } finally {
    try {
      await browser.close();
    } catch {
      /* 已关 */
    }
  }
  return R.finish(OUT);
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
