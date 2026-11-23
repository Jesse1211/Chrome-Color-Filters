// T4b REAL_STACK_GATE —— 三项合一:
//
//   2. **iframe 继承**(ADR-016)—— 含跨域 iframe 的页面上,iframe 内容同样被滤镜覆盖
//   3. **交互完整性**(INV-1)—— 点击命中区域、文本选中、video 播放、CSS 动画均正常
//   4. **(c) Network 实测**(ADR-026)—— 断言 content script 上下文**零条扩展发起的请求**
//
// 🔴 为什么 (c) 不能用静态断言代替(它已在 tests/t4b-static-gates.test.ts 里做过):
//    静态审计挡不住「运行时才构造出来的外传」——
//    `globalThis['fet'+'ch']`、`new (window['Web'+'Socket'])` 之类。
//    gate 因此要求三项**全做**,实测是最后一道。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, seed, rule, settings, EXT } = require('../T4a-gate/lib.cjs');

const OUT = path.join(__dirname, 'evidence');

// 本地 fixture:含跨域 iframe + video + CSS 动画 + 可点击区域 + 可选文本。
// 用 data: 不行(扩展不注入 data: 文档),故起一个本地 http 服务。
const FIXTURE = `<!doctype html>
<html><head><meta charset="utf-8"><title>ccf t4b fixture</title>
<style>
  body { margin: 0; font-family: sans-serif; background: #fff; }
  #hit { position: absolute; left: 40px; top: 300px; width: 200px; height: 80px;
         background: rgb(220, 20, 60); color: #fff; border: 0; font-size: 18px; }
  #spin { width: 120px; height: 120px; background: rgb(30, 120, 220);
          animation: spin 2s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  #text { font-size: 20px; padding: 10px; }
</style></head>
<body>
  <h1 style="color: rgb(200,30,30)">T4b fixture</h1>
  <div id="spin"></div>
  <p id="text">selectable text for INV-1 interaction check</p>
  <button id="hit" onclick="window.__clicked = (window.__clicked||0)+1">click me</button>
  <video id="vid" width="320" height="180" muted playsinline
         src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"></video>
  <!--
    🔴 跳域 iframe（ADR-016）—— 载体的选择是被实测纠正过的，不要换回 example.com：

    第一版用 "https://example.com/"，滞镜态量得 maxChannelSpread == 0，看起来 PASS。
    但对照组（主开关 OFF）量得的也是 **0** —— 当场穿帮。
    进一步用**无扩展的纯净 Chrome** 直接量 example.com：
      maxChannelSpread = 0，480000/480000 个像素的 spread 全为 0。
    即 example.com **本身就是全无彩色的页面**（白底黑字）。

    于是那条断言是**空转**的：即使 ADR-016 完全损坏（iframe 根本没被滞镜覆盖），
    它照样 PASS。这正是 DESIGN.md §8 与 ADR-066 反复警告的那种自欺。

    改用 placehold.co 生成的**纯红底 + 纯绿字**图片：跳域、可嵌入、
    且纯净 Chrome 下实测 maxChannelSpread == 255（理论最大值）。
    探针因此有最大的区分度：滞镜态应为 0，未滞镜态应为 255。
  -->
  <iframe id="xframe" width="400" height="240"
          src="https://placehold.co/400x240/ff0000/00ff00.png"></iframe>
</body></html>`;

// 读某个元素的平均像素(经由截图),用来判断「是否被滤镜覆盖」。
// 对 iframe 用元素截图 —— 跨域 iframe 的内容读不到 DOM,但**截得到像素**,
// 这正是 ADR-016 要验的东西(用户看到的是不是灰的)。
async function channelSpread(elementHandle) {
  const buf = await elementHandle.screenshot({ encoding: 'binary' });
  const { PNG } = require('pngjs');
  const png = PNG.sync.read(Buffer.from(buf));
  let maxSpread = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    const a = png.data[i + 3];
    if (a < 250) continue;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (spread > maxSpread) maxSpread = spread;
  }
  return maxSpread;
}

function startServer() {
  const http = require('http');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(FIXTURE);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  const results = { assertions: [], network: {}, pass: true };
  const { server, port } = await startServer();
  const host = `127.0.0.1`;
  const url = `http://${host}:${port}/`;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-t4b-noninv-'));
  const browser = await launch(userDataDir, { headless: true });

  function assert(name, ok, detail) {
    results.assertions.push({ name, ok, detail });
    if (!ok) results.pass = false;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${JSON.stringify(detail)}` : ''}`);
  }

  try {
    await seed(browser, settings([rule(host, 'Grayscale', 100)]));

    // ───────────────── (c) Network 实测(ADR-026) ─────────────────
    //
    // 记录**所有**请求,随后按 initiator/URL 判定有无「扩展发起的请求」。
    // 扩展发起的请求有两种可观测特征:
    //   - URL 为 chrome-extension://<id>/...(加载扩展自身资源)
    //   - initiator 指向 content script 的脚本 URL
    // 前者是正常的(manifest 里的 CSS/JS 本身要被加载);
    // 真正违反 ADR-026 的是**向外部网络**发起的请求。
    const requests = [];
    const page = await browser.newPage();
    page.on('request', (req) => {
      requests.push({ url: req.url(), resourceType: req.resourceType(), method: req.method() });
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 等滤镜就位。
    let state = null;
    for (let i = 0; i < 60; i += 1) {
      state = await page.evaluate(
        `getComputedStyle(document.documentElement).filter`,
      );
      if (state && state !== 'none') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert('fixture 页面已滤镜', state === 'grayscale(1)', { filter: state });

    // 给 video/iframe/动画一点时间,也给任何潜在的外传请求时间发出。
    await new Promise((r) => setTimeout(r, 3000));

    // 允许清单:fixture 自身 + 它显式引用的第三方资源 + 扩展自身资源。
    const ALLOWED = [
      url,
      'https://placehold.co/',
      'https://interactive-examples.mdn.mozilla.net/',
      'chrome-extension://',
      'data:',
      'about:',
    ];
    const foreign = requests.filter(
      (r) => !ALLOWED.some((a) => r.url.startsWith(a)),
    );
    results.network = {
      total: requests.length,
      foreign,
      extensionOrigin: requests.filter((r) => r.url.startsWith('chrome-extension://')),
    };
    assert(
      '🔴 (c) Network 实测:零条「页面与其资源之外」的请求(ADR-026)',
      foreign.length === 0,
      { foreignCount: foreign.length, sample: foreign.slice(0, 5) },
    );
    // 尤其:没有任何请求的 URL 里带着页面内容(典型的信标形态 ?d=<内容>)。
    const suspicious = requests.filter((r) =>
      /selectable text|fixture|innerText|document\./i.test(r.url),
    );
    assert('🔴 无请求 URL 携带页面内容(图片/信标外传)', suspicious.length === 0, {
      suspicious: suspicious.slice(0, 5),
    });

    // ───────────────── 2. iframe 继承(ADR-016) ─────────────────
    const xframe = await page.$('#xframe');
    const frameSpreadOn = await channelSpread(xframe);
    assert(
      '🔴 跨域 iframe 内容被滤镜覆盖(ADR-016):maxChannelSpread == 0',
      frameSpreadOn === 0,
      { frameSpreadOn },
    );

    // 对照:关掉主开关后 iframe 应恢复彩色 —— 证明上面的 0 不是因为
    // iframe 本来就是灰的(探针有效性,DESIGN.md 反复强调的那种基线)。
    await seed(browser, settings([rule(host, 'Grayscale', 100)], false));
    await new Promise((r) => setTimeout(r, 1500));
    const offFilter = await page.evaluate(
      `getComputedStyle(document.documentElement).filter`,
    );
    const frameSpreadOff = await channelSpread(xframe);
    assert('主开关 OFF 后页面未滤镜(INV-8)', offFilter === 'none', { offFilter });
    assert(
      '🔴 探针有效:iframe 在未滤镜态下确实彩色(spread > 0)',
      frameSpreadOff > 0,
      { frameSpreadOff },
    );

    // 恢复滤镜,继续做交互检查。
    await seed(browser, settings([rule(host, 'Grayscale', 100)]));
    for (let i = 0; i < 60; i += 1) {
      const f = await page.evaluate(
        `getComputedStyle(document.documentElement).filter`,
      );
      if (f !== 'none') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // ───────────────── 3. 交互完整性(INV-1) ─────────────────

    // 3a. 点击命中区域 —— 用真实鼠标事件点按钮的中心。
    const hit = await page.$('#hit');
    const box = await hit.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const clicked = await page.evaluate(`window.__clicked || 0`);
    assert('🔴 滤镜开启时点击命中区域正常(INV-1)', clicked === 1, { clicked });

    // 3b. 文本选中。
    const selected = await page.evaluate(`(() => {
      const p = document.getElementById('text');
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return sel.toString().length;
    })()`);
    assert('🔴 滤镜开启时文本可选中(INV-1)', selected > 10, { selectedLength: selected });

    // 3c. video 播放。
    const video = await page.evaluate(`(async () => {
      const v = document.getElementById('vid');
      try { await v.play(); } catch (e) { return { error: String(e) }; }
      const t0 = v.currentTime;
      await new Promise((r) => setTimeout(r, 1200));
      return { t0, t1: v.currentTime, paused: v.paused, readyState: v.readyState };
    })()`);
    // 网络视频可能加载失败(无外网/CORS);此时不判 FAIL,而是显式申报为盲点。
    const videoAdvanced = video && !video.error && video.t1 > video.t0;
    if (videoAdvanced) {
      assert('🔴 滤镜开启时 video 正常播放(INV-1)', true, video);
    } else {
      results.assertions.push({
        name: 'video 播放(未能在本环境验证 —— 申报为盲点)',
        ok: null,
        detail: video,
      });
      console.log(`SKIP  video 播放未能验证(申报为盲点)  ${JSON.stringify(video)}`);
    }

    // 3d. CSS 动画 —— 断言 transform 随时间变化(动画在跑)。
    const anim = await page.evaluate(`(async () => {
      const el = document.getElementById('spin');
      const a = getComputedStyle(el).transform;
      await new Promise((r) => setTimeout(r, 400));
      const b = getComputedStyle(el).transform;
      return { a, b, running: el.getAnimations().length };
    })()`);
    assert(
      '🔴 滤镜开启时 CSS 动画正常运行(INV-1)',
      anim.a !== anim.b && anim.running > 0,
      anim,
    );

    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'noninvasive-fixture-on.png') });
    await page.close();
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, 'noninvasive.json'),
    JSON.stringify(results, null, 2),
  );
  console.log(`\n${results.pass ? 'PASS' : 'FAIL'} — noninvasive`);
  process.exit(results.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
