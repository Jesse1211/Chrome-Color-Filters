// REAL_STACK_GATE #7:🔴 冷启动 + 会话恢复 + 多标签页(DESIGN.md §6 T4a 点名必测)。
//
// > 这是 ADR-062 **唯一可能被推翻**的场景,必测:
// > 配置规则 → 在多个已配置站点上开约 10 个重标签页 → 完全退出 Chrome →
// > 冷启动并恢复会话 → 逐帧录屏全部标签页。
// >
// > 理论风险:某个导航在扩展系统读完磁盘 StateStore 之前就提交了。
//
// 🔴 ADR-038:在 npm run build 产物上跑。
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔴 **上一轮本脚本是「假通过」的门禁仪器 —— 本轮修正**
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// 旧版只用 `Page.startScreencast` 测量,而**合成帧只发给可见的那一个标签页**。
// 实测证据(上一轮提交的 evidence/multitab.json,5 轮):
//
//   run1..run5:tab0..tab8 全部 frames=0,只有 tab9 有 160–211 帧
//
// 于是「10 个标签页合计 0/892 帧带色」实际上是**同一个标签页测了 5 次**,
// 另外 9 个**从未被观测**。更糟的是旧版**没有探针有效性基线**
// (flicker.cjs 有 `off` 基线,本脚本没有),所以 `frames=0, colorFrames=0`
// 与「真的通过」在输出里**完全无法区分** —— 零帧必然零带色帧。
// 用 masterEnabled=false 做对照可证明该盲区:tab9 报 167/169 带色,
// tab0..tab8 仍报 0/0。本该整片红的场景,9/10 的标签页报绿。
//
// ───────────────────────────────────────────────────────────────────────────
// ## 为什么不能只靠 rAF 探针(本轮第一次尝试,已被实测否掉)
//
// 第一版修正改用「`evaluateOnNewDocument` 装 rAF 探针」,想绕开合成器。
// 实测它换了个症状、同样瞎:**后台(hidden)标签页里 `requestAnimationFrame`
// 一次都不触发** —— `sampled: 0`,10 个标签页里 9 个读不出数:
//
//   tab0..tab8  {atFirstRaf: null, sampled: 0}
//   tab9        {atFirstRaf: "grayscale(1)", sampled: 130}
//
// 这其实是对的物理:hidden 标签页**不产生任何帧**,所以也不存在
// 「被显示过的未滤镜帧」。但一个读不出数的探针不得按通过计。
//
// ## 本版的测量模型:把「何时可能被看见」拆成两段,各用能跑的探针
//
// 1. **hidden 期(标签页在后台)** —— 用 `setTimeout` 轮询探针。
//    实测 `setTimeout` 在 hidden 标签页里**正常运行**(216/216 次采样),
//    故整段后台期的计算样式是可观测的。该段**不产生帧**,
//    它的意义是证明「滤镜自始就在、且没有中途掉过」。
//
// 2. **visible 期(标签页被切到前台 —— 用户真正看到它的那一刻)** ——
//    `bringToFront()` 后 rAF 立刻开始触发,此时逐帧采样 + screencast
//    像素判定同时生效。**这才是 INV-3 真正要守的时刻**:后台标签页
//    没有帧可闪,闪烁只可能发生在它被切到前台的那一帧。
//    实测 `bringToFront()` 使每个标签页都能拿到 31–78 个 rAF 样本,
//    于是 10/10 全部可测(不再是 1/10)。
//
// 3. **🔴 探针有效性基线(强制,旧版完全缺失)**
//    每轮末尾用 `masterEnabled=false` 再跑一遍同样的 10 个标签页。
//    此时页面必然彩色,故**两条探针都必须在 10/10 的标签页上报告「未滤镜」**。
//    基线报不出数、或报「已滤镜」→ 探针坏了 → 本轮结果作废(FAIL)。
//    这正是旧版缺的那一环:没有它,「零观测」会被静默当成「零缺陷」。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

/**
 * 页内探针 —— 装在 `evaluateOnNewDocument`,即早于页面任何脚本、
 * 也早于 content script 的 JS,但**晚于**浏览器注入声明式注册的 CSS
 * (后者正是 ADR-062 要证明的那一步)。
 *
 * 两条采样通道,分别覆盖 hidden 期与 visible 期(见文件头的测量模型):
 *
 * - `timer[]` —— `setTimeout` 轮询,**在后台标签页里照样跑**
 * - `raf[]`   —— `requestAnimationFrame`,只在标签页可见时触发;
 *                它的每个样本都是「这一帧将被合成出来的样式」
 *                (rAF 回调在样式/布局/绘制之前运行)
 *
 * 每个样本记 `[t, filter, visibilityState]`,便于事后区分
 * 「未滤镜但不可见(无帧,无害)」与「未滤镜且可见(INV-3 破裂)」。
 */
const PROBE = function () {
  const MAX_TIMER = 1200;
  const MAX_RAF = 600;
  const MAX_EARLY = 4000;
  const w = /** @type {any} */ (window);
  w.__ccfProbe = { timer: [], raf: [], early: [], firstReal: null, readErrors: 0 };
  const read = function () {
    try {
      const el = document.documentElement;
      // `evaluateOnNewDocument` 早于 documentElement 存在 —— 记为 NOEL,
      // 它既不算「已滤镜」也不算「未滤镜」(那一刻没有元素可画)。
      if (!el) return 'NOEL';
      return getComputedStyle(el).filter || '';
    } catch (e) {
      w.__ccfProbe.readErrors++;
      return 'ERR';
    }
  };
  // ── 通道 0:🔴 `firstReal` —— ADR-062 的**判别性**测量 ────────────────
  //
  //    零延时 `setTimeout` 紧密轮询,目的只有一个:抓住
  //    **`documentElement` 一存在就立刻读到的那第一个值**。
  //
  //    为什么这一条才是对 ADR-062 的真正检验:声明式注册的 CSS 文件
  //    「在页面的任何 DOM 被构建**或显示**之前」注入,故 documentElement
  //    的**第一个**可读计算样式就应该已经是滤镜值 —— 不经任何 JS。
  //    而 ADR-060 的 localStorage 快路径虽然也在 document_start 同步生效,
  //    却必然**晚于** documentElement 出现(它得先有 JS 跑起来)。
  //
  //    实测(wikipedia,已清空 ccf 的 localStorage 键):
  //      - 正常构建  firstReal = [277.8, "grayscale(1)"]  ← 第一眼就已滤镜
  //      - 把预生成 CSS 改成永不匹配的选择器(即废掉 ADR-062 路径):
  //                  firstReal = [288.9, "none"],27ms 后才由 JS 补上
  //    故本通道能把「声明式 CSS 生效」与「JS 快路径补救」区分开;
  //    10ms 粒度的 timer 通道与 rAF 通道都区分不了(两者都在 JS 之后)。
  let en = 0;
  const early = function () {
    const v = read();
    if (w.__ccfProbe.early.length < 60) {
      w.__ccfProbe.early.push([Math.round(performance.now() * 10) / 10, v]);
    }
    if (w.__ccfProbe.firstReal === null && v !== 'NOEL' && v !== 'ERR') {
      w.__ccfProbe.firstReal = [Math.round(performance.now() * 10) / 10, v];
      return; // 第一眼已拿到,本通道收工。
    }
    if (++en < MAX_EARLY) setTimeout(early, 0);
  };
  setTimeout(early, 0);

  let tn = 0;
  const tick = function () {
    w.__ccfProbe.timer.push([Math.round(performance.now()), read(), document.visibilityState]);
    if (++tn < MAX_TIMER) setTimeout(tick, 10);
  };
  setTimeout(tick, 0);
  let rn = 0;
  const frame = function () {
    w.__ccfProbe.raf.push([Math.round(performance.now()), read(), document.visibilityState]);
    if (++rn < MAX_RAF) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

/** 样本的三态分类。`NOEL` / `ERR` 都不计入「已滤镜」或「未滤镜」。 */
function classify(v) {
  if (v === 'NOEL') return 'noel';
  if (v === 'ERR') return 'err';
  if (v === '' || v === 'none') return 'unfiltered';
  return 'filtered';
}

/** 汇总一条采样通道。 */
function summarize(samples) {
  const out = { total: samples.length, filtered: 0, unfiltered: 0, noel: 0, err: 0, firstReal: null, worstUnfiltered: null };
  for (const s of samples) {
    const c = classify(s[1]);
    out[c]++;
    if (out.firstReal === null && (c === 'filtered' || c === 'unfiltered')) {
      out.firstReal = { t: s[0], filter: s[1], visibility: s[2] };
    }
    if (c === 'unfiltered' && out.worstUnfiltered === null) {
      out.worstUnfiltered = { t: s[0], filter: s[1], visibility: s[2] };
    }
  }
  return out;
}

/**
 * 一个标签页的完整测量。
 *
 * 阶段:装探针 → 并发导航(保留冷启动竞态)→ 由调用方逐个
 * `bringToFront()` 并录屏 → 回读探针。
 */
async function attach(page) {
  await page.evaluateOnNewDocument(PROBE);
}

/**
 * 把该标签页切到前台并逐帧录屏 —— 用户真正看到它的那一刻。
 *
 * 📌 **为什么切前台后还要滚一下页面**:`Page.startScreencast` 只在
 * **合成帧发生变化**时才推帧。一个已经静止、没有动画的页面(实测
 * news.ycombinator.com/newest)切到前台后可能一帧都不推 ——
 * 旧版把这种 `frames: 0` 当成了通过。
 * 滚动制造真实的合成变化,使像素通道在每个标签页上都拿得到帧;
 * 它同时顺带覆盖了「滚动后滤镜是否还在」。
 * 滚动只改 scrollTop,不动 DOM,与 INV-1 无关(本脚本是门禁,不入产品)。
 */
async function front(page, tag, dwellMs) {
  const client = await page.target().createCDPSession();
  const frames = [];
  client.on('Page.screencastFrame', async (f) => {
    frames.push(f.data);
    try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  // 🔴 切到前台 —— 这一步让 rAF 开始触发,也让合成器开始产帧。
  await page.bringToFront();
  await new Promise((r) => setTimeout(r, Math.round(dwellMs / 3)));
  // 制造合成变化,确保静止页面也推帧(见上方注释)。
  await page.evaluate(() => {
    try {
      window.scrollBy(0, 120);
      window.scrollBy(0, -120);
    } catch (e) { /* 门禁探针,失败不影响判定 */ }
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, dwellMs));
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

/** 回读探针并汇总。 */
async function readProbe(page) {
  const raw = await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    return w.__ccfProbe || null;
  }).catch(() => null);
  if (!raw) return { ok: false, reason: 'probe-missing' };
  // visible 期的 rAF 样本 —— INV-3 真正要守的那一段。
  const visibleRaf = (raw.raf || []).filter((s) => s[2] === 'visible');
  const fr = raw.firstReal;
  return {
    ok: true,
    // 🔴 ADR-062 的判别性读数:documentElement 的第一个可读计算样式。
    firstReal: fr ? { t: fr[0], filter: fr[1], state: classify(fr[1]) } : null,
    early: (raw.early || []).slice(0, 8),
    timer: summarize(raw.timer || []),
    raf: summarize(raw.raf || []),
    visibleRaf: summarize(visibleRaf),
    readErrors: raw.readErrors || 0,
  };
}

/**
 * 🔴 清空每个 origin 上本扩展的 localStorage 键 —— 制造**冷缓存**。
 *
 * **这一步是本门禁有判别力的前提。** ADR-060 的 localStorage 快路径同样
 * 在 `document_start` 同步生效,若缓存是热的,它会在 ADR-062 的声明式
 * 路径失效时**悄悄把结果补上**,使门禁对 ADR-062 的成败完全失明。
 *
 * 实测确认过这一点:把预生成 CSS 改成永不匹配的选择器(废掉 ADR-062),
 * 热缓存下本门禁**仍然全绿**;清掉缓存后才暴露出 `firstReal = "none"`。
 *
 * 只删 `__ccf` 前缀的键,不动站点自己的数据(同 ADR-060 的窄口精神)。
 */
async function clearCcfStorage(browser) {
  const origins = [...new Set(URLS.map((u) => new URL(u).origin))];
  for (const o of origins) {
    const p = await browser.newPage();
    try {
      await p.goto(o + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
      await p.evaluate(() => {
        try {
          const doomed = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf('__ccf') === 0) doomed.push(k);
          }
          doomed.forEach((k) => localStorage.removeItem(k));
        } catch (e) { /* 存储不可用 —— 本就等同于冷缓存 */ }
      });
    } catch (e) { /* 清不到就清不到,冷缓存只会更冷 */ }
    finally { await p.close(); }
  }
}

/**
 * 冷启动同一 profile,并发打开 10 个标签页,然后**逐个切到前台**测量。
 *
 * 并发创建+导航保留了「某个导航赶在扩展系统读完磁盘之前提交」的竞态;
 * 逐个切前台则让 10/10 都能被观测(旧版只有 1/10)。
 */
async function coldStartAndMeasure(udd, tagPrefix, dwellMs) {
  // 🔴 先在一个独立的浏览器会话里把快路径缓存清掉,再**完全退出**,
  //    使被测量的那次启动是真正的冷启动 + 冷缓存。
  {
    const pre = await launch(udd, { headless: true });
    try { await clearCcfStorage(pre); } finally { await pre.close(); }
  }

  const b = await launch(udd, { headless: true });
  try {
    const pages = await Promise.all(URLS.map(() => b.newPage()));
    await Promise.all(pages.map((p) => attach(p)));
    // 🔴 并发导航 —— 竞态在此发生。
    await Promise.all(pages.map((p, i) =>
      p.goto(URLS[i], { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {})));

    const out = [];
    for (let i = 0; i < pages.length; i++) {
      const screen = await front(pages[i], `${tagPrefix}-tab${i}`, dwellMs);
      const probe = await readProbe(pages[i]);
      out.push({ url: URLS[i], probe, ...screen });
    }
    return out;
  } finally {
    await b.close();
  }
}

const RUNS = Number(process.env.CCF_MULTITAB_RUNS || 5);
const DWELL = Number(process.env.CCF_MULTITAB_DWELL || 900);
/**
 * 像素通道的 quorum —— 需有这么多个标签页真的收到了合成帧。
 *
 * 为什么不是 10:`Page.startScreencast` 只在合成帧变化时推帧,静止且
 * 短到滚不动的页面可能一帧都不推(见判定 (ii) 的长注释)。
 * 为什么不是 1:1 就是旧版那个「一个标签页冒充十个」的强度。
 * 取 8 使「像素通道整体失效」必然被基线抓住,同时不对合成器的推帧策略
 * 提出与被测行为无关的要求。
 */
const PIXEL_QUORUM = Number(process.env.CCF_MULTITAB_PIXEL_QUORUM || 8);

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

    // ── 阶段 2:冷启动,并发打开全部 10 个标签页,逐个切前台测量 ────────
    const measured = await coldStartAndMeasure(udd, `r${runIdx}`, DWELL);

    // ── 阶段 3:🔴 探针有效性基线 —— 主开关 OFF,同一 10 个标签页 ───────
    b = await launch(udd, { headless: true });
    await seed(b, settings([rule('*')], false));
    await new Promise((r) => setTimeout(r, 1500));
    await b.close();
    const baseline = await coldStartAndMeasure(udd, `r${runIdx}-off`, DWELL);

    const perRun = { measured: {}, baseline: {} };

    // ── 判定 (i):🔴 探针有效性基线 ──────────────────────────────────────
    //
    //    主开关 OFF 时页面必然彩色,故探针**必须**报出「未滤镜」。
    //    这一段是整个脚本的可信度来源:没有它,「零观测」会被静默当成
    //    「零缺陷」(旧版 9/10 标签页正是这样报绿的)。
    //
    //    两类通道的判据强度**有意不同**,理由在下面 (ii) 里写明:
    //    - 样式通道(timer / visible-rAF):要求 10/10 全部报出「未滤镜」
    //    - 像素通道(screencast):要求**至少 QUORUM 个**标签页抓到带色帧
    let baselineBad = 0;
    let baselinePixelOk = 0;
    baseline.forEach((m, i) => {
      perRun.baseline[`tab${i}`] = m;
      const why = [];
      if (!m.probe.ok) {
        why.push(`探针读不出数(${m.probe.reason})`);
      } else {
        // 🔴 firstReal 通道的基线:主开关 OFF 时第一眼必须是「未滤镜」。
        //    若基线这里也报「已滤镜」,说明该通道恒真 —— 它就不是判别器。
        if (m.probe.firstReal === null) why.push('firstReal 通道读不出数');
        else if (m.probe.firstReal.state !== 'unfiltered') why.push(`firstReal 通道在主开关 OFF 下报 ${JSON.stringify(m.probe.firstReal)} —— 该通道恒真,不是判别器`);
        if (m.probe.visibleRaf.total === 0) why.push('visible-rAF 通道零样本 —— 该标签页未被观测');
        else if (m.probe.visibleRaf.unfiltered === 0) why.push(`visible-rAF 通道零「未滤镜」样本(${JSON.stringify(m.probe.visibleRaf)})`);
        if (m.probe.timer.unfiltered === 0) why.push(`timer 通道零「未滤镜」样本(${JSON.stringify(m.probe.timer)})`);
      }
      if (m.frames > 0 && m.colorFrames > 0) baselinePixelOk++;
      if (why.length) {
        console.log(`FAIL run${runIdx} 基线 tab${i}: ${why.join('；')} —— 探针无效`);
        baselineBad++;
      }
    });
    if (baselineBad > 0) {
      console.log(`FAIL run${runIdx}: 样式通道基线不成立(${baselineBad}/${URLS.length} 个标签页)—— 本轮测量作废`);
      fail = true;
    }
    if (baselinePixelOk < PIXEL_QUORUM) {
      console.log(`FAIL run${runIdx}: 像素通道基线仅 ${baselinePixelOk}/${URLS.length} 个标签页抓到带色帧(需 ≥${PIXEL_QUORUM})—— 像素判据不可信`);
      fail = true;
    }
    if (baselineBad === 0 && baselinePixelOk >= PIXEL_QUORUM) {
      console.log(`INFO run${runIdx}: 探针有效性基线通过 —— 样式通道 ${URLS.length}/${URLS.length} 报「未滤镜」,像素通道 ${baselinePixelOk}/${URLS.length} 抓到带色帧`);
    }

    // ── 判定 (ii):主测量 ───────────────────────────────────────────────
    //
    // 🔴 **两类通道的分工(有意为之,不是放宽判据)**
    //
    //   - **样式通道(timer + visible-rAF)= 每个标签页的判决,强制 10/10。**
    //     ADR-062 的论断是「声明式注册的 CSS 在首帧之前就已生效」,
    //     那是一个**样式**论断。rAF 回调在该帧的样式/布局/绘制之前运行,
    //     故回调里读到的计算样式**就是那一帧将被合成出来的样式** ——
    //     这是对该论断的直接测量,且 `bringToFront()` 后 10/10 都拿得到样本。
    //
    //   - **像素通道(screencast)= 交叉验证,按 quorum 判。**
    //     它证明「计算样式确实变成了屏幕像素」,样式通道无法替代。
    //     但 `Page.startScreencast` **只在合成帧发生变化时推帧**:
    //     已经静止、无动画、且短到滚不动的页面(实测
    //     news.ycombinator.com 系列)切到前台后可能一帧都不推。
    //     那是**合成器的推帧策略**,不是滤镜的正确性 ——
    //     把它判成 per-tab 强制项会制造与被测行为无关的非确定性失败。
    //
    //     🔴 关键在于:零帧现在**不再被当作通过**。
    //     该标签页的判决完全由样式通道给出(强制 10/10),
    //     像素通道只在 `frames > 0` 时参与;并且**基线侧施加同样的
    //     quorum**,故「像素通道整体失效」这种情况会被基线抓住、
    //     使整轮作废 —— 这正是旧版缺失的那道闭环。
    let observed = 0;
    let pixelCorroborated = 0;
    measured.forEach((m, i) => {
      perRun.measured[`tab${i}`] = m;
      if (!m.probe.ok) {
        console.log(`FAIL run${runIdx} tab${i} (${URLS[i]}): 探针读不出数(${m.probe.reason})—— 不得按通过计`);
        fail = true;
        return;
      }
      // 🔴 覆盖率:visible 期必须有 rAF 样本,否则该标签页**未被观测**,
      //    不得计为通过(这是旧版 9/10 静默报绿的根因)。
      if (m.probe.visibleRaf.total === 0) {
        console.log(`FAIL run${runIdx} tab${i} (${URLS[i]}): visible 期零 rAF 样本 —— 该标签页未被观测`);
        fail = true;
        return;
      }
      observed++;

      // ── 🔴 ADR-062 的判别性断言 ───────────────────────────────────────
      //    documentElement 的**第一个**可读计算样式就必须已是滤镜值。
      //    这一条才真正区分「声明式注册的 CSS 在首帧前生效」(ADR-062)
      //    与「JS 快路径事后补救」(ADR-060)。缓存已在 coldStartAndMeasure
      //    里清空,故 JS 快路径无从代偿 —— 过了就是 ADR-062 自己过的。
      if (m.probe.firstReal === null) {
        console.log(`FAIL run${runIdx} tab${i} (${URLS[i]}): firstReal 通道读不出数 —— 不得按通过计`);
        fail = true;
      } else if (m.probe.firstReal.state !== 'filtered') {
        console.log(`FAIL run${runIdx} tab${i} (${URLS[i]}): 🔴 documentElement 第一眼即为 ${JSON.stringify(m.probe.firstReal)},声明式 CSS 未赶在首帧之前(ADR-062 被推翻);early=${JSON.stringify(m.probe.early)}`);
        fail = true;
      }

      // 🔴 INV-3:可见期的每一个 rAF 样本都必须已滤镜。
      if (m.probe.visibleRaf.unfiltered !== 0) {
        console.log(`FAIL run${runIdx} tab${i} (${URLS[i]}): 可见期 ${m.probe.visibleRaf.unfiltered}/${m.probe.visibleRaf.total} 帧未滤镜,首个 ${JSON.stringify(m.probe.visibleRaf.worstUnfiltered)} —— INV-3 破裂`);
        fail = true;
      }
      // 后台期也不得掉滤镜(抓「切前台前就已掉色」这类退化)。
      if (m.probe.timer.unfiltered !== 0) {
        console.log(`FAIL run${runIdx} tab${i} (${URLS[i]}): 后台期 ${m.probe.timer.unfiltered}/${m.probe.timer.total} 次采样未滤镜,首个 ${JSON.stringify(m.probe.timer.worstUnfiltered)}`);
        fail = true;
      }
      // 像素层交叉验证 —— 只在该标签页确实收到帧时参与(见上方分工说明)。
      // `frames === 0` 不计为通过,也不计入 quorum;该标签页的判决已由
      // 样式通道给出。
      if (m.frames > 0) {
        pixelCorroborated++;
        if (m.colorFrames !== 0) {
          console.log(`FAIL run${runIdx} tab${i} (${URLS[i]}): 像素层 ${m.colorFrames}/${m.frames} 帧带色(worst=${m.worst})`);
          fail = true;
        }
      } else {
        console.log(`INFO run${runIdx} tab${i} (${URLS[i]}): 合成器未推帧(静止页面),判决由样式通道给出 —— visible-rAF ${m.probe.visibleRaf.total} 样本全部已滤镜`);
      }
    });

    // 🔴 覆盖率硬门:样式通道必须覆盖全部 10 个标签页。
    //    旧版实际只覆盖 1 个,却按 10 个全绿上报 —— 这条断言就是为挡那个。
    if (observed !== URLS.length) {
      console.log(`FAIL run${runIdx}: 样式通道仅覆盖 ${observed}/${URLS.length} 个标签页 —— 未被观测的不得计为通过`);
      fail = true;
    }
    // 像素通道的 quorum —— 与基线同一阈值。
    if (pixelCorroborated < PIXEL_QUORUM) {
      console.log(`FAIL run${runIdx}: 像素通道仅交叉验证了 ${pixelCorroborated}/${URLS.length} 个标签页(需 ≥${PIXEL_QUORUM})`);
      fail = true;
    }
    const totFrames = measured.reduce((a, m) => a + m.frames, 0);
    const totColor = measured.reduce((a, m) => a + m.colorFrames, 0);
    const totRaf = measured.reduce((a, m) => a + (m.probe.ok ? m.probe.visibleRaf.total : 0), 0);
    const totTimer = measured.reduce((a, m) => a + (m.probe.ok ? m.probe.timer.total : 0), 0);
    console.log(`INFO run${runIdx}: 样式通道 ${observed}/${URLS.length} 标签页被观测(可见期 rAF ${totRaf} 样本 + 后台期 timer ${totTimer} 样本,全部已滤镜);像素通道 ${pixelCorroborated}/${URLS.length} 标签页交叉验证,合计 ${totColor}/${totFrames} 帧带色`);
    all.push(perRun);
  }

  fs.writeFileSync(path.join(OUT, 'multitab.json'), JSON.stringify({ runs: RUNS, all }, null, 2));
  console.log(fail ? `MULTITAB: FAIL` : `MULTITAB: PASS (连续 ${RUNS} 次全绿,每轮 ${URLS.length}/${URLS.length} 标签页被观测 + 基线对照成立)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
