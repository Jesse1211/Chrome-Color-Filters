// ═══════════════════════════════════════════════════════════════════════════
// T7【回归】INV-7 —— 第 21 条被拒,提示明确
// ═══════════════════════════════════════════════════════════════════════════
//
// §6 T7 gate 原文:
//
// > **【回归】** INV-7:第 21 条被拒,提示明确
//
// 上游在**单元层**验过(`src/storage/__tests__/settings-repository.test.ts`
// 与 `src/ui/__tests__/rule-list-view.test.tsx`),但此前**没有任何真实栈门禁**
// 覆盖它。本脚本在真实 Chrome 的产物上验两件事:
//
//   (a) **仓储层**拒绝第 21 条,且返回**结构化错误**(ADR-046/ADR-012)——
//       「绝不静默淘汰」:拒绝之后原有 20 条**一字未动**;
//   (b) **UI** 在达到上限时给出**明确提示**,且「新建规则」入口被禁用 ——
//       提示文案逐字取自 `src/ui/strings.ts` 的 `CAPACITY_NOTICE`(ADR-047 中文)。
//
// 🔴 ADR-011:上限 20 条。理由在 ADR-010 之后改为**产品性**的 ——
//    20 条可在 popup 内全量渲染(可滚动),无需分页或虚拟滚动。
//
// 用法(从仓库根):npm run build && node docs/T7-gate/inv7-capacity.cjs

const path = require('path');
const {
  makeResults,
  tmpProfile,
  launch,
  seed,
  rule,
  settings,
  popupUrl,
  openPopup,
  siteTabOf,
  waitNotSkeleton,
  repoProbe,
  withRepo,
  readSettings,
  probe,
  exists,
  sleep,
} = require('./lib7.cjs');

const OUT = path.join(__dirname, 'evidence');
const R = makeResults('inv7-capacity');

/** 逐字取自 `src/ui/strings.ts`(ADR-047:首版仅中文,门禁照此检查)。 */
const CAPACITY_NOTICE = '已达 20 条上限,请先删除一条再添加';
const MAX_RULES = 20;

async function main() {
  const browser = await launch(tmpProfile('inv7'), { headless: true });
  try {
    // 播种**正好 20 条**(ADR-011 的上限)。
    const twenty = [];
    for (let i = 0; i < MAX_RULES; i++) {
      twenty.push(rule(`site${String(i)}.example.com`, 'Grayscale', 100));
    }
    await seed(browser, settings(twenty, true));

    const site = await browser.newPage();
    await site.goto('https://en.wikipedia.org/wiki/Color_blindness', {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    });
    const siteTab = await siteTabOf(browser, 'wikipedia.org');
    const popup = await openPopup(browser, await popupUrl(browser), siteTab);
    await waitNotSkeleton(popup);

    const before = await readSettings(browser);
    R.assert('前置:已有正好 20 条规则(ADR-011 上限)', before.rules.length === MAX_RULES, {
      count: before.rules.length,
    });

    /* ═══════ (a) 仓储层拒绝第 21 条,结构化错误,原有 20 条一字未动 ═══════ */
    await repoProbe(browser, popup);
    const attempt = await withRepo(popup, async (repo) => {
      const r = await repo.addRule({
        pattern: 'twenty-first.example.com',
        mode: 'BlueYellow',
        intensity: 50,
      });
      return {
        ok: r.ok,
        kind: r.ok ? null : r.error.kind,
        reason: r.ok ? null : r.error.reason,
        message: r.ok ? null : r.error.message,
      };
    });
    R.cases.push({ step: '第 21 条的仓储层写入尝试', attempt });

    R.assert(
      '🔴 INV-7:第 21 条被仓储层拒绝',
      attempt.ok === false,
      attempt,
    );
    // 📌 契约逐字核对自 `src/storage/errors.ts` 的 `capacityError()`:
    //    `kind: 'other'` + `reason: 'capacity-exceeded'`。
    //    本脚本第一版断言 `kind === 'capacity'` —— 那个取值**在契约里不存在**,
    //    是门禁凭印象写出来的,属于断言自身的错误(实测判红后照契约更正)。
    //    `kind` 的分档是给**调用方决定怎么显示**用的(quota/locked/other),
    //    精确原因在 `reason` 里 —— 故这里两者都断言。
    R.assert(
      '🔴 ADR-046:拒绝是**结构化错误**(kind/reason 皆符合契约),非静默丢弃也非 throw',
      attempt.kind === 'other' && attempt.reason === 'capacity-exceeded',
      { kind: attempt.kind, reason: attempt.reason },
    );
    R.assert(
      '🔴 INV-7:提示**明确**(错误消息非空且点明 20 条上限)',
      typeof attempt.message === 'string' &&
        attempt.message.length > 0 &&
        attempt.message.includes('20'),
      { message: attempt.message },
    );

    const after = await readSettings(browser);
    R.assert(
      '🔴 ADR-012:拒绝之后原有 20 条**一字未动**(绝不静默淘汰)',
      after.rules.length === MAX_RULES &&
        JSON.stringify(after.rules) === JSON.stringify(before.rules),
      { count: after.rules.length, unchanged: JSON.stringify(after.rules) === JSON.stringify(before.rules) },
    );
    R.assert(
      '新规则确实没有被写进去',
      !after.rules.some((x) => x.pattern === 'twenty-first.example.com'),
      { patterns: after.rules.map((x) => x.pattern).slice(0, 3) },
    );

    /* ═══════ (b) UI 在上限时给出明确提示,且新建入口被禁用 ═══════ */
    await popup.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await popup.waitForSelector('[data-testid="popup"]', { timeout: 15000 });
    await waitNotSkeleton(popup);
    await sleep(300);

    R.assert('🔴 UI:达到上限时出现容量提示条', await exists(popup, 'capacity-notice'));
    const notice = await probe(popup, 'capacity-notice');
    R.assert(
      '🔴 INV-7:UI 提示文案逐字符合规格(ADR-047 中文)',
      notice !== null && String(notice.text).includes(CAPACITY_NOTICE),
      { text: notice && notice.text, expected: CAPACITY_NOTICE },
    );

    const addBtn = await probe(popup, 'add-rule');
    R.assert(
      '🔴 UI:达到上限时「新建规则」入口被禁用(第二道防线,ADR-055 同理)',
      addBtn !== null && addBtn.disabled === true,
      { disabled: addBtn && addBtn.disabled },
    );

    const count = await probe(popup, 'rule-count');
    R.assert(
      'UI:条数显示为 20',
      count !== null && String(count.text).includes('20'),
      { text: count && count.text },
    );

    /* ═══════ (c) 删掉一条 → 上限解除,可再添加(闭环)═══════ */
    // ⚠️ 上面 reload 过 popup —— 页面全局(含探针构造器)随之清空,须重新加载。
    await repoProbe(browser, popup);
    const freed = await withRepo(popup, async (repo) => {
      const rm = await repo.removeRule(0);
      const add = await repo.addRule({
        pattern: 'twenty-first.example.com',
        mode: 'BlueYellow',
        intensity: 50,
      });
      return { rm: rm.ok, add: add.ok, kind: add.ok ? null : add.error.kind };
    });
    R.assert(
      '🔴 删掉一条后即可再添加(提示所说的「请先删除一条再添加」确实可行)',
      freed.rm === true && freed.add === true,
      freed,
    );
    const final = await readSettings(browser);
    R.assert(
      '闭环后仍恰好 20 条',
      final.rules.length === MAX_RULES,
      { count: final.rules.length },
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
