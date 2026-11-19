/**
 * `ColorMatrix` —— 由 `(mode, intensity)` 纯函数算出的派生值(ADR-025)。
 *
 * **不持久化**:持久化会产生可漂移的双份真相(ADR-025)。
 *
 * 产出的是 SVG `feColorMatrix` 的 20 个系数(4 行 × 5 列,row-major):
 *
 * ```
 * R' = m[0]*R  + m[1]*G  + m[2]*B  + m[3]*A  + m[4]
 * G' = m[5]*R  + m[6]*G  + m[7]*B  + m[8]*A  + m[9]
 * B' = m[10]*R + m[11]*G + m[12]*B + m[13]*A + m[14]
 * A' = m[15]*R + m[16]*G + m[17]*B + m[18]*A + m[19]
 * ```
 *
 * 纯 TypeScript —— 零 React / 零 chrome.* / 零 wxt(ADR-036)。
 *
 * ---
 *
 * ## 系数来源(spec 要求:不得随手捏造)
 *
 * **Grayscale** —— Rec. ITU-R BT.709-6《Parameter values for the HDTV standards
 * for production and international programme exchange》的亮度系数
 * `Y' = 0.2126 R' + 0.7152 G' + 0.0722 B'`。
 * 这也是 CSS Filter Effects Module Level 1 §8.5 为 `grayscale()` 规定的矩阵,
 * 与浏览器原生 `filter: grayscale()` 完全一致。
 * https://www.w3.org/TR/filter-effects-1/#grayscaleEquivalent
 *
 * **RedGreen / GreenRed / BlueYellow** —— 色觉**辅助**(daltonization)矩阵,
 * 建立在 Machado、Oliveira & Fernandes 的色觉模型之上:
 *
 * > G. M. Machado, M. M. Oliveira, L. A. F. Fernandes,
 * > "A Physiologically-based Model for Simulation of Color Vision Deficiency",
 * > IEEE Transactions on Visualization and Computer Graphics, 16(6):1291–1298, 2010.
 * > https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
 *
 * 该论文给出了 protanomaly / deuteranomaly / tritanomaly 在严重度 1.0 时的
 * **模拟**矩阵(下方 `SIMULATE_*`,数值逐字取自论文配套的严重度 1.0 表)。
 * 本扩展要做的不是模拟缺陷,而是**辅助辨色**,故采用业界标准的
 * daltonization 流程(Fidaner, Lin & Ozguven 的公开方法,其矩阵级形式
 * 被 Chrome/Android 等无障碍实现广泛采用):
 *
 * > O. Fidaner, P. Lin, N. Ozguven, "Analysis of Color Blindness",
 * > Stanford University EE368 project report.
 * > http://scien.stanford.edu/pages/labsite/2005/psych221/projects/05/ofidaner/project_report.pdf
 *
 * 流程:`误差 = 原色 − 模拟色`,再把误差**按固定权重重分配到可辨通道**,
 * 叠加回原色。该流程在矩阵层面可完全展开为一个 3×3 线性变换
 * (见 `DALTONIZE_SHIFT`),因此可以零成本地塞进 feColorMatrix,
 * 不需要逐像素 JS —— 这是 INV-1(UI 零影响)所必需的,
 * 任何逐像素处理都要碰页面内容,与 ADR-026 的隐私底线相悖。
 *
 * 三种模式的含义:
 * - `RedGreen`  (protanomaly 辅助):红锥不敏感者。把红绿误差推向**蓝/亮度**通道。
 * - `GreenRed`  (deuteranomaly 辅助):绿锥不敏感者。误差重分配方向与上相反。
 * - `BlueYellow`(tritanomaly 辅助):蓝锥不敏感者。把蓝黄误差推向**红绿**通道。
 *
 * ADR-030 已记录:红绿/绿红两个模式对部分用户难以分辨,故 UI 中色块
 * 必须始终与文字名称并列出现 —— 那是 T6 的职责,不影响本矩阵。
 */

import {
  type Intensity,
  intensityFraction,
} from './intensity.js';
import { type FilterMode } from './filter-mode.js';

/** feColorMatrix 的 20 个系数(4×5,row-major)。 */
export type ColorMatrix = readonly [
  number, number, number, number, number,
  number, number, number, number, number,
  number, number, number, number, number,
  number, number, number, number, number,
];

/** 3×3 线性 RGB 变换(row-major),矩阵运算的内部表示。 */
type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/** 恒等变换。intensity = 0 时必须等价于它(视觉无变化)。 */
const IDENTITY_3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Rec. ITU-R BT.709-6 亮度系数,亦即 CSS `grayscale(1)` 的等价矩阵
 * (W3C Filter Effects Level 1 §8.5)。
 */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

const GRAYSCALE_3: Mat3 = [
  LUMA_R, LUMA_G, LUMA_B,
  LUMA_R, LUMA_G, LUMA_B,
  LUMA_R, LUMA_G, LUMA_B,
];

/**
 * Machado et al. (2010) 严重度 1.0 的色觉缺陷**模拟**矩阵。
 * 数值逐字取自论文配套数据表(见文件头引用)。
 */
const SIMULATE_PROTANOPIA: Mat3 = [
  0.152286, 1.052583, -0.204868,
  0.114503, 0.786281, 0.099216,
  -0.003882, -0.048116, 1.051998,
];

const SIMULATE_DEUTERANOPIA: Mat3 = [
  0.367322, 0.860646, -0.227968,
  0.280085, 0.672501, 0.047413,
  -0.011820, 0.042940, 0.968881,
];

const SIMULATE_TRITANOPIA: Mat3 = [
  1.255528, -0.076749, -0.178779,
  -0.078411, 0.930809, 0.147602,
  0.004733, 0.691367, 0.303900,
];

/**
 * Daltonization 的误差重分配权重(Fidaner/Lin/Ozguven)。
 * 行 = 输出通道,列 = 误差通道。误差 `e = I − sim(I)` 经此矩阵后叠加回 `I`。
 *
 * 红绿类(protan/deutan):误差集中在 R/G,推向 G 与 B —— 蓝通道对这两类
 * 用户都是完好的,是唯一可靠的信息载体。
 */
const SHIFT_RED_GREEN: Mat3 = [
  0, 0, 0,
  0.7, 1, 0,
  0.7, 0, 1,
];

/** 绿红类:与上相反的重分配方向,使两个模式在视觉上可区分(ADR-002:四选一互斥)。 */
const SHIFT_GREEN_RED: Mat3 = [
  1, 0.7, 0,
  0, 0, 0,
  0, 0.7, 1,
];

/** 蓝黄类(tritan):误差集中在 B/Y,推向 R 与 G。 */
const SHIFT_BLUE_YELLOW: Mat3 = [
  1, 0, 0.7,
  0, 1, 0.7,
  0, 0, 0,
];

/**
 * 逐元素构造 Mat3。
 *
 * 下标 0..8 在 `Mat3` 这个定长元组类型上都是已定义的,
 * 用显式的 9 元组字面量构造可以让 `noUncheckedIndexedAccess`
 * 在不加任何 `as` 断言的前提下通过 —— 类型安全不靠断言糊过去。
 */
function at(m: Mat3, index: number): number {
  // Mat3 是定长 9 元组,调用方传入的下标恒在 0..8 内(本文件内部使用)。
  // 用计算下标索引元组时 TS 会把类型放宽为 `number | undefined`,
  // 这里一次性把该不变式收口,避免在每个算式里散落断言。
  const v: number | undefined = m[index];
  if (v === undefined) {
    throw new RangeError(`Mat3 index out of range: ${index}`);
  }
  return v;
}

function buildMat3(fn: (index: number) => number): Mat3 {
  return [
    fn(0), fn(1), fn(2),
    fn(3), fn(4), fn(5),
    fn(6), fn(7), fn(8),
  ];
}

function mat3Multiply(a: Mat3, b: Mat3): Mat3 {
  return buildMat3((i) => {
    const r = Math.floor(i / 3);
    const c = i % 3;
    return (
      at(a, r * 3) * at(b, c) +
      at(a, r * 3 + 1) * at(b, 3 + c) +
      at(a, r * 3 + 2) * at(b, 6 + c)
    );
  });
}

function mat3Subtract(a: Mat3, b: Mat3): Mat3 {
  return buildMat3((i) => at(a, i) - at(b, i));
}

function mat3Add(a: Mat3, b: Mat3): Mat3 {
  return buildMat3((i) => at(a, i) + at(b, i));
}

/** 线性插值:`t = 0` 返回 `from`,`t = 1` 返回 `to`。 */
function mat3Lerp(from: Mat3, to: Mat3, t: number): Mat3 {
  return buildMat3((i) => at(from, i) + (at(to, i) - at(from, i)) * t);
}

/**
 * 构造 daltonization 的满强度变换:`D = I + shift · (I − sim)`。
 *
 * 推导:误差 `e = I·c − sim·c = (I − sim)·c`;
 * 重分配后叠加 `c' = I·c + shift·e = (I + shift·(I − sim))·c`。
 * 整个流程是线性的,故可折叠成单个 3×3 矩阵 —— 这正是它能跑在
 * feColorMatrix 里而不需要逐像素 JS 的原因(INV-1 / ADR-026)。
 */
function daltonize(simulate: Mat3, shift: Mat3): Mat3 {
  const error = mat3Subtract(IDENTITY_3, simulate);
  return mat3Add(IDENTITY_3, mat3Multiply(shift, error));
}

/** 四种模式在 intensity = 100 时的满强度 3×3 变换。 */
const FULL_STRENGTH: Readonly<Record<FilterMode, Mat3>> = {
  Grayscale: GRAYSCALE_3,
  RedGreen: daltonize(SIMULATE_PROTANOPIA, SHIFT_RED_GREEN),
  GreenRed: daltonize(SIMULATE_DEUTERANOPIA, SHIFT_GREEN_RED),
  BlueYellow: daltonize(SIMULATE_TRITANOPIA, SHIFT_BLUE_YELLOW),
};

/**
 * `toColorMatrix(mode, intensity)` —— 纯函数,产出 feColorMatrix 的 20 个系数。
 *
 * - **纯**:同输入恒同输出,无副作用,不读任何外部可变状态(ADR-025)。
 * - `intensity === 0` 时结果**等价于恒等变换**(视觉无变化)—— 由
 *   `mat3Lerp(IDENTITY_3, full, 0)` 保证,门禁明确要求。
 * - 中间强度按线性插值从恒等变换过渡到满强度变换。这与 CSS
 *   `grayscale(amount)` 的规定做法一致(W3C Filter Effects Level 1 §8.5
 *   正是以 `amount` 在恒等与满强度之间插值定义的),四种模式统一采用。
 * - alpha 通道保持恒等(第 4 行 `0,0,0,1,0`):绝不改透明度,
 *   否则页面的可见性会随滤镜变化,违反 INV-1。
 *
 * 返回的数组是新建的,调用方的修改不会影响后续调用。
 */
export function toColorMatrix(
  mode: FilterMode,
  intensity: Intensity,
): ColorMatrix {
  const full = FULL_STRENGTH[mode] ?? FULL_STRENGTH.Grayscale;
  const t = intensityFraction(intensity);
  const m = mat3Lerp(IDENTITY_3, full, t);

  return [
    m[0], m[1], m[2], 0, 0,
    m[3], m[4], m[5], 0, 0,
    m[6], m[7], m[8], 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** 把 ColorMatrix 序列化为 feColorMatrix 的 `values` 属性字符串。 */
export function colorMatrixToValues(matrix: ColorMatrix): string {
  return matrix.map((n) => formatCoefficient(n)).join(' ');
}

/** 固定小数位输出,避免浮点尾数污染 DOM 属性,且保证确定性。 */
function formatCoefficient(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}
