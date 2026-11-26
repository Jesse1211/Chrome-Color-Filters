/**
 * 项目级门禁(ADR-037 / ADR-039 / ADR-040 / ADR-045 / ADR-047)。
 *
 * 这些是 T1 gate 里「一条 grep」级别的硬性检查,放在测试里以便持续生效 ——
 * 否则后续任务很容易在不经意间把它们破坏掉。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

// 从 PNG 中取出所有 IDAT chunk 并解压,得到原始像素字节。
// PNG = 8 字节签名 + 若干 chunk(4 字节长度 + 4 字节类型 + data + 4 字节 CRC)。
function pngPixels(buf: Buffer): Buffer {
  let off = 8;
  const parts: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') parts.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  return inflateSync(Buffer.concat(parts));
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(
  readFileSync(resolve(ROOT, 'package.json'), 'utf8'),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
const wxtConfigSource = readFileSync(resolve(ROOT, 'wxt.config.ts'), 'utf8');

describe('ADR-037 · WXT 版本精确锁定', () => {
  it('package.json 中 wxt 为精确值,无 ^ 或 ~', () => {
    const version = allDeps.wxt;
    expect(version).toBeDefined();
    expect(version).not.toMatch(/[\^~]/);
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('ADR-040 · 不使用 CRXJS', () => {
  it('package.json 不含任何 @crxjs/* 依赖', () => {
    const crxjs = Object.keys(allDeps).filter((d) => d.startsWith('@crxjs/'));
    expect(crxjs).toEqual([]);
  });
});

describe('ADR-047 · 首版仅中文,不做 i18n', () => {
  it('package.json 不含 i18n 依赖', () => {
    for (const banned of ['react-i18next', 'i18next', 'react-intl']) {
      expect(Object.keys(allDeps)).not.toContain(banned);
    }
  });

  it('无 _locales/ 目录', () => {
    expect(existsSync(resolve(ROOT, '_locales'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'public/_locales'))).toBe(false);
  });
});

describe('ADR-039 · 关闭 auto-imports', () => {
  it('wxt.config.ts 中 imports: false', () => {
    expect(wxtConfigSource).toMatch(/imports:\s*false/);
  });
});

describe('ADR-004 / ADR-010 · 权限声明', () => {
  it('wxt.config.ts 声明 host_permissions: <all_urls>', () => {
    expect(wxtConfigSource).toMatch(/host_permissions:\s*\['<all_urls>'\]/);
  });

  it('wxt.config.ts 声明 permissions: storage(非 sync)', () => {
    expect(wxtConfigSource).toMatch(/permissions:\s*\[[^\]]*'storage'/);
  });

  it("🔴 ADR-062 前提 · wxt.config.ts 声明 permissions 含 'scripting'", () => {
    // `scripting` 是声明式注册(ADR-062)的前提 —— 漏了所有
    // registerContentScripts 调用都会失败,且失败表现是「滤镜静默不生效」,
    // 排障成本极高。它**不增加任何用户可见的权限警告**(DESIGN.md §6 第 3 条)。
    expect(wxtConfigSource).toMatch(/permissions:\s*\[[^\]]*'scripting'/);
  });

  it("🔴🔒 ADR-077 前提 · wxt.config.ts 声明 permissions 含 'alarms'", () => {
    // `alarms` 是到期自动关闭的前提(ADR-077):必须在**到期那一刻**真的
    // 发生一次写入,即使 popup 没开、SW 已休眠。
    // `setTimeout` 不可靠 —— MV3 的 SW 随时会被回收。
    expect(wxtConfigSource).toMatch(/permissions:\s*\[[^\]]*'alarms'/);
  });

  it('🔴🔒 ADR-077 · 到期触发器不得用 setTimeout / setInterval(SW 会被回收)', () => {
    // 这是一条**静态**门禁:`setTimeout(…, 3600_000)` 会随 SW 一起消失,
    // 它不是一个更简单的方案,而是一个**不工作**的方案。
    // 剥去注释后检查 —— 文件头正是在论证「为什么不能用它」,那段该留着。
    const source = readFileSync(
      resolve(ROOT, 'src/background/lock-expiry.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(source).not.toContain('setTimeout');
    expect(source).not.toContain('setInterval');
  });

  it('🔴🔒 ADR-077 · 自动关闭的判定与写入只在仓储层(UI/SW 不得自己写 masterEnabled)', () => {
    // INV-14 / ADR-055:锁定强制点在仓储层。到期自动关闭是一个**新的**
    // 会写 masterEnabled 的路径,故这里静态钉住:
    // 触发器(SW 侧与 popup 侧)都**不出现** `masterEnabled` 的赋值,
    // 它们只调仓储层的 `applyExpiryAutoOff()`。
    for (const rel of ['src/background/lock-expiry.ts', 'src/ui/useLockExpiry.ts']) {
      const source = readFileSync(resolve(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      expect(source, `${rel} 不得自己写 masterEnabled`).not.toMatch(
        /masterEnabled\s*[:=]/,
      );
      expect(source, `${rel} 不得绕过仓储层直接碰 storage`).not.toContain(
        'chrome.storage',
      );
    }
  });

  it('🔴 ADR-010 · 未声明任何 sync 相关权限', () => {
    expect(wxtConfigSource).not.toContain('storage.sync');
  });
});

describe('INV-3 前提 · content script run_at', () => {
  it('entrypoints/content.ts 配置 runAt: document_start', () => {
    const source = readFileSync(resolve(ROOT, 'entrypoints/content.ts'), 'utf8');
    expect(source).toMatch(/runAt:\s*'document_start'/);
    expect(source).toMatch(/matches:\s*\['<all_urls>'\]/);
  });
});

describe('ADR-045 · 扩展图标两态,必须是不同的图片资源', () => {
  const SIZES = [16, 32, 48, 128];
  const variantDir = (v: string) => resolve(ROOT, 'public/icon', v);

  it('两态各 4 个尺寸共 8 个 PNG 已提交', () => {
    for (const variant of ['active', 'inactive']) {
      for (const size of SIZES) {
        const file = resolve(variantDir(variant), `${size}.png`);
        expect(existsSync(file), `缺少 ${file}`).toBe(true);
      }
    }
  });

  it('产物是真正的 PNG(魔数校验),且尺寸正确', () => {
    for (const variant of ['active', 'inactive']) {
      for (const size of SIZES) {
        const buf = readFileSync(resolve(variantDir(variant), `${size}.png`));
        expect(Array.from(buf.subarray(0, 8))).toEqual([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]);
        // IHDR 紧跟文件头:宽、高各 4 字节大端。
        expect(buf.readUInt32BE(16)).toBe(size);
        expect(buf.readUInt32BE(20)).toBe(size);
      }
    }
  });

  it('🔴 两态的文件内容不相同(断言 hash 不等)', () => {
    for (const size of SIZES) {
      const hash = (variant: string) =>
        createHash('sha256')
          .update(readFileSync(resolve(variantDir(variant), `${size}.png`)))
          .digest('hex');
      expect(
        hash('active'),
        `${size}px 的两态图标内容相同 —— ADR-019 等于没实现`,
      ).not.toBe(hash('inactive'));
    }
  });

  it('manifest 已注册图标', () => {
    for (const size of SIZES) {
      expect(wxtConfigSource).toContain(`icon/inactive/${size}.png`);
    }
  });

  it('WXT 模板自带的占位图标已被移除(不拿占位图通过门禁)', () => {
    expect(existsSync(resolve(ROOT, 'public/wxt.svg'))).toBe(false);
    const iconRoot = resolve(ROOT, 'public/icon');
    const strays = readdirSync(iconRoot).filter((e) => e.endsWith('.png'));
    expect(strays).toEqual([]);
  });

  it('图标生成脚本存在且可重入(ADR-045:程序生成)', async () => {
    const scriptPath = resolve(ROOT, 'scripts/generate-icons.mjs');
    expect(existsSync(scriptPath)).toBe(true);
    const mod = (await import(scriptPath)) as {
      rasterize: (size: number, v: unknown) => Buffer;
      encodePng: (size: number, rgba: Buffer) => Buffer;
      ICON_VARIANTS: Record<string, unknown>;
    };
    // 重新生成一次,必须与仓库里已提交的产物像素一致(确定性栅格化)。
    // 注意:不能比较压缩后的字节 —— encodePng 用 deflateSync 压缩,
    // deflate 的输出字节取决于 zlib 版本,不取决于本项目代码,换一台
    // 机器/换一个 Node 版本就可能字节不同。比较解压后的像素数据才是
    // 真正钉住栅格化逻辑本身的断言。
    for (const [variant, def] of Object.entries(mod.ICON_VARIANTS)) {
      for (const size of SIZES) {
        const regenerated = mod.encodePng(size, mod.rasterize(size, def));
        const committed = readFileSync(
          resolve(variantDir(variant), `${size}.png`),
        );
        expect(
          pngPixels(regenerated).equals(pngPixels(committed)),
          `public/icon/${variant}/${size}.png 的像素数据与生成脚本的输出不一致`,
        ).toBe(true);
      }
    }
  });
});

describe('ADR-036 · 目录结构', () => {
  it('src/domain、src/storage、src/ui 均存在', () => {
    for (const dir of ['src/domain', 'src/storage', 'src/ui']) {
      expect(existsSync(resolve(ROOT, dir)), `缺少 ${dir}`).toBe(true);
    }
  });

  it('entrypoints 下有 popup / content.ts / background.ts', () => {
    expect(existsSync(resolve(ROOT, 'entrypoints/popup'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'entrypoints/content.ts'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'entrypoints/background.ts'))).toBe(true);
  });
});
