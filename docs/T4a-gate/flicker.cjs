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
    const browser = await launch(udd, { headless: true });
    try {
      // (a) 基线:主开关关闭 → 页面必然彩色。证明探针确实能抓到带色帧。
      await seed(browser, settings([rule('*')], false));
      const off = await run(browser, key, url, 'off', null);

      await seed(browser, settings([rule('*')], true));

      // (c) 冷启动首访:全新标签页,sessionStorage 为空 → 快路径未命中。
      //     这是已申报的 blindSpot,如实记录但不作为 gate 的判据。
      const coldPage = await browser.newPage();
      const cold = await run(browser, key, url, 'cold', coldPage);

      // (b) 热路径:**同一个标签页**再次导航 —— 刷新/站内跳转/前进后退,
      //     即真实使用中的绝大多数导航。快路径同步命中,应零带色帧。
      const on = await run(browser, key, url, 'on', coldPage);
      await coldPage.close();

      results[key] = { off, cold, on };
      console.log(key, JSON.stringify(results[key]));
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(OUT, 'flicker.json'), JSON.stringify(results, null, 2));

  let fail = false;
  for (const [k, r] of Object.entries(results)) {
    if (r.off.colorFrames === 0) { console.log(`FAIL ${k}: 基线零带色帧 —— 探针无效`); fail = true; }
    if (r.on.colorFrames !== 0) { console.log(`FAIL ${k}: 滤镜态(快路径已热)${r.on.colorFrames}/${r.on.frames} 帧带色(INV-3 破裂)`); fail = true; }
    console.log(`INFO ${k}: 冷启动首访 ${r.cold.colorFrames}/${r.cold.frames} 帧带色(已申报 blindSpot)`);
  }
  console.log(fail ? 'FLICKER: FAIL' : 'FLICKER: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
