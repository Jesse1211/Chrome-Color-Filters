/**
 * 扩展图标程序生成脚本(ADR-045)。
 *
 * 生成两套图标,各含 16/32/48/128 px:
 *   - 生效态 (public/icon/active/<size>.png)  : 半黑半灰的圆角方块(设计稿 ◧ 标识),高对比
 *   - 未生效态 (public/icon/inactive/<size>.png): 全灰 + 降透明度
 *
 * ADR-045 要求两态必须是**不同的图片资源**,否则 ADR-019 的两态图标等于没实现。
 *
 * 实现说明:
 *   本脚本内部用「SVG 语义 → 自绘栅格」的方式产出 PNG,不引入 sharp/resvg 这类
 *   原生依赖 —— 图形是两个圆角矩形,解析一个完整 SVG 渲染器纯属过度工程。
 *   栅格化带 4x4 超采样抗锯齿,PNG 用 Node 内置 zlib 编码,输出完全确定性
 *   (同输入恒同字节),便于把产物提交进仓库并在门禁中断言 hash。
 *
 * 用法: npm run icons
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const ICON_SIZES = [16, 32, 48, 128];

/** 两态的视觉定义。颜色对齐 §5.2 的滤镜标识语义:左深右浅的双色方块。 */
export const ICON_VARIANTS = {
  /** 生效态:半黑半灰,高对比,完全不透明。 */
  active: {
    left: [0x17, 0x1a, 0x1d],
    right: [0xb8, 0xbd, 0xc4],
    alpha: 1,
  },
  /** 未生效态:全灰(左右同色,无对比)+ 降透明度。 */
  inactive: {
    left: [0x8a, 0x8f, 0x96],
    right: [0x8a, 0x8f, 0x96],
    alpha: 0.45,
  },
};

const SS = 4; // 超采样倍率

/** 圆角方块的覆盖判定(单位坐标系 0..1)。 */
function insideRoundedSquare(x, y, inset, radius) {
  const min = inset;
  const max = 1 - inset;
  if (x < min || x > max || y < min || y > max) return false;
  const cxs = [min + radius, max - radius];
  const cys = [min + radius, max - radius];
  const nx = x < cxs[0] ? cxs[0] : x > cxs[1] ? cxs[1] : x;
  const ny = y < cys[0] ? cys[0] : y > cys[1] ? cys[1] : y;
  const dx = x - nx;
  const dy = y - ny;
  return dx * dx + dy * dy <= radius * radius;
}

/** 栅格化一个图标变体为 RGBA buffer。 */
export function rasterize(size, variant) {
  const { left, right, alpha } = variant;
  const inset = 0.0625; // 1/16 边距
  const radius = 0.1875; // 相对半径,视觉上的圆角方块
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let cov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (pxi + (sx + 0.5) / SS) / size;
          const uy = (py + (sy + 0.5) / SS) / size;
          if (!insideRoundedSquare(ux, uy, inset, radius)) continue;
          const c = ux < 0.5 ? left : right;
          rs += c[0];
          gs += c[1];
          bs += c[2];
          cov += 1;
        }
      }
      const i = (py * size + pxi) * 4;
      const total = SS * SS;
      if (cov === 0) {
        px[i] = 0;
        px[i + 1] = 0;
        px[i + 2] = 0;
        px[i + 3] = 0;
      } else {
        px[i] = Math.round(rs / cov);
        px[i + 1] = Math.round(gs / cov);
        px[i + 2] = Math.round(bs / cov);
        px[i + 3] = Math.round((cov / total) * alpha * 255);
      }
    }
  }
  return px;
}

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** 把 RGBA buffer 编码为 PNG。确定性输出:同输入恒同字节。 */
export function encodePng(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter type 0 (None)
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 生成对应变体与尺寸的 SVG 源(留档用,便于人工核对几何定义)。 */
export function toSvg(variant) {
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const inset = 6.25;
  const side = 100 - inset * 2;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
    `  <g opacity="${variant.alpha}">`,
    `    <clipPath id="r"><rect x="${inset}" y="${inset}" width="${side}" height="${side}" rx="18.75" ry="18.75"/></clipPath>`,
    `    <g clip-path="url(#r)">`,
    `      <rect x="0" y="0" width="50" height="100" fill="${hex(variant.left)}"/>`,
    `      <rect x="50" y="0" width="50" height="100" fill="${hex(variant.right)}"/>`,
    '    </g>',
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}

function main() {
  for (const [name, variant] of Object.entries(ICON_VARIANTS)) {
    const dir = resolve(ROOT, 'public/icon', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'icon.svg'), toSvg(variant));
    for (const size of ICON_SIZES) {
      const png = encodePng(size, rasterize(size, variant));
      writeFileSync(resolve(dir, `${size}.png`), png);
      process.stdout.write(`wrote public/icon/${name}/${size}.png (${png.length} bytes)\n`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
