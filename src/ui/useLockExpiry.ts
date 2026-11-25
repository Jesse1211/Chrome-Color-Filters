/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * `useLockExpiry` —— ADR-077 在 **popup 开着时**的那条防线。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 🔴 为什么 SW 的闹钟不够,这个 hook 必须存在
 *
 * 任务书的硬要求:
 * > The UI must stay correct across the transition: when the lock expires with
 * > the popup open, the countdown banner disappears, the master switch reads
 * > OFF, and controls become editable — **with no stale intermediate state**.
 *
 * 平台文档明文(引文见 `src/background/lock-expiry.ts`):闹钟
 * 「**may delay them an arbitrary amount more**」—— 迟到量**无上界**。
 * 于是若只靠 SW 的闹钟,popup 开着时用户会看到这样一段中间态:
 *
 * ```
 * 倒计时归零 → 横幅消失、控件解禁(useLockState 的每秒时钟,当秒生效)
 *            → 但主开关仍读 ON、页面仍是灰的      ← 🔴 stale,长度不可控
 *            → (闹钟终于响)主开关跳成 OFF、页面恢复彩色
 * ```
 *
 * 那段 stale 恰恰是任务书点名禁止的东西。本 hook 把它消掉:popup 自己
 * 在**到期当秒**就去调一次仓储层的自动关闭,于是横幅消失、主开关读 OFF、
 * 控件解禁**在同一次 React 更新里**一起发生。
 *
 * ## 🔴 这不是「第二份锁定判定」
 *
 * 本 hook **不判断该不该关** —— 它只在「`locked` 刚刚从 true 翻到 false」
 * 这个边沿上**去问一次**仓储层。判定与写入全在
 * `SettingsRepository.applyExpiryAutoOff()`(INV-14 / ADR-055:
 * 真相守在数据层;UI 置灰只是第二道防线)。
 *
 * 若时钟/边沿判断出了任何偏差(比如系统时钟被改动,ADR-071:
 * 时钟由用户自行负责),后果只是**多调一次**仓储层:
 * 锁仍有效时它返回 `kind:'locked'` 被拒,未到期就一个字节都不写。
 * **本 hook 在结构上不可能促成一次锁定期内的关闭。**
 *
 * ## 为什么挂在边沿上,而不是每秒都调
 *
 * `useLockState` 的时钟每秒推进一次。若每一秒都调一次仓储层,
 * 未锁定的 popup 开着时就会每秒产生一次 `storage.get` ——
 * 而 ADR-071 刚刚才把「读路径写盘」那条竞态连根拔掉,
 * 这里不该反过来制造一条「读路径每秒空转」。
 *
 * 边沿的判据是 `wasLocked.current === true && locked === false`,
 * 即**本次 popup 会话内亲眼看到的那次翻转**。于是:
 * - popup 在锁定期间打开、看着它到期 → 边沿命中 → 当秒关闭 ✅
 * - popup 在**已经到期之后**才打开 → 没有边沿 → 本 hook 不动手,
 *   由 SW 的 `catchUp` 负责(它在 popup 打开唤醒 SW 时就会跑)。
 *   🔴 这是刻意的分工,不是漏洞:popup 刚打开时若自己也补一次,
 *   两边会在同一瞬间各写一次盘,而那两次写入的内容相同、
 *   第二次纯属多余(仓储层的幂等会把它变成 no-op,但多一次 IPC)。
 */

import { useEffect, useRef } from 'react';

import { type FilterSettings } from '../domain/filter-settings.js';

export interface UseLockExpiryOptions {
  /** 当前是否锁定 —— 由 `useLockState` 按每秒推进的时钟算出。 */
  readonly locked: boolean;
  /**
   * 🔴 执行到期自动关闭 —— **判定与写入都在仓储层**(ADR-077 / INV-14)。
   *
   * 生产环境是 `repository.applyExpiryAutoOff()`。
   */
  readonly applyAutoOff: () => Promise<
    | { readonly ok: true; readonly value: { readonly settings: FilterSettings; readonly applied: boolean } }
    | { readonly ok: false; readonly error: unknown }
  >;
  /**
   * 自动关闭成功后把新设置回灌给 React 状态。
   *
   * 与 `useLockState` 的 `onSettings` 同一套路:仓储层的 `subscribe` 走
   * `storage.onChanged`,**本窗口自己的写入不会回调自己**,
   * 故必须显式回灌 —— 否则主开关会停在写入**之前**的 ON 上,
   * 而那正是本 hook 要消掉的 stale。
   */
  readonly onSettings?: (next: FilterSettings) => void;
}

export function useLockExpiry({
  locked,
  applyAutoOff,
  onSettings,
}: UseLockExpiryOptions): void {
  /**
   * 上一次渲染看到的锁定态 —— 边沿检测的全部状态。
   *
   * 🔴 初值取 `locked` 本身,**不是 `false`**:
   * 若初值写死 `false`,popup 在**锁定中**打开的第一帧就会被判成
   * 「true→false 的边沿」的反面…… 更要紧的是,popup 在**已到期**后打开时
   * (`locked` 首帧即 false),写死 `false` 不会命中边沿 —— 这碰巧也对,
   * 但理由是偶然的。取 `locked` 让「首帧永远不构成边沿」成为**构造性**事实:
   * 边沿只能由一次真实的 **翻转** 产生。
   */
  const wasLocked = useRef(locked);

  /**
   * 注入项存 ref,**不作为 effect 的依赖**。
   *
   * 与 `useLockClock` 对 `clock` 的处理同理:调用方最自然的写法是在 JSX /
   * 组件体里内联传箭头函数,那样每次 render 都是新引用。
   * 若它出现在依赖数组里,effect 会在**每一帧**重跑 ——
   * 而本 effect 带写入副作用,每帧重跑意味着每帧一次 `storage.get`。
   */
  const applyRef = useRef(applyAutoOff);
  applyRef.current = applyAutoOff;
  const onSettingsRef = useRef(onSettings);
  onSettingsRef.current = onSettings;

  useEffect(() => {
    const previously = wasLocked.current;
    wasLocked.current = locked;

    // 🔴 只在「锁定 → 未锁定」这一个边沿上动手(见文件头的论证)。
    if (!(previously && !locked)) return;

    let alive = true;
    void applyRef.current().then(
      (result) => {
        /*
          popup 可能在这次跨进程写入飞在半路时就被销毁(Chrome 弹窗一失焦
          即销毁)。那**不影响落盘** —— 请求已经交给浏览器进程了,
          这里只是不再去碰一个已卸载组件的 state。
          落盘本身还有 SW 侧的闹钟与 catchUp 两条独立防线兜着。
        */
        if (!alive) return;
        if (result.ok && result.value.applied) {
          onSettingsRef.current?.(result.value.settings);
        }
      },
      () => {
        /*
          仓储层承诺返回结构化错误而非 throw(ADR-046),走到这里是极端情况。
          **刻意不向用户报错**:到期自动关闭是系统的收尾动作,
          用户没有发起任何操作,对着他弹一条红色「保存失败」是虚假警报。
          SW 侧的 catchUp 会在下次启动时补做。
        */
      },
    );

    return () => {
      alive = false;
    };
  }, [locked]);
}
