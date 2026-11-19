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
   * 重排走**防抖**版本(T3 的 `reorderRulesDebounced`)——
   * 拖拽是「列表侧的连续操作」,正是该方法的适用范围。
   */
  const reorderRules = useCallback(
    (rules: readonly FilterRule[]) =>
      apply(() => repository.reorderRulesDebounced(rules)),
    [apply, repository],
  );

  return useMemo(
    () => ({ settings, tabState, loaded, toggleMaster, deleteRule, reorderRules }),
    [settings, tabState, loaded, toggleMaster, deleteRule, reorderRules],
  );
}

/** 与 `WriteError` 同构 —— 这里只需要它的存在性,避免重复 import 造成的循环。 */
type ActionError = Extract<ActionResult, { ok: false }>['error'];
