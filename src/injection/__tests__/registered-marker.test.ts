/**
 * 🔴 声明式注册的**同步自述标记**(INV-3 的冷缓存承担者)。
 *
 * 本文件把 `docs/T4a-gate/flicker.cjs` 抓到的那个回归钉在单元层 ——
 * 真实 Chrome 逐帧录屏是昂贵的(每轮数分钟、需联网与真实站点),
 * 不能靠它守一条每次改注入编排都可能撞到的不变式。
 *
 * ## 被钉住的回归
 *
 * ADR-069 给预生成 CSS 加了 `.ccf-on` 门控。门控本身必需(消除前向引用
 * 的不确定性),但它**把 JS 重新放回了页面加载的关键路径**:冷缓存下
 * (宿主 origin 的 `localStorage` 无条目)`readFastPath` 返回 `unknown`,
 * 同步阶段无事可做,class 要等异步 `chrome.storage` 读完才加上。
 * 实测 `coldCache 1/4`、`1/3`、`1/5`、`2/127` 帧带色。
 *
 * 修法是补上缺失的同步输入:预生成文件自带一行无门控的
 * `:root { --ccf-registered: ccf-gray-100; }`,而该文件按**用户规则算出的
 * `matches`** 注册 —— 它在文档里就等于浏览器已判定本 host 该上色。
 *
 * ⚠️ 本文件不冒充 REAL_STACK_GATE:真实的零闪烁仍由 `flicker.cjs` 在
 *    真实 Chrome 的生产产物上逐帧验收(DESIGN.md §8 第 8 条)。
 *    这里验的是**编排**:冷缓存下同步阶段到底有没有上色。
 */
import { describe, expect, it } from 'vitest';
import {
  FILTER_REGISTERED_VAR,
  filterRegisteredMarker,
  parseRegisteredMarker,
} from '../../domain/index.js';
import { readRegisteredMarker } from '../registered-marker.js';

/** 一个只认 `--ccf-registered` 的计算样式替身。 */
function readerWith(value: string | null) {
  return () => ({
    getPropertyValue: (name: string) =>
      name === FILTER_REGISTERED_VAR && value !== null ? value : '',
  });
}

describe('🔴 自述标记的构造与解析(与 svgFilterId 同源,不得另写构词法)', () => {
  it('marker 逐字等于 SVG 的 <filter id> —— 两者同源,不可能漂移', () => {
    // ADR-063 明文禁止另写公式。marker 复用 svgFilterId,于是
    // 「CSS 写进去的」与「SVG 节点的 id」结构上不可能分叉。
    expect(filterRegisteredMarker('Grayscale', 100)).toBe('ccf-gray-100');
    expect(filterRegisteredMarker('RedGreen', 60)).toBe('ccf-redgreen-60');
    expect(filterRegisteredMarker('GreenRed', 0)).toBe('ccf-greenred-0');
    expect(filterRegisteredMarker('BlueYellow', 7)).toBe('ccf-blueyellow-7');
  });

  it('四模式 × 若干强度全部可往返(round-trip)', () => {
    for (const mode of ['Grayscale', 'RedGreen', 'GreenRed', 'BlueYellow'] as const) {
      for (const intensity of [0, 1, 37, 99, 100] as const) {
        const back = parseRegisteredMarker(filterRegisteredMarker(mode, intensity));
        expect(back).toEqual({ mode, intensity });
      }
    }
  });

  it('容忍前后空白 —— getPropertyValue 的返回值保留了 CSS 的记号化空白', () => {
    expect(parseRegisteredMarker('  ccf-gray-100  ')).toEqual({
      mode: 'Grayscale',
      intensity: 100,
    });
  });

  it('空串 = 本 host 未注册(绝大多数页面)→ null,调用方什么都不做', () => {
    expect(parseRegisteredMarker('')).toBeNull();
    expect(parseRegisteredMarker('   ')).toBeNull();
  });

  it('垃圾值一律 null,绝不抛异常(INV-1:不抛到页面上)', () => {
    for (const junk of [
      'ccf-nosuchmode-50',
      'ccf-gray-101',
      'ccf-gray--1',
      'ccf-gray',
      'gray-100',
      'ccf-gray-100; filter: url(evil)',
      '<script>',
    ]) {
      expect(parseRegisteredMarker(junk), junk).toBeNull();
    }
  });
});

describe('🔴 readRegisteredMarker:同步、软失败、只问一个写死的属性名', () => {
  it('读到合法 marker → 解出 (mode,intensity)', () => {
    expect(readRegisteredMarker({}, readerWith('ccf-redgreen-60'))).toEqual({
      mode: 'RedGreen',
      intensity: 60,
    });
  });

  it('未注册(空串)→ null', () => {
    expect(readRegisteredMarker({}, readerWith(null))).toBeNull();
  });

  it('🔴 只查询 `--ccf-registered` 这一个属性名 —— 不枚举、不读别的', () => {
    // ADR-026 / INV-9:本模块的「读」必须窄到无法读出页面任何东西。
    // 断言落在**实际查询了哪些属性名**上,而不是靠读代码确认。
    const asked: string[] = [];
    readRegisteredMarker({}, () => ({
      getPropertyValue: (name: string) => {
        asked.push(name);
        return '';
      },
    }));
    expect(asked).toEqual([FILTER_REGISTERED_VAR]);
  });

  it('🔴 宿主缺 getComputedStyle / 实现抛异常 → 降级为 null,绝不抛出', () => {
    // content script 抛到页面上就是对 INV-1 的破坏(会触发站点的错误处理器)。
    expect(
      readRegisteredMarker({}, () => {
        throw new Error('boom');
      }),
    ).toBeNull();
    expect(
      readRegisteredMarker({}, () => ({
        getPropertyValue: () => {
          throw new Error('boom');
        },
      })),
    ).toBeNull();
    // 非浏览器宿主:全局没有 getComputedStyle(本测试环境即如此)。
    expect(readRegisteredMarker({})).toBeNull();
  });

  it('getPropertyValue 返回非字符串(异常实现)→ null', () => {
    expect(
      readRegisteredMarker({}, () => ({
        getPropertyValue: () => undefined as unknown as string,
      })),
    ).toBeNull();
  });
});
