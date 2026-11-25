/**
 * Popup 根组件 —— **ADR-022 的视图状态机**(列表 / 编辑 / 锁定,三者互斥)。
 *
 * 列表视图(T6a)+ 锁定 UI(T6c)+ **编辑视图(T6b)**。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 📍 锁定 UI 的折叠改造(产品负责人决定)
 *
 * 原先列表视图内联承载**整块**锁定区:标题 + 说明 + 预设行 + 自定义行 +
 * 启动按钮,在 360×452 的 popup 里占掉近三分之一高度 —— 而启动锁定是
 * **低频**动作。现在:
 *
 * - 列表页**未锁定** → 一行 `LockEntryRow`(「🔒 时间锁定 ›」),点它进子页面
 * - 列表页**锁定中** → `LockCountdownBanner`(倒计时**留在列表页**,
 *   剩余时间一眼可见),点它进子页面
 * - 子页面 `LockView` → 时长选择 + 启动(未锁定)/ **延长**(锁定中)+ 确认框
 *
 * 🔴 **只改控件住在哪一页,不改任何一条语义**:ADR-056 的二次确认、
 *    ADR-052 的只增不减、ADR-058 的数字+单位、ADR-051 的锁定期全禁用,
 *    全部随控件原样搬家。
 *
 * ## 📍 ADR-076:主开关 OFF 时「添加规则」与「时间锁定」一并禁用
 *
 * 两个入口的禁用判据都由 `RuleListView` 算出(它同时握着 `settings`
 * 与 `tabState`),本文件只负责把结论接到 `LockEntryRow` 上 ——
 * 见下方 `lockEntry` 插槽。**本文件不复算任何禁用条件。**
 *
 * 连带:ADR-057(启动锁定时原子开启主开关)已废止,因为
 * 「主开关 OFF 时启动锁定」在 UI 上不再可达。
 *
 * ## ADR-022:三视图**互斥**
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
 * 新增 `{kind:'lock'}` 之后,I2 由下面**四条**结构事实共同保持:
 * - `lockBanner` / `lockEntry` 插槽**只**传给 `RuleListView` ——
 *   进锁定页的两个入口依旧**只在列表视图**上;
 * - `RuleEditView` 的 props 里根本没有锁定插槽(只有一个 `locked: boolean`
 *   用于禁用控件),于是「在编辑视图加个锁定入口」需要先改它的接口;
 * - **`LockView` 的 props 里根本没有 `previewChannel`、也没有任何规则
 *   编辑回调** —— 于是「在锁定页顺手改个强度并预览」同样需要先改接口。
 *   这是与上一条完全对称的做法(详见 `LockView` 文件头);
 * - `previewChannel` 在本文件里**只**出现在 `RuleEditView` 的那一处。
 *
 * 于是「预览还活着就启动了锁定」依旧不可达:从编辑视图到锁定页**必须**
 * 先返回列表,而离开编辑视图必发 `PREVIEW_CLEAR`(B1)。
 *
 * ## 🔴 锁定中与未锁定互斥地挂两个插槽(ADR-051 / ADR-052 / INV-12)
 *
 * - 锁定中 → `lockBanner`(倒计时,点进子页面**仅**能延长),**不挂** `lockEntry`
 * - 未锁定 → `lockEntry`(折叠入口行),**不挂** `lockBanner`
 *
 * 于是锁定中的 DOM 里结构上不可能出现「启动/解除/取消/结束/缩短」任何入口 ——
 * 那是 §6 T6c gate 里「INV-12 最重要的一条门禁」。
 * 子页面同样互斥(见 `LockView`):锁定中只渲染延长区,未锁定只渲染启动区。
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
import { LockEntryRow } from '../../src/ui/LockEntryRow.js';
import { LockView } from '../../src/ui/LockView.js';
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

/**
 * ADR-022 的视图判别联合 —— 三视图在类型上互斥。
 *
 * 新增 `'lock'` 用的是**同一个** `view` 状态机,而不是另起一个
 * `showLockPage` 布尔值:后者允许「编辑中 + 锁定页」这种状态存在,
 * 那恰好是 I2 要排除的东西(见文件头)。判别联合让它不可表达。
 */
type View =
  | { readonly kind: 'list' }
  /** `index === null` → 新建(ADR-020:默认 Grayscale @ 100%,输入框为空)。 */
  | { readonly kind: 'edit'; readonly index: number | null }
  /**
   * 锁定子页面 —— 时长设置 / 启动(未锁定)或延长(锁定中)。
   *
   * **没有任何负载**:本页不需要知道任何规则的身份。
   * ADR-076 之后它连 `settings` 都不读了(原先只为 ADR-057 的告知
   * 读一个 `masterEnabled`),只需要 `lockUntil` 与时钟。
   */
  | { readonly kind: 'lock' };

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
   * ADR-022:列表 → 锁定子页面。
   *
   * 🔴 **ADR-061:这条路径上一个字节都不写。**
   * 导航只改组件状态,既不防抖、也不「在卸载时补一次保存」——
   * popup 一失焦即销毁,任何挂在导航上的延迟写入都会静默丢失。
   * 锁定的写入只发生在子页面里确认之后,且走
   * `repository.setLockUntilImmediate`(点击那一轮就发出 `storage.set`)。
   *
   * 🔒 锁定中**同样允许**进入 —— 子页面在锁定中渲染的是延长区(ADR-052),
   * 那是锁定期间唯一合法的操作,拦住它反而是错的。
   */
  const openLockView = useCallback(() => {
    setView({ kind: 'lock' });
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

  if (view.kind === 'lock') {
    return (
      <LockView
        /*
          📌 ADR-076:**不再传 `settings`** —— 原先只为 ADR-057 的
             「将同时开启滤镜」告知读一个 `masterEnabled`,该告知已删除。
             少传一个 prop 让 I2 更硬:本页连规则数据都拿不到。
        */
        locked={locked}
        lockUntil={lockUntil}
        now={now}
        /* ADR-056:启动只在二次确认之后发生,确认框在 LockTimerEntry 里。 */
        onStartLock={startLock}
        /* ADR-052:锁定中唯一的写入。 */
        onExtendLock={extendLock}
        onBack={backToList}
        /* ADR-044:设置未读出前按骨架态禁用启动。 */
        disabled={!loaded}
        /*
          📌 这里**没有** previewChannel,也没有任何规则编辑回调
             (onSave / onDelete / onMoveToTop / onReindex 一个都没传,
             因为 LockView 的 props 里根本没有它们)——
             I2 的「预览与锁定永不共存」靠这个缺位保持,
             与编辑视图没有锁定插槽完全对称。见 LockView 文件头。
        */
      />
    );
  }

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
      /*
        锁定中:倒计时**留在列表页**(剩余时间一眼可见,产品负责人决定),
        点它进子页面延长(ADR-051 / ADR-052)。本条自身无任何写入控件。
      */
      lockBanner={
        locked && lockUntil !== null ? (
          <LockCountdownBanner
            lockUntil={lockUntil}
            now={now}
            onOpen={openLockView}
          />
        ) : undefined
      }
      /*
        未锁定:**折叠成一行**的入口(与「+ 添加规则」同一语气),
        时长选择 + 启动 + 二次确认全在子页面(ADR-056 / ADR-058)。
      */
      lockEntry={
        !locked
          ? /*
               🔴 **ADR-076:禁用状态由 `RuleListView` 算好传进来,这里不复算。**

               主开关 OFF 时锁定入口一并禁用 —— 但判据(`masterOff` 与
               「锁定是全局的,故 `notInjectable` **不算**理由」)住在
               `RuleListView` 里,因为只有那里同时握着 `settings` 与
               `tabState`。本文件若自己写一遍 `!settings.masterEnabled`,
               同一条 ADR-076 就有了两份实现,而门禁只盯着其中一份。

               `disabled` 里也仍然含骨架态(ADR-044)—— 原先那个
               `disabled={!loaded}` 并没有被放宽,只是改由
               `lockEntryDisabled` 的 `isSkeleton` 分量表达。
            */
            ({ disabled, reason }) => (
              <LockEntryRow
                onOpen={openLockView}
                disabled={disabled}
                disabledReason={reason}
              />
            )
          : undefined
      }
    />
  );
}

export default App;
