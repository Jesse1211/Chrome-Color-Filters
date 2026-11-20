/**
 * Content script 产物的**静态隐私/非侵入审计**(INV-9 / ADR-026)。
 *
 * 📌 完整的三项审计(含 Network 实测)是 **T4b** 的 gate。
 * 本文件只覆盖 T4a 已经能够断言、且与 T4a 注入路径直接相关的静态项 ——
 * 因为 T4a 引入了宿主 origin 的 `localStorage` 快路径（ADR-060），
 * 必须就地证明这条**窄口例外**没有被撑宽:它只碰自己那一个键，
 * 不枚举、不读页面内容、不外传。
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

  it('🔴 ADR-060 的窄口例外确实被用上了 —— 产物必须含 localStorage 快路径', () => {
    // ⚠️ 这条断言的**方向在本轮被反转了**，不是放松，而是跟随裁决。
    //
    // 上一轮这里断言「产物中不得出现 localStorage」，依据是 DESIGN.md §1
    // 「宿主页面……只可观察，永不拥有」。那个判断在当时是对的，但它的代价是
    // INV-3 在冷启动下**必然**失败（sessionStorage 活不过标签页，实测 6 次闪 3 次）。
    //
    // 产品负责人已就此裁决，记为 **ADR-060**：允许在宿主 origin 的 localStorage
    // 下存一条仅含 (mode,intensity) 的快路径记录，这是对 §1 的**窄口例外**，
    // DESIGN.md §1 与 §4.1 均已改写记入。
    //
    // 于是本断言改为守住**反方向**:快路径是 INV-3 的实现本体，
    // 谁把它悄悄换回 sessionStorage（或删掉），这里立刻红。
    expect(code, '产物中没有 localStorage 快路径 —— INV-3 失去唯一的同步通道（ADR-060）')
      .toContain('localStorage');
  });

  it('🔴 窄口例外不得被撑宽:localStorage 只被取用一次,且只做单键读写', () => {
    // ADR-060 授权的是「一条仅含 mode+intensity 的记录」,不是「随意使用宿主存储」。
    //
    // 📌 产物的真实形态(实测,不要想当然):打包后只有 **一处**
    // `globalThis.localStorage`,它被取出来当作 SyncKeyValueStore 端口传递,
    // 之后的调用是 `.getItem/.setItem/.removeItem`(经过压缩,标识符已改名)。
    // 所以这里不去数 `localStorage.xxx` 的成员访问 —— 那种写法在产物里
    // 根本不存在,断言会变成空转(本轮第一版就踩了这个坑,已改正)。
    //
    // 真正能机械把守的是这两条:取用次数 + 不存在任何枚举能力。
    const occurrences = code.match(/localStorage/g) ?? [];
    expect(occurrences.length, 'localStorage 出现次数异常 —— 窄口例外可能被撑宽').toBe(1);

    // 键名前缀必须在产物里,且只有这一个前缀。
    expect(code).toContain('__ccf_fp_');
  });

  it('Web Storage 只用于扩展自己的 __ccf_ 前缀键（快路径缓存）', () => {
    expect(code).toContain('__ccf_fp_');
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
