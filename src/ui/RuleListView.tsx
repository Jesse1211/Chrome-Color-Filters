/**
 * Popup **列表视图**(DESIGN.md §5.3 / §5.4 · 任务 T6a)。
 *
 * ```
 * ┌──────────────────────────────────┐
 * │ ◧ Color Filters            [●]   │  主开关,固定顶部
 * ├──────────────────────────────────┤
 * │ ↓ 从上往下匹配,首个命中的规则生效  │  常驻提示条 (ADR-031)
 * ├──────────────────────────────────┤
 * │ ⠿ *.weibo.*    ▰ 灰阶 100%   ✕   │  拖柄·色块+名称·强度·删除
 * │              ⋮ (可滚动)           │
 * ├──────────────────────────────────┤
 * │ [+ 添加规则]               3/20  │
 * └──────────────────────────────────┘
 * ```
 *
 * ## 本组件遵循的 ADR
 *
 * - **ADR-008 / INV-6** 顺序即优先级,可拖拽重排;重排后立即生效并持久化
 * - **ADR-009** 主开关是全局单例,**无 per-rule 开关**
 * - **ADR-012** 达到上限时提示并引导删除,绝不静默淘汰
 * - **ADR-013 / ADR-050** 不可注入页:规则编辑类控件置灰 + 说明原因,
 *   **但全局主开关保持可用**(§6.1 冲突第 7 条)
 * - **ADR-022** 双视图:本组件是列表视图,「打开编辑」通过 `onOpenRule` 上抛
 * - **ADR-023** 拖柄与展开/删除分离(实现见 `RuleRow`)
 * - **ADR-024** **不提供「清空全部」**
 * - **ADR-031** 列表顶部常驻优先级提示条
 * - **ADR-032** 被遮蔽行整行淡化 + 「此页未生效」,不使用删除线
 * - **ADR-043** 所有可聚焦元素的 focus 态由 `tokens.css` 统一提供
 * - **ADR-044** 当前页信息一律来自 `TabState`,**本视图不自己算匹配**
 * - **ADR-046** 存储失败 → 顶部红色报错条
 *
 * ## 锁定(T6c 接入)
 *
 * 本组件通过 `locked` / `lockBanner` / `lockEntry` 三个**可选**接缝接入 T6c 的
 * 锁定界面,自身**不构造**任何锁定 UI,也**绝不**提供解除/缩短入口(ADR-052/INV-12)。
 *
 * - **ADR-051** `locked` 为 true 时**全部设置控件禁用** —— 含主开关、规则行、
 *   添加、删除、拖拽。
 * - **🔴 ADR-051 优先于 ADR-050** —— 见下方 `masterDisabled`:
 *   不可注入页面上主开关本可用,但**锁定期间一并锁死**。
 * - 锁定拒绝(`kind: 'locked'`)**不弹红色报错条** —— `toSaveErrorBanner` 返回
 *   `null`,倒计时条已经表达了状态(T3 gate I1)。
 *
 * ## 不在本任务范围
 *
 * - 编辑视图是 T6b(ADR-022)。
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { type FilterRule } from '../domain/filter-rule.js';
import { type FilterSettings, MAX_RULES } from '../domain/filter-settings.js';
import { type WriteError } from '../storage/errors.js';
import { RuleRow } from './components/RuleRow.js';
import { type SaveErrorBanner, toSaveErrorBanner } from './save-error.js';
import { type TabState } from './tab-state.js';
import {
  ADD_RULE_LABEL,
  BRAND_NAME,
  CAPACITY_NOTICE,
  EMPTY_HINT,
  EMPTY_TITLE,
  LOCKED_DISABLED_REASON,
  MASTER_OFF_DISABLED_REASON,
  MASTER_SWITCH_LABEL,
  NOT_INJECTABLE_MESSAGE,
  PRIORITY_HINT_PREFIX,
  PRIORITY_HINT_STRONG,
} from './strings.js';

/** 写入动作的统一结果形状 —— 与仓储层的 `WriteResult` 同构。 */
export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: WriteError };

/**
 * 传给 `lockEntry` 插槽的禁用状态(ADR-076)。
 *
 * 🔴 **两个字段一起传,不只传 `disabled`。**
 * 只传布尔值的话,调用方渲染得出一个禁用的按钮,却说不出为什么 ——
 * 于是它要么编一句文案(与本组件的口径漂移),要么什么都不说
 * (屏幕阅读器只听到「不可用」)。原因与结论同产地,才不会分家。
 */
export interface LockEntrySlotState {
  /** 入口是否禁用 —— 骨架态或主开关 OFF(ADR-044 / ADR-076)。 */
  readonly disabled: boolean;
  /**
   * 禁用的原因,供 `title` 使用;未禁用时为 `undefined`。
   *
   * 与「添加规则」共用同一个 `disabledReason`,故两个入口在同一状态下
   * 给出**逐字相同**的解释 —— 它们本就是被同一条 ADR-076 一起禁用的。
   */
  readonly reason?: string;
}

export interface RuleListViewProps {
  readonly settings: FilterSettings;
  /**
   * 当前 tab 的状态(ADR-044)。`null` = **骨架态**:
   * > popup 在收到响应前渲染骨架态(控件禁用、不显示错误),收到后再渲染。
   */
  readonly tabState: TabState | null;
  readonly onToggleMaster: (next: boolean) => Promise<ActionResult> | ActionResult;
  readonly onDeleteRule: (index: number) => Promise<ActionResult> | ActionResult;
  readonly onReorderRules: (
    rules: readonly FilterRule[],
  ) => Promise<ActionResult> | ActionResult;
  readonly onAddRule: () => void;
  readonly onOpenRule: (index: number) => void;
  /**
   * 锁定态接缝 —— **T6c 的插槽**,T6a 不实现锁定 UI。
   * 为 true 时所有设置控件禁用(ADR-051),但本组件**不**渲染倒计时或任何解除入口。
   */
  readonly locked?: boolean;
  /** T6c 注入的锁定条(倒计时)。T6a 原样渲染在顶部,自身不构造内容。 */
  readonly lockBanner?: React.ReactNode;
  /**
   * T6c 注入的**未锁定**时的计时器入口(ADR-058)。渲染在列表之下、底部栏之上。
   *
   * 与 `lockBanner` 一样,本组件**不构造**其内容,也不判断该不该显示:
   * 调用方只在未锁定时传入它、只在锁定中传 `lockBanner`,
   * 两者互斥由调用方保证(锁定中渲染一个「启动锁定」入口是 INV-12 的违反)。
   *
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 🔴 **ADR-076:它是一个「接收禁用状态」的函数,不是一个 `ReactNode`。**
   *
   * ADR-076 要求主开关 OFF 时锁定入口**也**禁用,而「主开关是否 OFF」
   * 与「当前页是否可注入」这两个判据都只有**本组件**算得出
   * (`settings` + `tabState` 都在这里)。
   *
   * 若仍是 `ReactNode`,调用方(`App`)就得自己复算一遍 `masterOff`,
   * 于是同一条规则存在**两份实现** —— 而两份实现里只有一份被门禁盯着,
   * 另一份迟早漂移。改成函数后,禁用判据只有 `lockEntryDisabled`
   * 这一个产地,调用方拿到的就是最终结论(含**为什么**)。
   *
   * ⚠️ 传进来的 `disabled` **不含** `notInjectable`(ADR-050:锁定是全局的),
   *    判据表见 `lockEntryDisabled` 的文档。
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  readonly lockEntry?: (state: LockEntrySlotState) => React.ReactNode;
}

export function RuleListView({
  settings,
  tabState,
  onToggleMaster,
  onDeleteRule,
  onReorderRules,
  onAddRule,
  onOpenRule,
  locked = false,
  lockBanner,
  lockEntry,
}: RuleListViewProps) {
  /** ADR-046:最近一次写入失败。成功写入后清空。 */
  const [saveError, setSaveError] = useState<SaveErrorBanner | null>(null);

  /**
   * 拖拽过程中的**乐观顺序**,连同它所基于的那一份已持久化列表。
   *
   * `draft === null` = 不在重排中,直接用 `settings.rules`。
   *
   * ⚠️ 这里刻意**不用 `useEffect` 去清草稿**:那会在「新 settings 到达」与
   * 「草稿被清掉」之间多出一帧,用户能看到顺序闪回一下。
   * 改为在 render 时比对 `basedOn` —— 存储换了一份新的 `rules` 引用,
   * 草稿**当场**失效(INV-4:真相在存储)。无额外渲染、无中间帧。
   */
  const [draft, setDraft] = useState<{
    rules: readonly FilterRule[];
    basedOn: readonly FilterRule[];
  } | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const draftRules = draft && draft.basedOn === settings.rules ? draft.rules : null;
  const rules = draftRules ?? settings.rules;

  // ── 状态变体的判定(§5.4) ──────────────────────────────────────────────
  const isSkeleton = tabState === null;
  const masterOff = !settings.masterEnabled;
  const notInjectable = tabState !== null && !tabState.injectable;
  const isFull = settings.rules.length >= MAX_RULES;

  /**
   * 规则编辑类控件是否禁用。
   *
   * 🔴 **ADR-050 / §6.1 冲突第 7 条**:不可注入页面上**仅禁用规则编辑类控件**,
   * 全局主开关保持可用 —— 主开关是全局的,与当前页是什么无关,
   * 它是唯一的全局止血开关(ADR-027)。设计稿把主开关也禁用了,那是已记录的错误。
   *
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 🔴 **四个禁用理由是「或」,互不覆盖**(ADR-076 新增了 `masterOff` 对
   *    「添加规则」的约束,它与 ADR-050 的 `notInjectable` **各自独立**)。
   *
   * 这里刻意保持一个**布尔或**而不是「先判哪个理由优先」的级联:
   * 禁用是一个单调性质 —— 多一个理由只能让控件更不可用,绝不会让它
   * 重新可用。于是「两个理由同时成立时漏掉一个」在结构上不可能发生。
   *
   * 向用户**解释**原因则是另一回事,见下方 `disabledReason`:
   * 解释必须挑一条说(一次只能显示一条横幅),禁用本身不挑。
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  const rulesDisabled = isSkeleton || masterOff || notInjectable || locked;

  /**
   * 🔴 **ADR-076:主开关 OFF 时「添加规则」与「时间锁定」入口一并禁用。**
   *
   * > ADR-076:主开关 OFF 意味着「扩展整体停用」,此时新增规则或启动锁定
   * > 都是**对一个已停用的系统做配置**,语义含混。禁用后路径唯一:
   * > 要用先开主开关。
   *
   * `masterOff` 已经包含在 `rulesDisabled` 里(「添加规则」因此自动受管),
   * 这里单独命名的是**锁定入口**的禁用判据 —— 它与规则编辑类控件
   * **不同口径**,少一个理由:
   *
   * | 理由 | 规则编辑类 | 🔒 时间锁定入口 | 为什么 |
   * |---|---|---|---|
   * | 骨架态 | 禁用 | 禁用 | 设置还没读出来,点了也不知道在配置什么(ADR-044) |
   * | **主开关 OFF** | 禁用 | **禁用** | **ADR-076:对已停用的系统做配置,语义含混** |
   * | 不可注入页 | 禁用 | **仍可用** | ADR-050:锁定是**全局**的,与当前页是什么无关 —— 与主开关同理 |
   * | 锁定中 | 禁用 | (不在场)| 锁定中换成倒计时条,入口行根本不渲染(INV-12) |
   *
   * 🔴 第三行是本次改动最容易做错的一格:若把 `notInjectable` 也算进去,
   * 用户在 `chrome://extensions` 这类页面上就**永远**启动不了锁定 ——
   * 而锁定锁的是整个扩展,不是当前这个标签页。那会是一个新的缺陷,
   * 不是 ADR-076 要的东西。
   */
  const lockEntryDisabled = isSkeleton || masterOff;

  /**
   * 禁用的**原因说明**(无障碍:`title` + `aria-disabled` 的文案来源)。
   *
   * 🔴 与 `rulesDisabled` 的布尔或不同,解释必须**挑一条**说。
   * 优先级 = 「哪条更根本」:
   *
   * 1. **骨架态** —— 还没有任何可说的状态(连 `notInjectable` 都还不知道)。
   * 2. **锁定中** —— 最强的理由,且它凌驾 ADR-050(ADR-051 优先)。
   * 3. **主开关 OFF** —— 全局停用。它比「当前页不可注入」更根本:
   *    开了主开关也还是不可注入,但关着主开关时「这页能不能注入」
   *    根本不重要。
   * 4. **不可注入页** —— 最窄的理由,只关乎当前这一个标签页。
   *
   * ⚠️ 挑一条说**不等于**丢掉另一条:
   * - 禁用本身由 `rulesDisabled` 的或式保证,四条理由任一成立即禁用;
   * - 不可注入页的**横幅**(`not-injectable-notice`)是**独立**渲染的,
   *   不走这个优先级 —— 所以「主开关 OFF + 不可注入页」同时成立时,
   *   横幅照常解释不可注入,而控件的 `title` 说的是更根本的主开关。
   *   两条信息都在页面上,一条都没丢。
   *
   * 实现是一条**自上而下的 if 链**(原先是四层嵌套三元)——
   * 上面那个编号列表与代码行一一对应,读代码即读到优先级顺序。
   */
  const disabledReason = ((): string | undefined => {
    if (isSkeleton) return undefined;
    if (locked) return LOCKED_DISABLED_REASON;
    if (masterOff) return MASTER_OFF_DISABLED_REASON;
    if (notInjectable) return NOT_INJECTABLE_MESSAGE;
    return undefined;
  })();

  /**
   * 主开关是否禁用。
   *
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 🔴 **两条 ADR 的交集,§6.1 冲突第 7 条 / §6 T6c gate 的 D2 条款:**
   *
   * > **不可注入页面 + 锁定中**时,主开关**仍然禁用**(ADR-051 优先)。
   * > 这是两条 ADR 的交集,**首次打开 popup 即可达**。
   *
   * 读法:
   * - 不可注入页 **且未锁定** → 主开关**可用**(ADR-050:它是全局的,
   *   与当前页是什么无关,是唯一的全局止血开关)。
   *   故 `notInjectable` **刻意不在**本表达式里。
   * - **锁定中** → 主开关**禁用**,不管当前页可不可注入(ADR-051 优先)。
   *   ADR-050 的理由在锁定期间不成立 —— ADR-051 的全部前提就是
   *   「关滤镜是最需要被阻止的动作」,若锁定中仍可关,整个锁定功能形同虚设。
   *
   * UI 置灰只是第二道防线;真正的强制在仓储层的 `setMasterEnabled`
   * (INV-14 / ADR-055),它在锁定中返回 `kind: 'locked'`。
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  const masterDisabled = isSkeleton || locked;

  // ── 写入结果的统一处理(ADR-046) ───────────────────────────────────────
  const handleResult = useCallback(async (
    result: Promise<ActionResult> | ActionResult,
  ): Promise<ActionResult> => {
    const settled = await result;
    if (settled.ok) {
      setSaveError(null);
    } else {
      // locked 分类返回 null —— 锁定拒绝不弹红色报错条(T3 gate I1)。
      setSaveError(toSaveErrorBanner(settled.error));
    }
    return settled;
  }, []);

  const handleToggleMaster = useCallback(() => {
    void handleResult(onToggleMaster(!settings.masterEnabled));
  }, [handleResult, onToggleMaster, settings.masterEnabled]);

  const handleDelete = useCallback(
    (index: number) => {
      void handleResult(onDeleteRule(index));
    },
    [handleResult, onDeleteRule],
  );

  /** 重排落盘(ADR-008:拖拽重排后顺序立即生效并持久化)。 */
  const commitOrder = useCallback(
    (next: readonly FilterRule[]) => {
      setDraft({ rules: next, basedOn: settings.rules });
      void handleResult(onReorderRules(next)).then((settled) => {
        // 写入失败则回滚到存储中的顺序 —— 绝不让 UI 显示一个没存上的顺序。
        if (!settled.ok) setDraft(null);
      });
    },
    [handleResult, onReorderRules, settings.rules],
  );

  const move = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      const next = [...rules];
      const [moved] = next.splice(from, 1);
      if (!moved) return;
      next.splice(to, 0, moved);
      commitOrder(next);
    },
    [commitOrder, rules],
  );

  // ── 拖拽(ADR-023) ────────────────────────────────────────────────────
  const dragFrom = useRef<number | null>(null);

  const handleDragStart = useCallback((index: number) => {
    dragFrom.current = index;
    setDraggingIndex(index);
  }, []);

  const handleDragOver = useCallback((index: number) => {
    setDropIndex(index);
  }, []);

  const handleDrop = useCallback(
    (index: number) => {
      const from = dragFrom.current;
      dragFrom.current = null;
      setDraggingIndex(null);
      setDropIndex(null);
      if (from === null) return;
      move(from, index);
    },
    [move],
  );

  const handleDragEnd = useCallback(() => {
    dragFrom.current = null;
    setDraggingIndex(null);
    setDropIndex(null);
  }, []);

  // ── 当前页状态(ADR-044:真相来源唯一,本视图不自己算匹配) ──────────────
  const shadowedSet = useMemo(
    () => new Set(tabState?.shadowedRuleIndexes ?? []),
    [tabState],
  );
  /**
   * 「生效」标记只在**滤镜真的生效时**显示:
   * 主开关 OFF(INV-8)或当前页不可注入(ADR-013)时,没有任何规则在生效。
   */
  const activeIndex =
    tabState !== null && tabState.injectable && settings.masterEnabled
      ? tabState.activeRuleIndex
      : null;

  /**
   * §5.4 **第六种状态变体:锁定中**(ADR-051)。
   *
   * `popup--locked` 只负责视觉(列表淡化但**照常可见可滚动**)。
   * 真正的禁用靠各控件的 `disabled` 属性,最终防线在仓储层(INV-14 / ADR-055)。
   *
   * ⚠️ 锁定中**不加** `popup--dimmed`:那一条带 `pointer-events:none`,
   * 会让列表连滚动都做不到,而 §5.4 明确要求「规则列表照常**可见可滚动**但不可编辑」。
   */
  const popupClass = [
    'popup',
    masterOff ? 'popup--dimmed' : '',
    isSkeleton ? 'popup--skeleton' : '',
    locked ? 'popup--locked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={popupClass}
      data-testid="popup"
      data-view="list"
      data-skeleton={isSkeleton ? 'true' : 'false'}
      data-locked={locked ? 'true' : 'false'}
    >
      {/* ── 顶部:主开关,固定顶部(§5.3) ── */}
      <header className="popup__head">
        <div className="popup__brand">
          {/* §5.4 主开关 OFF:顶部图标变灰。 */}
          <span
            className={`popup__dot${masterOff ? ' popup__dot--off' : ''}`}
            data-testid="brand-dot"
            data-off={masterOff ? 'true' : 'false'}
            aria-hidden="true"
          />
          {BRAND_NAME}
        </div>
        <button
          type="button"
          className="switch"
          role="switch"
          aria-checked={settings.masterEnabled}
          aria-label={MASTER_SWITCH_LABEL}
          data-testid="master-switch"
          disabled={masterDisabled}
          onClick={handleToggleMaster}
        />
      </header>

      {/* T6c 的锁定条插槽(倒计时)。T6a 不构造其内容。 */}
      {lockBanner}

      {/*
        ── 提示条区 ──
        ADR-046 的红色报错条排在最前:它是**故障**,优先级高于一切状态说明。
        §5.4:「规则列表照常显示,用户仍可删除以腾出空间」——
        故报错条只是追加一条,不替换列表、也不禁用删除。
      */}
      {saveError && (
        <div className="notice notice--error" role="alert" data-testid="save-error">
          <span className="notice__icon" aria-hidden="true">
            ⚠
          </span>
          <span>
            {saveError.text}
            {saveError.advice}
          </span>
        </div>
      )}

      {/* §5.4 不可注入页(ADR-013):琥珀条 + 说明原因。 */}
      {notInjectable && (
        <div className="notice notice--warn" data-testid="not-injectable-notice">
          <span className="notice__icon" aria-hidden="true">
            ⚠
          </span>
          <span>{NOT_INJECTABLE_MESSAGE}</span>
        </div>
      )}

      {/*
        ── 顶部状态提示条(二选一)──
        优先级:已满 > 常驻优先级提示条。

        🔴 **ADR-076:原先这里是「三选一」,第一档是主开关 OFF 的琥珀条
           「已全局关闭,所有规则暂不生效」。那一档已整条删除。**

        产品负责人的理由:主开关 OFF 的状态**已经被说了三遍** ——
        顶部开关自身的位置、品牌图标变灰(`popup__dot--off`)、
        列表与底部整体淡化(`popup--dimmed`)。第四遍复述换不来任何信息,
        却实打实占掉 360×452 里一行高度。

        ⚠️ OFF 时**照常**显示 ADR-031 的常驻优先级提示条。
           原先替换掉它的理由是「OFF 时『首个命中的规则生效』是误导」——
           但那句话描述的是**规则的匹配语义**(顺序即优先级,ADR-008),
           它在 OFF 时依然是对规则列表的正确描述,只是暂时没有生效对象。
           而「现在没有规则在生效」这件事由淡化 + 图标变灰 + 两个入口被禁用
           共同表达,不需要文字再说一次。
      */}
      {isFull ? (
        <div className="notice notice--warn" data-testid="capacity-notice">
          <span>{CAPACITY_NOTICE}</span>
        </div>
      ) : (
        <div className="notice" data-testid="priority-hint">
          <span>
            {PRIORITY_HINT_PREFIX}
            <b>{PRIORITY_HINT_STRONG}</b>
          </span>
        </div>
      )}

      {/* ── 规则列表(可滚动) ── */}
      {rules.length === 0 ? (
        <div className="empty" data-testid="empty-state">
          <div className="empty__title">{EMPTY_TITLE}</div>
          <div className="empty__hint">{EMPTY_HINT}</div>
        </div>
      ) : (
        <ul className="rule-list" data-testid="rule-list">
          {rules.map((rule, index) => (
            <RuleRow
              key={`${index}:${rule.pattern}`}
              rule={rule}
              index={index}
              isActive={activeIndex === index}
              isShadowed={shadowedSet.has(index)}
              disabled={rulesDisabled}
              isDragging={draggingIndex === index}
              isDropTarget={dropIndex === index && draggingIndex !== index}
              onOpen={onOpenRule}
              onDelete={handleDelete}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              onMoveUp={(i) => move(i, i - 1)}
              onMoveDown={(i) => move(i, i + 1)}
              canMoveUp={index > 0}
              canMoveDown={index < rules.length - 1}
            />
          ))}
        </ul>
      )}

      {/*
        T6c:**未锁定**时的计时器入口(ADR-058)。锁定中由调用方改传 `lockBanner`,
        二者互斥 —— 锁定中出现「启动锁定」入口是无意义的,出现任何
        「解除/缩短」入口则直接违反 ADR-052 / INV-12。

        🔴 ADR-076:禁用状态由**本组件**算好传进去(见 `lockEntryDisabled`),
           调用方不复算 —— 同一条规则只有一份实现。
      */}
      {lockEntry?.({ disabled: lockEntryDisabled, reason: disabledReason })}

      {/*
        ── 底部:添加按钮 + 计数 ──
        ADR-024:**不提供「清空全部」** —— 危险且低频,逐条删除代价很小。
      */}
      <footer className="popup__foot">
        <button
          type="button"
          className="add-button"
          data-testid="add-rule"
          /*
            🔴 **真正的 `disabled`,不是「看起来禁用」**(ADR-076 + 无障碍)。
            `disabled` 的 <button> 既不触发 click、也不可 Tab 聚焦,
            键盘用户与鼠标用户得到同一个结论 —— 而仅用 CSS
            (`opacity` + `pointer-events:none`)只挡得住鼠标。
          */
          disabled={rulesDisabled || isFull}
          /*
            禁用了还要说得出**为什么**。满额有自己的横幅(capacity-notice),
            故它的原因直接用 `CAPACITY_NOTICE`;其余四种由 `disabledReason`
            按「哪条更根本」挑一条(见其文档)。
          */
          title={
            isFull && !rulesDisabled ? CAPACITY_NOTICE : disabledReason
          }
          onClick={onAddRule}
        >
          {ADD_RULE_LABEL}
        </button>
        {/* §5.4 满:计数变琥珀加粗。§5.1:tabular-nums。 */}
        <span
          className={`rule-count${isFull ? ' rule-count--full' : ''}`}
          data-testid="rule-count"
          data-full={isFull ? 'true' : 'false'}
        >
          {settings.rules.length}/{MAX_RULES}
        </span>
      </footer>
    </div>
  );
}
