/**
 * 启动锁定的**二次确认**(ADR-056)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **本组件自己不写任何数据。**
 *
 * §6 T6c gate:
 * > 确认框在点启动后出现,**未确认前不写入任何数据**(spy 断言)
 * > 「取消」关闭确认框且**不产生任何写入**
 *
 * 它只有两个出口:`onConfirm` 与 `onCancel`,两者都是回调。
 * 写入发生在调用方收到 `onConfirm` 之后 —— 结构上保证了
 * 「渲染确认框」这个动作本身不可能触发任何仓储层调用。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ADR-056 要求文案**明确列出三条后果**:
 * 无法修改设置 / 无法关闭滤镜 / 无法提前结束(可延长)。
 * 三条由 `LOCK_CONSEQUENCES` 单一来源驱动渲染,门禁逐条断言同一份常量。
 *
 * 🔴 ADR-057 的告知:主开关处于关闭状态时,这里**额外**说明
 * 「启动锁定将同时开启滤镜」—— 不可逆操作之前必须说清所有后果。
 */

import { useEffect, useRef } from 'react';

import {
  LOCK_CONFIRM_CANCEL,
  LOCK_CONFIRM_OK,
  LOCK_CONFIRM_TITLE,
  LOCK_CONSEQUENCES,
  LOCK_WILL_ENABLE_MASTER,
  lockConfirmDurationText,
} from '../lock-strings.js';

export interface LockConfirmDialogProps {
  /** 本次将锁定的时长,已格式化(如「4 小时」)。 */
  readonly durationText: string;
  /**
   * 🔴 ADR-057:当前主开关是否处于**关闭**状态。
   * 为 true 时追加告知 —— 确认后主开关会被**原子地**一并打开。
   */
  readonly willEnableMaster: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function LockConfirmDialog({
  durationText,
  willEnableMaster,
  onConfirm,
  onCancel,
}: LockConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  /**
   * 焦点落在**取消**上,不是「确认锁定」。
   *
   * 这是不可逆操作(ADR-056:误点代价极大,可能锁住数小时且无补救)——
   * 一个「打开即回车」的确认框等于没有确认。
   */
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className="lock-modal" data-testid="lock-confirm-backdrop">
      <div
        className="lock-modal__panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="lock-confirm-title"
        aria-describedby="lock-confirm-body"
        data-testid="lock-confirm"
        onKeyDown={(event) => {
          // Esc = 取消。同样**不产生任何写入**。
          if (event.key === 'Escape') {
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <h2 className="lock-modal__title" id="lock-confirm-title">
          {LOCK_CONFIRM_TITLE}
        </h2>

        <div className="lock-modal__body" id="lock-confirm-body">
          <p className="lock-modal__duration" data-testid="lock-confirm-duration">
            {lockConfirmDurationText(durationText)}
          </p>

          {/* ADR-056:三条后果,逐条列出。 */}
          <ul className="lock-modal__consequences" data-testid="lock-consequences">
            {LOCK_CONSEQUENCES.map((text, i) => (
              <li key={text} data-testid={`lock-consequence-${String(i)}`}>
                {text}
              </li>
            ))}
          </ul>

          {/* 🔴 ADR-057:主开关关闭时,告知它会被一并打开。 */}
          {willEnableMaster && (
            <p className="lock-modal__note" data-testid="lock-will-enable-master">
              {LOCK_WILL_ENABLE_MASTER}
            </p>
          )}
        </div>

        <div className="lock-modal__actions">
          {/*
            取消在前、确认在后,且取消拿初始焦点 —— 破坏性操作不占据默认位置。
            ⚠️ 这里的「取消」取消的是**尚未发生的启动动作**,
            不是已生效的锁(ADR-052/INV-12)。本框只在**未锁定**时渲染。
          */}
          <button
            ref={cancelRef}
            type="button"
            className="lock-modal__cancel"
            data-testid="lock-confirm-cancel"
            onClick={onCancel}
          >
            {LOCK_CONFIRM_CANCEL}
          </button>
          <button
            type="button"
            className="lock-modal__ok"
            data-testid="lock-confirm-ok"
            onClick={onConfirm}
          >
            {LOCK_CONFIRM_OK}
          </button>
        </div>
      </div>
    </div>
  );
}
