/**
 * Popup 的数据接线 —— 把仓储层(T3)与 `TabState`(ADR-044)接到 React。
 *
 * 🔴 **所有写入一律经 `SettingsRepository`**(INV-14 / ADR-055):
 * 锁定强制点在仓储层,直接调 `chrome.storage.*` 会把锁变成假锁。
 *
 * 🔴 **UI 不自己算匹配**(ADR-044):`activeRuleIndex` / `shadowedRuleIndexes`
 * 全部来自 `GET_TAB_STATE`,真相来源唯一。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type FilterRule,
  type FilterSettings,
  defaultSettings,
} from '../domain/index.js';
import { SettingsRepository } from '../storage/settings-repository.js';
import { type TabState, type TabStatePort } from './tab-state.js';
import { type ActionResult } from './RuleListView.js';

export interface PopupSettingsState {
  readonly settings: FilterSettings;
  /** `null` = 尚未收到 `GET_TAB_STATE` 响应 → 骨架态(ADR-044)。 */
  readonly tabState: TabState | null;
  /** 设置是否已从存储读出。读前同样算骨架态。 */
  readonly loaded: boolean;
  readonly toggleMaster: (next: boolean) => Promise<ActionResult>;
  readonly deleteRule: (index: number) => Promise<ActionResult>;
  readonly reorderRules: (rules: readonly FilterRule[]) => Promise<ActionResult>;
  /**
   * 保存一条规则(**T6b 接入点** · ADR-021 / F20)。
   *
   * `index === null` → 新建,走 `addRule`(容量上限由仓储层守,INV-7);
   * 否则走 `updateRule(index, rule)`(ADR-021:模式 / 强度 / 网址均可改)。
   *
   * 🔴 分派放在这里而不是组件里,是为了让编辑视图只认识「保存」这一个动作 ——
   * 新建与修改的差别是**数据层**的事(一个有索引、一个没有),
   * 不该泄漏成界面上的两个按钮。
   *
   * 🔴 **一次写入,立即落盘**(ADR-061:写入立即落盘不做防抖)。
   * 滑块拖动期间**完全不碰存储**(ADR-049 的预览通道),
   * 所以这里不存在「连续高频写入」这个要防抖的对象。
   */
  readonly saveRule: (
    index: number | null,
    rule: FilterRule,
  ) => Promise<ActionResult>;
  /**
   * 把某条规则移到最上面(**T6b** §5.6 的一键修复 · ADR-008 顺序即优先级)。
   *
   * 走 `replaceRules`(**无延迟**,同 `reorderRules` 的 ADR-061 理由)。
   * 索引越界或已在首位时是 no-op,返回成功 —— 用户点一个「已经满足」的
   * 修复按钮不该看到报错条。
   */
  readonly moveRuleToTop: (index: number) => Promise<ActionResult>;
  /**
   * 把一次**本窗口自己**完成的写入结果同步进 React 状态(T6c 接入点)。
   *
   * 仓储层的 `subscribe` 走 `storage.onChanged`,它只在**别处**改动时触发;
   * 本窗口自己的写入必须显式回灌 —— 上面的 `apply` 正是这么做的。
   * 锁定写入(`useLockState`)不走本 hook 的 `apply`(它直接调
   * `repository.setLockUntil`,一次写入,ADR-057 的原子性在仓储层),
   * 故把这个 setter 暴露出来供其回灌。
   *
   * ⚠️ 这**不是**一个绕过仓储层的写入口:它只改 React 的本地状态,
   * 且调用方只应传**仓储层写入成功后返回的那一份** `FilterSettings`
   * (INV-4:真相在存储)。
   */
  readonly syncSettings: (next: FilterSettings) => void;
}

export interface UsePopupSettingsOptions {
  readonly repository: SettingsRepository;
  readonly tabStatePort: TabStatePort;
}

export function usePopupSettings({
  repository,
  tabStatePort,
}: UsePopupSettingsOptions): PopupSettingsState {
  const [settings, setSettings] = useState<FilterSettings>(defaultSettings);
  const [tabState, setTabState] = useState<TabState | null>(null);
  const [loaded, setLoaded] = useState(false);

  /**
   * 🔴 端口存进 ref,**不作为 effect 的依赖项**。
   *
   * `tabStatePort` 是一个函数。调用方极自然地会写
   * `usePopupSettings({ repository, tabStatePort: chromeTabStatePort() })` ——
   * 那样每次 render 都是一个新引用,若它出现在依赖数组里,effect 就会
   * 「拆订阅 → 重订阅 → setState → 再 render」无限循环,popup 直接卡死。
   *
   * 端口的**身份**不承载语义(它只是「怎么问 service worker」),
   * 真正需要重新接线的只有 `repository` 换了的时候。故用 ref 持有最新值,
   * 依赖数组只留 `repository`。
   */
  const portRef = useRef(tabStatePort);
  portRef.current = tabStatePort;

  /**
   * 重新向 service worker 要一次 `TabState`(ADR-044)。
   *
   * 🔴 **为什么写入之后必须重问一次**
   *
   * `activeRuleIndex` / `shadowedRuleIndexes` 是**存储索引** —— 它们描述的是
   * service worker 上次 `resolveRule` 时的那份 `rules`。任何改变规则顺序或
   * 内容的写入(一键修复、保存、删除、改主开关)都会让这两个字段**失效**:
   * §5.6 的一键修复把本条移到首位后,旧的 `TabState` 仍说「本条被遮蔽」。
   *
   * ADR-044 规定两个视图都不自己算匹配、真相来源唯一。那么当真相变了,
   * 正确的做法是**重新去问那个唯一的真相来源**,而不是在 UI 里自己推算
   * 新索引 —— 后者就是 ADR-044 要禁止的事。
   */
  const refreshTabState = useCallback(() => {
    void portRef.current().then((s) => {
      setTabState(s);
    });
  }, []);

  useEffect(() => {
    let alive = true;

    void repository.read().then((s) => {
      if (!alive) return;
      setSettings(s);
      setLoaded(true);
    });

    // ADR-044:端口自带超时降级,这里不再加一层 —— 两层超时只会互相掩盖。
    void portRef.current().then((s) => {
      if (alive) setTabState(s);
    });

    // INV-4:另一处(其他 popup / service worker)改了设置,本视图立即跟进。
    //
    // 🔴 设置变了 → `TabState` 的两个索引字段可能已失效,一并重问(见
    //    `refreshTabState` 的注释)。
    const unsubscribe = repository.subscribe((next) => {
      if (!alive) return;
      setSettings(next);
      refreshTabState();
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [repository, refreshTabState]);

  /**
   * 🔴 **这里曾经有一个「popup 拆除前 flush 防抖队列」的 effect —— 已删除。**
   *
   * ADR-061:
   * > 上一轮的「关闭时强制 flush」**已被证伪** —— popup 销毁时异步存储调用
   * > 来不及完成。**消除那 300ms,而不是抢救它。**
   *
   * `chrome.storage.local` 是**跨进程 IPC**:`pagehide` 里发出的写请求在
   * 文档被拆掉时还在飞,浏览器进程那一侧的回调永远不会回到一个已经不存在的
   * JS 上下文。拆除时补写在原理上就救不回来。
   *
   * 真正的解法在下面的 `reorderRules` —— **松手即写,根本不存在待落盘的队列**。
   * 回归测试见 `__tests__/reorder-immediate.test.tsx`(异步 IPC + 文档销毁)。
   */

  const apply = useCallback(
    async (
      run: () => Promise<
        { ok: true; value: FilterSettings } | { ok: false; error: ActionError }
      >,
    ): Promise<ActionResult> => {
      const result = await run();
      if (result.ok) {
        setSettings(result.value);
        /*
         * 🔴 ADR-044:写入改变了 `rules`,service worker 的
         * `activeRuleIndex` / `shadowedRuleIndexes` 随之改变 —— 重新去问它。
         *
         * `repository.subscribe` 走 `storage.onChanged`,**本窗口自己的写入
         * 不会回调自己**(见 `syncSettings` 的注释),故此处必须显式刷新,
         * 否则 §5.6 的状态行会停在写入**之前**的那份索引上:
         * 一键修复把本条移到首位后,状态行仍显示「被遮蔽」。
         */
        refreshTabState();
        return { ok: true };
      }
      return { ok: false, error: result.error };
    },
    [refreshTabState],
  );

  const toggleMaster = useCallback(
    (next: boolean) => apply(() => repository.setMasterEnabled(next)),
    [apply, repository],
  );

  const deleteRule = useCallback(
    (index: number) => apply(() => repository.removeRule(index)),
    [apply, repository],
  );

  /**
   * 🔴 **重排:松手即写入,不走防抖**(ADR-061 / ADR-008 / INV-6)。
   *
   * 走 `replaceRules`(**无延迟**),不是 `reorderRulesDebounced`(300ms 窗口)。
   *
   * > ADR-061:防抖是为**连续高频事件**设计的,那是滑块的特征 —— 但滑块已改走
   * > ADR-049 预览通道、根本不写存储,防抖因此**失去了服务对象**。
   * > 拖拽松手是**一次性动作**,不需要防抖。
   *
   * 真机实测(3/3 复现):重排后 300ms 内 popup 关闭(Chrome 弹窗一失焦即销毁)
   * 会**静默丢失顺序**。而 ADR-008 让列表顺序**就是**优先级,
   * 丢一次重排即静默改变实际生效的滤镜(违反 INV-6),且用户不会收到任何提示。
   *
   * ⚠️ **仍然全程经仓储层**(INV-14 / ADR-055):`replaceRules` 内部照常做锁定
   * 检查与规则校验。消除的只是**防抖延迟**,不是任何一层守卫 ——
   * 绕过仓储层直接写 `chrome.storage.*` 会把锁变成假锁。
   *
   * ⚠️ 仓储层的 `reorderRulesDebounced` / `flush()` **保留不动**(向后兼容):
   * 本次改的是**调用方的选择**,不是 T3 的 API。
   */
  const reorderRules = useCallback(
    (rules: readonly FilterRule[]) => apply(() => repository.replaceRules(rules)),
    [apply, repository],
  );

  /**
   * 🔴 **保存一条规则(T6b)**:新建 → `addRule`,编辑 → `updateRule`。
   *
   * ⚠️ 全程经仓储层(INV-14 / ADR-055):锁定检查、pattern 校验、
   * 容量上限(INV-7)都在那一层。绕过它直接写 `chrome.storage.*`
   * 会把锁变成假锁,也会让第 21 条规则悄悄写进去。
   *
   * ⚠️ 走 `addRule` / `updateRule`(**立即落盘**),不走
   * `reorderRulesDebounced` —— ADR-061:滑块已改走预览通道、不写存储,
   * 防抖**失去了服务对象**;点保存是一次性动作。
   */
  const saveRule = useCallback(
    (index: number | null, rule: FilterRule) =>
      apply(() =>
        index === null
          ? repository.addRule(rule)
          : repository.updateRule(index, rule),
      ),
    [apply, repository],
  );

  /**
   * §5.6 的一键修复 —— 把 `index` 移到最前(ADR-008:顺序即优先级)。
   *
   * 🔴 读的是 `await repository.read()` —— **存储里那一份**,不是 React 状态
   * 里的 `settings.rules`(INV-4:真相在存储)。若读 React 状态,另一个窗口
   * 刚写入的改动会被本次 `replaceRules` 按旧快照覆盖掉。
   *
   * 写入与列表视图的拖拽(`reorderRules`)同一条路径、同一套校验。
   */
  const moveRuleToTop = useCallback(
    (index: number) =>
      apply(async () => {
        const current = await repository.read();
        const rules = [...current.rules];
        const target = rules[index];
        // 越界 / 已在首位 → 什么都不做,但报告成功:
        // 一个「已经满足」的修复点击不该弹红色报错条(ADR-046 的同一精神)。
        if (target === undefined || index === 0) {
          return { ok: true as const, value: current };
        }
        rules.splice(index, 1);
        rules.unshift(target);
        return repository.replaceRules(rules);
      }),
    [apply, repository],
  );

  /** 见 `PopupSettingsState.syncSettings`。 */
  const syncSettings = useCallback((next: FilterSettings) => {
    setSettings(next);
  }, []);

  return useMemo(
    () => ({
      settings,
      tabState,
      loaded,
      toggleMaster,
      deleteRule,
      reorderRules,
      saveRule,
      moveRuleToTop,
      syncSettings,
    }),
    [
      settings,
      tabState,
      loaded,
      toggleMaster,
      deleteRule,
      reorderRules,
      saveRule,
      moveRuleToTop,
      syncSettings,
    ],
  );
}

/** 与 `WriteError` 同构 —— 这里只需要它的存在性,避免重复 import 造成的循环。 */
type ActionError = Extract<ActionResult, { ok: false }>['error'];
