// REAL_STACK_GATE 共用工具:启动真实 Chrome、加载生产构建产物、播种规则。
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME = path.join(__dirname, '..', 'T0-spike', 'spike-code',
  'chrome/mac_arm-158.0.8127.36/chrome-mac-arm64',
  'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

// 🔴 ADR-038:一律用 wxt build 产物,dev 模式不作数。
// 路径相对**仓库根**解析(本文件在 <root>/docs/T4a-gate/),不写死任何机器路径 ——
// 否则换一台机器/换一个 worktree 跑 README 的复现步骤就会报「缺少生产构建产物」,
// 让人误判成构建坏了。可用 CCF_EXT_DIR 覆盖。
const EXT = process.env.CCF_EXT_DIR
  || path.join(__dirname, '..', '..', '.output', 'chrome-mv3');

async function launch(userDataDir, opts = {}) {
  if (!fs.existsSync(path.join(EXT, 'manifest.json'))) {
    throw new Error('缺少生产构建产物,请先 npm run build(ADR-038)');
  }
  return puppeteer.launch({
    executablePath: CHROME,
    // 🔴 与 T0 §7 的记载不同:本机环境下 headful 的窗口始终被系统判为遮挡,
    // 合成器不产帧 —— 实测 T0 自己的 flicker.js 原样重跑也只抓到 1–2 帧,
    // 且连「必然彩色」的基线都报 0 带色帧(探针失效)。
    // Chrome 的**新** headless 走虚拟显示,合成路径真实、MV3 扩展正常加载
    // (实测 47 帧 + service worker 存在),故零闪烁探针改用它。
    // 几何门禁仍用 headful(见 geometry.cjs),那里不依赖逐帧合成。
    headless: opts.headless !== undefined ? opts.headless : false,
    userDataDir,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,900',
    ],
    defaultViewport: { width: 1280, height: 860 },
  });
}

// 取得扩展的 service worker,用于在扩展上下文里写 chrome.storage.local。
async function getWorker(browser) {
  for (let i = 0; i < 60; i++) {
    const t = browser.targets().find((x) => x.type() === 'service_worker');
    if (t) { const w = await t.worker(); if (w) return w; }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('扩展 service worker 未出现 —— 扩展很可能没加载(见 T0 §7 环境坑)');
}

// 播种设置。
//
// 📌 这里直接写 chrome.storage.local,而 src/storage/index.ts 写明
// 「上层只应通过本模块读写设置;直接调用 chrome.storage.* 会绕开锁定强制
// (INV-14/ADR-055)」。本处是**合法例外**:门禁 fixture 从扩展包**外部**
// 播种初始状态,够不着仓储层的 API;且播种的 settings 恒带 lockUntil: null
// (见下方 settings()),不存在被绕过的锁。产品代码一律不得照抄这个写法。
async function seed(browser, settings) {
  const w = await getWorker(browser);
  await w.evaluate(async (s) => {
    await chrome.storage.local.set({ filterSettings: s });
  }, settings);
}

function rule(pattern, mode = 'Grayscale', intensity = 100) {
  return { pattern, mode, intensity };
}

function settings(rules, masterEnabled = true) {
  return { version: 1, masterEnabled, rules, lockUntil: null, maxSeenTime: Date.now() };
}

module.exports = { launch, getWorker, seed, rule, settings, EXT, CHROME };
