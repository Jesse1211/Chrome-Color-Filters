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

export interface FakeTab {
  id: number;
  url: string;
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
