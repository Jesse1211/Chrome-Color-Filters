// REAL_STACK_GATE #2:零闪烁(INV-3 / ADR-018 / ADR-060)。
// 🔴 ADR-038:必须在 npm run build 产物上做。dev 模式必然不成立。
// 方法同 T0 §3.3:CDP Page.startScreencast(everyNthFrame:1)捕获导航全过程的
// 每一个合成帧,逐帧判定「带色像素数 > 总像素 0.2%」。
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DESIGN.md §6 T4a 要求覆盖**三种缓存状态,缺一不可**,本脚本逐一对应:
//
//   1. coldCache  —— 清空该 origin 的 localStorage 后首次访问(上一轮失败的正是它)
//   2. newTab     —— 新标签页访问同一站点
//   3. restart    —— 浏览器进程完全退出后,用同一 profile 重启再访问
//
// 外加 hot(同标签页再次导航)与 off(主开关关闭的基线,用于证明探针有效)。
//
// ⚠️ 该门禁此前是**非确定性失败**(6 次闪 3 次),取决于缓存是否命中。
//    故 `RUNS`(默认 5)次**全部**通过才算过 —— 单次通过不作数。
//    用 `CCF_FLICKER_RUNS=1` 可在排障时缩短,但验收必须是 5。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { launch, seed, rule, settings } = require('./lib.cjs');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const SITES = {
  github: 'https://github.com/',
  wikipedia: 'https://en.wikipedia.org/wiki/CSS',
  hn: 'https://news.ycombinator.com/',
};

// 一帧里「明显带色」的像素占比是否超过 0.2%。
function colorFraction(buf) {
  const img = PNG.sync.read(Buffer.from(buf, 'base64'));
  let colored = 0;
  const total = img.width * img.height;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i], g = img.data[i+1], b = img.data[i+2];
    if (Math.max(r,g,b) - Math.min(r,g,b) > 12) colored++;
  }
  return { frac: colored / total, total };
}

// 在**同一个 page** 上录屏导航。warmPage 为 null 时自己新建(冷启动场景)。
async function run(browser, key, url, tag, page) {
  const own = !page;
  if (own) page = await browser.newPage();
  const client = await page.target().createCDPSession();
  const frames = [];
  client.on('Page.screencastFrame', async (f) => {
    frames.push(f.data);
    try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1500));
  try { await client.send('Page.stopScreencast'); } catch {}

  let colorFrames = 0, worst = -1, worstIdx = -1;
  frames.forEach((f, i) => {
    const { frac } = colorFraction(f);
    if (frac > 0.002) { colorFrames++; if (frac > worst) { worst = frac; worstIdx = i; } }
  });
  if (worstIdx >= 0) {
    fs.writeFileSync(path.join(OUT, `flicker-${key}-${tag}-worst${worstIdx}.png`),
      Buffer.from(frames[worstIdx], 'base64'));
  }
  if (own) await page.close();
  return { frames: frames.length, colorFrames, worst: worst < 0 ? 0 : Math.round(worst*10000)/10000 };
}

const RUNS = Number(process.env.CCF_FLICKER_RUNS || 5);

/** 清空该 origin 的 localStorage —— 制造「冷缓存」状态。 */
async function clearOriginStorage(browser, url) {
  const p = await browser.newPage();
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await p.evaluate(() => {
      try {
        // 只删本扩展的键,不动站点自己的数据(同 ADR-060 的窄口精神)。
        const doomed = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf('__ccf') === 0) doomed.push(k);
        }
        doomed.forEach((k) => localStorage.removeItem(k));
      } catch (e) { /* 存储不可用 —— 本就等同于冷缓存 */ }
    });
  } finally { await p.close(); }
}

/** 跑一轮完整的五场景测量,返回 { site: {off, coldCache, newTab, restart, hot} }。 */
async function oneRun(runIdx) {
  const results = {};
  for (const [key, url] of Object.entries(SITES)) {
    const udd = path.join(OUT, `fp-${key}-r${runIdx}`);
    fs.rmSync(udd, { recursive: true, force: true });

    // ── 阶段 1:基线 + 建立权威判定 ────────────────────────────────────
    let off;
    {
      const browser = await launch(udd, { headless: true });
      try {
        // (a) 基线:主开关关闭 → 页面必然彩色。证明探针确实能抓到带色帧。
        await seed(browser, settings([rule('*')], false));
        off = await run(browser, key, url, `r${runIdx}-off`, null);

        // 用户打开主开关并配置规则 —— 真实用户的必然前提。
        await seed(browser, settings([rule('*')], true));
      } finally { await browser.close(); }
    }

    // ── 阶段 2:🔴 冷缓存 —— 清空该 origin 的 localStorage 后首次访问 ──
    //    这是上一轮失败的那个场景。清掉快路径键后,同步阶段无从得知
    //    (mode,intensity);扩展必须靠异步权威补上并回写,**本次**可能带色。
    //
    //    ⚠️ 判据说明:INV-3 的要求是「在匹配到规则的页面上,用户绝不可见
    //    任何未滤镜的帧」。冷缓存首访同样在此范围内 —— 故它**计入 fail**,
    //    不降级为 INFO。扩展能做到的原因:ADR-060 的 localStorage 条目
    //    在用户配置规则后的第一次访问就已写入并**跨重启存活**,
    //    此处的"清空"是人为制造的极端状态,用来证明即便如此也不闪。
    let coldCache, newTab, restart, hot;
    {
      const browser = await launch(udd, { headless: true });
      try {
        await clearOriginStorage(browser, url);
        const p1 = await browser.newPage();
        coldCache = await run(browser, key, url, `r${runIdx}-coldcache`, p1);
        // (b) 热路径:**同一个标签页**再次导航 —— 刷新/站内跳转/前进后退。
        hot = await run(browser, key, url, `r${runIdx}-hot`, p1);
        await p1.close();

        // ── 🔴 新标签页访问同一站点 ───────────────────────────────────
        //    sessionStorage 方案在这里必然失败(缓存按标签页);
        //    localStorage 按 origin,故新标签页能同步命中。
        const p2 = await browser.newPage();
        newTab = await run(browser, key, url, `r${runIdx}-newtab`, p2);
        await p2.close();
      } finally { await browser.close(); }
    }

    // ── 阶段 3:🔴 浏览器重启后首次访问 ────────────────────────────────
    //    进程已完全退出,用同一份 profile 重新启动(真实用户第二天开浏览器)。
    //    sessionStorage 到这里必然蒸发 —— 这正是上一轮 6 次闪 3 次的根因。
    {
      const browser = await launch(udd, { headless: true });
      try {
        const p = await browser.newPage();
        restart = await run(browser, key, url, `r${runIdx}-restart`, p);
        await p.close();
      } finally { await browser.close(); }
    }

    results[key] = { off, coldCache, newTab, restart, hot };
    console.log(`run${runIdx} ${key}`, JSON.stringify(results[key]));
  }
  return results;
}

/**
 * 🔴 反向探针:一条**表达不出来的** glob 绝不能给它匹配不到的站点套滤镜。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 上一轮的缺陷与**此前全部门禁的盲区**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 当时 `*.baidu.*`(ADR-006 与 DESIGN.md:61-64 的旗舰示例)会被转换器
 * 兜底成「全网 match pattern」,与**裸 html** 的预生成 CSS 组合 →
 * **用户只配了 baidu,结果全网每个站点的首帧都被套上灰阶滤镜。**
 *
 * 本文件其余场景用的都是 `rule('*')`(原意即全网),
 * 「每个站点都被套滤镜」在那里**正是正确行为**,
 * 所以这个缺陷在本门禁里**不可能被看见**。方向是反的:
 *
 * - 其余场景问「该套滤镜的套上了吗」(漏匹配 → INV-3);
 * - 本函数问「**不该**套的没套上吧」(多匹配 → INV-1)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 为什么本场景**不能**用逐帧截屏,而必须读 computed style
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 这是本轮实测得出的结论,写下来以免后人又绕一遍:
 *
 * 把 bug 放回产品代码后,用**逐帧截屏**测 hn / github / wikipedia,
 * 门禁照样 PASS。原因是 `filter.css` 的 `html[data-ccf-off]` 压制规则会
 * 在 JS 跑完后把滤镜撤掉,而那个「已上色」的窗口实测只有 **约 11ms**:
 *
 * ```
 * t=7ms   filter=grayscale(1)  data-ccf-off=false   ← 未配置的站点被上色
 * t=14ms  filter=grayscale(1)  data-ccf-off=false
 * t=18ms  filter=none          data-ccf-off=true    ← JS 判定不匹配,撤掉
 * ```
 *
 * 11ms 常常落不进任何一个合成帧,于是像素探针**系统性漏报**。
 * 而「页面根元素在某一刻确实是 grayscale(1)」是**确定性**事实,
 * 读 computed style 就能稳定抓到 —— 判据因此落在这里。
 *
 * 📌 这**不是**降低标准:缺陷的本质就是「未配置的站点被套了滤镜」,
 * computed style 直接测的就是这件事,比「碰运气看能不能截到那一帧」更强。
 * 其余场景(正向的 INV-3)仍然用逐帧截屏 —— 那里要证明的是
 * 「用户看不到未滤镜的帧」,那是关于**像素**的命题,必须用像素测。
 *
 * ## 假阴性防护
 *
 * 「全程 filter=none」在一个**扩展根本没加载**的环境里会自动成立。
 * 故每个站点都配一条对照:同一 profile、同一探针,把规则换成 `*`
 * (原意即全网)后必须测到 `grayscale(1)`。
 * 两者一起才构成证据。
 */
async function filterTimeline(browser, url) {
  const p = await browser.newPage();
  try {
    await p.evaluateOnNewDocument(() => {
      window.__ccfSamples = [];
      const t0 = performance.now();
      const snap = () => {
        try {
          const de = document.documentElement;
          if (!de) return;
          window.__ccfSamples.push([
            Math.round(performance.now() - t0),
            getComputedStyle(de).filter,
          ]);
        } catch (e) { /* 页面尚未可查询 */ }
      };
      snap();
      // 4ms 间隔密集采样 1 秒 —— 足以覆盖「JS 撤掉滤镜」之前的窗口
      // (实测该窗口约 11ms,采样间隔必须远小于它)。
      let n = 0;
      const iv = setInterval(() => { snap(); if (++n > 250) clearInterval(iv); }, 4);
      requestAnimationFrame(() => { snap(); requestAnimationFrame(snap); });
    });
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 1200));
    const samples = await p.evaluate(() => window.__ccfSamples || []);
    const filtered = samples.filter(
      (x) => x[1] && x[1] !== 'none' && x[1] !== 'nohtml',
    );
    return {
      samples: samples.length,
      filteredSamples: filtered.length,
      firstFiltered: filtered.length ? filtered[0] : null,
    };
  } finally { await p.close(); }
}

async function unmatchedHostRun(runIdx) {
  const results = {};
  for (const [key, url] of Object.entries(SITES)) {
    const udd = path.join(OUT, `fp-unmatched-${key}-r${runIdx}`);
    fs.rmSync(udd, { recursive: true, force: true });

    let unmatched, control;
    const browser = await launch(udd, { headless: true });
    try {
      // (a) 只配表达不出来的 glob。github/wikipedia/hn 都**不**匹配它们。
      //     正确行为:根元素的 filter **自始至终**是 none。
      await seed(browser, settings([rule('*.baidu.*'), rule('*weibo*', 'RedGreen', 60)], true));
      await new Promise((r) => setTimeout(r, 1200));
      unmatched = await filterTimeline(browser, url);

      // (b) 对照:换成原意即全网的 `*` —— 同站点必须测到非 none 的 filter。
      await seed(browser, settings([rule('*')], true));
      await new Promise((r) => setTimeout(r, 1200));
      control = await filterTimeline(browser, url);
    } finally { await browser.close(); }

    results[key] = { unmatched, control };
    console.log(`run${runIdx} unmatched ${key}`, JSON.stringify(results[key]));
    fs.rmSync(udd, { recursive: true, force: true });
  }
  return results;
}

(async () => {
  const all = [];
  const allUnmatched = [];
  let fail = false;

  for (let runIdx = 1; runIdx <= RUNS; runIdx++) {
    console.log(`──────── RUN ${runIdx}/${RUNS} ────────`);
    const results = await oneRun(runIdx);
    all.push(results);

    for (const [k, r] of Object.entries(results)) {
      // 探针有效性 —— 基线必须抓到带色帧,否则下面全是假阴性。
      if (r.off.colorFrames === 0) {
        console.log(`FAIL run${runIdx} ${k}: 基线零带色帧 —— 探针无效`); fail = true;
      }
      // 🔴 三种缓存状态 + 热路径,全部同等判 fail(INV-3 不分场景)。
      for (const scen of ['coldCache', 'newTab', 'restart', 'hot']) {
        if (r[scen].colorFrames !== 0) {
          console.log(`FAIL run${runIdx} ${k}: ${scen} ${r[scen].colorFrames}/${r[scen].frames} 帧带色(INV-3 破裂)`);
          fail = true;
        }
      }
      console.log(`INFO run${runIdx} ${k}: coldCache ${r.coldCache.colorFrames}/${r.coldCache.frames}；newTab ${r.newTab.colorFrames}/${r.newTab.frames}；restart ${r.restart.colorFrames}/${r.restart.frames}；hot ${r.hot.colorFrames}/${r.hot.frames}；基线 ${r.off.colorFrames}/${r.off.frames}`);
    }

    // ── 🔴 反向场景:表达不出来的 glob 不得给未匹配站点上色(INV-1) ──
    const um = await unmatchedHostRun(runIdx);
    allUnmatched.push(um);
    for (const [k, r] of Object.entries(um)) {
      // (i) 探针/扩展有效性:对照(规则 = `*`)必须测到滤镜。
      //     否则扩展没加载,下面那条断言会在空环境里自动成立。
      if (r.control.filteredSamples === 0) {
        console.log(`FAIL run${runIdx} unmatched ${k}: 对照(规则=*)未测到任何滤镜 —— ` +
          `扩展未生效(采样 ${r.control.samples} 次),本组断言失去意义`);
        fail = true;
      }
      // (ii) 🔴 正题:只配了表达不出来的 glob 时,未匹配站点的根元素
      //      **任何时刻**都不得带滤镜。
      if (r.unmatched.samples === 0) {
        console.log(`FAIL run${runIdx} unmatched ${k}: 未取到任何采样 —— 探针无效`);
        fail = true;
      } else if (r.unmatched.filteredSamples > 0) {
        console.log(`FAIL run${runIdx} unmatched ${k}: 规则只配了 *.baidu.* / *weibo*,` +
          `但 ${k} 有 ${r.unmatched.filteredSamples}/${r.unmatched.samples} 次采样测到滤镜 ` +
          `(首次 ${JSON.stringify(r.unmatched.firstFiltered)}) —— ` +
          '未配置的站点被套上滤镜(违反 INV-1 与 DESIGN.md §1 匹配语义第 4 条)');
        fail = true;
      }
      console.log(`INFO run${runIdx} unmatched ${k}: unmatched 带滤镜采样 ${r.unmatched.filteredSamples}/${r.unmatched.samples}(应 0)；` +
        `对照 * 带滤镜采样 ${r.control.filteredSamples}/${r.control.samples}(应 >0)`);
    }
  }

  fs.writeFileSync(path.join(OUT, 'flicker.json'),
    JSON.stringify({ runs: RUNS, all, unmatchedHost: allUnmatched }, null, 2));

  // 🔴 连续 RUNS 次**全部**通过才算过 —— 该门禁此前是非确定性失败,
  //    单次通过不能作为证据。
  console.log(fail ? `FLICKER: FAIL (${RUNS} 次中存在失败)` : `FLICKER: PASS (连续 ${RUNS} 次全绿)`);

  // 🔴 退出码必须与上面那行字面一致 —— 任何按退出码判定的 CI/Owner
  //    都只看它。这里**不要**用 `process.exit()`:它会在 stdout 尚未
  //    flush 完时就终止进程,把最后几行(含上面那行判决)吞掉,
  //    于是「打印了 FAIL 却看不到」或「看到 FAIL 但退出码读成 0」。
  //    改为设 `exitCode` 并自然返回:Node 会在事件循环排空、
  //    stdout flush 之后才用它退出。
  //
  // ⚠️ 另:用管道跑本脚本时(`node flicker.cjs | tail`),`$?` 拿到的是
  //    **管道最后一个命令**的退出码,不是本脚本的。要判定本脚本请用
  //    `node flicker.cjs > out.log 2>&1; echo $?`,或 `set -o pipefail`。
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
