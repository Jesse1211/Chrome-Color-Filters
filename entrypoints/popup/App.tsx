/**
 * Popup 根组件 —— **ADR-022 的双视图状态机**。
 *
 * 列表视图(T6a)+ 锁定 UI(T6c)+ **编辑视图(T6b)**。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## ADR-022:两视图**互斥**
 *
 * `view` 是一个判别联合,**结构上不可能同时渲染两个视图** ——
 * 这不是一条「我们记得只渲染一个」的约定,而是类型。
 * 该性质承载 §6 T6b gate 的 **I2**:
 *
 * > **预览与锁定永不共存**:锁定入口**仅存在于列表视图**(T6c),
 * > 预览仅存在于编辑视图,而 ADR-022 规定两视图互斥,
 * > 且离开编辑视图必发 `PREVIEW_CLEAR`。故「锁定启动时预览仍活动」不可达。
 * > **此性质须保持** —— 不得在编辑视图添加锁定快捷入口。
 *
 * 落实在下面两处:
 * - `lockBanner` / `lockEntry` **只**传给 `RuleListView`;
 * - `RuleEditView` 的 props 里根本没有锁定插槽(只有一个 `locked: boolean`
 *   用于禁用控件),于是「在编辑视图加个锁定入口」需要先改它的接口。
 *
 * ## 🔴 锁定中与未锁定互斥地挂两个插槽(ADR-051 / ADR-052 / INV-12)
 *
 * - 锁定中 → `lockBanner`(倒计时 + **仅**延长),**不挂** `lockEntry`
 * - 未锁定 → `lockEntry`(计时器入口),**不挂** `lockBanner`
 *
 * 于是锁定中的 DOM 里结构上不可能出现「启动/解除/取消/结束/缩短」任何入口 ——
 * 那是 §6 T6c gate 里「INV-12 最重要的一条门禁」。
 *
 * ## 🔒 锁定中编辑视图不可达(ADR-051)
 *
 * gate 给了两种合规实现:「列表项点击不进入编辑视图」**或**「进入后全部
 * 控件禁用且保存/删除禁用」。本实现取**前者**(`openEditor` 在锁定中
 * 直接返回),并同时具备后者 —— `locked` 也原样传给编辑视图。
 * 两道都做是因为锁定可能在**已进入编辑视图之后**由另一个窗口启动,
 * 此时没有「点击」可拦,只能靠控件禁用。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
import { useCallback, useMemo, useState } from 'react';

import { type FilterRule } from '../../src/domain/index.js';
import { createSettingsRepository } from '../../src/storage/settings-repository.js';
import { chromeLocalStorageArea } from '../../src/storage/storage-area.js';
import { LockCountdownBanner } from '../../src/ui/LockCountdownBanner.js';
import { LockTimerEntry } from '../../src/ui/LockTimerEntry.js';
import { RuleEditView } from '../../src/ui/RuleEditView.js';
import { RuleListView, type ActionResult } from '../../src/ui/RuleListView.js';
import {
  chromePreviewConnect,
  createPreviewChannel,
} from '../../src/ui/preview-port.js';
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
 * 而是直接测 `RuleListView` / `RuleEditView` / `useLockState`(注入内存替身),
 * 避免伪造整个 `chrome` 全局。
 */
const repository = createSettingsRepository({ area: chromeLocalStorageArea() });
const tabStatePort = chromeTabStatePort();

/**
 * ADR-049 的预览通道。同样模块级构造一次 —— 它持有一个**长连接端口**,
 * 每次 render 重建会让端口反复断开重连,页面上的预览随之闪烁。
 *
 * 🔴 `chromePreviewConnect()` 内部**只有** `chrome.tabs.connect`,
 *    没有 `chrome.tabs.query` —— `tabId` 一律来自 `GET_TAB_STATE`(ADR-049)。
 */
const previewChannel = createPreviewChannel(chromePreviewConnect());

/** ADR-022 的视图判别联合 —— 两视图在类型上互斥。 */
type View =
  | { readonly kind: 'list' }
  /** `index === null` → 新建(ADR-020:默认 Grayscale @ 100%,输入框为空)。 */
  | { readonly kind: 'edit'; readonly index: number | null };

function App() {
  const {
    settings,
    tabState,
    loaded,
    toggleMaster,
    deleteRule,
    reorderRules,
    saveRule,
    moveRuleToTop,
    syncSettings,
  } = usePopupSettings({ repository, tabStatePort });

  const [view, setView] = useState<View>({ kind: 'list' });

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
   * ADR-022:列表 → 编辑。
   *
   * 🔒 ADR-051:锁定中**不进入**编辑视图(gate 允许的两种实现之一)。
   */
  const openEditor = useCallback(
    (index: number) => {
      if (locked) return;
      setView({ kind: 'edit', index });
    },
    [locked],
  );

  /** ADR-020:新建规则 —— `index: null`,编辑视图据此给出空输入框 + 默认值。 */
  const addRule = useCallback(() => {
    if (locked) return;
    setView({ kind: 'edit', index: null });
  }, [locked]);

  /** ADR-022:编辑 → 列表。`PREVIEW_CLEAR` 由编辑视图在调用前发出(B1)。 */
  const backToList = useCallback(() => {
    setView({ kind: 'list' });
  }, []);

  /**
   * 🔴 正在编辑的规则换了位置 → 视图状态跟过去(§1「身份 = 位置 + pattern」)。
   *
   * 目前唯一的来源是 §5.6 的一键修复(把本条移到最上面)。
   * 不跟过去的后果是静默的数据丢失 —— 详见 `RuleEditView` 的 `onReindex` 文档。
   */
  const reindexEditing = useCallback((nextIndex: number) => {
    setView((current) =>
      current.kind === 'edit' ? { kind: 'edit', index: nextIndex } : current,
    );
  }, []);

  // 设置未读出前也按骨架态渲染(ADR-044:控件禁用、不显示错误)。
  const effectiveTabState = useMemo(
    () => (loaded ? tabState : null),
    [loaded, tabState],
  );

  const editingIndex = view.kind === 'edit' ? view.index : null;

  /**
   * 保存 —— 新建走 `addRule`、编辑走 `updateRule`,分派在 `usePopupSettings`
   * 里(**一律经仓储层**,INV-14 / ADR-055)。
   */
  const handleSave = useCallback(
    (rule: FilterRule): Promise<ActionResult> => saveRule(editingIndex, rule),
    [saveRule, editingIndex],
  );

  if (view.kind === 'edit') {
    return (
      <RuleEditView
        settings={settings}
        tabState={effectiveTabState}
        editingIndex={view.index}
        previewChannel={previewChannel}
        onSave={handleSave}
        onDelete={deleteRule}
        onMoveToTop={moveRuleToTop}
        onBack={backToList}
        /*
          🔴 一键修复改变了规则的**位置**,而 §1 规定规则的身份是
             「位置 + pattern」—— 故视图状态必须跟过去,否则随后的
             删除/保存会作用在错误的规则上(见 `onReindex` 的文档)。
        */
        onReindex={reindexEditing}
        /* ADR-051:锁定中全部控件禁用,且不发 PREVIEW_FILTER。 */
        locked={locked}
        /*
          📌 这里**没有** lockBanner / lockEntry —— I2 的「预览与锁定永不共存」
             正是靠编辑视图不存在任何锁定入口来保持。
        */
      />
    );
  }

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
