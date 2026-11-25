/**
 * 实时预览的**义务机**(**ADR-049** · DESIGN.md §5.7 / §6 T6b gate)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 本 hook 存在的全部理由是把两组**容易漏**的义务从组件里拿出来,
 * 变成一处可穷举、可断言的逻辑:
 *
 * ## A. 四种**不发送** `PREVIEW_FILTER` 的情况(F9/F11/I2)
 *
 * 主开关 OFF · 当前页不可注入 · 编辑的 pattern 不匹配当前页 · **锁定中**。
 * (这是 gate 逐字的四条;`PreviewBlockReason` 另有一个骨架态 `'skeleton'`,
 *  共**五**个成员 —— 见该类型的文档注释。)
 * 判定在 `computePreviewEligibility`(纯函数,封闭联合);
 * 本 hook 只负责「不可用就一条都不发」。
 *
 * ## B. 🔴 `PREVIEW_CLEAR` 的发送义务(B1)—— 四条
 *
 * | 触发 | 实现落点 |
 * |---|---|
 * | 点「返回」离开编辑视图 | 调用方在 `onBack` 里调 `clear()`(**popup 仍开着、端口未断,必须主动发**) |
 * | 点「保存」 | 调用方在保存成功后调 `clear()` |
 * | 点「删除」 | 调用方在删除后调 `clear()` |
 * | pattern 改到不再匹配当前页的**那一刻** | **本 hook 的 effect 自动发** |
 * | (追加)预览条件从可用变不可用 | 同上 —— 上一条是它的一个特例 |
 *
 * 前三条是**用户动作**,交给调用方显式调用:把它们藏进 effect 会让
 * 「保存成功了但写入失败」这类分支的时序变得不可推理。
 * 第四、五条是**状态变化**,没有任何用户动作可挂,只能由 effect 观测 ——
 * 这正是 DESIGN.md 所说「预览条件从可用变不可用」那一条。
 *
 * 📌 为什么 `clear()` 还要在 `unmount` 时再发一次:编辑视图卸载有两条路,
 *    一条是用户点返回/保存/删除(上表前三行),另一条是 **popup 被 Chrome
 *    销毁**(失焦即销毁)。后者走 `onDisconnect`,接收端已有兜底
 *    (`preview-receiver.ts`),但卸载时主动撤一次是零成本的双重保险,
 *    且让「返回」这条路在任何实现顺序下都不会漏 —— 见 `useEffect` 的清理。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { type FilterMode, type Intensity } from '../domain/index.js';
import { type PreviewChannel } from './preview-port.js';
import { type PreviewEligibility } from './pattern-status.js';

export interface UsePreviewOptions {
  readonly channel: PreviewChannel;
  readonly eligibility: PreviewEligibility;
}

export interface PreviewController {
  /** 预览此刻是否可用(§5.7:不可用时提示行置灰并改文案)。 */
  readonly available: boolean;
  /**
   * 推一帧预览。**不可用时直接返回,不发任何消息**(四种情况,spy 可断言)。
   *
   * 滑块的 `onChange`、滤镜单选、pattern 变更后都调它 —— 预览值是
   * `(mode, intensity)` 的函数,任一维度变了都该重推。
   */
  readonly push: (mode: FilterMode, intensity: Intensity) => void;
  /**
   * 发 `PREVIEW_CLEAR`(页面恢复按规则解析的结果)。
   *
   * 幂等:没套过预览时是 no-op。调用方在**返回 / 保存 / 删除**三处必须调它
   * (B1 的前三条),其中「返回」那次 popup 仍开着、端口未断。
   */
  readonly clear: () => void;
}

export function usePreview({
  channel,
  eligibility,
}: UsePreviewOptions): PreviewController {
  /**
   * 是否有一层**本 popup 套上去的**预览还活着。
   *
   * 用它守住 `clear()` 的幂等,也是「从可用变不可用」那条 effect 的判据:
   * 没套过就没什么要撤的,不该白发一条消息(spy 断言会数消息条数)。
   */
  const activeRef = useRef(false);

  /**
   * 🔴 `channel` 与 `eligibility` 存进 ref,**不作为下面 effect 的依赖**。
   *
   * 与 `usePopupSettings` 里 `portRef` 完全同一个理由:`eligibility` 是
   * 每次 render 新建的对象字面量,放进依赖数组会让 effect 每帧重跑。
   * 真正需要触发「撤除」的不是对象身份,而是 `available` 这个**布尔值**
   * 的翻转 —— 故依赖数组里只放它。
   */
  const channelRef = useRef(channel);
  channelRef.current = channel;
  const eligibilityRef = useRef(eligibility);
  eligibilityRef.current = eligibility;

  const clear = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    channelRef.current.sendClear();
  }, []);

  const push = useCallback((mode: FilterMode, intensity: Intensity) => {
    const current = eligibilityRef.current;
    // 🔴 四种不可用情形在此被挡住 —— 一条 PREVIEW_FILTER 都不发。
    if (!current.available) return;
    activeRef.current = true;
    channelRef.current.sendFilter(current.tabId, mode, intensity);
  }, []);

  const available = eligibility.available;

  /**
   * 🔴 B1 第四条 + 「预览条件从可用变不可用」。
   *
   * `available` 从 true 翻到 false 的那一帧就撤除。pattern 被改到不再匹配
   * 当前页时,`computePreviewEligibility` 会给出
   * `reason: 'pattern-mismatch'` → `available` 翻 false → 这里发 CLEAR。
   * 主开关在另一个窗口被关掉、锁定在编辑中途启动,走的也是这条路。
   */
  useEffect(() => {
    if (available) return;
    clear();
  }, [available, clear]);

  /**
   * 卸载时的收尾(双重保险,见头注释的 📌)。
   *
   * 刻意是**独立的** effect 且依赖数组为空:若与上面那条合并,
   * `available` 每次翻转都会跑一遍清理,语义就不再是「卸载」了。
   */
  useEffect(() => {
    return () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      channelRef.current.sendClear();
    };
  }, []);

  return useMemo(
    () => ({ available, push, clear }),
    [available, push, clear],
  );
}
