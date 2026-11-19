// T0 harness: measure fixed/sticky geometry with/without each approach.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

// Chrome 158 stable ignores --load-extension (DisableLoadExtensionCommandLineSwitch).
// Chrome for Testing, same 158.0.8127.36 build, still honours it.
const CHROME = process.env.CHROME || path.join(__dirname,
  'chrome/mac_arm-158.0.8127.36/chrome-mac-arm64',
  'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const EXT = path.join(__dirname, 'ext');
const OUT = process.env.OUT || path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const SITES = {
  github: 'https://github.com/',
  wikipedia: 'https://en.wikipedia.org/wiki/CSS',
  hn: 'https://news.ycombinator.com/',
};

// Collect geometry of every fixed/sticky element, keyed by a stable path.
const PROBE = `(() => {
  function pathOf(el) {
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 8) {
      let p = el.tagName.toLowerCase();
      if (el.id) { p += '#' + el.id; parts.unshift(p); break; }
      const par = el.parentElement;
      if (par) p += ':nth-child(' + (Array.prototype.indexOf.call(par.children, el) + 1) + ')';
      parts.unshift(p);
      el = par;
    }
    return parts.join('>');
  }
  const out = [];
  const all = document.querySelectorAll('*');
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    out.push({
      path: pathOf(el),
      pos: cs.position,
      x: Math.round(r.x * 100) / 100,
      y: Math.round(r.y * 100) / 100,
      w: Math.round(r.width * 100) / 100,
      h: Math.round(r.height * 100) / 100,
    });
  }
  return {
    els: out,
    scrollY: window.scrollY,
    docH: document.documentElement.scrollHeight,
    innerH: window.innerHeight,
  };
})()`;

async function run(approach, siteKey, url) {
  // Bake the approach into the extension before launching Chrome.
  fs.writeFileSync(path.join(EXT, 'config.js'),
    `self.__T0_APPROACH = ${JSON.stringify(approach)};\n`);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'shell' === 'never' ? false : false, // headful needed for extensions
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,900',
    ],
    defaultViewport: { width: 1280, height: 860 },
  });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((a) => { window.__T0_APPROACH = a; }, approach);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2500));

    const applied = await page.evaluate(() => ({
      htmlFilter: getComputedStyle(document.documentElement).filter,
      bodyFilter: getComputedStyle(document.body).filter,
      overlay: (() => {
        const o = document.getElementById('__t0_spike_overlay');
        if (!o) return null;
        const cs = getComputedStyle(o);
        return { backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
                 pointerEvents: cs.pointerEvents, z: cs.zIndex };
      })(),
    }));

    const top = await page.evaluate(PROBE);
    await page.screenshot({ path: path.join(OUT, `${siteKey}-${approach}-top.png`) });

    await page.evaluate(() => window.scrollTo(0, 1200));
    await new Promise(r => setTimeout(r, 1200));
    const scrolled = await page.evaluate(PROBE);
    await page.screenshot({ path: path.join(OUT, `${siteKey}-${approach}-scroll1200.png`) });

    return { approach, siteKey, applied, top, scrolled };
  } finally {
    await browser.close();
  }
}

(async () => {
  const approaches = (process.env.APPROACHES || 'off,a1,a2,a3,a4').split(',');
  const sites = (process.env.SITES || 'github,wikipedia,hn').split(',');
  const results = [];
  for (const s of sites) {
    for (const a of approaches) {
      process.stderr.write(`running ${s} / ${a}\n`);
      try {
        results.push(await run(a, s, SITES[s]));
      } catch (e) {
        process.stderr.write(`ERROR ${s}/${a}: ${e.message}\n`);
        results.push({ approach: a, siteKey: s, error: e.message });
      }
    }
  }
  fs.writeFileSync(path.join(OUT, 'raw.json'), JSON.stringify(results, null, 2));
  console.log('done');
})();
