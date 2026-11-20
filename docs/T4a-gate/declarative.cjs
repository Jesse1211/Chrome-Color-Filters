// REAL_STACK_GATE #6:声明式注册在真实 Chrome 中的正确性(ADR-062/064/065)。
//
// 单测用 FakeScriptingPort 验的是**我们自己的 diff/分组/幂等逻辑**;
// 本脚本验的是**平台真的照做了** —— 两者不可互相替代(DESIGN.md §8 第 8 条)。
//
// 🔴 ADR-038:一律在 npm run build 产物上跑。
const path = require('path');
const os = require('os');
const fs = require('fs');
const { launch, getWorker, seed, rule, settings } = require('./lib.cjs');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const ids = (regs) => regs.map((r) => r.id).sort();
let fail = false;
const log = (ok, msg) => { if (!ok) fail = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); };
const results = {};

async function regs(w) { return w.evaluate(() => chrome.scripting.getRegisteredContentScripts()); }

(async () => {
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-decl-'));

  // ── 1. 规则创建 → 注册建立(ADR-062 的主路径) ────────────────────────
  let b = await launch(udd, { headless: true });
  let w = await getWorker(b);
  log((await regs(w)).length === 0, '初始无注册');

  await seed(b, settings([rule('weibo.com'), rule('zhihu.com'), rule('a.com', 'RedGreen', 60)]));
  await new Promise((r) => setTimeout(r, 1500));
  let r1 = await regs(w);
  results.afterSeed = r1;
  log(JSON.stringify(ids(r1)) === JSON.stringify(['ccf-gray-100', 'ccf-redgreen-60']),
    `按 (mode,intensity) 分组:${JSON.stringify(ids(r1))}`);

  // ADR-064:共享同一设置的站点合并进同一条 matches
  const gray = r1.find((r) => r.id === 'ccf-gray-100');
  log(gray && gray.matches.length === 2, `分组合并 matches=${JSON.stringify(gray && gray.matches)}`);
  log(gray && gray.persistAcrossSessions === true, 'persistAcrossSessions:true');
  log(gray && gray.runAt === 'document_start', "runAt:'document_start'");
  log(gray && gray.allFrames === false, 'allFrames:false');
  log(gray && gray.css.length === 1 && gray.css[0] === 'filters/gray-100.css',
    `css 指向预生成文件 ${JSON.stringify(gray && gray.css)}`);

  // ── 2. 幂等:再写一次同样的设置 ─────────────────────────────────────
  await seed(b, settings([rule('weibo.com'), rule('zhihu.com'), rule('a.com', 'RedGreen', 60)]));
  await new Promise((r) => setTimeout(r, 1500));
  const r2 = await regs(w);
  log(JSON.stringify(r2) === JSON.stringify(r1), '幂等:注册集合完全不变');

  // ── 3. 改强度 → css 路径被更新 ──────────────────────────────────────
  await seed(b, settings([rule('weibo.com'), rule('zhihu.com'), rule('a.com', 'RedGreen', 25)]));
  await new Promise((r) => setTimeout(r, 1500));
  const r3 = await regs(w);
  results.afterIntensityChange = r3;
  log(JSON.stringify(ids(r3)) === JSON.stringify(['ccf-gray-100', 'ccf-redgreen-25']),
    `改强度 → 新注册 ${JSON.stringify(ids(r3))}`);
  const rg = r3.find((r) => r.id === 'ccf-redgreen-25');
  log(rg && rg.css[0] === 'filters/redgreen-25.css', `css 更新到 ${rg && rg.css[0]}`);

  // ── 4. 删除规则 → 对应注册被 unregister ─────────────────────────────
  await seed(b, settings([rule('weibo.com'), rule('zhihu.com')]));
  await new Promise((r) => setTimeout(r, 1500));
  const r4 = await regs(w);
  log(JSON.stringify(ids(r4)) === JSON.stringify(['ccf-gray-100']),
    `删规则 → 注册被移除 ${JSON.stringify(ids(r4))}`);

  // ── 5. INV-8:主开关 OFF → 注册清空(ADR-027 彻底止血) ──────────────
  await seed(b, settings([rule('weibo.com'), rule('zhihu.com')], false));
  await new Promise((r) => setTimeout(r, 1500));
  const r5 = await regs(w);
  results.masterOff = r5;
  log(r5.length === 0, `主开关 OFF → 注册清空(${r5.length} 条)`);

  await seed(b, settings([rule('weibo.com'), rule('zhihu.com')], true));
  await new Promise((r) => setTimeout(r, 1500));
  log((await regs(w)).length === 1, '主开关开回 → 注册装回');
  await b.close();

  // ── 6. 跨浏览器重启存活(ADR-062 的关键机制) ────────────────────────
  b = await launch(udd, { headless: true });
  w = await getWorker(b);
  const r6 = await regs(w);
  results.afterRestart = r6;
  log(JSON.stringify(ids(r6)) === JSON.stringify(['ccf-gray-100']),
    `浏览器重启后注册仍在 ${JSON.stringify(ids(r6))}`);

  // ── 7. 🔴 ADR-065 强制项:扩展更新后重建 ────────────────────────────
  //    模拟「更新清除注册」:先把注册全删掉(等价于 Chrome 在更新时做的事),
  //    再派发 onInstalled(reason:'update')—— 注册必须被完整重建。
  await w.evaluate(async () => {
    const all = await chrome.scripting.getRegisteredContentScripts();
    if (all.length) await chrome.scripting.unregisterContentScripts({ ids: all.map((r) => r.id) });
  });
  log((await regs(w)).length === 0, 'ADR-065 前置:模拟更新清除了注册');

  await w.evaluate(() => {
    chrome.runtime.onInstalled.dispatch({ reason: 'update', previousVersion: '0.0.1' });
  });
  await new Promise((r) => setTimeout(r, 2000));
  const r7 = await regs(w);
  results.afterUpdate = r7;
  log(JSON.stringify(ids(r7)) === JSON.stringify(['ccf-gray-100']),
    `🔴 ADR-065 扩展更新后注册被完整重建 ${JSON.stringify(ids(r7))}`);

  // ── 8. 🔴 表达不出来的 glob 绝不注册成全网(converter × reconcile 接缝) ──
  //
  //    上一轮的缺陷:`*.baidu.*`(ADR-006 与 DESIGN.md:61-64 的旗舰示例)
  //    被转换器兜底成 `*://*/ *`,再被 reconcile 配上一张**裸 html** 的
  //    滤镜表 → 一条规则让**整个互联网**的首帧变灰(违反 INV-1 与
  //    DESIGN.md §1 匹配语义第 4 条「无规则命中 → 不套滤镜」)。
  //
  //    为什么此前的门禁看不见它:本脚本历来只播种字面 host(exact 路径),
  //    flicker/multitab/geometry/modes 用的是 rule('*')(原意即全网)。
  //    **没有任何一条门禁把一个放宽的 glob 送进过真实浏览器。**
  //    这一节专门驱动那个状态。
  await seed(b, settings([rule('*.baidu.*'), rule('*weibo*', 'RedGreen', 60)]));
  await new Promise((r) => setTimeout(r, 1500));
  const r8 = await regs(w);
  results.inexpressibleGlobs = r8;

  // 8a. 不得有任何注册带全网 matches。
  const allUrlsRegs = r8.filter((r) => (r.matches || []).includes('*://*/*'));
  log(allUrlsRegs.length === 0,
    `🔴 表达不出来的 glob 未注册成全网(全网注册 ${allUrlsRegs.length} 条,` +
    `实际注册 ${JSON.stringify(ids(r8))})`);

  // 8b. 对照:原意即全网的 `*` **仍然**注册成全网 —— 证明没有过度收紧,
  //     也证明上面的断言不是因为「reconcile 根本不工作」而空过。
  await seed(b, settings([rule('*')]));
  await new Promise((r) => setTimeout(r, 1500));
  const r8b = await regs(w);
  results.intentionalAllUrls = r8b;
  log(r8b.length === 1 && (r8b[0].matches || []).includes('*://*/*'),
    `对照:原意即全网的 * 仍注册为全网 ${JSON.stringify(r8b.map((r) => r.matches))}`);

  await b.close();
  fs.rmSync(udd, { recursive: true, force: true });

  fs.writeFileSync(path.join(OUT, 'declarative.json'), JSON.stringify(results, null, 2));
  console.log(fail ? 'DECLARATIVE: FAIL' : 'DECLARATIVE: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
