/**
 * ADR-019 / ADR-045 · 图标两态。
 *
 * §6 T5 gate 逐字:「图标两态正确:有规则生效→亮,无规则命中→灰,
 * 主开关 OFF→全灰(ADR-019)」。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  type FilterRule,
  type FilterSettings,
  defaultSettings,
} from '../../domain/index.js';
import {
  ICON_PATHS,
  ICON_SIZES,
  iconPathsFor,
  iconStateFor,
} from '../icon-state.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function rule(pattern: string, intensity = 100): FilterRule {
  return { pattern, mode: 'Grayscale', intensity };
}

function settingsWith(rules: FilterRule[], masterEnabled = true): FilterSettings {
  return { ...defaultSettings(), masterEnabled, rules };
}

describe('ADR-019 · 有规则生效 → 亮', () => {
  it('命中规则且强度 > 0 → active', () => {
    expect(iconStateFor(settingsWith([rule('weibo.com')]), 'https://weibo.com/u/1')).toBe(
      'active',
    );
  });

  it('通配规则命中同样 → active', () => {
    expect(iconStateFor(settingsWith([rule('*.sina.com')]), 'https://news.sina.com/a')).toBe(
      'active',
    );
  });
});

describe('ADR-019 · 无规则命中 → 灰', () => {
  it('规则列表非空但本页不命中 → inactive', () => {
    expect(iconStateFor(settingsWith([rule('weibo.com')]), 'https://zhihu.com/')).toBe(
      'inactive',
    );
  });

  it('规则列表为空 → inactive', () => {
    expect(iconStateFor(settingsWith([]), 'https://weibo.com/')).toBe('inactive');
  });
});

describe('🔴 ADR-019 + INV-8 · 主开关 OFF → 全灰', () => {
  it('即使规则命中,主开关 OFF 也判灰', () => {
    const s = settingsWith([rule('*')], false);
    for (const url of [
      'https://weibo.com/',
      'https://zhihu.com/',
      'https://news.ycombinator.com/',
    ]) {
      expect(iconStateFor(s, url), url).toBe('inactive');
    }
  });
});

describe('🔴 「是否**实际生效**」而非「是否有规则」(§6 T5 spec 的措辞)', () => {
  it('命中规则但强度 0 → inactive(像素完全没变,ADR-019「亮 = 这页被改色了」)', () => {
    expect(iconStateFor(settingsWith([rule('a.com', 0)]), 'https://a.com/')).toBe(
      'inactive',
    );
  });

  it('强度 1 即判亮(边界:>0 就是改色了)', () => {
    expect(iconStateFor(settingsWith([rule('a.com', 1)]), 'https://a.com/')).toBe('active');
  });

  it('首个命中者强度 0、后面有强度 100 的同样命中者 → 仍 inactive(INV-6:只有首个生效)', () => {
    const s = settingsWith([rule('a.com', 0), rule('a.com', 100)]);
    expect(iconStateFor(s, 'https://a.com/')).toBe('inactive');
  });
});

describe('ADR-013 · 不可注入页面 → 灰', () => {
  it('四类不可注入 URL 一律 inactive,即使有 `*` 规则', () => {
    const s = settingsWith([rule('*')]);
    for (const url of [
      'chrome://settings',
      'https://chromewebstore.google.com/',
      'https://example.com/a.pdf',
      'chrome://newtab/',
      'file:///x.html',
      '',
      null,
      undefined,
    ]) {
      expect(iconStateFor(s, url), String(url)).toBe('inactive');
    }
  });
});

describe('ADR-045 · 两态必须是不同的图片资源', () => {
  it('路径表覆盖四个尺寸,两态路径互不相同', () => {
    for (const size of ICON_SIZES) {
      const a = ICON_PATHS.active[String(size)];
      const i = ICON_PATHS.inactive[String(size)];
      expect(a).toBeDefined();
      expect(i).toBeDefined();
      expect(a).not.toBe(i);
    }
  });

  it('🔴 路径表指向的文件真实存在于 public/(写错会让 setIcon 静默失败)', () => {
    for (const state of ['active', 'inactive'] as const) {
      for (const size of ICON_SIZES) {
        const rel = ICON_PATHS[state][String(size)];
        expect(rel).toBeDefined();
        const file = resolve(ROOT, 'public', rel as string);
        expect(existsSync(file), `缺少 ${file}`).toBe(true);
      }
    }
  });

  it('🔴 两态的文件内容不相同(否则 ADR-019 等于没实现)', () => {
    for (const size of ICON_SIZES) {
      const hash = (state: 'active' | 'inactive'): string =>
        createHash('sha256')
          .update(readFileSync(resolve(ROOT, 'public', ICON_PATHS[state][String(size)] as string)))
          .digest('hex');
      expect(hash('active')).not.toBe(hash('inactive'));
    }
  });

  it('iconPathsFor 返回对应态的表', () => {
    expect(iconPathsFor('active')).toBe(ICON_PATHS.active);
    expect(iconPathsFor('inactive')).toBe(ICON_PATHS.inactive);
  });
});
