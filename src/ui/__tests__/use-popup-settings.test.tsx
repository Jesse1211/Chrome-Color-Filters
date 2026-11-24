// @vitest-environment jsdom
/**
 * `usePopupSettings` —— popup 的数据接线。
 *
 * 其中一条是**回归测试**:端口以内联形式传入(每次 render 都是新引用)时
 * 不得触发无限重渲染。这个缺陷在开发 T6a 的集成测试时真实发生过 ——
 * 七个测试全部 5s 超时,症状是 popup 卡死,而不是某条断言不符。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { MemoryStorageArea } from '../../storage/memory-storage-area.js';
import {
  SETTINGS_KEY,
  SettingsRepository,
} from '../../storage/settings-repository.js';
import { FALLBACK_TAB_STATE, stubTabStatePort } from '../tab-state.js';
import { usePopupSettings } from '../usePopupSettings.js';

afterEach(cleanup);

const seeded = {
  [SETTINGS_KEY]: {
    version: 1,
    masterEnabled: true,
    rules: [{ pattern: 'a.com', mode: 'Grayscale', intensity: 100 }],
    lockUntil: null,
  },
};

/**
 * 提交计数器。
 *
 * 在 **effect** 里自增 —— 副作用必须发生在 render 之外
 * (React 的组件纯度规则;ESLint `react-hooks` 会拦 render 期间的写入)。
 * 每次**提交**计一次,正好是「有没有在无谓地反复重渲染」的度量。
 */
const commits = { count: 0 };

/** 端口**内联构造** —— 每次 render 都是新引用,这正是要防的那种写法。 */
function Probe({ repository }: { repository: SettingsRepository }) {
  const { settings, tabState, loaded } = usePopupSettings({
    repository,
    tabStatePort: stubTabStatePort({ injectable: true, host: 'a.com' }),
  });

  useEffect(() => {
    commits.count += 1;
  });

  return (
    <div>
      <span data-testid="loaded">{String(loaded)}</span>
      <span data-testid="count">{settings.rules.length}</span>
      <span data-testid="host">{tabState?.host ?? '-'}</span>
    </div>
  );
}

describe('🔴 回归:端口为不稳定引用时不得无限重渲染', () => {
  it('内联 tabStatePort 也能正常完成一次加载,渲染次数有界', async () => {
    commits.count = 0;
    const repository = new SettingsRepository({
      area: new MemoryStorageArea(seeded),
    });

    render(<Probe repository={repository} />);

    await waitFor(() => {
      expect(screen.getByTestId('loaded').textContent).toBe('true');
    });
    await waitFor(() => {
      expect(screen.getByTestId('host').textContent).toBe('a.com');
    });

    expect(screen.getByTestId('count').textContent).toBe('1');

    // 一次加载的合理渲染次数在个位数。若 effect 依赖了不稳定的端口,
    // 这里会是成百上千(或根本到不了断言,直接超时)。
    const settled = commits.count;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(commits.count).toBe(settled);
    expect(settled).toBeLessThan(15);
  });
});

describe('ADR-044 · 骨架态与降级', () => {
  it('端口返回降级值时,tabState 为 injectable:false / no-tab', async () => {
    const repository = new SettingsRepository({
      area: new MemoryStorageArea(seeded),
    });

    function Downgraded() {
      const { tabState } = usePopupSettings({
        repository,
        tabStatePort: () => Promise.resolve(FALLBACK_TAB_STATE),
      });
      return (
        <span data-testid="reason">{tabState === null ? 'pending' : tabState.reason}</span>
      );
    }

    render(<Downgraded />);
    await waitFor(() => {
      expect(screen.getByTestId('reason').textContent).toBe('no-tab');
    });
  });
});
