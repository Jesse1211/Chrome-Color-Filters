// REAL_STACK_GATE #2:零闪烁(INV-3 / ADR-018)。
// 🔴 ADR-038:必须在 npm run build 产物上做。dev 模式必然不成立。
// 方法同 T0 §3.3:CDP Page.startScreencast(everyNthFrame:1)捕获导航全过程的
// 每一个合成帧,逐帧判定「带色像素数 > 总像素 0.2%」。
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

(async () => {
  const results = {};
  for (const [key, url] of Object.entries(SITES)) {
    const udd = path.join(OUT, `fp-${key}`);
    fs.rmSync(udd, { recursive: true, force: true });
    // ── 阶段 1：基线（主开关关闭）+ 用户配置规则后的首次访问。
    let off;
    {
      const browser = await launch(udd, { headless: true });
      try {
        // (a) 基线：主开关关闭 → 页面必然彩色。证明探针确实能抓到带色帧。
        await seed(browser, settings([rule('*')], false));
        off = await run(browser, key, url, 'off', null);

        // 用户打开主开关并配置规则，然后访问一次 —— 这一步建立「权威判定结果」，
        // 是真实用户的必然前提：没配规则就没有「该滤镜的站点」可言。
        await seed(browser, settings([rule('*')], true));
        const warm = await browser.newPage();
        await warm.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
        await new Promise((r) => setTimeout(r, 1200));
        await warm.close();
      } finally { await browser.close(); }
    }

    // ── 阶段 2：真正的**浏览器冷启动** —— 进程已完全退出，
    //    用同一份 profile 重新启动（即真实用户第二天打开浏览器）。
    //    🔴 这就是 DESIGN.md §6 T4a 逐字要求的「冷启动加载录屏」，
    //    其结果**必须**进入 fail 判据，不得降级为 INFO。
    let cold, on;
    {
      const browser = await launch(udd, { headless: true });
      try {
        const coldPage = await browser.newPage();
        cold = await run(browser, key, url, 'cold', coldPage);

        // (b) 热路径：**同一个标签页**再次导航 —— 刷新/站内跳转/前进后退。
        on = await run(browser, key, url, 'on', coldPage);
        await coldPage.close();
      } finally { await browser.close(); }
    }

    results[key] = { off, cold, on };
    console.log(key, JSON.stringify(results[key]));
  }
  fs.writeFileSync(path.join(OUT, 'flicker.json'), JSON.stringify(results, null, 2));

  let fail = false;
  for (const [k, r] of Object.entries(results)) {
    if (r.off.colorFrames === 0) { console.log(`FAIL ${k}: 基线零带色帧 —— 探针无效`); fail = true; }
    if (r.on.colorFrames !== 0) { console.log(`FAIL ${k}: 滤镜态(快路径已热)${r.on.colorFrames}/${r.on.frames} 帧带色(INV-3 破裂)`); fail = true; }
    // 🔴 冷启动是 T4a gate 逐字写明的子句（「冷启动加载录屏，逐帧检查，
    //    第一个可见帧即已滤镜」），必须与热路径同等判 fail。
    //    曾经这里是一行不影响结果的 INFO —— 那是在绕过自己的验收标准。
    if (r.cold.colorFrames !== 0) { console.log(`FAIL ${k}: 冷启动 ${r.cold.colorFrames}/${r.cold.frames} 帧带色（INV-3 破裂）`); fail = true; }
    console.log(`INFO ${k}: 冷启动 ${r.cold.colorFrames}/${r.cold.frames}；热路径 ${r.on.colorFrames}/${r.on.frames}；基线 ${r.off.colorFrames}/${r.off.frames}`);
  }
  console.log(fail ? 'FLICKER: FAIL' : 'FLICKER: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
