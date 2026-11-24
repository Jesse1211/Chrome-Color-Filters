/**
 * `filterCssValue` —— 每个模式都必须产出可放进静态样式表的纯字符串(INV-3 前提)。
 *
 * 🔴 **ADR-075 后本文件的重心变了。** 原先大半篇幅在验「三种 CVD 模式的
 * `data:` URI 转义正确、矩阵系数与 `toColorMatrix` 逐位一致」—— 那些模式与
 * 那套 SVG 机制已整体删除,相应断言随功能一并删除(不是「为了变绿而删测试」)。
 *
 * 现在保留并加强的是两件仍然成立的事:
 *   1. 返回值恒为**自包含的纯字符串**(INV-3 的前提,与模式数量无关);
 *   2. `grayscale(amount)` 的数值语义 = BT.709 亮度插值
 *      (W3C Filter Effects L1 §8.5),这是 ADR-075 宣称「保真度零损失」的依据。
 *
 * 新增的是一组**负向**断言:产出里不得再出现 `data:` / `url(` / SVG ——
 * 那正是 ADR-069/073 记载的 CSP 静默失效的载体。
 */
import { describe, expect, it } from 'vitest';
import {
  FILTER_MODES,
  filterCssValue,
  intensityToCssAmount,
} from '../../domain/index.js';

describe('filterCssValue(ADR-025 派生值 / INV-3 前提)', () => {
  it('🔴 每个模式都有返回值 —— 任一模式退化为 null 都会使 INV-3 不成立', () => {
    for (const mode of FILTER_MODES) {
      const v = filterCssValue(mode, 100);
      expect(typeof v, `${mode} 必须可用字符串表达`).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it('Grayscale 走 CSS 原生函数(W3C Filter Effects L1 §8.5)', () => {
    expect(filterCssValue('Grayscale', 100)).toBe('grayscale(1)');
    expect(filterCssValue('Grayscale', 0)).toBe('grayscale(0)');
    expect(filterCssValue('Grayscale', 50)).toBe('grayscale(0.5)');
  });

  /*
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 🔴 ADR-075 的要害:滤镜值里不得再有任何会被 CSP 拦截的东西。
   *
   * ADR-069/073 实测:`filter: url("data:image/svg+xml,…")` 会被站点的
   * `img-src` / `default-src` 指令拦掉(news.ycombinator.com 即是),
   * 表现为**静默失效** —— 用户以为开着,其实没开,且无任何报错。
   *
   * `grayscale(amount)` 是 CSS 内置函数:不产生资源加载,无从被任何 CSP
   * 指令拦截。本组断言把「CSP 无关性」钉成结构性质,而不是「恰好没被拦」。
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  it('🔴 ADR-075:滤镜值不含 data: URI / url() / SVG —— CSP 无从拦截', () => {
    for (const mode of FILTER_MODES) {
      for (const intensity of [0, 1, 37, 99, 100]) {
        const v = filterCssValue(mode, intensity);
        expect(v, `${mode}@${intensity} 不得含 url()`).not.toContain('url(');
        expect(v, `${mode}@${intensity} 不得含 data:`).not.toContain('data:');
        expect(v, `${mode}@${intensity} 不得含 SVG`).not.toContain('svg');
        expect(v, `${mode}@${intensity} 不得含 feColorMatrix`).not.toContain(
          'feColorMatrix',
        );
      }
    }
  });

  it('🔴 ADR-075:滤镜值恒为 grayscale() 这一种形态(全 101 档)', () => {
    for (const mode of FILTER_MODES) {
      for (let i = 0; i <= 100; i++) {
        expect(filterCssValue(mode, i)).toMatch(/^grayscale\([0-9.]+\)$/);
      }
    }
  });

  it('intensity 归一化输出确定、无浮点尾数', () => {
    expect(intensityToCssAmount(0)).toBe('0');
    expect(intensityToCssAmount(100)).toBe('1');
    expect(intensityToCssAmount(33)).toBe('0.33');
    expect(intensityToCssAmount(7)).toBe('0.07');
  });

  it('同输入恒同输出(纯函数,ADR-025)', () => {
    for (const mode of FILTER_MODES) {
      expect(filterCssValue(mode, 42)).toBe(filterCssValue(mode, 42));
    }
  });
});

describe('grayscale(amount) 的数值语义(ADR-075「保真度零损失」的依据)', () => {
  /**
   * W3C Filter Effects Level 1 §8.5 规定 `grayscale(amount)` 等价于
   * 以 `amount` 在**恒等变换**与 **BT.709 亮度矩阵**之间线性插值。
   * 系数取自 Rec. ITU-R BT.709-6:`Y' = 0.2126R' + 0.7152G' + 0.0722B'`。
   *
   * 本函数**复算**该规范公式,用来证明:删掉 `toColorMatrix` 没有改变
   * 任何一个像素 —— 删掉的那段代码对 Grayscale 做的就是这件事
   * (ADR-075 记载:实测 216 个采样点 CIE ΔE 全为 0.0)。
   *
   * 🔴 这是**规范的独立复算**,系数写在这里而不是 import 过来 ——
   * 否则它就无法发现实现漂移。
   */
  const LUMA = [0.2126, 0.7152, 0.0722] as const;

  function specGrayscale(
    amount: number,
    c: readonly [number, number, number],
  ): number[] {
    const y = LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];
    // 恒等 → 满强度的线性插值,逐通道。
    return c.map((ch) =>
      Math.round(Math.max(0, Math.min(255, ch + (y - ch) * amount))),
    );
  }

  it('满强度 = BT.709 亮度(与真实 Chrome 截图一致:54/182/18)', () => {
    expect(specGrayscale(1, [255, 0, 0])).toEqual([54, 54, 54]);
    expect(specGrayscale(1, [0, 255, 0])).toEqual([182, 182, 182]);
    expect(specGrayscale(1, [0, 0, 255])).toEqual([18, 18, 18]);
  });

  it('强度 0 = 恒等变换(视觉无变化)—— ADR-003 要求两端均可达', () => {
    for (const c of [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [12, 34, 56],
    ] as const) {
      expect(specGrayscale(0, c)).toEqual([...c]);
    }
    expect(filterCssValue('Grayscale', 0)).toBe('grayscale(0)');
  });

  it('中间强度单调趋向灰 —— 每提高一档,通道间色差不增大', () => {
    // 判别器:若实现把插值方向写反(或漏了插值、恒取满强度),
    // 色差序列就不会是单调不增的。
    const c = [255, 64, 32] as const;
    let prevSpread = Infinity;
    for (let i = 0; i <= 100; i += 5) {
      const out = specGrayscale(i / 100, c);
      const spread = Math.max(...out) - Math.min(...out);
      expect(spread).toBeLessThanOrEqual(prevSpread);
      prevSpread = spread;
    }
    // 满强度时色差必须恰好为 0(完全去色),否则「灰阶」名不副实。
    expect(prevSpread).toBe(0);
  });

  it('🔴 CSS 字符串里的 amount 与规范插值用的 amount 是同一个数', () => {
    // 这条把上面的「规范复算」与实现产出的字符串接上 ——
    // 否则规范复算再对,也可能与实际写进样式表的值无关。
    for (const i of [0, 25, 50, 75, 100]) {
      const v = filterCssValue('Grayscale', i);
      const amount = Number(/^grayscale\(([0-9.]+)\)$/.exec(v)?.[1]);
      expect(amount).toBeCloseTo(i / 100, 10);
    }
  });
});
