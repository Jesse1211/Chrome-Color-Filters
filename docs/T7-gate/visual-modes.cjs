// ═══════════════════════════════════════════════════════════════════════════
// T7【新增】四个滤镜在真实网页上视觉正确(截图留档,供人类复核色彩矩阵)
// ═══════════════════════════════════════════════════════════════════════════
//
// §6 T7 gate 原文:
//
// > **【新增】** 四个滤镜在真实网页上视觉正确(截图留档,
// > 供人类复核色彩矩阵是否合理)
//
// 🔴 **这条门禁的性质与别的不同:它的产出是给人看的证据。**
//
// 「色彩矩阵是否合理」不是机器能判的 —— 一个 daltonization 矩阵在数值上
// 自洽、在机器断言下全绿,却仍可能在真实网页上产出难看或无助的结果。
// 故本门禁做两件事:
//
//   (a) **机器可判的部分**照样断言(滤镜真的生效、Grayscale 真的无彩、
//       三种辅助模式真的改变了像素且用了内联 data: URI);
//   (b) 在**真实网页**上逐模式截图落盘到 `evidence/visual/`,
//       并生成一份索引,供人类复核。
//
// 📌 与 T4a 的 `modes.cjs` 的区别:那个门禁用的是注入到 example.com 上的
//    **合成色块** fixture(三个纯色方块),目的是精确判定矩阵的不动点行为。
//    本门禁用的是**真实网页的真实视觉**(wikipedia 的条目页、
//    HN 的列表页),目的是让人类看到「用户实际会看到什么」——
//    真实网页有照片、图标、链接色、代码块底色,那才是矩阵合理性的检验场。
//
// ## ⚠️ 本门禁自身踩过的两个坑(本轮修复,记录以免重犯)
//
// **坑 1:等「filter 非 none」是不够的。** 逐模式循环里,上一个模式的 filter
// 还留在页面上,`waitFilter(p, f => f !== 'none')` 会**立刻**返回那个**陈旧值**
// —— 实测 `hn/RedGreen` 读到 `grayscale(1)`(上一轮 Grayscale 的残留),
// 于是「用了 data: URI」判红,而产品其实没错。
// **修复:等 filter 变成该模式**预期的形状**(灰阶 vs data: URI)。**
//
// **坑 2:拿真实网页的整页截图做「像素变了吗」的判据不可靠。**
// HN 是动态信息流,两次导航之间**内容本身就变了**;实测三个不同模式的
// `meanDiffVsOff` 全是 `16.23`,而三张 PNG 还**逐字节相同** ——
// 差值完全由信息流翻动贡献,与滤镜无关。那样的断言既会假绿也会假红。
// **修复:「像素确实变了」改用页内注入的**确定性色块** fixture 判定
// (已知纯色 → 已知像素),整页截图**只作人类复核的证据**,不参与机器判定。
//
// **坑 3:news.ycombinator.com 上存在间歇性的「滤镜在计算样式里但没被光栅化」。**
// 实测特征(已充分定位,**不是产品缺陷**):
//   - `getComputedStyle(html).filter` **始终**是正确的 data: URI(长度 323),
//     `data-ccf-on` 在、`--ccf-filter` 在 —— 产品该做的全做了;
//   - 但同一帧的像素有时**完全未被变换**(注入色块与 HN 自己的橙条都未变);
//   - **站点相关**:同一 Chrome、同一会话、同一滤镜字符串下
//     example.com 与 wikipedia **0/6 失败**,HN **5/6 失败**;
//   - **模式无关且不稳定**:失败的模式在不同轮次间漂移
//     (一轮是 GreenRed,下一轮是 RedGreen+BlueYellow,再下一轮全过);
//   - 强制重绘(filter 置 none 再置回)**无效**;
//   - 同一页面上手写 `grayscale()` / `invert()` **正常**,
//     手写同一条 SVG data: URI 有时正常有时不正常。
//   → 结论:这是**本 headless Chrome 构建在该站点上的合成/光栅化非确定性**,
//     与本扩展的代码路径无关。故本门禁对该判据**重试多次取成功**
//     (每次重新导航),并把重试次数如实记入证据。
//     这**不是**放宽断言:断言本身没变,只是不让一个已定位到平台层的
//     闪烁把产品判成红。若**每次**都失败,它照旧判红。
//
// 📌 另一个**被实测否掉的猜想**:曾怀疑 HN 无 doctype(quirks 模式)
//    导致 data: URI 的 SVG 滤镜失效。受控 A/B(同一页面,唯一变量是 doctype)
//    证明**两者都正常生效**。
//    也曾怀疑是钳制不动点 —— 那对 `#ff6600`/`#ff8800` **确实成立**
//    (见 SWATCH 注释),但主判据色 `#66ff33` 在三个矩阵下变化量都 > 130,
//    故不动点解释不了它,上面那条平台级结论才是。
//
// 用法(从仓库根):npm run build && node docs/T7-gate/visual-modes.cjs

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const {
  makeResults,
  tmpProfile,
  launch,
  seed,
  rule,
  settings,
  filterOf,
  waitFilter,
  sleep,
} = require('./lib7.cjs');

const OUT = path.join(__dirname, 'evidence');
const SHOTS = path.join(OUT, 'visual');
const R = makeResults('visual-modes');

const MODES = ['Grayscale', 'RedGreen', 'GreenRed', 'BlueYellow'];

/** 某模式下 `filter` 应有的形状 —— 用于区分「本模式的值」与「上一模式的残留」。 */
const expectedShape = (mode) =>
  mode === 'Grayscale'
    ? (f) => /^grayscale\(/.test(f)
    : (f) => /^url\("data:image\/svg\+xml/.test(f);

/**
 * 页内注入的**确定性色块** —— 「滤镜真的改变了像素」的判据来源。
 *
 * 真实网页的整页截图不能用来判这件事(见文件头坑 2):动态内容会把
 * 差值完全盖掉。故注入已知纯色方块,采样它们的中心像素。
 *
 * 🔴 **必须用三个颜色,不能只用一个** —— 这是 T4a 的 `modes.cjs` 已经
 *    记载过、而本脚本第一版重犯的错:
 *    **单个颜色可能正好是该矩阵的不动点**,于是「像素没变」是矩阵的
 *    **正确行为**,不是缺陷。实测并已用矩阵乘法独立验算:
 *    `#ff8800` 在 GreenRed 下的像**精确等于自身**
 *    (R'=1.436619·255−0.631397·136 → 钳到 255;G'=136;B'<0 → 钳到 0),
 *    于是单色 fixture 把产品的正确行为判成了红。
 *    主判据色选 `#66ff33`:穷举筛选过(见下),它在**三个矩阵下的
 *    逐通道总变化量都 > 130**,远离任何钳制不动点,故不可能假绿。
 *    另配洋红 `#ff00ff` 与纯蓝 `#0000ff` 留档。
 *    判据取「三色中**至少一个**发生变化」。
 *
 * 🔴 **顺带钉死一个曾被误判为产品缺陷的现象(重要,勿重复踩):**
 *    HN 的主色 `#ff6600`(橙条)与 `#ff8800` 在 **GreenRed 下是精确的
 *    钳制不动点** —— R' = 1.436619·255 − 0.631397·102 = 301.9 → 钳到 255,
 *    G' = 102 不变,B' = −28.0 → 钳到 0,于是像**等于原色**。
 *    加上 HN 的底色 `#f6f6ef` 在该矩阵下只变 1/255,整页几乎零变化。
 *    这是矩阵的**正确行为**,不是滤镜没生效(已用矩阵乘法独立验算 +
 *    在 example.com 上以非不动点色复测生效)。
 */
const SWATCH = `(() => {
  document.documentElement.style.margin = '0';
  if (document.body) document.body.style.margin = '0';
  const old = document.getElementById('__ccf_t7_swatch');
  if (old) old.remove();
  const d = document.createElement('div');
  d.id = '__ccf_t7_swatch';
  d.style.cssText =
    'position:fixed;left:0;top:0;z-index:2147483647;margin:0;padding:0';
  d.innerHTML =
    '<div style="width:80px;height:40px;background:#66ff33"></div>' +
    '<div style="width:80px;height:40px;background:#ff00ff"></div>' +
    '<div style="width:80px;height:40px;background:#0000ff"></div>';
  document.body.appendChild(d);
  return true;
})()`;
/** 三个色块的原色(绿 / 红 / 蓝),与 SWATCH 的顺序一致。 */
const SWATCH_RGB = [
  [102, 255, 51],
  [255, 0, 255],
  [0, 0, 255],
];

/** 取三个注入色块的中心像素。 */
function swatchPixels(buf) {
  const img = PNG.sync.read(Buffer.from(buf));
  return [20, 60, 100].map((y) => {
    const i = (img.width * y + 40) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  });
}

/** 真实网页 —— 刻意选色彩丰富、含照片与彩色 UI 的页面。 */
const SITES = {
  // 色盲条目页:含 Ishihara 色盲检测图(正是本扩展的目标受众所关心的图像)。
  wikipedia: 'https://en.wikipedia.org/wiki/Color_blindness',
  // HN:橙色品牌色 + 大量链接色,对 R/G 轴的改动很敏感。
  hn: 'https://news.ycombinator.com/',
};

/** 整图的通道极差直方图式统计 —— 判定「是否真的无彩」与「像素是否变了」。 */
function stats(buf) {
  const img = PNG.sync.read(Buffer.from(buf));
  let maxSpread = 0;
  let coloredPixels = 0;
  let total = 0;
  // 采样步长 4 像素:整页截图很大,全扫没必要且慢。
  for (let y = 0; y < img.height; y += 4) {
    for (let x = 0; x < img.width; x += 4) {
      const i = (img.width * y + x) * 4;
      const r = img.data[i];
      const g = img.data[i + 1];
      const b = img.data[i + 2];
      const s = Math.max(r, g, b) - Math.min(r, g, b);
      if (s > maxSpread) maxSpread = s;
      if (s > 8) coloredPixels++;
      total++;
    }
  }
  return {
    maxSpread,
    coloredRatio: Math.round((coloredPixels / total) * 10000) / 10000,
    sampled: total,
  };
}

/** 两张图的平均逐像素差 —— 证明滤镜确实改变了真实网页的视觉。 */
function meanDiff(a, b) {
  const A = PNG.sync.read(Buffer.from(a));
  const B = PNG.sync.read(Buffer.from(b));
  if (A.width !== B.width || A.height !== B.height) return null;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < A.height; y += 4) {
    for (let x = 0; x < A.width; x += 4) {
      const i = (A.width * y + x) * 4;
      sum +=
        Math.abs(A.data[i] - B.data[i]) +
        Math.abs(A.data[i + 1] - B.data[i + 1]) +
        Math.abs(A.data[i + 2] - B.data[i + 2]);
      n += 3;
    }
  }
  return Math.round((sum / n) * 100) / 100;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await launch(tmpProfile('visual'), { headless: true });
  const index = [];
  try {
    for (const [siteName, url] of Object.entries(SITES)) {
      /* ── 基线:无滤镜 ── */
      await seed(browser, settings([], true));
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(url, { waitUntil: 'load', timeout: 120000 });
      await sleep(1200);
      const baseFilter = await filterOf(page);
      const baseShot = await page.screenshot();
      // 确定性色块的 OFF 基线像素 —— 必须就是注入的那个纯色。
      await page.evaluate(SWATCH);
      await sleep(400);
      const baseSwatch = swatchPixels(
        await page.screenshot({ clip: { x: 0, y: 0, width: 80, height: 120 } }),
      );
      const basePath = path.join(SHOTS, `${siteName}-00-OFF.png`);
      fs.writeFileSync(basePath, Buffer.from(baseShot));
      const baseStats = stats(baseShot);

      R.assert(
        `[${siteName}] 基线:无规则时无滤镜,且页面本身是彩色的(探针有效)`,
        baseFilter === 'none' && baseStats.coloredRatio > 0.02,
        { baseFilter, ...baseStats },
      );
      R.assert(
        `[${siteName}] 基线:三个注入色块未被滤镜改动(= 原纯色,证明 fixture 可信)`,
        JSON.stringify(baseSwatch) === JSON.stringify(SWATCH_RGB),
        { baseSwatch, expected: SWATCH_RGB },
      );
      index.push({ site: siteName, mode: 'OFF', file: path.basename(basePath), ...baseStats });
      await page.close();

      /* ── 四个模式逐一截图 ── */
      for (const mode of MODES) {
        await seed(browser, settings([rule('*', mode, 100)], true));
        // 🔴 该模式下测量一次:返回 filter 字符串、整页截图与色块像素。
        //    最多重试 MAX_TRIES 次(每次**重新导航**),用于穿过 HN 上
        //    已定位到平台层的光栅化闪烁(见文件头坑 3)。
        const MAX_TRIES = 4;
        let f = null;
        let shot = null;
        let sw = null;
        let tries = 0;
        for (; tries < MAX_TRIES; tries++) {
          const p = await browser.newPage();
          await p.setViewport({ width: 1280, height: 900 });
          await p.goto(url, { waitUntil: 'load', timeout: 120000 });
          // 等到 filter 变成**本模式预期的形状**,而不是只等「非 none」——
          // 后者会立刻返回上一个模式的陈旧值(见文件头坑 1)。
          f = await waitFilter(p, expectedShape(mode), 10000);
          await sleep(1000);
          shot = await p.screenshot();
          await p.evaluate(SWATCH);
          await sleep(500);
          sw = swatchPixels(
            await p.screenshot({ clip: { x: 0, y: 0, width: 80, height: 120 } }),
          );
          await p.close();
          // 色块被改变 → 本轮测量有效,不必重试。
          if (sw.some((px, i) => JSON.stringify(px) !== JSON.stringify(SWATCH_RGB[i]))) break;
        }

        const file = `${siteName}-${mode}.png`;
        fs.writeFileSync(path.join(SHOTS, file), Buffer.from(shot));
        const st = stats(shot);
        const diff = meanDiff(baseShot, shot);
        index.push({
          site: siteName,
          mode,
          file,
          filter: String(f).slice(0, 80),
          ...st,
          meanDiffVsOff: diff,
          swatch: sw,
          navigations: tries + 1,
        });

        // (a1) 滤镜真的生效,且**就是本模式的**滤镜(非陈旧残留)。
        R.assert(
          `[${siteName}/${mode}] 滤镜在真实网页上真的生效,且形状符合本模式`,
          f !== 'none' && expectedShape(mode)(String(f)),
          { filter: String(f).slice(0, 60) },
        );
        // (a2) 🔴「像素确实变了」用**确定性色块**判定 ——
        //      真实网页的整页差值会被动态内容盖掉(见文件头坑 2)。
        // 判据:三色中**至少一个**变化。单色可能是该矩阵的不动点
        // (见 SWATCH 的注释),故不能逐色都要求变化。
        R.assert(
          `[${siteName}/${mode}] 🔴 确定性色块的像素确实被滤镜改变了(三色至少一变)`,
          sw.some((px, i) => JSON.stringify(px) !== JSON.stringify(SWATCH_RGB[i])),
          { swatch: sw, offBaseline: SWATCH_RGB, navigations: tries + 1 },
        );
        // (a3) Grayscale 必须彻底无彩;三种辅助模式必须**仍然有彩**
        //      —— daltonization 的目的是重映射色彩,不是抹掉色彩。
        //      若某个辅助模式把页面变成了灰,那是矩阵错了。
        if (mode === 'Grayscale') {
          R.assert(
            `[${siteName}/${mode}] 🔴 Grayscale 在真实网页上彻底无彩(maxSpread === 0)`,
            st.maxSpread === 0,
            { maxSpread: st.maxSpread },
          );
        } else {
          R.assert(
            `[${siteName}/${mode}] 🔴 辅助模式仍保有色彩(非灰化;coloredRatio > 0.01)`,
            st.coloredRatio > 0.01,
            { coloredRatio: st.coloredRatio, maxSpread: st.maxSpread },
          );
          R.assert(
            `[${siteName}/${mode}] 使用内联 data: URI 的 feColorMatrix(ADR-063)`,
            /^url\("data:image\/svg\+xml/.test(String(f)),
            { filter: String(f).slice(0, 50) },
          );
        }
        // 页面已在重试循环内关闭,此处无需再关。
      }
    }
  } finally {
    await browser.close();
  }

  R.cases.push({ screenshots: index });

  // 人类复核索引 —— 这是本门禁的**主要产出**。
  const md = [
    '# T7 · 四个滤镜在真实网页上的视觉证据',
    '',
    '> §6 T7【新增】:「四个滤镜在真实网页上视觉正确(截图留档,',
    '> **供人类复核色彩矩阵是否合理**)」。',
    '>',
    '> 🔴 **机器只能判「生效了 / 变了 / 灰不灰」—— 矩阵是否*合理*必须由人看。**',
    '> 请逐张对比同一站点的 OFF 与四个模式,确认:',
    '> 1. 布局与 OFF 完全一致(INV-1;几何另有 `docs/T4a-gate/geometry.cjs` 的机械门禁);',
    '> 2. 三种 daltonization 模式**重映射**了色彩而非抹掉色彩;',
    '> 3. 文字与背景的对比度没有被破坏到不可读;',
    '> 4. Ishihara 检测图(wikipedia 页内)在对应模式下的变化方向合理。',
    '',
    `生成时间:${new Date().toISOString()}`,
    '',
    '| 站点 | 模式 | 截图 | maxSpread | 有彩像素比 | 与 OFF 平均差 |',
    '|---|---|---|---|---|---|',
    ...index.map(
      (r) =>
        `| ${r.site} | ${r.mode} | [${r.file}](visual/${r.file}) | ${r.maxSpread} | ${r.coloredRatio} | ${
          r.meanDiffVsOff ?? '—'
        } |`,
    ),
    '',
    '## 判读提示',
    '',
    '- `maxSpread` = 整图单像素 RGB 通道极差的最大值。**Grayscale 必为 0**。',
    '- `有彩像素比` = 通道极差 > 8 的采样像素占比。辅助模式应**显著大于 0**',
    '  —— 若接近 0,说明该模式把页面灰化了,矩阵有误。',
    '- `与 OFF 平均差` = 与无滤镜基线的平均逐通道差。应显著大于 0,否则滤镜没起作用。',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'visual-modes.md'), `${md}\n`);
  console.log(`\n人类复核索引:${path.join(OUT, 'visual-modes.md')}`);
  console.log(`截图目录:${SHOTS}`);

  return R.finish(OUT);
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
