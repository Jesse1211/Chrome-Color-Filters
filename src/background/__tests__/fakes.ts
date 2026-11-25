/**
 * T5 协调器单测用的内存替身。
 *
 * 全部平台能力经端口注入(见 `coordinator.ts` 的文件头),于是
 * §6 T5 gate 的「3 个 tab 即时同步」「图标全灰」等条款可以在 Node 下
 * **机械判定**,而不是「在真实 Chrome 里看一眼」。
 *
 * ⚠️ 这些替身**不冒充 REAL_STACK_GATE**:§8 第 8 条明确「jsdom/mock 下的
 * 绿灯不构成通过」,T5 的 REAL_STACK_GATE(终止 worker 后滤镜仍生效)
 * 仍须在真实 Chrome 中跑。
 */
import {
  type ActionPort,
  type BackgroundEventsPort,
  type MessagingPort,
  type TabChangeInfo,
  type TabQueryInfo,
  type TabsPort,
} from '../coordinator.js';
import { type TabLike } from '../compute-tab-state.js';
import { type TabState } from '../../ui/tab-state.js';

/**
 * 🔴 `url` 是**可选**的 —— 这不是图方便,而是修一个让门禁瞎掉的建模错误。
 *
 * 原先 `url: string` 是必填,于是整个测试套件**根本无法表达**真实 Chrome 上
 * 最关键的那个形态:`chrome://` 页的 tab 对象里 `url` 被浏览器**整个扣留**
 * (连 key 都没有,实测见 `wxt.config.ts` 里 `tabs` 权限那段)。
 * 测试只能把 URL 字符串直接喂给纯函数,而真实 SW 在 `chrome://` 页上
 * **永远到不了**那个状态 —— ADR-044 契约字段的错值因此一路绿灯,
 * 直到真实栈才暴露。
 *
 * **能表达的状态才测得到。** 保留 `url?: string` 让「tab 没有 url」
 * 成为一等公民形态。
 */
export interface FakeTab {
  id: number;
  url?: string;
  pendingUrl?: string;
  active?: boolean;
  windowId?: number;
}

export class FakeTabs implements TabsPort {
  tabs: FakeTab[];
  /** 下一次 query 抛错(测单次失败后的自愈)。 */
  failNext = false;
  /** 每次 query 都抛错(测持续失败的降级)。 */
  failAlways = false;

  constructor(tabs: FakeTab[] = []) {
    this.tabs = tabs;
  }

  async query(info: TabQueryInfo): Promise<readonly TabLike[]> {
    if (this.failAlways) throw new Error('tabs.query failed');
    if (this.failNext) {
      this.failNext = false;
      throw new Error('tabs.query failed');
    }
    if (info.active === true) return this.tabs.filter((t) => t.active === true);
    return [...this.tabs];
  }

  async get(tabId: number): Promise<TabLike | null> {
    return this.tabs.find((t) => t.id === tabId) ?? null;
  }
}

export interface IconCall {
  tabId: number | undefined;
  path: Readonly<Record<string, string>>;
}

export class FakeAction implements ActionPort {
  readonly calls: IconCall[] = [];
  readonly titles: { tabId: number | undefined; title: string }[] = [];
  failNext = false;

  async setIcon(details: {
    tabId?: number;
    path: Readonly<Record<string, string>>;
  }): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('No tab with id');
    }
    this.calls.push({ tabId: details.tabId, path: details.path });
  }

  async setTitle(details: { tabId?: number; title: string }): Promise<void> {
    this.titles.push({ tabId: details.tabId, title: details.title });
  }

  /** 某个 tab 最后一次被设置的图标态('active' / 'inactive';未设置则 undefined)。 */
  stateOf(tabId: number): 'active' | 'inactive' | undefined {
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const call = this.calls[i];
      if (call === undefined || call.tabId !== tabId) continue;
      const p16 = call.path['16'];
      if (p16 === undefined) return undefined;
      return p16.includes('/active/') ? 'active' : 'inactive';
    }
    return undefined;
  }

  reset(): void {
    this.calls.length = 0;
    this.titles.length = 0;
  }
}

export class FakeEvents implements BackgroundEventsPort {
  readonly updated: ((tabId: number, info: TabChangeInfo, tab: TabLike) => void)[] = [];
  readonly activated: ((tabId: number) => void)[] = [];
  readonly focusChanged: ((windowId: number) => void)[] = [];

  onTabUpdated(
    listener: (tabId: number, info: TabChangeInfo, tab: TabLike) => void,
  ): () => void {
    this.updated.push(listener);
    return () => {
      const i = this.updated.indexOf(listener);
      if (i >= 0) this.updated.splice(i, 1);
    };
  }

  onTabActivated(listener: (tabId: number) => void): () => void {
    this.activated.push(listener);
    return () => {
      const i = this.activated.indexOf(listener);
      if (i >= 0) this.activated.splice(i, 1);
    };
  }

  onWindowFocusChanged(listener: (windowId: number) => void): () => void {
    this.focusChanged.push(listener);
    return () => {
      const i = this.focusChanged.indexOf(listener);
      if (i >= 0) this.focusChanged.splice(i, 1);
    };
  }

  emitUpdated(tabId: number, info: TabChangeInfo, tab: TabLike): void {
    for (const l of [...this.updated]) l(tabId, info, tab);
  }

  emitActivated(tabId: number): void {
    for (const l of [...this.activated]) l(tabId);
  }

  emitFocusChanged(windowId: number): void {
    for (const l of [...this.focusChanged]) l(windowId);
  }
}

export class FakeMessaging implements MessagingPort {
  readonly handlers: ((message: unknown) => Promise<TabState> | null)[] = [];

  onMessage(handler: (message: unknown) => Promise<TabState> | null): () => void {
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  /** 模拟 popup 发消息。返回第一个认领它的 handler 的结果。 */
  send(message: unknown): Promise<TabState> | null {
    for (const h of this.handlers) {
      const r = h(message);
      if (r !== null) return r;
    }
    return null;
  }
}

// ──────────────────── ADR-077:闹钟替身 ────────────────────

/**
 * `AlarmsPort` 的内存替身(ADR-077)。
 *
 * 🔴 **刻意复刻平台的「同名替换」语义** —— `LockExpiryScheduler` 的延长路径
 * 正是靠它原地改期(不先 clear 再 create,那会留下一个没有闹钟的窗口)。
 * 若替身用「同名追加」实现,那条设计就测不出来了。
 *
 * 另外**刻意不自动触发**:闹钟何时响由测试显式 `fire()` 决定 ——
 * 平台的闹钟迟到量无上界(见 `lock-expiry.ts`),
 * 「真实时间到了就响」是一个本产品不能依赖的性质,替身不该提供它。
 */
export class FakeAlarms {
  /** 当前已排的闹钟:name → when。同名 create 覆盖(平台语义)。 */
  readonly alarms = new Map<string, number>();
  /** 全部 create 调用的流水(断言「排了几次、每次排到哪」)。 */
  readonly createCalls: { name: string; when: number }[] = [];
  /** 全部 clear 调用的流水。 */
  readonly clearCalls: string[] = [];
  /** 下一次 create 抛错(测平台失败时不抛给上层)。 */
  failNextCreate = false;

  readonly #listeners = new Set<(name: string) => void>();

  create(name: string, info: { readonly when: number }): Promise<void> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      return Promise.reject(new Error('alarms.create failed'));
    }
    this.createCalls.push({ name, when: info.when });
    // 平台语义:同名闹钟被**替换**,不是追加。
    this.alarms.set(name, info.when);
    return Promise.resolve();
  }

  clear(name: string): Promise<void> {
    this.clearCalls.push(name);
    this.alarms.delete(name);
    return Promise.resolve();
  }

  onAlarm(listener: (name: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 模拟闹钟触发。@returns 被通知的监听器数量。 */
  fire(name: string): number {
    const listeners = [...this.#listeners];
    for (const l of listeners) l(name);
    return listeners.length;
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }
}
