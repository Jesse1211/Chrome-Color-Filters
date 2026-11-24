/**
 * Popup **编辑视图**(DESIGN.md §5.5 / §5.6 / §5.7 · 任务 T6b)。
 *
 * ```
 * ┌──────────────────────────────────┐
 * │ ‹ 返回        编辑规则            │
 * ├──────────────────────────────────┤
 * │ 网址模式                          │
 * │ ┌──────────────────────────────┐ │
 * │ │ *.weibo.*                    │ │  等宽字体 (ADR-033)
 * │ └──────────────────────────────┘ │
 * │ ● 匹配当前网站 weibo.com · 生效中  │  ← 状态行,见 §5.6
 * │ 强度                              │
 * │ ▓▓▓▓▓▓▓▓▓▓●──────   100%         │
 * │ ● 拖动时当前页面实时预览           │
 * ├──────────────────────────────────┤
 * │ [    保存    ]        [ 删除 ]    │
 * └──────────────────────────────────┘
 * ```
 *
 * ## 本组件遵循的 ADR
 *
 * - **ADR-001** 规则是用户**手动输入**的,不绑定当前 tab ——
 *   故**没有**「使用当前网站」自动填充按钮(gate 负向断言:
 *   「这是看起来很贴心因而最容易被自作主张加上的东西」)
 * - **ADR-075** 模式单选组**已删除**(只剩一个模式,单选组是无意义的控件);
 *   `mode` 字段仍在规则里保留,见下方 `mode` 状态的说明。
 *   INV-2(模式互斥)因此退化为平凡真,DESIGN.md 明文保留该不变式
 * - **ADR-003** 每条规则带 Intensity 滑块(0–100,两端均可达)
 * - **ADR-020** 新建规则默认 Grayscale @ 100%(ADR-075 后这是唯一模式),输入框为空
 * - **ADR-021** 已有规则可展开编辑(强度、网址;模式已无可编辑项,见 ADR-075)
 * - **ADR-022** 双视图:本组件是编辑视图,「返回」通过 `onBack` 上抛
 * - **ADR-028** 负向:**无 Color Tint 选项,无 Hue 滑块**
 * - **ADR-033** 网址模式一律等宽字体
 * - **ADR-043** focus 态由 `tokens.css` 统一提供,本组件不覆盖
 * - **ADR-049** 实时预览直推 content script,**不写 storage**
 * - **ADR-051** 锁定中全部控件禁用,且**不发** `PREVIEW_FILTER`
 * - **ADR-066** 契约类型只有一处,`tsc --noEmit` 把守
 *
 * ## 🔴 预览与锁定永不共存(I2)—— 此性质须保持
 *
 * > 锁定入口**仅存在于列表视图**(T6c),预览仅存在于编辑视图,
 * > 而 ADR-022 规定两视图互斥,且离开编辑视图必发 `PREVIEW_CLEAR`。
 * > 故「锁定启动时预览仍活动」不可达。**不得在编辑视图添加锁定快捷入口。**
 *
 * 本组件因此**没有任何** lock 插槽、没有启动/延长锁定的入口,
 * 只接收一个 `locked: boolean` 用于禁用控件。这与 `RuleListView` 的
 * `lockEntry` / `lockBanner` 插槽形成对照 —— 那两个槽**刻意不在这里**。
 *
 * ## 保存的语义(F20)
 *
 * 点保存后规则持久化并**立即生效**:写入经仓储层 → `storage.onChanged` →
 * service worker 的 `reconcile()`(ADR-062)更新声明式注册,下一次导航即生效;
 * 当下已打开的 tab 由 T5 的 `BackgroundCoordinator` 广播(INV-4)。
 * 本组件只负责**一次写入**,那两条链路由 `entrypoints/background.ts` 接好。
 * **滑块拖动不写存储**,只在点保存时单次写入(ADR-049 + ADR-061)。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type FilterMode,
  type FilterRule,
  type FilterSettings,
  INTENSITY_MAX,
  INTENSITY_MIN,
} from '../domain/index.js';
import { type SaveErrorBanner, toSaveErrorBanner } from './save-error.js';
import { type ActionResult } from './RuleListView.js';
import { type TabState } from './tab-state.js';
import {
  type PatternStatus,
  type PreviewBlockReason,
  computePatternStatus,
  computePreviewEligibility,
} from './pattern-status.js';
import { type PreviewChannel } from './preview-port.js';
import { usePreview } from './usePreview.js';
import {
  BACK_LABEL,
  CREATE_TITLE,
  DELETE_LABEL,
  EDIT_TITLE,
  INTENSITY_LABEL,
  INTENSITY_SLIDER_LABEL,
  MOVE_TO_TOP_LABEL,
  PATTERN_LABEL,
  PREVIEW_LIVE_HINT,
  PREVIEW_UNAVAILABLE_HINT,
  SAVE_LABEL,
  SHADOW_BOX_MIDDLE,
  SHADOW_BOX_PREFIX,
  SHADOW_BOX_SUFFIX,
  STATUS_EMPTY_TEXT,
  STATUS_ERROR_PREFIX,
  STATUS_ERROR_SUFFIX,
  STATUS_ERROR_TAIL,
  STATUS_ICON_ERROR,
  STATUS_ICON_LIVE,
  STATUS_ICON_NO_MATCH,
  STATUS_ICON_SHADOWED,
  STATUS_LIVE_PREFIX,
  STATUS_LIVE_SUFFIX,
  STATUS_NO_MATCH_PREFIX,
  STATUS_SHADOWED_PREFIX,
  STATUS_SHADOWED_STRONG,
  STATUS_TOO_LONG_TEXT,
} from './edit-strings.js';

export interface RuleEditViewProps {
  readonly settings: FilterSettings;
  /** `null` = 尚未收到 `GET_TAB_STATE`(骨架态,ADR-044)。 */
  readonly tabState: TabState | null;
  /**
   * 正在编辑的规则索引;**`null` = 新建**(ADR-020:默认 Grayscale @ 100%,
   * 输入框为空)。
   */
  readonly editingIndex: number | null;
  /** ADR-049 的发送通道。调用方注入,便于单测用 spy 替身。 */
  readonly previewChannel: PreviewChannel;
  /**
   * 保存一条规则 —— 新建走 `addRule`,编辑走 `updateRule`,由调用方决定。
   * **一律经仓储层**(INV-14 / ADR-055)。
   */
  readonly onSave: (
    rule: FilterRule,
  ) => Promise<ActionResult> | ActionResult;
  readonly onDelete: (index: number) => Promise<ActionResult> | ActionResult;
  /** §5.6 一键修复:把本条移到最上面(ADR-008 顺序即优先级)。 */
  readonly onMoveToTop: (index: number) => Promise<ActionResult> | ActionResult;
  /** ADR-022:返回列表视图。 */
  readonly onBack: () => void;
  /**
   * 🔴 **本条规则的索引变了,请把视图状态跟过去**(§1「身份 = 位置 + pattern」)。
   *
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * ## 为什么必须有这个回调(真实栈门禁抓到的缺陷)
   *
   * `editingIndex` 是**位置**,而 §1 明确「`FilterRule` 的身份 = 它在
   * `rules` 中的位置 + `pattern`」—— 一键修复(`onMoveToTop`)**改变位置**,
   * 于是它**改变了正在编辑的那条规则的身份**。
   *
   * 首版漏了这一步,后果在真实栈里被抓到:
   *
   * 1. 在当前页编辑一条**被遮蔽**的规则(设 `editingIndex = 1`);
   * 2. 点「把这条移到最上面 ↑」→ 存储变成 `[本条, 原先的第 1 条]`;
   * 3. `editingIndex` 仍是 `1` —— 现在指向的是**另一条规则**;
   * 4. 此时点「删除」→ `onDelete(1)` 删掉了**用户没在编辑的那条**。
   *
   * 这是静默的数据丢失:用户看着自己那条规则,按了删除,消失的是别人。
   * 「保存」同样受影响(`updateRule(1, …)` 会覆盖另一条规则)。
   *
   * 修法不是在本组件里猜新索引 —— 索引归属**存储**,而本组件不读存储
   * (INV-14 / ADR-055:写入与真相都在仓储层)。故把事实上抛:
   * 一键修复成功后本组件调 `onReindex(0)`(移到最上面即 0 号),
   * 由**持有视图状态的调用方**更新 `editingIndex`。
   *
   * 📌 可选参数,**向后兼容**:不传时行为与首版一致(索引不跟随)。
   *    但调用方若提供了 `onMoveToTop`,就应当一并提供本回调 ——
   *    否则上述缺陷仍在。单测与真实栈门禁都覆盖了「跟过去了」这件事。
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  readonly onReindex?: (nextIndex: number) => void;
  /** ADR-051:锁定中全部控件禁用,且不发 `PREVIEW_FILTER`。 */
  readonly locked?: boolean;
}

export function RuleEditView({
  settings,
  tabState,
  editingIndex,
  previewChannel,
  onSave,
  onDelete,
  onMoveToTop,
  onBack,
  onReindex,
  locked = false,
}: RuleEditViewProps) {
  const existing: FilterRule | undefined =
    editingIndex === null ? undefined : settings.rules[editingIndex];

  /**
   * 草稿状态 —— **不落盘**。
   *
   * ADR-020:新建时 pattern 为空、Grayscale @ 100%。
   * ADR-021:编辑既有规则时以它的现值为初值。
   *
   * 🔴 初值只在**挂载时**取一次(`useState` 的惰性初值)。
   * 若改成 `useEffect` 跟随 `settings` 回灌,用户正在输入的内容会被
   * 另一个窗口的写入(INV-4 的 `onChanged`)覆盖掉 —— 那是数据丢失。
   */
  const [pattern, setPattern] = useState<string>(existing?.pattern ?? '');
  /*
   * 🔴 ADR-075:`mode` 只有初值,**没有 setter** —— 唯一的写入者
   * (模式单选组)已随三个 CVD 模式一起删除。保留这个状态而不直接内联
   * `'Grayscale'`,是因为 ADR-075 要求 `mode` 字段在数据结构里存活:
   * 编辑既有规则时要把它原值带回 `onSave`(ADR-021),
   * 而将来加回模式时这里只需补回 setter。
   *
   * 📌 读到的旧规则可能带 `'RedGreen'` 等已删除的模式字符串,
   * 但它在仓储层的读路径上已被 `coerceFilterMode` 收敛成 `'Grayscale'`
   * (见 `domain/filter-mode.ts` 的迁移说明),故这里拿到的恒为合法值。
   */
  const [mode] = useState<FilterMode>(existing?.mode ?? 'Grayscale');
  const [intensity, setIntensity] = useState<number>(existing?.intensity ?? INTENSITY_MAX);

  /** ADR-046:写入失败的红色报错条(与列表视图同一组件语义)。 */
  const [saveError, setSaveError] = useState<SaveErrorBanner | null>(null);

  // ── §5.6 两维状态行(纯函数判定,见 pattern-status.ts) ──
  const status: PatternStatus = useMemo(
    () =>
      computePatternStatus({
        draftPattern: pattern,
        editingIndex,
        settings,
        tabState,
      }),
    [pattern, editingIndex, settings, tabState],
  );

  // ── §5.7 / ADR-049 预览资格(四种不发送情形) ──
  const eligibility = computePreviewEligibility({
    settings,
    tabState,
    locked,
    matchesCurrentPage: status.matchesCurrentPage,
  });

  const preview = usePreview({ channel: previewChannel, eligibility });

  /**
   * 推一帧预览。
   *
   * 🔴 **不写存储**(ADR-049):这里只有 `preview.push`,
   * 没有任何 `repository.*` / `chrome.storage.*` 调用。
   * 滑块的值到点「保存」时才经仓储层**单次**写入(ADR-061:不防抖)。
   */
  const pushPreview = useCallback(
    (nextMode: FilterMode, nextIntensity: number) => {
      preview.push(nextMode, nextIntensity);
    },
    [preview],
  );

  /**
   * 预览变为可用时补推一帧。
   *
   * 场景:用户边敲 pattern 边看 —— 敲到匹配当前页的那一刻,
   * 页面就该出现预览效果,而此刻没有任何「拖动」事件可挂。
   * 反向(变不可用 → 发 `PREVIEW_CLEAR`)由 `usePreview` 的 effect 负责。
   */
  const availableRef = useRef(preview.available);
  useEffect(() => {
    const was = availableRef.current;
    availableRef.current = preview.available;
    if (preview.available && !was) pushPreview(mode, intensity);
  }, [preview.available, pushPreview, mode, intensity]);

  // ── 禁用判定 ──
  //
  // 🔒 ADR-051:锁定中**全部控件禁用**,含保存与删除(gate:「进入后全部
  //    控件禁用且保存/删除禁用」)。真正的强制在仓储层(INV-14 / ADR-055)。
  const isSkeleton = tabState === null;
  const editingDisabled = locked;
  /**
   * F20:**空 pattern 视为无效,保存按钮禁用** ——
   * 空串不含非法字符,但匹配不了任何东西,会产生一条静默失效的规则。
   * 语法错误时同样禁用(§5.5)。
   */
  const saveDisabled = editingDisabled || !status.valid;

  // ── 动作 ──

  const handleResult = useCallback(
    async (result: Promise<ActionResult> | ActionResult): Promise<ActionResult> => {
      const settled = await result;
      // locked 分类返回 null —— 锁定拒绝不弹红色报错条(T3 gate I1)。
      setSaveError(settled.ok ? null : toSaveErrorBanner(settled.error));
      return settled;
    },
    [],
  );

  /**
   * 🔴 B1 第一条:点「返回」—— **popup 仍开着、端口未断,必须主动发
   * `PREVIEW_CLEAR`**。DESIGN.md 称这是「最容易漏的一条」。
   */
  const handleBack = useCallback(() => {
    preview.clear();
    onBack();
  }, [preview, onBack]);

  /**
   * 🔴 B1 第二条:点「保存」必发 `PREVIEW_CLEAR`。
   *
   * 顺序是「先写入、成功后撤预览并返回」:
   * 写入失败时**留在编辑视图**并显示报错条(ADR-046),预览也不撤 ——
   * 用户的编辑内容与他正看着的页面效果都不该因一次失败而消失。
   */
  const handleSave = useCallback(() => {
    if (saveDisabled) return;
    void handleResult(
      onSave({ pattern, mode, intensity }),
    ).then((settled) => {
      if (!settled.ok) return;
      preview.clear();
      onBack();
    });
  }, [
    saveDisabled,
    handleResult,
    onSave,
    pattern,
    mode,
    intensity,
    preview,
    onBack,
  ]);

  /**
   * 🔴 B1 第三条:点「删除」必发 `PREVIEW_CLEAR`。
   *
   * gate 的完整行为:删除规则 → 发 `PREVIEW_CLEAR` → 页面恢复
   * → 返回列表视图 → 该规则已从列表消失。
   */
  const handleDelete = useCallback(() => {
    if (editingDisabled || editingIndex === null) return;
    void handleResult(onDelete(editingIndex)).then((settled) => {
      if (!settled.ok) return;
      preview.clear();
      onBack();
    });
  }, [editingDisabled, editingIndex, handleResult, onDelete, preview, onBack]);

  /**
   * §5.6 一键修复 + gate 的 **S13**:
   *
   * > 点「把这条移到最上面 ↑」后,不仅列表顺序改变,**当前页面渲染也立即
   * > 变成该规则的滤镜** —— 这个按钮的全部意义就是改变用户看到的东西。
   *
   * 下游效果由两条路共同保证,缺一不可:
   * 1. **立即**推一帧预览 —— 让用户**当下**就看到本条的滤镜,
   *    不必等 reconcile 与下一次导航;
   * 2. 顺序经仓储层落盘 → `storage.onChanged` → T5 广播(INV-4)+
   *    `reconcile()` 更新注册(ADR-062)。
   *
   * 第 1 条是本按钮「全部意义」的承担者:它改变的是**用户看到的东西**。
   * 注意此时预览资格已不再被遮蔽影响 —— `computePreviewEligibility`
   * 只看主开关 / 可注入 / 匹配 / 锁定四项,遮蔽不在其中
   * (被遮蔽说明本条**匹配**当前页,预览本就该能用)。
   */
  const handleMoveToTop = useCallback(() => {
    if (editingDisabled || editingIndex === null) return;
    void handleResult(onMoveToTop(editingIndex)).then((settled) => {
      if (!settled.ok) return;
      /*
       * 🔴 **先把索引跟过去,再推预览。**
       *
       * 「移到最上面」= 本条的新位置是 `0`。而 §1 规定规则的身份是
       * **位置 + pattern**,所以这一步不是锦上添花 —— 不做的话
       * `editingIndex` 会继续指向原来那个位置上**现在的另一条规则**,
       * 随后的「删除」/「保存」就会作用在错误的规则上(真实栈门禁抓到的
       * 缺陷,详见 `onReindex` 的文档)。
       */
      onReindex?.(0);
      pushPreview(mode, intensity);
    });
  }, [
    editingDisabled,
    editingIndex,
    handleResult,
    onMoveToTop,
    onReindex,
    pushPreview,
    mode,
    intensity,
  ]);

  const handlePatternChange = useCallback((next: string) => {
    setPattern(next);
    // 📌 这里**不**主动推预览:pattern 改了之后预览该不该发、该不该撤,
    //    取决于新的匹配结果,那是 `usePreview` 与上面那条 effect 的职责。
    //    在这里猜一次会与它们重复发送。
  }, []);

  const handleIntensityChange = useCallback(
    (next: number) => {
      setIntensity(next);
      // 🔴 **只推预览,不写存储**(ADR-049)。
      pushPreview(mode, next);
    },
    [pushPreview, mode],
  );

  const patternInputId = `pattern-input-${String(editingIndex ?? 'new')}`;

  return (
    <div
      className={`popup${locked ? ' popup--locked' : ''}`}
      data-testid="popup"
      data-view="edit"
      data-locked={locked ? 'true' : 'false'}
      data-skeleton={isSkeleton ? 'true' : 'false'}
    >
      {/* ── 顶栏:返回 + 标题(§5.5) ── */}
      <header className="edit__head">
        <button
          type="button"
          className="edit__back"
          data-testid="back-button"
          onClick={handleBack}
        >
          {BACK_LABEL}
        </button>
        <span className="edit__title" data-testid="edit-title">
          {editingIndex === null ? CREATE_TITLE : EDIT_TITLE}
        </span>
      </header>

      {/* ADR-046:写入失败的红色报错条。锁定拒绝不走这里(T3 gate I1)。 */}
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

      <div className="edit__body">
        {/* ── 网址模式(§5.5) ── */}
        <div className="field">
          <label className="field__label" htmlFor={patternInputId}>
            {PATTERN_LABEL}
          </label>
          {/*
            ADR-033:等宽字体(class `.pattern-input` 用 var(--font-mono))。
            §5.5:语法错误时**输入框描红**。

            🔴 ADR-001 负向:这里**只有**一个手动输入框 ——
               没有「使用当前网站」按钮、没有当前 host 的自动填充。
               规则不绑定当前 tab。
          */}
          <input
            type="text"
            id={patternInputId}
            className={`pattern-input${status.valid ? '' : ' pattern-input--invalid'}`}
            data-testid="pattern-input"
            data-invalid={status.valid ? 'false' : 'true'}
            value={pattern}
            disabled={editingDisabled}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!status.valid}
            onChange={(event) => handlePatternChange(event.target.value)}
          />

          <StatusLine status={status} />

          {/* §5.6 被遮蔽时追加解释框(琥珀底)+ 可点击的一键修复。 */}
          {status.kind === 'shadowed' && status.blockedBy !== null && (
            <div className="shadow-box" data-testid="shadow-box">
              <span>
                {SHADOW_BOX_PREFIX}
                <b data-testid="shadow-box-ordinal">{status.blockedBy.ordinal}</b>
                {SHADOW_BOX_MIDDLE}
                <code className="shadow-box__pattern">
                  {status.blockedBy.pattern}
                </code>
                {SHADOW_BOX_SUFFIX}
              </span>
              {/*
                ADR-022 / I2:这是**重排**入口,不是锁定入口 ——
                编辑视图里不存在任何锁定相关控件。
              */}
              <button
                type="button"
                className="shadow-box__fix"
                data-testid="move-to-top"
                disabled={editingDisabled || editingIndex === null}
                onClick={handleMoveToTop}
              >
                {MOVE_TO_TOP_LABEL}
              </button>
            </div>
          )}
        </div>

        {/*
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          🔴 **ADR-075:滤镜模式单选组已删除。**

          原先这里是一个 `role="radiogroup"`,四项分别是灰阶 / 红绿 / 绿红 / 蓝黄。
          ADR-075 砍掉后三项后,**单选组成了一个只有一个选项的控件** ——
          它既不能表达选择(没有别的可选),也不能被取消(radio 无取消语义),
          点它永远是 no-op。ADR-030 为此明文:
          「编辑视图不再需要模式单选组 —— 只有一个模式时单选组是无意义的控件」。

          ## 为什么不留一个「禁用的单项 radio」占位

          那会给用户一个永远点不动的控件,是比没有控件更差的无障碍结果:
          屏幕阅读器会播报一个 radiogroup 并提示可选,而实际不可选。

          ## `mode` 状态为什么**仍然保留**在本组件里

          规则的 `mode` 字段按 ADR-075 保留(单取值),`onSave` 仍要把它交出去。
          去掉的只是「让用户改它」的 UI,不是这个字段 ——
          将来加回模式时,数据流原样可用,只需把单选组加回这个位置。

          滤镜身份(色块 + 文字名称)仍在列表视图由 `FilterSwatch` 呈现
          (ADR-030 的「色块绝不可无文字名称」在那里依然成立)。
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        */}

        {/* ── 强度(§5.5 / ADR-003) ── */}
        <div className="field field--last">
          <label className="field__label" htmlFor="intensity-slider">
            {INTENSITY_LABEL}
          </label>
          <div className="slider-row">
            {/*
              ADR-003:0–100,**两端均可达**(gate:「滑块边界 0 与 100 均可达;
              强度 0 时页面视觉无变化」)。step=1 → 整数,与 `Intensity` 同构。

              §5.7:**预览不可用时滑块仍可改值**,只是不发 `PREVIEW_FILTER` ——
              故这里的 `disabled` **只看锁定**,不看预览资格。
            */}
            <input
              type="range"
              id="intensity-slider"
              className="slider"
              data-testid="intensity-slider"
              min={INTENSITY_MIN}
              max={INTENSITY_MAX}
              step={1}
              value={intensity}
              disabled={editingDisabled}
              aria-label={INTENSITY_SLIDER_LABEL}
              onChange={(event) =>
                handleIntensityChange(Number(event.target.value))
              }
            />
            <span className="slider__value" data-testid="intensity-value">
              {intensity}%
            </span>
          </div>

          <PreviewHint
            available={preview.available}
            reason={eligibility.available ? null : eligibility.reason}
          />
        </div>
      </div>

      {/* ── 底栏:保存 / 删除(§5.5) ── */}
      <footer className="edit__foot">
        <button
          type="button"
          className="edit__save"
          data-testid="save-button"
          disabled={saveDisabled}
          onClick={handleSave}
        >
          {SAVE_LABEL}
        </button>
        {/* 新建时没有可删的东西 —— 故仅在编辑既有规则时出现。 */}
        {editingIndex !== null && (
          <button
            type="button"
            className="edit__delete"
            data-testid="delete-button"
            disabled={editingDisabled}
            onClick={handleDelete}
          >
            {DELETE_LABEL}
          </button>
        )}
      </footer>
    </div>
  );
}

/* ──────────────────────────── §5.6 状态行 ──────────────────────────── */

/**
 * §5.6 的四种情况,**图标 / 文案 / 色**逐行对齐表格。
 *
 * 颜色由 `.status--{tone}` 的 class 决定,token 取自 §5.1 ——
 * 组件不内联色值(`tokens.css` 的头注释:色值只定义一次)。
 */
function StatusLine({ status }: { readonly status: PatternStatus }) {
  const icon = statusIcon(status.kind);

  return (
    <div
      className={`status status--${status.tone}`}
      data-testid="status-line"
      data-kind={status.kind}
      data-tone={status.tone}
    >
      <span className="status__icon" data-testid="status-icon" aria-hidden="true">
        {icon}
      </span>
      <span data-testid="status-text">
        <StatusText status={status} />
      </span>
    </div>
  );
}

function statusIcon(kind: PatternStatus['kind']): string {
  switch (kind) {
    case 'live':
      return STATUS_ICON_LIVE;
    case 'shadowed':
      return STATUS_ICON_SHADOWED;
    case 'no-match':
      return STATUS_ICON_NO_MATCH;
    case 'illegal-character':
    case 'empty':
    case 'too-long':
      return STATUS_ICON_ERROR;
    default: {
      // 📌 显式穷举:新增一种 kind 会在此被 tsc 收窄成它而非 never(ADR-066)。
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function StatusText({ status }: { readonly status: PatternStatus }) {
  switch (status.kind) {
    case 'live':
      return (
        <>
          {STATUS_LIVE_PREFIX}
          <b>{status.host}</b>
          {STATUS_LIVE_SUFFIX}
        </>
      );
    case 'shadowed':
      return (
        <>
          {STATUS_SHADOWED_PREFIX}
          <b>{STATUS_SHADOWED_STRONG}</b>
        </>
      );
    case 'no-match':
      // host 未知(不可注入页 / 骨架态)时不渲染一个空的加粗段 ——
      // §5.4 另有琥珀条说明原因,状态行不重复报警。
      return (
        <>
          {STATUS_NO_MATCH_PREFIX}
          {status.host !== null && <b>{status.host}</b>}
        </>
      );
    case 'illegal-character':
      return (
        <>
          {STATUS_ERROR_PREFIX}
          <code className="status__char" data-testid="illegal-char">
            {status.illegalChar}
          </code>
          {STATUS_ERROR_SUFFIX}
          <code>*</code>
          {STATUS_ERROR_TAIL}
        </>
      );
    case 'empty':
      // F20:空串不含非法字符,所以不能套用「不能使用 `{char}`」的文案。
      return <>{STATUS_EMPTY_TEXT}</>;
    case 'too-long':
      return <>{STATUS_TOO_LONG_TEXT}</>;
    default: {
      const exhaustive: never = status.kind;
      return exhaustive;
    }
  }
}

/* ───────────────────── §5.7 实时预览提示行 ───────────────────── */

/**
 * §5.7:
 * - 可用 → 绿点**脉冲** + 「拖动时当前页面实时预览」
 *   (`prefers-reduced-motion` 时关闭脉冲动画,见 `popup.css`)
 * - 不可用 → 提示行**置灰并改文案**,**滑块仍可改值**但不发 `PREVIEW_FILTER`
 */
function PreviewHint({
  available,
  reason,
}: {
  readonly available: boolean;
  readonly reason: PreviewBlockReason | null;
}) {
  return (
    <div
      className={`preview-hint${available ? '' : ' preview-hint--off'}`}
      data-testid="preview-hint"
      data-available={available ? 'true' : 'false'}
      data-reason={reason ?? ''}
    >
      <span
        className={`preview-dot${available ? ' preview-dot--pulse' : ''}`}
        data-testid="preview-dot"
        aria-hidden="true"
      />
      <span data-testid="preview-hint-text">
        {available ? PREVIEW_LIVE_HINT : PREVIEW_UNAVAILABLE_HINT}
      </span>
    </div>
  );
}
