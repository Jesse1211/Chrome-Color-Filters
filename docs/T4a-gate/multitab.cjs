// REAL_STACK_GATE #7:🔴 冷启动 + 会话恢复 + 多标签页(DESIGN.md §6 T4a 点名必测)。
//
// > 这是 ADR-062 **唯一可能被推翻**的场景,必测:
// > 配置规则 → 在多个已配置站点上开约 10 个重标签页 → 完全退出 Chrome →
// > 冷启动并恢复会话 → 逐帧录屏全部标签页。
// >
// > 理论风险:某个导航在扩展系统读完磁盘 StateStore 之前就提交了。
//
// 🔴 ADR-038:在 npm run build 产物上跑。
const path = require('path');
const fs = require('fs');
const { PNG } = require('pngjs');
const { launch, seed, rule, settings } = require('./lib.cjs');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// 10 个「重」标签页 —— 取内容量大、渲染慢的真实页面。
const URLS = [
  'https://en.wikipedia.org/wiki/CSS',
  'https://github.com/',
  'https://news.ycombinator.com/',
  'https://en.wikipedia.org/wiki/HTML',
  'https://en.wikipedia.org/wiki/JavaScript',
  'https://github.com/features',
  'https://news.ycombinator.com/newest',
  'https://en.wikipedia.org/wiki/Web_browser',
  'https://en.wikipedia.org/wiki/Cascading_Style_Sheets',
  'https://github.com/about',
];

function colorFraction(buf) {
  const img = PNG.sync.read(Buffer.from(buf, 'base64'));
  let colored = 0;
  const total = img.width * img.height;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 12) colored++;
  }
  return colored / total;
}

/** 录屏一次导航,返回带色帧数。 */
async function record(page, url, tag) {
  const client = await page.target().createCDPSession();
  const frames = [];
  client.on('Page.screencastFrame', async (f) => {
    frames.push(f.data);
    try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1200));
  try { await client.send('Page.stopScreencast'); } catch {}

  let colorFrames = 0, worst = -1, worstIdx = -1;
  frames.forEach((f, i) => {
    const frac = colorFraction(f);
    if (frac > 0.002) { colorFrames++; if (frac > worst) { worst = frac; worstIdx = i; } }
  });
  if (worstIdx >= 0) {
    fs.writeFileSync(path.join(OUT, `multitab-${tag}-worst${worstIdx}.png`),
      Buffer.from(frames[worstIdx], 'base64'));
  }
  return { frames: frames.length, colorFrames, worst: worst < 0 ? 0 : Math.round(worst * 10000) / 10000 };
}

const RUNS = Number(process.env.CCF_MULTITAB_RUNS || 5);

(async () => {
  let fail = false;
  const all = [];

  for (let runIdx = 1; runIdx <= RUNS; runIdx++) {
    console.log(`──────── RUN ${runIdx}/${RUNS} ────────`);
    const udd = path.join(OUT, `mt-r${runIdx}`);
    fs.rmSync(udd, { recursive: true, force: true });

    // ── 阶段 1:配置规则,并在 10 个标签页上访问过(建立会话) ──────────
    let b = await launch(udd, { headless: true });
    await seed(b, settings([rule('*')], true));
    await new Promise((r) => setTimeout(r, 1500));
    for (const u of URLS) {
      const p = await b.newPage();
      await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
      // 刻意**不关**页面 —— 模拟「退出时开着 10 个标签页」。
    }
    // 🔴 完全退出浏览器进程。
    await b.close();

    // ── 阶段 2:冷启动,同一 profile,同时打开全部 10 个标签页并逐帧录屏 ──
    //    并发打开是关键:它最大化「某个导航赶在扩展系统读完磁盘之前提交」的概率。
    b = await launch(udd, { headless: true });
    const pages = await Promise.all(URLS.map(() => b.newPage()));
    const measured = await Promise.all(
      pages.map((p, i) => record(p, URLS[i], `r${runIdx}-tab${i}`)),
    );
    await b.close();

    const perRun = {};
    measured.forEach((m, i) => {
      perRun[`tab${i}`] = { url: URLS[i], ...m };
      if (m.colorFrames !== 0) {
        console.log(`FAIL run${runIdx} tab${i} (${URLS[i]}): ${m.colorFrames}/${m.frames} 帧带色`);
        fail = true;
      }
    });
    const totalFrames = measured.reduce((a, m) => a + m.frames, 0);
    const totalColor = measured.reduce((a, m) => a + m.colorFrames, 0);
    console.log(`INFO run${runIdx}: 10 标签页合计 ${totalColor}/${totalFrames} 帧带色`);
    all.push(perRun);
  }

  fs.writeFileSync(path.join(OUT, 'multitab.json'), JSON.stringify({ runs: RUNS, all }, null, 2));
  console.log(fail ? `MULTITAB: FAIL` : `MULTITAB: PASS (连续 ${RUNS} 次全绿)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
