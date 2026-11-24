/**
 * `filterCssValue` —— 四种模式都必须产出可放进静态样式表的纯字符串(INV-3 前提)。
 */
import { describe, expect, it } from 'vitest';
import {
  FILTER_MODES,
  colorMatrixToValues,
  filterCssValue,
  filterMatrixValues,
  intensityToCssAmount,
  parseFilterCssValue,
  svgFilterId,
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

  it('🔴 ADR-070 · 四种模式**统一**走同文档 SVG fragment 引用,灰阶不例外', () => {
    // 灰阶本身就是一个颜色矩阵,用内置 grayscale() 只是巧合可行。
    // 两条路径各自演化会一直有「只在某条路上出现的 bug」——
    // 本轮 CSP 缺陷恰好只打中 SVG 路径而灰阶无恙,正是这种分裂的代价。
    for (const mode of FILTER_MODES) {
      expect(filterCssValue(mode, 100)).toMatch(/^url\("#ccf-[a-z]+-\d+"\)$/);
    }
    expect(filterCssValue('Grayscale', 100)).toBe('url("#ccf-gray-100")');
    expect(filterCssValue('Grayscale', 50)).toBe('url("#ccf-gray-50")');
    expect(filterCssValue('Grayscale', 0)).toBe('url("#ccf-gray-0")');
  });

  it('🔴 ADR-070 · 预生成值里**不出现**内置 grayscale( 调用', () => {
    for (const mode of FILTER_MODES) {
      for (const intensity of [0, 1, 50, 99, 100]) {
        expect(filterCssValue(mode, intensity)).not.toContain('grayscale(');
      }
    }
  });

  it('🔴 ADR-069 · **不得**是 data: URI —— 那是本轮修复的缺陷本体', () => {
    // `data:` URI 的 SVG 被浏览器归类为图片资源,受站点 CSP 的 img-src 管辖。
    // 不放行 data: 的站点上三个色觉矫正滤镜**静默失效**(像素等于关闭态、
    // 无任何报错)。真实 Chrome 捕获到 {directive:'img-src', blockedURI:'data'}。
    for (const mode of FILTER_MODES) {
      const v = filterCssValue(mode, 100);
      expect(v, 'data: URI 会被站点 CSP 的 img-src 拦掉 → 静默失效').not.toContain(
        'data:',
      );
      // 同文档引用不产生资源加载,CSP 无从拦截。
      expect(v).toContain('url("#');
      // 矩阵系数**不在** CSS 里 —— 它们在 SVG 节点上(见 svg-filter-def.ts)。
      expect(v).not.toContain('feColorMatrix');
    }
  });

  it('🔴 id 与 svgFilterId 同源 —— CSS 的 url(#id) 必须引用得到 SVG 的 filter id', () => {
    // 两边若各写一份构词法,url() 会引用到不存在的 id,
    // 而那个失败是**静默**的(filter 解析为无效 → 不上色、不报错)。
    for (const mode of FILTER_MODES) {
      for (const intensity of [0, 37, 100]) {
        expect(filterCssValue(mode, intensity)).toBe(
          `url("#${svgFilterId(mode, intensity)}")`,
        );
      }
    }
  });

  it('矩阵系数仍单一真相源:filterMatrixValues === colorMatrixToValues∘toColorMatrix', () => {
    for (const mode of FILTER_MODES) {
      for (const intensity of [0, 70, 100]) {
        expect(filterMatrixValues(mode, intensity)).toBe(
          colorMatrixToValues(toColorMatrix(mode, intensity)),
        );
      }
    }
  });

  it('🔴 parseFilterCssValue 是 filterCssValue 的逆 —— 往返无损(404 组合全查)', () => {
    // 注入层靠这个逆函数在**唯一的 DOM 写入点**把 (mode,intensity) 解回来,
    // 从而知道要建哪个 <filter>。往返一旦有损,就会建错/不建节点 → 静默失效。
    for (const mode of FILTER_MODES) {
      for (let intensity = 0; intensity <= 100; intensity += 1) {
        const round = parseFilterCssValue(filterCssValue(mode, intensity));
        expect(round, `${mode}@${intensity} 无法还原`).toEqual({
          mode,
          intensity,
        });
      }
    }
  });

  it('parseFilterCssValue 对非本扩展的值返回 null,不抛异常', () => {
    for (const bogus of [
      'grayscale(1)',
      'url("#other-thing")',
      'url("data:image/svg+xml,<svg/>#f")',
      'none',
      '',
      'url("#ccf-gray-101")', // 越界强度
      'url("#ccf-nosuchmode-50")',
    ]) {
      expect(parseFilterCssValue(bogus), bogus).toBeNull();
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
