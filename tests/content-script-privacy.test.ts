/**
 * Content script 产物的**静态隐私/非侵入审计**(INV-9 / ADR-026)。
 *
 * 📌 完整的三项审计(含 Network 实测)是 **T4b** 的 gate。
 * 本文件只覆盖 T4a 已经能够断言、且与 T4a 注入路径直接相关的静态项 ——
 * 因为 T4a 引入了 Web Storage（`localStorage` / `sessionStorage`）快路径，
 * 必须就地证明它没有顺手读取页面内容。
 *
 * 产物不存在时跳过(同 build-manifest.test.ts 的理由:构建是独立 gate 步骤)。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CS = resolve(ROOT, '.output/chrome-mv3/content-scripts/content.js');
const built = existsSync(CS);

describe.skipIf(!built)('content script 非侵入静态审计(INV-9 / ADR-026)', () => {
  const code = built ? readFileSync(CS, 'utf8') : '';

  it('🔴 不含任何外传通道', () => {
    for (const bad of [
      'fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'new Image(',
    ]) {
      expect(code, `产物中出现了外传通道 ${bad}`).not.toContain(bad);
    }
  });

  it('🔴 不读取页面内容(innerText / innerHTML / textContent)', () => {
    for (const bad of ['innerText', 'innerHTML', 'textContent']) {
      expect(code, `产物中出现了页面内容读取 ${bad}`).not.toContain(bad);
    }
  });

  it('🔴 不遍历页面元素 —— 注入只碰 documentElement', () => {
    expect(code).not.toContain('querySelectorAll');
    expect(code).not.toContain('getElementsByTagName');
  });

  it('Web Storage 只用于扩展自己的 __ccf_ 前缀键（快路径缓存）', () => {
    expect(code).toContain('__ccf_fp_');
    // 🔴 两层都要把关：T4a 为了关上 INV-3 的冷启动缺口接入了 localStorage
    //    （跨标签页可见），隐私纪律必须与 sessionStorage 完全同等。
    for (const api of ['sessionStorage', 'localStorage']) {
      // 不得枚举 —— 枚举等同于读取页面写入的数据。
      expect(code, `产物枚举了 ${api}`).not.toContain(`${api}.key`);
      expect(code, `产物枚举了 ${api}`).not.toContain(`Object.keys(${api}`);
      expect(code, `产物枚举了 ${api}`).not.toContain(`Object.entries(${api}`);
      expect(code, `产物读取了 ${api}.length`).not.toContain(`${api}.length`);
    }
    // 🔴 整体枚举的另一种写法：把 storage 对象本身交给某个函数
    //    （Object.keys/values/entries/assign、展开符等）。上面的逐项断言
    //    只挡住了具名写法，这条挡住「把对象整个传出去」。
    expect(code).not.toMatch(/Object\.(keys|values|entries|assign)\(\s*(?:globalThis\.)?(?:local|session)Storage/);
    expect(code).not.toMatch(/\.\.\.\s*(?:globalThis\.)?(?:local|session)Storage/);
  });
});
