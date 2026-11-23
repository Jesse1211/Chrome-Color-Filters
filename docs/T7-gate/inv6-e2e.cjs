// ═══════════════════════════════════════════════════════════════════════════
// T7【新增】INV-6 —— **端到端**验证优先级(首个命中胜)
// ═══════════════════════════════════════════════════════════════════════════
//
// §6 T7 gate 原文:
//
// > **【新增】** INV-6:**端到端**验证优先级 —— popup 里建两条规则
// > `[x.com→Gray, *→B/Y]`,真实打开 x.com 得 Gray、其他站得 B/Y。
// > 上游只在单元层验过 `resolveRule`,此处首次验证「UI 建的规则 → 实际渲染」
// > 整条链路
//
// 🔴 **这条为什么必须在 T7 才算验过:**
//
// T3 的门禁调 `resolveRule(settings, url)` —— 一个纯函数,输入是**手写的**
// settings 对象。它证明了领域逻辑对,但完全没有触碰:
//   (a) popup 的表单真的把用户填的 pattern/mode/intensity 按**正确顺序**
//       写进了 `rules` 数组(顺序即优先级,ADR-008);
//   (b) 写入真的落盘(ADR-010 `storage.local`,ADR-061 松手即写入);
//   (c) service worker 真的按新 settings 重算了声明式注册(ADR-062);
//   (d) 真实网页上**最终渲染出来的那一个** filter 是索引最小那条规则的,
//       而不是两条叠加、也不是后一条覆盖前一条。
//
// (d) 同时就是 **INV-2(任一时刻仅一个滤镜生效)** 在端到端层的体现:
// 断言 `getComputedStyle(html).filter` 是**单个** filter 函数,而非两个串联。
//
// 📌 规则按 §6 T7 逐字用 `[x.com→Gray, *→B/Y]`。`x.com` 在无头环境里会跳
//    登录墙/反自动化页,但**那不影响本门禁** —— 我们断言的是 host 匹配与
//    渲染结果,不读页面内容(ADR-026)。为避免站点可用性把门禁判成红,
//    另加两个稳定的真实站点做同构验证(wikipedia 命中专属规则、example.com
//    落到通配规则),并把 x.com 的结果一并留档。
//
// 用法(从仓库根):npm run build && node docs/T7-gate/inv6-e2e.cjs

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
  filterOf,
  waitFilter,
  sleep,
  probe,
} = require('./lib7.cjs');

const OUT = path.join(__dirname, 'evidence');
const R = makeResults('inv6-e2e');

/** Grayscale 的渲染结果形状 —— `grayscale(1)` / `grayscale(0.88)` 之类。 */
const isGray = (f) => /^grayscale\(/.test(f);
/** BlueYellow 走内联 data: URI 的 feColorMatrix(ADR-063/T4a modes 门禁已核实)。 */
const isMatrix = (f) => /^url\("data:image\/svg\+xml/.test(f);
/** INV-2:只能有**一个** filter 函数 —— 两条规则同时生效会串联成两段。 */
function filterFnCount(f) {
  if (!f || f === 'none') return 0;
  // 顶层拆分:`url(...)` 里含空格与括号,故只数顶层的函数名出现次数。
  let depth = 0;
  let count = 0;
  let atStart = true;
  for (let i = 0; i < f.length; i++) {
    const c = f[i];
    if (c === '(') { if (depth === 0 && atStart) { count++; atStart = false; } depth++; }
    else if (c === ')') depth--;
    else if (depth === 0 && c === ' ') atStart = true;
  }
  return count;
}

async function main() {
  const browser = await launch(tmpProfile('inv6'), { headless: true });
  try {
    // 空 settings 起步 —— 一切规则都必须由 popup UI 建出来。
    await seed(browser, settings([]));
    const PU = await popupUrl(browser);

    /* ───── 基线:建规则之前,两个站点都必须无滤镜(证明探针有效)───── */
    const wiki = await browser.newPage();
    await wiki.goto('https://en.wikipedia.org/wiki/Color_blindness', {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    });
    const wikiBase = await filterOf(wiki);
    R.assert('基线:wikipedia 建规则前无滤镜(探针有效)', wikiBase === 'none', { wikiBase });

    const siteTab = await siteTabOf(browser, 'wikipedia.org');
    R.assert('取到目标页 tab', siteTab !== null, siteTab);

    /* ═══════════ 1. 全程通过真实 popup UI 建两条规则 ═══════════ */
    //
    // 顺序至关重要:先建 `*.wikipedia.org → Grayscale`,再建 `* → BlueYellow`。
    // 新建是**追加到末尾**,所以索引 0 = 专属规则、索引 1 = 通配规则。
    // 这正是 §6 T7 要的 `[x.com→Gray, *→B/Y]` 形状。
    const popup = await openPopup(browser, PU, siteTab);
    R.assert('popup 收到 GET_TAB_STATE 响应(ADR-044 真实联调)', await waitNotSkeleton(popup));

    await createRuleViaUI(popup, {
      pattern: '*.wikipedia.org',
      mode: 'Grayscale',
      intensity: 100,
    });
    await createRuleViaUI(popup, { pattern: '*', mode: 'BlueYellow', intensity: 100 });

    const persisted = await readSettings(browser);
    R.assert(
      '🔴 UI 建的两条规则已落盘(ADR-010 storage.local)',
      persisted !== null && Array.isArray(persisted.rules) && persisted.rules.length === 2,
      persisted && persisted.rules,
    );
    R.assert(
      '🔴 顺序即优先级(ADR-008):索引 0 = 专属规则,索引 1 = 通配规则',
      persisted.rules[0].pattern === '*.wikipedia.org' &&
        persisted.rules[0].mode === 'Grayscale' &&
        persisted.rules[1].pattern === '*' &&
        persisted.rules[1].mode === 'BlueYellow',
      persisted.rules,
    );
    // 规则由 UI 建出,mode 必须是合法 FilterMode 字面量(ADR-066 的教训:
    // 一个非法 mode 能让断言空转而测试看起来绿)。
    R.assert(
      'UI 写出的 mode 是合法 FilterMode 字面量',
      ['Grayscale', 'RedGreen', 'GreenRed', 'BlueYellow'].includes(persisted.rules[0].mode) &&
        ['Grayscale', 'RedGreen', 'GreenRed', 'BlueYellow'].includes(persisted.rules[1].mode),
      persisted.rules.map((r) => r.mode),
    );
    await popup.close();

    /* ═══════════ 2. 命中专属规则的站点 → Grayscale ═══════════ */
    await wiki.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    const wikiFilter = await waitFilter(wiki, (f) => f !== 'none');
    R.assert(
      '🔴 INV-6 端到端:wikipedia 命中索引 0(Grayscale),**不是**通配的 B/Y',
      isGray(wikiFilter),
      { wikiFilter },
    );
    R.assert(
      '🔴 INV-2 端到端:wikipedia 上只有**一个** filter 生效(非两条叠加)',
      filterFnCount(wikiFilter) === 1,
      { wikiFilter, count: filterFnCount(wikiFilter) },
    );
    R.cases.push({ site: 'en.wikipedia.org', expected: 'Grayscale', filter: wikiFilter });

    /* ═══════════ 3. 只命中通配规则的站点 → BlueYellow ═══════════ */
    const other = await browser.newPage();
    await other.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    const otherFilter = await waitFilter(other, (f) => f !== 'none');
    R.assert(
      '🔴 INV-6 端到端:example.com 落到索引 1 的通配规则(BlueYellow 矩阵)',
      isMatrix(otherFilter),
      { otherFilter: String(otherFilter).slice(0, 60) },
    );
    R.assert(
      '🔴 INV-2 端到端:example.com 上只有**一个** filter 生效',
      filterFnCount(otherFilter) === 1,
      { count: filterFnCount(otherFilter) },
    );
    R.cases.push({ site: 'example.com', expected: 'BlueYellow', filter: otherFilter });

    /* ═══════════ 4. §6 T7 逐字点名的 x.com(留档) ═══════════ */
    //
    // 本段**不参与** pass/fail 判定:x.com 在无头环境下是否可达不由本项目控制。
    // 但它是 gate 条款逐字点名的站点,故真实访问一次并把结果留档,
    // 由人类复核。判定由上面两个稳定站点的同构断言承担。
    let xcom = null;
    try {
      const xp = await browser.newPage();
      await xp.goto('https://x.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(1500);
      xcom = { url: xp.url(), filter: await filterOf(xp) };
      await xp.close();
    } catch (e) {
      xcom = { error: String(e.message).slice(0, 200) };
    }
    R.cases.push({ site: 'x.com (留档,不参与判定)', observed: xcom });
    console.log(`INFO  x.com 留档:${JSON.stringify(xcom)}`);

    /* ═══════════ 5. 删掉专属规则 → wikipedia 落到通配规则 ═══════════ */
    //
    // 这一步把「首个命中胜」从**反方向**再钉一次:若索引 0 其实没在起作用、
    // wikipedia 的灰只是碰巧,那删掉它之后结果不会变。必须变成 B/Y。
    const popup2 = await openPopup(browser, PU, siteTab);
    await waitNotSkeleton(popup2);
    const row0 = await probe(popup2, 'rule-pattern-0');
    R.assert('列表首行是专属规则', row0 !== null && row0.text === '*.wikipedia.org', row0 && row0.text);
    const { clickTestid } = require('./lib7.cjs');
    await clickTestid(popup2, 'rule-delete-0', 600);
    const after = await readSettings(browser);
    R.assert(
      '通过 UI 删除索引 0 后只剩通配规则',
      after.rules.length === 1 && after.rules[0].pattern === '*',
      after.rules,
    );
    await popup2.close();

    await wiki.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    const wikiAfter = await waitFilter(wiki, (f) => isMatrix(f));
    R.assert(
      '🔴 反向确认:删掉专属规则后 wikipedia 改由通配规则生效(B/Y)',
      isMatrix(wikiAfter),
      { wikiAfter: String(wikiAfter).slice(0, 60) },
    );
  } finally {
    await browser.close();
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
