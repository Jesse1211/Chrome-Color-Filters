// 🔴🔒 T7【新增】**ADR-077 补偿语义 —— 「锁定过夜 + 关机」**(真实 Chrome)
//
// ADR-077 逐字要求:
//   > **补偿语义(错过的到期):** 浏览器关闭期间闹钟不会触发。
//   > SW 下次启动时若发现 `lockUntil` 已过去且 `masterEnabled` 仍为 `true`,
//   > **必须补做这次关闭** —— 否则「关机过夜」会让自动关闭静默失效。
//
// 任务书要求:
//   > A catch-up test: seed a lock that has already expired while
//   > `masterEnabled: true`, start the browser fresh, and assert the SW turns
//   > it off **without any popup being opened**.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ## 🔴 为什么这条**必须**用「真的退出并重启浏览器」来验
//
// 「浏览器关闭期间到期」这个场景的本质是:**没有任何闹钟会响**。
// 闹钟活在浏览器进程里,进程结束它就不存在了;重启后即便闹钟被恢复,
// 它的 `when` 也已经是过去时刻。
//
// 若用「同一个进程里把 lockUntil 改成过去值」来模拟,那会触发
// `storage.onChanged` → SW 的 `onSettingsChanged` → 重排闹钟,
// 于是**走的是另一条代码路径**(闹钟线),而不是补偿线。
// 那样测出来的绿灯与本条款无关 —— 故本门禁:
//
//   1. 启动浏览器,**在进程里**播种一个**已经过期**的锁(+ masterEnabled: true);
//   2. 🔴 **完全退出浏览器**(进程真的结束,闹钟随之消失);
//   3. 用**同一个 userDataDir** 重新启动 —— 这才是「关机过夜后开机」;
//   4. 🔴 **全程不打开 popup**,断言磁盘上 masterEnabled 已变 false。
//
// ## 🔴 负向对照(没有它这条门禁可能是恒真的)
//
// 「重启后主开关变 OFF」单看可能有别的来源(比如播种本身写错了、
// 或者某条代码路径无条件关主开关)。故本门禁带两组对照:
//
//   · **对照 1(锁仍有效)**:播种一个**未到期**的锁 → 重启 →
//     masterEnabled 必须**仍为 true**(补偿**不该**在锁定期内动手);
//   · **对照 2(从未锁过)**:播种 `lockUntil: null` → 重启 →
//     masterEnabled 必须**仍为 true**(从未用过锁定的用户不该被关掉滤镜)。
//
// 三组走的是**同一条代码路径**,只有数据不同;若实现是「重启就关」,
// 对照 1 与 2 会当场判红。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./lib7.cjs');

/** 播种一份设置(绕过 UI,从门禁外部布置初始状态 —— 与 T4a `seed` 同一合法例外)。 */
async function seedSettings(browser, settings) {
  const w = await L.getWorker(browser);
  await w.evaluate(async (s) => {
    await chrome.storage.local.set({ filterSettings: s });
  }, settings);
}

async function readState(browser) {
  const s = await L.readPersisted(browser);
  const w = await L.getWorker(browser);
  const now = await w.evaluate(() => Date.now());
  return {
    lockUntil: s?.lockUntil ?? null,
    masterEnabled: s?.masterEnabled ?? null,
    rules: (s?.rules ?? []).map((r) => `${r.pattern}@${String(r.intensity)}`),
    now,
    remainingMs: s?.lockUntil ? s.lockUntil - now : null,
    keys: s ? Object.keys(s).sort() : null,
  };
}

/** 当前已排的闹钟。 */
async function alarmsOf(browser) {
  const w = await L.getWorker(browser);
  return w.evaluate(async () => {
    const all = await chrome.alarms.getAll();
    return all.map((a) => ({ name: a.name, scheduledTime: a.scheduledTime }));
  });
}

/** 列出当前所有页面 URL —— 用来**证明** popup 从未被打开。 */
async function pageUrls(browser) {
  const pages = await browser.pages();
  return pages.map((p) => p.url());
}

/**
 * 跑一个「播种 → 完全退出 → 重启 → 观察」的回合。
 *
 * @returns {{before: object, after: object, alarmsAfter: object, urls: string[]}}
 */
async function restartRound(udd, settings, label) {
  // ── 1) 启动并播种 ──
  let browser = await L.launch(udd, { headless: true });
  await seedSettings(browser, settings);
  // 等一拍,让播种触发的 storage.onChanged 处理完(排/清闹钟)。
  await new Promise((r) => setTimeout(r, 1500));
  const before = await readState(browser);

  // ── 2) 🔴 完全退出浏览器(进程真的结束 —— 闹钟随之消失)──
  await browser.close();
  await new Promise((r) => setTimeout(r, 2500));

  // ── 3) 用同一个 userDataDir 重新启动 —— 「关机过夜后开机」 ──
  browser = await L.launch(udd, { headless: true });
  // 🔴 **不打开 popup**。只等 SW 起来并跑完它的冷启动兜底。
  //    等待量给足(SW 启动 + 一次 storage.get + 可能的写入)。
  await L.getWorker(browser);
  await new Promise((r) => setTimeout(r, 4000));

  const after = await readState(browser);
  const alarmsAfter = await alarmsOf(browser);
  const urls = await pageUrls(browser);

  console.log(`\n── ${label} ──`);
  console.log('  播种后:', JSON.stringify(before));
  console.log('  重启后:', JSON.stringify(after));
  console.log('  闹钟  :', JSON.stringify(alarmsAfter));
  console.log('  页面  :', JSON.stringify(urls));

  await browser.close();
  await new Promise((r) => setTimeout(r, 1200));
  return { before, after, alarmsAfter, urls };
}

const rules = [{ pattern: '*', mode: 'Grayscale', intensity: 100 }];

(async () => {
  const results = {
    clause: 'T7【新增】ADR-077 补偿语义(关机过夜后 SW 补做关闭)',
    assertions: [],
    data: {},
    pass: true,
  };
  const assert = L.makeAsserter(results);

  // ═══ 回合 1:🔴 **已经过期**的锁 + masterEnabled: true ═══════════════
  //
  // 「过夜」用 8 小时之前到期来表达 —— 一个任何闹钟都不可能覆盖的间隔。
  const udd1 = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-catchup-expired-'));
  const expiredAt = Date.now() - 8 * 3600_000;
  const r1 = await restartRound(
    udd1,
    { version: 1, masterEnabled: true, rules, lockUntil: expiredAt },
    '回合 1:锁已在 8 小时前到期,masterEnabled: true',
  );
  results.data.round1 = r1;

  assert('回合 1 前置:播种后确实是「已过期 + 主开关 ON」',
    r1.before.masterEnabled === true && r1.before.remainingMs < 0,
    r1.before);

  // 🔴🔴🔴 本门禁的核心断言。
  assert('🔴🔴🔴 ADR-077 补偿:**完全重启浏览器后、未开过 popup**,SW 把 masterEnabled 补关为 false',
    r1.after.masterEnabled === false, r1.after);

  assert('🔴 补偿只改主开关 —— 规则原样保留(INV-8)',
    JSON.stringify(r1.after.rules) === JSON.stringify(r1.before.rules),
    { before: r1.before.rules, after: r1.after.rules });

  assert('🔴 补偿**不清除** lockUntil(ADR-052:不为自动关闭开缩短的特例)',
    r1.after.lockUntil === expiredAt,
    { seeded: expiredAt, after: r1.after.lockUntil });

  assert('ADR-025:补偿没有新增任何持久化字段',
    JSON.stringify(r1.after.keys) === JSON.stringify(['lockUntil', 'masterEnabled', 'rules', 'version']),
    { keys: r1.after.keys });

  assert('🔴 补偿后不留过期闹钟(reschedule 把它清掉了)',
    r1.alarmsAfter.length === 0, r1.alarmsAfter);

  // 🔴 **证明** popup 真的没被打开 —— 不是「我没写打开它的代码」,而是实证。
  assert('🔴🔴 证据:全程没有任何 popup.html 页面存在过(补偿不依赖 popup)',
    r1.urls.every((u) => !u.includes('popup.html')), r1.urls);

  // ═══ 回合 2:对照 1 —— 锁**仍有效** ═════════════════════════════════
  const udd2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-catchup-active-'));
  const futureUntil = Date.now() + 6 * 3600_000;
  const r2 = await restartRound(
    udd2,
    { version: 1, masterEnabled: true, rules, lockUntil: futureUntil },
    '回合 2(对照 1):锁还有 6 小时,masterEnabled: true',
  );
  results.data.round2 = r2;

  assert('🔴🔴 对照 1:锁**仍有效**时重启 → masterEnabled 保持 true(补偿不在锁定期内动手)',
    r2.after.masterEnabled === true, r2.after);
  assert('🔴 对照 1 / INV-13:重启后锁仍然有效,lockUntil 原值不变(ADR-053)',
    r2.after.lockUntil === futureUntil && r2.after.remainingMs > 0,
    { seeded: futureUntil, after: r2.after });
  assert('🔴 对照 1:重启后闹钟被**重建**(ADR-077:闹钟不保证存活重启)',
    r2.alarmsAfter.length === 1
    && r2.alarmsAfter[0].name === 'ccf-lock-expiry'
    && r2.alarmsAfter[0].scheduledTime === futureUntil,
    { alarms: r2.alarmsAfter, lockUntil: futureUntil });

  // ═══ 回合 3:对照 2 —— **从未锁过** ═════════════════════════════════
  const udd3 = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-catchup-never-'));
  const r3 = await restartRound(
    udd3,
    { version: 1, masterEnabled: true, rules, lockUntil: null },
    '回合 3(对照 2):从未锁过(lockUntil: null),masterEnabled: true',
  );
  results.data.round3 = r3;

  assert('🔴🔴 对照 2:**从未锁过**的用户重启后 masterEnabled 保持 true(绝不无故关滤镜)',
    r3.after.masterEnabled === true && r3.after.lockUntil === null, r3.after);
  assert('对照 2:没有锁就没有闹钟',
    r3.alarmsAfter.length === 0, r3.alarmsAfter);

  // ═══ 回合 4:幂等 —— 已过期**且已经是 OFF** ═════════════════════════
  const udd4 = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-catchup-idem-'));
  const r4 = await restartRound(
    udd4,
    { version: 1, masterEnabled: false, rules, lockUntil: expiredAt },
    '回合 4(幂等):锁已过期,但 masterEnabled 本就是 false',
  );
  results.data.round4 = r4;

  assert('幂等:已过期且已是 OFF → 重启后仍是 OFF(不重复写、不翻转)',
    r4.after.masterEnabled === false, r4.after);

  // ═══ 🔴 判别力总结 ═══════════════════════════════════════════════════
  //
  // 四个回合走的是**同一条代码路径**(SW 冷启动的 catchUpAndReschedule),
  // 只有磁盘上的数据不同。若实现退化成「重启就关主开关」,
  // 回合 2 与 3 会判红;若退化成「从不关」,回合 1 会判红。
  assert('🔴🔴 判别力:四个回合的结果**不相同** —— 补偿确实在按数据分支,而非恒定行为',
    r1.after.masterEnabled === false
    && r2.after.masterEnabled === true
    && r3.after.masterEnabled === true,
    {
      已过期: r1.after.masterEnabled,
      锁仍有效: r2.after.masterEnabled,
      从未锁过: r3.after.masterEnabled,
      已过期且已关: r4.after.masterEnabled,
    });

  L.writeJson('lock-expiry-catchup.json', results);
  console.log(`\n${results.pass ? 'PASS' : 'FAIL'} — T7 ADR-077 补偿语义(关机过夜)`);
  process.exit(results.pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
