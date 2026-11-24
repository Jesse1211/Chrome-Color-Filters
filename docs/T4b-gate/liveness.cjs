// T4b REAL_STACK_GATE —— 存活性(INV-5 / ADR-017)。
//
// gate 条款:
//   1. SPA 存活性 —— 在**公开可访问的 SPA**(react.dev / vuejs.org /
//      github.com 文件树导航)内做站内跳转,滤镜持续生效。
//      > 不要用 gmail —— 需要登录态,无头 agent 没有
//   2. (本脚本附加)站点脚本**主动移除**注入物后自动恢复 —— 这是 INV-5 的
//      字面要求,比 SPA 跳转更直接:直接在页面上下文里摘掉属性/变量,
//      断言滤镜回来。SPA 跳转只是这件事在真实世界里的一个诱因。
//
// 🔴 一律跑在 `npm run build` 产物上(ADR-038)。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, seed, rule, settings } = require('../T4a-gate/lib.cjs');

const OUT = path.join(__dirname, 'evidence');

// 读 documentElement 上的实际渲染结果 —— 用 getComputedStyle 而不是读属性,
// 因为我们要断言的是「用户看到的是滤镜态」,而不是「属性还在」。
const PROBE = `(() => {
  const el = document.documentElement;
  return {
    filter: getComputedStyle(el).filter,
    // 🔴 ADR-069:门控是 class,且多了一件注入物(同文档 SVG 定义)。
    //    属性时代的 attrOn/attrOff 在 ADR-069 之后恒为 false ——
    //    留着它们会让这些探针**空转地通过**。
    classOn: el.classList.contains('ccf-on'),
    svgDefs: !!document.getElementById('ccf-svg-defs'),
    varValue: el.style.getPropertyValue('--ccf-filter'),
  };
})()`;

// 等到 filter 变成非 none(或超时)—— JS 路径是异步的(要读 chrome.storage)。
async function waitFiltered(page, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(PROBE);
    if (last.filter && last.filter !== 'none') return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  return last;
}

async function main() {
  const results = { cases: [], assertions: [], pass: true };
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-t4b-live-'));
  const browser = await launch(userDataDir, { headless: true });

  function assert(name, ok, detail) {
    results.assertions.push({ name, ok, detail });
    if (!ok) results.pass = false;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${JSON.stringify(detail)}` : ''}`);
  }

  try {
    await seed(
      browser,
      settings([
        rule('react.dev', 'Grayscale', 100),
        rule('vuejs.org', 'Grayscale', 100),
        rule('*.wikipedia.org', 'Grayscale', 100),
      ]),
    );

    // ─────────── 条款 2(附加):站点脚本移除注入物 → 自动恢复 ───────────
    //
    // 这是 INV-5 的字面要求。用 wikipedia(静态站、稳定、公开)做载体。
    {
      const page = await browser.newPage();
      await page.goto('https://en.wikipedia.org/wiki/Color_blindness', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      const before = await waitFiltered(page);
      assert('wikipedia 初始即滤镜态', before.filter !== 'none', before);

      // 模拟站点脚本的三种破坏,逐一断言恢复。
      const sabotage = [
        // 🔴 ADR-069 之后的破坏面:class、SVG 定义容器、变量、style 属性。
        //    (旧版摘的是 data-ccf-on / 塞的是 data-ccf-off —— 那两个属性
        //     压根不再被设置,于是那两个场景什么都不测。)
        {
          name: '站点摘掉 ccf-on class',
          script: `document.documentElement.classList.remove('ccf-on')`,
        },
        {
          name: '站点摘掉 --ccf-filter 变量',
          script: `document.documentElement.style.removeProperty('--ccf-filter')`,
        },
        {
          name: '站点整体摘掉 class 属性(连带 ccf-on)',
          script: `document.documentElement.removeAttribute('class')`,
        },
        {
          name: '站点整体摘掉 style 属性',
          script: `document.documentElement.removeAttribute('style')`,
        },
      ];

      for (const s of sabotage) {
        await page.evaluate(s.script);
        // 破坏生效的即时快照(证明探针有效 —— 不验这一步的话,
        // 「恢复成功」可能只是因为破坏压根没发生)。
        const broken = await page.evaluate(PROBE);
        // MutationObserver 是微任务级的,但给足裕量。
        const restored = await waitFiltered(page, 3000);
        assert(`${s.name} → 自动恢复(INV-5)`, restored.filter !== 'none', {
          broken: broken.filter,
          restored: restored.filter,
        });
        results.cases.push({ case: s.name, broken: broken.filter, restored: restored.filter });
      }

      // 反复破坏 —— 速率上限之内应当每次都恢复。
      let restoredCount = 0;
      for (let i = 0; i < 20; i += 1) {
        await page.evaluate(`document.documentElement.classList.remove('ccf-on')`);
        const r = await waitFiltered(page, 2000);
        if (r.filter !== 'none') restoredCount += 1;
      }
      assert('连续 20 次破坏全部恢复', restoredCount === 20, { restoredCount });

      await page.close();
    }

    // ─────────── 条款 1:SPA 站内跳转后滤镜持续生效 ───────────
    const spas = [
      {
        host: 'react.dev',
        start: 'https://react.dev/',
        // SPA 站内跳转:点一个站内链接(Next.js client-side routing)。
        navigate: async (page) => {
          await page.evaluate(() => {
            const a = [...document.querySelectorAll('a[href^="/learn"]')][0];
            if (a) a.click();
          });
        },
      },
      {
        host: 'vuejs.org',
        start: 'https://vuejs.org/',
        navigate: async (page) => {
          await page.evaluate(() => {
            const a = [...document.querySelectorAll('a[href^="/guide"]')][0];
            if (a) a.click();
          });
        },
      },
    ];

    for (const spa of spas) {
      const page = await browser.newPage();
      try {
        await page.goto(spa.start, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const before = await waitFiltered(page);
        const urlBefore = page.url();
        assert(`${spa.host} 初始即滤镜态`, before.filter !== 'none', before);

        await spa.navigate(page);
        // 等 SPA 路由完成(URL 变化),不依赖网络空闲。
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline && page.url() === urlBefore) {
          await new Promise((r) => setTimeout(r, 150));
        }
        const urlAfter = page.url();
        await new Promise((r) => setTimeout(r, 1200)); // 让框架完成渲染

        const after = await page.evaluate(PROBE);
        const navigated = urlAfter !== urlBefore;
        assert(`${spa.host} 站内跳转确实发生(探针有效)`, navigated, {
          urlBefore,
          urlAfter,
        });
        assert(`${spa.host} 站内跳转后滤镜仍生效(INV-5)`, after.filter !== 'none', {
          urlAfter,
          filter: after.filter,
        });
        results.cases.push({
          case: `SPA ${spa.host}`,
          urlBefore,
          urlAfter,
          navigated,
          filterBefore: before.filter,
          filterAfter: after.filter,
        });
      } catch (e) {
        assert(`${spa.host} SPA 用例执行成功`, false, { error: String(e) });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'liveness.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.pass ? 'PASS' : 'FAIL'} — liveness`);
  process.exit(results.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
