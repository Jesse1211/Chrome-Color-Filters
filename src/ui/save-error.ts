/**
 * 把仓储层的结构化写入错误(ADR-046)映射为顶部红色报错条的内容。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **`kind: 'locked'` 绝不触发红色报错条。**
 *
 * `src/storage/errors.ts` 已把这条写进文档并由 T3 gate 的 I1 澄清:
 * > 锁定拒绝**不是故障**,是设计中的预期行为。
 * > 若落入 `other`,UI 会弹出红色「保存失败」条并建议「请删除几条规则后重试」——
 * > 而锁定期间根本删不了。对一次预期内的拒绝报错是虚假警报。
 *
 * 锁定态的呈现由 **T6c** 负责(倒计时条),不在 T6a 范围内。
 * 本模块对 `locked` 返回 `null`,即「不显示报错条」。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import { type WriteError } from '../storage/errors.js';
import { SAVE_FAILED_PREFIX } from './strings.js';

export interface SaveErrorBanner {
  /** 「保存失败:{原因}」(§5.4 第五种状态变体)。 */
  readonly text: string;
  /** 可操作建议 —— ADR-046 要求报错条带「可操作建议」,而非只报坏消息。 */
  readonly advice: string;
}

/**
 * ADR-046 / §5.4:
 * > 顶部**红色**报错条:「保存失败:{原因}」+ 可操作建议(如「请删除几条规则后重试」)。
 * > 规则列表照常显示,用户仍可删除以腾出空间。
 *
 * @returns `null` 表示**不显示**报错条(锁定拒绝,见文件头)。
 */
export function toSaveErrorBanner(error: WriteError): SaveErrorBanner | null {
  if (error.kind === 'locked') return null;

  return {
    text: `${SAVE_FAILED_PREFIX}${error.message}`,
    advice: adviceFor(error),
  };
}

/**
 * 可操作建议。
 *
 * 原则:建议必须是**用户在当前 UI 里真能做到的动作**。
 * 容量与配额都可以靠「删几条」解决 —— §5.4 明确「规则列表照常显示,
 * 用户仍可删除以腾出空间」,所以这条建议在列表视图里恒可执行。
 */
function adviceFor(error: WriteError): string {
  if (error.kind === 'quota' || error.reason === 'capacity-exceeded') {
    return '请删除几条规则后重试。';
  }
  if (error.reason === 'invalid-input') {
    return '请检查网址模式后重试。';
  }
  return '设置未被写入,请重试;若反复失败,请删除几条规则后再试。';
}
