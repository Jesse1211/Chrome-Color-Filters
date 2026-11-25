// 🔴 ADR-077 前置调研:加 `alarms` 权限是否**新增用户可见的权限警告**?
//
// 任务书明文要求:「Adding the `alarms` permission is a manifest change.
// Confirm whether it adds any user-visible permission warning on install/update
// and report what you found — if it does, stop and tell me before proceeding.」
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ## 为什么用 `chrome.management.getPermissionWarningsByManifest`
//
// 它返回的就是 Chrome **安装/更新对话框里逐行显示给用户的那几句话**
// (与 `chrome://extensions` 的权限列表同源),是这个问题的权威答案 ——
// 比人眼看一眼截图可机械判定,也比读文档可靠(文档不保证与本版本一致)。
//
// 🔴 这是一次 **A/B**:同一份**产物 manifest**,唯一差别是
// `permissions` 里有没有 `alarms`。两次调用结果逐字比对,
// 新增的行就是 `alarms` 带来的警告。
//
// 对照组(探针有效性):第三次用一个**已知会报警**的权限(`history`)——
// 若它也报「零新增」,说明本探针根本读不出警告,结论不可信,当场判红。
//
// 📌 `management` 权限本身只加在**这个一次性探针**里吗?不 —— 完全不需要:
// `getPermissionWarningsByManifest` 在扩展自己的 SW 里可直接调用,
// 它查询的是「一份 manifest 文本会产生什么警告」,**不读取任何已安装扩展**,
// 故不需要 `management` 权限。实测见下方断言。
const fs = require('fs');
const path = require('path');
const L = require('./lib7.cjs');

(async () => {
  const results = { pass: true, assertions: [], data: {} };
  const assert = L.makeAsserter(results);
  const udd = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ccf-alarmwarn-'));

  let browser = await L.launch(udd, { headless: true });
  try {
    const w = await L.getWorker(browser);

    // 产物 manifest —— 以**构建产物**为准(ADR-038),不是 wxt.config.ts。
    const builtManifest = JSON.parse(
      fs.readFileSync(path.join(L.EXT, 'manifest.json'), 'utf8'),
    );

    const probe = async (permissions) =>
      w.evaluate(async (manifestStr) => {
        try {
          const warnings =
            await chrome.management.getPermissionWarningsByManifest(manifestStr);
          return { ok: true, warnings };
        } catch (e) {
          return { ok: false, error: String(e && e.message ? e.message : e) };
        }
      }, JSON.stringify({ ...builtManifest, permissions }));

    const basePerms = builtManifest.permissions ?? [];
    const withAlarms = [...basePerms, 'alarms'];
    const withHistory = [...basePerms, 'history'];

    const a = await probe(basePerms);
    const b = await probe(withAlarms);
    const c = await probe(withHistory);

    results.data = {
      builtPermissions: basePerms,
      base: a,
      withAlarms: b,
      withHistory: c,
    };

    assert('探针可用:getPermissionWarningsByManifest 调得通(无需 management 权限)',
      a.ok === true && b.ok === true && c.ok === true,
      { base: a, withAlarms: b, withHistory: c });

    if (!a.ok || !b.ok || !c.ok) throw new Error('探针不可用,结论不可信');

    const baseSet = a.warnings;
    const alarmsSet = b.warnings;
    const historySet = c.warnings;

    const addedByAlarms = alarmsSet.filter((x) => !baseSet.includes(x));
    const addedByHistory = historySet.filter((x) => !baseSet.includes(x));
    const removedByAlarms = baseSet.filter((x) => !alarmsSet.includes(x));

    results.data.addedByAlarms = addedByAlarms;
    results.data.addedByHistory = addedByHistory;

    // 🔴 核心结论。
    assert('🔴 ADR-077:加 `alarms` 后权限警告列表**逐字未变**(零新增用户可见警告)',
      addedByAlarms.length === 0 && removedByAlarms.length === 0,
      { baseSet, alarmsSet, addedByAlarms, removedByAlarms });

    // 🔴 探针有效性 —— 没有这条,上面那个「零新增」可能只是因为读不出警告。
    assert('🔴 探针有效性对照:`history` 确实**新增**了一条警告(证明本探针读得出变化)',
      addedByHistory.length >= 1,
      { addedByHistory, historySet });

    console.log('\n── 权限警告实测 ──');
    console.log('产物 permissions :', JSON.stringify(basePerms));
    console.log('基线警告         :', JSON.stringify(baseSet, null, 2));
    console.log('+alarms 后警告   :', JSON.stringify(alarmsSet, null, 2));
    console.log('+alarms 新增     :', JSON.stringify(addedByAlarms));
    console.log('+history 新增(对照):', JSON.stringify(addedByHistory));
  } finally {
    try { await browser.close(); } catch {}
  }

  L.writeJson('alarms-permission-warning.json', results);
  console.log(`\n${results.pass ? 'PASS' : 'FAIL'} — ADR-077 alarms 权限警告 A/B`);
  process.exit(results.pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
