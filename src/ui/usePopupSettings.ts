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
    const unsubscribe = repository.subscribe((next) => {
      if (alive) setSettings(next);
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [repository]);

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
        return { ok: true };
      }
      return { ok: false, error: result.error };
    },
    [],
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

  return useMemo(
    () => ({ settings, tabState, loaded, toggleMaster, deleteRule, reorderRules }),
    [settings, tabState, loaded, toggleMaster, deleteRule, reorderRules],
  );
}

/** 与 `WriteError` 同构 —— 这里只需要它的存在性,避免重复 import 造成的循环。 */
type ActionError = Extract<ActionResult, { ok: false }>['error'];
