// REAL_STACK_GATE #1:position:fixed / sticky 几何零影响(INV-1)。
// 在 github / wikipedia / hn 上,滤镜开关前后滚动,比对屏幕坐标 + 截图。
const fs = require('fs');
const path = require('path');
const { launch, seed, rule, settings } = require('./lib.cjs');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const SITES = {
  github: 'https://github.com/',
  wikipedia: 'https://en.wikipedia.org/wiki/CSS',
  hn: 'https://news.ycombinator.com/',
};

const PROBE = `(() => {
  function pathOf(el) {
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 8) {
      let p = el.tagName.toLowerCase();
      if (el.id) { p += '#' + el.id; parts.unshift(p); break; }
      const par = el.parentElement;
      if (par) p += ':nth-child(' + (Array.prototype.indexOf.call(par.children, el) + 1) + ')';
      parts.unshift(p); el = par;
    }
    return parts.join('>');
  }
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    out.push({ path: pathOf(el), pos: cs.position,
      x: Math.round(r.x*100)/100, y: Math.round(r.y*100)/100,
      w: Math.round(r.width*100)/100, h: Math.round(r.height*100)/100 });
  }
  // 🔴 ADR-069:滤镜态的真相源是 ccf-on class(属性已废止)。
  return { els: out, filtered: document.documentElement.classList.contains('ccf-on') };
})()`;

// 单像素 RGB 极差的最大值。灰阶输出必为 0 —— 证明滤镜真的生效了。
function maxChannelSpread(png) {
  const { PNG } = require('pngjs');
  const img = PNG.sync.read(Buffer.from(png));
  let max = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i], g = img.data[i+1], b = img.data[i+2];
    const s = Math.max(r,g,b) - Math.min(r,g,b);
    if (s > max) max = s;
  }
  return max;
}

async function measure(browser, url, key, on) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.evaluate(() => window.scrollTo(0, 1200));
  await new Promise((r) => setTimeout(r, 1200));
  const data = await page.evaluate(PROBE);
  const shot = await page.screenshot();
  fs.writeFileSync(path.join(OUT, `geo-${key}-${on ? "on" : "off"}.png`), Buffer.from(shot));
  data.spread = maxChannelSpread(shot);
  await page.close();
  return data;
}

(async () => {
  const results = {};
  for (const [key, url] of Object.entries(SITES)) {
    const udd = path.join(OUT, `profile-${key}`);
    fs.rmSync(udd, { recursive: true, force: true });
    const browser = await launch(udd);
    try {
      // 基线:无规则 → 不滤镜。
      await seed(browser, settings([]));
      const off = await measure(browser, url, key, false);

      // 滤镜态:一条匹配全部 host 的灰阶规则。
      await seed(browser, settings([rule('*')]));
      const on = await measure(browser, url, key, true);

      // 逐元素求差,只比对两边都存在的元素(T0 §3.2 记录的已知噪声:
      // 募捐横幅/进度条等页面自身动态内容会让元素集合不完全相同)。
      const offMap = new Map(off.els.map((e) => [e.path, e]));
      const diffs = [];
      for (const e of on.els) {
        const b = offMap.get(e.path);
        if (!b) continue;
        const dx = Math.round((e.x - b.x) * 100) / 100;
        const dy = Math.round((e.y - b.y) * 100) / 100;
        if (dx !== 0 || dy !== 0) diffs.push({ path: e.path, dx, dy });
      }
      results[key] = {
        compared: on.els.filter((e) => offMap.has(e.path)).length,
        onlyOn: on.els.length, onlyOff: off.els.length,
        diffs,
        filteredAttr: on.filtered,
        spreadOff: off.spread, spreadOn: on.spread,
      };
      console.log(key, JSON.stringify(results[key], null, 1));
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(OUT, 'geometry.json'), JSON.stringify(results, null, 2));

  let fail = false;
  for (const [k, r] of Object.entries(results)) {
    if (r.diffs.length) { console.log(`FAIL ${k}: ${r.diffs.length} 个元素位移`); fail = true; }
    if (r.spreadOn !== 0) { console.log(`FAIL ${k}: 滤镜态 spread=${r.spreadOn} ≠ 0,滤镜未真正生效`); fail = true; }
    if (r.spreadOff === 0) { console.log(`FAIL ${k}: 基线 spread=0,探针无效`); fail = true; }
    // hn(news.ycombinator.com)本身没有任何 fixed/sticky 元素 —— 这是站点属性,
    // 不是探针失效。T0 的 data/geometry-raw.json 独立佐证:off/a1/a2/a4/a5 六个
    // approach 下 scrolled els 恒为 0(a3 的那 1 个是 spike 自己注入的覆盖层 div)。
    // 故对 hn 不要求有可比对元素,但**仍然**要求滤镜真的生效(spreadOn === 0),
    // 那一项才是 hn 在本 gate 中承担的证据。
    const allowNoFixed = k === 'hn';
    if (r.compared === 0 && !allowNoFixed) { console.log(`FAIL ${k}: 无可比对元素`); fail = true; }
    if (r.compared === 0 && allowNoFixed) { console.log(`NOTE ${k}: 站点无 fixed/sticky 元素(T0 数据佐证),仅校验滤镜生效`); }
    if (!r.filteredAttr) { console.log(`FAIL ${k}: 滤镜态未打上门控属性`); fail = true; }
  }
  console.log(fail ? 'GEOMETRY: FAIL' : 'GEOMETRY: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
