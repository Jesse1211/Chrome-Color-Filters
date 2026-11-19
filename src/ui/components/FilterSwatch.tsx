/**
 * 滤镜色块 + 名称(§5.2 / **ADR-030**)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **本组件是 ADR-030 的渲染侧强制点。**
 *
 * > 红绿与绿红的色块对红绿色盲用户**无法分辨** —— 而他们正是这两个滤镜的目标用户。
 * > 因此色块**绝不可单独承载语义**,必须始终与文字名称并列出现。
 * > 任何「只有色块没有文字」的位置都是缺陷。
 *
 * 故本组件**不提供**「只渲染色块」的开关、prop 或变体。
 * 要色块就一并拿到名称 —— 这是刻意设计的、无法绕开的耦合。
 * T6b / T6c 复用本组件,同样受此约束。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import { type FilterMode } from '../../domain/filter-mode.js';
import { filterIdentity, swatchGradient } from '../filter-identity.js';

export interface FilterSwatchProps {
  readonly mode: FilterMode;
}

export function FilterSwatch({ mode }: FilterSwatchProps) {
  const identity = filterIdentity(mode);

  return (
    <span className="swatch-pair" data-testid="swatch-pair" data-mode={mode}>
      {/*
        色块本身对辅助技术是装饰性的(语义由紧邻的名称承载,ADR-030),
        故 aria-hidden —— 屏幕阅读器不会把一个无文字的渐变读成重复信息。
      */}
      <span
        className="swatch"
        data-testid="swatch"
        aria-hidden="true"
        style={{ background: swatchGradient(mode) }}
      />
      <span className="swatch-pair__name" data-testid="swatch-name">
        {identity.name}
      </span>
    </span>
  );
}
