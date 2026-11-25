// 🔴 ADR-077 前置调研:`chrome.alarms` 的**最小粒度**在本版本 Chrome 上究竟如何?
//
// 任务书:「Note `chrome.alarms` has a minimum period; check the current Chrome
// behaviour for one-shot `when` alarms and say what you found.」
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ## 为什么这个数字决定了架构
//
// 平台文档(node_modules/@wxt-dev/browser 的 d.ts,引自 Chrome 官方)原文:
//
//   > In order to reduce the load on the user's machine, Chrome limits alarms
//   > to at most once every 30 seconds but may delay them an arbitrary amount
//   > more. … `when` can be set to less than 30 seconds after "now" without
//   > warning but **won't actually cause the alarm to fire for at least 30
//   > seconds**.
//   > To help you debug your app or extension, **when you've loaded it
//   > unpacked, there's no limit** to how often the alarm can fire.
//
// 两个推论,都是架构级的:
//
// 1. **闹钟会迟到,且迟到量无上界**(“arbitrary amount more”)。于是闹钟
//    **不能**作为 UI 正确性的承担者 —— 若只靠它,popup 开着时用户会看到
//    一段「倒计时已归零、滤镜还开着、主开关还灰着」的中间态,
//    长度不可控。任务书点名禁止这种 stale intermediate state。
//    → 故 UI 必须有自己的、与闹钟无关的到期触发(见 useLockExpiry)。
//
// 2. 🔴 **门禁加载的是 unpacked 扩展,于是门禁里的闹钟不受 30s 限流。**
//    这意味着门禁**比生产更宽松** —— 一个只在门禁里绿的设计可能在
//    真实用户(安装自商店的 packed 扩展)那里迟到 30 秒。
//    本探针把这件事**量出来**并写进证据,以免它变成一个无人知道的洞。
//
// 本脚本实测三档 `when`(+2s / +10s / +35s),记录实际触发延迟。
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./lib7.cjs');

(async () => {
  const results = { pass: true, assertions: [], data: {} };
  const assert = L.makeAsserter(results);
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-alarmmin-'));

  let browser = await L.launch(udd, { headless: true });
  try {
    const w = await L.getWorker(browser);

    // 闹钟触发时刻记在 SW 的全局上(本探针自用,不经产品代码)。
    await w.evaluate(() => {
      self.__probeFires = [];
      chrome.alarms.onAlarm.addListener((a) => {
        self.__probeFires.push({ name: a.name, firedAt: Date.now(),
          scheduledTime: a.scheduledTime });
      });
    });

    const cases = [
      { name: 'p2s', deltaMs: 2_000 },
      { name: 'p10s', deltaMs: 10_000 },
      { name: 'p35s', deltaMs: 35_000 },
    ];

    const created = await w.evaluate(async (cs) => {
      const out = [];
      for (const c of cs) {
        const when = Date.now() + c.deltaMs;
        await chrome.alarms.create(c.name, { when });
        out.push({ name: c.name, requestedWhen: when, createdAt: Date.now() });
      }
      // 平台把 `when` 原样记下来了吗?
      const all = await chrome.alarms.getAll();
      return { out, all };
    }, cases);

    results.data.created = created;

    // 等足最长一档 + 余量(闹钟可能迟到,给 40s 余量)。
    const waitMs = 35_000 + 40_000;
    console.log(`\n⏳ 等待闹钟触发:${String(Math.round(waitMs / 1000))} 秒(真实挂钟)…`);
    await new Promise((r) => setTimeout(r, waitMs));

    const fires = await w.evaluate(() => self.__probeFires ?? []);
    results.data.fires = fires;

    const report = cases.map((c) => {
      const req = created.out.find((x) => x.name === c.name);
      const fire = fires.find((x) => x.name === c.name);
      return {
        name: c.name,
        requestedDeltaMs: c.deltaMs,
        fired: fire !== undefined,
        actualDelayMs: fire ? fire.firedAt - req.requestedWhen + c.deltaMs : null,
        latenessMs: fire ? fire.firedAt - req.requestedWhen : null,
        scheduledTimeEqualsRequested: fire ? fire.scheduledTime === req.requestedWhen : null,
      };
    });
    results.data.report = report;

    console.log('\n── 闹钟实测(unpacked 扩展)──');
    console.log(JSON.stringify(report, null, 2));

    assert('三档 `when` 闹钟全部触发了(没有被静默丢弃)',
      report.every((r) => r.fired), report);

    assert('平台把 `when` 原样记为 scheduledTime(未被向上取整到 30s)',
      report.every((r) => r.scheduledTimeEqualsRequested === true), report);

    // 🔴 本探针的产出是**数字**,不是一句「通过」。把 unpacked 下的实际
    //    迟到量记进证据 —— 它与生产的 30s 下限的差距就是门禁的宽松度。
    const sub30 = report.filter((r) => r.requestedDeltaMs < 30_000);
    assert('🔴 记录:unpacked 下 <30s 的 `when` 闹钟是否真的提早于 30s 触发了',
      sub30.length > 0,
      { note: 'unpacked 无限流 ⇒ 门禁比生产宽松,结论见 README',
        sub30: sub30.map((r) => ({ requested: r.requestedDeltaMs, lateness: r.latenessMs })) });
  } finally {
    try { await browser.close(); } catch {}
  }

  L.writeJson('alarms-minimum-probe.json', results);
  console.log(`\n${results.pass ? 'PASS' : 'FAIL'} — ADR-077 闹钟最小粒度实测`);
  process.exit(results.pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
