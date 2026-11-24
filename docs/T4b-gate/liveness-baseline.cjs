// T4b REAL_STACK_GATE —— 存活性门禁的**探针有效性基线**(对照组)。
//
// 🔴 为什么需要这个脚本:
//
// `liveness.cjs` 的每个用例里,「破坏后」那一拍抓到的 filter 仍然是
// `grayscale(1)` —— 因为 MutationObserver 的恢复是**微任务级**的,
// 快到 CDP 的下一次 evaluate 根本观测不到中间态。
//
// 这带来一个严肃的问题:**那些 PASS 可能是空转的。**
// 如果破坏压根没生效(比如选择器写错、属性名拼错),结果看起来
// 与「破坏了但瞬间恢复」完全一样,全绿而无意义 ——
// 这正是 DESIGN.md §8 与 ADR-066 反复警告的那种自欺。
//
// 故本脚本用**同步快照**抓中间态:在同一个 `page.evaluate` 里先摘掉注入物、
// 再**同步**读 `getComputedStyle` —— MutationObserver 回调是微任务,
// 此刻还没跑,于是能看到真正的「破坏已生效、尚未恢复」那一拍。
//
// 两个脚本合起来才构成完整证据:
//
//   - 本脚本:破坏手法有效 —— 不恢复时滤镜会掉(探针有效)
//   - liveness.cjs:同样的破坏手法下滤镜不掉(恢复有效)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, seed, rule, settings } = require('../T4a-gate/lib.cjs');

const OUT = path.join(__dirname, 'evidence');

const PROBE = `(() => {
  const el = document.documentElement;
  return {
    filter: getComputedStyle(el).filter,
    // 🔴 ADR-069:门控改为 class,另加同文档 SVG 定义容器。
    //    属性时代的 attrOn/attrOff 恒为 false —— 留着会让探针空转。
    classOn: el.classList.contains('ccf-on'),
    svgDefs: !!document.getElementById('ccf-svg-defs'),
  };
})()`;

async function main() {
  const results = { assertions: [], cases: [], pass: true };
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-t4b-base-'));
  const browser = await launch(userDataDir, { headless: true });

  function assert(name, ok, detail) {
    results.assertions.push({ name, ok, detail });
    if (!ok) results.pass = false;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${JSON.stringify(detail)}` : ''}`);
  }

  try {
    // 🔴 这里的宿主选择是被实测纠正过的，请连同理由一起读：
    //
    //    第一版把 `*.wikipedia.org` 当作对照组，当场 FAIL，数据是：
    //      { beforeFilter: 'url("#ccf-gray-100")', syncAfterFilter: 'url("#ccf-gray-100")', syncClassOn: false }
    //    即 class **确实被摘掉了**（syncClassOn:false），滤镜却没掉。
    //
    //    原因不是缺陷，而是 **ADR-062 按设计工作**：已配置的 host 上
    //    有声明式注册的预生成 CSS，它的选择器是**裸 `html`**：
    //      html { filter: grayscale(1) !important; }   (filters/gray-100.css)
    //    那条规则根本不看我们的属性，所以摧属性摧不掉它 ——
    //    这正是 INV-3 零闪烁的基础（首帧不能依赖 JS）。
    //
    //    于是对照组必须找一个「滞镜**只**来自 JS 路径」的场景。
    //    DESIGN.md §6 T4a 点名了正是这个场景：**已打开的标签页** ——
    //    「取消注册不会移除已注入的样式」的对偶面是：**新增**注册也不会
    //    给已打开的页面注入样式。所以：先在**无规则**时打开页面，
    //    再添规则 —— 此时该页的滞镜完全由 JS 路径（属性 + 变量）撑着，
    //    摧掉属性必然掉色，「破坏手法是否有效」因此可观测。

    // 步骤 1：**无规则**状态下打开页面（此时无任何注册的 CSS）。
    await seed(browser, settings([]));

    const page = await browser.newPage();
    await page.goto('https://en.wikipedia.org/wiki/Color_blindness', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    const noRule = await page.evaluate(PROBE);
    assert('无规则时页面未滞镜', noRule.filter === 'none', noRule);

    // 步骤 2：给**已打开**的这个标签页添规则。
    //    注册变更不影响已打开页面（Chrome 既定行为），
    //    所以这一次上色完全是 JS 路径的功劳 —— 正是我们要的对照条件。
    await seed(browser, settings([rule('*.wikipedia.org', 'Grayscale', 100)]));

    // 等滤镜就位。
    for (let i = 0; i < 60; i += 1) {
      const p = await page.evaluate(PROBE);
      if (p.filter !== 'none') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const before = await page.evaluate(PROBE);
    assert('对照组初始即滤镜态', before.filter !== 'none', before);

    // ── 关键一步：在**同一个** evaluate 里破坏 + 同步读取。
    //
    //    content script 与页面共享 DOM，但不共享 JS 世界（isolated world），
    //    所以页面脚本拿不到我们的 observer 实例，没法把它停掉。
    //    但我们不需要停它 —— 只需赶在它前面读一拍：
    //    MutationObserver 的回调是**微任务**，而同一个同步块里的
    //    `getComputedStyle` 在它之前执行。于是这一拍抓到的就是
    //    真正的中间态：破坏已生效、恢复尚未发生。
    const sync = await page.evaluate(`(() => {
      const el = document.documentElement;
      const out = {};
      out.beforeFilter = getComputedStyle(el).filter;
      // 🔴 ADR-069:破坏手法改为摘 class(属性已废止,摘它什么都不会发生)。
      el.classList.remove('ccf-on');
      el.style.removeProperty('--ccf-filter');
      // 🔴 同步读取 —— MutationObserver 回调还没跑(它是微任务)。
      out.syncAfterFilter = getComputedStyle(el).filter;
      out.syncClassOn = el.classList.contains('ccf-on');
      return out;
    })()`);

    // 这就是「破坏手法确实有效」的直接证据:同步快照里滤镜已经掉了。
    assert(
      '🔴 探针有效:摘掉 class 后的**同步**快照显示滤镜确实消失',
      sync.beforeFilter !== 'none' && sync.syncAfterFilter === 'none',
      sync,
    );

    // 然后让微任务跑完,断言恢复。
    await new Promise((r) => setTimeout(r, 500));
    const after = await page.evaluate(PROBE);
    assert('🔴 微任务跑完后滤镜已恢复(INV-5)', after.filter !== 'none', after);

    results.cases.push({ sync, after });
    await page.close();
  } finally {
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, 'liveness-baseline.json'),
    JSON.stringify(results, null, 2),
  );
  console.log(`\n${results.pass ? 'PASS' : 'FAIL'} — liveness-baseline`);
  process.exit(results.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
