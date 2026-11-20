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

(async () => {
  const all = [];
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
  }

  fs.writeFileSync(path.join(OUT, 'flicker.json'),
    JSON.stringify({ runs: RUNS, all }, null, 2));

  // 🔴 连续 RUNS 次**全部**通过才算过 —— 该门禁此前是非确定性失败,
  //    单次通过不能作为证据。
  console.log(fail ? `FLICKER: FAIL (${RUNS} 次中存在失败)` : `FLICKER: PASS (连续 ${RUNS} 次全绿)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
