/**
 * 色彩矩阵门禁(ADR-002 / ADR-003 / ADR-025)。
 */
import { describe, expect, it } from 'vitest';
import { FILTER_MODES, type FilterMode } from '../filter-mode.js';
import { colorMatrixToValues, toColorMatrix } from '../color-matrix.js';

const INTENSITIES = [0, 1, 50, 99, 100];

const IDENTITY_MATRIX = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

describe('toColorMatrix · 四种 mode × intensity ∈ {0,1,50,99,100}', () => {
  it.each(
    FILTER_MODES.flatMap((mode) =>
      INTENSITIES.map((intensity) => [mode, intensity] as const),
    ),
  )('%s @ %i 产出合法矩阵,无 NaN / 越界', (mode, intensity) => {
    const m = toColorMatrix(mode, intensity);
    expect(m).toHaveLength(20);
    for (const n of m) {
      expect(Number.isFinite(n)).toBe(true);
      expect(Number.isNaN(n)).toBe(false);
      // feColorMatrix 系数无硬性值域,但合理实现不应出现数量级失控。
      expect(Math.abs(n)).toBeLessThanOrEqual(10);
    }
  });

  it.each(FILTER_MODES.map((m) => [m] as const))(
    '%s @ intensity=0 等价于恒等变换(视觉无变化)',
    (mode) => {
      expect(Array.from(toColorMatrix(mode, 0))).toEqual(IDENTITY_MATRIX);
    },
  );

  it.each(
    FILTER_MODES.flatMap((mode) =>
      INTENSITIES.map((intensity) => [mode, intensity] as const),
    ),
  )('%s @ %i 保持 alpha 通道恒等(INV-1:绝不改透明度)', (mode, intensity) => {
    const m = toColorMatrix(mode, intensity);
    expect(Array.from(m.slice(15))).toEqual([0, 0, 0, 1, 0]);
  });

  it.each(FILTER_MODES.map((m) => [m] as const))(
    '%s @ 满强度把白色映射为白色(不给页面引入整体色偏)',
    (mode) => {
      const m = toColorMatrix(mode, 100);
      const coef = (i: number): number => m[i] ?? NaN;
      const rowSum = (r: number) => coef(r * 5) + coef(r * 5 + 1) + coef(r * 5 + 2);
      for (const r of [0, 1, 2]) {
        expect(rowSum(r)).toBeCloseTo(1, 5);
      }
    },
  );

  it('Grayscale @ 100 使用 Rec. BT.709 亮度系数(与 CSS grayscale(1) 一致)', () => {
    const m = toColorMatrix('Grayscale', 100);
    for (const r of [0, 1, 2]) {
      expect(m[r * 5]).toBeCloseTo(0.2126, 6);
      expect(m[r * 5 + 1]).toBeCloseTo(0.7152, 6);
      expect(m[r * 5 + 2]).toBeCloseTo(0.0722, 6);
    }
  });

  it('Grayscale @ 100 把任意颜色映射为三通道相等的灰(maxChannelSpread = 0)', () => {
    const m = toColorMatrix('Grayscale', 100);
    const coef = (i: number): number => m[i] ?? NaN;
    const apply = (rgb: readonly [number, number, number]) =>
      [0, 1, 2].map(
        (r) =>
          coef(r * 5) * rgb[0] +
          coef(r * 5 + 1) * rgb[1] +
          coef(r * 5 + 2) * rgb[2],
      );
    for (const rgb of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.3, 0.6, 0.9],
    ] as const) {
      const out = apply(rgb);
      expect(Math.max(...out) - Math.min(...out)).toBeCloseTo(0, 10);
    }
  });

  it('色觉辅助模式彼此不同,也不同于 Grayscale(ADR-002:四选一互斥)', () => {
    const seen = new Map<string, FilterMode>();
    for (const mode of FILTER_MODES) {
      const key = colorMatrixToValues(toColorMatrix(mode, 100));
      expect(seen.has(key)).toBe(false);
      seen.set(key, mode);
    }
    expect(seen.size).toBe(FILTER_MODES.length);
  });

  it('中间强度在恒等与满强度之间单调插值', () => {
    const full = toColorMatrix('Grayscale', 100);
    const half = toColorMatrix('Grayscale', 50);
    expect(half[1]).toBeCloseTo((0 + full[1]) / 2, 6);
    expect(half[0]).toBeCloseTo((1 + full[0]) / 2, 6);
  });
});

describe('toColorMatrix · 纯函数(ADR-025)', () => {
  it('同输入恒同输出', () => {
    for (const mode of FILTER_MODES) {
      for (const intensity of INTENSITIES) {
        const a = toColorMatrix(mode, intensity);
        const b = toColorMatrix(mode, intensity);
        expect(Array.from(a)).toEqual(Array.from(b));
      }
    }
  });

  it('返回新数组 —— 调用方修改结果不污染后续调用(无共享可变状态)', () => {
    const first = toColorMatrix('Grayscale', 100) as unknown as number[];
    const snapshot = Array.from(first);
    first[0] = 999;
    expect(Array.from(toColorMatrix('Grayscale', 100))).toEqual(snapshot);
  });

  it('越界 / 非法 intensity 被安全收敛,不抛异常', () => {
    expect(Array.from(toColorMatrix('Grayscale', -50))).toEqual(IDENTITY_MATRIX);
    expect(Array.from(toColorMatrix('Grayscale', 9999))).toEqual(
      Array.from(toColorMatrix('Grayscale', 100)),
    );
    expect(() =>
      toColorMatrix('Grayscale', NaN as unknown as number),
    ).not.toThrow();
  });
});

describe('colorMatrixToValues', () => {
  it('序列化为 20 个以空格分隔的数值', () => {
    const s = colorMatrixToValues(toColorMatrix('RedGreen', 100));
    expect(s.split(' ')).toHaveLength(20);
    expect(s).not.toContain('NaN');
  });
});
