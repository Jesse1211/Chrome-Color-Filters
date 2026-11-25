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

 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **ADR-076 废止了 ADR-057,本框因此少了一段告知。**
 *
 * 原先这里有第四段:主开关处于关闭状态时额外说明「滤镜当前已关闭,
 * 启动锁定将同时开启滤镜」—— 因为那时**可以**在主开关 OFF 时启动锁定,
 * 而仓储层会悄悄替用户把主开关打开(ADR-057)。
 *
 * ADR-076 之后,主开关 OFF 时「🔒 时间锁定」入口**本身就是禁用的**,
 * 用户根本到不了这个确认框。于是:
 * - 那段告知**永远不会被渲染** —— 一段不可达的 UI;
 * - 它描述的那个行为(自动开启主开关)也已从仓储层删除。
 *
 * 留着它就是留一条产品不再支持的路径。**从源头禁用,比事后告知更直白。**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import { useEffect, useRef } from 'react';

import {
  LOCK_CONFIRM_CANCEL,
  LOCK_CONFIRM_OK,
  LOCK_CONFIRM_TITLE,
  LOCK_CONSEQUENCES,
  lockConfirmDurationText,
} from '../lock-strings.js';

export interface LockConfirmDialogProps {
  /** 本次将锁定的时长,已格式化(如「4 小时」)。 */
  readonly durationText: string;
  /*
    🔴 ADR-076:原先这里还有一个 `willEnableMaster: boolean`(ADR-057
       的告知开关)。整个 prop 已删除 —— 不是默认 false,是不存在。

       留一个恒为 false 的 prop 等于留一条死分支:将来有人把它接上
       就能复活一条产品已经废止的路径,而门禁不会察觉。
  */
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function LockConfirmDialog({
  durationText,
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

          {/*
            🔴 ADR-076:ADR-057 的那段「启动锁定将同时开启滤镜」告知
               已删除 —— 主开关 OFF 时入口本身禁用,到不了这里。
          */}
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
