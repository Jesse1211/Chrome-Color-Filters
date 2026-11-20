/**
 * `ScriptingPort` 的生产装配 —— 唯一接触 `chrome.scripting` 的地方(ADR-062)。
 *
 * 把平台调用收束在一个薄模块里,使 `reconcile.ts` 保持零 `chrome.*`、
 * 可在 Node 下完整单测(ADR-062/064/065 的全部断言因此是机械判定的,
 * 而不是「在真实 Chrome 里看一眼」)。
 *
 * ## `scripting` 权限(ADR-062 的前提)
 *
 * 本模块的每一个调用都要求 manifest 含 `permissions: ['scripting']`。
 * **漏了的话所有注册调用都会失败**,且失败表现是「滤镜静默不生效」——
 * 排障成本极高。该权限**不增加任何用户可见的权限警告**
 * (DESIGN.md §6 第 3 条),故没有产品侧理由省它。
 * `wxt.config.ts` 已声明,`tests/project-gates.test.ts` 有机械断言把守。
 *
 * ## 为什么不用 `browser.*`(webextension-polyfill 风格)
 *
 * 本项目只发 Chrome(MV3),`chrome.scripting` 的这四个方法在
 * Chrome 96+ 均返回 Promise,无需 polyfill。少一层依赖,
 * 也少一处「polyfill 的回读对象多了字段导致 diff 永远判定变了」的风险。
 */

import {
  type RegisteredScriptLike,
  type Registration,
  type ScriptingPort,
} from './reconcile.js';

/**
 * `chrome.scripting` 里本模块需要的那部分 —— 刻意写窄。
 *
 * 不 `import` `@types/chrome`:本项目没装它,且全局 `chrome` 的类型
 * 在 content script / SW / popup 三个上下文里都要用。
 * 这里就地声明所需形状,类型安全由 `asPort` 的边界检查兜底。
 */
interface ChromeScriptingLike {
  getRegisteredContentScripts(): Promise<RegisteredScriptLike[]>;
  registerContentScripts(scripts: readonly Registration[]): Promise<void>;
  unregisterContentScripts(filter: { ids: readonly string[] }): Promise<void>;
  updateContentScripts(scripts: readonly Registration[]): Promise<void>;
}

function chromeScripting(): ChromeScriptingLike | null {
  const g = globalThis as {
    chrome?: { scripting?: unknown };
  };
  const scripting = g.chrome?.scripting;
  if (scripting === undefined || scripting === null) return null;
  const s = scripting as Partial<ChromeScriptingLike>;
  if (
    typeof s.getRegisteredContentScripts !== 'function' ||
    typeof s.registerContentScripts !== 'function' ||
    typeof s.unregisterContentScripts !== 'function' ||
    typeof s.updateContentScripts !== 'function'
  ) {
    return null;
  }
  return s as ChromeScriptingLike;
}

/**
 * 「什么都做不了」的端口 —— `chrome.scripting` 不可用时的降级。
 *
 * 何时会发生:非扩展上下文(单测、SSR)、或 `scripting` 权限缺失。
 * 降级而不抛:`reconcile()` 跑在 SW 的事件回调里,抛出去只会变成
 * 一条无人处理的 unhandled rejection,并连带破坏同一回调里的别的工作。
 *
 * ⚠️ 降级后 INV-3 的**首帧保证确实失效**(没有注册就没有首帧 CSS)。
 * 这不是「用 feature flag 把 ADR 的保证关掉」,而是平台能力缺失时的
 * 事实陈述 —— `getRegisteredContentScripts` 返回空集会让 reconcile
 * 每次都尝试重新注册,一旦权限恢复即自愈。
 */
const NULL_PORT: ScriptingPort = {
  getRegisteredContentScripts: async () => [],
  registerContentScripts: async () => {},
  unregisterContentScripts: async () => {},
  updateContentScripts: async () => {},
};

/** 取得生产用的 `ScriptingPort`;平台不可用时返回降级端口。 */
export function defaultScriptingPort(): ScriptingPort {
  const scripting = chromeScripting();
  if (scripting === null) return NULL_PORT;
  return {
    getRegisteredContentScripts: () =>
      scripting.getRegisteredContentScripts(),
    registerContentScripts: (scripts) =>
      scripting.registerContentScripts(scripts),
    unregisterContentScripts: (filter) =>
      scripting.unregisterContentScripts(filter),
    updateContentScripts: (scripts) => scripting.updateContentScripts(scripts),
  };
}

/** 平台是否可用(诊断用;不可用时首帧保证失效,见 `NULL_PORT`)。 */
export function isScriptingAvailable(): boolean {
  return chromeScripting() !== null;
}
