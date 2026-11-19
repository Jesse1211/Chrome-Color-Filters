/**
 * Popup 根组件。
 *
 * **T6a 范围:列表视图**(ADR-022 的两个视图之一)。
 * 编辑视图是 T6b,锁定 UI 是 T6c —— 两者的挂载点在下方以注释标出,
 * T6a **不**替它们预先实现任何界面。
 */
import { useCallback, useMemo } from 'react';

import { createSettingsRepository } from '../../src/storage/settings-repository.js';
import { chromeLocalStorageArea } from '../../src/storage/storage-area.js';
import { RuleListView } from '../../src/ui/RuleListView.js';
import { chromeTabStatePort } from '../../src/ui/tab-state.js';
import { usePopupSettings } from '../../src/ui/usePopupSettings.js';

/**
 * 仓储与消息端口在模块级构造一次。
 *
 * popup 的生命周期就是一次打开,不存在「换一个 storage」的场景;
 * 放在组件内每次 render 重建会让 `useEffect` 的订阅反复拆装。
 *
 * ⚠️ 构造 `chromeLocalStorageArea()` 在非扩展环境下会 throw(见其文档)。
 * popup 永远跑在扩展上下文中,故此处直接构造;单测**不**渲染本组件,
 * 而是直接测 `RuleListView`(注入内存替身),避免伪造整个 `chrome` 全局。
 */
const repository = createSettingsRepository({ area: chromeLocalStorageArea() });
const tabStatePort = chromeTabStatePort();

function App() {
  const { settings, tabState, loaded, toggleMaster, deleteRule, reorderRules } =
    usePopupSettings({ repository, tabStatePort });

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
      /* T6c:lockBanner / locked 两个接缝在此注入(§5.4 锁定中行)。 */
    />
  );
}

export default App;
