/**
 * `filterCssValue` —— 四种模式都必须产出可放进静态样式表的纯字符串(INV-3 前提)。
 */
import { describe, expect, it } from 'vitest';
import {
  FILTER_MODES,
  colorMatrixToValues,
  filterCssValue,
  intensityToCssAmount,
  toColorMatrix,
} from '../../domain/index.js';

describe('filterCssValue（ADR-025 派生值 / INV-3 前提）', () => {
  it('🔴 四种模式全部有返回值 —— 任一模式退化为 null 都会使 INV-3 只对灰阶成立', () => {
    for (const mode of FILTER_MODES) {
      const v = filterCssValue(mode, 100);
      expect(typeof v, `${mode} 必须可用字符串表达`).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it('Grayscale 走 CSS 原生函数（W3C Filter Effects L1 §8.5）', () => {
    expect(filterCssValue('Grayscale', 100)).toBe('grayscale(1)');
    expect(filterCssValue('Grayscale', 0)).toBe('grayscale(0)');
    expect(filterCssValue('Grayscale', 50)).toBe('grayscale(0.5)');
  });

  it('🔴 三种辅助模式走内联 data: URI，不需要任何 DOM 节点（INV-9/INV-3）', () => {
    for (const mode of ['RedGreen', 'GreenRed', 'BlueYellow'] as const) {
      const v = filterCssValue(mode, 100);
      expect(v).toMatch(/^url\("data:image\/svg\+xml,/);
      expect(v).toContain('feColorMatrix');
      // 必须以 fragment 指向内联 filter 的 id，否则 url() 引用不到滤镜。
      expect(v).toMatch(/#f"\)$/);
    }
  });

  it('data: URI 中的矩阵系数与 toColorMatrix 完全一致（ADR-025 单一真相源）', () => {
    const expected = colorMatrixToValues(toColorMatrix('RedGreen', 70));
    const v = filterCssValue('RedGreen', 70);
    // 系数在 URI 中空格被转义为 %20。
    expect(v).toContain(expected.replace(/ /g, '%20'));
  });

  it('🔴 data: URI 中不含未转义的 < > " #（否则 URI 在 CSS 中被截断/解析失败）', () => {
    for (const mode of ['RedGreen', 'GreenRed', 'BlueYellow'] as const) {
      const v = filterCssValue(mode, 100);
      // 剥掉外层 url("...") 后检查 URI 本体。
      const uri = v.slice('url("'.length, -'")'.length);
      const body = uri.slice(0, uri.lastIndexOf('#')); // 末尾那个 # 是合法的 fragment
      expect(body).not.toContain('<');
      expect(body).not.toContain('>');
      expect(body).not.toContain('"');
      expect(body).not.toContain('#');
    }
  });

  it('intensity 归一化输出确定、无浮点尾数', () => {
    expect(intensityToCssAmount(0)).toBe('0');
    expect(intensityToCssAmount(100)).toBe('1');
    expect(intensityToCssAmount(33)).toBe('0.33');
    expect(intensityToCssAmount(7)).toBe('0.07');
  });

  it('同输入恒同输出（纯函数，ADR-025）', () => {
    for (const mode of FILTER_MODES) {
      expect(filterCssValue(mode, 42)).toBe(filterCssValue(mode, 42));
    }
  });
});

describe('矩阵语义的真实 Chrome 对照（REAL_STACK_GATE 的可复算副本）', () => {
  /**
   * 把 feColorMatrix 的前三行作用到一个 sRGB 颜色上（alpha 行恒等，故忽略）。
   * 钳位到 [0,255] —— 与浏览器的行为一致。
   */
  function applyMatrix(mode: 'RedGreen' | 'GreenRed' | 'BlueYellow' | 'Grayscale', c: readonly [number, number, number]) {
    const m = toColorMatrix(mode, 100);
    const out: number[] = [];
    for (let row = 0; row < 3; row++) {
      const o = m[row*5]! * c[0] + m[row*5+1]! * c[1] + m[row*5+2]! * c[2];
      out.push(Math.round(Math.max(0, Math.min(255, o))));
    }
    return out;
  }

  it('Grayscale 满强度 = BT.709 亮度（与真实 Chrome 截图一致：54/182/18）', () => {
    expect(applyMatrix('Grayscale', [255, 0, 0])).toEqual([54, 54, 54]);
    expect(applyMatrix('Grayscale', [0, 255, 0])).toEqual([182, 182, 182]);
    expect(applyMatrix('Grayscale', [0, 0, 255])).toEqual([18, 18, 18]);
  });

  it('🔴 GreenRed 下纯红是**不动点** —— 这是矩阵的正确行为，不是滤镜没生效', () => {
    // R' = 1.436619*255 → 钳到 255；G' = 0；B' = -0.184239*255 → 钳到 0。
    // REAL_STACK_GATE 的像素探针曾因只采这一个点而误报「滤镜未生效」，
    // 故在此固化该事实，避免后续再次误判。
    expect(applyMatrix('GreenRed', [255, 0, 0])).toEqual([255, 0, 0]);
    // 但绿与蓝确实会变 —— 证明滤镜整体是生效的。
    expect(applyMatrix('GreenRed', [0, 255, 0])).toEqual([0, 255, 48]);
    expect(applyMatrix('GreenRed', [0, 0, 255])).toEqual([50, 0, 254]);
  });

  it('RedGreen / BlueYellow 对三原色均产生可见变化（与真实 Chrome 截图一致）', () => {
    expect(applyMatrix('RedGreen', [255, 0, 0])).toEqual([255, 122, 152]);
    expect(applyMatrix('BlueYellow', [0, 0, 255])).toEqual([170, 87, 255]);
  });
});
