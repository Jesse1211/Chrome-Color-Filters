/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * `BackgroundCoordinator` —— T5:后台协调与图标状态。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * §6 T5 spec 的四条职责,逐条落在本类上:
 *
 * | spec 条款 | 实现 |
 * |-----------|------|
 * | tab 导航时解析适用规则 | `handleNavigation()` ← `tabs.onUpdated` / `onActivated` |
 * | 匹配同一规则的所有 tab 即时同步(INV-4) | `syncAllTabs()` ← 仓储层 `subscribe()` |
 * | 按当前 tab 是否**实际生效**更新图标两态(ADR-019) | `iconStateFor()` + `ActionPort.setIcon` |
 * | 识别不可注入页面并向 popup 上报(ADR-013) | `handleMessage()` → `computeTabState()` |
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 🔴 与 T4a 的 `reconcile()` 是**两件事**,必须共存
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * `Reconciler`(ADR-062/064/065)管的是**下一次导航的首帧**:它把声明式注册
 * 写进浏览器磁盘上的 StateStore,于是 CSS 在首帧之前到场(INV-3)。
 * 本类管的是**运行时**:已打开 tab 的图标、popup 的状态查询、
 * 以及设置变更后已打开 tab 的即时一致(INV-4)。
 *
 * 两者**都订阅**仓储层的变更,这是刻意的而非重复:
 * reconcile 改注册(影响未来的导航),本类改图标与广播(影响当下的 tab)。
 * 本类**绝不**调用 `chrome.scripting.*` —— 注册的唯一写入者是 `Reconciler`,
 * 两处都写会制造 ADR-064 所防的并发重复注册。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 🔴 MV3:service worker 不是真相来源
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * > §6 T5 注:MV3 service worker 非持久化,随时可能被终止 ——
 * > **它不可以是聚合的真相来源**,真相在 `chrome.storage`。
 *
 * 本类据此**不持有任何设置快照**:每个事件回调都重新
 * `await readSettings()`(即仓储层 → `chrome.storage.local`)。
 * 唯一的实例状态是 `#unsubscribes`(监听器句柄,随 worker 一同消亡,
 * 本就无需存活)。于是 worker 在任意时刻被终止、下次被事件唤醒后,
 * 行为与从未终止过完全一致 —— 这正是 §6 T5 的 REAL_STACK_GATE
 * (「终止 worker 后打开匹配站点,滤镜仍正确应用」)所要证明的性质。
 *
 * 📌 顺带一提:滤镜本身的正确应用并**不依赖**本类 —— 首帧来自磁盘注册
 * (ADR-062),运行时来自 content script 自己读 storage(T4a)。本类只负责
 * 图标与 popup 查询。worker 被终止时图标会退回 manifest 的静态默认值
 * (`inactive`,见 `wxt.config.ts`),而 `inactive` 恰是「保守方向」:
 * 它不会谎称某页被改色了。tab 切换/导航会立刻唤醒 worker 并纠正。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## 为什么全部平台能力经端口注入
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 与 `reconcile.ts` / `injector.ts` 同一手法(ADR-062 建立的模式):
 * 本类零 `chrome.*`,故 §6 T5 gate 的「3 个 tab 即时同步」「图标两态」
 * 「reason 取值正确」都能在 Node 下**机械判定**,而不是「在真实 Chrome 里
 * 看一眼」。生产装配在 `background-ports.ts`。
 * (§8 第 8 条对 mock 绿灯的限制针对 REAL_STACK_GATE 那类端到端断言,
 * 本类的单测不冒充它 —— REAL_STACK_GATE 仍须在真实 Chrome 中跑。)
 */

import { type FilterSettings } from '../domain/index.js';
import {
  GET_TAB_STATE,
  type TabState,
  FALLBACK_TAB_STATE,
} from '../ui/tab-state.js';
import { type TabLike, computeTabState, tabUrl } from './compute-tab-state.js';
import { type IconState, iconPathsFor, iconStateFor } from './icon-state.js';

/** `chrome.tabs` 中本类用到的子集。 */
export interface TabsPort {
  /** 查询 tab。`query({ active: true, lastFocusedWindow: true })` 取当前 tab。 */
  query(info: TabQueryInfo): Promise<readonly TabLike[]>;
  /** 取单个 tab;不存在时 resolve 为 null(不抛)。 */
  get?(tabId: number): Promise<TabLike | null>;
}

export interface TabQueryInfo {
  readonly active?: boolean;
  readonly lastFocusedWindow?: boolean;
  readonly currentWindow?: boolean;
}

/** `chrome.action` 中本类用到的子集(ADR-019 / ADR-045)。 */
export interface ActionPort {
  setIcon(details: {
    readonly tabId?: number;
    readonly path: Readonly<Record<string, string>>;
  }): Promise<void>;
  /** 悬浮提示 —— 两态的文字版,可选(平台或降级端口可能没有)。 */
  setTitle?(details: {
    readonly tabId?: number;
    readonly title: string;
  }): Promise<void>;
}

/** 事件源 —— 把 `chrome.tabs.onUpdated` 等收束为可注入的订阅函数。 */
export interface BackgroundEventsPort {
  /** tab 导航/状态变化。`onUpdated(tabId, changeInfo, tab)`。 */
  onTabUpdated(
    listener: (tabId: number, changeInfo: TabChangeInfo, tab: TabLike) => void,
  ): () => void;
  /** 用户切到另一个 tab。 */
  onTabActivated(listener: (tabId: number) => void): () => void;
  /** 窗口焦点变化 —— 多窗口下「当前 tab」会变,而 `onActivated` 不触发。 */
  onWindowFocusChanged?(listener: (windowId: number) => void): () => void;
}

export interface TabChangeInfo {
  readonly status?: string;
  readonly url?: string;
}

/**
 * 消息端口 —— `chrome.runtime.onMessage` 的可注入形态。
 *
 * 回调返回 `Promise<TabState> | null`:
 * - `Promise` → 本类认领了该消息,平台侧须保持通道开启并回传结果;
 * - `null` → 不是本类的消息,交给别的监听器(未来 T6b 的 `PREVIEW_FILTER`
 *   走独立通道 ADR-049,**不经本类**,故此处必须能「不认领」)。
 */
export interface MessagingPort {
  onMessage(
    handler: (message: unknown) => Promise<TabState> | null,
  ): () => void;
}

export interface CoordinatorDeps {
  readonly tabs: TabsPort;
  readonly action: ActionPort;
  readonly events: BackgroundEventsPort;
  readonly messaging: MessagingPort;
  /** 读取权威设置(= `chrome.storage.local`,真相来源)。 */
  readonly readSettings: () => Promise<FilterSettings>;
  /**
   * 订阅设置变更 —— INV-4 的触发源。
   *
   * 生产环境是 `SettingsRepository.subscribe()`,它同时覆盖
   * `chrome.storage.onChanged`(别的窗口改了设置)与本进程写入后的通知
   * (与 T3 gate 的「`onChanged` 订阅回调正确触发 —— 这是 INV-4 的基础机制」
   * 同一个机制)。
   */
  readonly subscribeSettings: (listener: () => void) => () => void;
  /** 诊断回调(可选)—— 平台调用失败时唯一的可观测出口。 */
  readonly onError?: (where: string, error: unknown) => void;
}

/** 两态的悬浮提示文案(ADR-019 的文字版;中文,ADR-047 首版不做 i18n)。 */
export const ICON_TITLES: Readonly<Record<IconState, string>> = {
  active: 'Chrome Color Filters —— 此页已套用滤镜',
  inactive: 'Chrome Color Filters —— 此页未套用滤镜',
};

export class BackgroundCoordinator {
  readonly #deps: CoordinatorDeps;
  readonly #unsubscribes: (() => void)[] = [];
  #started = false;

  /**
   * 图标更新的单调纪元号 —— 陈旧覆盖防护(见 `#applyIcon` 的长注释)。
   *
   * 📌 这**不违反**「SW 不可以是真相来源」(§6 T5 注):它不是设置的缓存,
   * 而是本次 worker 生命周期内的并发仲裁。worker 被终止后计数器归零,
   * 而彼时所有在途更新也一并消失 —— 没有跨生命周期的陈旧写入需要挡。
   */
  #epoch = 0;

  /** tabId → 已应用的最大纪元号。 */
  readonly #appliedEpoch = new Map<number, number>();

  constructor(deps: CoordinatorDeps) {
    this.#deps = deps;
  }

  /**
   * 挂上全部监听并做一次初始同步。
   *
   * 幂等:重复调用只装一次监听(与 `reconcile()` 的幂等同一理由 ——
   * SW 入口在某些时序下可能被求值多次,装两套监听会让每个事件处理两遍)。
   */
  start(): void {
    if (this.#started) return;
    this.#started = true;

    this.#unsubscribes.push(
      this.#deps.events.onTabUpdated((tabId, changeInfo, tab) => {
        // 🔴 只在导航相关的变化上重算 —— `onUpdated` 还会为 title/favicon/audible
        // 等变化触发,每次都重读 storage 是无谓的 I/O。
        // `changeInfo.url` 出现 = 已提交新 URL;`status` 变化 = 加载进度推进
        // (`loading` 阶段 URL 已定,图标应当尽早正确,不等 `complete`)。
        if (changeInfo.url === undefined && changeInfo.status === undefined) {
          return;
        }
        void this.handleNavigation(tabId, tab);
      }),
    );

    this.#unsubscribes.push(
      this.#deps.events.onTabActivated((tabId) => {
        void this.handleActivated(tabId);
      }),
    );

    if (this.#deps.events.onWindowFocusChanged) {
      this.#unsubscribes.push(
        this.#deps.events.onWindowFocusChanged(() => {
          // 焦点换窗口 → 「当前 tab」变了,但 onActivated 不触发。
          void this.syncActiveTab();
        }),
      );
    }

    // ── INV-4:匹配同一规则的所有 tab 即时同步 ──────────────────────────
    //
    // 规则是**全局**的(ADR-014 的推导:「由『规则是全局的』直接推出;
    // 不存在两个 tab 显示不同颜色」),所以这里不去挑「哪些 tab 匹配了
    // 被改动的那条规则」—— 一条规则的增删改都可能让任意 tab 的归属改变
    // (例如删掉 rules[0] 会让原先被遮蔽的 rules[1] 在若干 tab 上转为生效)。
    // 故对**全部** tab 重算图标。tab 数量级是几十,一次纯函数判定,成本可忽略。
    //
    // 📌 页面滤镜本身的即时同步由 content script 自己的 storage 订阅完成
    // (T4a `injector.ts` 的 `subscribeSettings`)—— 那是 INV-4 在**像素**上的
    // 实现;本处是 INV-4 在**图标**上的实现。两者必须同时成立,
    // 否则会出现「页面变灰了但图标还亮着」这类用户可见的不一致。
    this.#unsubscribes.push(
      this.#deps.subscribeSettings(() => {
        void this.syncAllTabs();
      }),
    );

    this.#unsubscribes.push(
      this.#deps.messaging.onMessage((message) => this.handleMessage(message)),
    );

    // 冷启动/被唤醒时先把当前 tab 的图标摆正(worker 被终止期间图标退回
    // manifest 默认的 inactive,见类注释)。
    void this.syncActiveTab();
  }

  /** 卸掉全部监听(测试与热重载用)。 */
  stop(): void {
    this.#appliedEpoch.clear();
    for (const off of this.#unsubscribes.splice(0)) {
      try {
        off();
      } catch (error) {
        this.#deps.onError?.('unsubscribe', error);
      }
    }
    this.#started = false;
  }

  /**
   * 处理 `GET_TAB_STATE`(ADR-044)。
   *
   * 不是本类的消息 → 返回 `null`(见 `MessagingPort` 的文档)。
   *
   * 🔴 **永不 reject。** popup 是用户唯一的控制入口;一个被拒绝的 Promise
   * 会让 `chrome.runtime.sendMessage` 抛到 popup 侧,而 popup 的处理是
   * 降级为 `no-tab`(ADR-044)—— 用户看到的是「此页面不支持滤镜」,
   * 而真相可能只是 `tabs.query` 偶发失败。故失败一律在此处收敛为
   * `FALLBACK_TAB_STATE`(与超时降级同值,语义一致)。
   */
  handleMessage(message: unknown): Promise<TabState> | null {
    if (!isGetTabStateMessage(message)) return null;
    return this.currentTabState().catch((error): TabState => {
      this.#deps.onError?.('handleMessage', error);
      return FALLBACK_TAB_STATE;
    });
  }

  /**
   * 算出当前 tab 的 `TabState`(ADR-044)。
   *
   * 每次都重读 settings —— 见类注释「service worker 不是真相来源」。
   */
  async currentTabState(): Promise<TabState> {
    const [settings, tab] = await Promise.all([
      this.#deps.readSettings(),
      this.#activeTab(),
    ]);
    return computeTabState(settings, tab);
  }

  /** 某个 tab 导航后:重算它的图标。 */
  async handleNavigation(tabId: number, tab: TabLike): Promise<void> {
    const epoch = this.#nextEpoch();
    const settings = await this.#readSettingsSafely('handleNavigation');
    if (settings === null) return;
    await this.#applyIcon(tabId, tabUrl(tab), settings, epoch);
  }

  /** 用户切到某个 tab:重算它的图标(URL 需回查,`onActivated` 只给 id)。 */
  async handleActivated(tabId: number): Promise<void> {
    const epoch = this.#nextEpoch();
    const settings = await this.#readSettingsSafely('handleActivated');
    if (settings === null) return;
    const tab = await this.#tabById(tabId);
    if (tab === null) return;
    await this.#applyIcon(tabId, tabUrl(tab), settings, epoch);
  }

  /** 把当前活动 tab 的图标摆正。 */
  async syncActiveTab(): Promise<void> {
    const epoch = this.#nextEpoch();
    const settings = await this.#readSettingsSafely('syncActiveTab');
    if (settings === null) return;
    const tab = await this.#activeTab();
    if (tab === null || tab.id === undefined) return;
    await this.#applyIcon(tab.id, tabUrl(tab), settings, epoch);
  }

  /**
   * INV-4 / INV-8:对**全部** tab 重算图标。
   *
   * 主开关 OFF 时每个 tab 都算成 `inactive` —— 这就是 §6 T5 gate 的
   * 「主开关 OFF → ... 图标**全灰**」(INV-8 / ADR-019)。
   * 不是「只改当前 tab」:用户关掉主开关后切到别的 tab,那个 tab 的图标
   * 若还亮着,就是在谎称该页被改色了。
   */
  async syncAllTabs(): Promise<void> {
    const epoch = this.#nextEpoch();
    const settings = await this.#readSettingsSafely('syncAllTabs');
    if (settings === null) return;
    const tabs = await this.#queryTabs({});
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      await this.#applyIcon(tab.id, tabUrl(tab), settings, epoch);
    }
  }

  /** 某个 tab 当下应当是哪一态(诊断与测试用的只读查询)。 */
  iconStateOf(settings: FilterSettings, url: string | null): IconState {
    return iconStateFor(settings, url);
  }

  /**
   * 分配一个图标更新**纪元号**。
   *
   * 🔴 必须在 `readSettings()` **之前**调用 —— 纪元号的全部意义就是记录
   * 「本次更新读到的是哪一代设置」。在读之后分配会让一次读了旧设置的慢更新
   * 拿到更大的号,陈旧覆盖就挡不住了(见 `#applyIcon` 的论证)。
   */
  #nextEpoch(): number {
    this.#epoch += 1;
    return this.#epoch;
  }

  /**
   * 写图标。
   *
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 🔴 **陈旧覆盖防护(本轮由单测驱动发现的真实缺陷)**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   *
   * 图标更新有五个并发入口(`start` 的初始同步、`onUpdated`、`onActivated`、
   * 窗口焦点变化、设置变更的 `syncAllTabs`),每一个都要先 `await` 一次
   * `readSettings()`(真相在 `chrome.storage`,§6 T5 注)。于是**完成顺序
   * 不等于发起顺序**:
   *
   * ```
   * A: syncActiveTab()  → readSettings() 开始(读到 rules: [])
   * B: 用户加了一条规则 → syncAllTabs() → readSettings()(读到新规则)
   * B: setIcon(tab1, active)   ← 正确
   * A: setIcon(tab1, inactive) ← 🔴 **用旧设置覆盖了新结果**
   * ```
   *
   * 后果不是一帧的抖动,而是**持续错误**:图标会一直停在 `inactive`,
   * 直到下一个 tab 事件偶然把它纠正。用户看到的是「规则加上了、页面变灰了,
   * 但图标说没生效」—— ADR-019 的「亮 = 这页被改色了」当场失效,
   * 且是 §6 T5 gate「图标两态正确」的直接违反。
   *
   * 真实 Chrome 里这个交错是**普通时序**,不是极端竞态:popup 写入设置会
   * 同时唤醒 SW(若它正休眠)并触发 `storage.onChanged`,于是
   * 「冷启动的初始同步」与「设置变更的全量同步」几乎必然重叠。
   *
   * 修法:每次更新在**读设置之前**领一个单调递增的纪元号;写之前比对
   * 该 tab 已应用的最大纪元号,**更旧的一律丢弃**。这不是「加个锁」——
   * 丢弃比排队更正确:被丢弃的那次算出的本就是过时答案,排队执行它
   * 只会先写一个错值再等下一个事件纠正。
   *
   * 📌 与 `reconcile()` 的串行化(`reconciler.ts`)是同类问题的两种解法:
   * 那里必须串行,因为重复 `register` 会**抛错**连带整批失败;这里丢弃即可,
   * 因为 `setIcon` 幂等且只有最后一次可见。
   */
  async #applyIcon(
    tabId: number,
    url: string | null,
    settings: FilterSettings,
    epoch: number,
  ): Promise<void> {
    const applied = this.#appliedEpoch.get(tabId);
    if (applied !== undefined && applied > epoch) return; // 陈旧,丢弃
    this.#appliedEpoch.set(tabId, epoch);

    const state = iconStateFor(settings, url);
    try {
      await this.#deps.action.setIcon({ tabId, path: iconPathsFor(state) });
    } catch (error) {
      // tab 可能在 await 之间被关掉(`No tab with id`)—— 这是正常竞态,
      // 不是缺陷。记一条诊断即可,**不抛**:抛出去会在 SW 里变成
      // 一条无人处理的 unhandled rejection(与 `reconcile.ts` 同一论证)。
      this.#deps.onError?.('setIcon', error);
    }
    if (this.#deps.action.setTitle) {
      try {
        await this.#deps.action.setTitle({ tabId, title: ICON_TITLES[state] });
      } catch (error) {
        this.#deps.onError?.('setTitle', error);
      }
    }
  }

  async #readSettingsSafely(where: string): Promise<FilterSettings | null> {
    try {
      return await this.#deps.readSettings();
    } catch (error) {
      // 仓储层本就有 ADR-041 的默认值回退,走到这里是极端情况。
      this.#deps.onError?.(where, error);
      return null;
    }
  }

  async #activeTab(): Promise<TabLike | null> {
    // `lastFocusedWindow` 而非 `currentWindow`:popup 打开时「当前窗口」
    // 在某些平台上是 popup 自己所属的窗口,取不到用户正在看的那个 tab。
    const byFocus = await this.#queryTabs({
      active: true,
      lastFocusedWindow: true,
    });
    if (byFocus.length > 0 && byFocus[0] !== undefined) return byFocus[0];
    const byCurrent = await this.#queryTabs({ active: true, currentWindow: true });
    if (byCurrent.length > 0 && byCurrent[0] !== undefined) return byCurrent[0];
    return null;
  }

  async #queryTabs(info: TabQueryInfo): Promise<readonly TabLike[]> {
    try {
      return await this.#deps.tabs.query(info);
    } catch (error) {
      this.#deps.onError?.('tabs.query', error);
      return [];
    }
  }

  async #tabById(tabId: number): Promise<TabLike | null> {
    const get = this.#deps.tabs.get;
    if (get === undefined) return null;
    try {
      return await get.call(this.#deps.tabs, tabId);
    } catch (error) {
      this.#deps.onError?.('tabs.get', error);
      return null;
    }
  }
}

/** 严格的消息识别 —— 只认 ADR-044 逐字的 `{ type: 'GET_TAB_STATE' }`。 */
export function isGetTabStateMessage(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return false;
  return (message as { type?: unknown }).type === GET_TAB_STATE;
}
