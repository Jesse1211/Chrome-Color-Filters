// REAL_STACK_GATE 共用工具:启动真实 Chrome、加载生产构建产物、播种规则。
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME = path.join(__dirname, '..', 'T0-spike', 'spike-code',
  'chrome/mac_arm-158.0.8127.36/chrome-mac-arm64',
  'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

// 🔴 ADR-038:一律用 wxt build 产物,dev 模式不作数。
const EXT = '/tmp/ff-wt/T4a/.output/chrome-mv3';

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

// 播种设置。rules 为 null 表示「主开关关闭」场景。
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
