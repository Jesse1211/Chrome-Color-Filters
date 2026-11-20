/**
 * Popup 根组件。
 *
 * **已实现:列表视图(T6a)+ 锁定 UI(T6c)**(ADR-022 的两个视图之一)。
 * 编辑视图是 T6b —— 挂载点在下方以注释标出,此处不替它预先实现任何界面。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **锁定中与未锁定互斥地挂两个插槽(ADR-051 / ADR-052 / INV-12):**
 *
 * - 锁定中 → `lockBanner`(倒计时 + **仅**延长),**不挂** `lockEntry`
 * - 未锁定 → `lockEntry`(计时器入口),**不挂** `lockBanner`
 *
 * 于是锁定中的 DOM 里结构上不可能出现「启动/解除/取消/结束/缩短」任何入口 ——
 * 那是 §6 T6c gate 里「INV-12 最重要的一条门禁」。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
import { useCallback, useMemo } from 'react';

import { createSettingsRepository } from '../../src/storage/settings-repository.js';
import { chromeLocalStorageArea } from '../../src/storage/storage-area.js';
import { LockCountdownBanner } from '../../src/ui/LockCountdownBanner.js';
import { LockTimerEntry } from '../../src/ui/LockTimerEntry.js';
import { RuleListView } from '../../src/ui/RuleListView.js';
import { chromeTabStatePort } from '../../src/ui/tab-state.js';
import { useLockState } from '../../src/ui/useLockState.js';
import { usePopupSettings } from '../../src/ui/usePopupSettings.js';

/**
 * 仓储与消息端口在模块级构造一次。
 *
 * popup 的生命周期就是一次打开,不存在「换一个 storage」的场景;
 * 放在组件内每次 render 重建会让 `useEffect` 的订阅反复拆装。
 *
 * ⚠️ 构造 `chromeLocalStorageArea()` 在非扩展环境下会 throw(见其文档)。
 * popup 永远跑在扩展上下文中,故此处直接构造;单测**不**渲染本组件,
 * 而是直接测 `RuleListView` / `useLockState`(注入内存替身),
 * 避免伪造整个 `chrome` 全局。
 */
const repository = createSettingsRepository({ area: chromeLocalStorageArea() });
const tabStatePort = chromeTabStatePort();

function App() {
  const {
    settings,
    tabState,
    loaded,
    toggleMaster,
    deleteRule,
    reorderRules,
    syncSettings,
  } = usePopupSettings({ repository, tabStatePort });

  /**
   * 锁定态(T6c)。时钟每秒推进 → 到期时 `locked` 自动翻 false,
   * 倒计时条卸载、控件恢复可编辑,**无需手动刷新 popup**(gate 要求)。
   */
  const { locked, now, lockUntil, startLock, extendLock } = useLockState({
    repository,
    settings,
    onSettings: syncSettings,
  });

  /**
   * ADR-022:列表视图 ⇄ 编辑视图。**编辑视图由 T6b 实现**,
   * 本任务只把入口接出来 —— 此处刻意不做任何视图切换的半成品状态机,
   * 以免 T6b 要先拆掉一个猜出来的实现。
   */
  const openEditor = useCallback((index: number) => {
    /* T6b:切到编辑视图,编辑 rules[index](ADR-022)。 */
    void index;
  }, []);

  const addRule = useCallback(() => {
    /* T6b:新建规则默认 Grayscale @ 100%,输入框为空(ADR-020)。 */
  }, []);

  // 设置未读出前也按骨架态渲染(ADR-044:控件禁用、不显示错误)。
  const effectiveTabState = useMemo(
    () => (loaded ? tabState : null),
    [loaded, tabState],
  );

  return (
    <RuleListView
      settings={settings}
      tabState={effectiveTabState}
      onToggleMaster={toggleMaster}
      onDeleteRule={deleteRule}
      onReorderRules={reorderRules}
      onAddRule={addRule}
      onOpenRule={openEditor}
      /* ADR-051:锁定中全部设置控件禁用(含主开关,优先于 ADR-050)。 */
      locked={locked}
      /* 锁定中:倒计时 + 仅延长(ADR-051 / ADR-052)。 */
      lockBanner={
        locked && lockUntil !== null ? (
          <LockCountdownBanner
            lockUntil={lockUntil}
            now={now}
            onExtend={extendLock}
          />
        ) : undefined
      }
      /* 未锁定:计时器入口(ADR-058)+ 二次确认(ADR-056)。 */
      lockEntry={
        !locked ? (
          <LockTimerEntry
            /* ADR-057:关闭状态下启动锁定会原子地一并开启主开关。 */
            masterEnabled={settings.masterEnabled}
            onStartLock={startLock}
            disabled={!loaded}
          />
        ) : undefined
      }
    />
  );
}

export default App;
